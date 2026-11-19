/**
 * GET /api/v1/cities — public city list for selects/grids/autocomplete
 * (Epic 9.2, D12: the frontend carries NO baked city data; this is the single
 * source, backed by the Supabase `cities` table, public-read RLS).
 *
 * Query: ?lang=en|hi (default en — picks name_hi over name when hi available)
 *        ?country=IN (optional ISO-3166 filter)
 *
 * Deterministic → edge-cacheable.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";

function badRequest(c: any, message: string, details?: unknown) {
  return c.json({ error: { code: "validation_error", message, details } }, 400);
}

export const citiesRoute = new Hono<AppEnv>();

citiesRoute.get("/cities", async (c) => {
  const q = c.req.query();
  const lang = q.lang ?? "en";
  const country = q.country;

  if (!["en", "hi"].includes(lang)) {
    return badRequest(c, "lang must be en or hi", { received: lang });
  }

  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message:
            "City data requires backend database credentials, which are not configured on this deployment yet.",
        },
      },
      503,
    );
  }

  const params = new URLSearchParams({
    select: "slug,name,name_hi,country_code,latitude,longitude,timezone",
    order: "slug.asc",
  });
  if (country) params.set("country_code", `eq.${country}`);

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/cities?${params.toString()}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
  } catch {
    return c.json({ error: { code: "internal_error", message: "City lookup failed" } }, 500);
  }
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "City lookup failed" } }, 500);
  }

  const rows = (await res.json()) as Array<{
    slug: string;
    name: string;
    name_hi: string | null;
    country_code: string;
    latitude: number;
    longitude: number;
    timezone: string;
  }>;

  return c.json({
    data: {
      lang,
      cities: rows.map((r) => ({
        slug: r.slug,
        name: lang === "hi" && r.name_hi ? r.name_hi : r.name,
        name_en: r.name,
        name_hi: r.name_hi,
        country: r.country_code,
        lat: Number(r.latitude),
        lng: Number(r.longitude),
        tz: r.timezone,
      })),
    },
  });
});
