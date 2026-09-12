import { tool, type Tool } from "@strands-agents/sdk";
import { z } from "zod";
import { PolicySchema } from "../schemas.js";
import type { Evidence } from "../../types/index.js";
import { loadPolicy } from "../../utils/data-files.js";
import { checkRenewals } from "./check-renewals.js";
import { benchmarkPricing } from "./benchmark-pricing.js";
import { searchAlternatives } from "./search-alternatives.js";
import { sendNegotiationMessage } from "./send-negotiation-message.js";
import { parseVendorResponse } from "./parse-vendor-response.js";
import { checkPolicy } from "./check-policy.js";

/**
 * Tool surface for the Guardian agent.
 * `webEvidence` is the per-run overlay from the live web-search enrichment
 * (`src/agent/web-evidence.ts`). Optional: when absent (mock runs), research tools
 * consult only the cached evidence, exactly as before — no behavior change.
 *
 * `opts.negotiationTool` defaults to `true` for the Negotiator. The Guardian never
 * receives `send_negotiation_message`: contacting a vendor is only legal from the
 * approved NEGOTIATE transition, never from a recommendation evaluation.
 */
export function buildTools(
  webEvidence?: Record<string, Evidence[]>,
  opts: { negotiationTool?: boolean } = {}
): Tool[] {
  const tools: Tool[] = [
    tool({
      name: "check_renewals",
      description:
        "Find subscriptions whose renewalDate is within the given number of days of the current evaluation date.",
      inputSchema: z.object({
        windowDays: z.number().int().positive().describe("Number of days ahead to look for renewals."),
      }),
      callback: ({ windowDays }) => checkRenewals(windowDays),
    }),
    tool({
      name: "benchmark_pricing",
      description:
        "Look up current market benchmark pricing for a vendor in a category. Returns Evidence when available.",
      inputSchema: z.object({
        category: z.string().describe("Product category, e.g. Productivity."),
        vendorId: z.string().describe("Canonical vendor id, e.g. notion."),
      }),
      callback: ({ category, vendorId }) => benchmarkPricing(category, vendorId, webEvidence),
    }),
    tool({
      name: "search_alternatives",
      description:
        "Search for alternative vendors in a category that could replace the current vendor.",
      inputSchema: z.object({
        category: z.string().describe("Product category, e.g. Video."),
        currentVendorId: z.string().describe("Canonical vendor id of the vendor to replace."),
      }),
      callback: ({ category, currentVendorId }) => searchAlternatives(category, currentVendorId, webEvidence),
    }),
    tool({
      name: "parse_vendor_response",
      description:
        "Parse a vendor response into structured negotiation fields: counterOffer, status, terms, and reasoning.",
      inputSchema: z.object({
        response: z.string(),
      }),
      callback: ({ response }) => parseVendorResponse(response),
    }),
    tool({
      name: "check_policy",
      description:
        "Check if an action is allowed under the current procurement policy. Returns: allowed (boolean), requiresApproval (boolean), and reason (string).",
      inputSchema: z.object({
        action: z.string(),
        subscriptionId: z.string(),
        estimatedSavings: z.number(),
      }),
      callback: ({ action, subscriptionId, estimatedSavings }) =>
        checkPolicy(action as never, subscriptionId, loadPolicy(), estimatedSavings),
    }),
  ];
  if (opts.negotiationTool !== false) {
    tools.push(
      tool({
        name: "send_negotiation_message",
        description:
          "Send a message to a vendor in an ongoing renewal negotiation. The vendor sandbox will respond with a counter-offer or accept.",
        inputSchema: z.object({
          vendorId: z.string(),
          subscriptionId: z.string(),
          message: z.string(),
          round: z.number().int(),
          buyerOfferPrice: z.number(),
          buyerCurrentPrice: z.number(),
        }),
        callback: ({ vendorId, subscriptionId, message, round, buyerOfferPrice, buyerCurrentPrice }) =>
          sendNegotiationMessage(
            vendorId,
            message,
            buyerOfferPrice,
            { round, buyerCurrentPrice }
          ),
      })
    );
  }
  return tools;
}