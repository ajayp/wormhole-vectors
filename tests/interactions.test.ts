import { test } from "node:test";
import assert from "node:assert/strict";
import { generateInteractions, PERSONAS } from "../scripts/interactions";

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

test("generateInteractions is deterministic across calls", () => {
  const docs = buildDocs();
  const a = generateInteractions(docs);
  const b = generateInteractions(docs);
  assert.deepEqual(a, b);
});

test("generateInteractions produces correct dimensions", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  assert.equal(matrix.length, PERSONAS.length);
  for (const row of matrix) {
    assert.equal(row.length, docs.length);
  }
});

test("every item has at least one interaction", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  for (let i = 0; i < docs.length; i++) {
    const total = matrix.reduce((sum, row) => sum + row[i], 0);
    assert.ok(total > 0, `item ${docs[i].id} has no interactions`);
  }
});

test("values are restricted to 0, 1, or 3", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  for (const row of matrix) {
    for (const value of row) {
      assert.ok([0, 1, 3].includes(value));
    }
  }
});

test("at least a third of personas span 2+ categories with observed interactions", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);

  let crossCategoryPersonas = 0;
  PERSONAS.forEach((persona, u) => {
    const touchedCategories = new Set<string>();
    matrix[u].forEach((value, i) => {
      if (value > 0) touchedCategories.add(docs[i].source);
    });
    if (touchedCategories.size >= 2) crossCategoryPersonas += 1;
  });

  assert.ok(
    crossCategoryPersonas >= Math.floor(PERSONAS.length / 3),
    `expected at least ${Math.floor(PERSONAS.length / 3)} cross-category personas, got ${crossCategoryPersonas}`,
  );
});

test("matrix density is sparse (roughly 10-20% nonzero)", () => {
  const docs = buildDocs();
  const matrix = generateInteractions(docs);
  const total = matrix.length * docs.length;
  const nonzero = matrix.reduce((sum, row) => sum + row.filter((v) => v > 0).length, 0);
  const density = nonzero / total;
  assert.ok(density > 0.03 && density < 0.35, `density out of expected range: ${density}`);
});
