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
