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

export type RestListResult =
  | { ok: true; rows: Record<string, unknown>[]; total: number }
  | { ok: false; status: number };

/**
 * Paginated PostgREST read with `Prefer: count=exact`.
 *
 * PostgREST answers 416 PGRST103 when the requested offset is past the row
 * count (e.g. `?page=2` on a 2-row table). That is an empty page, not a
 * failure — the exact total still arrives in the `content-range` suffix
 * after the slash, so it is parsed here and reported normally. Anything
 * else non-OK (network, auth, 5xx) comes back as `{ ok: false }` for the
 * caller to map to its own 500.
 */
export async function restList(creds: SupabaseCreds, resource: string): Promise<RestListResult> {
  const res = await rest(creds, resource, { headers: { Prefer: "count=exact" } });
  if (res.status === 416)
    return {
      ok: true,
      rows: [],
      total: Number(res.headers.get("content-range")?.split("/")[1] ?? 0),
    };
  if (!res.ok) return { ok: false, status: res.status };
  const rows = (await res.json()) as Record<string, unknown>[];
  const total = Number(res.headers.get("content-range")?.split("/")[1] ?? rows.length);
  return { ok: true, rows, total };
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
