/**
 * Epic 6.4 — Auth proxy (D4: Supabase Auth is administered through backend
 * endpoints; the frontend never holds Supabase keys). The admin UI logs in
 * here; the returned Supabase access token is then presented to /admin/*,
 * where requireAdmin checks identity + role (Epic 6.1).
 *
 * Admin Phase 1: login success/failure and logout are written to the audit
 * trail; POST /auth/logout revokes the session server-side (the old panel
 * only dropped the client-side token, leaving the session live).
 *
 * Only the fields the UI needs leave the proxy — no Supabase envelope leakage.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { decodeJwtPayload } from "../../lib/admin-auth";
import { writeAudit } from "../../lib/audit";
import { rest } from "../../lib/supabase";
import { captchaRequired, verifyTurnstile } from "../../lib/turnstile";

type Env = AppEnv;

export const authRoute = new Hono<Env>();

interface SupabaseAuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
  msg?: string;
  error_description?: string;
  error_code?: string;
}

function creds(c: { env?: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string } }) {
  const url = c.env?.SUPABASE_URL;
  const key = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function grant(url: string, key: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(
    `${url}/auth/v1/token?grant_type=${body.refresh_token ? "refresh_token" : "password"}`,
    {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

authRoute.post("/auth/login", async (c) => {
  const creds0 = creds(c);
  if (!creds0) {
    return c.json(
      { error: { code: "service_unavailable", message: "Auth requires backend credentials." } },
      503,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: unknown;
    password?: unknown;
    turnstile_token?: unknown;
  };
  if (
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    !body.email ||
    !body.password
  ) {
    return c.json(
      { error: { code: "validation_error", message: "email and password are required" } },
      400,
    );
  }
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (!(await verifyTurnstile(body.turnstile_token, ip, c.env?.TURNSTILE_SECRET_KEY))) {
    return c.json(captchaRequired(), 400);
  }
  const res = await grant(creds0.url, creds0.key, { email: body.email, password: body.password });
  const data = (await res.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!res.ok || !data.access_token) {
    await writeAudit(creds0, {
      actor: null,
      action: "auth.login_failed",
      entity: "auth",
      details: { email: body.email },
    });
    return c.json(
      { error: { code: "invalid_credentials", message: "Invalid email or password" } },
      401,
    );
  }
  await writeAudit(creds0, {
    actor: data.user?.id ?? null,
    action: "auth.login",
    entity: "auth",
    entity_id: data.user?.id ?? null,
    details: { email: body.email },
  });
  return c.json({
    data: {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_in: data.expires_in ?? 3600,
      user: { id: data.user?.id ?? null, email: data.user?.email ?? body.email },
    },
  });
});

/**
 * Logout proxy: revokes the Supabase session (refresh tokens) server-side.
 * Body: { access_token } — the token to revoke. Idempotent: an already
 * expired token still answers ok so the UI can always sign out.
 */
authRoute.post("/auth/logout", async (c) => {
  const creds0 = creds(c);
  if (!creds0) {
    return c.json(
      { error: { code: "service_unavailable", message: "Auth requires backend credentials." } },
      503,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as { access_token?: unknown };
  const token = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!token) {
    return c.json(
      { error: { code: "validation_error", message: "access_token is required" } },
      400,
    );
  }
  const res = await fetch(`${creds0.url}/auth/v1/logout?scope=global`, {
    method: "POST",
    headers: { apikey: creds0.key, Authorization: `Bearer ${token}` },
  });
  if (res.ok || res.status === 401) {
    // 401 = token already invalid — signing out an expired session is fine.
    // Audit ONLY when Supabase validated the token: decoding the sub of an
    // *unverified* token would let anyone fabricate audit rows attributed to
    // any admin (pre-commit review P1 — audit-trail poisoning).
    if (res.ok) {
      const claims = decodeJwtPayload(token) as { sub?: unknown } | null;
      const actor = typeof claims?.sub === "string" ? claims.sub : null;
      await writeAudit(creds0, {
        actor,
        action: "auth.logout",
        entity: "auth",
        entity_id: actor,
      });
    }
    return c.json({ data: { ok: true } });
  }
  return c.json(
    { error: { code: "upstream_error", message: "Sign-out failed — try again." } },
    502,
  );
});

/**
 * Phase 5 — first-login password set (self-service). A direct-created admin
 * account signs in with its one-time temp password, is 403'd on /admin/*
 * (password_change_required) and lands on /admin/first-login, which calls
 * this route. OUTSIDE requireAdmin on purpose — the reset must stay reachable
 * while the flag is set; the caller's own bearer is the credential.
 *
 * The password hash is computed and stored by Supabase Auth (PUT /auth/v1/user
 * with the user's own token — which also validates that token); this proxy
 * never sees password material beyond the request body it forwards.
 * Body: { new_password } — ≥12 chars incl. a letter and a digit.
 */
authRoute.post("/auth/change-password", async (c) => {
  const creds0 = creds(c);
  if (!creds0) {
    return c.json(
      { error: { code: "service_unavailable", message: "Auth requires backend credentials." } },
      503,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as { new_password?: unknown };
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  if (newPassword.length < 12 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "new_password must be at least 12 characters and include a letter and a digit.",
        },
      },
      400,
    );
  }
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return c.json(
      {
        error: { code: "unauthorized", message: "Authentication required: supply a Bearer token." },
      },
      401,
    );
  }

  const res = await fetch(`${creds0.url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: creds0.key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return c.json(
        { error: { code: "unauthorized", message: "Invalid or expired access token." } },
        401,
      );
    }
    console.error(`change-password: Supabase user update failed (${res.status})`);
    return c.json(
      { error: { code: "upstream_error", message: "Password update failed — try again." } },
      502,
    );
  }

  // Supabase validated the token, so decoding the sub is safe (logout
  // precedent). Clear the first-login flag for admin rows; a non-admin
  // account simply has no row and the write matches nothing.
  const claims = decodeJwtPayload(token) as { sub?: unknown } | null;
  const actor = typeof claims?.sub === "string" ? claims.sub : null;
  if (actor) {
    await rest(creds0, `admin_users?user_id=eq.${encodeURIComponent(actor)}`, {
      method: "PATCH",
      body: JSON.stringify({ must_change_password: false, updated_at: new Date().toISOString() }),
    });
    await writeAudit(creds0, {
      actor,
      action: "auth.password_change",
      entity: "auth",
      entity_id: actor,
    });
  }
  return c.json({ data: { ok: true } });
});

authRoute.post("/auth/refresh", async (c) => {
  const creds0 = creds(c);
  if (!creds0) {
    return c.json(
      { error: { code: "service_unavailable", message: "Auth requires backend credentials." } },
      503,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as { refresh_token?: unknown };
  if (typeof body.refresh_token !== "string" || !body.refresh_token) {
    return c.json(
      { error: { code: "validation_error", message: "refresh_token is required" } },
      400,
    );
  }
  const res = await grant(creds0.url, creds0.key, { refresh_token: body.refresh_token });
  const data = (await res.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!res.ok || !data.access_token) {
    return c.json(
      { error: { code: "invalid_credentials", message: "Session expired — sign in again" } },
      401,
    );
  }
  return c.json({
    data: {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_in: data.expires_in ?? 3600,
    },
  });
});
