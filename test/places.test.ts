import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Route tests for the birthplace pickers (owner directive, 2026-11-20):
 *  - autocomplete falls back to the GeoNames-seeded cities table (worldwide
 *    coverage, population-ranked) without a Google key;
 *  - with GOOGLE_PLACES_API_KEY it proxies Places (New) — key stays server-side;
 *  - resolve handles city:{slug} and Google place ids (cache-first: a stored
 *    place answers without upstream calls), persists every resolution to the
 *    `places` store, and returns structured {main, admin1, country}.
 * Upstream responses are mocked; the live Google path is verified post-key.
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

const KEY_BINDINGS = {
  ...BINDINGS,
  GOOGLE_PLACES_API_KEY: "test-google-key",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Minimal Supabase-side mock: cities search + places store GET/POST. */
function supabaseMock(handlers: {
  cities?: unknown;
  placesGet?: unknown;
  assertCitiesUrl?: (url: string) => void;
  assertPlacesPost?: (body: unknown) => void;
}) {
  return mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/rest/v1/cities?")) {
      handlers.assertCitiesUrl?.(url);
      return new Response(JSON.stringify(handlers.cities ?? []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/places?") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify(handlers.placesGet ?? []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/places?") && init?.method === "POST") {
      handlers.assertPlacesPost?.(JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }
    return new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;
}

describe("GET /api/v1/places/autocomplete", () => {
  it("returns an empty list for very short queries", async () => {
    const res = await app.request("/api/v1/places/autocomplete?q=j", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { suggestions: unknown[] };
      meta: { source: string };
    };
    expect(body.data.suggestions).toEqual([]);
    expect(body.meta.source).toBe("none");
  });

  it("rejects over-long queries", async () => {
    const res = await app.request(`/api/v1/places/autocomplete?q=${"x".repeat(121)}`, {}, BINDINGS);
    expect(res.status).toBe(400);
  });

  it("falls back to the cities table: name+alternates search, population-ranked", async () => {
    let sawUrl = "";
    globalThis.fetch = supabaseMock({
      cities: [
        {
          slug: "sirohi-rajasthan",
          name: "Sirohi",
          admin1: "Rajasthan",
          country: "India",
          country_code: "IN",
        },
      ],
      assertCitiesUrl: (url) => {
        sawUrl = url;
      },
    });
    const res = await app.request("/api/v1/places/autocomplete?q=sirohi", {}, BINDINGS);
    expect(res.status).toBe(200);
    expect(sawUrl).toContain("search_names.ilike");
    expect(sawUrl).toContain("population.desc.nullslast");
    const body = (await res.json()) as {
      data: { suggestions: Array<{ place_id: string; label: string }> };
      meta: { source: string };
    };
    expect(body.meta.source).toBe("cities");
    expect(body.data.suggestions[0]?.place_id).toBe("city:sirohi-rajasthan");
    expect(body.data.suggestions[0]?.label).toBe("Sirohi, Rajasthan, India");
  });

  it("proxies Places (New) when the key is set — key never leaves the server", async () => {
    let sawKeyHeader = false;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
      const headers = new Headers(init?.headers);
      sawKeyHeader = headers.get("X-Goog-Api-Key") === "test-google-key";
      return new Response(
        JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: "ChIJtest123",
                structuredFormat: {
                  mainText: { text: "Jaipur" },
                  secondaryText: { text: "Rajasthan, India" },
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const res = await app.request("/api/v1/places/autocomplete?q=jai&session=s1", {}, KEY_BINDINGS);
    expect(res.status).toBe(200);
    expect(sawKeyHeader).toBe(true);
    const body = (await res.json()) as {
      data: { suggestions: Array<{ place_id: string; label: string }> };
      meta: { source: string };
    };
    expect(body.meta.source).toBe("google");
    expect(body.data.suggestions[0]?.place_id).toBe("ChIJtest123");
    expect(body.data.suggestions[0]?.label).toBe("Jaipur, Rajasthan, India");
  });
});

describe("GET /api/v1/places/resolve", () => {
  it("requires place_id", async () => {
    const res = await app.request("/api/v1/places/resolve", {}, BINDINGS);
    expect(res.status).toBe(400);
  });

  it("rejects malformed place ids", async () => {
    const res = await app.request("/api/v1/places/resolve?place_id=bad%20id!", {}, BINDINGS);
    expect(res.status).toBe(400);
  });

  it("resolves city:{slug} with structured parts and stores it", async () => {
    let stored: Record<string, unknown> | undefined;
    globalThis.fetch = supabaseMock({
      cities: [
        {
          name: "Sirohi",
          admin1: "Rajasthan",
          country: "India",
          country_code: "IN",
          latitude: 24.885,
          longitude: 72.8621,
          timezone: "Asia/Kolkata",
        },
      ],
      assertPlacesPost: (body) => {
        stored = body as Record<string, unknown>;
      },
    });
    const res = await app.request(
      "/api/v1/places/resolve?place_id=city:sirohi-rajasthan",
      {},
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        place_id: string;
        lat: number;
        lng: number;
        tz: string;
        label: string;
        structured: {
          main: string;
          admin1: string | null;
          country: string | null;
          country_code: string | null;
        };
      };
    };
    expect(body.data.lat).toBeCloseTo(24.885);
    expect(body.data.tz).toBe("Asia/Kolkata");
    expect(body.data.label).toBe("Sirohi, Rajasthan, India");
    expect(body.data.structured).toEqual({
      main: "Sirohi",
      admin1: "Rajasthan",
      country: "India",
      country_code: "IN",
    });
    expect(stored?.source).toBe("cities");
    expect(stored?.place_id).toBe("city:sirohi-rajasthan");
  });

  it("serves a Google place id from the places store without upstream calls", async () => {
    globalThis.fetch = supabaseMock({
      placesGet: [
        {
          name: "Udaipur",
          admin1: "Rajasthan",
          country: "India",
          country_code: "IN",
          latitude: 24.5854,
          longitude: 73.7125,
          timezone: "Asia/Kolkata",
          label: "Udaipur, Rajasthan, India",
        },
      ],
    });
    const res = await app.request(
      "/api/v1/places/resolve?place_id=ChIJcached999",
      {},
      KEY_BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { place_id: string; structured: { main: string } } };
    expect(body.data.place_id).toBe("ChIJcached999");
    expect(body.data.structured.main).toBe("Udaipur");
  });

  it("resolves a Google place id via Details + Time Zone, stores structured", async () => {
    let stored: Record<string, unknown> | undefined;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/places?")) {
        if ((init?.method ?? "GET") === "GET")
          return new Response(JSON.stringify([]), { status: 200 });
        stored = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(null, { status: 201 });
      }
      if (url.startsWith("https://places.googleapis.com/v1/places/ChIJtest123")) {
        return new Response(
          JSON.stringify({
            location: { latitude: 26.9124, longitude: 75.7873 },
            formattedAddress: "Jaipur, Rajasthan, India",
            addressComponents: [
              { longText: "Jaipur", shortText: "Jaipur", types: ["locality"] },
              { longText: "Rajasthan", shortText: "RJ", types: ["administrative_area_level_1"] },
              { longText: "India", shortText: "IN", types: ["country"] },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.startsWith("https://maps.googleapis.com/maps/api/timezone")) {
        return new Response(JSON.stringify({ status: "OK", timeZoneId: "Asia/Kolkata" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    const res = await app.request("/api/v1/places/resolve?place_id=ChIJtest123", {}, KEY_BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { tz: string; label: string; structured: { main: string; country: string | null } };
    };
    expect(body.data.tz).toBe("Asia/Kolkata");
    expect(body.data.label).toBe("Jaipur, Rajasthan, India");
    expect(body.data.structured.main).toBe("Jaipur");
    expect(body.data.structured.country).toBe("India");
    expect(stored?.source).toBe("google");
    expect(stored?.timezone).toBe("Asia/Kolkata");
  });

  it("503s on an uncached Google place id without a configured key", async () => {
    // explicit cache-miss mock: full-suite runs share fetch state across files
    globalThis.fetch = supabaseMock({ placesGet: [] });
    const res = await app.request("/api/v1/places/resolve?place_id=ChIJtest123", {}, BINDINGS);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });
});
