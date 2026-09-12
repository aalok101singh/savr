import express from "express";
import type { Express, Request, Response } from "express";
import {
  defaultMemory,
  loadCards,
  loadCompany,
  loadPackages,
  loadPolicy,
  loadSubscriptions,
  saveCards,
  saveCompany,
  saveMemory,
  savePackages,
  saveSubscriptions,
} from "../utils/data-files.js";
import { deriveAgentStatus, computeSavings } from "./state.js";
import { CardTransitionError, approveCard, rejectCard } from "./post-approval.js";
import { resetDemo, runDemo, withAgentLock, type DemoMode } from "./demo.js";
import { broadcastSse, clearRecording, registerSseClient, getRecording } from "./sse.js";
import { getAutopilotStatus } from "./autopilot.js";
import { getDemoDate } from "../utils/demo-clock.js";
import type { Company, DecisionCard, Subscription } from "../types/index.js";

const API_PREFIX = "/api";
const SSE_HEARTBEAT_MS = 15000;

let lastMode: DemoMode = "mock";

function pendingCards(): DecisionCard[] {
  return loadCards().filter((c) => c.status === "pending");
}

function cardErrorResponse(res: Response, err: unknown): void {
  if (err instanceof CardTransitionError) {
    res.status(err.status).json({ error: (err as Error).message });
    return;
  }
  res.status(500).json({ error: (err as Error).message });
}

function isCompany(value: unknown): value is Company {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.name === "string" && typeof c.employees === "number" && typeof c.annualBudget === "number";
}

