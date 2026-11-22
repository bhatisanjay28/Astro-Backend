/**
 * Epic 14 — calculator correctness regression tests (S14-1a/1b test plan).
 * Covers the proven P0/P1 fixes from qa/discrepancy-report.md:
 * QB-01 birth solver, QB-02 sidereal nodes, QB-05 manglik raw flags,
 * QB-06 sade-sati dip tolerance, QB-07 dhaiya + phase windows,
 * QF-01/02/03 FLAMES + names, QN-01 mobile prefix, QN-06 Lo Shu lines,
 * QN-03 plate analyser, D-QB08 ishta devata, validation guards,
 * antardasha arithmetic, interpretation presence on routes.
 */
import { describe, expect, test } from "bun:test";
import {
  ageOn,
  antardashasOf,
  flames,
  ishtaDevata,
  jaiminiKarakas,
  type KundliInput,
  kaalSarp,
  ketuSiderealLon,
  lagna,
  lahiriAyanamsha,
  loShuGrid,
  loveCompatibility,
  manglik,
  mobileNumerology,
  nameNumerology,
  numberCompatibility,
  planetaryPositions,
  rahuMeanLon,
  rahuSiderealLon,
  sadeSati,
  vehiclePlateAnalyser,
  vimshottariCurrent,
  vimshottariFromMoon,
} from "../src/engine";
import { isCalendarDate, validateBirth } from "../src/lib/birth";

const NATAL: KundliInput = {
  datetime: new Date("1990-06-15T06:30:00Z"),
  latitude: 28.6139,
  longitude: 77.209,
};

