/**
 * Hindu lunar calendar — month names (Amanta & Purnimanta), paksha, Samvat
 * (Epic 1.7, PRD §5.3 "Hindu Month & Samvat").
 *
 * Rules (cross-checked against published panchang tables and the design sample
 * 2026-11-19 → "Kartika • Vikram 2083"):
 *  - Amanta month = new-moon → new-moon, named by the SOLAR SIGN of the Sun at
 *    the new moon that STARTS it: Pisces→Chaitra, Aries→Vaisakha, … Libra→Kartika
 *    (name index = (signIndex + 1) % 12).
 *  - Adhika (leap) month: the current Amanta month is a leap month when the
 *    solar sign at its starting new moon equals the sign at the previous one.
 *  - Purnimanta (North Indian) month: same as Amanta during Shukla paksha
 *    (tithi 1..15), next month during Krishna paksha (tithi 16..30).
 *  - Vikram Samvat: Gregorian year + 57 after Chaitra Shukla 1 (new moon with
 *    Sun in Pisces), + 56 before it. Shaka: −78 / −79 on the same boundary.
 *  - Kshaya (skipped month): a solar sign jump of 2 between consecutive new
 *    moons — rare; flagged in a comment, naming follows the simple rule.
 */
import { SearchMoonPhase } from "astronomy-engine";
import { sunSiderealLon } from "./bodies";
import { LUNAR_MONTHS, LUNAR_MONTHS_HI, PAKSHA_NAMES, PAKSHA_NAMES_HI } from "./names";

export interface LocalizedName {
  name: string;
  name_hi: string;
}

export interface HinduMonthInfo {
  amanta: LocalizedName;
  purnimanta: LocalizedName;
  paksha: LocalizedName;
  adhika: boolean;
  samvat: { vikram: number; shaka: number };
}

const SYNODIC_MONTH_DAYS = 29.53;
const DAY_MS = 86400000;

function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Sidereal solar sign index 0..11 (0 = Aries/Mesha) at `date`. */
function solarSignSidereal(date: Date): number {
  return Math.floor(normDeg(sunSiderealLon(date)) / 30) % 12;
}

/**
 * Last new-moon instant at or before `date`.
 * `SearchMoonPhase(0, start, limit)` returns the first new moon after `start`,
 * so search from date−32d (first NM after that is always ≤ date−2.5d), then
 * check one candidate further — if it also falls before `date`, it is the
 * true last new moon (covers moments right after a new moon).
 */
export function newMoonBefore(date: Date): Date {
  let nm = SearchMoonPhase(0, new Date(date.getTime() - 32 * DAY_MS), 34)?.date;
  if (!nm) throw new Error("new_moon_not_found");
  const next = SearchMoonPhase(0, new Date(nm.getTime() + 25 * DAY_MS), 10)?.date;
  if (next && next.getTime() <= date.getTime()) nm = next;
  return nm;
}

/** New moon immediately preceding `monthStart` (search a full synodic window back). */
function newMoonBeforeMonth(monthStart: Date): Date {
  const nm = SearchMoonPhase(
    0,
    new Date(monthStart.getTime() - (SYNODIC_MONTH_DAYS + 1.5) * DAY_MS),
    34,
  )?.date;
  if (!nm) throw new Error("new_moon_not_found");
  return nm;
}

/**
 * New moon with Sun in sidereal Pisces (Chaitra 1, the Samvat new year)
 * inside the Gregorian year window containing `date`.
 */
function chaitraOneStart(year: number): Date {
  let probe = new Date(Date.UTC(year, 0, 1) - DAY_MS);
  for (let i = 0; i < 14; i++) {
    const nm = SearchMoonPhase(0, probe, 34)?.date;
    if (!nm) break;
    if (nm.getUTCFullYear() > year) break;
    if (solarSignSidereal(nm) === 11) return nm;
    probe = new Date(nm.getTime() + (SYNODIC_MONTH_DAYS - 0.5) * DAY_MS);
  }
  // Fallback (should be unreachable): mid-March approximation
  return new Date(Date.UTC(year, 2, 15));
}

/**
 * Compute the Hindu month/paksha/Samvat for a vedic day.
 * @param tithiIndex tithi at sunrise, 0..29 (0..14 Shukla, 15..29 Krishna)
 */
export function hinduCalendar(date: Date, tithiIndex: number): HinduMonthInfo {
  const monthStart = newMoonBefore(date);
  const prevStart = newMoonBeforeMonth(monthStart);

  const signAtStart = solarSignSidereal(monthStart);
  const signAtPrev = solarSignSidereal(prevStart);

  const amantaIdx = (signAtStart + 1) % 12;
  const adhika = signAtStart === signAtPrev;
  // NOTE (kshaya): if (signAtStart − signAtPrev + 12) % 12 === 2 a month is
  // skipped in this year — naming keeps the simple rule (documented in README).

  const isShukla = tithiIndex < 15;
  const purnimantaIdx = isShukla ? amantaIdx : (amantaIdx + 1) % 12;

  const year = date.getUTCFullYear();
  const newYear = chaitraOneStart(year);
  const afterNewYear = date.getTime() >= newYear.getTime();
  const vikram = year + (afterNewYear ? 57 : 56);
  const shaka = year + (afterNewYear ? -78 : -79);

  return {
    amanta: {
      name: LUNAR_MONTHS[amantaIdx] ?? "Chaitra",
      name_hi: LUNAR_MONTHS_HI[amantaIdx] ?? "चैत्र",
    },
    purnimanta: {
      name: LUNAR_MONTHS[purnimantaIdx] ?? "Chaitra",
      name_hi: LUNAR_MONTHS_HI[purnimantaIdx] ?? "चैत्र",
    },
    paksha: {
      name: isShukla ? PAKSHA_NAMES[0] : PAKSHA_NAMES[1],
      name_hi: isShukla ? PAKSHA_NAMES_HI[0] : PAKSHA_NAMES_HI[1],
    },
    adhika,
    samvat: { vikram, shaka },
  };
}
