/**
 * GET /api/v1/compatibility/signs(+/pair) — Epic ZC route tests (S-ZC-2 AC-3).
 * Read-only, no birth data; the pair endpoint is symmetric and same-sign safe.
 * Pair-200 tests stay red until the Epic ZC content lands (loud, intentional).
 */
import { describe, expect, it } from "bun:test";
import app from "../src/app";

interface SignsResponse {
  data?: {
    signs: Array<{
      slug: string;
      name: string;
      sanskrit: string;
      element: string;
      modality: string;
      polarity: string;
      ruler: string;
      co_ruler: string | null;
      approximate_dates: string;
    }>;
  };
  error?: { code: string; message: string };
}

interface PairResponse {
  data?: {
    pair: string;
    requested: { sign1: string; sign2: string };
    facts: {
      aspect: string;
      degrees: number;
      element_pair: string;
      modality_pair: string;
      polarity_pair: string;
      rulers: string;
      ruler_note: string;
      shared_ruler: { planet: string; disputed: boolean } | null;
    };
    overall: { score: number; band: string; band_note: string; verdict: string };
    categories: Array<{ key: string; label: string; score: number; explanation: string }>;
    tips: string[];
    disclaimer: string;
    method_note: string;
    verified: boolean;
  };
  meta?: { note: string };
  error?: { code: string; message: string };
}

async function getPair(
  sign1: string,
  sign2: string,
): Promise<{ status: number; json: PairResponse }> {
  const res = await app.request(`/api/v1/compatibility/signs/pair?sign1=${sign1}&sign2=${sign2}`);
  return { status: res.status, json: (await res.json()) as PairResponse };
}

describe("GET /api/v1/compatibility/signs", () => {
  it("returns the 12 signs in wheel order with selector metadata", async () => {
    const res = await app.request("/api/v1/compatibility/signs");
    expect(res.status).toBe(200);
    const json = (await res.json()) as SignsResponse;
    expect(json.data?.signs.length).toBe(12);
    const aries = json.data?.signs[0];
    expect(aries).toMatchObject({
      slug: "aries",
      name: "Aries",
      sanskrit: "Mesha",
      element: "Fire",
      modality: "Cardinal",
      polarity: "Yang",
      ruler: "Mars",
      co_ruler: null,
    });
    const scorpio = json.data?.signs.find((s) => s.slug === "scorpio");
    expect(scorpio?.co_ruler).toBe("Pluto");
  });
});

describe("GET /api/v1/compatibility/signs/pair", () => {
  it("returns 400 for missing parameters", async () => {
    const res = await app.request("/api/v1/compatibility/signs/pair");
    expect(res.status).toBe(400);
    const json = (await res.json()) as PairResponse;
    expect(json.error?.code).toBe("validation_error");
    expect(json.error?.message).toContain("sign1");
    expect(json.error?.message).toContain("sign2");
  });

  it("returns 400 for unknown signs (and non-lowercase input)", async () => {
    const bad1 = await getPair("ophiuchus", "leo");
    expect(bad1.status).toBe(400);
    const bad2 = await getPair("Aries", "leo");
    expect(bad2.status).toBe(400);
  });

  it("returns the full payload for a valid pair (red until content lands)", async () => {
    const { status, json } = await getPair("aries", "leo");
    expect(status).toBe(200);
    const pair = json.data;
    expect(pair?.pair).toBe("aries-leo");
    expect(pair?.verified).toBe(false);
    expect(pair?.overall.score).toBe(91);
    expect(pair?.overall.band).toBe("Excellent");
    expect(pair?.categories.length).toBe(6);
    expect(pair?.facts.aspect).toBe("trine");
    expect(pair?.facts.degrees).toBe(120);
    expect(pair?.tips.length).toBeGreaterThanOrEqual(4);
    expect(pair?.disclaimer).toContain("guidance and entertainment");
  });

  it("resolves mirrored requests to the same canonical record (red until content lands)", async () => {
    const ab = await getPair("taurus", "scorpio");
    const ba = await getPair("scorpio", "taurus");
    expect(ab.status).toBe(200);
    expect(ba.status).toBe(200);
    expect(ab.json.data?.pair).toBe("taurus-scorpio");
    expect(ba.json.data?.pair).toBe("taurus-scorpio");
    expect(ba.json.data?.overall).toEqual(ab.json.data?.overall);
    expect(ba.json.data?.categories).toEqual(ab.json.data?.categories);
    expect(ba.json.data?.requested).toEqual({ sign1: "scorpio", sign2: "taurus" });
  });

  it("allows the same sign for both people (red until content lands)", async () => {
    const { status, json } = await getPair("leo", "leo");
    expect(status).toBe(200);
    expect(json.data?.pair).toBe("leo-leo");
    expect(json.data?.overall.score).toBe(80);
    expect(json.data?.overall.band).toBe("Strong");
    expect(json.data?.facts.aspect).toBe("conjunction");
  });

  it("returns 503 (not 500) if content is missing for a valid pair", async () => {
    // With the full 78-record deploy this never fires; it pins the fail-soft contract.
    const res = await app.request("/api/v1/compatibility/signs/pair?sign1=aries&sign2=leo");
    expect([200, 503]).toContain(res.status);
    if (res.status === 503) {
      const json = (await res.json()) as PairResponse;
      expect(json.error?.code).toBe("content_unavailable");
    }
  });
});
