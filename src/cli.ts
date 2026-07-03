import * as readline from "readline";
import { wormholeSearch } from "./wormhole";
import { baselineSearch } from "./search";

process.loadEnvFile();

const FINAL_K = parseInt(process.env.FINAL_K ?? "5");

// Which Solr core to search: --core=<name> flag takes priority over SOLR_CORE
// env var, defaulting to the demo corpus. Without this, queries silently ran
// against wormhole_demo even after `npm run ingest:large` populated
// wormhole_large, with no indication which corpus was actually searched.
const coreFlag = process.argv.find((a) => a.startsWith("--core="))?.split("=")[1];
const CORE = coreFlag ?? process.env.SOLR_CORE ?? "wormhole_demo";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function run() {
  console.clear();
  console.log("=".repeat(72));
  console.log("  WORMHOLE VECTORS — Apache Solr PoC");
  console.log("=".repeat(72));
  console.log(`  Core: ${CORE}${coreFlag ? " (--core)" : process.env.SOLR_CORE ? " (SOLR_CORE)" : " (default)"}`);
  console.log("  Note: first query downloads the embedding model (~22MB)");
  console.log("\n  Legend:");
  console.log("    SKG scores: (0.000–1.000) = statistical significance of derived terms");
  console.log("    [S] = sparse hop (BM25, context-driven)");
  console.log("    [D] = dense hop (KNN, semantic similarity backfill)\n");

  const ask = () => {
    rl.question(`[${CORE}] Query (or "exit"): `, async (input) => {
      const q = input.trim();
      if (!q || q.toLowerCase() === "exit") { rl.close(); return; }

      try {
        const [wormhole, baseline] = await Promise.all([
          wormholeSearch(q, { finalK: FINAL_K, core: CORE }),
          baselineSearch(q, FINAL_K, CORE), // generated for comparision results v wormhole results.
        ]);

        const skgDisplay = wormhole.skgTerms
          .map((t) => `${t.term}(${t.relatedness.toFixed(3)})`)
          .join(", ");
        console.log(`\nSKG terms: [${skgDisplay}]\n`);

        const col = 42;
        console.log("Wormhole Results".padEnd(col) + " │ Plain BM25 Search");
        console.log("-".repeat(col) + "─┼─" + "-".repeat(col));

        for (let i = 0; i < FINAL_K; i++) {
          const title = wormhole.finalResults[i]?.title ?? "—";
          const hopTag = wormhole.finalResults[i] ? ` [${wormhole.finalResults[i].hop === "sparse" ? "S" : "D"}]` : "";
          const titleWithHop = title + hopTag;
          const w = titleWithHop.substring(0, col - 2).padEnd(col);
          const b = (baseline[i]?.title ?? "—").substring(0, col - 2);
          console.log(`${w} │ ${b}`);
        }
        console.log();
      } catch (err: any) {
        console.error(`Error: ${err.message}\n`);
      }

      ask();
    });
  };

  ask();
}

run().catch(console.error);
