---
id: ui-spec
level: L4
depends_on: [domain-model, agent-spec]
provides: ui-spec
used_by: [L4]
status: active
---

# 05 — UI Spec

## Event Mechanism

SSE from `GET /api/events`. Browser is never the authority over agent state.

> Payload note: each `negotiation_message` carries that **message's own** `round`,
> `buyerOfferPrice`, and `currentOffer`. Two messages are emitted per round — one
> `role:"agent"` (proposal) and one `role:"vendor"` (structured counter-offer). A client
> can therefore rebuild the offer path `10,800 → 10,200 → 9,840` from the frames directly;
> it never has to parse prose.

### SSE Event Payloads

```
event: guardian_update
data: { "subscriptionId": "notion", "action": "NEGOTIATE",
        "estimatedSavings": 0, "confidence": 0.87,
        "evidenceCount": 3, "requiresApproval": true }
# NEGOTIATE estimatedSavings = 0 at Guardian time. Realized ($2,160) appears
# on the DecisionCard only after the negotiation completes.

event: guardian_progress
data: { "subscriptionId": "figma", "vendorName": "Figma",
        "status": "evaluating" }
# Fired per candidate, twice per candidate: "evaluating" when its Strands
# evaluation starts, "done" (with the resolved action) when it finishes.
# Per docs/02's GuardianProgressEvent.

event: negotiation_message
data: { "subscriptionId": "notion", "round": 2,
        "role": "agent" | "vendor", "content": "We're targeting $9,800.",
        "currentOffer": { "totalAnnual": 10200, "terms": "2-year commitment" },
        "targetPrice": 9800, "maxAcceptablePrice": 10800,
        "buyerOfferPrice": 9800, "proposedAcceptPrice": 10800 }

event: decision_card
data: { "cardId": "card-notion-001", "subscriptionId": "notion",
        "action": "NEGOTIATE", "status": "pending",
        "estimatedSavings": 2160, "realizedSavings": 2160,
        "summary": "Notion negotiated from $12,000 to $9,840." }

event: savings_update
data: { "totalSavings": 5760, "approvedCount": 2, "lastAction": "loom-switch" }

event: agent_status
data: { "mode": "guardian" | "negotiator" | "idle" | "waiting_for_approval",
        "pendingCardId": "card-notion-001" | null,
        "currentSubscriptionId": "notion" | null }

event: error
data: { "code": "research_unavailable" | "memory_unavailable" | "negotiation_failed",
        "message": "Web research unavailable. Using cached data." }
```

## Screens

### 1. Stack Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  SAVR — Acme Corp SaaS Stack                    SAVINGS: $0/yr  │
├──────────┬──────────────┬────────────┬──────────┬────────┬──────────┤
│ Vendor   │ Category     │ Cost       │ Seats    │ Renew  │ Status   │
├──────────┼──────────────┼────────────┼──────────┼────────┼──────────┤
│ Notion   │ Productivity │ $12k       │ 14/20    │ 9/24   │ NEGOTIATE│
│ Slack    │ Communication│ $5.4k      │ 18/18    │ 10/25  │ KEEP     │
│ Loom     │ Video        │ $3.6k      │ 9/12     │ 10/10  │ SWITCH   │
│ Veed     │ Video        │ $2.4k      │ 8/10     │ 12/9   │ KEEP     │
│ ...      │ ...          │ ...        │ ...      │ ...    │ ...      │
└──────────┴──────────────┴────────────┴──────────┴────────┴──────────┘
```

### 2. Guardian Feed

```
┌─────────────────────────────────────────────────────┐
│ Notion — NEGOTIATE (requires approval)             │
│ Renewal 9/24. $12,000/yr. 6 unused seats.          │
│ Risk: 2-year commitment may be required.           │
│ Confidence: 0.87                                   │
│ [View DecisionCard]                                 │
├─────────────────────────────────────────────────────┤
│ Loom/Veed — SWITCH (requires approval)             │
│ Loom ($3.6k) + Veed ($2.4k) = $6k/yr for Video.    │
│ Overlap detected. Consolidate to Veed, cancel Loom.│
│ [View DecisionCard]                                 │
└─────────────────────────────────────────────────────┘
```

### 3. Negotiation Log (The Money Shot)

```
┌──────────────────────────────────────────────────────────────┐
│ NEGOTIATION: Notion                    [resolved · accepted] │
│ Round 3 of 5  Current $12,000/yr  Target $9,800  Max $10,800 │
│ Offer path:  $10,800 → $10,200 → $9,840  [accepted $9,840/yr]│
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Savr · round 1                  Proposing $9,800/yr      │ │
│ │ We'd like to renew at $9,800...                          │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Vendor · round 1                Offer: $10,800/yr        │ │
│ │ We're unable to go that low. $10,800...                  │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

