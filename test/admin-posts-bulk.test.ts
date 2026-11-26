import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Admin Phase 3 — bulk publish/unpublish/trash contract ([R5]), restore with
 * the publish_at sweep-trap fix ([R3]) and the purge gate ([R4][R10]).
 * All-or-nothing front door, per-id results, per-post audits; purge is
 * super_admin-only, Trash-only, audit-before-delete.
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
const post = (path: string, body: unknown) =>
  authed({
    method: "POST",
    headers: { "content-type": "application/json" },
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

/** Identity middleware responder for a chosen role. */
const identityAs =
  (role: string): Handler =>
  (url) => {
    if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "admin@vyotish.com" });
    if (url.includes("/rest/v1/admin_users"))
      return json([{ user_id: "user-1", email: "admin@vyotish.com", role }]);
    return undefined;
  };

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_GONE = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Capture audit_log POSTs in call order alongside other events. */
function auditCapturer(handler: Handler) {
  const events: Array<{ kind: "audit" | "other"; url: string; body?: unknown }> = [];
  const wrapped: Handler = (url, init) => {
    if (url.includes("/rest/v1/audit_log") && (init?.method ?? "GET") === "POST") {
      events.push({ kind: "audit", url, body: JSON.parse(String(init?.body)) });
      return json([], 201);
    }
    const out = handler(url, init);
    if (out) events.push({ kind: "other", url });
    return out;
  };
  return { events, wrapped };
}

describe("POST /api/v1/admin/posts/bulk — validation", () => {
  it("rejects an unknown action, empty ids and non-UUID ids with 400", async () => {
    mockSupabase(identityAs("admin"));
    const cases: Array<[unknown, string]> = [
      [{ ids: [ID_A], action: "nuke" }, "action"],
      [{ ids: [], action: "publish" }, "ids"],
      [{ ids: ["not-a-uuid"], action: "publish" }, "ids"],
    ];
    for (const [body, field] of cases) {
      const res = await app.request("/api/v1/admin/posts/bulk", post("/bulk", body), BINDINGS);
      expect(res.status).toBe(400);
      const b = (await res.json()) as { error: { details: Array<{ field: string }> } };
      expect(b.error.details[0]?.field).toBe(field);
    }
  });

  it("caps bulk size at 50 ids", async () => {
    mockSupabase(identityAs("admin"));
    const big = { ids: Array.from({ length: 51 }, () => ID_A), action: "publish" };
    const res = await app.request("/api/v1/admin/posts/bulk", post("/bulk", big), BINDINGS);
    expect(res.status).toBe(400);
    const b = (await res.json()) as { error: { details: Array<{ field: string }> } };
    expect(b.error.details[0]?.field).toBe("ids");
  });

  it("aborts the WHOLE request when any id is missing/already-trashed — zero writes", async () => {
    let patches = 0;
    const { events, wrapped } = auditCapturer((url) => {
      if (url.includes("blog_posts?id=in.")) {
        return json([
          { id: ID_A, status: "draft", slug: "a", title: "A" },
          { id: ID_B, status: "draft", slug: "b", title: "B" },
        ]);
      }
      if (url.includes(`blog_posts?id=eq.`) && url.includes("deleted_at=is.null")) patches += 1;
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      "/api/v1/admin/posts/bulk",
      post("/bulk", { ids: [ID_A, ID_B, ID_GONE], action: "publish" }),
      BINDINGS,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; missing: string[] } };
    expect(body.error.code).toBe("not_found");
    expect(body.error.missing).toEqual([ID_GONE]);
    expect(patches).toBe(0);
    expect(events.filter((e) => e.kind === "audit")).toHaveLength(0);
  });
});

