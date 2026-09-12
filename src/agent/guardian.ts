import { Agent, BeforeToolCallEvent, BedrockModel, type JSONValue, type Model } from "@strands-agents/sdk";
import { loadEnv } from "../utils/env.js";
import { loadCachedEvidence, loadPolicy, loadSubscriptions } from "../utils/data-files.js";
import { getDemoDate } from "../utils/demo-clock.js";
import { GuardianOutputSchema, type ParsedGuardianOutput } from "./schemas.js";
import { buildTools } from "./tools/index.js";
import { checkPolicy } from "./tools/check-policy.js";
import { policyGuardrail } from "./hooks/policy-guardrail.js";
import { executeAction } from "./execute-action.js";
import { LocalModel } from "./local-model.js";
import { CANONICAL_CANDIDATE_ORDER } from "./canonical-demo.js";
import { enrichWebEvidenceMap } from "./web-evidence.js";
import type {
  DecisionAction,
  DecisionCard,
  DecisionPackage,
  Evidence,
  EvidenceChecklist,
  GuardianProgressEvent,
  Policy,
  PolicyResult,
  Subscription,
  TriggerType,
} from "../types/index.js";

const PINNED_MODEL_ID = "anthropic.claude-sonnet-4-6";

export const SYSTEM_PROMPT = `You are Savr, an autonomous procurement employee for companies without a procurement team.

Your job is to manage the company's SaaS subscriptions. You watch the stack, decide what
needs attention, act within the human's policy, negotiate when you can, and only surface
when a real decision is the human's to make.

You have two modes:
1. GUARDIAN — Review subscriptions, benchmark pricing, find alternatives, and propose
   actions with evidence. You recommend; you do not execute.
2. NEGOTIATOR — Engage a vendor in structured rounds. Code owns financial boundaries.
   You handle language and strategy.

Rules:
- Never exceed policy limits. Policy is authoritative.
- Always cite evidence. Do not invent data.
- If evidence is incomplete, recommend KEEP and explain what is missing.
- Maximum 12 tool calls per subscription evaluation.
- Maximum 5 negotiation rounds per vendor.
- For NEGOTIATE: always propose buyerOfferPrice and proposedAcceptPrice within bounds.`;

export type RunMode = "mock" | "live";

export function createModel(mode: RunMode = "mock"): Model {
  if (mode === "mock") {
    return new LocalModel();
  }
  const override = process.env.SAVR_MODEL;
  if (override && override.trim().toLowerCase() === "local") {
    return new LocalModel();
  }
  if (override && override.trim().length > 0) {
    return new BedrockModel({
      region: process.env.AWS_REGION ?? "us-east-1",
      modelId: override,
      maxTokens: 2048,
      temperature: 0.2,
      cacheConfig: { strategy: "auto" },
    });
  }
  return new BedrockModel({
    region: process.env.AWS_REGION ?? "us-east-1",
    modelId: PINNED_MODEL_ID,
    maxTokens: 2048,
    temperature: 0.2,
    cacheConfig: { strategy: "auto" },
  });
}

export function evaluateTriggers(sub: Subscription, policy: Policy, now: Date): TriggerType[] {
  const triggers: TriggerType[] = [];
  const nowMs = now.getTime();
  const renewalMs = new Date(sub.renewalDate).getTime() - nowMs;
  if (renewalMs >= 0 && renewalMs <= policy.renewalWindowDays * 24 * 60 * 60 * 1000) {
    triggers.push("renewal_soon");
  }
  if (
    sub.billingModel === "seat_based" &&
    sub.seatsPurchased !== null &&
    sub.seatsActive !== null &&
    sub.seatsActive < sub.seatsPurchased * policy.unusedSeatThresholdPct
  ) {
    triggers.push("unused_seats");
  }
  if (sub.priceIncreasePct !== null && sub.priceIncreasePct > 0) {
    triggers.push("price_increase");
  }
  if (sub.annualCost > policy.maxSingleVendorSpend) {
    triggers.push("budget_anomaly");
  }
  return triggers;
}

export function buildCandidateSet(
  all: Subscription[],
  policy: Policy,
  now: Date
): Array<{ subscription: Subscription; triggers: TriggerType[] }> {
  const base = new Map<string, TriggerType[]>(all.map((s) => [s.id, evaluateTriggers(s, policy, now)]));
  const active = all.filter((s) => s.status === "active");
  const overlapIds = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.category !== b.category) continue;
      if ((base.get(a.id)?.length ?? 0) > 0 || (base.get(b.id)?.length ?? 0) > 0) {
        overlapIds.add(a.id);
        overlapIds.add(b.id);
      }
    }
  }
  const candidates: Array<{ subscription: Subscription; triggers: TriggerType[] }> = [];
  for (const s of all) {
    const triggers = [...(base.get(s.id) ?? [])];
    if (overlapIds.has(s.id)) triggers.push("category_overlap");
    if (triggers.length > 0) {
      candidates.push({ subscription: s, triggers });
    }
  }
  candidates.sort((a, b) =>
    CANONICAL_CANDIDATE_ORDER.indexOf(a.subscription.id) - CANONICAL_CANDIDATE_ORDER.indexOf(b.subscription.id)
  );
  return candidates;
}

