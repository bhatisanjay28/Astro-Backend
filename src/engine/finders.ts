/**
 * Time-of-crossing finders — wrap-aware bisection.
 * All Vedic limb boundaries (tithi/nakshatra/yoga/karana) reduce to
 * "when does this slowly-increasing cyclic function reach target X?".
 * Monotonicity holds because moon/sun longitudes only advance forward.
 */

const BISECT_ITERATIONS = 80;
const PRECISION_MS = 250; // quarter-second precision is plenty for Panchang

/**
 * Find the instant in (from, to] where `fn` (degrees, wrapped 0–360, strictly
 * advancing) reaches `targetDeg`. Returns null if the crossing is not in the
 * window. `meanRateDegPerDay` guides the upper search bound; supply a value
 * safely below the true rate (e.g. elongation ≈ 12°/day → pass 10) so the
 * window is never cut short before the crossing.
 */
export function findWrappedCrossing(
  fn: (date: Date) => number,
  targetDeg: number,
  from: Date,
  maxDays: number,
  meanRateDegPerDay: number,
): Date | null {
  const wrapDiff = (date: Date): number => {
    const v = fn(date);
    let d = v - targetDeg;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  };

  let lo = from.getTime();
  const loDiff = wrapDiff(new Date(lo));
  if (loDiff >= 0) return null; // already at/past target

  // Advance the window in meanRate-sized hops until the target is passed,
  // then bisect. Simple, robust against rate estimation error.
  let hi = lo;
  let hiDiff = loDiff;
  const hopMs = (1 / meanRateDegPerDay) * 86400000 * 0.8;
  let hops = 0;
  while (hiDiff < 0 && hops < 60) {
    hi = Math.min(hi + hopMs, lo + maxDays * 86400000);
    hiDiff = wrapDiff(new Date(hi));
    if (hi - lo >= maxDays * 86400000 && hiDiff < 0) return null; // out of window
    if (hi >= lo + maxDays * 86400000) break;
    hops++;
  }
  if (hiDiff < 0) return null;

  for (let i = 0; i < BISECT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const dMid = wrapDiff(new Date(mid));
    if (dMid < 0) lo = mid;
    else hi = mid;
    if (hi - lo < PRECISION_MS) break;
  }
  return new Date((lo + hi) / 2);
}

/** Next crossing strictly AFTER `after` (for iterating limb boundaries). */
export function nextCrossing(
  fn: (date: Date) => number,
  targetDeg: number,
  after: Date,
  maxDays: number,
  meanRateDegPerDay: number,
): Date | null {
  // Nudge forward so a crossing exactly at `after` is not re-found.
  const nudged = new Date(after.getTime() + 1000);
  return findWrappedCrossing(fn, targetDeg, nudged, maxDays, meanRateDegPerDay);
}
