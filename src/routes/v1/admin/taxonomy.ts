/**
 * Epic 6.2 + Admin Phase 3 — Category/tag management for the admin area
 * (PRD §7). Tables: blog_categories / blog_tags (migration 0001; 0017 adds
 * name_hi / description / display_order). Slugs are the wire format; names
 * are display labels. Categories are created explicitly; tags are
 * auto-upserted when posts are saved (posts.ts) but are fully managed here.
 *
 * Deletes are API-guarded: the DB would let a category delete through with
 * ON DELETE SET NULL — the 409 reassign guard lives here (story [R6]).
 * All deletes/renames are audited with pre-images.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { writeAudit } from "../../../lib/audit";
import { SLUG_RE, slugify } from "../../../lib/posts";
import { roleCan } from "../../../lib/rbac";
import { safeQuery } from "../../../lib/safe-query";
import { rest, restList, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminTaxonomyRoute = new Hono<Env>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Validate optional display_order (integer ≥ 0). Returns the number, null
 * when absent, or an error message. */
function parseDisplayOrder(
  v: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: null };
  if (v === null || v === "") return { ok: true, value: 0 };
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0 || n > 10_000) {
    return { ok: false, error: "display_order must be an integer between 0 and 10000" };
  }
  return { ok: true, value: n };
}

/** Post counts without aggregate assumptions: one pass per table, count in
 * route (tables are small today — story [R13]). */
async function countBy<T extends string>(
  creds: { url: string; key: string },
  resource: string,
  keyOf: (row: Record<string, unknown>) => T | undefined,
): Promise<Map<T, number>> {
  const counts = new Map<T, number>();
  const res = await restList(creds, resource);
  if (!res.ok) return counts;
  for (const row of res.rows) {
    const key = keyOf(row);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Slug collision check against a table, excluding the row being edited. */
async function slugTaken(
  creds: { url: string; key: string },
  table: "blog_categories" | "blog_tags",
  slug: string,
  excludeId: string,
): Promise<boolean> {
  const res = await rest(
    creds,
    `${table}?slug=eq.${encodeURIComponent(slug)}&id=neq.${encodeURIComponent(excludeId)}&select=id&limit=1`,
  );
  if (!res.ok) return false;
  return ((await res.json()) as unknown[]).length > 0;
}

adminTaxonomyRoute.get("/admin/categories", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const res = await rest(
    creds,
    "blog_categories?select=id,slug,name,name_hi,description,display_order&order=display_order.asc,slug.asc",
  );
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Category listing failed" } }, 500);
  }
  const categories = (await res.json()) as Array<{ id: string } & Record<string, unknown>>;
  const counts = await countBy(creds, "blog_posts?select=category_id&deleted_at=is.null", (r) =>
    typeof r.category_id === "string" ? r.category_id : undefined,
  );
  return c.json({
    data: {
      categories: categories.map((cat) => ({ ...cat, posts: counts.get(cat.id) ?? 0 })),
    },
  });
});

adminTaxonomyRoute.post("/admin/categories", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : slugify(name);
  if (name.length < 1 || name.length > 80) {
    return c.json(
      { error: { code: "validation_error", message: "name is required (1–80 characters)" } },
      400,
    );
  }
  if (!slug || !SLUG_RE.test(slug)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message:
            "slug must be lowercase letters/numbers separated by single hyphens (provide one explicitly for non-Latin names)",
        },
      },
      400,
    );
  }
  const ord = parseDisplayOrder(body.display_order);
  if (!ord.ok) return c.json({ error: { code: "validation_error", message: ord.error } }, 400);
  const nameHi = typeof body.name_hi === "string" ? body.name_hi.trim() : "";
  if (nameHi.length > 120) {
    return c.json(
      { error: { code: "validation_error", message: "name_hi must be ≤ 120 characters" } },
      400,
    );
  }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > 500) {
    return c.json(
      { error: { code: "validation_error", message: "description must be ≤ 500 characters" } },
      400,
    );
  }
  const res = await rest(creds, "blog_categories", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      slug,
      name,
      ...(nameHi ? { name_hi: nameHi } : {}),
      ...(description ? { description } : {}),
      ...(ord.value !== null ? { display_order: ord.value } : {}),
    }),
  });
  if (res.status === 409) {
    return c.json(
      { error: { code: "conflict", message: `category slug "${slug}" already exists` } },
      409,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("duplicate key")) {
      return c.json(
        { error: { code: "conflict", message: `category slug "${slug}" already exists` } },
        409,
      );
    }
    return c.json({ error: { code: "internal_error", message: "Category create failed" } }, 500);
  }
  const createdRows = (await res.json()) as Array<{ id: string; slug: string; name: string }>;
  const created = createdRows[0];
  if (!created) {
    return c.json(
      { error: { code: "internal_error", message: "Category create returned no row" } },
      500,
    );
  }
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_categories.create",
    entity: "blog_categories",
    entity_id: created.id,
    details: { slug: created.slug, name: created.name.slice(0, 120) },
  });
  return c.json({ data: created }, 201);
});