export function internalEvidenceFor(sub: Subscription, now: Date): Evidence {
  const isSeat = sub.seatsPurchased !== null && sub.seatsActive !== null;
  const observed = isSeat
    ? `${sub.seatsPurchased! - sub.seatsActive!} of ${sub.seatsPurchased} seats unused`
    : "usage-based (no seats)";
  return {
    id: `internal-${sub.id}-usage`,
    type: "unused_seats",
    source: "internal_data",
    url: null,
    publisher: "Acme Corp",
    retrievedAt: now.toISOString(),
    freshUntil: null,
    observedValue: observed,
    confidence: 1,
    isInternal: true,
    summary: `${sub.vendorName} utilization snapshot from Acme stack data.`,
    data: {
      seatsPurchased: sub.seatsPurchased,
      seatsActive: sub.seatsActive,
      usageMetric: sub.usageMetric,
    },
  };
}

export function computeEstimatedSavings(
  action: DecisionAction,
  sub: Subscription
): DecisionPackage["estimatedSavings"] {
  switch (action) {
    case "KEEP":
      return { amount: 0, formula: "No change", isRealized: false };
    case "DOWNGRADE": {
      const amount = sub.annualCost - (sub.seatsActive ?? 0) * (sub.pricePerSeat ?? 0);
      return {
        amount,
        formula: "annualCost - (seatsActive * pricePerSeat)",
        isRealized: false,
      };
    }
    case "SWITCH":
      return {
        amount: sub.annualCost,
        formula: "annualCost of switched-away vendor (alternative already paid for)",
        isRealized: false,
      };
    case "CANCEL":
      return { amount: sub.annualCost, formula: "annualCost (full savings)", isRealized: false };
    case "NEGOTIATE":
      return {
        amount: 0,
        formula: "0 until negotiation completes; equals realized savings afterward",
        isRealized: false,
      };
  }
}

const RISK_BY_ACTION: Record<DecisionAction, string> = {
  KEEP: "Low risk; no change. Re-evaluate at next renewal.",
  DOWNGRADE: "Affects only unused seats; some active users may rely on them.",
  SWITCH: "Migration and transition effort; data portability risk.",
  CANCEL: "Loss of the tool; the team may need a replacement.",
  NEGOTIATE: "Vendor may counter above the acceptable ceiling or stall; fallback is no agreement.",
};

function buildEvidenceChecklist(evidence: Evidence[], action: DecisionAction): EvidenceChecklist {
  const hasCurrentPriceSource = evidence.some((e) => !e.isInternal && e.type === "price_benchmark");
  const hasAlternativeSource = evidence.some((e) => !e.isInternal && e.type === "alternative_found");
  const hasInternalSignal = evidence.some((e) => e.isInternal);
  const base = { hasCurrentPriceSource, hasAlternativeSource, hasInternalSignal };
  switch (action) {
    case "KEEP":
      return { ...base, isComplete: hasInternalSignal };
    case "DOWNGRADE":
      return { ...base, isComplete: hasInternalSignal };
    case "CANCEL":
      return { ...base, isComplete: hasInternalSignal };
    case "SWITCH":
      return {
        ...base,
        isComplete: hasCurrentPriceSource && hasAlternativeSource && hasInternalSignal,
      };
    case "NEGOTIATE":
      return { ...base, isComplete: hasCurrentPriceSource && hasInternalSignal };
  }
}

function resolveEvidence(evidenceIds: string[], lookup: Record<string, Evidence>): Evidence[] {
  const resolved: Evidence[] = [];
  for (const id of evidenceIds) {
    const found = lookup[id];
    if (found) {
      resolved.push(found);
    } else {
      console.warn(`[guardian] evidence id '${id}' not resolvable; skipping.`);
    }
  }
  return resolved;
}

function buildEvidenceLookup(): Record<string, Evidence> {
  const lookup: Record<string, Evidence> = {};
  try {
    const cache = loadCachedEvidence();
    for (const entries of Object.values(cache)) {
      for (const e of entries) {
        lookup[e.id] = e;
      }
    }
  } catch (err) {
    console.warn(`[guardian] cached evidence unavailable: ${(err as Error).message}`);
  }
  return lookup;
}

