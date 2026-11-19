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

export function loShuGrid(dateISO: string): {
  grid: Array<{ number: number; digits: string[]; count: number }>;
  missing: number[];
  repeated: number[];
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
  const missing = LO_SHU_POSITIONS.filter((n) => (counts.get(n) ?? 0) === 0);
  const repeated = LO_SHU_POSITIONS.filter((n) => (counts.get(n) ?? 0) > 1);
  return { grid, missing, repeated };
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
    };
  });
}

/** Ishta Devata = deity of the Atmakaraka's navamsha sign. The classical
 * deity tables differ between schools — Phase 1 returns the computed
 * Atmakaraka + navamsha sign and defers the deity mapping to the Jyotishi
 * review (P11). */
export function ishtaDevata(positions: PlanetPosition[]): {
  atmakaraka: Karaka;
  navamsha_sign: string;
  ishta_devata: string | null;
  note: string;
} {
  const all = jaiminiKarakas(positions);
  const ak = all.find((k) => k.karaka === "Atmakaraka") ?? all[0];
  if (!ak) throw new Error("karakas_unavailable");
  return {
    atmakaraka: ak,
    navamsha_sign: ak.navamsha_sign,
    ishta_devata: null,
    note: "Ishta Devata = deity of the Atmakaraka's navamsha sign; the sign-to-deity table differs between classical schools and is pending Jyotishi verification (P11).",
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
  note: string;
  verified: false;
} {
  const rahu = positions.find((p) => p.planet === "Rahu");
  if (!rahu) throw new Error("rahu_position_unavailable");
  const rahuLon = ((rahu.lon % 360) + 360) % 360;
  const moving = positions.filter((p) => !["Rahu", "Ketu"].includes(p.planet));
  let inRahuToKetu = 0;
  for (const p of moving) {
    const rel = (((p.lon - rahuLon) % 360) + 360) % 360;
    if (rel < 180) inRahuToKetu++;
  }
  const present = inRahuToKetu === 0 || inRahuToKetu === moving.length;
  const lagnaSign = Math.floor((((lagnaLon % 360) + 360) % 360) / 30);
  const rahuSign = Math.floor(rahuLon / 30);
  const rahuHouse = ((rahuSign - lagnaSign + 12) % 12) + 1;
  return {
    present,
    axis: present ? (inRahuToKetu === moving.length ? "rahu_to_ketu" : "ketu_to_rahu") : null,
    rahu_house: rahuHouse,
    type: present ? (KAAL_SARP_TYPES[rahuHouse - 1] ?? null) : null,
    note: "All seven grahas hemmed within one Rahu–Ketu axis; type named by Rahu's house from the Lagna. Partial Kaal Sarp is not asserted. Pending Jyotishi review (P11).",
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

/** Classic FLAMES by letter cancellation. */
export function flames(a: string, b: string): { result: string; letters_removed: number } {
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
  const remaining = la.length - removed + (lb.length - removed);
  const sequence = ["Friends", "Love", "Affection", "Marriage", "Enemy", "Sibling"];
  let idx = 0;
  const arr = [...sequence];
  let n = remaining === 0 ? 6 : remaining;
  while (arr.length > 1) {
    idx = (idx + n - 1) % arr.length;
    arr.splice(idx, 1);
  }
  return { result: arr[0] ?? "Friends", letters_removed: removed };
}

const FUN_BANDS = ["Warm", "Bright", "Harmonious", "Playful", "Steady"] as const;

function namePairScore(a: string, b: string): number {
  const na = nameNumber(a);
  const nb = nameNumber(b);
  const combined = digitalRoot(na.root + nb.root);
  // Deterministic 55–95 band: combined root × 5 + 50, capped 55–95.
  return Math.min(95, Math.max(55, 40 + combined * 5));
}

export function loveCompatibility(
  a: string,
  b: string,
): { score: number; band: string; note: string } {
  const score = namePairScore(a, b);
  const band = FUN_BANDS[score % FUN_BANDS.length] ?? "Harmonious";
  return {
    score,
    band,
    note: "Name-numerology game for fun — not an astrological or relational verdict.",
  };
}

export function friendshipCompatibility(
  a: string,
  b: string,
): { score: number; band: string; note: string } {
  const score = namePairScore(b, a); // reversed mix keeps it distinct from love
  const band = FUN_BANDS[(score + 2) % FUN_BANDS.length] ?? "Playful";
  return {
    score,
    band,
    note: "Name-numerology game for fun — not an astrological or social verdict.",
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
/** Planetary friendship used for lucky-number advice (Rahu→Saturn-side, Ketu→Mars-side). */
const NUMBER_FRIENDS: Record<string, string[]> = {
  Sun: ["Sun", "Moon", "Jupiter", "Mars"],
  Moon: ["Sun", "Moon", "Mercury"],
  Jupiter: ["Sun", "Moon", "Mars"],
  Rahu: ["Venus", "Saturn", "Mercury"], // treated as Saturn-side (common convention)
  Mercury: ["Sun", "Mercury", "Venus"],
  Venus: ["Mercury", "Venus", "Saturn"],
  Ketu: ["Mars", "Jupiter"], // treated as Mars-side (common convention)
  Saturn: ["Mercury", "Venus"],
  Mars: ["Sun", "Moon", "Jupiter"],
};

export function vehicleLuckyNumber(dateISO: string): {
  mulank: number;
  lord: string;
  friendly_numbers: number[];
  neutral_numbers: number[];
  note: string;
} {
  const day = Number(dateISO.slice(8, 10));
  const mulank = digitalRoot(day);
  const lord = NUMBER_LORDS[mulank - 1] ?? "Sun";
  const friends = new Set(NUMBER_FRIENDS[lord] ?? []);
  const friendly: number[] = [];
  const neutral: number[] = [];
  for (let n = 1; n <= 9; n++) {
    if ((NUMBER_FRIENDS[NUMBER_LORDS[n - 1] ?? "Sun"] ?? []).some((l) => friends.has(l))) {
      friendly.push(n);
    } else {
      neutral.push(n);
    }
  }
  return {
    mulank,
    lord,
    friendly_numbers: friendly,
    neutral_numbers: neutral,
    note: "Lucky vehicle numbers via the birth-day number's planetary lord friendships (common convention; Rahu/Ketu mapped to Saturn/Mars sides). Pending Jyotishi review (P11).",
  };
}

export function mobileNumerology(digits: string): {
  sum: number;
  root: number;
  lord: string;
  note: string;
} {
  const clean = digits.replace(/\D/g, "");
  const sum = clean.split("").reduce((a, c) => a + Number(c), 0);
  const root = digitalRoot(sum);
  return {
    sum,
    root,
    lord: NUMBER_LORDS[root - 1] ?? "Sun",
    note: "Chaldean digit-sum of the mobile number with its planetary lord. For entertainment; no service-quality claim.",
  };
}

export function nameNumerology(name: string): {
  sum: number;
  root: number;
  lord: string;
  letters: number[];
  note: string;
} {
  const nn = nameNumber(name);
  return {
    sum: nn.sum,
    root: nn.root,
    lord: NUMBER_LORDS[nn.root - 1] ?? "Sun",
    letters: nn.letters,
    note: "Chaldean name numerology (traditional Vedic numerology uses Chaldean values).",
  };
}

/** Name compatibility (Tier 2) — combined Chaldean roots + harmony band. */
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
  const band = FUN_BANDS[combined % FUN_BANDS.length] ?? "Harmonious";
  return {
    a_root: ra,
    b_root: rb,
    combined_root: combined,
    band,
    note: "Chaldean name-compatibility game for fun — not a relationship verdict.",
  };
}

/** Age calculator (Tier 2) — exact calendar years/months/days. */
export function ageOn(
  birthISO: string,
  nowISO: string,
): {
  years: number;
  months: number;
  days: number;
  total_days: number;
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
    const prevMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 0);
    d += prevMonth.getUTCDate();
  }
  if (m < 0) {
    y--;
    m += 12;
  }
  return {
    years: y,
    months: m,
    days: d,
    total_days: Math.floor((now.getTime() - birth.getTime()) / 86400000),
  };
}
