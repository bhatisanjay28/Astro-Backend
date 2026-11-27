/**
 * Horoscope watchdog (S23 cron-repair) — third cron schedule, 06:20 IST.
 *
 * Why: the 00:05 IST generation cron was silently dying mid-invocation
 * (Cloudflare `exceededResources` when it shared one isolate with the
 * panchang warm — the very bug that left the site on yesterday's date).
 * The watchdog is the safety net that keeps a missed run from ever showing
 * stale pages again:
 *
 *   1. evaluate today's IST content (daily + current weekly/monthly/yearly)
 *      against the 24-row floor (12 signs × 2 langs) and the run log;
 *   2. if anything is missing/stale/failed → re-run generation (idempotent
 *      upserts) + ping the frontend deploy hook, exactly like the cron;
 *   3. if content is STILL missing or the run STILL failed → write rows to
 *      horoscope_alerts and attempt the optional alert email (SEND_EMAIL
 *      binding + ALERT_EMAIL_TO — inert until Cloudflare Email Routing is
 *      enabled on the zone).
 *
 * The evaluate half is pure and unit-tested (test/cron.test.ts); the live
 * half is fail-soft — every DB error logs and reports, never throws (cron
 * context).
 */

import { pingFrontendDeployHook } from "../lib/deploy-hook";
import { rest, type SupabaseCreds } from "../lib/supabase";
import type { GenerateResult } from "./generate";
import { istDateKey, periodDateKey } from "./ist";

const PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
type Period = (typeof PERIODS)[number];

export const ROW_FLOOR = 24; // 12 signs × 2 langs per window
export const STALE_RUN_HOURS = 30; // a healthy cycle is ≤ 24h (daily cron)

export interface RunSummary {
  ranAt: string;
  status: string;
  published: number;
}

export interface ContentCounts {
  daily: number;
  weekly: number;
  monthly: number;
  yearly: number;
}

export interface ExpectedKeys {
  daily: string;
  weekly: string;
  monthly: string;
  yearly: string;
}

export interface ContentState {
  /** periods below the 24-row floor for their current IST window */
  missing: Period[];
  failedRun: boolean;
  staleRun: boolean;
  needsRepair: boolean;
  reasons: string[];
}

/** Pure: judge content freshness from counts + last run at an instant. */
export function evaluateContentState(
  expected: ExpectedKeys,
  counts: ContentCounts,
  lastRun: RunSummary | null,
  now: Date,
): ContentState {
  const reasons: string[] = [];
  const missing = PERIODS.filter((p) => (counts[p] ?? 0) < ROW_FLOOR);
  if (missing.length > 0) {
    reasons.push(
      `content below ${ROW_FLOOR}-row floor: ${missing
        .map((p) => `${p}(${counts[p] ?? 0}/${ROW_FLOOR} for ${expected[p]})`)
        .join(", ")}`,
    );
  }
  const failedRun = lastRun?.status === "failed";
  if (failedRun) reasons.push(`last generation run failed at ${lastRun.ranAt}`);
  const ageH = lastRun ? (now.getTime() - Date.parse(lastRun.ranAt)) / 3_600_000 : Infinity;
  const staleRun = !lastRun || ageH > STALE_RUN_HOURS;
  if (staleRun) {
    reasons.push(
      lastRun
        ? `last run ${lastRun.ranAt} is ${ageH.toFixed(1)}h old (> ${STALE_RUN_HOURS}h)`
        : "no generation run recorded",
    );
  }
  return {
    missing,
    failedRun,
    staleRun,
    needsRepair: missing.length > 0 || failedRun || staleRun,
    reasons,
  };
}

/** Current IST window keys per period, resolved at one instant. */
export function expectedKeys(now: Date): ExpectedKeys {
  return {
    daily: istDateKey(now),
    weekly: periodDateKey("weekly", now),
    monthly: periodDateKey("monthly", now),
    yearly: periodDateKey("yearly", now),
  };
}

export interface WatchdogEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  FRONTEND_DEPLOY_HOOK_URL?: string;
  /** optional alert email — inert until the SEND_EMAIL binding is declared */
  ALERT_EMAIL_TO?: string;
  SEND_EMAIL?: { send: (message: Record<string, string>) => Promise<void> };
}

export interface WatchdogOutcome {
  preNeedsRepair: boolean;
  /** repair generation ran and the post-state is clean */
  healed: boolean;
  /** post-state still broken → horoscope_alerts rows written */
  alerted: boolean;
  pre: ContentState | null;
  post: ContentState | null;
}

interface AlertRow {
  kind: "content_missing" | "run_failed";
  detail: Record<string, unknown>;
}

