/**
 * Admin Phase 1 — user & role management (02-mary-gap-analysis §C: users.manage
 * = super_admin only; Epic 6.4 promised this and never shipped).
 *
 * GET   /admin/users          — list admin accounts (merged auth + role row)
 * POST  /admin/users          — direct create (Phase 5): server-generated one-time
 *                               temp password, must_change_password until first login
 * POST  /admin/users/invite   — Supabase invite email + admin_users row
 * PATCH /admin/users/:id      — role change / activate-deactivate / display name /
 *                               email change (auth identity first, then the row)
 *
 * Guards: all routes require users.manage; an admin cannot demote,
 * deactivate or re-email themselves (single-super-admin lockout guard —
 * self may only change display_name).
 * Deactivation bans the Supabase auth user AND flips admin_users.is_active
 * (requireAdmin then rejects any token the account still holds).
 * Every change is audited with before → after.
 */

import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import type { AdminContext } from "../../../lib/admin-auth";
import { diffBeforeAfter, writeAudit } from "../../../lib/audit";
import { ADMIN_ROLES, type AdminRole } from "../../../lib/rbac";
import { rest, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminUsersRoute = new Hono<Env>();

function forbidden(c: Context<Env>, message: string) {
  return c.json({ error: { code: "forbidden", message } }, 403);
}

function missingCreds(c: Context<Env>) {
  return c.json(
    {
      error: {
        code: "service_unavailable",
        message: "User management requires backend credentials.",
      },
    },
    503,
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One-time temp password for direct-created accounts (Phase 5): 14 chars
 * from an unambiguous alphabet (no 0/O/1/l/I), digit+letter guaranteed by
 * construction fix-ups. Generated server-side ONLY — never accepted from a
 * request body, never stored, logged or audited. The panel shows it once;
 * POST /auth/change-password replaces it at first login.
 */
function generateTempPassword(): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  if (!/[0-9]/.test(out)) out = `7${out.slice(1)}`;
  if (!/[A-Za-z]/.test(out)) out = `K${out.slice(1)}`;
  return out;
}

adminUsersRoute.get("/admin/users", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return missingCreds(c);

  // Role rows are the source of truth for panel access; auth users add
  // last sign-in. Two small calls (the panel has a handful of admins).
  const [rolesRes, authRes] = await Promise.all([
    rest(
      creds,
      "admin_users?select=user_id,email,role,is_active,display_name,must_change_password,created_at&order=created_at.asc",
    ),
    fetch(`${creds.url}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}` },
    }),
  ]);
  if (!rolesRes.ok) {
    return c.json(
      { error: { code: "internal_error", message: "Could not load admin users." } },
      500,
    );
  }
  const roles = (await rolesRes.json()) as Array<Record<string, unknown>>;
  let lastSignIn: Record<string, string | null> = {};
  if (authRes.ok) {
    const body = (await authRes.json().catch(() => ({ users: [] }))) as {
      users?: Array<{ id: string; last_sign_in_at?: string | null }>;
    };
    lastSignIn = Object.fromEntries(
      (body.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]),
    );
  }
  return c.json({
    data: roles.map((r) => ({
      ...r,
      last_sign_in_at: lastSignIn[String(r.user_id)] ?? null,
    })),
  });
});

/**
 * Phase 5 — direct creation: the Super Admin creates the account + assigns a
 * role right in the panel, no invite email (SMTP-independent). The one-time
 * temp password is generated here and returned exactly once; the account is
 * flagged must_change_password so requireAdmin blocks every /admin/* route
 * until POST /auth/change-password succeeds (enforced server-side, not
 * hide-buttons-only). Password hashing/storage is Supabase Auth's — this
 * proxy never sees the hash.
 */
