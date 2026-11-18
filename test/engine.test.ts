import { describe, expect, it } from "bun:test";
import * as Astronomy from "astronomy-engine";
import {
  computePanchang,
  ENGINE_VERSION,
  elongation,
  lahiriAyanamsha,
  moonSiderealLon,
  sunRiseSet,
  sunSiderealLon,
} from "../src/engine";

/**
 * QA-mindset validation (PRD §8: "validate against known sample dates/charts").
 * Anchors:
 *  1. Lahiri ayanamsha 2026 ≈ 24°14′ (published tables) → assert 24.15–24.30°
 *  2. Sun enters sidereal Capricorn (Makar Sankranti) on 2026-01-14/15 IST
 *  3. Internal consistency: elongation at astronomy-engine's own full-moon
 *     instant must be ≈ 180°
 *  4. Sunrise Delhi 2026-01-01 ≈ 07:12 IST (published) → window assert
 *  5. Tithi boundaries: at elongation just below/above 180° the tithi must be
 *     Purnima(15) / Krishna Pratipada(16)
 *  6. Structural invariants on every computed Panchang
 */

const DELHI = { latitude: 28.6139, longitude: 77.209, timezone: "Asia/Kolkata" };

describe("ayanamsha", () => {
  it("matches published Lahiri value for 2026 within ±0.08°", () => {
    const a = lahiriAyanamsha(new Date("2026-01-15T00:00:00Z"));
    expect(a).toBeGreaterThan(24.15);
    expect(a).toBeLessThan(24.31);
  });

  it("grows slowly (≈50.3″/yr) and stays in a sane range", () => {
    const a1950 = lahiriAyanamsha(new Date("1950-01-01T00:00:00Z"));
    const a2050 = lahiriAyanamsha(new Date("2050-01-01T00:00:00Z"));
    // Published Lahiri 1950-01-01 ≈ 23°09′ (23.15°); 2050 ≈ 24°34′ (24.57°)
    expect(a1950).toBeGreaterThan(23.1);
    expect(a1950).toBeLessThan(23.25);
    expect(a2050).toBeGreaterThan(24.2);
    expect(a2050).toBeLessThan(24.7);
    expect(a2050 - a1950).toBeGreaterThan(1.35);
    expect(a2050 - a1950).toBeLessThan(1.45);
  });
});

describe("sidereal sun — Makar Sankranti anchor", () => {
  it("sun enters sidereal Capricorn (>270°) on 2026-01-14 or 2026-01-15 IST", () => {
    const before = sunSiderealLon(new Date("2026-01-13T18:30:00Z")); // 2026-01-14 00:00 IST
    const after = sunSiderealLon(new Date("2026-01-15T18:30:00Z")); // 2026-01-16 00:00 IST
    expect(before).toBeLessThan(270);
    expect(after).toBeGreaterThan(270);
  });

  it("sidereal longitude is tropical minus ~24° (order-of-magnitude guard)", () => {
    const d = new Date("2026-03-20T00:00:00Z"); // near equinox: tropical ≈ 359°
    const tropical = Astronomy.SunPosition(d).elon;
    const sid = sunSiderealLon(d);
    const diff = (tropical - sid + 360) % 360;
    expect(diff).toBeGreaterThan(24.0);
    expect(diff).toBeLessThan(24.5);
  });
});

describe("elongation consistency", () => {
  it("matches astronomy-engine full moon (elongation ≈ 180° at its instant)", () => {
    const fullMoon = Astronomy.SearchMoonPhase(180, new Date("2026-06-01T00:00:00Z"), 40);
    expect(fullMoon).not.toBeNull();
    const el = elongation(fullMoon!.date);
    expect(Math.abs(el - 180)).toBeLessThan(0.5);
  });

  it("matches new moon (elongation ≈ 0/360)", () => {
    const newMoon = Astronomy.SearchMoonPhase(0, new Date("2026-07-01T00:00:00Z"), 40);
    expect(newMoon).not.toBeNull();
    const el = elongation(newMoon!.date);
    expect(el < 1 || el > 359).toBe(true);
  });
});

describe("sunrise — Delhi anchor", () => {
  it("Delhi sunrise on 2026-01-01 is ≈ 07:12 IST (published value is rounded — assert window)", () => {
    const start = new Date("2025-12-31T18:30:00Z"); // 2026-01-01 00:00 IST
    const { rise, set } = sunRiseSet(start, DELHI.latitude, DELHI.longitude);
    expect(rise).not.toBeNull();
    expect(set).not.toBeNull();
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(rise!);
    // Published almanacs show 07:12–07:14 for Delhi on this date (model/atmosphere variance)
    expect(local >= "07:10" && local <= "07:15").toBe(true);
  });
});

