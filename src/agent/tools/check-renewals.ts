import { loadSubscriptions } from "../../utils/data-files.js";
import { getDemoDate } from "../../utils/demo-clock.js";
import type { Subscription } from "../../types/index.js";

export function checkRenewals(windowDays: number): Subscription[] {
  try {
    const all = loadSubscriptions();
    const demoMs = getDemoDate().getTime();
    const spanMs = windowDays * 24 * 60 * 60 * 1000;
    return all.filter((s) => {
      const diff = new Date(s.renewalDate).getTime() - demoMs;
      return diff >= 0 && diff <= spanMs;
    });
  } catch (err) {
    console.warn(`check_renewals: ${(err as Error).message}`);
    return [];
  }
}