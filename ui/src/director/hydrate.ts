import type {
  AgentStatusState,
  DecisionCard,
  DecisionPackage,
  NegotiationState,
  SavingsState,
} from "../types";
import type { DirectorFrame } from "./types";

export interface DirectorSnapshot {
  packages: DecisionPackage[];
  negotiation: NegotiationState | null;
  cards: DecisionCard[];
  savings: SavingsState;
  status: AgentStatusState;
}

export function hydrateFrames(snapshot: DirectorSnapshot): DirectorFrame[] {
  const frames: DirectorFrame[] = [];

  for (const pkg of snapshot.packages) {
    frames.push({
      event: "guardian_update",
      data: {
        subscriptionId: pkg.subscriptionId,
        action: pkg.action,
        estimatedSavings: pkg.estimatedSavings.amount,
        confidence: pkg.confidence,
        evidenceCount: pkg.evidence.length,
        requiresApproval: pkg.approvalRequirement === "requires_approval",
      },
    });
  }

  const negotiation = snapshot.negotiation;
  if (negotiation) {
    negotiation.messages.forEach((m, i) => {
      frames.push({
        event: "negotiation_message",
        data: {
          subscriptionId: negotiation.subscriptionId,
          round: typeof m.round === "number" ? m.round : i + 1,
          role: m.role,
          content: m.content,
          currentOffer: m.currentOffer,
          targetPrice: negotiation.targetPrice,
          maxAcceptablePrice: negotiation.maxAcceptablePrice,
          buyerOfferPrice: m.buyerOfferPrice ?? null,
          proposedAcceptPrice: negotiation.proposedAcceptPrice,
        },
      });
    });
  }

  for (const card of snapshot.cards) {
    frames.push({
      event: "decision_card",
      data: {
        cardId: card.id,
        subscriptionId: card.subscriptionId,
        action: card.action,
        status: card.status,
        estimatedSavings: card.estimatedSavings,
        realizedSavings: card.realizedSavings,
        summary: card.summary,
      },
    });
  }

  frames.push({
    event: "savings_update",
    data: {
      totalSavings: snapshot.savings.totalSavings,
      approvedCount: snapshot.savings.approvedCount,
      lastAction: snapshot.savings.lastAction,
    },
  });

  frames.push({
    event: "agent_status",
    data: {
      mode: snapshot.status.mode,
      pendingCardId: snapshot.status.pendingCardId,
      currentSubscriptionId: snapshot.status.currentSubscriptionId,
    },
  });

  return frames;
}