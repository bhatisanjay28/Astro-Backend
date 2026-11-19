/**
 * Epic 6.4 — Directory catalogues for the admin area (PRD §5): astrologers
 * and pujas CRUD over the 0001 tables (+0004 design columns). Deletes are
 * hard (consultation_requests.astrologer_id is ON DELETE SET NULL); hiding
 * from the public site is PATCH is_active = false.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { SLUG_RE, slugify } from "../../../lib/posts";
import { rest, type SupabaseCreds, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminCatalogRoute = new Hono<Env>();

const ASTRO_COLUMNS =
  "id,slug,name,title,photo_url,about,expertise,languages,experience_years,price_per_minute," +
  "session_types,availability_label,is_available,sort_order,accent,is_active,updated_at";
const PUJA_COLUMNS =
  "id,slug,name,name_hi,category,purpose,samagri,duration,mode,sample_price,muhurat_note," +
  "description,includes,sort_order,accent,is_active,updated_at";

const PUJA_CATEGORIES = [
  "graha_shanti",
  "satyanarayan",
  "griha_pravesh",
  "rudrabhishek",
  "navagraha",
  "kaal_sarp",
  "other",
];
const PUJA_MODES = ["online", "home", "temple"];

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

function conflict(c: any, what: string) {
  return c.json({ error: { code: "conflict", message: `${what} already exists` } }, 409);
}

function fieldError(c: any, details: unknown) {
  return c.json({ error: { code: "validation_error", message: "Invalid payload", details } }, 400);
}

const isStr = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length >= 1 && v.length <= max;
const isOptStr = (v: unknown, max: number): boolean =>
  v === undefined || v === null || isStr(v, max);
const isOptNum = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "number" && v >= 0);
const isStrArr = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((s) => typeof s === "string" && s.length <= 80);

function resolveSlug(input: Record<string, unknown>, name: string): string | null {
  const given = typeof input.slug === "string" ? input.slug.trim() : "";
  const slug = given || slugify(name);
  if (!slug || !SLUG_RE.test(slug)) return null;
  return slug;
}

/* ---------------------------- astrologers ---------------------------- */

function validateAstrologer(
  input: Record<string, unknown>,
  mode: "create" | "update",
): string[] | null {
  const errs: string[] = [];
  if (mode === "create" && !isStr(input.name, 120)) errs.push("name is required (1–120 chars)");
  else if (input.name !== undefined && !isStr(input.name, 120))
    errs.push("name must be 1–120 chars");
  if (input.title !== undefined && !isOptStr(input.title, 160)) errs.push("title too long");
  if (input.about !== undefined && !isOptStr(input.about, 4000)) errs.push("about too long");
  if (input.photo_url !== undefined && !isOptStr(input.photo_url, 500))
    errs.push("photo_url invalid");
  if (input.expertise !== undefined && !isStrArr(input.expertise, 20))
    errs.push("expertise must be ≤20 short strings");
  if (input.languages !== undefined && !isStrArr(input.languages, 20))
    errs.push("languages must be ≤20 short strings");
  if (input.experience_years !== undefined && !isOptNum(input.experience_years))
    errs.push("experience_years must be ≥0");
  if (input.price_per_minute !== undefined && !isOptNum(input.price_per_minute))
    errs.push("price_per_minute must be ≥0");
  if (input.sort_order !== undefined && !isOptNum(input.sort_order))
    errs.push("sort_order must be ≥0");
  if (input.is_active !== undefined && typeof input.is_active !== "boolean")
    errs.push("is_active must be boolean");
  if (input.is_available !== undefined && typeof input.is_available !== "boolean")
    errs.push("is_available must be boolean");
  if (input.session_types !== undefined) {
    const st = input.session_types;
    if (
      !Array.isArray(st) ||
      st.length > 10 ||
      !st.every(
        (s) =>
          typeof s === "object" &&
          s !== null &&
          isStr((s as Record<string, unknown>).type, 40) &&
          isOptNum((s as Record<string, unknown>).duration_min),
      )
    ) {
      errs.push("session_types must be ≤10 {type, duration_min} objects");
    }
  }
  return errs.length > 0 ? errs : null;
}

adminCatalogRoute.get("/admin/astrologers", async (c) => {
  const creds0 = supabaseCreds(c);
  if (!creds0) return credsMissing(c);
  const res = await rest(
    creds0,
    `astrologers?select=${ASTRO_COLUMNS}&order=sort_order.asc,name.asc`,
  );
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Astrologer listing failed" } }, 500);
  return c.json({ data: { astrologers: await res.json() } });
});

