import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./env";
import { rateLimitExceeded } from "./lib/rate-limit";
import { apiRoute } from "./routes/api";
import { healthRoute } from "./routes/health";
import { v1Route } from "./routes/v1";
import { adminRoute } from "./routes/v1/admin";
import { authRoute } from "./routes/v1/auth";
import { blogRoute } from "./routes/v1/blog";
import { calculatorsRoute } from "./routes/v1/calculators";
import { citiesRoute } from "./routes/v1/cities";
import { contentRoute } from "./routes/v1/content";
import { directoryRoute } from "./routes/v1/directory";
import { horoscopeRoute } from "./routes/v1/horoscope";
import { kundliRoute } from "./routes/v1/kundli";
import { matchRoute } from "./routes/v1/match";
import { muhuratRoute } from "./routes/v1/muhurat";
import { newsletterRoute } from "./routes/v1/newsletter";
import { panchangRoute } from "./routes/v1/panchang";
import { requestsRoute } from "./routes/v1/requests";
import { settingsRoute } from "./routes/v1/settings";

const app = new Hono<AppEnv>();

/**
 * CORS: origin allowlist (PRD §14). Production origins + local dev ports.
 * GET endpoints are public data; POST /api/v1/kundli is stateless and no-PII,
 * so no credentials are ever exchanged cross-origin.
 */
const ALLOWED_ORIGIN_PATTERN =
  /^https:\/\/(vyotish\.com|www\.vyotish\.com|.*\.vyotish\.workers\.dev)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  "/api/*",
  cors({ origin: (origin) => (ALLOWED_ORIGIN_PATTERN.test(origin) ? origin : null) }),
);

/**
 * Security headers on every API response (Epic 7.2, PRD §14). The API never
 * frames anything, so X-Frame-Options DENY is safe; the TLS termination is
 * Cloudflare's, which already enforces HTTPS on the workers.dev/vyotish.com.
 */
app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

/**
 * Best-effort rate limiting on abuse-prone POST endpoints (Epic 7.2):
 * login brute-force, newsletter and booking-request spam. Per-isolate in
 * Workers; volumetric defence stays with Cloudflare WAF (owner keys).
 */
app.use("/api/*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (rateLimitExceeded(c.req.path, ip, (c.env ?? {}) as Record<string, unknown>)) {
    return c.json(
      { error: { code: "rate_limited", message: "Too many requests — try again in a minute." } },
      429,
    );
  }
  await next();
});

app.route("/", healthRoute);
app.route("/", apiRoute);
app.route("/api/v1", v1Route);
app.route("/api/v1", panchangRoute);
app.route("/api/v1", muhuratRoute);
app.route("/api/v1", kundliRoute);
app.route("/api/v1", matchRoute);
app.route("/api/v1", calculatorsRoute);
app.route("/api/v1", horoscopeRoute);
app.route("/api/v1", newsletterRoute);
app.route("/api/v1", citiesRoute);
app.route("/api/v1", contentRoute);
app.route("/api/v1", settingsRoute);
app.route("/api/v1", directoryRoute);
app.route("/api/v1", requestsRoute);
app.route("/api/v1", authRoute);
app.route("/api/v1", blogRoute);
app.route("/api/v1", adminRoute);

/**
 * Contract v1 (docs/plan/epics.md): success `{ data, meta? }`;
 * error `{ error: { code, message, details? } }` with correct HTTP status.
 */
app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: `No route for ${c.req.method} ${c.req.path}`,
      },
    },
    404,
  ),
);

app.onError((err, c) => {
  // Never leak internals/secrets to clients (PRD §14); log details server-side.
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err);
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "Something went wrong. Please try again.",
      },
    },
    500,
  );
});

export default app;
