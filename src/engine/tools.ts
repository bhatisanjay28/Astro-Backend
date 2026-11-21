/**
 * Calculator tools — Tier 1 + Tier 2 (Epic 4.4/4.6, PRD §5.7).
 * Deterministic, pure functions. Fun calculators are labelled "for fun" in the
 * routes. Jaimini karakas / Kaal Sarp are classical engine computations
 * flagged verified:false pending Jyotishi review (P11).
 */
import { navamshaSignIndex, type PlanetPosition, SIGNS } from "./kundli";

// ---------------------------------------------------------------------------
// Chaldean numerology shared base (same table as calculators.ts)
// ---------------------------------------------------------------------------

const CHALDEAN: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 8,
  G: 3,
  H: 5,
  I: 1,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  O: 7,
  P: 8,
  Q: 1,
  R: 2,
  S: 3,
  T: 4,
  U: 6,
  V: 6,
  W: 6,
  X: 5,
  Y: 1,
  Z: 7,
};

export function digitalRoot(n: number): number {
  while (n > 9) {
    n = String(n)
      .split("")
      .reduce((a, c) => a + Number(c), 0);
  }
  return n;
}

export function nameNumber(name: string): { sum: number; root: number; letters: number[] } {
  const letters: number[] = [];
  let sum = 0;
  for (const ch of name.toUpperCase().replace(/[^A-Z]/g, "")) {
    const v = CHALDEAN[ch] ?? 0;
    letters.push(v);
    sum += v;
  }
  return { sum, root: digitalRoot(sum), letters };
}

// ---------------------------------------------------------------------------
// Lo Shu Grid (Tier 2): digits of DDMMYYYY placed on the classical 3×3 map
// [4 9 2 / 3 5 7 / 8 1 6]; 0s are dropped (no Lo Shu position).
// ---------------------------------------------------------------------------

const LO_SHU_POSITIONS = [4, 9, 2, 3, 5, 7, 8, 1, 6];

/** The 8 classical Lo Shu lines (research/lo-shu-grid.md §3.3): complete when
 *  all three numbers are present, broken when any is missing. */
const LO_SHU_LINES: Array<{
  name: string;
  numbers: [number, number, number];
  kind: "plane" | "arrow";
}> = [
  { name: "Mental Plane", numbers: [4, 9, 2], kind: "plane" },
  { name: "Emotional Plane", numbers: [3, 5, 7], kind: "plane" },
  { name: "Practical Plane", numbers: [8, 1, 6], kind: "plane" },
  { name: "Thought Plane", numbers: [4, 3, 8], kind: "arrow" },
  { name: "Will Plane", numbers: [9, 5, 1], kind: "arrow" },
  { name: "Action Plane", numbers: [2, 7, 6], kind: "arrow" },
  { name: "Silver Yog (Rajat Yog)", numbers: [2, 5, 8], kind: "arrow" },
  { name: "Golden Yog (Raj Yog)", numbers: [4, 5, 6], kind: "arrow" },
];

export function loShuGrid(dateISO: string): {
  grid: Array<{ number: number; digits: string[]; count: number }>;
  missing: number[];
  repeated: number[];
  lines: Array<{ name: string; numbers: number[]; kind: string; complete: boolean }>;
} {
  const digits = dateISO
    .replace(/\D/g, "")
    .split("")
    .filter((d) => d !== "0");
  const counts = new Map<number, number>();
  for (const d of digits) {
    counts.set(Number(d), (counts.get(Number(d)) ?? 0) + 1);
  }
  const grid = LO_SHU_POSITIONS.map((n) => ({
    number: n,
    digits: Array.from({ length: counts.get(n) ?? 0 }, () => String(n)),
    count: counts.get(n) ?? 0,
  }));
  const missing = LO_SHU_POSITIONS.filter((n) => (counts.get(n) ?? 0) === 0).sort((a, b) => a - b);
  const repeated = LO_SHU_POSITIONS.filter((n) => (counts.get(n) ?? 0) > 1).sort((a, b) => a - b);
  const lines = LO_SHU_LINES.map((l) => ({
    name: l.name,
    numbers: l.numbers,
    kind: l.kind,
    complete: l.numbers.every((n) => (counts.get(n) ?? 0) > 0),
  }));
  return { grid, missing, repeated, lines };
}

