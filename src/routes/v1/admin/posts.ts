/**
 * Epic 6.2 — Post CRUD for the admin area (PRD §7). All routes sit behind
 * requireAdmin (Epic 6.1). Tables: blog_posts / blog_categories / blog_tags /
 * post_tags (migration 0001 + 0007 category link).
 *
 * Schedule model: a scheduled post is a draft with future publish_at; every
 * listing sweeps due drafts to published (no cron dependency).
 * Soft delete: deleted_at set; deleted posts vanish from admin reads too.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import {
  canTransition,
  type PostStatus,
  readingMinutes,
  slugify,
  validatePostInput,
} from "../../../lib/posts";
import { rest, type SupabaseCreds, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminPostsRoute = new Hono<Env>();

/** Due scheduled drafts → published. Runs before reads; failure is non-fatal. */
async function sweepDueDrafts(creds: SupabaseCreds): Promise<void> {
  const now = new Date().toISOString();
  try {
    await rest(
      creds,
      `blog_posts?status=eq.draft&publish_at=lte.${encodeURIComponent(now)}&deleted_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "published" }),
      },
    );
  } catch {
    // non-fatal: sweep retries on the next listing
  }
}

const COLUMNS =
  "id,slug,title,excerpt,content_md,status,publish_at,category_id,featured_image_url,alt_text," +
  "seo_title,seo_description,canonical_url,og_image_url,reading_minutes,author_id,created_at,updated_at";

async function slugExists(
  creds: SupabaseCreds,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const excl = excludeId ? `&id=neq.${encodeURIComponent(excludeId)}` : "";
  const res = await rest(
    creds,
    `blog_posts?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1${excl}`,
  );
  if (!res.ok) return false;
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

/** Unique slug: provided or derived from title; -2, -3… suffixes on conflict. */
async function uniqueSlug(
  creds: SupabaseCreds,
  desired: string,
  excludeId?: string,
): Promise<string> {
  let candidate = desired;
  for (let n = 2; (await slugExists(creds, candidate, excludeId)) && n <= 50; n += 1) {
    candidate = `${desired}-${n}`;
  }
  return candidate;
}

function badRequest(c: any, errors: unknown) {
  return c.json(
    { error: { code: "validation_error", message: "Invalid post payload", details: errors } },
    400,
  );
}

function notFound(c: any) {
  return c.json({ error: { code: "not_found", message: "Post not found" } }, 404);
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

async function applyTags(creds: SupabaseCreds, postId: string, tags: string[]): Promise<boolean> {
  if (tags.length > 0) {
    const payload = tags.map((slug) => ({ slug, name: slug.replace(/-/g, " ") }));
    const up = await rest(creds, "blog_tags?on_conflict=slug", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload),
    });
    if (!up.ok) return false;
  }
  const del = await rest(creds, `post_tags?post_id=eq.${postId}`, { method: "DELETE" });
  if (!del.ok) return false;
  if (tags.length > 0) {
    const tagRes = await rest(
      creds,
      `blog_tags?slug=in.(${tags.map(encodeURIComponent).join(",")})&select=id,slug`,
    );
    if (!tagRes.ok) return false;
    const rows = (await tagRes.json()) as Array<{ id: string; slug: string }>;
    const links = tags
      .map((slug) => rows.find((r) => r.slug === slug))
      .filter((r): r is { id: string; slug: string } => Boolean(r))
      .map((r) => ({ post_id: postId, tag_id: r.id }));
    if (links.length > 0) {
      const ins = await rest(creds, "post_tags", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(links),
      });
      if (!ins.ok) return false;
    }
  }
  return true;
}

adminPostsRoute.get("/admin/posts", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message: "Admin endpoints require backend auth credentials.",
        },
      },
      503,
    );
  }
  await sweepDueDrafts(creds);

  const q = c.req.query();
  const page = Math.max(1, Number(q.page ?? "1") || 1);
  const perPage = Math.min(50, Math.max(1, Number(q.per_page ?? "20") || 20));
  const params = new URLSearchParams({
    select: COLUMNS,
    order: "created_at.desc",
    limit: String(perPage),
    offset: String((page - 1) * perPage),
  });

  const status = q.status ?? "";
  if (status === "scheduled") {
    params.set("status", "eq.draft");
    params.set("publish_at", `gt.${new Date().toISOString()}`);
  } else if (["draft", "published", "archived"].includes(status)) {
    params.set("status", `eq.${status}`);
  }
  if (q.q) params.set("title", `ilike.*${encodeURIComponent(q.q)}*`);
  if (q.category) {
    const catId = await lookupCategoryId(creds, q.category);
    if (!catId) {
      return c.json({ data: { posts: [] }, meta: { page, per_page: perPage, total: 0 } });
    }
    params.set("category_id", `eq.${catId}`);
  }

  let idsFromTag: string[] | null = null;
  if (q.tag) {
    const tagRes = await rest(
      creds,
      `blog_tags?slug=eq.${encodeURIComponent(q.tag)}&select=id&limit=1`,
    );
    const rows = tagRes.ok ? ((await tagRes.json()) as Array<{ id: string }>) : [];
    const tagId = rows[0]?.id;
    if (!tagId) {
      return c.json({ data: { posts: [] }, meta: { page, per_page: perPage, total: 0 } });
    }
    const links = await rest(creds, `post_tags?tag_id=eq.${tagId}&select=post_id`);
    idsFromTag = links.ok
      ? ((await links.json()) as Array<{ post_id: string }>).map((r) => r.post_id)
      : [];
    if (idsFromTag.length === 0) {
      return c.json({ data: { posts: [] }, meta: { page, per_page: perPage, total: 0 } });
    }
    params.set("id", `in.(${idsFromTag.join(",")})`);
  }

  const res = await rest(creds, `blog_posts?${params.toString()}`, {
    headers: { Prefer: "count=exact" },
  });
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Post listing failed" } }, 500);
  }
  const total = Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
  const posts = (await res.json()) as Record<string, unknown>[];
  return c.json({ data: { posts }, meta: { page, per_page: perPage, total } });
});

adminPostsRoute.post("/admin/posts", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message: "Admin endpoints require backend auth credentials.",
        },
      },
      503,
    );
  }
  const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const check = validatePostInput(input, "create");
  if (!check.ok) return badRequest(c, check.errors);
  const f = check.fields;

  // slug: explicit > derived from title > timestamp fallback (e.g. Devanagari
  // titles strip to nothing in slugify).
  let desiredSlug = (f.slug as string | undefined) ?? slugify((f.title as string) ?? "");
  if (!desiredSlug) {
    desiredSlug = `post-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }
  const slug = await uniqueSlug(creds, desiredSlug);

  let categoryId: string | null = null;
  if (f.category) {
    categoryId = await lookupCategoryId(creds, f.category as string);
    if (!categoryId)
      return badRequest(c, [{ field: "category", message: "unknown category slug" }]);
  }

  const publishAt =
    f.status === "published" && !f.publish_at
      ? new Date().toISOString()
      : (f.publish_at as string | undefined);

  const row = {
    slug,
    title: f.title,
    content_md: f.content_md,
    excerpt: f.excerpt ?? null,
    status: f.status,
    publish_at: publishAt ?? null,
    category_id: categoryId,
    featured_image_url: f.featured_image_url ?? null,
    alt_text: f.alt_text ?? null,
    seo_title: f.seo_title ?? null,
    seo_description: f.seo_description ?? null,
    canonical_url: f.canonical_url ?? null,
    og_image_url: f.og_image_url ?? null,
    reading_minutes: readingMinutes(f.content_md as string),
    author_id: c.get("admin").userId,
  };

  const res = await rest(creds, "blog_posts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    return c.json(
      { error: { code: "internal_error", message: `Post create failed: ${res.status}` } },
      500,
    );
  }
  const createdRows = (await res.json()) as Array<{ id: string }>;
  const created = createdRows[0];
  if (!created) {
    return c.json(
      { error: { code: "internal_error", message: "Post create returned no row" } },
      500,
    );
  }
  if (Array.isArray(f.tags) && f.tags.length > 0) {
    await applyTags(creds, created.id, f.tags as string[]);
  }
  return c.json({ data: { ...created } }, 201);
});

