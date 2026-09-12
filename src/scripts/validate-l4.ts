import { loadEnv } from "../utils/env.js";
import { createApiApp } from "../api/routes.js";
import type { Express } from "express";
import type { Server } from "http";
import type { DecisionCard, DecisionPackage, NegotiationState, Policy, Subscription } from "../types/index.js";

const errors: string[] = [];

function assert(cond: boolean, label: string, detail?: unknown): void {
  if (!cond) {
    errors.push(`${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  loadEnv();

  const app: Express = createApiApp();
  const server: Server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  console.error(`[validate:l4] API on ${base}`);

  const json = async <T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json" } });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body: body as T };
  };

  // T1 — 14 subscriptions
  const subsRes = await json<Subscription[]>("/api/subscriptions");
  assert(subsRes.status === 200, "T1 subscriptions status 200", subsRes.status);
  assert(subsRes.body.length === 14, "T1 exactly 14 subscriptions", subsRes.body.length);

  // T2 — reset restores initial state
  const resetRes = await json<{ subscriptionsReset: number; cardsCleared: number }>("/api/demo/reset", {
    method: "POST",
  });
  assert(resetRes.status === 200, "T2 reset 200", resetRes.status);
  assert(resetRes.body.subscriptionsReset === 14, "T2 reset restored 14 subscriptions", resetRes.body);
  const neverNegotiated = await json<{ error: string }>("/api/negotiation/slack");
  assert(neverNegotiated.status === 404, "T2 never-negotiated subscription returns 404", neverNegotiated.status);

  // T3 — synchronous demo/run
  const runRes = await json<{
    status: string;
    decisionPackages: number;
    cardsPending: number;
    autonomousActions: number;
    savings: number;
  }>("/api/demo/run", { method: "POST" });
  assert(runRes.status === 200, "T3 demo/run 200", runRes.status);
  assert(runRes.body.status === "complete", "T3 demo/run complete", runRes.body.status);
  assert(runRes.body.decisionPackages === 5, "T3 five decision packages", runRes.body.decisionPackages);
  assert(runRes.body.cardsPending === 2, "T3 two pending cards", runRes.body.cardsPending);
  assert(runRes.body.autonomousActions === 3, "T3 three autonomous actions", runRes.body.autonomousActions);
  assert(runRes.body.savings === 0, "T3 savings 0 before approval", runRes.body.savings);

  // T4 — pending cards: notion NEGOTIATE + loom SWITCH
  const pendingRes = await json<DecisionCard[]>("/api/decisions/pending");
  assert(pendingRes.body.length === 2, "T4 exactly 2 pending cards", pendingRes.body.length);
  const pendingSubs = pendingRes.body.map((c) => c.subscriptionId).sort();
  assert(JSON.stringify(pendingSubs) === JSON.stringify(["loom", "notion"]), "T4 pending = notion + loom", pendingSubs);
  const notionCard = pendingRes.body.find((c) => c.subscriptionId === "notion")!;
  const loomCard = pendingRes.body.find((c) => c.subscriptionId === "loom")!;
  assert(notionCard.action === "NEGOTIATE", "T4 notion action NEGOTIATE", notionCard.action);
  assert(notionCard.realizedSavings === 2160, "T4 notion realized savings 2160", notionCard.realizedSavings);
  assert(notionCard.estimatedSavings === 2160, "T4 notion card estimated savings mirrors realized (2160)", notionCard.estimatedSavings);
  assert(loomCard.action === "SWITCH", "T4 loom action SWITCH", loomCard.action);
  assert(loomCard.estimatedSavings === 3600, "T4 loom estimated savings 3600", loomCard.estimatedSavings);
  assert(loomCard.realizedSavings === 0, "T4 loom realized savings 0", loomCard.realizedSavings);

  // T5 — negotiation log (money shot)
  const neg = await json<NegotiationState>("/api/negotiation/notion");
  assert(neg.status === 200, "T5 negotiation 200", neg.status);
  assert(neg.body.round === 3, "T5 3 rounds", neg.body.round);
  assert(neg.body.currentOffer?.totalAnnual === 9840, "T5 final offer $9,840", neg.body.currentOffer);
  assert(neg.body.resolution === "accepted", "T5 resolved accepted", neg.body.resolution);
  assert(neg.body.buyerOfferPrice === 9800, "T5 structured buyerOfferPrice $9,800", neg.body.buyerOfferPrice);
  assert(neg.body.proposedAcceptPrice === 10000, "T5 proposedAcceptPrice $10,000", neg.body.proposedAcceptPrice);

  // T5b — decisions endpoint returns 5 packages
  const packagesRes = await json<DecisionPackage[]>("/api/decisions");
  assert(packagesRes.body.length === 5, "T5b decisions returns 5 packages", packagesRes.body.length);

  // T5c — negotiation transcript records both roles with per-round offers
  const transcript = neg.body.messages;
  assert(transcript.length >= 6, "T5c transcript records agent + vendor per round", transcript.length);
  const transcriptAgent = transcript.filter((m) => m.role === "agent");
  const transcriptVendor = transcript.filter((m) => m.role === "vendor");
  assert(transcriptAgent.length === 3, "T5c three agent messages", transcriptAgent.length);
  assert(transcriptVendor.length === 3, "T5c three vendor messages", transcriptVendor.length);
  const transcriptOffers = transcriptVendor.map((m) => m.currentOffer?.totalAnnual ?? null);
  assert(
    JSON.stringify(transcriptOffers) === JSON.stringify([10800, 10200, 9840]),
    "T5c per-round vendor offers distinct and retained",
    transcriptOffers
  );
  assert(
    transcript.every((m) => m.buyerOfferPrice === 9800),
    "T5c every agent/vendor message carries round buyer offer 9800",
    transcript.map((m) => m.buyerOfferPrice)
  );

  // T6 — approve notion: PostApprovalMutation applies renewalCost 9840
  const approve1 = await json<{ card: DecisionCard; mutation: { changes: Record<string, unknown> } }>(
    `/api/decisions/${notionCard.id}/approve`,
    { method: "POST" }
  );
  assert(approve1.status === 200, "T6 approve notion 200", approve1.status);
  assert(approve1.body.card.status === "approved", "T6 notion card approved", approve1.body.card.status);
  assert(approve1.body.mutation.changes.renewalCost === 9840, "T6 NEGOTIATE mutation renewalCost 9840", approve1.body.mutation);
  const afterApprove1 = await json<Subscription[]>("/api/subscriptions");
  const notionSub = afterApprove1.body.find((s) => s.id === "notion")!;
  assert(notionSub.renewalCost === 9840, "T6 notion.renewalCost = 9840", notionSub.renewalCost);

  // T7 — idempotent approve returns 200 with same result
  const approve2 = await json<{ card: DecisionCard }>(`/api/decisions/${notionCard.id}/approve`, { method: "POST" });
  assert(approve2.status === 200, "T7 repeated approve 200", approve2.status);
  assert(approve2.body.card.status === "approved", "T7 repeated approve still approved", approve2.body.card.status);

  // T8 — reject on approved card → 409
  const rejectApproved = await json<{ error: string }>(`/api/decisions/${notionCard.id}/reject`, { method: "POST" });
  assert(rejectApproved.status === 409, "T8 reject approved card 409", rejectApproved.status);
  assert(typeof rejectApproved.body.error === "string" && rejectApproved.body.error.length > 0, "T8 has conflict error", rejectApproved.body.error);

  // T9 — approve loom: status switched
  const approveLoom = await json<{ card: DecisionCard }>(`/api/decisions/${loomCard.id}/approve`, { method: "POST" });
  assert(approveLoom.status === 200, "T9 approve loom 200", approveLoom.status);
  assert(approveLoom.body.card.status === "approved", "T9 loom card approved", approveLoom.body.card.status);
  const afterApproveLoom = await json<Subscription[]>("/api/subscriptions");
  const loomSub = afterApproveLoom.body.find((s) => s.id === "loom")!;
  assert(loomSub.status === "switched", "T9 loom.status switched", loomSub.status);
  const veedSub = afterApproveLoom.body.find((s) => s.id === "veed")!;
  assert(veedSub.status === "active", "T9 veed remains active", veedSub.status);

  // T10 — savings $5,760
  const savings = await json<{ totalSavings: number; approvedCount: number; lastAction: string | null }>("/api/savings");
  assert(savings.body.totalSavings === 5760, "T10 savings $5,760", savings.body);
  assert(savings.body.approvedCount === 2, "T10 two approved actions", savings.body.approvedCount);
  assert(savings.body.lastAction === "loom-switch", "T10 lastAction loom-switch", savings.body.lastAction);

  // T10b — agent status: all resolved → idle
  const agentStatus = await json<{ mode: string; pendingCardId: string | null }>("/api/agent/status");
  assert(agentStatus.body.mode === "idle", "T10b agent status idle", agentStatus.body);

  // T11 — policy view
  const policy = await json<Policy>("/api/policy");
  assert(policy.status === 200, "T11 policy 200", policy.status);
  assert(policy.body.maxAnnualBudget === 60000, "T11 policy budget $60,000", policy.body.maxAnnualBudget);

  // T12 — SSE events: subscribe, trigger an event source, observe canonical frames
  const sseRes = await fetch(`${base}/api/events`);
  const sseReader = sseRes.body!.getReader();
  let sseText = "";
  const ssePump = (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await sseReader.read();
      if (done) break;
      sseText += decoder.decode(value, { stream: true });
    }
  })();
  await json("/api/demo/reset", { method: "POST" });
  await json("/api/demo/run", { method: "POST" });
  await sleep(300);
  await sseReader.cancel();
  await ssePump.catch(() => undefined);
  assert(sseText.includes("event: guardian_update"), "T12 SSE guardian_update", sseText.slice(0, 120));
  assert(sseText.includes("event: decision_card"), "T12 SSE decision_card", sseText.slice(0, 120));
  assert(sseText.includes("event: savings_update"), "T12 SSE savings_update", sseText.slice(0, 120));
  assert(sseText.includes("event: agent_status"), "T12 SSE agent_status", sseText.slice(0, 120));

  // T13 — reset clears savings and cards; fresh post-approval still canonical
  await json("/api/demo/reset", { method: "POST" });
  const freshSavings = await json<{ totalSavings: number }>("/api/savings");
  assert(freshSavings.body.totalSavings === 0, "T13 reset zeroes savings", freshSavings.body);
  const freshPending = await json<DecisionCard[]>("/api/decisions/pending");
  assert(freshPending.body.length === 0, "T13 reset clears cards", freshPending.body.length);
  const restoredLoom = (await json<Subscription[]>("/api/subscriptions")).body.find((s) => s.id === "loom")!;
  assert(restoredLoom.status === "active", "T13 reset restores loom to active", restoredLoom.status);

  server.close();
}

async function main(): Promise<void> {
  try {
    await run();
  } catch (err) {
    errors.push(`FATAL ${(err as Error).message}`);
  }

  if (errors.length > 0) {
    console.error("validate:l4 FAILED");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log("T1 PASS -> /api/subscriptions returns 14 rows");
  console.log("T2 PASS -> demo/reset restores; never-negotiated returns 404");
  console.log("T3 PASS -> demo/run synchronous: 5 packages, 2 pending, 3 autonomous, savings 0");
  console.log("T4 PASS -> pending cards = notion NEGOTIATE (2160/2160) + loom SWITCH (3600/0)");
  console.log("T5 PASS -> negotiation log: 3 rounds, offer $9,840, accepted, buyerOffer $9,800");
  console.log("T5c PASS -> transcript: both roles, per-round offers 10,800 / 10,200 / 9,840");
  console.log("T6 PASS -> approve notion => renewalCost 9840");
  console.log("T7 PASS -> repeated approve idempotent (200, approved)");
  console.log("T8 PASS -> reject approved card => 409 conflict");
  console.log("T9 PASS -> approve loom => status switched, veed stays active");
  console.log("T10 PASS -> savings $5,760, approvedCount 2, lastAction loom-switch");
  console.log("T11 PASS -> policy view renders active policy");
  console.log("T12 PASS -> SSE emits guardian_update / decision_card / savings_update / agent_status");
  console.log("T13 PASS -> reset restores initial state");
  console.log("L4 GATE PASSED");
  process.exit(0);
}

main();