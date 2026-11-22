/**
 * Zodiac Sign Compatibility (Western sun-sign pairs) — Epic ZC / S-ZC-2.
 *
 * Deterministic scoring per _bmad-output/zodiac-compatibility/research/
 * pair-matrix.md (Mary, 2026-11-22; source register in research/sources.md):
 * the wheel-geometry method — aspect base + element modifier + bounded
 * dignity modifier + shared-ruler bonus, clamped to the honest 35–95 range
 * (no fake 0/100 extremes; sun-sign is one lens of a whole-chart picture).
 *
 * Canonical-formula note (decisions.md D-ZC8): a full 78-row re-verification
 * confirms the research table matches the §2 formula for 77/78 rows — the one
 * slip is row 22 Taurus–Aquarius (table 45 → formula 42; earth–air contrary
 * missed). Dignity precedence: exaltation is counted even where the ruler is
 * also in domicile (the single dual case, Mercury in Virgo → Gemini–Virgo 47
 * per §6.7). Tests assert the formula-derived distribution (Excellent 10 /
 * Strong 26 / Mixed 6 / Challenging 33 / Very challenging 3).
 *
 * Interpretive tradition, not a scientific measure. Content SIGNED OFF by the
 * owner 2026-11-22 → verified:true (the P11-class gate for this set; Ashtakoota
 * matching/muhurat/transits keep their own verified:false pending their review).
 * Vedic Graha Maitri is deliberately NOT mixed in (research §2.5); cross-link to
 * /matching for the Vedic method instead.
 *
 * Symmetry: pair(A,B) ≡ pair(B,A) by construction — one canonical record per
 * unordered pair; 78 unique pairs cover all 144 ordered lookups. Pair
 * editorial content lives in src/data/sign-compatibility/pairs.json (Epic ZC
 * content pipeline); missing keys throw loudly — no runtime filler copy.
 */

import pairsData from "../data/sign-compatibility/pairs.json";

// ---------------------------------------------------------------------------
// Sign table (pair-matrix §1.1; sanskrit/approx dates parity with
// SUN_SIGN_META in calculators.ts, kept inline so this module is self-contained)
// ---------------------------------------------------------------------------

export const ZODIAC_SIGNS = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
] as const;
export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];

export type Element = "Fire" | "Earth" | "Air" | "Water";
export type Modality = "Cardinal" | "Fixed" | "Mutable";
export type Polarity = "Yang" | "Yin";

export interface SignMeta {
  name: string;
  sanskrit: string;
  element: Element;
  modality: Modality;
  polarity: Polarity;
  /** Classical ruler (the only ruler that enters the scoring — D-ZC8 spec). */
  ruler: string;
  /** Modern co-ruler — displayed for transparency, never scored (pair-matrix §2 design choices). */
  coRuler: string | null;
  approxDates: string;
}

