/**
 * Muhurat routes (Epic 3.3) — contract v1 envelope.
 *   GET  /api/v1/muhurat/today?lat&lng&tz        → today's auspicious/inauspicious
 *   POST /api/v1/muhurat/find { event, from, to, lat, lng, tz }
 *
 * Every response carries the Jyotishi-review disclaimer (P11) — the rule DATA
 * is pending review even though the mechanics are complete (PRD §5.4).
 */
import { Hono } from "hono";
import {
  computePanchang,
  findMuhurats,
  MUHURAT_EVENT_TYPES,
  type MuhuratEventType,
} from "../../engine";
import type { AppEnv } from "../../env";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function coordError(c: any, message: string) {
  return c.json({ error: { code: "validation_error", message } }, 400);
}

export const muhuratRoute = new Hono<AppEnv>();

muhuratRoute.get("/muhurat/today", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  const tz = c.req.query("tz");
  const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return coordError(c, "lat must be in [-90,90] and lng in [-180,180]");
  }
  if (!tz) return coordError(c, "tz (IANA) is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return coordError(c, "tz must be a valid IANA timezone");
  }

  const panchang = computePanchang({ date, latitude: lat, longitude: lng, timezone: tz });
  return c.json({
    data: {
      date: panchang.date,
      timezone: panchang.timezone,
      auspicious: [panchang.abhijit, panchang.brahma_muhurta],
      inauspicious: [panchang.rahu_kaal, panchang.yamaganda, panchang.gulika],
      vaar: panchang.vaar,
      engine_version: panchang.engine_version,
    },
    meta: { verified: false, note: "Segment tables pending Jyotishi review (P11)" },
  });
});

muhuratRoute.post("/muhurat/find", async (c) => {
  let body: {
    event?: string;
    from?: string;
    to?: string;
    lat?: number;
    lng?: number;
    tz?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return coordError(c, "Body must be JSON");
  }

  const { event, from, to, lat, lng, tz } = body;
  if (!event || !MUHURAT_EVENT_TYPES.includes(event as MuhuratEventType)) {
    return coordError(c, `event must be one of: ${MUHURAT_EVENT_TYPES.join(", ")}`);
  }
  if (!from || !DATE_RE.test(from) || !to || !DATE_RE.test(to)) {
    return coordError(c, "from and to must be YYYY-MM-DD (inclusive range, max 62 days)");
  }
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return coordError(c, "lat must be a number in [-90,90]");
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return coordError(c, "lng must be a number in [-180,180]");
  }
  if (!tz) return coordError(c, "tz (IANA) is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return coordError(c, "tz must be a valid IANA timezone");
  }

  try {
    const result = findMuhurats({
      event: event as MuhuratEventType,
      from,
      to,
      latitude: lat,
      longitude: lng,
      timezone: tz,
    });
    return c.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "date_range_out_of_bounds") {
      return coordError(c, "Date range must be between 1 and 62 days");
    }
    if (msg === "invalid_date_range") {
      return coordError(c, "Invalid date range");
    }
    console.error("[muhurat/find]", err);
    return c.json(
      { error: { code: "internal_error", message: "Muhurat computation failed" } },
      500,
    );
  }
});
