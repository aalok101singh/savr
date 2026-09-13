---
id: product-flow
level: L4.5
depends_on: [vision, architecture, domain-model, agent-spec, ui-spec]
provides: product-flow
used_by: [L4.5]
status: active
---

# 08 — Product Flow

## Two Modes, One Server

Savr 2.0 runs in exactly one of two modes per request, chosen by the caller, never by a
process-wide setting:

- **Mock** — the existing Acme walkthrough. Always resets from `data/seed/` first, always
  uses `LocalModel`, always produces the canonical $5,760 outcome. This is the "show me
  everything in one go" button and is unchanged from the current build except for how its
  model is selected (see Architecture Amendment below).
- **Live** — the real product. Runs against whatever company and stack the user entered
  or imported this session, always uses `BedrockModel`. No canonical numbers, no
  guaranteed outcome — Guardian's real recommendation, on real data, is whatever it is.

Both modes exist in the same running server. A judge (or a real user) can run the Mock
walkthrough, then separately go through the real onboarding flow with different numbers,
in the same session, without restarting anything. That contrast — canned demo vs. live
run producing different, reasoned numbers — is the actual proof this isn't a static page.

## Screens

1. **Landing** — two entry points, presented as equals, neither hidden behind the other:
   "Try the Mock Demo" (Acme, instant) and "Set Up Your Company" (real flow, below).
2. **Company** — name, employee count, annual SaaS budget. Maps directly to the existing
   `Company` shape (`data/company.json` today — promote to a named type, see Domain Model
   Amendment). No new fields invented beyond what Guardian's policy checks already use.
3. **Stack** — two ways in, both hitting the *existing* `POST /api/stack/import`
   endpoint, which already validates required fields and billing model:
   - Manual: add a row per tool (vendor name, category, annual cost, seats, renewal
     date) — a form, not a spreadsheet import, since this is the fallback for someone
     with 3–5 tools who doesn't have a JSON file handy.
   - Import: paste or upload JSON matching the `Subscription[]` shape. This is the
     primary path for the video and for anyone testing "does this actually work" —
     it's near-zero new backend work since the endpoint already exists and already
     rejects malformed input with a clear error.
4. **Reviewing** — Guardian runs, live. This is the screen that answers "how do I know
   something changed and why" — see Progress Events below. Ends by landing on the
   existing dashboard, unmodified, now populated with the user's real data and Guardian's
   real recommendations.
5. **Dashboard** — the existing L4 UI. No changes required here beyond what fix #2 in
   `savr-2.0-plan.md` already requires (negotiation must trigger off whatever Guardian
   actually flagged, not a hardcoded subscription ID).

## Progress Events (new)

`runGuardian` currently evaluates every candidate internally and returns once; nothing is
observable while it runs. Add an optional callback parameter:

```
runGuardian(options?: { onProgress?: (event: GuardianProgressEvent) => void })
```

Called twice per candidate — once when evaluation of that subscription starts, once when
it finishes with its action and confidence. `guardian.ts` stays decoupled from SSE (it
takes a plain callback, same pattern already used elsewhere in this codebase); `demo.ts`
is the only place that wires the callback to `broadcastSse("guardian_progress", ...)`.
This is the only change needed to make the Reviewing screen show real, truthful,
per-tool progress instead of an invented animation — the data was always being computed,
it just wasn't being reported as it happened.

## Session Model — explicitly not multi-tenant

One active company's data lives in the same JSON files Guardian already reads
(`data/company.json`, `data/subscriptions.json`), for the current server session. Live
mode's "Set Up Your Company" flow overwrites these; there is no per-user isolation, no
login, and no stored history of past companies. `POST /api/stack/import` already
overwrites the working subscription set — the only new requirement is that **the Mock
entry point must always call `demo/reset` (restoring from `data/seed/`) before
`demo/run`**, so a Live session's data can never leak into a Mock walkthrough. This is one
guard, not a database.

## What this explicitly does not add

No user accounts. No persisted list of companies across sessions. No real vendor billing
API integrations — "data fetching" means Guardian's existing research tools
(`benchmark_pricing`, `search_alternatives`) running against cached evidence today, live
web search only if time remains per the existing "stretch" note in `docs/00`. If a
real vendor isn't in `data/cached-evidence.json`, the existing `evidence_unavailable`
path already handles that (per `docs/03-agent-spec.md`) — Guardian recommends KEEP and
says what's missing, honestly, rather than inventing a number. That behavior is correct
and needs no change for Live mode; it's the reason Live mode is trustworthy for
subscriptions Savr has no benchmark data for.
