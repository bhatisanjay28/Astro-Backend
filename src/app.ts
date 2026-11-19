import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./env";
import { apiRoute } from "./routes/api";
import { healthRoute } from "./routes/health";
import { v1Route } from "./routes/v1";
import { citiesRoute } from "./routes/v1/cities";
import { contentRoute } from "./routes/v1/content";
import { horoscopeRoute } from "./routes/v1/horoscope";
import { kundliRoute } from "./routes/v1/kundli";
import { muhuratRoute } from "./routes/v1/muhurat";
import { newsletterRoute } from "./routes/v1/newsletter";
import { panchangRoute } from "./routes/v1/panchang";
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

app.route("/", healthRoute);
app.route("/", apiRoute);
app.route("/api/v1", v1Route);
app.route("/api/v1", panchangRoute);
app.route("/api/v1", muhuratRoute);
app.route("/api/v1", kundliRoute);
app.route("/api/v1", horoscopeRoute);
app.route("/api/v1", newsletterRoute);
app.route("/api/v1", citiesRoute);
app.route("/api/v1", contentRoute);
app.route("/api/v1", settingsRoute);

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
