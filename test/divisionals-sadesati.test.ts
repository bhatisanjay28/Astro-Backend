/**
 * Epic 1.10 — divisional charts (D3/D7/D9/D10/D12) + Sade Sati tests.
 *
 * Divisionals use hand-computed classical rule values at fixed longitudes.
 * Sade Sati is tested for structural invariants with injected `now`
 * (verified:false pending Jyotishi review — no external anchors asserted).
 */
import { describe, expect, test } from "bun:test";
import {
  dashamshaSignIndex,
  divisionalSignIndex,
  divisionalsOf,
  drekkanaSignIndex,
  dwadashamshaSignIndex,
  saptamshaSignIndex,
} from "../src/engine/divisionals";
import type { KundliInput } from "../src/engine/kundli";
import { navamshaSignIndex } from "../src/engine/kundli";
import { sadeSati } from "../src/engine/transits";

describe("divisionals (Parashari varga rules)", () => {
  test("D3 drekkana: self / 5th / 9th from the sign", () => {
    expect(drekkanaSignIndex(5)).toBe(0); // Aries part 0 → Aries
    expect(drekkanaSignIndex(15)).toBe(4); // Aries part 1 → Leo (5th)
    expect(drekkanaSignIndex(25)).toBe(8); // Aries part 2 → Sagittarius (9th)
    expect(drekkanaSignIndex(31)).toBe(1); // Taurus part 0 → Taurus
  });

  test("D7 saptamsha: odd from self, even from the 7th", () => {
    // Aries (odd): 30/7° ≈ 4.286° per part; 10° → part 2 → Gemini
    expect(saptamshaSignIndex(1)).toBe(0);
    expect(saptamshaSignIndex(10)).toBe(2);
    // Taurus (even): starts from Scorpio (7)
    expect(saptamshaSignIndex(31)).toBe(7);
    expect(saptamshaSignIndex(40)).toBe(9); // in-sign 10° → part 2 → Capricorn
  });

  test("D10 dashamsha: odd from self, even from the 9th", () => {
    // Aries (odd): part 3 → Cancer
    expect(dashamshaSignIndex(10)).toBe(3);
    // Taurus (even): starts from Capricorn (9)
    expect(dashamshaSignIndex(31)).toBe(9);
    // Gemini (odd): part 0 → Gemini
    expect(dashamshaSignIndex(61)).toBe(2);
  });

  test("D12 dwadashamsha: always from self", () => {
    expect(dwadashamshaSignIndex(1)).toBe(0); // Aries part 0
    expect(dwadashamshaSignIndex(57.5)).toBe(0); // Taurus in-sign 27.5° → part 11 → (1+11)%12 = 0
    expect(dwadashamshaSignIndex(30)).toBe(1); // Taurus part 0 → Taurus
    expect(dwadashamshaSignIndex(32.5)).toBe(2); // Taurus part 1 → Gemini
  });

  test("D9 matches the existing navamshaSignIndex for every 30′ of a sign", () => {
    for (let d = 0; d < 360; d += 0.5) {
      expect(divisionalSignIndex(d, "D9")).toBe(navamshaSignIndex(d));
    }
  });

  test("divisionalsOf returns all five charts in range", () => {
    const all = divisionalsOf(123.456);
    for (const chart of ["D3", "D7", "D9", "D10", "D12"] as const) {
      expect(all[chart]).toBeGreaterThanOrEqual(0);
      expect(all[chart]).toBeLessThanOrEqual(11);
    }
  });
});

