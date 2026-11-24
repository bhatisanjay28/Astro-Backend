/**
 * Horoscope scorer (Horoscope Upgrade Step 4; ruleset 03-ruleset.md §3–§5, §8).
 *
 * Turns a day's sidereal snapshot into per-planet benefit values, category
 * scores, rating bands and the derived flags (retro review, chandrashtama,
 * Sade Sati phase, drivers). Pure functions — the generator feeds it
 * `planetaryPositions` snapshots and calendar day lists.
 */
import { type PlanetName, type PlanetPosition, planetaryPositions } from "../engine/kundli";
import {
  CATEGORY_WEIGHTS,
  FAVORABLE_HOUSES,
  type HoroscopeSign,
  houseFromSign,
  PLANETS,
  type Rating,
  ratingFromScore,
  SATURN_HOUSE_MODIFIER,
  signIndex,
  vedhaObstructor,
} from "./rules";

export interface Snapshot {
  date: Date;
  positions: Map<PlanetName, PlanetPosition>;
}

/** Sidereal snapshot for an instant (IST day ⇒ evaluate at day start, 00:05 IST convention). */
export function snapshotAt(instant: Date): Snapshot {
  const positions = planetaryPositions({
    datetime: instant,
    latitude: 28.6139, // Delhi reference meridian — house counting is zodiacal,
    longitude: 77.209, // so the lat/lng only anchor the ephemeris time conversion
  });
  return { date: instant, positions: new Map(positions.map((p) => [p.planet, p])) };
}

export interface PlanetBenefit {
  b: number; // −1 … +1 (ruleset §3 scale)
  house: number;
  favorable: boolean;
  vedha: boolean;
  retroDemoted: boolean;
}

/** §3 — per-planet daily favorability value for one sign. */
export function planetBenefit(
  planet: PlanetName,
  sign: HoroscopeSign,
  snap: Snapshot,
): PlanetBenefit {
  const pos = snap.positions.get(planet);
  if (!pos) throw new Error(`missing position for ${planet}`);
  const sIdx = signIndex(sign);
  const house = houseFromSign(pos.signIndex, sIdx);
  const isFavorable = FAVORABLE_HOUSES[planet].includes(house);

  let b: number;
  let vedha = false;
  if (isFavorable) {
    const obstructor = vedhaObstructor(planet, house, houseMap(snap, sIdx));
    if (obstructor) {
      b = 0.2; // dampened, not erased (§2.2 UNVERIFIED-3)
      vedha = true;
    } else {
      b = 1;
    }
  } else if ((planet === "Rahu" || planet === "Ketu") && house === 10) {
    b = 0.5; // weak-positive [VAR]
  } else {
    // §2.1: every planet's non-favorable houses are unfavorable ("rest" in the table).
    b = -1;
  }

  let retroDemoted = false;
  // §3 retro modifier — classical fast/slow planets only. Rahu/Ketu are always
  // retrograde (mean nodes) and never carry the "second pass" tone. [ED]
  if (pos.retrograde && planet !== "Rahu" && planet !== "Ketu" && b > 0) {
    b *= 0.6;
    retroDemoted = true;
  }
  return { b, house, favorable: isFavorable, vedha, retroDemoted };
}

/** Planet → house-from-`sign` map for vedha lookups (vedhaObstructor expects houses, not signIndexes). */
function houseMap(snap: Snapshot, sign: number): Map<PlanetName, number> {
  return new Map([...snap.positions].map(([p, pp]) => [p, houseFromSign(pp.signIndex, sign)]));
}

export type Bucket = "fav" | "neutral" | "unfav" | "chandrashtama";

/** Library §3 pb bucket — favorability bucket of a planet's house for one sign. */
export function houseBucket(planet: PlanetName, sign: HoroscopeSign, snap: Snapshot): Bucket {
  const pos = snap.positions.get(planet);
  if (!pos) return "neutral";
  const house = houseFromSign(pos.signIndex, signIndex(sign));
  if (planet === "Moon" && house === 8) return "chandrashtama";
  if (FAVORABLE_HOUSES[planet].includes(house)) return "fav";
  return "unfav"; // §2.1 treats non-favorable as unfavorable (see hasExplicitUnfavorable)
}

export interface CategoryScore {
  category: string;
  score: number;
  rating: Rating;
  retroReview: boolean;
  topPositive: { planet: PlanetName; house: number; b: number } | null;
  topNegative: { planet: PlanetName; house: number; b: number } | null;
}

