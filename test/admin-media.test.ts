import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Admin Phase 3 — media list (safeQuery search + per-row usage counts) and
 * the guarded DELETE ([R7]: referenced → 409 {used_in}; ?force=true needs
 * media.force_delete, checked in-handler; storage 404 = already gone).
 * Plus the blocks-PUT sanitizeDeep wiring ([R9]).
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  RATE_LIMIT_DISABLED: "1",
};

const originalFetch = globalThis.fetch;

function fakeJwt(): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "user-1", aal: "aal1" })}.sig`;
}
const TOKEN = fakeJwt();
const authed = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
});
const jsonReq = (path: string, method: string, body: unknown) => ({
  method,
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockSupabase(handler: Handler) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("fake-project.supabase.co")) {
      return new Response("unmocked", { status: 599 });
    }
    const out = handler(url, init ?? {});
    return out ?? new Response("unmocked upstream: " + url, { status: 599 });
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const identityAs =
  (role: string): Handler =>
  (url) => {
    if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "admin@vyotish.com" });
    if (url.includes("/rest/v1/admin_users"))
      return json([{ user_id: "user-1", email: "admin@vyotish.com", role }]);
    return undefined;
  };

const MEDIA_ID = "ddddddd1-0000-4000-8000-000000000001";
const MEDIA_ROW = {
  id: MEDIA_ID,
  bucket: "media",
  path: "2026-11/abc-chart.png",
  mime: "image/png",
  size_bytes: 1234,
  alt: "chart",
  created_at: "2026-11-26T00:00:00Z",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/v1/admin/media", () => {
  it("returns items with per-row used_in counts and public URLs", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/media?")) {
        return json([MEDIA_ROW]);
      }
      if (url.includes("blog_posts?or=")) {
        return json([{ id: "p1" }], 200, { "content-range": "0-0/2" });
      }
      return identityAs("admin")(url);
    });
    const res = await app.request("/api/v1/admin/media", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: Array<{ used_in: number; url: string; path: string }> };
    };
    expect(body.data.items[0]?.used_in).toBe(2);
    expect(body.data.items[0]?.url).toContain(
      "/storage/v1/object/public/media/2026-11/abc-chart.png",
    );
  });

  it("passes a sanitised q through as an ilike on path/alt", async () => {
    let seen = "";
    mockSupabase((url) => {
      if (url.includes("/rest/v1/media?")) {
        seen = url;
        return json([]);
      }
      return identityAs("admin")(url);
    });
    // comma is a PostgREST or= operator — safeQuery must strip it
    const res = await app.request("/api/v1/admin/media?q=chart,png", authed(), BINDINGS);
    expect(res.status).toBe(200);
    expect(seen).toContain("path.ilike.");
    expect(seen).toContain("alt.ilike.");
    expect(seen).not.toContain("chart,png");
  });
});

describe("DELETE /api/v1/admin/media/:id", () => {
  it("404s an unknown id", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/media?id=eq.")) return json([]);
      return identityAs("admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/media/${MEDIA_ID}`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("409s a referenced image with {used_in:n} and touches nothing", async () => {
    let storageDeleted = 0;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/media?id=eq.")) return json([MEDIA_ROW]);
      if (url.includes("blog_posts?or=")) {
        return json([{ id: "p1" }], 200, { "content-range": "0-0/4" });
      }
      if (url.includes("/storage/v1/object/media/") && init?.method === "DELETE") {
        storageDeleted += 1;
        return json({}, 200);
      }
      return identityAs("admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/media/${MEDIA_ID}`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string; used_in: number } };
    expect(body.error.used_in).toBe(4);
    expect(body.error.message).toContain("force=true");
    expect(storageDeleted).toBe(0);
  });

  it("force=true as content_editor is 403 — media.force_delete is admin+ ([R4])", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/media?id=eq.")) return json([MEDIA_ROW]);
      if (url.includes("blog_posts?or=")) {
        return json([{ id: "p1" }], 200, { "content-range": "0-0/1" });
      }
      return identityAs("content_editor")(url);
    });
    const res = await app.request(
      `/api/v1/admin/media/${MEDIA_ID}?force=true`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("content_editor");
  });

  it("unreferenced delete: storage object removed, row removed, audited", async () => {
    const order: string[] = [];
    const { audits, wrapped } = auditCapturer((url, init) => {
      if (url.includes("/rest/v1/media?id=eq.") && (init?.method ?? "GET") !== "DELETE") {
        return json([MEDIA_ROW]);
      }
      if (url.includes("blog_posts?or=")) return json([], 200, { "content-range": "*/0" });
      if (url.includes("/storage/v1/object/media/") && init?.method === "DELETE") {
        order.push("storage");
        return json({}, 200);
      }
      if (url.includes("/rest/v1/media?id=eq.") && init?.method === "DELETE") {
        order.push("row");
        return json([{ id: MEDIA_ID }]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      `/api/v1/admin/media/${MEDIA_ID}`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(order).toEqual(["storage", "row"]);
    expect(audits[0]?.action).toBe("media.delete");
    expect(audits[0]?.details.force).toBe(false);
    expect(audits[0]?.details.path).toBe("2026-11/abc-chart.png");
  });

  it("force=true as admin succeeds on a referenced image and audits force:true", async () => {
    const { audits, wrapped } = auditCapturer((url, init) => {
      if (url.includes("/rest/v1/media?id=eq.") && (init?.method ?? "GET") === "GET") {
        return json([MEDIA_ROW]);
      }
      if (url.includes("blog_posts?or=")) {
        return json([{ id: "p1" }], 200, { "content-range": "0-0/1" });
      }
      if (url.includes("/storage/v1/object/media/") && init?.method === "DELETE") {
        return json({}, 200);
      }
      if (url.includes("/rest/v1/media?id=eq.") && init?.method === "DELETE") {
        return json([{ id: MEDIA_ID }]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      `/api/v1/admin/media/${MEDIA_ID}?force=true`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { used_in: number; force: boolean } };
    expect(body.data.used_in).toBe(1);
    expect(body.data.force).toBe(true);
    expect(audits[0]?.details.force).toBe(true);
  });

  it("treats a 404 storage object as already gone and still removes the row", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/media?id=eq.")) {
        return (init?.method ?? "GET") === "DELETE" ? json([{ id: MEDIA_ID }]) : json([MEDIA_ROW]);
      }
      if (url.includes("blog_posts?or=")) return json([], 200, { "content-range": "*/0" });
      if (url.includes("/storage/v1/object/media/") && init?.method === "DELETE") {
        return new Response("not found", { status: 404 });
      }
      return identityAs("admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/media/${MEDIA_ID}`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
  });
});

function auditCapturer(handler: Handler) {
  const audits: Array<{ action: string; details: Record<string, unknown> }> = [];
  const wrapped: Handler = (url, init) => {
    if (url.includes("/rest/v1/audit_log") && (init?.method ?? "GET") === "POST") {
      const parsed = JSON.parse(String(init?.body)) as {
        action: string;
        details: Record<string, unknown>;
      };
      audits.push(parsed);
      return json([], 201);
    }
    return handler(url, init);
  };
  return { audits, wrapped };
}

describe("PUT /api/v1/admin/content-blocks/:key — sanitizeDeep [R9]", () => {
  it("scrubs scriptable HTML from string payload values on save", async () => {
    let stored: Array<Record<string, unknown>> = [];
    const { audits, wrapped } = auditCapturer((url, init) => {
      if (url.includes("content_blocks?on_conflict=") && init?.method === "POST") {
        stored = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
        return json([{ id: "blk-1", block_key: "kundli.lagna", lang: "en", status: "published" }]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      "/api/v1/admin/content-blocks/kundli.lagna",
      jsonReq("/blocks", "PUT", {
        lang: "en",
        status: "published",
        payload: {
          text: "<script>alert(1)</script>Lagna note",
          safe: "<b>bold</b> stays",
          count: 3,
        },
      }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const payload = stored[0]?.payload as Record<string, unknown>;
    expect(payload.text).toBe("Lagna note");
    expect(payload.safe).toBe("<b>bold</b> stays");
    expect(payload.count).toBe(3);
    expect(audits[0]?.action).toBe("content_blocks.update");
  });
});
