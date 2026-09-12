import { getDemoDate } from "../utils/demo-clock.js";
import { loadCards, loadMemory, loadSubscriptions, saveCards, saveMemory, saveSubscriptions } from "../utils/data-files.js";
import { broadcastSse } from "./sse.js";
import { computeSavings, deriveAgentStatus } from "./state.js";
import type { DecisionCard, PostApprovalMutation, Subscription } from "../types/index.js";

export class CardTransitionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function buildPostApprovalMutation(card: DecisionCard, sub: Subscription): PostApprovalMutation {
  switch (card.action) {
    case "NEGOTIATE": {
      const offer = card.negotiation?.currentOffer;
      if (!offer) {
        throw new CardTransitionError(`Card ${card.id}: NEGOTIATE has no final offer to apply.`, 409);
      }
      return {
        action: "NEGOTIATE",
        subscriptionId: sub.id,
        changes: { renewalCost: offer.totalAnnual },
      };
    }
    case "SWITCH":
      return {
        action: "SWITCH",
        subscriptionId: sub.id,
        changes: { status: "switched" },
      };
    case "DOWNGRADE": {
      const seatsActive = sub.seatsActive ?? sub.seatsPurchased ?? 0;
      const annualCost = seatsActive * (sub.pricePerSeat ?? 0);
      return {
        action: "DOWNGRADE",
        subscriptionId: sub.id,
        changes: { annualCost, notes: `${sub.notes} [DOWNGRADED ${getDemoDate().toISOString()}]`.trim() },
      };
    }
    case "CANCEL":
      return {
        action: "CANCEL",
        subscriptionId: sub.id,
        changes: { autoRenew: false, status: "cancelled", renewalCost: 0 },
      };
    case "KEEP":
      return { action: "KEEP", subscriptionId: sub.id, changes: {} };
  }
}

function recordMemory(card: DecisionCard, decidedAt: string): void {
  const memory = loadMemory();
  memory.decisions.push({
    id: `dec-${card.id}`,
    decisionPackageId: card.decisionPackageId,
    subscriptionId: card.subscriptionId,
    action: card.action,
    estimatedSavings: card.estimatedSavings,
    realizedSavings: card.realizedSavings,
    decidedAt,
    humanDecision: card.humanDecision,
  });
  if (card.action === "NEGOTIATE" && card.negotiation) {
    memory.negotiations.push({
      id: `neg-${card.subscriptionId}-${decidedAt}`,
      subscriptionId: card.subscriptionId,
      resolution: card.negotiation.resolution ?? "max_rounds",
      finalOffer: card.negotiation.currentOffer,
      roundsCompleted: card.negotiation.round,
      completedAt: decidedAt,
    });
  }
  saveMemory(memory);
}

function replaceCard(cards: DecisionCard[], updated: DecisionCard): DecisionCard[] {
  return cards.map((c) => (c.id === updated.id ? updated : c));
}

export function approveCard(cardId: string): { card: DecisionCard; mutation: PostApprovalMutation } {
  const cards = loadCards();
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    throw new CardTransitionError("Card not found.", 404);
  }
  if (card.status === "approved") {
    // Idempotent: a repeated approve returns the existing result.
    return { card, mutation: buildPostApprovalMutation(card, loadSubscriptions().find((s) => s.id === card.subscriptionId)!) };
  }
  if (card.status === "rejected") {
    throw new CardTransitionError(`Card ${cardId} is already rejected.`, 409);
  }

  const subscriptions = loadSubscriptions();
  const sub = subscriptions.find((s) => s.id === card.subscriptionId);
  if (!sub) {
    throw new CardTransitionError(`Subscription '${card.subscriptionId}' not found.`, 404);
  }

  const mutation = buildPostApprovalMutation(card, sub);
  for (const [key, value] of Object.entries(mutation.changes)) {
    (sub as unknown as Record<string, unknown>)[key] = value;
  }
  saveSubscriptions(subscriptions);

  const decidedAt = getDemoDate().toISOString();
  const updated: DecisionCard = {
    ...card,
    status: "approved",
    humanDecision: "approved",
    decidedAt,
  };
  const savedCards = replaceCard(loadCards(), updated);
  saveCards(savedCards);
  recordMemory(updated, decidedAt);

  broadcastSse("decision_card", {
    cardId: updated.id,
    subscriptionId: updated.subscriptionId,
    action: updated.action,
    status: updated.status,
    estimatedSavings: updated.estimatedSavings,
    realizedSavings: updated.realizedSavings,
    summary: updated.summary,
  });
  broadcastSse("savings_update", computeSavings(savedCards));
  broadcastSse("agent_status", deriveAgentStatus());

  return { card: updated, mutation };
}

export function rejectCard(cardId: string): { card: DecisionCard } {
  const cards = loadCards();
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    throw new CardTransitionError("Card not found.", 404);
  }
  if (card.status === "rejected") {
    return { card };
  }
  if (card.status === "approved") {
    throw new CardTransitionError(`Card ${cardId} is already approved.`, 409);
  }

  const decidedAt = getDemoDate().toISOString();
  const updated: DecisionCard = {
    ...card,
    status: "rejected",
    humanDecision: "rejected",
    decidedAt,
  };
  const savedCards = replaceCard(loadCards(), updated);
  saveCards(savedCards);

  broadcastSse("decision_card", {
    cardId: updated.id,
    subscriptionId: updated.subscriptionId,
    action: updated.action,
    status: updated.status,
    estimatedSavings: updated.estimatedSavings,
    realizedSavings: updated.realizedSavings,
    summary: updated.summary,
  });
  broadcastSse("agent_status", deriveAgentStatus());

  return { card: updated };
}