function constructDecisionPackage(
  sub: Subscription,
  output: ParsedGuardianOutput,
  policyResult: PolicyResult,
  savings: DecisionPackage["estimatedSavings"],
  evidence: Evidence[],
  createdAt: string
): DecisionPackage {
  return {
    id: `pkg-${sub.id}-${createdAt}`,
    subscriptionId: sub.id,
    triggers: output.triggers,
    action: output.action,
    approvalRequirement: policyResult.requiresApproval ? "requires_approval" : "autonomous",
    reasoning: output.reasoning,
    evidence,
    evidenceChecklist: buildEvidenceChecklist(evidence, output.action),
    estimatedSavings: savings,
    risk: RISK_BY_ACTION[output.action],
    confidence: Math.max(0, Math.min(1, output.confidence)),
    createdAt,
  };
}

function constructDecisionCard(pkg: DecisionPackage, sub: Subscription, createdAt: string): DecisionCard {
  const alternatives = pkg.evidence
    .filter((e) => e.type === "alternative_found")
    .map((e) => {
      const data = (e.data ?? {}) as Record<string, unknown>;
      return {
        vendorId: typeof data.vendorId === "string" ? data.vendorId : e.observedValue,
        annualCost: typeof data.annualCost === "number" ? data.annualCost : 0,
        summary: e.summary,
      };
    });
  return {
    id: `card-${pkg.id}`,
    decisionPackageId: pkg.id,
    subscriptionId: sub.id,
    action: pkg.action,
    summary: pkg.reasoning,
    details: pkg.risk,
    estimatedSavings: pkg.estimatedSavings.amount,
    realizedSavings: 0,
    migrationNotes: pkg.action === "SWITCH" ? "Consolidate onto the retained vendor before renewal." : "None.",
    alternatives,
    createdAt,
    status: "pending",
    humanDecision: null,
    decidedAt: null,
  };
}

function buildCandidatePrompt(
  sub: Subscription,
  triggers: TriggerType[],
  policy: Policy
): string {
  const snippet = {
    subscriptionId: sub.id,
    vendorName: sub.vendorName,
    category: sub.category,
    billingModel: sub.billingModel,
    renewalDate: sub.renewalDate,
    annualCost: sub.annualCost,
    seatsPurchased: sub.seatsPurchased,
    seatsActive: sub.seatsActive,
    pricePerSeat: sub.pricePerSeat,
    priceIncreasePct: sub.priceIncreasePct,
    triggers,
  };
  const policySnippet = {
    maxAnnualBudget: policy.maxAnnualBudget,
    maxSingleVendorSpend: policy.maxSingleVendorSpend,
    renewalWindowDays: policy.renewalWindowDays,
    unusedSeatThresholdPct: policy.unusedSeatThresholdPct,
  };
  return `Evaluate this candidate subscription for corrective or protective action.

Candidate (JSON):
${JSON.stringify(snippet, null, 2)}

Policy (JSON):
${JSON.stringify(policySnippet, null, 2)}

Decide the single best action (KEEP, DOWNGRADE, SWITCH, CANCEL, or NEGOTIATE) for THIS subscription only.
Use the research tools (check_renewals, benchmark_pricing, search_alternatives) as needed and cite the evidence IDs they return.
If evidence is incomplete for a material recommendation, recommend KEEP and explain what is missing.
Then produce the structured output with subscriptionId, triggers, action, reasoning, confidence, and evidenceIds.`;
}