describe("tithi boundary semantics", () => {
  it("Purnima at elongation just below 180°, Krishna Pratipada just above", () => {
    // Pick elongation 179° and 181° by scanning instants around a full moon
    const full = Astronomy.SearchMoonPhase(180, new Date("2026-09-01T00:00:00Z"), 40)!;
    const minus = new Date(full.date.getTime() - 3600 * 1000); // ~1h before full ≈ elong 179
    const plus = new Date(full.date.getTime() + 3600 * 1000);
    const tithiAt = (d: Date) => Math.floor(elongation(d) / 12) + 1;
    expect(tithiAt(minus)).toBe(15);
    expect(tithiAt(plus)).toBe(16);
  });
});

describe("computePanchang structural invariants", () => {
  const p = computePanchang({ date: "2026-11-19", ...DELHI });

  it("returns engine version and vedic day window", () => {
    expect(p.engine_version).toBe(ENGINE_VERSION);
    expect(new Date(p.vedic_day.sunrise).getTime()).toBeLessThan(
      new Date(p.vedic_day.sunset).getTime(),
    );
    expect(new Date(p.vedic_day.sunset).getTime()).toBeLessThan(
      new Date(p.vedic_day.next_sunrise).getTime(),
    );
  });

  it("at least one window per limb, all inside the vedic day", () => {
    for (const limb of ["tithi", "nakshatra", "yoga", "karana"] as const) {
      expect(p[limb].length).toBeGreaterThan(0);
      const total = p[limb].length;
      expect(total).toBeLessThan(10); // degenerate-loop guard
      for (const w of p[limb]) {
        expect(new Date(w.start).getTime()).toBeGreaterThanOrEqual(
          new Date(p.vedic_day.sunrise).getTime(),
        );
        expect(new Date(w.end).getTime()).toBeLessThanOrEqual(
          new Date(p.vedic_day.next_sunrise).getTime(),
        );
      }
      // windows are contiguous: each start equals previous end
      for (let i = 1; i < p[limb].length; i++) {
        const prev = p[limb][i - 1]!;
        const curr = p[limb][i]!;
        expect(curr.start).toBe(prev.end);
      }
    }
  });

  it("tithi indices are in 1..30 and names non-empty", () => {
    for (const w of p.tithi) {
      expect(w.index).toBeGreaterThanOrEqual(1);
      expect(w.index).toBeLessThanOrEqual(30);
      expect(w.name.length).toBeGreaterThan(0);
    }
  });

  it("nakshatra indices are in 1..27 with Devanagari names", () => {
    for (const w of p.nakshatra) {
      expect(w.index).toBeGreaterThanOrEqual(1);
      expect(w.index).toBeLessThanOrEqual(27);
      expect(w.name_hi).toBeTruthy();
    }
  });

  it("day-segment windows lie inside sunrise→sunset and carry review flags", () => {
    const rise = new Date(p.vedic_day.sunrise).getTime();
    const set = new Date(p.vedic_day.sunset).getTime();
    for (const s of [p.rahu_kaal, p.yamaganda, p.gulika]) {
      const sT = new Date(s.start).getTime();
      const eT = new Date(s.end).getTime();
      expect(sT).toBeGreaterThanOrEqual(rise - 1000);
      expect(eT).toBeLessThanOrEqual(set + 1000);
      expect(s.verified).toBe(false); // pending Jyotishi review (P11)
    }
    expect(p.abhijit.verified).toBe(true);
    expect(p.brahma_muhurta.verified).toBe(true);
  });

  it("works for a foreign timezone (London) without crossing-window errors", () => {
    const p2 = computePanchang({
      date: "2026-06-15",
      latitude: 51.5074,
      longitude: -0.1278,
      timezone: "Europe/London",
    });
    expect(p2.tithi.length).toBeGreaterThan(0);
    expect(p2.vaar.name.length).toBeGreaterThan(0);
  });

  it("handles leap-year date", () => {
    const p3 = computePanchang({ date: "2028-02-29", ...DELHI });
    expect(p3.tithi.length).toBeGreaterThan(0);
  });

  it("REGRESSION: shows mid-day limb crossings when a boundary falls inside the Vedic day", () => {
    // 2026-11-19 Delhi: elongation 107.84° (Navami) at sunrise → crosses 108°
    // (Dashami boundary) during the day → 119.76° at next sunrise. The engine
    // must show BOTH windows (this bug shipped once — see live cross-check).
    const p = computePanchang({ date: "2026-11-19", ...DELHI });
    expect(p.tithi.length).toBe(2);
    expect(p.tithi[0]!.index).toBe(9); // Shukla Navami at sunrise
    expect(p.tithi[1]!.index).toBe(10); // Shukla Dashami after crossing
    expect(p.tithi[0]!.end_kind).toBe("crossing");
    expect(p.tithi[1]!.end_kind).toBe("day_end");
  });
});