export const SIGN_META: Record<ZodiacSign, SignMeta> = {
  aries: {
    name: "Aries",
    sanskrit: "Mesha",
    element: "Fire",
    modality: "Cardinal",
    polarity: "Yang",
    ruler: "Mars",
    coRuler: null,
    approxDates: "Mar 21 – Apr 19",
  },
  taurus: {
    name: "Taurus",
    sanskrit: "Vrishabha",
    element: "Earth",
    modality: "Fixed",
    polarity: "Yin",
    ruler: "Venus",
    coRuler: null,
    approxDates: "Apr 20 – May 20",
  },
  gemini: {
    name: "Gemini",
    sanskrit: "Mithuna",
    element: "Air",
    modality: "Mutable",
    polarity: "Yang",
    ruler: "Mercury",
    coRuler: null,
    approxDates: "May 21 – Jun 20",
  },
  cancer: {
    name: "Cancer",
    sanskrit: "Karka",
    element: "Water",
    modality: "Cardinal",
    polarity: "Yin",
    ruler: "Moon",
    coRuler: null,
    approxDates: "Jun 21 – Jul 22",
  },
  leo: {
    name: "Leo",
    sanskrit: "Simha",
    element: "Fire",
    modality: "Fixed",
    polarity: "Yang",
    ruler: "Sun",
    coRuler: null,
    approxDates: "Jul 23 – Aug 22",
  },
  virgo: {
    name: "Virgo",
    sanskrit: "Kanya",
    element: "Earth",
    modality: "Mutable",
    polarity: "Yin",
    ruler: "Mercury",
    coRuler: null,
    approxDates: "Aug 23 – Sep 22",
  },
  libra: {
    name: "Libra",
    sanskrit: "Tula",
    element: "Air",
    modality: "Cardinal",
    polarity: "Yang",
    ruler: "Venus",
    coRuler: null,
    approxDates: "Sep 23 – Oct 23",
  },
  scorpio: {
    name: "Scorpio",
    sanskrit: "Vrishchika",
    element: "Water",
    modality: "Fixed",
    polarity: "Yin",
    ruler: "Mars",
    coRuler: "Pluto",
    approxDates: "Oct 23 – Nov 21",
  },
  sagittarius: {
    name: "Sagittarius",
    sanskrit: "Dhanu",
    element: "Fire",
    modality: "Mutable",
    polarity: "Yang",
    ruler: "Jupiter",
    coRuler: null,
    approxDates: "Nov 22 – Dec 21",
  },
  capricorn: {
    name: "Capricorn",
    sanskrit: "Makara",
    element: "Earth",
    modality: "Cardinal",
    polarity: "Yin",
    ruler: "Saturn",
    coRuler: null,
    approxDates: "Dec 22 – Jan 19",
  },
  aquarius: {
    name: "Aquarius",
    sanskrit: "Kumbha",
    element: "Air",
    modality: "Fixed",
    polarity: "Yang",
    ruler: "Saturn",
    coRuler: "Uranus",
    approxDates: "Jan 20 – Feb 18",
  },
  pisces: {
    name: "Pisces",
    sanskrit: "Meena",
    element: "Water",
    modality: "Mutable",
    polarity: "Yin",
    ruler: "Jupiter",
    coRuler: "Neptune",
    approxDates: "Feb 19 – Mar 20",
  },
};

export function isZodiacSign(value: unknown): value is ZodiacSign {
  return typeof value === "string" && (ZODIAC_SIGNS as readonly string[]).includes(value);
}

/** Canonical (wheel-order sorted) unordered pair key, e.g. "aries-taurus". */
export function canonicalPairSlug(a: ZodiacSign, b: ZodiacSign): string {
  const [x, y] = wheelOrder(a, b);
  return `${x}-${y}`;
}

function wheelOrder(a: ZodiacSign, b: ZodiacSign): [ZodiacSign, ZodiacSign] {
  return ZODIAC_SIGNS.indexOf(a) <= ZODIAC_SIGNS.indexOf(b) ? [a, b] : [b, a];
}

// ---------------------------------------------------------------------------
// Aspects (pair-matrix §1.2) — d = min(diff, 12 − diff)
// ---------------------------------------------------------------------------

export const ASPECTS = [
  "conjunction",
  "semisextile",
  "sextile",
  "square",
  "trine",
  "quincunx",
  "opposition",
] as const;
export type Aspect = (typeof ASPECTS)[number];

const ASPECT_BY_D: Aspect[] = [
  "conjunction",
  "semisextile",
  "sextile",
  "square",
  "trine",
  "quincunx",
  "opposition",
];
const ASPECT_DEGREES: Record<Aspect, number> = {
  conjunction: 0,
  semisextile: 30,
  sextile: 60,
  square: 90,
  trine: 120,
  quincunx: 150,
  opposition: 180,
};
const ASPECT_BASE: Record<Aspect, number> = {
  trine: 88,
  conjunction: 80,
  sextile: 78,
  opposition: 62,
  semisextile: 54,
  quincunx: 48,
  square: 45,
};

export function aspectFor(a: ZodiacSign, b: ZodiacSign): Aspect {
  const diff = Math.abs(ZODIAC_SIGNS.indexOf(a) - ZODIAC_SIGNS.indexOf(b));
  return ASPECT_BY_D[Math.min(diff, 12 - diff)]!;
}

// ---------------------------------------------------------------------------
// Dignities (pair-matrix §1.3, from Wikipedia "Essential dignity") — classical
// rulers only; a ruler IN its own sign(s) is a shared-ruler case, not a modifier
// ---------------------------------------------------------------------------

