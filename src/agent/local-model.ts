import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";
import {
  CANONICAL_ACTIONS,
  CANONICAL_EVIDENCE_IDS,
  CANONICAL_RESEARCH_TOOL,
} from "./canonical-demo.js";

function candidateIdFromMessages(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    for (const block of message.content) {
      if (block.type === "textBlock") {
        const match = block.text.match(/"subscriptionId":\s*"([a-z0-9-]+)"/);
        if (match) return match[1];
      }
    }
  }
  return null;
}

function triggersFromMessages(messages: Message[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const block of messages[i].content) {
      if (block.type === "textBlock") {
        const match = block.text.match(/"triggers":\[([^\]]*)\]/);
        if (match) {
          return match[1]
            .split(",")
            .map((t) => t.trim().replace(/^"|"$/g, ""))
            .filter(Boolean);
        }
      }
    }
  }
  return [];
}

function negRoundFromMessages(messages: Message[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i].content
      .filter((block) => block.type === "textBlock")
      .map((block) => (block.type === "textBlock" ? block.text : ""))
      .join("\n");
    if (/\bNEGOTIATOR\b/.test(text)) {
      const roundMatch = text.match(/"round":\s*(\d+)/);
      return roundMatch ? Number(roundMatch[1]) : 1;
    }
  }
  return null;
}

function lastMessageWasToolResult(messages: Message[]): boolean {
  const last = messages[messages.length - 1];
  if (!last) return false;
  return last.content.some((block) => block.type === "toolResultBlock");
}

const STRUCTURED_OUTPUT_TOOL_NAME = "strands_structured_output";

export const CANONICAL_NEGOTIATION_OFFER = 9800;
export const CANONICAL_NEGOTIATION_ACCEPT = 10000;

export const CANONICAL_NEGOTIATION_MESSAGES: Record<number, string> = {
  1: "We'd like to discuss pricing for your annual renewal.",
  2: "We appreciate that. We're targeting a lower price. Can you improve?",
  3: "We'll accept a better offer with annual billing.",
};

export const CANONICAL_NEGOTIATION_REASONING: Record<number, string> = {
  1: "Opening the negotiation at our $9,800 target, inside the policy ceiling.",
  2: "The vendor countered at $10,200; hold the $9,800 offer and ask for improvement.",
  3: "Close the deal: accept an offer at or below our proposedAcceptPrice.",
};

let sequence = 0;

async function* emitToolCall(
  name: string,
  input: Record<string, unknown>
): AsyncIterable<ModelStreamEvent> {
  sequence += 1;
  const toolUseId = `toolu_${Date.now()}_${sequence}`;
  yield { type: "modelMessageStartEvent", role: "assistant" };
  yield {
    type: "modelContentBlockStartEvent",
    start: { type: "toolUseStart", name, toolUseId },
  };
  yield {
    type: "modelContentBlockDeltaEvent",
    delta: { type: "toolUseInputDelta", input: JSON.stringify(input) },
  };
  yield { type: "modelContentBlockStopEvent" };
  yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
}

export class LocalModel extends Model<BaseModelConfig> {
  private _config: BaseModelConfig;

  constructor(config: BaseModelConfig = {}) {
    super();
    this._config = { modelId: "local-deterministic-demo", ...config };
  }

  updateConfig(modelConfig: BaseModelConfig): void {
    this._config = { ...this._config, ...modelConfig };
  }

  getConfig(): BaseModelConfig {
    return this._config;
  }

  async *stream(messages: Message[], _options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const negRound = negRoundFromMessages(messages);
    if (negRound !== null) {
      yield* emitToolCall(STRUCTURED_OUTPUT_TOOL_NAME, {
        message: CANONICAL_NEGOTIATION_MESSAGES[negRound] ?? "We need a further concession to continue the renewal.",
        buyerOfferPrice: CANONICAL_NEGOTIATION_OFFER,
        proposedAcceptPrice: CANONICAL_NEGOTIATION_ACCEPT,
        reasoning:
          CANONICAL_NEGOTIATION_REASONING[negRound] ??
          "Continuing the structured negotiation within the policy ceiling.",
      });
      return;
    }

    const subId = candidateIdFromMessages(messages);
    const emitToolUse = lastMessageWasToolResult(messages);

    let name: string;
    let input: Record<string, unknown>;
    if (!emitToolUse) {
      const known = subId ? CANONICAL_RESEARCH_TOOL[subId] : undefined;
      const research = known ?? {
        name: "benchmark_pricing",
        input: { category: "Productivity", vendorId: subId ?? "notion" },
      };
      name = research.name;
      input = research.input;
    } else {
      name = STRUCTURED_OUTPUT_TOOL_NAME;
      const canonical = (subId ? CANONICAL_ACTIONS[subId] : undefined) ?? CANONICAL_ACTIONS.notion;
      const triggers = triggersFromMessages(messages);
      input = {
        subscriptionId: subId ?? "notion",
        triggers: triggers.length > 0 ? triggers : ["renewal_soon"],
        action: canonical.action,
        reasoning: canonical.reasoning,
        confidence: canonical.confidence,
        evidenceIds: subId ? CANONICAL_EVIDENCE_IDS[subId] ?? [] : [],
      };
    }

    yield* emitToolCall(name, input);
  }
}