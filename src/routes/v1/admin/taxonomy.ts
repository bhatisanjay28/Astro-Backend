/**
 * Epic 6.2 — Category/tag management for the admin area (PRD §7).
 * Tables: blog_categories / blog_tags (migration 0001). Slugs are the wire
 * format; names are display labels. Categories are created explicitly; tags
 * are auto-upserted when posts are saved (posts.ts) but listed here too.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { writeAudit } from "../../../lib/audit";
import { SLUG_RE, slugify } from "../../../lib/posts";
import { rest, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminTaxonomyRoute = new Hono<Env>();

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

adminTaxonomyRoute.get("/admin/categories", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const res = await rest(creds, "blog_categories?select=id,slug,name&order=slug.asc");
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Category listing failed" } }, 500);
  }
  const categories = (await res.json()) as Array<{ id: string; slug: string; name: string }>;
  return c.json({ data: { categories } });
});

adminTaxonomyRoute.post("/admin/categories", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; slug?: unknown };
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
  const res = await rest(creds, "blog_categories", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ slug, name }),
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

adminTaxonomyRoute.get("/admin/tags", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const q = c.req.query().q ?? "";
  let path = "blog_tags?select=id,slug,name&order=slug.asc";
  if (q) path += `&slug=ilike.*${encodeURIComponent(q)}*`;
  const res = await rest(creds, path);
  if (!res.ok) {
    return c.json({ error: { code: "internal_error", message: "Tag listing failed" } }, 500);
  }
  const tags = (await res.json()) as Array<{ id: string; slug: string; name: string }>;
  return c.json({ data: { tags } });
});