const EXALTED_IN: Record<string, ZodiacSign> = {
  Sun: "aries",
  Moon: "taurus",
  Mercury: "virgo",
  Venus: "pisces",
  Mars: "capricorn",
  Jupiter: "cancer",
  Saturn: "libra",
};
const DETRIMENT_IN: Record<string, ZodiacSign[]> = {
  Sun: ["aquarius"],
  Moon: ["capricorn"],
  Mercury: ["sagittarius", "pisces"],
  Venus: ["scorpio", "aries"],
  Mars: ["libra", "taurus"],
  Jupiter: ["gemini", "virgo"],
  Saturn: ["cancer", "leo"],
};
const FALL_IN: Record<string, ZodiacSign[]> = {
  Sun: ["libra"],
  Moon: ["scorpio"],
  Mercury: ["pisces"],
  Venus: ["virgo"],
  Mars: ["cancer"],
  Jupiter: ["capricorn"],
  Saturn: ["aries"],
};

// Shared-ruler pairs (pair-matrix §2 step 4). The +2 rows are a ruler's two
// domiciles; the +1 rows are traditional-only (modern co-rulers differ) and
// stay flagged DISPUTED per research §6.9.
const SHARED_RULER: Record<string, { planet: string; bonus: number; disputed: boolean }> = {
  "gemini-virgo": { planet: "Mercury", bonus: 2, disputed: false },
  "taurus-libra": { planet: "Venus", bonus: 2, disputed: false },
  "aries-scorpio": { planet: "Mars", bonus: 1, disputed: true },
  "sagittarius-pisces": { planet: "Jupiter", bonus: 1, disputed: true },
  "capricorn-aquarius": { planet: "Saturn", bonus: 1, disputed: true },
};

// ---------------------------------------------------------------------------
// Scoring (pair-matrix §2) — canonical formula
// ---------------------------------------------------------------------------

export type ElementRelation = "same" | "complementary" | "cross" | "contrary";

/** Classical contrariety mapping (research §2.1/§3): complementary fire–air and earth–water; contrary fire–water and earth–air; the rest cross. */
export function elementRelation(a: Element, b: Element): ElementRelation {
  if (a === b) return "same";
  const fireAir = (a === "Fire" && b === "Air") || (a === "Air" && b === "Fire");
  const earthWater = (a === "Earth" && b === "Water") || (a === "Water" && b === "Earth");
  if (fireAir || earthWater) return "complementary";
  const fireWater = (a === "Fire" && b === "Water") || (a === "Water" && b === "Fire");
  const earthAir = (a === "Earth" && b === "Air") || (a === "Air" && b === "Earth");
  if (fireWater || earthAir) return "contrary";
  return "cross";
}

const ELEMENT_MODIFIER: Record<ElementRelation, number> = {
  same: 0,
  complementary: 3,
  cross: 0,
  contrary: -3,
};

const SCORE_FLOOR = 35;
const SCORE_CEILING = 95;

function clampScore(value: number): number {
  return Math.min(SCORE_CEILING, Math.max(SCORE_FLOOR, value));
}

/**
 * One direction of the dignity lens: A's classical ruler placed in B's sign.
 * Exaltation is checked FIRST: for the one dual case (Mercury is both
 * domicile and exalted in Virgo) the research table counts the +3
 * (pair-matrix §4 row 27 / §6.7). A plain domicile hit → shared ruler
 * (step 4), never a modifier.
 */
function dignityOfDirection(rulerSign: ZodiacSign, inSign: ZodiacSign): number {
  const ruler = SIGN_META[rulerSign].ruler;
  if (EXALTED_IN[ruler] === inSign) return 3;
  if (ruler === SIGN_META[inSign].ruler) return 0; // domicile-in-partner → shared ruler (step 4)
  if ((DETRIMENT_IN[ruler] ?? []).includes(inSign) || (FALL_IN[ruler] ?? []).includes(inSign)) {
    return -4;
  }
  return 0;
}

export interface PairFacts {
  aspect: Aspect;
  degrees: number;
  element_pair: string;
  modality_pair: string;
  polarity_pair: string;
  rulers: string;
  ruler_note: string;
  shared_ruler: { planet: string; disputed: boolean } | null;
}

export interface PairScores {
  score: number;
  band: string;
  band_note: string;
  categories: Record<CategoryKey, number>;
}

export type CategoryKey =
  | "love"
  | "sexual"
  | "friendship"
  | "communication"
  | "trust"
  | "emotional";

export const BAND_NOTES: Record<string, string> = {
  Excellent: "easy flow — the work is not taking it for granted",
  Strong: "natural rapport with clear, workable edges",
  Mixed: "workable with effort",
  Challenging: "growth through friction — different tempos to reconcile",
  "Very challenging": "growth-intensive — both partners must stretch",
};

function bandFor(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Mixed";
  if (score >= 40) return "Challenging";
  return "Very challenging";
}

