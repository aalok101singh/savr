import type { DecisionAction } from "../types";
import type {
  ActivityKind,
  DirectorFrame,
  DirectorState,
  RoundSummary,
  SpotlightItem,
  TranscriptItem,
} from "./types";

export const INITIAL_DIRECTOR_STATE: DirectorState = {
  phase: "idle",
  mode: "idle",
  savings: 0,
  approvedCount: 0,
  pendingIds: [],
  spotlight: [],
  transcript: [],
  rounds: [],
  recap: [],
  activity: [],
  error: null,
  resolution: null,
  meta: { targetPrice: null, maxAcceptablePrice: null, proposedAcceptPrice: null },
  frameCount: 0,
};

const MAX_ACTIVITY = 200;
const MAX_TRANSCRIPT = 100;

function pushActivity(
  prev: DirectorState,
  kind: ActivityKind,
  text: string
): DirectorState["activity"] {
  const list = [
    ...prev.activity,
    { id: prev.frameCount, timestamp: new Date().toISOString(), kind, text },
  ];
  if (list.length > MAX_ACTIVITY) {
    list.splice(0, list.length - MAX_ACTIVITY);
  }
  return list;
}

function upsertSpotlight(
  list: SpotlightItem[],
  item: SpotlightItem
): SpotlightItem[] {
  const existing = list.findIndex((s) => s.subscriptionId === item.subscriptionId);
  if (existing >= 0) {
    const next = list.slice();
    next[existing] = item;
    return next;
  }
  return [...list, item];
}

function upsertRound(list: RoundSummary[], item: RoundSummary): RoundSummary[] {
  const existing = list.find((r) => r.round === item.round);
  if (existing) {
    return list.map((r) => (r.round === item.round ? item : r));
  }
  return [...list, item];
}

function pushTranscript(
  prev: DirectorState,
  item: TranscriptItem
): DirectorState["transcript"] {
  const list = [...prev.transcript, item];
  if (list.length > MAX_TRANSCRIPT) {
    list.splice(0, list.length - MAX_TRANSCRIPT);
  }
  return list;
}

export function reduceAll(state: DirectorState, frames: DirectorFrame[]): DirectorState {
  return frames.reduce(directorReducer, state);
}

