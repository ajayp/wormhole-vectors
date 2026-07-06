import { test } from "node:test";
import assert from "node:assert/strict";
import { poolVectors, foregroundSpecificity } from "../src/pool";

test("poolVectors averages element-wise", () => {
  const pooled = poolVectors([
    [1, 0],
    [0, 1],
  ]);

  // mean is [0.5, 0.5], then L2-normalized
  const expectedNorm = Math.sqrt(0.5 ** 2 + 0.5 ** 2);
  assert.ok(Math.abs(pooled[0] - 0.5 / expectedNorm) < 1e-9);
  assert.ok(Math.abs(pooled[1] - 0.5 / expectedNorm) < 1e-9);
});

test("poolVectors returns an L2-normalized vector", () => {
  const pooled = poolVectors([
    [3, 4],
    [3, 4],
  ]);
  const norm = Math.sqrt(pooled.reduce((acc, x) => acc + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
});

test("poolVectors throws on empty input", () => {
  assert.throws(() => poolVectors([]));
});

test("poolVectors handles a single vector (pooled == normalized input)", () => {
  const pooled = poolVectors([[3, 4]]);
  assert.ok(Math.abs(pooled[0] - 0.6) < 1e-9);
  assert.ok(Math.abs(pooled[1] - 0.8) < 1e-9);
});

test("foregroundSpecificity is 1 when all vectors are identical (tight cluster)", () => {
  const specificity = foregroundSpecificity([
    [1, 0],
    [1, 0],
    [1, 0],
  ]);
  assert.ok(Math.abs(specificity - 1) < 1e-9);
});

test("foregroundSpecificity is lower for spread-out vectors than for a tight cluster", () => {
  const tight = foregroundSpecificity([
    [1, 0],
    [0.99, 0.01],
    [0.98, 0.02],
  ]);
  const broad = foregroundSpecificity([
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]);

  assert.ok(tight > broad, `expected tight (${tight}) > broad (${broad})`);
});

test("foregroundSpecificity throws on empty input", () => {
  assert.throws(() => foregroundSpecificity([]));
});
