import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Route tests for Epic 6.2 admin post CRUD (behind Epic 6.1 auth):
 * listing filters, create validation/auto-slug, transition rules, soft delete,
 * plus media upload validation and the bucket auto-create retry.
 * Auth middleware edge cases are covered in admin-auth-route.test.ts; here a
 * valid-shaped token is assumed and Supabase REST/storage is mocked.
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
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

const POST_ROW = {
  id: "post-1",
  slug: "hello-world",
  title: "Hello World",
  content_md: "# Hi",
  status: "draft",
  created_at: "2026-11-19T00:00:00Z",
};

/** Middleware identity mock: Supabase /auth/v1/user + admin_users row. */
const identityOk: Handler = (url) => {
  if (url.includes("/auth/v1/user")) return json({ id: "user-1", email: "admin@vyotish.com" });
  if (url.includes("/rest/v1/admin_users"))
    return json([{ user_id: "user-1", email: "admin@vyotish.com", role: "admin" }]);
  return undefined;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/v1/admin/posts", () => {
  it("returns posts + pagination meta", async () => {
    mockSupabase((url) => {
      if (!url.includes("/rest/v1/admin_users") && !url.includes("/auth/v1/user")) {
        if (url.includes("/rest/v1/blog_posts?")) {
          return json([POST_ROW], 200, { "content-range": "0-0/1" });
        }
      }
      return identityOk(url);
    });
    const res = await app.request("/api/v1/admin/posts", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { posts: unknown[] }; meta: { total: number } };
    expect(body.data.posts.length).toBe(1);
    expect(body.meta.total).toBe(1);
  });

  it("scheduled filter maps to draft + future publish_at", async () => {
    let seen = "";
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_posts?")) {
        seen = url;
        return json([], 200, { "content-range": "0-0/0" });
      }
      return identityOk(url);
    });
    await app.request("/api/v1/admin/posts?status=scheduled", authed(), BINDINGS);
    expect(seen).toContain("status=eq.draft");
    expect(seen).toContain("publish_at=gt.");
  });

  it("unknown category filter short-circuits to an empty page", async () => {
    mockSupabase((url) => {
      if (url.includes("blog_categories?slug=eq.no-such")) return json([]);
      return identityOk(url);
    });
    const res = await app.request("/api/v1/admin/posts?category=no-such", authed(), BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { posts: unknown[] }; meta: { total: number } };
    expect(body.data.posts).toEqual([]);
    expect(body.meta.total).toBe(0);
  });
});

describe("POST /api/v1/admin/posts", () => {
  it("rejects a payload without title/content_md", async () => {
    mockSupabase(identityOk);
    const res = await app.request(
      "/api/v1/admin/posts",
      authed({ method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details.length).toBeGreaterThanOrEqual(2);
  });

  it("suffixes the slug when the desired one is taken", async () => {
    const seenSlugs: string[] = [];
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_posts?slug=eq.")) {
        const raw = url.split("slug=eq.")[1]?.split("&")[0] ?? "";
        const slug = decodeURIComponent(raw);
        seenSlugs.push(slug);
        return json(slug === "hello-world" ? [{ id: "other" }] : []);
      }
      if (url.includes("/rest/v1/blog_posts")) {
        return json([{ ...POST_ROW, slug: seenSlugs.at(-1) ?? "" }], 201);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/posts",
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Hello World", content_md: "Body" }),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(201);
    expect(seenSlugs).toEqual(["hello-world", "hello-world-2"]);
  });

  it("stamps publish_at when creating as published", async () => {
    let row: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/blog_posts?slug=eq.")) return json([]);
      if (url.includes("/rest/v1/blog_posts") && init?.method === "POST") {
        row = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ ...POST_ROW, ...row }], 201);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/posts",
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Hello World", content_md: "Body", status: "published" }),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(201);
    expect(row?.status).toBe("published");
    expect(typeof row?.publish_at).toBe("string");
  });

  it("rejects an unknown category slug", async () => {
    mockSupabase((url) => {
      if (url.includes("blog_categories?slug=eq.missing")) return json([]);
      if (url.includes("/rest/v1/blog_posts?slug=eq.")) return json([]);
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/posts",
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "T", content_md: "B", category: "missing" }),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { details: Array<{ field: string }> } };
    expect(body.error.details[0]?.field).toBe("category");
  });
});

