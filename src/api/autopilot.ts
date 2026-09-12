import { loadSubscriptions } from "../utils/data-files.js";
import { runDemo, withAgentLock } from "./demo.js";
import { broadcastSse, sseClientCount } from "./sse.js";
import type { AutopilotCheckEvent } from "../types/index.js";

export const DEFAULT_AUTOPILOT_INTERVAL_MS = 120000;

export function resolveAutopilotInterval(): number {
  const raw = process.env.AUTOPILOT_INTERVAL_MS;
  if (raw && raw.trim().length > 0) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_AUTOPILOT_INTERVAL_MS;
}

export interface AutopilotStatus {
  enabled: boolean;
  intervalMs: number;
  lastCheck: LastAutopilotCheck | null;
}

interface LastAutopilotCheck {
  checkedAt: string;
  subscriptionsChecked: number;
  flaggedPackages: number;
  cardsPending: number;
  actionsTaken: number;
  action: AutopilotCheckEvent["action"];
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastCheck: LastAutopilotCheck | null = null;
let checkInFlight = false;

export function startAutopilot(): void {
  if (timer) return;
  const intervalMs = resolveAutopilotInterval();
  timer = setInterval(() => {
    void runAutopilotCheck().catch((err) => {
      console.warn(`[autopilot] check failed: ${(err as Error).message}`);
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.warn(`[autopilot] scheduled agent checks every ${intervalMs}ms.`);
}

export function stopAutopilot(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function getAutopilotStatus(): AutopilotStatus {
  return {
    enabled: timer !== null,
    intervalMs: resolveAutopilotInterval(),
    lastCheck,
  };
}

export type AutopilotCheckResult =
  | { checked: true; reason: "ok"; check: LastAutopilotCheck }
  | { checked: false; reason: "busy" | "no_subscriptions" };

export async function runAutopilotCheck(): Promise<AutopilotCheckResult> {
  if (checkInFlight) return { checked: false, reason: "busy" };
  checkInFlight = true;
  try {
    const subscriptions = loadSubscriptions();
    if (subscriptions.length === 0) {
      return { checked: false, reason: "no_subscriptions" };
    }
    const result = await withAgentLock(() => runDemo({ mode: "live" }));
    if (result === null) {
      return { checked: false, reason: "busy" };
    }
    const check: LastAutopilotCheck = {
      checkedAt: new Date().toISOString(),
      subscriptionsChecked: result.subscriptionsChecked,
      flaggedPackages: result.decisionPackages,
      cardsPending: result.cardsPending,
      actionsTaken: result.autonomousActions,
      action: result.decisionPackages === 0 ? "nothing_found" : "flagged",
    };
    lastCheck = check;
    broadcastSse(
      "autopilot_check",
      { ...check, source: "autonomous" } satisfies AutopilotCheckEvent,
      { record: false }
    );
    if (sseClientCount() === 0) {
      console.warn(
        `[autopilot] checked ${check.subscriptionsChecked} sub(s): ${check.flaggedPackages} flagged, ${check.cardsPending} pending.`
      );
    }
    return { checked: true, reason: "ok", check };
  } finally {
    checkInFlight = false;
  }
}