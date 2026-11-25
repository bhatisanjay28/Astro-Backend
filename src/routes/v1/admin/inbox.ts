/**
 * Admin Phase 2 — inbox workflow (story: _bmad-output/admin/stories/
 * phase-2-dashboard-inbox; design of record 03-winston-architecture §4).
 * Replaces the Epic 6.4 dead-end list (any-status dropdown, no verify gate).
 *
 * What this route enforces (owner-verbatim rules):
 *  - one-way status transitions via lib/inbox-flow.ts — closed/cancelled are
 *    terminal, nothing re-opens them;
 *  - close requires a prior verify stamp (409 "Verify this request before
 *    closing it.") — verification before closing, so no re-open is needed;
 *  - PII (phone/email/birth details) is masked for roles without
 *    inbox.read_pii. Enforcement lives HERE, not in RLS: the backend's
 *    service-role key bypasses RLS entirely, so this route is the gate that
 *    actually runs;
 *  - every full-PII detail read, verify, note and CSV export is audited.
 *
 * Live-bug fix (story review #6): puja_requests has NO preferred_date
 * column — its submitted date column is `date`, and it also carries
 * gotra/location/language which the old panel never surfaced. The previous
 * PUJA_REQUEST_COLUMNS selected preferred_date and 500'd `?type=puja` in
 * production. Both request tables are described by REQUEST_KINDS below.
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { type AdminContext, requireCapability } from "../../../lib/admin-auth";
import { diffBeforeAfter, writeAudit } from "../../../lib/audit";
import {
  assertMessageTransition,
  assertRequestTransition,
  MESSAGE_STATUS_LIST,
  REQUEST_STATUS_LIST,
  TransitionError,
} from "../../../lib/inbox-flow";
import { maskRequestRow } from "../../../lib/mask";
import { adminActionLimited } from "../../../lib/rate-limit";
import { rest, restList, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminInboxRoute = new Hono<Env>();

/** Workflow columns present on both request tables (migration 0015). */
const WORKFLOW_COLUMNS =
  "scheduled_for,assignee_id,is_test,archived_at,verified_at,verified_by,closed_reason,closed_at";

/** Per-table shape map — the single place that knows each table's columns. */
interface RequestKindSpec {
  table: string;
  kind: "consultation" | "puja";
  /** PostgREST select for list + detail reads */
  columns: string;
  /** the submitted preferred date (per-table: review #6) */
  dateColumn: string;
  /** which mask.ts fields apply to this table */
  mask: { phone?: string; email?: string; birth?: string; consent?: string };
}

const REQUEST_KINDS: Record<"consultation" | "puja", RequestKindSpec> = {
  consultation: {
    table: "consultation_requests",
    kind: "consultation",
    columns: `id,name,phone,email,topic,preferred_date,preferred_time,birth_details,birth_details_consent,message,status,created_at,${WORKFLOW_COLUMNS}`,
    dateColumn: "preferred_date",
    mask: {
      phone: "phone",
      email: "email",
      birth: "birth_details",
      consent: "birth_details_consent",
    },
  },
  puja: {
    table: "puja_requests",
    kind: "puja",
    columns: `id,name,phone,email,puja_id,gotra,date,location,language,message,status,created_at,${WORKFLOW_COLUMNS}`,
    dateColumn: "date",
    mask: { phone: "phone", email: "email" },
  },
};

const MESSAGE_COLUMNS = `id,name,email,subject,message,status,created_at,is_test,archived_at`;

