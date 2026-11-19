/**
 * Panchang computation (Epic 1.2) — deterministic, pure functions (PRD §8).
 *
 * Conventions (documented choices, PRD §5.3):
 *  - Vedic day runs sunrise → next sunrise (not midnight).
 *  - Lahiri ayanamsha, IANA timezones.
 *  - Limb windows list EVERY occurrence inside the Vedic day, each with
 *    start/end instants.
 *  - Day-segment tables (Rahu Kaal etc.) use the widely-published proportional
 *    method and carry `verified: false` until Jyotishi review (P11).
 */
import {
  elongation,
  moonRiseSet,
  moonSiderealLon,
  type RiseSet,
  sunMoonSumSidereal,
  sunRiseSet,
  sunSiderealLon,
} from "./bodies";
import { type ChoghadiyaSlot, choghadiyaDay } from "./choghadiya";
import { findWrappedCrossing, nextCrossing } from "./finders";
import { hinduCalendar, type LocalizedName } from "./hinduCalendar";
import { type HoraSlot, horaDay } from "./hora";
import {
  daySegmentTables,
  karanaName,
  NAKSHATRAS,
  NAKSHATRAS_HI,
  TITHIS,
  VAARS,
  VAARS_HI,
  YOGAS,
} from "./names";

export interface LimbWindow {
  index: number; // 1-based (tithi/nakshatra/yoga/karana)
  name: string;
  name_hi?: string;
  start: string; // ISO instant
  end: string; // ISO instant
  end_kind: "crossing" | "day_end";
}

export interface Segment {
  name: string;
  start: string;
  end: string;
  verified: boolean;
  source: string;
}

/** Epic 9.3 (D12): server-side "what the user should see right now". */
export interface ActiveLimb {
  window: LimbWindow | null;
  next: LimbWindow | null;
}

export interface ActiveLimbs {
  /** ISO instant the picks were computed against (deterministic traceability). */
  as_of: string;
  tithi: ActiveLimb;
  nakshatra: ActiveLimb;
  yoga: ActiveLimb;
  karana: ActiveLimb;
}

export interface Panchang {
  city?: { slug: string; name: string };
  date: string;
  timezone: string;
  vedic_day: { sunrise: string; next_sunrise: string; sunset: string };
  vaar: { name: string; name_hi: string };
  tithi: LimbWindow[];
  nakshatra: LimbWindow[];
  yoga: LimbWindow[];
  karana: LimbWindow[];
  rahu_kaal: Segment;
  yamaganda: Segment;
  gulika: Segment;
  abhijit: Segment;
  brahma_muhurta: Segment;
  moonrise: string | null;
  moonset: string | null;
  /** Epic 1.7 — Hindu lunar month (Amanta + Purnimanta) and Samvat years. */
  hindu_month: {
    amanta: LocalizedName;
    purnimanta: LocalizedName;
    paksha: LocalizedName;
    adhika: boolean;
    /** Epic 1.9 — the site-configured display month (primary of the two). */
    primary: LocalizedName;
  };
  samvat: { vikram: number; shaka: number };
  choghadiya: { day: ChoghadiyaSlot[]; night: ChoghadiyaSlot[] };
  hora: { day: HoraSlot[]; night: HoraSlot[] };
  /** Epic 9.3 (D12) — server-picked current/upcoming limbs (frontend renders, never computes). */
  active: ActiveLimbs;
  engine_version: string;
}

export const ENGINE_VERSION = "1.2.0-alpha1";

const DAY_MS = 86400000;
const DEG_PER_DAY_ELONGATION = 10; // true ≈ 12.2 — keep below for safe search hops
const DEG_PER_DAY_MOON = 11; // true ≈ 13.2
const DEG_PER_DAY_SUM = 12; // true ≈ 14.2

function iso(d: Date): string {
  return d.toISOString();
}

/** Local midnight of `dateISO` in an IANA timezone (works on Workers/Bun). */
function zonedStartOfDay(dateISO: string, timezone: string): Date {
  // Find the UTC instant whose local date/time in `timezone` is 00:00:00 on dateISO.
  // Strategy: probe with offsets until local formatting matches — robust across DST.
  const parts = dateISO.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0); // assume UTC start
  for (let i = 0; i < 3; i++) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const localMinutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
    const targetMinutes = 0; // 00:00:00
    const driftMin = localMinutes - targetMinutes;
    // Also compare the local calendar date
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    const dateDriftDays = localDate < dateISO ? 1 : localDate > dateISO ? -1 : 0;
    if (driftMin === 0 && dateDriftDays === 0) break;
    guess -= driftMin * 60000 + dateDriftDays * DAY_MS;
  }
  return new Date(guess);
}

