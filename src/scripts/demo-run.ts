import { loadEnv } from "../utils/env.js";
import { runDemo } from "../api/demo.js";

async function main(): Promise<void> {
  loadEnv();
  const result = await runDemo();
  console.log(JSON.stringify(result, null, 2));
  console.error(
    `[demo:run] status=${result.status} decisionPackages=${result.decisionPackages} cardsPending=${result.cardsPending} autonomousActions=${result.autonomousActions} savings=${result.savings}`
  );
  const gateOk =
    result.status === "complete" &&
    result.decisionPackages === 5 &&
    result.cardsPending === 2 &&
    result.autonomousActions === 3 &&
    result.savings === 0;
  process.exitCode = gateOk ? 0 : 2;
}

main().catch((err) => {
  console.error(`[demo:run] fatal: ${(err as Error).message}`);
  process.exit(1);
});