async function fetchCounts(creds: SupabaseCreds, expected: ExpectedKeys): Promise<ContentCounts> {
  // single query — the four expected keys are distinct strings, so an or=()
  // on date_key plus a client-side (period, date_key) pair-match is enough
  const keys = [expected.daily, expected.weekly, expected.monthly, expected.yearly]
    .map((k) => `date_key.eq.${k}`)
    .join(",");
  const res = await rest(
    creds,
    `horoscopes?status=eq.published&select=period,date_key&or=(${keys})&limit=200`,
  );
  const counts: ContentCounts = { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
  if (!res.ok) throw new Error(`counts lookup failed: ${res.status}`);
  for (const row of (await res.json()) as Array<{ period: string; date_key: string }>) {
    const p = row.period as Period;
    if (PERIODS.includes(p) && expected[p] === row.date_key) counts[p] += 1;
  }
  return counts;
}

async function fetchLastRun(creds: SupabaseCreds): Promise<RunSummary | null> {
  const res = await rest(
    creds,
    "horoscope_run_log?select=ran_at,status,published&order=ran_at.desc&limit=1",
  );
  if (!res.ok) throw new Error(`run-log lookup failed: ${res.status}`);
  const rows = (await res.json()) as RunSummary[];
  return rows[0] ?? null;
}

async function evaluateLive(
  creds: SupabaseCreds,
  expected: ExpectedKeys,
  now: Date,
): Promise<{ state: ContentState; counts: ContentCounts; lastRun: RunSummary | null }> {
  const [counts, lastRun] = [await fetchCounts(creds, expected), await fetchLastRun(creds)];
  return { state: evaluateContentState(expected, counts, lastRun, now), counts, lastRun };
}

function buildAlerts(
  state: ContentState,
  expected: ExpectedKeys,
  counts: ContentCounts,
  lastRun: RunSummary | null,
): AlertRow[] {
  const alerts: AlertRow[] = [];
  if (state.missing.length > 0) {
    alerts.push({
      kind: "content_missing",
      detail: { missing: state.missing, expected, counts, reasons: state.reasons },
    });
  }
  if (state.failedRun) {
    alerts.push({ kind: "run_failed", detail: { lastRun, reasons: state.reasons } });
  }
  return alerts;
}

async function writeAlerts(creds: SupabaseCreds, alerts: AlertRow[]): Promise<void> {
  if (alerts.length === 0) return;
  const res = await rest(creds, "horoscope_alerts", {
    method: "POST",
    body: JSON.stringify(alerts.map((a) => ({ kind: a.kind, detail: a.detail }))),
  });
  if (!res.ok) console.error(`[watchdog] alert insert failed: ${res.status}`);
}

/** Optional email — no SEND_EMAIL binding / ALERT_EMAIL_TO → silently skipped. */
async function sendAlertEmail(
  env: WatchdogEnv,
  alerts: AlertRow[],
  state: ContentState,
): Promise<void> {
  if (!env.SEND_EMAIL || !env.ALERT_EMAIL_TO || alerts.length === 0) return;
  const subject = `[Vyotish] horoscope watchdog: ${alerts.map((a) => a.kind).join(" + ")}`;
  const text = [
    "The horoscope watchdog could not restore fresh content after a repair run.",
    "",
    ...state.reasons.map((r) => `- ${r}`),
    "",
    "Open the admin panel or GET /health for the currently published content dates.",
  ].join("\n");
  await env.SEND_EMAIL.send({ from: "alerts@vyotish.com", to: env.ALERT_EMAIL_TO, subject, text });
  console.log(`[watchdog] alert email sent to ${env.ALERT_EMAIL_TO}`);
}

/**
 * The watchdog entry — run on its own cron schedule (06:20 IST), also safe to
 * invoke manually. Never throws (cron context); outcomes land in the console
 * and horoscope_alerts.
 */
export async function runHoroscopeWatchdog(
  env: WatchdogEnv,
  generate: (env: WatchdogEnv) => Promise<GenerateResult>,
): Promise<WatchdogOutcome> {
  const outcome: WatchdogOutcome = {
    preNeedsRepair: false,
    healed: false,
    alerted: false,
    pre: null,
    post: null,
  };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[watchdog] skipped: no backend credentials");
    return outcome;
  }
  const creds: SupabaseCreds = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
  try {
    const expected = expectedKeys(new Date());
    const pre = await evaluateLive(creds, expected, new Date());
    outcome.pre = pre.state;
    outcome.preNeedsRepair = pre.state.needsRepair;
    if (!pre.state.needsRepair) return outcome;

    console.warn(`[watchdog] repair needed: ${pre.state.reasons.join("; ")}`);
    const result = await generate(env); // generateHoroscopes itself never throws
    if (result.published > 0 && env.FRONTEND_DEPLOY_HOOK_URL) {
      await pingFrontendDeployHook(env.FRONTEND_DEPLOY_HOOK_URL, {
        source: "cron",
        published: result.published,
      });
    }

    const post = await evaluateLive(creds, expected, new Date());
    outcome.post = post.state;
    if (!post.state.needsRepair) {
      outcome.healed = true;
      console.log(
        `[watchdog] self-healed — generation published ${result.published} rows; re-pinged the frontend deploy hook`,
      );
      return outcome;
    }

    const alerts = buildAlerts(post.state, expected, post.counts, post.lastRun);
    await writeAlerts(creds, alerts);
    await sendAlertEmail(env, alerts, post.state).catch((err) =>
      console.error("[watchdog] alert email failed:", err),
    );
    outcome.alerted = alerts.length > 0;
    console.error(`[watchdog] STILL unhealthy after repair: ${post.state.reasons.join("; ")}`);
    return outcome;
  } catch (err) {
    console.error("[watchdog] failed:", err);
    return outcome;
  }
}
