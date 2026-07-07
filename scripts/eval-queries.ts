// Shared query/domain fixtures for eval.ts, reused (not duplicated) from the
// domain sets already curated in tests/integration/*.test.ts, keyed by core
// so `npm run eval -- --core=wormhole_large` picks up the right query set.

export interface EvalQuery {
  query: string;
  domain: string;
}

export const DEMO_QUERIES: EvalQuery[] = [
  { query: "Java programming", domain: "java_programming" },
  { query: "coffee bean", domain: "java_coffee" },
  { query: "Mercury planet orbit", domain: "mercury_planet" },
  { query: "Mercury element toxicity", domain: "mercury_element" },
  { query: "Mercury Cougar automobile", domain: "mercury_car" },
  { query: "Python programming NumPy", domain: "python_programming" },
  { query: "Python snake constrictor", domain: "python_snake" },
  { query: "server technology Linux", domain: "server_tech" },
  { query: "server hospitality restaurant", domain: "server_hospitality" },
];

export const LARGE_QUERIES: EvalQuery[] = [
  { query: "doctor treatment infection symptoms", domain: "health" },
  { query: "cancer surgery blood pressure", domain: "health" },
  { query: "nutrition diet blood pressure", domain: "health" },

  { query: "bread baking recipe oven", domain: "cooking" },
  { query: "chicken recipe knife prep", domain: "cooking" },
  { query: "oven roast chicken tips", domain: "cooking" },

  { query: "kubernetes container deployment pipeline", domain: "devops" },
  { query: "docker ansible provisioning", domain: "devops" },
  { query: "git monitoring automation", domain: "devops" },

  { query: "star wars alien science fiction", domain: "scifi" },
  { query: "novel universe planet fiction", domain: "scifi" },
  { query: "robot universe fiction", domain: "scifi" },

  { query: "visa passport flight hotel", domain: "travel" },
  { query: "airport customs currency", domain: "travel" },
  { query: "backpack tips travel", domain: "travel" },
];

export const QUERIES_BY_CORE: Record<string, EvalQuery[]> = {
  wormhole_demo: DEMO_QUERIES,
  wormhole_large: LARGE_QUERIES,
};
