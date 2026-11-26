import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";
import { CAPABILITIES, type Capability, capabilitiesOf, roleCan } from "../src/lib/rbac";

/**
 * Admin Phase 1 — permission matrix as code (02-mary-gap-analysis §C) plus
 * the auth hardening contract (token-age cap, deactivated accounts,
 * capability 403s, user management, logout, login audit).
 *
 * The matrix block below is the enforcement artifact: if someone changes
 * rbac.ts without updating expectations here (or vice versa), this fails.
 * Unknown/legacy roles must carry NO capabilities (fail-safe).
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  RATE_LIMIT_DISABLED: "1",
};

const originalFetch = globalThis.fetch;

type JwtOpts = { aal?: string; iat?: number };
function fakeJwt(opts: JwtOpts | string = {}): string {
  const payload =
    typeof opts === "string"
      ? { sub: "user-1", ...(opts === "aal2" ? { aal: "aal2" } : {}) }
      : {
          sub: "user-1",
          ...(opts.aal ? { aal: opts.aal } : {}),
          ...(opts.iat ? { iat: opts.iat } : {}),
        };
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

type AdminRow = {
  user_id?: string;
  email?: string;
  role?: string;
  is_active?: boolean;
  display_name?: string | null;
};

type MockSpec = {
  adminRow?: AdminRow;
  /** extra responder for the Nth+ upstream calls (users/audit/logout routes) */
  respond?: (url: string, method: string) => Response | undefined;
};