export function directorReducer(prev: DirectorState, frame: DirectorFrame): DirectorState {
  const f = prev.frameCount + 1;
  let next: DirectorState = { ...prev, frameCount: f };

  switch (frame.event) {
    case "guardian_update": {
      const d = (frame.data ?? {}) as Record<string, unknown>;
      const subscriptionId = String(d.subscriptionId ?? "unknown");
      const action = String(d.action ?? "KEEP") as DecisionAction;
      next = {
        ...next,
        spotlight: upsertSpotlight(prev.spotlight, {
          subscriptionId,
          action,
          requiresApproval: Boolean(d.requiresApproval),
          estimatedSavings: typeof d.estimatedSavings === "number" ? d.estimatedSavings : 0,
          confidence: typeof d.confidence === "number" ? d.confidence : 0,
          evidenceCount: typeof d.evidenceCount === "number" ? d.evidenceCount : 0,
        }),
        activity: pushActivity(prev, "guardian", `Guardian flagged ${subscriptionId} — ${action}`),
      };
      break;
    }

    case "negotiation_message": {
      const d = (frame.data ?? {}) as Record<string, unknown>;
      const round = typeof d.round === "number" ? d.round : 1;
      const role = d.role === "agent" ? "agent" : "vendor";
      const buyerOfferPrice = typeof d.buyerOfferPrice === "number" ? d.buyerOfferPrice : null;
      const offerRaw = (d.currentOffer ?? null) as Record<string, unknown> | null;
      const vendorOffer = typeof offerRaw?.totalAnnual === "number" ? offerRaw.totalAnnual : null;
      const proposedAcceptPrice =
        typeof d.proposedAcceptPrice === "number" ? d.proposedAcceptPrice : null;

      const item: TranscriptItem = {
        id: f,
        round,
        role,
        content: String(d.content ?? ""),
        buyerOfferPrice,
        vendorOffer,
      };

      let rounds = prev.rounds;
      let resolution = prev.resolution;
      if (role === "vendor" && vendorOffer !== null) {
        rounds = upsertRound(prev.rounds, { round, agentOffer: buyerOfferPrice, vendorOffer });
        resolution = proposedAcceptPrice !== null && vendorOffer <= proposedAcceptPrice ? "accepted" : resolution ?? "in_progress";
      }

      const meta = {
        targetPrice: typeof d.targetPrice === "number" ? d.targetPrice : prev.meta.targetPrice,
        maxAcceptablePrice:
          typeof d.maxAcceptablePrice === "number" ? d.maxAcceptablePrice : prev.meta.maxAcceptablePrice,
        proposedAcceptPrice:
          typeof d.proposedAcceptPrice === "number" ? d.proposedAcceptPrice : prev.meta.proposedAcceptPrice,
      };

      const text =
        role === "agent"
          ? `Round ${round} — Agent proposes ${buyerOfferPrice === null ? "a price" : `$${buyerOfferPrice.toLocaleString()}`}/yr`
          : `Round ${round} — Vendor counters ${vendorOffer === null ? "a price" : `$${vendorOffer.toLocaleString()}`}/yr`;

      next = {
        ...next,
        transcript: pushTranscript(prev, item),
        rounds,
        resolution,
        meta,
        activity: pushActivity(prev, "message", text),
      };
      break;
    }

    case "decision_card": {
      const d = (frame.data ?? {}) as Record<string, unknown>;
      const cardId = String(d.cardId ?? "");
      const status = String(d.status ?? "pending");
      const subscriptionId = String(d.subscriptionId ?? "unknown");
      const action = String(d.action ?? "KEEP") as DecisionAction;
      const pending = status === "pending";
      const pendingIds = pending
        ? prev.pendingIds.includes(cardId)
          ? prev.pendingIds
          : [...prev.pendingIds, cardId]
        : prev.pendingIds.filter((id) => id !== cardId);

      const recap =
        !pending && status === "approved" && !prev.recap.some((r) => r.cardId === cardId)
          ? [
              ...prev.recap,
              {
                cardId,
                subscriptionId,
                action,
                estimatedSavings: typeof d.estimatedSavings === "number" ? d.estimatedSavings : 0,
                realizedSavings: typeof d.realizedSavings === "number" ? d.realizedSavings : 0,
                summary: String(d.summary ?? ""),
              },
            ]
          : prev.recap;

      const text = pending
        ? `Decision required: ${subscriptionId} ${action}`
        : status === "approved"
          ? `Approved ${subscriptionId} ${action}`
          : `Rejected ${subscriptionId} ${action}`;

      next = {
        ...next,
        pendingIds,
        recap,
        activity: pushActivity(prev, pending ? "card" : "approval", text),
      };
      break;
    }

    case "savings_update": {
      const d = (frame.data ?? {}) as Record<string, unknown>;
      const savings = typeof d.totalSavings === "number" ? d.totalSavings : prev.savings;
      const approvedCount =
        typeof d.approvedCount === "number" ? d.approvedCount : prev.approvedCount;
      const activity =
        savings !== prev.savings
          ? pushActivity(prev, "savings", `Savings ${savings === 0 ? "reset to $0" : `now $${savings.toLocaleString()} /yr`}`)
          : prev.activity;
      next = { ...next, savings, approvedCount, activity };
      break;
    }

    case "agent_status": {
      const d = (frame.data ?? {}) as Record<string, unknown>;
      const mode = String(d.mode ?? prev.mode);
      const activity =
        mode !== prev.mode
          ? pushActivity(prev, "status", `Agent: ${mode.replace(/_/g, " ")}`)
          : prev.activity;
      next = { ...next, mode, activity };
      break;
    }

    case "error": {
      const d = (frame.data ?? {}) as Record<string, unknown>;
      next = {
        ...next,
        error: typeof d.message === "string" ? d.message : "Unknown error",
        activity: pushActivity(prev, "error", `Error: ${typeof d.message === "string" ? d.message : "unknown"}`),
      };
      break;
    }

    default:
      break;
  }

  next.phase = derivePhase(next);
  return next;
}

function derivePhase(state: DirectorState): DirectorState["phase"] {
  if (state.error) return "error";
  if (state.savings > 0 && state.pendingIds.length === 0) return "resolved";
  // An approved NEGOTIATE transitions straight to the Negotiator: while the
  // negotiation produces rounds the phase shows "negotiating", even though
  // the resolution of those terms still happens under human authority.
  if (state.rounds.length > 0) return "negotiating";
  if (state.pendingIds.length > 0) return "approval";
  if (state.spotlight.length > 0) return "guardian";
  return "idle";
}