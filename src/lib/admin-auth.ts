/**
 * Epic 6.1 — Admin authentication + Phase 1 authorization plumbing.
 *
 * Identity: Supabase Auth. The backend never signs or validates JWTs itself;
 * a bearer token is validated by calling Supabase's /auth/v1/user endpoint
 * (401 there ⇒ token invalid/expired). The token payload is only decoded
 * WITHOUT verification to read the `aal` and `iat` claims — safe, because
 * Supabase has already proven the token at that point.
 *
 * Authorization (Admin Phase 1):
 *  - role from admin_users (5-role model, migration 0014; unknown/legacy
 *    roles carry no capabilities — fail-safe);
 *  - requireAdmin() authenticates + checks account is_active;
 *  - requireCapability() (per route/subtree) checks role capabilities via
 *    lib/rbac.ts — the enforcement point for 02-mary-gap-analysis §C;
 *  - absolute session cap: access tokens older than 12 h are rejected even
 *    if Supabase still accepts them (client refresh keeps sessions alive).
 *
 * MFA: enforcing minAal is a one-line middleware option once owners enrol
 * factors (Supabase raises `aal` to 2 in the access token).
 */
import type { Context, Next } from "hono";
import type { AppEnv } from "../env";
import { type AdminRateBucket, adminActionLimited } from "./rate-limit";
import { type Capability, capabilitiesOf, roleCan } from "./rbac";

export type AdminRole = string;

export type AdminContext = {
  userId: string;
  email: string;
  role: AdminRole;
  display_name: string | null;
  is_active: boolean;
  /** Phase 5 — direct-created accounts must set a new password at first login
   * (requireAdmin 403s every /admin/* route until POST /auth/change-password). */
  must_change_password: boolean;
  /** authenticator assurance level from the validated token (1 password-only, 2 MFA) */
  aal: 1 | 2;
  /** capabilities granted by the role (rbac.ts) — convenience for /admin/me */
  capabilities: Capability[];
};

type EnvWithAdmin = AppEnv & { Variables: { admin: AdminContext } };

type SupabaseUser = {
  id: string;
  email?: string | null;
};

type SupabaseUserResponse = { user?: SupabaseUser } & SupabaseUser;

type AdminUserRow = {
  user_id: string;
  email: string;
  role: AdminRole;
  is_active?: boolean | null;
  display_name?: string | null;
  must_change_password?: boolean | null;
};

/** Absolute cap on a presented access token's age (iat), in seconds: 12 h. */
const MAX_TOKEN_AGE_SECONDS = 12 * 60 * 60;

function unauthorized(c: Context, message: string) {
  return c.json({ error: { code: "unauthorized", message } }, 401);
}

/** Decode a JWT payload WITHOUT verifying it — only after Supabase validated the token. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Validate a Supabase access token and load its admin row.
 * Returns null at each failure layer; callers map nulls to the right status.
 */
export async function resolveAdmin(
  supabaseUrl: string,
  serviceKey: string,
  token: string,
): Promise<
  | { ok: true; admin: AdminContext }
  | {
      ok: false;
      reason: "invalid_token" | "expired_token" | "not_admin" | "deactivated" | "upstream";
    }
> {
  // 1. Identity — Supabase validates the token server-side.
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, reason: "upstream" };
  }
  if (!res.ok) return { ok: false, reason: "invalid_token" };

  const body = (await res.json()) as SupabaseUserResponse;
  const user = body.user ?? body;
  if (!user?.id) return { ok: false, reason: "invalid_token" };

  // 2. Assurance level + absolute age — from the validated token's payload.
  const claims = decodeJwtPayload(token);
  const aal = claims?.aal === "aal2" ? 2 : 1;
  if (typeof claims?.iat === "number" && Date.now() / 1000 - claims.iat > MAX_TOKEN_AGE_SECONDS) {
    return { ok: false, reason: "expired_token" };
  }

  // 3. Authorization — role row from admin_users (service-role read).
  let roleRes: Response;
  try {
    roleRes = await fetch(
      `${supabaseUrl}/rest/v1/admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,email,role,is_active,display_name,must_change_password`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
  } catch {
    return { ok: false, reason: "upstream" };
  }
  if (!roleRes.ok) return { ok: false, reason: "upstream" };

  const rows = (await roleRes.json()) as AdminUserRow[];
  const row = rows[0];
  if (!row) return { ok: false, reason: "not_admin" };
  if (row.is_active === false) return { ok: false, reason: "deactivated" };

  return {
    ok: true,
    admin: {
      userId: row.user_id,
      email: row.email,
      role: row.role,
      display_name: row.display_name ?? null,
      // the deactivated guard above already returned; anything past it is active
      is_active: true,
      must_change_password: row.must_change_password === true,
      aal,
      capabilities: capabilitiesOf(row.role),
    },
  };
}

