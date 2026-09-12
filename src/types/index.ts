// ─── BillingModel ───────────────────────────────────────
export type BillingModel = "seat_based" | "usage_based";

// ─── Company ────────────────────────────────────────────
export interface Company {
  name: string;
  employees: number;
  annualBudget: number;
}

// ─── GuardianProgressEvent ──────────────────────────────
// Fired per candidate during a Guardian run. status "evaluating"
// immediately before the candidate's Strands Agent run; "done"
// immediately after, carrying the resolved action.
export interface GuardianProgressEvent {
  subscriptionId: string;
  vendorName: string;
  status: "evaluating" | "done";
  action?: DecisionAction;
  confidence?: number;
}

// ─── SubscriptionStatus ─────────────────────────────────
export type SubscriptionStatus = "active" | "cancelled" | "switched";

// ─── Subscription ────────────────────────────────────────
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

// ─── TriggerType ────────────────────────────────────────
export type TriggerType =
  | "renewal_soon"
  | "unused_seats"
  | "category_overlap"
  | "price_increase"
  | "budget_anomaly";

// ─── DecisionAction ──────────────────────────────────────
export type DecisionAction =
  | "KEEP"
  | "DOWNGRADE"
  | "SWITCH"
  | "CANCEL"
  | "NEGOTIATE";

// ─── ApprovalRequirement ────────────────────────────────
export type ApprovalRequirement =
  | "autonomous"
  | "requires_approval";

// ─── NegotiationResolution ───────────────────────────────
export type NegotiationResolution =
  | "accepted"
  | "stalled"
  | "rejected"
  | "max_rounds";

// ─── HumanDecision ───────────────────────────────────────
export type HumanDecision = "approved" | "rejected";

// ─── Evidence ────────────────────────────────────────────
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

// ─── EvidenceChecklist ───────────────────────────────────
export interface EvidenceChecklist {
  hasCurrentPriceSource: boolean;
  hasAlternativeSource: boolean;
  hasInternalSignal: boolean;
  isComplete: boolean;
}

// ─── EstimatedSavings ────────────────────────────────────
export interface EstimatedSavings {
  amount: number;
  formula: string;
  isRealized: boolean;
}

// ─── DecisionPackage ─────────────────────────────────────
export interface DecisionPackage {
  id: string;
  subscriptionId: string;
  triggers: TriggerType[];
  action: DecisionAction;
  approvalRequirement: ApprovalRequirement;
  reasoning: string;
  evidence: Evidence[];
  evidenceChecklist: EvidenceChecklist;
  estimatedSavings: EstimatedSavings;
  risk: string;
  confidence: number;
  createdAt: string;
}

// ─── Offer ───────────────────────────────────────────────
export interface Offer {
  pricePerSeat: number;
  totalAnnual: number;
  seatsIncluded: number;
  terms: string;
  expiresAt: string;
}

// ─── NegotiationState ────────────────────────────────────
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

// ─── Policy ──────────────────────────────────────────────
export interface Policy {
  maxAnnualBudget: number;
  maxSingleVendorSpend: number;
  renewalWindowDays: number;
  unusedSeatThresholdPct: number;
  blacklist: string[];
  cancellationWindowDays: number;
  categories: string[];
}

// ─── DecisionCard ────────────────────────────────────────
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
  alternatives: Array<{
    vendorId: string;
    annualCost: number;
    summary: string;
  }>;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  humanDecision: HumanDecision | null;
  decidedAt: string | null;
}

// ─── PostApprovalMutation ────────────────────────────────
export interface PostApprovalMutation {
  action: DecisionAction;
  subscriptionId: string;
  changes: Record<string, unknown>;
  newSubscription?: Subscription;
}

// ─── ProcurementMemory ───────────────────────────────────
export interface ProcurementMemory {
  companyId: string;
  decisions: Array<{
    id: string;
    decisionPackageId: string;
    subscriptionId: string;
    action: DecisionAction;
    estimatedSavings: number;
    realizedSavings: number;
    decidedAt: string;
    humanDecision: HumanDecision | null;
  }>;
  negotiations: Array<{
    id: string;
    subscriptionId: string;
    resolution: NegotiationResolution;
    finalOffer: Offer | null;
    roundsCompleted: number;
    completedAt: string;
  }>;
  vendorHistory: Record<string, {
    lastContacted: string | null;
    lastOutcome: NegotiationResolution | null;
    notes: string;
  }>;
  policies: Array<{
    id: string;
    policy: Policy;
    activatedAt: string;
  }>;
}

// ─── AgentState ──────────────────────────────────────────
export interface AgentState {
  currentSubscription: Subscription | null;
  policy: Policy;
  negotiationState: NegotiationState | null;
  totalSpend: number;
  evidence: Evidence[];
  evidenceChecklist: EvidenceChecklist;
  toolCallCount: number;
  memory: ProcurementMemory;
  pendingCardId: string | null;
  mode: "guardian" | "negotiator";
}

// ─── GuardianRunOutput ───────────────────────────────────
export type GuardianRunOutput = DecisionPackage[];

// ─── GuardianOutput (LLM structured output) ──────────────
export interface GuardianOutput {
  subscriptionId: string;
  triggers: TriggerType[];
  action: DecisionAction;
  reasoning: string;
  confidence: number;
  evidenceIds: string[];
}

// ─── NegotiationOutput (LLM structured output) ───────────
export interface NegotiationOutput {
  message: string;
  buyerOfferPrice: number;
  proposedAcceptPrice: number;
  reasoning: string;
}

// ─── Tool Results ────────────────────────────────────────
export type CheckRenewalsResult = Subscription[];

export type BenchmarkPricingResult =
  | { status: "success"; evidence: Evidence }
  | { status: "evidence_unavailable"; reason: string };

export type SearchAlternativesResult =
  | { status: "success"; evidence: Evidence[] }
  | { status: "evidence_unavailable"; reason: string };

export type SendMessageResult =
  | { status: "success"; response: string; offer: Offer | null }
  | { status: "error"; error: "sandbox_unreachable" | "timeout" | "vendor_rejected" };

export type ParseVendorResponseResult =
  | { status: "success"; offer: Offer }
  | { status: "parse_failure"; reason: string };

export interface PolicyResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

// ─── DemoResetResponse ───────────────────────────────────
export interface DemoResetResponse {
  subscriptionsReset: number;
  negotiationsCleared: number;
  cardsCleared: number;
  savingsReset: number;
}

// ─── AutopilotCheckEvent ─────────────────────────────────
/** Emitted by the autonomous scheduler after it reruns Guardian on its own. */
export interface AutopilotCheckEvent {
  checkedAt: string;
  subscriptionsChecked: number;
  flaggedPackages: number;
  cardsPending: number;
  actionsTaken: number;
  action: "nothing_found" | "flagged";
  source: "autonomous";
}
