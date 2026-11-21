import { describe, expect, it } from "bun:test";
import app from "../src/app";

/**
 * S13 calculator routes (moon-phase / sun-sign / destiny-number) — QA-mindset:
 * contract envelope shape, research-verified values, and 400 paths for every
 * invalid input (missing date, bad format, impossible calendar date, bad time).
 */

interface DataBody {
  data: Record<string, unknown> & { engine_version: string };
  meta?: Record<string, string>;
}

describe("GET /api/v1/calculators/moon-phase", () => {
  it("returns phase, illumination, age and neighbour lunations", async () => {
    const res = await app.request("/api/v1/calculators/moon-phase?date=2025-01-13&time=22:30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataBody;
    expect(body.data.phase).toBe("Full Moon");
    expect(body.data.illumination as number).toBeGreaterThan(0.99);
    expect(body.data.waxing).toBe(false);
    expect(typeof body.data.moon_age_days).toBe("number");
    for (const key of ["prev_new_moon", "next_new_moon", "prev_full_moon", "next_full_moon"]) {
      expect(new Date(body.data[key] as string).toString()).not.toBe("Invalid Date");
    }
    expect(typeof body.data.rashi).toBe("string");
    expect(body.data.engine_version).toBeDefined();
    expect(body.meta?.note).toContain("UTC");
  });

  it("defaults the time to 12:00 UTC", async () => {
    const res = await app.request("/api/v1/calculators/moon-phase?date=2025-06-25");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataBody;
    expect(body.data.phase).toBe("New Moon");
  });

  it("rejects missing/malformed date, bad time and impossible dates", async () => {
    for (const url of [
      "/api/v1/calculators/moon-phase",
      "/api/v1/calculators/moon-phase?date=13-01-2025",
      "/api/v1/calculators/moon-phase?date=2025-02-30",
      "/api/v1/calculators/moon-phase?date=2025-01-13&time=25:00",
      "/api/v1/calculators/moon-phase?date=2025-01-13&time=9:30",
    ]) {
      const res = await app.request(url);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("validation_error");
      expect(body.error.message.length).toBeGreaterThan(0);
    }
  });
});

describe("GET /api/v1/calculators/sun-sign", () => {
  it("returns tropical sign + Vedic rashi + nakshatra + lord", async () => {
    const res = await app.request("/api/v1/calculators/sun-sign?date=2025-01-14");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataBody;
    expect(body.data.tropical_sign).toBe("Capricorn");
    expect(body.data.rashi).toBe("Capricorn"); // after the 09:03 IST Makar Sankranti
    expect(body.data.lord).toBe("Saturn");
    expect(typeof body.data.nakshatra).toBe("string");
    expect(body.data.pada).toBeGreaterThanOrEqual(1);
    expect(body.data.pada).toBeLessThanOrEqual(4);
    expect(body.data.engine_version).toBeDefined();
  });

  it("straddles the Mesha ingress (Apr 13 Meena, Apr 15 Mesha)", async () => {
    const before = (await (
      await app.request("/api/v1/calculators/sun-sign?date=2025-04-13")
    ).json()) as DataBody;
    const after = (await (
      await app.request("/api/v1/calculators/sun-sign?date=2025-04-15")
    ).json()) as DataBody;
    expect(before.data.rashi).toBe("Pisces");
    expect(after.data.rashi).toBe("Aries");
  });

  it("rejects missing/malformed and impossible dates", async () => {
    for (const url of [
      "/api/v1/calculators/sun-sign",
      "/api/v1/calculators/sun-sign?date=20250114",
      "/api/v1/calculators/sun-sign?date=2025-02-30",
    ]) {
      const res = await app.request(url);
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/v1/calculators/destiny-number", () => {
  it("returns Bhagyank + Mulank with lords and the master-33 flag", async () => {
    const res = await app.request("/api/v1/calculators/destiny-number?date=1970-06-19");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataBody;
    expect(body.data.destiny).toBe(6);
    expect(body.data.destiny_sum).toBe(33);
    expect(body.data.master).toBe(true);
    expect(body.data.mulank).toBe(1);
    expect(body.data.destiny_lord).toBe("Venus");
    expect(body.data.mulank_lord).toBe("Sun");
    expect(body.data.engine_version).toBeDefined();
  });

  it("matches the researched non-master vectors", async () => {
    const cases: Array<[string, number, number]> = [
      ["1947-08-15", 8, 6],
      ["1869-10-02", 9, 2],
      ["1950-09-17", 5, 8],
      ["1985-08-15", 1, 6],
    ];
    for (const [date, destiny, mulank] of cases) {
      const res = await app.request(`/api/v1/calculators/destiny-number?date=${date}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as DataBody;
      expect(body.data.destiny).toBe(destiny);
      expect(body.data.mulank).toBe(mulank);
      expect(body.data.master).toBe(false);
    }
  });

  it("rejects missing, malformed and impossible dates", async () => {
    for (const url of [
      "/api/v1/calculators/destiny-number",
      "/api/v1/calculators/destiny-number?date=19061970",
      "/api/v1/calculators/destiny-number?date=2025-02-30",
    ]) {
      const res = await app.request(url);
      expect(res.status).toBe(400);
    }
  });
});
