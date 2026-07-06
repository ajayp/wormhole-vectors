/**
 * Integration tests — require a live Solr instance with the demo corpus ingested.
 *
 *   docker compose up -d && npm run ingest
 *   npm run test:integration
 *
 * These tests verify retrieval *outcomes* (disambiguation, semantic coherence,
 * wormhole-vs-baseline deltas), not just query-string mechanics.  They exercise
 * the full wormholeSearch() orchestrator end-to-end against real Solr.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as dotenv from "dotenv";

dotenv.config();

import { wormholeSearch, wormholeSearchSparseToDense } from "../../src/wormhole";
import { baselineSearch, wormholeHop } from "../../src/search";
import { embedText } from "../../src/embed";
import { iterativeWormholeSearch } from "../../src/iterate";

const SOLR_URL = process.env.SOLR_URL ?? "http://localhost:8983/solr";
const FINAL_K = 5;

// Synchronous Solr liveness check — avoids top-level await (unsupported in CJS).
// Returns true only if Solr responds AND the wormhole_demo core has > 0 docs.
let solrAlive = false;
try {
  const out = execSync(
    `curl -s "${SOLR_URL}/admin/cores?action=STATUS&core=wormhole_demo"`,
    { timeout: 5000, encoding: "utf-8" }
  );
  const numDocs = JSON.parse(out)?.status?.wormhole_demo?.index?.numDocs ?? 0;
  solrAlive = numDocs > 0;
} catch {
  // Solr is down — tests below will each skip.
}

const skipReason = solrAlive ? undefined : "live Solr + ingested corpus required";

/** Helper that wraps test() with a Solr availability guard. */
function integrationTest(name: string, fn: () => Promise<void>) {
  test(name, { skip: skipReason }, fn);
}

// ──────────────────────────────────────────────────────────────────────
// 1. End-to-end disambiguation — context-steered queries land correctly
// ──────────────────────────────────────────────────────────────────────

integrationTest("'server I ordered food from' → all results are server_hospitality", async () => {
  const result = await wormholeSearch("server I ordered food from", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0, "expected at least one result");
  for (const doc of result.finalResults) {
    assert.equal(
      doc.source,
      "server_hospitality",
      `result "${doc.title}" has source "${doc.source}", expected server_hospitality`
    );
  }
});

