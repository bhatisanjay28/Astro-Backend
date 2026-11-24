/**
 * Payload composer + pre-publish validator tests (Step 4; ruleset §7, §10).
 *
 * Compose tests use real ephemeris snapshots for day/week/month windows and
 * fabricated snapshots for the yearly window (cheap + deterministic Sade Sati
 * runs). A recording pick-stub captures every (slot, condition) the composer
 * derives, pinning §7.1 condition-key grammar. Validation tests mutate real
 * composed payloads to trip each of the §10 rules 1–7.
 */
import { describe, expect, test } from "bun:test";
import type { PlanetName, PlanetPosition } from "../src/engine/kundli";
import {
  type ComposeCtx,
  composeHoroscope,
  type HoroscopePayload,
  type Lang,
  type PickResult,
} from "../src/horoscope/compose";
import { addDays, istStartOfDay } from "../src/horoscope/ist";
import { HOROSCOPE_SIGNS, type HoroscopeSign } from "../src/horoscope/rules";
import { type Snapshot, snapshotAt } from "../src/horoscope/score";
import { type ValidationRow, validateBatch } from "../src/horoscope/validate";

/** Fabricate a full 9-planet snapshot (planets fixed at chosen signIndexes). */
function fabSnap(
  at: Partial<Record<PlanetName, number>> = {},
  date = new Date("2026-11-24T00:05:00+05:30"),
): Snapshot {
  const positions = new Map<PlanetName, PlanetPosition>();
  const all: PlanetName[] = [
    "Sun",
    "Moon",
    "Mars",
    "Mercury",
    "Jupiter",
    "Venus",
    "Saturn",
    "Rahu",
    "Ketu",
  ];
  for (const p of all) {
    const signIndex = at[p] ?? 0;
    positions.set(p, {
      planet: p,
      lon: signIndex * 30 + 5,
      sign: "test",
      signIndex,
      nakshatra: "Ashwini",
      nakshatraIndex: 0,
      pada: 1,
      retrograde: false,
    });
  }
  return { date, positions };
}

/** Recording pick stub — returns deterministic text and captures conditions.
 * The text carries {planet}/{house} so fillClause substitution is exercised. */
function stubCtx(lang: Lang, log?: Array<{ slot: string; condition: string }>): ComposeCtx {
  return {
    lang,
    pick: (slot, condition): PickResult => {
      log?.push({ slot, condition });
      return {
        text: `${slot} · ${condition} · {planet} {house}`,
        source: "fallback",
        variantNo: 1000,
      };
    },
  };
}

describe("compose daily (real ephemeris)", () => {
  const log: Array<{ slot: string; condition: string }> = [];
  const dateKey = "2026-11-24";
  const snap = snapshotAt(new Date(`${dateKey}T00:05:00+05:30`));
  const payload = composeHoroscope({
    period: "daily",
    sign: "aries",
    dateKey,
    snaps: [snap],
    ctx: stubCtx("en", log),
  });

  test("shape: overview + thought + 6 areas + dos/donts + lucky + variants", () => {
    expect(payload.period).toBe("daily");
    expect(payload.date_key).toBe(dateKey);
    expect(payload.lang).toBe("en");
    expect(payload.sign).toBe("aries");
    expect(["excellent", "good", "moderate", "challenging"]).toContain(payload.rating);
    expect(payload.overview.text.length).toBeGreaterThan(0);
    expect(payload.thought?.text.length).toBeGreaterThan(0);
    expect(Object.keys(payload.areas ?? {}).sort()).toEqual([
      "career",
      "education",
      "family",
      "health",
      "love",
      "money",
    ]);
    expect(payload.dos?.text.length).toBeGreaterThan(0);
    expect(payload.donts?.text.length).toBeGreaterThan(0);
    expect(payload.lucky?.planet).toBeTruthy();
    // §10.5 traceability: every picked slot records its variant number
    // (overview + thought + 6 areas + dos + donts = 10)
    expect(Object.keys(payload.variants ?? {}).length).toBe(10);
    expect([...Object.values(payload.variants ?? {})].every((v) => v === 1000)).toBe(true);
  });

  test("§7.1 condition-key grammar on the picked slots", () => {
    const bySlot = new Map(log.map((l) => [l.slot, l.condition]));
    expect(bySlot.get("daily.overview")).toMatch(/^rating=\w+\.retro=(review|none)$/);
    expect(bySlot.get("daily.health")).toMatch(
      /^rating=\w+\.pb=(fav|neutral|unfav|chandrashtama)\.retro=(review|none)$/,
    );
    expect(bySlot.get("thought")).toMatch(/^theme=\d+\.tone=\w+$/);
    expect(bySlot.get("dos")).toMatch(/^house=\d+\.flavour=constructive$/);
    expect(bySlot.get("donts")).toMatch(/^house=\d+\.flavour=deferring$/);
    // six area slots (overview excluded), not four — education and family are separate
    expect(
      log.filter((l) => l.slot.startsWith("daily.") && l.slot !== "daily.overview").length,
    ).toBe(6);
  });

  test("chandrashtama flag fires when the Moon hits the 8th", () => {
    // Moon in Scorpio (signIndex 7) = house 8 from Aries
    const cs = composeHoroscope({
      period: "daily",
      sign: "aries",
      dateKey,
      snaps: [fabSnap({ Moon: 7 })],
      ctx: stubCtx("en"),
    });
    expect(cs.chandrashtama).toBe(true);
  });
});

