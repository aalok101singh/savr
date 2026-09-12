import { loadCachedEvidence } from "../../utils/data-files.js";
import type { BenchmarkPricingResult, Evidence } from "../../types/index.js";

export function benchmarkPricing(
  category: string,
  vendorId: string,
  webEvidence?: Record<string, Evidence[]>
): BenchmarkPricingResult {
  try {
    const key = `${category}#${vendorId}`;
    if (webEvidence && webEvidence[key]) {
      const pricing = webEvidence[key].filter((e) => e.type === "price_benchmark");
      if (pricing.length > 0) {
        return { status: "success", evidence: pricing[0] };
      }
    }
    if (process.env.DEMO_MODE === "true") {
      const cache = loadCachedEvidence();
      const entries = cache[key] ?? [];
      const pricing = entries.filter((e) => e.type === "price_benchmark");
      if (pricing.length > 0) {
        return { status: "success", evidence: pricing[0] };
      }
      return {
        status: "evidence_unavailable",
        reason: `No benchmark pricing cached for ${key}.`,
      };
    }
    return {
      status: "evidence_unavailable",
      reason: "Live pricing lookup is not configured outside demo mode.",
    };
  } catch (err) {
    return {
      status: "evidence_unavailable",
      reason: `benchmark_pricing failed: ${(err as Error).message}`,
    };
  }
}