/** §4 — category score with Sade Sati / boosts applied. */
export function categoryScore(
  category: string,
  sign: HoroscopeSign,
  snap: Snapshot,
): CategoryScore {
  const weights = CATEGORY_WEIGHTS[category];
  if (!weights) throw new Error(`unknown category ${category}`);
  let score = 0;
  let retroReview = false;
  let topPositive: CategoryScore["topPositive"] = null;
  let topNegative: CategoryScore["topNegative"] = null;

  for (const [planetRaw, w] of Object.entries(weights) as Array<[PlanetName, number | undefined]>) {
    if (w === undefined) continue;
    const ben = planetBenefit(planetRaw, sign, snap);
    if (ben.retroDemoted) retroReview = true;
    score += w * ben.b;
    if (!topPositive || ben.b > topPositive.b) {
      if (ben.b > 0) topPositive = { planet: planetRaw, house: ben.house, b: ben.b };
    }
    if (!topNegative || ben.b < topNegative.b) {
      if (ben.b < 0) topNegative = { planet: planetRaw, house: ben.house, b: ben.b };
    }
  }

  // §4.3 Sade Sati / Dhaiya modifier on Health, Family, Career
  const saturnBen = planetBenefit("Saturn", sign, snap);
  const saturnMod = SATURN_HOUSE_MODIFIER[saturnBen.house];
  const modifiable = category === "health" || category === "family" || category === "career";
  if (modifiable && saturnMod) score += saturnMod.delta * (score > 0 ? 1 : 0.5);

  // §4.4 Jupiter-on-the-rashi boost
  const jupBen = planetBenefit("Jupiter", sign, snap);
  if (jupBen.house === 1) score += 0.1;

  return { category, score, rating: ratingFromScore(score), retroReview, topPositive, topNegative };
}

/** Overall day score for a sign = mean of the six daily categories (§7.4 best/testing basis). */
export const DAILY_CATEGORIES = [
  "health",
  "education",
  "career",
  "wealth",
  "love",
  "family",
] as const;

export function dayOverallScore(sign: HoroscopeSign, snap: Snapshot): number {
  let sum = 0;
  for (const cat of DAILY_CATEGORIES) sum += categoryScore(cat, sign, snap).score;
  return sum / DAILY_CATEGORIES.length;
}

/** §4.5 aggregation — mean of per-day category scores. */
export function aggregateCategory(
  category: string,
  sign: HoroscopeSign,
  snaps: Snapshot[],
): { score: number; rating: Rating; retroReview: boolean } {
  let sum = 0;
  let retroReview = false;
  for (const snap of snaps) {
    const cs = categoryScore(category, sign, snap);
    sum += cs.score;
    if (cs.retroReview) retroReview = true;
  }
  const score = snaps.length ? sum / snaps.length : 0;
  return { score, rating: ratingFromScore(score), retroReview };
}

/** Sade Sati phase info for a sign from Saturn's current house (§4.3), or null. */
export function sadeSatiPhaseFor(sign: HoroscopeSign, snap: Snapshot) {
  const house = houseFromSign(snap.positions.get("Saturn")!.signIndex, signIndex(sign));
  const mod = SATURN_HOUSE_MODIFIER[house];
  if (!mod) return null;
  return { house, ...mod };
}

/** Yearly driver (§7.2): which slow-planet factor dominated the area's year. */
export type Driver = "jupiter-good" | "saturn-phase" | "rahu-axis" | "mixed" | "steady";

export function driverFor(category: string, sign: HoroscopeSign, snaps: Snapshot[]): Driver {
  let jup = 0;
  let sat = 0;
  let rahu = 0;
  let other = 0;
  const weights = CATEGORY_WEIGHTS[category] ?? {};
  for (const snap of snaps) {
    for (const [planet, w] of Object.entries(weights) as Array<[PlanetName, number | undefined]>) {
      if (w === undefined) continue;
      const ben = planetBenefit(planet, sign, snap);
      if (planet === "Jupiter") jup += w * ben.b;
      else if (planet === "Saturn") sat += w * ben.b;
      else if (planet === "Rahu" || planet === "Ketu") rahu += w * ben.b;
      else other += w * ben.b;
    }
  }
  const n = Math.max(1, snaps.length);
  const parts = [
    { name: "jupiter-good", v: jup / n },
    { name: "saturn-phase", v: sat / n },
    { name: "rahu-axis", v: rahu / n },
    { name: "mixed", v: other / n },
  ].sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const top = parts[0]!;
  // If nothing clearly dominates, the year reads as "steady".
  if (Math.abs(top.v) < 0.05) return "steady";
  return top.name as Driver;
}
