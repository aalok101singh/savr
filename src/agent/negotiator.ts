import { Agent, BeforeToolCallEvent, type JSONValue, type Model } from "@strands-agents/sdk";
import { loadEnv } from "../utils/env.js";
import { loadPolicy, loadSubscriptions, upsertPendingCard } from "../utils/data-files.js";
import { getDemoDate } from "../utils/demo-clock.js";
import { NegotiationOutputSchema, type ParsedNegotiationOutput } from "./schemas.js";
import { SYSTEM_PROMPT, createModel } from "./guardian.js";
import { buildTools } from "./tools/index.js";
import { policyGuardrail } from "./hooks/policy-guardrail.js";
import { sendNegotiationMessage } from "./tools/send-negotiation-message.js";
import { parseVendorResponse } from "./tools/parse-vendor-response.js";
import { resolveSandboxPort, sandboxReachable, startSandboxServer, type SandboxServer } from "../sandbox/server.js";
import type { DecisionCard, NegotiationState, Offer, Subscription } from "../types/index.js";

export const CANONICAL_NEGOTIATION_TARGET = 9800;
export const CANONICAL_NEGOTIATION_MAX_ROUNDS = 5;

export function createNegotiatorAgent(model: Model, maxAcceptablePrice: number): Agent {
  const policy = loadPolicy();
  const all = loadSubscriptions();
  const agent = new Agent({
    model,
    tools: buildTools(),
    systemPrompt: SYSTEM_PROMPT,
    structuredOutputSchema: NegotiationOutputSchema,
    appState: {
      policy: policy as unknown as Record<string, JSONValue>,
      totalSpend: all.reduce((sum, s) => sum + s.annualCost, 0),
      maxAcceptablePrice,
    },
    printer: false,
  });
  agent.addHook(BeforeToolCallEvent, policyGuardrail);
  return agent;
}

export function buildNegotiationPrompt(state: NegotiationState, sub: Subscription): string {
  return `You are Savr in NEGOTIATOR mode, negotiating the annual renewal of subscription "${sub.id}" with vendor ${sub.vendorName}. Code owns the financial boundaries; you handle language and strategy.

Negotiation state (JSON):
${JSON.stringify(
  {
    round: state.round,
    maxRounds: state.maxRounds,
    currentPrice: state.currentPrice,
    targetPrice: state.targetPrice,
    maxAcceptablePrice: state.maxAcceptablePrice,
    currentOffer: state.currentOffer,
  },
  null,
  2
)}

Craft THIS round's message and propose prices:
- buyerOfferPrice: the price you propose to the vendor this round.
- proposedAcceptPrice: the highest price you would accept this round.
Both must be positive numbers within [0, maxAcceptablePrice]; never exceed maxAcceptablePrice.
Then emit the structured output { message, buyerOfferPrice, proposedAcceptPrice, reasoning }.`;
}