// ---------------------------------------------------------------------------
// Jaimini karakas (Tier 2: Atmakaraka/Darakaraka/Ishta Devata base).
// Classical 7-karaka scheme over Sun..Saturn ranked by degree-within-sign
// (desc): Atma, Amatya, Bhratri, Matri, Putra, Gnati, Dara(=Darakaraka).
// ---------------------------------------------------------------------------

const KARAKA_PLANETS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"] as const;
const KARAKA_NAMES = [
  "Atmakaraka",
  "Amatyakaraka",
  "Bhratrikaraka",
  "Matrikaraka",
  "Putrakaraka",
  "Gnatikaraka",
  "Darakaraka",
] as const;

export interface Karaka {
  karaka: (typeof KARAKA_NAMES)[number];
  planet: string;
  sign: string;
  degree_in_sign: number;
  navamsha_sign: string;
  is_atmakaraka: boolean;
}

export function jaiminiKarakas(positions: PlanetPosition[]): Karaka[] {
  const ranked = positions
    .filter((p) => (KARAKA_PLANETS as readonly string[]).includes(p.planet))
    .map((p) => ({ p, deg: ((p.lon % 30) + 30) % 30 }))
    .sort((a, b) => b.deg - a.deg);
  return ranked.map((r, i) => {
    const nav = navamshaSignIndex(r.p.lon);
    return {
      karaka: KARAKA_NAMES[i] ?? "Darakaraka",
      planet: r.p.planet,
      sign: r.p.sign,
      degree_in_sign: Math.round(r.deg * 100) / 100,
      navamsha_sign: SIGNS[nav] ?? "Aries",
      is_atmakaraka: i === 0,
    };
  });
}

/** Scheme disclosure (Epic 14 QB-14): this engine ranks the classical seven
 *  (Sun…Saturn); the 8-karaka extension adds Rahu. Surfaced so UI/API can
 *  state which scheme is in use. */
export const KARAKA_SCHEME =
  "7-karaka classical scheme (Sun…Saturn ranked by in-sign degree); the 8-karaka extension adds Rahu and is not applied here";

/** Ishta Devata — classical Jaimini method (Epic 14 D-QB08; research/
 *  ishta-devata.md §3): the highest-degree occupant of the 12th sign from the
 *  Karakamsha (AK's navamsha sign) in D9, else that sign's lord; the planet
 *  then maps to a deity. Stable core mappings are used outright; disputed
 *  rows (Mars/Saturn/Rahu — schools disagree) are flagged with alternates.
 *  The deity answer is real but the TABLE still awaits Jyotishi sign-off
 *  (P11), so verified:false is kept. */
const SIGN_LORDS = [
  "Mars", // Aries
  "Venus", // Taurus
  "Mercury", // Gemini
  "Moon", // Cancer
  "Sun", // Leo
  "Mercury", // Virgo
  "Venus", // Libra
  "Mars", // Scorpio (co-lord Ketu — noted in the derivation)
  "Jupiter", // Sagittarius
  "Saturn", // Capricorn
  "Saturn", // Aquarius (co-lord Rahu — noted in the derivation)
  "Jupiter", // Pisces
];

const DEITY_TABLE: Record<string, { deity: string; disputed: boolean; alternates: string[] }> = {
  Sun: { deity: "Shiva", disputed: false, alternates: ["Sri Rama"] },
  Moon: {
    deity: "Devi (Gauri)",
    disputed: false,
    alternates: ["Lalita", "Saraswati", "Sri Krishna"],
  },
  Mars: { deity: "Hanuman", disputed: true, alternates: ["Kartikeya", "Narasimha", "Rudra"] },
  Mercury: { deity: "Vishnu", disputed: false, alternates: ["Narayana"] },
  Jupiter: { deity: "Vishnu", disputed: false, alternates: ["Hayagriva", "Dattatreya"] },
  Venus: { deity: "Lakshmi", disputed: false, alternates: ["Parvati"] },
  Saturn: { deity: "Vishnu", disputed: true, alternates: ["Brahma", "Mahakala/Bhairava"] },
  Rahu: { deity: "Durga", disputed: true, alternates: ["Narasimha", "Kali"] },
  Ketu: { deity: "Ganesha", disputed: false, alternates: [] },
};

