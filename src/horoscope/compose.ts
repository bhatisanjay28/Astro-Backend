/**
 * Payload composer (Horoscope Upgrade Step 4; ruleset §7–§8, spec §3–§4).
 *
 * Pure composition: given a sign, lang, period window and its sidereal
 * snapshots, emits the final page payload the API serves (horoscopes.payload).
 * Free-text sections are selected through the injected `pick` fn (library →
 * fallback); sky/best-testing-days/month-table/lucky are pure data per
 * ruleset §7.3–§7.5 with zero fabricated text.
 *
 * Layout mapping (spec §3): daily = overview + thought + 6 areas (career &
 * money render as one compact block, D1) + do/don't + lucky; weekly =
 * overview + areas + lucky; monthly adds best/testing days + sky block;
 * yearly adds Sade Sati note + 9 areas + month table.
 */

import type { PlanetName } from "../engine/kundli";
import { NAKSHATRAS_HI } from "../engine/names";
import { istDateKey } from "./ist";
import { type LuckyBlock, luckyBlockFor } from "./lucky";
import {
  CATEGORY_WEIGHTS,
  HOROSCOPE_SIGNS,
  HOUSE_ORDINAL_HI,
  type HoroscopeSign,
  houseFromSign,
  MONTH_NAMES,
  MONTH_SHORT,
  PLANET_HI,
  type Rating,
  ratingFromScore,
  SIGN_HI,
  signIndex,
} from "./rules";
import {
  aggregateCategory,
  categoryScore,
  DAILY_CATEGORIES,
  dayOverallScore,
  driverFor,
  houseBucket,
  planetBenefit,
  type Snapshot,
  sadeSatiPhaseFor,
} from "./score";

export type Lang = "en" | "hi";
export type HoroscopePeriod = "yesterday" | "daily" | "tomorrow" | "weekly" | "monthly" | "yearly";
export type Source = "library" | "fallback";

export interface PickResult {
  text: string;
  source: Source;
  variantNo: number | null;
}

/** Injected by the generator: library lookup + fallback + no-repeat dodge. */
export interface ComposeCtx {
  lang: Lang;
  /**
   * `salt` scopes the FNV seed beyond the run's dateKey — e.g. the yearly
   * month table passes the month key so 12 months don't all land on the same
   * variant of a clause cell.
   */
  pick(
    slot: string,
    condition: string,
    rating: Rating,
    recentVariants?: number[],
    salt?: string,
  ): PickResult;
  /** slot → variant_nos used on the previous 2 dated rows (daily §10.5 no-repeat). */
  recent?: Map<string, number[]>;
}

export interface AreaEntry {
  text: string;
  rating: Rating;
  pb: string;
  retro: boolean;
  source: Source;
}

export interface SkyLine {
  date: string;
  kind: "ingress" | "new_moon" | "full_moon" | "station";
  en: string;
  hi: string;
  planet: PlanetName | null;
  sign: string | null;
}

export interface HoroscopePayload {
  period: HoroscopePeriod;
  date_key: string;
  lang: Lang;
  sign: HoroscopeSign;
  rating: Rating;
  overview: { text: string; source: Source };
  range?: { start: string; end: string };
  thought?: { text: string; theme: number; source: Source };
  areas?: Record<string, AreaEntry>;
  dos?: { text: string; house: number; source: Source };
  donts?: { text: string; house: number; source: Source };
  lucky?: LuckyBlock;
  chandrashtama?: boolean;
  best_days?: Array<{ date: string; planets_en: string[]; planets_hi: string[] }>;
  testing_day?: { date: string; planets_en: string[]; planets_hi: string[] };
  sky?: SkyLine[];
  /** Sade Sati/Dhaiya phases grouped by label with display month ranges ("Jan–May & Nov–Dec"). */
  sadesati?: {
    active: boolean;
    phases: Array<{ label: string; label_hi: string; months_en: string; months_hi: string }>;
  };
  year_areas?: Record<string, { text: string; rating: Rating; driver: string; source: Source }>;
  month_table?: Array<{ month: string; month_hi: string; clause: string; rating: Rating }>;
  /** slot → variant_no actually served (library row or 1000+idx fallback); traceability + no-repeat input. */
  variants?: Record<string, number | null>;
}

