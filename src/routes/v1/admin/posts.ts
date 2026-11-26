/**
 * Epic 6.2 + Admin Phase 3 — Post CRUD for the admin area (PRD §7). All
 * routes sit behind requireAdmin (Epic 6.1). Tables: blog_posts /
 * blog_categories / blog_tags / post_tags (migration 0001 + 0007 category
 * link; 0017 adds `lang`).
 *
 * Schedule model: a scheduled post is a draft with future publish_at; every
 * listing sweeps due drafts to published (no cron dependency).
 * Soft delete: deleted_at set; deleted posts vanish from admin reads too —
 * the list's default view filters them out and `?deleted=true` is the Trash.
 * Purge (?purge=true) is the permanent delete: super_admin only, Trash-only,
 * audited with the full pre-image (the audit row IS the backup).
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { writeAudit } from "../../../lib/audit";
import {
  canTransition,
  type PostStatus,
  readingMinutes,
  slugify,
  validatePostInput,
} from "../../../lib/posts";
import { roleCan } from "../../../lib/rbac";
import { rest, restList, type SupabaseCreds, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminPostsRoute = new Hono<Env>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  "seo_title,seo_description,canonical_url,og_image_url,reading_minutes,author_id,lang,created_at,updated_at";

/**
 * Manual joins for category/author names — NOT PostgREST embeds: author_id is
 * a plain column with no FK (0001:228), and embed keys are table names anyway
 * (`category{…}` would PGRST200). Same hand-join pattern as the public
 * blog route (phase-3 story [R1]). Join failures degrade to nulls; the
 * listing itself already succeeded.
 */
async function joinCategoryAuthor(
  creds: SupabaseCreds,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const catIds = [
    ...new Set(rows.map((r) => r.category_id).filter((v): v is string => typeof v === "string")),
  ];
  const authorIds = [
    ...new Set(rows.map((r) => r.author_id).filter((v): v is string => typeof v === "string")),
  ];
  const catMap = new Map<string, { name: string; slug: string }>();
  const authorMap = new Map<string, { display_name: string | null }>();
  const [catsRes, authorsRes] = await Promise.all([
    catIds.length > 0
      ? rest(creds, `blog_categories?id=in.(${catIds.join(",")})&select=id,slug,name`)
      : Promise.resolve(null),
    // service-role read — admin_users RLS doesn't apply to the backend
    authorIds.length > 0
      ? rest(creds, `admin_users?user_id=in.(${authorIds.join(",")})&select=user_id,display_name`)
      : Promise.resolve(null),
  ]);
  if (catsRes?.ok) {
    for (const cat of (await catsRes.json()) as Array<{ id: string; name: string; slug: string }>) {
      catMap.set(cat.id, { name: cat.name, slug: cat.slug });
    }
  }
  if (authorsRes?.ok) {
    for (const a of (await authorsRes.json()) as Array<{
      user_id: string;
      display_name: string | null;
    }>) {
      authorMap.set(a.user_id, { display_name: a.display_name });
    }
  }
  return rows.map((r) => ({
    ...r,
    category: typeof r.category_id === "string" ? (catMap.get(r.category_id) ?? null) : null,
    author: typeof r.author_id === "string" ? (authorMap.get(r.author_id) ?? null) : null,
  }));
}

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

function credsMissing(c: any) {
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
  if (!creds) return credsMissing(c);
  await sweepDueDrafts(creds);

  const q = c.req.query();
  const page = Math.max(1, Number(q.page ?? "1") || 1);
  const perPage = Math.min(50, Math.max(1, Number(q.per_page ?? "20") || 20));
  // Sort whitelist + id tiebreaker for stable pagination; publish_at sorts
  // nulls-last so undated drafts never bury dated rows (phase-3 story [R11]).
  const SORTABLE = new Set(["updated_at", "publish_at", "title", "created_at"]);
  const sortCol = SORTABLE.has(q.sort ?? "") ? (q.sort as string) : "updated_at";
  const dir = q.order === "asc" ? "asc" : "desc";
  const order =
    (sortCol === "publish_at" ? `${sortCol}.${dir}.nullslast` : `${sortCol}.${dir}`) + ",id.asc";
  const params = new URLSearchParams({
    select: COLUMNS,
    order,
    limit: String(perPage),
    offset: String((page - 1) * perPage),
  });

  // Trash view vs live view: the default list never shows soft-deleted rows.
  if (q.deleted === "true") params.set("deleted_at", "not.is.null");
  else params.set("deleted_at", "is.null");

  const status = q.status ?? "";
  if (status === "scheduled") {
    params.set("status", "eq.draft");
    params.set("publish_at", `gt.${new Date().toISOString()}`);
  } else if (["draft", "published", "archived"].includes(status)) {
    params.set("status", `eq.${status}`);
  }
  if (q.q) params.set("title", `ilike.*${encodeURIComponent(q.q)}*`);
  if (q.lang === "en" || q.lang === "hi") params.set("lang", `eq.${q.lang}`);
  if (q.category_id && UUID_RE.test(q.category_id)) {
    params.set("category_id", `eq.${q.category_id}`);
  }
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

  const listing = await restList(creds, `blog_posts?${params.toString()}`);
  if (!listing.ok) {
    return c.json({ error: { code: "internal_error", message: "Post listing failed" } }, 500);
  }
  const posts = await joinCategoryAuthor(creds, listing.rows);
  return c.json({
    data: { posts },
    meta: { page, per_page: perPage, total: listing.total },
  });
});

