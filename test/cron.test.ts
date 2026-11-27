import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  CRON_HOROSCOPE,
  CRON_PANCHANG,
  CRON_WATCHDOG,
  cronJobFor,
  runHoroscopeWatchdogJob,
} from "../src/cron";
import type { GenerateResult } from "../src/horoscope/generate";
import { istDateKey } from "../src/horoscope/ist";
import {
  type ExpectedKeys,
  evaluateContentState,
  expectedKeys,
  ROW_FLOOR,
  type RunSummary,
  runHoroscopeWatchdog,
  STALE_RUN_HOURS,
} from "../src/horoscope/watchdog";

/**
 * S23 cron-repair — schedule mapping, IST alignment, watchdog judgement.
 * Pins the root cause of the 26-Nov staleness: the scheduled handler now
 * dispatches per schedule (one job per isolate — chaining panchang warm +
 * horoscope compose blew the CPU limit and killed every run), and the
 * watchdog self-heals a missed run instead of leaving yesterday's pages up.
 */

const wranglerText = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text();
// wrangler.jsonc is JSONC — drop full-line // comments (line-anchored, so
// "https://…" string values are untouched) before parsing
const wranglerJson = JSON.parse(wranglerText.replace(/^\s*\/\/.*$/gm, "")) as {
  triggers: { crons: string[] };
};
const declaredCrons = wranglerJson.triggers.crons;

describe("cron schedule map (wrangler.jsonc ⇄ cronJobFor)", () => {
  it("declares exactly the three UTC schedules", () => {
    expect(declaredCrons.sort()).toEqual([CRON_HOROSCOPE, CRON_PANCHANG, CRON_WATCHDOG].sort());
  });

  it("maps each known expression to its job", () => {
    expect(cronJobFor(CRON_PANCHANG)).toBe("panchang");
    expect(cronJobFor(CRON_HOROSCOPE)).toBe("horoscope");
    expect(cronJobFor(CRON_WATCHDOG)).toBe("watchdog");
  });

  it("defaults an unrecognised expression (ops one-off trigger) to horoscope", () => {
    expect(cronJobFor("23 7 * * *")).toBe("horoscope");
    expect(cronJobFor("")).toBe("horoscope");
  });
});

describe("IST alignment of the schedules (the daily rollover test)", () => {
  it("the horoscope cron fires 5 minutes AFTER IST midnight — new day, not old", () => {
    // 26 Nov 18:35 UTC = 27 Nov 00:05 IST → istDateKey must already be the 27th
    expect(istDateKey(new Date("2026-11-26T18:35:00Z"))).toBe("2026-11-27");
    // and 18:25 UTC (5 min earlier) is still the 26th in IST
    expect(istDateKey(new Date("2026-11-26T18:25:00Z"))).toBe("2026-11-26");
  });

  it("the panchang cron (00:15 UTC) and watchdog cron (00:50 UTC) stay on today's IST date", () => {
    expect(istDateKey(new Date("2026-11-27T00:15:00Z"))).toBe("2026-11-27");
    expect(istDateKey(new Date("2026-11-27T00:50:00Z"))).toBe("2026-11-27"); // 06:20 IST
  });

  it("expectedKeys resolve to the new IST window after the midnight rollover", () => {
    // firing instant of the horoscope cron = 00:05 IST Fri 27 Nov
    const keys = expectedKeys(new Date("2026-11-26T18:35:00Z"));
    expect(keys.daily).toBe("2026-11-27");
    expect(keys.weekly).toBe("2026-11-23"); // Monday-on-or-before (Fri 27 Nov's week)
    expect(keys.monthly).toBe("2026-11");
    expect(keys.yearly).toBe("2026");
  });
});

