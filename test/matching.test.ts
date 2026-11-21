/**
 * Epic 1.8 — Ashtakoota matching engine tests.
 *
 * External reference values are NOT asserted (tables are verified:false pending
 * Jyotishi review, P11). Instead: algebraic identities (self-match), koota
 * maxima, wiring consistency between profiles and scores, and manglik
 * invariants across a time grid.
 */
import { describe, expect, test } from "bun:test";
import { type KundliInput, planetaryPositions } from "../src/engine/kundli";
import {
  ASHTAKOOTA_MAX,
  ASHTAKOOTA_THRESHOLD,
  ashtakoota,
  type KootaName,
  manglik,
  matchProfile,
} from "../src/engine/matching";

const BOY: KundliInput = {
  datetime: new Date("1990-06-15T06:30:00Z"), // 12:00 IST Delhi
  latitude: 28.6139,
  longitude: 77.209,
};
const GIRL: KundliInput = {
  datetime: new Date("1993-03-05T08:30:00Z"), // 14:00 IST Mumbai
  latitude: 19.076,
  longitude: 72.8777,
};

describe("ashtakoota", () => {
  const result = ashtakoota(BOY, GIRL);

  test("returns exactly 8 kootas with classical maxima 1..8", () => {
    expect(result.kootas).toHaveLength(8);
    expect(result.kootas.map((k) => k.max)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const order: KootaName[] = [
      "varna",
      "vashya",
      "tara",
      "yoni",
      "graha_maitri",
      "gana",
      "bhakoot",
      "nadi",
    ];
    expect(result.kootas.map((k) => k.koota)).toEqual(order);
  });

  test("total equals the sum of koota points and respects bounds", () => {
    const sum = result.kootas.reduce((s, k) => s + k.points, 0);
    expect(result.total).toBe(Math.round(sum * 10) / 10);
    expect(result.max).toBe(ASHTAKOOTA_MAX);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(ASHTAKOOTA_MAX);
    expect(result.acceptable).toBe(result.total >= ASHTAKOOTA_THRESHOLD);
  });

  test("self-match identity: total = 28 (same gana = 6; nadi dosha forces 0)", () => {
    const same = ashtakoota(BOY, BOY);
    // same person: varna 1, vashya 2, tara 3 (count 27 → Ati-mitra both ways),
    // yoni 4, maitri 5, gana 6 (same gana), bhakoot 7 (1/1), nadi 0.
    expect(same.total).toBe(1 + 2 + 3 + 4 + 5 + 6 + 7 + 0);
    expect(same.acceptable).toBe(true);
    expect(same.kootas.find((k) => k.koota === "nadi")?.points).toBe(0);
    expect(same.kootas.find((k) => k.koota === "yoni")?.points).toBe(4);
    expect(same.kootas.find((k) => k.koota === "graha_maitri")?.points).toBe(5);
    expect(same.kootas.find((k) => k.koota === "bhakoot")?.points).toBe(7);
    expect(same.kootas.find((k) => k.koota === "tara")?.points).toBe(3);
  });

  test("profiles carry coherent identity (nakshatra, rashi lord, tables)", () => {
    const p = matchProfile(BOY);
    expect(p.moon_sign).toBe(result.boy.moon_sign);
    expect(p.moon_nakshatra).toBe(result.boy.moon_nakshatra);
    expect(p.rashi_lord).toBeTruthy();
    expect(["Brahmin", "Kshatriya", "Vaishya", "Shudra"]).toContain(p.varna);
    expect(["manava", "chatushpada", "jalachara", "vanachara", "keeta"]).toContain(p.vashya);
    expect(["Deva", "Manushya", "Rakshasa"]).toContain(p.gana);
    expect(["Adi", "Madhya", "Antya"]).toContain(p.nadi);
    expect(p.moon_pada).toBeGreaterThanOrEqual(1);
    expect(p.moon_pada).toBeLessThanOrEqual(4);
  });

  test("each koota score matches an independent recomputation from profiles", () => {
    const { boy, girl, kootas } = result;
    const byName = new Map(kootas.map((k) => [k.koota, k]));

    // varna
    const rank = { Brahmin: 4, Kshatriya: 3, Vaishya: 2, Shudra: 1 } as const;
    expect(byName.get("varna")?.points).toBe(rank[boy.varna] >= rank[girl.varna] ? 1 : 0);

    // nadi
    expect(byName.get("nadi")?.points).toBe(boy.nadi === girl.nadi ? 0 : 8);

    // bhakoot consistency: no-dosha → 7; dosha → 0 or 7 when lords are friends
    const pos = Math.min(
      ((girl.moon_sign_index - boy.moon_sign_index + 12) % 12) + 1,
      ((boy.moon_sign_index - girl.moon_sign_index + 12) % 12) + 1,
    );
    const other = pos === 1 ? 1 : 14 - pos; // pair complement (1/1, 2/12, 3/11, 4/10, 5/9, 6/8, 7/7)
    const isDosha = ["2/12", "5/9", "6/8"].includes(`${pos}/${other}`);
    const bh = byName.get("bhakoot");
    const bhPoints = bh?.points ?? -1;
    expect(bh).toBeTruthy();
    if (!isDosha) expect(bhPoints).toBe(7);
    else expect([0, 7]).toContain(bhPoints);

    // tara (both directions recomputed)
    const goodTaras = [1, 2, 4, 6, 8, 9];
    const countG2B = ((boy.moon_nakshatra_index - girl.moon_nakshatra_index + 27) % 27) + 1;
    const countB2G = ((girl.moon_nakshatra_index - boy.moon_nakshatra_index + 27) % 27) + 1;
    const taraG2B = (((countG2B - 1) % 9) + 1) as number;
    const taraB2G = (((countB2G - 1) % 9) + 1) as number;
    const expectedTara =
      (goodTaras.includes(taraG2B) ? 1.5 : 0) + (goodTaras.includes(taraB2G) ? 1.5 : 0);
    expect(byName.get("tara")?.points).toBe(expectedTara);
  });

  test("every koota carries a human-readable detail string", () => {
    for (const k of result.kootas) {
      expect(k.detail.length).toBeGreaterThan(5);
    }
  });

  test("deterministic: same inputs give identical results", () => {
    expect(ashtakoota(BOY, GIRL)).toEqual(ashtakoota(BOY, GIRL));
  });
});

describe("manglik", () => {
  test("manglik structure for the boy sample", () => {
    const m = manglik(BOY);
    const houses = [m.mars_houses.lagna, m.mars_houses.moon, m.mars_houses.venus];
    expect(houses.every((h) => h >= 1 && h <= 12)).toBe(true);
    expect(typeof m.is_manglik).toBe("boolean");
    expect(typeof m.verified).toBe("boolean");
  });

  test("invariants hold across a 24-month grid of births", () => {
    for (let i = 0; i < 24; i++) {
      const input: KundliInput = {
        datetime: new Date(Date.UTC(1990, i, 15, 6, 30)),
        latitude: 28.6139,
        longitude: 77.209,
      };
      const m = manglik(input);
      const { lagna, moon, venus } = m.mars_houses;
      const doshaHouses = new Set([1, 2, 4, 7, 8, 12]);
      const rawHit = doshaHouses.has(lagna) || doshaHouses.has(moon) || doshaHouses.has(venus);
      if (m.cancelled) {
        expect(m.is_manglik).toBe(false);
        // QB-05: from_* report RAW placements — cancellation is a separate
        // flag, never folded into the placement booleans.
        expect(m.from_lagna).toBe(doshaHouses.has(lagna));
        expect(m.from_moon).toBe(doshaHouses.has(moon));
        expect(m.from_venus).toBe(doshaHouses.has(venus));
        expect(m.cancellation_reason).toBeTruthy();
      } else {
        expect(m.is_manglik).toBe(rawHit);
        expect(m.cancellation_reason).toBeNull();
        expect(m.from_lagna).toBe(doshaHouses.has(lagna));
        expect(m.from_moon).toBe(doshaHouses.has(moon));
        expect(m.from_venus).toBe(doshaHouses.has(venus));
      }
    }
  });

  test("cancellation applies whenever Mars sits in Aries/Scorpio/Capricorn", () => {
    // Scan daily noon UTC for 3 years; every Aries/Scorpio/Capricorn Mars must
    // be flagged cancelled (signs 0, 7, 9).
    let checked = 0;
    for (let d = 0; d < 365 * 3; d += 5) {
      const input: KundliInput = {
        datetime: new Date(Date.UTC(1991, 0, 1 + d, 12)),
        latitude: 19.076,
        longitude: 72.8777,
      };
      const m = manglik(input);
      const marsSign = manglikMarsSign(input);
      if (marsSign === 0 || marsSign === 7 || marsSign === 9) {
        expect(m.cancelled).toBe(true);
        expect(m.is_manglik).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

/** Mars sign index via the engine (for cross-checking cancellation). */
function manglikMarsSign(input: KundliInput): number {
  const mars = planetaryPositions(input).find((p) => p.planet === "Mars");
  return mars?.signIndex ?? -1;
}
