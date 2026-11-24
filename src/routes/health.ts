import { Hono } from "hono";
import type { AppEnv } from "../env";
import { rest, type SupabaseCreds } from "../lib/supabase";

/**
 * GET /health — liveness probe with a best-effort horoscope-generation
 * heartbeat (Horoscope Upgrade Step 4, automation req #5 alerting surface).
 *
 * Liveness never depends on the database: if creds are missing or the
 * lookup fails, `horoscope` is simply omitted / reported null and status
 * stays "ok". Generator health is judged from `horoscope.last_run.status`
 * ("success" | "partial" | "failed") and `ran_at` staleness, not from here.
 */
export const healthRoute = new Hono<AppEnv>().get("/health", async (c) => {
  const base = {
    status: "ok",
    service: "astro-backend",
    version: "0.2.0",
    env: c.env?.ENV ?? "development",
  };

  const url = c.env?.SUPABASE_URL;
  const key = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return c.json({ data: base });

  try {
    const creds: SupabaseCreds = { url, key };
    const res = await rest(
      creds,
      "horoscope_run_log?select=ran_at,status,published,duration_ms&order=ran_at.desc&limit=1",
    );
    if (!res.ok) return c.json({ data: { ...base, horoscope: { last_run: null } } });
    const rows = (await res.json()) as Array<{
      ran_at: string;
      status: string;
      published: number;
      duration_ms: number;
    }>;
    const last = rows[0];
    return c.json({
      data: {
        ...base,
        horoscope: {
          last_run: last
            ? {
                ran_at: last.ran_at,
                status: last.status,
                published: last.published,
                duration_ms: last.duration_ms,
              }
            : null,
        },
      },
    });
  } catch {
    // never fail liveness on the heartbeat lookup
    return c.json({ data: { ...base, horoscope: { last_run: null } } });
  }
});
