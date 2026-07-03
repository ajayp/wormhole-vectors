import { embedText } from "./embed";
import { wormholeHop, bm25Search, SolrDoc, SkgTerm } from "./search";

process.loadEnvFile();

export interface WormholeOpts {
  foregroundK?: number;
  finalK?: number;
  core?: string;
}

export interface RankedDoc extends SolrDoc {
  hop: "sparse" | "dense";
}

export interface SearchResult {
  query: string;
  skgTerms: SkgTerm[];
  finalResults: RankedDoc[];
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
  const seen = new Set<string>();
  const merged: RankedDoc[] = [];

  for (const [docs, hop] of [[sparse, "sparse"], [dense, "dense"]] as const) {
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

/**
 * Runs the wormhole pipeline: embed, dense hop + SKG, then sparse hop —
 * unless the dense hop yields no SKG terms, in which case it returns
 * dense-only results without running the sparse hop.
 */
export async function wormholeSearch(
  query: string,
  opts?: WormholeOpts
): Promise<SearchResult> {
  const fgK = opts?.foregroundK ?? parseInt(process.env.FOREGROUND_K ?? "15");
  const finalK = opts?.finalK ?? parseInt(process.env.FINAL_K ?? "5");
  const core = opts?.core;

  // Step 1: embed query
  const vector = await embedText(query);

  // Step 2+3: dense retrieval + SKG in one request
  const { docs: foregroundDocs, skgTerms } = await wormholeHop(vector, fgK, core);

  if (!skgTerms.length) {
    console.warn("SKG returned no terms — returning dense results only.");
    const finalResults = foregroundDocs.slice(0, finalK).map((doc) => ({ ...doc, hop: "dense" as const }));
    return { query, skgTerms: [], finalResults };
  }

  // Step 4: sparse traversal using derived terms
  const sparseResults = await bm25Search(skgTerms, finalK, core);

  // Step 5: sparse-first merge + dedupe, backfilled from dense
  const merged = mergeWormholeResults(sparseResults, foregroundDocs, finalK);

  return { query, skgTerms, finalResults: merged };
}
