import { Hono } from "hono";
import type { AppEnv } from "./env";
import { apiRoute } from "./routes/api";
import { healthRoute } from "./routes/health";
import { v1Route } from "./routes/v1";
import { kundliRoute } from "./routes/v1/kundli";
import { panchangRoute } from "./routes/v1/panchang";

const app = new Hono<AppEnv>();

app.route("/", healthRoute);
app.route("/", apiRoute);
app.route("/api/v1", v1Route);
app.route("/api/v1", panchangRoute);
app.route("/api/v1", kundliRoute);

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
