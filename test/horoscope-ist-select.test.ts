/**
 * IST date-key discipline + deterministic variant selection (Step 4; req #7,
 * library-structure §5). The IST half pins the 2026-11-21 QA rule: date keys
 * never come from toISOString directly.
 */
import { describe, expect, test } from "bun:test";
import {
  addDays,
  dayRange,
  istDateKey,
  istStartOfDay,
  periodDateKey,
  periodDays,
  weekdayOf,
  weekStart,
} from "../src/horoscope/ist";
import { fnv1a64, type LibraryRow, pickVariant, type VariantPool } from "../src/horoscope/select";
import { resolveCurrent } from "../src/routes/v1/horoscope";

describe("IST date keys (fixed +05:30)", () => {
  test("18:29 UTC stays on the same IST day; 18:31 rolls over", () => {
    // 2026-11-24T18:29:00Z + 5:30 = 2026-11-24T23:59 IST
    expect(istDateKey(new Date("2026-11-24T18:29:00Z"))).toBe("2026-11-24");
    // 2026-11-24T18:31:00Z + 5:30 = 2026-11-25T00:01 IST
    expect(istDateKey(new Date("2026-11-24T18:31:00Z"))).toBe("2026-11-25");
  });

  test("istStartOfDay inverts istDateKey", () => {
    const dk = "2026-11-25";
    expect(istDateKey(istStartOfDay(dk))).toBe(dk);
    // IST midnight = 18:30 UTC previous day
    expect(istStartOfDay(dk).toISOString()).toBe("2026-11-24T18:30:00.000Z");
  });

  test("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("weekdayOf and weekStart (Monday)", () => {
    expect(weekdayOf("2026-11-23")).toBe(1); // Monday
    expect(weekStart("2026-11-24")).toBe("2026-11-23"); // Tue → Mon
    expect(weekStart("2026-11-23")).toBe("2026-11-23"); // Mon → itself
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday → previous Monday
  });

  test("periodDateKey per period", () => {
    const now = new Date("2026-11-24T10:00:00Z"); // 15:30 IST
    expect(periodDateKey("daily", now)).toBe("2026-11-24");
    expect(periodDateKey("yesterday", now)).toBe("2026-11-23");
    expect(periodDateKey("tomorrow", now)).toBe("2026-11-25");
    expect(periodDateKey("weekly", now)).toBe("2026-11-23");
    expect(periodDateKey("monthly", now)).toBe("2026-11");
    expect(periodDateKey("yearly", now)).toBe("2026");
  });

  test("periodDays windows: day, week (7), month, year (365/366)", () => {
    expect(periodDays("daily", "2026-11-24").days).toEqual(["2026-11-24"]);
    const week = periodDays("weekly", "2026-11-24");
    expect(week.start).toBe("2026-11-23");
    expect(week.days).toHaveLength(7);
    expect(week.days[0]).toBe("2026-11-23");
    expect(week.days[6]).toBe("2026-11-29");
    const nov = periodDays("monthly", "2026-11");
    expect(nov.days).toHaveLength(30);
    expect(nov.days[0]).toBe("2026-11-01");
    const feb = periodDays("monthly", "2028-02");
    expect(feb.days).toHaveLength(29); // leap
    const year = periodDays("yearly", "2026");
    expect(year.days).toHaveLength(365);
    expect(year.days[0]).toBe("2026-01-01");
    expect(year.days[364]).toBe("2026-12-31");
  });

  test("dayRange is start-inclusive / end-exclusive", () => {
    expect(dayRange("2026-11-30", "2026-12-02")).toEqual(["2026-11-30", "2026-12-01"]);
  });
});

