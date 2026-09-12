import type { Server } from "http";
import express from "express";
import type { Express, Request, Response } from "express";
import { loadEnv } from "../utils/env.js";
import { getDemoDate } from "../utils/demo-clock.js";
import type { Offer } from "../types/index.js";
import {
  competitorEvidenceBonus,
  counterForRound,
  offerForAcceptance,
  resolveVendorPolicy,
  toOffer,
} from "./vendor-policies.js";
import {
  cachedResponse,
  getVendorState,
  hasCachedResponse,
  idempotencyKey,
  recordReceivedMessage,
  recordRound,
  setNegotiationStatus,
  trailingIdenticalOfferCount,
} from "./vendor-state.js";

export const DEFAULT_SANDBOX_PORT = 3001;

export function resolveSandboxPort(): number {
  const raw = process.env.SANDBOX_PORT;
  if (raw && raw.trim().length > 0) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_SANDBOX_PORT;
}

const STALL_AFTER_IDENTICAL_OFFERS = 4;

interface MessageBody {
  message: string;
  round: number;
  buyerCurrentPrice: number;
  buyerOfferPrice: number;
}

function parseMessageBody(body: unknown): MessageBody | { error: string; reason: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "invalid_request", reason: "Request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const message = record.message;
  const round = record.round;
  const buyerCurrentPrice = record.buyerCurrentPrice;
  const buyerOfferPrice = record.buyerOfferPrice;
  if (typeof message !== "string" || message.trim().length === 0) {
    return { error: "invalid_request", reason: "message must be a non-empty string." };
  }
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1) {
    return { error: "invalid_request", reason: "round must be a positive integer." };
  }
  if (typeof buyerCurrentPrice !== "number" || buyerCurrentPrice <= 0) {
    return { error: "invalid_request", reason: "buyerCurrentPrice must be a positive number." };
  }
  if (typeof buyerOfferPrice !== "number" || buyerOfferPrice <= 0) {
    return { error: "invalid_request", reason: "buyerOfferPrice must be a positive number." };
  }
  return { message: message.trim(), round, buyerCurrentPrice, buyerOfferPrice };
}

function expiresAtFor(offerDays: number): string {
  return new Date(getDemoDate().getTime() + offerDays * 24 * 60 * 60 * 1000).toISOString();
}

export function createVendorApp(): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/vendor/:vendorId/state", (req: Request, res: Response) => {
    const vendorId = String(req.params.vendorId);
    const policy = resolveVendorPolicy(vendorId);
    if (!policy) {
      res.status(404).json({ error: "unknown_vendor", vendorId });
      return;
    }
    const state = getVendorState(policy.vendorId);
    res.json({
      vendorId: policy.vendorId,
      buyerCurrentPrice: state.buyerCurrentPrice,
      vendorReservationPrice: policy.reservationPrice,
      roundsCompleted: state.roundsCompleted,
      currentOffer: state.currentOffer,
      status: state.status,
    });
  });

  app.get("/vendor/:vendorId/messages", (req: Request, res: Response) => {
    const vendorId = String(req.params.vendorId);
    const policy = resolveVendorPolicy(vendorId);
    if (!policy) {
      res.status(404).json({ error: "unknown_vendor", vendorId });
      return;
    }
    const state = getVendorState(policy.vendorId);
    res.json({ vendorId: policy.vendorId, receivedMessages: state.receivedMessages });
  });

  app.post("/vendor/:vendorId/message", (req: Request, res: Response) => {
    const vendorId = String(req.params.vendorId);
    const policy = resolveVendorPolicy(vendorId);
    if (!policy) {
      res.status(404).json({ error: "unknown_vendor", vendorId });
      return;
    }
    const parsed = parseMessageBody(req.body);
    if ("error" in parsed) {
      res.status(400).json(parsed);
      return;
    }
    const { message, round, buyerCurrentPrice, buyerOfferPrice } = parsed;

    const state = getVendorState(vendorId);
    state.buyerCurrentPrice = buyerCurrentPrice;

    const key = idempotencyKey(round, buyerOfferPrice);
    if (hasCachedResponse(state, key)) {
      res.json(cachedResponse(state, key));
      return;
    }

    recordReceivedMessage(state, { message, round, buyerCurrentPrice, buyerOfferPrice });

    const discountBonus = competitorEvidenceBonus(message);
    const counter = counterForRound(policy, buyerCurrentPrice, round, discountBonus);
    const expiresAt = expiresAtFor(14);

    let responseText: string;
    let offer: Offer;

    if (buyerOfferPrice < policy.reservationPrice) {
      responseText = `We're unable to go that low. Our best offer is $${counter.totalAnnual} with ${counter.terms.toLowerCase()}.`;
      offer = toOffer(counter, policy.seats, expiresAt);
    } else if (buyerOfferPrice >= counter.totalAnnual) {
      responseText = `We can accept your offer of $${buyerOfferPrice} with ${counter.terms.toLowerCase()}.`;
      offer = offerForAcceptance(policy, buyerOfferPrice, expiresAt);
      setNegotiationStatus(state, "accepted");
    } else if (trailingIdenticalOfferCount(state, buyerOfferPrice) >= STALL_AFTER_IDENTICAL_OFFERS - 1) {
      responseText = `We've made our best offer of $${counter.totalAnnual} with ${counter.terms.toLowerCase()}.`;
      offer = toOffer(counter, policy.seats, expiresAt);
    } else {
      responseText = `We appreciate your interest. Our best offer is $${counter.totalAnnual} with ${counter.terms.toLowerCase()}.`;
      offer = toOffer(counter, policy.seats, expiresAt);
    }

    recordRound(state, round, buyerOfferPrice, offer);
    // Terminal-state selection must be mutually exclusive: an acceptance reached
    // on the final allowed round is a SUCCESS, never a max_rounds exhaustion.
    if (state.status !== "accepted") {
      if (round >= policy.maxRounds) {
        setNegotiationStatus(state, "max_rounds");
      } else {
        setNegotiationStatus(state, "negotiating");
      }
    }

    const response = {
      status: "success",
      response: responseText,
      offer,
      vendorId,
      round,
    };
    state.responses[key] = response;
    res.json(response);
  });

  return app;
}

export interface SandboxServer {
  app: Express;
  server: Server;
  port: number;
}

export function startSandboxServer(
  port = resolveSandboxPort(),
  options: { unref?: boolean } = {}
): SandboxServer {
  const app = createVendorApp();
  const server = app.listen(port);
  if (options.unref) {
    server.unref();
  }
  const actualPort = (server.address() as { port: number } | null)?.port ?? port;
  return { app, server, port: actualPort };
}

export async function sandboxReachable(
  port = resolveSandboxPort(),
  timeoutMs = 1500
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  loadEnv();
  const { server, port } = startSandboxServer();
  console.error(`[sandbox] vendor sandbox listening on http://127.0.0.1:${port} (demo mode: ${process.env.DEMO_MODE})`);
  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1]?.endsWith("server.ts")) {
  main().catch((err) => {
    console.error(`[sandbox] fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}