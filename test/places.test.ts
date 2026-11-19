import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Route tests for the birthplace pickers (owner directive, 2026-11-20):
 *  - autocomplete falls back to the cities table without a Google key;
 *  - with GOOGLE_PLACES_API_KEY it proxies Places (New) — key stays server-side;
 *  - resolve handles both city:{slug} and Google place ids (Details + Time Zone).
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

  it("falls back to the cities table without a Google key", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      expect(url).toContain("/rest/v1/cities?");
      expect(url).toContain("ilike");
      return new Response(
        JSON.stringify([
          { slug: "jaipur", name: "Jaipur", admin1: "Rajasthan", country_code: "IN" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const res = await app.request("/api/v1/places/autocomplete?q=jai", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { suggestions: Array<{ place_id: string; label: string }> };
      meta: { source: string };
    };
    expect(body.meta.source).toBe("cities");
    expect(body.data.suggestions[0]?.place_id).toBe("city:jaipur");
    expect(body.data.suggestions[0]?.label).toBe("Jaipur, Rajasthan, IN");
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

  it("resolves city:{slug} from the cities table", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify([
            {
              name: "Jaipur",
              admin1: "Rajasthan",
              country_code: "IN",
              latitude: 26.9124,
              longitude: 75.7873,
              timezone: "Asia/Kolkata",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
    const res = await app.request("/api/v1/places/resolve?place_id=city:jaipur", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lat: number; lng: number; tz: string; label: string };
    };
    expect(body.data.lat).toBeCloseTo(26.9124);
    expect(body.data.tz).toBe("Asia/Kolkata");
    expect(body.data.label).toContain("Jaipur");
  });

  it("resolves a Google place id via Details + Time Zone", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("https://places.googleapis.com/v1/places/ChIJtest123")) {
        return new Response(
          JSON.stringify({
            location: { latitude: 26.9124, longitude: 75.7873 },
            formattedAddress: "Jaipur, Rajasthan, India",
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
    const body = (await res.json()) as { data: { tz: string; label: string } };
    expect(body.data.tz).toBe("Asia/Kolkata");
    expect(body.data.label).toBe("Jaipur, Rajasthan, India");
  });

  it("503s on a Google place id without a configured key", async () => {
    const res = await app.request("/api/v1/places/resolve?place_id=ChIJtest123", {}, BINDINGS);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });
});
