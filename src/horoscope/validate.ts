/**
 * Pre-publish validation (ruleset 03-ruleset.md §10, rules 1–7).
 *
 * Every generated row must pass before publish; the generator publishes only
 * passing rows and records violations in the run log (alerting surface for
 * automation req #5). Pure functions over payloads — no DB access, so tests
 * can exercise every rule directly.
 */

import type { HoroscopePayload, HoroscopePeriod, Lang } from "./compose";
import { addDays, weekdayOf } from "./ist";
import {
  HOROSCOPE_SIGNS,
  type HoroscopeSign,
  PLANET_ATTRIBUTES,
  RATING_BANDS,
  type Rating,
} from "./rules";

export interface ValidationRow {
  period: HoroscopePeriod;
  sign: HoroscopeSign;
  lang: Lang;
  dateKey: string;
  payload: HoroscopePayload;
}

export interface Violation {
  rule: number; // §10 rule number
  sign: string;
  lang: Lang;
  detail: string;
}

export interface ValidationResult {
  ok: boolean; // true when zero violations across the batch
  violations: Violation[];
}

const PLACEHOLDER_RE = /\bTODO\b|lorem ipsum|\bXX\b|…/i;

const DIRECTIONS = new Set([
  "East",
  "South-East",
  "South",
  "South-West",
  "West",
  "North-West",
  "North",
  "North-East",
]);

/** All human-written text fields of a payload, keyed by slot (for variety checks). */
export function payloadTexts(payload: HoroscopePayload): Map<string, string> {
  const out = new Map<string, string>();
  out.set("overview", payload.overview.text);
  if (payload.thought) out.set("thought", payload.thought.text);
  for (const [key, area] of Object.entries(payload.areas ?? {})) out.set(`area.${key}`, area.text);
  if (payload.dos) out.set("dos", payload.dos.text);
  if (payload.donts) out.set("donts", payload.donts.text);
  if (payload.year_areas)
    for (const [key, a] of Object.entries(payload.year_areas)) out.set(`year.${key}`, a.text);
  return out;
}

/** Required sections per period — missing/empty fails rule 1. */
function requiredSections(period: HoroscopePeriod): string[] {
  if (period === "yearly") return ["overview", "year.areas", "month.table"];
  const base = ["overview", "areas"];
  if (period === "daily" || period === "yesterday" || period === "tomorrow") {
    return [...base, "thought", "dos", "donts", "lucky"];
  }
  if (period === "monthly") return [...base, "best_days", "testing_day", "sky", "lucky"];
  return base; // weekly
}

function sectionPresent(payload: HoroscopePayload, section: string): boolean {
  switch (section) {
    case "overview":
      return payload.overview.text.trim().length > 0;
    case "thought":
      return !!payload.thought?.text.trim();
    case "areas":
      return (
        !!payload.areas &&
        Object.keys(payload.areas).length >= 6 &&
        Object.values(payload.areas).every((a) => a.text.trim().length > 0)
      );
    case "dos":
      return !!payload.dos?.text.trim();
    case "donts":
      return !!payload.donts?.text.trim();
    case "lucky":
      return !!payload.lucky;
    case "best_days":
      return (payload.best_days?.length ?? 0) >= 1;
    case "testing_day":
      return !!payload.testing_day?.date;
    case "sky":
      return (payload.sky?.length ?? 0) >= 1;
    case "year.areas":
      return (
        !!payload.year_areas &&
        Object.keys(payload.year_areas).length === 9 &&
        Object.values(payload.year_areas).every((a) => a.text.trim().length > 0)
      );
    case "month.table":
      return payload.month_table?.length === 12;
    default:
      return false;
  }
}

