import { cosineSim, createEmbedder } from "../src/index.js";

const { embed } = createEmbedder();

const t0 = Date.now();
const [a, b, c] = await embed([
  "the deal value increased to $500k",
  "how much is the contract worth?",
  "the office plants need watering",
]);
console.log(`embedded 3 texts in ${Date.now() - t0}ms (incl. model load)`);
if (a && b && c) {
  console.log("dim:", a.length);
  console.log("sim(deal value, contract worth):", cosineSim(a, b).toFixed(3));
  console.log("sim(deal value, office plants): ", cosineSim(a, c).toFixed(3));
}
process.exit(0);
