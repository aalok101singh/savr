import { loadEnv } from "../utils/env.js";
import { runNegotiation } from "../agent/negotiator.js";
import { startSandboxServer, type SandboxServer } from "../sandbox/server.js";
import { resetAllVendorState } from "../sandbox/vendor-state.js";

interface VendorPostBody {
  message: string;
  round: number;
  buyerCurrentPrice: number;
  buyerOfferPrice: number;
}

interface VendorHttpResponse {
  status: string;
  response: string;
  offer: { totalAnnual: number } | null;
  vendorId: string;
  round: number;
}

const errors: string[] = [];
function assert(cond: boolean, label: string, detail?: unknown): void {
  if (!cond) {
    errors.push(`${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

function postVendor(
  base: string,
  vendorId: string,
  body: VendorPostBody
): Promise<VendorHttpResponse> {
  return fetch(`${base}/vendor/${vendorId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for round ${body.round} offer ${body.buyerOfferPrice}`);
    return r.json() as Promise<VendorHttpResponse>;
  });
}

async function runSandboxApiChecks(base: string): Promise<void> {
  resetAllVendorState();

  const r1 = await postVendor(base, "notion", {
    message: "pricing",
    round: 1,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 9800,
  });
  assert(r1.offer?.totalAnnual === 10800, "round1 counter should be $10,800", r1.offer);

  const r2 = await postVendor(base, "notion", {
    message: "pricing",
    round: 2,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 9800,
  });
  assert(r2.offer?.totalAnnual === 10200, "round2 counter should be $10,200", r2.offer);

  const r3 = await postVendor(base, "notion", {
    message: "pricing",
    round: 3,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 9800,
  });
  assert(r3.offer?.totalAnnual === 9840, "round3 counter should be $9,840", r3.offer);

  const floor = await postVendor(base, "notion", {
    message: "we want 5000",
    round: 1,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 5000,
  });
  assert(/unable to go that low/i.test(floor.response), "floor rejection text", floor.response);
  assert(floor.offer?.totalAnnual === 10800, "floor rejection returns best counter offer", floor.offer);

  const competitor = await postVendor(base, "notion", {
    message: "A credible competitor: Coda $8400 per year.",
    round: 4,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 9300,
  });
  assert(
    competitor.offer?.totalAnnual === 9360,
    "competitor evidence improves round4 counter to 22% ($9,360)",
    competitor.offer
  );
  assert(
    !/accept your offer/i.test(competitor.response),
    "offer below improved counter -> vendor counters, does not accept",
    competitor.response
  );

  const stall4 = await postVendor(base, "notion", {
    message: "same price again",
    round: 1,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 9500,
  });
  const stallRounds = [stall4.round];
  for (const round of [2, 3, 4]) {
    const r = await postVendor(base, "notion", {
      message: "same price again",
      round,
      buyerCurrentPrice: 12000,
      buyerOfferPrice: 9500,
    });
    stallRounds.push(r.round);
    if (round === 4) {
      assert(/we've made our best offer/i.test(r.response), "4th identical offer stalls vendor", r.response);
    } else {
      assert(
        !/we've made our best offer/i.test(r.response),
        `round ${round} identical offer must NOT stall yet`,
        r.response
      );
    }
  }
  assert(stallRounds.length === 4, "stall sequence ran 4 rounds");

  const noCompetitorSameRound = await postVendor(base, "notion", {
    message: "pricing (no competitor)",
    round: 5,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 9300,
  });
  assert(
    noCompetitorSameRound.offer?.totalAnnual === 9360,
    "without competitor evidence round5 counter is 22% ($9,360)",
    noCompetitorSameRound.offer
  );

  const canonicalRepeat = await postVendor(base, "notion", {
    message: "pricing",
    round: 1,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 9800,
  });
  assert(
    canonicalRepeat.offer?.totalAnnual === r1.offer?.totalAnnual,
    "idempotent reply for same round+offer",
    { before: r1.offer, after: canonicalRepeat.offer }
  );

  const state = (await fetch(`${base}/vendor/notion/state`).then((r) => r.json())) as {
    vendorId: string;
    vendorReservationPrice: number;
    roundsCompleted: number;
    status: string;
  };
  assert(state.vendorId === "notion", "state endpoint returns vendorId");
  assert(state.vendorReservationPrice === 8400, "state endpoint exposes reservation price (debug)", state.vendorReservationPrice);
  assert(state.roundsCompleted >= 3, "state roundsCompleted is server-authoritative", state.roundsCompleted);
  assert(["negotiating", "accepted", "max_rounds", "idle"].includes(state.status), "state status valid", state.status);

  const unknown = await fetch(`${base}/vendor/nope/state`);
  assert(unknown.status === 404, "unknown vendor returns 404", unknown.status);

  // Final-round acceptance must win: an offer accepted exactly on the last allowed
  // round is a success, never a max_rounds exhaustion.
  resetAllVendorState();
  const finalRoundAccept = await postVendor(base, "notion", {
    message: "final offer beyond counter",
    round: 5,
    buyerCurrentPrice: 12000,
    buyerOfferPrice: 9600,
  });
  assert(
    /accept your offer/i.test(finalRoundAccept.response),
    "acceptance message on the max-allowable round",
    finalRoundAccept.response
  );
  const finalAcceptState = (await fetch(`${base}/vendor/notion/state`).then((r) => r.json())) as {
    status: string;
    roundsCompleted: number;
  };
  assert(
    finalAcceptState.status === "accepted",
    "final-round acceptance is not overwritten by max_rounds",
    finalAcceptState
  );

  const badResponse = await fetch(`${base}/vendor/notion/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "x", round: 0, buyerCurrentPrice: 12000, buyerOfferPrice: 9800 }),
  });
  assert(badResponse.status === 400, "invalid round rejected with 400", badResponse.status);
}

