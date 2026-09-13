---
id: synthetic-data
level: L1
depends_on: [domain-model]
provides: synthetic-data
used_by: [L1, L2]
status: active
---

# 06 — Synthetic Data

## Demo Clock

All relative dates resolve against the fixed demo date: **2026-09-10T12:00:00-07:00**.

When `DEMO_MODE=true`, `getDemoDate()` returns this fixed date. "+14 days" for Notion means `2026-09-10 + 14 = 2026-09-24`.

## Company Header

| Field | Value |
|-------|-------|
| Name | Acme Corp |
| Employees | 18 |
| Annual Budget | $60,000 |

## Canonical Totals (for validation)

| Metric | Value | How to Verify |
|--------|-------|---------------|
| Total subscriptions | 14 | `subscriptions.length === 14` |
| Total annual spend | $47,400 | `sum(annualCost) === 47400` |
| Seat-based subscriptions | 12 | `billingModel === "seat_based"` |
| Usage-based subscriptions | 2 | `billingModel === "usage_based"` |
| Subscriptions renewing ≤30 days | 4 | `renewalDate - demoDate <= 30 days` |
| Unused seats (total) | 32 | `sum(seatsPurchased - seatsActive)` for seat-based |
| Overlapping pairs | 1 | Loom + Veed both in "Video" |
| Price increases | 1 | notion-ai: priceIncreasePct = 17 |

## Subscription Data

All dates are absolute ISO 8601. Demo date: 2026-09-10. All annual costs are integer USD dollars and satisfy `annualCost = pricePerSeat * seatsPurchased` for seat-based rows.

| id | vendorName | category | billing | annualCost | perSeat | seatsP/A | renewalDate | inc% | notes |
|----|-----------|----------|---------|-----------|---------|----------|-------------|------|-------|
| notion | Notion | Productivity | seat/ann | 12000 | 600 | 20/14 | 2026-09-24 | null | Primary NEGOTIATE target |
| slack | Slack | Communication | seat/ann | 5400 | 300 | 18/18 | 2026-10-25 | null | Fully used. KEEP. |
| figma | Figma | Design | seat/ann | 4200 | 420 | 10/9 | 2026-11-09 | null | 1 unused (90% used, above threshold — not triggered). |
| loom | Loom | Video | seat/ann | 3600 | 300 | 12/8 | 2026-10-10 | null | Overlaps Veed. SWITCH candidate. |
| veed | Veed | Video | seat/ann | 2400 | 240 | 10/7 | 2026-12-09 | null | Overlaps Loom. Consolidation target. |
| github | GitHub | Dev Tools | seat/ann | 2700 | 150 | 18/17 | 2027-01-08 | null | Near full use. KEEP. |
| linear | Linear | PM | seat/ann | 2100 | 140 | 15/13 | 2026-10-25 | null | 2 unused (87% used, above threshold — not triggered). |
| posthog | PostHog | Analytics | seat/ann | 2400 | 240 | 10/10 | 2026-10-10 | null | Renewal soon. Benchmark pricing. |
| calendly | Calendly | Scheduling | seat/ann | 900 | 180 | 5/4 | 2027-03-09 | null | 1 unused (80% used, above threshold). Low priority. |
| notion-ai | Notion AI | Add-on | seat/ann | 2400 | 200 | 12/5 | 2026-09-24 | 17 | Tied to Notion. 17% increase. |
| zoom | Zoom | Communication | seat/ann | 1800 | 100 | 18/13 | 2026-12-09 | null | Partial use (72% used, above threshold — not triggered). |
| miro | Miro | Whiteboard | seat/ann | 600 | 120 | 5/3 | 2027-01-08 | null | 2 unused (60% used, above threshold — not triggered). |
| vercel | Vercel | Hosting | usage/ann | 3600 | — | —/— | 2026-11-09 | null | Usage-based. Monitor. |
| aws | AWS | Cloud | usage/mo | 3300 | — | —/— | 2026-10-20 | null | Monthly. renewalDate drives the next payment. |

## Verification: Totals

**Annual cost by row:**
12000 + 5400 + 4200 + 3600 + 2400 + 2700 + 2100 + 2400 + 900 + 2400 + 1800 + 600 + 3600 + 3300

**Seat-based subtotal:** 12,000 + 5,400 + 4,200 + 3,600 + 2,400 + 2,700 + 2,100 + 2,400 + 900 + 2,400 + 1,800 + 600 = **$40,500**
**Usage-based subtotal:** 3,600 + 3,300 = **$6,900**
**Grand total:** $40,500 + $6,900 = **$47,400** ✓

