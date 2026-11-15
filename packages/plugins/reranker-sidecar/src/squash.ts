/**
 * Raw scores into [0, 1] by the logistic function, keeping the model's strict order where float64 cannot. A model
 * scored as log-odds (a Qwen3 reranker's logit("yes") − logit("no")) answers +36, +56, +88 for documents it ranks apart,
 * and the logistic of each rounds to exactly 1, so the engine would order them by the fused order instead. Where a
 * strictly lower raw score squashes to a value not below the one above it, it takes the next float down: an order the
 * model gave is never lost, equal raw scores stay equal, and a score moves by a few ulps at most. A model whose scores
 * stay within about ±36 gets the plain logistic, bit for bit.
 */
export function squashed(raw: readonly number[]): number[] {
  const out = raw.map((score) => 1 / (1 + Math.exp(-score)));
  const byRaw = raw.map((_, i) => i).sort((a, b) => (raw[b] ?? 0) - (raw[a] ?? 0));
  for (let k = 1; k < byRaw.length; k += 1) {
    const above = byRaw[k - 1] ?? 0;
    const at = byRaw[k] ?? 0;
    const top = out[above] ?? 0;
    if ((raw[at] ?? 0) === (raw[above] ?? 0)) out[at] = top;
    else if ((out[at] ?? 0) >= top) out[at] = nextDown(top);
  }
  return out;
}

/** The largest float64 below `x`, never below 0. */
function nextDown(x: number): number {
  if (x <= 0) return 0;
  const bits = new BigInt64Array(new Float64Array([x]).buffer);
  bits[0] = (bits[0] ?? 0n) - 1n;
  return new Float64Array(bits.buffer)[0] ?? 0;
}
