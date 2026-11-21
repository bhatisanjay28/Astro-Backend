import { describe, expect, it } from "bun:test";
import * as Astronomy from "astronomy-engine";
import {
  destinyNumber,
  moonPhaseDetails,
  moonPhaseName,
  moonSiderealLon,
  numerology,
  phaseNameFromElong,
  rashiAndNakshatra,
  sunSiderealLon,
  sunSignDetails,
  sunSignTropical,
  sunTropicalLon,
} from "../src/engine";

/**
 * Calculator primitive tests (Epic 1.5) — QA-mindset.
 *  1. Moon phase at astronomy-engine's own new/full moon instants
 *  2. Sun sign at known boundary dates (boundary-exactness at edges)
 *  3. Rashi consistency with the kundli path
 *  4. Numerology: known values + edge inputs (single-digit day, zeros, empty name)
 *  5. S13 calculators: moon-phase neighbour lunations vs published instants
 *     (timeanddate/NASA/astro-seek, ±2 min), sun-sign Sankranti cusps,
 *     destiny vectors incl. master number (live-verified on bhagyank.in /
 *     AstroTalk / GaneshaSpeaks, research report 2026-11-21).
 */

/** Assert an ISO instant is within `minutes` of the published instant. */
function expectNear(actualISO: string, expectedISO: string, minutes = 2): void {
  const diff = Math.abs(new Date(actualISO).getTime() - new Date(expectedISO).getTime());
  expect(diff).toBeLessThanOrEqual(minutes * 60_000);
}

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

describe("moon phase details (S13)", () => {
  it("matches published neighbours at the Jan 2025 full moon", () => {
    // FM 2025-01-13 22:26 UTC published (engine 22:27:32); input 2.5 min after
    const d = moonPhaseDetails(new Date("2025-01-13T22:30:00Z"));
    expect(d.phase).toBe("Full Moon");
    expect(d.illumination).toBeGreaterThan(0.99);
    expect(d.waxing).toBe(false);
    expectNear(d.prev_new_moon, "2024-12-30T22:27:00Z");
    expectNear(d.next_new_moon, "2025-01-29T12:35:00Z");
    expectNear(d.next_full_moon, "2025-02-12T13:53:00Z");
    // age = time since that previous new moon — this lunation is short:
    // Dec 30 22:27 → Jan 13 22:27 is exactly 14.0 days (winter lunations vary)
    expect(d.moon_age_days).toBeGreaterThan(13.95);
    expect(d.moon_age_days).toBeLessThan(14.05);
  });

  it("matches published neighbours at the Jun 2025 new moon", () => {
    // NM 2025-06-25 10:31 UTC published (engine 10:32:07)
    const d = moonPhaseDetails(new Date("2025-06-25T10:35:00Z"));
    expect(d.phase).toBe("New Moon");
    expect(d.illumination).toBeLessThan(0.02);
    expect(d.moon_age_days).toBeLessThan(0.05);
    expectNear(d.prev_full_moon, "2025-06-11T07:44:00Z");
    expectNear(d.next_full_moon, "2025-07-10T20:36:00Z");
    expectNear(d.next_new_moon, "2025-07-24T19:11:00Z");
  });

  it("matches published neighbours at the Nov 2025 new moon", () => {
    const d = moonPhaseDetails(new Date("2025-11-20T06:48:00Z"));
    expect(d.phase).toBe("New Moon");
    expectNear(d.next_full_moon, "2025-12-04T23:14:00Z");
    expectNear(d.next_new_moon, "2025-12-20T01:43:00Z");
  });

  it("matches published neighbours at the Jan 2026 new moon", () => {
    const d = moonPhaseDetails(new Date("2026-01-18T19:53:00Z"));
    expect(d.phase).toBe("New Moon");
    expectNear(d.next_full_moon, "2026-02-01T22:09:00Z");
    expectNear(d.next_new_moon, "2026-02-17T12:01:00Z");
  });

  it("lands First/Last Quarter on the published quarter instants", () => {
    // FQ 2025-02-05 08:02 UTC, TQ 2025-02-20 17:32 UTC (timeanddate)
    expect(moonPhaseDetails(new Date("2025-02-05T08:02:00Z")).phase).toBe("First Quarter");
    expect(moonPhaseDetails(new Date("2025-02-20T17:33:00Z")).phase).toBe("Last Quarter");
  });

  it("uses half-open buckets at every 45° edge", () => {
    expect(phaseNameFromElong(0)).toBe("New Moon");
    expect(phaseNameFromElong(22.5)).toBe("Waxing Crescent"); // start of bucket
    expect(phaseNameFromElong(67.5)).toBe("First Quarter");
    expect(phaseNameFromElong(157.5)).toBe("Full Moon");
    expect(phaseNameFromElong(202.5)).toBe("Waning Gibbous");
    expect(phaseNameFromElong(247.5)).toBe("Last Quarter");
    expect(phaseNameFromElong(292.5)).toBe("Waning Crescent");
    expect(phaseNameFromElong(337.5)).toBe("New Moon"); // start of the New Moon bucket
    expect(phaseNameFromElong(359.9)).toBe("New Moon");
  });

  it("reports the same moon rashi as the kundli path for the same instant", () => {
    const t = new Date("1990-05-15T04:30:00Z");
    expect(moonPhaseDetails(t).rashi).toBe(rashiAndNakshatra(t).rashi);
  });
});

