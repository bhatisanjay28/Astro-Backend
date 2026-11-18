/**
 * POST /api/v1/kundli — Epic 4.1 (engine-backed, contract v1 envelope).
 *
 * Body: { date: "YYYY-MM-DD", time: "HH:mm", lat, lng, tz } (+ optional
 * `northIndianStyle` display flag handled by the frontend, not here).
 *
 * NO-PII POLICY (PRD §10): birth data is processed and returned — never
 * persisted. Consent note travels with the response meta.
 */
import { Hono } from "hono";
import {
  ENGINE_VERSION,
  lagna,
  navamshaSignIndex,
  planetaryPositions,
  vimshottariFromMoon,
  wholeSignHouses,
} from "../../engine";
import type { AppEnv } from "../../env";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface KundliBody {
  date?: string;
  time?: string;
  lat?: number;
  lng?: number;
  tz?: string;
}

export const kundliRoute = new Hono<AppEnv>();

kundliRoute.post("/kundli", async (c) => {
  let body: KundliBody;
  try {
    body = (await c.req.json()) as KundliBody;
  } catch {
    return c.json({ error: { code: "validation_error", message: "Body must be JSON" } }, 400);
  }

  const { date, time, lat, lng, tz } = body;
  if (!date || !DATE_RE.test(date)) {
    return c.json({ error: { code: "validation_error", message: "date must be YYYY-MM-DD" } }, 400);
  }
  const birthTime = time ?? "12:00";
  if (!TIME_RE.test(birthTime)) {
    return c.json(
      { error: { code: "validation_error", message: "time must be HH:mm (24h)" } },
      400,
    );
  }
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return c.json(
      { error: { code: "validation_error", message: "lat must be a number in [-90,90]" } },
      400,
    );
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return c.json(
      { error: { code: "validation_error", message: "lng must be a number in [-180,180]" } },
      400,
    );
  }
  if (!tz) {
    return c.json(
      { error: { code: "validation_error", message: "tz must be a valid IANA timezone" } },
      400,
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return c.json(
      { error: { code: "validation_error", message: "tz must be a valid IANA timezone" } },
      400,
    );
  }

  // Birth instant: interpret date+time in the given IANA timezone (UTC-convert).
  const naive = Date.parse(`${date}T${birthTime}:00Z`);
  if (Number.isNaN(naive)) {
    return c.json({ error: { code: "validation_error", message: "Invalid date/time" } }, 400);
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  let instant = naive;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    const localMinutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
    const wantMinutes = 0;
    const drift = localMinutes - wantMinutes;
    const dateDrift = localDate < date ? 1 : localDate > date ? -1 : 0;
    if (drift === 0 && dateDrift === 0) break;
    instant -= drift * 60000 + dateDrift * 86400000;
  }
  // The loop aligns 00:00; shift by the requested time-of-day:
  const [hh, mm] = birthTime.split(":").map(Number);
  const birthInstant = new Date(instant + (hh ?? 0) * 3600000 + (mm ?? 0) * 60000);

  const input = { datetime: birthInstant, latitude: lat, longitude: lng };
  const grahas = planetaryPositions(input);
  const asc = lagna(input);
  const houses = wholeSignHouses(grahas, asc.lon);
  const dasha = vimshottariFromMoon(birthInstant);

  const navamsha = Object.fromEntries(grahas.map((p) => [p.planet, navamshaSignIndex(p.lon)]));

  return c.json({
    data: {
      birth: {
        datetime_utc: birthInstant.toISOString(),
        date,
        time: birthTime,
        timezone: tz,
        latitude: lat,
        longitude: lng,
      },
      lagna: asc,
      grahas,
      houses,
      navamsha,
      dasha,
      engine_version: ENGINE_VERSION,
    },
    meta: {
      consent_note: "Birth details are processed on request and are not stored.",
      chart_styles: ["north_indian", "south_indian"],
    },
  });
});