function weekdayOfSunrise(sunrise: Date, timezone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(
    sunrise,
  );
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

/** All limb windows inside [from, to) for a cyclic limb driven by `fn`. */
function limbWindows(
  fn: (d: Date) => number,
  from: Date,
  to: Date,
  spanDeg: number,
  rate: number,
  totalLimbCount: number, // 30 tithi / 27 nakshatra / 27 yoga / 60 karana
  nameOf: (index1: number) => { name: string; name_hi?: string },
): LimbWindow[] {
  const out: LimbWindow[] = [];
  const startIndex = Math.floor(fn(from) / spanDeg) + 1; // 1-based limb active at `from`
  // The FIRST boundary we can still cross inside this day is the limb's END
  // boundary (startIndex * spanDeg) — the start boundary is already behind us.
  let boundaryDeg = startIndex * spanDeg;
  let cursor = new Date(from);
  let currentIndex = startIndex;
  for (let i = 0; i < 10; i++) {
    const crossing = nextCrossing(
      fn,
      boundaryDeg % 360,
      cursor,
      (to.getTime() - cursor.getTime()) / DAY_MS + 0.2,
      rate,
    );
    if (!crossing || crossing.getTime() >= to.getTime()) {
      out.push({
        index: currentIndex,
        ...nameOf(currentIndex),
        start: iso(cursor),
        end: iso(to),
        end_kind: "day_end",
      });
      break;
    }
    out.push({
      index: currentIndex,
      ...nameOf(currentIndex),
      start: iso(cursor),
      end: iso(crossing),
      end_kind: "crossing",
    });
    cursor = crossing;
    currentIndex = (currentIndex % totalLimbCount) + 1;
    boundaryDeg += spanDeg;
  }
  return out;
}

/**
 * Epic 9.3 (D12) — pick the window containing `now` plus the next upcoming
 * one. Deterministic fallbacks: if `now` sits outside every window (e.g. a
 * past/future day was queried), current = the last window already started
 * (or the first window when `now` precedes all), next = the first window
 * starting after `now`. The frontend NEVER does this picking itself.
 */
export function pickActiveLimb(windows: LimbWindow[], now: Date): ActiveLimb {
  let current: LimbWindow | null = null;
  let next: LimbWindow | null = null;
  for (const w of windows) {
    const start = new Date(w.start).getTime();
    const end = new Date(w.end).getTime();
    if (start <= now.getTime() && now.getTime() < end) {
      current = w;
    } else if (start > now.getTime() && next === null) {
      next = w;
    }
  }
  if (current === null) {
    // last started window (or the earliest window when now precedes all)
    for (const w of windows) {
      if (new Date(w.start).getTime() <= now.getTime()) current = w;
    }
    current = current ?? windows[0] ?? null;
  }
  return { window: current, next };
}

export function computePanchang(input: {
  date: string; // YYYY-MM-DD
  latitude: number;
  longitude: number;
  timezone: string;
  city?: { slug: string; name: string };
  /** ISO instant to treat as "now" for active-limb picking (tests / replays). */
  nowOverride?: string;
  /** Epic 1.9 — which Amanta/Purnimanta month drives the `primary` display. */
  month_system?: "amanta" | "purnimanta";
}): Panchang {
  const { date, latitude, longitude, timezone, city } = input;
  const dayStart = zonedStartOfDay(date, timezone);

  const sun1 = sunRiseSet(dayStart, latitude, longitude);
  if (!sun1.rise) throw new Error("sunrise_not_found");
  const sunrise = sun1.rise;
  const sunset = sun1.set ?? new Date(sunrise.getTime() + DAY_MS / 2);
  const sun2 = sunRiseSet(new Date(sunrise.getTime() + DAY_MS / 2), latitude, longitude);
  const nextSunrise = sun2.rise ?? new Date(sunrise.getTime() + DAY_MS);

  const vaarIndex = weekdayOfSunrise(sunrise, timezone);

  const tithi = limbWindows(
    elongation,
    sunrise,
    nextSunrise,
    12,
    DEG_PER_DAY_ELONGATION,
    30,
    (i) => ({
      name: `${i <= 15 ? "Shukla" : "Krishna"} ${TITHIS[i - 1]}`,
    }),
  );
  const nakshatra = limbWindows(
    moonSiderealLon,
    sunrise,
    nextSunrise,
    360 / 27,
    DEG_PER_DAY_MOON,
    27,
    (i) => ({
      name: NAKSHATRAS[i - 1] ?? "Ashwini",
      name_hi: NAKSHATRAS_HI[i - 1] ?? "अश्विनी",
    }),
  );
  const yoga = limbWindows(
    sunMoonSumSidereal,
    sunrise,
    nextSunrise,
    360 / 27,
    DEG_PER_DAY_SUM,
    27,
    (i) => ({
      name: YOGAS[i - 1] ?? "Vishkambha",
    }),
  );
  const karana = limbWindows(
    elongation,
    sunrise,
    nextSunrise,
    6,
    DEG_PER_DAY_ELONGATION,
    60,
    (i) => ({
      name: karanaName(i - 1),
    }),
  );

  // Day-segment windows (proportional method)
  const daySpan = sunset.getTime() - sunrise.getTime();
  const seg = (part: number): { start: Date; end: Date } => ({
    start: new Date(sunrise.getTime() + ((part - 1) * daySpan) / 8),
    end: new Date(sunrise.getTime() + (part * daySpan) / 8),
  });
  const tables = daySegmentTables(vaarIndex);
  const SOURCE_SEG =
    "Proportional 1/8-day method — widely published traditional tables; PENDING Jyotishi review (P11)";
  const segToObj = (part: number, name: string): Segment => {
    const w = seg(part);
    return { name, start: iso(w.start), end: iso(w.end), verified: false, source: SOURCE_SEG };
  };

  // Abhijit: 1/8-day window centered on solar noon; Brahma: 14th–15th muhurta before sunrise
  const noon = new Date((sunrise.getTime() + sunset.getTime()) / 2);
  const halfSeg = daySpan / 16;
  const abhijit: Segment = {
    name: "Abhijit Muhurat",
    start: iso(new Date(noon.getTime() - halfSeg)),
    end: iso(new Date(noon.getTime() + halfSeg)),
    verified: true,
    source: "Middle 1/8 muhurta window centred on solar noon — standard definition",
  };
  const brahma: Segment = {
    name: "Brahma Muhurta",
    start: iso(new Date(sunrise.getTime() - 96 * 60000)),
    end: iso(new Date(sunrise.getTime() - 48 * 60000)),
    verified: true,
    source: "2 muhurtas (96→48 min) before sunrise — standard definition",
  };

  const moon: RiseSet = moonRiseSet(sunrise, latitude, longitude);

  // Epic 1.7 — Hindu month/paksha/Samvat anchored at sunrise; Choghadiya + Hora
  const tithiAtSunrise = Math.floor((((elongation(sunrise) % 360) + 360) % 360) / 12) % 30;
  const calendar = hinduCalendar(sunrise, tithiAtSunrise);
  const { amanta, purnimanta, paksha, adhika, samvat } = calendar;
  const choghadiya = choghadiyaDay(vaarIndex, sunrise, sunset, nextSunrise);
  const hora = horaDay(vaarIndex, sunrise, sunset, nextSunrise);

  // Epic 9.3 (D12) — active limbs: real "now" when the queried date IS today
  // in the city timezone; otherwise a deterministic in-day instant (sunrise).
  const nowInstant =
    input.nowOverride ?? (isTodayInTz(date, timezone) ? iso(new Date()) : iso(sunrise));
  const active: ActiveLimbs = {
    as_of: nowInstant,
    tithi: pickActiveLimb(tithi, new Date(nowInstant)),
    nakshatra: pickActiveLimb(nakshatra, new Date(nowInstant)),
    yoga: pickActiveLimb(yoga, new Date(nowInstant)),
    karana: pickActiveLimb(karana, new Date(nowInstant)),
  };

  return {
    ...(city ? { city } : {}),
    date,
    timezone,
    vedic_day: { sunrise: iso(sunrise), next_sunrise: iso(nextSunrise), sunset: iso(sunset) },
    vaar: { name: VAARS[vaarIndex] ?? "Ravivara", name_hi: VAARS_HI[vaarIndex] ?? "रविवार" },
    tithi,
    nakshatra,
    yoga,
    karana,
    rahu_kaal: segToObj(tables.rahu, "Rahu Kaal"),
    yamaganda: segToObj(tables.yamaganda, "Yamaganda"),
    gulika: segToObj(tables.gulika, "Gulika"),
    abhijit,
    brahma_muhurta: brahma,
    moonrise: moon.rise ? iso(moon.rise) : null,
    moonset: moon.set ? iso(moon.set) : null,
    hindu_month: {
      amanta,
      purnimanta,
      paksha,
      adhika,
      // Epic 1.9 — site-configurable primary month (default Purnimanta).
      primary: (input.month_system ?? "purnimanta") === "amanta" ? amanta : purnimanta,
    },
    samvat,
    choghadiya,
    hora,
    active,
    engine_version: ENGINE_VERSION,
  };
}

/** Is `date` (YYYY-MM-DD) today in `timezone`? */
function isTodayInTz(date: string, timezone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()) === date; // en-CA → YYYY-MM-DD
}
