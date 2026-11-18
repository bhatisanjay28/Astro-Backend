import { describe, expect, it } from "bun:test";
import app from "../src/app";

describe("POST /api/v1/kundli", () => {
  const body = {
    date: "1990-05-15",
    time: "10:00",
    lat: 28.6139,
    lng: 77.209,
    tz: "Asia/Kolkata",
  };

  it("returns the full kundli contract envelope", async () => {
    const res = await app.request("/api/v1/kundli", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        birth: { datetime_utc: string; timezone: string };
        lagna: { sign: string; house: number };
        grahas: Array<{
          planet: string;
          sign: string;
          nakshatra: string;
          pada: number;
          retrograde: boolean;
        }>;
        houses: Record<string, number>;
        navamsha: Record<string, number>;
        dasha: { moon_nakshatra_lord: string; mahadashas: Array<{ lord: string; years: number }> };
        engine_version: string;
      };
      meta: { consent_note: string };
    };
    expect(json.data.grahas.length).toBe(9);
    expect(json.data.lagna.house).toBe(1);
    expect(json.data.houses["Sun"]).toBeGreaterThanOrEqual(1);
    expect(json.data.navamsha["Moon"]).toBeGreaterThanOrEqual(0);
    expect(json.data.dasha.mahadashas.length).toBe(9);
    expect(json.data.engine_version).toMatch(/^1\./);
    expect(json.meta.consent_note).toContain("not stored");
  });

  it("interprets birth time in the given timezone (IST noon vs UTC)", async () => {
    const res = await app.request("/api/v1/kundli", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data: { birth: { datetime_utc: string } } };
    // 1990-05-15 10:00 IST === 04:30 UTC
    expect(json.data.birth.datetime_utc).toBe("1990-05-15T04:30:00.000Z");
  });

  it("rejects malformed date/time and coordinates", async () => {
    const cases: Array<Record<string, unknown>> = [
      { ...body, date: "15-05-1990" },
      { ...body, time: "25:99" },
      { ...body, lat: 200 },
      { ...body, tz: "Nope/Nowhere" },
      { date: "1990-05-15" }, // missing everything else
    ];
    for (const payload of cases) {
      const res = await app.request("/api/v1/kundli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("validation_error");
    }
  });

  it("rejects non-JSON body", async () => {
    const res = await app.request("/api/v1/kundli", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    expect(res.status).toBe(400);
  });

  it("works for a southern-hemisphere birth (Sydney)", async () => {
    const res = await app.request("/api/v1/kundli", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        date: "1995-01-20",
        time: "14:30",
        lat: -33.8688,
        lng: 151.2093,
        tz: "Australia/Sydney",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { lagna: { sign: string }; grahas: unknown[] } };
    expect(json.data.lagna.sign.length).toBeGreaterThan(0);
    expect(json.data.grahas.length).toBe(9);
  });
});
