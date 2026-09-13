---
id: vendor-sandbox
level: L3
depends_on: [agent-spec]
provides: vendor-sandbox
used_by: [L3]
status: active
---

# 04 — Vendor Sandbox

## Why

> "The negotiation uses the same agent-to-vendor interface we'd use in production. For the demo, the vendor is a sandbox because real enterprise sales cycles take days or weeks."

## Separation of Policies

**Buyer Policy (Savr's):** In `data/policy.json`. Determines what Savr may accept/send. Enforced by `check_policy` and Strands hooks.

**Vendor Policy (sandbox's):** In `src/sandbox/vendor-policies.ts`. Determines how the simulated vendor responds. Agent never sees this. Independent of buyer policy.

## API

### POST /vendor/:vendorId/message

**Request:**

```json
{
  "message": "We'd like to discuss pricing for your annual renewal.",
  "round": 1,
  "buyerCurrentPrice": 12000,
  "buyerOfferPrice": 10200
}
```

- `message` — natural-language message from agent
- `round` — current round number (1-indexed)
- `buyerCurrentPrice` — what the buyer currently pays (public info)
- `buyerOfferPrice` — the specific price the agent is proposing (structured, not guessed from prose)

**Response (success):**

```json
{
  "status": "success",
  "response": "Thank you for reaching out. We can offer a 10% discount for annual billing.",
  "offer": {
    "pricePerSeat": 540,
    "totalAnnual": 10800,
    "seatsIncluded": 20,
    "terms": "Annual billing",
    "expiresAt": "2026-09-24T00:00:00Z"
  },
  "vendorId": "notion",
  "round": 1
}
```

**Response (vendor rejects — offer below floor):**

```json
{
  "status": "success",
  "response": "We're unable to go that low. Our best offer is $9,840 with a 2-year commitment.",
  "offer": {
    "pricePerSeat": 492,
    "totalAnnual": 9840,
    "seatsIncluded": 20,
    "terms": "2-year commitment, annual billing",
    "expiresAt": "2026-09-24T00:00:00Z"
  },
  "vendorId": "notion",
  "round": 3
}
```

### GET /vendor/:vendorId/state

**Response:**

```json
{
  "vendorId": "notion",
  "buyerCurrentPrice": 12000,
  "vendorReservationPrice": 8400,
  "roundsCompleted": 1,
  "currentOffer": { "totalAnnual": 10800, "terms": "Annual billing" },
  "status": "negotiating"
}
```

Note: `vendorReservationPrice` is in the state endpoint for debugging only. The agent never queries this endpoint.

## Vendor Decision Logic

The vendor's response is **purely determined by the round number**. The agent's `buyerOfferPrice` is noted but does not influence the vendor's counter-offer. This makes the sandbox deterministic and reproducible.

**Vendor counter-offer schedule:**

| Round | Discount | Counter-offer (from $12,000) | Terms |
|-------|----------|------------------------------|-------|
| 1 | 10% | $10,800 | Annual billing |
| 2 | 15% | $10,200 | 2-year commitment, annual billing |
| 3 | 18% | $9,840 | 2-year commitment, annual billing |
| 4 | 20% | $9,600 | 2-year commitment, annual billing |
| 5 | 22% | $9,360 | 2-year commitment, annual billing |

**Vendor acceptance rule:** The vendor accepts the agent's `buyerOfferPrice` if it is **at or above** the vendor's counter-offer for that round. Otherwise, the vendor counters with their scheduled offer.

**Vendor floor:** The vendor will not offer below `reservationPrice` ($8,400 for Notion). If the round schedule would produce a price below `reservationPrice`, the vendor offers `reservationPrice` instead.

**Vendor behavior specifics:**
- If `buyerOfferPrice >= counterOffer`: vendor accepts the agent's price (agent got a better deal).
- If `buyerOfferPrice < counterOffer`: vendor counters with the scheduled offer.
- If `buyerOfferPrice < reservationPrice`: vendor rejects with "unable to go that low."
- At round 5: vendor makes a final offer. If agent does not accept, status becomes `max_rounds`.

## Canonical Demo Exchange (3 Rounds)

The agent always proposes `buyerOfferPrice = 9800`.

**Round 1:**
- Agent: `"We'd like to discuss pricing for your annual renewal."` buyerOfferPrice: 9800
- Vendor: counter = $10,800 (10% off). Agent's $9,800 < $10,800 → vendor counters at $10,800.
- Vendor response: `"We can offer $10,800 with annual billing."`

**Round 2:**
- Agent: `"We appreciate that. We're targeting a lower price. Can you improve?"` buyerOfferPrice: 9800
- Vendor: counter = $10,200 (15% off). Agent's $9,800 < $10,200 → vendor counters at $10,200.
- Vendor response: `"We can do $10,200 with a 2-year commitment."`

**Round 3:**
- Agent: `"We'll accept a better offer with annual billing."` buyerOfferPrice: 9800
- Vendor: counter = $9,840 (18% off). Agent's $9,800 < $9,840 → vendor counters at $9,840.
- Vendor response: `"We can offer $9,840 with a 2-year commitment and priority support."`

**Agent accepts $9,840** (it is within `proposedAcceptPrice` and close to `targetPrice`).

Resolution: `accepted`. Final offer: $9,840. Realized savings: $12,000 - $9,840 = **$2,160**.

## Adversarial Behaviors

1. **Rejects below floor** — `buyerOfferPrice < reservationPrice` → explicit rejection.
2. **Improves after credible evidence** — Only when `message` explicitly contains the token `competitor` followed by a numeric price (e.g. `"competitor: Coda $8400"`). In that case the vendor improves the round counter by 2 percentage points of discount. The canonical demo messages never contain this token, so the canonical outcome stays deterministic.
3. **Stalls on repeated requests** — If agent sends the same `buyerOfferPrice` 4+ times consecutively, vendor's response becomes "We've made our best offer." Throttled to the 4th identical booking on purpose: the canonical demo proposes the same $9,800 in each of its 3 rounds (see "Canonical Demo" above), so a 3-repeat stall would contradict the locked 3-round outcome. Round 4 with the same offer trips the stall.
4. **Final offer at round 5** — No further improvement. Agent must accept or walk.

## Implementation Notes

- State is **server-authoritative**. Client cannot manipulate floor, rounds, or status.
- Each vendor has its own state, keyed by `vendorId`.
- The sandbox is stateless between requests within a negotiation (state is tracked server-side per vendorId).
- `POST /vendor/:vendorId/message` is idempotent for the same `round` + `buyerOfferPrice`.

## Done-When Checklist

- Sandbox starts on port 3001.
- `POST /vendor/notion/message` with round=1, buyerOfferPrice=9800 returns counter=$10,800.
- `POST /vendor/notion/message` with round=2, buyerOfferPrice=9800 returns counter=$10,200.
- `POST /vendor/notion/message` with round=3, buyerOfferPrice=9800 returns counter=$9,840.
- `POST /vendor/notion/message` with buyerOfferPrice=8000 (< floor) returns rejection.
- `GET /vendor/notion/state` returns server-authoritative state.
- A 3-round negotiation via `npm run negotiate` produces DecisionCard with status `pending` and realizedSavings = $2,160.
- Vendor improves offer when agent mentions credible competitor evidence.
