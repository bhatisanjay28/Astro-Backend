import app from "./app";

/**
 * Worker entry point (production: `wrangler deploy`).
 * The Hono app's fetch handler is the Worker default export.
 */
export default app;

/**
 * Local dev server via Bun (`bun run dev`) — DECISIONS.md D2.
 * Not executed on Cloudflare Workers (no Bun global there).
 */
if (typeof Bun !== "undefined") {
  const port = Number(process.env.PORT ?? 3000);
  const server = Bun.serve({ port, fetch: app.fetch });
  console.log(`astro-backend dev server → http://localhost:${server.port}`);
}
