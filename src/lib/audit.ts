/**
 * Admin Phase 1 — audit trail writer (03-winston-architecture.md §5).
 *
 * The audit_log table (migration 0001) existed with zero writers until now.
 * Every admin mutation, login and export records: who (actor uuid), what
 * (action), on which entity (+id), and a compact diff/details payload.
 *
 * Best-effort by design: a failed audit write must never fail (or roll back)
 * the user's operation — it is logged server-side instead. The trade-off is
 * accepted because the underlying operation is already committed when we
 * audit, and the trail is reconstructed from console logs on the rare miss.
 */
import type { SupabaseCreds } from "./supabase";

export type AuditEntry = {
  /** admin_users.user_id of the acting admin; null for system/anonymous */
  actor: string | null;
  /** dotted action, e.g. "posts.update", "auth.login", "newsletter.export" */
  action: string;
  /** entity family, e.g. "blog_posts", "admin_users", "auth" */
  entity: string;
  entity_id?: string | null;
  /** compact payload: field-level before/after, filters, counts — never secrets */
  details?: Record<string, unknown>;
};

export async function writeAudit(creds: SupabaseCreds, entry: AuditEntry): Promise<void> {
  try {
    const res = await fetch(`${creds.url}/rest/v1/audit_log`, {
      method: "POST",
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entity_id ?? null,
        details: entry.details ?? null,
      }),
    });
    if (!res.ok) {
      console.error(`[audit] write failed (${res.status}) for ${entry.action} ${entry.entity}`);
    }
  } catch (err) {
    console.error(`[audit] write error for ${entry.action} ${entry.entity}:`, err);
  }
}

/** Extract a small before/after map from two row-ish objects (top level only). */
export function diffBeforeAfter(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    const prev = before ? before[key] : undefined;
    if (JSON.stringify(prev) !== JSON.stringify(value)) {
      out[key] = { from: prev ?? null, to: value };
    }
  }
  return out;
}
