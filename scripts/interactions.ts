// Synthetic implicit-feedback interactions for the behavioral vector space (Phase D).
// Personas span the corpus's `source` categories; cross-category personas (e.g. a
// barista touching both java_coffee and server_hospitality) are the whole point —
// they create the affinity links matrix factorization needs to produce serendipity.

export type AffinityStrength = "strong" | "medium" | "weak";

export interface PersonaAffinity {
  category: string;
  strength: AffinityStrength;
}

export interface Persona {
  name: string;
  affinities: PersonaAffinity[];
}

export const PERSONAS: Persona[] = [
  // ── java_programming ────────────────────────────────────────────
  { name: "backend_java_engineer", affinities: [{ category: "java_programming", strength: "strong" }] },
  { name: "java_enterprise_architect", affinities: [{ category: "java_programming", strength: "strong" }] },
  {
    name: "jvm_performance_tuner",
    affinities: [
      { category: "java_programming", strength: "strong" },
      { category: "server_tech", strength: "weak" },
    ],
  },
  { name: "java_qa_tester", affinities: [{ category: "java_programming", strength: "strong" }] },

  // ── java_coffee ──────────────────────────────────────────────────
  { name: "coffee_connoisseur", affinities: [{ category: "java_coffee", strength: "strong" }] },
  { name: "indonesian_coffee_trader", affinities: [{ category: "java_coffee", strength: "strong" }] },
  {
    name: "barista",
    affinities: [
      { category: "java_coffee", strength: "strong" },
      { category: "server_hospitality", strength: "strong" },
    ],
  },
  {
    name: "cafe_owner",
    affinities: [
      { category: "java_coffee", strength: "medium" },
      { category: "server_hospitality", strength: "strong" },
    ],
  },

  // ── mercury_planet ───────────────────────────────────────────────
  { name: "astronomy_enthusiast", affinities: [{ category: "mercury_planet", strength: "strong" }] },
  {
    name: "space_mission_engineer",
    affinities: [
      { category: "mercury_planet", strength: "strong" },
      { category: "server_tech", strength: "weak" },
    ],
  },

  // ── mercury_element ──────────────────────────────────────────────
  { name: "toxicologist", affinities: [{ category: "mercury_element", strength: "strong" }] },
  {
    name: "environmental_health_researcher",
    affinities: [
      { category: "mercury_element", strength: "strong" },
      { category: "server_hospitality", strength: "medium" },
    ],
  },

  // ── mercury_car ──────────────────────────────────────────────────
  { name: "classic_car_collector", affinities: [{ category: "mercury_car", strength: "strong" }] },
  { name: "vintage_auto_mechanic", affinities: [{ category: "mercury_car", strength: "strong" }] },
  { name: "ford_brand_historian", affinities: [{ category: "mercury_car", strength: "strong" }] },

  // ── python_programming ───────────────────────────────────────────
  {
    name: "python_data_scientist",
    affinities: [
      { category: "python_programming", strength: "strong" },
      { category: "java_programming", strength: "medium" },
    ],
  },
  {
    name: "polyglot_developer",
    affinities: [
      { category: "python_programming", strength: "strong" },
      { category: "java_programming", strength: "strong" },
    ],
  },
  {
    name: "ml_engineer",
    affinities: [
      { category: "python_programming", strength: "strong" },
      { category: "server_tech", strength: "medium" },
    ],
  },

  // ── python_snake ─────────────────────────────────────────────────
  { name: "reptile_keeper", affinities: [{ category: "python_snake", strength: "strong" }] },
  { name: "herpetologist", affinities: [{ category: "python_snake", strength: "strong" }] },
  {
    name: "python_search_ambiguous_user",
    affinities: [
      { category: "python_snake", strength: "medium" },
      { category: "python_programming", strength: "medium" },
    ],
  },

  // ── server_tech / server_hospitality ──────────────────────────────
  {
    name: "devops_engineer",
    affinities: [
      { category: "server_tech", strength: "strong" },
      { category: "python_programming", strength: "medium" },
    ],
  },
  {
    name: "sre_engineer",
    affinities: [
      { category: "server_tech", strength: "strong" },
      { category: "java_programming", strength: "medium" },
    ],
  },
  {
    name: "restaurant_manager",
    affinities: [
      { category: "server_hospitality", strength: "strong" },
      { category: "server_tech", strength: "medium" },
    ],
  },
];

const STRENGTH_PARAMS: Record<AffinityStrength, { pInteract: number; pStrong: number }> = {
  strong: { pInteract: 0.4, pStrong: 0.5 },
  medium: { pInteract: 0.22, pStrong: 0.3 },
  weak: { pInteract: 0.12, pStrong: 0.15 },
};

const SEED = 0xc0ffee;

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a deterministic users × items implicit-feedback matrix (0/1/3) from
 * the persona affinity definitions above. Rows follow PERSONAS order; columns
 * follow the input `docs` order.
 */
export function generateInteractions(docs: { id: string; source: string }[]): number[][] {
  const rand = mulberry32(SEED);
  const matrix: number[][] = PERSONAS.map(() => new Array(docs.length).fill(0));

  PERSONAS.forEach((persona, u) => {
    const affinityByCategory = new Map(persona.affinities.map((a) => [a.category, STRENGTH_PARAMS[a.strength]]));
    docs.forEach((doc, i) => {
      const params = affinityByCategory.get(doc.source);
      if (!params) return;
      if (rand() < params.pInteract) {
        matrix[u][i] = rand() < params.pStrong ? 3 : 1;
      }
    });
  });

  // Guarantee every item is reachable from at least one persona, preferring a
  // persona whose affinities actually include that item's category.
  for (let i = 0; i < docs.length; i++) {
    if (matrix.some((row) => row[i] > 0)) continue;

    const candidateUsers = PERSONAS.map((p, u) => (p.affinities.some((a) => a.category === docs[i].source) ? u : -1)).filter(
      (u) => u >= 0,
    );
    const u =
      candidateUsers.length > 0
        ? candidateUsers[Math.floor(rand() * candidateUsers.length)]
        : Math.floor(rand() * PERSONAS.length);
    matrix[u][i] = rand() < 0.5 ? 3 : 1;
  }

  return matrix;
}