describe("compose weekly/monthly (real ephemeris)", () => {
  const startKey = "2026-11-23"; // Monday
  const weekSnaps = Array.from({ length: 7 }, (_, i) =>
    snapshotAt(new Date(`${addDays(startKey, i)}T00:05:00+05:30`)),
  );
  const weekly = composeHoroscope({
    period: "weekly",
    sign: "taurus",
    dateKey: startKey,
    snaps: weekSnaps,
    ctx: stubCtx("en"),
  });

  test("weekly: Mon–Sun range, areas, lucky, no thought/dos", () => {
    expect(weekly.range?.start).toBe(startKey);
    expect(weekly.range?.end).toBe(addDays(startKey, 6));
    expect(weekly.thought).toBeUndefined();
    expect(weekly.dos).toBeUndefined();
    expect(Object.keys(weekly.areas ?? {}).length).toBe(6);
    expect(weekly.lucky?.number).toBeGreaterThan(0);
  });

  const monthSnaps = Array.from({ length: 30 }, (_, i) =>
    snapshotAt(new Date(`${addDays("2026-11-01", i)}T00:05:00+05:30`)),
  );
  const monthly = composeHoroscope({
    period: "monthly",
    sign: "gemini",
    dateKey: "2026-11",
    snaps: monthSnaps,
    ctx: stubCtx("en"),
  });

  test("monthly: best/testing days + non-empty sky block (§7.4/§7.5)", () => {
    expect(monthly.best_days?.length).toBe(2);
    expect(monthly.testing_day?.date).toBeTruthy();
    expect(monthly.range?.start).toBe("2026-11-01");
    expect(monthly.range?.end).toBe("2026-11-30");
    // a real month always has at least the Sun's sidereal ingress
    expect(monthly.sky?.length ?? 0).toBeGreaterThanOrEqual(1);
    const ingress = monthly.sky?.find((s) => s.kind === "ingress");
    expect(ingress?.en).toMatch(/enters \w+/);
    expect(ingress?.planet).toBeTruthy();
  });
});

describe("compose yearly (fabricated Saturn-in-Pisces year)", () => {
  // Saturn fixed in Pisces (signIndex 11) = house 12 from Aries → Sade Sati rising all year.
  // IST-anchored day starts so the window is exactly Jan 1 – Dec 31 (no 2027 rollover).
  const yearSnaps = Array.from({ length: 365 }, (_, i) =>
    fabSnap({ Saturn: 11 }, istStartOfDay(addDays("2026-01-01", i))),
  );
  const yearly = composeHoroscope({
    period: "yearly",
    sign: "aries",
    dateKey: "2026",
    snaps: yearSnaps,
    ctx: stubCtx("en"),
  });

  test("shape: 9 year areas + 12-row month table + range", () => {
    expect(yearly.period).toBe("yearly");
    expect(Object.keys(yearly.year_areas ?? {}).sort()).toEqual([
      "business",
      "career",
      "children",
      "education",
      "family",
      "health",
      "love",
      "marriage",
      "wealth",
    ]);
    expect(yearly.month_table?.length).toBe(12);
    expect(yearly.month_table?.[0]?.month).toBe("January");
    expect(yearly.month_table?.[11]?.month).toBe("December");
    expect(yearly.range?.start).toBe("2026-01-01");
    expect(yearly.range?.end).toBe("2026-12-31");
    expect(yearly.lucky).toBeTruthy();
  });

  test("Sade Sati rising phase active with a Jan–Dec range", () => {
    expect(yearly.sadesati?.active).toBe(true);
    const phase = yearly.sadesati?.phases[0];
    expect(phase?.label).toBe("Sade Sati — rising phase");
    expect(phase?.label_hi).toContain("साढ़े साती");
    expect(phase?.months_en).toBe("Jan–Dec");
    expect(phase?.months_hi).toContain("जन");
  });

  test("month-table clause fills {planet}/{house} from the slow planets", () => {
    const row = yearly.month_table?.[0];
    expect(row?.rating).toBeTruthy();
    // Jupiter (h1, strongly negative across daily categories) drives the neg clause
    expect(row?.clause).toContain("Jupiter");
    expect(row?.clause).toContain("1st");
  });
});

