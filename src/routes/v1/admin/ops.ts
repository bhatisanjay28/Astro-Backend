/**
 * Epic 6.4 — newsletter export, subscribers and site settings for the admin
 * area. Export streams the subscriber list as CSV (email/marketing data stays
 * behind the admin gate, PRD §14). Settings are a JSONB key/value store; the
 * public /settings endpoint (Epic 1.9) reads its allowlisted keys.
 *
 * Admin Phase 4 rework (lib/settings-registry.ts is the contract):
 *  - GET /admin/settings returns the registry itself so the UI renders
 *    groups with no hardcoded key list (D12); engine values are hidden from
 *    roles without settings.engine;
 *  - PUT /admin/settings/:key picks the capability PER KEY from the registry
 *    (engine → settings.engine, nav → nav.write, rest → settings.write) and
 *    keeps the defensive `public.engine_` prefix check — the real keys are
 *    public.engine_* (underscore), which is exactly why the old "engine."
 *    guard matched nothing and role `admin` could rewrite the engine ([P0]);
 *  - GET/PUT /admin/settings/nav validate the frontend NavTab shape 1:1 and
 *    ping the CF Pages deploy hook on change so the build-time merge
 *    re-bakes the header (scripts/ sync reads public.nav_config);
 *  - subscribers get list / patch / delete (newsletter.read / .write /
 *    .delete — DELETE is super_admin + admin only). The DPDP erase audits a
 *    SHA-256 of the email, never the address itself;
 *  - the CSV export sets X-Export-Capped at its 10k-row ceiling and records
 *    that in the audit, so a truncated export is never mistaken for the full
 *    list.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { requireCapability } from "../../../lib/admin-auth";
import { diffBeforeAfter, writeAudit } from "../../../lib/audit";
import { pingFrontendDeployHook } from "../../../lib/deploy-hook";
import { adminActionLimited } from "../../../lib/rate-limit";
import { roleCan } from "../../../lib/rbac";
import { safeQuery } from "../../../lib/safe-query";
import {
  checkSettingValue,
  isEngineKey,
  registryDef,
  registryGroups,
  SETTINGS_REGISTRY,
} from "../../../lib/settings-registry";
import { rest, restList, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminOpsRoute = new Hono<Env>();

const KEY_RE = /^[a-z0-9_.-]{1,80}$/;
/** DB key behind the nav editor ([R3]) — also served publicly via /settings. */
const NAV_KEY = "public.nav_config";
const SUB_COLUMNS = "id,email,confirmed_at,unsubscribed_at,source,created_at";

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

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** SHA-256 hex — DPDP erase audits the hash, never the plaintext address. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type FieldError = { field: string; message: string };

/** Site-relative nav href: starts with a single "/", no scheme tricks. */
function isNavHref(href: string): boolean {
  return (
    href.startsWith("/") && !href.startsWith("//") && !href.includes("://") && !href.includes("..")
  );
}

const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * Validate one NavTab against the frontend interface (data/navigation.ts)
 * 1:1 — label/label_hi/href/description/icon (+ optional menu groups with
 * title?/cols?/links{label,href,desc?,hi?}). Unknown fields are rejected, so
 * a drifted editor cannot silently drop data ([R3]).
 */