function credsMissing(c: { json: (body: unknown, status?: number) => Response }) {
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

function badRequest(c: { json: (body: unknown, status?: number) => Response }, message: string) {
  return c.json({ error: { code: "validation_error", message } }, 400);
}

function paginate(q: Record<string, string>) {
  const page = Math.max(1, Number(q.page ?? "1") || 1);
  const perPage = Math.min(100, Math.max(1, Number(q.per_page ?? "25") || 25));
  return { page, perPage, offset: (page - 1) * perPage };
}

/** The caller's role decides masking; capabilities come from requireAdmin. */
function fullPii(admin: AdminContext): boolean {
  return admin.capabilities.includes("inbox.read_pii");
}

/** Free-text search token — strip characters that break PostgREST or() lists. */
function safeQuery(raw: string): string {
  return raw
    .replace(/[(),*\\]/g, " ")
    .trim()
    .slice(0, 80);
}

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function requestKindOf(type: unknown): "consultation" | "puja" {
  return type === "puja" ? "puja" : "consultation";
}

/* ---------------------------------------------------------------------------
 * Shared list-filter builder (GET list + CSV export must match exactly).
 * Test/archive semantics (story review #5):
 *   default        → is_test=false AND archived_at IS NULL
 *   include_test=1 → the is_test filter is dropped (flagged rows shown)
 *   is_test=true   → ONLY flagged rows (implies include)
 *   archived=true  → ONLY archived; archived=any → both; default → live only
 * ------------------------------------------------------------------------- */
function applyRequestFilters(
  params: URLSearchParams,
  kind: RequestKindSpec,
  q: Record<string, string>,
  canSeePii: boolean,
): { ok: true } | { ok: false; message: string } {
  const status = q.status ?? "";
  if (status) {
    if (!REQUEST_STATUS_LIST.includes(status as never)) {
      return { ok: false, message: `status must be one of: ${REQUEST_STATUS_LIST.join(", ")}` };
    }
    params.set("status", `eq.${status}`);
  }
  if (q.date_from || q.date_to) {
    if (q.date_from && !isIsoDate(q.date_from))
      return { ok: false, message: "date_from must be YYYY-MM-DD" };
    if (q.date_to && !isIsoDate(q.date_to))
      return { ok: false, message: "date_to must be YYYY-MM-DD" };
    if (q.date_from) params.set(kind.dateColumn, `gte.${q.date_from}`);
    if (q.date_to) params.append(kind.dateColumn, `lte.${q.date_to}`);
  }
  if (q.topic) {
    // consultation-only filter (review #8); ignored on the puja tab
    if (kind.kind === "consultation") params.set("topic", `eq.${safeQuery(q.topic)}`);
  }
  if (q.puja_id) {
    if (kind.kind === "puja") params.set("puja_id", `eq.${safeQuery(q.puja_id)}`);
  }
  if (q.older_than === "24h") {
    // SLA view: awaiting first action for more than a day (matches /admin/stats
    // older_24h). An explicit status filter wins when both are given.
    if (!status) params.set("status", "in.(new,contacted)");
    params.set("created_at", `lt.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`);
  }
  if (q.is_test === "true") {
    params.set("is_test", "eq.true");
  } else if (q.include_test !== "true") {
    params.set("is_test", "eq.false");
  }
  if (q.archived === "true") {
    params.set("archived_at", "not.is.null");
  } else if (q.archived !== "any") {
    params.set("archived_at", "is.null");
  }
  const search = safeQuery(q.q ?? "");
  if (search) {
    // Existence-oracle guard (review #7): phone/email search is limited to
    // inbox.read_pii holders — a masked role searching "98765" must not be
    // able to probe which phone numbers exist.
    if (canSeePii) {
      params.set("or", `(name.ilike.*${search}*,phone.ilike.*${search}*,email.ilike.*${search}*)`);
    } else {
      params.set("name", `ilike.*${search}*`);
    }
  }
  return { ok: true };
}

/* ----------------------------- list ------------------------------------- */

adminInboxRoute.get("/admin/requests", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  const q = c.req.query();
  const kind = REQUEST_KINDS[requestKindOf(q.type)];
  const { page, perPage, offset } = paginate(q);
  const params = new URLSearchParams({
    select: kind.columns,
    order: "created_at.desc",
    limit: String(perPage),
    offset: String(offset),
  });
  const filters = applyRequestFilters(params, kind, q, fullPii(admin));
  if (!filters.ok) return badRequest(c, filters.message);
  const listing = await restList(creds, `${kind.table}?${params.toString()}`);
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Request listing failed" } }, 500);
  const pii = fullPii(admin);
  return c.json({
    data: {
      type: kind.kind,
      requests: listing.rows.map((r) => maskRequestRow(r, pii, kind.mask)),
    },
    meta: { page, per_page: perPage, total: listing.total },
  });
});