describe("QB-01 birth-instant solver", () => {
  test("evening IST births land on the same wall-clock date (P0 regression)", () => {
    for (const [date, time, expected] of [
      ["2000-03-30", "22:15", "2000-03-30T16:45:00.000Z"],
      ["2000-03-30", "19:15", "2000-03-30T13:45:00.000Z"],
      ["2000-03-30", "00:15", "2000-03-29T18:45:00.000Z"], // IST = UTC+5:30 → previous UTC day
      ["2000-03-30", "14:30", "2000-03-30T09:00:00.000Z"],
    ] as const) {
      const r = validateBirth({ date, time, lat: 28.6, lng: 77.2, tz: "Asia/Kolkata" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.instant.toISOString()).toBe(expected);
    }
  });

  test("DST-zone matrix: Sydney, New York, Adelaide", () => {
    const syd = validateBirth({
      date: "2005-01-10",
      time: "14:30",
      lat: -33.87,
      lng: 151.21,
      tz: "Australia/Sydney",
    });
    if (syd.ok) expect(syd.instant.toISOString()).toBe("2005-01-10T03:30:00.000Z"); // UTC+11 (DST)
    const ny = validateBirth({
      date: "1995-07-04",
      time: "23:45",
      lat: 40.71,
      lng: -74.01,
      tz: "America/New_York",
    });
    if (ny.ok) expect(ny.instant.toISOString()).toBe("1995-07-05T03:45:00.000Z"); // UTC-4 (EDT) → next day
    const adel = validateBirth({
      date: "2008-04-02",
      time: "09:30",
      lat: -34.93,
      lng: 138.6,
      tz: "Australia/Adelaide",
    });
    if (adel.ok) expect(adel.instant.toISOString()).toBe("2008-04-01T23:00:00.000Z"); // DST (UTC+10:30) until 2008-04-06
  });

  test("invalid dates are rejected, not rolled over", () => {
    expect(isCalendarDate("2025-02-30")).toBe(false);
    expect(isCalendarDate("2025-02-28")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true); // leap year
    expect(isCalendarDate("2023-02-29")).toBe(false);
    const r = validateBirth({
      date: "2025-02-30",
      time: "10:00",
      lat: 28.6,
      lng: 77.2,
      tz: "Asia/Kolkata",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("calendar date");
  });

  test("S18: future birth dates are rejected with a clear message", () => {
    const far = validateBirth({
      date: "2099-01-01",
      time: "10:00",
      lat: 28.6,
      lng: 77.2,
      tz: "Asia/Kolkata",
    });
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.message).toContain("future");
    // today itself stays valid (someone born earlier today)
    const today = new Date().toISOString().slice(0, 10);
    const nowOk = validateBirth({
      date: today,
      time: "00:30",
      lat: 28.6,
      lng: 77.2,
      tz: "Asia/Kolkata",
    });
    expect(nowOk.ok).toBe(true);
  });
});

describe("QB-02 sidereal lunar nodes", () => {
  test("chart Rahu/Ketu use the Lahiri-sidereal mean node", () => {
    const date = new Date("1990-06-15T06:30:00Z");
    const ayanamsha = lahiriAyanamsha(date);
    const tropical = rahuMeanLon(date);
    const sidereal = rahuSiderealLon(date);
    const diff = Math.abs((((sidereal - tropical + ayanamsha) % 360) + 360) % 360);
    expect(Math.min(diff, 360 - diff)).toBeLessThan(0.01); // circular difference
    expect(Math.abs(((((ketuSiderealLon(date) - sidereal) % 360) + 360) % 360) - 180)).toBeLessThan(
      1e-9,
    );
    // Positions fed to charts are sidereal — Rahu's sign must not be shifted ~24°.
    const positions = planetaryPositions(NATAL);
    const rahu = positions.find((p) => p.planet === "Rahu");
    if (rahu) {
      const d = Math.abs((((rahu.lon - sidereal) % 360) + 360) % 360);
      expect(Math.min(d, 360 - d)).toBeLessThan(0.01);
    }
  });

  test("kaalSarp planet table covers all seven grahas with sides", () => {
    const positions = planetaryPositions(NATAL);
    const asc = lagna(NATAL);
    const r = kaalSarp(positions, asc.lon);
    expect(r.planets).toHaveLength(7);
    for (const row of r.planets) {
      expect(["rahu_to_ketu", "ketu_to_rahu"]).toContain(row.side);
      expect(row.house).toBeGreaterThanOrEqual(1);
      expect(row.house).toBeLessThanOrEqual(12);
    }
  });
});

describe("QF-01/02/03 FLAMES + name games", () => {
  test("letter cancellation undercount fixed: counts subtract from BOTH names", () => {
    // "Ann"/"Nina": a,n,n vs n,i,n,a — three cancellation pairs, 'i' remains.
    const r = flames("Ann", "Nina");
    expect(r.letters_removed).toBe(3); // cancellation pairs
    expect(r.remaining_letters).toBe(1);
    expect(r.rounds.length).toBeGreaterThan(0);
  });

  test("n = 0 convention: nothing left → Friends", () => {
    const r = flames("Ram", "Ram");
    expect(r.result).toBe("Friends");
    expect(r.remaining_letters).toBe(0);
  });

  test("LOVES/FRIEND keyword games return 0–99 with fold steps (D-QF10)", () => {
    const love = loveCompatibility("Romeo", "Juliet");
    expect(love.score).toBeGreaterThanOrEqual(0);
    expect(love.score).toBeLessThanOrEqual(99);
    expect(love.counts).toHaveLength(5);
    for (const step of love.steps) {
      expect(typeof step).toBe("string");
    }
  });
});

describe("QN-01/02 numerology inputs + outputs", () => {
  test("mobile +91 prefix is stripped before reading (QN-01)", () => {
    const r = mobileNumerology("+919876543210");
    expect(r.prefix_stripped).toBe("9876543210");
    expect(r.digits_clean).toBe("9876543210");
    expect(r.root).toBe(9);
    expect(mobileNumerology("09876543210").prefix_stripped).toBe("9876543210");
    expect(mobileNumerology("12345").length_warning).toContain("5 digits");
  });

  test("name numerology reports per-word subtotals and letter values (QN-10)", () => {
    const r = nameNumerology("Ram Kumar");
    expect(r.words).toHaveLength(2);
    expect(r.words[0]?.word).toBe("RAM"); // words are upper-cased in the trace
    expect(r.letters).toHaveLength(8);
    const wordSum = (r.words ?? []).reduce((a, w) => a + w.sum, 0);
    expect(wordSum).toBe(r.sum);
  });

  test("Lo Shu grid sorted + 8 planes/arrows lines (QN-06)", () => {
    const r = loShuGrid("1990-06-15");
    expect([...r.missing]).toEqual([...r.missing].sort((a, b) => a - b));
    expect([...r.repeated]).toEqual([...r.repeated].sort((a, b) => a - b));
    expect(r.lines).toHaveLength(8);
    const planes = r.lines.filter((l) => l.kind === "plane");
    const arrows = r.lines.filter((l) => l.kind === "arrow");
    expect(planes).toHaveLength(3);
    expect(arrows).toHaveLength(5);
  });
});

describe("QN-03 vehicle plate analyser", () => {
  test("parses Indian plate structure and reports both schools", () => {
    const r = vehiclePlateAnalyser("DL8CAF1234", "1990-06-15");
    expect(r.state_code).toBe("DL");
    expect(r.rto_code).toBe("8");
    expect(r.series_letters).toBe("CAF");
    expect(r.number_portion).toBe("1234");
    expect(r.school_a?.root).toBe(1); // 1+2+3+4 = 10 → 1
    expect(["Lucky", "Mixed", "Neutral", "Not suggested"]).toContain(r.verdict);
    expect(r.owner?.mulank).toBe(6);
    expect(r.owner?.bhagyank).toBe(4);
  });

  test("unparseable plates return an honest Unparseable verdict (no fake numbers)", () => {
    const r = vehiclePlateAnalyser("XY", "1990-06-15");
    expect(r.verdict).toBe("Unparseable");
    expect(r.state_code).toBeNull();
    expect(r.school_a).toBeNull();
    expect(r.verdict_reasons[0]).toContain("format");
  });
});

describe("QB-05 manglik raw flags", () => {
  test("cancelled charts still expose raw dosha placements", () => {
    // Mars in Capricorn (exalted, sign index 9) → cancelled; placements stay raw.
    let found = false;
    for (let m = 0; m < 60 && !found; m++) {
      const input: KundliInput = {
        datetime: new Date(Date.UTC(1995, m, 15, 9, 0)),
        latitude: 28.6139,
        longitude: 77.209,
      };
      const positions = planetaryPositions(input);
      const mars = positions.find((p) => p.planet === "Mars");
      if (mars?.signIndex !== 9) continue;
      const r = manglik(input);
      expect(r.cancelled).toBe(true);
      // Raw flags: at least one may be true — cancellation must NOT zero them.
      expect(typeof r.from_lagna).toBe("boolean");
      expect(typeof r.from_moon).toBe("boolean");
      expect(typeof r.from_venus).toBe("boolean");
      found = true;
    }
    expect(found).toBe(true);
  });
});

describe("QB-06/07 sade-sati dip tolerance + dhaiya", () => {
  test("mid-window retro dip keeps the window open (2027 Aries dip, Taurus moon)", () => {
    let birth: Date | null = null;
    for (
      let d = new Date("1995-06-01T06:00:00Z");
      d < new Date("1995-06-30T06:00:00Z");
      d = new Date(d.getTime() + 86400000)
    ) {
      const moon = planetaryPositions({ datetime: d, latitude: 28.6139, longitude: 77.209 }).find(
        (p) => p.planet === "Moon",
      );
      if (moon?.sign === "Taurus") {
        birth = d;
        break;
      }
    }
    expect(birth).toBeTruthy();
    const natal: KundliInput = { datetime: birth!, latitude: 28.6139, longitude: 77.209 };
    const duringDip = sadeSati(natal, new Date("2027-12-15T00:00:00Z"));
    expect(duringDip.saturn_sign).toBe("Pisces"); // outside the trio
    expect([0, 1, 11]).not.toContain(duringDip.saturn_offset_from_moon);
    expect(duringDip.in_sade_sati).toBe(true); // window still stands
    expect(duringDip.phase).toBe(1);
    expect(duringDip.current?.start.slice(0, 10)).toBe("2027-06-02");
    const afterReentry = sadeSati(natal, new Date("2028-04-01T00:00:00Z"));
    expect(afterReentry.in_sade_sati).toBe(true);
  });

  test("dhaiya fires for 4th/8th Saturn from Moon (QB-07)", () => {
    let sagBirth: Date | null = null;
    for (
      let d = new Date("1998-01-01T06:00:00Z");
      d < new Date("1998-02-01T06:00:00Z");
      d = new Date(d.getTime() + 86400000)
    ) {
      const moon = planetaryPositions({ datetime: d, latitude: 28.6139, longitude: 77.209 }).find(
        (p) => p.planet === "Moon",
      );
      if (moon?.sign === "Sagittarius") {
        sagBirth = d;
        break;
      }
    }
    expect(sagBirth).toBeTruthy();
    const r = sadeSati(
      { datetime: sagBirth!, latitude: 28.6139, longitude: 77.209 },
      new Date("2026-11-21T00:00:00Z"),
    );
    expect(r.in_dhaiya).toBe(true);
    expect(r.dhaiya_house).toBe(4);
    expect(r.in_sade_sati).toBe(false);
  });

  test("phase windows are contiguous and start at phase 1", () => {
    let birth: Date | null = null;
    for (
      let d = new Date("1995-06-01T06:00:00Z");
      d < new Date("1995-06-30T06:00:00Z");
      d = new Date(d.getTime() + 86400000)
    ) {
      const moon = planetaryPositions({ datetime: d, latitude: 28.6139, longitude: 77.209 }).find(
        (p) => p.planet === "Moon",
      );
      if (moon?.sign === "Taurus") {
        birth = d;
        break;
      }
    }
    const r = sadeSati(
      { datetime: birth!, latitude: 28.6139, longitude: 77.209 },
      new Date("2028-08-01T00:00:00Z"),
    );
    expect(r.phase_windows.length).toBeGreaterThan(1);
    expect(r.phase_windows[0]?.phase).toBe(1);
    expect(r.phase_windows[0]?.start.slice(0, 10)).toBe("2027-06-02");
    for (let i = 1; i < r.phase_windows.length; i++) {
      expect(r.phase_windows[i]?.start).toBe(r.phase_windows[i - 1]?.end);
    }
  });
});

describe("D-QB08 ishta devata + karakas", () => {
  test("ishta devata derived from 12th-from-Karakamsha with disputed flags", () => {
    const r = ishtaDevata(planetaryPositions(NATAL));
    expect(r.atmakaraka).toBeTruthy();
    expect(r.ishta_devata).toBeTruthy();
    expect(r.karakamsha_sign).toBe(r.navamsha_sign);
    expect(Array.isArray(r.alternates)).toBe(true);
  });

  test("karaka list discloses scheme and marks the Atmakaraka", () => {
    const karakas = jaiminiKarakas(planetaryPositions(NATAL));
    expect(karakas[0]?.is_atmakaraka).toBe(true);
    expect(karakas.slice(1).every((k) => !k.is_atmakaraka)).toBe(true);
  });
});

describe("antardasha arithmetic + current lookup", () => {
  test("antardashas sum exactly to the mahadasha span, lords run in order", () => {
    const v = vimshottariFromMoon(new Date("1990-06-15T06:30:00Z"));
    for (const maha of v.mahadashas) {
      const subs = antardashasOf(maha);
      expect(subs).toHaveLength(9);
      expect(subs[0]?.lord).toBe(maha.lord); // sub cycle starts with the maha lord
      const first = subs[0]?.start.getTime() ?? 0;
      const last = subs[8]?.end.getTime() ?? 0;
      expect(last - first).toBe(maha.end.getTime() - maha.start.getTime());
      for (let i = 1; i < subs.length; i++) {
        expect(subs[i]?.start.getTime()).toBe(subs[i - 1]?.end.getTime());
      }
    }
  });

  test("vimshottariCurrent finds the running period with a sane fraction", () => {
    const v = vimshottariFromMoon(new Date("1990-06-15T06:30:00Z"));
    const now = new Date("2026-11-21T00:00:00Z");
    const cur = vimshottariCurrent(v.mahadashas, now);
    expect(cur).toBeTruthy();
    if (cur) {
      expect(cur.elapsed_fraction).toBeGreaterThan(0);
      expect(cur.elapsed_fraction).toBeLessThanOrEqual(1);
      expect(cur.antardasha_index).toBeGreaterThanOrEqual(0);
      expect(cur.antardasha_index).toBeLessThanOrEqual(8);
    }
    const beforeBirth = vimshottariCurrent(v.mahadashas, new Date("1985-01-01T00:00:00Z"));
    expect(beforeBirth).toBeNull();
  });
});

describe("age extras (QF-15)", () => {
  test("week totals, weekday and next-birthday are consistent", () => {
    const a = ageOn("2000-02-29", "2026-11-21");
    expect(a.total_days).toBeGreaterThan(9000);
    expect(a.total_weeks).toBe(Math.floor(a.total_days / 7));
    expect([
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ]).toContain(a.day_of_week);
    expect(a.next_birthday.days_until).toBeGreaterThanOrEqual(0);
    expect(a.next_birthday.days_until).toBeLessThanOrEqual(366);
  });
});

describe("numberCompatibility (S14-2 name-numerology owner date)", () => {
  // 1990-06-15 → mulank 6 (row: friends [4,5,8], enemies [1,3]), bhagyank 4
  // (row: friends [5,6,8], enemies [1,2,9]).
  test("both-friendly → Supportive", () => {
    const r = numberCompatibility(5, "1990-06-15"); // name root 5 ("Poonam")
    expect(r.owner_mulank).toBe(6);
    expect(r.owner_bhagyank).toBe(4);
    expect(r.relation_to_mulank).toBe("friendly");
    expect(r.relation_to_bhagyank).toBe("friendly");
    expect(r.verdict).toBe("Supportive");
  });

  test("any enemy relation → Challenging", () => {
    const r = numberCompatibility(1, "1990-06-15"); // 1 is an enemy of row 6
    expect(r.relation_to_mulank).toBe("enemy");
    expect(r.verdict).toBe("Challenging");
  });

  test("numbers absent from a row read as neutral", () => {
    const r = numberCompatibility(7, "1990-06-15"); // 7 not listed in rows 6/4
    expect(r.relation_to_mulank).toBe("neutral");
    expect(r.relation_to_bhagyank).toBe("neutral");
    expect(r.verdict).toBe("Neutral");
  });
});
