/** Vectors as the database and the ranking read them. */
/** pgvector literal format. */
export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] as number) * (b[i] as number);
  return dot; // vectors are normalized
}
