import type { DecisionAction } from "../types/index.js";

export const CANONICAL_CANDIDATE_ORDER = ["notion", "loom", "veed", "notion-ai", "posthog"];

export interface CanonicalAction {
  action: DecisionAction;
  reasoning: string;
  confidence: number;
}

export const CANONICAL_ACTIONS: Record<string, CanonicalAction> = {
  notion: {
    action: "NEGOTIATE",
    reasoning:
      "Notion renews in 14 days at $12,000/yr. Market benchmark evidence supports a lower price; negotiate within the policy ceiling before renewal.",
    confidence: 0.92,
  },
  loom: {
    action: "SWITCH",
    reasoning:
      "Loom renews in 30 days and overlaps Veed in the Video category. Consolidating onto Veed, which is already subscribed, eliminates Loom's full $3,600.",
    confidence: 0.9,
  },
  veed: {
    action: "KEEP",
    reasoning: "Veed is the retained consolidation target for video. Keep as-is.",
    confidence: 0.95,
  },
  "notion-ai": {
    action: "DOWNGRADE",
    reasoning:
      "Notion AI renews in 14 days with a 17% price increase and only 5 of 12 seats active (42% used). Reduce to the active seat count.",
    confidence: 0.9,
  },
  posthog: {
    action: "KEEP",
    reasoning:
      "PostHog renews in 30 days, is fully used, and benchmark pricing is in line with the current rate.",
    confidence: 0.95,
  },
};

export const CANONICAL_EVIDENCE_IDS: Record<string, string[]> = {
  notion: ["ev-benchmark-notion-1", "internal-notion-usage"],
  loom: ["ev-benchmark-loom-1", "ev-alt-loom-1", "ev-alt-loom-2", "internal-loom-usage"],
  veed: ["internal-veed-usage"],
  "notion-ai": ["internal-notion-ai-usage"],
  posthog: ["ev-benchmark-posthog-1", "internal-posthog-usage"],
};

export const CANONICAL_RESEARCH_TOOL: Record<string, { name: string; input: Record<string, unknown> }> = {
  notion: { name: "benchmark_pricing", input: { category: "Productivity", vendorId: "notion" } },
  loom: { name: "search_alternatives", input: { category: "Video", currentVendorId: "loom" } },
  veed: { name: "benchmark_pricing", input: { category: "Video", vendorId: "veed" } },
  "notion-ai": { name: "benchmark_pricing", input: { category: "Add-on", vendorId: "notion-ai" } },
  posthog: { name: "benchmark_pricing", input: { category: "Analytics", vendorId: "posthog" } },
};