/* --------------------- static paths BEFORE :id --------------------------- */

/** Staff directory for the drawer's assignee select. booking_manager assigns
 * requests but holds no users.manage, so the panel needs an inbox-scoped read
 * of active staff (names + emails only). */
adminInboxRoute.get("/admin/requests/assignees", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const listing = await restList(
    creds,
    "admin_users?select=user_id,display_name,email,role&is_active=eq.true&order=display_name.asc",
  );
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Staff listing failed" } }, 500);
  return c.json({ data: listing.rows });
});

// The subtree GET gate is inbox.read — but the export carries FULL PII for
// every role, so it needs its own stricter capability (inbox.export is held
// by booking_manager/admin/super_admin only; viewer reads masked lists).
adminInboxRoute.get("/admin/requests/export.csv", requireCapability("inbox.export"), async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  if (adminActionLimited("admin:export", admin.userId, c.env)) {
    return c.json(
      {
        error: {
          code: "rate_limited",
          message: "Export limit reached (5 per minute). Try again shortly.",
        },
      },
      429,
    );
  }
  const q = c.req.query();
  const kind = REQUEST_KINDS[requestKindOf(q.type)];
  // Export ignores pagination and carries FULL PII for every role — the
  // export action itself is the PII grant, and it is audited below.
  const EXPORT_CAP = 10000;
  const params = new URLSearchParams({
    select: kind.columns,
    order: "created_at.desc",
    limit: String(EXPORT_CAP),
  });
  const filters = applyRequestFilters(params, kind, q, true);
  if (!filters.ok) return badRequest(c, filters.message);
  const listing = await restList(creds, `${kind.table}?${params.toString()}`);
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Export failed" } }, 500);
  // Hitting the cap exactly means PostgREST stopped at it — the export is
  // likely truncated, so flag it instead of failing silently (review P3).
  const capped = listing.rows.length >= EXPORT_CAP;

  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = Object.keys(listing.rows[0] ?? { id: "" });
  const lines = [header.join(",")];
  for (const row of listing.rows) {
    lines.push(header.map((h) => cell(row[h])).join(","));
  }

  await writeAudit(creds, {
    actor: admin.userId,
    action: `${kind.table}.export`,
    entity: kind.table,
    details: { type: kind.kind, count: listing.rows.length, capped, filters: q },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind.kind}-requests-${stamp}.csv"`,
      ...(capped ? { "X-Export-Capped": "true" } : {}),
    },
  });
});

/* --------------------------- detail + workflow ---------------------------- */

function notesPath(kind: string, id: string): string {
  return (
    `request_notes?request_kind=eq.${kind}&request_id=eq.${encodeURIComponent(id)}` +
    `&select=id,body,created_at,author_id,author:admin_users(display_name)&order=created_at.asc`
  );
}

adminInboxRoute.get("/admin/requests/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  const kind = REQUEST_KINDS[requestKindOf(c.req.query("type"))];
  const id = c.req.param("id");
  const listing = await restList(
    creds,
    `${kind.table}?id=eq.${encodeURIComponent(id)}&select=${kind.columns}`,
  );
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Request lookup failed" } }, 500);
  const row = listing.rows[0];
  if (!row) return c.json({ error: { code: "not_found", message: "Request not found" } }, 404);

  const notes = await restList(creds, notesPath(kind.kind, id));
  const noteRows = notes.ok ? notes.rows : [];

  const pii = fullPii(admin);
  const hasRawPii = pii && Boolean(row.phone || row.email || row.birth_details);
  if (hasRawPii) {
    // Every unmasked detail read is on the trail (story review #4).
    await writeAudit(creds, {
      actor: admin.userId,
      action: `${kind.table}.read_pii`,
      entity: kind.table,
      entity_id: id,
      details: { type: kind.kind },
    });
  }
  return c.json({
    data: { type: kind.kind, request: maskRequestRow(row, pii, kind.mask), notes: noteRows },
  });
});

