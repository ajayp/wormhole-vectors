import * as readline from "readline";
import * as dotenv from "dotenv";
import { wormholeSearch, wormholeSearchSparseToDense, wormholeSearchBehavioral, RankedDoc } from "./wormhole";
import { iterativeWormholeSearch } from "./iterate";
import { baselineSearch } from "./search";

dotenv.config();

const FINAL_K = parseInt(process.env.FINAL_K ?? "5");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const HOP_TAGS: Record<RankedDoc["hop"], string> = { sparse: "S", dense: "D", behavioral: "B" };

function hopTag(doc: RankedDoc | undefined): string {
  if (!doc) return "";
  return ` [${HOP_TAGS[doc.hop]}]`;
}

function printSideBySide(left: RankedDoc[], right: { title?: string }[]) {
  const col = 42;
  console.log("Wormhole Results".padEnd(col) + " │ Plain BM25 Search");
  console.log("-".repeat(col) + "─┼─" + "-".repeat(col));

  for (let i = 0; i < FINAL_K; i++) {
    const title = left[i]?.title ?? "—";
    const titleWithHop = title + hopTag(left[i]);
    const w = titleWithHop.substring(0, col - 2).padEnd(col);
    const b = (right[i]?.title ?? "—").substring(0, col - 2);
    console.log(`${w} │ ${b}`);
  }
  console.log();
}

async function runDenseToSparse(q: string) {
  const [wormhole, baseline] = await Promise.all([
    wormholeSearch(q, { finalK: FINAL_K }),
    baselineSearch(q, FINAL_K),
  ]);

  if (wormhole.skgCategories.length) {
    const categoryDisplay = wormhole.skgCategories
      .map((c) => `${c.term}(${c.relatedness.toFixed(3)})`)
      .join(", ");
    console.log(`SKG category: ${categoryDisplay}`);
  }

  const skgDisplay = wormhole.skgTerms
    .map((t) => `${t.term}(${t.relatedness.toFixed(3)})`)
    .join(", ");
  console.log(`SKG terms: [${skgDisplay}]`);

  const specificityLabel = wormhole.broad ? "broad" : "specific";
  console.log(`specificity: ${wormhole.specificity.toFixed(3)} (${specificityLabel})\n`);

  printSideBySide(wormhole.finalResults, baseline);
}

async function runSparseToDense(q: string) {
  const result = await wormholeSearchSparseToDense(q, { finalK: FINAL_K });
  const baseline = await baselineSearch(q, FINAL_K);

  console.log(`Pooled ${result.pooledFrom} sparse foreground doc(s) into wormhole vector\n`);
  printSideBySide(result.finalResults, baseline);
}

async function runBehavioral(q: string) {
  const result = await wormholeSearchBehavioral(q, { finalK: FINAL_K });
  const baseline = await baselineSearch(q, FINAL_K);

  console.log(`Pooled ${result.pooledFrom} dense foreground behavior vector(s) into wormhole vector\n`);
  printSideBySide(result.finalResults, baseline);
}

async function runIterative(q: string) {
  const result = await iterativeWormholeSearch(q, { finalK: FINAL_K });

  const hopSummary = result.hopStats.map((h) => `H${h.hop}:+${h.newDocs}`).join(", ");
  console.log(`Hops: [${hopSummary}]\n`);

  for (const doc of result.finalResults) {
    console.log(`[H${doc.hopNumber}] ${doc.title ?? "—"}`);
  }
  console.log();
}

async function run() {
  console.clear();
  console.log("=".repeat(72));
  console.log("  WORMHOLE VECTORS — Apache Solr PoC");
  console.log("=".repeat(72));
  console.log("  Note: first query downloads the embedding model (~22MB)");
  console.log("\n  Legend:");
  console.log("    SKG scores: (0.000–1.000) = statistical significance of derived terms");
  console.log("    [S] = sparse hop (BM25, context-driven)");
  console.log("    [D] = dense hop (KNN, semantic similarity backfill)");
  console.log("    [B] = behavioral hop (shared audience, not shared meaning)");
  console.log("    plain query     = dense → SKG → sparse (default)");
  console.log("    s2d: <query>    = sparse → SKG → dense (reverse hop)");
  console.log("    iter: <query>   = iterative hopping across rounds");
  console.log("    behave: <query> = dense → behavioral space (serendipity)\n");

  const ask = () => {
    rl.question('Query (or "exit"): ', async (input) => {
      const raw = input.trim();
      if (!raw || raw.toLowerCase() === "exit") { rl.close(); return; }

      try {
        if (raw.toLowerCase().startsWith("s2d:")) {
          await runSparseToDense(raw.slice(4).trim());
        } else if (raw.toLowerCase().startsWith("iter:")) {
          await runIterative(raw.slice(5).trim());
        } else if (raw.toLowerCase().startsWith("behave:")) {
          await runBehavioral(raw.slice(7).trim());
        } else {
          await runDenseToSparse(raw);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}\n`);
      }

      ask();
    });
  };

  ask();
}

run().catch(console.error);