export function ishtaDevata(positions: PlanetPosition[]): {
  atmakaraka: Karaka;
  navamsha_sign: string;
  karakamsha_sign: string;
  jivanmukta_sign: string;
  indicating_planet: string;
  derivation_source: string;
  ishta_devata: string;
  alternates: string[];
  disputed: boolean;
  note: string;
  verified: false;
} {
  const all = jaiminiKarakas(positions);
  const ak = all.find((k) => k.karaka === "Atmakaraka") ?? all[0];
  if (!ak) throw new Error("karakas_unavailable");
  const karakamshaIdx = SIGNS.indexOf(ak.navamsha_sign as (typeof SIGNS)[number]);
  const jivanmuktaIdx = (karakamshaIdx + 11) % 12;
  const jivanmuktaSign = SIGNS[jivanmuktaIdx] ?? "Aries";

  // Occupants of the 12th-from-Karakamsha in D9 (all nine grahas count);
  // highest in-sign degree wins when several occupy (deterministic).
  const occupants = positions
    .map((p) => ({
      planet: p.planet,
      navIdx: navamshaSignIndex(((p.lon % 360) + 360) % 360),
      deg: ((p.lon % 30) + 30) % 30,
    }))
    .filter((x) => x.navIdx === jivanmuktaIdx)
    .sort((a, b) => b.deg - a.deg);

  let indicating: string;
  let source: string;
  if (occupants.length > 0) {
    indicating = occupants[0]!.planet;
    source = "highest-degree occupant of the 12th from Karakamsha (D9)";
  } else {
    indicating = SIGN_LORDS[jivanmuktaIdx] ?? "Mars";
    source = `lord of the 12th from Karakamsha (${jivanmuktaSign} is empty in D9)${
      jivanmuktaIdx === 7 ? "; some lineages use the co-lord Ketu (→ Ganesha)" : ""
    }${jivanmuktaIdx === 10 ? "; some lineages use the co-lord Rahu" : ""}`;
  }
  const entry = DEITY_TABLE[indicating] ?? { deity: "Ganesha", disputed: false, alternates: [] };
  return {
    atmakaraka: ak,
    navamsha_sign: ak.navamsha_sign,
    karakamsha_sign: ak.navamsha_sign,
    jivanmukta_sign: jivanmuktaSign,
    indicating_planet: indicating,
    derivation_source: source,
    ishta_devata: entry.deity,
    alternates: entry.alternates,
    disputed: entry.disputed,
    note: "Ishta Devata via the classical 12th-from-Karakamsha method (BPHS Karakamsa Phala; Jaimini Upadesa Sutras 1.2.72–79). Deity table differs between schools — disputed rows carry alternates; pending Jyotishi review (P11).",
    verified: false,
  };
}

// ---------------------------------------------------------------------------
// Kaal Sarp Yoga (Tier 1): all seven grahas (Sun..Saturn + Moon) hemmed
// within one Rahu–Ketu axis. Type named by Rahu's house from the Lagna.
// ---------------------------------------------------------------------------

const KAAL_SARP_TYPES = [
  "Anant",
  "Kulit",
  "Vasuki",
  "Shankhpal",
  "Padma",
  "Mahapadma",
  "Takshak",
  "Karkotak",
  "Shankhchud",
  "Ghaatak",
  "Vishdhar",
  "Sheshnag",
] as const;

