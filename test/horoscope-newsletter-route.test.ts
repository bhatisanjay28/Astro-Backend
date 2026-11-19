import { describe, expect, it } from "bun:test";
import app from "../src/app";

/**
 * Route tests run WITHOUT Supabase bindings (like the city-mode Panchang
 * tests): validation paths and the explicit 503 service-unavailable contract.
 * The live DB path is verified post-deploy against the real project.
 */
describe("GET /api/v1/horoscope (Epic 5.1 minimal)", () => {
  it("rejects an unknown period with validation_error", async () => {
    const res = await app.request("/api/v1/horoscope?period=hourly");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("rejects an unknown lang", async () => {
    const res = await app.request("/api/v1/horoscope?lang=fr");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("rejects an unknown sign", async () => {
    const res = await app.request("/api/v1/horoscope?sign=ophiuchus");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 503 service_unavailable without DB credentials", async () => {
    const res = await app.request("/api/v1/horoscope");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });
});

describe("POST /api/v1/newsletter (Epic 5.5 minimal)", () => {
  it("rejects a malformed body", async () => {
    const res = await app.request("/api/v1/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("rejects an invalid email", async () => {
    const res = await app.request("/api/v1/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nope" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("rejects an unknown source", async () => {
    const res = await app.request("/api/v1/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.co", source: "spam" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("reaches the 503 contract before touching the DB when unconfigured", async () => {
    const res = await app.request("/api/v1/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", source: "gemstones_notify" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });

  it("throttles bursts from the same IP (429 rate_limited)", async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) {
      const res = await app.request("/api/v1/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
        body: JSON.stringify({ email: `burst${i}@example.com` }),
      });
      last = res.status;
    }
    expect(last).toBe(429);
    const followUp = await app.request("/api/v1/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
      body: JSON.stringify({ email: "more@example.com" }),
    });
    const body = (await followUp.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });
});
