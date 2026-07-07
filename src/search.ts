import { solrPost } from "./solr-client";
import { embedText } from "./embed";

process.loadEnvFile();

const DEFAULT_CORE = "wormhole_demo";

export interface SolrDoc {
  id: string;
  title?: string;
  text?: string;
  source?: string;
  vector?: number[];
  behavior_vector?: number[];
}

export interface SkgTerm {
  term: string;
  relatedness: number;
}

export interface WormholeHopResult {
  docs: SolrDoc[];
  skgTerms: SkgTerm[];
  skgCategories: SkgTerm[];
}

export interface SearchOpts {
  withVectors?: boolean;
  withBehaviorVectors?: boolean;
  /** Which Solr core to query — defaults to wormhole_demo. */
  core?: string;
}

// The two hoppable KNN spaces: text embeddings and behavioral (MF) embeddings.
export type VectorField = "vector" | "behavior_vector";

// Escapes Lucene/Solr query-syntax special characters so raw terms can be
// safely interpolated into a hand-built query string.
export function escapeSolrTerm(s: string): string {
  return s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}

function fieldsFor(opts?: SearchOpts): string[] {
  const fields = ["id", "title", "text", "source"];
  if (opts?.withVectors) fields.push("vector");
  if (opts?.withBehaviorVectors) fields.push("behavior_vector");
  return fields;
}

// Solr returns vector fields as strings (see the encodeVector workaround
// in src/solr.ts) — parse them back to numbers in one place.
function normalizeDocs(docs: Array<Record<string, unknown>>): SolrDoc[] {
  return docs.map((d) => {
    const doc = { ...d } as unknown as SolrDoc;
    for (const field of ["vector", "behavior_vector"] as const) {
      if (Array.isArray(d[field])) {
        doc[field] = (d[field] as Array<string | number>).map((v) =>
          typeof v === "string" ? parseFloat(v) : v
        );
      }
    }
    return doc;
  });
}

function buildKnnQuery(vector: number[], k: number, field: VectorField = "vector"): string {
  return `{!knn f=${field} topK=${k}}[${vector.join(",")}]`;
}

// Plain KNN dense search — no SKG facet. The pooled-vector counterpart to
// wormholeHop's dense+facet request, used for the sparse→dense hop and
// iterative traversal, where no new SKG terms are needed from this leg.
// `field` selects the vector space: text embeddings (default) or the
// behavioral (matrix-factorization) space.
export async function denseSearch(
  vector: number[],
  k: number,
  opts?: SearchOpts & { field?: VectorField }
): Promise<SolrDoc[]> {
  const core = opts?.core ?? DEFAULT_CORE;
  const response = (await solrPost(`/${core}/select`, {
    query: buildKnnQuery(vector, k, opts?.field ?? "vector"),
    limit: k,
    fields: fieldsFor(opts),
  })) as { response: { docs: Array<Record<string, unknown>> } };

  return normalizeDocs(response.response.docs);
}

/**
 * The dense hop. Runs a KNN query to get the nearest docs (the "foreground
 * set"), and in the same round-trip facets over `text_terms` with Solr's SKG
 * `relatedness()` function to find the keywords most distinctive of that set
 * vs. the whole corpus — plus a second sub-facet on `source` for the
 * category-level signal. Those terms feed {@link bm25Search}.
 */
export async function wormholeHop(
  vector: number[],
  k: number,
  opts?: SearchOpts
): Promise<WormholeHopResult> {
  const core = opts?.core ?? DEFAULT_CORE;
  const skgLimit = parseInt(process.env.SKG_LIMIT ?? "8");

  const response = (await solrPost(`/${core}/select`, {
    query: buildKnnQuery(vector, k),
    limit: k,
    fields: fieldsFor(opts),
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
      wormhole_categories: {
        type: "terms",
        field: "source",
        limit: 2,
        sort: { relatedness: "desc" },
        facet: {
          relatedness: { type: "func", func: "relatedness($fore,$back)" },
        },
      },
    },
  })) as {
    response: { docs: Array<Record<string, unknown>> };
    facets?: {
      wormhole_terms?: { buckets: Array<{ val: string; relatedness: { relatedness: number } }> };
      wormhole_categories?: { buckets: Array<{ val: string; relatedness: { relatedness: number } }> };
    };
  };

  const docs = normalizeDocs(response.response.docs);
  const termBuckets = response.facets?.wormhole_terms?.buckets ?? [];
  const categoryBuckets = response.facets?.wormhole_categories?.buckets ?? [];
  const skgTerms = termBuckets.map((b) => ({ term: b.val, relatedness: b.relatedness.relatedness }));
  const skgCategories = categoryBuckets.map((b) => ({ term: b.val, relatedness: b.relatedness.relatedness }));

  return { docs, skgTerms, skgCategories };
}

