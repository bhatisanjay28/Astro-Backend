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
  /**
   * Cloudflare Turnstile widget secret — bot protection on the anonymous
   * write endpoints (/auth/login, /requests/*, /newsletter). Unset → the
   * verification is skipped (local dev / tests / arming window); the public
   * counterpart PUBLIC_TURNSTILE_SITE_KEY bakes into the Pages build.
   */
  TURNSTILE_SECRET_KEY?: string;
  /**
   * Optional CF Pages deploy hook — the horoscope cron pings it after a
   * publishing run and the admin nav route pings it after a nav config
   * save, so the static frontend rebuilds with the fresh data (build-time
   * SSR). Unset → ping skipped (frontend refreshes on the next
   * push-triggered deploy).
   */
  FRONTEND_DEPLOY_HOOK_URL?: string;
  /**
   * Optional horoscope-watchdog alert recipient (S23). When set together
   * with the SEND_EMAIL binding, the watchdog emails ALERT_EMAIL_TO after a
   * repair run that leaves content still missing/stale. Inert until Cloudflare
   * Email Routing is enabled on the vyotish.com zone (so the SEND_EMAIL
   * binding can be declared) and this is set (`wrangler secret put
   * ALERT_EMAIL_TO`). Alerts always land in horoscope_alerts regardless.
   */
  ALERT_EMAIL_TO?: string;
  /**
   * Optional send_email binding backing the watchdog alert email — declared
   * in wrangler.jsonc only after Cloudflare Email Routing is enabled on the
   * vyotish.com zone. Unset → email alerts skipped (the horoscope_alerts
   * table and /health still surface every alert).
   */
  SEND_EMAIL?: { send: (message: Record<string, string>) => Promise<void> };
  /**
   * Test opt-out for every rate limiter (login proxy, admin action buckets,
   * booking in-file throttle) — mirrors src/lib/rate-limit.ts. Never set in
   * production.
   */
  RATE_LIMIT_DISABLED?: string | boolean;
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
