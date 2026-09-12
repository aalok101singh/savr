import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { loadEnv } from "../utils/env.js";
import { priceFromText, enrichWebEvidenceMap } from "../agent/web-evidence.js";
import { benchmarkPricing } from "../agent/tools/benchmark-pricing.js";
import { searchAlternatives } from "../agent/tools/search-alternatives.js";

const errors: string[] = [];
let stubHits = 0;

function assert(cond: boolean, label: string, detail?: unknown): void {
  if (!cond) {
    errors.push(`${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

function stubHandler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "POST" && req.url === "/v1/search") {
    stubHits++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        results: [
          { title: "Figma Pricing", url: "https://figma.com/pricing", content: "Figma Professional $12 per editor per month, billed annually. Enterprise plans start higher." },
          { title: "Design Alternatives", url: "https://www.g2.com/categories/prototyping", content: "Adobe XD is a popular prototyping tool. Penpot is a free open source alternative." },
        ],
      })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
}

async function run(): Promise<void> {
  loadEnv();
  const orig = process.env.NINEROUTER_URL;
  process.env.NINEROUTER_URL = "";

  // ─── T1 — priceFromText unit extraction ───
  const p1 = priceFromText("Figma Professional $12 per editor per month, billed annually.");
  assert(p1 !== null && p1.value === 12 && p1.label === "$12", "T1 extract $12 from realistic snippet", p1);
  const p2 = priceFromText("Adobe XD is a popular prototyping tool. Penpot is a free open source alternative.");
  assert(p2 === null, "T1 no price in pure alternative text", p2);
  const p3 = priceFromText("Plans from $1,200/yr to $3,600/yr");
  assert(p3 !== null && p3.value === 1200 && p3.label === "$1,200", "T1 comma in price", p3);

  // ─── T2 — stub 9Router: enrichment exactly returns price_benchmark ───
  const stub = createServer(stubHandler);
  await new Promise<void>((resolve) => stub.listen(0, resolve));
  const port = (stub.address() as { port: number }).port;
  process.env.NINEROUTER_URL = `http://127.0.0.1:${port}`;
  stubHits = 0;

  const evidence = await enrichWebEvidenceMap([
    { vendorId: "figma", vendorName: "Figma", category: "Design" },
  ]);
  const figmaKey = "Design#figma";
  assert(stubHits === 1, "T2 stub hit once for enrichment", stubHits);
  assert(Array.isArray(evidence[figmaKey]), "T2 enrichment produced evidence for figma", evidence);
  const priceEvid = evidence[figmaKey]?.filter((e) => e.type === "price_benchmark");
  assert(priceEvid !== undefined && priceEvid.length === 1, "T2 exactly one price_benchmark extracted", priceEvid?.length);
  assert(priceEvid?.[0].data.minPricePerUnit === 12, "T2 price value parsed correctly", priceEvid?.[0].data);
  assert(priceEvid?.[0].confidence === 0.5, "T2 web evidence has honest low confidence", priceEvid?.[0].confidence);
  assert(typeof priceEvid?.[0].publisher === "string" && priceEvid?.[0].publisher.length > 0, "T2 publisher set from hit", priceEvid?.[0].publisher);

  // Alternative-bearing web hit is deliberately NOT surfaced as alternative_found (scope choice — see DECISIONS).
  const altEvid = evidence[figmaKey]?.filter((e) => e.type === "alternative_found");
  assert(!altEvid || altEvid.length === 0, "T2 alt-bearing hit excluded (price-only enrichment)", altEvid?.length);

  // ─── T3 — tool fallback chain: overlay > cache > evidence_unavailable ───
  const overlayHit = benchmarkPricing("Design", "figma", evidence);
  assert(overlayHit.status === "success", "T3 overlay hit returns success (stub price evidence)", overlayHit);

  const overlayMiss = benchmarkPricing("Productivity", "notion", evidence);
  assert(overlayMiss.status === "success", "T3 overlay miss falls through to cache (Acme evidence for notion)", overlayMiss);
  const notionCached = benchmarkPricing("Productivity", "notion", {});
  assert(notionCached.status === "success", "T3 empty overlay falls through to cache (DEMO_MODE path)", notionCached);
  const altToolMiss = searchAlternatives("AI Research", "unknown", evidence);
  assert(
    altToolMiss.status === "evidence_unavailable",
    "T3 unknown vendor + empty overlay returns evidence_unavailable",
    altToolMiss
  );

  // ─── T4 — without NINEROUTER_URL: enrichment returns nothing, tool unchanged ───
  process.env.NINEROUTER_URL = "";
  const offline = await enrichWebEvidenceMap([{ vendorId: "figma", vendorName: "Figma", category: "Design" }]);
  assert(Object.keys(offline).length === 0, "T4 enrichment silently returns empty without a gateway", offline);
  const offlineTool = benchmarkPricing("Productivity", "notion", undefined);
  assert(offlineTool.status === "success", "T4 undefined overlay falls through to cache (no gateway)", offlineTool);

  // cleanup
  stub.close();
  if (orig) process.env.NINEROUTER_URL = orig;
  else delete process.env.NINEROUTER_URL;

  if (errors.length > 0) {
    console.error("validate:web-evidence FAILED");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("T1 PASS -> priceFromText extracts dollar amounts from realistic snippets; misses pure alt text");
  console.log("T2 PASS -> enrichment calls stub 9Router once, extracts exactly one price_benchmark (honest confidence)");
  console.log("T3 PASS -> tools consult overlay first, then cache, then evidence_unavailable (no gateway)");
  console.log("T4 PASS -> without NINEROUTER_URL enrichment silently skips, tools unchanged (fallback preserved)");
  console.log("WEB EVIDENCE GATE PASSED");
  process.exitCode = 0;
}

run().catch((err) => {
  console.error(`[validate:web-evidence] fatal: ${(err as Error).message}`);
  process.exitCode = 1;
});