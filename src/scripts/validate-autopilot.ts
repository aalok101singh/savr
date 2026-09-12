import { loadEnv } from "../utils/env.js";
import { resetDemo, runDemo, withAgentLock } from "../api/demo.js";
import { runAutopilotCheck } from "../api/autopilot.js";
import { registerSseClient } from "../api/sse.js";
import { seedSubscriptions, saveSubscriptions } from "../utils/data-files.js";
import type { AutopilotCheckEvent } from "../types/index.js";

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
  process.env.SAVR_MODEL = "local";
  loadEnv();
  resetDemo();

  // ─── T1 — the shared agent lock serializes manual & autonomous runs ───
  let released: () => void = () => undefined;
  const held = withAgentLock(
    () =>
      new Promise<"first">((resolve) => {
        released = () => resolve("first");
      })
  );
  await sleep(20);
  const second = await withAgentLock(() => Promise.resolve("second"));
  assert(second === null, "T1 concurrent run acquires no lock (returns null)", second);
  released();
  const firstResult = await held;
  assert(firstResult === "first", "T1 suspended run completes after lock release", firstResult);

  // ─── T2 — no stack loaded -> scheduler declines silently ───
  resetDemo();
  saveSubscriptions([]);
  const empty = await runAutopilotCheck();
  assert(empty.checked === false && empty.reason === "no_subscriptions", "T2 no-stack check declines", empty);

  // ─── T3 — with a stack, the agent checks on its own and broadcasts ───
  saveSubscriptions(seedSubscriptions());
  const frames: string[] = [];
  const unregister = registerSseClient({ write: (chunk: string) => frames.push(String(chunk)) } as never);
  const check = await runAutopilotCheck();
  assert(check.checked === true && check.reason === "ok", "T3 autonomous check ran", check);
  assert(
    check.checked && check.check.flaggedPackages >= 4,
    "T3 Acme stack flagged the canonical candidates",
    check.checked ? check.check.flaggedPackages : check
  );
  const eventFrame = frames
    .map((chunk) => chunk.split(/\r?\n\r?\n/))
    .flat()
    .find((block) => block.includes("autopilot_check"));
  assert(eventFrame !== undefined, "T3 autopilot_check broadcast to live clients", frames.length);
  if (eventFrame) {
    const dataLine = eventFrame.split(/\r?\n/).find((l) => l.startsWith("data:"));
    const parsed = dataLine ? (JSON.parse(dataLine.slice(5).trim()) as AutopilotCheckEvent) : null;
    assert(parsed?.source === "autonomous", "T3 event flagged source=autonomous", parsed);
    assert(parsed?.action === "flagged", "T3 event reported flagged", parsed);
  }
  unregister();

  // ─── T4 — scheduler defers while a manual run is in flight ───
  let stopTheManual: () => void = () => undefined;
  const manual = withAgentLock(
    () =>
      new Promise<"manual">((resolve) => {
        stopTheManual = () => resolve("manual");
      })
  );
  await sleep(20);
  const during = await runAutopilotCheck();
  assert(during.checked === false && during.reason === "busy", "T4 scheduler skips while agent busy", during);
  stopTheManual();
  await manual;

  // ─── T5 — check reaises nothing, data restored pristine ───
  resetDemo();
  const pristine = await import("../utils/data-files.js").then((m) => m.loadSubscriptions());
  assert(pristine.length === 14, "T5 demo/reset restores 14 subs after autonomous run", pristine.length);

  if (errors.length > 0) {
    console.error("validate:autopilot FAILED");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("T1 PASS -> agent lock prevents concurrent manual + autonomous runs");
  console.log("T2 PASS -> scheduler declines when no stack is loaded");
  console.log("T3 PASS -> autonomous check ran unprompted, flagged canonical candidates, broadcast autopilot_check");
  console.log("T4 PASS -> scheduler defers (busy) while a manual run holds the lock");
  console.log("T5 PASS -> data restored pristine after autonomous checks");
  console.log("AUTOPILOT GATE PASSED");
  process.exitCode = 0;
}

run().catch((err) => {
  console.error(`[validate:autopilot] fatal: ${(err as Error).message}`);
  process.exitCode = 1;
});