type RequireAdminOptions = {
  /** minimum authenticator assurance level (2 ⇒ MFA required). Default 1. */
  minAal?: 1 | 2;
};

/**
 * Hono middleware guarding /api/v1/admin/* routes — authentication + account
 * state. Capability checks are separate (requireCapability) so each subtree
 * can declare its own contract.
 * Contract: 401 unauthorized (missing/invalid/expired token), 403 forbidden
 * (authenticated but no admin_users row / deactivated), 503
 * service_unavailable when the auth upstream is unreachable (fail-closed).
 */
export function requireAdmin(options: RequireAdminOptions = {}) {
  const minAal = options.minAal ?? 1;

  return async (c: Context<EnvWithAdmin>, next: Next) => {
    const supabaseUrl = c.env?.SUPABASE_URL;
    const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return c.json(
        {
          error: {
            code: "service_unavailable",
            message:
              "Admin endpoints require backend auth credentials, which are not configured on this deployment yet.",
          },
        },
        503,
      );
    }

    const auth = c.req.header("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) {
      return unauthorized(
        c,
        "Authentication required: supply a Supabase access token as a Bearer token.",
      );
    }

    const result = await resolveAdmin(supabaseUrl, serviceKey, token);
    if (!result.ok) {
      if (result.reason === "upstream") {
        return c.json(
          {
            error: {
              code: "service_unavailable",
              message: "Authentication service is unreachable. Try again.",
            },
          },
          503,
        );
      }
      if (result.reason === "not_admin") {
        return c.json(
          { error: { code: "forbidden", message: "This account does not have admin access." } },
          403,
        );
      }
      if (result.reason === "deactivated") {
        return c.json(
          {
            error: {
              code: "forbidden",
              message: "This admin account has been deactivated. Contact a super admin.",
            },
          },
          403,
        );
      }
      if (result.reason === "expired_token") {
        return unauthorized(c, "Session expired — sign in again.");
      }
      return unauthorized(c, "Invalid or expired access token.");
    }

    if (result.admin.aal < minAal) {
      return c.json(
        {
          error: {
            code: "forbidden",
            message: "Multi-factor authentication is required for this action.",
          },
        },
        403,
      );
    }

    // Phase 5 — a direct-created account cannot touch the panel (or any admin
    // API) until it has replaced its one-time temp password. /auth/change-
    // password lives OUTSIDE this middleware, so the reset itself stays
    // reachable; the UI detects this code from /admin/me and shows the
    // first-login form.
    if (result.admin.must_change_password) {
      return c.json(
        {
          error: {
            code: "password_change_required",
            message: "Set a new password before using the admin panel.",
          },
        },
        403,
      );
    }

    c.set("admin", result.admin);
    await next();
  };
}

/**
 * Method-aware capability gate for admin subtrees: map HTTP method →
 * capability (e.g. { GET: "posts.read", PUT: "posts.write" }). Methods not
 * in the map get no capability constraint beyond requireAdmin itself —
 * declare every mutating method explicitly at the call site.
 */
export function requireCapabilityFor(map: Partial<Record<string, Capability>>) {
  return async (c: Context<EnvWithAdmin>, next: Next) => {
    const capability = map[c.req.method];
    if (!capability) {
      await next();
      return;
    }
    const gate = requireCapability(capability);
    return gate(c, next);
  };
}

/**
 * Capability gate for admin routes (Admin Phase 1). Requires the admin
 * context set by requireAdmin; 403 when the role lacks the capability.
 * Non-GET requests also pass a per-user admin-write rate bucket
 * (rate-limit.ts; per-isolate memory, best-effort).
 */
export function requireCapability(capability: Capability) {
  return async (c: Context<EnvWithAdmin>, next: Next) => {
    const admin = c.get("admin");
    if (!admin) {
      return unauthorized(c, "Authentication required.");
    }
    if (!roleCan(admin.role, capability)) {
      return c.json(
        {
          error: {
            code: "forbidden",
            message: `Your role (${admin.role || "unknown"}) does not permit this action.`,
          },
        },
        403,
      );
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const bucket: AdminRateBucket = "admin:write";
      if (adminActionLimited(bucket, admin.userId, (c.env ?? {}) as Record<string, unknown>)) {
        return c.json(
          {
            error: {
              code: "rate_limited",
              message: "Too many admin changes in a short time — slow down and try again.",
            },
          },
          429,
        );
      }
    }
    await next();
  };
}
