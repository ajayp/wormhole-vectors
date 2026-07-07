import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { bm25Search, baselineSearch, wormholeHop, denseSearch, rrfSearch, escapeSolrTerm } from "../src/search";

// Captured before any test below replaces global.fetch with a stub.
const realFetch: typeof fetch = global.fetch;

// The one test below that hits real Solr (not the fetch stub) needs its own guard —
// it isn't part of tests/integration/ so it doesn't get integration.test.ts's skip
// wrapper. Without this, an un-ingested core makes Solr return an HTML 404 page,
// which fails as a confusing "Unexpected token '<'" JSON parse error instead of a
// clean skip.
const SOLR_URL = process.env.SOLR_URL ?? "http://localhost:8983/solr";
let solrDemoReady = false;
try {
  const statusOut = execSync(
    `curl -s "${SOLR_URL}/admin/cores?action=STATUS&core=wormhole_demo"`,
    { timeout: 5000, encoding: "utf-8" }
  );
  const numDocs = JSON.parse(statusOut)?.status?.wormhole_demo?.index?.numDocs ?? 0;

  const schemaOut = execSync(`curl -s "${SOLR_URL}/wormhole_demo/schema/fields/vector"`, {
    timeout: 5000,
    encoding: "utf-8",
  });
  const hasVectorField = JSON.parse(schemaOut)?.responseHeader?.status === 0;

  solrDemoReady = numDocs > 0 && hasVectorField;
} catch {
  // Solr is down — the test below will skip.
}
const liveSolrSkipReason = solrDemoReady ? undefined : "live Solr + `npm run ingest` required";

function stubFetch(responseBody: unknown) {
  const calls: Array<{ url: string; body: any }> = [];
  (global as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    return {
      ok: true,
      json: async () => responseBody,
    } as Response;
  };
  return calls;
}

test("escapeSolrTerm escapes Lucene special characters", () => {
  assert.equal(escapeSolrTerm('a:b+c"d'), 'a\\:b\\+c\\"d');
});

test("bm25Search queries text_terms (not text) with relatedness boosts", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await bm25Search([{ term: "server", relatedness: 0.9 }, { term: "rack", relatedness: 0.3 }], 5);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.query, "text_terms:server^0.9 OR text_terms:rack^0.3");
});

test("bm25Search escapes special characters in terms", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await bm25Search([{ term: "c++", relatedness: 0.5 }], 5);

  assert.equal(calls[0].body.query, "text_terms:c\\+\\+^0.5");
});

test("bm25Search returns empty array without calling Solr for no terms", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  const result = await bm25Search([], 5);

  assert.deepEqual(result, []);
  assert.equal(calls.length, 0);
});

test("baselineSearch binds every token of a multi-word query to text", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await baselineSearch("the server I ordered food from", 5);

  assert.equal(calls[0].body.query, "text:(the server I ordered food from)");
});

test("baselineSearch escapes special characters in query tokens", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await baselineSearch('c++ vs "java"', 5);

  assert.equal(calls[0].body.query, 'text:(c\\+\\+ vs \\"java\\")');
});

test("baselineSearch handles README example: 'server'", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await baselineSearch("server", 5);

  assert.equal(calls[0].body.query, "text:(server)");
});

test("baselineSearch handles README example: 'server I ordered food from'", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await baselineSearch("server I ordered food from", 5);

  assert.equal(calls[0].body.query, "text:(server I ordered food from)");
});

test("wormholeHop extracts term + relatedness pairs from facet buckets", async () => {
  stubFetch({
    response: { docs: [{ id: "1", title: "t", text: "x" }] },
    facets: {
      wormhole_terms: {
        buckets: [
          { val: "server", relatedness: { relatedness: 0.9 } },
          { val: "rack", relatedness: { relatedness: 0.4 } },
        ],
      },
    },
  });

  const result = await wormholeHop([0.1, 0.2], 10);

  assert.deepEqual(result.skgTerms, [
    { term: "server", relatedness: 0.9 },
    { term: "rack", relatedness: 0.4 },
  ]);
  assert.deepEqual(result.skgCategories, []);
  assert.equal(result.docs.length, 1);
});

test("wormholeHop extracts category buckets alongside term buckets", async () => {
  stubFetch({
    response: { docs: [{ id: "1", title: "t", text: "x" }] },
    facets: {
      wormhole_terms: {
        buckets: [{ val: "server", relatedness: { relatedness: 0.9 } }],
      },
      wormhole_categories: {
        buckets: [
          { val: "java_programming", relatedness: { relatedness: 0.34 } },
          { val: "server_tech", relatedness: { relatedness: 0.12 } },
        ],
      },
    },
  });

  const result = await wormholeHop([0.1, 0.2], 10);

  assert.deepEqual(result.skgCategories, [
    { term: "java_programming", relatedness: 0.34 },
    { term: "server_tech", relatedness: 0.12 },
  ]);
});

test("wormholeHop requests the vector field when withVectors is set", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await wormholeHop([0.1, 0.2], 10, { withVectors: true });

  assert.ok((calls[0].body.fields as string[]).includes("vector"));
});

test("wormholeHop omits the vector field by default", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await wormholeHop([0.1, 0.2], 10);

  assert.ok(!(calls[0].body.fields as string[]).includes("vector"));
});

test("wormholeHop parses stringified vector components back to numbers", async () => {
  stubFetch({
    response: { docs: [{ id: "1", title: "t", vector: ["0.1", "0.2", "-3e-33"] }] },
  });

  const result = await wormholeHop([0.1, 0.2], 10, { withVectors: true });

  assert.deepEqual(result.docs[0].vector, [0.1, 0.2, -3e-33]);
});