export function kaalSarp(
  positions: PlanetPosition[],
  lagnaLon: number,
): {
  present: boolean;
  axis: "rahu_to_ketu" | "ketu_to_rahu" | null;
  rahu_house: number;
  type: string | null;
  planets: Array<{
    planet: string;
    sign: string;
    degree_in_sign: number;
    house: number;
    side: "rahu_to_ketu" | "ketu_to_rahu";
  }>;
  note: string;
  verified: false;
} {
  const rahu = positions.find((p) => p.planet === "Rahu");
  if (!rahu) throw new Error("rahu_position_unavailable");
  const rahuLon = ((rahu.lon % 360) + 360) % 360;
  const lagnaSign = Math.floor((((lagnaLon % 360) + 360) % 360) / 30);
  const rahuSign = Math.floor(rahuLon / 30);
  const rahuHouse = ((rahuSign - lagnaSign + 12) % 12) + 1;
  const moving = positions.filter((p) => !["Rahu", "Ketu"].includes(p.planet));
  let inRahuToKetu = 0;
  const planetRows: Array<{
    planet: string;
    sign: string;
    degree_in_sign: number;
    house: number;
    side: "rahu_to_ketu" | "ketu_to_rahu";
  }> = [];
  for (const p of moving) {
    const rel = (((p.lon - rahuLon) % 360) + 360) % 360;
    const side = rel < 180 ? "rahu_to_ketu" : "ketu_to_rahu";
    if (rel < 180) inRahuToKetu++;
    const signIdx = Math.floor((((p.lon % 360) + 360) % 360) / 30);
    planetRows.push({
      planet: p.planet,
      sign: p.sign,
      degree_in_sign: Math.round((((p.lon % 30) + 30) % 30) * 100) / 100,
      house: ((signIdx - lagnaSign + 12) % 12) + 1,
      side,
    });
  }
  const present = inRahuToKetu === 0 || inRahuToKetu === moving.length;
  return {
    present,
    axis: present ? (inRahuToKetu === moving.length ? "rahu_to_ketu" : "ketu_to_rahu") : null,
    rahu_house: rahuHouse,
    type: present ? (KAAL_SARP_TYPES[rahuHouse - 1] ?? null) : null,
    planets: planetRows,
    note: "All seven grahas hemmed within one Rahu–Ketu axis; type named by Rahu's house from the Lagna. The planet table shows each graha's side of the axis so a partial pattern is visible without being asserted as yoga. Partial Kaal Sarp is not asserted. Pending Jyotishi review (P11).",
    verified: false,
  };
}

// ---------------------------------------------------------------------------
// Fun calculators (Tier 2, labelled "for fun" in the UI) — deterministic
// name/date games with no astrological claim.
// ---------------------------------------------------------------------------

function lettersOf(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .split("");
}

/** Classic FLAMES by letter cancellation.
 *  Fixed (Epic 14 QF-02/03): count the surviving letters from the SPLICED copy
 *  of b (the old code re-subtracted the removal count from the mutated length);
 *  zero remaining letters resolves to "Friends" (our documented n=0 convention). */
export function flames(
  a: string,
  b: string,
): {
  result: string;
  letters_removed: number;
  remaining_letters: number;
  rounds: string[];
} {
  const la = lettersOf(a);
  const lb = lettersOf(b);
  let removed = 0;
  for (const ch of la) {
    const idx = lb.indexOf(ch);
    if (idx >= 0) {
      lb.splice(idx, 1);
      removed++;
    }
  }
  // la minus its matched letters + the survivors of lb (already spliced above)
  const remaining = la.length - removed + lb.length;
  const sequence = ["Friends", "Love", "Affection", "Marriage", "Enemy", "Sibling"];
  const rounds: string[] = [];
  const arr = [...sequence];
  if (remaining === 0) {
    // QF-03 convention: identical/subset names keep the friendship letter.
    return { result: "Friends", letters_removed: removed, remaining_letters: 0, rounds };
  }
  let idx = 0;
  while (arr.length > 1) {
    idx = (idx + remaining - 1) % arr.length;
    rounds.push(String(arr[idx]));
    arr.splice(idx, 1);
  }
  return {
    result: arr[0] ?? "Friends",
    letters_removed: removed,
    remaining_letters: remaining,
    rounds,
  };
}

// ---------------------------------------------------------------------------
// Love / friendship percentage — the documented schoolyard keyword games
// (Epic 14 D-QF10; research/love-compatibility.md §3.1, friendship §3.1).
// Counts of the keyword letters, then adjacent-pair folding to 2 digits.
// Fully deterministic, with every fold step returned for show-your-work UI.
// ---------------------------------------------------------------------------

const LOVE_KEYWORD = "LOVES";
const FRIEND_KEYWORD = "FRIEND";

const LOVE_BANDS: Array<{ max: number; band: string }> = [
  { max: 24, band: "Just pals (in this game)" },
  { max: 49, band: "Getting along" },
  { max: 74, band: "Strong spark" },
  { max: 99, band: "Game-approved match" },
];
const FRIEND_BANDS: Array<{ max: number; band: string }> = [
  { max: 24, band: "Acquaintances (in this game)" },
  { max: 49, band: "Good company" },
  { max: 74, band: "Solid squad" },
  { max: 99, band: "Best-friend material" },
];

function bandFor(score: number, bands: Array<{ max: number; band: string }>): string {
  return bands.find((b) => score <= b.max)?.band ?? bands[bands.length - 1]!.band;
}

