/**
 * Admin Phase 4 — catalog rewrite (astrologers + pujas). Replaces the Epic
 * 6.4 read-mostly CRUD with:
 *  - explicit field whitelists on POST/PATCH (no mass-assignment spreads —
 *    Winston §6; the exhaustive lists are in the phase-4 story [R4]);
 *  - every column editable, incl. the 0018 additions (title_hi/about_hi/
 *    listing_consent_confirmed_at, description_hi/images/dakshina_on_request);
 *  - server pagination + name search + status filter + meta.total;
 *  - GET by id;
 *  - SOFT delete (deleted_at) with ?deleted=true trash view and
 *    POST /:id/restore — DELETE used to hard-delete while the UI said "soft"
 *    (phase-4 [P1]); consultation_requests.astrologer_id/puja_id are ON DELETE
 *    SET NULL, so a hard delete silently orphaned bookings;
 *  - DELETE ?purge=true hard-deletes behind catalog.purge — super_admin ONLY
 *    ([R6]; posts.purge precedent) — with a full pre-image audit;
 *  - POST /admin/catalog/reorder for up/down ordering (bulk-audited).
 *
 * Public gating mirrors the 0018 RLS floors (enforced in directory.ts):
 * astrologers need is_active + listing_consent_confirmed_at + not deleted;
 * pujas need is_active + not deleted.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { writeAudit } from "../../../lib/audit";
import { SLUG_RE, slugify } from "../../../lib/posts";
import { roleCan } from "../../../lib/rbac";
import { safeQuery } from "../../../lib/safe-query";
import { rest, restList, type SupabaseCreds, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminCatalogRoute = new Hono<Env>();

const ASTRO_COLUMNS =
  "id,slug,name,title,title_hi,photo_url,about,about_hi,expertise,languages,experience_years," +
  "price_per_minute,session_types,availability_label,is_available,sort_order,accent,is_active," +
  "is_sample,listing_consent_confirmed_at,deleted_at,created_at,updated_at";
const PUJA_COLUMNS =
  "id,slug,name,name_hi,category,purpose,description,description_hi,samagri,includes,images," +
  "duration,mode,sample_price,dakshina_on_request,muhurat_note,sort_order,accent,is_active," +
  "is_sample,deleted_at,created_at,updated_at";

/** [R4] exhaustive POST/PATCH whitelists — nothing else is accepted. */
const ASTRO_FIELDS = [
  "name",
  "title",
  "title_hi",
  "about",
  "about_hi",
  "photo_url",
  "expertise",
  "languages",
  "experience_years",
  "session_types",
  "price_per_minute",
  "is_available",
  "availability_label",
  "sort_order",
  "accent",
  "is_active",
  "listing_consent_confirmed_at",
] as const;
const PUJA_FIELDS = [
  "name",
  "name_hi",
  "description_hi",
  "category",
  "purpose",
  "description",
  "samagri",
  "includes",
  "images",
  "mode",
  "duration",
  "sample_price",
  "dakshina_on_request",
  "muhurat_note",
  "sort_order",
  "accent",
  "is_active",
] as const;

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
const ACCENTS = ["primary", "secondary"];

type Kind = "astrologers" | "pujas";

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

function fieldError(c: any, details: Array<{ field: string; message: string }>) {
  return c.json({ error: { code: "validation_error", message: "Invalid payload", details } }, 400);
}

function conflict(c: any, what: string) {
  return c.json({ error: { code: "conflict", message: `${what} already exists` } }, 409);
}

const isStr = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length >= 1 && v.length <= max;
const isOptStr = (v: unknown, max: number): boolean =>
  v === undefined || v === null || isStr(v, max);
const isOptNum = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const isStrArr = (v: unknown, maxItems: number, maxLen: number): boolean =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) &&
    v.length <= maxItems &&
    v.every((s) => typeof s === "string" && s.length <= maxLen));

/**
 * URLs (photo_url, images entries) must be site-relative or http(s) — this
 * keeps `javascript:`/`data:` URIs out of <img src> and picker-built <a href>.
 */