/**
 * Bulk publish/unpublish/trash — one request, per-id semantics, per-post
 * audit rows (phase-3 story [R5]). All-or-nothing front door: any unknown or
 * already-trashed id aborts the whole request before the first write. The
 * per-id loop is mandatory — a single `.in.` PATCH cannot check per-row
 * transitions nor write per-post audits.
 */
adminPostsRoute.post("/admin/posts/bulk", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);

  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown; action?: unknown };
  const action = body.action;
  if (action !== "publish" && action !== "unpublish" && action !== "trash") {
    return badRequest(c, [
      { field: "action", message: "action must be publish, unpublish or trash" },
    ]);
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return badRequest(c, [
      { field: "ids", message: "ids must be a non-empty array of post UUIDs" },
    ]);
  }
  if (body.ids.length > 50) {
    return badRequest(c, [{ field: "ids", message: "at most 50 posts per bulk request" }]);
  }
  const ids = [...new Set(body.ids.map((v) => String(v).trim()))];
  if (ids.some((id) => !UUID_RE.test(id))) {
    return badRequest(c, [{ field: "ids", message: "ids must be UUIDs" }]);
  }

  const pre = await rest(
    creds,
    `blog_posts?id=in.(${ids.join(",")})&deleted_at=is.null&select=id,status,slug,title`,
  );
  if (!pre.ok) {
    return c.json({ error: { code: "internal_error", message: "Bulk pre-read failed" } }, 500);
  }
  const rows = (await pre.json()) as Array<{
    id: string;
    status: PostStatus;
    slug: string;
    title: string;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return c.json(
      {
        error: {
          code: "not_found",
          message: "one or more posts were not found (or are already trashed)",
          missing,
        },
      },
      404,
    );
  }

  const admin = c.get("admin");
  const now = new Date().toISOString();
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    const row = byId.get(id)!;
    if (action === "trash") {
      const res = await rest(creds, `blog_posts?id=eq.${id}&deleted_at=is.null`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ deleted_at: now, updated_at: now }),
      });
      if (!res.ok) {
        results.push({ id, ok: false, error: `trash failed (${res.status})` });
        continue;
      }
      await writeAudit(creds, {
        actor: admin.userId,
        action: "blog_posts.trash",
        entity: "blog_posts",
        entity_id: id,
        details: { bulk: true, slug: row.slug },
      });
      results.push({ id, ok: true });
    } else {
      const target: PostStatus = action === "publish" ? "published" : "draft";
      if (!canTransition(row.status, target)) {
        results.push({
          id,
          ok: false,
          error: `status transition ${row.status} → ${target} is not allowed`,
        });
        continue;
      }
      const patch: Record<string, unknown> = { status: target, updated_at: now };
      if (target === "published" && row.status !== "published") patch.publish_at = now;
      // unpublish must not leave a schedule behind — the sweep would
      // re-publish the draft on the next listing ([R3] trap, bulk variant).
      if (target === "draft") patch.publish_at = null;
      const res = await rest(creds, `blog_posts?id=eq.${id}&deleted_at=is.null`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        results.push({ id, ok: false, error: `update failed (${res.status})` });
        continue;
      }
      await writeAudit(creds, {
        actor: admin.userId,
        action: "blog_posts.update",
        entity: "blog_posts",
        entity_id: id,
        details: { bulk: true, status: target, prev_status: row.status, slug: row.slug },
      });
      results.push({ id, ok: true });
    }
  }
  return c.json({ data: { results } });
});

/**
 * Restore from Trash → draft. Clears a PAST publish_at: a restored post with
 * an expired schedule would be swept straight back to published with no
 * action (phase-3 story [R3]); a future schedule survives trash.
 */
