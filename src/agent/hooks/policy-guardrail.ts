import type { BeforeToolCallEvent } from "@strands-agents/sdk";
import type { Policy } from "../../types/index.js";

export const MAX_TOOL_CALLS_PER_EVALUATION = 12;

export function policyGuardrail(event: BeforeToolCallEvent): void {
  const toolName = event.toolUse.name;
  const toolInput = (event.toolUse.input ?? {}) as Record<string, unknown>;
  const policy = event.agent.appState.get("policy") as Policy | undefined;
  const count = (event.invocationState.toolCallCount as number | undefined) ?? 0;

  if (!policy) {
    event.cancel = "No active policy loaded. Cancelling tool call.";
    return;
  }

  if (count >= MAX_TOOL_CALLS_PER_EVALUATION) {
    event.cancel = `Tool-call limit reached (${MAX_TOOL_CALLS_PER_EVALUATION} per evaluation).`;
    return;
  }

  if (toolName === "send_negotiation_message") {
    if (policy.blacklist.includes(toolInput.vendorId as string)) {
      event.cancel = `Vendor '${toolInput.vendorId}' is blacklisted.`;
      return;
    }
    const totalSpend = (event.agent.appState.get("totalSpend") as number | undefined) ?? 0;
    if (totalSpend >= policy.maxAnnualBudget && totalSpend > 0) {
      event.cancel = "Annual budget cap reached.";
      return;
    }
    const buyerOfferPrice = toolInput.buyerOfferPrice as number;
    const maxAcceptable = (event.agent.appState.get("maxAcceptablePrice") as number | undefined) ?? Number.MAX_SAFE_INTEGER;
    if (maxAcceptable > 0 && buyerOfferPrice > maxAcceptable) {
      event.cancel = `buyerOfferPrice ${buyerOfferPrice} exceeds maxAcceptablePrice ${maxAcceptable}.`;
      return;
    }
  }

  event.invocationState.toolCallCount = count + 1;
}