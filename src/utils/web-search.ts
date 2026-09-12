export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface WebSearchOptions {
  maxResults?: number;
  timeoutMs?: number;
}

/**
 * 9Router web search client (OpenAI-compatible gateway; see the 9router skill).
 * Returns null on any failure so callers fall back to the cached-evidence path
 * (and ultimately `evidence_unavailable`) — live search is an enhancement, never a
 * hard dependency.
 */
export async function searchWeb(
  query: string,
  options: WebSearchOptions = {}
): Promise<WebSearchHit[] | null> {
  const baseUrl = process.env.NINEROUTER_URL;
  if (!baseUrl || baseUrl.trim().length === 0) return null;
  const apiKey = process.env.NINEROUTER_KEY;
  const model = process.env.NINEROUTER_WEB_MODEL ?? "search-combo";
  const maxResults = options.maxResults ?? 5;
  const timeoutMs = options.timeoutMs ?? 8000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, query, max_results: maxResults, search_type: "web" }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    const items = extractHits(data);
    return items;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractHits(data: unknown): WebSearchHit[] | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const list = Array.isArray(record.results) ? record.results : Array.isArray(record.data) ? record.data : null;
  if (!Array.isArray(list)) return null;
  const hits: WebSearchHit[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title : "";
    const url = typeof item.url === "string" ? item.url : "";
    const snippet =
      (typeof item.snippet === "string" && item.snippet) ||
      (typeof item.content === "string" && item.content) ||
      (typeof item.description === "string" && item.description) ||
      "";
    const source = typeof item.source === "string" || typeof item.provider === "string"
      ? (typeof item.source === "string" ? item.source : undefined) ?? String(item.provider)
      : undefined;
    if (!url || !title) continue;
    hits.push({ title, url, snippet: snippet.slice(0, 600), source });
  }
  return hits.length > 0 ? hits : null;
}