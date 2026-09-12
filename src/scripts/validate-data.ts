import { readFileSync } from "fs";
import { join } from "path";
import type { Subscription } from "../types/index.js";
import { getDemoDate } from "../utils/demo-clock.js";
import { loadEnv } from "../utils/env.js";

loadEnv();

const dataDir = join(import.meta.dirname, "../../data");
const subscriptions: Subscription[] = JSON.parse(
  readFileSync(join(dataDir, "subscriptions.json"), "utf-8")
);

const errors: string[] = [];

// 1. Exactly 14 subscriptions
if (subscriptions.length !== 14) {
  errors.push(`Expected 14 subscriptions, got ${subscriptions.length}`);
}

// 2. sum(annualCost) === 47400
const totalAnnual = subscriptions.reduce((sum, s) => sum + s.annualCost, 0);
if (totalAnnual !== 47400) {
  errors.push(`Expected total annualCost 47400, got ${totalAnnual}`);
}

// 3. Exactly 4 renewals within 30 days of demo date
const demoDate = getDemoDate();
const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
const renewalsWithin30 = subscriptions.filter((s) => {
  const renewal = new Date(s.renewalDate);
  const diff = renewal.getTime() - demoDate.getTime();
  return diff >= 0 && diff <= thirtyDaysMs;
});
if (renewalsWithin30.length !== 4) {
  errors.push(
    `Expected 4 renewals within 30 days, got ${renewalsWithin30.length}: [${renewalsWithin30.map((s) => s.id).join(", ")}]`
  );
}

// 4. Unused seats === 32 for seat-based
const seatBased = subscriptions.filter((s) => s.billingModel === "seat_based");
const totalUnused = seatBased.reduce(
  (sum, s) => sum + (s.seatsPurchased! - s.seatsActive!),
  0
);
if (totalUnused !== 32) {
  errors.push(`Expected 32 unused seats, got ${totalUnused}`);
}

// 5. Loom + Veed overlap (both category "Video")
const loom = subscriptions.find((s) => s.id === "loom");
const veed = subscriptions.find((s) => s.id === "veed");
if (!loom || !veed) {
  errors.push("Missing loom or veed subscription");
} else if (loom.category !== "Video" || veed.category !== "Video") {
  errors.push(
    `Expected loom/veed category "Video", got "${loom.category}/${veed.category}"`
  );
}

// 6. notion-ai priceIncreasePct === 17
const notionAi = subscriptions.find((s) => s.id === "notion-ai");
if (!notionAi) {
  errors.push("Missing notion-ai subscription");
} else if (notionAi.priceIncreasePct !== 17) {
  errors.push(
    `Expected notion-ai priceIncreasePct 17, got ${notionAi.priceIncreasePct}`
  );
}

// 7. Vercel + AWS billingModel === "usage_based", seats null
const vercel = subscriptions.find((s) => s.id === "vercel");
const aws = subscriptions.find((s) => s.id === "aws");
if (!vercel || !aws) {
  errors.push("Missing vercel or aws subscription");
} else {
  if (vercel.billingModel !== "usage_based") {
    errors.push(`Expected vercel billingModel "usage_based", got "${vercel.billingModel}"`);
  }
  if (aws.billingModel !== "usage_based") {
    errors.push(`Expected aws billingModel "usage_based", got "${aws.billingModel}"`);
  }
  if (vercel.seatsPurchased !== null || vercel.seatsActive !== null) {
    errors.push("Expected vercel seats to be null");
  }
  if (aws.seatsPurchased !== null || aws.seatsActive !== null) {
    errors.push("Expected aws seats to be null");
  }
}

// 8. Seat-based: annualCost === pricePerSeat * seatsPurchased
for (const s of seatBased) {
  const expected = s.pricePerSeat! * s.seatsPurchased!;
  if (s.annualCost !== expected) {
    errors.push(
      `${s.id}: annualCost ${s.annualCost} !== pricePerSeat*seatsPurchased ${expected}`
    );
  }
}

// 9. Annual billing: annualCost === currentPeriodCost; Monthly: annualCost === currentPeriodCost * 12
for (const s of subscriptions) {
  if (s.billingCycle === "annual") {
    if (s.annualCost !== s.currentPeriodCost) {
      errors.push(
        `${s.id}: annual billing but annualCost ${s.annualCost} !== currentPeriodCost ${s.currentPeriodCost}`
      );
    }
  } else if (s.billingCycle === "monthly") {
    const expected = s.currentPeriodCost * 12;
    if (s.annualCost !== expected) {
      errors.push(
        `${s.id}: monthly billing but annualCost ${s.annualCost} !== currentPeriodCost*12 ${expected}`
      );
    }
  }
}

// 10. vendorName and id are distinct strings
for (const s of subscriptions) {
  if (s.id === s.vendorName) {
    errors.push(
      `${s.id}: vendorName and id are identical — they should be distinct`
    );
  }
}

// 11. 12 seat-based + 2 usage-based
const usageBased = subscriptions.filter((s) => s.billingModel === "usage_based");
if (seatBased.length !== 12) {
  errors.push(`Expected 12 seat-based, got ${seatBased.length}`);
}
if (usageBased.length !== 2) {
  errors.push(`Expected 2 usage-based, got ${usageBased.length}`);
}

if (errors.length > 0) {
  console.error("Validation FAILED:");
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log("All validations passed");
process.exit(0);