describe("sadeSati (structural invariants, injected now)", () => {
  const NATAL: KundliInput = {
    datetime: new Date("1990-06-15T06:30:00Z"),
    latitude: 28.6139,
    longitude: 77.209,
  };

  test("result structure and relationship invariants", () => {
    const r = sadeSati(NATAL, new Date("2026-11-19T00:00:00Z"));
    expect(r.moon_sign_index).toBeGreaterThanOrEqual(0);
    expect(r.moon_sign_index).toBeLessThanOrEqual(11);
    expect(r.saturn_sign_index).toBeGreaterThanOrEqual(0);
    expect(r.saturn_sign_index).toBeLessThanOrEqual(11);
    const offset = (r.saturn_sign_index - r.moon_sign_index + 12) % 12;
    expect(r.saturn_offset_from_moon).toBe(offset);
    // Dip-tolerant (QB-06): when Saturn is OUTSIDE the trio in a mid-window
    // retro dip the window still stands, so in_sade_sati can be true with an
    // out-of-trio offset — but when Saturn IS in the trio the window must
    // always be open.
    if (offset === 0 || offset === 1 || offset === 11) {
      expect(r.in_sade_sati).toBe(true);
    }
    if (r.in_sade_sati) {
      expect(r.phase).not.toBeNull();
      expect(r.phase_windows.length).toBeGreaterThan(0);
    } else {
      expect(r.phase).toBeNull();
    }
    expect(r.in_dhaiya).toBe(r.dhaiya_house !== null);
    expect(r.verified).toBe(false);
    expect(r.note).toContain("P11");
    if (r.in_sade_sati) {
      expect(r.current).toBeTruthy();
      expect(r.next).toBeTruthy();
      const start = new Date(r.current?.start ?? "").getTime();
      const end = new Date(r.current?.end ?? "").getTime();
      const now = new Date("2026-11-19T00:00:00Z").getTime();
      expect(start).toBeLessThanOrEqual(now);
      expect(end).toBeGreaterThan(now);
      // a full Sade Sati spans ≈ 7.5 ± 1.5 years
      expect(end - start).toBeGreaterThan(6 * 365.25 * 86400000);
      expect(end - start).toBeLessThan(9 * 365.25 * 86400000);
    } else {
      expect(r.in_sade_sati).toBe(false);
      expect(r.phase).toBeNull();
      expect(r.next).toBeTruthy(); // there is always a next window within ~30y
    }
  });

  test("deterministic for the same injected now", () => {
    const a = sadeSati(NATAL, new Date("2026-11-19T00:00:00Z"));
    const b = sadeSati(NATAL, new Date("2026-11-19T00:00:00Z"));
    expect(a).toEqual(b);
  });

  test("windows across a multi-year grid stay internally consistent", () => {
    let anySeen = false;
    for (let m = 0; m < 60; m += 6) {
      const now = new Date(Date.UTC(2024 + (m % 4), (m * 2) % 12, 1));
      const r = sadeSati(NATAL, now);
      const nowMs = now.getTime();
      if (r.current) {
        const s = new Date(r.current.start).getTime();
        const e = new Date(r.current.end).getTime();
        expect(s).toBeLessThanOrEqual(nowMs);
        expect(e).toBeGreaterThan(nowMs);
        expect(r.in_sade_sati).toBe(true);
        expect(r.next).toBeTruthy();
        if (r.next) {
          expect(new Date(r.next.start).getTime()).toBeGreaterThanOrEqual(e);
        }
        anySeen = true;
      } else {
        expect(r.in_sade_sati).toBe(false);
        expect(r.next).toBeTruthy();
        if (r.next) {
          const ns = new Date(r.next.start).getTime();
          const ne = new Date(r.next.end).getTime();
          expect(ns).toBeGreaterThan(nowMs);
          expect(ne).toBeGreaterThan(ns);
        }
      }
    }
    expect(anySeen).toBe(true);
  });

  test("current window length is the classical ~7.5 years (6–9y bound)", () => {
    const r = sadeSati(NATAL, new Date("2026-11-19T00:00:00Z"));
    expect(r.current).toBeTruthy();
    if (r.current) {
      const span = new Date(r.current.end).getTime() - new Date(r.current.start).getTime();
      expect(span).toBeGreaterThan(6 * 365.25 * 86400000);
      expect(span).toBeLessThan(9 * 365.25 * 86400000);
    }
  });
});