/** Ruler-affinity display note for the facts chips (pair-matrix §4 'ruler affinity note' logic, derived not copied). */
function rulerNote(
  a: ZodiacSign,
  b: ZodiacSign,
  shared: { planet: string; disputed: boolean } | null,
): string {
  if (shared) {
    if (shared.disputed) {
      return `both classically ruled by ${shared.planet} (modern co-rulers differ)`;
    }
    return `both ruled by ${shared.planet}`;
  }
  const parts: string[] = [];
  const aIn = dignityOfDirection(b, a); // B's ruler placed in A's sign
  const bIn = dignityOfDirection(a, b);
  if (EXALTED_IN[SIGN_META[b].ruler] === a)
    parts.push(
      `${SIGN_META[b].ruler} (the ${SIGN_META[b].name} ruler) is exalted in ${SIGN_META[a].name}`,
    );
  if (EXALTED_IN[SIGN_META[a].ruler] === b)
    parts.push(
      `${SIGN_META[a].ruler} (the ${SIGN_META[a].name} ruler) is exalted in ${SIGN_META[b].name}`,
    );
  const debilitated = (d: number) => d === -4;
  if (debilitated(aIn) && debilitated(bIn))
    parts.push("rulers in mutual detriment across the axis");
  else {
    if (debilitated(aIn))
      parts.push(`${SIGN_META[b].ruler} is debilitated in ${SIGN_META[a].name}`);
    if (debilitated(bIn))
      parts.push(`${SIGN_META[a].ruler} is debilitated in ${SIGN_META[b].name}`);
  }
  return parts.length > 0 ? parts.join("; ") : "no classical dignity interaction";
}

/**
 * The canonical deterministic score for an unordered sign pair (pair-matrix
 * §2). Same-sign pairs short-circuit to the conjunction base 80 (dignity lens
 * skipped — a ruler in its own sign is a property of the sign, not a pair
 * interaction).
 */
export function signCompatibilityScores(a: ZodiacSign, b: ZodiacSign): PairScores {
  const aspect = aspectFor(a, b);
  const base = ASPECT_BASE[aspect];
  const elRel = elementRelation(SIGN_META[a].element, SIGN_META[b].element);

  let dignityTotal = 0;
  if (a !== b) {
    dignityTotal = dignityOfDirection(a, b) + dignityOfDirection(b, a);
    dignityTotal = Math.min(5, Math.max(-6, dignityTotal));
  }

  const shared = a === b ? null : (SHARED_RULER[canonicalPairSlug(a, b)] ?? null);
  const sharedBonus = shared?.bonus ?? 0;

  const score = clampScore(base + ELEMENT_MODIFIER[elRel] + dignityTotal + sharedBonus);
  const band = bandFor(score);

  const chemistry =
    aspect === "conjunction" ||
    aspect === "trine" ||
    aspect === "sextile" ||
    aspect === "opposition";
  const talkFriction = aspect === "square" || aspect === "quincunx" || aspect === "semisextile";
  const axisFriction = aspect === "opposition" || aspect === "square";
  const waterInvolving = SIGN_META[a].element === "Water" || SIGN_META[b].element === "Water";
  const friendlyBond =
    elRel === "same" || elRel === "complementary" ? 2 : elRel === "contrary" ? -2 : 0;

  return {
    score,
    band,
    band_note: BAND_NOTES[band]!,
    categories: {
      love: clampScore(score + 4),
      sexual: clampScore(score + (chemistry ? 6 : 2)),
      friendship: clampScore(score + friendlyBond),
      communication: clampScore(score + (talkFriction ? -6 : 0)),
      trust: clampScore(score + (axisFriction ? -8 : -2)),
      emotional: clampScore(score + (waterInvolving ? 2 : 0)),
    },
  };
}

/** Facts block for the UI chips (pure display; canonical sign order keeps it symmetric). */
export function signCompatibilityFacts(a: ZodiacSign, b: ZodiacSign): PairFacts {
  const [x, y] = wheelOrder(a, b);
  const aspect = aspectFor(x, y);
  const A = SIGN_META[x];
  const B = SIGN_META[y];
  const shared = x === y ? null : (SHARED_RULER[canonicalPairSlug(x, y)] ?? null);
  return {
    aspect,
    degrees: ASPECT_DEGREES[aspect],
    element_pair: `${A.element} × ${B.element}`,
    modality_pair: `${A.modality} × ${B.modality}`,
    polarity_pair: `${A.polarity} × ${B.polarity}`,
    rulers: `${A.ruler} / ${B.ruler}`,
    ruler_note: rulerNote(x, y, shared),
    shared_ruler: shared ? { planet: shared.planet, disputed: shared.disputed } : null,
  };
}

