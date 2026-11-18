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
