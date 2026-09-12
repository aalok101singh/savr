import { useEffect, useRef } from "react";

export type OnSseEvent = (eventName: string, data: unknown) => void;

const EVENT_NAMES = [
  "guardian_update",
  "guardian_progress",
  "negotiation_message",
  "decision_card",
  "savings_update",
  "agent_status",
  "autopilot_check",
  "session_reset",
  "error",
];

export function useSSE(onEvent: OnSseEvent): void {
  const handlerRef = useRef<OnSseEvent>(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let closed = false;
    const source = new EventSource("/api/events");
    const handler = (e: Event): void => {
      if (closed) return;
      const messageEvent = e as MessageEvent<string>;
      let data: unknown = null;
      try {
        data = JSON.parse(messageEvent.data);
      } catch {
        data = messageEvent.data;
      }
      handlerRef.current(messageEvent.type, data);
    };
    for (const name of EVENT_NAMES) {
      source.addEventListener(name, handler);
    }
    source.addEventListener("open", () => {
      handlerRef.current("agent_status", null);
    });
    return () => {
      closed = true;
      source.close();
    };
  }, []);
}