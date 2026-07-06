import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeWormholeResults,
  mergeWormholeResultsDenseFirst,
  mergeWormholeResultsBehavioralFirst,
} from "../src/wormhole";
import { SolrDoc } from "../src/search";

const doc = (id: string): SolrDoc => ({ id, title: `title-${id}` });

test("sparse results come first, in order", () => {
  const sparse = [doc("s1"), doc("s2")];
  const dense = [doc("d1"), doc("d2"), doc("d3")];

  const merged = mergeWormholeResults(sparse, dense, 5);

  assert.deepEqual(merged.map((d) => d.id), ["s1", "s2", "d1", "d2", "d3"]);
});

test("dense backfills remaining slots when sparse is short", () => {
  const sparse = [doc("s1")];
  const dense = [doc("d1"), doc("d2"), doc("d3")];

  const merged = mergeWormholeResults(sparse, dense, 3);

  assert.deepEqual(merged.map((d) => d.id), ["s1", "d1", "d2"]);
});

test("dedupes by id, preferring the sparse occurrence", () => {
  const sparse = [doc("shared"), doc("s2")];
  const dense = [doc("shared"), doc("d1")];

  const merged = mergeWormholeResults(sparse, dense, 5);

  assert.deepEqual(merged.map((d) => d.id), ["shared", "s2", "d1"]);
});

test("falls back to dense-only when sparse is empty", () => {
  const dense = [doc("d1"), doc("d2")];

  const merged = mergeWormholeResults([], dense, 5);

  assert.deepEqual(merged.map((d) => d.id), ["d1", "d2"]);
});

test("truncates at finalK even if more candidates are available", () => {
  const sparse = [doc("s1"), doc("s2"), doc("s3")];
  const dense = [doc("d1"), doc("d2"), doc("d3")];

  const merged = mergeWormholeResults(sparse, dense, 2);

  assert.deepEqual(merged.map((d) => d.id), ["s1", "s2"]);
});

test("tags sparse results with hop: sparse", () => {
  const sparse = [doc("s1"), doc("s2")];
  const dense = [doc("d1")];

  const merged = mergeWormholeResults(sparse, dense, 5);

  assert.equal(merged[0].hop, "sparse");
  assert.equal(merged[1].hop, "sparse");
});

test("tags dense results with hop: dense", () => {
  const sparse = [doc("s1")];
  const dense = [doc("d1"), doc("d2")];

  const merged = mergeWormholeResults(sparse, dense, 5);

  assert.equal(merged[1].hop, "dense");
  assert.equal(merged[2].hop, "dense");
});

test("deduped shared doc retains hop: sparse (preferring sparse origin)", () => {
  const sparse = [doc("shared")];
  const dense = [doc("shared"), doc("d1")];

  const merged = mergeWormholeResults(sparse, dense, 5);

  assert.equal(merged[0].id, "shared");
  assert.equal(merged[0].hop, "sparse");
});

// ── mergeWormholeResultsDenseFirst (sparse→dense mirror image) ──────────

test("dense results come first, in order", () => {
  const dense = [doc("d1"), doc("d2")];
  const sparse = [doc("s1"), doc("s2"), doc("s3")];

  const merged = mergeWormholeResultsDenseFirst(dense, sparse, 5);

  assert.deepEqual(merged.map((d) => d.id), ["d1", "d2", "s1", "s2", "s3"]);
});

test("sparse backfills remaining slots when dense is short", () => {
  const dense = [doc("d1")];
  const sparse = [doc("s1"), doc("s2"), doc("s3")];

  const merged = mergeWormholeResultsDenseFirst(dense, sparse, 3);

  assert.deepEqual(merged.map((d) => d.id), ["d1", "s1", "s2"]);
});

test("dedupes by id, preferring the dense occurrence", () => {
  const dense = [doc("shared"), doc("d2")];
  const sparse = [doc("shared"), doc("s1")];

  const merged = mergeWormholeResultsDenseFirst(dense, sparse, 5);

  assert.deepEqual(merged.map((d) => d.id), ["shared", "d2", "s1"]);
  assert.equal(merged[0].hop, "dense");
});

test("falls back to sparse-only when dense is empty", () => {
  const sparse = [doc("s1"), doc("s2")];

  const merged = mergeWormholeResultsDenseFirst([], sparse, 5);

  assert.deepEqual(merged.map((d) => d.id), ["s1", "s2"]);
  assert.equal(merged[0].hop, "sparse");
});

// ── mergeWormholeResultsBehavioralFirst (behavioral space, Phase D) ──────

test("behavioral results come first and are tagged hop: behavioral", () => {
  const behavioral = [doc("b1"), doc("b2")];
  const dense = [doc("d1"), doc("d2")];

  const merged = mergeWormholeResultsBehavioralFirst(behavioral, dense, 5);

  assert.deepEqual(merged.map((d) => d.id), ["b1", "b2", "d1", "d2"]);
  assert.equal(merged[0].hop, "behavioral");
  assert.equal(merged[1].hop, "behavioral");
  assert.equal(merged[2].hop, "dense");
});

test("dedupes by id, preferring the behavioral occurrence", () => {
  const behavioral = [doc("shared"), doc("b2")];
  const dense = [doc("shared"), doc("d1")];

  const merged = mergeWormholeResultsBehavioralFirst(behavioral, dense, 5);

  assert.deepEqual(merged.map((d) => d.id), ["shared", "b2", "d1"]);
  assert.equal(merged[0].hop, "behavioral");
});

test("falls back to dense-only when behavioral is empty", () => {
  const dense = [doc("d1"), doc("d2")];

  const merged = mergeWormholeResultsBehavioralFirst([], dense, 5);

  assert.deepEqual(merged.map((d) => d.id), ["d1", "d2"]);
  assert.equal(merged[0].hop, "dense");
});