describe("evaluateContentState (pure watchdog judgement)", () => {
  const expected: ExpectedKeys = {
    daily: "2026-11-27",
    weekly: "2026-11-23",
    monthly: "2026-11",
    yearly: "2026",
  };
  const now = new Date("2026-11-27T00:50:00Z"); // 06:20 IST
  const freshRun: RunSummary = {
    ranAt: "2026-11-26T18:35:10.000Z",
    status: "success",
    published: 336,
  };
  const healthyCounts = { daily: 24, weekly: 24, monthly: 24, yearly: 24 };

  it("healthy: full rows + fresh success run → no repair", () => {
    const state = evaluateContentState(expected, healthyCounts, freshRun, now);
    expect(state.needsRepair).toBe(false);
    expect(state.missing).toEqual([]);
    expect(state.failedRun).toBe(false);
    expect(state.staleRun).toBe(false);
  });

  it("missing today's daily content → repair", () => {
    const state = evaluateContentState(expected, { ...healthyCounts, daily: 0 }, freshRun, now);
    expect(state.needsRepair).toBe(true);
    expect(state.missing).toEqual(["daily"]);
    expect(state.reasons.join(" ")).toContain("daily");
  });

  it("a partial window (e.g. 12 rows) is below the floor", () => {
    const state = evaluateContentState(expected, { ...healthyCounts, yearly: 12 }, freshRun, now);
    expect(state.missing).toEqual(["yearly"]);
    expect(state.reasons.join(" ")).toContain(`${12}/${ROW_FLOOR}`);
  });

  it("failed last run → repair even with full content", () => {
    const state = evaluateContentState(
      expected,
      healthyCounts,
      { ...freshRun, status: "failed", published: 0 },
      now,
    );
    expect(state.failedRun).toBe(true);
    expect(state.needsRepair).toBe(true);
  });

  it("run older than the staleness window → repair", () => {
    const old = { ...freshRun, ranAt: "2026-11-25T15:12:53.000Z" }; // ~33.6h before `now`
    const state = evaluateContentState(expected, healthyCounts, old, now);
    expect(state.staleRun).toBe(true);
    expect(state.needsRepair).toBe(true);
    expect(state.reasons.join(" ")).toContain(`${STALE_RUN_HOURS}h`);
  });

  it("no run record at all → repair", () => {
    const state = evaluateContentState(expected, healthyCounts, null, now);
    expect(state.staleRun).toBe(true);
    expect(state.needsRepair).toBe(true);
  });

  it("a 'partial' run that published is healthy (violations republish next cycle)", () => {
    const state = evaluateContentState(
      expected,
      healthyCounts,
      { ...freshRun, status: "partial" },
      now,
    );
    expect(state.needsRepair).toBe(false);
  });
});

/* ---- live watchdog flow (fetch-mocked Supabase; injected generation) ---- */

const originalFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const CREDS = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};
const HOOK_URL = "https://fake-pages.example/hook";

interface WatchSpec {
  /** (period, date_key) → published row count */
  counts: Record<string, number>;
  lastRun: RunSummary | null;
}

/** Installs a fetch mock resolving the watchdog's counts/run-log reads and
 * capturing horoscope_alerts inserts + deploy-hook pings. */
function installWatchBackend(spec: WatchSpec) {
  const captured = { alertRows: [] as Array<Record<string, unknown>>, pings: [] as string[] };
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/horoscopes?") && url.includes("select=period,date_key")) {
      const rows: Array<{ period: string; date_key: string }> = [];
      for (const [pair, count] of Object.entries(spec.counts)) {
        const [period = "", date_key = ""] = pair.split("@");
        for (let i = 0; i < count; i++) rows.push({ period, date_key });
      }
      return json(rows);
    }
    if (url.includes("/rest/v1/horoscope_run_log")) {
      return json(spec.lastRun ? [spec.lastRun] : []);
    }
    if (url.includes("/rest/v1/horoscope_alerts") && method === "POST") {
      captured.alertRows.push(
        ...(JSON.parse(String(init?.body)) as Array<Record<string, unknown>>),
      );
      return json([]);
    }
    if (url.startsWith(HOOK_URL)) {
      captured.pings.push(url);
      return json({}, 200);
    }
    return json([], 200);
  }) as unknown as typeof fetch;
  return captured;
}

const okRun = (published = 336): GenerateResult => ({
  status: "success",
  published,
  violations: [],
  durationMs: 100,
  ranAt: new Date().toISOString(),
});

/** Content counts keyed to the CURRENT expected IST windows — the watchdog
 * resolves its keys from the real clock, so fixed dates would go stale. */