adminUsersRoute.post("/admin/users", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return missingCreds(c);
  const admin = c.get("admin") as AdminContext;

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: unknown;
    role?: unknown;
    display_name?: unknown;
  };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body.role === "string" ? body.role : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (!email || !EMAIL_RE.test(email)) {
    return c.json(
      { error: { code: "validation_error", message: "A valid email is required." } },
      400,
    );
  }
  if (!ADMIN_ROLES.includes(role as AdminRole)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: `role must be one of: ${ADMIN_ROLES.join(", ")}`,
        },
      },
      400,
    );
  }

  const dupRes = await rest(
    creds,
    `admin_users?email=eq.${encodeURIComponent(email)}&select=user_id`,
  );
  if (dupRes.ok && ((await dupRes.json()) as unknown[]).length > 0) {
    return c.json(
      { error: { code: "conflict", message: "That email already has an admin account." } },
      409,
    );
  }

  const tempPassword = generateTempPassword();
  const createRes = await fetch(`${creds.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      "Content-Type": "application/json",
    },
    // email_confirm skips any confirmation email — the temp password is the
    // credential, shared out-of-band by the Super Admin.
    body: JSON.stringify({ email, password: tempPassword, email_confirm: true }),
  });
  if (!createRes.ok) {
    if (createRes.status === 422) {
      // Supabase: "already been registered" — an auth account exists without
      // an admin row (e.g. an old invited-but-never-completed account).
      return c.json(
        { error: { code: "conflict", message: "That email already has an account." } },
        409,
      );
    }
    console.error(`users.create: auth create failed (${createRes.status})`);
    return c.json(
      {
        error: {
          code: "upstream_error",
          message: "Supabase could not create the account. Try again.",
        },
      },
      502,
    );
  }
  const created = (await createRes.json().catch(() => ({}))) as { id?: string };
  const userId = created.id;
  if (!userId) {
    return c.json(
      { error: { code: "upstream_error", message: "Account creation did not return a user id." } },
      502,
    );
  }

  const insertRes = await rest(creds, "admin_users", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      email,
      role,
      display_name: displayName || null,
      is_active: true,
      must_change_password: true,
    }),
  });
  if (!insertRes.ok) {
    return c.json(
      { error: { code: "internal_error", message: "Could not create the admin_users row." } },
      500,
    );
  }

  // Audit records identity + role only — never any password material.
  await writeAudit(creds, {
    actor: admin.userId,
    action: "users.create",
    entity: "admin_users",
    entity_id: userId,
    details: { email, role, display_name: displayName || null, created_via: "direct" },
  });
  return c.json(
    {
      data: {
        user_id: userId,
        email,
        role,
        is_active: true,
        must_change_password: true,
        temporary_password: tempPassword,
      },
    },
    201,
  );
});

adminUsersRoute.post("/admin/users/invite", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return missingCreds(c);
  const admin = c.get("admin") as AdminContext;

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: unknown;
    role?: unknown;
    display_name?: unknown;
  };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body.role === "string" ? body.role : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (!email || !EMAIL_RE.test(email)) {
    return c.json(
      { error: { code: "validation_error", message: "A valid email is required." } },
      400,
    );
  }
  if (!ADMIN_ROLES.includes(role as AdminRole)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: `role must be one of: ${ADMIN_ROLES.join(", ")}`,
        },
      },
      400,
    );
  }

  const dupRes = await rest(
    creds,
    `admin_users?email=eq.${encodeURIComponent(email)}&select=user_id`,
  );
  if (dupRes.ok && ((await dupRes.json()) as unknown[]).length > 0) {
    return c.json(
      { error: { code: "conflict", message: "That email already has an admin account." } },
      409,
    );
  }

  // Supabase sends the invite email (accept link lets them set a password).
  // Requires project SMTP to be configured (Supabase built-in works at low volume).
  const inviteRes = await fetch(`${creds.url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "invite", email }),
  });
  if (!inviteRes.ok) {
    return c.json(
      {
        error: {
          code: "upstream_error",
          message:
            "Supabase could not send the invite email. Check the project's Auth SMTP settings, then retry.",
        },
      },
      502,
    );
  }
  const invited = (await inviteRes.json()) as { user?: { id?: string } };
  const userId = invited.user?.id;
  if (!userId) {
    return c.json(
      { error: { code: "upstream_error", message: "Invite did not return a user id." } },
      502,
    );
  }

  const insertRes = await rest(creds, "admin_users", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      email,
      role,
      display_name: displayName || null,
      is_active: true,
    }),
  });
  if (!insertRes.ok) {
    return c.json(
      { error: { code: "internal_error", message: "Could not create the admin_users row." } },
      500,
    );
  }

  await writeAudit(creds, {
    actor: admin.userId,
    action: "users.invite",
    entity: "admin_users",
    entity_id: userId,
    details: { email, role, display_name: displayName || null },
  });
  return c.json({ data: { user_id: userId, email, role, is_active: true } }, 201);
});