describe("POST /api/v1/admin/posts/bulk — per-id loop", () => {
  it("publishes each id with its own PATCH + per-post audit rows", async () => {
    const patches: Array<Record<string, unknown>> = [];
    const { events, wrapped } = auditCapturer((url, init) => {
      if (url.includes("blog_posts?id=in.")) {
        return json([
          { id: ID_A, status: "draft", slug: "a", title: "A" },
          { id: ID_B, status: "draft", slug: "b", title: "B" },
        ]);
      }
      if (url.includes(`blog_posts?id=eq.`) && init?.method === "PATCH") {
        patches.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json([]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      "/api/v1/admin/posts/bulk",
      post("/bulk", { ids: [ID_A, ID_B], action: "publish" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { results: Array<{ id: string; ok: boolean }> } };
    expect(body.data.results).toEqual([
      { id: ID_A, ok: true },
      { id: ID_B, ok: true },
    ]);
    expect(patches).toHaveLength(2);
    for (const p of patches) {
      expect(p.status).toBe("published");
      expect(typeof p.publish_at).toBe("string"); // first publish stamps the date
    }
    const audits = events.filter((e) => e.kind === "audit");
    expect(audits).toHaveLength(2);
    const actions = audits.map((a) => (a.body as { action: string }).action);
    expect(actions).toEqual(["blog_posts.update", "blog_posts.update"]);
    expect((audits[0]?.body as { details: { bulk: boolean } }).details.bulk).toBe(true);
  });

  it("unpublish clears publish_at so the sweep cannot re-publish ([R3])", async () => {
    let patch: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("blog_posts?id=in.")) {
        return json([{ id: ID_A, status: "published", slug: "a", title: "A" }]);
      }
      if (url.includes(`blog_posts?id=eq.`) && init?.method === "PATCH") {
        patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([]);
      }
      return identityAs("admin")(url);
    });
    const res = await app.request(
      "/api/v1/admin/posts/bulk",
      post("/bulk", { ids: [ID_A], action: "unpublish" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(patch?.status).toBe("draft");
    expect(patch?.publish_at).toBeNull();
  });

  it("reports a per-id transition failure without blocking the rest", async () => {
    mockSupabase((url, init) => {
      if (url.includes("blog_posts?id=in.")) {
        return json([
          { id: ID_A, status: "archived", slug: "a", title: "A" },
          { id: ID_B, status: "published", slug: "b", title: "B" },
        ]);
      }
      if (url.includes(`blog_posts?id=eq.`) && init?.method === "PATCH") return json([]);
      return identityAs("admin")(url);
    });
    // archived → draft is the one blocked unpublish; published → draft passes
    const res = await app.request(
      "/api/v1/admin/posts/bulk",
      post("/bulk", { ids: [ID_A, ID_B], action: "unpublish" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { results: Array<{ id: string; ok: boolean; error?: string }> };
    };
    expect(body.data.results[0]?.ok).toBe(false);
    expect(body.data.results[0]?.error).toContain("archived → draft");
    expect(body.data.results[1]?.ok).toBe(true);
  });

  it("trash writes deleted_at + a bulk:true trash audit per post", async () => {
    const patches: Array<Record<string, unknown>> = [];
    const { events, wrapped } = auditCapturer((url, init) => {
      if (url.includes("blog_posts?id=in.")) {
        return json([{ id: ID_A, status: "draft", slug: "a", title: "A" }]);
      }
      if (url.includes(`blog_posts?id=eq.`) && init?.method === "PATCH") {
        patches.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json([]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      "/api/v1/admin/posts/bulk",
      post("/bulk", { ids: [ID_A], action: "trash" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(patches[0]?.deleted_at).toBeTruthy();
    const audits = events.filter((e) => e.kind === "audit");
    expect(audits).toHaveLength(1);
    expect((audits[0]?.body as { action: string }).action).toBe("blog_posts.trash");
    expect((audits[0]?.body as { details: { bulk: boolean } }).details.bulk).toBe(true);
  });
});

describe("POST /api/v1/admin/posts/:id/restore", () => {
  it("clears a PAST publish_at on restore so the sweep cannot resurrect it ([R3])", async () => {
    let patch: Record<string, unknown> | undefined;
    const { events, wrapped } = auditCapturer((url, init) => {
      if (url.includes("deleted_at=not.is.null")) {
        return json([
          {
            id: ID_A,
            status: "published",
            publish_at: "2026-01-01T00:00:00Z", // past
            slug: "stale-schedule",
          },
        ]);
      }
      if (url.includes(`blog_posts?id=eq.`) && init?.method === "PATCH") {
        patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      `/api/v1/admin/posts/${ID_A}/restore`,
      post("/restore", {}),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; publish_at_cleared: boolean } };
    expect(body.data.status).toBe("draft");
    expect(body.data.publish_at_cleared).toBe(true);
    expect(patch?.deleted_at).toBeNull();
    expect(patch?.status).toBe("draft");
    expect(patch?.publish_at).toBeNull();
    const audits = events.filter((e) => e.kind === "audit");
    expect((audits[0]?.body as { action: string }).action).toBe("blog_posts.restore");
  });

  it("keeps a FUTURE publish_at — the schedule survives the trash round-trip", async () => {
    let patch: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("deleted_at=not.is.null")) {
        return json([
          {
            id: ID_A,
            status: "draft",
            publish_at: "2099-01-01T00:00:00Z", // future
            slug: "scheduled",
          },
        ]);
      }
      if (url.includes(`blog_posts?id=eq.`) && init?.method === "PATCH") {
        patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([]);
      }
      return identityAs("admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/posts/${ID_A}/restore`,
      post("/restore", {}),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { publish_at_cleared: boolean } };
    expect(body.data.publish_at_cleared).toBe(false);
    expect(patch?.publish_at).toBeUndefined(); // untouched
  });

  it("404s a post that is not in the Trash", async () => {
    mockSupabase((url) => {
      if (url.includes("deleted_at=not.is.null")) return json([]);
      return identityAs("admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/posts/${ID_A}/restore`,
      post("/restore", {}),
      BINDINGS,
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/admin/posts/:id?purge=true", () => {
  it("403s content_editor and admin — purge is super_admin-only ([R4])", async () => {
    for (const role of ["content_editor", "admin", "booking_manager"]) {
      mockSupabase(identityAs(role));
      const res = await app.request(
        `/api/v1/admin/posts/${ID_A}?purge=true`,
        authed({ method: "DELETE" }),
        BINDINGS,
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain(role);
    }
  });

  it("409s a live (non-trashed) post even for super_admin", async () => {
    mockSupabase((url) => {
      if (url.includes("blog_posts?id=eq.")) {
        return json([{ id: ID_A, slug: "live", deleted_at: null }]);
      }
      return identityAs("super_admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/posts/${ID_A}?purge=true`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("trash it first");
  });

  it("super_admin purge: full pre-image + tags audited BEFORE the hard delete", async () => {
    const seq: string[] = [];
    let auditBefore: unknown;
    const fullRow = {
      id: ID_A,
      slug: "trashed-post",
      title: "Trashed",
      deleted_at: "2026-11-26T00:00:00Z",
    };
    const base: Handler = (url, init) => {
      if (url.includes("post_tags?post_id=eq.")) return json([{ tag_id: "t1" }]);
      if (url.includes("blog_tags?id=in.")) return json([{ slug: "vedic" }]);
      if (url.includes(`blog_posts?id=eq.`) && !url.includes("post_tags")) {
        if ((init?.method ?? "GET") === "DELETE") {
          seq.push("delete");
          return json([{ id: ID_A }]);
        }
        seq.push("read");
        return json([fullRow]);
      }
      return identityAs("super_admin")(url);
    };
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/audit_log") && (init?.method ?? "GET") === "POST") {
        seq.push("audit");
        auditBefore = (JSON.parse(String(init?.body)) as { details: unknown }).details;
        return json([], 201);
      }
      return base(url, init);
    });
    const res = await app.request(
      `/api/v1/admin/posts/${ID_A}?purge=true`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { purged: boolean } };
    expect(body.data.purged).toBe(true);
    expect(seq).toEqual(["read", "audit", "delete"]); // audit FIRST — it is the backup
    const details = auditBefore as { before: Record<string, unknown>; tags: string[] };
    expect(details.before.slug).toBe("trashed-post");
    expect(details.tags).toEqual(["vedic"]);
  });

  it("hard delete returning no rows answers 404 (idempotent repeat)", async () => {
    mockSupabase((url, init) => {
      if (url.includes("post_tags?post_id=eq.")) return json([]);
      if (url.includes(`blog_posts?id=eq.`) && (init?.method ?? "GET") === "DELETE") {
        return json([]);
      }
      if (url.includes(`blog_posts?id=eq.`)) {
        return json([{ id: ID_A, deleted_at: "2026-11-26T00:00:00Z" }]);
      }
      return identityAs("super_admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/posts/${ID_A}?purge=true`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(404);
  });
});
