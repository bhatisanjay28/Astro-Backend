import { afterEach, describe, expect, it, mock } from "bun:test";
import app from "../src/app";

/**
 * Route tests for Epic 6.3 public blog reads: published-only visibility,
 * search/category/tag filters, the article bundle (tags/related), and
 * taxonomy lists. Supabase REST is mocked; no admin auth involved.
 */

const BINDINGS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

const originalFetch = globalThis.fetch;

function mockSupabase(handler: (url: string, init?: RequestInit) => Response | undefined) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("fake-project.supabase.co")) {
      return new Response("unmocked", { status: 599 });
    }
    return handler(url, init ?? {}) ?? new Response("unmocked: " + url, { status: 599 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const POST_ROW = {
  id: "post-1",
  slug: "hello-world",
  title: "Hello World",
  excerpt: "First post",
  category_id: "cat-1",
  publish_at: "2026-11-01T00:00:00Z",
};

describe("GET /api/v1/blog/posts", () => {
  it("filters to published + not deleted and paginates", async () => {
    let seen = "";
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_posts?")) {
        seen = url;
        return json([POST_ROW], 200, { "content-range": "0-0/1" });
      }
      return json([]);
    });
    const res = await app.request("/api/v1/blog/posts?page=2&per_page=5", {}, BINDINGS);
    expect(res.status).toBe(200);
    expect(seen).toContain("status=eq.published");
    expect(seen).toContain("deleted_at=is.null");
    expect(seen).toContain("offset=5");
    expect(seen).toContain("limit=5");
    const body = (await res.json()) as { data: { posts: unknown[] }; meta: { total: number } };
    expect(body.data.posts.length).toBe(1);
    expect(body.meta.total).toBe(1);
  });

  it("maps a search query to title/excerpt or-filter", async () => {
    let seen = "";
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_posts?")) {
        seen = url;
        return json([], 200, { "content-range": "0-0/0" });
      }
      return json([]);
    });
    await app.request("/api/v1/blog/posts?q=kundli", {}, BINDINGS);
    expect(seen).toContain("or=");
    expect(decodeURIComponent(seen)).toContain("title.ilike.*kundli*");
    expect(decodeURIComponent(seen)).toContain("excerpt.ilike.*kundli*");
  });

  it("an unknown category short-circuits to an empty page", async () => {
    mockSupabase((url) => {
      if (url.includes("blog_categories?slug=eq.no-such")) return json([]);
      return json([]);
    });
    const res = await app.request("/api/v1/blog/posts?category=no-such", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { posts: unknown[] }; meta: { total: number } };
    expect(body.data.posts).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("an unknown tag short-circuits to an empty page", async () => {
    mockSupabase((url) => {
      if (url.includes("blog_tags?slug=eq.missing")) return json([]);
      return json([]);
    });
    const res = await app.request("/api/v1/blog/posts?tag=missing", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { total: number } };
    expect(body.meta.total).toBe(0);
  });

  it("returns an empty page (not 500) when the offset is past the row count", async () => {
    // PostgREST answers 416 PGRST103 for ?page=2 on a 2-row table; the total
    // still arrives in content-range. BUG-02 regression: this used to 500.
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_posts?")) {
        return json({ code: "PGRST103", message: "Requested range not satisfiable" }, 416, {
          "content-range": "*/2",
        });
      }
      return json([]);
    });
    const res = await app.request("/api/v1/blog/posts?page=2", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { posts: unknown[] };
      meta: { page: number; total: number };
    };
    expect(body.data.posts).toEqual([]);
    expect(body.meta.page).toBe(2);
    expect(body.meta.total).toBe(2);
  });

  it("503s without backend credentials", async () => {
    const res = await app.request("/api/v1/blog/posts", {});
    expect(res.status).toBe(503);
  });
});

describe("GET /api/v1/blog/posts/:slug", () => {
  it("returns the article bundle with tags, category and related", async () => {
    mockSupabase((url) => {
      if (url.includes("blog_posts?slug=eq.hello-world&status=eq.published")) {
        return json([{ ...POST_ROW, content_md: "# Hi" }]);
      }
      if (url.includes("blog_categories?id=eq.cat-1")) {
        return json([{ slug: "guides", name: "Guides" }]);
      }
      if (url.includes("post_tags?post_id=eq.post-1")) {
        return json([{ tag_id: "t1" }, { tag_id: "t2" }]);
      }
      if (url.includes("blog_tags?id=in.")) {
        return json([
          { slug: "vedic", name: "vedic" },
          { slug: "basics", name: "basics" },
        ]);
      }
      if (url.includes("slug=neq.hello-world")) {
        return json([{ slug: "next-post", title: "Next", excerpt: null }]);
      }
      return json([]);
    });
    const res = await app.request("/api/v1/blog/posts/hello-world", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        content_md: string;
        author: { name: string };
        category: { slug: string } | null;
        tags: unknown[];
        related: unknown[];
      };
    };
    expect(body.data.content_md).toBe("# Hi");
    expect(body.data.author.name).toBe("Team Vyotish");
    expect(body.data.category?.slug).toBe("guides");
    expect(body.data.tags.length).toBe(2);
    expect(body.data.related.length).toBe(1);
  });

  it("404s for drafts, archived and soft-deleted posts", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_posts?slug=eq.")) return json([]);
      return json([]);
    });
    const res = await app.request("/api/v1/blog/posts/missing", {}, BINDINGS);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/blog/categories + /tags", () => {
  it("lists categories", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_categories"))
        return json([{ slug: "guides", name: "Guides" }]);
      return json([]);
    });
    const res = await app.request("/api/v1/blog/categories", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { categories: Array<{ slug: string }> } };
    expect(body.data.categories[0]?.slug).toBe("guides");
  });

  it("lists tags", async () => {
    mockSupabase((url) => {
      if (url.includes("/rest/v1/blog_tags")) return json([{ slug: "vedic", name: "vedic" }]);
      return json([]);
    });
    const res = await app.request("/api/v1/blog/tags", {}, BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { tags: Array<{ slug: string }> } };
    expect(body.data.tags[0]?.slug).toBe("vedic");
  });
});
