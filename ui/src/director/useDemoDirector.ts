import { useCallback, useEffect, useRef, useState } from "react";
import { useSSE } from "../hooks/useSSE";
import { INITIAL_DIRECTOR_STATE, directorReducer, reduceAll } from "./reducer";
import type { DirectorFrame, DirectorState } from "./types";
import { DEFAULT_REPLAY_PACING, LIVE_PACING, scheduleFrames, type PacingConfig } from "./runner";

export interface DemoDirector {
  state: DirectorState;
  pacing: PacingConfig;
  live: boolean;
  replaying: boolean;
  playRecording: (frames: DirectorFrame[], pacing?: PacingConfig) => void;
  stopReplay: () => void;
  hydrate: (frames: DirectorFrame[]) => void;
}

export function useDemoDirector(): DemoDirector {
  const [state, setState] = useState<DirectorState>(INITIAL_DIRECTOR_STATE);
  const [pacing, setPacing] = useState<PacingConfig>(LIVE_PACING);
  const [replaying, setReplaying] = useState(false);
  const cancelRef = useRef<() => void>(() => undefined);
  const liveBufferRef = useRef<DirectorFrame[]>([]);
  const replayingRef = useRef(false);

  const applyFrames = useCallback((frames: DirectorFrame[]) => {
    setState((prev) => reduceAll(prev, frames));
  }, []);

  const flushLiveBuffer = useCallback(() => {
    const buffered = liveBufferRef.current;
    liveBufferRef.current = [];
    if (buffered.length > 0) applyFrames(buffered);
  }, [applyFrames]);

  useSSE((event, data) => {
    const frame: DirectorFrame = { event, data };
    if (replayingRef.current) {
      liveBufferRef.current.push(frame);
      return;
    }
    setState((prev) => directorReducer(prev, frame));
  });

  const stopReplay = useCallback(() => {
    cancelRef.current();
    replayingRef.current = false;
    setReplaying(false);
    setPacing(LIVE_PACING);
    flushLiveBuffer();
  }, [flushLiveBuffer]);

  const playRecording = useCallback(
    (frames: DirectorFrame[], cfg?: PacingConfig) => {
      cancelRef.current();
      liveBufferRef.current = [];
      replayingRef.current = true;
      setReplaying(true);
      const nextPacing = cfg ?? DEFAULT_REPLAY_PACING;
      setPacing(nextPacing);
      setState(INITIAL_DIRECTOR_STATE);
      const run = scheduleFrames(frames, nextPacing, (s) => setState(s), () => stopReplay());
      cancelRef.current = () => {
        run.cancel();
      };
    },
    [stopReplay]
  );

  const hydrate = useCallback((frames: DirectorFrame[]) => {
    cancelRef.current();
    liveBufferRef.current = [];
    replayingRef.current = false;
    setReplaying(false);
    setPacing(LIVE_PACING);
    setState(reduceAll(INITIAL_DIRECTOR_STATE, frames));
  }, []);

  useEffect(() => {
    return () => {
      cancelRef.current();
    };
  }, []);

  return {
    state,
    pacing,
    live: pacing.kind === "live",
    replaying,
    playRecording,
    stopReplay,
    hydrate,
  };
}