/** Daily/weekly/monthly area slots and their category + pb key planet (§7.1). */
const AREA_DEFS: Array<{ key: string; slot: string; category: string; pbPlanet: PlanetName }> = [
  { key: "health", slot: "health", category: "health", pbPlanet: "Moon" },
  { key: "education", slot: "education", category: "education", pbPlanet: "Mercury" },
  { key: "career", slot: "career", category: "career", pbPlanet: "Saturn" },
  { key: "money", slot: "money", category: "wealth", pbPlanet: "Jupiter" },
  { key: "love", slot: "love", category: "love", pbPlanet: "Venus" },
  { key: "family", slot: "family", category: "family", pbPlanet: "Saturn" },
];

/** §7.2 yearly areas (9). */
const YEAR_AREAS: Array<{ key: string; category: string }> = [
  { key: "health", category: "health" },
  { key: "education", category: "education" },
  { key: "career", category: "career" },
  { key: "business", category: "business" },
  { key: "wealth", category: "wealth" },
  { key: "love", category: "love" },
  { key: "marriage", category: "marriage" },
  { key: "family", category: "family" },
  { key: "children", category: "children" },
];

const SLOW_PLANETS: PlanetName[] = ["Jupiter", "Saturn", "Rahu"];

/** §7.1 retro bit — any of Mercury/Jupiter/Saturn retrograde during the window. */
function retroBit(snaps: Snapshot[]): "review" | "none" {
  for (const snap of snaps) {
    for (const p of ["Mercury", "Jupiter", "Saturn"] as PlanetName[]) {
      if (snap.positions.get(p)?.retrograde) return "review";
    }
  }
  return "none";
}

function signName(slug: HoroscopeSign): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Chandrashtama = Moon in the 8th from the sign on any day of the window. */
function chandrashtamaIn(sign: HoroscopeSign, snaps: Snapshot[]): boolean {
  return snaps.some((snap) => houseBucket("Moon", sign, snap) === "chandrashtama");
}

/** Compose one area section (§7.1 condition key: rating.pb.retro). */
function composeArea(
  family: string,
  def: (typeof AREA_DEFS)[number],
  sign: HoroscopeSign,
  snaps: Snapshot[],
  ctx: ComposeCtx,
  recentSlot?: string,
): AreaEntry {
  const agg = aggregateCategory(def.category, sign, snaps);
  const pb = houseBucket(def.pbPlanet, sign, snaps[0]!); // window-start bucket [ED]
  const retro = retroBit(snaps) === "review";
  const slot = `${family}.${def.slot}`;
  const condition = `rating=${agg.rating}.pb=${pb}.retro=${retro ? "review" : "none"}`;
  const recent = recentSlot ? ctx.recent?.get(recentSlot) : undefined;
  const picked = ctx.pick(slot, condition, agg.rating, recent);
  return { text: picked.text, rating: agg.rating, pb, retro, source: picked.source };
}

/** Overall best/worst planet of a single day (thought theme + do/don't houses). */
function dayPeaks(
  sign: HoroscopeSign,
  snap: Snapshot,
): {
  top: { planet: PlanetName; house: number; b: number } | null;
  bottom: { planet: PlanetName; house: number; b: number } | null;
} {
  let top: { planet: PlanetName; house: number; b: number } | null = null;
  let bottom: { planet: PlanetName; house: number; b: number } | null = null;
  for (const cat of DAILY_CATEGORIES) {
    const cs = categoryScore(cat, sign, snap);
    if (cs.topPositive && (!top || cs.topPositive.b > top.b)) top = cs.topPositive;
    if (cs.topNegative && (!bottom || cs.topNegative.b < bottom.b)) bottom = cs.topNegative;
  }
  return { top, bottom };
}

function planetNames(planets: PlanetName[], lang: Lang): string[] {
  return planets.map((p) => (lang === "hi" ? PLANET_HI[p] : p));
}