function validateNavTab(tab: Record<string, unknown>, path: string, errs: FieldError[]): void {
  for (const k of Object.keys(tab)) {
    if (!["label", "label_hi", "href", "description", "icon", "menu"].includes(k)) {
      errs.push({ field: `${path}.${k}`, message: "unknown field" });
    }
  }
  if (!isStr(tab.label) || !tab.label || tab.label.length > 80) {
    errs.push({ field: `${path}.label`, message: "label is required (≤80 chars)" });
  }
  if (!isStr(tab.label_hi) || !tab.label_hi || tab.label_hi.length > 80) {
    errs.push({ field: `${path}.label_hi`, message: "label_hi is required (≤80 chars)" });
  }
  if (!isStr(tab.href) || !isNavHref(tab.href) || tab.href.length > 300) {
    errs.push({
      field: `${path}.href`,
      message: "href must be a site-relative path starting with / (≤300 chars)",
    });
  }
  if (!isStr(tab.description) || !tab.description || tab.description.length > 200) {
    errs.push({ field: `${path}.description`, message: "description is required (≤200 chars)" });
  }
  if (!isStr(tab.icon) || !tab.icon || tab.icon.length > 60) {
    errs.push({ field: `${path}.icon`, message: "icon is required (≤60 chars)" });
  }
  const menu = tab.menu;
  if (menu === undefined) return;
  if (!Array.isArray(menu) || menu.length > 8) {
    errs.push({ field: `${path}.menu`, message: "menu must be an array of at most 8 groups" });
    return;
  }
  menu.forEach((g, gi) => {
    const gp = `${path}.menu[${gi}]`;
    if (!g || typeof g !== "object" || Array.isArray(g)) {
      errs.push({ field: gp, message: "menu group must be an object" });
      return;
    }
    const group = g as Record<string, unknown>;
    for (const k of Object.keys(group)) {
      if (!["title", "cols", "links"].includes(k)) {
        errs.push({ field: `${gp}.${k}`, message: "unknown field" });
      }
    }
    if (group.title !== undefined && (!isStr(group.title) || group.title.length > 80)) {
      errs.push({ field: `${gp}.title`, message: "title must be ≤80 chars" });
    }
    if (
      group.cols !== undefined &&
      (typeof group.cols !== "number" ||
        !Number.isInteger(group.cols) ||
        group.cols < 1 ||
        group.cols > 12)
    ) {
      errs.push({ field: `${gp}.cols`, message: "cols must be an integer 1–12" });
    }
    if (!Array.isArray(group.links) || group.links.length === 0 || group.links.length > 40) {
      errs.push({ field: `${gp}.links`, message: "links must be an array of 1–40 entries" });
      return;
    }
    group.links.forEach((l, li) => {
      const lp = `${gp}.links[${li}]`;
      if (!l || typeof l !== "object" || Array.isArray(l)) {
        errs.push({ field: lp, message: "link must be an object" });
        return;
      }
      const link = l as Record<string, unknown>;
      for (const k of Object.keys(link)) {
        if (!["label", "href", "desc", "hi"].includes(k)) {
          errs.push({ field: `${lp}.${k}`, message: "unknown field" });
        }
      }
      if (!isStr(link.label) || !link.label || link.label.length > 80) {
        errs.push({ field: `${lp}.label`, message: "label is required (≤80 chars)" });
      }
      if (!isStr(link.href) || !isNavHref(link.href) || link.href.length > 300) {
        errs.push({
          field: `${lp}.href`,
          message: "href must be a site-relative path starting with / (≤300 chars)",
        });
      }
      if (link.desc !== undefined && (!isStr(link.desc) || link.desc.length > 200)) {
        errs.push({ field: `${lp}.desc`, message: "desc must be ≤200 chars" });
      }
      if (link.hi !== undefined && (!isStr(link.hi) || link.hi.length > 80)) {
        errs.push({ field: `${lp}.hi`, message: "hi must be ≤80 chars" });
      }
    });
  });
}

// --- newsletter export -------------------------------------------------------

adminOpsRoute.get("/admin/newsletter/export", requireCapability("newsletter.export"), async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  if (adminActionLimited("admin:export", admin.userId, (c.env ?? {}) as Record<string, unknown>)) {
    return c.json(
      {
        error: {
          code: "rate_limited",
          message: "Export limit reached (5 per minute) — try again shortly.",
        },
      },
      429,
    );
  }
  const res = await rest(
    creds,
    "newsletter_subscribers?select=email,confirmed_at,unsubscribed_at,source,created_at&order=created_at.desc&limit=10000",
  );
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Newsletter export failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  // Ceiling marker: a 10k-row cap must never masquerade as the full list.
  const capped = rows.length >= 10000;
  const header = "email,confirmed_at,unsubscribed_at,source,created_at";
  const body = rows
    .map((r) =>
      [r.email, r.confirmed_at, r.unsubscribed_at, r.source, r.created_at].map(csvCell).join(","),
    )
    .join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  // Every export is logged (who, when, how many rows) per the security brief.
  await writeAudit(creds, {
    actor: admin.userId,
    action: "newsletter.export",
    entity: "newsletter_subscribers",
    details: { rows: rows.length, format: "csv", capped },
  });
  return new Response(`${header}\n${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vyotish-newsletter-${stamp}.csv"`,
      ...(capped ? { "X-Export-Capped": "true" } : {}),
    },
  });
});

