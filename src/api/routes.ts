import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
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

// Debug negotiation routes exist only for development; they must be explicitly
// enabled and still pass the auth gate + agent lock like every other endpoint.
const DEBUG_ROUTES_ENABLED = process.env.DEBUG_MODE === "true";
// Optional bearer token for state-changing and debug routes. When unset the API
// still binds to the loopback interface by default, so nothing is exposed to the
// network; any deployment that sets HOST to bind beyond loopback MUST also set
// API_TOKEN or every POST /api/* route rejects with 401.
const API_TOKEN = process.env.API_TOKEN?.trim() ?? "";

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

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!API_TOKEN) {
    next();
    return;
  }
  if (req.header("Authorization") !== `Bearer ${API_TOKEN}`) {
    res.status(401).json({ error: "Unauthorized. Configure API_TOKEN and send Authorization: Bearer <token>." });
    return;
  }
  next();
}

// Run a state mutation through the shared agent lock. Returns the mutation result
// or throws a 409 when the agent (demo/run, autopilot, or a negotiation triggered
// by an approval) is already running — resets, imports, and approvals must never
// race the agent or each other over the same JSON files.
async function lockGuard<T>(fn: () => Promise<T>): Promise<T> {
  const result = await withAgentLock(fn);
  if (result === null) {
    throw new CardTransitionError("The agent is already running a check or demo; try again shortly.", 409);
  }
  return result;
}