function mockSupabase(spec: MockSpec = {}) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const custom = spec.respond?.(url, method);
    if (custom) return custom;
    if (url.includes("/auth/v1/user")) {
      const row = spec.adminRow ?? {};
      return new Response(
        JSON.stringify({ id: row.user_id ?? "user-1", email: row.email ?? "a@b.co" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/admin_users")) {
      const row = spec.adminRow ?? {};
      return new Response(
        JSON.stringify(
          row.role === undefined
            ? []
            : [
                {
                  user_id: row.user_id ?? "user-1",
                  email: row.email ?? "a@b.co",
                  role: row.role,
                  is_active: row.is_active ?? true,
                  display_name: row.display_name ?? null,
                },
              ],
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("unmocked upstream: " + method + " " + url, { status: 599 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const authed = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const jsonReq = (path: string, method: string, body: unknown, token = fakeJwt()) => ({
  method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// 1. The matrix itself
// ---------------------------------------------------------------------------
describe("permission matrix (02 §C, pinned)", () => {
  it("super_admin holds everything, including users.manage and settings.engine", () => {
    expect(roleCan("super_admin", "users.manage")).toBe(true);
    expect(roleCan("super_admin", "settings.engine")).toBe(true);
    for (const cap of CAPABILITIES) {
      expect(roleCan("super_admin", cap)).toBe(true);
    }
  });

  it("admin holds everything except users.manage, settings.engine and posts.purge", () => {
    expect(roleCan("admin", "users.manage")).toBe(false);
    expect(roleCan("admin", "settings.engine")).toBe(false);
    // phase-3 story [R4]: permanent blog purges are super_admin-only
    expect(roleCan("admin", "posts.purge")).toBe(false);
    expect(roleCan("admin", "media.force_delete")).toBe(true);
    for (const cap of CAPABILITIES) {
      if (cap === "users.manage" || cap === "settings.engine" || cap === "posts.purge") continue;
      expect(roleCan("admin", cap)).toBe(true);
    }
  });

  it("content_editor: content caps only — no inbox, catalog, settings, users", () => {
    const has = (cap: Capability) => roleCan("content_editor", cap);
    expect(has("posts.read")).toBe(true);
    expect(has("posts.write")).toBe(true);
    expect(has("posts.publish")).toBe(true); // owner decision D1
    expect(has("posts.purge")).toBe(false);
    expect(has("taxonomy.write")).toBe(true);
    expect(has("tags.merge")).toBe(false);
    expect(has("media.delete")).toBe(true);
    expect(has("media.force_delete")).toBe(false); // referenced deletes stay admin+ ([R4])
    expect(has("blocks.write")).toBe(true);
    expect(has("horoscope.write")).toBe(true);
    expect(has("horoscope.regenerate")).toBe(false);
    expect(has("nav.write")).toBe(true);
    expect(has("audit.read")).toBe(true);
    expect(has("inbox.read")).toBe(false);
    expect(has("inbox.write")).toBe(false);
    expect(has("inbox.read_pii")).toBe(false);
    expect(has("inbox.export")).toBe(false);
    expect(has("catalog.write")).toBe(false);
    expect(has("settings.read")).toBe(false);
    expect(has("settings.write")).toBe(false);
    expect(has("newsletter.read")).toBe(false);
    expect(has("users.manage")).toBe(false);
  });

  it("booking_manager: inbox + catalog + subscribers, no content or users", () => {
    const has = (cap: Capability) => roleCan("booking_manager", cap);
    expect(has("inbox.read")).toBe(true);
    expect(has("inbox.read_pii")).toBe(true);
    expect(has("inbox.write")).toBe(true);
    expect(has("inbox.export")).toBe(true);
    expect(has("catalog.read")).toBe(true);
    expect(has("catalog.write")).toBe(true);
    expect(has("newsletter.read")).toBe(true);
    expect(has("newsletter.export")).toBe(true);
    expect(has("newsletter.delete")).toBe(false);
    expect(has("audit.read")).toBe(true);
    expect(has("posts.write")).toBe(false);
    expect(has("media.write")).toBe(false);
    expect(has("settings.write")).toBe(false);
    expect(has("users.manage")).toBe(false);
  });

  it("viewer: dashboard + masked inbox reads only", () => {
    expect(capabilitiesOf("viewer").sort()).toEqual(["horoscope.read", "inbox.read", "stats.read"]);
    expect(roleCan("viewer", "audit.read")).toBe(false);
    expect(roleCan("viewer", "inbox.read_pii")).toBe(false);
    expect(roleCan("viewer", "posts.read")).toBe(false);
  });

  it("unknown/legacy roles carry NO capabilities (fail-safe)", () => {
    for (const legacy of ["editor", "", "root", "SUPER_ADMIN"]) {
      expect(capabilitiesOf(legacy)).toEqual([]);
      expect(roleCan(legacy, "stats.read")).toBe(false);
      expect(roleCan(legacy, "posts.read")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Auth hardening (resolveAdmin layers surfaced as HTTP statuses)
// ---------------------------------------------------------------------------
describe("admin auth hardening (Phase 1)", () => {
  it("rejects an access token older than the 12 h absolute cap", async () => {
    mockSupabase({ adminRow: { role: "admin" } });
    const stale = Math.floor(Date.now() / 1000) - 13 * 60 * 60;
    const res = await app.request("/api/v1/admin/me", authed(fakeJwt({ iat: stale })), BINDINGS);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toMatch(/Session expired/i);
  });

  it("accepts a fresh token and reports role, display_name and capabilities", async () => {
    mockSupabase({
      adminRow: {
        role: "booking_manager",
        display_name: "Rita",
        email: "rita@vyotish.com",
      },
    });
    const fresh = Math.floor(Date.now() / 1000) - 60;
    const res = await app.request("/api/v1/admin/me", authed(fakeJwt({ iat: fresh })), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { role: string; display_name: string; capabilities: string[] };
    };
    expect(body.data.role).toBe("booking_manager");
    expect(body.data.display_name).toBe("Rita");
    expect(body.data.capabilities).toContain("inbox.export");
    expect(body.data.capabilities).not.toContain("posts.write");
  });

  it("403s a deactivated admin even with a valid token", async () => {
    mockSupabase({ adminRow: { role: "admin", is_active: false } });
    const res = await app.request("/api/v1/admin/me", authed(fakeJwt()), BINDINGS);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toMatch(/deactivated/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Capability gates through the router
// ---------------------------------------------------------------------------
describe("capability gates (HTTP)", () => {
  it("audit log: admin reads, viewer is 403 with the role named", async () => {
    mockSupabase({
      adminRow: { role: "admin" },
      respond: (url) =>
        url.includes("/rest/v1/audit_log")
          ? new Response(JSON.stringify([{ id: 1, action: "auth.login", entity: "auth" }]), {
              status: 200,
              headers: { "content-type": "application/json", "content-range": "0-0/1" },
            })
          : undefined,
    });
    const ok = await app.request("/api/v1/admin/audit", authed(fakeJwt()), BINDINGS);
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { data: unknown[]; meta: { total: number } };
    expect(okBody.data).toHaveLength(1);
    expect(okBody.meta.total).toBe(1);

    mockSupabase({ adminRow: { role: "viewer" } });
    const no = await app.request("/api/v1/admin/audit", authed(fakeJwt()), BINDINGS);
    expect(no.status).toBe(403);
    const noBody = (await no.json()) as { error: { message: string } };
    expect(noBody.error.message).toContain("viewer");
  });

  it("content mutation: viewer POST /admin/posts is 403 (method-map gates fire)", async () => {
    // QA phase-1 finding 5: requireCapabilityFor passes methods absent from
    // its map with only requireAdmin — pin a representative mutation so a
    // future map regression (a POST losing its METHOD entry) fails here.
    mockSupabase({ adminRow: { role: "viewer" } });
    const no = await app.request(
      "/api/v1/admin/posts",
      jsonReq("POST /admin/posts", "POST", { title: "x" }),
      BINDINGS,
    );
    expect(no.status).toBe(403);
    const body = (await no.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("viewer");
  });

  it("user management: admin is 403, super_admin lists", async () => {
    mockSupabase({ adminRow: { role: "admin" } });
    const no = await app.request("/api/v1/admin/users", authed(fakeJwt()), BINDINGS);
    expect(no.status).toBe(403);

    mockSupabase({
      adminRow: { role: "super_admin" },
      respond: (url) =>
        url.includes("/auth/v1/admin/users")
          ? new Response(JSON.stringify({ users: [{ id: "user-1", last_sign_in_at: null }] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : undefined,
    });
    const ok = await app.request("/api/v1/admin/users", authed(fakeJwt()), BINDINGS);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: Array<{ role: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.role).toBe("super_admin");
  });

  it("invite: super_admin creates an invite + role row; role is validated", async () => {
    mockSupabase({
      adminRow: { role: "super_admin" },
      respond: (url, method) => {
        if (url.includes("/rest/v1/admin_users?email=eq.") && method === "GET") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/auth/v1/admin/generate_link") && method === "POST") {
          return new Response(JSON.stringify({ user: { id: "user-9" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/rest/v1/admin_users") && method === "POST") {
          return new Response("[]", {
            status: 201,
            headers: { "content-type": "application/json", prefer: "return=minimal" },
          });
        }
        return undefined;
      },
    });
    const bad = await app.request(
      "/api/v1/admin/users/invite",
      jsonReq("/api/v1/admin/users/invite", "POST", {
        email: "x@y.co",
        role: "emperor",
      }),
      BINDINGS,
    );
    expect(bad.status).toBe(400);

    const ok = await app.request(
      "/api/v1/admin/users/invite",
      jsonReq("/api/v1/admin/users/invite", "POST", {
        email: "newstaff@vyotish.com",
        role: "booking_manager",
        display_name: "Rita",
      }),
      BINDINGS,
    );
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { data: { user_id: string; role: string } };
    expect(body.data.user_id).toBe("user-9");
    expect(body.data.role).toBe("booking_manager");
  });

  it("invite is super_admin-only: booking_manager gets 403", async () => {
    mockSupabase({ adminRow: { role: "booking_manager" } });
    const res = await app.request(
      "/api/v1/admin/users/invite",
      jsonReq("/api/v1/admin/users/invite", "POST", { email: "x@y.co", role: "viewer" }),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });

  it("PATCH user: super_admin changes role, is blocked from self-role change", async () => {
    let selectCalls = 0;
    mockSupabase({
      adminRow: { role: "super_admin", user_id: "user-1" },
      respond: (url, method) => {
        if (url.includes("/rest/v1/admin_users?user_id=eq.user-2") && method === "GET") {
          selectCalls += 1;
          const role = selectCalls === 1 ? "viewer" : "booking_manager"; // before → after
          return new Response(
            JSON.stringify([
              {
                user_id: "user-2",
                email: "e@x.co",
                role,
                is_active: true,
                display_name: null,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/rest/v1/admin_users?user_id=eq.user-2") && method === "PATCH") {
          return new Response("[]", { status: 204 });
        }
        return undefined;
      },
    });
    const self = await app.request(
      "/api/v1/admin/users/user-1",
      jsonReq("/api/v1/admin/users/user-1", "PATCH", { role: "viewer" }),
      BINDINGS,
    );
    expect(self.status).toBe(403);
    const selfBody = (await self.json()) as { error: { message: string } };
    expect(selfBody.error.message).toMatch(/own role/i);

    const ok = await app.request(
      "/api/v1/admin/users/user-2",
      jsonReq("/api/v1/admin/users/user-2", "PATCH", { role: "booking_manager" }),
      BINDINGS,
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: { role: string } | null };
    expect(body.data?.role).toBe("booking_manager");
  });
});

// ---------------------------------------------------------------------------
// 4. Logout + login audit
// ---------------------------------------------------------------------------
describe("auth logout proxy (Phase 1)", () => {
  it("revokes the session via Supabase and answers ok", async () => {
    let auditPosts = 0;
    mockSupabase({
      respond: (url, method) => {
        if (url.includes("/rest/v1/audit_log") && method === "POST") {
          auditPosts += 1;
          return new Response("[]", {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        return url.includes("/auth/v1/logout") ? new Response("{}", { status: 204 }) : undefined;
      },
    });
    const res = await app.request(
      "/api/v1/auth/logout",
      jsonReq("/api/v1/auth/logout", "POST", { access_token: "tok" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
    // Supabase validated the token → the logout is attributed.
    expect(auditPosts).toBe(1);
  });

  it("treats an already-invalid token as signed-out (idempotent) and writes NO audit row", async () => {
    // Pre-commit review P1: auditing the 401 path decodes the sub of an
    // *unverified* token — anyone could forge audit rows for any admin.
    let auditPosts = 0;
    mockSupabase({
      respond: (url, method) => {
        if (url.includes("/rest/v1/audit_log") && method === "POST") {
          auditPosts += 1;
          return new Response("[]", {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        return url.includes("/auth/v1/logout") ? new Response("{}", { status: 401 }) : undefined;
      },
    });
    const res = await app.request(
      "/api/v1/auth/logout",
      jsonReq("/api/v1/auth/logout", "POST", { access_token: "forged.forged.forged" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(auditPosts).toBe(0);
  });

  it("requires an access_token", async () => {
    const res = await app.request(
      "/api/v1/auth/logout",
      jsonReq("/api/v1/auth/logout", "POST", {}),
      BINDINGS,
    );
    expect(res.status).toBe(400);
  });
});
