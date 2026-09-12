import { loadSubscriptions } from "../../utils/data-files.js";
import { getDemoDate } from "../../utils/demo-clock.js";
import type { DecisionAction, Policy, PolicyResult } from "../../types/index.js";

export function checkPolicy(
  action: DecisionAction,
  subscriptionId: string,
  policy: Policy,
  estimatedSavings: number
): PolicyResult {
  const sub = loadSubscriptions().find((s) => s.id === subscriptionId);

  if (policy.blacklist.includes(subscriptionId)) {
    return { allowed: false, requiresApproval: false, reason: "Vendor is blacklisted." };
  }

  if (!sub) {
    return { allowed: false, requiresApproval: false, reason: `Unknown subscription '${subscriptionId}'.` };
  }

  if (policy.categories.length > 0 && !policy.categories.includes(sub.category)) {
    return { allowed: true, requiresApproval: false, reason: "Category not in monitored set." };
  }

  if (action === "NEGOTIATE" || action === "SWITCH") {
    return { allowed: true, requiresApproval: true, reason: "Action requires human approval." };
  }

  if (action === "CANCEL") {
    const days = (new Date(sub.renewalDate).getTime() - getDemoDate().getTime()) / (24 * 60 * 60 * 1000);
    if (days < policy.cancellationWindowDays) {
      return { allowed: false, requiresApproval: false, reason: "Within cancellation window." };
    }
  }

  if (sub.annualCost > policy.maxSingleVendorSpend) {
    return { allowed: true, requiresApproval: true, reason: "Exceeds per-vendor spend threshold." };
  }

  return { allowed: true, requiresApproval: false, reason: "Autonomous action." };
}