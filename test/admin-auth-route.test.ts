import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Route tests for Epic 6.1 admin auth:
 *  - without bindings → 503 service_unavailable (fail-closed);
 *  - missing/malformed/expired bearer → 401 unauthorized;
 *  - valid token but no admin_users row → 403 forbidden;
 *  - valid token + admin row → 200 with identity/role/aal (aal1 & aal2);
 *  - auth upstream unreachable → 503.
 * The live path (real Supabase) is verified post-deploy by the owner's token.
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

const originalFetch = globalThis.fetch;

/** Minimal unsigned JWT — only the payload's `aal` is read by the backend (post-validation). */
function fakeJwt(aal?: string): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payload = aal ? { sub: "user-1", aal } : { sub: "user-1" };
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

type MockSpec = {
  /** response for Supabase /auth/v1/user */
  user?: { status: number; body: unknown };
  /** response for PostgREST /rest/v1/admin_users */
  roles?: { status: number; body: unknown };
  /** simulate network failure on the Nth upstream call */
  throwOnCall?: number;
};

function mockSupabase(spec: MockSpec) {
  let calls = 0;
  globalThis.fetch = mock(async (input: unknown) => {
    calls += 1;
    if (spec.throwOnCall === calls) throw new TypeError("network down");
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      const { status, body } = spec.user ?? { status: 500, body: { error: "unmocked" } };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/admin_users")) {
      const { status, body } = spec.roles ?? { status: 500, body: { error: "unmocked" } };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("unmocked upstream call: " + url, { status: 599 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const authed = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("GET /api/v1/admin/me (Epic 6.1)", () => {
  it("returns 503 service_unavailable without DB/auth credentials", async () => {
    const res = await app.request("/api/v1/admin/me");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });

  it("returns 401 when no Authorization header is supplied", async () => {
    mockSupabase({});
    const res = await app.request("/api/v1/admin/me", {}, BINDINGS);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns 401 for a non-Bearer Authorization header", async () => {
    mockSupabase({});
    const res = await app.request(
      "/api/v1/admin/me",
      { headers: { Authorization: "Basic abc" } },
      BINDINGS,
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when Supabase rejects the token (expired/invalid)", async () => {
    mockSupabase({ user: { status: 401, body: { message: "invalid claim" } } });
    const res = await app.request("/api/v1/admin/me", authed(fakeJwt()), BINDINGS);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns 403 when the authenticated user has no admin_users row", async () => {
    mockSupabase({
      user: { status: 200, body: { id: "user-1", email: " civilian@example.com" } },
      roles: { status: 200, body: [] },
    });
    const res = await app.request("/api/v1/admin/me", authed(fakeJwt()), BINDINGS);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("returns identity + role + aal1 for a valid admin (password-only token)", async () => {
    mockSupabase({
      user: { status: 200, body: { id: "user-1", email: "owner@vyotish.com" } },
      roles: {
        status: 200,
        body: [{ user_id: "user-1", email: "owner@vyotish.com", role: "admin" }],
      },
    });
    const res = await app.request("/api/v1/admin/me", authed(fakeJwt()), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { user_id: string; email: string; role: string; aal: number };
    };
    expect(body.data.user_id).toBe("user-1");
    expect(body.data.email).toBe("owner@vyotish.com");
    expect(body.data.role).toBe("admin");
    expect(body.data.aal).toBe(1);
  });

  it("reports aal2 for an MFA assurance token", async () => {
    mockSupabase({
      user: { status: 200, body: { id: "user-1", email: "owner@vyotish.com" } },
      roles: {
        status: 200,
        body: [{ user_id: "user-1", email: "owner@vyotish.com", role: "editor" }],
      },
    });
    const res = await app.request("/api/v1/admin/me", authed(fakeJwt("aal2")), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { role: string; aal: number } };
    expect(body.data.role).toBe("editor");
    expect(body.data.aal).toBe(2);
  });

  it("returns 503 (fail-closed) when the auth upstream is unreachable", async () => {
    mockSupabase({ throwOnCall: 1 });
    const res = await app.request("/api/v1/admin/me", authed(fakeJwt()), BINDINGS);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("service_unavailable");
  });
});
