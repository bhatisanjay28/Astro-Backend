import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Route tests for the D12 data-plane endpoints (Epic 9.2):
 *  - without bindings → explicit 503 service_unavailable contract;
 *  - with bindings + mocked Supabase REST fetch → shape/mapping contract.
 * The live DB path is verified post-deploy against the real project.
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

const originalFetch = globalThis.fetch;
function mockSupabase(handler: (path: string) => unknown) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    const path = url.split("/rest/v1/")[1] ?? "";
    return new Response(JSON.stringify(handler(path)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/v1/cities (Epic 9.2)", () => {
  it("returns 503 service_unavailable without DB credentials", async () => {
    const res = await app.request("/api/v1/cities");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });

  it("rejects an unknown lang", async () => {
    const res = await app.request("/api/v1/cities?lang=fr");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("maps Supabase rows to the city contract (en)", async () => {
    mockSupabase((path) => {
      expect(path).toContain("cities?");
      return [
        {
          slug: "new-delhi",
          name: "New Delhi",
          name_hi: "नई दिल्ली",
          country_code: "IN",
          latitude: 28.6139,
          longitude: 77.209,
          timezone: "Asia/Kolkata",
        },
      ];
    });
    const res = await app.request("/api/v1/cities", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        lang: string;
        cities: Array<{
          slug: string;
          name: string;
          name_en: string;
          name_hi: string | null;
          country: string;
          lat: number;
          lng: number;
          tz: string;
        }>;
      };
    };
    expect(body.data.lang).toBe("en");
    const c = body.data.cities[0];
    expect(c?.slug).toBe("new-delhi");
    expect(c?.name).toBe("New Delhi"); // en keeps the English name
    expect(c?.name_hi).toBe("नई दिल्ली");
    expect(c?.country).toBe("IN");
    expect(c?.lat).toBeCloseTo(28.6139, 4);
    expect(c?.lng).toBeCloseTo(77.209, 3);
    expect(c?.tz).toBe("Asia/Kolkata");
  });

  it("prefers the Hindi name when lang=hi", async () => {
    mockSupabase(() => [
      {
        slug: "new-delhi",
        name: "New Delhi",
        name_hi: "नई दिल्ली",
        country_code: "IN",
        latitude: 28.6139,
        longitude: 77.209,
        timezone: "Asia/Kolkata",
      },
    ]);
    const res = await app.request("/api/v1/cities?lang=hi", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { cities: Array<{ name: string }> } };
    expect(body.data.cities[0]?.name).toBe("नई दिल्ली");
  });
});

describe("GET /api/v1/content/home (Epic 9.2)", () => {
  it("returns 503 service_unavailable without DB credentials", async () => {
    const res = await app.request("/api/v1/content/home");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });

  it("rejects an unknown lang", async () => {
    const res = await app.request("/api/v1/content/home?lang=fr");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("maps the four Supabase sources into the home content bundle", async () => {
    mockSupabase((path) => {
      if (path.startsWith("astrologers")) {
        return [
          {
            slug: "vidyadhar-shastri",
            name: "Pt. Vidyadhar Shastri",
            title: "Vedic Jyotish & Muhurat Expert",
            about: "Traditional Varanasi lineage scholar.",
            expertise: ["Janam Kundli", "Career"],
            languages: ["Hindi", "Sanskrit", "English"],
            experience_years: 18,
            price_per_minute: 45,
            is_available: true,
            availability_label: "Available for Booking",
            accent: "primary",
            is_sample: true,
          },
        ];
      }
      if (path.startsWith("pujas")) {
        return [
          {
            slug: "navagraha-shanti",
            name: "Navagraha Shanti Pooja",
            category: "navagraha",
            purpose: "Graha Shanti",
            description: "Harmonizes malefic planetary influences.",
            duration: "2.5 hrs",
            mode: ["home", "online"],
            includes: ["Mode: At Home or Online Sankalp"],
            sample_price: 3500,
            accent: "primary",
            is_sample: true,
          },
        ];
      }
      if (path.startsWith("faq_items")) {
        return [{ question: "Q?", answer: "A.", is_sample: true }];
      }
      if (path.startsWith("content_blocks")) {
        return [
          {
            block_key: "hero_trust",
            payload: [{ icon: "lock", text: "Zero OTP" }],
            is_sample: true,
          },
          { block_key: "calculators", payload: [{ title: "Rashi Calculator" }], is_sample: true },
        ];
      }
      return [];
    });

    const res = await app.request("/api/v1/content/home?lang=en", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        lang: string;
        astrologers: Array<{ slug: string; rate_per_min: number | null; is_sample: boolean }>;
        poojas: Array<{
          slug: string;
          duration_label: string;
          includes: string[];
          price_inr: number | null;
        }>;
        faqs: Array<{ question: string }>;
        blocks: Record<string, unknown> & { is_sample: boolean };
      };
    };
    expect(body.data.lang).toBe("en");
    expect(body.data.astrologers[0]?.slug).toBe("vidyadhar-shastri");
    expect(body.data.astrologers[0]?.rate_per_min).toBe(45);
    expect(body.data.poojas[0]?.duration_label).toBe("2.5 hrs");
    expect(body.data.poojas[0]?.price_inr).toBe(3500);
    expect(body.data.poojas[0]?.includes).toEqual(["Mode: At Home or Online Sankalp"]);
    expect(body.data.faqs[0]?.question).toBe("Q?");
    expect("hero_trust" in body.data.blocks).toBe(true);
    expect("calculators" in body.data.blocks).toBe(true);
    expect(body.data.blocks.is_sample).toBe(true);
  });

  it("coerces null numeric columns to null (not zero)", async () => {
    mockSupabase((path) => {
      if (path.startsWith("astrologers")) {
        return [
          {
            slug: "s",
            name: "N",
            title: "T",
            about: "A",
            expertise: [],
            languages: [],
            experience_years: null,
            price_per_minute: null,
            is_available: false,
            availability_label: "Next slot 4:00 PM",
            accent: "secondary",
            is_sample: true,
          },
        ];
      }
      if (path.startsWith("pujas")) {
        return [
          {
            slug: "p",
            name: "P",
            category: "navagraha",
            purpose: null,
            description: null,
            duration: null,
            mode: ["home"],
            includes: null,
            sample_price: null,
            accent: "primary",
            is_sample: true,
          },
        ];
      }
      return [];
    });

    const res = await app.request("/api/v1/content/home", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        astrologers: Array<{ rate_per_min: number | null }>;
        poojas: Array<{ price_inr: number | null; includes: string[]; purpose: string }>;
        faqs: unknown[];
        blocks: Record<string, unknown>;
      };
    };
    expect(body.data.astrologers[0]?.rate_per_min).toBeNull();
    expect(body.data.poojas[0]?.price_inr).toBeNull();
    expect(body.data.poojas[0]?.includes).toEqual([]);
    expect(body.data.poojas[0]?.purpose).toBe("");
    expect(body.data.blocks.is_sample).toBe(false); // no block rows → honest empty
  });

  it("maps a Supabase REST failure to internal_error 500", async () => {
    globalThis.fetch = mock(
      async () => new Response("{}", { status: 401 }),
    ) as unknown as typeof fetch;
    const res = await app.request("/api/v1/content/home", {}, BINDINGS);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("internal_error");
  });
});
