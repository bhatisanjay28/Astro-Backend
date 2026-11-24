/**
 * Horoscope scorer + lucky attribution golden cases (Step 4; ruleset §2–§5).
 *
 * Snapshots are fabricated (all nine planets at chosen sign indexes) so each
 * table entry — favorable houses, vedha pairs, exemptions, retro demotion,
 * Sade Sati modifiers — is pinned in isolation.
 */
import { describe, expect, test } from "bun:test";
import type { PlanetName, PlanetPosition } from "../src/engine/kundli";
import { houseOrdinal, luckyAttribution, luckyBlockFor } from "../src/horoscope/lucky";
import {
  CATEGORY_WEIGHTS,
  HOROSCOPE_SIGNS,
  PLANETS,
  ratingFromScore,
  SATURN_HOUSE_MODIFIER,
  vedhaObstructor,
} from "../src/horoscope/rules";
import {
  aggregateCategory,
  categoryScore,
  dayOverallScore,
  driverFor,
  houseBucket,
  planetBenefit,
  type Snapshot,
  snapshotAt,
} from "../src/horoscope/score";

/** Fabricate a full 9-planet snapshot: planet → signIndex (0=Aries…), retro flags. */
function snap(
  at: Partial<Record<PlanetName, number>>,
  retro: Partial<Record<PlanetName, boolean>> = {},
  date = new Date("2026-11-24T00:05:00+05:30"),
): Snapshot {
  const positions = new Map<PlanetName, PlanetPosition>();
  for (const p of PLANETS) {
    const signIndex = at[p] ?? 0;
    positions.set(p, {
      planet: p,
      lon: signIndex * 30 + 5,
      sign: "test",
      signIndex,
      nakshatra: "Ashwini",
      nakshatraIndex: 0,
      pada: 1,
      retrograde: retro[p] ?? false,
    });
  }
  return { date, positions };
}

describe("rules tables", () => {
  test("category weights sum to 1 where defined", () => {
    for (const [cat, weights] of Object.entries(CATEGORY_WEIGHTS)) {
      const sum = Object.values(weights).reduce<number>((a, w) => a + (w ?? 0), 0);
      expect(sum).toBeCloseTo(1, 5);
      void cat;
    }
  });

  test("Saturn modifier table covers exactly Sade Sati + Dhaiya + Ashtama houses", () => {
    expect(Object.keys(SATURN_HOUSE_MODIFIER).sort()).toEqual(["1", "12", "2", "4", "8"]);
  });

  test("vedhaObstructor honours exemptions and node/Moon exclusion", () => {
    // positions: planet → HOUSE number for Aries
    const positions = new Map<PlanetName, number>([
      ["Sun", 3],
      ["Saturn", 12], // obstructs Jupiter@2 (pair 2←12)
      ["Moon", 1],
      ["Mercury", 5], // would obstruct Moon@1, but Moon↔Mercury is exempt
      ["Mars", 5], // also obstructs Moon@1 — Moon↔Mars is NOT exempt
    ]);
    expect(vedhaObstructor("Jupiter", 2, positions)).toBe("Saturn");
    expect(vedhaObstructor("Sun", 3, positions)).toBeNull(); // exemption
    expect(vedhaObstructor("Moon", 1, positions)).toBe("Mars"); // Mercury exempt, Mars is not
    // nodes receive no vedha (VEDHA_PAIRS empty)
    expect(vedhaObstructor("Rahu", 3, positions)).toBeNull();
    // Moon never obstructs (MOON_AS_OBSTRUCTOR false): Mercury@2 needs house 5, only Moon there
    const moonOnly = new Map<PlanetName, number>([["Moon", 5]]);
    expect(vedhaObstructor("Mercury", 2, moonOnly)).toBeNull();
    // Mars@3 obstructed by a planet in house 12 — Saturn is there
    expect(vedhaObstructor("Mars", 3, positions)).toBe("Saturn");
    // nobody at the obstructing house → null
    expect(vedhaObstructor("Venus", 6, positions)).toBeNull(); // pair 6←7, house 7 empty
  });
});

