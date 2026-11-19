import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Epic 7.2 — rate limiter: fixed-window 429s on the login proxy. Uses a
 * dedicated x-forwarded-for bucket so it cannot pollute other test files'
 * "unknown"-IP counters (the Map is process-wide).
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

const originalFetch = globalThis.fetch;
const IP = "rate-limit-test-ip";

async function loginOnce(): Promise<Response> {
  return app.request(
    "/api/v1/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": IP },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    },
    BINDINGS,
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("rate limiting (Epic 7.2)", () => {
  it("429s after the fixed-window limit on /auth/login", async () => {
    globalThis.fetch = mock(
      async () => new Response("{}", { status: 400 }),
    ) as unknown as typeof fetch;
    let hit429 = false;
    // limit is 10/min — push 15 and expect a 429 among them
    for (let i = 0; i < 15; i += 1) {
      const res = await loginOnce();
      if (res.status === 429) {
        hit429 = true;
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe("rate_limited");
        break;
      }
    }
    expect(hit429).toBe(true);
  });

  it("unlimited paths never 429", async () => {
    globalThis.fetch = mock(
      async () => new Response("{}", { status: 400 }),
    ) as unknown as typeof fetch;
    for (let i = 0; i < 3; i += 1) {
      const res = await app.request("/api/v1/kundli", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": IP },
        body: "{}",
      });
      expect(res.status).not.toBe(429);
    }
  });
});
