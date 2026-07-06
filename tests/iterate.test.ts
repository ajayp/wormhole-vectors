import { test } from "node:test";
import assert from "node:assert/strict";
import { iterativeWormholeSearch } from "../src/iterate";

const fakeEmbed = async () => [0.1, 0.2, 0.3];

// Each call to fetch consumes the next queued response (or the last one, if
// the queue is shorter than the number of calls) — lets a single test script
// a full multi-hop sequence (wormholeHop, then alternating bm25Search/denseSearch).
function queueFetch(responses: unknown[]) {
  const calls: Array<{ url: string; body: any }> = [];
  let i = 0;
  (global as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const body = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: true, json: async () => body } as Response;
  };
  return calls;
}

function wormholeHopResponse(docs: Array<Record<string, unknown>>, terms: string[] = ["server"]) {
  return {
    response: { docs },
    facets: {
      wormhole_terms: { buckets: terms.map((t) => ({ val: t, relatedness: { relatedness: 0.5 } })) },
      wormhole_categories: { buckets: [] },
    },
  };
}

function docsResponse(docs: Array<Record<string, unknown>>) {
  return { response: { docs } };
}

test("hop 1 runs a dense+SKG hop and records its docs", async () => {
  const calls = queueFetch([wormholeHopResponse([{ id: "d1" }, { id: "d2" }])]);

  const result = await iterativeWormholeSearch("q", { embed: fakeEmbed, maxHops: 1 });

  assert.equal(calls.length, 1);
  assert.deepEqual(result.hopStats, [{ hop: 1, newDocs: 2 }]);
  assert.deepEqual(
    result.finalResults.map((d) => [d.id, d.hopNumber]),
    [["d1", 1], ["d2", 1]]
  );
});

test("hop 2 (even) runs bm25Search using hop 1's SKG terms", async () => {
  const calls = queueFetch([
    wormholeHopResponse([{ id: "d1" }], ["server"]),
    docsResponse([{ id: "d2" }]),
  ]);

  const result = await iterativeWormholeSearch("q", { embed: fakeEmbed, maxHops: 2 });

  assert.equal(calls.length, 2);
  assert.match(calls[1].body.query, /text_terms:server/);
  assert.deepEqual(result.hopStats, [
    { hop: 1, newDocs: 1 },
    { hop: 2, newDocs: 1 },
  ]);
});

test("hop 3 (odd) pools hop 2's vectors into a dense KNN", async () => {
  const calls = queueFetch([
    wormholeHopResponse([{ id: "d1" }], ["server"]),
    docsResponse([{ id: "d2", vector: ["0.1", "0.2", "0.3"] }]),
    docsResponse([{ id: "d3" }]),
  ]);

  const result = await iterativeWormholeSearch("q", { embed: fakeEmbed, maxHops: 3, minNewDocs: 1 });

  assert.equal(calls.length, 3);
  assert.match(calls[2].body.query, /{!knn f=vector/);
  assert.deepEqual(result.hopStats.map((h) => h.hop), [1, 2, 3]);
});

test("stops early on convergence: a hop contributing fewer than minNewDocs new docs halts iteration", async () => {
  const calls = queueFetch([
    wormholeHopResponse([{ id: "d1" }, { id: "d2" }], ["server"]),
    // hop 2 returns only a doc already seen at hop 1 -> 0 new docs < minNewDocs
    docsResponse([{ id: "d1" }]),
  ]);

  const result = await iterativeWormholeSearch("q", {
    embed: fakeEmbed,
    maxHops: 4,
    minNewDocs: 1,
  });

  assert.equal(calls.length, 2, "should stop after hop 2 instead of continuing to hop 3/4");
  assert.deepEqual(result.hopStats, [
    { hop: 1, newDocs: 2 },
    { hop: 2, newDocs: 0 },
  ]);
});

test("runs all maxHops when every hop keeps contributing enough new docs", async () => {
  const calls = queueFetch([
    wormholeHopResponse([{ id: "d1" }], ["server"]),
    docsResponse([{ id: "d2", vector: ["0.1", "0.2"] }, { id: "d3", vector: ["0.3", "0.4"] }]),
    docsResponse([{ id: "d4" }, { id: "d5" }, { id: "d6" }, { id: "d7" }]),
    docsResponse([{ id: "d8" }, { id: "d9" }]),
  ]);

  const result = await iterativeWormholeSearch("q", {
    embed: fakeEmbed,
    maxHops: 4,
    minNewDocs: 1,
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(result.hopStats.map((h) => h.hop), [1, 2, 3, 4]);
});

test("breaks before hop 2 when hop 1 has no SKG terms", async () => {
  const calls = queueFetch([wormholeHopResponse([{ id: "d1" }], [])]);

  const result = await iterativeWormholeSearch("q", { embed: fakeEmbed, maxHops: 4 });

  assert.equal(calls.length, 1, "no bm25Search call should be made without SKG terms");
  assert.deepEqual(result.hopStats, [{ hop: 1, newDocs: 1 }]);
});

test("breaks before hop 3 when hop 2's docs carry no vectors to pool", async () => {
  const calls = queueFetch([
    wormholeHopResponse([{ id: "d1" }], ["server"]),
    docsResponse([{ id: "d2" }]), // no vector field
  ]);

  const result = await iterativeWormholeSearch("q", { embed: fakeEmbed, maxHops: 4, minNewDocs: 1 });

  assert.equal(calls.length, 2, "no denseSearch call should be made without pooled vectors");
});

test("dedupes documents across hops: a doc re-surfacing at a later hop isn't double-counted", async () => {
  const calls = queueFetch([
    wormholeHopResponse([{ id: "d1" }, { id: "d2" }], ["server"]),
    docsResponse([{ id: "d1" }, { id: "d3" }]), // d1 repeats, only d3 is new
  ]);

  const result = await iterativeWormholeSearch("q", { embed: fakeEmbed, maxHops: 2, minNewDocs: 1 });

  assert.equal(calls.length, 2);
  assert.equal(result.hopStats[1].newDocs, 1);
  const ids = result.finalResults.map((d) => d.id);
  assert.deepEqual(ids, ["d1", "d2", "d3"], "d1 should appear once, tagged with its first-discovery hop");
  assert.equal(result.finalResults.find((d) => d.id === "d1")?.hopNumber, 1);
});

test("truncates finalResults to finalK while preserving discovery order across hops", async () => {
  const calls = queueFetch([
    wormholeHopResponse([{ id: "d1" }, { id: "d2" }], ["server"]),
    docsResponse([{ id: "d3" }, { id: "d4" }]),
  ]);

  const result = await iterativeWormholeSearch("q", {
    embed: fakeEmbed,
    maxHops: 2,
    minNewDocs: 1,
    finalK: 3,
  });

  assert.deepEqual(result.finalResults.map((d) => d.id), ["d1", "d2", "d3"]);
});

test("threads the core option through every hop's Solr request", async () => {
  const calls = queueFetch([
    wormholeHopResponse([{ id: "d1" }], ["server"]),
    docsResponse([{ id: "d2" }]),
  ]);

  await iterativeWormholeSearch("q", { embed: fakeEmbed, maxHops: 2, core: "wormhole_large" });

  for (const call of calls) {
    assert.match(call.url, /\/wormhole_large\/select/);
  }
});
