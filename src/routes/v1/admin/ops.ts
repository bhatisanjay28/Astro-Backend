/**
 * Epic 6.4 — Newsletter export + site settings for the admin area.
 * Export streams the subscriber list as CSV (email/marketing data stays
 * behind the admin gate, PRD §14). Settings are a JSONB key/value store;
 * the public /settings endpoint (Epic 1.9) reads its allowlisted keys.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { rest, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminOpsRoute = new Hono<Env>();

const KEY_RE = /^[a-z0-9_.-]{1,80}$/;

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

adminOpsRoute.get("/admin/newsletter/export", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
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
  return new Response(`${header}\n${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vyotish-newsletter-${stamp}.csv"`,
    },
  });
});

adminOpsRoute.get("/admin/settings", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const res = await rest(creds, "site_settings?select=key,value,updated_at&order=key.asc");
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Settings read failed" } }, 500);
  return c.json({ data: { settings: await res.json() } });
});

adminOpsRoute.put("/admin/settings/:key", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const key = c.req.param("key");
  if (!KEY_RE.test(key)) {
    return c.json(
      { error: { code: "validation_error", message: "key must be 1–80 chars of a-z 0-9 . _ -" } },
      400,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as { value?: unknown };
  if (body.value === undefined) {
    return c.json(
      { error: { code: "validation_error", message: "value is required (any JSON)" } },
      400,
    );
  }
  const res = await rest(creds, "site_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ key, value: body.value, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Settings write failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return c.json({ data: rows[0] ?? { key, value: body.value } });
});
