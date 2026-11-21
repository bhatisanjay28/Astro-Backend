import app from "./app";
import { warmPanchangCache } from "./cron";

/**
 * Worker entry point (production: `wrangler deploy`).
 * The Hono app's fetch handler is the Worker fetch export; the cron trigger
 * (wrangler.jsonc) warms/prunes the panchang cache daily (Epic 3.1b).
 */
export default {
  fetch: app.fetch,
  scheduled: (event: unknown, env: unknown) => {
    void warmPanchangCache(env as never).catch((err) => console.error("[cron] failed:", err));
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
