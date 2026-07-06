import * as dotenv from "dotenv";
import { embedText } from "./embed";
import { poolVectors, foregroundSpecificity } from "./pool";
import {
  wormholeHop,
  bm25Search,
  baselineSearch,
  denseSearch,
  SolrDoc,
  SkgTerm,
} from "./search";

dotenv.config();

export interface WormholeOpts {
  foregroundK?: number;
  finalK?: number;
}

export type Hop = "sparse" | "dense";

export interface RankedDoc extends SolrDoc {
  hop: Hop;
}

export interface SearchResult {
  query: string;
  skgTerms: SkgTerm[];
  skgCategories: SkgTerm[];
  specificity: number;
  broad: boolean;
  finalResults: RankedDoc[];
}

export interface SparseToDenseResult {
  query: string;
  pooledFrom: number;
  finalResults: RankedDoc[];
}

// Dedupes docs across hops in priority order — earlier groups win ties and
// their own internal ranking is preserved. `mergeWormholeResults` (sparse
// first) and its sparse→dense mirror image both build on this.
function mergeByPriority(
  groups: Array<{ docs: SolrDoc[]; hop: Hop }>,
  finalK: number
): RankedDoc[] {
  const seen = new Set<string>();
  const merged: RankedDoc[] = [];

  for (const { docs, hop } of groups) {
    for (const doc of docs) {
      if (merged.length >= finalK) break;
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        merged.push({ ...doc, hop });
      }
    }
  }

  return merged;
}

// Sparse (SKG-refined) results take priority; dense (raw KNN) results only
// backfill remaining slots. This keeps the ambiguity that dense retrieval
// alone can't resolve from dominating the final result set. Each result is
// tagged with which hop (sparse/dense) produced it.
export function mergeWormholeResults(
  sparse: SolrDoc[],
  dense: SolrDoc[],
  finalK: number
): RankedDoc[] {
  return mergeByPriority(
    [
      { docs: sparse, hop: "sparse" },
      { docs: dense, hop: "dense" },
    ],
    finalK
  );
}

// Mirror image for the sparse→dense hop: dense (pooled-vector KNN) results
// take priority, backfilled by the sparse foreground that produced them.
export function mergeWormholeResultsDenseFirst(
  dense: SolrDoc[],
  sparse: SolrDoc[],
  finalK: number
): RankedDoc[] {
  return mergeByPriority(
    [
      { docs: dense, hop: "dense" },
      { docs: sparse, hop: "sparse" },
    ],
    finalK
  );
}

const SPECIFICITY_THRESHOLD = parseFloat(process.env.SPECIFICITY_THRESHOLD ?? "0.6");

export async function wormholeSearch(
  query: string,
  opts?: WormholeOpts
): Promise<SearchResult> {
  const fgK = opts?.foregroundK ?? parseInt(process.env.FOREGROUND_K ?? "15");
  const finalK = opts?.finalK ?? parseInt(process.env.FINAL_K ?? "5");

  // Step 1: embed query
  const vector = await embedText(query);

  // Step 2+3: dense retrieval + SKG in one request (with vectors, to measure
  // how tightly the foreground set clusters around its own centroid)
  const { docs: foregroundDocs, skgTerms, skgCategories } = await wormholeHop(vector, fgK, {
    withVectors: true,
  });

  const foregroundVectors = foregroundDocs.filter((d) => d.vector).map((d) => d.vector!);
  const specificity = foregroundVectors.length ? foregroundSpecificity(foregroundVectors) : 1;
  const broad = specificity < SPECIFICITY_THRESHOLD;

  if (!skgTerms.length) {
    console.warn("SKG returned no terms — returning dense results only.");
    return {
      query,
      skgTerms: [],
      skgCategories,
      specificity,
      broad,
      finalResults: foregroundDocs.slice(0, finalK).map((d) => ({ ...d, hop: "dense" as const })),
    };
  }

  // Step 4: sparse traversal using derived terms. A broad query's foreground
  // doesn't cluster around one point, so widen the fetch before merging —
  // the POC-scale version of "search a region, not a point."
  //
  // Note: skgCategories is surfaced for display and available as an opt-in
  // boost via bm25Search's `categories` option, but isn't applied here —
  // category relatedness is a noisier signal than term relatedness and can
  // tip already-correct term-based disambiguation the wrong way.
  const sparseFetchK = broad ? finalK * 2 : finalK;
  const sparseResults = await bm25Search(skgTerms, sparseFetchK);

  // Step 5: sparse-first merge + dedupe, backfilled from dense
  const merged = mergeWormholeResults(sparseResults, foregroundDocs, finalK);

  return { query, skgTerms, skgCategories, specificity, broad, finalResults: merged };
}

// The talk's "easy direction" (52:17): keyword search → average top-N doc
// embeddings → KNN. Mirrors wormholeSearch but starts sparse and hops dense.
export async function wormholeSearchSparseToDense(
  query: string,
  opts?: WormholeOpts
): Promise<SparseToDenseResult> {
  const fgK = opts?.foregroundK ?? parseInt(process.env.FOREGROUND_K ?? "15");
  const finalK = opts?.finalK ?? parseInt(process.env.FINAL_K ?? "5");

  // Step 1: BM25 on the raw query, with vectors so we can pool them
  const foregroundDocs = await baselineSearch(query, fgK, { withVectors: true });
  const foregroundVectors = foregroundDocs.filter((d) => d.vector).map((d) => d.vector!);

  if (!foregroundVectors.length) {
    console.warn("Sparse foreground returned no vectors — cannot pool a wormhole vector.");
    return {
      query,
      pooledFrom: 0,
      finalResults: foregroundDocs.slice(0, finalK).map((d) => ({ ...d, hop: "sparse" as const })),
    };
  }

  // Step 2: pool foreground embeddings into a single wormhole vector
  const pooled = poolVectors(foregroundVectors);

  // Step 3: KNN on the pooled vector
  const denseResults = await denseSearch(pooled, finalK);

  // Step 4: dense-first merge + dedupe, backfilled from sparse
  const merged = mergeWormholeResultsDenseFirst(denseResults, foregroundDocs, finalK);

  return { query, pooledFrom: foregroundVectors.length, finalResults: merged };
}