/** One keyword game: counts → fold rows → 0–99 score. Shared by love/friend. */
function keywordGame(
  a: string,
  b: string,
  keyword: string,
): {
  score: number;
  counts: Array<{ letter: string; count: number }>;
  folds: number[];
  steps: string[];
} {
  const combined = (a + b).toUpperCase().replace(/[^A-Z]/g, "");
  const counts = keyword.split("").map((letter) => ({
    letter,
    count: combined.split(letter).length - 1,
  }));
  // One digit per keyword letter; counts ≥ 10 collapse to their digital root
  // (documented convention, keeps the fold rows single-digit).
  let row: number[] = counts.map((c) => (c.count > 9 ? digitalRoot(c.count) : c.count));
  const folds: number[] = [Number(row.join(""))];
  const steps: string[] = [
    `${keyword
      .split("")
      .map((l, i) => `${l}${row[i]}`)
      .join(" ")}`,
  ];
  while (row.length > 2) {
    const next: number[] = [];
    for (let i = 0; i < row.length - 1; i++) {
      const sum = row[i]! + row[i + 1]!;
      // two-digit sums split into separate digits (documented fold rule)
      if (sum > 9) next.push(Math.floor(sum / 10), sum % 10);
      else next.push(sum);
    }
    row = next;
    folds.push(Number(row.join("")));
    steps.push(row.join(" "));
  }
  const score = Math.min(99, 10 * (row[0] ?? 0) + (row[1] ?? 0));
  return { score, counts, folds, steps };
}

export function loveCompatibility(
  a: string,
  b: string,
): {
  score: number;
  band: string;
  counts: Array<{ letter: string; count: number }>;
  steps: string[];
  note: string;
} {
  const g = keywordGame(a, b, LOVE_KEYWORD);
  return {
    score: g.score,
    band: bandFor(g.score, LOVE_BANDS),
    counts: g.counts,
    steps: g.steps,
    note: "The LOVES keyword game played on your names — for laughs, not life decisions.",
  };
}

export function friendshipCompatibility(
  a: string,
  b: string,
): {
  score: number;
  band: string;
  counts: Array<{ letter: string; count: number }>;
  steps: string[];
  note: string;
} {
  const g = keywordGame(a, b, FRIEND_KEYWORD);
  return {
    score: g.score,
    band: bandFor(g.score, FRIEND_BANDS),
    counts: g.counts,
    steps: g.steps,
    note: "The FRIEND keyword game played on your names — real friendship isn't a percentage.",
  };
}

// ---------------------------------------------------------------------------
// Numerology suite (Tier 2)
// ---------------------------------------------------------------------------

/** Number → classical planetary lord (1 Sun … 9 Mars). */
const NUMBER_LORDS = [
  "Sun",
  "Moon",
  "Jupiter",
  "Rahu",
  "Mercury",
  "Venus",
  "Ketu",
  "Saturn",
  "Mars",
] as const;

/** Consensus friend/neutral/enemy matrix (research/vedic-numerology.md §3.5,
 *  the stable core across sources). Epic 14 QN-02 replaces the planet-level
 *  friendship heuristic with this number-level table. */
const NUMBER_MATRIX: Record<number, { friends: number[]; neutral: number[]; enemies: number[] }> = {
  1: { friends: [2, 3, 5, 9], neutral: [4, 7], enemies: [6, 8] },
  2: { friends: [1, 3, 5], neutral: [6, 7, 9], enemies: [4, 8] },
  3: { friends: [1, 2, 9], neutral: [4, 7, 8], enemies: [5, 6] },
  4: { friends: [5, 6, 8], neutral: [3], enemies: [1, 2, 9] },
  5: { friends: [1, 2, 3, 4, 6], neutral: [7, 8, 9], enemies: [] },
  6: { friends: [4, 5, 8], neutral: [2, 9], enemies: [1, 3] },
  7: { friends: [4, 5, 6], neutral: [2, 3, 8, 9], enemies: [] },
  8: { friends: [4, 5, 6], neutral: [3], enemies: [1, 2, 9] },
  9: { friends: [1, 3, 5], neutral: [4, 6, 7], enemies: [8] },
};

function matrixFriends(n: number): number[] {
  return NUMBER_MATRIX[n]?.friends ?? [];
}
function matrixEnemies(n: number): number[] {
  return NUMBER_MATRIX[n]?.enemies ?? [];
}

