import type { DecisionAction } from "../types";

export type DirectorPhase = "idle" | "guardian" | "negotiating" | "approval" | "resolved" | "error";

export interface SpotlightItem {
  subscriptionId: string;
  action: DecisionAction;
  requiresApproval: boolean;
  estimatedSavings: number;
  confidence: number;
  evidenceCount: number;
}

export interface TranscriptItem {
  id: number;
  round: number;
  role: "agent" | "vendor";
  content: string;
  buyerOfferPrice: number | null;
  vendorOffer: number | null;
}

export interface RoundSummary {
  round: number;
  agentOffer: number | null;
  vendorOffer: number | null;
}

export interface RecapItem {
  cardId: string;
  subscriptionId: string;
  action: DecisionAction;
  estimatedSavings: number;
  realizedSavings: number;
  summary: string;
}

export type ActivityKind =
  | "guardian"
  | "message"
  | "card"
  | "approval"
  | "savings"
  | "status"
  | "error";

export interface ActivityItem {
  id: number;
  timestamp: string;
  kind: ActivityKind;
  text: string;
}

export interface NegotiationMeta {
  targetPrice: number | null;
  maxAcceptablePrice: number | null;
  proposedAcceptPrice: number | null;
}

export interface DirectorState {
  phase: DirectorPhase;
  mode: string;
  savings: number;
  approvedCount: number;
  pendingIds: string[];
  spotlight: SpotlightItem[];
  transcript: TranscriptItem[];
  rounds: RoundSummary[];
  recap: RecapItem[];
  activity: ActivityItem[];
  error: string | null;
  resolution: string | null;
  meta: NegotiationMeta;
  frameCount: number;
}

export interface DirectorFrame {
  event: string;
  data: unknown;
}