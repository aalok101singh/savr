import { searchWeb, type WebSearchHit } from "../utils/web-search.js";
import type { Evidence } from "../types/index.js";

/**
 * Honest web-evidence enrichment for Guardian research tools.
 *
 * Only builds `price_benchmark` evidence when the web result actually contains a
 * dollar amount — we never invent numbers. When no price appears, the vendor keeps
 * the existing fallback chain (cached evidence, then `evidence_unavailable`) so a
 * missing price degrades to honesty, exactly like the current `evidence_unavailable`.
 */

interface PriceMatch {
  value: number;
  label: string;
}

export function priceFromText(text: string): PriceMatch | null {
  const match = text.match(/\$\s?([\d][\d,]*(?:\.\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, label: match[0] };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function toEvidence(hit: WebSearchHit, type: string, vendorId: string, index: number, price: PriceMatch | null): Evidence {
  return {
    id: `web-${type === "price_benchmark" ? "benchmark" : "alt"}-${vendorId}-${index}`,
    type,
    source: "web_search",
    url: hit.url,
    publisher: hit.source ?? hostOf(hit.url),
    retrievedAt: new Date().toISOString(),
    freshUntil: null,
    observedValue: price ? `Web search: ${price.label}` : hit.title.slice(0, 80),
    confidence: 0.5,
    isInternal: false,
    summary: hit.snippet.slice(0, 200),
    data: price
      ? { minPricePerUnit: price.value, currency: "USD", vendorId, source: "web_search" }
      : { source: "web_search", vendorId },
  };
}

/**
 * Builds price_benchmark evidence for `(category, vendor)` from a web search, or []
 * when no searchable evidence resolves. Callers decide whether to index the result.
 */
export async function enrichWebEvidence(
  vendorId: string,
  vendorName: string,
  category: string
): Promise<Evidence[]> {
  const pricingQuery = `${vendorName} ${category} pricing per user per year ${new Date().getUTCFullYear()}`;
  const hits = await searchWeb(pricingQuery, { maxResults: 5 });
  if (!hits) return [];
  const pricing: Evidence[] = [];
  for (let i = 0; i < hits.length; i++) {
    const price = priceFromText(`${hits[i].snippet} ${hits[i].title}`.slice(0, 400));
    if (price) {
      pricing.push(toEvidence(hits[i], "price_benchmark", vendorId, i, price));
    }
  }
  return pricing;
}

/** Enrichment happens once per live Guardian run, per distinct (category, vendor). */
export async function enrichWebEvidenceMap(
  vendors: Array<{ vendorId: string; vendorName: string; category: string }>
): Promise<Record<string, Evidence[]>> {
  const map: Record<string, Evidence[]> = {};
  const results = await Promise.allSettled(
    vendors.map(({ vendorId, vendorName, category }) =>
      enrichWebEvidence(vendorId, vendorName, category).then((evidence) => ({
        key: `${category}#${vendorId}`,
        evidence,
      }))
    )
  );
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.evidence.length > 0) {
      map[result.value.key] = result.value.evidence;
    }
  }
  return map;
}