// --- subscribers (phase 4) ---------------------------------------------------

adminOpsRoute.get("/admin/subscribers", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const q = c.req.query();
  const page = Math.max(1, Number(q.page ?? "1") || 1);
  const perPage = Math.min(100, Math.max(1, Number(q.per_page ?? "25") || 25));
  const params = new URLSearchParams({
    select: SUB_COLUMNS,
    order: "created_at.desc",
    limit: String(perPage),
    offset: String((page - 1) * perPage),
  });
  const term = safeQuery(q.q ?? "");
  if (term) params.set("email", `ilike.*${term}*`);
  const status = q.status ?? "all";
  if (status === "confirmed") params.set("confirmed_at", "not.is.null");
  else if (status === "unsubscribed") params.set("unsubscribed_at", "not.is.null");
  else if (status === "active") params.set("unsubscribed_at", "is.null");
  const listing = await restList(creds, `newsletter_subscribers?${params.toString()}`);
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Subscribers read failed" } }, 500);
  return c.json({
    data: { subscribers: listing.rows },
    meta: { page, per_page: perPage, total: listing.total },
  });
});

adminOpsRoute.patch("/admin/subscribers/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    unsubscribed?: unknown;
    confirmed?: unknown;
  };
  const patch: Record<string, unknown> = {};
  const errs: FieldError[] = [];
  if (body.unsubscribed !== undefined) {
    if (typeof body.unsubscribed !== "boolean") {
      errs.push({ field: "unsubscribed", message: "must be true or false" });
    } else {
      patch.unsubscribed_at = body.unsubscribed ? new Date().toISOString() : null;
    }
  }
  if (body.confirmed !== undefined) {
    if (typeof body.confirmed !== "boolean") {
      errs.push({ field: "confirmed", message: "must be true or false" });
    } else {
      patch.confirmed_at = body.confirmed ? new Date().toISOString() : null;
    }
  }
  if (errs.length === 0 && Object.keys(patch).length === 0) {
    errs.push({
      field: "body",
      message: "nothing to update — send {unsubscribed} and/or {confirmed}",
    });
  }
  if (errs.length > 0) {
    return c.json(
      { error: { code: "validation_error", message: "Invalid subscriber payload", details: errs } },
      400,
    );
  }
  const prevRes = await rest(
    creds,
    `newsletter_subscribers?id=eq.${encodeURIComponent(id)}&select=${SUB_COLUMNS}`,
  );
  const prevRows = prevRes.ok ? ((await prevRes.json()) as Array<Record<string, unknown>>) : [];
  const prev = prevRows[0];
  if (!prev) return c.json({ error: { code: "not_found", message: "Subscriber not found" } }, 404);
  const res = await rest(creds, `newsletter_subscribers?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Subscriber update failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Subscriber not found" } }, 404);
  await writeAudit(creds, {
    actor: admin.userId,
    action: "newsletter.update",
    entity: "newsletter_subscribers",
    entity_id: id,
    details: { changes: diffBeforeAfter(prev, rows[0] ?? {}) },
  });
  return c.json({ data: rows[0] });
});

adminOpsRoute.delete("/admin/subscribers/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  const id = c.req.param("id");
  const prevRes = await rest(
    creds,
    `newsletter_subscribers?id=eq.${encodeURIComponent(id)}&select=${SUB_COLUMNS}`,
  );
  const prevRows = prevRes.ok ? ((await prevRes.json()) as Array<Record<string, unknown>>) : [];
  const prev = prevRows[0];
  if (!prev) return c.json({ error: { code: "not_found", message: "Subscriber not found" } }, 404);
  const email = typeof prev.email === "string" ? prev.email : "";
  const emailSha256 = await sha256Hex(email);
  const res = await rest(creds, `newsletter_subscribers?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Subscriber delete failed" } }, 500);
  // DPDP erase: the audit keeps the hash + source, never the address itself.
  await writeAudit(creds, {
    actor: admin.userId,
    action: "newsletter.delete",
    entity: "newsletter_subscribers",
    entity_id: id,
    details: { email_sha256: emailSha256, source: prev.source ?? null },
  });
  return c.json({ data: { deleted: true, id, email_sha256: emailSha256 } });
});

