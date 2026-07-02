import * as readline from "readline";
import * as dotenv from "dotenv";
import { wormholeSearch } from "./wormhole";
import { baselineSearch } from "./search";

dotenv.config();

const FINAL_K = parseInt(process.env.FINAL_K ?? "5");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function run() {
  console.clear();
  console.log("=".repeat(72));
  console.log("  WORMHOLE VECTORS — Apache Solr PoC");
  console.log("=".repeat(72));
  console.log("  Note: first query downloads the embedding model (~22MB)");
  console.log("\n  Legend:");
  console.log("    SKG scores: (0.000–1.000) = statistical significance of derived terms");
  console.log("    [S] = sparse hop (BM25, context-driven)");
  console.log("    [D] = dense hop (KNN, semantic similarity backfill)\n");

  const ask = () => {
    rl.question('Query (or "exit"): ', async (input) => {
      const q = input.trim();
      if (!q || q.toLowerCase() === "exit") { rl.close(); return; }

      try {
        const [wormhole, baseline] = await Promise.all([
          wormholeSearch(q, { finalK: FINAL_K }),
          baselineSearch(q, FINAL_K),
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
