import { embedText } from "./embed";
import { poolVectors } from "./pool";
import { wormholeHop, bm25Search, denseSearch, SolrDoc } from "./search";

process.loadEnvFile();

export interface IteratedDoc extends SolrDoc {
  hopNumber: number;
}

export interface HopStats {
  hop: number;
  newDocs: number;
}

export interface IterativeSearchResult {
  query: string;
  hopStats: HopStats[];
  finalResults: IteratedDoc[];
}

export interface IterativeOpts {
  foregroundK?: number;
  finalK?: number;
  maxHops?: number;
  minNewDocs?: number;
  core?: string;
  /** Injection seam for tests — defaults to the real embedText. */
  embed?: (text: string) => Promise<number[]>;
}

// "Repeat as needed" (29:07): bounce between dense and sparse spaces,
// accumulating unseen documents each round. Hop 1 is dense+SKG (wormholeHop);
// even hops are sparse (BM25 from the SKG terms derived at hop 1); odd hops
// after the first pool the previous hop's vectors back into a dense KNN
// (denseSearch, no new facet). Stops at `maxHops` or once a hop contributes
// fewer than `minNewDocs` new documents (convergence).
export async function iterativeWormholeSearch(
  query: string,
  opts?: IterativeOpts
): Promise<IterativeSearchResult> {
  const fgK = opts?.foregroundK ?? parseInt(process.env.FOREGROUND_K ?? "15");
  const finalK = opts?.finalK ?? parseInt(process.env.FINAL_K ?? "5");
  const maxHops = opts?.maxHops ?? parseInt(process.env.MAX_HOPS ?? "4");
  const minNewDocs = opts?.minNewDocs ?? 2;
  const core = opts?.core;
  const embed = opts?.embed ?? embedText;

  const seen = new Set<string>();
  const accumulated: IteratedDoc[] = [];
  const hopStats: HopStats[] = [];

  const recordHop = (hopNumber: number, docs: SolrDoc[]): number => {
    let newDocs = 0;
    for (const doc of docs) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        accumulated.push({ ...doc, hopNumber });
        newDocs++;
      }
    }
    hopStats.push({ hop: hopNumber, newDocs });
    return newDocs;
  };

  const vector = await embed(query);
  const { docs: hop1Docs, skgTerms } = await wormholeHop(vector, fgK, { core });
  recordHop(1, hop1Docs);

  let lastVectorSourceDocs: SolrDoc[] = [];

  for (let hop = 2; hop <= maxHops; hop++) {
    let docs: SolrDoc[];

    if (hop % 2 === 0) {
      if (!skgTerms.length) break;
      docs = await bm25Search(skgTerms, fgK, { withVectors: true, core });
      lastVectorSourceDocs = docs;
    } else {
      const vectors = lastVectorSourceDocs.filter((d) => d.vector).map((d) => d.vector!);
      if (!vectors.length) break;
      docs = await denseSearch(poolVectors(vectors), fgK, { core });
    }

    const newDocs = recordHop(hop, docs);
    if (newDocs < minNewDocs) break;
  }

  return { query, hopStats, finalResults: accumulated.slice(0, finalK) };
}
