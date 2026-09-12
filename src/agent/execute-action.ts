import type { DecisionAction, PostApprovalMutation, Subscription } from "../types/index.js";

export function executeAction(subscription: Subscription, action: DecisionAction): PostApprovalMutation {
  let changes: Record<string, unknown> = {};
  let newSubscription: Subscription | undefined;

  switch (action) {
    case "DOWNGRADE": {
      newSubscription = {
        ...subscription,
        seatsPurchased: subscription.seatsActive,
        annualCost: (subscription.pricePerSeat ?? 0) * (subscription.seatsActive ?? 0),
        status: "active",
        notes: `${subscription.notes} [DOWNGRADED ${new Date().toISOString()}]`.trim(),
      };
      changes = {
        seatsPurchased: newSubscription.seatsPurchased,
        annualCost: newSubscription.annualCost,
      };
      break;
    }
    case "CANCEL": {
      newSubscription = {
        ...subscription,
        autoRenew: false,
        status: "cancelled",
        notes: `${subscription.notes} [CANCELLED ${new Date().toISOString()}]`.trim(),
      };
      changes = { autoRenew: false, status: "cancelled" };
      break;
    }
    case "SWITCH": {
      newSubscription = {
        ...subscription,
        status: "switched",
        notes: `${subscription.notes} [SWITCHED ${new Date().toISOString()}]`.trim(),
      };
      changes = { status: "switched" };
      break;
    }
    case "KEEP": {
      newSubscription = {
        ...subscription,
        status: "active",
        notes: `${subscription.notes} [KEEP]`.trim(),
      };
      changes = {};
      break;
    }
    case "NEGOTIATE": {
      newSubscription = undefined;
      changes = { pendingNegotiation: new Date().toISOString() };
      break;
    }
  }

  return {
    action,
    subscriptionId: subscription.id,
    changes,
    newSubscription,
  };
}