adminPostsRoute.get("/admin/posts/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message: "Admin endpoints require backend auth credentials.",
        },
      },
      503,
    );
  }
  const id = c.req.param("id");
  const res = await rest(
    creds,
    `blog_posts?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=${COLUMNS}&limit=1`,
  );
  if (!res.ok) return notFound(c);
  const rows = (await res.json()) as Record<string, unknown>[];
  if (rows.length === 0) return notFound(c);
  const tagsRes = await rest(creds, `post_tags?post_id=eq.${encodeURIComponent(id)}&select=tag_id`);
  const tagIds = tagsRes.ok
    ? ((await tagsRes.json()) as Array<{ tag_id: string }>).map((r) => r.tag_id)
    : [];
  let tags: string[] = [];
  if (tagIds.length > 0) {
    const rows2 = await rest(creds, `blog_tags?id=in.(${tagIds.join(",")})&select=slug`);
    tags = rows2.ok ? ((await rows2.json()) as Array<{ slug: string }>).map((r) => r.slug) : [];
  }
  return c.json({ data: { ...rows[0], tags } });
});

adminPostsRoute.put("/admin/posts/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message: "Admin endpoints require backend auth credentials.",
        },
      },
      503,
    );
  }
  const id = c.req.param("id");
  const existingRes = await rest(
    creds,
    `blog_posts?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=status,slug&limit=1`,
  );
  const existing = existingRes.ok
    ? ((await existingRes.json()) as Array<{ status: PostStatus; slug: string }>)
    : [];
  const prev = existing[0];
  if (!prev) return notFound(c);

  const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const check = validatePostInput(input, "update");
  if (!check.ok) return badRequest(c, check.errors);
  const f = check.fields;

  if (f.status && f.status !== prev.status && !canTransition(prev.status, f.status as PostStatus)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: `status transition ${prev.status} → ${f.status} is not allowed`,
        },
      },
      400,
    );
  }

  const patch: Record<string, unknown> = { ...f, updated_at: new Date().toISOString() };
  delete (patch as { tags?: unknown }).tags;
  delete (patch as { category?: unknown }).category;

  if (f.slug) {
    const newSlug = await uniqueSlug(creds, f.slug as string, id);
    patch.slug = newSlug;
  }
  if (f.content_md) patch.reading_minutes = readingMinutes(f.content_md as string);
  if (f.status === "published" && f.status !== prev.status && f.publish_at === undefined) {
    // transitioning to published without an explicit timestamp: stamp now
    patch.publish_at = new Date().toISOString();
  }

  if (f.category !== undefined) {
    patch.category_id = f.category ? await lookupCategoryId(creds, f.category as string) : null;
    if (f.category && !patch.category_id) {
      return badRequest(c, [{ field: "category", message: "unknown category slug" }]);
    }
  }

  const res = await rest(creds, `blog_posts?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    return c.json(
      { error: { code: "internal_error", message: `Post update failed: ${res.status}` } },
      500,
    );
  }
  const updatedRows = (await res.json()) as Array<Record<string, unknown>>;
  if (Array.isArray(f.tags)) {
    await applyTags(creds, id, f.tags as string[]);
  }
  return c.json({ data: updatedRows[0] ?? {} });
});

adminPostsRoute.delete("/admin/posts/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message: "Admin endpoints require backend auth credentials.",
        },
      },
      503,
    );
  }
  const id = c.req.param("id");
  const res = await rest(creds, `blog_posts?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Post delete failed" } }, 500);
  }
  const rows = (await res.json()) as unknown[];
  if (rows.length === 0) return notFound(c);
  return c.json({ data: { id, deleted: true } });
});