describe("planetBenefit", () => {
  test("favorable without vedha → b = 1", () => {
    const s = snap({ Sun: 2 }); // Sun in Gemini = house 3 from Aries
    const ben = s.positions.get("Sun");
    void ben;

    const r = planetBenefit("Sun", "aries", s);
    expect(r.b).toBe(1);
    expect(r.favorable).toBe(true);
    expect(r.vedha).toBe(false);
  });

  test("vedha dampens to 0.2, not zero (§2.2)", () => {
    // Jupiter in Taurus (house 2, favorable); Saturn in Pisces (house 12) obstructs Jupiter@2
    const s = snap({ Jupiter: 1, Saturn: 11 });

    const r = planetBenefit("Jupiter", "aries", s);
    expect(r.favorable).toBe(true);
    expect(r.vedha).toBe(true);
    expect(r.b).toBeCloseTo(0.2, 5);
  });

  test("Sun↔Saturn exemption keeps Sun at b = 1", () => {
    // Sun in Gemini (house 3); Saturn in Sagittarius (house 9) — exempt pair
    const s = snap({ Sun: 2, Saturn: 8 });

    const r = planetBenefit("Sun", "aries", s);
    expect(r.vedha).toBe(false);
    expect(r.b).toBe(1);
  });

  test("retrograde demotes positive planets ×0.6, never the nodes (§3)", () => {
    const s = snap({ Mercury: 1, Rahu: 2 }, { Mercury: true, Rahu: true });
    const merc = planetBenefit("Mercury", "aries", s); // Taurus = house 2 (favorable for Mercury)
    expect(merc.retroDemoted).toBe(true);
    expect(merc.b).toBeCloseTo(0.6, 5);
    const rahu = planetBenefit("Rahu", "aries", s); // Gemini = house 3 (favorable for nodes)
    expect(rahu.b).toBe(1);
    expect(rahu.retroDemoted).toBe(false);
  });

  test("retrograde does not deepen an unfavorable placement", () => {
    const s = snap({ Sun: 0 }, { Sun: true }); // Sun in Aries = house 1 (unfavorable)
    const r = planetBenefit("Sun", "aries", s);
    expect(r.b).toBe(-1);
    expect(r.retroDemoted).toBe(false);
  });

  test("Rahu/Ketu house 10 → weak positive 0.5", () => {
    const s = snap({ Rahu: 9, Ketu: 9 }); // Capricorn = house 10
    expect(planetBenefit("Rahu", "aries", s).b).toBeCloseTo(0.5, 5);
    expect(planetBenefit("Ketu", "aries", s).b).toBeCloseTo(0.5, 5);
  });

  test("non-favorable houses are unfavorable (−1) per §2.1", () => {
    const s = snap({ Sun: 0 }); // Aries = house 1
    expect(planetBenefit("Sun", "aries", s).b).toBe(-1);
  });
});

describe("houseBucket", () => {
  test("Moon house 8 → chandrashtama; Mercury house 8 → fav", () => {
    const s = snap({ Moon: 7, Mercury: 7 }); // Scorpio = house 8
    expect(houseBucket("Moon", "aries", s)).toBe("chandrashtama");
    expect(houseBucket("Mercury", "aries", s)).toBe("fav");
  });
});

