/**
 * Epic 5.2/5.3 — directory + booking-request route tests (mocked Supabase REST).
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

let lastInsert: { path: string; body: Record<string, unknown> } | null = null;

function mockSupabase(
  handler: (path: string, init?: { method?: string; body?: string }) => unknown,
) {
  globalThis.fetch = mock(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const path = url.split("/rest/v1/")[1] ?? "";
    const out = handler(path, init);
    if (out !== undefined) {
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify([{ id: "generated-uuid" }]), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  mock.restore();
  lastInsert = null;
});

describe("GET /api/v1/astrologers + /pujas", () => {
  it("503s without credentials", async () => {
    const res = await app.request("/api/v1/astrologers");
    expect(res.status).toBe(503);
  });

  it("lists astrologers with numeric rates", async () => {
    mockSupabase(() => [
      {
        slug: "pt-vidyadhar",
        name: "Pt. Vidyadhar Shastri",
        title: "Jyotish Acharya",
        about: "a",
        expertise: ["Vedic Kundli"],
        languages: ["Hindi", "English"],
        experience_years: 25,
        price_per_minute: "51.00",
        session_types: [],
        is_available: true,
        availability_label: "Today",
        is_sample: true,
      },
    ]);
    const res = await app.request("/api/v1/astrologers", {}, BINDINGS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { astrologers: Array<{ rate_per_min: number; slug: string }> };
    };
    expect(json.data.astrologers[0]?.rate_per_min).toBe(51);
  });

  it("astrologer 404s on unknown slug", async () => {
    mockSupabase(() => []);
    const res = await app.request("/api/v1/astrologers/unknown", {}, BINDINGS);
    expect(res.status).toBe(404);
  });

  it("lists pujas with includes and category filter", async () => {
    mockSupabase((path) => {
      expect(path).toContain("category=eq.graha_shanti");
      return [
        {
          slug: "graha-shanti",
          name: "Graha Shanti",
          name_hi: "ग्रह शांति",
          category: "graha_shanti",
          purpose: "p",
          description: "d",
          duration: "3 hours",
          mode: ["online", "home"],
          includes: ["Samagri"],
          sample_price: "5100.00",
          muhurat_note: "n",
          is_sample: true,
        },
      ];
    });
    const res = await app.request("/api/v1/pujas?category=graha_shanti", {}, BINDINGS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { pujas: Array<{ price_inr: number; includes: string[] }> };
    };
    expect(json.data.pujas[0]?.price_inr).toBe(5100);
    expect(json.data.pujas[0]?.includes).toEqual(["Samagri"]);
  });
});

describe("POST /api/v1/requests/consultation", () => {
  const valid = {
    name: "Test Person",
    phone: "+91 9876543210",
    email: "t@example.com",
    topic: "Career guidance",
    astrologer_slug: "pt-vidyadhar",
  };

  it("validates and inserts with resolved astrologer id", async () => {
    mockSupabase((path, init) => {
      if (path.startsWith("astrologers?")) return [{ id: "astro-uuid" }];
      if (path.startsWith("consultation_requests") && init?.method === "POST") {
        lastInsert = { path, body: JSON.parse(init.body ?? "{}") };
        return [{ id: "req-uuid" }];
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/requests/consultation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valid),
      },
      BINDINGS,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string; status: string } };
    expect(json.data.status).toBe("received");
    expect(lastInsert?.body.astrologer_id).toBe("astro-uuid");
    expect(lastInsert?.body.name).toBe("Test Person");
  });

  it("400s on invalid phone and missing topic", async () => {
    const res = await app.request(
      "/api/v1/requests/consultation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "T", phone: "abc", topic: "" }),
      },
      BINDINGS,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { details: string[] } };
    expect(json.error.details?.length).toBeGreaterThanOrEqual(2);
  });

  it("503s without credentials before insert", async () => {
    const res = await app.request("/api/v1/requests/consultation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid),
    });
    expect(res.status).toBe(503);
  });
});

describe("POST /api/v1/requests/puja", () => {
  it("inserts with gotra/date/location fields", async () => {
    mockSupabase((path, init) => {
      if (path.startsWith("pujas?")) return [{ id: "puja-uuid" }];
      if (path.startsWith("puja_requests") && init?.method === "POST") {
        lastInsert = { path, body: JSON.parse(init.body ?? "{}") };
        return [{ id: "puja-req-uuid" }];
      }
      return undefined;
    });
    const res = await app.request(
      "/api/v1/requests/puja",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Devotee",
          phone: "9876543210",
          puja_slug: "graha-shanti",
          gotra: "Kashyap",
          date: "2026-12-01",
          location: "Varanasi",
        }),
      },
      BINDINGS,
    );
    expect(res.status).toBe(201);
    expect(lastInsert?.body.puja_id).toBe("puja-uuid");
    expect(lastInsert?.body.gotra).toBe("Kashyap");
    expect(lastInsert?.body.date).toBe("2026-12-01");
  });

  it("400s on a bad email", async () => {
    const res = await app.request(
      "/api/v1/requests/puja",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Devotee", phone: "9876543210", email: "nope" }),
      },
      BINDINGS,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/festivals (Epic 3.2b)", () => {
  it("returns festivals for an exact date", async () => {
    mockSupabase(() => [
      { name: "Diwali", name_hi: "दीपावली", date: "2026-11-08", description: "Festival of lights", is_sample: true },
    ]);
    const res = await app.request("/api/v1/festivals?date=2026-11-08", {}, BINDINGS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { date: string; festivals: Array<{ name: string }> } };
    expect(json.data.date).toBe("2026-11-08");
    expect(json.data.festivals[0]?.name).toBe("Diwali");
  });

  it("400s on a bad date and 503s without creds", async () => {
    const bad = await app.request("/api/v1/festivals?date=junk", {}, BINDINGS);
    expect(bad.status).toBe(400);
    const nocreds = await app.request("/api/v1/festivals?date=2026-11-08");
    expect(nocreds.status).toBe(503);
  });
});