adminTaxonomyRoute.put("/admin/categories/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: { code: "not_found", message: "Category not found" } }, 404);
  }
  const existingRes = await rest(
    creds,
    `blog_categories?id=eq.${encodeURIComponent(id)}&select=id,slug,name,name_hi,description,display_order&limit=1`,
  );
  if (!existingRes.ok) {
    return c.json({ error: { code: "internal_error", message: "Category lookup failed" } }, 500);
  }
  const existing = ((await existingRes.json()) as Array<Record<string, unknown>>)[0];
  if (!existing) {
    return c.json({ error: { code: "not_found", message: "Category not found" } }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const errors: Array<{ field: string; message: string }> = [];

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 80) {
      errors.push({ field: "name", message: "name must be 1–80 characters" });
    } else {
      patch.name = name;
    }
  }
  if (body.slug !== undefined) {
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    if (!slug || !SLUG_RE.test(slug)) {
      errors.push({
        field: "slug",
        message: "slug must be lowercase letters/numbers separated by single hyphens",
      });
    } else if (slug !== existing.slug && (await slugTaken(creds, "blog_categories", slug, id))) {
      return c.json(
        { error: { code: "conflict", message: `category slug "${slug}" already exists` } },
        409,
      );
    } else {
      patch.slug = slug;
    }
  }
  if (body.name_hi !== undefined) {
    const nameHi = typeof body.name_hi === "string" ? body.name_hi.trim() : "";
    if (nameHi.length > 120) {
      errors.push({ field: "name_hi", message: "name_hi must be ≤ 120 characters" });
    } else {
      patch.name_hi = nameHi || null;
    }
  }
  if (body.description !== undefined) {
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length > 500) {
      errors.push({ field: "description", message: "description must be ≤ 500 characters" });
    } else {
      patch.description = description || null;
    }
  }
  const ord = parseDisplayOrder(body.display_order);
  if (!ord.ok) errors.push({ field: "display_order", message: ord.error });
  else if (ord.value !== null) patch.display_order = ord.value;

  if (errors.length > 0) {
    return c.json(
      { error: { code: "validation_error", message: "Invalid category payload", details: errors } },
      400,
    );
  }
  if (Object.keys(patch).length === 0) {
    return c.json(
      {
        error: { code: "validation_error", message: "nothing to update — send at least one field" },
      },
      400,
    );
  }

  const res = await rest(creds, `blog_categories?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409 || text.includes("duplicate key")) {
      return c.json({ error: { code: "conflict", message: "category slug already exists" } }, 409);
    }
    return c.json({ error: { code: "internal_error", message: "Category update failed" } }, 500);
  }
  const updated = ((await res.json()) as Array<Record<string, unknown>>)[0] ?? {};
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_categories.update",
    entity: "blog_categories",
    entity_id: id,
    details: {
      before: { slug: existing.slug, name: existing.name },
      fields: Object.keys(patch),
    },
  });
  return c.json({ data: updated });
});

adminTaxonomyRoute.delete("/admin/categories/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: { code: "not_found", message: "Category not found" } }, 404);
  }
  const existingRes = await rest(
    creds,
    `blog_categories?id=eq.${encodeURIComponent(id)}&select=id,slug,name&limit=1`,
  );
  if (!existingRes.ok) {
    return c.json({ error: { code: "internal_error", message: "Category lookup failed" } }, 500);
  }
  const existing = (
    (await existingRes.json()) as Array<{ id: string; slug: string; name: string }>
  )[0];
  if (!existing) {
    return c.json({ error: { code: "not_found", message: "Category not found" } }, 404);
  }

  // The DB FK is ON DELETE SET NULL — Postgres would silently detach posts.
  // The reassign guard is enforced HERE: any non-trashed post still on the
  // category blocks the delete (story [R6]; trashed posts don't count).
  const usage = await restList(
    creds,
    `blog_posts?category_id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=id&limit=1`,
  );
  if (usage.ok && usage.total > 0) {
    return c.json(
      {
        error: {
          code: "conflict",
          message: `this category is used by ${usage.total} post${usage.total === 1 ? "" : "s"} — reassign them first`,
          posts: usage.total,
        },
      },
      409,
    );
  }

  const res = await rest(creds, `blog_categories?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Category delete failed" } }, 500);
  }
  const gone = (await res.json()) as unknown[];
  if (gone.length === 0) {
    return c.json({ error: { code: "not_found", message: "Category not found" } }, 404);
  }
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_categories.delete",
    entity: "blog_categories",
    entity_id: id,
    details: { before: existing },
  });
  return c.json({ data: { id, deleted: true } });
});

