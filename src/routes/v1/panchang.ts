/**
 * GET /api/v1/panchang — Epic 3.1 (engine-backed, contract v1 envelope).
 *
 * Modes:
 *  - `?city={slug}&date={YYYY-MM-DD}`  → city lookup in Supabase `cities`
 *    (requires backend service credentials; clear 503 until they are set)
 *  - `?lat={..}&lng={..}&tz={IANA}&date={YYYY-MM-DD}` → direct coordinates
 *
 * Deterministic per (location, date) → edge-cacheable (panchang_cache lands
 * with the Supabase credential wiring).
 */
import { Hono } from "hono";
import { computePanchang } from "../../engine";
import type { AppEnv } from "../../env";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(c: any, message: string, details?: unknown) {
  return c.json({ error: { code: "validation_error", message, details } }, 400);
}

export const panchangRoute = new Hono<AppEnv>();

panchangRoute.get("/panchang", async (c) => {
  const q = c.req.query();
  const date = q.date ?? new Date().toISOString().slice(0, 10);

  if (!DATE_RE.test(date)) {
    return badRequest(c, "date must be YYYY-MM-DD", { received: date });
  }

  const lat = q.lat !== undefined ? Number(q.lat) : undefined;
  const lng = q.lng !== undefined ? Number(q.lng) : undefined;
  const tz = q.tz;

  if (q.city) {
    const supabaseUrl = c.env?.SUPABASE_URL;
    const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return c.json(
        {
          error: {
            code: "service_unavailable",
            message:
              "City lookup requires backend database credentials, which are not configured on this deployment yet. Use lat/lng/tz parameters meanwhile.",
          },
        },
        503,
      );
    }
    // City-mode computation is wired when the service key is set (Epic 3.1).
    const url = `${supabaseUrl}/rest/v1/cities?slug=eq.${encodeURIComponent(q.city)}&select=slug,name,latitude,longitude,timezone`;
    const res = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) {
      return c.json({ error: { code: "internal_error", message: "City lookup failed" } }, 500);
    }
    const rows = (await res.json()) as Array<{
      slug: string;
      name: string;
      latitude: number;
      longitude: number;
      timezone: string;
    }>;
    const city = rows[0];
    if (!city) {
      return c.json({ error: { code: "not_found", message: `Unknown city: ${q.city}` } }, 404);
    }
    const data = computePanchang({
      date,
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
      city: { slug: city.slug, name: city.name },
    });
    return c.json({ data });
  }

  if (lat === undefined || lng === undefined || !tz) {
    return badRequest(
      c,
      "Provide either ?city={slug} or ?lat&lng&tz (plus optional ?date=YYYY-MM-DD)",
    );
  }
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return badRequest(c, "lat must be in [-90,90] and lng in [-180,180]");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return badRequest(c, "tz must be a valid IANA timezone", { received: tz });
  }

  const data = computePanchang({ date, latitude: lat, longitude: lng, timezone: tz });
  return c.json({ data });
});