The transcript is a **first-class record, not decoration**: every round stores both the
agent's message (with its `buyerOfferPrice`) and the vendor's response (with its own
`currentOffer`). The offer path above comes from those per-round numbers — never from
parsing chat text.

**The debug accept/reject buttons are NOT part of the UI.** A shipped product does not
expose its own test harness. `POST /api/debug/negotiation/:id/:action` remains available
server-side for integration probes only; the client never renders it.

### 4. Decision Card

```
┌──────────────────────────────────────────────┐
│ DECISION REQUIRED                            │
│                                              │
│ Action: NEGOTIATE                            │
│ Subscription: Notion                         │
│                                              │
│ Current price:  $12,000/yr                   │
│ Negotiated to:  $9,840/yr                    │
│ Realized savings: $2,160/yr                  │
│                                              │
│ Migration: No migration needed. 2-year       │
│            commitment required.              │
│                                              │
│ Evidence:                                    │
│ • Utilization: 14/20 seats active (internal) │
│ • Market: comparable tools $8,400 (cached)  │
│                                              │
│ [Approve]  [Reject]  [View Full Details]     │
└──────────────────────────────────────────────┘
```

### 5. Savings Counter

```
┌─────────────────────────────────────┐
│ SAVINGS: $5,760/yr                  │
└─────────────────────────────────────┘
```

Updates after each approval. Demo closing shot target: **$5,760**.

The counter tracks **only human-approved post-approval mutations**. Autonomous actions (KEEP, DOWNGRADE, CANCEL) change subscriptions but do NOT move the counter. This is why the counter reads $0 right after `/api/demo/run` and only reaches $5,760 after both approvals.

### 6. Pending Actions Count

```
2 actions need your approval
```

Dynamic: `${pendingCount} actions need your approval`. After all resolved: `All actions resolved`.

### 7. Policy View

Shows the active procurement policy (read-only):

```
┌─────────────────────────────────────┐
│ ACTIVE POLICY                       │
│ Max annual budget: $60,000          │
│ Max per-vendor spend: $15,000       │
│ Renewal window: 30 days             │
│ Unused seat threshold: 50%          │
│ Blacklist: competitor-x             │
│ NEGOTIATE/SWITCH: require approval  │
│ DOWNGRADE/CANCEL: autonomous        │
└─────────────────────────────────────┘
```

Editing is out of scope. Displaying the policy is required — "Humans define the rules" must be visible.

### 8. Landing ("Set Up" entry)

Two entry points presented as equals, neither hidden behind the other. See
`docs/08-product-flow.md` for full detail:

- **Try the Mock Demo** — Acme walkthrough. `POST /api/demo/run { mode: "mock" }`,
  lands on the existing dashboard with the director's replay pacing, exactly as today.
- **Set Up Your Company** — the real onboarding flow: Company → Stack → Reviewing →
  existing dashboard.

### 9. Company

Form for `name`, `employees`, `annualBudget`. Posts to `POST /api/session/company`.
No new fields beyond the `Company` shape.

### 10. Stack

Two ways in, both hitting `POST /api/stack/import` (which already validates required
fields and billing model):

- **Manual** — add a row per tool (vendor name, category, annual cost, seats, renewal
  date). A form, not a spreadsheet import.
- **Import** — paste or upload JSON matching the `Subscription[]` shape. Primary path
  for the video. Surface the endpoint's existing validation errors directly.

### 11. Reviewing

Subscribes to `guardian_progress` SSE events and renders each candidate's evaluation as
it starts and finishes (vendor name, then its action once resolved). On completion,
navigates to the existing dashboard — unmodified.

## Behavior Rules

- Agent persists DecisionCard and halts. Browser only reads.
- Approve → POST `/api/decisions/:cardId/approve` → idempotent. Backend applies post-approval mutation and resumes agent.
- Reject → POST `/api/decisions/:cardId/reject` → idempotent. Agent may recommend an alternative.
- View Full Details → shows DecisionPackage with all evidence.
- SSE updates feed, log, savings, and status automatically.
- On **Approve NEGOTIATE**: `subscription.renewalCost` is set to the negotiated total; no vendor is contacted.
- On **Approve SWITCH (Loom/Veed)**: `loom.status = "switched"`, `veed` remains active.

## Loading States

| State | UI |
|-------|-----|
| `agent_running` | Skeleton rows + "Loading stack…" on first paint |
| `agent_idle` | Static rows, agents idle, empty-state copy |
| `approval_pending` | Card visible, row highlighted |
| `negotiating` | Live log, row highlighted blue |
| `research_unavailable` | "Using cached data" badge |
| `memory_unavailable` | "Local mode" badge |
| `no_pending_actions` | "All actions resolved" |
| `negotiation_failed` | "Best offer available" |

