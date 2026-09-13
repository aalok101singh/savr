---
id: agent-spec
level: L2
depends_on: [architecture, domain-model]
provides: agent-spec
used_by: [L2, L3, L4]
status: active
---

# 03 — Agent Spec

## Orchestrator

Single Strands Agent. Guardian and Negotiator are modes.

### System Prompt

```
You are Savr, an autonomous procurement employee for companies without a procurement team.

Your job is to manage the company's SaaS subscriptions. You watch the stack, decide what
needs attention, act within the human's policy, negotiate when you can, and only surface
when a real decision is the human's to make.

You have two modes:
1. GUARDIAN — Review subscriptions, benchmark pricing, find alternatives, and propose
   actions with evidence. You recommend; you do not execute.
2. NEGOTIATOR — Engage a vendor in structured rounds. Code owns financial boundaries.
   You handle language and strategy.

Rules:
- Never exceed policy limits. Policy is authoritative.
- Always cite evidence. Do not invent data.
- If evidence is incomplete, recommend KEEP and explain what is missing.
- Maximum 12 tool calls per subscription evaluation.
- Maximum 5 negotiation rounds per vendor.
- For NEGOTIATE: always propose buyerOfferPrice and proposedAcceptPrice within bounds.
```

## Structured Output (LLM → Application Code)

The LLM outputs schema-validated structures. Application code transforms them into domain objects.

### Guardian Mode

**LLM produces:** `GuardianOutput` (validated via Zod)

```typescript
import { z } from "zod";

const GuardianOutputSchema = z.object({
  subscriptionId: z.string(),
  triggers: z.array(z.enum(["renewal_soon", "unused_seats", "category_overlap", "price_increase", "budget_anomaly"])),
  action: z.enum(["KEEP", "DOWNGRADE", "SWITCH", "CANCEL", "NEGOTIATE"]),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
});
```

**Application code transforms into:** `DecisionPackage`

The transformation:
1. Validate LLM output against `GuardianOutputSchema`.
2. Look up evidence by `evidenceIds`.
3. Compute `estimatedSavings` using the deterministic formula.
4. Check evidence checklist completeness.
5. Run `check_policy()`.
6. Construct `DecisionPackage` with generated `id`, computed fields, and `approvalRequirement`.

### Negotiation Mode

**LLM produces:** `NegotiationOutput` (validated via Zod)

```typescript
const NegotiationOutputSchema = z.object({
  message: z.string().min(1),
  buyerOfferPrice: z.number().positive(),
  proposedAcceptPrice: z.number().positive(),
  reasoning: z.string().min(1),
});
```

**Hook validates before sending:**
- `buyerOfferPrice <= maxAcceptablePrice`
- `proposedAcceptPrice <= maxAcceptablePrice`
- If violated: hook cancels the tool call, agent receives error, must adjust.

## Tools

### check_renewals

**Signature:** `(windowDays: number) → Subscription[]`

**Purpose:** Reads `data/subscriptions.json`. Returns all subscriptions where `renewalDate - getDemoDate() <= windowDays`.

**Failure:** Returns empty array. Logs error.

**Role:** The candidate set is built deterministically by `evaluateTriggers` from all 5 triggers. This tool is informational — it gives the LLM renewal-window context/evidence for the current candidate. It is NOT the source of candidate selection.

### benchmark_pricing

**Signature:** `(category: string, vendorId: string) → BenchmarkPricingResult`

**Purpose:** Gets market pricing for the category. In `DEMO_MODE`, loads from `data/cached-evidence.json`.

**Returns:**
- `{ status: "success", evidence: Evidence }` — pricing data found
- `{ status: "evidence_unavailable", reason: string }` — both live and cached failed

**Cached evidence freshness:** Evidence retrievedAt + 7 days = freshUntil. Stale evidence returned as secondary with a note.

### search_alternatives

**Signature:** `(category: string, currentVendorId: string) → SearchAlternativesResult`

**Purpose:** Finds competing products. Cached in DEMO_MODE.

**Returns:**
- `{ status: "success", evidence: Evidence[] }` — alternatives found (may be empty array)
- `{ status: "evidence_unavailable", reason: string }` — search failed

### send_negotiation_message

**Signature:** `(vendorId: string, message: string, buyerOfferPrice: number) → SendMessageResult`

