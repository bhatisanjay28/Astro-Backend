import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Admin Phase 3 — category/tag write routes: counts on the listings, create/
 * update with the 0017 fields, delete guards ([R6]: the DB FK is SET NULL so
 * the "still has posts" 409 is API-enforced), tag rename/delete, and the
 * PK-safe tag merge ([R6][R13], tags.merge is admin+ only).
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

const CAT_ID = "aaaaaaa1-0000-4000-8000-000000000001";
const TAG_ID = "bbbbbbb1-0000-4000-8000-000000000001";
const TAG_SRC = "ccccccc1-0000-4000-8000-000000000001";
const TAG_TGT = "ccccccc2-0000-4000-8000-000000000002";

/** Audit capture wrapper: collects audit_log POST bodies in order. */
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

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/v1/admin/categories", () => {
  it("lists categories with live-post counts (one-pass count, [R13])", async () => {
    mockSupabase((url) => {
      if (url.includes("blog_categories?select=")) {
        return json([
          {
            id: CAT_ID,
            slug: "basics",
            name: "Basics",
            name_hi: null,
            description: null,
            display_order: 0,
          },
        ]);
      }
      if (url.includes("blog_posts?select=category_id")) {
        return json([{ category_id: CAT_ID }, { category_id: CAT_ID }], 200, {
          "content-range": "0-1/2",
        });
      }
      return identityAs("admin")(url);
    });
    const res = await app.request("/api/v1/admin/categories", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { categories: Array<{ posts: number }> } };
    expect(body.data.categories[0]?.posts).toBe(2);
  });
});