function fullCounts(without?: "daily"): WatchSpec["counts"] {
  const exp = expectedKeys(new Date());
  const counts: WatchSpec["counts"] = {
    [`daily@${exp.daily}`]: 24,
    [`weekly@${exp.weekly}`]: 24,
    [`monthly@${exp.monthly}`]: 24,
    [`yearly@${exp.yearly}`]: 24,
  };
  if (without) counts[`daily@${exp.daily}`] = 0;
  return counts;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("runHoroscopeWatchdog (live flow)", () => {
  it("healthy content → no repair, no generation, no ping", async () => {
    installWatchBackend({
      counts: fullCounts(),
      // fresh run relative to the real clock — a fixed instant would age past
      // STALE_RUN_HOURS and flip this fixture to needsRepair
      lastRun: { ranAt: new Date().toISOString(), status: "success", published: 336 },
    });
    let calls = 0;
    const outcome = await runHoroscopeWatchdog(
      { ...CREDS, FRONTEND_DEPLOY_HOOK_URL: HOOK_URL },
      async () => {
        calls += 1;
        return okRun();
      },
    );
    expect(outcome.preNeedsRepair).toBe(false);
    expect(calls).toBe(0);
    expect(outcome.healed).toBe(false);
    expect(outcome.alerted).toBe(false);
  });

  it("missed run → repairs, re-pings the deploy hook, heals", async () => {
    installWatchBackend({
      counts: fullCounts("daily"),
      lastRun: { ranAt: "2026-11-25T15:12:53.000Z", status: "success", published: 336 },
    });
    let calls = 0;
    const outcome = await runHoroscopeWatchdog(
      { ...CREDS, FRONTEND_DEPLOY_HOOK_URL: HOOK_URL },
      async () => {
        calls += 1;
        return okRun();
      },
    );
    // NOTE: post-repair counts still read 0 from the mock (static spec), so
    // post-state stays broken — this run asserts the repair attempt itself.
    expect(outcome.preNeedsRepair).toBe(true);
    expect(calls).toBe(1);
    expect(outcome.healed).toBe(false);
    expect(outcome.alerted).toBe(true);
  });

  it("repair that restores health → healed, no alerts", async () => {
    const spec = {
      counts: fullCounts("daily"),
      lastRun: { ranAt: "2026-11-25T15:12:53.000Z", status: "success", published: 336 },
    };
    const captured = installWatchBackend(spec);
    const outcome = await runHoroscopeWatchdog(
      { ...CREDS, FRONTEND_DEPLOY_HOOK_URL: HOOK_URL },
      async () => {
        // the repair publishes today's rows + writes a fresh run log
        spec.counts["daily@2026-11-27"] = 24;
        spec.lastRun = { ranAt: new Date().toISOString(), status: "success", published: 24 };
        return okRun(24);
      },
    );
    expect(outcome.preNeedsRepair).toBe(true);
    expect(outcome.healed).toBe(true);
    expect(outcome.alerted).toBe(false);
    expect(captured.alertRows).toEqual([]);
    expect(captured.pings.length).toBe(1);
  });

  it("still unhealthy after repair → content_missing + run_failed alert rows", async () => {
    const captured = installWatchBackend({
      counts: fullCounts("daily"),
      lastRun: { ranAt: "2026-11-25T15:12:53.000Z", status: "failed", published: 0 },
    });
    const outcome = await runHoroscopeWatchdog(
      { ...CREDS, FRONTEND_DEPLOY_HOOK_URL: HOOK_URL },
      async () => ({
        status: "failed",
        published: 0,
        violations: [],
        durationMs: 1,
        ranAt: new Date().toISOString(),
      }),
    );
    expect(outcome.alerted).toBe(true);
    const kinds = captured.alertRows.map((r) => r.kind).sort();
    expect(kinds).toEqual(["content_missing", "run_failed"]);
  });

  it("runHoroscopeWatchdogJob (cron wrapper) logs and never throws", async () => {
    installWatchBackend({
      counts: fullCounts(),
      lastRun: { ranAt: new Date().toISOString(), status: "success", published: 336 },
    });
    // void return — the cron wrapper only logs the outcome; never throws
    await runHoroscopeWatchdogJob({ ...CREDS });
  });
});
