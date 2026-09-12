import { z } from "zod";

export const GuardianOutputSchema = z.object({
  subscriptionId: z.string(),
  triggers: z.array(
    z.enum(["renewal_soon", "unused_seats", "category_overlap", "price_increase", "budget_anomaly"])
  ),
  action: z.enum(["KEEP", "DOWNGRADE", "SWITCH", "CANCEL", "NEGOTIATE"]),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
});

export const NegotiationOutputSchema = z.object({
  message: z.string().min(1),
  buyerOfferPrice: z.number().positive(),
  proposedAcceptPrice: z.number().positive(),
  reasoning: z.string().min(1),
});

export const PolicySchema = z.object({
  maxAnnualBudget: z.number(),
  maxSingleVendorSpend: z.number(),
  renewalWindowDays: z.number(),
  unusedSeatThresholdPct: z.number(),
  blacklist: z.array(z.string()),
  cancellationWindowDays: z.number(),
  categories: z.array(z.string()),
});

export type ParsedGuardianOutput = z.infer<typeof GuardianOutputSchema>;
export type ParsedNegotiationOutput = z.infer<typeof NegotiationOutputSchema>;