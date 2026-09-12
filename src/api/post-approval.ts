import { getDemoDate } from "../utils/demo-clock.js";
import {
  loadCards,
  loadMemory,
  loadSubscriptions,
  saveCards,
  saveMemory,
  saveSubscriptions,
} from "../utils/data-files.js";
import { runNegotiation } from "../agent/negotiator.js";
import { broadcastSse } from "./sse.js";
import { computeSavings, deriveAgentStatus } from "./state.js";
import type { DecisionCard, NegotiationState, PostApprovalMutation, Subscription } from "../types/index.js";

export class CardTransitionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// A NEGOTIATE action can only be approved when the vendor has actually accepted a
// final offer. An unfinished, stalled, rejected, or round-exhausted negotiation
// has nothing a human can approve, so the transition is refused before any
// mutation touches procurement data.
function requireAcceptedOffer(card: DecisionCard): number {
  const negotiation = card.negotiation;
  if (!negotiation || negotiation.resolution !== "accepted" || !negotiation.currentOffer) {
    throw new CardTransitionError(
      `Card ${card.id}: negotiation did not reach an accepted agreement` +
        ` (resolution=${negotiation?.resolution ?? "none"}); nothing to approve.`,
      409
    );
  }
  return negotiation.currentOffer.totalAnnual;
}

export function buildPostApprovalMutation(card: DecisionCard, sub: Subscription): PostApprovalMutation {
  switch (card.action) {
    case "NEGOTIATE": {
      const totalAnnual = requireAcceptedOffer(card);
      return {
        action: "NEGOTIATE",
        subscriptionId: sub.id,
        changes: { renewalCost: totalAnnual },
      };
    }
    case "SWITCH":
      return {
        action: "SWITCH",
        subscriptionId: sub.id,
        changes: { status: "switched" },
      };
    case "DOWNGRADE": {
      if (sub.billingModel !== "seat_based") {
        throw new CardTransitionError(
          `Card ${card.id}: DOWNGRADE is only valid for seat-based subscriptions; '${sub.id}' is ${sub.billingModel}.`,
          409
        );
      }
      const seatsActive = sub.seatsActive ?? sub.seatsPurchased ?? 0;
      const pricePerSeat = sub.pricePerSeat ?? 0;
      if (!Number.isFinite(pricePerSeat) || pricePerSeat <= 0 || !Number.isFinite(seatsActive) || seatsActive < 0) {
        throw new CardTransitionError(
          `Card ${card.id}: DOWNGRADE requires a valid pricePerSeat and seatsActive on '${sub.id}' ` +
            `(got ${pricePerSeat}/${seatsActive}).`,
          409
        );
      }
      const annualCost = seatsActive * pricePerSeat;
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

function broadcastNegotiation(state: NegotiationState): void {
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
}

function broadcastCard(card: DecisionCard): void {
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

// The human gate comes BEFORE any vendor contact: a NEGOTIATE card is approved
// as a decision to negotiate, and only then does the negotiator engage the vendor.
// The resulting terms must be accepted for the mutation to apply.
async function prepareNegotiationCard(card: DecisionCard): Promise<DecisionCard> {
  if (card.negotiation?.resolution != null) {
    return card;
  }
  broadcastSse("agent_status", {
    mode: "negotiator",
    pendingCardId: card.id,
    currentSubscriptionId: card.subscriptionId,
  });
  let negotiation: NegotiationState;
  try {
    const { state, closeSandbox } = await runNegotiation(card.subscriptionId);
    negotiation = state;
    await closeSandbox();
  } catch (err) {
    throw new CardTransitionError(
      `Card ${card.id}: negotiation failed (${(err as Error).message}); card not approved.`,
      409
    );
  }
  const now = getDemoDate().toISOString();
  const realizedSavings = negotiation.currentOffer
    ? negotiation.currentPrice - negotiation.currentOffer.totalAnnual
    : 0;
  const price = negotiation.currentOffer?.totalAnnual ?? null;
  const updated: DecisionCard = {
    ...card,
    summary:
      negotiation.resolution === "accepted" && price !== null
        ? `${card.summary} Negotiated from $${negotiation.currentPrice}/yr to $${price}/yr — realized savings $${realizedSavings}/yr.`
        : card.summary,
    negotiation,
    estimatedSavings: 0,
    realizedSavings,
  };
  const cards = loadCards().filter(
    (c) => !(c.subscriptionId === card.subscriptionId && c.action === "NEGOTIATE" && c.status === "pending")
  );
  cards.push(updated);
  saveCards(cards);
  broadcastNegotiation(negotiation);
  broadcastCard(updated);
  return updated;
}

export async function approveCard(cardId: string): Promise<{ card: DecisionCard; mutation: PostApprovalMutation }> {
  const cards = loadCards();
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    throw new CardTransitionError("Card not found.", 404);
  }
  if (card.status === "approved") {
    // Idempotent: a repeated approve returns the existing result.
    const sub = loadSubscriptions().find((s) => s.id === card.subscriptionId);
    if (!sub) {
      throw new CardTransitionError(`Subscription '${card.subscriptionId}' not found.`, 404);
    }
    return { card, mutation: buildPostApprovalMutation(card, sub) };
  }
  if (card.status === "rejected") {
    throw new CardTransitionError(`Card ${cardId} is already rejected.`, 409);
  }

  const active = card.action === "NEGOTIATE" ? await prepareNegotiationCard(card) : card;

  const subscriptions = loadSubscriptions();
  const sub = subscriptions.find((s) => s.id === active.subscriptionId);
  if (!sub) {
    throw new CardTransitionError(`Subscription '${active.subscriptionId}' not found.`, 404);
  }

  const mutation = buildPostApprovalMutation(active, sub);
  for (const [key, value] of Object.entries(mutation.changes)) {
    (sub as unknown as Record<string, unknown>)[key] = value;
  }
  saveSubscriptions(subscriptions);

  const decidedAt = getDemoDate().toISOString();
  const updated: DecisionCard = {
    ...active,
    status: "approved",
    humanDecision: "approved",
    decidedAt,
  };
  const savedCards = replaceCard(loadCards(), updated);
  saveCards(savedCards);
  recordMemory(updated, decidedAt);

  broadcastCard(updated);
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