describe("PUT /api/v1/admin/posts/:id", () => {
  it("blocks archived → draft transitions", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_posts?id=eq.post-1&deleted_at=is.null&select=status,slug")) {
        return json([{ status: "archived", slug: "archived-post" }]);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/posts/post-1",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "draft" }),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("archived → draft");
  });

  it("recomputes reading_minutes when content changes", async () => {
    const w600 = Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ");
    let patch: Record<string, unknown> | undefined;
    mockSupabase((url, init) => {
      if (url.includes("/rest/v1/blog_posts?id=eq.post-1&deleted_at=is.null&select=status,slug")) {
        return json([{ status: "draft", slug: "draft-post" }]);
      }
      if (url.includes("/rest/v1/blog_posts?id=eq.post-1") && init?.method === "PATCH") {
        patch = JSON.parse(init.body as string) as Record<string, unknown>;
        return json([{ ...POST_ROW, ...patch }]);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/posts/post-1",
      authed({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content_md: w600 }),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(patch?.reading_minutes).toBe(3);
    expect(patch?.updated_at).toBeTruthy();
  });
});

describe("DELETE /api/v1/admin/posts/:id", () => {
  it("soft-deletes once, then 404 on repeat", async () => {
    let deleted = false;
    mockSupabase((url, init) => {
      if (
        url.includes("/rest/v1/blog_posts?id=eq.post-1&deleted_at=is.null") &&
        init?.method === "PATCH"
      ) {
        if (deleted) return json([]);
        deleted = true;
        return json([{ ...POST_ROW, deleted_at: new Date().toISOString() }]);
      }
      return identityOk(url);
    });
    const first = await app.request(
      "/api/v1/admin/posts/post-1",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(first.status).toBe(200);
    const body = (await first.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
    const second = await app.request(
      "/api/v1/admin/posts/post-1",
      authed({ method: "DELETE" }),
      BINDINGS,
    );
    expect(second.status).toBe(404);
  });
});

describe("POST /api/v1/admin/media", () => {
  it("rejects a missing filename", async () => {
    mockSupabase(identityOk);
    const res = await app.request(
      "/api/v1/admin/media",
      authed({
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([1]),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
  });

  it("rejects SVG (stored-XSS vector)", async () => {
    mockSupabase(identityOk);
    const res = await app.request(
      "/api/v1/admin/media?filename=x.svg",
      authed({
        method: "POST",
        headers: { "content-type": "image/svg+xml" },
        body: new Uint8Array([1]),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("SVG");
  });

  it("rejects bytes that do not match the declared image type (magic-byte check)", async () => {
    mockSupabase(identityOk);
    const res = await app.request(
      "/api/v1/admin/media?filename=evil.png&alt=decoy",
      authed({
        method: "POST",
        headers: { "content-type": "image/png" },
        // text masquerading as a PNG — no PNG signature
        body: new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e]),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("does not match");
  });

  it("accepts each allowed type by its real signature", async () => {
    const cases: Array<{ mime: string; bytes: number[] }> = [
      { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
      { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff, 0xe0] },
      { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
      {
        mime: "image/webp",
        bytes: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
      },
    ];
    for (const { mime, bytes } of cases) {
      let stored = false;
      mockSupabase((url, init) => {
        if (url.includes("/storage/v1/object/media/")) return json({ Key: "x" }, 200);
        if (url.includes("/rest/v1/media") && (init?.method ?? "GET") === "POST") {
          stored = true;
          return json([{ id: "m" }], 201);
        }
        return identityOk(url);
      });
      const res = await app.request(
        `/api/v1/admin/media?filename=ok&alt=alt text`,
        authed({ method: "POST", headers: { "content-type": mime }, body: new Uint8Array(bytes) }),
        BINDINGS,
      );
      expect(res.status).toBe(201);
      expect(stored).toBe(true);
    }
  });

  it("requires alt text", async () => {
    mockSupabase(identityOk);
    const res = await app.request(
      "/api/v1/admin/media?filename=no-alt.png",
      authed({
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("alt");
  });

  it("rejects oversized bodies", async () => {
    mockSupabase(identityOk);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const res = await app.request(
      "/api/v1/admin/media?filename=big.png",
      authed({ method: "POST", headers: { "content-type": "image/png" }, body: big }),
      BINDINGS,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("5 MB");
  });

  it("uploads to storage, records the row and returns the public URL", async () => {
    let uploadPath = "";
    mockSupabase((url, init) => {
      if (url.includes("/storage/v1/object/media/")) {
        uploadPath = url.split("/storage/v1/object/media/")[1] ?? "";
        return json({ Key: uploadPath }, 200);
      }
      if (url.includes("/rest/v1/media") && init?.method === "POST") {
        return json([{ id: "media-1" }], 201);
      }
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/media?filename=Chart%20Image.png&alt=chart",
      authed({
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { url: string; path: string } };
    expect(body.data.url).toContain("/storage/v1/object/public/media/");
    expect(body.data.path).toBe(uploadPath);
    expect(body.data.path).toMatch(/^20\d\d-\d\d\/.+\.png$/);
    expect(body.data.path).toContain("chart-image");
  });

  it("creates a missing bucket and retries the upload once", async () => {
    let uploads = 0;
    let bucketsCreated = 0;
    mockSupabase((url, init) => {
      if (url.includes("/storage/v1/object/media/")) {
        uploads += 1;
        return uploads === 1
          ? new Response("bucket not found", { status: 404 })
          : json({ Key: "x" }, 200);
      }
      if (url.includes("/storage/v1/bucket") && init?.method === "POST") {
        bucketsCreated += 1;
        return json({ name: "media" }, 200);
      }
      if (url.includes("/rest/v1/media")) return json([{ id: "media-2" }], 201);
      return identityOk(url);
    });
    const res = await app.request(
      "/api/v1/admin/media?filename=first.png&alt=first upload",
      authed({
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
      BINDINGS,
    );
    expect(res.status).toBe(201);
    expect(bucketsCreated).toBe(1);
    expect(uploads).toBe(2);
  });
});
