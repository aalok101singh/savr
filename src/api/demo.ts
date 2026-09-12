import { getDemoDate } from "../utils/demo-clock.js";
import {
  ensureSeed,
  loadCards,
  loadSubscriptions,
  saveCards,
  saveMemory,
  savePackages,
  saveSubscriptions,
  seedMemory,
  seedSubscriptions,
} from "../utils/data-files.js";
import { runGuardian } from "../agent/guardian.js";
import { runNegotiation } from "../agent/negotiator.js";
import { broadcastSse, clearRecording } from "./sse.js";
import { computeSavings, deriveAgentStatus, pendingCount } from "./state.js";
import type { DecisionCard, DecisionPackage, DemoResetResponse, Subscription } from "../types/index.js";

export type DemoMode = "mock" | "live";

export interface DemoRunResult {
  status: "complete";
  decisionPackages: number;
  cardsPending: number;
  autonomousActions: number;
  savings: number;
  subscriptionsChecked: number;
}

export interface DemoRunOptions {
  mode?: DemoMode;
}

// Shared agent-run lock: a manual `demo/run` and the autonomous scheduler must never
// run Guardian or the negotiator concurrently — both clobber the same cards/packages.
let agentBusy = false;

export function agentIsBusy(): boolean {
  return agentBusy;
}

export async function withAgentLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (agentBusy) return null;
  agentBusy = true;
  try {
    return await fn();
  } finally {
    agentBusy = false;
  }
}

function buildSwitchCard(pkg: DecisionPackage, sub: Subscription, createdAt: string): DecisionCard {
  return {
    id: `card-switch-${sub.id}-${createdAt}`,
    decisionPackageId: pkg.id,
    subscriptionId: sub.id,
    action: "SWITCH",
    summary: `${sub.vendorName} overlaps ${pkg.reasoning}`.slice(0, 220),
    details: pkg.reasoning,
    estimatedSavings: pkg.estimatedSavings.amount,
    realizedSavings: 0,
    migrationNotes: "Consolidate onto the retained vendor (Veed) before renewal; cancel this subscription.",
    alternatives: pkg.evidence
      .filter((e) => e.type === "alternative_found")
      .map((e) => {
        const data = (e.data ?? {}) as Record<string, unknown>;
        return {
          vendorId: typeof data.vendorId === "string" ? data.vendorId : e.observedValue,
          annualCost: typeof data.annualCost === "number" ? data.annualCost : 0,
          summary: e.summary,
        };
      }),
    createdAt,
    status: "pending",
    humanDecision: null,
    decidedAt: null,
  };
}

async function runCanonicalNegotiation(subscriptionId: string): Promise<void> {
  broadcastSse("agent_status", { mode: "negotiator", pendingCardId: null, currentSubscriptionId: subscriptionId });

  const { state, card, closeSandbox } = await runNegotiation(subscriptionId);
  try {
    const accepted = state.resolution === "accepted";
    const normalized: DecisionCard = accepted
      ? { ...card, estimatedSavings: card.realizedSavings }
      : card;
    const cards = loadCards().filter((c) => !(c.subscriptionId === subscriptionId && c.status === "pending"));
    cards.push(normalized);
    saveCards(cards);

    for (const message of state.messages) {
      broadcastSse("negotiation_message", {
        subscriptionId: state.subscriptionId,
        round: message.round,
        role: message.role,
        content: message.content,
        currentOffer: message.currentOffer,
        targetPrice: state.targetPrice,
        maxAcceptablePrice: state.maxAcceptablePrice,
        buyerOfferPrice: message.buyerOfferPrice,
        proposedAcceptPrice: state.proposedAcceptPrice,
      });
    }
    broadcastSse("decision_card", {
      cardId: normalized.id,
      subscriptionId: normalized.subscriptionId,
      action: normalized.action,
      status: normalized.status,
      estimatedSavings: normalized.estimatedSavings,
      realizedSavings: normalized.realizedSavings,
      summary: normalized.summary,
    });
  } finally {
    await closeSandbox();
  }
}