async function runNegotiationGate(): Promise<void> {
  const { state, card } = await runNegotiation("notion");
  assert(state.resolution === "accepted", "canonical negotiation resolves accepted", state.resolution);
  assert(state.round === 3, "canonical negotiation closes in 3 rounds", state.round);
  assert(state.currentOffer?.totalAnnual === 9840, "final offer is $9,840", state.currentOffer);
  assert(card.status === "pending", "DecisionCard is pending", card.status);
  assert(card.realizedSavings === 2160, "realized savings equals $2,160", card.realizedSavings);
  assert(card.subscriptionId === "notion", "card targets notion", card.subscriptionId);
  assert(card.action === "NEGOTIATE", "card action is NEGOTIATE", card.action);
  assert(
    card.negotiation?.buyerOfferPrice === 9800,
    "agent proposed $9,800 per round (canonical)",
    card.negotiation?.buyerOfferPrice
  );
  assert(state.messages.length >= 6, "transcript records agent + vendor for every round", state.messages.length);
  const agentMsgs = state.messages.filter((m) => m.role === "agent");
  const vendorMsgs = state.messages.filter((m) => m.role === "vendor");
  assert(agentMsgs.length === 3, "three agent messages recorded", agentMsgs.length);
  assert(vendorMsgs.length === 3, "three vendor messages recorded", vendorMsgs.length);
  for (const m of agentMsgs) {
    assert(m.buyerOfferPrice === 9800 && m.currentOffer === null, "agent msg carries its offer, no vendor offer", m);
  }
  const vendorOffers = vendorMsgs.map((m) => m.currentOffer?.totalAnnual ?? null);
  assert(
    JSON.stringify(vendorOffers) === JSON.stringify([10800, 10200, 9840]),
    "each vendor message retains its own distinct round offer",
    vendorOffers
  );
  const rounds = state.messages.map((m) => m.round);
  assert(
    JSON.stringify(rounds) === JSON.stringify([1, 1, 2, 2, 3, 3]),
    "messages carry their own 1-indexed round",
    rounds
  );
}

async function assertNoPrivatePricesSent(base: string): Promise<void> {
  const data = (await fetch(`${base}/vendor/notion/messages`).then((r) => r.json())) as {
    receivedMessages: Array<Record<string, unknown>>;
  };
  assert(data.receivedMessages.length > 0, "sandbox audited inbound messages", data.receivedMessages.length);
  for (const received of data.receivedMessages) {
    const keys = Object.keys(received);
    assert(
      !keys.includes("proposedAcceptPrice") && !keys.includes("targetPrice") && !keys.includes("maxAcceptablePrice"),
      `payload must not leak private prices (keys=${keys.join(",")})`,
      received
    );
  }
}

async function main(): Promise<void> {
  loadEnv();
  const bootstrapped = startSandboxServer(0) as SandboxServer;
  const base = `http://127.0.0.1:${bootstrapped.port}`;
  process.env.SANDBOX_PORT = String(bootstrapped.port);
  console.error(`[validate:sandbox] sandbox on ${base}`);

  await runSandboxApiChecks(base);
  await runNegotiationGate();
  await assertNoPrivatePricesSent(base);

  bootstrapped.server.close();

  if (errors.length > 0) {
    console.error("validate:sandbox FAILED");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log("T1 PASS -> rounds produce $10,800 / $10,200 / $9,840");
  console.log("T2 PASS -> floor rejection below $8,400 reservation");
  console.log("T3 PASS -> competitor evidence improves counter by 2 percentage points");
  console.log("T4 PASS -> repeated identical offer stalls only from the 4th booking");
  console.log("T5 PASS -> idempotent per round+buyerOfferPrice; GET /state server-authoritative");
  console.log("T6 PASS -> private prices never sent to vendor (audit log clean)");
  console.log("T7 PASS -> npm run negotiate gate: card pending, realizedSavings $2,160, 3 rounds, $9,840");
  console.log("T8 PASS -> transcript: both roles recorded, per-round offers 10,800 / 10,200 / 9,840");
  console.log("L3 GATE PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error(`validate:sandbox FATAL: ${(err as Error).message}`);
  process.exit(1);
});