adminUsersRoute.patch("/admin/users/:id", async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) return missingCreds(c);
  const admin = c.get("admin") as AdminContext;
  const targetId = c.req.param("id");

  const body = (await c.req.json().catch(() => ({}))) as {
    role?: unknown;
    is_active?: unknown;
    display_name?: unknown;
    email?: unknown;
  };

  // Self-lockout: an admin may only rename themselves — role, is_active and
  // email are identity-level changes (A1 review: email too, not just role).
  if (
    targetId === admin.userId &&
    (body.role !== undefined || body.is_active === false || body.email !== undefined)
  ) {
    return forbidden(
      c,
      "You cannot change your own role, deactivate or re-email your own account.",
    );
  }
  if (body.role !== undefined && !ADMIN_ROLES.includes(body.role as AdminRole)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: `role must be one of: ${ADMIN_ROLES.join(", ")}`,
        },
      },
      400,
    );
  }
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") {
    return c.json(
      { error: { code: "validation_error", message: "is_active must be a boolean." } },
      400,
    );
  }
  const newEmail =
    body.email !== undefined && typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : undefined;
  if (body.email !== undefined && (!newEmail || !EMAIL_RE.test(newEmail))) {
    return c.json(
      { error: { code: "validation_error", message: "A valid email is required." } },
      400,
    );
  }

  const beforeRes = await rest(
    creds,
    `admin_users?user_id=eq.${encodeURIComponent(targetId)}&select=user_id,email,role,is_active,display_name`,
  );
  if (!beforeRes.ok) {
    return c.json({ error: { code: "internal_error", message: "Lookup failed." } }, 500);
  }
  const before = ((await beforeRes.json()) as Array<Record<string, unknown>>)[0];
  if (!before) {
    return c.json({ error: { code: "not_found", message: "No such admin user." } }, 404);
  }

  // Email dup-check excludes the target itself (re-saving the same address
  // must not self-conflict).
  if (newEmail !== undefined && newEmail !== String(before.email).toLowerCase()) {
    const emailDupRes = await rest(
      creds,
      `admin_users?email=eq.${encodeURIComponent(newEmail)}&user_id=neq.${encodeURIComponent(targetId)}&select=user_id`,
    );
    if (emailDupRes.ok && ((await emailDupRes.json()) as unknown[]).length > 0) {
      return c.json(
        { error: { code: "conflict", message: "That email already has an admin account." } },
        409,
      );
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.role !== undefined) patch.role = body.role;
  if (body.is_active !== undefined) patch.is_active = body.is_active;
  if (body.display_name !== undefined)
    patch.display_name = String(body.display_name).trim() || null;

  // Email: the AUTH identity moves first (W4 — no half-state where the row
  // claims an address the login identity doesn't have). email_confirm skips
  // any confirmation email; the change is admin-asserted.
  let emailSyncedToAuth = false;
  if (newEmail !== undefined && newEmail !== String(before.email).toLowerCase()) {
    const authEmailRes = await fetch(
      `${creds.url}/auth/v1/admin/users/${encodeURIComponent(targetId)}`,
      {
        method: "PUT",
        headers: {
          apikey: creds.key,
          Authorization: `Bearer ${creds.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: newEmail, email_confirm: true }),
      },
    );
    if (!authEmailRes.ok) {
      console.error(
        `users.update: auth email change failed for ${targetId} (status=${authEmailRes.status})`,
      );
      return c.json(
        {
          error: {
            code: "upstream_error",
            message: "Supabase rejected the email change — nothing was modified.",
          },
        },
        502,
      );
    }
    emailSyncedToAuth = true;
    patch.email = newEmail;
  }

  const patchRes = await rest(creds, `admin_users?user_id=eq.${encodeURIComponent(targetId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) {
    // A1 — the auth identity may already carry the new email; say so instead
    // of a generic failure so the admin knows a retry completes the row sync.
    return c.json(
      {
        error: {
          code: "internal_error",
          message: emailSyncedToAuth
            ? "The auth email was updated but the admin row sync failed — retry the same PATCH."
            : "Could not update the admin user.",
        },
      },
      500,
    );
  }

  // Keep the auth account in step: deactivate ⇒ ban (kills sessions +
  // blocks sign-in); reactivate ⇒ lift the ban. A failed ban must be
  // observable (QA phase-1 finding 1): the panel row would say "deactivated"
  // while the auth identity can still sign in — log it loudly and record it
  // in the audit row instead of swallowing the error.
  let banSynced = true;
  if (body.is_active !== undefined) {
    const banRes = await fetch(`${creds.url}/auth/v1/admin/users/${encodeURIComponent(targetId)}`, {
      method: "PUT",
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ban_duration: body.is_active ? "none" : "876000h" }),
    });
    if (!banRes.ok) {
      banSynced = false;
      console.error(
        `users.update: auth ban sync failed for ${targetId} (is_active=${body.is_active}, status=${banRes.status})`,
      );
    }
  }

  const changes = diffBeforeAfter(
    before,
    // updated_at is write bookkeeping, not a change — keep audit diffs clean
    // (QA phase-1 finding 7).
    Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "updated_at")),
  );
  await writeAudit(creds, {
    actor: admin.userId,
    action: "users.update",
    entity: "admin_users",
    entity_id: targetId,
    details: {
      email: before.email,
      changes,
      ...(body.is_active !== undefined ? { auth_ban_synced: banSynced } : {}),
    },
  });

  const afterRes = await rest(
    creds,
    `admin_users?user_id=eq.${encodeURIComponent(targetId)}&select=user_id,email,role,is_active,display_name`,
  );
  const after = afterRes.ok ? ((await afterRes.json()) as Array<Record<string, unknown>>)[0] : null;
  return c.json({ data: after ?? null });
});
