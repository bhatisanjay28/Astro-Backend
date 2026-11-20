/**
 * Epic 6.4 — Inboxes for the admin area (PRD §5/§6): consultation + puja
 * booking requests and contact messages. Reads are paginated; the only
 * write is the status field (workflow: new → contacted → scheduled → closed
 * for requests, new → read → closed for messages). Anon inserts stay on the
 * public endpoints (Epic 5.2/5.3).
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { rest, restList, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminInboxRoute = new Hono<Env>();

const REQUEST_STATUSES = ["new", "contacted", "scheduled", "closed"];
const MESSAGE_STATUSES = ["new", "read", "closed"];

const REQUEST_COLUMNS =
  "id,name,phone,email,topic,preferred_date,preferred_time,birth_details," +
  "birth_details_consent,message,status,created_at";
const PUJA_REQUEST_COLUMNS = "id,name,phone,email,puja_id,preferred_date,message,status,created_at";
const MESSAGE_COLUMNS = "id,name,email,subject,message,status,created_at";

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

function paginate(c: any) {
  const q = c.req.query();
  const page = Math.max(1, Number(q.page ?? "1") || 1);
  const perPage = Math.min(100, Math.max(1, Number(q.per_page ?? "25") || 25));
  return { page, perPage, offset: (page - 1) * perPage };
}

adminInboxRoute.get("/admin/requests", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const type = c.req.query().type === "puja" ? "puja" : "consultation";
  const table = type === "puja" ? "puja_requests" : "consultation_requests";
  const columns = type === "puja" ? PUJA_REQUEST_COLUMNS : REQUEST_COLUMNS;
  const { page, perPage, offset } = paginate(c);
  const params = new URLSearchParams({
    select: columns,
    order: "created_at.desc",
    limit: String(perPage),
    offset: String(offset),
  });
  const status = c.req.query().status ?? "";
  if (REQUEST_STATUSES.includes(status)) params.set("status", `eq.${status}`);
  const listing = await restList(creds, `${table}?${params.toString()}`);
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Request listing failed" } }, 500);
  return c.json({
    data: { type, requests: listing.rows },
    meta: { page, per_page: perPage, total: listing.total },
  });
});

adminInboxRoute.patch("/admin/requests/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const body = (await c.req.json().catch(() => ({}))) as { type?: unknown; status?: unknown };
  const type = body.type === "puja" ? "puja" : "consultation";
  const table = type === "puja" ? "puja_requests" : "consultation_requests";
  if (typeof body.status !== "string" || !REQUEST_STATUSES.includes(body.status)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: `status must be one of: ${REQUEST_STATUSES.join(", ")}`,
        },
      },
      400,
    );
  }
  const res = await rest(creds, `${table}?id=eq.${encodeURIComponent(c.req.param("id"))}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: body.status }),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Request update failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Request not found" } }, 404);
  return c.json({ data: rows[0] });
});

adminInboxRoute.get("/admin/messages", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const { page, perPage, offset } = paginate(c);
  const params = new URLSearchParams({
    select: MESSAGE_COLUMNS,
    order: "created_at.desc",
    limit: String(perPage),
    offset: String(offset),
  });
  const status = c.req.query().status ?? "";
  if (MESSAGE_STATUSES.includes(status)) params.set("status", `eq.${status}`);
  const listing = await restList(creds, `contact_messages?${params.toString()}`);
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Message listing failed" } }, 500);
  return c.json({
    data: { messages: listing.rows },
    meta: { page, per_page: perPage, total: listing.total },
  });
});

adminInboxRoute.patch("/admin/messages/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown };
  if (typeof body.status !== "string" || !MESSAGE_STATUSES.includes(body.status)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: `status must be one of: ${MESSAGE_STATUSES.join(", ")}`,
        },
      },
      400,
    );
  }
  const res = await rest(creds, `contact_messages?id=eq.${encodeURIComponent(c.req.param("id"))}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: body.status }),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Message update failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Message not found" } }, 404);
  return c.json({ data: rows[0] });
});
