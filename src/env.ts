/**
 * Environment bindings for the Worker.
 *
 * Secrets (SUPABASE_SERVICE_ROLE_KEY, TURNSTILE_SECRET_KEY, …) are set via
 * `wrangler secret put` in production and `.dev.vars` locally — never in code
 * or `.env` committed to the repository (DECISIONS.md D3, PRD §14).
 */
export type Bindings = {
  /** deployment environment marker */
  ENV?: string;
  /** local dev port for the Bun server (ignored on Workers) */
  PORT?: string;
  /** Supabase project URL — Epic 0.4 */
  SUPABASE_URL?: string;
  /** Supabase service-role key — server-only, Epic 0.4 */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Google Places (New) API key — birthplace pickers; proxied server-side so
   * the browser never sees it. Without it, /places/* falls back to the
   * cities table (same response shape). */
  GOOGLE_PLACES_API_KEY?: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Record<string, never>;
};

/** Env shape for routes that set admin context (Epic 6.1 requireAdmin). */
export type AppEnvWithAdmin = {
  Bindings: Bindings;
  Variables: { admin: import("./lib/admin-auth").AdminContext };
};
