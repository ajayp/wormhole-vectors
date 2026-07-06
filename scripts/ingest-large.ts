import * as fs from "fs";
import * as path from "path";
import { createGunzip } from "zlib";
import { parse } from "csv-parse";
import { randomUUID } from "crypto";
import { ensureCore, insertDocuments, Doc } from "../src/solr";
import { embedBatch } from "../src/embed";

process.loadEnvFile();

const CORE = "wormhole_large";
const DOMAINS = ["health", "cooking", "scifi", "travel", "devops"];
const SAMPLE_SIZE = parseInt(process.env.LARGE_CORPUS_SAMPLE_SIZE ?? "200");
const MAX_CHARS = 2000;
const EMBED_CONCURRENCY = 20;

// Vendored as a git submodule (vendor/solr-skg-ts) — contains real Stack Exchange
// data dumps used to validate Solr relatedness() at larger scale. Run
// `git submodule update --init` if this directory is empty.
const DATA_ROOT = path.resolve(__dirname, "../vendor/solr-skg-ts/data");

interface RawRow {
  title: string;
  text: string;
  source: string;
}

// The dumps store body/title HTML-entity-encoded (a data-format artifact, not
// meaningful noise) — decode entities, then strip tags, but leave real-world
// typos/jargon/tangents untouched.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent[0] === "#") {
      const codePoint =
        ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[ent] ?? match;
  });
}

function cleanHtml(raw: string): string {
  const decoded = decodeEntities(raw);
  const stripped = decoded.replace(/<[^>]*>/g, " ");
  return stripped.replace(/\s+/g, " ").trim();
}

async function sampleDomain(domain: string): Promise<RawRow[]> {
  const filePath = path.join(DATA_ROOT, domain, "posts.csv.gz");
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Expected Stack Exchange data at ${filePath} (vendor/solr-skg-ts submodule not initialized or missing this domain's data). ` +
        `Run "git submodule update --init" to fetch it.`
    );
  }

  const rows: RawRow[] = [];

  await new Promise<void>((resolve, reject) => {
    const parser = parse({ columns: true, relax_quotes: true, skip_empty_lines: true });
    const stream = fs.createReadStream(filePath).pipe(createGunzip()).pipe(parser);

    stream.on("data", (record: Record<string, string>) => {
      if (rows.length >= SAMPLE_SIZE) return;

      const title = (record.title ?? "").trim();
      const body = (record.body ?? "").trim();
      if (!title || !body) return;

      const text = cleanHtml(body).slice(0, MAX_CHARS);
      if (!text) return;

      rows.push({ title: cleanHtml(title), text, source: domain });

      if (rows.length >= SAMPLE_SIZE) {
        stream.destroy();
      }
    });

    stream.on("close", resolve);
    stream.on("end", resolve);
    stream.on("error", (err: Error) => {
      // Destroying the stream early (once we have enough rows) surfaces as
      // a "Premature close" error — not a real failure, ignore it.
      if (rows.length >= SAMPLE_SIZE) resolve();
      else reject(err);
    });
  });

  return rows;
}

async function embedInChunks(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_CONCURRENCY) {
    const chunk = texts.slice(i, i + EMBED_CONCURRENCY);
    const chunkVectors = await embedBatch(chunk);
    vectors.push(...chunkVectors);
    console.log(`  embedded ${Math.min(i + EMBED_CONCURRENCY, texts.length)}/${texts.length}`);
  }
  return vectors;
}

async function main() {
  console.log("Setting up Solr core...");
  await ensureCore(CORE);

  const allRows: RawRow[] = [];
  for (const domain of DOMAINS) {
    console.log(`\nSampling ${domain}...`);
    const rows = await sampleDomain(domain);
    console.log(`  sampled ${rows.length} docs from ${domain}`);
    allRows.push(...rows);
  }

  console.log(`\nEmbedding ${allRows.length} documents (first run downloads model ~22MB)...`);
  const texts = allRows.map((r) => `${r.title} ${r.text}`);
  const vectors = await embedInChunks(texts);

  const docs: Doc[] = allRows.map((r, i) => ({
    id: randomUUID(),
    title: r.title,
    text: r.text,
    source: r.source,
    vector: vectors[i],
  }));

  console.log("\nInserting documents into Solr...");
  await insertDocuments(docs, CORE);

  console.log(`\nDone. Indexed ${docs.length} docs into core [${CORE}].`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