describe("POST /api/v1/admin/categories", () => {
  it("creates with the 0017 fields and audits the create", async () => {
    let row: Record<string, unknown> | undefined;
    const { audits, wrapped } = auditCapturer((url, init) => {
      if (url.includes("/rest/v1/blog_categories") && init?.method === "POST") {
        row = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([{ id: CAT_ID, slug: "muhurat", name: "Muhurat" }], 201);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      "/api/v1/admin/categories",
      jsonReq("/categories", "POST", {
        name: "Muhurat",
        name_hi: "मुहूर्त",
        description: "Auspicious timing",
        display_order: 3,
      }),
      BINDINGS,
    );
    expect(res.status).toBe(201);
    expect(row?.slug).toBe("muhurat");
    expect(row?.name_hi).toBe("मुहूर्त");
    expect(row?.description).toBe("Auspicious timing");
    expect(row?.display_order).toBe(3);
    expect(audits[0]?.action).toBe("blog_categories.create");
  });

  it("rejects a missing name and a malformed slug", async () => {
    mockSupabase(identityAs("admin"));
    const noName = await app.request(
      "/api/v1/admin/categories",
      jsonReq("/categories", "POST", { name: "" }),
      BINDINGS,
    );
    expect(noName.status).toBe(400);
    const badSlug = await app.request(
      "/api/v1/admin/categories",
      jsonReq("/categories", "POST", { name: "X", slug: "Not A Slug" }),
      BINDINGS,
    );
    expect(badSlug.status).toBe(400);
  });

  it("409s a duplicate slug", async () => {
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/blog_categories") && init?.method === "POST") {
        return json([], 409);
      }
      return identityAs("admin")(url);
    });
    const res = await app.request(
      "/api/v1/admin/categories",
      jsonReq("/categories", "POST", { name: "Basics" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("conflict");
  });
});

describe("PUT /api/v1/admin/categories/:id", () => {
  it("updates fields and audits the pre-image", async () => {
    let patch: Record<string, unknown> | undefined;
    const { audits, wrapped } = auditCapturer((url, init) => {
      if (url.includes(`blog_categories?id=eq.${CAT_ID}&select=id,slug,name`)) {
        return json([{ id: CAT_ID, slug: "basics", name: "Basics", display_order: 0 }]);
      }
      if (url.includes(`blog_categories?id=eq.${CAT_ID}`) && init?.method === "PATCH") {
        patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([{ id: CAT_ID, slug: "basics", name: "Foundations", display_order: 2 }]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      `/api/v1/admin/categories/${CAT_ID}`,
      jsonReq("/categories", "PUT", { name: "Foundations", display_order: 2 }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(patch?.name).toBe("Foundations");
    expect(patch?.display_order).toBe(2);
    expect(audits[0]?.action).toBe("blog_categories.update");
    expect((audits[0]?.details.before as { slug: string }).slug).toBe("basics");
  });

  it("409s a slug collision with another category", async () => {
    mockSupabase((url) => {
      if (url.includes(`blog_categories?id=eq.${CAT_ID}&select=id,slug,name`)) {
        return json([{ id: CAT_ID, slug: "basics", name: "Basics" }]);
      }
      if (url.includes("blog_categories?slug=eq.muhurat&id=neq.")) {
        return json([{ id: "other-cat" }]);
      }
      return identityAs("admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/categories/${CAT_ID}`,
      jsonReq("/categories", "PUT", { slug: "muhurat" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
  });

  it("400s an empty update", async () => {
    mockSupabase((url) => {
      if (url.includes(`blog_categories?id=eq.${CAT_ID}&select=id,slug,name`)) {
        return json([{ id: CAT_ID, slug: "basics", name: "Basics" }]);
      }
      return identityAs("admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/categories/${CAT_ID}`,
      jsonReq("/categories", "PUT", {}),
      BINDINGS,
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/v1/admin/categories/:id", () => {
  it("409s with the post count when live posts still use the category ([R6])", async () => {
    mockSupabase((url) => {
      if (url.includes(`blog_categories?id=eq.${CAT_ID}&select=id,slug,name`)) {
        return json([{ id: CAT_ID, slug: "basics", name: "Basics" }]);
      }
      if (url.includes(`blog_posts?category_id=eq.${CAT_ID}&deleted_at=is.null`)) {
        return json([{ id: "p1" }], 200, { "content-range": "0-0/3" });
      }
      return identityAs("admin")(url);
    });
    const res = await app.request(
      `/api/v1/admin/categories/${CAT_ID}`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string; posts: number } };
    expect(body.error.posts).toBe(3);
    expect(body.error.message).toContain("reassign");
  });

  it("deletes an unused category and audits the pre-image", async () => {
    const { audits, wrapped } = auditCapturer((url, init) => {
      if (url.includes(`blog_categories?id=eq.${CAT_ID}&select=id,slug,name`)) {
        return json([{ id: CAT_ID, slug: "basics", name: "Basics" }]);
      }
      if (url.includes(`blog_posts?category_id=eq.${CAT_ID}&deleted_at=is.null`)) {
        return json([], 200, { "content-range": "*/0" });
      }
      if (url.includes(`blog_categories?id=eq.${CAT_ID}`) && init?.method === "DELETE") {
        return json([{ id: CAT_ID }]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      `/api/v1/admin/categories/${CAT_ID}`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
    expect(audits[0]?.action).toBe("blog_categories.delete");
  });
});

describe("GET /api/v1/admin/tags", () => {
  it("lists tags with link counts and passes the q filter", async () => {
    let seen = "";
    mockSupabase((url) => {
      if (url.includes("blog_tags?select=")) {
        seen = url;
        return json([{ id: TAG_ID, slug: "vedic", name: "Vedic" }]);
      }
      if (url.includes("post_tags?select=tag_id")) {
        return json([{ tag_id: TAG_ID }], 200, { "content-range": "0-0/1" });
      }
      return identityAs("admin")(url);
    });
    const res = await app.request("/api/v1/admin/tags?q=ved", authed(), BINDINGS);
    expect(res.status).toBe(200);
    expect(seen).toContain("slug=ilike.");
    const body = (await res.json()) as { data: { tags: Array<{ posts: number }> } };
    expect(body.data.tags[0]?.posts).toBe(1);
  });

  it("sanitises q through safeQuery — operator chars never reach the filter", async () => {
    let seen = "";
    mockSupabase((url) => {
      if (url.includes("blog_tags?select=")) {
        seen = url;
        return json([]);
      }
      return identityAs("admin")(url);
    });
    // comma/parens are PostgREST filter operators; encodeURIComponent leaves
    // them intact (phase-3 review P2) — safeQuery must strip them. Assert on
    // the derived filter param (the select list legitimately uses commas).
    const res = await app.request("/api/v1/admin/tags?q=ved,ic)", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const filter = new URL(seen).searchParams.get("slug") ?? "";
    expect(filter).not.toContain(",");
    expect(filter).not.toContain(")");
    expect(filter).toContain("ved");
  });
});

describe("PUT + DELETE /api/v1/admin/tags/:id", () => {
  it("renames a tag with a pre-image audit; collision 409s", async () => {
    const { audits, wrapped } = auditCapturer((url, init) => {
      if (url.includes(`blog_tags?id=eq.${TAG_ID}&select=id,slug,name`)) {
        return json([{ id: TAG_ID, slug: "vedic", name: "Vedic" }]);
      }
      if (url.includes("blog_tags?slug=eq.vedic-2&id=neq.")) return json([]);
      if (url.includes(`blog_tags?id=eq.${TAG_ID}`) && init?.method === "PATCH") {
        return json([{ id: TAG_ID, slug: "vedic-2", name: "Vedic II" }]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const ok = await app.request(
      `/api/v1/admin/tags/${TAG_ID}`,
      jsonReq("/tags", "PUT", { slug: "vedic-2", name: "Vedic II" }),
      BINDINGS,
    );
    expect(ok.status).toBe(200);
    expect(audits[0]?.action).toBe("blog_tags.update");
    expect((audits[0]?.details.before as { slug: string }).slug).toBe("vedic");

    mockSupabase((url) => {
      if (url.includes(`blog_tags?id=eq.${TAG_ID}&select=id,slug,name`)) {
        return json([{ id: TAG_ID, slug: "vedic", name: "Vedic" }]);
      }
      if (url.includes("blog_tags?slug=eq.panchang&id=neq.")) return json([{ id: "other" }]);
      return identityAs("admin")(url);
    });
    const clash = await app.request(
      `/api/v1/admin/tags/${TAG_ID}`,
      jsonReq("/tags", "PUT", { slug: "panchang" }),
      BINDINGS,
    );
    expect(clash.status).toBe(409);
  });

  it("deletes links first, then the tag, then audits", async () => {
    const order: string[] = [];
    const { audits, wrapped } = auditCapturer((url, init) => {
      if (url.includes(`blog_tags?id=eq.${TAG_ID}&select=id,slug,name`)) {
        return json([{ id: TAG_ID, slug: "vedic", name: "Vedic" }]);
      }
      if (url.includes(`post_tags?tag_id=eq.${TAG_ID}`) && init?.method === "DELETE") {
        order.push("links");
        return json([]);
      }
      if (url.includes(`blog_tags?id=eq.${TAG_ID}`) && init?.method === "DELETE") {
        order.push("tag");
        return json([{ id: TAG_ID }]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      `/api/v1/admin/tags/${TAG_ID}`,
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(order).toEqual(["links", "tag"]);
    expect(audits[0]?.action).toBe("blog_tags.delete");
    expect((audits[0]?.details.before as { slug: string }).slug).toBe("vedic");
  });
});

describe("POST /api/v1/admin/tags/merge", () => {
  it("403s content_editor — merge is admin+ ([R4])", async () => {
    mockSupabase(identityAs("content_editor"));
    const res = await app.request(
      "/api/v1/admin/tags/merge",
      jsonReq("/tags/merge", "POST", { source_id: TAG_SRC, target_id: TAG_TGT }),
      BINDINGS,
    );
    expect(res.status).toBe(403);
  });

  it("validates UUIDs and self-merge", async () => {
    mockSupabase(identityAs("admin"));
    const same = await app.request(
      "/api/v1/admin/tags/merge",
      jsonReq("/tags/merge", "POST", { source_id: TAG_SRC, target_id: TAG_SRC }),
      BINDINGS,
    );
    expect(same.status).toBe(400);
    const bad = await app.request(
      "/api/v1/admin/tags/merge",
      jsonReq("/tags/merge", "POST", { source_id: "nope", target_id: TAG_TGT }),
      BINDINGS,
    );
    expect(bad.status).toBe(400);
  });

  it("PK-safe merge: drops the both-tags link, moves the rest, deletes the source", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const { audits, wrapped } = auditCapturer((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes(`blog_tags?id=in.(${TAG_SRC},${TAG_TGT})`)) {
        return json([
          { id: TAG_SRC, slug: "old-tag", name: "Old" },
          { id: TAG_TGT, slug: "new-tag", name: "New" },
        ]);
      }
      if (url.includes(`post_tags?tag_id=eq.${TAG_SRC}&select=post_id`)) {
        return json([{ post_id: "p1" }, { post_id: "p2" }]);
      }
      if (url.includes(`post_tags?tag_id=eq.${TAG_TGT}&post_id=in.`)) {
        return json([{ post_id: "p2" }]); // p2 holds BOTH tags
      }
      if (url.includes(`post_tags?tag_id=eq.${TAG_SRC}&post_id=in.`) && method === "DELETE") {
        calls.push({ method, url });
        return json([]);
      }
      if (url.includes(`post_tags?tag_id=eq.${TAG_SRC}&post_id=in.`) && method === "PATCH") {
        calls.push({ method, url, body: JSON.parse(String(init?.body)) });
        return json([{ post_id: "p1", tag_id: TAG_TGT }]);
      }
      if (
        url === `${BINDINGS.SUPABASE_URL}/rest/v1/post_tags?tag_id=eq.${TAG_SRC}` &&
        method === "DELETE"
      ) {
        calls.push({ method, url }); // leftover sweep
        return json([]);
      }
      if (url.includes(`blog_tags?id=eq.${TAG_SRC}`) && method === "DELETE") {
        calls.push({ method, url });
        return json([{ id: TAG_SRC }]);
      }
      return identityAs("admin")(url);
    });
    mockSupabase(wrapped);
    const res = await app.request(
      "/api/v1/admin/tags/merge",
      jsonReq("/tags/merge", "POST", { source_id: TAG_SRC, target_id: TAG_TGT }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { moved: number; replaced: number } };
    expect(body.data.moved).toBe(1);
    expect(body.data.replaced).toBe(1);
    // order: drop dup link → move rest → sweep → delete source tag
    expect(calls.map((c) => c.method)).toEqual(["DELETE", "PATCH", "DELETE", "DELETE"]);
    expect((calls[1]?.body as { tag_id: string }).tag_id).toBe(TAG_TGT);
    expect(audits[0]?.action).toBe("blog_tags.merge");
    expect(audits[0]?.details.moved).toBe(1);
    expect(audits[0]?.details.replaced).toBe(1);
    expect(audits[0]?.details.leftover_links_removed).toBe(0);
    expect(audits[0]?.details.source_slug).toBe("old-tag");
  });

  it("404s when the source tag does not exist", async () => {
    mockSupabase((url) => {
      if (url.includes("blog_tags?id=in."))
        return json([{ id: TAG_TGT, slug: "new-tag", name: "New" }]);
      return identityAs("admin")(url);
    });
    const res = await app.request(
      "/api/v1/admin/tags/merge",
      jsonReq("/tags/merge", "POST", { source_id: TAG_SRC, target_id: TAG_TGT }),
      BINDINGS,
    );
    expect(res.status).toBe(404);
  });
});