adminPostsRoute.post("/admin/posts/:id/restore", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const id = c.req.param("id");
  const res = await rest(
    creds,
    `blog_posts?id=eq.${encodeURIComponent(id)}&deleted_at=not.is.null&select=id,status,publish_at,slug&limit=1`,
  );
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Restore lookup failed" } }, 500);
  }
  const rows = (await res.json()) as Array<{
    id: string;
    status: PostStatus;
    publish_at: string | null;
    slug: string;
  }>;
  const row = rows[0];
  if (!row) return notFound(c); // not found, or not in the Trash

  const publishAtPast =
    typeof row.publish_at === "string" && new Date(row.publish_at).getTime() <= Date.now();
  const patch: Record<string, unknown> = {
    deleted_at: null,
    status: "draft",
    updated_at: new Date().toISOString(),
    ...(publishAtPast ? { publish_at: null } : {}),
  };
  const upd = await rest(creds, `blog_posts?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!upd.ok) {
    return c.json({ error: { code: "internal_error", message: "Restore failed" } }, 500);
  }
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_posts.restore",
    entity: "blog_posts",
    entity_id: id,
    details: { slug: row.slug, publish_at_cleared: publishAtPast },
  });
  return c.json({
    data: { id, restored: true, status: "draft", publish_at_cleared: publishAtPast },
  });
});

adminPostsRoute.post("/admin/posts", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
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
    // lang is validated in validatePostInput; omitted on create → DB default 'en'
    ...(f.lang !== undefined ? { lang: f.lang } : {}),
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
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_posts.create",
    entity: "blog_posts",
    entity_id: created.id,
    details: {
      slug,
      title: String(f.title ?? "").slice(0, 120),
      status: f.status,
      content_md: `${String(f.content_md ?? "").length} chars`,
      ...(Array.isArray(f.tags) ? { tags: f.tags.length } : {}),
    },
  });
  return c.json({ data: { ...created } }, 201);
});

adminPostsRoute.get("/admin/posts/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
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
  if (!creds) return credsMissing(c);
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

  // Unpublish must not leave a stale schedule: a published → draft move that
  // keeps a past publish_at gets swept straight back to published on the next
  // listing (same trap as restore, story [R3]).
  if (f.status === "draft" && prev.status === "published" && f.publish_at === undefined) {
    patch.publish_at = null;
  }

  if (f.slug) {
    const newSlug = await uniqueSlug(creds, f.slug as string, id);
    patch.slug = newSlug;
  }
  if (f.content_md) patch.reading_minutes = readingMinutes(f.content_md as string);
  if (
    f.status === "published" &&
    f.status !== prev.status &&
    (f.publish_at === undefined || f.publish_at === null)
  ) {
    // transitioning to published without a timestamp (omitted or explicitly
    // cleared): stamp now — "publish" means publish now.
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
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_posts.update",
    entity: "blog_posts",
    entity_id: id,
    details: {
      fields: Object.keys(patch).filter((k) => k !== "updated_at"),
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      ...(f.title !== undefined ? { title: String(f.title).slice(0, 120) } : {}),
      ...(f.status !== undefined ? { status: f.status, prev_status: prev.status } : {}),
      ...(f.content_md !== undefined ? { content_md: `${String(f.content_md).length} chars` } : {}),
      ...(Array.isArray(f.tags) ? { tags: f.tags.length } : {}),
    },
  });
  return c.json({ data: updatedRows[0] ?? {} });
});

adminPostsRoute.delete("/admin/posts/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const id = c.req.param("id");
  const admin = c.get("admin");

  // ?purge=true — the permanent delete (phase-3 story [R4][R10]): super_admin
  // only, offered only from the Trash. The audit row written BEFORE the hard
  // delete carries the full pre-image + tag slugs — that IS the backup (the
  // only referencing table, post_tags, cascades; media is untouched).
  if (c.req.query("purge") === "true") {
    if (!roleCan(admin.role, "posts.purge")) {
      return c.json(
        {
          error: {
            code: "forbidden",
            message: `Your role (${admin.role || "unknown"}) does not permit this action.`,
          },
        },
        403,
      );
    }
    const res = await rest(
      creds,
      `blog_posts?id=eq.${encodeURIComponent(id)}&select=${COLUMNS}&limit=1`,
    );
    if (!res.ok) {
      return c.json({ error: { code: "internal_error", message: "Purge lookup failed" } }, 500);
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return notFound(c);
    if (!row.deleted_at) {
      return c.json(
        {
          error: {
            code: "conflict",
            message: "only trashed posts can be purged — trash it first",
          },
        },
        409,
      );
    }
    const tagsRes = await rest(
      creds,
      `post_tags?post_id=eq.${encodeURIComponent(id)}&select=tag_id`,
    );
    const tagIds = tagsRes.ok
      ? ((await tagsRes.json()) as Array<{ tag_id: string }>).map((r) => r.tag_id)
      : [];
    const tags: string[] = [];
    if (tagIds.length > 0) {
      const t = await rest(creds, `blog_tags?id=in.(${tagIds.join(",")})&select=slug`);
      if (t.ok) {
        for (const r of (await t.json()) as Array<{ slug: string }>) tags.push(r.slug);
      }
    }
    await writeAudit(creds, {
      actor: admin.userId,
      action: "blog_posts.purge",
      entity: "blog_posts",
      entity_id: id,
      details: { before: row, tags },
    });
    const del = await rest(creds, `blog_posts?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    if (!del.ok) {
      return c.json({ error: { code: "internal_error", message: "Purge failed" } }, 500);
    }
    const gone = (await del.json()) as unknown[];
    if (gone.length === 0) return notFound(c); // idempotent repeat
    return c.json({ data: { id, purged: true } });
  }

  // default: soft delete (Trash)
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
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_posts.trash",
    entity: "blog_posts",
    entity_id: id,
  });
  return c.json({ data: { id, deleted: true } });
});
