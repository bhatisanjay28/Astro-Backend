import app from "./app";
import {
  cronJobFor,
  runHoroscopeGeneration,
  runHoroscopeWatchdogJob,
  warmPanchangCache,
} from "./cron";

/**
 * Worker entry point (production: `wrangler deploy`).
 * The Hono app's fetch handler is the Worker fetch export; three cron
 * triggers (wrangler.jsonc) dispatch via cronJobFor — each job gets its OWN
 * invocation (S23: chaining panchang warm + horoscope compose in one isolate
 * blew the CPU limit and silently killed the horoscope run every day):
 *   15 0 * * *  (05:45 IST) → panchang cache warm + prune
 *   35 18 * * * (00:05 IST) → horoscope generation + deploy-hook ping
 *   50 0 * * *  (06:20 IST) → watchdog (self-heal + alert)
 * Any unrecognised expression (ops one-off trigger) runs horoscope
 * generation too.
 */
export default {
  fetch: app.fetch,
  // ctx.waitUntil keeps the isolate alive until the async work settles —
  // returning before that lets Cloudflare kill a mid-run generation
  // (the horoscope pass composes ~800 ephemeris snapshots).
  scheduled: (
    event: { cron: string },
    env: unknown,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) => {
    const job = cronJobFor(event.cron);
    ctx.waitUntil(
      (async () => {
        if (job === "panchang") {
          await warmPanchangCache(env as never).catch((err) =>
            console.error("[cron] panchang warm failed:", err),
          );
          return;
        }
        if (job === "watchdog") {
          await runHoroscopeWatchdogJob(env as never).catch((err) =>
            console.error("[cron] horoscope watchdog failed:", err),
          );
          return;
        }
        await runHoroscopeGeneration(env as never).catch((err) =>
          console.error("[cron] horoscope generation failed:", err),
        );
      })(),
    );
  },
};

/**
 * Local dev server via Bun (`bun run dev`) — DECISIONS.md D2.
 * Not executed on Cloudflare Workers (no Bun global there), and gated on
 * import.meta.main so scripts that merely IMPORT this entry (QA runners)
 * don't boot a server and hold the event loop open.
 */
if (typeof Bun !== "undefined" && import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  // Workers receive bindings via c.env; in local Bun dev, supply process.env so
  // routes that need SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY can reach Supabase.
  const execCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  };
  const server = Bun.serve({
    port,
    fetch: (req) => app.fetch(req, process.env as unknown as Record<string, string>, execCtx),
  });
  console.log(`astro-backend dev server → http://localhost:${server.port}`);
}
