import * as dotenv from "dotenv";
import { solrPost } from "./solr-client";

dotenv.config();

const CORE = "wormhole_demo";

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

export async function wormholeHop(
  vector: number[],
  k: number
): Promise<WormholeHopResult> {
  const knnQuery = `{!knn f=vector topK=${k}}[${vector.join(",")}]`;
  const skgLimit = parseInt(process.env.SKG_LIMIT ?? "8");

  const response = (await solrPost(`/${CORE}/select`, {
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
  const buckets = response.facets?.wormhole_terms?.buckets ?? [];
  const skgTerms = buckets.map((b) => ({ term: b.val, relatedness: b.relatedness.relatedness }));

  return { docs, skgTerms };
}

export async function bm25Search(
  terms: SkgTerm[],
  k: number
): Promise<SolrDoc[]> {
  if (!terms.length) return [];
  const queryString = terms
    .map((t) => `text_terms:${escapeSolrTerm(t.term)}^${t.relatedness}`)
    .join(" OR ");

  const response = (await solrPost(`/${CORE}/select`, {
    query: queryString,
    limit: k,
    fields: ["id", "title", "text", "source"],
  })) as { response: { docs: SolrDoc[] } };

  return response.response.docs;
}

export async function baselineSearch(
  query: string,
  k: number
): Promise<SolrDoc[]> {
  const words = query.trim().split(/\s+/).filter(Boolean).map(escapeSolrTerm);

  const response = (await solrPost(`/${CORE}/select`, {
    query: words.length ? `text:(${words.join(" ")})` : "*:*",
    limit: k,
    fields: ["id", "title", "text", "source"],
  })) as { response: { docs: SolrDoc[] } };

  return response.response.docs;
}
