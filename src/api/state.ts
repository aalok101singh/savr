import { loadCards, loadMemory } from "../utils/data-files.js";
import type { DecisionCard, ProcurementMemory } from "../types/index.js";

export type AgentMode = "guardian" | "negotiator" | "idle" | "waiting_for_approval";

export interface SavingsState {
  totalSavings: number;
  approvedCount: number;
  lastAction: string | null;
}

export interface AgentStatusState {
  mode: AgentMode;
  pendingCardId: string | null;
  currentSubscriptionId: string | null;
}

export function computeSavings(cards: DecisionCard[]): SavingsState {
  const approved = cards
    .filter((c) => c.status === "approved")
    .slice()
    .sort((a, b) => (a.decidedAt ?? "").localeCompare(b.decidedAt ?? ""));
  let totalSavings = 0;
  for (const card of approved) {
    totalSavings += card.action === "NEGOTIATE" ? card.realizedSavings : card.estimatedSavings;
  }
  const latest = latestApprovedAction(cards, approved);
  return {
    totalSavings,
    approvedCount: approved.length,
    lastAction: latest ? `${latest.subscriptionId}-${latest.action.toLowerCase()}` : null,
  };
}

// "last action" is whichever decision was approved most recently. Memory records
// decisions in strict approval order, so it is the deterministic source (decidedAt
// alone is ambiguous: the demo clock is fixed, so two approvals in the same run
// share a timestamp and card file order is not an approval ordering). Falls back
// to the largest decidedAt when memory is out of sync (e.g. freshly imported).
function latestApprovedAction(
  cards: DecisionCard[],
  approvedByTime: DecisionCard[]
): DecisionCard | undefined {
  const memory = readMemorySafely();
  if (memory && memory.decisions.length > 0) {
    const ids = new Set(approvedByTime.map((c) => c.decisionPackageId));
    for (let i = memory.decisions.length - 1; i >= 0; i--) {
      const decision = memory.decisions[i];
      if (ids.has(decision.decisionPackageId)) {
        const card = cards.find((c) => c.decisionPackageId === decision.decisionPackageId);
        if (card) return card;
      }
    }
  }
  return approvedByTime[approvedByTime.length - 1];
}

// Read memory without throwing on a missing/stale file; deriveAgentStatus callers
// (e.g. SSE endpoints) must never crash because memory.json is unavailable.
function readMemorySafely(): ProcurementMemory | null {
  try {
    return loadMemory();
  } catch {
    return null;
  }
}

// Authoritative in-memory run status, separate from persisted cards. It is set by
// whoever actually runs the agent (demo/run, an approval that triggers a
// negotiation, the autopilot) and cleared when the run ends, so status reads and
// SSE broadcasts report Guardian/Negotiator activity while a run is in flight
// instead of guessing "idle" or "waiting_for_approval" from stale cards.
let runMode: "guardian" | "negotiator" | null = null;
let runSubscriptionId: string | null = null;

export function setAgentRunStatus(mode: "guardian" | "negotiator", currentSubscriptionId: string | null): void {
  runMode = mode;
  runSubscriptionId = currentSubscriptionId;
}

export function clearAgentRunStatus(): void {
  runMode = null;
  runSubscriptionId = null;
}

export function deriveAgentStatus(): AgentStatusState {
  if (runMode) {
    return {
      mode: runMode,
      pendingCardId: null,
      currentSubscriptionId: runSubscriptionId,
    };
  }
  const pending = loadCards().filter((c) => c.status === "pending");
  if (pending.length > 0) {
    return {
      mode: "waiting_for_approval",
      pendingCardId: pending[0].id,
      currentSubscriptionId: pending[0].subscriptionId,
    };
  }
  return { mode: "idle", pendingCardId: null, currentSubscriptionId: null };
}

export function pendingCount(cards: DecisionCard[]): number {
  return cards.filter((c) => c.status === "pending").length;
}