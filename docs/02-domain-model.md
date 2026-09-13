---
id: domain-model
level: L1
depends_on: [architecture]
provides: domain-model
used_by: [L1, L2, L3, L4]
status: active
---

# 02 — Domain Model

## Units

**All monetary values are integer USD dollars.** Production would use integer cents or a decimal type. For this hackathon MVP, whole dollars are used throughout.

## Demo Clock

The system uses a **fixed demo date** when `DEMO_MODE=true`: `2026-09-10T12:00:00-07:00`. All relative date calculations (e.g. "+14 days") resolve against this fixed date, not the actual system clock. This ensures the demo works regardless of when the code runs.

When `DEMO_MODE=false`, the system uses the actual system clock.

The demo clock is provided by `src/utils/demo-clock.ts`:
```typescript
export function getDemoDate(): Date {
  if (process.env.DEMO_MODE === "true") {
    return new Date("2026-09-10T12:00:00-07:00");
  }
  return new Date();
}
```

## TypeScript Interfaces

```typescript
// ─── Company ─────────────────────────────────────────────
export interface Company {
  name: string;
  employees: number;
  annualBudget: number;
}

// ─── GuardianProgressEvent ───────────────────────────────
// Fired per candidate during a Guardian run. status "evaluating"
// immediately before the candidate's Strands Agent run; "done"
// immediately after, carrying the resolved action.
export interface GuardianProgressEvent {
  subscriptionId: string;
  vendorName: string;
  status: "evaluating" | "done";
  action?: DecisionAction;   // present only when status === "done"
}

// ─── BillingModel ───────────────────────────────────────
export type BillingModel = "seat_based" | "usage_based";

// ─── SubscriptionStatus ─────────────────────────────────
export type SubscriptionStatus = "active" | "cancelled" | "switched";

// ─── Subscription ────────────────────────────────────────
export interface Subscription {
  id: string;                        // Canonical vendor ID (e.g. "notion"). Used in API, policy, sandbox.
  vendorName: string;                // Display name (e.g. "Notion"). Used in UI.
  category: string;                  // Product category (e.g. "Productivity")
  billingModel: BillingModel;        // seat_based or usage_based
  status: SubscriptionStatus;        // active, cancelled, or switched
  contractStart: string;             // ISO 8601 date
  contractEnd: string;               // ISO 8601 date. For monthly: next renewal date.
  renewalDate: string;               // ISO 8601 date. When next payment/renewal is due.
  billingCycle: "monthly" | "annual";
  annualCost: number;                // USD. Committed annual cost. For monthly: annualized (monthly * 12).
  currentPeriodCost: number;         // USD. For annual: equals annualCost. For monthly: one month of spend.
  renewalCost: number | null;        // USD. Known renewal price. null if unknown. Updated after NEGOTIATE.
  seatsPurchased: number | null;     // Total seats. null if usage_based.
  seatsActive: number | null;        // Seats currently used. null if usage_based.
  pricePerSeat: number | null;       // USD per seat per year. null if usage_based. Computed: annualCost / seatsPurchased.
  priceIncreasePct: number | null;   // Percent increase at renewal. null if unknown or no increase.
  autoRenew: boolean;                // Auto-renewal flag
  usageMetric: string | null;        // e.g. "build minutes", "GB transferred". null if seat_based.
  notes: string;                     // Free-text notes
}

// ─── TriggerType ────────────────────────────────────────
// What caused the Guardian to flag a subscription.
export type TriggerType =
  | "renewal_soon"        // Renewing within renewalWindowDays
  | "unused_seats"        // seatsActive < seatsPurchased * 0.5
  | "category_overlap"    // Another active subscription in the same category
  | "price_increase"      // priceIncreasePct > 0
  | "budget_anomaly";     // Annual cost exceeds per-vendor budget threshold

// ─── DecisionAction ──────────────────────────────────────
export type DecisionAction =
  | "KEEP"
  | "DOWNGRADE"
  | "SWITCH"
  | "CANCEL"
  | "NEGOTIATE";

// ─── ApprovalRequirement ────────────────────────────────
// Whether an action requires human approval.
export type ApprovalRequirement =
  | "autonomous"          // Agent executes without human approval
  | "requires_approval";  // Agent must emit DecisionCard and wait

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
  id: string;                        // Unique evidence ID
  type: string;                      // e.g. "price_benchmark", "unused_seats", "alternative_found"
  source: string;                    // Source name (e.g. "G2", "vendor_site", "internal_data")
  url: string | null;                // Source URL if external, null if internal
  publisher: string;                 // Who published this
  retrievedAt: string;               // ISO 8601. When this evidence was gathered.
  freshUntil: string | null;         // ISO 8601. Stale after this. Cached pricing: retrievedAt + 7 days.
  observedValue: string;             // What was observed (e.g. "$84/seat/mo", "60% unused")
  confidence: number;                // 0–1
  isInternal: boolean;               // true = company data, false = external research
  summary: string;                   // Human-readable
  data: Record<string, unknown>;     // Structured payload
}

// ─── EvidenceChecklist ───────────────────────────────────
export interface EvidenceChecklist {
  hasCurrentPriceSource: boolean;    // Required for NEGOTIATE, SWITCH
  hasAlternativeSource: boolean;     // Required for SWITCH
  hasInternalSignal: boolean;        // Required for all material actions
  isComplete: boolean;               // All required evidence for the proposed action
}

// Evidence completeness rules:
// KEEP:       hasInternalSignal = true
// DOWNGRADE:  hasInternalSignal = true (utilization data)
// CANCEL:     hasInternalSignal = true (utilization or overlap data)
// SWITCH:     hasCurrentPriceSource = true AND hasAlternativeSource = true AND hasInternalSignal = true
// NEGOTIATE:  hasCurrentPriceSource = true AND hasInternalSignal = true

// ─── EstimatedSavings ────────────────────────────────────
// Computed by application code, not the LLM. Formula depends on action.
export interface EstimatedSavings {
  // KEEP:       0
  // DOWNGRADE:  annualCost - (seatsActive * pricePerSeat)
  // SWITCH:     annualCost of the vendor being switched away from (full cost).
  //             The alternative vendor's cost is NOT subtracted: in the
  //             canonical Loom→Veed consolidation Veed is already paid for, so
  //             consolidating away from Loom saves Loom's full $3,600.
  // CANCEL:     annualCost (full savings)
  // NEGOTIATE:  0 at Guardian time (unknown until negotiation completes); once
  //             the negotiation completes, the DecisionCard's estimatedSavings
  //             equals realizedSavings.
  amount: number;                    // USD. Gross savings before migration cost.
  formula: string;                   // Human-readable formula used
  isRealized: boolean;               // false = estimated (Guardian), true = finalized (post-negotiation)
}

// ─── DecisionPackage ─────────────────────────────────────
// Emitted by the Guardian. One per flagged subscription.
export interface DecisionPackage {
  id: string;                        // Unique ID (also referenced by DecisionCard.decisionPackageId)
  subscriptionId: string;            // Subscription.id
  triggers: TriggerType[];           // What triggered this recommendation
  action: DecisionAction;            // Recommended action
  approvalRequirement: ApprovalRequirement; // Whether human approval is needed
  reasoning: string;                 // LLM-generated reasoning
  evidence: Evidence[];              // Supporting evidence
  evidenceChecklist: EvidenceChecklist;
  estimatedSavings: EstimatedSavings;
  risk: string;                      // What could go wrong
  confidence: number;                // 0–1
  createdAt: string;                 // ISO 8601
}

// ─── Offer ───────────────────────────────────────────────
export interface Offer {
  pricePerSeat: number;              // USD per seat per year
  totalAnnual: number;               // USD total annual cost
  seatsIncluded: number;             // Seats in this offer
  terms: string;                     // Free-text terms
  expiresAt: string;                 // ISO 8601
}

// ─── NegotiationState ────────────────────────────────────
// Price semantics:
//   currentPrice        — what company pays now (public, vendor knows)
//   targetPrice         — agent's target (private, LLM sets)
//   maxAcceptablePrice  — policy-derived ceiling (private, code-enforced)
//   buyerOfferPrice     — what agent proposes to vendor this round (private)
//   proposedAcceptPrice — max agent will accept from vendor (private)
export interface NegotiationState {
  subscriptionId: string;
  round: number;                     // 1-indexed
  maxRounds: number;                 // Hard cap (5). Canonical demo: 3.
  currentPrice: number;              // What company pays now (USD)
  targetPrice: number;               // Agent's target (USD)
  maxAcceptablePrice: number;        // Policy-derived ceiling (USD)
  buyerOfferPrice: number | null;    // What agent proposed to vendor this round (USD)
  proposedAcceptPrice: number | null; // Max agent will accept from vendor (USD)
  currentOffer: Offer | null;        // Latest vendor offer
  resolution: NegotiationResolution | null; // null while active
  messages: Array<{
    role: "agent" | "vendor";
    content: string;
    timestamp: string;
    round: number;                  // 1-indexed round this message belongs to
    buyerOfferPrice: number | null; // this round's buyer offer (agent messages; echoed on vendor responses)
    currentOffer: Offer | null;     // this round's vendor counter (vendor messages; null on agent messages)
  }>;
}

// ─── Policy ──────────────────────────────────────────────
// Policy evaluation is deterministic. The LLM cannot override it.
export interface Policy {
  maxAnnualBudget: number;           // Total SaaS budget cap (USD)
  maxSingleVendorSpend: number;      // Per-vendor cap (USD). Actions on vendors above this require approval.
  renewalWindowDays: number;         // Flag renewals within N days
  unusedSeatThresholdPct: number;    // Flag subscriptions where seatsActive/seatsPurchased < this (e.g. 0.5)
  blacklist: string[];               // Vendor IDs to never negotiate with. Uses Subscription.id.
  cancellationWindowDays: number;    // Warn if cancellation deadline is within N days
  categories: string[];              // Categories to monitor. Empty = all categories.
}

// Approval rules (deterministic, code-enforced):
// NEGOTIATE → ALWAYS requires human approval
// SWITCH    → ALWAYS requires human approval
// DOWNGRADE → autonomous (reduces seats to seatsActive)
// CANCEL    → autonomous (only if renewalDate > today + cancellationWindowDays)
// KEEP      → autonomous (no action)
//
// Additional approval triggers:
// Any action where annualCost > maxSingleVendorSpend → requires approval
// Any action on a blacklisted vendor → blocked (never emitted)

// ─── DecisionCard ────────────────────────────────────────
// Surfaces to the human for approval. The human gate.
export interface DecisionCard {
  id: string;                        // Unique card ID. Idempotency key for approve/reject.
  decisionPackageId: string;         // Links to DecisionPackage.id
  subscriptionId: string;
  action: DecisionAction;
  summary: string;                   // One-line for the human
  details: string;                   // Full explanation
  negotiation?: NegotiationState;    // If NEGOTIATE, the negotiation state
  estimatedSavings: number;          // USD. For NEGOTIATE: realized savings (post-negotiation).
  realizedSavings: number;           // USD. 0 until negotiation completes or other action is finalized.
  migrationNotes: string;            // Qualitative migration impact
  alternatives: Array<{
    vendorId: string;
    annualCost: number;
    summary: string;
  }>;
  createdAt: string;                 // ISO 8601
  status: "pending" | "approved" | "rejected";
  humanDecision: HumanDecision | null;
  decidedAt: string | null;          // ISO 8601
}

// ─── PostApprovalMutation ────────────────────────────────
// What happens after the human approves a DecisionCard.
export interface PostApprovalMutation {
  action: DecisionAction;
  subscriptionId: string;
  // NEGOTIATE: renewalCost = negotiated totalAnnual from final offer
  // DOWNGRADE: seatsActive = seatsActive (reduce to current usage), annualCost recomputed
  // SWITCH:    status = "switched" on old subscription, new subscription created
  // CANCEL:    status = "cancelled", renewalCost = 0
  // KEEP:      no mutation
  changes: Record<string, unknown>;  // Key-value pairs of fields to update
  newSubscription?: Subscription;    // Only for SWITCH
}

// ─── ProcurementMemory ───────────────────────────────────
// DynamoDB persistence model.
// Table: savr-procurement-memory
// Partition key: companyId (string)
// Sort key: entityType#entityId (string)
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
// In-memory state for the current evaluation loop.
// Strands mapping:
//   appState       → policy, config, company info (persists across invocations)
//   invocationState → currentSubscription, evidence, toolCallCount, mode (per-evaluation)
//   DynamoDB       → ProcurementMemory (cross-session persistence)
export interface AgentState {
  currentSubscription: Subscription | null;
  policy: Policy;
  negotiationState: NegotiationState | null;
  totalSpend: number;
  evidence: Evidence[];
  evidenceChecklist: EvidenceChecklist;
  toolCallCount: number;             // Max 12 per evaluation
  memory: ProcurementMemory;         // Loaded subset at session start
  pendingCardId: string | null;
  mode: "guardian" | "negotiator";
}

// ─── GuardianRunOutput ───────────────────────────────────
// The Guardian evaluates all candidate subscriptions in one run.
// Returns an array of DecisionPackages (one per flagged subscription).
export type GuardianRunOutput = DecisionPackage[];

// ─── GuardianOutput (LLM structured output) ──────────────
// What the LLM produces. Application code transforms this into DecisionPackage.
export interface GuardianOutput {
  subscriptionId: string;
  triggers: TriggerType[];
  action: DecisionAction;
  reasoning: string;
  confidence: number;
  evidenceIds: string[];
}

// ─── NegotiationOutput (LLM structured output) ───────────
// What the LLM produces during negotiation.
export interface NegotiationOutput {
  message: string;                   // Message to send to vendor
  buyerOfferPrice: number;           // Price agent proposes to vendor (must be <= maxAcceptablePrice)
  proposedAcceptPrice: number;       // Max agent will accept from vendor (must be <= maxAcceptablePrice)
  reasoning: string;
}

// ─── Tool Results (explicit success/error unions) ────────
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

// check_policy never fails — it always returns a PolicyResult.
export interface PolicyResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;                    // Explanation if blocked
}

// ─── DemoResetResponse ───────────────────────────────────
export interface DemoResetResponse {
  subscriptionsReset: number;
  negotiationsCleared: number;
  cardsCleared: number;
  savingsReset: number;
}
```