## Presentation (DemoDirector)

The dashboard renders the run as a **story the agent actually performed**, driven by a pure
client-side reducer over the real SSE stream — not by post-hoc scripting:

- `DirectorPhase`: `idle → guardian → negotiating → approval → resolved`
- Phase bar, activity log, offer ticker, savings count-up all derive from captured frames.
- Pacing is **parameterized**: live/production rendering applies frames as they arrive
  (`pacing = 0`, the "● LIVE" badge is a truthful readout of this mode). Replaying a
  captured run for a presentation/video uses a timed table (guardian 700ms, message
  1100ms, card 900ms, savings 700ms). Same reducer, two callers.
- The bounded per-run capture is available via `GET /api/demo/recording` so a run can be
  replayed without re-executing agents.
- `ui:check-story` captures the real SSE frames of a full run + approvals, replays them
  through the reducer, and asserts the phase arc and the $0 → $2,160 → $5,760 savings
  canvas — proving the story is data, not a script.

## API Contracts

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/session/company` | POST | Body: `Company`. Overwrites `data/company.json` for the current session. |
| `/api/subscriptions` | GET | Subscription[] with status |
| `/api/decisions` | GET | DecisionPackage[] |
| `/api/decisions/pending` | GET | Pending DecisionCard[] |
| `/api/decisions/:cardId` | GET | Single DecisionCard |
| `/api/decisions/:cardId/approve` | POST | Approve (idempotent) |
| `/api/decisions/:cardId/reject` | POST | Reject (idempotent) |
| `/api/negotiation/:subscriptionId` | GET | Final NegotiationState, 404 if never negotiated |
| `/api/savings` | GET | { totalSavings } |
| `/api/events` | GET | SSE stream |
| `/api/demo/reset` | POST | Reset to initial state |
| `/api/demo/run` | POST | Synchronous demo pipeline. Returns only when complete. Body: `{ mode: "mock" \| "live" }`, default `"mock"`. `"mock"` always resets from seed first; `"live"` runs against current session data. |
| `/api/demo/recording` | GET | Captured SSE frames of the last run (bounded replay buffer, cleared on reset) |
| `/api/agent/status` | GET | { mode, pendingCardId, currentSubscriptionId } |
| `/api/policy` | GET | Active Policy (read-only) |
| `/api/stack/import` | POST | Primary onboarding data-entry path. Validates against Subscription schema. |

`/api/demo/run` is **synchronous**: runs Guardian → Negotiate → DecisionCard pipeline and returns only when complete. `mode` defaults to `"mock"` so pre-existing callers keep working unchanged.

`/api/demo/run` is **synchronous**: runs Guardian → Negotiate → DecisionCard pipeline and returns only when complete.

```json
{
  "status": "complete",
  "decisionPackages": 5,
  "cardsPending": 2,
  "autonomousActions": 3,
  "savings": 0
}
```

The canonical demo produces:
- **5 DecisionPackages:** notion (NEGOTIATE), loom (SWITCH), veed (KEEP — consolidation target), notion-ai (DOWNGRADE), posthog (KEEP)
- **2 pending DecisionCards:** notion + loom
- **3 autonomous actions:** veed KEEP, notion-ai DOWNGRADE, posthog KEEP

This is deterministic: the data (renewals, overlap, price increase) plus the deterministic approval model always produce these two cards.

`/api/negotiation/:subscriptionId` returns the final negotiation state even after completion (for the money shot). Returns 404 if this subscription was never negotiated.

**Idempotency:** An already-approved card cannot be rejected (409 with current status). An already-rejected card cannot be approved (409 with current status). A repeated approve/reject on a terminal state returns the existing result (200).

## Demo Controls

- **Reset Demo** → `POST /api/demo/reset`. Restores subscriptions, clears negotiations/cards/savings/memory.
- **Run Demo** → `POST /api/demo/run`. Synchronous canonical pipeline.
- Flow: Reset → Run → "2 actions need your approval" → Approve both → Savings.

## Canonical Demo State (exact)

### After `/api/demo/run`, before approval:

| Card ID | Subscription | Action | Card Status | Savings |
|---------|--------------|--------|-------------|---------|
| card-notion-001 | notion | NEGOTIATE | pending | estimated 2160, realized 2160 |
| card-loom-switch-001 | loom | SWITCH | pending | estimated 3600, realized 0 |

Pending text: **"2 actions need your approval"**
Savings counter: **$0**

### After approving both cards:

| Approved Card | Post-Approval Mutation | Savings Added |
|---------------|------------------------|---------------|
| card-notion-001 | notion.renewalCost = 9840 | $2,160 |
| card-loom-switch-001 | loom.status = "switched" | $3,600 |

Final savings counter: **$5,760/yr**
Text: **"All actions resolved"**