describe("compose lang=hi", () => {
  test("Hindi payload fills clause houses in Hindi ordinals", () => {
    const yearSnaps = Array.from({ length: 60 }, (_, i) =>
      fabSnap({ Saturn: 11 }, istStartOfDay(addDays("2026-01-01", i))),
    );
    const yearly = composeHoroscope({
      period: "yearly",
      sign: "aries",
      dateKey: "2026",
      snaps: yearSnaps,
      ctx: stubCtx("hi"),
    });
    expect(yearly.lang).toBe("hi");
    expect(yearly.month_table?.[0]?.clause).toContain("पहले"); // house 1 oblique ordinal
  });
});

// ————— validator —————

/** Full §10-compliant daily batch: 12 signs × 2 langs from one real snapshot. */
function dailyBatch(dateKey: string, snap: Snapshot): ValidationRow[] {
  const rows: ValidationRow[] = [];
  for (const sign of HOROSCOPE_SIGNS) {
    for (const lang of ["en", "hi"] as Lang[]) {
      rows.push({
        period: "daily",
        sign,
        lang,
        dateKey,
        payload: composeHoroscope({
          period: "daily",
          sign,
          dateKey,
          snaps: [snap],
          ctx: stubCtx(lang),
        }),
      });
    }
  }
  return rows;
}

describe("validateBatch (§10 rules 1–7)", () => {
  const snap = snapshotAt(new Date("2026-11-24T00:05:00+05:30"));

  test("rule-green: a full daily batch of real composed payloads passes", () => {
    const result = validateBatch(dailyBatch("2026-11-24", snap));
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("rule 1: empty overview + absent sign rows flagged", () => {
    const rows = dailyBatch("2026-11-24", snap);
    rows[0]!.payload.overview.text = "";
    rows.pop(); // drop one sign/lang pair
    const result = validateBatch(rows);
    expect(result.violations.some((v) => v.rule === 1)).toBe(true);
  });

  test("rule 2: placeholder tokens rejected", () => {
    const rows = dailyBatch("2026-11-24", snap);
    rows[0]!.payload.overview.text = "TODO: write overview";
    const result = validateBatch(rows);
    expect(result.violations.some((v) => v.rule === 2)).toBe(true);
  });

  test("rule 3: lucky number must match the planet palette", () => {
    const rows = dailyBatch("2026-11-24", snap);
    const lucky = rows[0]!.payload.lucky;
    if (lucky) lucky.number = 99;
    const result = validateBatch(rows);
    expect(result.violations.some((v) => v.rule === 3)).toBe(true);
  });

  test("rule 4: off-scale ratings rejected", () => {
    const rows = dailyBatch("2026-11-24", snap);
    rows[0]!.payload.rating = "amazing" as (typeof rows)[number]["payload"]["rating"];
    const result = validateBatch(rows);
    expect(result.violations.some((v) => v.rule === 4)).toBe(true);
  });

  test("rule 5: identical text vs the previous dated row flagged", () => {
    const rows = dailyBatch("2026-11-24", snap);
    const prev = rows[0]!;
    const result = validateBatch(rows, [
      { sign: prev.sign, lang: prev.lang, payload: { ...prev.payload, date_key: "2026-11-23" } },
    ]);
    expect(result.violations.some((v) => v.rule === 5)).toBe(true);
  });

  test("rule 6: weekly date_key must be a Monday with a Mon–Sun range", () => {
    const weekSnaps = Array.from({ length: 7 }, (_, i) =>
      snapshotAt(new Date(`${addDays("2026-11-24", i)}T00:05:00+05:30`)),
    );
    const rows: ValidationRow[] = [];
    for (const sign of HOROSCOPE_SIGNS) {
      for (const lang of ["en", "hi"] as Lang[]) {
        rows.push({
          period: "weekly",
          sign,
          lang,
          dateKey: "2026-11-24", // Tuesday
          payload: composeHoroscope({
            period: "weekly",
            sign,
            dateKey: "2026-11-24",
            snaps: weekSnaps,
            ctx: stubCtx(lang),
          }),
        });
      }
    }
    const result = validateBatch(rows);
    expect(result.violations.filter((v) => v.rule === 6).length).toBe(24);
  });

  test("rule 7: single-language batch flagged", () => {
    const rows = dailyBatch("2026-11-24", snap).filter((r) => r.lang === "en");
    const result = validateBatch(rows);
    expect(result.violations.some((v) => v.rule === 7)).toBe(true);
  });
});
