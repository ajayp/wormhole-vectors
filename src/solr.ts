import { solrPost, solrPostForm } from "./solr-client";

process.loadEnvFile();

const DEFAULT_CORE = "wormhole_demo";

// Solr's _default configset is shared on disk across cores/recreations, so schema
// mutations (add-field-type, add-field) persist even after UNLOAD ... deleteInstanceDir.
// Tolerate "already exists" so ensureCore() stays idempotent across repeated runs.
async function addToSchemaIdempotent(core: string, body: unknown): Promise<void> {
  await solrPost(`/${core}/schema`, body).catch((err: Error) => {
    if (!err.message.includes("already exists")) throw err;
  });
}

export interface Doc {
  id: string;
  title: string;
  text: string;
  source: string;
  vector: number[];
  behaviorVector?: number[];
}

// Solr's JSON parser throws "ClassCastException: String cannot be cast to Number" on
// DenseVectorField when a value needs exponential notation (e.g. our embeddings' ~1e-33
// noise components) — a known Solr bug (see "Double value in Float32 DenseVectorField",
// users@solr.apache.org). Sending each component as a JSON string avoids the broken path.
function encodeVector(vector: number[]): string[] {
  return vector.map(String);
}

export async function ensureCore(core: string = DEFAULT_CORE): Promise<void> {
  // Idempotent: UNLOAD existing core (ignore if not found), then CREATE fresh
  await solrPostForm("/admin/cores", [
    ["action", "UNLOAD"],
    ["core", core],
    ["deleteIndex", "true"],
    ["deleteDataDir", "true"],
    ["deleteInstanceDir", "true"],
  ]).catch(() => {});

  await solrPostForm("/admin/cores", [
    ["action", "CREATE"],
    ["name", core],
    ["configSet", "_default"],
  ]);

  // Disable auto field guessing
  await solrPost(`/${core}/config`, {
    "set-user-property": { "update.autoCreateFields": "false" },
  });

  // Register the DenseVectorField type for 384-dim cosine vectors
  await addToSchemaIdempotent(core, {
    "add-field-type": {
      name: "knn_vector_384",
      class: "solr.DenseVectorField",
      vectorDimension: 384,
      similarityFunction: "cosine",
    },
  });

  // Behavioral (collaborative-filtering) vectors from matrix factorization —
  // a third hoppable space alongside text embeddings, see src/mf.ts
  await addToSchemaIdempotent(core, {
    "add-field-type": {
      name: "knn_vector_16",
      class: "solr.DenseVectorField",
      vectorDimension: 16,
      similarityFunction: "cosine",
    },
  });

  // Stemmed text type — text_general has no stemmer, which fragments plural/singular
  // forms (e.g. "server"/"servers") into distinct tokens for both matching and faceting.
  await addToSchemaIdempotent(core, {
    "add-field-type": {
      name: "text_stem",
      class: "solr.TextField",
      indexAnalyzer: {
        tokenizer: { class: "solr.StandardTokenizerFactory" },
        filters: [
          { class: "solr.LowerCaseFilterFactory" },
          { class: "solr.StopFilterFactory", ignoreCase: true, words: "stopwords.txt" },
          { class: "solr.PorterStemFilterFactory" },
        ],
      },
      queryAnalyzer: {
        tokenizer: { class: "solr.StandardTokenizerFactory" },
        filters: [
          { class: "solr.LowerCaseFilterFactory" },
          { class: "solr.StopFilterFactory", ignoreCase: true, words: "stopwords.txt" },
          { class: "solr.PorterStemFilterFactory" },
        ],
      },
    },
  });

  // Text fields — uninvertible: true is required for Solr 9 terms facets
  for (const name of ["title", "text", "text_terms"]) {
    await addToSchemaIdempotent(core, {
      "add-field": {
        name,
        type: "text_stem", // merges plural/singular so they don't split SKG relatedness or miss BM25 matches
        stored: true,
        indexed: true,
        multiValued: false,
        uninvertible: true,
      },
    });
  }

  // Source label field (no need for full-text analysis)
  await addToSchemaIdempotent(core, {
    "add-field": {
      name: "source",
      type: "string",
      stored: true,
      indexed: true,
    },
  });

  // Dense vector field
  await addToSchemaIdempotent(core, {
    "add-field": {
      name: "vector",
      type: "knn_vector_384",
      stored: true,
      indexed: true,
    },
  });

  // Behavioral vector field
  await addToSchemaIdempotent(core, {
    "add-field": {
      name: "behavior_vector",
      type: "knn_vector_16",
      stored: true,
      indexed: true,
    },
  });

  console.log(`Core [${core}] ready.`);
}

export async function insertDocuments(docs: Doc[], core: string = DEFAULT_CORE): Promise<void> {
  const payload = docs.map((d) => ({
    id: d.id,
    title: d.title,
    text: d.text,
    text_terms: `${d.title} ${d.text}`, // duplicate for facet targeting
    source: d.source,
    vector: encodeVector(d.vector),
    ...(d.behaviorVector ? { behavior_vector: encodeVector(d.behaviorVector) } : {}),
  }));

  await solrPost(`/${core}/update`, payload);
  await solrPost(`/${core}/update?commit=true`, {});
  console.log(`Indexed ${docs.length} documents.`);
}