**Purpose:** Sends message + structured price to vendor sandbox. `buyerOfferPrice` is the price the agent proposes to the vendor. The agent's `proposedAcceptPrice` and `targetPrice` are NOT sent.

**Returns:**
- `{ status: "success", response: string, offer: Offer | null }`
- `{ status: "error", error: "sandbox_unreachable" | "timeout" | "vendor_rejected" }`

**Failure handling:** On error, agent retries once. On second failure, negotiation enters `stalled`.

### parse_vendor_response

**Signature:** `(rawResponse: string) → ParseVendorResponseResult`

**Purpose:** Extracts Offer from vendor text. Returns structured failure if unparseable. **Never invents data.**

**Returns:**
- `{ status: "success", offer: Offer }` — all fields present and numeric
- `{ status: "parse_failure", reason: string }` — missing price, unparseable text, etc.

### check_policy

**Signature:** `(action: DecisionAction, subscriptionId: string, policy: Policy, estimatedSavings: number) → PolicyResult`

**Purpose:** Deterministic policy validation. **Never fails.**

**Rules (evaluated in order):**

1. Look up subscription by `subscriptionId`.
2. If `policy.categories` is non-empty and the subscription's category is not in it → `{ allowed: true, requiresApproval: false, reason: "Category not in monitored set." }` (not evaluated; no action).
3. If `subscription.id` is in `policy.blacklist` → `{ allowed: false, requiresApproval: false, reason: "Vendor is blacklisted." }`
4. If action is NEGOTIATE or SWITCH → `{ allowed: true, requiresApproval: true, reason: "Action requires human approval." }`
5. If action is CANCEL and `subscription.renewalDate - today < policy.cancellationWindowDays` → `{ allowed: false, requiresApproval: false, reason: "Within cancellation window." }`
6. If `subscription.annualCost > policy.maxSingleVendorSpend` → `{ allowed: true, requiresApproval: true, reason: "Exceeds per-vendor spend threshold." }`
7. All other cases → `{ allowed: true, requiresApproval: false, reason: "Autonomous action." }`

**When `allowed: false`:** Action is never emitted. Agent must choose different action or escalate.
**When `requiresApproval: true`:** Agent emits DecisionCard and pauses.

## Policy Guardrails — TypeScript Strands Hook

```typescript
import { BeforeToolCallEvent } from "@strands-agents/sdk";

export function policyGuardrail(event: BeforeToolCallEvent): void {
  const toolName = event.toolUse.name;
  const toolInput = event.toolUse.input;
  const policy = event.agent.state.get("policy") as Policy;
  const toolCallCount = (event.agent.invocationState.get("toolCallCount") as number) || 0;

  if (!policy) {
    event.cancel({ reason: "No active policy loaded." });
    return;
  }

  // Tool-call limit
  if (toolCallCount >= 12) {
    event.cancel({ reason: "Tool-call limit reached (12 per evaluation)." });
    return;
  }

  // Vendor blacklist
  if (toolName === "send_negotiation_message") {
    const vendorId = toolInput.vendorId as string;
    if (policy.blacklist.includes(vendorId)) {
      event.cancel({ reason: `Vendor '${vendorId}' is blacklisted.` });
      return;
    }
  }

  // Budget check
  if (toolName === "send_negotiation_message") {
    const totalSpend = (event.agent.state.get("totalSpend") as number) || 0;
    if (totalSpend >= policy.maxAnnualBudget) {
      event.cancel({ reason: "Annual budget cap reached." });
      return;
    }
  }

  // Price bounds check for negotiation
  if (toolName === "send_negotiation_message") {
    const buyerOfferPrice = toolInput.buyerOfferPrice as number;
    const maxAcceptable = (event.agent.state.get("maxAcceptablePrice") as number) || Infinity;
    if (buyerOfferPrice > maxAcceptable) {
      event.cancel({ reason: `buyerOfferPrice ${buyerOfferPrice} exceeds maxAcceptablePrice ${maxAcceptable}.` });
      return;
    }
  }

  // Increment counter
  event.agent.invocationState.set("toolCallCount", toolCallCount + 1);
}
```

## Guardian Loop

