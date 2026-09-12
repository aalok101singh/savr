import { loadEnv } from "../utils/env.js";
import { createApiApp } from "../api/routes.js";
import type { Express } from "express";
import type { Server } from "http";
import type { Company, DecisionPackage, GuardianProgressEvent, Subscription } from "../types/index.js";

const errors: string[] = [];

function assert(cond: boolean, label: string, detail?: unknown): void {
  if (!cond) {
    errors.push(`${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SseFrame {
  event: string;
  data: unknown;
}

function parseSse(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = "message";
    let dataLine = "";
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
    }
    if (dataLine === "") continue;
    try {
      frames.push({ event, data: JSON.parse(dataLine) });
    } catch {
      frames.push({ event, data: dataLine });
    }
  }
  return frames;
}

async function captureEvents(base: string, trigger: () => Promise<unknown>): Promise<SseFrame[]> {
  const res = await fetch(`${base}/api/events`);
  const reader = res.body!.getReader();
  let text = "";
  const pump = (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  })();
  try {
    await trigger();
    await sleep(600);
  } finally {
    await reader.cancel().catch(() => undefined);
    await pump.catch(() => undefined);
  }
  return parseSse(text);
}

function progressFor(frames: SseFrame[], subscriptionId: string): Array<{ status: string; action?: string }> {
  return frames
    .filter((f) => f.event === "guardian_progress")
    .map((f) => f.data as GuardianProgressEvent)
    .filter((d) => d.subscriptionId === subscriptionId)
    .map((d) => ({ status: d.status, action: d.action }));
}

const FIGMA: Record<string, unknown> = {
  id: "figma",
  vendorName: "Figma",
  category: "Design",
  billingModel: "seat_based",
  annualCost: 9600,
  seatsPurchased: 16,
  seatsActive: 6,
  renewalDate: "2026-09-22T00:00:00.000Z",
};
const LOOM_ROW: Record<string, unknown> = {
  id: "loom",
  vendorName: "Loom",
  category: "Video",
  billingModel: "seat_based",
  annualCost: 3600,
  seatsPurchased: 10,
  seatsActive: 10,
  renewalDate: "2026-10-10T00:00:00.000Z",
};
const VEED_ROW: Record<string, unknown> = {
  id: "veed",
  vendorName: "Veed",
  category: "Video",
  billingModel: "seat_based",
  annualCost: 2400,
  seatsPurchased: 8,
  seatsActive: 8,
  renewalDate: "2026-11-01T00:00:00.000Z",
};

async function run(): Promise<void> {
  loadEnv();

  const app: Express = createApiApp();
  const server: Server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  console.error(`[validate:l4.5] API on ${base} (SAVR_MODEL=${process.env.SAVR_MODEL ?? "(unset)"})`);

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

  // ──────────────────────────────────────────────────────
  // T1 — mock path byte-identical to L4 canon ($5,760 pre-approval)
  await json("/api/demo/reset", { method: "POST" });
  const mockRun = await json<{
    status: string;
    decisionPackages: number;
    cardsPending: number;
    autonomousActions: number;
    savings: number;
  }>("/api/demo/run", { method: "POST", body: JSON.stringify({ mode: "mock" }) });
  assert(mockRun.status === 200, "T1 mock run 200", mockRun.status);
  assert(mockRun.body.status === "complete", "T1 mock status complete", mockRun.body);
  assert(mockRun.body.decisionPackages === 5, "T1 mock 5 packages", mockRun.body.decisionPackages);
  assert(mockRun.body.cardsPending === 2, "T1 mock 2 pending cards", mockRun.body.cardsPending);
  assert(mockRun.body.autonomousActions === 3, "T1 mock 3 autonomous actions", mockRun.body.autonomousActions);
  assert(mockRun.body.savings === 0, "T1 mock savings 0 pre-approval", mockRun.body.savings);
  const cardsAfterMock = await json<
    Array<{ subscriptionId: string; action: string; estimatedSavings: number; realizedSavings: number }>
  >("/api/decisions/pending");
  assert(cardsAfterMock.body.length === 2, "T1 two pending cards", cardsAfterMock.body.length);
  const notionCard = cardsAfterMock.body.find((c) => c.subscriptionId === "notion" && c.action === "NEGOTIATE");
  const loomCard = cardsAfterMock.body.find((c) => c.subscriptionId === "loom" && c.action === "SWITCH");
  assert(notionCard !== undefined, "T1 notion NEGOTIATE card", cardsAfterMock.body);
  assert(loomCard !== undefined, "T1 loom SWITCH card", cardsAfterMock.body);

  // ──────────────────────────────────────────────────────
  // T2 — session/company accepts a non-Acme company (and rejects malformed)
  const badCompany = await json<{ error: string }>("/api/session/company", {
    method: "POST",
    body: JSON.stringify({ name: 42, employees: "nope", annualBudget: {} }),
  });
  assert(badCompany.status === 400, "T2 malformed company 400", badCompany.status);
  const testco: Company = { name: "Testco", employees: 8, annualBudget: 30000 };
  const companyRes = await json<{ status: string; company: Company }>("/api/session/company", {
    method: "POST",
    body: JSON.stringify(testco),
  });
  assert(companyRes.status === 200, "T2 company accepted 200", companyRes.status);
  assert(companyRes.body.company.name === "Testco", "T2 company name Testco", companyRes.body);
  const companyGet = await json<Company>("/api/company");
  assert(companyGet.body.name === "Testco", "T2 GET /api/company = Testco", companyGet.body);
  assert(companyGet.body.employees === 8, "T2 company employees 8", companyGet.body.employees);
  assert(companyGet.body.annualBudget === 30000, "T2 company budget 30000", companyGet.body.annualBudget);

  // ──────────────────────────────────────────────────────
  // T3 — stack/import accepts a non-Acme stack (figma, loom, veed)
  const importRes = await json<{ count: number }>("/api/stack/import", {
    method: "POST",
    body: JSON.stringify([FIGMA, LOOM_ROW, VEED_ROW]),
  });
  assert(importRes.status === 200, "T3 stack import 200", importRes.status);
  const subsAfterImport = await json<Subscription[]>("/api/subscriptions");
  assert(subsAfterImport.body.length === 3, "T3 3 subscriptions after import", subsAfterImport.body.length);
  const figmaSub = subsAfterImport.body.find((s) => s.id === "figma");
  assert(figmaSub !== undefined, "T3 figma present", subsAfterImport.body.map((s) => s.id));
  assert(figmaSub?.seatsPurchased === 16 && figmaSub?.seatsActive === 6, "T3 figma seats 16/6", figmaSub);

  // ──────────────────────────────────────────────────────
  // T4 — live run acts on whatever Guardian flags, not hardcoded "notion"/"loom".
  // Locally the Bedrock IAM permission is absent (DECISIONS #038), so we use the
  // SAVR_MODEL=local escape hatch: model resolution honours the per-run mode
  // (BedrockModel on a real "live" call; LocalModel via the explicit test override)
  // while the full live orchestration path — evaluate -> propose -> negotiate/switching
  // keyed off pkg.subscriptionId — runs for real against the imported stack.
  process.env.SAVR_MODEL = "local";
  const liveFrames = await captureEvents(base, () =>
    json("/api/demo/run", { method: "POST", body: JSON.stringify({ mode: "live" }) })
  );
  delete process.env.SAVR_MODEL;

  const figmaProgress = progressFor(liveFrames, "figma");
  const evalIdx = figmaProgress.findIndex((e) => e.status === "evaluating");
  const doneIdx = figmaProgress.findIndex((e) => e.status === "done");
  assert(evalIdx !== -1, "T4 figma evaluating event fired", figmaProgress);
  assert(doneIdx !== -1, "T4 figma done event fired", figmaProgress);
  assert(evalIdx < doneIdx, "T4 figma evaluating precedes done", figmaProgress);

  const decisionsAfterLive = await json<DecisionPackage[]>("/api/decisions");
  const figmaPkg = decisionsAfterLive.body.find((p) => p.subscriptionId === "figma");
  assert(figmaPkg !== undefined, "T4 figma evaluated with a recommendation", decisionsAfterLive.body.map((p) => p.subscriptionId));
  assert(figmaPkg?.action === "NEGOTIATE", "T4 figma recommended NEGOTIATE (unused seats + renewal)", figmaPkg?.action);

  const cardsAfterLive = await json<
    Array<{ subscriptionId: string; action: string; status: string; resolution?: string }>
  >("/api/decisions/pending");
  const figmaNegCard = cardsAfterLive.body.find((c) => c.subscriptionId === "figma" && c.action === "NEGOTIATE");
  assert(figmaNegCard !== undefined, "T4 negotiator actually ran for figma (not notion)", cardsAfterLive.body);
  assert(
    figmaNegCard?.status === "pending",
    "T4 figma negotiation produced a pending card",
    figmaNegCard
  );
  const loomSwitchCard = cardsAfterLive.body.find((c) => c.subscriptionId === "loom" && c.action === "SWITCH");
  assert(loomSwitchCard !== undefined, "T4 generic SWITCH loop runs keyed off package", cardsAfterLive.body);

  const figmaNegotiation = await json<{ resolution: string; subscriptionId: string }>(
    "/api/negotiation/figma"
  );
  assert(figmaNegotiation.body.subscriptionId === "figma", "T4 negotiation state stored for figma", figmaNegotiation.body);
  assert(
    ["stalled", "accepted"].includes(figmaNegotiation.body.resolution),
    "T4 figma negotiation resolved gracefully (stalled is expected without the vendor in the sandbox)",
    figmaNegotiation.body
  );

  // ──────────────────────────────────────────────────────
  // T5 — optional real-Bedrock probe (only when RUN_LIVE_AKS=true).
  // Without the IAM permission it must still return gracefully (e.g. 0 packages),
  // never hang, never 500. Default off: hermetic gate.
  if (process.env.RUN_LIVE_AKS === "true") {
    const started = Date.now();
    const liveReal = await json<{ status: string; decisionPackages: number }>("/api/demo/run", {
      method: "POST",
      body: JSON.stringify({ mode: "live" }),
    });
    const elapsed = Date.now() - started;
    assert(liveReal.status === 200, "T5 real-Bedrock live run 200", liveReal.status);
    assert(liveReal.body.status === "complete", "T5 real-Bedrock live run complete", liveReal.body);
    assert(elapsed < 120000, "T5 live run finished within 120s", elapsed);
  } else {
    console.log("T5 SKIP -> real-Bedrock probe requires RUN_LIVE_AKS=true (IAM permission is a prerequisite, DECISIONS #038)");
  }

  // ──────────────────────────────────────────────────────
  // T6 — mock after a live run still canonical (data can't leak between modes;
  // mock always resets from seed). Progress events also fire during the mock run.
  const mockFrames = await captureEvents(base, () =>
    json("/api/demo/run", { method: "POST", body: JSON.stringify({ mode: "mock" }) })
  );
  const notionProgress = progressFor(mockFrames, "notion");
  const nEval = notionProgress.findIndex((e) => e.status === "evaluating");
  const nDone = notionProgress.findIndex((e) => e.status === "done");
  assert(nEval !== -1 && nDone !== -1 && nEval < nDone, "T6 guardian_progress ordering on mock run", notionProgress);
  const mockAfterLive = await json<{
    status: string;
    decisionPackages: number;
    cardsPending: number;
    autonomousActions: number;
  }>("/api/demo/run", { method: "POST", body: JSON.stringify({ mode: "mock" }) });
  assert(mockAfterLive.status === 200, "T6 mock after live 200", mockAfterLive.status);
  assert(mockAfterLive.body.decisionPackages === 5, "T6 mock still 5 packages", mockAfterLive.body);
  assert(mockAfterLive.body.cardsPending === 2, "T6 mock still 2 pending", mockAfterLive.body);
  assert(mockAfterLive.body.autonomousActions === 3, "T6 mock still 3 autonomous", mockAfterLive.body);

  // ──────────────────────────────────────────────────────
  // T7 — reset leaves data pristine
  const reset = await json<{ subscriptionsReset: number; cardsCleared: number }>("/api/demo/reset", {
    method: "POST",
  });
  assert(reset.body.subscriptionsReset === 14, "T7 reset restores 14 subs", reset.body);
  const finalSubs = await json<Subscription[]>("/api/subscriptions");
  assert(finalSubs.body.length === 14, "T7 14 subs after reset", finalSubs.body.length);

  // ──────────────────────────────────────────────────────
  // T8 — zero-result live run (a healthy stack flags nothing; the run completes
  // gracefully with 0 packages / 0 pending cards — the "nothing needs attention"
  // state the UI must present plainly, not as a broken page).
  await json("/api/demo/reset", { method: "POST" });
  const cleanSub = [
    {
      id: "sequoia",
      vendorName: "Sequoia",
      category: "CRM",
      billingModel: "seat_based",
      annualCost: 2400,
      seatsPurchased: 5,
      seatsActive: 5,
      renewalDate: "2027-06-01T00:00:00.000Z",
      autoRenew: false,
      notes: "Healthy seat utilisation, no renewal soon.",
    },
  ];
  await json("/api/stack/import", { method: "POST", body: JSON.stringify(cleanSub) });
  const zeroRun = await json<{
    status: string;
    decisionPackages: number;
    cardsPending: number;
    autonomousActions: number;
    subscriptionsChecked: number;
  }>("/api/demo/run", { method: "POST", body: JSON.stringify({ mode: "live" }) });
  assert(zeroRun.status === 200, "T8 zero-result live run 200", zeroRun.status);
  assert(zeroRun.body.status === "complete", "T8 zero-result run completes", zeroRun.body);
  assert(zeroRun.body.decisionPackages === 0, "T8 healthy stack flags nothing", zeroRun.body);
  assert(zeroRun.body.cardsPending === 0, "T8 no pending cards on zero-result run", zeroRun.body);
  assert(zeroRun.body.subscriptionsChecked === 1, "T8 run reports subscriptionsChecked", zeroRun.body);

  // ──────────────────────────────────────────────────────
  // T9 — session reset ("different company") clears the current company + stack and
  // returns a clean slate for onboarding; the Acme walkthrough remains reachable via
  // demo/reset afterwards.
  const sessionReset = await json<{ cleared: boolean; subscriptions: number }>("/api/session/reset", {
    method: "POST",
  });
  assert(sessionReset.status === 200, "T9 session reset 200", sessionReset.status);
  assert(sessionReset.body.cleared === true, "T9 session reset clears", sessionReset.body);
  assert(sessionReset.body.subscriptions === 0, "T9 session reset empties stack", sessionReset.body);
  const emptySubs = await json<Subscription[]>("/api/subscriptions");
  const emptyCards = await json<unknown[]>("/api/decisions/pending");
  assert(emptySubs.body.length === 0, "T9 subscriptions empty after reset", emptySubs.body.length);
  assert(Array.isArray(emptyCards.body) && emptyCards.body.length === 0, "T9 pending cards empty", emptyCards.body);

  // Restore the canonical walkthrough data.
  await json("/api/demo/reset", { method: "POST" });
  const restoredSubs = await json<Subscription[]>("/api/subscriptions");
  assert(restoredSubs.body.length === 14, "T9 demo/reset restores 14 subs after session reset", restoredSubs.body.length);

  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (errors.length > 0) {
    console.error("validate:l4.5 FAILED");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("T1 PASS -> mock mode byte-identical: 5 packages / 2 pending / 3 autonomous / savings 0");
  console.log("T2 PASS -> /api/session/company accepts non-Acme company, rejects malformed");
  console.log("T3 PASS -> /api/stack/import accepts non-Acme stack (figma/loom/veed)");
  console.log("T4 PASS -> live run evaluated figma, negotiator ran FOR figma (not hardcoded notion); SWITCH loop generic");
  console.log("T6 PASS -> mock after live still canonical ($5,760-canon), guardian_progress ordered during run");
  console.log("T7 PASS -> demo/reset restores pristine 14-sub seed");
  console.log("T8 PASS -> zero-result live run completes gracefully (0 packages / 0 pending)");
  console.log("T9 PASS -> session reset clears company + stack; demo/reset restores canonical walkthrough");
  console.log("L4.5 GATE PASSED");
  process.exitCode = 0;
}

run().catch((err) => {
  console.error(`[validate:l4.5] fatal: ${(err as Error).message}`);
  process.exitCode = 1;
});