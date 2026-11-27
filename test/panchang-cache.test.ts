import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";
import { ENGINE_VERSION } from "../src/engine/panchang";

/**
 * Epic 3.1b — panchang_cache write-through: city-mode reads hit the cache
 * first, misses compute + store, and security headers (Epic 7.2) ride on
 * every API response.
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

const originalFetch = globalThis.fetch;

function mockSupabase(handler: (url: string, init?: RequestInit) => Response | undefined) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("fake-project.supabase.co")) return new Response("unmocked", { status: 599 });
    return handler(url, init ?? {}) ?? new Response("unmocked: " + url, { status: 599 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CITY = [
  {
    id: "city-1",
    slug: "new-delhi",
    name: "New Delhi",
    latitude: 28.6,
    longitude: 77.2,
    timezone: "Asia/Kolkata",
  },
];

describe("panchang cache write-through", () => {
  it("a cache miss computes, stores and flags meta.cache=miss", async () => {
    let stored: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/cities?")) return json(CITY);
      if (url.includes("/rest/v1/panchang_cache?city_id=eq.city-1")) return json([]);
      if (
        url.includes("/rest/v1/panchang_cache?on_conflict=city_id,date") &&
        init?.method === "POST"
      ) {
        stored = (JSON.parse(init.body as string) as Array<Record<string, unknown>>)[0];
        return json([], 201);
      }
      return undefined;
    });
    const res = await app.request("/api/v1/panchang?city=new-delhi&date=2026-11-20", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { cache: string }; data: Record<string, unknown> };
    expect(body.meta.cache).toBe("miss");
    expect(body.data.engine_version).toBeTruthy();
    expect(stored?.city_id).toBe("city-1");
    expect(stored?.date).toBe("2026-11-20");
    expect(stored?.timezone).toBe("Asia/Kolkata");
  });

  it("a cache hit returns the stored payload without computing", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/cities?")) return json(CITY);
      if (url.includes("/rest/v1/panchang_cache?city_id=eq.city-1")) {
        return json([
          {
            payload: { cached: true, engine_version: ENGINE_VERSION },
            engine_version: ENGINE_VERSION,
            computed_at: "2026-11-19T00:00:00Z",
          },
        ]);
      }
      return undefined;
    });
    const res = await app.request("/api/v1/panchang?city=new-delhi&date=2026-11-20", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { cache: string; computed_at: string };
      data: Record<string, unknown>;
    };
    expect(body.meta.cache).toBe("hit");
    expect(body.meta.computed_at).toBe("2026-11-19T00:00:00Z");
    expect(body.data.cached).toBe(true);
  });

  it("S24: a cache row from an older engine version is treated as a miss (bilingual names)", async () => {
    let recomputed = false;
    mockSupabase((url) => {
      if (url.includes("/rest/v1/cities?")) return json(CITY);
      if (url.includes("/rest/v1/panchang_cache?city_id=eq.city-1")) {
        return json([
          {
            payload: { cached: true, engine_version: "1.4.0-alpha1" },
            engine_version: "1.4.0-alpha1",
            computed_at: "2026-11-19T00:00:00Z",
          },
        ]);
      }
      if (url.includes("/rest/v1/panchang_cache?on_conflict=city_id,date")) recomputed = true;
      return undefined;
    });
    const res = await app.request("/api/v1/panchang?city=new-delhi&date=2026-11-20", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { cache: string }; data: Record<string, unknown> };
    expect(body.meta.cache).toBe("miss"); // recomputed with the current engine
    expect(body.data.cached).toBeUndefined();
    expect(recomputed).toBe(true);
  });

  it("S24: ?lang=hi localizes names at read time without touching the cache", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/cities?")) return json(CITY);
      if (url.includes("/rest/v1/panchang_cache?city_id=eq.city-1")) {
        return json([
          {
            payload: {
              cached: true,
              engine_version: ENGINE_VERSION,
              vaar: { name: "Ravivara", name_hi: "रविवार" },
              tithi: [{ name: "Shukla Purnima", name_hi: "शुक्ल पूर्णिमा" }],
            },
            engine_version: ENGINE_VERSION,
            computed_at: "2026-11-19T00:00:00Z",
          },
        ]);
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/panchang?city=new-delhi&date=2026-11-20&lang=hi",
      {},
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { cache: string };
      data: { vaar: { name: string }; tithi: Array<{ name: string }> };
    };
    expect(body.meta.cache).toBe("hit"); // lang-neutral cache
    expect(body.data.vaar.name).toBe("रविवार");
    expect(body.data.tithi[0]?.name).toBe("शुक्ल पूर्णिमा");
  });
});

describe("security headers (Epic 7.2)", () => {
  it("rides nosniff / frame-deny / referrer policy on API responses", async () => {
    mockSupabase(() => undefined);
    const res = await app.request("/api/v1/panchang?date=2026-11-20", {}, BINDINGS);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});
