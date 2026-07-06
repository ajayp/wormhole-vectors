// Plain gradient-descent matrix factorization — no dependencies. Factors the
// synthetic users × items implicit-feedback matrix (scripts/interactions.ts)
// into low-dimensional user and item vectors; the L2-normalized item vectors
// become the corpus's behavioral vector space (the talk's collaborative-
// filtering embeddings, 40:39–45:36). At 24×135 this runs in milliseconds.

export const BEHAVIOR_DIMS = 16;

export interface MfOpts {
  dims?: number;
  epochs?: number;
  learningRate?: number;
  regularization?: number;
  seed?: number;
}

export interface MfModel {
  userVectors: number[][];
  /** One vector per item (input matrix column), L2-normalized. */
  itemVectors: number[][];
  /** RMSE over all matrix cells after each epoch. */
  epochErrors: number[];
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  return norm === 0 ? [...v] : v.map((x) => x / norm);
}

export function factorize(matrix: number[][], opts?: MfOpts): MfModel {
  if (!matrix.length || !matrix[0].length) {
    throw new Error("Cannot factorize an empty interaction matrix.");
  }

  const dims = opts?.dims ?? BEHAVIOR_DIMS;
  const epochs = opts?.epochs ?? 200;
  const lr = opts?.learningRate ?? 0.01;
  const reg = opts?.regularization ?? 0.02;
  const rand = mulberry32(opts?.seed ?? 0xbeef);

  const nUsers = matrix.length;
  const nItems = matrix[0].length;

  const users: number[][] = Array.from({ length: nUsers }, () =>
    Array.from({ length: dims }, () => (rand() - 0.5) * 0.1)
  );
  const items: number[][] = Array.from({ length: nItems }, () =>
    Array.from({ length: dims }, () => (rand() - 0.5) * 0.1)
  );

  // SGD over every cell: zeros count as real "no interaction" targets, which
  // pushes items with disjoint audiences apart while shared-persona items
  // (e.g. java_coffee + server_hospitality via the barista) stay close.
  const epochErrors: number[] = [];
  for (let epoch = 0; epoch < epochs; epoch++) {
    let squaredError = 0;
    for (let u = 0; u < nUsers; u++) {
      for (let i = 0; i < nItems; i++) {
        let pred = 0;
        for (let f = 0; f < dims; f++) pred += users[u][f] * items[i][f];
        const err = matrix[u][i] - pred;
        squaredError += err * err;
        for (let f = 0; f < dims; f++) {
          const uf = users[u][f];
          const vf = items[i][f];
          users[u][f] += lr * (err * vf - reg * uf);
          items[i][f] += lr * (err * uf - reg * vf);
        }
      }
    }
    epochErrors.push(Math.sqrt(squaredError / (nUsers * nItems)));
  }

  return {
    userVectors: users,
    itemVectors: items.map(l2Normalize),
    epochErrors,
  };
}