const isSafeUrl = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (typeof v === "string" &&
    v.length <= 500 &&
    (v.startsWith("/") || v.startsWith("https://") || v.startsWith("http://")));

function resolveSlug(input: Record<string, unknown>, name: string): string | null {
  const given = typeof input.slug === "string" ? input.slug.trim() : "";
  const slug = given || slugify(name);
  if (!slug || !SLUG_RE.test(slug)) return null;
  return slug;
}

/**
 * listing_consent_confirmed_at: `true` stamps now(), `false`/null clears,
 * an ISO timestamp backdates (kept as-is), anything else is a 400.
 */
function consentValue(input: Record<string, unknown>): { value: unknown; error?: string } {
  const v = input.listing_consent_confirmed_at;
  if (v === undefined) return { value: undefined };
  if (v === true) return { value: new Date().toISOString() };
  if (v === false || v === null) return { value: null };
  if (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v))) {
    return { value: v };
  }
  return {
    value: undefined,
    error: "listing_consent_confirmed_at must be true, false or an ISO timestamp",
  };
}

function validateAstrologer(
  input: Record<string, unknown>,
  mode: "create" | "update",
): Array<{ field: string; message: string }> | null {
  const errs: Array<{ field: string; message: string }> = [];
  const push = (field: string, message: string): void => {
    errs.push({ field, message });
  };
  if (mode === "create" && !isStr(input.name, 120)) push("name", "name is required (1–120 chars)");
  else if (input.name !== undefined && !isStr(input.name, 120))
    push("name", "name must be 1–120 chars");
  if (!isOptStr(input.title, 160)) push("title", "title must be ≤160 chars");
  if (!isOptStr(input.title_hi, 160)) push("title_hi", "title_hi must be ≤160 chars");
  if (!isOptStr(input.about, 4000)) push("about", "about must be ≤4000 chars");
  if (!isOptStr(input.about_hi, 4000)) push("about_hi", "about_hi must be ≤4000 chars");
  if (!isSafeUrl(input.photo_url))
    push("photo_url", "photo_url must be a site-relative or http(s) URL");
  if (!isStrArr(input.expertise, 20, 80)) push("expertise", "expertise must be ≤20 short strings");
  if (!isStrArr(input.languages, 20, 80)) push("languages", "languages must be ≤20 short strings");
  if (!isOptNum(input.experience_years)) push("experience_years", "experience_years must be ≥0");
  if (!isOptNum(input.price_per_minute)) push("price_per_minute", "price_per_minute must be ≥0");
  if (!isOptNum(input.sort_order)) push("sort_order", "sort_order must be ≥0");
  if (!isOptStr(input.availability_label, 80))
    push("availability_label", "availability_label must be ≤80 chars");
  if (
    input.accent !== undefined &&
    input.accent !== null &&
    !ACCENTS.includes(String(input.accent))
  )
    push("accent", `accent must be one of: ${ACCENTS.join(", ")}`);
  if (input.is_active !== undefined && typeof input.is_active !== "boolean")
    push("is_active", "is_active must be boolean");
  if (input.is_available !== undefined && typeof input.is_available !== "boolean")
    push("is_available", "is_available must be boolean");
  const st = input.session_types;
  if (st !== undefined && st !== null) {
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
      push("session_types", "session_types must be ≤10 {type, duration_min} objects");
    }
  }
  const consent = consentValue(input);
  if (consent.error) push("listing_consent_confirmed_at", consent.error);
  return errs.length > 0 ? errs : null;
}