describe("FNV1a64 selection (library-structure §5)", () => {
  const row = (variant_no: number, text: string): LibraryRow => ({
    slot: "daily.health",
    condition: "rating=good.pb=fav.retro=none",
    lang: "en",
    variant_no,
    text,
    is_active: true,
  });

  const pool = (rows: LibraryRow[], fallback: string[] = ["fallback one"]): VariantPool => ({
    rows,
    fallback,
  });

  test("deterministic: same inputs → same variant", () => {
    const ctx = {
      dateKey: "2026-11-24",
      sign: "aries",
      lang: "en",
      slot: "daily.health",
      condition: "rating=good.pb=fav.retro=none",
    };
    const a = pickVariant(ctx, pool([row(1, "a"), row(2, "b"), row(3, "c")]));
    const b = pickVariant(ctx, pool([row(1, "a"), row(2, "b"), row(3, "c")]));
    expect(a.variantNo).toBe(b.variantNo);
    expect(a.source).toBe("library");
  });

  test("fnv1a64 is stable and spread across the pool", () => {
    expect(fnv1a64("x")).toBe(fnv1a64("x"));
    expect(fnv1a64("x")).not.toBe(fnv1a64("y"));
    // spreads over 1000 keys → every bucket reachable
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(Number(fnv1a64(`k${i}`) % 5n));
    expect(seen.size).toBe(5);
  });

  test("no-repeat dodge avoids the previous day's variant when the pool allows", () => {
    const ctx = {
      dateKey: "2026-11-24",
      sign: "aries",
      lang: "en",
      slot: "daily.health",
      condition: "rating=good.pb=fav.retro=none",
      recentVariants: [1],
    };
    // force v0 = 0 by finding a dateKey that hashes there — simpler: assert
    // the picked variant is never the recent one while another exists
    for (let i = 0; i < 50; i++) {
      const r = pickVariant(
        { ...ctx, dateKey: `2026-11-24-${i}` },
        pool([row(1, "a"), row(2, "b")]),
      );
      expect(r.variantNo).toBe(2);
    }
  });

  test("single-variant pool must still serve even if it repeats", () => {
    const ctx = {
      dateKey: "2026-11-24",
      sign: "aries",
      lang: "en",
      slot: "daily.health",
      condition: "rating=good.pb=fav.retro=none",
      recentVariants: [7],
    };
    const r = pickVariant(ctx, pool([row(7, "only")]));
    expect(r.variantNo).toBe(7);
  });

  test("fallback templates are numbered 1000+idx and dodge too", () => {
    const ctx = {
      dateKey: "2026-11-24",
      sign: "aries",
      lang: "hi",
      slot: "daily.health",
      condition: "rating=good.pb=fav.retro=none",
      recentVariants: [1000],
    };
    for (let i = 0; i < 30; i++) {
      const r = pickVariant({ ...ctx, dateKey: `2026-11-24-${i}` }, pool([], ["fb1", "fb2"]));
      expect(r.source).toBe("fallback");
      expect(r.variantNo).toBe(1001); // 1000 is recent → always the other one
      expect(r.text).toBe("fb2");
    }
  });

  test("empty pool + empty fallback throws (compose error path)", () => {
    expect(() =>
      pickVariant(
        {
          dateKey: "2026-11-24",
          sign: "aries",
          lang: "en",
          slot: "daily.health",
          condition: "rating=good.pb=fav.retro=none",
        },
        { rows: [], fallback: [] },
      ),
    ).toThrow(/no variants and no fallback/);
  });

  test("salted seeds spread sub-period picks across variants (yearly month table)", () => {
    // 12 months on one run: without the month salt every pick hashed to the
    // same variant and the table read the same clause 12 times (2026-11-24 bug).
    const pool = { rows: [], fallback: ["fb1", "fb2", "fb3"] };
    const picks = new Set<string>();
    for (let m = 1; m <= 12; m++) {
      const r = pickVariant(
        {
          dateKey: `2026#2026-${String(m).padStart(2, "0")}`,
          sign: "aries",
          lang: "en",
          slot: "clause.closing",
          condition: "rating=moderate",
        },
        pool,
      );
      picks.add(r.text);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe("resolve-current mapping (route IST ladder)", () => {
  // 2026-11-24T10:00Z = 15:30 IST Tue 24 Nov — no boundary tension.
  const midDay = new Date("2026-11-24T10:00:00Z");
  // 18:31 UTC = 00:01 IST 25 Nov — the UTC date still says the 24th; every
  // resolution below must key off IST, not off the machine clock.
  const rollover = new Date("2026-11-24T18:31:00Z");

  test("daily/yesterday/tomorrow → daily @ D / D-1 / D+1", () => {
    expect(resolveCurrent("daily", midDay)).toEqual({ period: "daily", dateKey: "2026-11-24" });
    expect(resolveCurrent("yesterday", midDay)).toEqual({
      period: "daily",
      dateKey: "2026-11-23",
    });
    expect(resolveCurrent("tomorrow", midDay)).toEqual({
      period: "daily",
      dateKey: "2026-11-25",
    });
    expect(resolveCurrent("tomorrow", midDay).dateKey).not.toBe(istDateKey(midDay));
  });

  test("weekly → Monday of the IST week; monthly/yearly → YYYY-MM / YYYY", () => {
    // 2026-11-24 is a Tuesday → week starts Mon 2026-11-23
    expect(resolveCurrent("weekly", midDay)).toEqual({
      period: "weekly",
      dateKey: "2026-11-23",
    });
    expect(resolveCurrent("monthly", midDay)).toEqual({
      period: "monthly",
      dateKey: "2026-11",
    });
    expect(resolveCurrent("yearly", midDay)).toEqual({ period: "yearly", dateKey: "2026" });
  });

  test("UTC 18:31 rollover resolves on the NEW IST day (Dec 31 → Jan 1)", () => {
    expect(resolveCurrent("daily", rollover)).toEqual({ period: "daily", dateKey: "2026-11-25" });
    // New Year boundary in IST: 2026-12-31T18:31Z = 2027-01-01T00:01 IST
    expect(resolveCurrent("daily", new Date("2026-12-31T18:31:00Z"))).toEqual({
      period: "daily",
      dateKey: "2027-01-01",
    });
    expect(resolveCurrent("yearly", new Date("2026-12-31T18:31:00Z"))).toEqual({
      period: "yearly",
      dateKey: "2027",
    });
  });

  test("weekly keys snap at the IST Monday rollover, not the UTC one", () => {
    // Mon 2026-11-23 00:01 IST = Sun 2026-11-22T18:31Z — UTC still says Sunday,
    // but IST Monday has begun, so the weekly key must already be 2026-11-23.
    expect(resolveCurrent("weekly", new Date("2026-11-22T18:31:00Z"))).toEqual({
      period: "weekly",
      dateKey: "2026-11-23",
    });
    // Mid-week Tuesday IST 2026-12-01 still resolves to that week's Monday.
    expect(resolveCurrent("weekly", new Date("2026-11-30T18:31:00Z"))).toEqual({
      period: "weekly",
      dateKey: "2026-11-30",
    });
  });

  test("unknown period falls through to today's daily row", () => {
    expect(resolveCurrent("hourly" as never, midDay)).toEqual({
      period: "daily",
      dateKey: "2026-11-24",
    });
  });
});