export async function runDemo(options: DemoRunOptions = {}): Promise<DemoRunResult> {
  const mode = options.mode ?? "mock";
  ensureSeed();
  if (mode === "mock") {
    saveSubscriptions(seedSubscriptions());
    saveMemory(seedMemory());
    saveCards([]);
    savePackages([]);
    clearRecording();
  }

  broadcastSse("agent_status", { mode: "guardian", pendingCardId: null, currentSubscriptionId: null });

  const { packages, model } = await runGuardian({
    mode,
    onProgress: (event) => broadcastSse("guardian_progress", event),
  });
  savePackages(packages);

  for (const pkg of packages) {
    broadcastSse("guardian_update", {
      subscriptionId: pkg.subscriptionId,
      action: pkg.action,
      estimatedSavings: pkg.estimatedSavings.amount,
      confidence: pkg.confidence,
      evidenceCount: pkg.evidence.length,
      requiresApproval: pkg.approvalRequirement === "requires_approval",
    });
  }
  console.warn(`[api:demo] guardian done (${packages.length} packages, model=${model}).`);

  const createdAt = getDemoDate().toISOString();

  for (const pkg of packages) {
    if (pkg.action === "NEGOTIATE") {
      try {
        await runCanonicalNegotiation(pkg.subscriptionId);
      } catch (err) {
        broadcastSse("error", { code: "negotiation_failed", message: (err as Error).message });
        console.warn(`[api:demo] negotiation failed for ${pkg.subscriptionId}: ${(err as Error).message}`);
      }
    }
  }

  const subscriptions = loadSubscriptions();
  const existingCards = loadCards();
  for (const pkg of packages) {
    if (pkg.action !== "SWITCH") continue;
    const target = subscriptions.find((s) => s.id === pkg.subscriptionId);
    if (!target) {
      console.warn(`[api:demo] SWITCH package for unknown subscription '${pkg.subscriptionId}'; skipping.`);
      continue;
    }
    if (existingCards.some((c) => c.subscriptionId === pkg.subscriptionId && c.action === "SWITCH" && c.status === "pending")) {
      continue;
    }
    const card = buildSwitchCard(pkg, target, createdAt);
    const cards = loadCards().filter(
      (c) => !(c.subscriptionId === pkg.subscriptionId && c.action === "SWITCH" && c.status === "pending")
    );
    cards.push(card);
    saveCards(cards);
    broadcastSse("decision_card", {
      cardId: card.id,
      subscriptionId: card.subscriptionId,
      action: card.action,
      status: card.status,
      estimatedSavings: card.estimatedSavings,
      realizedSavings: card.realizedSavings,
      summary: card.summary,
    });
  }

  const cards = loadCards();
  broadcastSse("savings_update", computeSavings(cards));
  broadcastSse("agent_status", deriveAgentStatus());

  const autonomousActions = packages.filter((p) => p.approvalRequirement === "autonomous").length;
  return {
    status: "complete",
    decisionPackages: packages.length,
    cardsPending: pendingCount(cards),
    autonomousActions,
    savings: 0,
    subscriptionsChecked: subscriptions.length,
  };
}

export function resetDemo(): DemoResetResponse {
  ensureSeed();
  const subscriptionsReset = loadSubscriptions().length;
  const cardsCleared = loadCards().length;
  saveSubscriptions(seedSubscriptions());
  saveMemory(seedMemory());
  saveCards([]);
  savePackages([]);
  clearRecording();

  broadcastSse("savings_update", computeSavings([]));
  broadcastSse("agent_status", deriveAgentStatus());
  broadcastSse("error", { code: "memory_unavailable", message: "Local mode — procurement memory stored in data/memory.json." });

  return {
    subscriptionsReset,
    negotiationsCleared: 0,
    cardsCleared,
    savingsReset: 1,
  };
}