// Element-wise mean + L2 normalization — mirrors the talk's numpy averaging
// for pooling a foreground document set into a single wormhole vector.
export function poolVectors(vectors: number[][]): number[] {
  if (!vectors.length) throw new Error("Cannot pool an empty vector list.");

  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  const mean = sum.map((s) => s / vectors.length);

  const norm = Math.sqrt(mean.reduce((acc, x) => acc + x * x, 0));
  return norm === 0 ? mean : mean.map((x) => x / norm);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Mean cosine similarity of each foreground vector to the pooled centroid.
// High => tight/specific query (foreground vectors cluster together).
// Low => broad query (foreground spans a wide region of vector space).
export function foregroundSpecificity(vectors: number[][]): number {
  if (!vectors.length) throw new Error("Cannot compute specificity for an empty vector list.");

  const centroid = poolVectors(vectors);
  const similarities = vectors.map((v) => cosineSimilarity(v, centroid));
  return similarities.reduce((acc, s) => acc + s, 0) / similarities.length;
}