// ---------------------------------------------------------------------------
// Pair content (editorial) — src/data/sign-compatibility/pairs.json
// ---------------------------------------------------------------------------

export interface PairContentRecord {
  pair: string;
  aspect: Aspect;
  overall: { verdict: string };
  categories: Record<CategoryKey, string>;
  tips: string[];
}

const PAIR_CONTENT = new Map<string, PairContentRecord>();
for (const record of pairsData as PairContentRecord[]) {
  PAIR_CONTENT.set(record.pair, record);
}

export const PAIR_CONTENT_COUNT = PAIR_CONTENT.size;

/** Editorial content for a canonical pair slug. Missing keys throw — callers must never render filler. */
export function pairContent(pairSlug: string): PairContentRecord {
  const record = PAIR_CONTENT.get(pairSlug);
  if (!record) throw new Error(`no compatibility content for pair "${pairSlug}"`);
  return record;
}

// ---------------------------------------------------------------------------
// Full result shape (route payload, D12)
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  love: "Love Compatibility",
  sexual: "Sexual Compatibility",
  friendship: "Friendship Compatibility",
  communication: "Communication Compatibility",
  trust: "Trust Compatibility",
  emotional: "Emotional Compatibility",
};

export const COMPATIBILITY_DISCLAIMER =
  "Zodiac sign compatibility readings on Vyotish are for guidance and entertainment purposes only. Real relationships depend on the whole people in them, not just sun signs.";

export const COMPATIBILITY_METHOD_NOTE =
  "Scores derive from classical Western sign-geometry factors — aspect (angular distance between signs), element, modality and traditional planetary rulers — using a fixed documented formula. This is an interpretive method, not a scientific measure.";

export interface SignPairResult {
  pair: string;
  requested: { sign1: ZodiacSign; sign2: ZodiacSign };
  facts: PairFacts;
  overall: { score: number; band: string; band_note: string; verdict: string };
  categories: Array<{ key: string; label: string; score: number; explanation: string }>;
  tips: string[];
  disclaimer: string;
  method_note: string;
  /** Content sign-off: owner approved the 78-record set 2026-11-22 (P11-class). */
  verified: boolean;
}

export class UnknownSignError extends Error {
  constructor(sign: unknown) {
    super(`unknown zodiac sign: ${String(sign)}`);
  }
}

/**
 * Full symmetric result for two signs (any order; canonicalised internally).
 * Throws UnknownSignError for invalid slugs and Error for missing content.
 */
export function signPairResult(sign1: string, sign2: string): SignPairResult {
  if (!isZodiacSign(sign1)) throw new UnknownSignError(sign1);
  if (!isZodiacSign(sign2)) throw new UnknownSignError(sign2);
  const a = sign1 as ZodiacSign;
  const b = sign2 as ZodiacSign;
  const slug = canonicalPairSlug(a, b);
  const content = pairContent(slug);
  const facts = signCompatibilityFacts(a, b);
  const scores = signCompatibilityScores(a, b);

  const categories = (Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map(
    (key) => ({
      key,
      label: CATEGORY_LABELS[key],
      score: scores.categories[key],
      explanation: content.categories[key],
    }),
  );

  return {
    pair: slug,
    requested: { sign1: a, sign2: b },
    facts,
    overall: {
      score: scores.score,
      band: scores.band,
      band_note: scores.band_note,
      verdict: content.overall.verdict,
    },
    categories,
    tips: content.tips,
    disclaimer: COMPATIBILITY_DISCLAIMER,
    method_note: COMPATIBILITY_METHOD_NOTE,
    // Owner content sign-off 2026-11-22 — the "interpretive method" UI tag
    // renders only while this is false. Method framing/disclaimer stay.
    verified: true,
  };
}

/** All 78 canonical pair slugs, wheel order (for sitemaps/getStaticPaths). */
export function allCanonicalPairs(): string[] {
  const slugs: string[] = [];
  for (let i = 0; i < ZODIAC_SIGNS.length; i++) {
    for (let j = i; j < ZODIAC_SIGNS.length; j++) {
      slugs.push(`${ZODIAC_SIGNS[i]}-${ZODIAC_SIGNS[j]}`);
    }
  }
  return slugs;
}
