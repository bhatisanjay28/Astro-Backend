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

export interface SadeSatiPhase {
  phase: 1 | 2 | 3;
  start: string;
  end: string;
}

export interface SadeSatiResult {
  in_sade_sati: boolean;
  phase: 1 | 2 | 3 | null;
  /** Dhaiya: Saturn transiting the 4th or 8th sign from natal Moon. */
  in_dhaiya: boolean;
  dhaiya_house: 4 | 8 | null;
  moon_sign: string;
  moon_sign_index: number;
  saturn_sign: string;
  saturn_sign_index: number;
  /** Saturn's offset from natal Moon sign (0 = same, 11 = 12th from). */
  saturn_offset_from_moon: number;
  /** The active window (when in Sade Sati). */
  current: SadeSatiWindow | null;
  /** Phase sub-windows of the active window (dips folded into prior phase). */
  phase_windows: SadeSatiPhase[];
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
 * Start of the window that `now` falls inside, or null when `now` lies between
 * windows (QB-06). Backward walk with dip tolerance: a short outside stretch
 * (< FINAL_EXIT_DAYS) is a mid-window retro dip — skipped, mirroring
 * finalTrioExit; an outside stretch ≥ FINAL_EXIT_DAYS means the last window
 * closed, so there is no open window at `now`.
 */
function currentWindowStart(moonSign: number, now: Date): Date | null {
  const limitMs = now.getTime() - MAX_SEARCH_YEARS * 365.25 * 86400000;
  const limit = new Date(limitMs);
  let cursor = new Date(now.getTime());
  // If Saturn is outside the trio now, first decide whether that is a dip or
  // a closed window: walk back through the outside run; reaching the trio
  // within FINAL_EXIT_DAYS ⇒ dip (keep searching for this window's start);
  // otherwise the window is over and `now` sits between windows.
  if (!inTrio(signIndexOf(saturnSiderealLon(cursor)), moonSign)) {
    let outsideDays = 0;
    while (
      cursor.getTime() > limitMs &&
      !inTrio(signIndexOf(saturnSiderealLon(cursor)), moonSign)
    ) {
      outsideDays += BACKWARD_SAMPLE_DAYS;
      cursor = new Date(cursor.getTime() - BACKWARD_SAMPLE_DAYS * 86400000);
    }
    if (cursor.getTime() <= limitMs) return null;
    if (outsideDays >= FINAL_EXIT_DAYS) return null; // window closed — between windows
    // else: mid-window dip — cursor is now inside the trio; fall through.
  }
  // Walk backward to this window's first trio entry, skipping interior dips.
  while (cursor.getTime() > limitMs) {
    const prev = new Date(cursor.getTime() - BACKWARD_SAMPLE_DAYS * 86400000);
    if (!inTrio(signIndexOf(saturnSiderealLon(prev)), moonSign)) {
      // Candidate re-entry between prev and cursor. Is the outside stretch
      // BEFORE prev a final exit or another interior dip?
      let back = prev.getTime();
      const stretchLimit = back - FINAL_EXIT_DAYS * 86400000;
      let dipped = false;
      while (back > stretchLimit && back > limitMs) {
        back -= 10 * 86400000;
        if (inTrio(signIndexOf(saturnSiderealLon(new Date(back))), moonSign)) {
          dipped = true;
          break;
        }
      }
      if (!dipped) {
        // Final exit precedes this run — bisect the re-entry instant.
        let l = prev.getTime();
        let h = cursor.getTime();
        while (h - l > 60_000) {
          const mid = (l + h) / 2;
          if (inTrio(signIndexOf(saturnSiderealLon(new Date(mid))), moonSign)) h = mid;
          else l = mid;
        }
        return new Date(h);
      }
      cursor = new Date(back); // interior dip — resume from inside the trio
      continue;
    }
    cursor = prev;
  }
  return null;
}

/**
 * Phase sub-windows of one Sade Sati window (QB-07). Walk the window with
 * sign-change bisection; a phase boundary is a sign change into a different
 * trio phase. Retro dips OUTSIDE the trio keep the previous phase (classical
 * presentation), so dip time folds into the preceding phase segment.
 */
function phaseWindows(moonSign: number, windowStart: Date, windowEnd: Date): SadeSatiPhase[] {
  const phaseAt = (sign: number): 1 | 2 | 3 | null => {
    if (!inTrio(sign, moonSign)) return null;
    const offset = (sign - moonSign + SIGNS_COUNT) % SIGNS_COUNT;
    return offset === 11 ? 1 : offset === 0 ? 2 : 3;
  };
  const out: SadeSatiPhase[] = [];
  let cursor = windowStart.getTime();
  const endMs = windowEnd.getTime();
  let currentPhase = phaseAt(signIndexOf(saturnSiderealLon(new Date(cursor)))) ?? 1;
  let segmentStart = cursor;
  while (cursor < endMs) {
    const next = cursor + SAMPLE_DAYS * 86400000;
    const sPrev = signIndexOf(saturnSiderealLon(new Date(cursor)));
    const sNext = signIndexOf(saturnSiderealLon(new Date(Math.min(next, endMs))));
    if (sPrev !== sNext) {
      const crossing = bisectCrossing(cursor, Math.min(next, endMs), sPrev).getTime();
      const newPhase = phaseAt(sNext);
      if (newPhase !== null && newPhase !== currentPhase) {
        out.push({
          phase: currentPhase,
          start: new Date(segmentStart).toISOString(),
          end: new Date(crossing).toISOString(),
        });
        segmentStart = crossing;
        currentPhase = newPhase;
      }
    }
    cursor = next;
  }
  out.push({
    phase: currentPhase,
    start: new Date(segmentStart).toISOString(),
    end: new Date(endMs).toISOString(),
  });
  return out;
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

  // Active window: `currentWindowStart` is dip-tolerant — it returns the start
  // of the window that `now` falls inside (even when Saturn is momentarily
  // OUTSIDE the trio in a mid-window retro dip), or null when `now` lies
  // between windows. The end is the FINAL exit from the trio.
  let current: SadeSatiWindow | null = null;
  let next: SadeSatiWindow | null = null;
  let currentStart: Date | null = null;
  let currentEnd: Date | null = null;
  const start = currentWindowStart(moonSign, now);
  if (start) {
    const end = finalTrioExit(moonSign, start);
    if (end && end.getTime() > now.getTime()) {
      currentStart = start;
      currentEnd = end;
      current = { start: start.toISOString(), end: end.toISOString() };
      // Next window: the first trio entry after this window's final exit.
      const nextEntry = nextTrioEntry(moonSign, end);
      if (nextEntry) {
        const nextEnd = finalTrioExit(moonSign, nextEntry);
        if (nextEnd) {
          next = { start: nextEntry.toISOString(), end: nextEnd.toISOString() };
        }
      }
    } else {
      // Last window has closed; the next one opens after its final exit.
      const nextEntry = nextTrioEntry(moonSign, end ?? now);
      if (nextEntry) {
        const nextEnd = finalTrioExit(moonSign, nextEntry);
        if (nextEnd) {
          next = { start: nextEntry.toISOString(), end: nextEnd.toISOString() };
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

  // Dhaiya: Saturn transiting the 4th (offset 3) or 8th (offset 7) sign from
  // natal Moon — "Small Panoti", independent of Sade Sati membership.
  const dhaiyaHouse: 4 | 8 | null = offset === 3 ? 4 : offset === 7 ? 8 : null;
  const phaseWindowsOut =
    currentStart !== null && currentEnd !== null
      ? phaseWindows(moonSign, currentStart, currentEnd)
      : [];

  const inSadeSati = current !== null;
  // Phase: from the phase sub-windows (dips folded), so a mid-window retro dip
  // keeps the classical presentation instead of dropping the phase to null.
  let phase: 1 | 2 | 3 | null = null;
  if (inSadeSati) {
    const nowMs = now.getTime();
    const seg = phaseWindowsOut.find((w) => {
      const t = nowMs;
      return t >= Date.parse(w.start) && t <= Date.parse(w.end);
    });
    phase = seg ? seg.phase : offset === 11 ? 1 : offset === 0 ? 2 : 3;
  }

  return {
    in_sade_sati: inSadeSati,
    phase,
    in_dhaiya: dhaiyaHouse !== null,
    dhaiya_house: dhaiyaHouse,
    moon_sign: SIGNS[moonSign] ?? "Aries",
    moon_sign_index: moonSign,
    saturn_sign: SIGNS[saturnSign] ?? "Aries",
    saturn_sign_index: saturnSign,
    saturn_offset_from_moon: offset,
    current,
    phase_windows: phaseWindowsOut,
    next,
    note: "Sade Sati = Saturn transiting 12th/1st/2nd from natal Moon; window = first entry to final exit (mid-window retro dips stay inside the window, classical presentation). Phases 1–3 in transit order; phase_windows fold dips into the preceding phase. Dhaiya = Saturn 4th/8th from Moon, reported separately. Pending Jyotishi review (P11).",
    verified: false,
  };
}
