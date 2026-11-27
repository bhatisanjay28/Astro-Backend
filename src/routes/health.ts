import { Hono } from "hono";
import type { AppEnv } from "../env";
import { istDateKey, periodDateKey } from "../horoscope/ist";
import { rest, type SupabaseCreds } from "../lib/supabase";

/**
 * GET /health — liveness probe with a best-effort horoscope heartbeat
 * (Horoscope Upgrade Step 4, automation req #5; S23 cron-repair).
 *
 * Liveness never depends on the database: if creds are missing or the
 * lookup fails, `horoscope` is simply omitted / reported null and status
 * stays "ok". Generator health is judged from `horoscope.last_run.status`
 * ("success" | "partial" | "failed") and `ran_at` staleness, not from here.
 *
 * S23 additions (the health check the owner asked for — "the date of the
 * content currently published"):
 *   horoscope.content   — per period, the current IST window's expected
 *                         date_key + published row count (daily/weekly/
 *                         monthly/yearly), so a glance shows whether the
 *                         pages being served are fresh;
 *   horoscope.open_alerts — unresolved horoscope_alerts rows (watchdog).
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
    const now = new Date();
    const expected = {
      daily: istDateKey(now),
      weekly: periodDateKey("weekly", now),
      monthly: periodDateKey("monthly", now),
      yearly: periodDateKey("yearly", now),
    };
    // the four expected keys are distinct strings — one or=() query + pair match
    const keys = [expected.daily, expected.weekly, expected.monthly, expected.yearly]
      .map((k) => `date_key.eq.${k}`)
      .join(",");
    const [runRes, contentRes, alertsRes] = await Promise.all([
      rest(
        creds,
        "horoscope_run_log?select=ran_at,status,published,duration_ms&order=ran_at.desc&limit=1",
      ),
      rest(creds, `horoscopes?status=eq.published&select=period,date_key&or=(${keys})&limit=200`),
      rest(
        creds,
        "horoscope_alerts?select=kind,created_at,detail&resolved_at=is.null&order=created_at.desc&limit=10",
      ),
    ]);
    if (!runRes.ok) return c.json({ data: { ...base, horoscope: { last_run: null } } });
    const rows = (await runRes.json()) as Array<{
      ran_at: string;
      status: string;
      published: number;
      duration_ms: number;
    }>;
    const last = rows[0];

    const counts: Record<string, { date_key: string; rows: number }> = {
      daily: { date_key: expected.daily, rows: 0 },
      weekly: { date_key: expected.weekly, rows: 0 },
      monthly: { date_key: expected.monthly, rows: 0 },
      yearly: { date_key: expected.yearly, rows: 0 },
    };
    if (contentRes.ok) {
      for (const row of (await contentRes.json()) as Array<{
        period: string;
        date_key: string;
      }>) {
        const bucket = counts[row.period];
        if (bucket && bucket.date_key === row.date_key) bucket.rows += 1;
      }
    }

    const openAlerts = alertsRes.ok
      ? ((await alertsRes.json()) as Array<{ kind: string; created_at: string; detail: unknown }>)
      : [];

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
          content: counts,
          open_alerts: openAlerts,
        },
      },
    });
  } catch {
    // never fail liveness on the heartbeat lookup
    return c.json({ data: { ...base, horoscope: { last_run: null } } });
  }
});