async function evaluateCandidate(
  agent: Agent,
  sub: Subscription,
  triggers: TriggerType[],
  policy: Policy
): Promise<ParsedGuardianOutput> {
  const prompt = buildCandidatePrompt(sub, triggers, policy);
  const result = await agent.invoke(prompt, {
    invocationState: { mode: "guardian", currentSubscriptionId: sub.id, toolCallCount: 0 },
  });
  const raw = result.structuredOutput as unknown;
  if (raw === undefined || raw === null) {
    throw new Error(`No structured output. stopReason=${result.stopReason}`);
  }
  const parsed = GuardianOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Guardian structured output failed Zod validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function createGuardianAgent(model: Model, opts?: { webEvidence?: Record<string, Evidence[]> }): Agent {
  const policy = loadPolicy();
  const all = loadSubscriptions();
  const agent = new Agent({
    model,
    tools: buildTools(opts?.webEvidence),
    systemPrompt: SYSTEM_PROMPT,
    structuredOutputSchema: GuardianOutputSchema,
    appState: {
      policy: policy as unknown as Record<string, JSONValue>,
      totalSpend: all.reduce((sum, s) => sum + s.annualCost, 0),
      maxAcceptablePrice: 0,
    },
    printer: false,
  });
  agent.addHook(BeforeToolCallEvent, policyGuardrail);
  return agent;
}

export interface RunGuardianOptions {
  mode?: RunMode;
  onProgress?: (event: GuardianProgressEvent) => void;
}

export async function runGuardian(options: RunGuardianOptions = {}): Promise<{
  packages: DecisionPackage[];
  pendingCards: DecisionCard[];
  model: string;
}> {
  loadEnv();
  const mode = options.mode ?? "mock";
  const onProgress = options.onProgress;
  const policy = loadPolicy();
  const all = loadSubscriptions();
  const now = getDemoDate();
  const candidates = buildCandidateSet(all, policy, now);
  const createdAt = now.toISOString();
  const globalEvidence = buildEvidenceLookup();

  // Live runs with a 9Router web-search gateway: build a per-candidate web-evidence
  // overlay so research tools can fall back to real pricing when cached evidence is
  // absent (the honest fallback chain: web → cache → evidence_unavailable).
  let webEvidence: Record<string, Evidence[]> | undefined;
  if (mode === "live" && process.env.NINEROUTER_URL) {
    const seen = new Set<string>();
    const toEnrich = candidates
      .map(({ subscription }) => `${subscription.category}#${subscription.id}`)
      .filter((key) => {
        if (globalEvidence[key] || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((key) => {
        const [category, id] = key.split("#");
        const sub = all.find((s) => s.id === id)!;
        return { vendorId: id, vendorName: sub.vendorName, category };
      });
    if (toEnrich.length > 0) {
      try {
        webEvidence = await enrichWebEvidenceMap(toEnrich);
        const count = Object.values(webEvidence).reduce((n, e) => n + e.length, 0);
        if (count > 0) console.warn(`[guardian] live web evidence: ${count} piece(s) from 9Router.`);
      } catch (err) {
        console.warn(`[guardian] live web enrichment failed: ${(err as Error).message}; continuing without it.`);
      }
    }
  }

  const model = createModel(mode);
  const modelLabel = String(model.getConfig().modelId ?? "unknown");
  console.warn(`[guardian] model=${modelLabel} candidates=${candidates.map((c) => c.subscription.id).join(", ")}`);

  const packages: DecisionPackage[] = [];
  const pendingCards: DecisionCard[] = [];

  for (const candidate of candidates) {
    const { subscription, triggers } = candidate;
    onProgress?.({
      subscriptionId: subscription.id,
      vendorName: subscription.vendorName,
      status: "evaluating",
    });
    const agent = createGuardianAgent(model, webEvidence ? { webEvidence } : undefined);
    try {
      const output = await evaluateCandidate(agent, subscription, triggers, policy);
      const policyResult = checkPolicy(output.action, subscription.id, policy, 0);
      const savings = computeEstimatedSavings(output.action, subscription);
      const evidenceMap: Record<string, Evidence> = {
        ...globalEvidence,
        [internalEvidenceFor(subscription, now).id]: internalEvidenceFor(subscription, now),
      };
      const evidence = resolveEvidence(output.evidenceIds, evidenceMap);
      const pkg = constructDecisionPackage(subscription, output, policyResult, savings, evidence, createdAt);
      packages.push(pkg);
      onProgress?.({
        subscriptionId: subscription.id,
        vendorName: subscription.vendorName,
        status: "done",
        action: output.action,
        confidence: output.confidence,
      });

      if (!policyResult.allowed) {
        console.warn(`[guardian] ${subscription.id}: BLOCKED (${policyResult.reason})`);
        continue;
      }
      if (policyResult.requiresApproval) {
        const card = constructDecisionCard(pkg, subscription, createdAt);
        pendingCards.push(card);
        console.warn(`[guardian] ${subscription.id}: ${output.action} requires approval — pending card ${card.id}.`);
      } else {
        const mutation = executeAction(subscription, output.action);
        console.warn(
          `[guardian] ${subscription.id}: ${output.action} executed autonomously — mutation ${JSON.stringify(mutation.changes)}.`
        );
      }
    } catch (err) {
      onProgress?.({
        subscriptionId: subscription.id,
        vendorName: subscription.vendorName,
        status: "done",
      });
      console.warn(`[guardian] evaluation FAILED for ${subscription.id}: ${(err as Error).message}`);
    }
  }

  return { packages, pendingCards, model: modelLabel };
}

async function main(): Promise<void> {
  const { packages, pendingCards, model } = await runGuardian();
  console.log(JSON.stringify(packages, null, 2));
  console.error(`[guardian] done. ${packages.length} packages, ${pendingCards.length} pending card(s), model=${model}`);
}

if (process.argv[1]?.endsWith("guardian.ts")) {
  main().catch((err) => {
    console.error(`[guardian] fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}