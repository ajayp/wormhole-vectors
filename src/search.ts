import { solrPost } from "./solr-client";

process.loadEnvFile();

const DEFAULT_CORE = "wormhole_demo";

export interface SolrDoc {
  id: string;
  title?: string;
  text?: string;
  source?: string;
}

export interface SkgTerm {
  term: string;
  relatedness: number;
}

export interface WormholeHopResult {
  docs: SolrDoc[];
  skgTerms: SkgTerm[];
}

// Escapes Lucene/Solr query-syntax special characters so raw terms can be
// safely interpolated into a hand-built query string.
export function escapeSolrTerm(s: string): string {
  return s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}
/**
 * The dense hop. Runs a KNN query to get the nearest docs (the "foreground
 * set"), and in the same round-trip facets over `text_terms` with Solr's SKG
 * `relatedness()` function to find the keywords most distinctive of that set
 * vs. the whole corpus. Those terms feed {@link bm25Search}.
 */
export async function wormholeHop(
  vector: number[],
  k: number,
  core: string = DEFAULT_CORE
): Promise<WormholeHopResult> {
  const knnQuery = `{!knn f=vector topK=${k}}[${vector.join(",")}]`;
  const skgLimit = parseInt(process.env.SKG_LIMIT ?? "8");

  const response = (await solrPost(`/${core}/select`, {
    query: knnQuery,
    limit: k,
    fields: ["id", "title", "text", "source"],
    params: {
      fore: "{!lucene v=$q}",
      back: "*:*",
    },
    facet: {
      wormhole_terms: {
        type: "terms",
        field: "text_terms",
        limit: skgLimit,
        sort: { relatedness: "desc" },
        facet: {
          relatedness: { type: "func", func: "relatedness($fore,$back)" },
        },
      },
    },
  })) as {
    response: { docs: SolrDoc[] };
    facets?: {
      wormhole_terms?: { buckets: Array<{ val: string; relatedness: { relatedness: number } }> };
    };
  };

  const docs = response.response.docs;
  // each "bucket" = one term Solr found, with its relatedness score
  const buckets = response.facets?.wormhole_terms?.buckets ?? [];
  const skgTerms = buckets.map((b) => ({ term: b.val, relatedness: b.relatedness.relatedness }));

  return { docs, skgTerms };
}

/**
 * The sparse hop. A BM25 search over `text_terms` using the SKG terms from
 * {@link wormholeHop}, each boosted by its relatedness score — turns the
 * dense hop's fuzzy neighborhood into a precise keyword match. Returns `[]`
 * without hitting Solr if there are no terms to search on.
 */
export async function bm25Search(
  terms: SkgTerm[],
  k: number,
  core: string = DEFAULT_CORE
): Promise<SolrDoc[]> {
  if (!terms.length) return [];
  const queryString = terms
    .map((t) => `text_terms:${escapeSolrTerm(t.term)}^${t.relatedness}`)
    .join(" OR ");

  const response = (await solrPost(`/${core}/select`, {
    query: queryString,
    limit: k,
    fields: ["id", "title", "text", "source"],
  })) as { response: { docs: SolrDoc[] } };

  return response.response.docs;
}

/**
 * Plain BM25 on the raw query string — the baseline comparison used by the
 * CLI. Words are escaped and bound to `text` via Solr's grouped field
 * syntax (`text:(a b c)`) so multi-word queries don't leak unbound tokens to
 * Solr's default field. Falls back to matching everything (`*:*`) if the
 * query is empty or whitespace.
 */
export async function baselineSearch(
  query: string,
  k: number,
  core: string = DEFAULT_CORE
): Promise<SolrDoc[]> {
  const words = query.trim().split(/\s+/).filter(Boolean).map(escapeSolrTerm);

  const response = (await solrPost(`/${core}/select`, {
    query: words.length ? `text:(${words.join(" ")})` : "*:*",
    limit: k,
    fields: ["id", "title", "text", "source"],
  })) as { response: { docs: SolrDoc[] } };

  return response.response.docs;
}