export function vehicleLuckyNumber(dateISO: string): {
  mulank: number;
  lord: string;
  friendly_numbers: number[];
  neutral_numbers: number[];
  enemy_numbers: number[];
  note: string;
} {
  const day = Number(dateISO.slice(8, 10));
  const mulank = digitalRoot(day);
  const row = NUMBER_MATRIX[mulank] ?? NUMBER_MATRIX[1]!;
  return {
    mulank,
    lord: NUMBER_LORDS[mulank - 1] ?? "Sun",
    friendly_numbers: row.friends,
    neutral_numbers: row.neutral,
    enemy_numbers: row.enemies,
    note: "Friendly/neutral/enemy plate numbers from the consensus number-lord matrix for your birth-day number. Pending Jyotishi review (P11).",
  };
}

// ---------------------------------------------------------------------------
// Vehicle plate analyser (Epic 14 D-QN03; research/lucky-vehicle-number.md §3).
// School A: digits of the registration's unique number portion. School B:
// Chaldean letter values + all digits. Verdict compares the plate root with
// the owner's mulank AND bhagyank via the consensus matrix (both friendly →
// lucky; any enemy → not suggested; else mixed/neutral).
// ---------------------------------------------------------------------------

export interface PlateAnalysis {
  plate: string;
  state_code: string | null;
  rto_code: string | null;
  series_letters: string | null;
  number_portion: string | null;
  /** Owner's mulank + bhagyank from the birth date (both schools compare to these). */
  owner: { mulank: number; bhagyank: number } | null;
  school_a: { value: number; root: number; label: string } | null;
  school_b: { value: number; root: number; label: string } | null;
  verdict: string;
  verdict_reasons: string[];
  digit_clash_warnings: string[];
}

function chaldeanLetterSum(text: string): number {
  let sum = 0;
  for (const ch of text.toUpperCase()) {
    if (ch >= "A" && ch <= "Z") sum += CHALDEAN[ch] ?? 0;
  }
  return sum;
}

function digitSum(text: string): number {
  let sum = 0;
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") sum += Number(ch);
  }
  return sum;
}

