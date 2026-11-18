import { Hono } from "hono";
import type { AppEnv } from "../env";

/**
 * GET /health — liveness probe. Preserved from the original scaffold.
 */
export const healthRoute = new Hono<AppEnv>().get("/health", (c) =>
  c.json({
    data: {
      status: "ok",
      service: "astro-backend",
      version: "0.2.0",
      env: c.env?.ENV ?? "development",
    },
  }),
);