test("denseSearch runs a plain KNN query with no facet", async () => {
  const calls = stubFetch({ response: { docs: [{ id: "1", title: "t" }] } });

  const docs = await denseSearch([0.1, 0.2], 5);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.query, "{!knn f=vector topK=5}[0.1,0.2]");
  assert.equal(calls[0].body.facet, undefined);
  assert.equal(docs.length, 1);
});

test("denseSearch targets the behavior_vector field when requested", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await denseSearch([0.1, 0.2], 5, { field: "behavior_vector" });

  assert.equal(calls[0].body.query, "{!knn f=behavior_vector topK=5}[0.1,0.2]");
});

test("denseSearch requests the behavior_vector field when withBehaviorVectors is set", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await denseSearch([0.1, 0.2], 5, { withBehaviorVectors: true });

  assert.ok((calls[0].body.fields as string[]).includes("behavior_vector"));
});

// rrfSearch fires baselineSearch and denseSearch concurrently over the same
// fetch stub — route by query shape (KNN clause vs. text:(...)) so each leg
// gets its own doc set.
function stubFetchByQueryShape(sparseDocs: Array<{ id: string }>, denseDocs: Array<{ id: string }>) {
  (global as any).fetch = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const docs = (body.query as string).startsWith("{!knn") ? denseDocs : sparseDocs;
    return { ok: true, json: async () => ({ response: { docs } }) } as Response;
  };
}

test("rrfSearch fuses sparse and dense rankings by reciprocal rank", async () => {
  stubFetchByQueryShape(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    [{ id: "b" }, { id: "a" }, { id: "d" }]
  );

  const docs = await rrfSearch("query", 5, { embed: async () => [0.1, 0.2] });

  // "a" and "b" each appear in both lists (higher fused score); "b" has the
  // better combined rank (1st dense + 2nd sparse) than "a" (1st sparse + 2nd dense)
  // — tied ranks-sum, but RRF's harmonic weighting favors "b" here since rank 1
  // contributes more than rank 2 non-linearly. Assert set membership and that
  // both doubly-ranked docs outrank the singly-ranked ones, rather than pinning
  // an exact order that's sensitive to the RRF_K constant.
  const ids = docs.map((d) => d.id);
  assert.deepEqual(new Set(ids), new Set(["a", "b", "c", "d"]));
  assert.ok(ids.indexOf("a") < ids.indexOf("c"));
  assert.ok(ids.indexOf("b") < ids.indexOf("d"));
});

test("rrfSearch truncates to k", async () => {
  stubFetchByQueryShape(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    [{ id: "d" }, { id: "e" }, { id: "f" }]
  );

  const docs = await rrfSearch("query", 2, { embed: async () => [0.1, 0.2] });

  assert.equal(docs.length, 2);
});

test("denseSearch parses stringified behavior_vector components back to numbers", async () => {
  stubFetch({
    response: { docs: [{ id: "1", title: "t", behavior_vector: ["0.5", "-0.25"] }] },
  });

  const docs = await denseSearch([0.1, 0.2], 5, { withBehaviorVectors: true });

  assert.deepEqual(docs[0].behavior_vector, [0.5, -0.25]);
});

test("bm25Search ORs in category clauses when provided", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await bm25Search(
    [{ term: "server", relatedness: 0.9 }],
    5,
    { categories: [{ term: "java_programming", relatedness: 0.34 }] }
  );

  assert.equal(
    calls[0].body.query,
    'text_terms:server^0.9 OR source:"java_programming"^0.34'
  );
});

test("bm25Search drops non-positive relatedness terms and categories (Solr boost must be positive)", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await bm25Search(
    [
      { term: "server", relatedness: 0.9 },
      { term: "rack", relatedness: -0.02 },
    ],
    5,
    {
      categories: [
        { term: "java_programming", relatedness: 0.34 },
        { term: "java_coffee", relatedness: -0.01 },
      ],
    }
  );

  assert.equal(
    calls[0].body.query,
    'text_terms:server^0.9 OR source:"java_programming"^0.34'
  );
});

test("bm25Search returns empty array without calling Solr when every term/category is non-positive", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  const result = await bm25Search([{ term: "rack", relatedness: -0.02 }], 5);

  assert.deepEqual(result, []);
  assert.equal(calls.length, 0);
});

test("baselineSearch requests the vector field when withVectors is set", async () => {
  const calls = stubFetch({ response: { docs: [] } });

  await baselineSearch("server", 5, { withVectors: true });

  assert.ok((calls[0].body.fields as string[]).includes("vector"));
});

// Requires a live Solr instance with the corpus already ingested (docker compose up -d && npm run ingest).
// Unlike the tests above, this hits real Solr to confirm the text_stem field type (src/solr.ts) actually
// stems at index time, not just that our code builds the right query string.
test(
  "text_stem collapses plural/singular forms to one indexed token in Solr",
  { skip: liveSolrSkipReason },
  async () => {
    const res = await realFetch(
      `${SOLR_URL}/wormhole_demo/terms?terms.fl=text_terms&terms.prefix=server&terms.limit=20&wt=json`
    );
    const body = (await res.json()) as { terms: { text_terms: (string | number)[] } };
    const terms = body.terms.text_terms.filter((_, i) => i % 2 === 0) as string[];

    assert.ok(terms.includes("server"), `expected stemmed token "server" among indexed terms: ${terms}`);
    assert.ok(!terms.includes("servers"), `unstemmed "servers" should not exist as a separate token: ${terms}`);
  }
);