adminCatalogRoute.post("/admin/astrologers", async (c) => {
  const creds0 = supabaseCreds(c);
  if (!creds0) return credsMissing(c);
  const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const errs = validateAstrologer(input, "create");
  if (errs)
    return fieldError(
      c,
      errs.map((message) => ({ field: "astrologer", message })),
    );
  const name = (input.name as string).trim();
  const slug = resolveSlug(input, name);
  if (!slug)
    return fieldError(c, [
      { field: "slug", message: "slug must be lowercase letters/numbers with single hyphens" },
    ]);
  const row = { ...input, slug, name, updated_at: new Date().toISOString() };
  const res = await rest(creds0, "astrologers", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    if ((await res.text()).includes("duplicate key"))
      return conflict(c, `astrologer slug "${slug}"`);
    return c.json({ error: { code: "internal_error", message: "Astrologer create failed" } }, 500);
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return c.json({ data: rows[0] ?? null }, 201);
});

adminCatalogRoute.patch("/admin/astrologers/:id", async (c) => {
  const creds0 = supabaseCreds(c);
  if (!creds0) return credsMissing(c);
  const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const errs = validateAstrologer(input, "update");
  if (errs)
    return fieldError(
      c,
      errs.map((message) => ({ field: "astrologer", message })),
    );
  delete (input as { slug?: unknown }).slug; // slug immutable via patch — create-only
  const patch = { ...input, updated_at: new Date().toISOString() };
  const res = await rest(creds0, `astrologers?id=eq.${encodeURIComponent(c.req.param("id"))}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Astrologer update failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Astrologer not found" } }, 404);
  return c.json({ data: rows[0] });
});

adminCatalogRoute.delete("/admin/astrologers/:id", async (c) => {
  const creds0 = supabaseCreds(c);
  if (!creds0) return credsMissing(c);
  const res = await rest(creds0, `astrologers?id=eq.${encodeURIComponent(c.req.param("id"))}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Astrologer delete failed" } }, 500);
  const rows = (await res.json()) as unknown[];
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Astrologer not found" } }, 404);
  return c.json({ data: { deleted: true } });
});

/* ------------------------------- pujas ------------------------------- */

function validatePuja(input: Record<string, unknown>, mode: "create" | "update"): string[] | null {
  const errs: string[] = [];
  if (mode === "create" && !isStr(input.name, 120)) errs.push("name is required (1–120 chars)");
  else if (input.name !== undefined && !isStr(input.name, 120))
    errs.push("name must be 1–120 chars");
  if (mode === "create" && !isStr(input.category, 40)) errs.push("category is required");
  else if (input.category !== undefined && !PUJA_CATEGORIES.includes(String(input.category))) {
    errs.push(`category must be one of: ${PUJA_CATEGORIES.join(", ")}`);
  }
  if (input.purpose !== undefined && !isOptStr(input.purpose, 300)) errs.push("purpose too long");
  if (input.description !== undefined && !isOptStr(input.description, 8000))
    errs.push("description too long");
  if (input.muhurat_note !== undefined && !isOptStr(input.muhurat_note, 500))
    errs.push("muhurat_note too long");
  if (input.duration !== undefined && !isOptStr(input.duration, 80)) errs.push("duration too long");
  if (input.mode !== undefined) {
    if (
      !Array.isArray(input.mode) ||
      input.mode.length > 3 ||
      !input.mode.every((m) => PUJA_MODES.includes(String(m)))
    ) {
      errs.push(`mode must be a subset of: ${PUJA_MODES.join(", ")}`);
    }
  }
  if (input.sample_price !== undefined && !isOptNum(input.sample_price))
    errs.push("sample_price must be ≥0");
  if (input.sort_order !== undefined && !isOptNum(input.sort_order))
    errs.push("sort_order must be ≥0");
  if (input.is_active !== undefined && typeof input.is_active !== "boolean")
    errs.push("is_active must be boolean");
  if (input.includes !== undefined && !Array.isArray(input.includes))
    errs.push("includes must be an array");
  if (input.samagri !== undefined && !Array.isArray(input.samagri))
    errs.push("samagri must be an array");
  return errs.length > 0 ? errs : null;
}

adminCatalogRoute.get("/admin/pujas", async (c) => {
  const creds0 = supabaseCreds(c);
  if (!creds0) return credsMissing(c);
  const res = await rest(creds0, `pujas?select=${PUJA_COLUMNS}&order=sort_order.asc,name.asc`);
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Puja listing failed" } }, 500);
  return c.json({ data: { pujas: await res.json() } });
});

adminCatalogRoute.post("/admin/pujas", async (c) => {
  const creds0 = supabaseCreds(c);
  if (!creds0) return credsMissing(c);
  const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const errs = validatePuja(input, "create");
  if (errs)
    return fieldError(
      c,
      errs.map((message) => ({ field: "puja", message })),
    );
  const name = (input.name as string).trim();
  const slug = resolveSlug(input, name);
  if (!slug)
    return fieldError(c, [
      { field: "slug", message: "slug must be lowercase letters/numbers with single hyphens" },
    ]);
  const row = { ...input, slug, name, updated_at: new Date().toISOString() };
  const res = await rest(creds0, "pujas", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    if ((await res.text()).includes("duplicate key")) return conflict(c, `puja slug "${slug}"`);
    return c.json({ error: { code: "internal_error", message: "Puja create failed" } }, 500);
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return c.json({ data: rows[0] ?? null }, 201);
});

adminCatalogRoute.patch("/admin/pujas/:id", async (c) => {
  const creds0 = supabaseCreds(c);
  if (!creds0) return credsMissing(c);
  const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const errs = validatePuja(input, "update");
  if (errs)
    return fieldError(
      c,
      errs.map((message) => ({ field: "puja", message })),
    );
  delete (input as { slug?: unknown }).slug;
  const patch = { ...input, updated_at: new Date().toISOString() };
  const res = await rest(creds0, `pujas?id=eq.${encodeURIComponent(c.req.param("id"))}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Puja update failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Puja not found" } }, 404);
  return c.json({ data: rows[0] });
});

adminCatalogRoute.delete("/admin/pujas/:id", async (c) => {
  const creds0 = supabaseCreds(c);
  if (!creds0) return credsMissing(c);
  const res = await rest(creds0, `pujas?id=eq.${encodeURIComponent(c.req.param("id"))}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Puja delete failed" } }, 500);
  const rows = (await res.json()) as unknown[];
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Puja not found" } }, 404);
  return c.json({ data: { deleted: true } });
});
