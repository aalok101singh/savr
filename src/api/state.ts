import { loadCards } from "../utils/data-files.js";
import type { DecisionCard } from "../types/index.js";

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
  const latest = approved[approved.length - 1];
  return {
    totalSavings,
    approvedCount: approved.length,
    lastAction: latest ? `${latest.subscriptionId}-${latest.action.toLowerCase()}` : null,
  };
}

export function deriveAgentStatus(): AgentStatusState {
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