// --- settings (registry-driven, phase 4) -------------------------------------

adminOpsRoute.get("/admin/settings", requireCapability("settings.read"), async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  const seeEngine = roleCan(admin.role, "settings.engine");
  const res = await rest(creds, "site_settings?select=key,value,updated_at&order=key.asc");
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Settings read failed" } }, 500);
  const rows = (await res.json()) as Array<{
    key: string;
    value: unknown;
    updated_at?: string;
  }>;
  const values: Record<string, unknown> = {};
  const lastChanged: Record<string, string> = {};
  for (const row of rows) {
    const def = registryDef(row.key);
    if (!def) continue; // unknown legacy keys stay out of the admin UI
    // engine values are hidden from roles without settings.engine ([R9])
    if (def.capability === "settings.engine" && !seeEngine) continue;
    values[row.key] = row.value;
    if (typeof row.updated_at === "string") lastChanged[row.key] = row.updated_at;
  }
  return c.json({
    data: {
      registry: SETTINGS_REGISTRY,
      groups: registryGroups(),
      values,
      last_changed: lastChanged,
    },
  });
});

adminOpsRoute.get("/admin/settings/nav", requireCapability("nav.write"), async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const res = await rest(
    creds,
    `site_settings?key=eq.${encodeURIComponent(NAV_KEY)}&select=key,value,updated_at`,
  );
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Nav config read failed" } }, 500);
  const rows = (await res.json()) as Array<{
    key: string;
    value: unknown;
    updated_at?: string;
  }>;
  const row = rows[0];
  return c.json({
    data: {
      key: NAV_KEY,
      tabs: row?.value ?? null,
      updated_at: row?.updated_at ?? null,
    },
  });
});

adminOpsRoute.put("/admin/settings/nav", requireCapability("nav.write"), async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  if (adminActionLimited("admin:write", admin.userId, (c.env ?? {}) as Record<string, unknown>)) {
    return c.json(
      { error: { code: "rate_limited", message: "Too many admin writes — slow down." } },
      429,
    );
  }
  const body = (await c.req.json().catch(() => null)) as unknown;
  if (!Array.isArray(body) || body.length === 0 || body.length > 20) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "nav config must be an array of 1–20 tabs",
        },
      },
      400,
    );
  }
  const errs: FieldError[] = [];
  body.forEach((t, i) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      errs.push({ field: `tabs[${i}]`, message: "tab must be an object" });
      return;
    }
    validateNavTab(t as Record<string, unknown>, `tabs[${i}]`, errs);
  });
  if (errs.length > 0) {
    return c.json(
      { error: { code: "validation_error", message: "Invalid nav config", details: errs } },
      400,
    );
  }
  // previous value first — change detection drives the deploy-hook ping
  const prevRes = await rest(
    creds,
    `site_settings?key=eq.${encodeURIComponent(NAV_KEY)}&select=key,value`,
  );
  const prevRows = prevRes.ok ? ((await prevRes.json()) as Array<Record<string, unknown>>) : [];
  const prev = prevRows[0] ?? null;
  const changed = !prev || JSON.stringify(prev.value) !== JSON.stringify(body);
  const res = await rest(creds, "site_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ key: NAV_KEY, value: body, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Nav config write failed" } }, 500);
  await writeAudit(creds, {
    actor: admin.userId,
    action: "settings.write",
    entity: "site_settings",
    entity_id: NAV_KEY,
    details: { tabs: body.length, changed },
  });
  // rebuild the static frontend so the header picks the new tabs up —
  // fire-and-forget ([P3] review fix): a slow Pages hook must not delay the
  // admin save. waitUntil on Workers; plain await in the Bun test env,
  // which has no execution context.
  if (changed && c.env?.FRONTEND_DEPLOY_HOOK_URL) {
    const ping = pingFrontendDeployHook(c.env.FRONTEND_DEPLOY_HOOK_URL, { source: "nav_save" });
    try {
      c.executionCtx.waitUntil(ping);
    } catch {
      await ping;
    }
  }
  return c.json({ data: { key: NAV_KEY, value: body } });
});

