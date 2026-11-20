/**
 * GET /api/v1/places/autocomplete?q={text}&session={uuid}
 * GET /api/v1/places/resolve?place_id={id}
 *
 * Birthplace pickers on every birth-input form (owner directive, 2026-11-20).
 * Google Places (New) is proxied through the backend so the API key never
 * reaches the browser (PRD §14, same principle as the auth proxy). Without a
 * configured key the endpoints fall back to the Supabase `cities` table —
 * now seeded worldwide from GeoNames (~70k populated places, owner directive
 * "all places/cities") — with the SAME response shape, so pickers work on
 * every deployment and upgrade to worldwide Google suggestions the moment
 * the key is set (wrangler secret put GOOGLE_PLACES_API_KEY).
 *
 * Every successful resolution is persisted to the `places` store (reference
 * data only — no user records, PRD §10 no-PII) and returned in structured
 * form: { place_id, lat, lng, tz, label, structured: {main, admin1, country,
 * country_code} }. Google resolutions are cache-first: a stored place is
 * served without upstream calls (saves quota, works even keyless later).
 *
 * Contract: { data: { suggestions: [{place_id, main, secondary, label}] },
 *             meta: { source } }
 *           { data: { place_id, lat, lng, tz, label, structured } }
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";

export const placesRoute = new Hono<AppEnv>();

interface Suggestion {
  place_id: string;
  main: string;
  secondary: string;
  label: string;
}

interface StructuredPlace {
  main: string;
  admin1: string | null;
  country: string | null;
  country_code: string | null;
}

interface PlaceRow {
  slug?: string;
  name: string;
  admin1: string | null;
  country: string | null;
  country_code: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

const Q_MAX = 120;
const PLACE_ID_RE = /^[A-Za-z0-9:_-]{4,240}$/;
const CITY_SLUG_RE = /^[a-z0-9-]{1,80}$/;

/** Trims and drops control characters — input is echoed into URLs/queries. */
function cleanText(raw: string | undefined): string {
  let out = "";
  for (const ch of raw ?? "") {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out.trim();
}

/** PostgREST or=-syntax safe text: commas/parens/wildcards would split or
 * inject filters — spaces are fine. */
function postgrestSafe(raw: string): string {
  return cleanText(raw)
    .replace(/[,%()*]/g, " ")
    .trim();
}

function creds(c: { env?: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string } }) {
  const url = c.env?.SUPABASE_URL;
  const key = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

/** Best-effort write-through to the places store — never fails a resolve. */
async function storePlace(
  c: { env?: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string } },
  entry: {
    source: "google" | "cities";
    place_id: string;
    name: string;
    admin1: string | null;
    country: string | null;
    country_code: string;
    latitude: number;
    longitude: number;
    timezone: string;
    label: string;
  },
): Promise<void> {
  const sc = creds(c);
  if (!sc) return;
  try {
    const params = new URLSearchParams({ on_conflict: "place_id" });
    await fetch(`${sc.url}/rest/v1/places?${params.toString()}`, {
      method: "POST",
      headers: {
        apikey: sc.key,
        Authorization: `Bearer ${sc.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(entry),
    });
  } catch {
    /* cache write is advisory */
  }
}

function labelFor(main: string, admin1: string | null, country: string | null): string {
  return [main, admin1, country].filter(Boolean).join(", ");
}

placesRoute.get("/places/autocomplete", async (c) => {
  const q = cleanText(c.req.query("q"));
  const session = cleanText(c.req.query("session")).slice(0, 64);
  if (q.length > Q_MAX) {
    return c.json({ error: { code: "validation_error", message: "Query too long." } }, 400);
  }
  if (q.length < 2) {
    return c.json({ data: { suggestions: [] as Suggestion[] }, meta: { source: "none" } });
  }

  const apiKey = c.env?.GOOGLE_PLACES_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify({
          input: q,
          languageCode: "en",
          // locality-level results only — a birthplace is a city/town, not a street
          includedPrimaryTypes: ["locality", "postal_town", "administrative_area_level_3"],
          ...(session ? { sessionToken: session } : {}),
        }),
      });
      if (!res.ok) {
        return c.json(
          {
            error: {
              code: "upstream_error",
              message: "Place suggestions are unavailable right now.",
            },
          },
          502,
        );
      }
      const body = (await res.json()) as {
        suggestions?: Array<{
          placePrediction?: {
            placeId?: string;
            structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
          };
        }>;
      };
      const suggestions: Suggestion[] = (body.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
        .slice(0, 5)
        .map((p) => {
          const main = p.structuredFormat?.mainText?.text ?? "";
          const secondary = p.structuredFormat?.secondaryText?.text ?? "";
          return {
            place_id: p.placeId as string,
            main,
            secondary,
            label: secondary ? `${main}, ${secondary}` : main,
          };
        });
      return c.json({ data: { suggestions }, meta: { source: "google" } });
    } catch {
      return c.json(
        {
          error: {
            code: "upstream_error",
            message: "Place suggestions are unavailable right now.",
          },
        },
        502,
      );
    }
  }

  // No Google key — worldwide fallback over our own GeoNames-seeded city
  // table (name + alternate-name match — exonyms like "Calcutta" work too),
  // biggest places first.
  const sc = creds(c);
  if (!sc) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message: "Place lookup is not configured on this deployment yet.",
        },
      },
      503,
    );
  }
  const term = postgrestSafe(q).slice(0, 60);
  if (!term) {
    return c.json({ data: { suggestions: [] as Suggestion[] }, meta: { source: "cities" } });
  }
  const params = new URLSearchParams({
    select: "slug,name,admin1,country,country_code",
    or: `(name.ilike.*${term}*,search_names.ilike.*${term}*)`,
    order: "population.desc.nullslast",
    limit: "5",
  });
  let res: Response;
  try {
    res = await fetch(`${sc.url}/rest/v1/cities?${params.toString()}`, {
      headers: { apikey: sc.key, Authorization: `Bearer ${sc.key}` },
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
    admin1: string | null;
    country: string | null;
    country_code: string;
  }>;
  const suggestions: Suggestion[] = rows.map((r) => ({
    place_id: `city:${r.slug}`,
    main: r.name,
    secondary: [r.admin1, r.country ?? r.country_code].filter(Boolean).join(", "),
    label: labelFor(r.name, r.admin1, r.country ?? r.country_code),
  }));
  return c.json({ data: { suggestions }, meta: { source: "cities" } });
});

placesRoute.get("/places/resolve", async (c) => {
  const placeId = cleanText(c.req.query("place_id"));
  if (!placeId) {
    return c.json({ error: { code: "validation_error", message: "place_id is required." } }, 400);
  }
  if (!PLACE_ID_RE.test(placeId)) {
    return c.json({ error: { code: "validation_error", message: "Invalid place_id." } }, 400);
  }

  // our own city ids carry lat/lng/tz in the table — no Google call needed
  if (placeId.startsWith("city:")) {
    const slug = placeId.slice(5);
    if (!CITY_SLUG_RE.test(slug)) {
      return c.json({ error: { code: "validation_error", message: "Invalid city." } }, 400);
    }
    const sc = creds(c);
    if (!sc) {
      return c.json(
        {
          error: {
            code: "service_unavailable",
            message: "City lookup is not configured on this deployment yet.",
          },
        },
        503,
      );
    }
    const params = new URLSearchParams({
      select: "name,admin1,country,country_code,latitude,longitude,timezone",
      slug: `eq.${slug}`,
      limit: "1",
    });
    let res: Response;
    try {
      res = await fetch(`${sc.url}/rest/v1/cities?${params.toString()}`, {
        headers: { apikey: sc.key, Authorization: `Bearer ${sc.key}` },
      });
    } catch {
      return c.json({ error: { code: "internal_error", message: "City lookup failed" } }, 500);
    }
    if (!res.ok) {
      return c.json({ error: { code: "internal_error", message: "City lookup failed" } }, 500);
    }
    const rows = (await res.json()) as Array<PlaceRow>;
    const city = rows[0];
    if (!city) {
      return c.json({ error: { code: "not_found", message: "Unknown city." } }, 404);
    }
    const structured: StructuredPlace = {
      main: city.name,
      admin1: city.admin1,
      country: city.country ?? null,
      country_code: city.country_code,
    };
    await storePlace(c, {
      source: "cities",
      place_id: placeId,
      name: city.name,
      admin1: city.admin1,
      country: structured.country,
      country_code: city.country_code,
      latitude: Number(city.latitude),
      longitude: Number(city.longitude),
      timezone: city.timezone,
      label: labelFor(city.name, city.admin1, structured.country),
    });
    return c.json({
      data: {
        place_id: placeId,
        lat: Number(city.latitude),
        lng: Number(city.longitude),
        tz: city.timezone,
        label: labelFor(city.name, city.admin1, structured.country),
        structured,
      },
    });
  }

  // Google place id — cache-first: a previously stored resolution answers
  // without upstream calls (saves quota, works even without a key).
  const sc = creds(c);
  if (sc) {
    const params = new URLSearchParams({
      select: "name,admin1,country,country_code,latitude,longitude,timezone,label",
      place_id: `eq.${placeId}`,
      limit: "1",
    });
    try {
      const res = await fetch(`${sc.url}/rest/v1/places?${params.toString()}`, {
        headers: { apikey: sc.key, Authorization: `Bearer ${sc.key}` },
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<{
          name: string;
          admin1: string | null;
          country: string | null;
          country_code: string;
          latitude: number;
          longitude: number;
          timezone: string;
          label: string;
        }>;
        const hit = rows[0];
        if (hit) {
          return c.json({
            data: {
              place_id: placeId,
              lat: Number(hit.latitude),
              lng: Number(hit.longitude),
              tz: hit.timezone,
              label: hit.label,
              structured: {
                main: hit.name,
                admin1: hit.admin1,
                country: hit.country,
                country_code: hit.country_code,
              },
            },
          });
        }
      }
    } catch {
      /* cache miss on failure — fall through to Google */
    }
  }

  // Google Details for coordinates + structured parts, Time Zone API for IANA tz
  const apiKey = c.env?.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message: "Place resolution requires a configured Google Places key.",
        },
      },
      503,
    );
  }
  try {
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "location,formattedAddress,addressComponents",
        },
      },
    );
    if (!detailsRes.ok) {
      return c.json(
        {
          error: {
            code: detailsRes.status === 404 ? "not_found" : "upstream_error",
            message: "Place could not be resolved.",
          },
        },
        detailsRes.status === 404 ? 404 : 502,
      );
    }
    const details = (await detailsRes.json()) as {
      location?: { latitude?: number; longitude?: number };
      formattedAddress?: string;
      addressComponents?: Array<{
        longText?: string;
        shortText?: string;
        types?: string[];
      }>;
    };
    const lat = details.location?.latitude;
    const lng = details.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return c.json(
        { error: { code: "upstream_error", message: "Place has no coordinates." } },
        502,
      );
    }
    const part = (type: string) => details.addressComponents?.find((a) => a.types?.includes(type));
    const locality = part("locality")?.longText ?? part("postal_town")?.longText;
    const admin1 = part("administrative_area_level_1")?.longText ?? null;
    const countryComp = part("country");
    const country = countryComp?.longText ?? null;
    const countryCode = countryComp?.shortText ?? null;
    const tzRes = await fetch(
      `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${Math.floor(Date.now() / 1000)}&key=${apiKey}`,
    );
    if (!tzRes.ok) {
      return c.json({ error: { code: "upstream_error", message: "Timezone lookup failed." } }, 502);
    }
    const tzBody = (await tzRes.json()) as { status?: string; timeZoneId?: string };
    if (tzBody.status !== "OK" || !tzBody.timeZoneId) {
      return c.json({ error: { code: "upstream_error", message: "Timezone lookup failed." } }, 502);
    }
    const label = details.formattedAddress ?? "";
    const main = locality ?? label.split(",")[0] ?? label;
    const structured: StructuredPlace = { main, admin1, country, country_code: countryCode };
    if (countryCode) {
      await storePlace(c, {
        source: "google",
        place_id: placeId,
        name: main,
        admin1,
        country,
        country_code: countryCode,
        latitude: lat,
        longitude: lng,
        timezone: tzBody.timeZoneId,
        label,
      });
    }
    return c.json({
      data: { place_id: placeId, lat, lng, tz: tzBody.timeZoneId, label, structured },
    });
  } catch {
    return c.json({ error: { code: "upstream_error", message: "Place resolution failed." } }, 502);
  }
});
