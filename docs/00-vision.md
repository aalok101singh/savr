---
id: vision
level: L0
depends_on: []
provides: vision
used_by: [L0, L5]
status: active
---

# 00 — Vision

## One-Liner

**Savr is an autonomous procurement employee for companies without a procurement team.**

## ICP

A solo founder or ops lead at a 5–20 person startup managing 15+ SaaS renewals in a spreadsheet, with no time or leverage to negotiate any of them.

## The Pain

- A 5–20 person startup spends **$40k–$60k/year on SaaS** across 15–30 tools.
- Nobody owns procurement. The founder is the ops lead is the procurement team.
- Renewals happen when someone remembers them. Prices creep up silently.
- Seats go unused. Nobody has time to research alternatives or negotiate.

## The Promise

> It watches your software stack, decides what needs attention, acts within your policies, negotiates when it can, and only asks you when a real decision is yours to make.

## The Philosophy

**Humans define the rules. Agents run the work.**

## What Savr Actually Is

Savr is a **continuous SaaS-stack management agent**. It is not a renewal reminder, not a negotiation chatbot, and not a one-shot wizard. It runs in the background, observes the full stack, reasons about what matters, and acts within policy.

The product has two operational modes:

- **Guardian** — the monitoring and decision loop. Continuously observes subscriptions, benchmarks pricing, finds alternatives, detects overlaps, and recommends actions.
- **Negotiator** — one action capability that Guardian invokes when a recommendation is NEGOTIATE. It engages vendors in structured rounds.

Negotiation is a feature of Savr, not the entirety of Savr. The primary value is continuous stack management. Negotiation is one of several actions the agent can take.

## Competitive Positioning

Vertice launched "Ana" (2026-09-08) for enterprise procurement. CloudEagle launched Renewal Agents (2026-08). Vendr is part of Vertice.

Savr's positioning:

> Vertice built an AI negotiation agent for enterprise procurement teams. Savr is for the companies that don't have a procurement team.

## What Is Genuinely Original

1. **Continuous autonomous management** — not a one-shot wizard. Runs in the background, always.
2. **Organizational procurement memory** — remembers past negotiations, policies, and preferences across sessions.
3. **Policy-aware action** — the agent never violates a rule the human set. Policy is deterministic and authoritative.
4. **Human decision boundaries** — the human is the policy maker, not the operator. The agent recommends; code enforces; human decides what requires authority.
5. **Built for the no-procurement-team segment** — not enterprise. Not "procurement for everyone." For the 5–20 person startup specifically.

## Demo Story

**Acme** — 18-person startup. 14 SaaS products. $47,400/year spend. 4 renewals in 30 days. 32 unused seats. 2 overlapping products. One 17% price increase incoming.

Press **Enable Autopilot**. The agent runs. It flags a Notion renewal and negotiates from $12,000 → $9,840. It detects that Loom ($3,600) and Veed ($2,400) overlap and recommends consolidating to Veed. Two decision cards surface. The human approves both. Savings counter updates: **$5,760/year**.

Separately: a user can set up their own company and stack, and watch Guardian reason
over it live, with a real Bedrock call and a real (possibly different, possibly zero)
recommendation. The Acme walkthrough proves the feature set; the live flow proves it
isn't scripted.

## Out of Scope

- Persistent user accounts / login
- Multiple companies stored and retrievable across sessions
- Real third-party vendor billing/API integrations (a live connection to Notion's,
  Slack's, etc. actual billing systems)
- Real outbound vendor contact
- Contract signing
- AgentCore (stretch only)
- "Full procurement platform"

In scope as of v2 (see `docs/08-product-flow.md`): a single-session onboarding flow
(one company, entered or imported for the current session only) so Guardian's reasoning
is demonstrably driven by real input data, not hardcoded to the Acme fixture. This does
not require accounts or multi-company persistence — see `docs/08` for the exact
boundary.

## Hackathon Success Metric

A judge watches a 3-minute demo and says: "That would save me real money."