export function createApiApp(): Express {
  const app = express();
  app.use(express.json());

  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader("X-Savr-Mode", lastMode);
    next();
  });

  // Every state-changing /api route requires the configured bearer token.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "POST" && req.path.startsWith(API_PREFIX)) {
      requireAuth(req, res, next);
      return;
    }
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

  app.post(`${API_PREFIX}/decisions/:cardId/approve`, async (req: Request, res: Response) => {
    try {
      const result = await lockGuard(() => approveCard(String(req.params.cardId)));
      res.json(result);
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  app.post(`${API_PREFIX}/decisions/:cardId/reject`, async (req: Request, res: Response) => {
    try {
      const result = await lockGuard(() => Promise.resolve(rejectCard(String(req.params.cardId))));
      res.json(result);
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

  app.post(`${API_PREFIX}/demo/reset`, async (_req: Request, res: Response) => {
    try {
      const result = await lockGuard(() => Promise.resolve(resetDemo()));
      res.json(result);
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  app.get(`${API_PREFIX}/demo/recording`, (_req: Request, res: Response) => {
    res.json(getRecording());
  });

  app.post(`${API_PREFIX}/session/company`, async (req: Request, res: Response) => {
    const body = req.body;
    if (!isCompany(body)) {
      res
        .status(400)
        .json({ error: "Expected a Company object with string 'name', number 'employees', number 'annualBudget'." });
      return;
    }
    try {
      await lockGuard(() => {
        saveCompany(body);
        broadcastSse("agent_status", deriveAgentStatus());
        return Promise.resolve();
      });
      res.json({ status: "ok", company: body });
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  app.post(`${API_PREFIX}/demo/run`, async (req: Request, res: Response) => {
    try {
      const mode: DemoMode = req.body?.mode === "live" ? "live" : "mock";
      lastMode = mode;
      const result = await lockGuard(() => runDemo({ mode }));
      res.json(result);
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  app.post(`${API_PREFIX}/session/reset`, async (_req: Request, res: Response) => {
    try {
      await lockGuard(() => {
        saveSubscriptions([]);
        saveCompany({ name: "", employees: 0, annualBudget: 0 });
        saveMemory(defaultMemory());
        saveCards([]);
        savePackages([]);
        clearRecording();
        broadcastSse("session_reset", { cleared: true }, { record: false });
        broadcastSse("savings_update", computeSavings([]), { record: false });
        broadcastSse("agent_status", deriveAgentStatus(), { record: false });
        return Promise.resolve();
      });
      res.json({ cleared: true, subscriptions: 0, company: null });
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  app.get(`${API_PREFIX}/autopilot/status`, (_req: Request, res: Response) => {
    res.json(getAutopilotStatus());
  });

  app.post(`${API_PREFIX}/stack/import`, async (req: Request, res: Response) => {
    const body = req.body;
    if (!Array.isArray(body) || body.length === 0) {
      res.status(400).json({ error: "Expected a non-empty array of subscriptions." });
      return;
    }
    const parsed = parseStackImport(body);
    if (!parsed.ok) {
      res
        .status(400)
        .json({ error: "Stack import rejected: subscription validation failed.", errors: parsed.errors });
      return;
    }
    try {
      const result = await lockGuard(() =>
        Promise.resolve(applyStackImport(parsed.subs))
      );
      res.json(result);
    } catch (err) {
      cardErrorResponse(res, err);
    }
  });

  if (DEBUG_ROUTES_ENABLED) {
    app.post(`${API_PREFIX}/debug/negotiation/:subscriptionId/accept`, async (req: Request, res: Response) => {
      await lockGuard(() => {
        debugResolveNegotiation(String(req.params.subscriptionId), "accepted", res);
        return Promise.resolve();
      }).catch((err) => cardErrorResponse(res, err));
    });

    app.post(`${API_PREFIX}/debug/negotiation/:subscriptionId/reject`, async (req: Request, res: Response) => {
      await lockGuard(() => {
        debugResolveNegotiation(String(req.params.subscriptionId), "rejected", res);
        return Promise.resolve();
      }).catch((err) => cardErrorResponse(res, err));
    });
  }

  return app;
}

// ---------------------------------------------------------------------------
// Stack import: an atomic session replacement with strict runtime validation.
// ---------------------------------------------------------------------------

interface ImportFieldError {
  path: string;
  message: string;
}

type ParsedImport =
  | { ok: true; subs: Subscription[] }
  | { ok: false; errors: ImportFieldError[] };

type ImportRaw = Record<string, unknown>;

const REQUIRED_STRING_FIELDS: Array<[keyof Subscription, string]> = [
  ["id", "id"],
  ["vendorName", "vendorName"],
  ["category", "category"],
];

const OPTIONAL_MONEY_FIELDS: Array<[keyof Subscription, string]> = [
  ["renewalCost", "renewalCost"],
  ["seatsPurchased", "seatsPurchased"],
  ["seatsActive", "seatsActive"],
  ["pricePerSeat", "pricePerSeat"],
  ["priceIncreasePct", "priceIncreasePct"],
];

const OPTIONAL_DATE_FIELDS: Array<[keyof Subscription, string]> = [
  ["contractStart", "contractStart"],
  ["contractEnd", "contractEnd"],
  ["renewalDate", "renewalDate"],
];

function parseMoney(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return !Number.isNaN(parsed) && Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validateElement(raw: unknown, index: number, errors: ImportFieldError[]): ImportRaw | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push({ path: `[${index}]`, message: `element ${index} must be a plain object (got ${raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw}).` });
    return null;
  }
  return raw as ImportRaw;
}

function validateOptionalNumberField(
  item: ImportRaw,
  field: keyof Subscription,
  label: string,
  index: number,
  errors: ImportFieldError[]
): void {
  if (!(field in item)) return;
  const value = item[field];
  if (value === null) return;
  const parsed = typeof value === "number" ? value : parseMoney(value);
  if (parsed === null || parsed < 0) {
    errors.push({ path: `[${index}].${label}`, message: `${label} for element ${index} must be a finite, non-negative number.` });
  }
}

function validateOptionalDateField(
  item: ImportRaw,
  field: keyof Subscription,
  label: string,
  index: number,
  errors: ImportFieldError[]
): void {
  if (!(field in item)) return;
  const value = item[field];
  if (typeof value !== "string") {
    errors.push({ path: `[${index}].${label}`, message: `${label} for element ${index} must be an ISO date string.` });
    return;
  }
  if (Number.isNaN(new Date(value).getTime())) {
    errors.push({ path: `[${index}].${label}`, message: `${label} for element ${index} is not a valid date.` });
  }
}

// Validate every imported element and field against a runtime schema BEFORE any
// conversion, subscription construction, or persistence. Required string fields
// must be non-empty; monetary and seat fields must be finite and non-negative;
// optional dates must parse; identifiers must be unique. Every violation is
// returned as a field-specific error and the whole import is rejected with 400.
export function parseStackImport(body: unknown[]): ParsedImport {
  const errors: ImportFieldError[] = [];
  const seenIds = new Set<string>();
  const subs: Subscription[] = [];
  const nowIso = getDemoDate().toISOString();

  body.forEach((raw, index) => {
    const item = validateElement(raw, index, errors);
    if (!item) return;

    for (const [key, label] of REQUIRED_STRING_FIELDS) {
      const value = item[key];
      if (typeof value !== "string" || value.trim() === "") {
        errors.push({ path: `[${index}].${label}`, message: `${label} is required for element ${index} and must be a non-empty string.` });
      }
    }
    const id = typeof item.id === "string" ? item.id : "";
    if (id && seenIds.has(id)) {
      errors.push({ path: `[${index}].id`, message: `duplicate subscription id '${id}' (already used at index ${[...seenIds].indexOf(id)}).` });
    }
    if (id) seenIds.add(id);

    if ("annualCost" in item) {
      const value = parseMoney(item.annualCost);
      if (value === null || value < 0) {
        errors.push({ path: `[${index}].annualCost`, message: `annualCost for element ${index} must be a finite, non-negative number.` });
      }
    } else {
      errors.push({ path: `[${index}].annualCost`, message: `annualCost is required for element ${index}.` });
    }
    if ("currentPeriodCost" in item) {
      const value = parseMoney(item.currentPeriodCost);
      if (value === null || value < 0) {
        errors.push({ path: `[${index}].currentPeriodCost`, message: `currentPeriodCost for element ${index} must be a finite, non-negative number.` });
      }
    }

    if ("billingModel" in item && item.billingModel !== "seat_based" && item.billingModel !== "usage_based") {
      errors.push({ path: `[${index}].billingModel`, message: `billingModel for element ${index} must be 'seat_based' or 'usage_based'.` });
    }
    if ("status" in item && item.status !== "active" && item.status !== "cancelled" && item.status !== "switched") {
      errors.push({ path: `[${index}].status`, message: `status for element ${index} must be 'active', 'cancelled', or 'switched'.` });
    }
    if ("billingCycle" in item && item.billingCycle !== "monthly" && item.billingCycle !== "annual") {
      errors.push({ path: `[${index}].billingCycle`, message: `billingCycle for element ${index} must be 'monthly' or 'annual'.` });
    }
    if ("autoRenew" in item && typeof item.autoRenew !== "boolean") {
      errors.push({ path: `[${index}].autoRenew`, message: `autoRenew for element ${index} must be a boolean.` });
    }
    if ("usageMetric" in item && item.usageMetric !== null && typeof item.usageMetric !== "string") {
      errors.push({ path: `[${index}].usageMetric`, message: `usageMetric for element ${index} must be a string or null.` });
    }
    if ("notes" in item && typeof item.notes !== "string") {
      errors.push({ path: `[${index}].notes`, message: `notes for element ${index} must be a string.` });
    }
    for (const [key, label] of OPTIONAL_MONEY_FIELDS) {
      validateOptionalNumberField(item, key, label, index, errors);
    }
    for (const [key, label] of OPTIONAL_DATE_FIELDS) {
      validateOptionalDateField(item, key, label, index, errors);
    }

    if (errors.length > 0 && errors.some((e) => e.path.startsWith(`[${index}]`))) {
      return;
    }

    const billingModel = item.billingModel === "usage_based" ? "usage_based" : "seat_based";
    const status = item.status === "cancelled" || item.status === "switched" ? (item.status as Subscription["status"]) : "active";
    const billingCycle = item.billingCycle === "monthly" ? "monthly" : "annual";
    const annualCost = parseMoney(item.annualCost) ?? 0;
    const currentPeriodCost = parseMoney(item.currentPeriodCost) ?? annualCost;

    subs.push({
      id: String(item.id),
      vendorName: String(item.vendorName),
      category: String(item.category),
      billingModel,
      status,
      contractStart: typeof item.contractStart === "string" ? (item.contractStart as string) : nowIso,
      contractEnd: typeof item.contractEnd === "string" ? (item.contractEnd as string) : nowIso,
      renewalDate: typeof item.renewalDate === "string" ? (item.renewalDate as string) : nowIso,
      billingCycle,
      annualCost,
      currentPeriodCost,
      renewalCost: typeof item.renewalCost === "number" ? (item.renewalCost as number) : null,
      seatsPurchased: typeof item.seatsPurchased === "number" ? (item.seatsPurchased as number) : null,
      seatsActive: typeof item.seatsActive === "number" ? (item.seatsActive as number) : null,
      pricePerSeat: typeof item.pricePerSeat === "number" ? (item.pricePerSeat as number) : null,
      priceIncreasePct: typeof item.priceIncreasePct === "number" ? (item.priceIncreasePct as number) : null,
      autoRenew: item.autoRenew !== false,
      usageMetric: typeof item.usageMetric === "string" ? (item.usageMetric as string) : null,
      notes: typeof item.notes === "string" ? (item.notes as string) : "",
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, subs };
}

function applyStackImport(subs: Subscription[]): { status: string; imported: number; asOf: string } {
  // A stack import replaces the procurement session wholesale: the subscriptions
  // AND every artifact derived from the previous stack (decision packages, cards,
  // memory, savings, and the demo recording) are cleared atomically so nothing
  // from the old stack leaks into Guardian or negotiation decisions.
  saveSubscriptions(subs);
  saveCards([]);
  savePackages([]);
  saveMemory(defaultMemory());
  clearRecording();
  broadcastSse("savings_update", computeSavings([]), { record: false });
  broadcastSse("agent_status", deriveAgentStatus(), { record: false });
  return { status: "ok", imported: subs.length, asOf: getDemoDate().toISOString() };
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
  broadcastSse("agent_status", deriveAgentStatus());
  res.json({ status: "ok", resolution, subscriptionId });
}