export function vehiclePlateAnalyser(plate: string, dateISO: string): PlateAnalysis {
  const compact = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Indian plates: <state 2 letters><RTO 1-2 digits><series letters><number digits>
  const m = /^([A-Z]{2})(\d{1,2})?([A-Z]{0,3})(\d{1,6})$/.exec(compact);
  const stateCode = m?.[1] ?? null;
  const rtoCode = m?.[2] ?? null;
  const series = m?.[3] || null;
  const numberPortion = m?.[4] ?? null;

  // School A — digits of the unique number portion only (fall back to all digits).
  const aDigits = numberPortion ?? compact.replace(/[A-Z]/g, "");
  const aValue = digitSum(aDigits);
  // School B — Chaldean letters + every digit on the plate.
  const bValue = chaldeanLetterSum(compact) + digitSum(compact);

  const day = Number(dateISO.slice(8, 10));
  const mulank = digitalRoot(day);
  const bhagyank = digitalRoot(digitSum(dateISO));
  const owner = NUMBER_MATRIX[mulank] ?? NUMBER_MATRIX[1]!;
  const bhagyankRow = NUMBER_MATRIX[bhagyank] ?? NUMBER_MATRIX[1]!;

  const relation = (n: number, row: { friends: number[]; neutral: number[]; enemies: number[] }) =>
    row.friends.includes(n) ? "friendly" : row.enemies.includes(n) ? "enemy" : "neutral";

  const analyse = (root: number, label: string) => {
    const relMulank = relation(root, owner);
    const relBhagyank = relation(root, bhagyankRow);
    const reasons = [
      `${label} root ${root} is ${relMulank} for mulank ${mulank}`,
      `${label} root ${root} is ${relBhagyank} for bhagyank ${bhagyank}`,
    ];
    let verdict: string;
    if (relMulank === "enemy" || relBhagyank === "enemy") verdict = "Not suggested";
    else if (relMulank === "friendly" && relBhagyank === "friendly") verdict = "Lucky";
    else if (relMulank === "friendly" || relBhagyank === "friendly") verdict = "Mixed";
    else verdict = "Neutral";
    return { verdict, reasons };
  };

  const aRoot = digitalRoot(aValue);
  const bRoot = digitalRoot(bValue);

  // Unparseable plate: no verdict arithmetic on a plate that doesn't match the
  // standard Indian format — report the failure honestly instead.
  if (!m) {
    return {
      plate,
      state_code: null,
      rto_code: null,
      series_letters: null,
      number_portion: null,
      owner: { mulank, bhagyank },
      school_a: null,
      school_b: null,
      verdict: "Unparseable",
      verdict_reasons: [
        "Plate does not match the standard Indian format (e.g. DL 8C AF 1234) — enter <state 2 letters><RTO digits><series letters><number>",
      ],
      digit_clash_warnings: [],
    };
  }

  const aVerdict = analyse(aRoot, "School A");
  const bVerdict = analyse(bRoot, "School B");

  // Digit-clash warnings (Nehaa school, §3.3): individual digits that are
  // enemies of the owner's mulank/bhagyank, plus harmful doubled pairs.
  const warnings: string[] = [];
  for (const d of aDigits) {
    const n = Number(d);
    if (n > 0 && (owner.enemies.includes(n) || bhagyankRow.enemies.includes(n))) {
      warnings.push(`Digit ${d} clashes with your numbers`);
    }
  }
  if (/(\d)\1/.exec(aDigits))
    warnings.push("Doubled pair on the plate (e.g. 66) — flagged harmful by some schools");

  const verdict =
    aVerdict.verdict === "Lucky" && bVerdict.verdict === "Lucky"
      ? "Lucky"
      : aVerdict.verdict === "Not suggested" || bVerdict.verdict === "Not suggested"
        ? "Not suggested"
        : aVerdict.verdict === "Mixed" || bVerdict.verdict === "Mixed"
          ? "Mixed"
          : "Neutral";
  const verdictReasons = [...aVerdict.reasons, ...bVerdict.reasons];
  if (aVerdict.verdict !== bVerdict.verdict) {
    verdictReasons.push("Schools disagree — shown separately below; schools differ by tradition");
  }

  return {
    plate,
    state_code: stateCode,
    rto_code: rtoCode,
    series_letters: series,
    number_portion: numberPortion,
    owner: { mulank, bhagyank },
    school_a: {
      value: aValue,
      root: aRoot,
      label: `digits of ${numberPortion ?? "the plate"} → ${aValue} → ${aRoot}`,
    },
    school_b: {
      value: bValue,
      root: bRoot,
      label: `Chaldean letters + digits → ${bValue} → ${bRoot}`,
    },
    verdict,
    verdict_reasons: verdictReasons,
    digit_clash_warnings: warnings,
  };
}

/** Mobile numerology — strips the common Indian prefixes (+91 / 91 / leading
 *  0) BEFORE summing when what remains is a 10-digit number starting 6–9
 *  (Epic 14 QN-01: "+91 98765 43210" used to sum to 55/1 instead of 45/9).
 *  Anything else is summed raw; callers validate length. */
export function mobileNumerology(digits: string): {
  raw: string;
  digits_clean: string;
  prefix_stripped: string | null;
  sum: number;
  root: number;
  lord: string;
  length_warning: string | null;
  note: string;
} {
  const compact = digits.replace(/[^\d+]/g, "");
  let clean = compact.replace(/\D/g, "");
  let stripped: string | null = null;
  if (/^\+91\d{10}$/.test(compact) || /^91\d{10}$/.test(compact) || /^0\d{10}$/.test(compact)) {
    stripped = compact.slice(compact.length - 10);
    clean = stripped;
  }
  const sum = clean.split("").reduce((a, c) => a + Number(c), 0);
  const root = digitalRoot(sum);
  return {
    raw: digits,
    digits_clean: clean,
    prefix_stripped: stripped,
    sum,
    root,
    lord: NUMBER_LORDS[root - 1] ?? "Sun",
    length_warning:
      clean.length === 10
        ? null
        : `The number has ${clean.length} digits — readings are calibrated for 10-digit mobiles.`,
    note: "Chaldean digit-sum of the mobile number with its planetary lord. For entertainment; no service-quality claim.",
  };
}

