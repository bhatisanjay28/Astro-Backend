/**
 * Lucky attribution (ruleset 03-ruleset.md §5).
 *
 * Precedence: strongest benefic of the window (argmax b(p), Ketu allowed for
 * colour/number/deity/mantra but never for direction — its direction is null)
 * → the window's weekday lord → the sign's lord. Whichever planet wins
 * supplies the whole triad (colour + number + direction) plus deity and
 * mantra, so the block never mixes attributions.
 *
 * Emits a structured attribution; the human-readable "why" line is rendered
 * from content_blocks horoscope.lucky_why templates (D12: content lives
 * behind the API, not in code).
 */
import type { PlanetName } from "../engine/kundli";
import { istDateKey, weekdayOf } from "./ist";
import {
  type HoroscopeSign,
  PLANET_ATTRIBUTES,
  PLANET_HI,
  PLANETS,
  SIGN_EN,
  SIGN_HI,
  SIGN_LORD,
  WEEKDAY_PLANET,
} from "./rules";
import { planetBenefit, type Snapshot } from "./score";

export type LuckyBasis = "planet_of_day" | "weekday" | "sign_lord"; // keys match content_blocks horoscope.lucky_why

export interface LuckyAttribution {
  planet: PlanetName;
  house: number | null; // null when attributed by weekday/lord (not a house placement)
  b: number | null;
  basis: LuckyBasis;
}

/**
 * The window's lucky planet for one sign. `snap` is the representative
 * snapshot (daily: the day; weekly/monthly: window start; yearly: year start).
 */
export function luckyAttribution(sign: HoroscopeSign, snap: Snapshot): LuckyAttribution {
  // 1. strongest benefic — strict > keeps earlier planets (PLANETS order) on ties
  let best: { planet: PlanetName; house: number; b: number } | null = null;
  for (const planet of PLANETS) {
    const ben = planetBenefit(planet, sign, snap);
    if (ben.b > 0 && (!best || ben.b > best.b)) {
      best = { planet, house: ben.house, b: ben.b };
    }
  }
  if (best) {
    return { planet: best.planet, house: best.house, b: best.b, basis: "planet_of_day" };
  }

  // 2. weekday lord of the window's representative day (IST calendar date)
  const wdPlanet = WEEKDAY_PLANET[weekdayOf(istDateKey(snap.date))];
  if (wdPlanet) {
    return { planet: wdPlanet, house: null, b: null, basis: "weekday" };
  }

  // 3. sign lord (always resolvable)
  return { planet: SIGN_LORD[sign], house: null, b: null, basis: "sign_lord" };
}

export interface LuckyBlock {
  planet: PlanetName;
  planet_hi: string;
  basis: LuckyBasis;
  house: number | null;
  why: {
    key: LuckyBasis;
    params: {
      planet: string;
      planet_hi: string;
      sign: string; // visitor-facing EN display name (SIGN_EN)
      sign_hi: string;
      house: number | null;
    };
  };
  colours: Array<{ en: string; hi: string; swatch: string }>;
  number: number;
  direction: { en: string; hi: string } | null;
  deity: { en: string; hi: string };
  mantra: { hi: string; en: string };
}

/** Full lucky block payload from an attribution (attributes all from one planet). */
export function luckyBlockFor(sign: HoroscopeSign, snap: Snapshot): LuckyBlock {
  const attr = luckyAttribution(sign, snap);
  const attrs = PLANET_ATTRIBUTES[attr.planet];
  return {
    planet: attr.planet,
    planet_hi: PLANET_HI[attr.planet],
    basis: attr.basis,
    house: attr.house,
    why: {
      key: attr.basis,
      params: {
        planet: attr.planet,
        planet_hi: PLANET_HI[attr.planet],
        sign: SIGN_EN[sign],
        sign_hi: SIGN_HI[sign],
        house: attr.house,
      },
    },
    colours: attrs.colours,
    number: attrs.number,
    direction: attrs.direction, // Ketu → null; frontend hides the direction cell
    deity: attrs.deity,
    mantra: attrs.mantra,
  };
}

/** House ordinal suffix for EN why-lines ("1st", "2nd", "3rd", "11th"...). */
export function houseOrdinal(house: number): string {
  const rem = house % 10;
  const teenth = house % 100;
  if (teenth >= 11 && teenth <= 13) return `${house}th`;
  if (rem === 1) return `${house}st`;
  if (rem === 2) return `${house}nd`;
  if (rem === 3) return `${house}rd`;
  return `${house}th`;
}
