import { loadEnv } from "../utils/env.js";
import { createApiApp } from "../api/routes.js";
import type { Express } from "express";
import type { Server } from "http";
import type { DecisionCard, NegotiationState, Subscription } from "../types/index.js";

/**
 * L5 acceptance test: seed → guardian → negotiate → card → approve → savings = $5,760.
 * `npm run demo:test`. Exits 0 only when every canonical assertion holds.
 */

const errors: string[] = [];

function assert(cond: boolean, label: string, detail?: unknown): void {
  if (!cond) {
    errors.push(`${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

async function run(): Promise<void> {
  loadEnv();

  const app: Express = createApiApp();
  const server: Server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  console.error(`[demo:test] API on ${base}`);

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

  // 1. Seed — pristine canonical state (14 subs, $47,400/yr, 0 savings)
  const reset = await json<{ subscriptionsReset: number; savingsReset: number }>("/api/demo/reset", { method: "POST" });
  assert(reset.status === 200, "START reset ok", reset.status);
  assert(reset.body.subscriptionsReset === 14, "START 14 subscriptions seeded", reset.body);

  const before = await json<{ totalSavings: number }>("/api/savings");
  assert(before.body.totalSavings === 0, "START savings 0", before.body);

  // 2. Guardian → Negotiator → DecisionCards (the agentic pipeline, mock mode = canonical)
  const run = await json<{
    status: string;
    decisionPackages: number;
    cardsPending: number;
    autonomousActions: number;
    savings: number;
  }>("/api/demo/run", { method: "POST", body: JSON.stringify({ mode: "mock" }) });
  assert(run.status === 200, "RUN 200", run.status);
  assert(run.body.status === "complete", "RUN complete", run.body.status);
  assert(run.body.decisionPackages === 5, "RUN 5 decision packages", run.body.decisionPackages);
  assert(run.body.cardsPending === 2, "RUN 2 pending cards", run.body.cardsPending);
  assert(run.body.autonomousActions === 3, "RUN 3 autonomous actions", run.body.autonomousActions);
  assert(run.body.savings === 0, "RUN savings 0 until human approves", run.body.savings);

  const pending = await json<DecisionCard[]>("/api/decisions/pending");
  assert(pending.status === 200, "PENDING 200", pending.status);
  assert(pending.body.length === 2, "PENDING two cards", pending.body.length);
  const notionCard = pending.body.find((c) => c.subscriptionId === "notion" && c.action === "NEGOTIATE");
  const loomCard = pending.body.find((c) => c.subscriptionId === "loom" && c.action === "SWITCH");
  assert(notionCard !== undefined, "PENDING notion NEGOTIATE card", pending.body.map((c) => c.subscriptionId));
  assert(loomCard !== undefined, "PENDING loom SWITCH card", pending.body.map((c) => c.subscriptionId));
  assert(notionCard?.realizedSavings === 2160, "PENDING notion realized $2,160", notionCard?.realizedSavings);

  const neg = await json<NegotiationState>("/api/negotiation/notion");
  assert(neg.status === 200, "NEGOTIATION 200", neg.status);
  assert(neg.body.round === 3, "NEGOTIATION 3 rounds", neg.body.round);
  assert(neg.body.resolution === "accepted", "NEGOTIATION accepted", neg.body.resolution);
  assert(neg.body.currentOffer?.totalAnnual === 9840, "NEGOTIATION final offer $9,840", neg.body.currentOffer);
  const vendorOffers = neg.body.messages.filter((m) => m.role === "vendor").map((m) => m.currentOffer?.totalAnnual ?? null);
  assert(
    JSON.stringify(vendorOffers) === JSON.stringify([10800, 10200, 9840]),
    "NEGOTIATION offer path 10,800 → 10,200 → 9,840",
    vendorOffers
  );

  // 3. Human gate — approve both actions
  const approveNotion = await json<{ card: DecisionCard }>(`/api/decisions/${notionCard!.id}/approve`, { method: "POST" });
  assert(approveNotion.status === 200, "APPROVE notion 200", approveNotion.status);
  assert(approveNotion.body.card.status === "approved", "APPROVE notion approved", approveNotion.body.card.status);
  const afterNotion = await json<Subscription[]>("/api/subscriptions");
  const notionSub = afterNotion.body.find((s) => s.id === "notion")!;
  assert(notionSub.renewalCost === 9840, "APPROVE notion renewalCost 9,840", notionSub.renewalCost);

  const approveLoom = await json<{ card: DecisionCard }>(`/api/decisions/${loomCard!.id}/approve`, { method: "POST" });
  assert(approveLoom.status === 200, "APPROVE loom 200", approveLoom.status);
  assert(approveLoom.body.card.status === "approved", "APPROVE loom approved", approveLoom.body.card.status);
  const afterLoom = await json<Subscription[]>("/api/subscriptions");
  const loomSub = afterLoom.body.find((s) => s.id === "loom")!;
  assert(loomSub.status === "switched", "APPROVE loom switched", loomSub.status);
  const veedSub = afterLoom.body.find((s) => s.id === "veed")!;
  assert(veedSub.status === "active", "APPROVE veed still active", veedSub.status);

  // 4. Acceptance — savings == $5,760
  const savings = await json<{ totalSavings: number; approvedCount: number; lastAction: string | null }>("/api/savings");
  assert(savings.status === 200, "SAVINGS 200", savings.status);
  assert(savings.body.totalSavings === 5760, "SAVINGS $5,760", savings.body);
  assert(savings.body.approvedCount === 2, "SAVINGS two approved", savings.body.approvedCount);
  assert(savings.body.lastAction === "loom-switch", "SAVINGS last action loom-switch", savings.body.lastAction);

  // 5. All actions resolved
  const agentStatus = await json<{ mode: string }>("/api/agent/status");
  assert(agentStatus.body.mode === "idle", "STATUS idle after approvals", agentStatus.body);

  const after = await json<DecisionCard[]>("/api/decisions/pending");
  assert(after.body.length === 0, "STATUS no pending cards remain", after.body.length);

  // 6. Teardown — restore pristine state for the next run/video
  const done = await json<{ subscriptionsReset: number }>("/api/demo/reset", { method: "POST" });
  assert(done.status === 200, "TEARDOWN reset ok", done.status);
  assert(done.body.subscriptionsReset === 14, "TEARDOWN pristine restored", done.body);
  const finalSavings = await json<{ totalSavings: number }>("/api/savings");
  assert(finalSavings.body.totalSavings === 0, "TEARDOWN savings reset to 0", finalSavings.body);

  server.close();
}

(async () => {
  try {
    await run();
  } catch (err) {
    errors.push(`FATAL ${(err as Error).message}`);
  }

  if (errors.length > 0) {
    console.error("demo:test FAILED");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log("demo:test PASS -> seed → guardian → negotiate → cards → approve → savings = $5,760");
  process.exit(0);
})();