function validatePuja(
  input: Record<string, unknown>,
  mode: "create" | "update",
): Array<{ field: string; message: string }> | null {
  const errs: Array<{ field: string; message: string }> = [];
  const push = (field: string, message: string): void => {
    errs.push({ field, message });
  };
  if (mode === "create" && !isStr(input.name, 120)) push("name", "name is required (1–120 chars)");
  else if (input.name !== undefined && !isStr(input.name, 120))
    push("name", "name must be 1–120 chars");
  if (!isOptStr(input.name_hi, 160)) push("name_hi", "name_hi must be ≤160 chars");
  if (mode === "create" && !isStr(input.category, 40)) push("category", "category is required");
  else if (input.category !== undefined && input.category !== null) {
    if (!PUJA_CATEGORIES.includes(String(input.category)))
      push("category", `category must be one of: ${PUJA_CATEGORIES.join(", ")}`);
  }
  if (!isOptStr(input.purpose, 300)) push("purpose", "purpose must be ≤300 chars");
  if (!isOptStr(input.description, 8000)) push("description", "description must be ≤8000 chars");
  if (!isOptStr(input.description_hi, 8000))
    push("description_hi", "description_hi must be ≤8000 chars");
  if (!isOptStr(input.muhurat_note, 500)) push("muhurat_note", "muhurat_note must be ≤500 chars");
  if (!isOptStr(input.duration, 80)) push("duration", "duration must be ≤80 chars");
  if (input.mode !== undefined && input.mode !== null) {
    if (
      !Array.isArray(input.mode) ||
      input.mode.length > 3 ||
      !input.mode.every((m) => PUJA_MODES.includes(String(m)))
    ) {
      push("mode", `mode must be a subset of: ${PUJA_MODES.join(", ")}`);
    }
  }
  if (!isOptNum(input.sample_price)) push("sample_price", "sample_price must be ≥0");
  if (!isOptNum(input.sort_order)) push("sort_order", "sort_order must be ≥0");
  if (input.dakshina_on_request !== undefined && typeof input.dakshina_on_request !== "boolean")
    push("dakshina_on_request", "dakshina_on_request must be boolean");
  if (
    input.accent !== undefined &&
    input.accent !== null &&
    !ACCENTS.includes(String(input.accent))
  )
    push("accent", `accent must be one of: ${ACCENTS.join(", ")}`);
  if (input.is_active !== undefined && typeof input.is_active !== "boolean")
    push("is_active", "is_active must be boolean");
  if (!isStrArr(input.includes, 40, 200))
    push("includes", "includes must be ≤40 strings (≤200 chars)");
  if (!isStrArr(input.samagri, 40, 200))
    push("samagri", "samagri must be ≤40 strings (≤200 chars)");
  if (!isStrArr(input.images, 10, 500)) push("images", "images must be ≤10 URLs");
  if (Array.isArray(input.images) && !input.images.every((u) => isSafeUrl(u)))
    push("images", "images entries must be site-relative or http(s) URLs");
  return errs.length > 0 ? errs : null;
}

/** Whitelist picker — copies only known, declared fields out of the payload. */
function pickFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in input) out[key] = input[key];
  }
  return out;
}

/** dakshina_on_request=true nulls sample_price (they are mutually exclusive). */
function applyDakshinaRule(row: Record<string, unknown>): void {
  if (row.dakshina_on_request === true) row.sample_price = null;
}

/* ------------------------------ list / get ------------------------------ */

async function listKind(c: any, kind: Kind, columns: string): Promise<Response> {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const q = c.req.query();
  const page = Math.max(1, Number(q.page ?? "1") || 1);
  const perPage = Math.min(100, Math.max(1, Number(q.per_page ?? "25") || 25));
  const deleted = q.deleted === "true";
  const params = new URLSearchParams({
    select: columns,
    order: "sort_order.asc,name.asc",
    limit: String(perPage),
    offset: String((page - 1) * perPage),
  });
  params.set("deleted_at", deleted ? "not.is.null" : "is.null");
  if (q.status === "active") params.set("is_active", "eq.true");
  if (q.status === "inactive") params.set("is_active", "eq.false");
  const term = safeQuery(q.q);
  if (term) params.set("name", `ilike.*${term}*`);
  const listing = await restList(creds, `${kind}?${params.toString()}`);
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: `${kind} listing failed` } }, 500);
  return c.json({
    data: { [kind]: listing.rows },
    meta: { page, per_page: perPage, total: listing.total, deleted },
  });
}

async function getById(c: any, kind: Kind, columns: string): Promise<Response> {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const res = await rest(
    creds,
    `${kind}?id=eq.${encodeURIComponent(c.req.param("id"))}&select=${columns}`,
  );
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: `${kind} read failed` } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0) return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
  return c.json({ data: rows[0] });
}

/* --------------------------- delete lifecycle --------------------------- */

