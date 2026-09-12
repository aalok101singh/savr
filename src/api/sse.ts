import type { Response } from "express";

export type SseEventName =
  | "guardian_update"
  | "guardian_progress"
  | "negotiation_message"
  | "decision_card"
  | "savings_update"
  | "agent_status"
  | "autopilot_check"
  | "session_reset"
  | "error";

interface SseClient {
  id: number;
  res: Response;
}

export interface RecordedFrame {
  event: SseEventName;
  data: unknown;
}

const MAX_RECORDED_FRAMES = 500;

let clients: SseClient[] = [];
let nextClientId = 1;
const recording: RecordedFrame[] = [];

export function registerSseClient(res: Response): () => void {
  const client: SseClient = { id: nextClientId++, res };
  clients.push(client);
  return () => {
    clients = clients.filter((c) => c.id !== client.id);
  };
}

export function broadcastSse(event: SseEventName, data: unknown, opts: { record?: boolean } = {}): void {
  if (opts.record !== false) {
    recording.push({ event, data });
    if (recording.length > MAX_RECORDED_FRAMES) {
      recording.splice(0, recording.length - MAX_RECORDED_FRAMES);
    }
  }
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(frame);
    } catch {
      // Client gone; the close handler unregisters it.
    }
  }
}

export function getRecording(): RecordedFrame[] {
  return recording.map((f) => ({ event: f.event, data: f.data }));
}

export function clearRecording(): void {
  recording.length = 0;
}

export function sseClientCount(): number {
  return clients.length;
}