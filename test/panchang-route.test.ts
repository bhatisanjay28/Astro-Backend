import { describe, expect, it } from "bun:test";
import app from "../src/app";

describe("GET /api/v1/panchang (coords mode)", () => {
  it("returns contract envelope with panchang for Delhi on a date", async () => {
    const res = await app.request(
      "/api/v1/panchang?lat=28.6139&lng=77.209&tz=Asia/Kolkata&date=2026-11-19",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        date: string;
        timezone: string;
        vaar: { name: string };
        tithi: Array<{ index: number; name: string }>;
        rahu_kaal: { name: string; verified: boolean };
        engine_version: string;
      };
    };
    expect(body.data.date).toBe("2026-11-19");
    expect(body.data.timezone).toBe("Asia/Kolkata");
    expect(body.data.vaar.name.length).toBeGreaterThan(0);
    expect(body.data.tithi.length).toBeGreaterThan(0);
    expect(body.data.rahu_kaal.name).toBe("Rahu Kaal");
    expect(body.data.engine_version).toMatch(/^1\./);
  });

  it("defaults to today when date omitted", async () => {
    const res = await app.request("/api/v1/panchang?lat=28.6139&lng=77.209&tz=Asia/Kolkata");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { date: string } };
    expect(body.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects malformed date", async () => {
    const res = await app.request("/api/v1/panchang?lat=28&lng=77&tz=Asia/Kolkata&date=19-11-2026");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("rejects out-of-range coordinates", async () => {
    const res = await app.request("/api/v1/panchang?lat=999&lng=77&tz=Asia/Kolkata");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("rejects invalid IANA timezone", async () => {
    const res = await app.request("/api/v1/panchang?lat=28&lng=77&tz=Not/AZone");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("requires either city or coordinates", async () => {
    const res = await app.request("/api/v1/panchang");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("city mode without backend credentials returns clear 503", async () => {
    const res = await app.request("/api/v1/panchang?city=mumbai&date=2026-11-19");
    // test env has no SUPABASE_URL/KEY bindings
    expect([200, 503]).toContain(res.status);
    if (res.status === 503) {
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("service_unavailable");
    }
  });
});