async function preImage(
  creds: SupabaseCreds,
  kind: Kind,
  id: string,
): Promise<Record<string, unknown> | null> {
  const res = await rest(creds, `${kind}?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

/** Cap long text fields inside audit payloads. */
function trimForAudit(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] =
      typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}… (${v.length} chars)` : v;
  }
  return out;
}

async function softDelete(c: any, kind: Kind): Promise<Response> {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  const id = c.req.param("id");
  if (c.req.query("purge") === "true") {
    // [R6] irreversible hard delete is super_admin-only (posts.purge
    // precedent, rbac.ts) — checked here because the /admin/{kind}/*
    // subtree maps only gate the soft-delete path at catalog.write; purge
    // must not ride that level.
    if (!roleCan(admin.role, "catalog.purge")) {
      return c.json(
        {
          error: {
            code: "forbidden",
            message: "Permanent deletion requires a super admin.",
          },
        },
        403,
      );
    }
    const before = await preImage(creds, kind, id);
    if (!before) return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    const res = await rest(creds, `${kind}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok)
      return c.json({ error: { code: "internal_error", message: `${kind} purge failed` } }, 500);
    await writeAudit(creds, {
      actor: admin.userId,
      action: `${kind}.purge`,
      entity: kind,
      entity_id: id,
      details: { purge: true, pre_image: trimForAudit(before) },
    });
    return c.json({ data: { purged: true, id } });
  }
  const res = await rest(creds, `${kind}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: `${kind} delete failed` } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0) return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
  await writeAudit(creds, {
    actor: admin.userId,
    action: `${kind}.soft_delete`,
    entity: kind,
    entity_id: id,
    details: { slug: rows[0]?.slug },
  });
  return c.json({ data: { deleted: true, id } });
}

