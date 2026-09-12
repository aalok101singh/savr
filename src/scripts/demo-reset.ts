import { loadEnv } from "../utils/env.js";
import { resetDemo } from "../api/demo.js";

loadEnv();
const result = resetDemo();
console.log(JSON.stringify(result, null, 2));
console.error(
  `[demo:reset] subscriptionsReset=${result.subscriptionsReset} cardsCleared=${result.cardsCleared} savingsReset=${result.savingsReset}`
);
process.exit(0);