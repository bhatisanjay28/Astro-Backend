/**
 * Epic 6.3 — Public blog reads over the admin-managed tables (PRD §7).
 * Only published, non-deleted posts are ever visible here. Search is a
 * server-side title/excerpt filter so the frontend stays a thin renderer
 * (D12). Markdown sanitisation happens at render time in the frontend
 * (D13) — the API returns the stored markdown verbatim.
 *
 * Author display: blog_posts.author_id has no FK to a public profile table,
 * so the API never leaks admin identities; the frontend renders the
 * editorial byline "Team Vyotish" (swap to a real author field later).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { rest, restList, type SupabaseCreds, supabaseCreds } from "../../lib/supabase";

type Env = AppEnv;

export const blogRoute = new Hono<Env>();

/** Columns safe for public listing cards (no content_md — heavy + not needed). */
const LIST_COLUMNS =
  "id,slug,title,excerpt,featured_image_url,alt_text,publish_at,reading_minutes,category_id,created_at";

function credsMissing(c: any) {
  return c.json(
    {
      error: {
        code: "service_unavailable",
        message:
          "Blog content requires backend database credentials, which are not configured on this deployment yet.",
      },
    },
    503,
  );
}

async function lookupCategoryId(creds: SupabaseCreds, slug: string): Promise<string | null> {
  const res = await rest(
    creds,
    `blog_categories?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

blogRoute.get("/blog/posts", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);

  const q = c.req.query();
  const page = Math.max(1, Number(q.page ?? "1") || 1);
  const perPage = Math.min(50, Math.max(1, Number(q.per_page ?? "10") || 10));
  const params = new URLSearchParams({
    select: LIST_COLUMNS,
    status: "eq.published",
    deleted_at: "is.null",
    order: "publish_at.desc.nullslast,created_at.desc",
    limit: String(perPage),
    offset: String((page - 1) * perPage),
  });

  if (q.q) {
    // search across title + excerpt
    const needle = encodeURIComponent(q.q.replace(/[(),*]/g, " ").trim());
    if (needle) params.set("or", `(title.ilike.*${needle}*,excerpt.ilike.*${needle}*)`);
  }

  if (q.category) {
    const catId = await lookupCategoryId(creds, q.category);
    if (!catId) return c.json({ data: { posts: [] }, meta: { page, per_page: perPage, total: 0 } });
    params.set("category_id", `eq.${catId}`);
  }

  if (q.tag) {
    const tagRes = await rest(
      creds,
      `blog_tags?slug=eq.${encodeURIComponent(q.tag)}&select=id&limit=1`,
    );
    const rows = tagRes.ok ? ((await tagRes.json()) as Array<{ id: string }>) : [];
    const tagId = rows[0]?.id;
    if (!tagId) return c.json({ data: { posts: [] }, meta: { page, per_page: perPage, total: 0 } });
    const links = await rest(creds, `post_tags?tag_id=eq.${tagId}&select=post_id`);
    const ids = links.ok
      ? ((await links.json()) as Array<{ post_id: string }>).map((r) => r.post_id)
      : [];
    if (ids.length === 0)
      return c.json({ data: { posts: [] }, meta: { page, per_page: perPage, total: 0 } });
    params.set("id", `in.(${ids.join(",")})`);
  }

  const listing = await restList(creds, `blog_posts?${params.toString()}`);
  if (!listing.ok) {
    return c.json({ error: { code: "internal_error", message: "Blog listing failed" } }, 500);
  }
  return c.json({
    data: { posts: listing.rows },
    meta: { page, per_page: perPage, total: listing.total },
  });
});

blogRoute.get("/blog/posts/:slug", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const slug = c.req.param("slug");

  const res = await rest(
    creds,
    `blog_posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&deleted_at=is.null&select=` +
      "id,slug,title,content_md,excerpt,featured_image_url,alt_text,publish_at,reading_minutes," +
      "seo_title,seo_description,canonical_url,og_image_url,category_id,created_at,updated_at&limit=1",
  );
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Blog lookup failed" } }, 500);
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const post = rows[0];
  if (!post) {
    return c.json({ error: { code: "not_found", message: "Post not found" } }, 404);
  }

  // taxonomy in parallel: category row + tag slugs (2-step via post_tags)
  let category: { slug: string; name: string } | null = null;
  const tags: Array<{ slug: string; name: string }> = [];
  const catId = post.category_id as string | null;
  const [catRes, linkRes] = await Promise.all([
    catId
      ? rest(creds, `blog_categories?id=eq.${catId}&select=slug,name&limit=1`)
      : Promise.resolve(null),
    rest(creds, `post_tags?post_id=eq.${post.id as string}&select=tag_id`),
  ]);
  if (catRes?.ok) {
    const crows = (await catRes.json()) as Array<{ slug: string; name: string }>;
    category = crows[0] ?? null;
  }
  if (linkRes.ok) {
    const tagIds = ((await linkRes.json()) as Array<{ tag_id: string }>).map((r) => r.tag_id);
    if (tagIds.length > 0) {
      const t = await rest(
        creds,
        `blog_tags?id=in.(${tagIds.join(",")})&select=slug,name&order=slug.asc`,
      );
      if (t.ok) tags.push(...((await t.json()) as Array<{ slug: string; name: string }>));
    }
  }

  // related: latest published posts sharing the category (exclude this one)
  let related: Array<{ slug: string; title: string; excerpt: string | null }> = [];
  if (catId) {
    const relRes = await rest(
      creds,
      `blog_posts?category_id=eq.${catId}&status=eq.published&deleted_at=is.null&slug=neq.${encodeURIComponent(slug)}` +
        `&select=slug,title,excerpt&order=publish_at.desc.nullslast,created_at.desc&limit=3`,
    );
    if (relRes.ok) related = (await relRes.json()) as typeof related;
  }

  return c.json({
    data: { ...post, author: { name: "Team Vyotish" }, category, tags, related },
  });
});

blogRoute.get("/blog/categories", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const res = await rest(creds, "blog_categories?select=slug,name&order=slug.asc");
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Category lookup failed" } }, 500);
  }
  return c.json({
    data: { categories: (await res.json()) as Array<{ slug: string; name: string }> },
  });
});

blogRoute.get("/blog/tags", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const res = await rest(creds, "blog_tags?select=slug,name&order=slug.asc");
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag lookup failed" } }, 500);
  }
  return c.json({ data: { tags: (await res.json()) as Array<{ slug: string; name: string }> } });
});
