// Build-time bearer token for state-changing routes. Only set for a public demo
// deployment (VITE_API_TOKEN at build time); local development leaves it empty so
// the API's loopback binding is the only protection needed. Optional-chaining keeps
// `import.meta.env` safe when this module runs under tsx (ui/scripts checkers).
const AUTH_TOKEN: string = import.meta.env?.VITE_API_TOKEN ?? "";

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`GET ${path} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  }
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `POST ${path} -> HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function fmtCompact(n: number): string {
  if (n >= 1000 && n % 1000 === 0) return `$${n / 1000}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n}`;
}

export function monthDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export async function sessionReset(): Promise<{ cleared: true; subscriptions: 0; company: null }> {
  return postJson("/api/session/reset");
}

export interface AutopilotStatus {
  enabled: boolean;
  intervalMs: number;
  lastCheck: {
    checkedAt: string;
    subscriptionsChecked: number;
    flaggedPackages: number;
    cardsPending: number;
    actionsTaken: number;
    action: "nothing_found" | "flagged";
  } | null;
}

export async function fetchAutopilotStatus(): Promise<AutopilotStatus> {
  return getJson("/api/autopilot/status");
}