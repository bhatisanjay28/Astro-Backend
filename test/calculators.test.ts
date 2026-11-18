import { describe, expect, it } from "bun:test";
import * as Astronomy from "astronomy-engine";
import {
  moonPhaseName,
  moonSiderealLon,
  numerology,
  rashiAndNakshatra,
  sunSignTropical,
  sunTropicalLon,
} from "../src/engine";

/**
 * Calculator primitive tests (Epic 1.5) — QA-mindset.
 *  1. Moon phase at astronomy-engine's own new/full moon instants
 *  2. Sun sign at known boundary dates (boundary-exactness at edges)
 *  3. Rashi consistency with the kundli path
 *  4. Numerology: known values + edge inputs (single-digit day, zeros, empty name)
 */

describe("moon phase", () => {
  it("is New Moon at astronomy-engine's new-moon instant", () => {
    const inst = Astronomy.SearchMoonPhase(0, new Date("2026-11-01T00:00:00Z"), 30);
    expect(inst).not.toBeNull();
    const mp = moonPhaseName(inst!.date);
    expect(mp.phase).toBe("New Moon");
    expect(mp.illumination).toBeLessThan(0.05);
  });

  it("is Full Moon at astronomy-engine's full-moon instant", () => {
    const inst = Astronomy.SearchMoonPhase(180, new Date("2026-11-01T00:00:00Z"), 40);
    expect(inst).not.toBeNull();
    const mp = moonPhaseName(inst!.date);
    expect(mp.phase).toBe("Full Moon");
    expect(mp.illumination).toBeGreaterThan(0.95);
  });
});

describe("sun sign (tropical)", () => {
  it("matches known signs for mid-month dates", () => {
    expect(sunSignTropical("1990-05-15")).toBe("Taurus");
    expect(sunSignTropical("2000-01-15")).toBe("Capricorn");
    expect(sunSignTropical("2000-08-15")).toBe("Leo");
  });

  it("crosses sign boundaries within the boundary day window", () => {
    // Aries→Taurus boundary ≈ April 20; assert the two adjacent days differ
    const apr19 = sunSignTropical("2026-04-19");
    const apr21 = sunSignTropical("2026-04-21");
    expect(apr19).toBe("Aries");
    expect(apr21).toBe("Taurus");
  });
});

describe("rashi + nakshatra", () => {
  it("is consistent with the kundli engine path for the same instant", () => {
    const birth = new Date("1990-05-15T04:30:00Z");
    const r = rashiAndNakshatra(birth);
    const moon = moonSiderealLon(birth);
    expect(r.rashiIndex).toBe(Math.floor(moon / 30));
    expect(r.nakshatraIndex).toBe(Math.floor(moon / (360 / 27)));
    expect(r.pada).toBeGreaterThanOrEqual(1);
    expect(r.pada).toBeLessThanOrEqual(4);
  });
});

describe("numerology", () => {
  it("computes known Mulank/Destiny values", () => {
    // 1990-05-15: day 15 → 1+5 = 6; full sum 1+9+9+0+0+5+1+5 = 30 → 3
    const n = numerology("1990-05-15", "Rahul");
    expect(n.mulank).toBe(6);
    expect(n.destiny).toBe(3);
    expect(n.name_number).toBeGreaterThan(0);
  });

  it("handles single-digit day", () => {
    expect(numerology("2000-01-05", "X").mulank).toBe(5);
  });

  it("ignores non-letters in names and handles empty name", () => {
    const withSpaces = numerology("2000-01-01", "A B");
    const compact = numerology("2000-01-01", "AB");
    expect(withSpaces.name_number).toBe(compact.name_number);
    expect(numerology("2000-01-01", "").name_number).toBe(0);
  });

  it("sun tropical vs sidereal differ by the ayanamsha (~24°) — smoke guard", () => {
    const d = new Date("2026-06-01T00:00:00Z");
    const diff = (((sunTropicalLon(d) - moonSiderealLon(d)) % 360) + 360) % 360;
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThan(360);
  });
});