adminOpsRoute.put("/admin/settings/:key", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin");
  const key = c.req.param("key");
  if (!key || !KEY_RE.test(key)) {
    return c.json(
      { error: { code: "validation_error", message: "key must be 1–80 chars of a-z 0-9 . _ -" } },
      400,
    );
  }
  const def = registryDef(key);
  if (!def) {
    return c.json({ error: { code: "not_found", message: `unknown settings key: ${key}` } }, 404);
  }
  // Belt-and-braces on top of the registry capability: an engine key can
  // never be written without settings.engine, even if a future registry
  // entry mislabels it ([P0] regression pin — the real keys are
  // public.engine_* with an underscore, which is why the old "engine."
  // prefix guard matched nothing).
  if (isEngineKey(key) && !admin.capabilities.includes("settings.engine")) {
    return c.json(
      {
        error: {
          code: "forbidden",
          message: "Calculation-engine settings can only be changed by a super admin.",
        },
      },
      403,
    );
  }
  if (!roleCan(admin.role, def.capability)) {
    return c.json(
      {
        error: {
          code: "forbidden",
          message:
            def.capability === "nav.write"
              ? "This key is managed on the Nav screen (nav.write capability required)."
              : "You do not have permission to change this setting.",
        },
      },
      403,
    );
  }
  if (adminActionLimited("admin:write", admin.userId, (c.env ?? {}) as Record<string, unknown>)) {
    return c.json(
      { error: { code: "rate_limited", message: "Too many admin writes — slow down." } },
      429,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as { value?: unknown };
  if (body.value === undefined) {
    return c.json(
      { error: { code: "validation_error", message: "value is required (any JSON)" } },
      400,
    );
  }
  const check = checkSettingValue(def, body.value);
  if (!check.ok) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: `Invalid value for ${key}`,
          details: [{ field: "value", message: check.message }],
        },
      },
      400,
    );
  }
  // NavTab shape check on the generic path too ([P1] review fix): the json
  // type is deliberately shape-agnostic, but public.nav_config is served on
  // the public /settings and baked into the site header — writing it through
  // this back door must clear the same validator as PUT /admin/settings/nav,
  // or a javascript: href could bypass isNavHref entirely.
  if (key === NAV_KEY) {
    const navErrs: FieldError[] = [];
    if (!Array.isArray(body.value)) {
      navErrs.push({ field: "value", message: "nav config must be an array of tabs" });
    } else {
      (body.value as unknown[]).forEach((t, i) => {
        if (!t || typeof t !== "object" || Array.isArray(t)) {
          navErrs.push({ field: `value[${i}]`, message: "tab must be an object" });
          return;
        }
        validateNavTab(t as Record<string, unknown>, `value[${i}]`, navErrs);
      });
    }
    if (navErrs.length > 0) {
      return c.json(
        {
          error: {
            code: "validation_error",
            message: "Invalid nav config — must match the NavTab shape",
            details: navErrs.slice(0, 25),
          },
        },
        400,
      );
    }
  }
  // previous row first, so the audit shows what changed (who-changed-what)
  const prevRes = await rest(
    creds,
    `site_settings?key=eq.${encodeURIComponent(key)}&select=key,value`,
  );
  const prev = prevRes.ok
    ? (((await prevRes.json()) as Array<Record<string, unknown>>)[0] ?? null)
    : null;

  const res = await rest(creds, "site_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ key, value: body.value, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Settings write failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  await writeAudit(creds, {
    actor: admin.userId,
    action: "settings.write",
    entity: "site_settings",
    entity_id: key,
    details: { changes: diffBeforeAfter(prev, { value: body.value }) },
  });
  return c.json({ data: rows[0] ?? { key, value: body.value } });
});