export async function negotiateRound(
  agent: Agent,
  state: NegotiationState,
  sub: Subscription
): Promise<ParsedNegotiationOutput> {
  const result = await agent.invoke(buildNegotiationPrompt(state, sub), {
    structuredOutputSchema: NegotiationOutputSchema,
    invocationState: {
      mode: "negotiator",
      round: state.round,
      currentSubscriptionId: sub.id,
      currentPrice: state.currentPrice,
      buyerCurrentPrice: state.currentPrice,
      maxAcceptablePrice: state.maxAcceptablePrice,
      targetPrice: state.targetPrice,
      toolCallCount: 0,
    },
  });
  const raw = result.structuredOutput as unknown;
  if (raw === undefined || raw === null) {
    throw new Error(`No structured output for round ${state.round}. stopReason=${result.stopReason}`);
  }
  const parsed = NegotiationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Negotiation structured output failed Zod validation: ${parsed.error.message}`);
  }
  const output = parsed.data;
  output.buyerOfferPrice = Math.min(output.buyerOfferPrice, state.maxAcceptablePrice);
  output.proposedAcceptPrice = Math.min(output.proposedAcceptPrice, state.maxAcceptablePrice);
  return output;
}

export function initNegotiationState(sub: Subscription): NegotiationState {
  return {
    subscriptionId: sub.id,
    round: 0,
    maxRounds: CANONICAL_NEGOTIATION_MAX_ROUNDS,
    currentPrice: sub.annualCost,
    targetPrice: CANONICAL_NEGOTIATION_TARGET,
    maxAcceptablePrice: Math.round(sub.annualCost * 0.9),
    buyerOfferPrice: null,
    proposedAcceptPrice: null,
    currentOffer: null,
    resolution: null,
    messages: [],
  };
}

export function pushAgentMessage(
  state: NegotiationState,
  output: ParsedNegotiationOutput,
  timestamp: string
): void {
  state.messages.push({
    role: "agent",
    content: output.message,
    timestamp,
    round: state.round,
    buyerOfferPrice: output.buyerOfferPrice,
    currentOffer: null,
  });
}

export function pushVendorMessage(
  state: NegotiationState,
  content: string,
  offer: Offer,
  timestamp: string
): void {
  state.messages.push({
    role: "vendor",
    content,
    timestamp,
    round: state.round,
    buyerOfferPrice: state.buyerOfferPrice,
    currentOffer: offer,
  });
}

export function constructNegotiationCard(
  state: NegotiationState,
  sub: Subscription,
  realizedSavings: number,
  createdAt: string
): DecisionCard {
  const final = state.currentOffer;
  const price = final ? final.totalAnnual : null;
  const summary =
    state.resolution === "accepted" && price !== null
      ? `${sub.vendorName} negotiated from $${state.currentPrice}/yr to $${price}/yr — realized savings $${realizedSavings}/yr.`
      : `${sub.vendorName} negotiation ${state.resolution} — no agreement reached.`;
  return {
    id: `card-neg-${sub.id}-${createdAt}`,
    decisionPackageId: `pkg-${sub.id}-${createdAt}`,
    subscriptionId: sub.id,
    action: "NEGOTIATE",
    summary,
    details:
      `Negotiation resolution: ${state.resolution}. Rounds: ${state.round}/${state.maxRounds} cap. ` +
      `Target price $${state.targetPrice}, max acceptable $${state.maxAcceptablePrice}.`,
    negotiation: state,
    estimatedSavings: 0,
    realizedSavings,
    migrationNotes: "None.",
    alternatives: [],
    createdAt,
    status: "pending",
    humanDecision: null,
    decidedAt: null,
  };
}

async function waitForSandbox(port: number, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await sandboxReachable(port, 500)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`Sandbox did not become reachable on port ${port}.`);
}

export async function runNegotiation(
  subscriptionId = "notion",
  options: { mode?: "mock" | "live" } = {}
): Promise<{
  state: NegotiationState;
  card: DecisionCard;
  model: string;
  sandboxPort: number;
  sandboxStarted: boolean;
  closeSandbox: () => Promise<void>;
}> {
  loadEnv();
  const mode = options.mode ?? "mock";
  const sub = loadSubscriptions().find((s) => s.id === subscriptionId);
  if (!sub) {
    throw new Error(`Unknown subscription '${subscriptionId}'.`);
  }
  const now = getDemoDate();
  const state = initNegotiationState(sub);

  const model = createModel(mode);
  const modelLabel = String(model.getConfig().modelId ?? "unknown");
  console.warn(
    `[negotiator] sub=${sub.id} model=${modelLabel} target=${state.targetPrice} maxAcceptable=${state.maxAcceptablePrice}`
  );

  let sandboxPort = resolveSandboxPort();
  let startedSandbox: SandboxServer | null = null;
  if (!(await sandboxReachable(sandboxPort))) {
    console.warn(`[negotiator] sandbox not reachable on ${sandboxPort}; starting it in-process.`);
    startedSandbox = startSandboxServer(sandboxPort, { unref: true });
    sandboxPort = startedSandbox.port;
    await waitForSandbox(sandboxPort);
  }

  const closeSandbox = async (): Promise<void> => {
    const serverToClose = startedSandbox?.server;
    if (serverToClose) {
      await new Promise<void>((resolve) => serverToClose.close(() => resolve()));
    }
    startedSandbox = null;
  };

  const agent = createNegotiatorAgent(model, state.maxAcceptablePrice);
  let retriesUsed = 0;

  while (state.round < state.maxRounds) {
    state.round += 1;
    let output: ParsedNegotiationOutput;
    try {
      output = await negotiateRound(agent, state, sub);
    } catch (err) {
      if (retriesUsed < 1) {
        retriesUsed += 1;
        state.round -= 1;
        console.warn(
          `[negotiator] round ${state.round + 1} model output failed (${(err as Error).message}); retrying.`
        );
        continue;
      }
      state.resolution = "stalled";
      console.warn(`[negotiator] stalled: model output failed '${(err as Error).message}'.`);
      break;
    }
    state.buyerOfferPrice = output.buyerOfferPrice;
    state.proposedAcceptPrice = output.proposedAcceptPrice;
    pushAgentMessage(state, output, now.toISOString());

    const result = await sendNegotiationMessage(sub.id, output.message, output.buyerOfferPrice, {
      round: state.round,
      buyerCurrentPrice: state.currentPrice,
    });

    if (result.status === "error") {
      if (retriesUsed < 1) {
        retriesUsed += 1;
        state.round -= 1;
        console.warn(`[negotiator] round ${state.round + 1} send failed (${result.error}); retrying.`);
        continue;
      }
      state.resolution = "stalled";
      console.warn(`[negotiator] stalled: send error '${result.error}'.`);
      break;
    }

    const parsed = parseVendorResponse(result.offer ? JSON.stringify(result.offer) : result.response);
    if (parsed.status === "parse_failure") {
      state.resolution = "stalled";
      console.warn(`[negotiator] stalled: vendor response unparseable (${parsed.reason}).`);
      break;
    }
    state.currentOffer = parsed.offer;
    pushVendorMessage(state, result.response, parsed.offer, now.toISOString());
    console.warn(
      `[negotiator] round ${state.round}: offered ${output.buyerOfferPrice}, vendor counter ${state.currentOffer.totalAnnual}.`
    );

    if (state.currentOffer.totalAnnual <= state.proposedAcceptPrice) {
      state.resolution = "accepted";
      console.warn(
        `[negotiator] accepted $${state.currentOffer.totalAnnual} (<= proposedAcceptPrice $${state.proposedAcceptPrice}).`
      );
      break;
    }
  }

  if (state.resolution === null) {
    state.resolution = "max_rounds";
  }

  const realizedSavings = state.currentOffer ? state.currentPrice - state.currentOffer.totalAnnual : 0;
  const card = constructNegotiationCard(state, sub, realizedSavings, now.toISOString());
  const cards = upsertPendingCard(card);
  console.warn(`[negotiator] card persisted (${cards.length} pending card(s) on file).`);

  return { state, card, model: modelLabel, sandboxPort, sandboxStarted: startedSandbox !== null, closeSandbox };
}

async function main(): Promise<void> {
  const { state, card, sandboxPort, closeSandbox } = await runNegotiation("notion");
  console.log(JSON.stringify(card, null, 2));
  console.error(
    `[negotiator] done. resolution=${state.resolution} rounds=${state.round} realizedSavings=${card.realizedSavings} sandboxPort=${sandboxPort}`
  );
  const gateOk = card.status === "pending" && card.realizedSavings === 2160;
  await closeSandbox();
  process.exitCode = gateOk ? 0 : 2;
}

if (process.argv[1]?.endsWith("negotiator.ts")) {
  main().catch((err) => {
    console.error(`[negotiator] fatal: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}