/** §10 rules 1–7 over one batch. `prevPayloads` = up to 2 previous dated payloads per (sign, lang) for the variety rule. */
export function validateBatch(
  rows: ValidationRow[],
  prevPayloads: Array<{ sign: HoroscopeSign; lang: Lang; payload: HoroscopePayload }> = [],
): ValidationResult {
  const violations: Violation[] = [];
  const add = (rule: number, sign: string, lang: Lang, detail: string) =>
    violations.push({ rule, sign, lang, detail });

  // Rule 1 — all 12 signs present per period+lang, sections non-empty
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(`${row.period}|${row.sign}|${row.lang}`);
    for (const section of requiredSections(row.period)) {
      if (!sectionPresent(row.payload, section)) {
        add(1, row.sign, row.lang, `missing/empty section ${section}`);
      }
    }
  }
  for (const period of new Set(rows.map((r) => r.period))) {
    for (const lang of ["en", "hi"] as Lang[]) {
      for (const sign of HOROSCOPE_SIGNS) {
        if (!seen.has(`${period}|${sign}|${lang}`))
          add(1, sign, lang, `row absent for ${period}/${lang}`);
      }
    }
  }

  for (const row of rows) {
    const texts = payloadTexts(row.payload);

    // Rule 2 — no placeholder tokens in any section
    for (const [slot, text] of texts) {
      if (PLACEHOLDER_RE.test(text)) add(2, row.sign, row.lang, `placeholder token in ${slot}`);
    }

    // Rule 3 — lucky block: triad from one planet, palette values, valid number/direction
    const lucky = row.payload.lucky;
    if (lucky) {
      const attrs = PLANET_ATTRIBUTES[lucky.planet];
      if (!attrs) {
        add(3, row.sign, row.lang, `unknown lucky planet ${lucky.planet}`);
      } else {
        if (lucky.number < 1 || lucky.number > 9 || lucky.number !== attrs.number) {
          add(
            3,
            row.sign,
            row.lang,
            `lucky number ${lucky.number} not the planet's palette number`,
          );
        }
        if (lucky.direction !== null && !DIRECTIONS.has(lucky.direction.en)) {
          add(3, row.sign, row.lang, `invalid direction ${lucky.direction.en}`);
        }
        if (lucky.direction === null && attrs.direction !== null) {
          add(3, row.sign, row.lang, `direction missing though planet has one`);
        }
        if (lucky.deity.en !== attrs.deity.en || lucky.mantra.hi !== attrs.mantra.hi) {
          add(3, row.sign, row.lang, `deity/mantra not paired to lucky planet`);
        }
        for (const c of lucky.colours) {
          if (!attrs.colours.some((a) => a.en === c.en)) {
            add(3, row.sign, row.lang, `colour ${c.en} outside the planet's palette`);
          }
        }
      }
    }

    // Rule 4 — ratings on the 4-band scale; yearly table = exactly 12 rows
    const ratingOK = (r: string): r is Rating => (RATING_BANDS as readonly string[]).includes(r);
    if (!ratingOK(row.payload.rating))
      add(4, row.sign, row.lang, `bad overall rating ${row.payload.rating}`);
    for (const [key, area] of Object.entries(row.payload.areas ?? {})) {
      if (!ratingOK(area.rating)) add(4, row.sign, row.lang, `bad rating on area ${key}`);
    }
    for (const [key, area] of Object.entries(row.payload.year_areas ?? {})) {
      if (!ratingOK(area.rating)) add(4, row.sign, row.lang, `bad rating on year area ${key}`);
    }
    if (row.period === "yearly") {
      if (row.payload.month_table?.length !== 12) {
        add(
          4,
          row.sign,
          row.lang,
          `month table has ${row.payload.month_table?.length ?? 0} rows, expected 12`,
        );
      }
    }

    // Rule 6 — date integrity per period window
    if (row.period === "weekly") {
      if (weekdayOf(row.dateKey) !== 1)
        add(6, row.sign, row.lang, `weekly date_key ${row.dateKey} is not a Monday`);
      const r = row.payload.range;
      if (!r || r.start !== row.dateKey || r.end !== addDays(row.dateKey, 6)) {
        add(
          6,
          row.sign,
          row.lang,
          `weekly range ${r ? `${r.start}..${r.end}` : "missing"} is not Mon–Sun`,
        );
      }
    } else if (row.period === "monthly") {
      if (!/^\d{4}-\d{2}$/.test(row.dateKey))
        add(6, row.sign, row.lang, `monthly date_key ${row.dateKey} not YYYY-MM`);
      const r = row.payload.range;
      if (!r || r.start !== `${row.dateKey}-01` || r.end.slice(0, 7) !== row.dateKey) {
        add(6, row.sign, row.lang, `monthly range does not match ${row.dateKey}`);
      }
    } else if (row.period === "yearly") {
      if (!/^\d{4}$/.test(row.dateKey))
        add(6, row.sign, row.lang, `yearly date_key ${row.dateKey} not YYYY`);
      const r = row.payload.range;
      if (!r || r.start !== `${row.dateKey}-01-01` || r.end !== `${row.dateKey}-12-31`) {
        add(6, row.sign, row.lang, `yearly range does not span ${row.dateKey}`);
      }
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dateKey)) {
      add(6, row.sign, row.lang, `daily-family date_key ${row.dateKey} not YYYY-MM-DD`);
    }
  }

  // Rule 5 — variety: new text must differ from both previous dated rows per (sign, lang, slot)
  for (const row of rows) {
    const prevs = prevPayloads.filter((p) => p.sign === row.sign && p.lang === row.lang);
    const texts = payloadTexts(row.payload);
    for (const prev of prevs) {
      const prevTexts = payloadTexts(prev.payload);
      for (const [slot, text] of texts) {
        const before = prevTexts.get(slot);
        if (before !== undefined && before === text && text.length > 0) {
          add(5, row.sign, row.lang, `${slot} text identical to ${prev.payload.date_key}`);
        }
      }
    }
  }

  // Rule 7 — both langs present per sign (paired with rule 1's coverage check above,
  // re-asserted per-sign so a single-language batch fails loudly here)
  for (const period of new Set(rows.map((r) => r.period))) {
    for (const sign of HOROSCOPE_SIGNS) {
      const langs = new Set(
        rows.filter((r) => r.period === period && r.sign === sign).map((r) => r.lang),
      );
      if (!langs.has("en") || !langs.has("hi")) {
        add(7, sign, langs.has("en") ? "hi" : "en", `missing ${langs.has("en") ? "hi" : "en"} row`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
