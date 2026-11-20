import { describe, expect, it } from "bun:test";
import app from "../src/app";

/** QA-mindset: test the requirement's behaviour — envelope shape, statuses, unknown routes. */

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

type ErrorBody = { error: { code: string; message: string } };
type HealthBody = {
  data: { status: string; service: string; version: string; env: string };
  error?: { code: string; message: string };
};
type ApiInfoBody = { data: { name: string; version: string } };
type V1RootBody = { data: { version: string; planned: string[]; implemented: string[] } };

describe("GET /health", () => {
  it("returns 200 with ok status inside the contract envelope", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await json<HealthBody>(res);
    expect(body.data.status).toBe("ok");
    expect(body.data.service).toBe("astro-backend");
    expect(body.error).toBeUndefined();
  });

  it("is reachable via HEAD (probe-friendliness)", async () => {
    const res = await app.request("/health", { method: "HEAD" });
    expect(res.status).toBe(200);
  });
});

describe("GET /api", () => {
  it("describes the API with version info", async () => {
    const res = await app.request("/api");
    expect(res.status).toBe(200);
    const body = await json<ApiInfoBody>(res);
    expect(body.data.version).toBe("v1");
    expect(body.data.name).toContain("Vyotish");
  });
});

describe("GET /api/v1", () => {
  it("returns the contract root listing", async () => {
    const res = await app.request("/api/v1");
    expect(res.status).toBe(200);
    const body = await json<V1RootBody>(res);
    expect(body.data.version).toBe("v1");
    expect(Array.isArray(body.data.planned)).toBe(true);
    // panchang shipped with Epic 1/3.1 — implemented list must include it
    expect(body.data.implemented.some((e) => e.includes("/api/v1/panchang"))).toBe(true);
  });

  it("returns contract-shaped 404 for unknown v1 routes", async () => {
    const res = await app.request("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    const body = await json<ErrorBody>(res);
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.message).toBe("string");
  });
});

describe("CORS", () => {
  it("allows the production origin", async () => {
    const res = await app.request("/api/v1", { headers: { Origin: "https://vyotish.com" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://vyotish.com");
  });

  it("allows local dev origins", async () => {
    const res = await app.request("/api/v1", { headers: { Origin: "http://127.0.0.1:4321" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4321");
  });

  it("withholds CORS headers from unknown origins", async () => {
    const res = await app.request("/api/v1", { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("locks out local dev origins when ALLOW_LOCALHOST_CORS=false", async () => {
    // BUG-10 regression: the localhost allowance is an explicit, auditable
    // opt-out — production can set ALLOW_LOCALHOST_CORS=false.
    const res = await app.request(
      "/api/v1",
      { headers: { Origin: "http://127.0.0.1:4321" } },
      { ALLOW_LOCALHOST_CORS: "false" },
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const prod = await app.request(
      "/api/v1",
      { headers: { Origin: "https://vyotish.com" } },
      { ALLOW_LOCALHOST_CORS: "false" },
    );
    expect(prod.headers.get("access-control-allow-origin")).toBe("https://vyotish.com");
  });
});

describe("unknown top-level route", () => {
  it("returns contract-shaped 404", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    const body = await json<ErrorBody>(res);
    expect(body.error.code).toBe("not_found");
  });

  it("does not leak internals in the 404 message", async () => {
    const res = await app.request("/nope");
    const body = await json<ErrorBody>(res);
    expect(body.error.message).not.toMatch(/stack|at /i);
  });
});
