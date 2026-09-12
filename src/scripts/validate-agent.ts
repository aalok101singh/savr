import { loadEnv } from "../utils/env.js";
import { loadPolicy, loadSubscriptions } from "../utils/data-files.js";
import { getDemoDate } from "../utils/demo-clock.js";
import { checkPolicy } from "../agent/tools/check-policy.js";
import { buildCandidateSet } from "../agent/guardian.js";
import { CANONICAL_ACTIONS } from "../agent/canonical-demo.js";
import type { DecisionAction } from "../types/index.js";

const errors: string[] = [];
loadEnv();
const policy = loadPolicy();

const r1 = checkPolicy("NEGOTIATE", "competitor-x", policy, 0);
if (r1.allowed) {
  errors.push(`T1 blacklist: expected allowed=false, got ${JSON.stringify(r1)}`);
} else if (!/blacklist/i.test(r1.reason)) {
  errors.push(`T1 blacklist: reason must mention blacklist, got "${r1.reason}"`);
}

const r2 = checkPolicy("NEGOTIATE", "notion", policy, 0);
if (!r2.allowed || !r2.requiresApproval) {
  errors.push(`T2 notion NEGOTIATE: expected allowed+approval, got ${JSON.stringify(r2)}`);
}

const r3 = checkPolicy("DOWNGRADE", "figma", policy, 420);
if (!r3.allowed || r3.requiresApproval) {
  errors.push(`T3 figma DOWNGRADE: expected autonomous, got ${JSON.stringify(r3)}`);
}

const candidates = buildCandidateSet(loadSubscriptions(), policy, getDemoDate());
const ids = candidates.map((c) => c.subscription.id);
const expected = ["notion", "loom", "veed", "notion-ai", "posthog"];
if (JSON.stringify(ids) !== JSON.stringify(expected)) {
  errors.push(`Candidate set mismatch: got [${ids.join(", ")}], expected [${expected.join(", ")}]`);
}

for (const c of candidates) {
  const canonical = CANONICAL_ACTIONS[c.subscription.id];
  if (!canonical) {
    errors.push(`No canonical action for candidate ${c.subscription.id}`);
    continue;
  }
  const result = checkPolicy(canonical.action as DecisionAction, c.subscription.id, policy, 0);
  const expectApproval = canonical.action === "NEGOTIATE" || canonical.action === "SWITCH";
  if (!result.allowed) {
    errors.push(`${c.subscription.id}: expected allowed, got ${result.reason}`);
  }
  if (result.requiresApproval !== expectApproval) {
    errors.push(`${c.subscription.id}: requiresApproval=${result.requiresApproval}, expected ${expectApproval}`);
  }
}

if (errors.length > 0) {
  console.error("validate:agent FAILED");
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`T1 PASS -> checkPolicy NEGOTIATE competitor-x blocked: "${r1.reason}"`);
console.log(`T2 PASS -> checkPolicy NEGOTIATE notion requires approval: "${r2.reason}"`);
console.log(`T3 PASS -> checkPolicy DOWNGRADE figma autonomous: "${r3.reason}"`);
console.log(`T4 PASS -> candidate set = [${expected.join(", ")}], approval flags canonical`);
process.exit(0);