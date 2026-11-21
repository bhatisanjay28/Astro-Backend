/**
 * Vimshottari Dasha (Epic 1.3) — the classical 120-year planetary period cycle.
 *
 * METHOD (standard, documented):
 *  - The dasha sequence starts from the lord of the Moon's nakshatra at birth.
 *  - Period lengths (years, solar 365.25-day): Ketu 7, Venus 20, Sun 6,
 *    Moon 10, Mars 7, Rahu 18, Jupiter 16, Saturn 19, Mercury 17. Sum = 120.
 *  - Balance at birth = remaining fraction of the first period, from the
 *    Moon's position within its nakshatra.
 */
import { moonSiderealLon } from "./bodies";
import { NAKSHATRAS } from "./names";

const NAKSHATRA_SPAN = 360 / 27;

export const DASHA_ORDER = [
  "Ketu",
  "Venus",
  "Sun",
  "Moon",
  "Mars",
  "Rahu",
  "Jupiter",
  "Saturn",
  "Mercury",
] as const;

export const DASHA_YEARS: Record<(typeof DASHA_ORDER)[number], number> = {
  Ketu: 7,
  Venus: 20,
  Sun: 6,
  Moon: 10,
  Mars: 7,
  Rahu: 18,
  Jupiter: 16,
  Saturn: 19,
  Mercury: 17,
};

const NAKSHATRA_LORDS = [
  "Ketu",
  "Venus",
  "Sun",
  "Moon",
  "Mars",
  "Rahu",
  "Jupiter",
  "Saturn",
  "Mercury",
  "Ketu",
  "Venus",
  "Sun",
  "Moon",
  "Mars",
  "Rahu",
  "Jupiter",
  "Saturn",
  "Mercury",
  "Ketu",
  "Venus",
  "Sun",
  "Moon",
  "Mars",
  "Rahu",
  "Jupiter",
  "Saturn",
  "Mercury",
] as const;

export interface DashaPeriod {
  lord: string;
  start: Date;
  end: Date;
  years: number;
}

export interface VimshottariResult {
  moon_nakshatra: string;
  moon_nakshatra_lord: string;
  balance_at_birth_years: number;
  /** Maha-dasha sequence starting from birth (first = balance-truncated). */
  mahadashas: DashaPeriod[];
}

const YEAR_MS = 365.25 * 86400000;

export function vimshottari(moonLon: number, birth: Date, count = 9): VimshottariResult {
  const norm = ((moonLon % 360) + 360) % 360;
  const nIdx = Math.floor(norm / NAKSHATRA_SPAN);
  const within = norm - nIdx * NAKSHATRA_SPAN;
  const fractionElapsed = within / NAKSHATRA_SPAN;
  const firstLord = NAKSHATRA_LORDS[nIdx] ?? "Ketu";
  const firstIdx = DASHA_ORDER.indexOf(firstLord as (typeof DASHA_ORDER)[number]);
  const firstFull = DASHA_YEARS[firstLord as keyof typeof DASHA_YEARS];
  const balance = firstFull * (1 - fractionElapsed);

  const mahadashas: DashaPeriod[] = [];
  let cursor = new Date(birth.getTime());
  // First (partial) period
  mahadashas.push({
    lord: firstLord,
    start: cursor,
    end: new Date(cursor.getTime() + balance * YEAR_MS),
    years: Math.round(balance * 1000) / 1000,
  });
  cursor = mahadashas[0]!.end;

  for (let i = 1; i < count; i++) {
    const lord = DASHA_ORDER[(firstIdx + i) % 9]!;
    const years = DASHA_YEARS[lord];
    mahadashas.push({
      lord,
      start: cursor,
      end: new Date(cursor.getTime() + years * YEAR_MS),
      years,
    });
    cursor = mahadashas[mahadashas.length - 1]!.end;
  }

  return {
    moon_nakshatra: NAKSHATRAS[nIdx] ?? "Ashwini",
    moon_nakshatra_lord: firstLord,
    balance_at_birth_years: Math.round(balance * 1000) / 1000,
    mahadashas,
  };
}

/** Convenience: compute Vimshottari from the Moon's sidereal longitude at birth. */
export function vimshottariFromMoon(birth: Date, count = 9): VimshottariResult {
  return vimshottari(moonSiderealLon(birth), birth, count);
}

// ---------------------------------------------------------------------------
// Antardashas + current-position lookup (Epic 14, S14-1b).
// ---------------------------------------------------------------------------

export interface AntardashaPeriod {
  lord: string;
  start: Date;
  end: Date;
  years: number;
}

/**
 * Antardasha (sub-period) sequence of one mahadasha: runs in DASHA_ORDER
 * starting with the maha lord; each length = maha span × (sub years / 120).
 * For the balance-truncated first mahadasha every antardasha scales
 * proportionally, so the sub-periods always sum exactly to the maha span.
 */
export function antardashasOf(maha: DashaPeriod): AntardashaPeriod[] {
  const lordIdx = DASHA_ORDER.indexOf(maha.lord as (typeof DASHA_ORDER)[number]);
  const spanMs = maha.end.getTime() - maha.start.getTime();
  const out: AntardashaPeriod[] = [];
  // Cumulative boundaries (not per-step accumulation) so the sub-periods sum
  // to the maha span with zero float drift.
  let cumulativeYears = 0;
  for (let i = 0; i < 9; i++) {
    const lord = DASHA_ORDER[(lordIdx + i) % 9]!;
    const startMs = maha.start.getTime() + (spanMs * cumulativeYears) / 120;
    cumulativeYears += DASHA_YEARS[lord];
    const endMs = maha.start.getTime() + (spanMs * cumulativeYears) / 120;
    out.push({
      lord,
      start: new Date(startMs),
      end: new Date(endMs),
      years: Math.round(((endMs - startMs) / YEAR_MS) * 1000) / 1000,
    });
  }
  return out;
}

export interface DashaCurrent {
  mahadasha_lord: string;
  mahadasha_start: Date;
  mahadasha_end: Date;
  antardasha_lord: string;
  antardasha_start: Date;
  antardasha_end: Date;
  antardasha_index: number;
  /** Fraction (0–1) of the current antardasha elapsed at `now`. */
  elapsed_fraction: number;
  next_antardasha_lord: string | null;
  next_antardasha_start: Date | null;
}

/** Where does `now` sit in the cycle? null when outside the computed span. */
export function vimshottariCurrent(mahadashas: DashaPeriod[], now: Date): DashaCurrent | null {
  const t = now.getTime();
  const maha = mahadashas.find((m) => t >= m.start.getTime() && t < m.end.getTime());
  if (!maha) return null;
  const subs = antardashasOf(maha);
  const sub = subs.find((s) => t >= s.start.getTime() && t < s.end.getTime());
  if (!sub) return null;
  const idx = subs.indexOf(sub);
  const nextSub = subs[idx + 1] ?? null;
  const fraction = (t - sub.start.getTime()) / (sub.end.getTime() - sub.start.getTime());
  return {
    mahadasha_lord: maha.lord,
    mahadasha_start: maha.start,
    mahadasha_end: maha.end,
    antardasha_lord: sub.lord,
    antardasha_start: sub.start,
    antardasha_end: sub.end,
    antardasha_index: idx,
    elapsed_fraction: Math.round(fraction * 1e6) / 1e6,
    next_antardasha_lord: nextSub?.lord ?? null,
    next_antardasha_start: nextSub?.start ?? null,
  };
}
