/**
 * Calculator primitives (Epic 1.5) — Tier 1 tools per PRD §5.7.
 * Thin, deterministic wrappers over the engine core.
 */
import * as Astronomy from "astronomy-engine";
import { elongation, moonSiderealLon, sunSiderealLon, sunTropicalLon } from "./bodies";
import { nakshatraOf, signOf } from "./kundli";
import { RASHI_LORDS } from "./matching";

const SIGNS_TROPICAL = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
];

/** 8 classical phase names from tropical elongation — half-open buckets [start,end). */
export function phaseNameFromElong(elong: number): string {
  if (elong < 22.5 || elong >= 337.5) return "New Moon";
  if (elong < 67.5) return "Waxing Crescent";
  if (elong < 112.5) return "First Quarter";
  if (elong < 157.5) return "Waxing Gibbous";
  if (elong < 202.5) return "Full Moon";
  if (elong < 247.5) return "Waning Gibbous";
  if (elong < 292.5) return "Last Quarter";
  return "Waning Crescent";
}

/** Moon phase name for a date (8 classical phases + illumination fraction). */
export function moonPhaseName(date: Date): { phase: string; illumination: number } {
  const illum = Astronomy.Illumination(
    Astronomy.Body.Moon,
    Astronomy.MakeTime(date),
  ).phase_fraction;
  // Elongation must be TROPICAL moon−sun — mixing frames leaks the ayanamsha
  // into the phase bin (caught by the new/full-moon instant tests).
  return {
    phase: phaseNameFromElong(elongation(date)),
    illumination: Math.round(illum * 100) / 100,
  };
}

const DAY_MS = 86_400_000;
/** Synodic month max ≈ 29.8 d, so a 35-day window always brackets the neighbour. */
const LUNATION_WINDOW_DAYS = 35;

/** Nearest target-phase (0 = new, 180 = full) instant; direction +1 future / −1 past. */
function searchLunation(targetLon: 0 | 180, date: Date, direction: 1 | -1): Date {
  const hit = Astronomy.SearchMoonPhase(
    targetLon,
    Astronomy.MakeTime(date),
    LUNATION_WINDOW_DAYS * direction,
  );
  if (!hit) throw new Error(`no ${targetLon === 0 ? "new" : "full"} moon within search window`);
  return hit.date;
}

/** Full moon-phase snapshot — phase, illumination, age and the four neighbour lunations. */
export function moonPhaseDetails(date: Date): {
  phase: string;
  illumination: number;
  waxing: boolean;
  moon_age_days: number;
  prev_new_moon: string;
  next_new_moon: string;
  prev_full_moon: string;
  next_full_moon: string;
  rashi: string;
} {
  const elong = elongation(date);
  const illum = Astronomy.Illumination(
    Astronomy.Body.Moon,
    Astronomy.MakeTime(date),
  ).phase_fraction;
  const prevNM = searchLunation(0, date, -1);
  return {
    phase: phaseNameFromElong(elong),
    illumination: Math.round(illum * 100) / 100,
    waxing: elong < 180,
    moon_age_days: Math.round(((date.getTime() - prevNM.getTime()) / DAY_MS) * 100) / 100,
    prev_new_moon: prevNM.toISOString(),
    next_new_moon: searchLunation(0, date, 1).toISOString(),
    prev_full_moon: searchLunation(180, date, -1).toISOString(),
    next_full_moon: searchLunation(180, date, 1).toISOString(),
    rashi: signOf(moonSiderealLon(date)).sign,
  };
}

/** Western (tropical) sun sign from a birth date. */
export function sunSignTropical(dateISO: string): string {
  // Sun's tropical longitude at 12:00 UTC on that date (sign boundaries are day-stable)
  const d = new Date(`${dateISO}T12:00:00Z`);
  const lon = sunTropicalLon(d);
  return SIGNS_TROPICAL[Math.floor(lon / 30)] ?? "Aries";
}

/** Sanskrit name, element and approximate tropical date range per sign. */
const SUN_SIGN_META: Record<string, { sanskrit: string; element: string; approx: string }> = {
  Aries: { sanskrit: "Mesha", element: "Fire", approx: "Mar 21 – Apr 19" },
  Taurus: { sanskrit: "Vrishabha", element: "Earth", approx: "Apr 20 – May 20" },
  Gemini: { sanskrit: "Mithuna", element: "Air", approx: "May 21 – Jun 20" },
  Cancer: { sanskrit: "Karka", element: "Water", approx: "Jun 21 – Jul 22" },
  Leo: { sanskrit: "Simha", element: "Fire", approx: "Jul 23 – Aug 22" },
  Virgo: { sanskrit: "Kanya", element: "Earth", approx: "Aug 23 – Sep 22" },
  Libra: { sanskrit: "Tula", element: "Air", approx: "Sep 23 – Oct 22" },
  Scorpio: { sanskrit: "Vrishchika", element: "Water", approx: "Oct 23 – Nov 21" },
  Sagittarius: { sanskrit: "Dhanu", element: "Fire", approx: "Nov 22 – Dec 21" },
  Capricorn: { sanskrit: "Makara", element: "Earth", approx: "Dec 22 – Jan 19" },
  Aquarius: { sanskrit: "Kumbha", element: "Air", approx: "Jan 20 – Feb 18" },
  Pisces: { sanskrit: "Meena", element: "Water", approx: "Feb 19 – Mar 20" },
};