adminInboxRoute.patch("/admin/requests/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: unknown;
    status?: unknown;
    scheduled_for?: unknown;
    assignee_id?: unknown;
    archived?: unknown;
    is_test?: unknown;
    closed_reason?: unknown;
  };
  const kind = REQUEST_KINDS[requestKindOf(body.type)];

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !REQUEST_STATUS_LIST.includes(body.status as never)) {
      return badRequest(c, `status must be one of: ${REQUEST_STATUS_LIST.join(", ")}`);
    }
  }
  if (
    body.scheduled_for !== undefined &&
    body.scheduled_for !== null &&
    (typeof body.scheduled_for !== "string" || Number.isNaN(Date.parse(body.scheduled_for)))
  ) {
    return badRequest(c, "scheduled_for must be an ISO datetime or null.");
  }
  if (
    body.assignee_id !== undefined &&
    body.assignee_id !== null &&
    !(typeof body.assignee_id === "string" && body.assignee_id.length <= 64)
  ) {
    return badRequest(c, "assignee_id must be a staff user id or null.");
  }
  if (
    body.closed_reason !== undefined &&
    body.closed_reason !== null &&
    (typeof body.closed_reason !== "string" || body.closed_reason.length > 500)
  ) {
    return badRequest(c, "closed_reason must be at most 500 characters.");
  }

  // Current row: the transition map needs status + verified_at; the audit
  // diff needs the pre-change values of everything this PATCH can touch.
  const currentRes = await restList(
    creds,
    `${kind.table}?id=eq.${encodeURIComponent(id)}&select=id,status,verified_at,scheduled_for,assignee_id,is_test,archived_at,closed_at`,
  );
  if (!currentRes.ok)
    return c.json({ error: { code: "internal_error", message: "Request lookup failed" } }, 500);
  const current = currentRes.rows[0];
  if (!current) return c.json({ error: { code: "not_found", message: "Request not found" } }, 404);

  const terminal = current.status === "closed" || current.status === "cancelled";
  if ((body.scheduled_for !== undefined || body.assignee_id !== undefined) && terminal) {
    return c.json(
      {
        error: {
          code: "invalid_transition",
          message: `A ${current.status} request can no longer be scheduled or reassigned.`,
        },
      },
      409,
    );
  }
  // A schedule timestamp only makes sense on a scheduled request — a bare
  // scheduled_for on new/contacted would leave the row carrying a date its
  // status contradicts (pre-commit review P3). Scheduling together with the
  // status move (PATCH {status:"scheduled", scheduled_for:…}) stays allowed;
  // clearing a date (null) is a reschedule concern and stays allowed too.
  if (body.scheduled_for !== undefined && body.scheduled_for !== null) {
    const resulting = typeof body.status === "string" ? body.status : current.status;
    if (resulting !== "scheduled") {
      return badRequest(
        c,
        'scheduled_for requires status "scheduled" — send both fields together.',
      );
    }
  }
  if (typeof body.status === "string" && body.status !== current.status) {
    try {
      assertRequestTransition(String(current.status), body.status, current.verified_at !== null);
    } catch (err) {
      if (err instanceof TransitionError) {
        return c.json({ error: { code: err.code, message: err.message } }, 409);
      }
      throw err;
    }
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.status === "string") patch.status = body.status;
  if (body.scheduled_for !== undefined) {
    patch.scheduled_for =
      body.scheduled_for === null ? null : new Date(String(body.scheduled_for)).toISOString();
  }
  if (body.assignee_id !== undefined) patch.assignee_id = body.assignee_id;
  if (typeof body.archived === "boolean") {
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if (typeof body.is_test === "boolean") patch.is_test = body.is_test;
  if (body.closed_reason !== undefined) {
    patch.closed_reason =
      body.closed_reason === null ? null : String(body.closed_reason).slice(0, 500);
  }
  if (body.status === "closed" && current.status !== "closed") {
    patch.closed_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return badRequest(c, "Nothing to update — send at least one changeable field.");
  }

  const res = await rest(creds, `${kind.table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Request update failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Request not found" } }, 404);

  await writeAudit(creds, {
    actor: admin.userId,
    action: `${kind.table}.update`,
    entity: kind.table,
    entity_id: id,
    details: {
      type: kind.kind,
      changes: diffBeforeAfter(current, patch),
    },
  });
  const pii = fullPii(admin);
  return c.json({
    data: { request: maskRequestRow(rows[0] as Record<string, unknown>, pii, kind.mask) },
  });
});

/** Stamp verified_at/verified_by. Idempotent: re-verify returns the existing
 * stamp (already_verified) without writing a second audit row. */
adminInboxRoute.post("/admin/requests/:id/verify", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { type?: unknown };
  const kind = REQUEST_KINDS[requestKindOf(body.type)];

  const currentRes = await restList(
    creds,
    `${kind.table}?id=eq.${encodeURIComponent(id)}&select=id,verified_at,verified_by`,
  );
  if (!currentRes.ok)
    return c.json({ error: { code: "internal_error", message: "Request lookup failed" } }, 500);
  const current = currentRes.rows[0];
  if (!current) return c.json({ error: { code: "not_found", message: "Request not found" } }, 404);
  if (current.verified_at) {
    return c.json({
      data: {
        id,
        verified_at: current.verified_at,
        verified_by: current.verified_by,
        already_verified: true,
      },
    });
  }

  const now = new Date().toISOString();
  const res = await rest(creds, `${kind.table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ verified_at: now, verified_by: admin.userId }),
  });
  if (!res.ok) return c.json({ error: { code: "internal_error", message: "Verify failed" } }, 500);
  const rows = (await res.json()) as Array<{ verified_at: string; verified_by: string }>;
  await writeAudit(creds, {
    actor: admin.userId,
    action: `${kind.table}.verify`,
    entity: kind.table,
    entity_id: id,
    details: { type: kind.kind },
  });
  return c.json({
    data: {
      id,
      verified_at: rows[0]?.verified_at ?? now,
      verified_by: rows[0]?.verified_by ?? admin.userId,
      already_verified: false,
    },
  });
});

