import { describe, expect, it } from "bun:test";
import app from "../src/app";

/**
 * S24 — ?lang=hi localization gates (QA-mindset).
 *
 * Pins the three contracts the frontend depends on:
 *  1. Value strings (signs/grahas/nakshatras/phases) localize to Hindi.
 *  2. Verdict/band words at the TOP level stay EN in hi mode — the
 *     calculator-render-map derives status classes from the raw EN values
 *     (str(d.verdict) === "Lucky" → "good") BEFORE display translation.
 *  3. lang other than "hi" behaves exactly like EN.
 */

const DEVANAGARI = /[\u0900-\u097F]/;

describe("GET /api/v1/calculators/* ?lang=hi", () => {
  it("sun-sign localizes rashi/lord/element and interpretation to Hindi", async () => {
    const res = await app.request("/api/v1/calculators/sun-sign?date=2025-01-14&lang=hi");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, unknown> & {
        tropical_sign: string;
        rashi: string;
        lord: string;
        element: string;
        nakshatra: string;
        interpretation: { verdict: string; basis?: string };
        engine_version: string;
      };
    };
    expect(body.data.tropical_sign).toBe("मकर");
    expect(body.data.rashi).toBe("मकर");
    expect(body.data.lord).toBe("शनि");
    expect(body.data.element).toBe("पृथ्वी");
    expect(DEVANAGARI.test(body.data.nakshatra)).toBe(true);
    expect(DEVANAGARI.test(body.data.interpretation.verdict)).toBe(true);
    expect(body.data.engine_version).toMatch(/^1\./);
  });

  it("sun-sign EN mode is unchanged when lang is absent", async () => {
    const res = await app.request("/api/v1/calculators/sun-sign?date=2025-01-14");
    const body = (await res.json()) as { data: { rashi: string; lord: string } };
    expect(body.data.rashi).toBe("Capricorn");
    expect(body.data.lord).toBe("Saturn");
  });

  it("unknown lang values behave exactly like EN", async () => {
    const res = await app.request("/api/v1/calculators/sun-sign?date=2025-01-14&lang=fr");
    const body = (await res.json()) as { data: { rashi: string } };
    expect(body.data.rashi).toBe("Capricorn");
  });

  it("moon-phase localizes the phase name to Hindi", async () => {
    const res = await app.request(
      "/api/v1/calculators/moon-phase?date=2025-01-13&time=22:30&lang=hi",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { phase: string; interpretation: { verdict: string } };
    };
    expect(body.data.phase).toBe("पूर्णिमा");
    expect(DEVANAGARI.test(body.data.interpretation.verdict)).toBe(true);
  });

  it("vehicle-plate keeps the top-level verdict EN but localizes the interpretation (status-class coupling)", async () => {
    const plate = "DL8CAF1234";
    const en = (await (
      await app.request(`/api/v1/calculators/vehicle-plate?plate=${plate}&date=2025-01-14`)
    ).json()) as { data: { verdict: string; interpretation: { verdict: string } } };
    const hi = (await (
      await app.request(`/api/v1/calculators/vehicle-plate?plate=${plate}&date=2025-01-14&lang=hi`)
    ).json()) as { data: { verdict: string; interpretation: { verdict: string } } };
    // top-level verdict identical across languages — the frontend keys
    // status classes on this raw EN value
    expect(hi.data.verdict).toBe(en.data.verdict);
    // the display interpretation flips to Hindi
    expect(DEVANAGARI.test(hi.data.interpretation.verdict)).toBe(true);
    expect(en.data.interpretation.verdict).toBe(en.data.verdict);
  });
});

describe("POST /api/v1/kundli ?lang=hi", () => {
  const body = {
    date: "1990-05-15",
    time: "10:00",
    lat: 28.6139,
    lng: 77.209,
    tz: "Asia/Kolkata",
  };
  const PLANETS_HI = ["सूर्य", "चंद्र", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "राहु", "केतु"];

  it("localizes lagna/grahas/dasha value strings to Hindi", async () => {
    const res = await app.request("/api/v1/kundli?lang=hi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        lagna: { sign: string; nakshatra: string };
        grahas: Array<{ planet: string; sign: string; nakshatra: string }>;
        dasha: { moon_nakshatra_lord: string; mahadashas: Array<{ lord: string }> };
        sade_sati: Record<string, unknown>;
        manglik: Record<string, unknown>;
        kaal_sarp: Record<string, unknown>;
      };
    };
    expect(DEVANAGARI.test(json.data.lagna.sign)).toBe(true);
    expect(DEVANAGARI.test(json.data.lagna.nakshatra)).toBe(true);
    for (const g of json.data.grahas) {
      expect(DEVANAGARI.test(g.sign)).toBe(true);
      expect(DEVANAGARI.test(g.nakshatra)).toBe(true);
    }
    const firstLord = json.data.dasha.mahadashas[0]?.lord ?? "";
    expect(PLANETS_HI).toContain(firstLord);
    expect(DEVANAGARI.test(json.data.dasha.moon_nakshatra_lord)).toBe(true);
    for (const key of ["sade_sati", "manglik", "kaal_sarp"]) {
      expect((json.data as unknown as Record<string, unknown>)[key]).toBeDefined();
    }
  });

  it("EN mode (no lang param) still returns English value strings", async () => {
    const res = await app.request("/api/v1/kundli", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      data: { lagna: { sign: string }; grahas: Array<{ sign: string }> };
    };
    expect(DEVANAGARI.test(json.data.lagna.sign)).toBe(false);
    for (const g of json.data.grahas) expect(DEVANAGARI.test(g.sign)).toBe(false);
  });
});