describe("categoryScore", () => {
  test("fully favorable health day scores 1.0 → excellent", () => {
    const s = snap({ Moon: 0, Sun: 2, Saturn: 5, Mars: 5, Rahu: 5, Ketu: 10, Jupiter: 3 });
    // Moon h1, Sun h3, Saturn h6, Mars h6, Rahu h6, Ketu h11 — all favorable;
    // Saturn at h6 (favorable, no Sade Sati modifier), Jupiter h4 (no H1 boost)
    const cs = categoryScore("health", "aries", s);
    expect(cs.score).toBeCloseTo(1.0, 5);
    expect(cs.rating).toBe("excellent");
  });

  test("Sade Sati rising phase (Saturn h12): unfavorable placement + −0.20 modifier ×1", () => {
    const s = snap({ Moon: 0, Sun: 2, Saturn: 11, Mars: 5, Rahu: 5, Ketu: 10, Jupiter: 3 });
    // Saturn h12 is BOTH an unfavorable placement (−0.2 weight) and a Sade Sati
    // modifier: 0.8 (others max) − 0.2 (Saturn unfav) − 0.2×1 (score > 0) → 0.4
    const cs = categoryScore("health", "aries", s);
    expect(cs.score).toBeCloseTo(0.4, 5);
    expect(cs.rating).toBe("excellent");
  });

  test("modifier damping halves on a negative category score (§4.3)", () => {
    const s = snap({ Moon: 7, Sun: 0, Saturn: 11, Mars: 11, Rahu: 0, Ketu: 1, Jupiter: 3 });
    // Moon h8 −0.3, Sun h1 −0.2, Saturn h12 −0.2, Mars h12 −0.15, Rahu h1 −0.1, Ketu h2 −0.05
    // base −1.0; Saturn mod −0.2 × 0.5 → −1.1 (Jupiter h4 keeps the §4.4 boost out)
    const cs = categoryScore("health", "aries", s);
    expect(cs.score).toBeCloseTo(-1.1, 5);
    expect(cs.rating).toBe("challenging");
  });

  test("Jupiter on the rashi adds +0.10 to every category (§4.4)", () => {
    const s = snap({ Mercury: 3, Jupiter: 0, Venus: 1, Moon: 5 });
    // education: Mercury h4 (fav +0.4), Jupiter h1 (unfav −0.35) + H1 boost +0.1,
    // Venus h2 (fav +0.15), Moon h6 (fav +0.1) → 0.4 − 0.35 + 0.15 + 0.1 + 0.1 = 0.4
    const cs = categoryScore("education", "aries", s);
    expect(cs.score).toBeCloseTo(0.4, 5);
    expect(cs.rating).toBe("excellent");
    // the boost applies even where Jupiter carries no weight in the category
    const s2 = snap({ Jupiter: 0, Moon: 7, Sun: 0, Saturn: 11, Mars: 11, Rahu: 0, Ketu: 1 });
    // health base −1.0, Saturn mod −0.1, boost +0.1 → −1.0 (vs −1.1 without the boost)
    expect(categoryScore("health", "aries", s2).score).toBeCloseTo(-1.0, 5);
  });

  test("retrograde flag surfaces as retroReview for Mercury/Jupiter/Saturn categories", () => {
    const s = snap({ Mercury: 3 }, { Mercury: true });
    const cs = categoryScore("education", "aries", s);
    expect(cs.retroReview).toBe(true);
  });
});

describe("rating bands (§4.2)", () => {
  test("exact thresholds", () => {
    expect(ratingFromScore(0.35)).toBe("excellent");
    expect(ratingFromScore(0.34)).toBe("good");
    expect(ratingFromScore(0.1)).toBe("good");
    expect(ratingFromScore(0.09)).toBe("moderate");
    expect(ratingFromScore(-0.09)).toBe("moderate");
    expect(ratingFromScore(-0.1)).toBe("challenging"); // band rule is >−0.10, not ≥
    expect(ratingFromScore(-0.11)).toBe("challenging");
  });
});