```
function guardian():
  // DETERMINISTIC: Load data
  policy = loadPolicy("data/policy.json")
  allSubscriptions = loadSubscriptions("data/subscriptions.json")
  memory = loadMemory()  // Subset: vendor history + recent decisions + active policy

  // DETERMINISTIC: Build candidate set from ALL triggers
  candidates = []
  for sub in allSubscriptions:
    triggers = evaluateTriggers(sub, policy, getDemoDate())
    if triggers.length > 0:
      candidates.push({ subscription: sub, triggers })

  // AGENTIC: For each candidate, LLM decides what to research and recommend
  packages = []
  for candidate in candidates:
    agentState.currentSubscription = candidate.subscription
    agentState.toolCallCount = 0
    agentState.evidence = []

    // LLM runs, calls tools, produces GuardianOutput
    llmOutput = agent.run(candidate, memory, policy)

    // DETERMINISTIC: Validate, compute savings, check policy
    validatedOutput = validateGuardianOutput(llmOutput)
    savings = computeEstimatedSavings(validatedOutput.action, candidate.subscription)
    policyResult = check_policy(validatedOutput.action, candidate.subscription.id, policy, savings.amount)

    if !policyResult.allowed:
      // Agent must try different action or escalate
      agent.retryWithConstraint(policyResult.reason)
      continue

    // DETERMINISTIC: Construct DecisionPackage
    pkg = constructDecisionPackage(validatedOutput, candidate, savings, policyResult)
    packages.push(pkg)

    // DETERMINISTIC: Handle approval requirement
    // No blocking pause here: one run must finish synchronously (demo/run
    // returns all packages). Cards are emitted and the agent enters
    // waiting_for_approval after the loop.
    if policyResult.requiresApproval:
      card = constructDecisionCard(pkg, candidate.subscription)
      persist(card)
      agentState.pendingCardId = card.id

    elif pkg.action in ["KEEP", "DOWNGRADE", "CANCEL"]:
      // AUTONOMOUS: Execute immediately
      mutation = executeAction(pkg, candidate.subscription)
      applyMutation(mutation, candidate.subscription)
      persist(mutation)

  // All candidates processed in one synchronous run. If any cards are
  // pending, the agent stops acting and waits for the human gate
  // (status: waiting_for_approval) instead of pausing mid-loop.

  // Return all packages (GuardianRunOutput = DecisionPackage[])
  return packages
```

