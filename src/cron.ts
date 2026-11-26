/**
 * Epic 3.1b — Cloudflare Cron Trigger: warm the panchang cache for today
 * (all cities) and prune stale rows. Runs ~00:15 UTC daily; also safe to
 * invoke manually. Failures are logged, never thrown — a missed warm is
 * healed by the write-through on first request.
 *
 * Horoscope Upgrade Step 4 — the same trigger then generates/refreshes
 * horoscope rows (12 signs × 2 langs × daily buffer + weekly/monthly/yearly
 * windows). Generation is deterministic and validates before publishing;
 * failures land in horoscope_run_log and never throw.
 */

import { computePanchang } from "./engine";
import type { Bindings } from "./env";
import { generateHoroscopes } from "./horoscope/generate";
import { pingFrontendDeployHook } from "./lib/deploy-hook";
import { prunePanchangCache, storePanchang } from "./lib/panchang-cache";
import { rest, type SupabaseCreds } from "./lib/supabase";

/** Cron bindings — the deploy-hook var lives on the worker Bindings type (env.ts). */
type CronEnv = Pick<
  Bindings,
  "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "FRONTEND_DEPLOY_HOOK_URL"
>;

export async function warmPanchangCache(env: CronEnv): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[cron] panchang warm skipped: no backend credentials");
    return;
  }
  const creds: SupabaseCreds = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
  const today = new Date().toISOString().slice(0, 10);

  const res = await rest(
    creds,
    "cities?select=id,slug,name,latitude,longitude,timezone&limit=1000",
  );
  if (!res.ok) {
    console.error("[cron] cities list failed");
    return;
  }
  const cities = (await res.json()) as Array<{
    id: string;
    slug: string;
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
  }>;

  let warmed = 0;
  const chunk = 6;
  for (let i = 0; i < cities.length; i += chunk) {
    await Promise.all(
      cities.slice(i, i + chunk).map(async (city) => {
        try {
          const payload = computePanchang({
            date: today,
            latitude: city.latitude,
            longitude: city.longitude,
            timezone: city.timezone,
            city: { slug: city.slug, name: city.name },
          }) as unknown as Record<string, unknown>;
          const ok = await storePanchang(creds, city.id, today, city.timezone, payload);
          if (ok) warmed += 1;
        } catch (err) {
          console.error(`[cron] panchang warm failed for ${city.slug}:`, err);
        }
      }),
    );
  }
  const pruned = await prunePanchangCache(creds);
  console.log(
    `[cron] panchang warm: ${warmed}/${cities.length} cities for ${today}; prune ${pruned ? "ok" : "failed"}`,
  );
}

/** Horoscope Upgrade Step 4 — generate + validate + publish horoscope rows. */
export async function runHoroscopeGeneration(env: CronEnv): Promise<void> {
  const result = await generateHoroscopes(env);
  console.log(
    `[cron] horoscope generation: ${result.status}, ${result.published} rows, ${result.violations.length} violations, ${result.durationMs}ms`,
  );
  if (env.FRONTEND_DEPLOY_HOOK_URL && result.published > 0) {
    await pingFrontendDeployHook(env.FRONTEND_DEPLOY_HOOK_URL, {
      source: "cron",
      published: result.published,
    });
  }
}
