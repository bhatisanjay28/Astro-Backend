/**
 * Epic 6.1 — Admin authentication plumbing.
 *
 * Identity: Supabase Auth. The backend never signs or validates JWTs itself;
 * a bearer token is validated by calling Supabase's /auth/v1/user endpoint
 * (401 there ⇒ token invalid/expired). The token payload is only decoded
 * WITHOUT verification to read the `aal` claim — safe, because Supabase has
 * already proven the token at that point. This keeps the stack MFA-ready:
 * enforcing a higher assurance level is a one-line middleware option once
 * owners enrol factors (Supabase raises `aal` to 2 in the access token).
 *
 * Authorization: the `admin_users` table (migration 0006) maps auth users to
 * roles; RLS leaves it service-role-only, so only this backend reads it.
 */
import type { Context, Next } from "hono";
import type { AppEnv } from "../env";

export type AdminRole = "admin" | "editor";

export type AdminContext = {
  userId: string;
  email: string;
  role: AdminRole;
  /** authenticator assurance level from the validated token (1 password-only, 2 MFA) */
  aal: 1 | 2;
};

type EnvWithAdmin = AppEnv & { Variables: { admin: AdminContext } };

type SupabaseUser = {
  id: string;
  email?: string | null;
};

type SupabaseUserResponse = { user?: SupabaseUser } & SupabaseUser;

function unauthorized(c: Context, message: string) {
  return c.json({ error: { code: "unauthorized", message } }, 401);
}

/** Decode a JWT payload WITHOUT verifying it — only after Supabase validated the token. */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
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
  | { ok: false; reason: "invalid_token" | "not_admin" | "upstream" }
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

  // 2. Assurance level — MFA-ready: enforced by middleware options, not here.
  const claims = decodeJwtPayload(token);
  const aal = claims?.aal === "aal2" ? 2 : 1;

  // 3. Authorization — role row from admin_users (service-role read).
  let roleRes: Response;
  try {
    roleRes = await fetch(
      `${supabaseUrl}/rest/v1/admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,email,role`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
  } catch {
    return { ok: false, reason: "upstream" };
  }
  if (!roleRes.ok) return { ok: false, reason: "upstream" };

  const rows = (await roleRes.json()) as Array<{ user_id: string; email: string; role: AdminRole }>;
  const row = rows[0];
  if (!row) return { ok: false, reason: "not_admin" };

  return {
    ok: true,
    admin: {
      userId: row.user_id,
      email: row.email,
      role: row.role,
      aal,
    },
  };
}

type RequireAdminOptions = {
  /** minimum authenticator assurance level (2 ⇒ MFA required). Default 1. */
  minAal?: 1 | 2;
  /** minimum role level ("editor" ⊂ "admin"). Default: any admin_users row. */
  role?: AdminRole;
};

const ROLE_RANK: Record<AdminRole, number> = { editor: 1, admin: 2 };

/**
 * Hono middleware guarding /api/v1/admin/* routes.
 * Contract: 401 unauthorized (missing/invalid token), 403 forbidden
 * (authenticated but not an admin / insufficient role or AAL),
 * 503 service_unavailable when the auth upstream is unreachable (fail-closed).
 */
export function requireAdmin(options: RequireAdminOptions = {}) {
  const minAal = options.minAal ?? 1;
  const minRole = options.role ? ROLE_RANK[options.role] : 0;

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
    if (ROLE_RANK[result.admin.role] < minRole) {
      return c.json(
        { error: { code: "forbidden", message: "Your admin role does not permit this action." } },
        403,
      );
    }

    c.set("admin", result.admin);
    await next();
  };
}
