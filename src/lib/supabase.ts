/**
 * Shared Supabase access helpers (Epic 6.2+). Routes historically inline the
 * fetch + apikey boilerplate; the admin CRUD makes enough calls that a helper
 * pays for itself. Service-role only — every call is a backend call (D3/D12).
 */
export type SupabaseCreds = { url: string; key: string };

/**
 * Accepts any Hono context whose Bindings carry the Supabase vars (AppEnv and
 * AppEnvWithAdmin both qualify — structural, so admin routes pass their
 * admin-context variant without casts).
 */
export function supabaseCreds(c: {
  env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
}): SupabaseCreds | null {
  const url = c.env?.SUPABASE_URL;
  const key = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

/** PostgREST call with service-role auth already applied. */
export function rest(
  creds: SupabaseCreds,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${creds.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** Supabase Storage call (upload/bucket endpoints, not PostgREST). */
export function storage(
  creds: SupabaseCreds,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${creds.url}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      ...(init.headers ?? {}),
    },
  });
}