/** Daily payload: overview + thought + areas + do/don't + lucky (+ chandrashtama). */
function composeDaily(
  period: "yesterday" | "daily" | "tomorrow",
  sign: HoroscopeSign,
  dateKey: string,
  snap: Snapshot,
  ctx: ComposeCtx,
): HoroscopePayload {
  const overall = dayOverallScore(sign, snap);
  const rating = ratingFromScore(overall);
  // §7.1 overview condition uses the same review|none vocabulary as the areas
  const retro = retroBit([snap]);

  const picked = ctx.pick(
    "daily.overview",
    `rating=${rating}.retro=${retro}`,
    rating,
    ctx.recent?.get("daily.overview"),
  );

  // thought-of-the-day: theme house = the day's dominant house; tone = overall band
  const peaks = dayPeaks(sign, snap);
  const moonPos = snap.positions.get("Moon");
  const theme =
    peaks.top?.house ??
    peaks.bottom?.house ??
    (moonPos ? houseFromSign(moonPos.signIndex, signIndex(sign)) : 1);
  const thought = ctx.pick(
    "thought",
    `theme=${theme}.tone=${rating}`,
    rating,
    ctx.recent?.get("thought"),
  );

  const areas: Record<string, AreaEntry> = {};
  for (const def of AREA_DEFS) {
    areas[def.key] = composeArea("daily", def, sign, [snap], ctx, `daily.${def.slot}`);
  }

  const dos = peaks.top
    ? ctx.pick(
        "dos",
        `house=${peaks.top.house}.flavour=constructive`,
        rating,
        ctx.recent?.get("dos"),
      )
    : null;
  const donts = peaks.bottom
    ? ctx.pick(
        "donts",
        `house=${peaks.bottom.house}.flavour=deferring`,
        rating,
        ctx.recent?.get("donts"),
      )
    : null;

  return {
    period,
    date_key: dateKey,
    lang: ctx.lang,
    sign,
    rating,
    overview: { text: picked.text, source: picked.source },
    thought: { text: thought.text, theme, source: thought.source },
    areas,
    ...(dos ? { dos: { text: dos.text, house: peaks.top!.house, source: dos.source } } : {}),
    ...(donts
      ? { donts: { text: donts.text, house: peaks.bottom!.house, source: donts.source } }
      : {}),
    lucky: luckyBlockFor(sign, snap),
    ...(chandrashtamaIn(sign, [snap]) ? { chandrashtama: true } : {}),
  };
}

/** Weekly/monthly payloads: overview + areas + lucky (+ chandrashtama). */
function composeWindow(
  period: "weekly" | "monthly",
  sign: HoroscopeSign,
  dateKey: string,
  snaps: Snapshot[],
  ctx: ComposeCtx,
): HoroscopePayload {
  const scores = snaps.map((snap) => dayOverallScore(sign, snap));
  const overall = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const rating = ratingFromScore(overall);
  // §7.1 — keep retroBit's "review"|"none" vocabulary verbatim in the condition;
  // coercing to a boolean emitted retro=true|false, which matches no library row
  // and silently dropped every weekly/monthly overview onto fallback templates.
  const retro = retroBit(snaps);
  const picked = ctx.pick(
    `${period}.overview`,
    `rating=${rating}.retro=${retro}`,
    rating,
    ctx.recent?.get(`${period}.overview`),
  );

  const areas: Record<string, AreaEntry> = {};
  for (const def of AREA_DEFS) {
    areas[def.key] = composeArea(period, def, sign, snaps, ctx);
  }

  return {
    period,
    date_key: dateKey,
    lang: ctx.lang,
    sign,
    rating,
    overview: { text: picked.text, source: picked.source },
    range: { start: istDateKey(snaps[0]!.date), end: istDateKey(snaps[snaps.length - 1]!.date) },
    areas,
    lucky: luckyBlockFor(sign, snaps[0]!),
    ...(chandrashtamaIn(sign, snaps) ? { chandrashtama: true } : {}),
  };
}

