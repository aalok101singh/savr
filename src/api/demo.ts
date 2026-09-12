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
import { broadcastSse, clearRecording } from "./sse.js";
import {
  clearAgentRunStatus,
  computeSavings,
  deriveAgentStatus,
  pendingCount,
  setAgentRunStatus,
} from "./state.js";
import type { DemoResetResponse } from "../types/index.js";

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

// Shared agent-run lock: a manual `demo/run`, an approval that triggers a
// negotiation, and the autonomous scheduler must never run the agent concurrently
// — everything clobbers the same cards/packages/subscriptions files. The lock also
// backs the authoritative in-memory run status surfaced by /api/agent/status.
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
    clearAgentRunStatus();
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

  setAgentRunStatus("guardian", null);
  broadcastSse("agent_status", { mode: "guardian", pendingCardId: null, currentSubscriptionId: null });

  const { packages, pendingCards, model } = await runGuardian({
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
  console.warn(`[api:demo] guardian done (${packages.length} packages, ${pendingCards.length} approval card(s), model=${model}).`);

  // Persist the approval-required cards Guardian created (NEGOTIATE, SWITCH, and
  // spend-threshold-crossing KEEP/DOWNGRADE/CANCEL). NEGOTIATE cards are persisted
  // WITHOUT contacting the vendor — the negotiation only runs on the approved-card
  // transition, so the human gate precedes any vendor contact. No card is
  // duplicated: a pending card for the same (subscription, action) is replaced.
  for (const card of pendingCards) {
    const cards = loadCards().filter(
      (c) => !(c.subscriptionId === card.subscriptionId && c.action === card.action && c.status === "pending")
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
    console.warn(`[api:demo] ${card.subscriptionId}: ${card.action} requires approval — card ${card.id} persisted.`);
  }

  const subscriptions = loadSubscriptions();
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

  // A successful reset must look successful: keep the post-reset sync events out
  // of the freshly cleared recording and never emit an error for a happy path.
  broadcastSse("savings_update", computeSavings([]), { record: false });
  broadcastSse("agent_status", deriveAgentStatus(), { record: false });

  return {
    subscriptionsReset,
    negotiationsCleared: 0,
    cardsCleared,
    savingsReset: 1,
  };
}