**Schedule:** Runs on demand (`npm run guardian`, `POST /api/demo/run`) and, when the
opt-in autopilot is enabled (`AUTOPILOT_ENABLED=true`, `src/api/autopilot.ts`), on an
in-process `setInterval` (default 120s). Production intent is an EventBridge cron (e.g.
every 4 hours); that is deliberately not deployed in this submission
(DECISIONS #044 / docs/01 Architecture).

## runGuardian Options (v2)

`runGuardian` accepts an optional options object:

```typescript
runGuardian(options?: {
  mode?: "mock" | "live";                          // model selection; default "mock"
  onProgress?: (event: GuardianProgressEvent) => void;
})
```

`onProgress` is called twice per candidate: with `status: "evaluating"`
immediately before the candidate's Strands Agent run, and with `status: "done"`
immediately after, including the resolved `action` and `confidence`. `guardian.ts`
never imports from `src/api/` — the callback is a plain function parameter, wired to
SSE only by the caller (`src/api/demo.ts`). No change to what Guardian decides; only
to what it reports while deciding. `mode` defaults to `"mock"` when omitted.

## runDemo Orchestration (v2)

`runDemo` (in `src/api/demo.ts`) generalizes its orchestration to act on **every**
package Guardian actually returns, not on hardcoded Acme subscription IDs:

```
for each package in packages:
  if pkg.action === "NEGOTIATE":
    runNegotiation(pkg.subscriptionId)      // for every NEGOTIATE package
  if pkg.action === "SWITCH":
    applySwitchMutation(pkg)                // keyed off pkg.subscriptionId, generically
```

Acme's canonical output is unchanged — Guardian still returns the same 5 packages for
Acme's data. The fix makes Live mode functional: Guardian can correctly recommend
NEGOTIATE or SWITCH on a real company's real data and the orchestrator will act on it.

## Negotiator Loop

```
function negotiate(subscription, policy):
  // DETERMINISTIC: Calculate price boundaries
  currentPrice = subscription.annualCost
  targetPrice = 9800   // Canonical demo target (Notion, from $12,000). LLM may adjust; demo locks $9,800.
  maxAcceptablePrice = currentPrice * 0.90  // 10% ceiling

  // Initialize negotiation state
  state = {
    subscriptionId: subscription.id,
    round: 0,
    maxRounds: 5,  // Hard cap. Canonical demo: 3.
    currentPrice,
    targetPrice,
    maxAcceptablePrice,
    buyerOfferPrice: null,
    proposedAcceptPrice: null,
    currentOffer: null,
    resolution: null,
    messages: []
  }

  // Negotiation loop
  while state.round < state.maxRounds:
    state.round++

    // AGENTIC: LLM crafts message and prices
    llmOutput = agent.negotiateRound(state, vendorHistory)
    // If the model output fails Zod validation (real-model path), retry once for this
    // round; a second failure resolves "stalled" and still produces a DecisionCard.
    // One malformed response never crashes the whole negotiation (mirrors Guardian).

    // DETERMINISTIC: Validate prices
    validatedOutput = validateNegotiationOutput(llmOutput)
    if validatedOutput.buyerOfferPrice > maxAcceptablePrice:
      validatedOutput.buyerOfferPrice = maxAcceptablePrice
    if validatedOutput.proposedAcceptPrice > maxAcceptablePrice:
      validatedOutput.proposedAcceptPrice = maxAcceptablePrice

    state.buyerOfferPrice = validatedOutput.buyerOfferPrice
    state.proposedAcceptPrice = validatedOutput.proposedAcceptPrice
    state.messages.push({
      role: "agent", content: validatedOutput.message, timestamp: now(),
      round: state.round,
      buyerOfferPrice: validatedOutput.buyerOfferPrice,
      currentOffer: null
    })

    // DETERMINISTIC: Send message to sandbox
    result = send_negotiation_message(vendorId, validatedOutput.message, validatedOutput.buyerOfferPrice)

    if result.status === "error":
      if retries < 1: retry; continue
      else: state.resolution = "stalled"; break

    // DETERMINISTIC: Parse response
    parseResult = parse_vendor_response(result.response)
    if parseResult.status === "parse_failure":
      state.resolution = "stalled"; break

    offer = parseResult.offer
    state.messages.push({
      role: "vendor", content: result.response, timestamp: now(),
      round: state.round,
      buyerOfferPrice: state.buyerOfferPrice,
      currentOffer: offer
    })

    // DETERMINISTIC: Check acceptance
    if offer.totalAnnual <= state.proposedAcceptPrice:
      state.resolution = "accepted"
      state.currentOffer = offer
      break

    state.currentOffer = offer

  // Round cap
  if state.resolution === null:
    state.resolution = "max_rounds"

  // Emit DecisionCard with realized savings
  realizedSavings = state.currentOffer ? currentPrice - state.currentOffer.totalAnnual : 0
  card = constructDecisionCardFromNegotiation(state, realizedSavings)
  persist(card)
  agent.status = "waiting_for_approval"  // Stop acting; wait for the human gate.
```

## Tool Failure Behavior

Every tool has explicit success and failure types. The agent must handle failures:

| Tool | Success | Failure | Agent Behavior |
|------|---------|---------|----------------|
| check_renewals | Subscription[] | Empty array | No renewal-window data. Continue — candidate set already built by `evaluateTriggers`. |
| benchmark_pricing | BenchmarkPricingResult (success) | evidence_unavailable | Note incomplete evidence. Cannot SWITCH without price source. |
| search_alternatives | SearchAlternativesResult (success) | evidence_unavailable | Cannot SWITCH. Recommend KEEP with note. |
| send_negotiation_message | SendMessageResult (success) | error (timeout/unreachable) | Retry once. Then stall. |
| parse_vendor_response | ParseVendorResponseResult (success) | parse_failure | Treat as vendor stall. |
| check_policy | PolicyResult (always succeeds) | Never fails | N/A |

**Research stopping criteria:** Before a material recommendation (SWITCH, CANCEL, NEGOTIATE), the agent must have:
- At least one `hasCurrentPriceSource` or `hasInternalSignal`
- For SWITCH: additionally `hasAlternativeSource`

If criteria not met, recommend KEEP with a note about missing evidence.

## What NOT to Do

- Do not implement the vendor sandbox here (`docs/04-vendor-sandbox.md`).
- Do not build UI (`docs/05-ui-spec.md`).
- Do not introduce separate agent instances.
- Do not let the LLM bypass policy.
- Do not let the LLM invent evidence data.
- Do not parse vendor responses with "best-effort defaults" — return structured failure.
