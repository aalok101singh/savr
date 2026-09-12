import { existsSync } from "fs";
import { join } from "path";
import express from "express";
import type { Request, Response } from "express";
import { ROOT, loadEnv } from "../utils/env.js";
import { createApiApp } from "./routes.js";
import { ensureSeed } from "../utils/data-files.js";
import { resolveAutopilotInterval, startAutopilot } from "./autopilot.js";

export const DEFAULT_API_PORT = 3000;

export function resolveApiPort(): number {
  const raw = process.env.API_PORT;
  if (raw && raw.trim().length > 0) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_API_PORT;
}

export function createServerApp() {
  const app = createApiApp();
  const uiDist = join(ROOT, "ui", "dist");
  const uiIndex = join(uiDist, "index.html");
  if (existsSync(uiIndex)) {
    app.use(express.static(uiDist));
    app.use((req: Request, res: Response, next: () => void) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        res.type("html").sendFile(uiIndex);
        return;
      }
      next();
    });
  } else {
    console.warn(
      `[api] ui/dist/index.html not found; serving the API without the built UI. Run 'npm --prefix ui run build'.`
    );
  }
  return app;
}

async function main(): Promise<void> {
  loadEnv();
  ensureSeed();
  const port = resolveApiPort();
  const app = createServerApp();
  const server = app.listen(port);
  const actualPort = (server.address() as { port: number } | null)?.port ?? port;
  console.error(`[api] Savr API listening on http://127.0.0.1:${actualPort} (demo mode: ${process.env.DEMO_MODE})`);
  if (process.env.AUTOPILOT_ENABLED === "true") {
    startAutopilot();
    console.error(
      `[api] autonomous checks every ${resolveAutopilotInterval()}ms (AUTOPILOT_ENABLED=true).`
    );
  } else {
    console.error("[api] autonomous checks disabled (opt in with AUTOPILOT_ENABLED=true).");
  }

  const shutdown = (): void => {
    console.error("[api] shutting down.");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1]?.endsWith("server.ts")) {
  main().catch((err) => {
    console.error(`[api] fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}