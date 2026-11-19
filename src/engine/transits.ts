/**
 * Saturn transit — Sade Sati (Epic 1.10, PRD §5.5/§5.7).
 *
 * Classical definition: Sade Sati is the ~7.5-year span when Saturn transits
 * the 12th, 1st and 2nd signs from the NATAL MOON sign (phase 1 / 2 / 3).
 * The window is computed the way published panchang tables present it:
 * start = Saturn's FIRST entry into the 12th-from-moon sign, end = its FINAL
 * exit from the 2nd-from-moon sign — mid-window retrograde excursions outside
 * the trio (≤ ~6 months, e.g. the 2027 Aries dip) do NOT end the window;
 * an excursion counts as final only when Saturn stays outside the trio.
 * All instants come from Saturn's true sidereal longitude via sample-and-
 * bisect. Flagged `verified: false` pending Jyotishi review (P11).
 */
import { saturnSiderealLon } from "./bodies";
import { type KundliInput, planetaryPositions, SIGNS } from "./kundli";

const SIGNS_COUNT = 12;
const SAMPLE_DAYS = 20;
const BACKWARD_SAMPLE_DAYS = 30;
/** An exit from the trio is "final" when Saturn stays out ≥ this many days. */
const FINAL_EXIT_DAYS = 200;
const MAX_SEARCH_YEARS = 31; // Saturn's circuit ≈ 29.46y

export interface SadeSatiWindow {
  start: string;
  end: string;
}

export interface SadeSatiResult {
  in_sade_sati: boolean;
  phase: 1 | 2 | 3 | null;
  moon_sign: string;
  moon_sign_index: number;
  saturn_sign: string;
  saturn_sign_index: number;
  /** Saturn's offset from natal Moon sign (0 = same, 11 = 12th from). */
  saturn_offset_from_moon: number;
  /** The active window (when in Sade Sati). */
  current: SadeSatiWindow | null;
  /** The next upcoming window (always present within one Saturn circuit). */
  next: SadeSatiWindow | null;
  note: string;
  verified: false;
}

function signIndexOf(lon: number): number {
  return Math.floor((((lon % 360) + 360) % 360) / 30) % SIGNS_COUNT;
}

function inTrio(signIndex: number, moonSign: number): boolean {
  const offset = (signIndex - moonSign + SIGNS_COUNT) % SIGNS_COUNT;
  return offset === 11 || offset === 0 || offset === 1;
}

/** Bisect the exact crossing instant between lo (old sign) and hi (new sign). */
function bisectCrossing(lo: number, hi: number, oldSign: number): Date {
  let l = lo;
  let h = hi;
  while (h - l > 60_000) {
    const mid = (l + h) / 2;
    if (signIndexOf(saturnSiderealLon(new Date(mid))) === oldSign) l = mid;
    else h = mid;
  }
  return new Date(h);
}

/**
 * First instant Saturn enters the natal-Moon trio searching forward from
 * `from` (bounded by MAX_SEARCH_YEARS). Sample-and-bisect.
 */
function nextTrioEntry(moonSign: number, from: Date): Date | null {
  const limit = new Date(from.getTime() + MAX_SEARCH_YEARS * 365.25 * 86400000);
  let cursor = new Date(from.getTime());
  let prevSign = signIndexOf(saturnSiderealLon(cursor));
  while (cursor < limit) {
    const next = new Date(cursor.getTime() + SAMPLE_DAYS * 86400000);
    const sign = signIndexOf(saturnSiderealLon(next));
    if (sign !== prevSign) {
      const enter = bisectCrossing(cursor.getTime(), next.getTime(), prevSign);
      if (inTrio(signIndexOf(saturnSiderealLon(enter)), moonSign)) return enter;
      prevSign = sign;
    }
    cursor = next;
  }
  return null;
}

/**
 * Final exit from the trio after `windowStart`: the first sign-change into a
 * non-trio sign NOT followed by a re-entry within FINAL_EXIT_DAYS (dips are
 * ignored). Bounded by one Saturn circuit after windowStart.
 */
