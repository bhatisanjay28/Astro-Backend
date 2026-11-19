/**
 * Choghadiya — 8 day + 8 night divisions of the vedic day (Epic 1.7, PRD §5.3).
 *
 * Rules (verified 2026-11-19 against drikpanchang's live Delhi table and
 * AstroSage's weekday tables):
 *  - 8 slots span sunrise→sunset (day) and sunset→next sunrise (night),
 *    each 1/8 of its span.
 *  - The first DAY choghadiya is ruled by the weekday lord; subsequent slots
 *    step forward through the Chaldean order (Saturn, Jupiter, Mars, Sun,
 *    Venus, Mercury, Moon). The name derives from the slot's lord.
 *  - The NIGHT sequence of a weekday equals the DAY sequence of (weekday + 4)
 *    — reproduces drikpanchang's Thursday-night table exactly.
 *  - Nature: Amrit/Shubh/Labh/Char auspicious; Kaal/Rog/Udveg inauspicious.
 */
import { LocalizedName } from "./hinduCalendar";

export type ChoghadiyaNature = "auspicious" | "inauspicious";

export interface ChoghadiyaSlot {
  name: string;
  name_hi: string;
  lord: string;
  nature: ChoghadiyaNature;
  start: string; // ISO instant
  end: string;
}

interface ChoghadiyaDef {
  name: string;
  name_hi: string;
  lord: string;
  nature: ChoghadiyaNature;
  note: string;
}

/** The 7 choghadiyas, each tied to a planet (drikpanchang reference table). */
const CHOGHADIYA_DEFS: ChoghadiyaDef[] = [
  { name: "Udveg", name_hi: "उद्वेग", lord: "Sun", nature: "inauspicious", note: "government work" },
  { name: "Char", name_hi: "चर", lord: "Venus", nature: "auspicious", note: "travel" },
  {
    name: "Labh",
    name_hi: "लाभ",
    lord: "Mercury",
    nature: "auspicious",
    note: "education, new skills",
  },
  { name: "Amrit", name_hi: "अमृत", lord: "Moon", nature: "auspicious", note: "all works" },
  {
    name: "Kaal",
    name_hi: "काल",
    lord: "Saturn",
    nature: "inauspicious",
    note: "wealth accumulation",
  },
  {
    name: "Shubh",
    name_hi: "शुभ",
    lord: "Jupiter",
    nature: "auspicious",
    note: "ceremonies, marriage",
  },
  { name: "Rog", name_hi: "रोग", lord: "Mars", nature: "inauspicious", note: "competitions" },
];

/** Chaldean order — planets by decreasing speed, cycled forward per slot. */
const CHALDEAN = ["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"];

/** Weekday lord by vaar index (0 = Sunday). */
const WEEKDAY_LORDS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"];

const LORD_TO_CHOGHADIYA = new Map<string, number>(CHOGHADIYA_DEFS.map((d, i) => [d.lord, i]));

function chaldeanIndexOf(lord: string): number {
  return CHALDEAN.indexOf(lord);
}

/** Name indices (into CHOGHADIYA_DEFS) of the 8 DAY slots for a vaar index. */
export function choghadiyaDaySequence(vaarIndex: number): number[] {
  const start = chaldeanIndexOf(WEEKDAY_LORDS[((vaarIndex % 7) + 7) % 7] ?? "Sun");
  const seq: number[] = [];
  for (let k = 0; k < 8; k++) {
    const lord = CHALDEAN[(start + k) % 7] ?? "Sun";
    seq.push(LORD_TO_CHOGHADIYA.get(lord) ?? 0);
  }
  return seq;
}

/**
 * The NIGHT sequence: slot k is ruled by the weekday lord of
 * (vaar + 4·(k+1)) — i.e. it starts at the lord of (weekday + 4) and steps
 * +4 through the weekday-lord cycle per slot. Verified against drikpanchang's
 * live Thursday-night table (Amrit Char Rog Kaal Labh Udveg Shubh Amrit) and
 * the canonical weekday grid (Sun: night Shubh · Mon: Char · Tue: Kaal ·
 * Wed: Udveg · Fri: Rog · Sat: Labh).
 */
export function choghadiyaNightSequence(vaarIndex: number): number[] {
  const v = ((vaarIndex % 7) + 7) % 7;
  const seq: number[] = [];
  for (let k = 0; k < 8; k++) {
    const lord = WEEKDAY_LORDS[(v + 4 * (k + 1)) % 7] ?? "Sun";
    seq.push(LORD_TO_CHOGHADIYA.get(lord) ?? 0);
  }
  return seq;
}

function slotsFrom(nameIdx: number[], startMs: number, endMs: number): ChoghadiyaSlot[] {
  const span = (endMs - startMs) / 8;
  return nameIdx.map((idx, k) => {
    const def = CHOGHADIYA_DEFS[idx] ?? CHOGHADIYA_DEFS[0]!;
    return {
      name: def.name,
      name_hi: def.name_hi,
      lord: def.lord,
      nature: def.nature,
      start: new Date(startMs + k * span).toISOString(),
      end: new Date(startMs + (k + 1) * span).toISOString(),
    };
  });
}

/**
 * All 16 choghadiya slots (day + night) for one vedic day.
 * Day spans sunrise→sunset; night spans sunset→next sunrise.
 */
export function choghadiyaDay(
  vaarIndex: number,
  sunrise: Date,
  sunset: Date,
  nextSunrise: Date,
): { day: ChoghadiyaSlot[]; night: ChoghadiyaSlot[] } {
  return {
    day: slotsFrom(choghadiyaDaySequence(vaarIndex), sunrise.getTime(), sunset.getTime()),
    night: slotsFrom(choghadiyaNightSequence(vaarIndex), sunset.getTime(), nextSunrise.getTime()),
  };
}