/**
 * Sun sign pair — Western tropical sign + Vedic Surya Rashi (with nakshatra +
 * lord). `instant` (optional, from route-side birth resolution) gives the
 * EXACT longitude at the birth moment; without it the function falls back to
 * the 12:00-UTC approximation. Cusp flag fires within 1° of an ingress.
 */
export function sunSignDetails(
  dateISO: string,
  instant?: Date,
): {
  tropical_sign: string;
  tropical_longitude: number;
  rashi: string;
  rashiIndex: number;
  nakshatra: string;
  nakshatraIndex: number;
  pada: number;
  lord: string;
  element: string;
  sanskrit_name: string;
  approximate_dates: string;
  evaluated_at: string;
  cusp: { neighbouring_sign: string; degrees_to_boundary: number; warning: string } | null;
} {
  const at = instant ?? new Date(`${dateISO}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) throw new Error("invalid date");
  const tropicalLon = ((sunTropicalLon(at) % 360) + 360) % 360;
  const sid = sunSiderealLon(at);
  const sign = signOf(sid);
  const tIdx = Math.floor(tropicalLon / 30) % 12;
  const tropicalSign = SIGNS_TROPICAL[tIdx] ?? "Aries";
  const meta = SUN_SIGN_META[tropicalSign] ?? {
    sanskrit: tropicalSign,
    element: "—",
    approx: "—",
  };

  // Cusp: distance to the nearest 30° tropical boundary. Within 1°, the sign
  // may flip if the stated time is off (only meaningful with an exact instant).
  const within = tropicalLon % 30;
  let cusp: { neighbouring_sign: string; degrees_to_boundary: number; warning: string } | null =
    null;
  const distToLower = Math.min(within, 30 - within);
  if (distToLower <= 1) {
    const prevSign = SIGNS_TROPICAL[(tIdx + 11) % 12] ?? "Aries";
    const nextSign = SIGNS_TROPICAL[(tIdx + 1) % 12] ?? "Aries";
    const nearLower = within < 15;
    const other = nearLower ? prevSign : nextSign;
    cusp = {
      neighbouring_sign: other,
      degrees_to_boundary: Math.round(distToLower * 100) / 100,
      warning: `Birth falls within ${Math.round(distToLower * 100) / 100}° of the ${tropicalSign}/${other} boundary — with an inexact birth time the sign could be ${other} instead. Provide the exact birth time for certainty.`,
    };
  }

  return {
    tropical_sign: tropicalSign,
    tropical_longitude: Math.round(tropicalLon * 100) / 100,
    rashi: sign.sign,
    rashiIndex: sign.signIndex,
    ...nakshatraOf(sid),
    lord: RASHI_LORDS[sign.signIndex] ?? "Mars",
    element: meta.element,
    sanskrit_name: meta.sanskrit,
    approximate_dates: meta.approx,
    evaluated_at: instant
      ? `exact instant ${instant.toISOString()}`
      : "date only — evaluated at 12:00 UTC approximation",
    cusp,
  };
}

/** Vedic Moon sign (Rashi) + nakshatra from a birth instant. */
export function rashiAndNakshatra(birth: Date): {
  rashi: string;
  rashiIndex: number;
  nakshatra: string;
  nakshatraIndex: number;
  pada: number;
} {
  const lon = moonSiderealLon(birth);
  const sign = signOf(lon);
  const naks = nakshatraOf(lon);
  return { rashi: sign.sign, rashiIndex: sign.signIndex, ...naks };
}

/** Chaldean numerology letter values (traditional Vedic numerology uses Chaldean). */
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

function digitalRoot(n: number): number {
  while (n > 9) {
    n = String(n)
      .split("")
      .reduce((a, c) => a + Number(c), 0);
  }
  return n;
}

export function numerology(
  dateISO: string,
  name: string,
): {
  mulank: number; // birth-day number
  destiny: number; // full DOB sum
  name_number: number;
} {
  const digits = dateISO.replace(/\D/g, "").split("").map(Number);
  const day = Number(dateISO.slice(8, 10));
  const mulank = digitalRoot(day);
  const destiny = digitalRoot(digits.reduce((a, c) => a + c, 0));
  const nameSum = name
    .toUpperCase()
    .split("")
    .reduce((a, ch) => a + (CHALDEAN[ch] ?? 0), 0);
  return { mulank, destiny, name_number: digitalRoot(nameSum) };
}

/**
 * Vedic numerology lords 1–9 (Chaldean; Rahu/Ketu — Indian sites never use
 * Uranus/Neptune). Verified across bhagyank.in, AstroTalk, GaneshaSpeaks.
 */
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

/** Bhagyank (destiny) + Mulank (psychic) from a full DOB, compound sum surfaced. */
export function destinyNumber(dateISO: string): {
  destiny: number;
  destiny_sum: number;
  master: boolean;
  mulank: number;
  destiny_lord: string;
  mulank_lord: string;
} {
  const digits = dateISO.replace(/\D/g, "").split("").map(Number);
  const day = Number(dateISO.slice(8, 10));
  const sum = digits.reduce((a, c) => a + c, 0);
  const destiny = digitalRoot(sum);
  const mulank = digitalRoot(day);
  return {
    destiny,
    destiny_sum: sum,
    // Master totals {11,22,33} shown as compound + root (GaneshaSpeaks superset display)
    master: sum === 11 || sum === 22 || sum === 33,
    mulank,
    destiny_lord: NUMBER_LORDS[destiny - 1] ?? "Sun",
    mulank_lord: NUMBER_LORDS[mulank - 1] ?? "Sun",
  };
}