## Verification: Unused Seats

| id | seatsP | seatsA | unused |
|----|--------|--------|--------|
| notion | 20 | 14 | 6 |
| slack | 18 | 18 | 0 |
| figma | 10 | 9 | 1 |
| loom | 12 | 8 | 4 |
| veed | 10 | 7 | 3 |
| github | 18 | 17 | 1 |
| linear | 15 | 13 | 2 |
| posthog | 10 | 10 | 0 |
| calendly | 5 | 4 | 1 |
| notion-ai | 12 | 5 | 7 |
| zoom | 18 | 13 | 5 |
| miro | 5 | 3 | 2 |
| **Total** | | | **32** ✓ |

Every seat-based row: `annualCost === pricePerSeat * seatsPurchased` (e.g. notion 600 × 20 = 12,000 ✓).

## Verification: Renewals ≤30 Days

From 2026-09-10:
- notion: 2026-09-24 (+14d) ✓
- notion-ai: 2026-09-24 (+14d) ✓
- loom: 2026-10-10 (+30d) ✓
- posthog: 2026-10-10 (+30d) ✓

**Exactly 4 renewals ≤30 days.** aws (+40d) and slack/linear (+45d) are outside the window.

**Policy: `renewalWindowDays: 30`.**

## Canonical Candidate Set

Given the triggers (renewal ≤30d, <50% seat utilization, category overlap, price increase, over-budget):

| id | Triggers | Expected Agent Action | Approval |
|----|----------|----------------------|----------|
| notion | renewal_soon | NEGOTIATE | requires_approval |
| loom | renewal_soon, category_overlap (veed) | SWITCH (drop loom, consolidate to veed) | requires_approval |
| veed | category_overlap (loom) | KEEP (consolidation target) | autonomous |
| notion-ai | renewal_soon, price_increase (17%), unused_seats | DOWNGRADE (12→5 seats) | autonomous |
| posthog | renewal_soon | KEEP (fully used, price is market-rate) | autonomous |
| others | none | not evaluated | — |

This produces **5 DecisionPackages, 2 pending DecisionCards, 3 autonomous actions** — the canonical demo state.

**Note:** `budget_anomaly` (annualCost > `maxSingleVendorSpend` = $15,000) never fires in this data — every `annualCost` is below the per-vendor cap. This is intentional; it keeps the demo to exactly the 5 candidates above.

**Note on `category_overlap`:** the trigger fires only when at least one member of an active same-category pair already has a base trigger (see `docs/01-architecture.md`). Loom (renewal_soon) and Veed (overlap) qualify; Slack and Zoom share "Communication" but neither is base-triggered, so they do not appear as candidates.

## Cached Evidence

`data/cached-evidence.json` — research evidence from real searches, used in DEMO_MODE.

**Schema:**
```json
{
  "category#vendor": [Evidence, ...]
}
```

Keys: `"Productivity#notion"`, `"Video#loom"`, `"Analytics#posthog"`.

Each entry is an `Evidence` object from `docs/02-domain-model.md`, with `retrievedAt` + 7 day `freshUntil`. Must include:
- ≥2 benchmark pricing entries for "Productivity"
- ≥2 alternatives for "Video"
- ≥1 alternative for "Productivity"

## Synthetic vs Live Evidence

- **Internal (synthetic):** Subscription costs, seats, dates, policy. Loaded from JSON. The company's view.
- **External (research):** Market pricing, alternatives. Via tools or cache. The market view.

When external conflicts with internal on pricing benchmarks, external wins. Internal data is never generated by external search; external data never edits `subscriptions.json`.

## Done-When Checklist

- 14 subscriptions in `data/subscriptions.json`.
- `sum(annualCost) === 47400`.
- Unused seats === 32.
- Exactly 4 subscriptions renew within 30 days of 2026-09-10.
- Loom and Veed share `category: "Video"`.
- `notion-ai.priceIncreasePct === 17`.
- Vercel and AWS are `usage_based` with null seat fields.
- Every seat-based row: `annualCost === pricePerSeat * seatsPurchased`.
- Monthly row (aws): `annualCost === currentPeriodCost * 12` → currentPeriodCost = 275.
- Annual rows: `annualCost === currentPeriodCost`.
- `data/policy.json`: `renewalWindowDays: 30`.
- All dates absolute ISO 8601.
- `validate-data.ts` exits 0.