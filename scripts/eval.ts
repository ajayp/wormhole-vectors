// Eval harness: measures wormholeSearch against the baselines the README's
// pitch implicitly compares itself to — plain BM25, plain dense KNN, and RRF
// hybrid (the "smash both together" approach the talk says wormhole vectors
// go beyond, 19:55–22:18) — over the same domain-labeled query set already
// used as pass/fail assertions in tests/integration/*.test.ts.
//
// This turns Trey Grainger's own ask in the talk ("I need lots of good evals
// on how this actually does in practice", ~63:00) into a runnable number
// instead of an anecdote — purity@k and nDCG@k per pipeline, averaged across
// the query set, plus per-query detail.
//
// Usage:
//   npm run eval                         # wormhole_demo, k=5
//   npm run eval -- --core=wormhole_large --k=5
//   npm run eval -- --json                # machine-readable output only

import { embedText } from "../src/embed";
import { baselineSearch, denseSearch, rrfSearch, SolrDoc } from "../src/search";
import { wormholeSearch } from "../src/wormhole";
import { QUERIES_BY_CORE, EvalQuery } from "./eval-queries";

process.loadEnvFile();

const coreFlag = process.argv.find((a) => a.startsWith("--core="))?.split("=")[1];
const CORE = coreFlag ?? process.env.SOLR_CORE ?? "wormhole_demo";
const K = parseInt(process.argv.find((a) => a.startsWith("--k="))?.split("=")[1] ?? "5");
const JSON_OUTPUT = process.argv.includes("--json");

function purityAtK(sources: (string | undefined)[], domain: string): number {
  if (!sources.length) return 0;
  return sources.filter((s) => s === domain).length / sources.length;
}

// Binary relevance nDCG@k. IDCG assumes a perfect ranking of k relevant docs
// (i.e. we don't know the corpus's true relevant-doc count for this domain,
// only whether each returned doc matches it) — the same simplifying
// assumption purity@k already makes about what "relevant" means here.
function ndcgAtK(sources: (string | undefined)[], domain: string): number {
  if (!sources.length) return 0;
  const dcg = sources.reduce((acc, s, i) => acc + (s === domain ? 1 / Math.log2(i + 2) : 0), 0);
  const idcg = sources.reduce((acc, _s, i) => acc + 1 / Math.log2(i + 2), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

interface PipelineResult {
  purity: number;
  ndcg: number;
  top1: boolean;
}

interface Pipeline {
  name: string;
  run: (q: EvalQuery) => Promise<SolrDoc[]>;
}

async function buildPipelines(): Promise<Pipeline[]> {
  return [
    { name: "BM25 (sparse)", run: (q) => baselineSearch(q.query, K, { core: CORE }) },
    { name: "Dense KNN", run: async (q) => denseSearch(await embedText(q.query), K, { core: CORE }) },
    { name: "RRF hybrid", run: (q) => rrfSearch(q.query, K, { core: CORE }) },
    {
      name: "Wormhole",
      run: async (q) => (await wormholeSearch(q.query, { finalK: K, core: CORE })).finalResults,
    },
  ];
}

function evaluate(docs: SolrDoc[], domain: string): PipelineResult {
  const sources = docs.map((d) => d.source);
  return {
    purity: purityAtK(sources, domain),
    ndcg: ndcgAtK(sources, domain),
    top1: sources[0] === domain,
  };
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

async function main() {
  const queries = QUERIES_BY_CORE[CORE];
  if (!queries) {
    console.error(
      `No eval query fixture for core "${CORE}". Known cores: ${Object.keys(QUERIES_BY_CORE).join(", ")}`
    );
    process.exit(1);
  }

  const pipelines = await buildPipelines();
  const perPipeline: Record<string, PipelineResult[]> = {};
  const perQueryRows: Array<Record<string, unknown>> = [];

  for (const q of queries) {
    const row: Record<string, unknown> = { query: q.query, domain: q.domain };
    for (const pipeline of pipelines) {
      const docs = await pipeline.run(q);
      const result = evaluate(docs, q.domain);
      (perPipeline[pipeline.name] ??= []).push(result);
      row[`${pipeline.name} purity@${K}`] = result.purity.toFixed(2);
      row[`${pipeline.name} nDCG@${K}`] = result.ndcg.toFixed(2);
    }
    perQueryRows.push(row);
  }

  const summary = pipelines.map((p) => {
    const results = perPipeline[p.name];
    return {
      pipeline: p.name,
      [`avg purity@${K}`]: mean(results.map((r) => r.purity)).toFixed(3),
      [`avg nDCG@${K}`]: mean(results.map((r) => r.ndcg)).toFixed(3),
      "top-1 match rate": mean(results.map((r) => (r.top1 ? 1 : 0))).toFixed(3),
    };
  });

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ core: CORE, k: K, perQuery: perQueryRows, summary }, null, 2));
    return;
  }

  console.log(`\nEval: core=${CORE}, k=${K}, ${queries.length} queries\n`);
  console.log("Per-query detail:");
  console.table(perQueryRows);
  console.log("\nSummary (averaged across all queries):");
  console.table(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
