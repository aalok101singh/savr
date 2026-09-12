export type BillingModel = "seat_based" | "usage_based";
export type SubscriptionStatus = "active" | "cancelled" | "switched";
export type DecisionAction = "KEEP" | "DOWNGRADE" | "SWITCH" | "CANCEL" | "NEGOTIATE";
export type ApprovalRequirement = "autonomous" | "requires_approval";
export type NegotiationResolution = "accepted" | "stalled" | "rejected" | "max_rounds";

export interface Subscription {
  id: string;
  vendorName: string;
  category: string;
  billingModel: BillingModel;
  status: SubscriptionStatus;
  contractStart: string;
  contractEnd: string;
  renewalDate: string;
  billingCycle: "monthly" | "annual";
  annualCost: number;
  currentPeriodCost: number;
  renewalCost: number | null;
  seatsPurchased: number | null;
  seatsActive: number | null;
  pricePerSeat: number | null;
  priceIncreasePct: number | null;
  autoRenew: boolean;
  usageMetric: string | null;
  notes: string;
}

export interface Evidence {
  id: string;
  type: string;
  source: string;
  url: string | null;
  publisher: string;
  retrievedAt: string;
  freshUntil: string | null;
  observedValue: string;
  confidence: number;
  isInternal: boolean;
  summary: string;
  data: Record<string, unknown>;
}

export interface EstimatedSavings {
  amount: number;
  formula: string;
  isRealized: boolean;
}

export interface DecisionPackage {
  id: string;
  subscriptionId: string;
  triggers: string[];
  action: DecisionAction;
  approvalRequirement: ApprovalRequirement;
  reasoning: string;
  evidence: Evidence[];
  evidenceChecklist: {
    hasCurrentPriceSource: boolean;
    hasAlternativeSource: boolean;
    hasInternalSignal: boolean;
    isComplete: boolean;
  };
  estimatedSavings: EstimatedSavings;
  risk: string;
  confidence: number;
  createdAt: string;
}

export interface Offer {
  pricePerSeat: number;
  totalAnnual: number;
  seatsIncluded: number;
  terms: string;
  expiresAt: string;
}

export interface NegotiationState {
  subscriptionId: string;
  round: number;
  maxRounds: number;
  currentPrice: number;
  targetPrice: number;
  maxAcceptablePrice: number;
  buyerOfferPrice: number | null;
  proposedAcceptPrice: number | null;
  currentOffer: Offer | null;
  resolution: NegotiationResolution | null;
  messages: Array<{
    role: "agent" | "vendor";
    content: string;
    timestamp: string;
    round: number;
    buyerOfferPrice: number | null;
    currentOffer: Offer | null;
  }>;
}

export interface DecisionCard {
  id: string;
  decisionPackageId: string;
  subscriptionId: string;
  action: DecisionAction;
  summary: string;
  details: string;
  negotiation?: NegotiationState;
  estimatedSavings: number;
  realizedSavings: number;
  migrationNotes: string;
  alternatives: Array<{ vendorId: string; annualCost: number; summary: string }>;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  humanDecision: "approved" | "rejected" | null;
  decidedAt: string | null;
}

export interface Policy {
  maxAnnualBudget: number;
  maxSingleVendorSpend: number;
  renewalWindowDays: number;
  unusedSeatThresholdPct: number;
  blacklist: string[];
  cancellationWindowDays: number;
  categories: string[];
}

export interface SavingsState {
  totalSavings: number;
  approvedCount: number;
  lastAction: string | null;
}

export interface AgentStatusState {
  mode: "guardian" | "negotiator" | "idle" | "waiting_for_approval";
  pendingCardId: string | null;
  currentSubscriptionId: string | null;
}

export interface Company {
  name: string;
  employees: number;
  annualBudget: number;
}

export interface GuardianProgressEvent {
  subscriptionId: string;
  vendorName: string;
  status: "evaluating" | "done";
  action?: DecisionAction;
  confidence?: number;
}

export interface AutopilotCheckEvent {
  checkedAt: string;
  subscriptionsChecked: number;
  flaggedPackages: number;
  cardsPending: number;
  actionsTaken: number;
  action: "nothing_found" | "flagged";
  source: "autonomous";
}

export interface AutopilotStatus {
  enabled: boolean;
  intervalMs: number;
  lastCheck: {
    checkedAt: string;
    subscriptionsChecked: number;
    flaggedPackages: number;
    cardsPending: number;
    actionsTaken: number;
    action: "nothing_found" | "flagged";
  } | null;
}