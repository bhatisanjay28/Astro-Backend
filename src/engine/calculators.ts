/**
 * Calculator primitives (Epic 1.5) — Tier 1 tools per PRD §5.7.
 * Thin, deterministic wrappers over the engine core.
 */
import * as Astronomy from "astronomy-engine";
import { elongation, moonSiderealLon, sunTropicalLon } from "./bodies";
import { nakshatraOf, signOf } from "./kundli";

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

/** Moon phase name for a date (8 classical phases + illumination fraction). */
export function moonPhaseName(date: Date): { phase: string; illumination: number } {
  const illum = Astronomy.Illumination(
    Astronomy.Body.Moon,
    Astronomy.MakeTime(date),
  ).phase_fraction;
  // Elongation must be TROPICAL moon−sun — mixing frames leaks the ayanamsha
  // into the phase bin (caught by the new/full-moon instant tests).
  const elong = elongation(date);
  let phase: string;
  if (elong < 22.5 || elong >= 337.5) phase = "New Moon";
  else if (elong < 67.5) phase = "Waxing Crescent";
  else if (elong < 112.5) phase = "First Quarter";
  else if (elong < 157.5) phase = "Waxing Gibbous";
  else if (elong < 202.5) phase = "Full Moon";
  else if (elong < 247.5) phase = "Waning Gibbous";
  else if (elong < 292.5) phase = "Last Quarter";
  else phase = "Waning Crescent";
  return { phase, illumination: Math.round(illum * 100) / 100 };
}

/** Western (tropical) sun sign from a birth date. */
export function sunSignTropical(dateISO: string): string {
  // Sun's tropical longitude at 12:00 UTC on that date (sign boundaries are day-stable)
  const d = new Date(`${dateISO}T12:00:00Z`);
  const lon = sunTropicalLon(d);
  return SIGNS_TROPICAL[Math.floor(lon / 30)] ?? "Aries";
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
