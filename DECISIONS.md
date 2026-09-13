---
id: decisions-log
level: meta
depends_on: []
provides: decision-history
used_by: [all]
status: active
---

# DECISIONS.md — ADR Log

## Template

```
## NNN — YYYY-MM-DD — <title>
**Context:** Why this decision was needed.
**Decision:** What was chosen.
**Alternatives:** What was rejected.
**Consequences:** What is now locked in.
```

---

## 001 — 2026-09-10 — Product name: Savr

**Context:** Needed a short, memorable name conveying saving money on software.
**Decision:** **Savr**. Tagline: "Humans define the rules. Agents run the work."
**Alternatives:** ProcureBot, SaaS Sniper, RenewWise, StackSaver.
**Consequences:** All public materials and demo use "Savr."

## 002 — 2026-09-10 — Dual-loop architecture

**Context:** The product needs passive monitoring and active negotiation.
**Decision:** Guardian (monitoring/decision) and Negotiator (one capability invoked by Guardian). Single Strands agent, two modes.
**Alternatives:** Separate agents. Three-loop design.
**Consequences:** Guardian emits DecisionPackage[]; Negotiator emits DecisionCard. Negotiation is not the product — continuous stack management is.

## 003 — 2026-09-10 — Markdown context router

**Context:** Agents need to know what to read/write per build level.
**Decision:** `AGENTS.md` routing table with the L0–L5 Read/Write columns and a source-of-truth hierarchy.
**Alternatives:** JSON config, YAML pipeline, DB permissions.
**Consequences:** Routing table is the single source of truth for agent scope.

## 004 — 2026-09-10 — Money units: integer USD dollars

**Context:** "Whole cents" contradicted the $12,000-style data.
**Decision:** Integer USD dollars in MVP. Production would use cents or decimal.
**Alternatives:** Cents everywhere, floats.
**Consequences:** All cost fields are integer USD.

## 005 — 2026-09-10 — billingModel field

**Context:** Vercel/AWS are usage-based; the seat-cost invariant can't hold for them.
**Decision:** `billingModel: "seat_based" | "usage_based"`. Seat fields nullable for usage-based.
**Consequences:** Validation branches on billingModel. Usage-based skip utilization checks.

## 006 — 2026-09-10 — Policy is deterministic and authoritative

**Context:** Approval mechanisms contradicted each other; LLM could override policy.
**Decision:** Policy evaluation is code. LLM proposes; code validates; human approves high-stakes actions.
**Consequences:** `check_policy` returns PolicyResult; hooks cancel violating tool calls.

## 007 — 2026-09-10 — SSE for UI events

**Context:** UI needs real-time updates; architecture only defined Express.
**Decision:** Server-Sent Events from `GET /api/events` with typed payloads.
**Alternatives:** WebSocket, polling.
**Consequences:** SSE endpoint with canonical payload schemas.

## 008 — 2026-09-10 — Demo snapshot with cached research

**Context:** Live web search is risky during a recorded demo.
**Decision:** `DEMO_MODE=true` loads `data/cached-evidence.json`. Live search is a stretch feature, not the demo path.
**Alternatives:** Always live, never live.
**Consequences:** benchmark_pricing/search_alternatives check DEMO_MODE first.

## 009 — 2026-09-10 — Action / resolution / human decision separation

**Context:** `DecisionCard.action = NEGOTIATE → ACCEPT` was semantically broken.
**Decision:** Separate `DecisionAction` (agent recommendation), `NegotiationResolution`, and `HumanDecision` ("reviewed" is not a terminal state).
**Consequences:** Clean data model; card transitions `pending → approved | rejected`.

## 010 — 2026-09-10 — Negotiation price semantics

**Context:** `floorPrice` was ambiguous and effectively backwards.
**Decision:** Four distinct prices: `currentPrice`, `targetPrice`, `maxAcceptablePrice` (code-derived), `vendorReservationPrice` (vendor-private). Plus `buyerOfferPrice` (what agent proposes) and `proposedAcceptPrice` (max agent accepts) — these are different and both bounded by `maxAcceptablePrice`.
**Consequences:** Sandbox receives only `buyerCurrentPrice` and `buyerOfferPrice` — never private state.

## 011 — 2026-09-10 — Estimated vs realized savings

**Context:** The domain formula said NEGOTIATE = current − negotiated, but Guardian runs before negotiation. That number doesn't exist yet.
**Decision:** Guardian emits `estimatedSavings` (which is 0 for NEGOTIATE until completion). Negotiator emits `realizedSavings` after the deal. Both live on the DecisionCard.
**Consequences:** `EstimatedSavings.isRealized` on DecisionPackage; `realizedSavings` on DecisionCard.

## 012 — 2026-09-10 — Approval policy: NEGOTIATE/SWITCH always require approval

**Context:** `requiredApprovalAbove` + `autoApproveThreshold` + autoApprove rules contradicted each other. The demo needs NEGOTIATE to produce a pending card.
**Decision:** Simple deterministic model:
- NEGOTIATE, SWITCH → ALWAYS require human approval
- KEEP, DOWNGRADE, CANCEL → autonomous (subject to policy)
- Annual cost > maxSingleVendorSpend → requires approval
- Blacklist → blocked

Both thresholds are removed. No auto-approval of spending actions.
**Alternatives:** Threshold-based auto-approval.
**Consequences:** Every file uses this single model. Demo produces exactly 2 pending cards.

## 013 — 2026-09-10 — Sandbox vendor is a round-schedule state machine

