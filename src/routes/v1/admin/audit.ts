/**
 * Admin Phase 1 — audit trail reader (03-winston-architecture.md §5).
 * GET /admin/audit — capability audit.read (super_admin, admin,
 * content_editor, booking_manager; NOT viewer, per 02 §C).
 * Filters: entity, actor, action, from/to (ISO). Newest first, paginated.
 */

import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { rest, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminAuditRoute = new Hono<Env>();

adminAuditRoute.get("/admin/audit", async (c: Context<Env>) => {
  const creds = supabaseCreds(c);
  if (!creds) {
    return c.json(
      {
        error: { code: "service_unavailable", message: "Audit log requires backend credentials." },
      },
      503,
    );
  }

  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
  const offset = (page - 1) * limit;

  const filters: string[] = [];
  const entity = c.req.query("entity");
  const actor = c.req.query("actor");
  const action = c.req.query("action");
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (entity) filters.push(`entity=eq.${encodeURIComponent(entity)}`);
  if (actor) filters.push(`actor=eq.${encodeURIComponent(actor)}`);
  if (action) filters.push(`action=eq.${encodeURIComponent(action)}`);
  if (from) filters.push(`created_at=gte.${encodeURIComponent(from)}`);
  if (to) filters.push(`created_at=lte.${encodeURIComponent(to)}`);

  const query = `audit_log?select=id,actor,action,entity,entity_id,details,created_at&order=created_at.desc&limit=${limit}&offset=${offset}${
    filters.length ? `&${filters.join("&")}` : ""
  }`;
  const res = await rest(creds, query, { headers: { Prefer: "count=exact" } });
  if (!res.ok) {
    return c.json(
      { error: { code: "internal_error", message: "Could not load the audit log." } },
      500,
    );
  }
  const rows = (await res.json()) as Record<string, unknown>[];
  const total = Number(res.headers.get("content-range")?.split("/")[1] ?? rows.length);
  return c.json({ data: rows, meta: { page, limit, total } });
});
