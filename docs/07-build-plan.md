---
id: build-plan
level: L0
depends_on: [vision, architecture]
provides: build-plan
used_by: [L0, L5]
status: active
---

# 07 — Build Plan

## Deadline

**2026-09-14, 17:00 PDT (2026-09-15 00:00 UTC).** No extensions. Ship what works.

## Highest-Risk Technical Path

The riskiest item: Strands + Bedrock + one tool + structured output + policy hook + sandbox round trip working end-to-end. Prove this on Day 1.

```
Strands Agent → Bedrock (Claude Sonnet 4.6) → one tool call → Zod-validated output → policy hook → sandbox round trip
```

If any piece fails, simplify the Strands integration (fewer features, simpler tools) but **never remove Strands** — it is a hackathon requirement.

## Stack (pinned)

| Component | Version/Choice |
|-----------|---------------|
| Node.js | 22+ |
| Strands SDK | `@strands-agents/sdk@1.14.0` |
| TypeScript | 5.x |
| Model | Amazon Bedrock, `anthropic.claude-sonnet-4-6` (override via `SAVR_MODEL`; deterministic `LocalModel` under `DEMO_MODE=true` — see DECISIONS #038) |
| Region | `us-east-1` |
| UI | React + Vite |
| API | Express |
| Persistence | DynamoDB (local JSON fallback) |
| Events | SSE |

## Level Gates

| Level | Gate | Command |
|-------|------|---------|
| L0 | Docs consistent, no contradictions. | Manual review + grep. |
| L1 | Types compile. Data validates. Totals pass. | `tsc --noEmit`, `npm run validate:data`. |
| L2 | Guardian outputs DecisionPackage[]. Policy blocks blacklist. | `npm run guardian`. |
| L3 | Sandbox runs 3-round negotiation. DecisionCard pending. | `npm run negotiate`. |
| L4 | Dashboard, card, approve→resume, savings. | `npm run dev`. |
| L5 | Public repo, video, README. Blog optional. | GitHub, YouTube, Builder Center. |

## Day-by-Day

### Day 1 — Prove the Risk + Foundation (L0, L1, POC)

- Lock docs (L0).
- Initialize project. One-time AWS account setup (budget alert, least-privilege IAM, Bedrock model access — see "AWS Cost Guardrails"). Install `@strands-agents/sdk@1.14.0`. Configure Bedrock.
- Prove: Strands → Bedrock → one tool → structured output → hook.
- Implement types (L1). Create dataset (L1). Validate.
- Sandbox skeleton: canned response for round 1.

### Day 2 — Agent Core + Sandbox (L2, L3)

- 6 tools. Guardian loop. Policy hook.
- Adversarial sandbox. Negotiator loop. Wiring.
- `npm run guardian` + `npm run negotiate`.

### Day 3 — UI + Integration (L4)

- React project. Stack overview. Guardian feed.
- SSE. DecisionCard. Approve/Reject. Negotiation log. Savings.
- `npm run dev` end-to-end.

### Day 4 — Polish + Submit (L5)

- Diagram. README. Video (≤5 min). Push repo.
- Blog post (optional bonus).
- Verify Builder Center compliance.

## Kill Switches

| If this fails... | Do this... | Strands preserved? |
|------------------|-----------|---------------------|
| Strands tool-calling | Use a single tool with simpler schema | Yes |
| Bedrock model | Try another Bedrock Claude model | Yes |
| Live web search | Use `data/cached-evidence.json` | Yes |
| DynamoDB | Local JSON in `data/memory.json` | Yes |
| AgentCore | Omit it (stretch only) | Yes |
| Full Guardian (14 subs) | Demo canonical path (Notion + Loom/Veed) | Yes |
| SSE | Poll every 2s | Yes |

**Strands is never removed.** Every fallback preserves the Strands Agent as the orchestrator.

## AWS Cost Guardrails (read before wiring Bedrock)

Bedrock inference is the **only real AWS cost** in this repo. Everything else is local (Express sandbox on 3001, React/Vite on 3000, cron) or near-free (DynamoDB at this data scale).

1. **`DEMO_MODE=true` is the default for dev and the demo.** It forces `benchmark_pricing`/`search_alternatives` to `data/cached-evidence.json` and keeps per-run model calls low (one candidate set + ≤3 canonical negotiation rounds ≈ 8–10 calls).
2. **Local memory fallback first.** Use `data/memory.json` during dev so DynamoDB is optional. DynamoDB only needs to actually work at the L3/L4 gates.
3. **Least-privilege IAM (one-time, manual).** Allow only `bedrock:InvokeModel*` on the Sonnet 4.6 foundation-model ARN and `dynamodb:GetItem/PutItem/Query/UpdateItem` on the single `savr-procurement-memory` table. Nothing else.
4. **Budget alert (one-time, manual).** Create an AWS Budget (~$5) with email alerts before the first Bedrock call. Free and immediate protection.
5. **Model override for dev loops.** `SAVR_MODEL` env may point at a cheaper Bedrock profile while iterating. The demo pins `anthropic.claude-sonnet-4-6`; `DEMO_MODE` has no structural dependency on the cheaper model. When `DEMO_MODE=true` and no `SAVR_MODEL` is set, the Strands agent runs on the deterministic `LocalModel` so demo runs are reproducible and cost nothing (see DECISIONS #038).
6. **No always-on cron during the hackathon.** The "every 4 hours" scheduler in `docs/03-agent-spec.md` is a production note, not a demo requirement. All runs are manually triggered (`npm run guardian`, `/api/demo/run`), so spend stays under your control.

## Deterministic vs Agentic

| Component | Owner |
|-----------|-------|
| Policy, savings, caps, transitions, executeAction | Code |
| Tool selection, research, recommendation, negotiation, risk | LLM |

## In Scope

- Intake → research the candidate set (the Guardian evaluates the entire stack via the 5 triggers); cached evidence in demo, live search as a stretch.
- Recommendation with rationale and evidence.
- Negotiation against sandbox vendor.
- Guardian loop on synthetic data.
- Human confirmation gate.

## Out of Scope

- Multi-tenant polish
- Arbitrary category generalization
- Real outbound vendor contact
- Contract signing
- User accounts
- AgentCore (stretch only)
- "Full procurement platform"

## The One Rule

Ship the scoped version fully working by **2026-09-14T17:00:00-07:00**. Strands is the orchestrator — never removed, only simplified.