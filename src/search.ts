import * as dotenv from "dotenv";
import { solrPost } from "./solr-client";

dotenv.config();

const CORE = "wormhole_demo";

export interface SolrDoc {
  id: string;
  title?: string;
  text?: string;
  source?: string;
  vector?: number[];
}

export interface SkgTerm {
  term: string;
  relatedness: number;
}

export interface WormholeHopResult {
  docs: SolrDoc[];
  skgTerms: SkgTerm[];
}

export interface SearchOpts {
  withVectors?: boolean;
}

// Escapes Lucene/Solr query-syntax special characters so raw terms can be
// safely interpolated into a hand-built query string.
export function escapeSolrTerm(s: string): string {
  return s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}

function fieldsFor(opts?: SearchOpts): string[] {
  const fields = ["id", "title", "text", "source"];
  if (opts?.withVectors) fields.push("vector");
  return fields;
}

// Solr returns the vector field as strings (see the encodeVector workaround
// in src/solr.ts) — parse them back to numbers in one place.
function normalizeDocs(docs: Array<Record<string, unknown>>): SolrDoc[] {
  return docs.map((d) => {
    const doc = { ...d } as unknown as SolrDoc;
    if (Array.isArray(d.vector)) {
      doc.vector = (d.vector as Array<string | number>).map((v) =>
        typeof v === "string" ? parseFloat(v) : v
      );
    }
    return doc;
  });
}

function buildKnnQuery(vector: number[], k: number): string {
  return `{!knn f=vector topK=${k}}[${vector.join(",")}]`;
}

// Plain KNN dense search — no SKG facet. The pooled-vector counterpart to
// wormholeHop's dense+facet request, used for the sparse→dense hop where no
// new SKG terms are needed from this leg.
export async function denseSearch(
  vector: number[],
  k: number,
  opts?: SearchOpts
): Promise<SolrDoc[]> {
  const response = (await solrPost(`/${CORE}/select`, {
    query: buildKnnQuery(vector, k),
    limit: k,
    fields: fieldsFor(opts),
  })) as { response: { docs: Array<Record<string, unknown>> } };

  return normalizeDocs(response.response.docs);
}

export async function wormholeHop(
  vector: number[],
  k: number,
  opts?: SearchOpts
): Promise<WormholeHopResult> {
  const skgLimit = parseInt(process.env.SKG_LIMIT ?? "8");

  const response = (await solrPost(`/${CORE}/select`, {
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
    },
  })) as {
    response: { docs: Array<Record<string, unknown>> };
    facets?: {
      wormhole_terms?: { buckets: Array<{ val: string; relatedness: { relatedness: number } }> };
    };
  };

  const docs = normalizeDocs(response.response.docs);
  const buckets = response.facets?.wormhole_terms?.buckets ?? [];
  const skgTerms = buckets.map((b) => ({ term: b.val, relatedness: b.relatedness.relatedness }));

  return { docs, skgTerms };
}

export async function bm25Search(
  terms: SkgTerm[],
  k: number,
  opts?: SearchOpts
): Promise<SolrDoc[]> {
  if (!terms.length) return [];
  const queryString = terms
    .map((t) => `text_terms:${escapeSolrTerm(t.term)}^${t.relatedness}`)
    .join(" OR ");

  const response = (await solrPost(`/${CORE}/select`, {
    query: queryString,
    limit: k,
    fields: fieldsFor(opts),
  })) as { response: { docs: Array<Record<string, unknown>> } };

  return normalizeDocs(response.response.docs);
}

export async function baselineSearch(
  query: string,
  k: number,
  opts?: SearchOpts
): Promise<SolrDoc[]> {
  const words = query.trim().split(/\s+/).filter(Boolean).map(escapeSolrTerm);

  const response = (await solrPost(`/${CORE}/select`, {
    query: words.length ? `text:(${words.join(" ")})` : "*:*",
    limit: k,
    fields: fieldsFor(opts),
  })) as { response: { docs: Array<Record<string, unknown>> } };

  return normalizeDocs(response.response.docs);
}
