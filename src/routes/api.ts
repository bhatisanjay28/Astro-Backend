import { Hono } from "hono";
import type { AppEnv } from "../env";

/**
 * GET /api — API info. Preserved from the original scaffold.
 */
export const apiRoute = new Hono<AppEnv>().get("/api", (c) =>
  c.json({
    data: {
      name: "Vyotish-Astro API",
      version: "v1",
      description:
        "All business logic and database access for Vyotish live here (DECISIONS.md D2/D3).",
      endpoints: {
        health: "GET /health",
        api: "GET /api",
        v1: "GET /api/v1",
      },
    },
  }),
);