/** Append an internal note (multi-note history, never a mutable column). */
adminInboxRoute.post("/admin/requests/:id/notes", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { type?: unknown; body?: unknown };
  const kind = REQUEST_KINDS[requestKindOf(body.type)];
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text.length < 1 || text.length > 2000) {
    return badRequest(c, "A note must be between 1 and 2000 characters.");
  }

  const exists = await restList(creds, `${kind.table}?id=eq.${encodeURIComponent(id)}&select=id`);
  if (!exists.ok || exists.rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Request not found" } }, 404);

  const res = await rest(creds, "request_notes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      request_kind: kind.kind,
      request_id: id,
      author_id: admin.userId,
      body: text,
    }),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Could not save the note." } }, 500);
  const note = ((await res.json()) as Array<Record<string, unknown>>)[0];
  await writeAudit(creds, {
    actor: admin.userId,
    action: "request_notes.create",
    entity: "request_notes",
    entity_id: note ? String(note.id) : null,
    details: { request_kind: kind.kind, request_id: id },
  });
  return c.json({ data: note }, 201);
});

/* ------------------------------- messages -------------------------------- */

adminInboxRoute.get("/admin/messages", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  const q = c.req.query();
  const { page, perPage, offset } = paginate(q);
  const params = new URLSearchParams({
    select: MESSAGE_COLUMNS,
    order: "created_at.desc",
    limit: String(perPage),
    offset: String(offset),
  });
  const status = q.status ?? "";
  if (status) {
    if (!MESSAGE_STATUS_LIST.includes(status as never)) {
      return badRequest(c, `status must be one of: ${MESSAGE_STATUS_LIST.join(", ")}`);
    }
    params.set("status", `eq.${status}`);
  }
  if (q.is_test === "true") params.set("is_test", "eq.true");
  else if (q.include_test !== "true") params.set("is_test", "eq.false");
  if (q.archived === "true") params.set("archived_at", "not.is.null");
  else if (q.archived !== "any") params.set("archived_at", "is.null");
  const search = safeQuery(q.q ?? "");
  if (search) {
    // Same existence-oracle rule as requests (review #7): email search
    // requires inbox.read_pii; masked roles search names only.
    if (fullPii(admin)) {
      params.set("or", `(name.ilike.*${search}*,email.ilike.*${search}*)`);
    } else {
      params.set("name", `ilike.*${search}*`);
    }
  }
  const listing = await restList(creds, `contact_messages?${params.toString()}`);
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Message listing failed" } }, 500);
  const pii = fullPii(admin);
  return c.json({
    data: {
      messages: listing.rows.map((r) => maskRequestRow(r, pii, { email: "email" })),
    },
    meta: { page, per_page: perPage, total: listing.total },
  });
});

