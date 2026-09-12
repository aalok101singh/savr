import { loadEnv } from "../../src/utils/env.js";
import { createApiApp } from "../../src/api/routes.js";
import { INITIAL_DIRECTOR_STATE, directorReducer, reduceAll } from "../src/director/reducer";
import type { DirectorFrame, DirectorState } from "../src/director/types";

const errors: string[] = [];

function assert(cond: boolean, label: string, detail?: unknown): void {
  if (!cond) {
    errors.push(`${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSseText(raw: string): DirectorFrame[] {
  const frames: DirectorFrame[] = [];
  const blocks = raw.split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "";
    const datas: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) datas.push(line.slice(5).trim());
    }
    if (!event || datas.length === 0) continue;
    let data: unknown = datas.join("\n");
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = datas.join("\n");
      }
    }
    frames.push({ event, data });
  }
  return frames;
}

async function run(): Promise<void> {
  loadEnv();
  const app = createApiApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

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

  await json("/api/demo/reset", { method: "POST" });

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

  await json("/api/demo/run", { method: "POST" });
  await sleep(500);

  const pending = (await json<Array<{ id: string; subscriptionId: string }>>("/api/decisions/pending")).body;
  assert(pending.length === 2, "story demo produced 2 pending cards", pending.length);

  for (const card of pending) {
    await json(`/api/decisions/${encodeURIComponent(card.id)}/approve`, { method: "POST" });
    await sleep(500);
  }

  await sseReader.cancel();
  await ssePump.catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const frames = parseSseText(sseText);
  assert(frames.length > 0, "captured frames from a real run", frames.length);
  const events = frames.map((f) => f.event);
  for (const name of ["guardian_update", "negotiation_message", "decision_card", "savings_update", "agent_status"]) {
    assert(events.includes(name), `captured event type ${name}`, frames.length);
  }

  const final: DirectorState = reduceAll(INITIAL_DIRECTOR_STATE, frames);

  const transcriptRoles = [...new Set(final.transcript.map((m) => m.role))];
  assert(
    transcriptRoles.includes("agent") && transcriptRoles.includes("vendor"),
    "transcript contains both agent and vendor roles",
    transcriptRoles
  );
  assert(final.transcript.length >= 6, "transcript has agent + vendor per round", final.transcript.length);

  const vendorOffers = final.rounds.map((r) => r.vendorOffer);
  assert(
    JSON.stringify(vendorOffers) === JSON.stringify([10800, 10200, 9840]),
    "round offers are genuinely distinct per round",
    vendorOffers
  );

  let s = INITIAL_DIRECTOR_STATE;
  const phases: string[] = [];
  for (const frame of frames) {
    s = directorReducer(s, frame);
    phases.push(s.phase);
  }

  // The human gate now precedes all vendor contact: Guardian flags, the stack sits
  // in approval while cards are pending, approving the NEGOTIATE card starts the
  // negotiation rounds, and only then does the run resolve.
  const phaseOrder = ["guardian", "approval", "negotiating", "resolved"];
  let cursor = -1;
  const lastPhase = final.phase;
  assert(lastPhase === "resolved", "story ends resolved", lastPhase);
  for (const target of phaseOrder) {
    const idx = phases.indexOf(target, cursor + 1);
    assert(idx > cursor, `phase arc includes ${target} in order`, phases);
    cursor = idx;
  }

  assert(final.savings === 5760, "savings arc lands at $5,760", final.savings);
  assert(final.approvedCount === 2, "two approvals recorded", final.approvedCount);
  assert(final.recap.length === 2, "recap shows both approved consequences", final.recap);
  assert(final.pendingIds.length === 0, "no pending cards at resolution", final.pendingIds);

  const savingsFrames = frames
    .filter((f) => f.event === "savings_update")
    .map((f) => ((f.data as { totalSavings?: number }).totalSavings ?? 0));
  assert(
    JSON.stringify(savingsFrames) === JSON.stringify([0, 0, 2160, 5760]) ||
      JSON.stringify(savingsFrames.filter((v, i, a) => a.indexOf(v) === i)) === JSON.stringify([0, 2160, 5760]),
    "savings canvas 0 → 2,160 → 5,760",
    savingsFrames
  );

  console.log(
    `[ui:check-story] ${frames.length} real SSE frames -> phases [${phases.join(" -> ")}] -> $${final.savings}/yr, offers [${vendorOffers.join(", ")}], roles [${transcriptRoles.join(", ")}]`
  );
  if (errors.length > 0) {
    throw new Error(`ui:check-story FAILED\n${errors.join("\n")}`);
  }
  console.log("STORY GATE PASSED");
  process.exitCode = 0;
}

run().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});