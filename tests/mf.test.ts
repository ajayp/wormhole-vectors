import { test } from "node:test";
import assert from "node:assert/strict";
import { factorize, BEHAVIOR_DIMS } from "../src/mf";
import { generateInteractions, PERSONAS } from "../scripts/interactions";

// Same demo-corpus category counts as scripts/ingest.ts (135 docs total).
const CATEGORY_COUNTS: Record<string, number> = {
  java_programming: 18,
  java_coffee: 17,
  mercury_planet: 12,
  mercury_element: 12,
  mercury_car: 11,
  python_programming: 15,
  python_snake: 15,
  server_tech: 18,
  server_hospitality: 17,
};

function buildDocs(): { id: string; source: string }[] {
  const docs: { id: string; source: string }[] = [];
  for (const [source, count] of Object.entries(CATEGORY_COUNTS)) {
    for (let i = 0; i < count; i++) {
      docs.push({ id: `${source}-${i}`, source });
    }
  }
  return docs;
}

function cosine(a: number[], b: number[]): number {
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

// Mean pairwise cosine between two item groups (or within one, if the same
// indices are passed twice — self-pairs excluded).
function meanCrossCosine(items: number[][], groupA: number[], groupB: number[]): number {
  let sum = 0;
  let count = 0;
  for (const a of groupA) {
    for (const b of groupB) {
      if (a === b) continue;
      sum += cosine(items[a], items[b]);
      count++;
    }
  }
  return sum / count;
}

function itemIndicesFor(docs: { source: string }[], source: string): number[] {
  return docs.map((d, i) => (d.source === source ? i : -1)).filter((i) => i >= 0);
}

test("factorize rejects an empty matrix", () => {
  assert.throws(() => factorize([]));
});

test("reconstruction error decreases over training", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  const { epochErrors } = factorize(matrix);

  assert.equal(epochErrors.length, 200);
  assert.ok(
    epochErrors[epochErrors.length - 1] < epochErrors[0],
    `final RMSE ${epochErrors[epochErrors.length - 1]} should be below initial ${epochErrors[0]}`
  );
  // Substantial convergence, not just a wiggle: at least halved.
  assert.ok(epochErrors[epochErrors.length - 1] < epochErrors[0] / 2);
});

test("item vectors have BEHAVIOR_DIMS dimensions and unit L2 norm", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  const { itemVectors } = factorize(matrix);

  assert.equal(itemVectors.length, docs.length);
  for (const v of itemVectors) {
    assert.equal(v.length, BEHAVIOR_DIMS);
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `expected unit norm, got ${norm}`);
  }
});

test("factorization is deterministic across calls (fixed seed)", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  const a = factorize(matrix);
  const b = factorize(matrix);
  assert.deepEqual(a.itemVectors, b.itemVectors);
});

test("items sharing a persona audience end up closer than cross-domain items", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  const { itemVectors } = factorize(matrix);

  const javaProg = itemIndicesFor(docs, "java_programming");
  const mercuryCar = itemIndicesFor(docs, "mercury_car");

  const withinJavaProg = meanCrossCosine(itemVectors, javaProg, javaProg);
  const acrossDomains = meanCrossCosine(itemVectors, javaProg, mercuryCar);

  assert.ok(
    withinJavaProg > acrossDomains,
    `within-category similarity (${withinJavaProg}) should exceed cross-domain (${acrossDomains})`
  );
});

test("persona-linked categories are behaviorally closer than unlinked ones (serendipity)", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  const { itemVectors } = factorize(matrix);

  const coffee = itemIndicesFor(docs, "java_coffee");
  const hospitality = itemIndicesFor(docs, "server_hospitality");
  const planet = itemIndicesFor(docs, "mercury_planet");

  // barista + cafe_owner personas touch both java_coffee and server_hospitality;
  // no persona links java_coffee to mercury_planet.
  const linked = meanCrossCosine(itemVectors, coffee, hospitality);
  const unlinked = meanCrossCosine(itemVectors, coffee, planet);

  assert.ok(
    linked > unlinked,
    `persona-linked similarity (${linked}) should exceed unlinked (${unlinked})`
  );
});