adminInboxRoute.get("/admin/messages/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  const id = c.req.param("id");
  const listing = await restList(
    creds,
    `contact_messages?id=eq.${encodeURIComponent(id)}&select=${MESSAGE_COLUMNS}`,
  );
  if (!listing.ok)
    return c.json({ error: { code: "internal_error", message: "Message lookup failed" } }, 500);
  const row = listing.rows[0];
  if (!row) return c.json({ error: { code: "not_found", message: "Message not found" } }, 404);
  const notes = await restList(creds, notesPath("message", id));

  const pii = fullPii(admin);
  if (pii && row.email) {
    await writeAudit(creds, {
      actor: admin.userId,
      action: "contact_messages.read_pii",
      entity: "contact_messages",
      entity_id: id,
    });
  }
  return c.json({
    data: {
      message: maskRequestRow(row, pii, { email: "email" }),
      notes: notes.ok ? notes.rows : [],
    },
  });
});

adminInboxRoute.patch("/admin/messages/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return credsMissing(c);
  const admin = c.get("admin") as AdminContext;
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    status?: unknown;
    archived?: unknown;
    is_test?: unknown;
  };
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !MESSAGE_STATUS_LIST.includes(body.status as never)) {
      return badRequest(c, `status must be one of: ${MESSAGE_STATUS_LIST.join(", ")}`);
    }
  }

  const currentRes = await restList(
    creds,
    `contact_messages?id=eq.${encodeURIComponent(id)}&select=id,status,is_test,archived_at`,
  );
  if (!currentRes.ok)
    return c.json({ error: { code: "internal_error", message: "Message lookup failed" } }, 500);
  const current = currentRes.rows[0];
  if (!current) return c.json({ error: { code: "not_found", message: "Message not found" } }, 404);

  if (typeof body.status === "string" && body.status !== current.status) {
    try {
      assertMessageTransition(String(current.status), body.status);
    } catch (err) {
      if (err instanceof TransitionError) {
        return c.json({ error: { code: err.code, message: err.message } }, 409);
      }
      throw err;
    }
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.status === "string") patch.status = body.status;
  if (typeof body.archived === "boolean") {
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if (typeof body.is_test === "boolean") patch.is_test = body.is_test;
  if (Object.keys(patch).length === 0) {
    return badRequest(c, "Nothing to update — send at least one changeable field.");
  }

  const res = await rest(creds, `contact_messages?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    return c.json({ error: { code: "internal_error", message: "Message update failed" } }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0)
    return c.json({ error: { code: "not_found", message: "Message not found" } }, 404);

  await writeAudit(creds, {
    actor: admin.userId,
    action: "contact_messages.update",
    entity: "contact_messages",
    entity_id: id,
    details: { changes: diffBeforeAfter(current, patch) },
  });
  const pii = fullPii(admin);
  return c.json({
    data: { message: maskRequestRow(rows[0] as Record<string, unknown>, pii, { email: "email" }) },
  });
});
