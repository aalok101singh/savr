import { renderToString } from "react-dom/server";
import { loadEnv } from "../../src/utils/env.js";
import { createApiApp } from "../../src/api/routes.js";
import { StackOverview } from "../src/components/StackOverview";
import type { DecisionPackage, Subscription } from "../src/types";

async function verify(): Promise<string> {
  loadEnv();
  const app = createApiApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const subsRes = await fetch(`${base}/api/subscriptions`);
  const subs = (await subsRes.json()) as Subscription[];
  const pkgsRes = await fetch(`${base}/api/decisions`);
  const pkgs = (await pkgsRes.json()) as DecisionPackage[];

  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (subs.length !== 14) {
    throw new Error(`expected 14 subscriptions, got ${subs.length}`);
  }

  const actionsBySub: Record<string, DecisionPackage["action"]> = {};
  for (const pkg of pkgs) {
    actionsBySub[pkg.subscriptionId] = pkg.action;
  }
  const html = renderToString(StackOverview({ subscriptions: subs, actionsBySub, pendingSubs: new Set() }));
  const rowCount = (html.match(/<tr[\s>]/g) ?? []).length;
  const bodyRows = rowCount - 1;
  if (bodyRows < 14) {
    throw new Error(`StackOverview rendered ${bodyRows} body rows, expected 14`);
  }
  const missing = subs.filter((s) => !html.includes(s.vendorName)).map((s) => s.vendorName);
  if (missing.length > 0) {
    throw new Error(`rendered HTML missing vendors: ${missing.join(", ")}`);
  }

  return `${subs.length} subscription rows rendered (${pkgs.length} decisions applied)`;
}

verify()
  .then((summary) => {
    console.log(`UI RENDER PASS -> ${summary}`);
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error(`check:rows FAILED: ${(err as Error).message}`);
    process.exitCode = 1;
  });