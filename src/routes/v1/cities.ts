/**
 * GET /api/v1/cities — public city lookup for selects/grids/search
 * (Epic 9.2, D12: the frontend carries NO baked city data; this is the single
 * source, backed by the Supabase `cities` table, public-read RLS).
 *
 * The table now holds ~70k worldwide populated places (GeoNames seed), so the
 * endpoint is a SEARCH: ?q={text} matches name + alternate names, ordered by
 * population, paginated with ?limit= (default 50, max 200). Un-searched calls
 * return the biggest cities first — no more whole-table dumps.
 *
 * Query: ?lang=en|hi (default en — picks name_hi over name when hi available)
 *        ?country=IN (optional ISO-3166 filter)
 *        ?q=search text (matches name + search_names: exonyms, romanizations)
 *        ?limit=50 (1..200)
 *
 * Deterministic → edge-cacheable.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";

function badRequest(c: any, message: string, details?: unknown) {
  return c.json({ error: { code: "validation_error", message, details } }, 400);
}

/** PostgREST or=-syntax safe text: commas/parens/wildcards would split or
 * inject filters — spaces are fine. */
function postgrestSafe(raw: string): string {
  let out = "";
  for (const ch of raw ?? "") {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out
    .trim()
    .replace(/[,%()*]/g, " ")
    .trim();
}

export const citiesRoute = new Hono<AppEnv>();

citiesRoute.get("/cities", async (c) => {
  const q = c.req.query();
  const lang = q.lang ?? "en";
  const country = q.country;
  const search = postgrestSafe(q.q ?? "");
  const limitRaw = Number(q.limit ?? 50);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 200) : 50;

  if (!["en", "hi"].includes(lang)) {
    return badRequest(c, "lang must be en or hi", { received: lang });
  }
  if (country && !/^[A-Za-z]{2}$/.test(country)) {
    return badRequest(c, "country must be a 2-letter ISO code", { received: country });
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
    select: "slug,name,name_hi,country,country_code,latitude,longitude,timezone",
    order: "population.desc.nullslast",
    limit: String(limit),
  });
  if (country) params.set("country_code", `eq.${country}`);
  if (search) {
    const term = search.slice(0, 60);
    params.set("or", `(name.ilike.*${term}*,search_names.ilike.*${term}*)`);
  }

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
    country: string | null;
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
        country_name: r.country,
        lat: Number(r.latitude),
        lng: Number(r.longitude),
        tz: r.timezone,
      })),
    },
  });
});