function finalTrioExit(moonSign: number, windowStart: Date): Date | null {
  const limit = new Date(windowStart.getTime() + MAX_SEARCH_YEARS * 365.25 * 86400000);
  let cursor = new Date(windowStart.getTime());
  let prevSign = signIndexOf(saturnSiderealLon(cursor));
  while (cursor < limit) {
    const next = new Date(cursor.getTime() + SAMPLE_DAYS * 86400000);
    const sign = signIndexOf(saturnSiderealLon(next));
    if (sign !== prevSign) {
      const crossing = bisectCrossing(cursor.getTime(), next.getTime(), prevSign);
      if (!inTrio(sign, moonSign)) {
        // Dip check: does Saturn come back into the trio soon after?
        let dipCursor = crossing.getTime();
        let reentered = false;
        while (dipCursor < crossing.getTime() + FINAL_EXIT_DAYS * 86400000) {
          dipCursor += 5 * 86400000;
          if (inTrio(signIndexOf(saturnSiderealLon(new Date(dipCursor))), moonSign)) {
            reentered = true;
            break;
          }
        }
        if (!reentered) return crossing; // final exit
        // Mid-window dip — keep scanning from just before the re-entry.
      }
      prevSign = sign;
    }
    cursor = next;
  }
  return null;
}

/**
 * Start of the CURRENT window: walk backwards from `now` to the last instant
 * Saturn was outside the trio, then bisect forward to the re-entry (= the
 * first trio entry of this run).
 */
function currentWindowStart(moonSign: number, now: Date): Date | null {
  const limit = new Date(now.getTime() - MAX_SEARCH_YEARS * 365.25 * 86400000);
  let cursor = new Date(now.getTime());
  while (cursor > limit) {
    const prev = new Date(cursor.getTime() - BACKWARD_SAMPLE_DAYS * 86400000);
    const sPrev = signIndexOf(saturnSiderealLon(prev));
    if (!inTrio(sPrev, moonSign)) {
      // Re-entry lies between prev and cursor — bisect on trio membership.
      let l = prev.getTime();
      let h = cursor.getTime();
      while (h - l > 60_000) {
        const mid = (l + h) / 2;
        if (inTrio(signIndexOf(saturnSiderealLon(new Date(mid))), moonSign)) h = mid;
        else l = mid;
      }
      return new Date(h);
    }
    cursor = prev;
  }
  return null;
}

/**
 * Sade Sati status for a natal chart, evaluated at `now` (default current
 * instant; injectable for determinism).
 */
export function sadeSati(natal: KundliInput, now: Date = new Date()): SadeSatiResult {
  const positions = planetaryPositions(natal);
  const moon = positions.find((p) => p.planet === "Moon");
  if (!moon) throw new Error("moon_position_unavailable");
  const moonSign = moon.signIndex;

  const saturnLon = saturnSiderealLon(now);
  const saturnSign = signIndexOf(saturnLon);
  const offset = (saturnSign - moonSign + SIGNS_COUNT) % SIGNS_COUNT;
  const saturnInTrioNow = inTrio(saturnSign, moonSign);

  // Active window: when Saturn is inside the trio, its start is the first
  // entry of the current run; the end is the FINAL exit from the trio.
  let current: SadeSatiWindow | null = null;
  let next: SadeSatiWindow | null = null;
  if (saturnInTrioNow) {
    const start = currentWindowStart(moonSign, now);
    if (start) {
      const end = finalTrioExit(moonSign, start);
      if (end) {
        current = { start: start.toISOString(), end: end.toISOString() };
        const nextEntry = nextTrioEntry(moonSign, end);
        if (nextEntry) {
          const nextEnd = finalTrioExit(moonSign, nextEntry);
          if (nextEnd) {
            next = { start: nextEntry.toISOString(), end: nextEnd.toISOString() };
          }
        }
      }
    }
  } else {
    const nextEntry = nextTrioEntry(moonSign, now);
    if (nextEntry) {
      const nextEnd = finalTrioExit(moonSign, nextEntry);
      if (nextEnd) {
        next = { start: nextEntry.toISOString(), end: nextEnd.toISOString() };
      }
    }
  }

  const inSadeSati = current !== null;
  // Phase from Saturn's instantaneous offset; during a mid-window retro dip
  // (Saturn momentarily outside the trio) the classical presentation keeps
  // the last phase, so an in-window dip reports 3.
  const phase: 1 | 2 | 3 | null = !inSadeSati ? null : offset === 11 ? 1 : offset === 0 ? 2 : 3;

  return {
    in_sade_sati: inSadeSati,
    phase,
    moon_sign: SIGNS[moonSign] ?? "Aries",
    moon_sign_index: moonSign,
    saturn_sign: SIGNS[saturnSign] ?? "Aries",
    saturn_sign_index: saturnSign,
    saturn_offset_from_moon: offset,
    current,
    next,
    note: "Sade Sati = Saturn transiting 12th/1st/2nd from natal Moon; window = first entry to final exit (mid-window retro dips ignored, classical presentation). Phases 1–3 in transit order. Pending Jyotishi review (P11).",
    verified: false,
  };
}