adminTaxonomyRoute.get("/admin/tags", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const q = safeQuery(c.req.query().q);
  let path = "blog_tags?select=id,slug,name&order=slug.asc";
  if (q) path += `&slug=ilike.*${encodeURIComponent(q)}*`;
  const res = await rest(creds, path);
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag listing failed" } }, 500);
  }
  const tags = (await res.json()) as Array<{ id: string } & Record<string, unknown>>;
  const counts = await countBy(creds, "post_tags?select=tag_id", (r) =>
    typeof r.tag_id === "string" ? r.tag_id : undefined,
  );
  return c.json({
    data: { tags: tags.map((tag) => ({ ...tag, posts: counts.get(tag.id) ?? 0 })) },
  });
});

adminTaxonomyRoute.put("/admin/tags/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: { code: "not_found", message: "Tag not found" } }, 404);
  }
  const existingRes = await rest(
    creds,
    `blog_tags?id=eq.${encodeURIComponent(id)}&select=id,slug,name&limit=1`,
  );
  if (!existingRes.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag lookup failed" } }, 500);
  }
  const existing = (
    (await existingRes.json()) as Array<{ id: string; slug: string; name: string }>
  )[0];
  if (!existing) {
    return c.json({ error: { code: "not_found", message: "Tag not found" } }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 80) {
      return c.json(
        { error: { code: "validation_error", message: "name must be 1–80 characters" } },
        400,
      );
    }
    patch.name = name;
  }
  if (body.slug !== undefined) {
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    if (!slug || !SLUG_RE.test(slug)) {
      return c.json(
        {
          error: {
            code: "validation_error",
            message: "slug must be lowercase letters/numbers separated by single hyphens",
          },
        },
        400,
      );
    }
    // slug stays stable unless explicitly changed; collision → 409
    if (slug !== existing.slug && (await slugTaken(creds, "blog_tags", slug, id))) {
      return c.json(
        { error: { code: "conflict", message: `tag slug "${slug}" already exists` } },
        409,
      );
    }
    patch.slug = slug;
  }
  if (Object.keys(patch).length === 0) {
    return c.json(
      { error: { code: "validation_error", message: "nothing to update — send name and/or slug" } },
      400,
    );
  }

  const res = await rest(creds, `blog_tags?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409 || text.includes("duplicate key")) {
      return c.json({ error: { code: "conflict", message: "tag slug already exists" } }, 409);
    }
    return c.json({ error: { code: "internal_error", message: "Tag update failed" } }, 500);
  }
  const updated = ((await res.json()) as Array<Record<string, unknown>>)[0] ?? {};
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_tags.update",
    entity: "blog_tags",
    entity_id: id,
    details: {
      before: { slug: existing.slug, name: existing.name },
      fields: Object.keys(patch),
    },
  });
  return c.json({ data: updated });
});

adminTaxonomyRoute.delete("/admin/tags/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: { code: "not_found", message: "Tag not found" } }, 404);
  }
  const existingRes = await rest(
    creds,
    `blog_tags?id=eq.${encodeURIComponent(id)}&select=id,slug,name&limit=1`,
  );
  if (!existingRes.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag lookup failed" } }, 500);
  }
  const existing = (
    (await existingRes.json()) as Array<{ id: string; slug: string; name: string }>
  )[0];
  if (!existing) {
    return c.json({ error: { code: "not_found", message: "Tag not found" } }, 404);
  }

  // links first, then the tag — a failed link cleanup aborts the delete
  const links = await rest(creds, `post_tags?tag_id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!links.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag link cleanup failed" } }, 500);
  }
  const res = await rest(creds, `blog_tags?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag delete failed" } }, 500);
  }
  const gone = (await res.json()) as unknown[];
  if (gone.length === 0) {
    return c.json({ error: { code: "not_found", message: "Tag not found" } }, 404);
  }
  const admin = c.get("admin");
  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_tags.delete",
    entity: "blog_tags",
    entity_id: id,
    details: { before: existing },
  });
  return c.json({ data: { id, deleted: true } });
});

/**
 * Merge a tag into another: source associations move to the target, the
 * source disappears. super_admin/admin only (`tags.merge` — the subtree gate
 * gives POST to taxonomy.write, so the sharper capability is checked here,
 * story [R4]). PK-safe: post_tags PK is (post_id, tag_id), so posts holding
 * BOTH tags have their source link REPLACED (deleted, target link kept)
 * before the remaining links are re-pointed — a naive update would violate
 * the PK (story [R6]).
 */
adminTaxonomyRoute.post("/admin/tags/merge", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  if (!roleCan(admin.role, "tags.merge")) {
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

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const sourceId = typeof body.source_id === "string" ? body.source_id.trim() : "";
  const targetId = typeof body.target_id === "string" ? body.target_id.trim() : "";
  if (!UUID_RE.test(sourceId) || !UUID_RE.test(targetId)) {
    return c.json(
      { error: { code: "validation_error", message: "source_id and target_id must be tag UUIDs" } },
      400,
    );
  }
  if (sourceId === targetId) {
    return c.json(
      { error: { code: "validation_error", message: "source and target must be different tags" } },
      400,
    );
  }

  const both = await rest(creds, `blog_tags?id=in.(${sourceId},${targetId})&select=id,slug,name`);
  if (!both.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag lookup failed" } }, 500);
  }
  const tagRows = (await both.json()) as Array<{ id: string; slug: string; name: string }>;
  const source = tagRows.find((t) => t.id === sourceId);
  const target = tagRows.find((t) => t.id === targetId);
  if (!source || !target) {
    return c.json({ error: { code: "not_found", message: "source or target tag not found" } }, 404);
  }

  // (a) all source links
  const srcLinks = await rest(creds, `post_tags?tag_id=eq.${sourceId}&select=post_id`);
  if (!srcLinks.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag link lookup failed" } }, 500);
  }
  const sourcePostIds = ((await srcLinks.json()) as Array<{ post_id: string }>).map(
    (r) => r.post_id,
  );

  // (b) posts holding BOTH tags → their source link must be dropped, not moved
  const dupIds: string[] = [];
  if (sourcePostIds.length > 0) {
    const dupRes = await rest(
      creds,
      `post_tags?tag_id=eq.${targetId}&post_id=in.(${sourcePostIds.join(",")})&select=post_id`,
    );
    if (!dupRes.ok) {
      return c.json(
        { error: { code: "internal_error", message: "Tag overlap lookup failed" } },
        500,
      );
    }
    for (const r of (await dupRes.json()) as Array<{ post_id: string }>) dupIds.push(r.post_id);
  }

  // (c) drop the conflicting source links (PK would reject a blind move)
  if (dupIds.length > 0) {
    const drop = await rest(
      creds,
      `post_tags?tag_id=eq.${sourceId}&post_id=in.(${dupIds.join(",")})`,
      { method: "DELETE" },
    );
    if (!drop.ok) {
      return c.json({ error: { code: "internal_error", message: "Tag link cleanup failed" } }, 500);
    }
  }

  // (d) re-point the remaining source links to the target
  let moved = 0;
  const remaining = sourcePostIds.filter((pid) => !dupIds.includes(pid));
  if (remaining.length > 0) {
    const move = await rest(
      creds,
      `post_tags?tag_id=eq.${sourceId}&post_id=in.(${remaining.join(",")})`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ tag_id: targetId }),
      },
    );
    if (!move.ok) {
      return c.json({ error: { code: "internal_error", message: "Tag link move failed" } }, 500);
    }
    moved = ((await move.json()) as unknown[]).length;
  }

  // (e) any stragglers (posts created between reads) — belt and braces
  const leftover = await rest(creds, `post_tags?tag_id=eq.${sourceId}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  const leftoverRemoved = leftover.ok ? ((await leftover.json()) as unknown[]).length : -1;

  // (f) delete the source tag itself
  const del = await rest(creds, `blog_tags?id=eq.${sourceId}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!del.ok) {
    return c.json({ error: { code: "internal_error", message: "Source tag delete failed" } }, 500);
  }
  const gone = (await del.json()) as unknown[];
  if (gone.length === 0) {
    return c.json({ error: { code: "not_found", message: "source tag not found" } }, 404);
  }

  await writeAudit(creds, {
    actor: admin.userId,
    action: "blog_tags.merge",
    entity: "blog_tags",
    entity_id: targetId,
    details: {
      moved,
      replaced: dupIds.length,
      leftover_links_removed: leftoverRemoved,
      source_slug: source.slug,
      target_slug: target.slug,
    },
  });
  return c.json({
    data: {
      source: { id: sourceId, slug: source.slug },
      target: { id: targetId, slug: target.slug },
      moved,
      replaced: dupIds.length,
    },
  });
});