export function createApiApp(): Express {
  const app = express();
  app.use(express.json());

  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader("X-Savr-Mode", lastMode);
    next();
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get(`${API_PREFIX}/company`, (_req: Request, res: Response) => {
    res.json(loadCompany());
  });

  app.get(`${API_PREFIX}/policy`, (_req: Request, res: Response) => {
    res.json(loadPolicy());
  });

  app.get(`${API_PREFIX}/subscriptions`, (_req: Request, res: Response) => {
    res.json(loadSubscriptions());
  });

  app.get(`${API_PREFIX}/decisions`, (_req: Request, res: Response) => {
    res.json(loadPackages());
  });

  app.get(`${API_PREFIX}/decisions/pending`, (_req: Request, res: Response) => {
    res.json(pendingCards());
  });

  app.get(`${API_PREFIX}/decisions/:cardId`, (req: Request, res: Response) => {
    const cardId = String(req.params.cardId);
    const card = loadCards().find((c) => c.id === cardId);
    if (!card) {
      res.status(404).json({ error: `Card '${cardId}' not found.` });
      return;
    }
    res.json(card);
  });

  app.post(`${API_PREFIX}/decisions/:cardId/approve`, (req: Request, res: Response) => {
    try {
      res.json(approveCard(String(req.params.cardId)));
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  app.post(`${API_PREFIX}/decisions/:cardId/reject`, (req: Request, res: Response) => {
    try {
      res.json(rejectCard(String(req.params.cardId)));
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  app.get(`${API_PREFIX}/negotiation/:subscriptionId`, (req: Request, res: Response) => {
    const subscriptionId = String(req.params.subscriptionId);
    const card = loadCards().find((c) => c.subscriptionId === subscriptionId && c.action === "NEGOTIATE");
    if (!card?.negotiation) {
      res.status(404).json({ error: `Subscription '${subscriptionId}' was never negotiated.` });
      return;
    }
    res.json(card.negotiation);
  });

  app.get(`${API_PREFIX}/savings`, (_req: Request, res: Response) => {
    res.json(computeSavings(loadCards()));
  });

  app.get(`${API_PREFIX}/agent/status`, (_req: Request, res: Response) => {
    res.json(deriveAgentStatus());
  });

  app.get(`${API_PREFIX}/events`, (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("retry: 2000\n\n");
    const unregister = registerSseClient(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, SSE_HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unregister();
    });
  });

  app.post(`${API_PREFIX}/demo/reset`, (_req: Request, res: Response) => {
    res.json(resetDemo());
  });

  app.get(`${API_PREFIX}/demo/recording`, (_req: Request, res: Response) => {
    res.json(getRecording());
  });

  app.post(`${API_PREFIX}/session/company`, (req: Request, res: Response) => {
    const body = req.body;
    if (!isCompany(body)) {
      res
        .status(400)
        .json({ error: "Expected a Company object with string 'name', number 'employees', number 'annualBudget'." });
      return;
    }
    saveCompany(body);
    broadcastSse("agent_status", deriveAgentStatus());
    res.json({ status: "ok", company: body });
  });

  app.post(`${API_PREFIX}/demo/run`, async (req: Request, res: Response) => {
    try {
      const mode: DemoMode = req.body?.mode === "live" ? "live" : "mock";
      lastMode = mode;
      const result = await withAgentLock(() => runDemo({ mode }));
      if (result === null) {
        res
          .status(409)
          .json({ error: "The agent is already running a check or demo; try again shortly." });
        return;
      }
      res.json(result);
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  app.post(`${API_PREFIX}/session/reset`, (_req: Request, res: Response) => {
    saveSubscriptions([]);
    saveCompany({ name: "", employees: 0, annualBudget: 0 });
    saveMemory(defaultMemory());
    saveCards([]);
    savePackages([]);
    clearRecording();
    broadcastSse("session_reset", { cleared: true }, { record: false });
    broadcastSse("savings_update", computeSavings([]), { record: false });
    broadcastSse("agent_status", deriveAgentStatus(), { record: false });
    res.json({ cleared: true, subscriptions: 0, company: null });
  });

  app.get(`${API_PREFIX}/autopilot/status`, (_req: Request, res: Response) => {
    res.json(getAutopilotStatus());
  });

  app.post(`${API_PREFIX}/stack/import`, (req: Request, res: Response) => {
    const body = req.body;
    if (!Array.isArray(body) || body.length === 0) {
      res.status(400).json({ error: "Expected a non-empty array of subscriptions." });
      return;
    }
    const subs: Subscription[] = [];
    const required: Array<keyof Subscription> = ["id", "vendorName", "category", "annualCost"];
    for (const raw of body) {
      const item = raw as Record<string, unknown>;
      for (const key of required) {
        if (typeof item[key] === "undefined") {
          res.status(400).json({ error: `Subscription missing required field '${String(key)}'.` });
          return;
        }
      }
      if (item.billingModel !== "seat_based" && item.billingModel !== "usage_based") {
        res.status(400).json({ error: `Subscription '${String(item.id)}' has invalid billingModel.` });
        return;
      }
      subs.push({
        id: String(item.id),
        vendorName: String(item.vendorName),
        category: String(item.category),
        billingModel: item.billingModel as Subscription["billingModel"],
        status: item.status === "cancelled" || item.status === "switched" ? (item.status as Subscription["status"]) : "active",
        contractStart: typeof item.contractStart === "string" ? item.contractStart : getDemoDate().toISOString(),
        contractEnd: typeof item.contractEnd === "string" ? item.contractEnd : getDemoDate().toISOString(),
        renewalDate: typeof item.renewalDate === "string" ? item.renewalDate : getDemoDate().toISOString(),
        billingCycle: item.billingCycle === "monthly" ? "monthly" : "annual",
        annualCost: Number(item.annualCost),
        currentPeriodCost: Number(item.currentPeriodCost ?? item.annualCost),
        renewalCost: typeof item.renewalCost === "number" ? (item.renewalCost as number) : null,
        seatsPurchased: typeof item.seatsPurchased === "number" ? (item.seatsPurchased as number) : null,
        seatsActive: typeof item.seatsActive === "number" ? (item.seatsActive as number) : null,
        pricePerSeat: typeof item.pricePerSeat === "number" ? (item.pricePerSeat as number) : null,
        priceIncreasePct: typeof item.priceIncreasePct === "number" ? (item.priceIncreasePct as number) : null,
        autoRenew: item.autoRenew !== false,
        usageMetric: typeof item.usageMetric === "string" ? item.usageMetric : null,
        notes: typeof item.notes === "string" ? item.notes : "",
      });
    }
    saveSubscriptions(subs);
    res.json({ status: "ok", imported: subs.length, asOf: getDemoDate().toISOString() });
  });

  app.post(`${API_PREFIX}/debug/negotiation/:subscriptionId/accept`, (req: Request, res: Response) => {
    debugResolveNegotiation(String(req.params.subscriptionId), "accepted", res);
  });

  app.post(`${API_PREFIX}/debug/negotiation/:subscriptionId/reject`, (req: Request, res: Response) => {
    debugResolveNegotiation(String(req.params.subscriptionId), "rejected", res);
  });

  return app;
}

function debugResolveNegotiation(subscriptionId: string, resolution: "accepted" | "rejected", res: Response): void {
  const cards = loadCards();
  const card = cards.find((c) => c.subscriptionId === subscriptionId && c.action === "NEGOTIATE");
  if (!card?.negotiation) {
    res.status(404).json({ error: `Subscription '${subscriptionId}' was never negotiated.` });
    return;
  }
  const negotiation = { ...card.negotiation };
  negotiation.round = negotiation.round || 1;
  negotiation.resolution = resolution;
  negotiation.messages = [
    ...negotiation.messages,
    {
      role: "agent",
      content:
        resolution === "accepted"
          ? "The vendor offer is within our acceptable range — DEBUG accept."
          : "The vendor offer is not acceptable — DEBUG reject.",
      timestamp: getDemoDate().toISOString(),
      round: negotiation.round,
      buyerOfferPrice: negotiation.buyerOfferPrice,
      currentOffer: negotiation.currentOffer,
    },
  ];
  card.negotiation = negotiation;
  card.realizedSavings =
    resolution === "accepted" && negotiation.currentOffer
      ? negotiation.currentPrice - negotiation.currentOffer.totalAnnual
      : 0;
  const updatedCards = cards.map((c) => (c.id === card.id ? card : c));
  saveCards(updatedCards);

  broadcastSse("negotiation_message", {
    subscriptionId,
    round: negotiation.round,
    role: "agent",
    content: negotiation.messages[negotiation.messages.length - 1].content,
    currentOffer: negotiation.currentOffer,
    targetPrice: negotiation.targetPrice,
    maxAcceptablePrice: negotiation.maxAcceptablePrice,
    buyerOfferPrice: negotiation.buyerOfferPrice,
    proposedAcceptPrice: negotiation.proposedAcceptPrice,
  });
  broadcastSse("decision_card", {
    cardId: card.id,
    subscriptionId: card.subscriptionId,
    action: card.action,
    status: card.status,
    estimatedSavings: card.estimatedSavings,
    realizedSavings: card.realizedSavings,
    summary: card.summary,
  });
  res.json({ card });
}