## Invariants

- `seatsActive <= seatsPurchased` — only when `billingModel === "seat_based"`. Skipped for usage_based.
- `annualCost === pricePerSeat * seatsPurchased` — only when `billingModel === "seat_based"`.
- `annualCost === currentPeriodCost` — when `billingCycle === "annual"`.
- `annualCost === currentPeriodCost * 12` — when `billingCycle === "monthly"`.
- `NegotiationState.round <= NegotiationState.maxRounds`.
- `DecisionCard.status`: transitions `pending → approved | rejected`. No transition from terminal state.
- `DecisionPackage.id` must exist and be referenced by `DecisionCard.decisionPackageId`.
- `buyerOfferPrice <= maxAcceptablePrice` — enforced by hook before sending to sandbox.
- `proposedAcceptPrice <= maxAcceptablePrice` — enforced by hook.
- `NEGOTIATE` and `SWITCH` always have `approvalRequirement: "requires_approval"`.
- `KEEP`, `DOWNGRADE`, `CANCEL` have `approvalRequirement: "autonomous"` (subject to policy checks).
- Evidence with `freshUntil` in the past is stale. Stale evidence may be shown as secondary but not cited as primary.
- `Subscription.id` is the canonical identifier used in policy, sandbox, and memory. `vendorName` is display-only.

## Post-Approval Mutations

When the human approves a DecisionCard, the following state changes occur:

| Action | Mutation |
|--------|----------|
| NEGOTIATE | `subscription.renewalCost = negotiationState.currentOffer.totalAnnual` |
| DOWNGRADE | `subscription.seatsActive = subscription.seatsActive` (reduce to current usage), `subscription.annualCost = subscription.seatsActive * subscription.pricePerSeat` |
| SWITCH | `subscription.status = "switched"`, create new Subscription for the alternative vendor |
| CANCEL | `subscription.status = "cancelled"`, `subscription.renewalCost = 0` |
| KEEP | No mutation |

For SWITCH, the new subscription is created with `status: "active"` and copied from the alternative's details. The old subscription's `status` becomes `"switched"`.

For DOWNGRADE, `annualCost` is recomputed because fewer seats means lower cost. The `seatsPurchased` field is NOT changed (the company still owns the seats; they just stop paying for unused ones at renewal).

For NEGOTIATE, only `renewalCost` is updated. The actual price change takes effect at `renewalDate`.