/**
 * The sparse hop. A BM25 search over `text_terms` using the SKG terms from
 * {@link wormholeHop}, each boosted by its relatedness score — turns the
 * dense hop's fuzzy neighborhood into a precise keyword match. Also accepts
 * an optional `categories` boost clause (source:"cat"^relatedness) for
 * callers that want to combine category and term signals. Returns `[]`
 * without hitting Solr if there are no terms/categories to search on.
 */
export async function bm25Search(
  terms: SkgTerm[],
  k: number,
  opts?: SearchOpts & { categories?: SkgTerm[] }
): Promise<SolrDoc[]> {
  if (!terms.length) return [];

  const core = opts?.core ?? DEFAULT_CORE;

  // relatedness() can be negative (term/category is under-represented in the
  // foreground vs. background) — Solr's `^boost` syntax requires a positive
  // float, and a negative signal isn't one we want to boost by anyway.
  const termClauses = terms
    .filter((t) => t.relatedness > 0)
    .map((t) => `text_terms:${escapeSolrTerm(t.term)}^${t.relatedness}`);
  const categoryClauses = (opts?.categories ?? [])
    .filter((c) => c.relatedness > 0)
    .map((c) => `source:"${escapeSolrTerm(c.term)}"^${c.relatedness}`);
  if (!termClauses.length && !categoryClauses.length) return [];
  const queryString = [...termClauses, ...categoryClauses].join(" OR ");

  const response = (await solrPost(`/${core}/select`, {
    query: queryString,
    limit: k,
    fields: fieldsFor(opts),
  })) as { response: { docs: Array<Record<string, unknown>> } };

  return normalizeDocs(response.response.docs);
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
  opts?: SearchOpts
): Promise<SolrDoc[]> {
  const core = opts?.core ?? DEFAULT_CORE;
  const words = query.trim().split(/\s+/).filter(Boolean).map(escapeSolrTerm);

  const response = (await solrPost(`/${core}/select`, {
    query: words.length ? `text:(${words.join(" ")})` : "*:*",
    limit: k,
    fields: fieldsFor(opts),
  })) as { response: { docs: Array<Record<string, unknown>> } };

  return normalizeDocs(response.response.docs);
}

const RRF_K = 60; // standard smoothing constant from the original RRF paper

// The talk's baseline for "what most hybrid search looks like out of the
// box" (19:55–22:18): run sparse (BM25) and dense (KNN) independently, then
// blend by reciprocal rank fusion — score(doc) = sum over lists of
// 1/(RRF_K + rank). Wormhole vectors are pitched as going *beyond* this; this
// function exists so that claim has something concrete to be measured against.
export async function rrfSearch(
  query: string,
  k: number,
  opts?: SearchOpts & { embed?: (text: string) => Promise<number[]> }
): Promise<SolrDoc[]> {
  const fetchK = Math.max(k, 20);
  const embed = opts?.embed ?? embedText;
  const vector = await embed(query);
  const [sparse, dense] = await Promise.all([
    baselineSearch(query, fetchK, opts),
    denseSearch(vector, fetchK, opts),
  ]);

  const scores = new Map<string, number>();
  const docsById = new Map<string, SolrDoc>();
  for (const list of [sparse, dense]) {
    list.forEach((doc, rank) => {
      docsById.set(doc.id, doc);
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + 1 / (RRF_K + rank + 1));
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => docsById.get(id)!);
}
