import { cosineSim, createEmbedder } from "../src/index.js";

const { embed } = createEmbedder();

// Invented sample sentences: no customer or person here is real.

const [q1, q2, body] = await embed([
  "who quit at the customer",
  "how much is the contract worth",
  "Churn risk — champion Dana Voss resigned",
]);
if (q1 && q2 && body) {
  console.log("sim(who quit…, churn-risk body):", cosineSim(q1, body).toFixed(3));
  console.log("sim(contract worth, churn-risk body):", cosineSim(q2, body).toFixed(3));
}
process.exit(0);