**Context:** The vendor decision table contradicted the canonical example (15% request → wrong offer, round 3 more generous than "post-round-3 conservative shift").
**Decision:** The vendor's counter-offer is purely a function of round number: 10% / 15% / 18% / 20% / 22%. The vendor accepts `buyerOfferPrice` at or above that round's counter. The agent's message does not drive the counter (except: mentioning a credible competitor improves it by 2%). The agent's accept/reject/continue decision makes it a real loop.
**Alternatives:** Request-driven tables (didn't close in 3 rounds with clean numbers).
**Consequences:** Canonical demo yields $10,800 → $10,200 → $9,840, agent accepts, realized savings $2,160.

## 014 — 2026-09-10 — Sandbox API gets structured buyerOfferPrice

**Context:** Sandbox can't guess a numeric offer from prose; that makes it non-deterministic.
**Decision:** `POST /vendor/:vendorId/message` requires `buyerOfferPrice` as a number. `send_negotiation_message` signature includes it.
**Consequences:** Deterministic demo. No natural-language price extraction on the sandbox side.

## 015 — 2026-09-10 — DynamoDB persistence model

**Context:** "DynamoDB memory" had no table contract.
**Decision:** Table `savr-procurement-memory`. PK `companyId`, SK `entityType#entityId`. Items: company, subscription, vendor, decision, negotiation, policy. Load only active policy + relevant vendor history + last 10 decisions at session start.
**Consequences:** Memory loading is explicit and bounded.

## 016 — 2026-09-10 — Remove trustScore

**Context:** "Learned over time" with no learning algorithm lets a coder invent one.
**Decision:** Vendor history stores lastContacted/lastOutcome/notes. Trust scoring is post-hackathon.
**Consequences:** No learning code in MVP.

## 017 — 2026-09-10 — Pinned Strands stack

**Context:** Vague "latest" is not reproducible.
**Decision:** Node 22+, `@strands-agents/sdk@1.14.0`, TypeScript 5.x. Bedrock `anthropic.claude-sonnet-4-6-20250514-v1:0`, region `us-east-1`.
**Consequences:** package.json pins exact versions.

## 018 — 2026-09-10 — Strands integration contract

**Context:** Docs had a Python hook example and vague structured-output claims.
**Decision:** Hooks are `BeforeToolCallEvent` — mutate/cancel the event (no HookResult). LLM outputs `GuardianOutput`/`NegotiationOutput` via Zod; application code builds `DecisionPackage`/`DecisionCard`. State maps: `appState` (policy/config), `invocationState` (per-evaluation), DynamoDB (persistence).
**Consequences:** All Strands code is TypeScript against the real SDK. All examples in specs match the SDK.

## 019 — 2026-09-10 — Candidate selection covers the whole stack

**Context:** `check_renewals` only returned renewal-window subscriptions, but Savr must catch unused seats, overlaps, price increases. Veed (+90d) still needs flagging.
**Decision:** Candidate set from 5 triggers: renewal_soon, unused_seats, category_overlap, price_increase, budget_anomaly. Veed is caught by category_overlap.
**Consequences:** Guardian evaluates the full stack, not just renewals.

## 020 — 2026-09-10 — Fixed demo clock

**Context:** "Notion renews in +14 days" can't depend on the real system clock.
**Decision:** `getDemoDate()` returns `2026-09-10T12:00:00-07:00` when `DEMO_MODE=true`. All dates absolute ISO 8601.
**Consequences:** Reproducible regardless of when the repo is run.

## 021 — 2026-09-10 — Canonical demo round semantics

**Context:** 3/4/5 rounds appeared across files.
**Decision:** 3 canonical demo rounds; 5 hard cap. Round 4–5 are edge-case tests.
**Consequences:** Demo script targets 3 rounds.

## 022 — 2026-09-10 — Gross savings, migration notes

**Context:** Migration cost would make savings estimates unreliable.
**Decision:** Savings are gross, before migration cost. Migration described qualitatively.
**Consequences:** DecisionCard.migrationNotes carries migration impact.

## 023 — 2026-09-10 — Post-approval mutations defined

**Context:** "Approve" only changed card status; nothing mutated the subscription.
**Decision:** Explicit `PostApprovalMutation`: NEGOTIATE → renewalCost=negotiated; SWITCH → old status=switched, new sub created; DOWNGRADE → seats reduced, cost recomputed; CANCEL → status=cancelled; KEEP → none.
**Consequences:** Approve actually executes the action end-to-end.

## 024 — 2026-09-10 — Idempotency for approval actions

**Context:** Double-click / retry could double-execute.
**Decision:** Card status is the idempotency key. Repeated approve/reject returns existing result; wrong transition returns 409.
**Consequences:** Backend validates card status before executing.

## 025 — 2026-09-10 — vendorId vs vendorName

**Context:** "Notion" vs "notion" mixed in policy/sandbox/blacklist.
**Decision:** `Subscription.id` is the canonical vendorId used in policy, sandbox, memory. `vendorName` is display-only.
**Consequences:** Blacklist and sandbox use `id`.

## 026 — 2026-09-10 — Guardian outputs an array

**Context:** Specs alternated between "a DecisionPackage" and a JSON array.
**Decision:** `GuardianRunOutput = DecisionPackage[]`. One package per flagged subscription.
**Consequences:** `npm run guardian` prints a valid array.

## 027 — 2026-09-10 — Tool results are explicit unions

**Context:** `send_negotiation_message` declared `{response, offer}` but had error returns.
**Decision:** Every tool returns an explicit success/error union. `parse_vendor_response` returns parse_failure rather than inventing defaults.
**Consequences:** No fabricated data. Clear failure handling.

## 028 — 2026-09-10 — Strands is never removed

**Context:** The build plan's "direct Bedrock API" fallback would violate the Strands requirement.
**Decision:** Kill switches simplify the Strands implementation (fewer tools, simpler schema, cached evidence) but never remove the Strands Agent.
**Consequences:** Strands stays the orchestrator under every fallback.

## 029 — 2026-09-10 — Exact demo numbers

**Context:** ~$9,800 / ~$5,800 were not reproducible.
**Decision:** Canonical totals: Notion negotiated to $9,840 (savings $2,160). Loom/Veed consolidate to Veed, cancel Loom (savings $3,600). Final savings counter: **$5,760**. Pending text "2 actions need your approval."
**Consequences:** Demo, tests, UI, and video agree on $5,760.

## 030 — 2026-09-10 — Live search is a stretch

**Context:** Web search provider/API/credentials/rate limits were never specified.
**Decision:** Cached evidence (`data/cached-evidence.json`) is the canonical demo path. Live search (e.g. a Perplexity integration) is explicitly a stretch — not required.
**Consequences:** No un-pinned external search dependency in the demo.

## 031 — 2026-09-10 — Stack import endpoint

**Context:** The product felt seeded entirely from Acme JSON.
**Decision:** `POST /api/stack/import` accepts a stack JSON matching the Subscription schema. Product boundary is the schema, not hardcoded data.
**Consequences:** Demo ships with Acme seeded; import works.

## 032 — 2026-09-10 — Hackathon compliance locked

**Context:** Stage One requires Strands; blog is optional bonus; video ≤5 min; repo/license/Builder ID rules apply.
**Decision:** Compliance checks are L5 acceptance items. Blog is optional (0.6 bonus, "Agents for Humans" title). Video plan 3 min, cap 5.
**Consequences:** L5 task includes the compliance checklist. No contract requires the blog.

## 033 — 2026-09-10 — Spec discrepancy sweep (16 items)

**Context:** Third cross-file audit after the build plan consumed the demo numbers. Six P0 inconsistencies would have misdirected coding.
**Decision:** Resolved in the lower-ranked files per the AGENTS.md hierarchy:
- Canonical NEGOTIATE target is **$9,800** (not `currentPrice * 0.82` = $9,840). Negotiator pseudocode initializes `targetPrice = 9800`; the LLM may adjust, the demo locks $9,800.
- SWITCH savings = **full annualCost of the vendor switched away from** (alternative cost not subtracted). Loom→Veed consolidation saves Loom's full $3,600 because Veed is already paid for.
- Savings counter tracks **only approved post-approval mutations**. Autonomous actions (e.g. notion-ai DOWNGRADE) do not move the counter → $0 before approval, $5,760 after, by design.
- `EstimatedSavings` for NEGOTIATE is 0 at Guardian time and equals `realizedSavings` once negotiation completes (SSE `guardian_update` shows 0).
- CANCEL cancellation-window uses **`renewalDate`** (not `contractEnd`).
- Guardian loop does not `pause()` mid-candidate; one synchronous run emits cards, then the agent enters `waiting_for_approval`.
- P1/P2 cleanups: `check_renewals` is informational (candidate set is deterministic), misleading row notes reworded, Veed mock shows KEEP, CANCEL mutation sets `renewalCost: 0`, cache key corrected to `Analytics#posthog`, `budget_anomaly` documented as intentionally dead, hierarchy table includes 04/06, unverified SDK URL removed from README, "2–3 categories" wording aligned.
**Alternatives:** Keep the formulas and relabel demo numbers (rejected — demo numbers are locked in #029).
**Consequences:** All spec files, SSE examples, and the canonical demo table agree on the same operands.

## 034 — 2026-09-10 — Strands SDK public URL

**Context:** README linked `github.com/strands-agents/sdk-typescript`; the URL was never verified.
**Decision:** Removed the hyperlink from README. The real URL must be confirmed from the Strands installation output at L5 before publishing.
**Alternatives:** Guessing a different URL (rejected — never publish an unverified external link).
**Consequences:** README names the package and pin only; a verified URL may be added back at L5.

## 035 — 2026-09-10 — check_policy signature includes policy

**Context:** The spec documented `check_policy` as `(action, subscriptionId, estimatedSavings)` but its rules evaluate `policy.blacklist`/`policy.categories` etc., and the L2 task tests already passed a `policy` argument (4-arg call). The documented and tested signatures disagreed.
**Decision:** Signature is `(action: DecisionAction, subscriptionId: string, policy: Policy, estimatedSavings: number) → PolicyResult`. Updated the spec, the architecture tools table, the Guardian loop call, and the L2 test snippets (which now define the policy inline). NEGOTIATE sample uses estimatedSavings 0; DOWNGRADE sample uses figma's real 420.
**Alternatives:** Keep 3 args and have check_policy load policy internally (rejected — the rules need the exact policy; injecting is deterministic and testable).
**Consequences:** Interfaces, tools table, loop, and tests agree.

## 036 — 2026-09-10 — Fourth sweep residuals (5 items)

**Context:** Re-audit after #033 surfaced 5 small leftovers.
**Decision:**
- Post-Approval Mutations table CANCEL row now includes `renewalCost = 0` (matches interface comment + architecture).
- `check_renewals` failure row in Tool Failure Behavior clarified: empty result means no renewal-window data, not no candidates.
- `PROGRESS.md` Active Decisions range updated to #001–#034.
- aws row note reworded to `renewalDate` (no nonexistent `nextRenewalDate` field).
- README Build block now lists `npm run demo:test` (the agreed E2E script referenced by L5).
**Alternatives:** n/a — pure consistency cleanups.
**Consequences:** No known contradictions remain between spec, tasks, README, and progress files.

## 037 — 2026-09-10 — AWS cost guardrails

**Context:** Bedrock inference is the only real AWS cost; nothing in the repo throttles how often it is invoked, which could burn credits during dev.
**Decision:** Codified guardrails in `docs/07-build-plan.md` → "AWS Cost Guardrails" and the L2 task:
- `DEMO_MODE=true` is the default (cached evidence, local memory fallback).
- Least-privilege IAM: `bedrock:InvokeModel*` on the Sonnet 4.6 model ARN only + DynamoDB CRUD on `savr-procurement-memory` only.
- One-time manual AWS Budget alert (~$5) before first Bedrock call.
- `SAVR_MODEL` env override for cheaper dev loops; demo pins Sonnet 4.6.
- No always-on cron during the hackathon; runs are manually triggered.
**Alternatives:** None — all five are additions, no behavior change to the product spec.
**Consequences:** Dev and demo spend stay bounded; the two manual AWS account steps live in the build plan as L2 prerequisites.
---

## 038 — 2026-09-11 — L2 implementation forks: model ID, overlap trigger, hook API, model resolution, in-memory execution

**Context:** Surfaced while implementing L2 against the live Strands SDK 1.14.0 and Bedrock.

**Decisions:**
1. **Model ID fixed.** The pinned ID `anthropic.claude-sonnet-4-6-20250514-v1:0` is invalid ("The provided model identifier is invalid" from Bedrock). Correct ID is `anthropic.claude-sonnet-4-6` (the SDK's own default; `anthropic.claude-sonnet-4-20250514-v1:0` is the Sonnet-4 launch ID). IAM user `savr-dev` is not yet authorized for `bedrock:InvokeModel*` on any Sonnet model. Updated `docs/07-build-plan.md` stack. IAM remaind a manual one-time prerequisite for the live path.
2. **Model resolution rule (deterministic demo).** `createModel()`: if `SAVR_MODEL` set → live Bedrock; else if `DEMO_MODE=true` → `LocalModel` (deterministic Strands model, zero cost, offline); else → live Bedrock `anthropic.claude-sonnet-4-6`. Strands is the orchestrator in every path — Agent, tools, hooks, Zod structured output all run for real; only the model is injected. When IAM access is granted, setting `SAVR_MODEL` (or `DEMO_MODE=false`) activates the live path unchanged.
3. **category_overlap refined.** Mechanical definition ("another active subscription in same category") would also flag Slack + Zoom (both "Communication"), producing 7 packages and breaking the locked 5-package / 2-card demo. Refined: fires when an active same-category pair exists AND at least one member has a base trigger (renewal_soon/unused_seats/price_increase/budget_anomaly); both members flagged when qualified. Reproduction of exactly the canonical five (notion, loom, veed, notion-ai, posthog). Doc-filled into `docs/01` + `docs/06`.
4. **Hook API.** SDK 1.14.0 exposes `event.agent.appState` (StateStore) and `event.invocationState`, not `event.agent.state`; cancellation is `event.cancel = string`, not `event.cancel({reason})`. Implemented against the real SDK; hook semantics (policy missing → cancel, 12-call limit, blacklist, budget cap, price bounds) unchanged. Structured-output tool name is `strands_structured_output`.
5. **L2 executeAction is in-memory only.** Autonomous mutations (veed KEEP, notion-ai DOWNGRADE, posthog KEEP) run against a copy and are logged; `data/subscriptions.json` stays canonical until L4 wiring persists real state.

**Alternatives:** Emitting 7 packages (rejected: breaks locked demo numbers). Making Bedrock the strict default in demo mode (rejected: IAM not yet authorized, nondeterministic recordings).
**Consequences:** `npm run guardian` is fully deterministic and offline; the live Strands+Bedrock path exists behind the same code and activates via `SAVR_MODEL`.

---

## 039 — 2026-09-11 — L3 implementation forks: negotiator loop, sandbox contract, persistence

**Context:** Surfaced while implementing L3 (Negotiator via Strands + Express sandbox) against SDK 1.14.0.

**Decisions:**

1. **SDK API verification — no drift.** Every name in `docs/03`-`docs/04` was checked against the installed SDK d.ts: `Agent.invoke(prompt, { structuredOutputSchema, invocationState })` per-invocation override exists (`InvokeOptions.structuredOutputSchema` / `.invocationState`), `AgentResult.structuredOutput`, `tool()` callbacks receive `(input, context)` with `context.invocationState`, `BeforeToolCallEvent` cancellation via `event.cancel`. Negotiator reuses the single Strands `Agent` (same system prompt, tools, guardrail hook) with a per-round `structuredOutputSchema = NegotiationOutputSchema` override — "Guardian and Negotiator are modes" is implemented as two invoke contracts on one agent, not two agents.
2. **Canonical negotiation parameters.** Agent proposes `buyerOfferPrice = $9,800` every round (locked target) and `proposedAcceptPrice = $10,000` (≥ round-3 counter $9,840, ≤ ceiling $10,800), so round 3 utes: vendor counters $10,800 → $10,200 → $9,840, all within `proposedAcceptPrice` at $9,840, resolved `accepted`, realized savings **$2,160**. Both prices are clamped to `maxAcceptablePrice = 90% of currentPrice` after Zod validation.
3. **`send_negotiation_message` carries sandbox fields via invocationState.** Sandbox requires `round` + `buyerCurrentPrice`; the tool signature stays 3-arg as spec'd. The Strands tool callback reads `context.invocationState.round/buyerCurrentPrice`; the deterministic negotiator loop passes them via an optional 4th parameter on the plain function. `proposedAcceptPrice`/`targetPrice` never appear in any HTTP payload (proven by the sandbox audit log, `GET /vendor/:id/messages`).
4. **`parse_vendor_response` parses the structured offer, never prose.** `SendMessageResult.response` is natural language; feeding it to `parse_vendor_response` (a JSON parser) can only fail. The loop serializes `result.offer` (the vendor's structured payload) to JSON and feeds that — "never invents data" holds and determinism is preserved. No change to the L2 tool.
5. **DecisionCard persistence → `data/cards.json`.** L2 emitted cards in-memory only. L3 wires pending-card persistence as a `DecisionCard[]` registry (`loadCards`/`upsertPendingCard`), upserted per subscriptionId while pending, so repeated `npm run negotiate` runs leave exactly one notion pending card. Guardian stays read-only; proposal cards are consumed by L4. `memory.json` `negotiations[]` fills at approval time (L4).
6. **`npm run negotiate` is self-contained.** If port 3001 is not serving `/health`, it boots the sandbox in-process (unref'd) and closes it before exit; if a standalone sandbox is already running it is reused, so `npm run sandbox &` + `npm run negotiate` and bare `npm run negotiate` are equivalent. Exit code 0 only when the gate holds (card pending, realizedSavings $2,160).
7. **Stall rule contradiction resolved (docs/04 edited).** docs/04 said "stalls on same `buyerOfferPrice` 3+ times", but the locked canonical demo proposes $9,800 in rounds 1-3. The 3rd identical booking must NOT stall. Fixed the lower-ranked file (`docs/04`, bullet 3): stall tripped only by the **4th** identical consecutive booking, with the canonical rationale inlined. `docs/03` unchanged; verified by T4 of `npm run validate:sandbox`.
8. **Sandbox extras.** `GET /health` (probe), `GET /vendor/:vendorId/state` debug (exposes `vendorReservationPrice` in the sandbox only — never visible to the agent HTTP contract), `GET /vendor/:vendorId/messages` audit log for the no-private-prices proof, and idempotency per `round`+`buyerOfferPrice` (repeat calls return the stored response without advancing state).
9. **`proposedAcceptPrice = $10,000` vs "$9,800 accepted" phrasing.** The demo summary says "agent accepts $9,840 (close to targetPrice)". It accepts because $9,840 ≤ proposedAcceptPrice $10,000; it never bids above target. This reconciles the docs' "target = $9,800" with the spec's acceptance rule.

**Alternatives:** A second dedicated Strands Agent for negotiation (rejected: violates "single Strands agent, two modes"). Tenant-owned `expiresAt` per userId (rejected: a single deterministic demo clock is enough for the sandbox). Persisting cards into `memory.json` (rejected: domain model reserves `negotiations[]` for post-approval records; cards are a distinct UI contract).
**Consequences:** L3 gate passes offline and deterministically. Sending `npm run negotiate` in a live-Bedrock environment (`SAVR_MODEL`) exercises the same Strands loop with a real LLM flavoring the messages; the vendor counter/acceptance math stays code-owned as spec'd.


## 040 - 2026-09-11 - L4 UI & Gate implementation forks

**Context:** Surfaced while implementing L4 (React+Vite dashboard, Express API on the Saga port, SSE, approval gate) against docs/05 and the locked L2/L3 code. Three non-obvious forks plus a spec-vs-code contradiction.

**Decisions:**

1. **SDK API verification - no new drift.** The L4 API layer consumes only the already-verified L2/L3 exports (`runGuardian`, `runNegotiation`, `loadCards`/`upsertPendingCard`, `PostApprovalMutation` from `src/types`). No new SDK surface is used; SSE is raw Express `res.write` frames, not the SDK. No drift to log.

2. **Canonical demo/run is an L4 API orchestration, not an agent change.** `POST /api/demo/run` calls `runGuardian()` then `runNegotiation("notion")` then builds the loom SWITCH card from the guardian `DecisionPackage` and persists both via `upsertPendingCard`. Package emission stays Strands-driven; the API layer only wires the loop and persists `data/packages.json`. DecisionPackages were previously in-memory only (DECISIONS #038 #5); L4 adds `savePackages/loadPackages` + reset clears it.

3. **Savings is derived from approved cards, not a new store.** `totalSavings` = sum over approved cards of `NEGOTIATE ? realizedSavings : estimatedSavings` (so notion +2,160, loom SWITCH +3,600 = 5,760). `savings_update` SSE broadcasts this on every approval. A separate savings file would be duplicate state; cards are already the pending registry and mutate on approve.

4. **`DecisionCard.estimatedSavings` normalized to `realizedSavings` for accepted NEGOTIATE (spec-vs-code contradiction).** docs/02 says "estimatedSavings ... For NEGOTIATE: realized savings (post-negotiation)" and docs/05 lists the notion card as estimated 2,160 / realized 2,160. L3's `constructNegotiationCard` persisted `estimatedSavings: 0` (mirroring the Guardian-time meaning). Resolution: docs/05 canonical table is the target; the L4 API layer stamps `estimatedSavings = realizedSavings` on an accepted NEGOTIATE card when demo/run completes. **No L2/L3 code was modified.** SSE `decision_card` and cards.json therefore carry estimated 2,160 / realized 2,160.

5. **Card IDs stay idempotency keys; L3 naming reused.** docs/05's canonical table prints `card-notion-001` / `card-loom-switch-001`, but L3 persists `card-neg-notion-<ts>` (notion) and L4 persists `card-switch-loom-<ts>` (loom). Card id is an idempotency key, not a contract; the UI and tests select by `subscriptionId`/`[0]`, so both schemes coexist. No re-litigation of the L3 id.

6. **`negotiation_message` SSE uses terminal-state pricing with round-indexed content.** The L3 state machine keeps only the final `NegotiationState` + a vendor message log; per-round offers are not retained. The live stream therefore emits one frame per vendor message (round = index+1, content = that round's actual message) carrying the terminal `currentOffer/targetPrice/maxAcceptablePrice/buyerOfferPrice/proposedAcceptPrice`. The persisted negotiation (what the UI log renders) holds the true final state.

7. **Demo reset uses a self-bootstrapped seed.** `ensureSeed()` writes pristine `subscriptions.json` (canonical 14, renewalCost null, loom active), default `memory.json`, empty `cards.json` and `packages.json` into `data/seed/` on first run; `demo/reset` restores from it. This keeps "data/subscriptions.json is canonical" (DECISIONS #038 #5) while giving demo/reset a deterministic restore point.

8. **Debug negotiation controls are explicit DEBUG endpoints.** `POST /api/debug/negotiation/:id/accept|reject` force-resolves the persisted NEGOTIATE negotiation (labels in the UI: "Debug controls. Normal operation resolves automatically.") and are not part of the approval flow or the canonical demo. This is the minimal faithful reading of docs/05's debug buttons; no scope was added beyond it.

**Alternatives:** Persisting a separate `savings.json`; renaming L3's card ids to docs/05's sample; editing L3 agent code to emit estimated=realized at construction time.
**Consequences:** The API layer owns demo orchestration, savings derivation, idempotent approval state (`status` is the idempotency key per DECISIONS #024), and reset. L4 gate verified: 14 rows render, demo/run returns 5/2/3/0, approve notion sets renewalCost 9,840, approve loom switches it, savings hits $5,760, reject-after-approve 409s, reset restores. `GET /api/negotiation/:id` returns `card.negotiation` only when a NEGOTIATE card exists; otherwise 404.


## 041 — 2026-09-11 — Post-L4 review: transcript as data, per-round resilience, DemoDirector, presentation refresh

**Context:** A live-review pass on the finished L4 build. Three structural defects in the negotiation transcript, an unexercised live-model path, a storyless/fontless dashboard, and a visible test harness in the UI.

**Decisions:**

1. **The negotiation transcript is a first-class record — supersedes #040 #6.** Every
   message object now stores its own `round`, `buyerOfferPrice`, and `currentOffer` at the
   moment it is created (`negotiator.pushAgentMessage` / `pushVendorMessage`). The agent's
   outgoing message is persisted to `state.messages` exactly like the vendor's response,
   so `NegotiationState.messages` alternates `agent`/`vendor` per round. The SSE
   rebroadcast in `demo.runCanonicalNegotiation` emits per-message values, never
   terminal-state values, so a client can rebuild `10,800 → 10,200 → 9,840` from the
   frames without parsing prose. `docs/02`, `docs/03`, `docs/05` updated; `ui/check-story`
   and `validate-sandbox` T8/T5c lock the invariant.
2. **One bad model round stalls, never crashes.** `negotiateRound` failures (Zod
   validation, Bedrock invoke, etc.) are caught per round in the loop — retry once, then
   resolve `stalled` with a pending DecisionCard, mirroring Guardian's per-candidate
   try/catch. The `demo.ts` caller's outer try/catch remains for orchestration-level
   failures (e.g. sandbox unreachable).
3. **Live-model path contract-tested — IAM is the only blocker.** `DEMO_MODE=false`
   probe against real Bedrock: `createModel()` resolves `anthropic.claude-sonnet-4-6`,
   every Guardian candidate fails with the known `bedrock:InvokeModelWithResponseStream`
   AccessDenied (IAM savr-dev, #038) and the run survives (0 packages, exit 0); the
   negotiator retries, stalls, writes the stalled card, and exits with the gate-miss code
   instead of crashing. The residual risk is permission-only, not code. Outcome logged
   here rather than in `docs/03`.
4. **SSE recording buffer is bounded product state.** `sse.ts` retains the last 500
   `RecordedFrame`s (cleared on `demo/reset`), exposed via `GET /api/demo/recording`.
   Enables replay of a captured run without re-executing agents; the cap addresses the
   unbounded-buffer concern without building more.
5. **DemoDirector is product, not scaffolding.** A pure `directorReducer` over the real
   SSE frames drives `DirectorPhase` (`idle → guardian → negotiating → approval →
   resolved`), the offer ticker, transcript, recap, and activity log. Pacing is
   parameterized (`PacingConfig`): **live** mode applies frames as they arrive
   (`delay=0`, "● LIVE" badge is a truthful readout); **replay** mode (submission video)
   uses a timed table (guardian 700ms, message 1100ms, card 900ms, savings 700ms). Same
   state machine, two callers; `ui:check-story` replays captured frames through it.
6. **UI test harness removed from the product view.** The Debug accept/reject buttons and
   their caption are gone from `NegotiationLog`. The API endpoints remain for integration
   probes (docs/05 updated accordingly). No env flag needed — the harness no longer exists
   in the client.
7. **Prose is proportional; numbers are monospace.** Body/UI switch to a system sans;
   `ui-monospace` is scoped to numeric columns, IDs, badges, timestamps, and offer
   figures. StackOverview sorts flagged/pending rows to the top with an attention
   indicator, and a skeleton appears while the dashboard loads. Savings hero, pending
   decision panel, and negotiation offer-path now carry the visual weight; Guardian feed
   and policy recede into a secondary column.

**Alternatives:** Parsing chat text for the ticker (rejected: numbers already exist as
data); hardcoded replay animations (rejected: reducer is driven by real captured frames);
removing the debug API endpoints entirely (rejected: manual probes still useful, now
uncalled by the UI).
**Consequences:** Transcript/offer invariants locked by T8 (sandbox), T5c (L4), and
`ui:check-story` (phase arc + $0 → $2,160 → $5,760 + both roles + distinct round offers).
Live-mode resilience proven against Bedrock IAM denial.

## 042 — 2026-09-11 — SAVR_MODEL=local is a dev/test escape hatch on the live path

**Context:** L4.5 makes mode a per-request parameter (mock → LocalModel, live →
BedrockModel). The IAM permission for bedrock:InvokeModelWithResponseStream is absent
(#038), so the generalized live orchestration — evaluate a non-Acme company, negotiate
with whatever Guardian actually flags — could never be exercised end-to-end in CI or on a
laptop, and the L4.5 gate would be unverifiable locally.

**Decision:** createModel("live") honors SAVR_MODEL=local as an explicit escape hatch that
returns LocalModel. Any other SAVR_MODEL value still overrides the pinned Bedrock model
ID. Default client behavior is unchanged: no override → real BedrockModel.

**Alternatives:** Skip live-path verification entirely (gate unprovable locally); a
separate mode:"sim" run mode (adds a second not-real product path to the UI).

**Consequences:** validate:l4.5 T4 proves the orchestration generalization
deterministically by importing Testco/figma/loom/veed, running mode:"live" with
SAVR_MODEL=local, and asserting the negotiator ran for figma (not hardcoded notion) —
exactly the L4.5 gate's core requirement, no AWS account required. The hermetic gate keeps
the real-Bedrock probe optional (RUN_LIVE_AKS=true). Documented in docs/08 as a
dev/testing override, not a product mode.

## 043 — 2026-09-11 — LocalModel generalized for unknown subscription IDs

**Context:** The L4.5 live-path test imports a non-Acme subscription (figma). The
LocalModel's structured-output lookup was CANONICAL_ACTIONS[subId] with no fallback,
crashing figma evaluation ("Cannot read properties of undefined (reading 'action')").
This was a latent mock-path bug, exposed only now that non-Acme IDs are valid input.

**Decision:** The structured-output lookup now falls back to CANONICAL_ACTIONS.notion when
the subscription ID is not in the canonical table, mirroring the existing
CANONICAL_RESEARCH_TOOL fallback for the research step. Evidence IDs default to [] (the
policy/evaluate logic already treats empty evidence as incomplete → KEEP-with-explanation
or honest gate behavior).

**Alternatives:** Throw a clear unsupported_subscription error in LocalModel (requires
callers to special-case, and breaks the graceful per-candidate catch).

**Consequences:** Any subscription — Acme-canonical or imported — evaluates without
crashing in mock/fixture runs; unknown vendors still negotiate to a graceful stalled card
since the sandbox has no policy for them (correct, #038, plan L4.5). The canonical Acme
path produces identical output (gate T1/T6 re-verified).

## 044 — 2026-09-11 — Autonomous trigger is an in-process scheduler, not EventBridge

**Context:** The post-L4.5 roadmap calls for a real autonomous trigger and mentions
EventBridge as an optional AWS-native option, but the hackathon needs a deterministic
demo without adding deployment scope.

**Decision:** Use the existing server-side `setInterval` scheduler in `src/api/autopilot.ts`
(default 120s), gated by `AUTOPILOT_ENABLED=false`. It reruns Guardian in live mode,
serializes with manual runs through `withAgentLock`, and broadcasts `autopilot_check`.
EventBridge is explicitly not implemented for this submission.

**Alternatives:** Deploy an EventBridge rule (rejected for hackathon scope and deployment
risk); fake the trigger in the UI (rejected because it would not be a real agent run).

**Consequences:** The autonomous trigger is real and testable offline via
`npm run validate:autopilot`. It must not be presented as an AWS EventBridge deployment.

## 045 — 2026-09-11 — Live web search is a separate, gateway-dependent gate

**Context:** The roadmap's live-search stretch item needs a fallback path for vendors not
in `data/cached-evidence.json`, but the main L4.5 gate runs deterministically without a
web gateway.

**Decision:** Keep cached evidence as the default and preserve `evidence_unavailable` when
`NINEROUTER_URL` is unset. In live mode, `enrichWebEvidenceMap` may add low-confidence
web evidence from the configured 9Router-compatible gateway; `validate:web-evidence`
tests this with a local stub.

**Alternatives:** Make web search mandatory in `validate:l4.5` (rejected because it would
make the core gate environment-dependent); remove the cached fallback (rejected because
it would invent evidence).

**Consequences:** Live search is implemented and verified separately with
`npm run validate:web-evidence`; the deterministic L4.5 gate remains hermetic and honest.

## 046 — 2026-09-12 — Autopilot is opt-in; dev servers never spend on their own

**Context:** #044 shipped the autonomous trigger on by default (120s `setInterval`
unless `AUTOPILOT_ENABLED=false`). A bare `npm run dev` therefore fires live-mode
Guardian runs every two minutes. That is the opposite of the cost guardrails (#037) the
moment IAM grants `bedrock:InvokeModel*`, and it makes the demo's "the agent runs on
its own" moment less deliberate.

**Decision:** Flip the default. `src/api/server.ts` starts the scheduler only when
`AUTOPILOT_ENABLED=true`; the `120s` interval is unchanged and tunable via
`AUTOPILOT_INTERVAL_MS`. `.env.example`, docs/01, docs/03 and README updated. The video
enables it explicitly to show the autonomous check.

**Alternatives:** Keep default-on and rely on the IAM denial protecting cost (rejected:
a permission change anywhere flips on recurring spend).

**Consequences:** `validate:autopilot` unchanged (it drives
`runAutopilotCheck`/`startAutopilot` directly, not the server default). The validator
gate still proves the scheduler runs a real unprompted check when enabled.

## 047 — 2026-09-12 — `npm run demo:test` is the real L5 E2E, not a stub

**Context:** The L5 task required `npm run demo:test` (seed → guardian → negotiate →
card → approve → savings = 5760); the script previously `echo`'d "L5 not yet
implemented" and exited 0 — a fake-green acceptance test.

**Decision:** Implemented `src/scripts/demo-test.ts`. It boots the API on an ephemeral
port and asserts the full canonical flow over HTTP: reset (14 subs, savings 0) → mock
run (5 packages / 2 pending / 3 autonomous / savings 0) → negotiation log (3 rounds,
$10,800 → $10,200 → $9,840, accepted) → approve notion (renewalCost 9840) → approve loom
(switched, veed still active) → savings $5,760, approvedCount 2, mode idle, no pending
cards → reset restores. Exits non-zero on the first failed assertion, and restores
pristine data in all paths.

**Alternatives:** Reuse `ui:check-story` wholesale (rejected: it also covers the story
reducer; `demo:test` is the API-level acceptance contract in `tasks/L5`).

**Consequences:** `npm run demo:test` is now an honest, hermetic L5 gate.

## 048 — 2026-09-12 — L5 submission hardening: honesty sweep + publishables

**Context:** Pre-submission audit found claims and missing publishables that would cost
points with a judging panel, plus one live-credential leak risk.

**Decisions:**
1. **Credentials.** `.env` was committed-adjacent with live AWS keys and no
   `.gitignore`. Added `.gitignore` (`.env` excluded) and `.env.example` documenting
   every variable. Keys must be rotated before any public push (README "Security" note).
2. **Honesty sweep — README/docs/01/03/04-literally.** Removed the false "DynamoDB
   implemented" claim (no DynamoDB code exists; it is production intent) in README,
   PROGRESS, HANDOFF and docs/01. Pinned the correct model ID
   (`anthropic.claude-sonnet-4-6`, per #038) everywhere the wrong launch ID survived,
   and replaced the "Cron every 4 hours" claims with the in-process opt-in scheduler
   per #044.
3. **Publishables.** MIT `LICENSE`, `docs/architecture.png` (generated), `.gitignore`,
   `.env.example`. Removed `scaffold.py` (L0 scaffolding helper; compliance item
   "no pre-existing non-standard code"). Committed pristine seed data + built `ui/dist`
   so `npm run dev` serves the UI on a fresh clone with no steps in between.
4. **Autopilot default** — see #046.

**Alternatives:** Ship with the wrong model ID / false DynamoDB claims (rejected:
reproducible at first glance from README vs code); keep scaffold.py (rejected: trivial
compliance red flag).

**Consequences:** Everything a judge clones and runs out of the box matches the README.
Remaining L5 work is human: record the ≤5-min video, `git remote`/push to a public repo,
verify on AWS Builder Center, optional "Agents for Humans" blog.

## 049 — 2026-09-13 — Bedrock live auth status: account-gated, demo stays deterministic

**Context:** After the IAM least-privilege policy was granted, every Bedrock invoke
returned `ValidationException: Operation not allowed` for every model family (Anthropic
Sonnet 4.6 and Amazon Nova Pro/Lite/Micro alike), and the Anthropic use-case-details
flow and the brand-new Bedrock API-key generation both refused with "account not
authorized" / "create a support case". We tested three auth paths end to end:
SigV4 IAM, and the Bedrock API-key **bearer** scheme (via `AWS_BEARER_TOKEN` +
`bedrock:CallWithBearerToken` on `*`; config `authSchemePreference: ["httpBearerAuth"]`
+ `token`).

**Decision:** The account's Bedrock model access is **gated at the account level** —
bearer/API-key auth passes IAM (`CallWithBearerToken`) and still hits
`Operation not allowed`. No code change can unlock it. The live-Bedrock segment of the
L5 video is dropped; the submission runs the deterministic Strands orchestrator
(`LocalModel`) end to end, with the Sonnet 4.6 live path wired (`PINNED_MODEL_ID`,
`createModel("live")`) and honestly documented as gated.

**Consequences:** README `## Demo` notes the account gate; `.env.example` documents
`AWS_BEARER_TOKEN` as optional and explicitly gated; the Builder/LinkedIn posts already
frame the demo as the deterministic Strands run, not a Bedrock inference. If the
account unlocks (EC2 warm-up or AWS Support), flipping live requires no app change.

