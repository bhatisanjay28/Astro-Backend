/**
 * Admin Phase 5 — direct user creation, first-login password set, email edit,
 * and the legal.* deploy-hook ping (story
 * _bmad-output/admin/stories/phase-5-users-legal-cms).
 *
 * Same mock-Supabase style as admin-rbac.test.ts / content-blocks-route.test.ts:
 * the real Hono app is driven via app.request with a forged local JWT; the
 * live path (real Supabase) is verified post-deploy by the owner's token.
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  RATE_LIMIT_DISABLED: "1",
};

const originalFetch = globalThis.fetch;

function fakeJwt(sub = "user-1"): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub })}.sig`;
}
const authed = (token = fakeJwt()) => ({ headers: { Authorization: `Bearer ${token}` } });
const jsonReq = (path: string, method: string, body: unknown, token = fakeJwt()) => ({
  method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// POST /admin/users — direct creation (story AC 1/2/3)
// ---------------------------------------------------------------------------
describe("POST /admin/users (Phase 5 direct create)", () => {
  it("creates the auth account + flagged admin row and returns the one-time temp password", async () => {
    let authCreateBody: Record<string, unknown> | undefined;
    let insertBody: Record<string, unknown> | undefined;
    let auditBody: Record<string, unknown> | undefined;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "owner@x.co" });
      if (url.includes("/rest/v1/admin_users?user_id=eq.")) {
        return json([
          { user_id: "user-1", email: "owner@x.co", role: "super_admin", is_active: true },
        ]);
      }
      if (url.includes("/rest/v1/admin_users?email=eq.") && method === "GET") return json([]);
      if (url.includes("/auth/v1/admin/users") && method === "POST") {
        authCreateBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ id: "user-8" }, 201);
      }
      if (url.includes("/rest/v1/admin_users") && method === "POST") {
        insertBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([], 201);
      }
      if (url.includes("/rest/v1/audit_log") && method === "POST") {
        auditBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([], 201);
      }
      return new Response("unmocked: " + method + " " + url, { status: 599 });
    }) as unknown as typeof fetch;

    const res = await app.request(
      "/api/v1/admin/users",
      jsonReq("/api/v1/admin/users", "POST", {
        email: "NewStaff@vyotish.com",
        role: "content_editor",
        display_name: "Rita",
      }),
      BINDINGS,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        user_id: string;
        role: string;
        must_change_password: boolean;
        temporary_password: string;
      };
    };
    expect(body.data.user_id).toBe("user-8");
    expect(body.data.role).toBe("content_editor");
    expect(body.data.must_change_password).toBe(true);
    // temp password: 14 chars, letters+digits only, no ambiguity leaks
    const pw = body.data.temporary_password;
    expect(pw).toMatch(/^[A-Za-z0-9]{14}$/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[A-Za-z]/);

    // Supabase admin-create: email confirmed, password forwarded (hashing is Supabase's)
    expect(authCreateBody).toMatchObject({ email: "newstaff@vyotish.com", email_confirm: true });
    expect(String(authCreateBody?.password)).toHaveLength(14);
    // the admin row is born flagged so requireAdmin blocks the panel
    expect(insertBody).toMatchObject({
      user_id: "user-8",
      email: "newstaff@vyotish.com",
      role: "content_editor",
      must_change_password: true,
    });
    // AC 1: NO password material in the audit trail
    expect(auditBody?.action).toBe("users.create");
    const details = auditBody?.details as Record<string, unknown> | undefined;
    expect(details?.email).toBe("newstaff@vyotish.com");
    expect(details && ("password" in details || "temporary_password" in details)).toBe(false);
  });

  it("validates email and role (400)", async () => {
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "owner@x.co" });
      if (url.includes("/rest/v1/admin_users?user_id=eq.")) {
        return json([
          { user_id: "user-1", email: "owner@x.co", role: "super_admin", is_active: true },
        ]);
      }
      return new Response("unmocked", { status: 599 });
    }) as unknown as typeof fetch;

    const badEmail = await app.request(
      "/api/v1/admin/users",
      jsonReq("/api/v1/admin/users", "POST", { email: "not-an-email", role: "viewer" }),
      BINDINGS,
    );
    expect(badEmail.status).toBe(400);
    const badRole = await app.request(
      "/api/v1/admin/users",
      jsonReq("/api/v1/admin/users", "POST", { email: "x@y.co", role: "emperor" }),
      BINDINGS,
    );
    expect(badRole.status).toBe(400);
  });

  it("409s when the email already has an admin row or an auth account", async () => {
    let rowTaken = true;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "owner@x.co" });
      if (url.includes("/rest/v1/admin_users?user_id=eq.")) {
        return json([
          { user_id: "user-1", email: "owner@x.co", role: "super_admin", is_active: true },
        ]);
      }
      if (url.includes("/rest/v1/admin_users?email=eq.") && method === "GET") {
        // first request in this test → dup admin row; second → empty
        return rowTaken ? json([{ user_id: "taken" }]) : json([]);
      }
      if (url.includes("/auth/v1/admin/users") && method === "POST") {
        return json({ msg: "already been registered" }, 422);
      }
      return new Response("unmocked", { status: 599 });
    }) as unknown as typeof fetch;

    const dupRow = await app.request(
      "/api/v1/admin/users",
      jsonReq("/api/v1/admin/users", "POST", { email: "taken@x.co", role: "viewer" }),
      BINDINGS,
    );
    expect(dupRow.status).toBe(409);

    rowTaken = false;
    const dupAuth = await app.request(
      "/api/v1/admin/users",
      jsonReq("/api/v1/admin/users", "POST", { email: "authonly@x.co", role: "viewer" }),
      BINDINGS,
    );
    expect(dupAuth.status).toBe(409);
  });

  it("is super_admin-only (users.manage): booking_manager gets 403", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "bm@x.co" });
      if (url.includes("/rest/v1/admin_users?user_id=eq.")) {
        return json([
          { user_id: "user-1", email: "bm@x.co", role: "booking_manager", is_active: true },
        ]);
      }
      return new Response("unmocked", { status: 599 });
    }) as unknown as typeof fetch;
    const res = await app.request(
      "/api/v1/admin/users",
      jsonReq("/api/v1/admin/users", "POST", { email: "x@y.co", role: "viewer" }),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });

  it("PATCH email is also users.manage-only: booking_manager gets 403", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "bm@x.co" });
      if (url.includes("/rest/v1/admin_users?user_id=eq.")) {
        return json([
          { user_id: "user-1", email: "bm@x.co", role: "booking_manager", is_active: true },
        ]);
      }
      return new Response("unmocked", { status: 599 });
    }) as unknown as typeof fetch;
    const res = await app.request(
      "/api/v1/admin/users/user-2",
      jsonReq("/api/v1/admin/users/user-2", "PATCH", { email: "new@y.co" }),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id — email edit (story AC 6)
// ---------------------------------------------------------------------------
describe("PATCH /admin/users/:id email edit (Phase 5)", () => {
  function mockEmailPatch(opts: { dupHit?: boolean; authPutOk?: boolean } = {}) {
    let user2Gets = 0;
    let authPutBody: Record<string, unknown> | null = null;
    let authPutCalled = false;
    let rowPatchBody: Record<string, unknown> | null = null;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user") && method === "GET") {
        return json({ id: "user-1", email: "owner@x.co" });
      }
      if (url.includes("/rest/v1/admin_users?user_id=eq.user-1")) {
        return json([
          { user_id: "user-1", email: "owner@x.co", role: "super_admin", is_active: true },
        ]);
      }
      if (
        url.includes("/rest/v1/admin_users") &&
        url.includes("user_id=neq.") &&
        method === "GET"
      ) {
        return json(opts.dupHit ? [{ user_id: "other" }] : []);
      }
      if (url.includes("/rest/v1/admin_users?user_id=eq.user-2") && method === "GET") {
        user2Gets += 1;
        const email = user2Gets === 1 ? "old@x.co" : "new@x.co"; // before → after
        return json([{ user_id: "user-2", email, role: "viewer", is_active: true }]);
      }
      if (url.includes("/auth/v1/admin/users/user-2") && method === "PUT") {
        authPutCalled = true;
        if (opts.authPutOk === false) return json({ msg: "nope" }, 400);
        authPutBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ id: "user-2" }, 200);
      }
      if (url.includes("/rest/v1/admin_users?user_id=eq.user-2") && method === "PATCH") {
        rowPatchBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([], 204);
      }
      return new Response("unmocked: " + method + " " + url, { status: 599 });
    }) as unknown as typeof fetch;
    return {
      assert: () => ({ authPutCalled, authPutBody, rowPatchBody }),
    };
  }

  it("moves the auth identity first, then syncs the admin row", async () => {
    const m = mockEmailPatch();
    const res = await app.request(
      "/api/v1/admin/users/user-2",
      jsonReq("/api/v1/admin/users/user-2", "PATCH", { email: "New@X.co" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string } | null };
    expect(body.data?.email).toBe("new@x.co");
    const { authPutBody, rowPatchBody } = m.assert();
    expect(authPutBody).toMatchObject({ email: "new@x.co", email_confirm: true });
    expect(rowPatchBody?.email).toBe("new@x.co");
  });

  it("403s a self email change (identity-level, like role)", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "owner@x.co" });
      if (url.includes("/rest/v1/admin_users?user_id=eq.user-1")) {
        return json([
          { user_id: "user-1", email: "owner@x.co", role: "super_admin", is_active: true },
        ]);
      }
      return new Response("unmocked", { status: 599 });
    }) as unknown as typeof fetch;
    const res = await app.request(
      "/api/v1/admin/users/user-1",
      jsonReq("/api/v1/admin/users/user-1", "PATCH", { email: "me2@x.co" }, fakeJwt("user-1")),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });

  it("409s on a duplicate email and 502s when Supabase rejects the identity change", async () => {
    mockEmailPatch({ dupHit: true });
    const dupRes = await app.request(
      "/api/v1/admin/users/user-2",
      jsonReq("/api/v1/admin/users/user-2", "PATCH", { email: "taken@x.co" }),
      BINDINGS,
    );
    expect(dupRes.status).toBe(409);

    mockEmailPatch({ authPutOk: false });
    const rejRes = await app.request(
      "/api/v1/admin/users/user-2",
      jsonReq("/api/v1/admin/users/user-2", "PATCH", { email: "new@x.co" }),
      BINDINGS,
    );
    expect(rejRes.status).toBe(502);
  });

  it("skips the auth call when the email is unchanged", async () => {
    const m = mockEmailPatch();
    const res = await app.request(
      "/api/v1/admin/users/user-2",
      jsonReq("/api/v1/admin/users/user-2", "PATCH", { email: "old@x.co" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const { authPutCalled, rowPatchBody } = m.assert();
    expect(authPutCalled).toBe(false);
    expect(rowPatchBody && "email" in rowPatchBody).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/change-password (story AC 4/5)
// ---------------------------------------------------------------------------
describe("POST /auth/change-password (Phase 5)", () => {
  const path = "/api/v1/auth/change-password";

  it("400s a weak password", async () => {
    const short = await app.request(
      path,
      jsonReq(path, "POST", { new_password: "short1" }),
      BINDINGS,
    );
    expect(short.status).toBe(400);
    const noDigit = await app.request(
      path,
      jsonReq(path, "POST", { new_password: "onlylettershere" }),
      BINDINGS,
    );
    expect(noDigit.status).toBe(400);
    const noLetter = await app.request(
      path,
      jsonReq(path, "POST", { new_password: "123456789012" }),
      BINDINGS,
    );
    expect(noLetter.status).toBe(400);
  });

  it("401s without a bearer and with an invalid token", async () => {
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/v1/user") && (init?.method ?? "GET").toUpperCase() === "PUT") {
        return json({ msg: "bad token" }, 401);
      }
      return new Response("unmocked", { status: 599 });
    }) as unknown as typeof fetch;
    const noToken = await app.request(
      path,
      jsonReq(path, "POST", { new_password: "goodpass1234" }),
      BINDINGS,
    );
    expect(noToken.status).toBe(401);
    const bad = await app.request(
      path,
      jsonReq(path, "POST", { new_password: "goodpass1234" }, "not-a-jwt"),
      BINDINGS,
    );
    expect(bad.status).toBe(401);
  });

  it("updates the password via the caller's own bearer and clears the first-login flag", async () => {
    let userPutAuth = "";
    let userPutBody: Record<string, unknown> | undefined;
    let flagPatchBody: Record<string, unknown> | undefined;
    let auditAction = "";
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.includes("/auth/v1/user") && method === "PUT") {
        userPutAuth = headers.Authorization ?? "";
        userPutBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ id: "user-7" }, 200);
      }
      if (url.includes("/rest/v1/admin_users?user_id=eq.user-7") && method === "PATCH") {
        flagPatchBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([], 204);
      }
      if (url.includes("/rest/v1/audit_log") && method === "POST") {
        auditAction = (JSON.parse(String(init?.body)) as Record<string, unknown>).action as string;
        return json([], 201);
      }
      return new Response("unmocked: " + method + " " + url, { status: 599 });
    }) as unknown as typeof fetch;

    const res = await app.request(
      path,
      jsonReq(path, "POST", { new_password: "NewSecurePass123" }, fakeJwt("user-7")),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
    // the USER's token carried the change, not the service key
    expect(userPutAuth).toBe(`Bearer ${fakeJwt("user-7")}`);
    expect(userPutBody?.password).toBe("NewSecurePass123");
    expect(flagPatchBody?.must_change_password).toBe(false);
    expect(auditAction).toBe("auth.password_change");
  });
});

// ---------------------------------------------------------------------------
// legal.* blocks ping the Pages deploy hook (story AC 7)
// ---------------------------------------------------------------------------
describe("content-blocks legal deploy-hook ping (Phase 5)", () => {
  const HOOK_BINDINGS = {
    ...BINDINGS,
    FRONTEND_DEPLOY_HOOK_URL: "https://hooks.example.com/deploy",
  };

  function mockBlocks(hookCaptures: string[]) {
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("https://hooks.example.com")) {
        hookCaptures.push(url);
        return new Response("{}", { status: 200 });
      }
      if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "ed@x.co" });
      if (url.includes("/rest/v1/admin_users")) {
        return json([{ user_id: "user-1", email: "ed@x.co", role: "admin", is_active: true }]);
      }
      if (url.includes("/rest/v1/content_blocks")) {
        if (method === "GET") return json([]);
        if (method === "POST") return json([{ block_key: "x" }], 201);
        if (method === "DELETE") return json([]);
      }
      return new Response("unmocked: " + method + " " + url, { status: 599 });
    }) as unknown as typeof fetch;
  }

  it("pings the hook on a legal.* PUT and DELETE but not on other prefixes", async () => {
    let hookCalls: string[] = [];
    mockBlocks(hookCalls);
    const legalPut = await app.request(
      "/api/v1/admin/content-blocks/legal.privacy",
      jsonReq("/api/v1/admin/content-blocks/legal.privacy", "PUT", {
        lang: "en",
        status: "published",
        payload: { title: "Privacy Policy", sections: [] },
      }),
      HOOK_BINDINGS,
    );
    expect(legalPut.status).toBe(200);
    expect(hookCalls).toHaveLength(1);

    const kundliPut = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna",
      jsonReq("/api/v1/admin/content-blocks/kundli.lagna", "PUT", {
        lang: "en",
        status: "published",
        payload: { title: "Lagna" },
      }),
      HOOK_BINDINGS,
    );
    expect(kundliPut.status).toBe(200);
    expect(hookCalls).toHaveLength(1); // unchanged — kundli.* must not ping

    mockBlocks(hookCalls);
    const legalDelete = await app.request(
      "/api/v1/admin/content-blocks/legal.privacy?lang=hi",
      { method: "DELETE", headers: { Authorization: `Bearer ${fakeJwt()}` } },
      HOOK_BINDINGS,
    );
    expect(legalDelete.status).toBe(200);
    expect(hookCalls).toHaveLength(2); // legal PUT + legal DELETE

    mockBlocks(hookCalls);
    const kundliDelete = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna?lang=hi",
      { method: "DELETE", headers: { Authorization: `Bearer ${fakeJwt()}` } },
      HOOK_BINDINGS,
    );
    expect(kundliDelete.status).toBe(200);
    expect(hookCalls).toHaveLength(2); // unchanged — kundli.* must not ping
  });
});