async function restore(c: any, kind: Kind): Promise<Response> {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  const id = c.req.param("id");
  const res = await rest(creds, `${kind}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ deleted_at: null, updated_at: new Date().toISOString() }),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: `${kind} restore failed` } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0) return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
  await writeAudit(creds, {
    actor: admin.userId,
    action: `${kind}.restore`,
    entity: kind,
    entity_id: id,
    details: { slug: rows[0]?.slug },
  });
  return c.json({ data: rows[0] });
}

/* ------------------------------- routes -------------------------------- */

for (const [kind, columns, fields, validate, isAstro] of [
  ["astrologers", ASTRO_COLUMNS, ASTRO_FIELDS, validateAstrologer, true],
  ["pujas", PUJA_COLUMNS, PUJA_FIELDS, validatePuja, false],
] as const) {
  adminCatalogRoute.get(`/admin/${kind}`, async (c) => listKind(c, kind, columns));

  adminCatalogRoute.get(`/admin/${kind}/:id`, async (c) => getById(c, kind, columns));

  adminCatalogRoute.post(`/admin/${kind}`, async (c) => {
    const creds = supabaseCreds(c);
    if (!creds) return credsMissing(c);
    const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const errs = validate(input, "create");
    if (errs) return fieldError(c, errs);
    const picked = pickFields(input, fields);
    const name = String(picked.name ?? "").trim();
    const slug = resolveSlug(input, name);
    if (!slug) {
      return fieldError(c, [
        { field: "slug", message: "slug must be lowercase letters/numbers with single hyphens" },
      ]);
    }
    const row = { ...picked, slug, name, updated_at: new Date().toISOString() };
    if (!isAstro) applyDakshinaRule(row);
    const res = await rest(creds, kind, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      if ((await res.text()).includes("duplicate key"))
        return conflict(c, `${kind} slug "${slug}"`);
      return c.json({ error: { code: "internal_error", message: `${kind} create failed` } }, 500);
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const admin = c.get("admin");
    await writeAudit(creds, {
      actor: admin.userId,
      action: `${kind}.create`,
      entity: kind,
      entity_id: typeof rows[0]?.id === "string" ? (rows[0]?.id as string) : null,
      details: {
        slug,
        name: name.slice(0, 120),
        fields: Object.keys(picked),
      },
    });
    return c.json({ data: rows[0] ?? null }, 201);
  });

  adminCatalogRoute.patch(`/admin/${kind}/:id`, async (c) => {
    const creds = supabaseCreds(c);
    if (!creds) return credsMissing(c);
    const admin = c.get("admin");
    const id = c.req.param("id");
    const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const errs = validate(input, "update");
    if (errs) return fieldError(c, errs);
    // slug is create-only — the PATCH whitelist does not include it
    const picked = pickFields(input, fields);
    if (Object.keys(picked).length === 0) {
      return fieldError(c, [{ field: "payload", message: "no editable fields in payload" }]);
    }
    const before = await preImage(creds, kind, id);
    if (!before) return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    // Record so the consent write (astrologers only) type-checks in the
    // shared route loop — the picked type omits it for pujas
    const patch: Record<string, unknown> = { ...picked, updated_at: new Date().toISOString() };
    if (!isAstro) {
      // closeout C2: exclusivity spans PATCHes — when the patch doesn't
      // carry the flag, the stored flag still governs the price. The rule
      // runs on a merged candidate; only a rule-nulled price is copied back,
      // and only when the patch touched price or flag (a `{name}`-only PATCH
      // changes neither field). The folded flag itself is never written.
      const candidate: Record<string, unknown> = {
        ...patch,
        dakshina_on_request: patch.dakshina_on_request ?? before.dakshina_on_request,
      };
      applyDakshinaRule(candidate);
      if (
        candidate.sample_price === null &&
        (patch.sample_price !== undefined || patch.dakshina_on_request !== undefined)
      ) {
        patch.sample_price = null;
      }
    }
    const consent = consentValue(input);
    if (isAstro && consent.value !== undefined) patch.listing_consent_confirmed_at = consent.value;
    const res = await rest(creds, `${kind}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!res.ok)
      return c.json({ error: { code: "internal_error", message: `${kind} update failed` } }, 500);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (rows.length === 0)
      return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    const details: Record<string, unknown> = {
      fields: Object.keys(patch).filter((k) => k !== "updated_at"),
    };
    if (isAstro && "listing_consent_confirmed_at" in patch) {
      // consent writes are audited with who/when (story §Scope 1)
      details.consent_set_to = patch.listing_consent_confirmed_at;
    }
    await writeAudit(creds, {
      actor: admin.userId,
      action: `${kind}.update`,
      entity: kind,
      entity_id: id,
      details,
    });
    return c.json({ data: rows[0] });
  });

  adminCatalogRoute.post(`/admin/${kind}/:id/restore`, async (c) => restore(c, kind));
  adminCatalogRoute.delete(`/admin/${kind}/:id`, async (c) => softDelete(c, kind));
}

/** POST /admin/catalog/reorder {kind, ids[]} — sort_order := (index+1)*10. */
adminCatalogRoute.post("/admin/catalog/reorder", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; ids?: unknown };
  const kind = body.kind === "astrologers" || body.kind === "pujas" ? body.kind : null;
  const ids = Array.isArray(body.ids) ? body.ids : null;
  if (!kind)
    return fieldError(c, [{ field: "kind", message: "kind must be astrologers or pujas" }]);
  if (!ids || ids.length === 0 || ids.length > 200 || !ids.every((i) => typeof i === "string")) {
    return fieldError(c, [{ field: "ids", message: "ids must be 1–200 row ids in the new order" }]);
  }
  let moved = 0;
  for (let i = 0; i < ids.length; i++) {
    const res = await rest(creds, `${kind}?id=eq.${encodeURIComponent(ids[i] as string)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        sort_order: (i + 1) * 10,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok)
      return c.json({ error: { code: "internal_error", message: `${kind} reorder failed` } }, 500);
    const rows = (await res.json()) as unknown[];
    if (rows.length === 0) {
      return c.json(
        { error: { code: "not_found", message: `id not found: ${String(ids[i]).slice(0, 40)}` } },
        404,
      );
    }
    moved += 1;
  }
  await writeAudit(creds, {
    actor: admin.userId,
    action: `${kind}.reorder`,
    entity: kind,
    details: { moved },
  });
  return c.json({ data: { reordered: moved } });
});
