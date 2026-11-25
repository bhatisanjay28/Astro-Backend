/**
 * Epic 6.4 — Newsletter export + site settings for the admin area.
 * Export streams the subscriber list as CSV (email/marketing data stays
 * behind the admin gate, PRD §14). Settings are a JSONB key/value store;
 * the public /settings endpoint (Epic 1.9) reads its allowlisted keys.
 *
 * Admin Phase 1: per-route capability gates (export = newsletter.export and
 * is rate-limited 5/min/user; settings.read/write; engine.* keys additionally
 * require settings.engine = super_admin), and audit writes for every export
 * and settings change.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { requireCapability } from "../../../lib/admin-auth";
import { diffBeforeAfter, writeAudit } from "../../../lib/audit";
import { adminActionLimited } from "../../../lib/rate-limit";
import { rest, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminOpsRoute = new Hono<Env>();

const KEY_RE = /^[a-z0-9_.-]{1,80}$/;

/** Keys under engine.* change astrological computation — super admin only. */
const ENGINE_PREFIX = "engine.";

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
    details: { rows: rows.length, format: "csv" },
  });
  return new Response(`${header}\n${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vyotish-newsletter-${stamp}.csv"`,
    },
  });
});

adminOpsRoute.get("/admin/settings", requireCapability("settings.read"), async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const res = await rest(creds, "site_settings?select=key,value,updated_at&order=key.asc");
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Settings read failed" } }, 500);
  return c.json({ data: { settings: await res.json() } });
});

adminOpsRoute.put("/admin/settings/:key", requireCapability("settings.write"), async (c) => {
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
  if (key.startsWith(ENGINE_PREFIX) && !admin.capabilities.includes("settings.engine")) {
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
  const body = (await c.req.json().catch(() => ({}))) as { value?: unknown };
  if (body.value === undefined) {
    return c.json(
      { error: { code: "validation_error", message: "value is required (any JSON)" } },
      400,
    );
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
