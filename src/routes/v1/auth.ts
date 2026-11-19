/**
 * Epic 6.4 — Auth proxy (D4: Supabase Auth is administered through backend
 * endpoints; the frontend never holds Supabase keys). The admin UI logs in
 * here; the returned Supabase access token is then presented to /admin/*,
 * where requireAdmin checks identity + role (Epic 6.1).
 *
 * Only the fields the UI needs leave the proxy — no Supabase envelope leakage.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";

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
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
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
  const res = await grant(creds0.url, creds0.key, { email: body.email, password: body.password });
  const data = (await res.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!res.ok || !data.access_token) {
    return c.json(
      { error: { code: "invalid_credentials", message: "Invalid email or password" } },
      401,
    );
  }
  return c.json({
    data: {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_in: data.expires_in ?? 3600,
      user: { id: data.user?.id ?? null, email: data.user?.email ?? body.email },
    },
  });
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