/** §7.4 — best/testing days from the month's mean daily scores, with driver planets. */
function bestTestingDays(
  sign: HoroscopeSign,
  snaps: Snapshot[],
): {
  best: Array<{ date: string; planets_en: string[]; planets_hi: string[] }>;
  testing: { date: string; planets_en: string[]; planets_hi: string[] } | null;
} {
  const dayDrivers = (snap: Snapshot): PlanetName[] => {
    const tops: PlanetName[] = [];
    for (const cat of DAILY_CATEGORIES) {
      const cs = categoryScore(cat, sign, snap);
      if (cs.topPositive && !tops.includes(cs.topPositive.planet)) tops.push(cs.topPositive.planet);
    }
    return tops.slice(0, 3);
  };

  const scored = snaps.map((snap) => ({ snap, score: dayOverallScore(sign, snap) }));
  const desc = [...scored].sort(
    (a, b) => b.score - a.score || istDateKey(a.snap.date).localeCompare(istDateKey(b.snap.date)),
  );
  const best = desc.slice(0, 2).map(({ snap }) => {
    const tops = dayDrivers(snap);
    return {
      date: istDateKey(snap.date),
      planets_en: planetNames(tops, "en"),
      planets_hi: planetNames(tops, "hi"),
    };
  });
  // testing day = lowest score; ties resolve to the earliest date
  let worst = scored[0] ?? null;
  for (const entry of scored) {
    if (
      entry.score < (worst?.score ?? Infinity) ||
      (entry.score === worst?.score && istDateKey(entry.snap.date) < istDateKey(worst!.snap.date))
    ) {
      worst = entry;
    }
  }
  return {
    best,
    testing: worst
      ? {
          date: istDateKey(worst.snap.date),
          planets_en: planetNames(dayDrivers(worst.snap), "en"),
          planets_hi: planetNames(dayDrivers(worst.snap), "hi"),
        }
      : null,
  };
}

/** §7.5 — monthly sky block: ingresses, lunations, retro stations. Pure data lines. */
function monthlySky(snaps: Snapshot[]): SkyLine[] {
  const lines: SkyLine[] = [];
  const INGRESS_PLANETS: PlanetName[] = ["Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
  const STATION_PLANETS: PlanetName[] = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
  const elong = (snap: Snapshot): number | null => {
    const m = snap.positions.get("Moon");
    const sun = snap.positions.get("Sun");
    if (!m || !sun) return null;
    return (((m.lon - sun.lon) % 360) + 360) % 360;
  };
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1]!;
    const curr = snaps[i]!;
    const date = istDateKey(curr.date);
    for (const p of INGRESS_PLANETS) {
      const a = prev.positions.get(p);
      const b = curr.positions.get(p);
      if (a && b && a.signIndex !== b.signIndex) {
        const slug = HOROSCOPE_SIGNS[b.signIndex]!;
        lines.push({
          date,
          kind: "ingress",
          planet: p,
          sign: slug,
          en: `${p} enters ${signName(slug)}`,
          hi: `${PLANET_HI[p]} ${SIGN_HI[slug]} में प्रवेश`,
        });
      }
    }
    for (const p of STATION_PLANETS) {
      const a = prev.positions.get(p);
      const b = curr.positions.get(p);
      if (a && b && a.retrograde !== b.retrograde) {
        const retro = b.retrograde;
        lines.push({
          date,
          kind: "station",
          planet: p,
          sign: null,
          en: `${p} turns ${retro ? "retrograde" : "direct"}`,
          hi: retro ? `${PLANET_HI[p]} वक्री होते हैं` : `${PLANET_HI[p]} मार्गी होते हैं`,
        });
      }
    }
    // lunations via Moon–Sun elongation (monotonic — the Moon outpaces the Sun)
    const e0 = elong(prev);
    const e1 = elong(curr);
    if (e0 !== null && e1 !== null) {
      const moon = curr.positions.get("Moon")!;
      const nakHi = NAKSHATRAS_HI[moon.nakshatraIndex] ?? moon.nakshatra;
      if (e1 < e0) {
        lines.push({
          date,
          kind: "new_moon",
          planet: "Moon",
          sign: null,
          en: `New moon · ${moon.nakshatra}`,
          hi: `अमावस्या · ${nakHi}`,
        });
      } else if (e0 < 180 && e1 >= 180) {
        lines.push({
          date,
          kind: "full_moon",
          planet: "Moon",
          sign: null,
          en: `Full moon · ${moon.nakshatra}`,
          hi: `पूर्णिमा · ${nakHi}`,
        });
      }
    }
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date));
}

/** §7.3 clause band from the slow planet's benefit value. */
function clauseBand(b: number): "fav" | "neutral" | "unfav" {
  if (b >= 0.5) return "fav";
  if (b > 0) return "neutral";
  return "unfav";
}

/** Fill {planet}/{house} placeholders in a clause fragment for the lang. */
function fillClause(template: string, planet: PlanetName, house: number, lang: Lang): string {
  if (lang === "hi") {
    return template
      .replace("{planet}", PLANET_HI[planet])
      .replace("{house}", HOUSE_ORDINAL_HI[house] ?? String(house));
  }
  return template.replace("{planet}", planet).replace("{house}", `${house}${ordinalSuffix(house)}`);
}