describe("aggregation", () => {
  test("dayOverallScore = mean of six daily categories", () => {
    const s = snap({ Moon: 0, Sun: 2, Saturn: 5, Mars: 5, Rahu: 5, Ketu: 10, Jupiter: 3 });
    const expected =
      (categoryScore("health", "aries", s).score +
        categoryScore("education", "aries", s).score +
        categoryScore("career", "aries", s).score +
        categoryScore("wealth", "aries", s).score +
        categoryScore("love", "aries", s).score +
        categoryScore("family", "aries", s).score) /
      6;
    expect(dayOverallScore("aries", s)).toBeCloseTo(expected, 5);
  });

  test("aggregateCategory averages per-day scores across snapshots", () => {
    const s1 = snap({ Moon: 0, Sun: 2, Saturn: 5, Mars: 5, Rahu: 5, Ketu: 10, Jupiter: 3 });
    const s2 = snap({ Moon: 7, Sun: 0, Saturn: 11, Mars: 11, Rahu: 0, Ketu: 1, Jupiter: 3 });
    const agg = aggregateCategory("health", "aries", [s1, s2]);
    expect(agg.score).toBeCloseTo((1.0 + -1.1) / 2, 5);
    expect(agg.rating).toBe("moderate"); // −0.05 → moderate
  });

  test("driverFor picks the dominating slow planet (jupiter-good)", () => {
    const s = snap({ Jupiter: 1, Venus: 0, Moon: 1, Mars: 0 });
    // love contributions: Jupiter w.15×+1 = 0.15; mixed = Venus .4×(+1) + Moon .3×(−1)
    // + Mars .15×(−1) = −0.05 → |jupiter| dominates → jupiter-good
    expect(driverFor("love", "aries", [s])).toBe("jupiter-good");
  });
});

describe("lucky attribution (§5)", () => {
  test("strongest benefic wins with basis planet_of_day", () => {
    const s = snap({ Jupiter: 1, Venus: 11, Sun: 2 });
    // Jupiter h2 (+1) beats Sun h3 (+1)? strict > keeps FIRST planet on tie → Sun (PLANETS order)
    const attr = luckyAttribution("aries", s);
    expect(attr.basis).toBe("planet_of_day");
    expect(attr.planet).toBe("Sun"); // tie at b=1 → PLANETS order (Sun before Jupiter)
    expect(attr.house).toBe(3);
  });

  test("Ketu may win the triad but direction stays null (§5)", () => {
    // Only Ketu favorable: Ketu h3 (+1); everyone else unfavorable or non-favorable
    const s = snap({
      Sun: 0,
      Moon: 1,
      Mars: 0,
      Mercury: 0,
      Jupiter: 3,
      Venus: 5,
      Saturn: 0,
      Rahu: 0,
      Ketu: 2,
    });
    // Ketu in Gemini = house 3 (+1). Rahu h1 (−1). Jupiter h4 (unfav). Venus h6 (unfav).
    const block = luckyBlockFor("aries", s);
    expect(block.planet).toBe("Ketu");
    expect(block.direction).toBeNull();
    expect(block.deity.en).toBe("Ganesha");
    expect(block.number).toBe(7);
  });

  test("weekday basis applies when no planet is positive", () => {
    const s = snap({
      Sun: 0,
      Moon: 1,
      Mars: 0,
      Mercury: 0,
      Jupiter: 3,
      Venus: 5,
      Saturn: 0,
      Rahu: 0,
      Ketu: 0,
    });
    const attr = luckyAttribution("aries", s);
    expect(attr.basis).toBe("weekday");
    expect(attr.house).toBeNull();
  });

  test("house ordinals", () => {
    expect(houseOrdinal(1)).toBe("1st");
    expect(houseOrdinal(2)).toBe("2nd");
    expect(houseOrdinal(3)).toBe("3rd");
    expect(houseOrdinal(4)).toBe("4th");
    expect(houseOrdinal(11)).toBe("11th");
    expect(houseOrdinal(12)).toBe("12th");
  });
});

describe("real ephemeris smoke", () => {
  test("snapshotAt returns all nine planets for a real instant", () => {
    const s = snapshotAt(new Date("2026-11-24T00:05:00+05:30"));
    expect(s.positions.size).toBe(9);
    for (const sign of HOROSCOPE_SIGNS) {
      const score = dayOverallScore(sign, s);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeLessThanOrEqual(1.2); // 1.0 raw + Jupiter H1 boost ceiling
    }
  });
});
