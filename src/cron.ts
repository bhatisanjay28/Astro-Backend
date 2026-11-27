/**
 * Epic 3.1b — Cloudflare Cron Trigger: warm the panchang cache for today
 * (all cities) and prune stale rows. Runs ~00:15 UTC daily; also safe to
 * invoke manually. Failures are logged, never thrown — a missed warm is
 * healed by the write-through on first request.
 *
 * Horoscope Upgrade Step 4 — the trigger then generates/refreshes
 * horoscope rows (12 signs × 2 langs × daily buffer + weekly/monthly/yearly
 * windows). Generation is deterministic and validates before publishing;
 * failures land in horoscope_run_log and never throw.
 *
 * S23 cron-repair — the two jobs moved onto SEPARATE schedules (one isolate
 * each): chaining panchang warm + horoscope compose in a single invocation
 * blew the CPU limit (`exceededResources` on every firing since 24 Nov), so
 * the horoscope pass never completed, never pinged the Pages deploy hook and
 * the static site kept serving the previous build's dates. The scheduled
 * handler dispatches on `event.cron` via cronJobFor; any unrecognised
 * expression (e.g. a temporary ops trigger registered through the API)
 * defaults to horoscope generation. A third schedule (watchdog, 06:20 IST)
 * self-heals a missed run and alerts via horoscope_alerts.
 */

import { computePanchang } from "./engine";
import type { Bindings } from "./env";
import { type GenerateResult, generateHoroscopes } from "./horoscope/generate";
import { istDateKey } from "./horoscope/ist";
import { runHoroscopeWatchdog, type WatchdogEnv } from "./horoscope/watchdog";
import { pingFrontendDeployHook } from "./lib/deploy-hook";
import { prunePanchangCache, storePanchang } from "./lib/panchang-cache";
import { rest, type SupabaseCreds } from "./lib/supabase";

/** Cron bindings — the deploy-hook var lives on the worker Bindings type (env.ts). */
type CronEnv = Pick<
  Bindings,
  "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "FRONTEND_DEPLOY_HOOK_URL"
>;

/** The three schedules in wrangler.jsonc (UTC; IST = UTC+5:30). */
export const CRON_PANCHANG = "15 0 * * *"; // 05:45 IST — panchang cache warm + prune
export const CRON_HOROSCOPE = "35 18 * * *"; // 00:05 IST — daily horoscope generation
export const CRON_WATCHDOG = "50 0 * * *"; // 06:20 IST — watchdog (self-heal + alert)
export type CronJob = "panchang" | "horoscope" | "watchdog";

/**
 * Which job a fired schedule runs. The three known expressions map 1:1; any
 * OTHER expression is treated as horoscope generation so an ops one-off
 * trigger (schedules API) always produces a fresh content run.
 */
export function cronJobFor(cron: string): CronJob {
  if (cron === CRON_PANCHANG) return "panchang";
  if (cron === CRON_WATCHDOG) return "watchdog";
  return "horoscope";
}

export async function warmPanchangCache(env: CronEnv): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[cron] panchang warm skipped: no backend credentials");
    return;
  }
  const creds: SupabaseCreds = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
  // IST calendar date — never raw toISOString (ist.ts rule); harmless at the
  // 05:45 IST schedule but aligned so a schedule move can never drift it.
  const today = istDateKey(new Date());

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

/** Generate + ping the Pages deploy hook — shared by the cron and the watchdog. */
async function generateAndPing(env: CronEnv & Partial<WatchdogEnv>): Promise<GenerateResult> {
  const result = await generateHoroscopes(env);
  if (env.FRONTEND_DEPLOY_HOOK_URL && result.published > 0) {
    await pingFrontendDeployHook(env.FRONTEND_DEPLOY_HOOK_URL, {
      source: "cron",
      published: result.published,
    });
  }
  return result;
}

/** Horoscope Upgrade Step 4 — generate + validate + publish horoscope rows. */
export async function runHoroscopeGeneration(env: CronEnv): Promise<void> {
  const result = await generateAndPing(env);
  console.log(
    `[cron] horoscope generation: ${result.status}, ${result.published} rows, ${result.violations.length} violations, ${result.durationMs}ms`,
  );
}

/** S23 watchdog — self-heal a missed/failed run, alert if still unhealthy. */
export async function runHoroscopeWatchdogJob(env: CronEnv & Partial<WatchdogEnv>): Promise<void> {
  const outcome = await runHoroscopeWatchdog(env, (e) => generateAndPing(e));
  console.log(
    `[cron] horoscope watchdog: preNeedsRepair=${outcome.preNeedsRepair} healed=${outcome.healed} alerted=${outcome.alerted}`,
  );
}
