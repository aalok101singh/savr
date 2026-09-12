import { loadCachedEvidence } from "../../utils/data-files.js";
import type { Evidence, SearchAlternativesResult } from "../../types/index.js";

export function searchAlternatives(
  category: string,
  currentVendorId: string,
  webEvidence?: Record<string, Evidence[]>
): SearchAlternativesResult {
  try {
    const key = `${category}#${currentVendorId}`;
    if (webEvidence && webEvidence[key]) {
      const alternatives = webEvidence[key].filter((e) => e.type === "alternative_found");
      if (alternatives.length > 0) {
        return { status: "success", evidence: alternatives };
      }
    }
    if (process.env.DEMO_MODE === "true") {
      const cache = loadCachedEvidence();
      const entries = cache[key];
      if (!entries) {
        return {
          status: "evidence_unavailable",
          reason: `No cached evidence for ${key}.`,
        };
      }
      const alternatives = entries.filter((e) => e.type === "alternative_found");
      return { status: "success", evidence: alternatives };
    }
    return {
      status: "evidence_unavailable",
      reason: "Live alternative search is not configured outside demo mode.",
    };
  } catch (err) {
    return {
      status: "evidence_unavailable",
      reason: `search_alternatives failed: ${(err as Error).message}`,
    };
  }
}