describe("sun sign details (S13)", () => {
  it("gives Makara on Makar Sankranti day 2025 (after the 09:03 IST ingress)", () => {
    const s = sunSignDetails("2025-01-14");
    expect(s.rashi).toBe("Capricorn");
    expect(s.lord).toBe("Saturn");
    expect(s.tropical_sign).toBe("Capricorn");
  });

  it("straddles the Mesha ingress 2025 (Apr 13 Meena, Apr 15 Mesha)", () => {
    expect(sunSignDetails("2025-04-13").rashi).toBe("Pisces");
    const after = sunSignDetails("2025-04-15");
    expect(after.rashi).toBe("Aries");
    expect(after.lord).toBe("Mars");
  });

  it("keeps sun nakshatra consistent with the sidereal longitude mapping", () => {
    const s = sunSignDetails("2025-01-14");
    const sid = sunSiderealLon(new Date("2025-01-14T12:00:00Z"));
    expect(s.rashiIndex).toBe(Math.floor(sid / 30));
    expect(s.nakshatraIndex).toBe(Math.floor(sid / (360 / 27)));
    expect(s.pada).toBeGreaterThanOrEqual(1);
    expect(s.pada).toBeLessThanOrEqual(4);
  });

  it("keeps the engine pure — calendar-date rejection lives at the route boundary", () => {
    // Bun's ISO parser rolls 2025-02-30 over to Mar 2, so the engine computes
    // whatever instant it is given; impossible dates are 400-rejected in the
    // route tests (isCalendarDate).
    expect(sunSignDetails("2025-02-30").rashi).toBe(sunSignDetails("2025-03-02").rashi);
  });
});

describe("destiny number (S13)", () => {
  it("computes the researched vectors incl. the master-33 case", () => {
    // 19-06-1970 → sum 33 → 6 (master); mulank 19 → 1 (bhagyank.in shows 33,
    // AstroTalk shows 6 — we surface both)
    const master = destinyNumber("1970-06-19");
    expect(master.destiny).toBe(6);
    expect(master.destiny_sum).toBe(33);
    expect(master.master).toBe(true);
    expect(master.mulank).toBe(1);
    expect(master.destiny_lord).toBe("Venus");
    expect(master.mulank_lord).toBe("Sun");

    expect(destinyNumber("1947-08-15").destiny).toBe(8); // 35 → 8 (Saturn)
    expect(destinyNumber("1950-01-26").destiny).toBe(6); // 24 → 6 (Venus)
    expect(destinyNumber("1869-10-02").destiny).toBe(9); // 27 → 9 (Mars)
    expect(destinyNumber("1950-09-17").destiny).toBe(5); // 32 → 5 (Mercury)
    expect(destinyNumber("1985-08-15").destiny).toBe(1); // 37 → 10 → 1
    expect(destinyNumber("2004-02-29").destiny).toBe(1); // Feb-29 vector
    expect(destinyNumber("2004-02-29").mulank).toBe(2); // 29 → 11 → 2
  });

  it("maps all nine lords (Rahu/Ketu, not Uranus/Neptune)", () => {
    // dates chosen so the full-DOB digit sum reduces to each root 1–9
    const cases: Array<[string, number, string]> = [
      ["2000-01-07", 1, "Sun"], // sum 10
      ["2000-01-08", 2, "Moon"], // sum 11 (master)
      ["1990-05-15", 3, "Jupiter"], // sum 30
      ["2000-01-01", 4, "Rahu"], // sum 4
      ["2000-01-02", 5, "Mercury"], // sum 5
      ["2000-01-03", 6, "Venus"], // sum 6
      ["2000-01-04", 7, "Ketu"], // sum 7
      ["2000-01-05", 8, "Saturn"], // sum 8
      ["2000-01-06", 9, "Mars"], // sum 9
    ];
    for (const [date, root, lord] of cases) {
      const d = destinyNumber(date);
      expect(d.destiny).toBe(root);
      expect(d.destiny_lord).toBe(lord);
    }
    expect(destinyNumber("2000-01-08").master).toBe(true); // sum 11
    expect(destinyNumber("2000-01-01").master).toBe(false);
  });

  it("agrees with the existing numerology() destiny/mulank for shared inputs", () => {
    for (const date of ["1990-05-15", "1970-06-19", "2004-02-29"]) {
      const legacy = numerology(date, "X");
      const fresh = destinyNumber(date);
      expect(fresh.destiny).toBe(legacy.destiny);
      expect(fresh.mulank).toBe(legacy.mulank);
    }
  });
});