function ordinalSuffix(house: number): string {
  const rem = house % 10;
  const teen = house % 100;
  if (teen >= 11 && teen <= 13) return "th";
  if (rem === 1) return "st";
  if (rem === 2) return "nd";
  if (rem === 3) return "rd";
  return "th";
}

function prevDay(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** Display month range for a run ("Jan–May" / "जन–मई") from its boundary dateKeys. */
function monthRange(from: string, to: string, lang: Lang): string {
  const label = (key: string) => MONTH_SHORT[key.slice(5, 7)]?.[lang] ?? key;
  return `${label(from)}–${label(to)}`;
}

/** §7.3 — slow planet's weighted benefit across the daily categories. */
function slowContribution(planet: PlanetName, sign: HoroscopeSign, snap: Snapshot): number {
  let v = 0;
  for (const cat of DAILY_CATEGORIES) {
    const w = CATEGORY_WEIGHTS[cat]?.[planet];
    if (!w) continue;
    v += w * planetBenefit(planet, sign, snap).b;
  }
  return v;
}

/** Yearly payload: overview + Sade Sati + 9 areas + month table. */
function composeYearly(
  sign: HoroscopeSign,
  dateKey: string,
  snaps: Snapshot[],
  ctx: ComposeCtx,
): HoroscopePayload {
  // year overview from the 12 monthly means (§8 aggregation)
  const byMonth = new Map<string, Snapshot[]>();
  for (const snap of snaps) {
    const key = istDateKey(snap.date).slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(snap);
    byMonth.set(key, list);
  }
  const months = [...byMonth.keys()].sort();
  const meanOf = (list: Snapshot[]): number => {
    const scores = list.map((snap) => dayOverallScore(sign, snap));
    return scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  };
  const monthlyMeans = months.map((mKey) => meanOf(byMonth.get(mKey)!));
  const overall = monthlyMeans.reduce((a, b) => a + b, 0) / Math.max(1, monthlyMeans.length);
  const rating = ratingFromScore(overall);
  const picked = ctx.pick("yearly.overview", `rating=${rating}`, rating);

  // Sade Sati phases: contiguous day-runs of Saturn in a modifier house,
  // grouped by phase label with display month ranges
  const runs: Array<{ label: string; label_hi: string; from: string; to: string }> = [];
  for (const snap of snaps) {
    const phase = sadeSatiPhaseFor(sign, snap);
    if (!phase) continue;
    const date = istDateKey(snap.date);
    const last = runs[runs.length - 1];
    if (last && last.label === phase.label && last.to === prevDay(date)) {
      last.to = date; // same phase continues
    } else {
      runs.push({ label: phase.label, label_hi: phase.label_hi, from: date, to: date });
    }
  }
  const phases: Array<{ label: string; label_hi: string; months_en: string; months_hi: string }> =
    [];
  for (const run of runs) {
    const monthsEn = monthRange(run.from, run.to, "en");
    const monthsHi = monthRange(run.from, run.to, "hi");
    const prev = phases[phases.length - 1];
    if (prev && prev.label === run.label) {
      // same phase recurring after a gap (Saturn retrograde loop) — append with " & "
      prev.months_en = `${prev.months_en} & ${monthsEn}`;
      prev.months_hi = `${prev.months_hi} और ${monthsHi}`;
    } else {
      phases.push({
        label: run.label,
        label_hi: run.label_hi,
        months_en: monthsEn,
        months_hi: monthsHi,
      });
    }
  }

  const yearAreas: Record<
    string,
    { text: string; rating: Rating; driver: string; source: Source }
  > = {};
  for (const area of YEAR_AREAS) {
    const agg = aggregateCategory(area.category, sign, snaps);
    const driver = driverFor(area.category, sign, snaps);
    const pickedArea = ctx.pick(
      `yearly.${area.key}`,
      `rating=${agg.rating}.driver=${driver}`,
      agg.rating,
    );
    yearAreas[area.key] = {
      text: pickedArea.text,
      rating: agg.rating,
      driver,
      source: pickedArea.source,
    };
  }

  // month table (§7.3): rating + auto-composed clause from slow-planet houses
  const monthTable: Array<{ month: string; month_hi: string; clause: string; rating: Rating }> = [];
  for (const mKey of months) {
    const list = byMonth.get(mKey)!;
    const mRating = ratingFromScore(meanOf(list));
    const mid = list[Math.floor(list.length / 2)]!;

    let topPos: { planet: PlanetName; house: number; v: number } | null = null;
    let topNeg: { planet: PlanetName; house: number; v: number } | null = null;
    for (const p of SLOW_PLANETS) {
      const v = slowContribution(p, sign, mid);
      if (Math.abs(v) < 1e-9) continue;
      const pos = mid.positions.get(p)!;
      const house = houseFromSign(pos.signIndex, signIndex(sign));
      if (v > 0 && (!topPos || v > topPos.v)) topPos = { planet: p, house, v };
      if (v < 0 && (!topNeg || v < topNeg.v)) topNeg = { planet: p, house, v };
    }

    const parts: string[] = [];
    if (topPos) {
      const frag = ctx.pick(
        "clause.pos",
        `planet=${topPos.planet}.band=${clauseBand(topPos.v)}`,
        mRating,
        undefined,
        mKey,
      );
      parts.push(fillClause(frag.text, topPos.planet, topPos.house, ctx.lang));
    }
    if (topNeg) {
      const frag = ctx.pick(
        "clause.neg",
        `planet=${topNeg.planet}.band=${clauseBand(topNeg.v)}`,
        mRating,
        undefined,
        mKey,
      );
      parts.push(fillClause(frag.text, topNeg.planet, topNeg.house, ctx.lang));
    }
    const closing = ctx.pick("clause.closing", `rating=${mRating}`, mRating, undefined, mKey);
    const clause = parts.length > 0 ? `${parts.join("; ")} — ${closing.text}` : closing.text;

    const mm = mKey.slice(5, 7);
    monthTable.push({
      month: MONTH_NAMES[mm]?.en ?? mKey,
      month_hi: MONTH_NAMES[mm]?.hi ?? mKey,
      clause,
      rating: mRating,
    });
  }

  return {
    period: "yearly",
    date_key: dateKey,
    lang: ctx.lang,
    sign,
    rating,
    overview: { text: picked.text, source: picked.source },
    range: { start: istDateKey(snaps[0]!.date), end: istDateKey(snaps[snaps.length - 1]!.date) },
    sadesati: { active: phases.length > 0, phases },
    year_areas: yearAreas,
    month_table: monthTable,
    lucky: luckyBlockFor(sign, snaps[0]!),
  };
}

export interface ComposeArgs {
  period: HoroscopePeriod;
  sign: HoroscopeSign;
  dateKey: string;
  snaps: Snapshot[];
  ctx: ComposeCtx;
}

/** Compose the payload for any period. Wraps ctx.pick to record served variant numbers. */
export function composeHoroscope({
  period,
  sign,
  dateKey,
  snaps,
  ctx,
}: ComposeArgs): HoroscopePayload {
  if (!snaps.length) throw new Error(`no snapshots for ${sign} ${period} ${dateKey}`);
  const used = new Map<string, number | null>();
  const recording: ComposeCtx = {
    lang: ctx.lang,
    recent: ctx.recent,
    pick: (slot, condition, rating, recentVariants) => {
      const r = ctx.pick(slot, condition, rating, recentVariants);
      used.set(slot, r.variantNo);
      return r;
    },
  };
  let payload: HoroscopePayload;
  switch (period) {
    case "yesterday":
    case "daily":
    case "tomorrow":
      payload = composeDaily(period, sign, dateKey, snaps[0]!, recording);
      break;
    case "weekly":
      payload = composeWindow("weekly", sign, dateKey, snaps, recording);
      break;
    case "monthly": {
      const base = composeWindow("monthly", sign, dateKey, snaps, recording);
      const bt = bestTestingDays(sign, snaps);
      payload = {
        ...base,
        best_days: bt.best,
        ...(bt.testing ? { testing_day: bt.testing } : {}),
        sky: monthlySky(snaps),
      };
      break;
    }
    case "yearly":
      payload = composeYearly(sign, dateKey, snaps, recording);
      break;
  }
  return { ...payload, variants: Object.fromEntries(used) };
}