export function nameNumerology(name: string): {
  sum: number;
  root: number;
  lord: string;
  letters: Array<{ letter: string; value: number }>;
  words: Array<{ word: string; sum: number; root: number }>;
  note: string;
} {
  const upper = name.toUpperCase();
  const letters: Array<{ letter: string; value: number }> = [];
  let sum = 0;
  for (const ch of upper) {
    const v = CHALDEAN[ch];
    if (v !== undefined) {
      letters.push({ letter: ch, value: v });
      sum += v;
    }
  }
  // Per-word subtotals (Epic 14 QN-10): words carry their own reading line.
  const words = upper
    .split(/[^A-Z]+/)
    .filter((w) => w.length > 0)
    .map((w) => {
      const wSum = w.split("").reduce((a, ch) => a + (CHALDEAN[ch] ?? 0), 0);
      return { word: w, sum: wSum, root: digitalRoot(wSum) };
    });
  return {
    sum,
    root: digitalRoot(sum),
    lord: NUMBER_LORDS[digitalRoot(sum) - 1] ?? "Sun",
    letters,
    words,
    note: "Chaldean name numerology (traditional Vedic numerology uses Chaldean values).",
  };
}

/** Name compatibility (Tier 2) — combined Chaldean roots + traditional
 *  planet-lord band (Epic 14 D-QF10: bands come from the consensus
 *  friend/enemy matrix, not an invented scale). */
export function nameCompatibility(
  a: string,
  b: string,
): {
  a_root: number;
  b_root: number;
  combined_root: number;
  band: string;
  note: string;
} {
  const ra = nameNumber(a).root;
  const rb = nameNumber(b).root;
  const combined = digitalRoot(ra + rb);
  let band: string;
  if (ra === rb) band = "Same vibration";
  else if (matrixFriends(ra).includes(rb) && matrixFriends(rb).includes(ra)) band = "Harmonious";
  else if (matrixEnemies(ra).includes(rb) || matrixEnemies(rb).includes(ra)) band = "Challenging";
  else band = "Neutral";
  return {
    a_root: ra,
    b_root: rb,
    combined_root: combined,
    band,
    note: "Chaldean name compatibility banded via the traditional number-lord friendship matrix (consensus table). Not a relationship verdict.",
  };
}

/** Age calculator (Tier 2) — exact calendar years/months/days plus the
 *  detail block (Epic 14 QF-15). Fixed (QF-06 latent): the previous-month
 *  length used LOCAL Date construction — on non-UTC hosts it returned the
 *  wrong day count; now pure UTC. */
export function ageOn(
  birthISO: string,
  nowISO: string,
): {
  years: number;
  months: number;
  days: number;
  total_days: number;
  total_weeks: number;
  total_hours: number;
  day_of_week: string;
  next_birthday: { date: string; days_until: number; weekday: string };
} {
  const birth = new Date(`${birthISO}T00:00:00Z`);
  const now = new Date(`${nowISO}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(now.getTime())) {
    throw new Error("invalid_date");
  }
  let y = now.getUTCFullYear() - birth.getUTCFullYear();
  let m = now.getUTCMonth() - birth.getUTCMonth();
  let d = now.getUTCDate() - birth.getUTCDate();
  if (d < 0) {
    m--;
    // UTC-only arithmetic: day 0 of the current month = last day of the prior month
    const prevMonthDays = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
    ).getUTCDate();
    d += prevMonthDays;
  }
  if (m < 0) {
    y--;
    m += 12;
  }
  // Next birthday: the first occurrence of birth month/day strictly after now.
  let nbYear = now.getUTCFullYear();
  const nb = new Date(Date.UTC(nbYear, birth.getUTCMonth(), birth.getUTCDate()));
  if (nb.getTime() <= now.getTime()) nb.setUTCFullYear(++nbYear);
  // Feb-29 birthdays: Mar-1 anchor on non-leap years (Date.UTC normalises 29→Mar 1).
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const daysUntil = Math.round((nb.getTime() - now.getTime()) / 86400000);
  return {
    years: y,
    months: m,
    days: d,
    total_days: Math.floor((now.getTime() - birth.getTime()) / 86400000),
    total_weeks: Math.floor((now.getTime() - birth.getTime()) / (86400000 * 7)),
    total_hours: Math.floor((now.getTime() - birth.getTime()) / 3600000),
    day_of_week: WEEKDAYS[birth.getUTCDay()] ?? "—",
    next_birthday: {
      date: nb.toISOString().slice(0, 10),
      days_until: daysUntil,
      weekday: WEEKDAYS[nb.getUTCDay()] ?? "—",
    },
  };
}