integrationTest("'Java' → all results are java_programming (not coffee)", async () => {
  const result = await wormholeSearch("Java", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  for (const doc of result.finalResults) {
    assert.equal(
      doc.source,
      "java_programming",
      `result "${doc.title}" has source "${doc.source}", expected java_programming`
    );
  }
});

integrationTest("'Mercury poison' → all results are mercury_element", async () => {
  const result = await wormholeSearch("Mercury poison", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  for (const doc of result.finalResults) {
    assert.equal(
      doc.source,
      "mercury_element",
      `result "${doc.title}" has source "${doc.source}", expected mercury_element`
    );
  }
});

// ──────────────────────────────────────────────────────────────────────
// 2. SKG term semantic coherence
// ──────────────────────────────────────────────────────────────────────

integrationTest("'Mercury poison' → SKG terms include mercury/element/toxic, not planet/car", async () => {
  const result = await wormholeSearch("Mercury poison", { finalK: FINAL_K });
  const terms = result.skgTerms.map((t) => t.term);

  assert.ok(terms.includes("mercuri"), `expected stemmed "mercuri" in SKG terms: ${terms}`);

  // Planet-specific and car-specific vocabulary should NOT appear
  const forbidden = ["planet", "orbit", "crater", "car", "ford", "sedan", "cougar"];
  const leaked = forbidden.filter((f) => terms.includes(f));
  assert.equal(leaked.length, 0, `unexpected non-element SKG terms leaked: ${leaked}`);
});

integrationTest("'server I ordered food from' → SKG terms are hospitality-leaning", async () => {
  const result = await wormholeSearch("server I ordered food from", { finalK: FINAL_K });
  const terms = result.skgTerms.map((t) => t.term);

  // At least one hospitality-specific term should be present
  const hospitalityTerms = ["restaur", "dine", "food", "guest", "servic", "menu", "tip"];
  const found = hospitalityTerms.filter((t) => terms.includes(t));
  assert.ok(found.length >= 2, `expected ≥2 hospitality SKG terms, found ${found} in ${terms}`);
});

// ──────────────────────────────────────────────────────────────────────
// 3. Wormhole vs. baseline — the wormhole should disambiguate better
// ──────────────────────────────────────────────────────────────────────

integrationTest("wormhole disambiguates 'Mercury poison' better than baseline", async () => {
  const [wormhole, baseline] = await Promise.all([
    wormholeSearch("Mercury poison", { finalK: FINAL_K }),
    baselineSearch("Mercury poison", FINAL_K),
  ]);

  // Wormhole should return only mercury_element docs
  for (const doc of wormhole.finalResults) {
    assert.equal(doc.source, "mercury_element");
  }

  // Baseline should mix sources (it lacks context-driven disambiguation)
  const baselineSources = new Set(baseline.map((d) => d.source));
  assert.ok(
    baselineSources.size > 1,
    `baseline should return mixed sources, got: ${[...baselineSources]}`
  );
});

integrationTest("wormhole disambiguates 'Java' better than baseline", async () => {
  const [wormhole, baseline] = await Promise.all([
    wormholeSearch("Java", { finalK: FINAL_K }),
    baselineSearch("Java", FINAL_K),
  ]);

  // Wormhole should return only java_programming docs
  for (const doc of wormhole.finalResults) {
    assert.equal(doc.source, "java_programming");
  }

  // Baseline should mix programming + coffee (both contain "java" literally)
  const baselineSources = new Set(baseline.map((d) => d.source));
  assert.ok(
    baselineSources.size > 1,
    `baseline should return mixed java_programming + java_coffee, got: ${[...baselineSources]}`
  );
});

// ──────────────────────────────────────────────────────────────────────
// 4. Full pipeline shape — SKG terms returned with relatedness scores
// ──────────────────────────────────────────────────────────────────────

integrationTest("wormholeSearch returns SKG terms with relatedness > 0", async () => {
  const result = await wormholeSearch("Python programming", { finalK: FINAL_K });

  assert.ok(result.skgTerms.length > 0, "expected non-empty SKG terms");
  for (const t of result.skgTerms) {
    assert.ok(t.relatedness > 0, `term "${t.term}" has non-positive relatedness: ${t.relatedness}`);
    assert.equal(typeof t.term, "string");
  }
});

integrationTest("wormholeHop returns foreground docs + SKG terms from live Solr", async () => {
  const vector = await embedText("server");
  const { docs, skgTerms } = await wormholeHop(vector, 15);

  assert.ok(docs.length > 0, "expected foreground docs from KNN");
  assert.ok(skgTerms.length > 0, "expected SKG terms from facet");
  assert.ok(skgTerms.length <= 8, `SKG terms should respect limit (got ${skgTerms.length})`);
});

// ──────────────────────────────────────────────────────────────────────
// 5. Schema / stemming invariant (live Solr)
// ──────────────────────────────────────────────────────────────────────

integrationTest("text_stem collapses plural/singular in live index (server ≠ servers)", async () => {
  const res = await fetch(
    `${SOLR_URL}/wormhole_demo/terms?terms.fl=text_terms&terms.prefix=server&terms.limit=20&wt=json`
  );
  assert.ok(res.ok, "Solr terms endpoint should respond");

  const body = (await res.json()) as { terms: { text_terms: (string | number)[] } };
  const terms = body.terms.text_terms.filter((_, i) => i % 2 === 0) as string[];

  assert.ok(terms.includes("server"), `expected stemmed "server" token: ${terms}`);
  assert.ok(!terms.includes("servers"), `unstemmed "servers" should not exist: ${terms}`);
});

integrationTest("text_stem collapses plural/singular in live index (python ≠ pythons)", async () => {
  const res = await fetch(
    `${SOLR_URL}/wormhole_demo/terms?terms.fl=text_terms&terms.prefix=python&terms.limit=20&wt=json`
  );
  assert.ok(res.ok);

  const body = (await res.json()) as { terms: { text_terms: (string | number)[] } };
  const terms = body.terms.text_terms.filter((_, i) => i % 2 === 0) as string[];

  assert.ok(terms.includes("python"), `expected stemmed "python" token: ${terms}`);
  assert.ok(!terms.includes("pythons"), `unstemmed "pythons" should not exist: ${terms}`);
});

// ──────────────────────────────────────────────────────────────────────
// PRIORITY 1: Complete disambiguation matrix (Python, Mercury planet/car, server tech)
// ──────────────────────────────────────────────────────────────────────

integrationTest("'Python constrictor' → majority results are python_snake", async () => {
  const result = await wormholeSearch("Python constrictor", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  const snakeCount = result.finalResults.filter((d) => d.source === "python_snake").length;
  assert.ok(snakeCount >= 3, `expected ≥3 snake results, got ${snakeCount}/${FINAL_K}`);
});

integrationTest("'Python data science' → majority results are python_programming", async () => {
  const result = await wormholeSearch("Python data science", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  const progCount = result.finalResults.filter((d) => d.source === "python_programming").length;
  assert.ok(progCount >= 3, `expected ≥3 programming results, got ${progCount}/${FINAL_K}`);
});

integrationTest("'Mercury orbit planet' → all results are mercury_planet", async () => {
  const result = await wormholeSearch("Mercury orbit planet", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  for (const doc of result.finalResults) {
    assert.equal(
      doc.source,
      "mercury_planet",
      `result "${doc.title}" has source "${doc.source}", expected mercury_planet`
    );
  }
});

integrationTest("'Mercury Cougar car' → all results are mercury_car", async () => {
  const result = await wormholeSearch("Mercury Cougar car", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  for (const doc of result.finalResults) {
    assert.equal(
      doc.source,
      "mercury_car",
      `result "${doc.title}" has source "${doc.source}", expected mercury_car`
    );
  }
});

integrationTest("'server Linux deployment' → majority results are server_tech", async () => {
  const result = await wormholeSearch("server Linux deployment", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  const techCount = result.finalResults.filter((d) => d.source === "server_tech").length;
  assert.ok(techCount >= 3, `expected ≥3 server_tech results, got ${techCount}/${FINAL_K}`);
});

// ──────────────────────────────────────────────────────────────────────
// PRIORITY 2: No-context boundary tests (defines expected limitations)
// ──────────────────────────────────────────────────────────────────────

integrationTest("'server' (no context) → mixed sources (expected ambiguity)", async () => {
  const result = await wormholeSearch("server", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  const sources = new Set(result.finalResults.map((d) => d.source));
  assert.ok(sources.size > 1, `no-context 'server' should return mixed sources, got: ${[...sources]}`);
});

integrationTest("'Mercury' (no context) → mixed sources (expected ambiguity)", async () => {
  const result = await wormholeSearch("Mercury", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  const sources = new Set(result.finalResults.map((d) => d.source));
  assert.ok(
    sources.size > 1,
    `no-context 'Mercury' should return mixed sources (planet/element/car), got: ${[...sources]}`
  );
});

// ──────────────────────────────────────────────────────────────────────
// PRIORITY 3: Ranking quality (top results are most relevant)
// ──────────────────────────────────────────────────────────────────────

integrationTest("'Python data science' → top result contains python/data/science vocabulary", async () => {
  const result = await wormholeSearch("Python data science", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  const topTitle = (result.finalResults[0].title ?? "").toLowerCase();
  const topText = (result.finalResults[0].text ?? "").toLowerCase();
  const topContent = topTitle + " " + topText;

  const relevantTerms = ["python", "data", "scienc", "numpi", "panda", "sklearn", "pytorch"];
  const hasRelevance = relevantTerms.some((term) => topContent.includes(term));
  assert.ok(
    hasRelevance,
    `top result "${result.finalResults[0].title}" should contain python/data science vocabulary`
  );
});

integrationTest("'Mercury poison' → top result contains mercury/toxicity vocabulary", async () => {
  const result = await wormholeSearch("Mercury poison", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  const topTitle = (result.finalResults[0].title ?? "").toLowerCase();
  const topText = (result.finalResults[0].text ?? "").toLowerCase();
  const topContent = topTitle + " " + topText;

  const relevantTerms = ["mercury", "toxic", "poison", "element", "mining", "health", "vapour"];
  const hasRelevance = relevantTerms.some((term) => topContent.includes(term));
  assert.ok(
    hasRelevance,
    `top result "${result.finalResults[0].title}" should contain mercury/toxicity vocabulary`
  );
});

// ──────────────────────────────────────────────────────────────────────
// PRIORITY 4: Edge cases (robustness and graceful degradation)
// ──────────────────────────────────────────────────────────────────────

integrationTest("nonsense query 'zzzxqqq gibberish' → graceful fallback to dense results", async () => {
  const result = await wormholeSearch("zzzxqqq gibberish", { finalK: FINAL_K });

  // Should not crash; can return 0 or more results depending on dense KNN fallback
  assert.ok(Array.isArray(result.finalResults));
  // If SKG returns no meaningful terms, that's fine — dense fallback handles it
  assert.ok(result.skgTerms.length >= 0);
});

integrationTest("single word 'food' → hospitality-leaning results", async () => {
  const result = await wormholeSearch("food", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  const hospCount = result.finalResults.filter((d) => d.source === "server_hospitality").length;
  assert.ok(hospCount >= 3, `expected ≥3 hospitality results for 'food', got ${hospCount}/${FINAL_K}`);
});

// ──────────────────────────────────────────────────────────────────────
// PRIORITY 5: Corpus completeness (infrastructure test)
// ──────────────────────────────────────────────────────────────────────

integrationTest("corpus is fully indexed: all 8 knowledge domains have retrievable docs", async () => {
  const domainQueries = [
    { query: "Java programming", domain: "java_programming" },
    { query: "coffee bean", domain: "java_coffee" },
    { query: "Mercury planet orbit", domain: "mercury_planet" },
    { query: "Mercury element toxicity", domain: "mercury_element" },
    { query: "Mercury Cougar automobile", domain: "mercury_car" },
    { query: "Python programming NumPy", domain: "python_programming" },
    { query: "Python snake constrictor", domain: "python_snake" },
    { query: "server technology Linux", domain: "server_tech" },
    { query: "server hospitality restaurant", domain: "server_hospitality" },
  ];

  for (const { query, domain } of domainQueries) {
    const result = await wormholeSearch(query, { finalK: 10 });
    const docsForDomain = result.finalResults.filter((d) => d.source === domain);
    assert.ok(
      docsForDomain.length > 0,
      `expected at least one ${domain} doc for query "${query}", got 0`
    );
  }
});

// ──────────────────────────────────────────────────────────────────────
// PHASE A: Sparse → dense hop (bidirectional traversal)
// ──────────────────────────────────────────────────────────────────────

integrationTest("'s2d: java' from a programming-heavy BM25 set lands in java_programming dense space", async () => {
  const result = await wormholeSearchSparseToDense("java", { finalK: FINAL_K });

  assert.ok(result.pooledFrom > 0, "expected at least one pooled foreground vector");
  assert.ok(result.finalResults.length > 0);
  const progCount = result.finalResults.filter((d) => d.source === "java_programming").length;
  assert.ok(progCount >= 3, `expected ≥3 java_programming results, got ${progCount}/${FINAL_K}`);
});

integrationTest("'s2d: coffee bean roast' pools into the java_coffee dense neighborhood", async () => {
  const result = await wormholeSearchSparseToDense("coffee bean roast", { finalK: FINAL_K });

  assert.ok(result.finalResults.length > 0);
  for (const doc of result.finalResults) {
    assert.equal(doc.source, "java_coffee", `result "${doc.title}" has source "${doc.source}"`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// PHASE B: Query specificity + multi-field SKG
// ──────────────────────────────────────────────────────────────────────

integrationTest("broad query ('server') yields lower specificity than a specific one ('java garbage collection')", async () => {
  const broad = await wormholeSearch("server", { finalK: FINAL_K });
  const specific = await wormholeSearch("java garbage collection", { finalK: FINAL_K });

  assert.ok(
    broad.specificity < specific.specificity,
    `expected broad (${broad.specificity}) < specific (${specific.specificity})`
  );
});

integrationTest("SKG category matches the dominant source of the foreground ('Java' → java_programming)", async () => {
  const result = await wormholeSearch("Java", { finalK: FINAL_K });

  assert.ok(result.skgCategories.length > 0, "expected at least one SKG category");
  assert.equal(result.skgCategories[0].term, "java_programming");
});

// ──────────────────────────────────────────────────────────────────────
// PHASE C: Iterative hopping
// ──────────────────────────────────────────────────────────────────────

integrationTest("iterative search converges within MAX_HOPS and returns ≥ as many unique docs as single-shot", async () => {
  const [iterative, singleShot] = await Promise.all([
    iterativeWormholeSearch("server", { finalK: 20 }),
    wormholeSearch("server", { finalK: 5 }),
  ]);

  assert.ok(iterative.hopStats.length <= parseInt(process.env.MAX_HOPS ?? "4"));
  assert.ok(
    iterative.finalResults.length >= singleShot.finalResults.length,
    `expected iterative (${iterative.finalResults.length}) >= single-shot (${singleShot.finalResults.length})`
  );
});
