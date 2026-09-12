import type { DirectorFrame, DirectorState } from "./types";
import { INITIAL_DIRECTOR_STATE, directorReducer } from "./reducer";

export type PacingKind = "live" | "replay";

export interface PacingConfig {
  kind: PacingKind;
  guardianMs?: number;
  messageMs?: number;
  cardMs?: number;
  savingsMs?: number;
  statusMs?: number;
  errorMs?: number;
}

export const LIVE_PACING: PacingConfig = { kind: "live" };

export const DEFAULT_REPLAY_PACING: PacingConfig = {
  kind: "replay",
  guardianMs: 700,
  messageMs: 1100,
  cardMs: 900,
  savingsMs: 700,
  statusMs: 350,
  errorMs: 300,
};

export function delayForEvent(event: string, pacing: PacingConfig): number {
  if (pacing.kind === "live") return 0;
  switch (event) {
    case "guardian_update":
      return pacing.guardianMs ?? 700;
    case "negotiation_message":
      return pacing.messageMs ?? 1100;
    case "decision_card":
      return pacing.cardMs ?? 900;
    case "savings_update":
      return pacing.savingsMs ?? 700;
    case "agent_status":
      return pacing.statusMs ?? 350;
    case "error":
      return pacing.errorMs ?? 300;
    default:
      return 0;
  }
}

export interface DirectorRun {
  cancel: () => void;
}

export function scheduleFrames(
  frames: DirectorFrame[],
  pacing: PacingConfig,
  onState: (state: DirectorState) => void,
  onDone?: () => void
): DirectorRun {
  let state: DirectorState = INITIAL_DIRECTOR_STATE;
  onState(state);
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let elapsed = 0;
  for (const frame of frames) {
    elapsed += delayForEvent(frame.event, pacing);
    const pending = frame;
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        state = directorReducer(state, pending);
        onState(state);
      }, elapsed)
    );
  }
  timers.push(
    setTimeout(() => {
      if (cancelled) return;
      onDone?.();
    }, elapsed)
  );
  return {
    cancel: () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    },
  };
}