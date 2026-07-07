/**
 * Large-corpus integration tests — require a live Solr instance with the
 * ~1,000-doc real Stack Exchange sample ingested into the `wormhole_large` core.
 *
 *   docker compose up -d && npm run ingest:large
 *   npm run test:integration:large
 *
 * Unlike tests/integration/integration.test.ts (135 hand-curated, perfectly
 * balanced demo docs), this corpus is real, messy, HTML-laden Stack Exchange
 * text sampled from five homogeneous domains (health, cooking, scifi, travel,
 * devops). It validates SCALE, NOISE TOLERANCE, and SKG COHERENCE on real
 * text — NOT lexical-ambiguity resolution (java=lang vs coffee), which the
 * demo corpus already covers. Assertions here use statistical thresholds
 * (purity@5 >= N/5), not 100%-purity exact matches, because noisy real text
 * won't hit perfect domain purity the way curated docs do.
 *
 * THE CONDITIONAL FINDING (read this before touching sections 2–4):
 *
 * Empirically (verified at both 200/domain and 500/domain via
 * LARGE_CORPUS_SAMPLE_SIZE), wormhole's disambiguation advantage over plain
 * BM25 does NOT reliably reproduce on this corpus — not because the
 * technique "doesn't work," but because it depends on two properties the
 * curated demo corpus has and this real corpus lacks:
 *
 *   (a) genuinely disjoint senses — demo `java`=language vs `java`=coffee
 *       are semantically unrelated. Here, `cold`=symptom and `cold`=
 *       temperature are the same underlying concept leaking across topic
 *       domains, so the dense embedding sits *between* both uses rather
 *       than clustering distinctly — the KNN neighborhood ends up less
 *       concentrated, not more.
 *   (b) balanced representation — the demo has ~18 docs/sense. Here,
 *       domain frequency is skewed (e.g. "cold" appears in 15/200 health
 *       docs vs. 4/200 cooking docs), so BM25's literal term-frequency
 *       match already has a free domain lean baked in from the corpus
 *       imbalance, with no ambiguity left for the dense hop to resolve.
 *
 * When both hold (the demo), the dense hop's neighborhood selection is what
 * creates domain coherence. When neither holds (here), BM25's literal-
 * frequency skew already supplies it, and wormhole's blended neighborhood
 * can be a wash or even slightly worse. This was checked for sample-size
 * sensitivity: re-running at 500/domain didn't flip the structural case
 * (`cold`) — same result, tighter margins — confirming it's not noise.
 *
 * SUITE STRUCTURE, given that finding:
 *
 * - Section 1 (domain-anchored, "easy"): keywords are already domain-
 *   distinctive, so BM25 does fine here too. Hard gate — this is the
 *   defensible generalization claim ("doesn't regress at scale on messy
 *   real text"), with a small tolerance for cross-run noise (see section 4).
 * - Section 2 (context-steered) and section 3 (bare ambiguous terms):
 *   INFORMATIONAL ONLY. These report wormhole-vs-BM25 numbers, including
 *   cases where BM25 wins, without failing CI over a corpus property no
 *   code change here can fix.
 * - Section 3 also codifies the one case (`cold`) that reproduced at both
 *   sample sizes as a PASSING assertion of the negative result — an
 *   invariant, not a broken expectation.
 * - Section 6 (SKG term sanity) stays a hard gate — SKG coherence on real
 *   text is a claim the suite can actually back, independent of the
 *   wormhole-vs-BM25 ranking comparison above.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

process.loadEnvFile();

import { wormholeSearch } from "../../src/wormhole";
import { baselineSearch } from "../../src/search";
import { LARGE_QUERIES } from "../../scripts/eval-queries";

const SOLR_URL = process.env.SOLR_URL ?? "http://localhost:8983/solr";
const CORE = "wormhole_large";
const FINAL_K = 5;

// A stale core can have leftover docs from an older/different schema and pass
// a numDocs-only check, then fail every test mid-run with a confusing
// "undefined field: vector" 400 instead of a clean skip — so also confirm the
// schema actually has the "vector" field.
let solrAlive = false;
try {
  const statusOut = execSync(
    `curl -s "${SOLR_URL}/admin/cores?action=STATUS&core=${CORE}"`,
    { timeout: 5000, encoding: "utf-8" }
  );
  const numDocs = JSON.parse(statusOut)?.status?.[CORE]?.index?.numDocs ?? 0;

  const schemaOut = execSync(`curl -s "${SOLR_URL}/${CORE}/schema/fields/vector"`, {
    timeout: 5000,
    encoding: "utf-8",
  });
  const hasVectorField = JSON.parse(schemaOut)?.responseHeader?.status === 0;

  solrAlive = numDocs > 0 && hasVectorField;
} catch {
  // Solr is down — tests below will each skip.
}

const skipReason = solrAlive ? undefined : "live Solr + `npm run ingest:large` required";

function integrationTest(name: string, fn: () => Promise<void>) {
  test(name, { skip: skipReason }, fn);
}

function purityAt5(sources: (string | undefined)[], domain: string): number {
  return sources.filter((s) => s === domain).length / sources.length;
}

// Share of the single most common domain in a result set — how concentrated
// the results are around one topic, regardless of which topic that is.
// Used for bare ambiguous terms, where there's no single "correct" domain
// to measure purity against.
function dominantDomainShare(sources: (string | undefined)[]): number {
  const counts = new Map<string, number>();
  for (const s of sources) {
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const max = counts.size ? Math.max(...counts.values()) : 0;
  return sources.length ? max / sources.length : 0;
}

// ──────────────────────────────────────────────────────────────────────
// 1. Domain-anchored queries — statistical purity@5, not exact match.
//    3 queries/domain (not 1) so the aggregate below isn't swung by a
//    single easy or unlucky query. These are the "easy" case: BM25 should
//    do reasonably well here too, since the keywords are domain-distinctive.
// ──────────────────────────────────────────────────────────────────────

const DOMAIN_ANCHORED_QUERIES = LARGE_QUERIES;

const PURITY_THRESHOLD = 3 / 5; // >= 3 of top 5 in the anchored domain

for (const { query, domain } of DOMAIN_ANCHORED_QUERIES) {
  integrationTest(
    `'${query}' → purity@5 >= ${PURITY_THRESHOLD.toFixed(1)} for ${domain}`,
    async () => {
      const result = await wormholeSearch(query, { finalK: FINAL_K, core: CORE });
      assert.ok(result.finalResults.length > 0, "expected at least one result");

      const purity = purityAt5(result.finalResults.map((d) => d.source), domain);
      assert.ok(
        purity >= PURITY_THRESHOLD,
        `purity@5 for "${query}" was ${purity.toFixed(2)}, expected >= ${PURITY_THRESHOLD.toFixed(2)}. ` +
          `Sources: ${result.finalResults.map((d) => d.source).join(", ")}`
      );
    }
  );
}

// ──────────────────────────────────────────────────────────────────────
// 2. Context-steered ambiguous queries — INFORMATIONAL ONLY, no hard gate.
//
//    These add domain-suggestive context to an ambiguous term (e.g. "sugar"
//    + "baking recipe"). Whether wormhole beats BM25 on the resulting query,
//    and whether steering moves the pipeline toward the intended domain
//    vs. the bare term, are both reported as numbers — not asserted.
//    Several of these context words (e.g. "recipe") turn out to be
//    domain-exclusive vocabulary themselves, so BM25 already hits ceiling
//    purity with no ambiguity left to resolve; asserting a wormhole win
//    here would just be re-litigating a corpus property, not testing code.
// ──────────────────────────────────────────────────────────────────────

const CROSS_DOMAIN_QUERIES = [
  { ambiguousTerm: "sugar", steered: "blood sugar levels diabetes", domain: "health" },
  { ambiguousTerm: "sugar", steered: "sugar in a baking recipe", domain: "cooking" },
  { ambiguousTerm: "cold", steered: "cold symptoms flu treatment", domain: "health" },
  { ambiguousTerm: "cold", steered: "serve the dish cold recipe", domain: "cooking" },
  { ambiguousTerm: "fat", steered: "body fat health diet", domain: "health" },
  { ambiguousTerm: "fat", steered: "cooking fat oil frying", domain: "cooking" },
];

for (const { ambiguousTerm, steered, domain } of CROSS_DOMAIN_QUERIES) {
  integrationTest(`[info] '${steered}' vs. BM25 and vs. bare '${ambiguousTerm}' toward ${domain}`, async () => {
    const [wormholeSteered, baselineSteered, wormholeBare] = await Promise.all([
      wormholeSearch(steered, { finalK: FINAL_K, core: CORE }),
      baselineSearch(steered, FINAL_K, { core: CORE }),
      wormholeSearch(ambiguousTerm, { finalK: FINAL_K, core: CORE }),
    ]);

    const wormholePurity = purityAt5(wormholeSteered.finalResults.map((d) => d.source), domain);
    const baselinePurity = purityAt5(baselineSteered.map((d) => d.source), domain);
    const barePurity = purityAt5(wormholeBare.finalResults.map((d) => d.source), domain);

    console.log(
      `    [info] "${steered}": wormhole=${wormholePurity.toFixed(2)}, BM25=${baselinePurity.toFixed(2)}, ` +
        `bare-term-wormhole=${barePurity.toFixed(2)}` +
        (wormholePurity < baselinePurity ? " (BM25 ahead — likely domain-exclusive context words)" : "")
    );

    // Not a claim about wormhole vs. BM25 — just confirms the harness itself
    // returns usable results for both paths (regression guard, not a metric).
    assert.ok(wormholeSteered.finalResults.length > 0 && baselineSteered.length > 0);
  });
}

// ──────────────────────────────────────────────────────────────────────
// 3. Bare ambiguous term — no steering context, so there's no single
//    "correct" domain. Measures whether wormhole's dense hop concentrates
//    results around one domain (dominantDomainShare) better than plain
//    BM25's literal keyword match on the exact same query string.
//
//    "sugar" and "fat" are INFORMATIONAL: their wormhole-vs-BM25 sign
//    flipped between the 200/domain and 500/domain runs, so it's sample
//    noise, not a stable property — asserting either direction would be
//    encoding noise as an invariant.
//
//    "cold" is a HARD GATE, asserting the negative result: BM25 domain
//    coherence >= wormhole's, on the bare term. This reproduced at both
//    200/domain (0.80 vs 1.00) and 500/domain (0.80 vs 1.00) — a stable,
//    structural finding (see file header), not noise. Codifying it as a
//    passing assertion documents the boundary as a checked invariant
//    instead of a red CI test everyone learns to ignore.
// ──────────────────────────────────────────────────────────────────────

const BARE_AMBIGUOUS_TERMS_INFO = ["sugar", "fat"];

for (const term of BARE_AMBIGUOUS_TERMS_INFO) {
  integrationTest(`[info] bare '${term}' → wormhole vs. BM25 domain coherence`, async () => {
    const [wormholeResult, baselineResult] = await Promise.all([
      wormholeSearch(term, { finalK: FINAL_K, core: CORE }),
      baselineSearch(term, FINAL_K, { core: CORE }),
    ]);

    const wormholeCoherence = dominantDomainShare(wormholeResult.finalResults.map((d) => d.source));
    const baselineCoherence = dominantDomainShare(baselineResult.map((d) => d.source));

    console.log(
      `    [info] bare "${term}": wormhole coherence=${wormholeCoherence.toFixed(2)}, ` +
        `BM25 coherence=${baselineCoherence.toFixed(2)}`
    );

    assert.ok(wormholeResult.finalResults.length > 0 && baselineResult.length > 0);
  });
}

integrationTest(
  "bare 'cold' → BM25 domain coherence >= wormhole's (codified negative finding, stable across sample sizes)",
  async () => {
    const [wormholeResult, baselineResult] = await Promise.all([
      wormholeSearch("cold", { finalK: FINAL_K, core: CORE }),
      baselineSearch("cold", FINAL_K, { core: CORE }),
    ]);

    const wormholeCoherence = dominantDomainShare(wormholeResult.finalResults.map((d) => d.source));
    const baselineCoherence = dominantDomainShare(baselineResult.map((d) => d.source));

    assert.ok(
      baselineCoherence >= wormholeCoherence,
      `expected BM25 domain coherence (${baselineCoherence.toFixed(2)}) >= wormhole's ` +
        `(${wormholeCoherence.toFixed(2)}) for bare "cold" — if this flips, the conditional finding ` +
        `in this file's header needs re-checking, not just this assertion`
    );
  }
);

// ──────────────────────────────────────────────────────────────────────
// 4. Aggregate check — the generalization claim itself, over the "easy"
//    domain-anchored query set only. `AGGREGATE_TOLERANCE` absorbs
//    cross-run noise: at 500/domain, the averaged purity was 0.99 vs.
//    1.00 (a single query dropping one doc out of 15 queries' worth of
//    results) — a strict >= would make this flaky at the margin without
//    signaling any real regression. There's no equivalent "hard" aggregate
//    over the bare-ambiguous-term set — see section 3 for why that's
//    informational plus a single codified invariant instead.
// ──────────────────────────────────────────────────────────────────────

const AGGREGATE_TOLERANCE = 0.05;

integrationTest(
  "aggregate (domain-anchored): average wormhole purity@5 >= average baseline BM25 purity@5 (within noise tolerance)",
  async () => {
    let wormholeTotal = 0;
    let baselineTotal = 0;

    for (const { query, domain } of DOMAIN_ANCHORED_QUERIES) {
      const [wormhole, baseline] = await Promise.all([
        wormholeSearch(query, { finalK: FINAL_K, core: CORE }),
        baselineSearch(query, FINAL_K, { core: CORE }),
      ]);

      wormholeTotal += purityAt5(wormhole.finalResults.map((d) => d.source), domain);
      baselineTotal += purityAt5(baseline.map((d) => d.source), domain);
    }

    const wormholeAvg = wormholeTotal / DOMAIN_ANCHORED_QUERIES.length;
    const baselineAvg = baselineTotal / DOMAIN_ANCHORED_QUERIES.length;

    assert.ok(
      wormholeAvg >= baselineAvg - AGGREGATE_TOLERANCE,
      `average wormhole purity@5 (${wormholeAvg.toFixed(2)}) should be >= ` +
        `average baseline BM25 purity@5 (${baselineAvg.toFixed(2)}) minus ${AGGREGATE_TOLERANCE} tolerance ` +
        `on domain-anchored queries`
    );
  }
);

// ──────────────────────────────────────────────────────────────────────
// 5. Ranking quality — purity@5 alone hides ranking differences (a result
//    set can be 5/5 pure but still rank the best-matching doc below a
//    worse one). Approximate ranking quality with a top-1 domain-match
//    rate (MRR@1-ish) over the domain-anchored ("easy") query set, where
//    there's a well-defined correct domain to check against.
// ──────────────────────────────────────────────────────────────────────

integrationTest(
  "top-1 domain-match rate: wormhole's top result lands in the intended domain at least as often as BM25's",
  async () => {
    let wormholeTop1Matches = 0;
    let baselineTop1Matches = 0;

    for (const { query, domain } of DOMAIN_ANCHORED_QUERIES) {
      const [wormhole, baseline] = await Promise.all([
        wormholeSearch(query, { finalK: FINAL_K, core: CORE }),
        baselineSearch(query, FINAL_K, { core: CORE }),
      ]);

      if (wormhole.finalResults[0]?.source === domain) wormholeTop1Matches++;
      if (baseline[0]?.source === domain) baselineTop1Matches++;
    }

    const wormholeRate = wormholeTop1Matches / DOMAIN_ANCHORED_QUERIES.length;
    const baselineRate = baselineTop1Matches / DOMAIN_ANCHORED_QUERIES.length;

    assert.ok(
      wormholeRate >= baselineRate,
      `wormhole top-1 domain-match rate (${wormholeRate.toFixed(2)}) should be >= ` +
        `BM25 top-1 domain-match rate (${baselineRate.toFixed(2)}) across ${DOMAIN_ANCHORED_QUERIES.length} queries`
    );
  }
);

// ──────────────────────────────────────────────────────────────────────
// 6. SKG term sanity — derived terms are non-empty, free of raw HTML/
//    entity artifacts, with relatedness > 0.
//
//    Checked against both `devops` and `health` — health's raw body text
//    had the densest HTML/entity noise of the five domains in the sampled
//    corpus, so it's the likeliest place for cleaning gaps to leak through
//    into SKG terms.
//
//    The artifact check specifically targets leftover entity/tag markup
//    (&, <, >, ;, #) rather than requiring pure-alphabetic terms — real
//    tokens legitimately mix letters, digits, and punctuation (e.g. stemmed
//    dosage text like "500mg", or a European-format reading like "37,2"),
//    and rejecting those would be testing for the wrong thing.
// ──────────────────────────────────────────────────────────────────────

const HTML_ARTIFACT_PATTERN = /[&<>;#]/;

const SKG_SANITY_QUERIES = [
  "kubernetes container deployment pipeline",
  "doctor treatment infection symptoms",
];

for (const query of SKG_SANITY_QUERIES) {
  integrationTest(`'${query}' → SKG terms are non-empty, free of HTML/entity artifacts, with relatedness > 0`, async () => {
    const result = await wormholeSearch(query, { finalK: FINAL_K, core: CORE });

    assert.ok(result.skgTerms.length > 0, "expected non-empty SKG terms");
    for (const t of result.skgTerms) {
      assert.ok(t.term.length > 0, "term should be non-empty");
      assert.ok(
        !HTML_ARTIFACT_PATTERN.test(t.term),
        `term "${t.term}" contains an HTML/entity artifact marker (&, <, >, ;, or #)`
      );
      assert.ok(t.relatedness > 0, `term "${t.term}" has non-positive relatedness: ${t.relatedness}`);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────
// 7. Corpus completeness (infrastructure test) — mirrors the demo suite's
//    equivalent check. Catches silent ingestion failures (a domain's CSV
//    resolving to 0 rows, a bad sibling-repo path, etc.) that would
//    otherwise just quietly depress purity numbers above instead of
//    failing with a clear cause.
// ──────────────────────────────────────────────────────────────────────

integrationTest("corpus is fully indexed: all 5 domains have retrievable docs", async () => {
  const oneQueryPerDomain = new Map(DOMAIN_ANCHORED_QUERIES.map((q) => [q.domain, q]));
  for (const { query, domain } of oneQueryPerDomain.values()) {
    const result = await wormholeSearch(query, { finalK: 10, core: CORE });
    const docsForDomain = result.finalResults.filter((d) => d.source === domain);
    assert.ok(
      docsForDomain.length > 0,
      `expected at least one ${domain} doc for query "${query}", got 0`
    );
  }
});
