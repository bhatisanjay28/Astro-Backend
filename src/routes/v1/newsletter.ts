/**
 * POST /api/v1/newsletter — public subscribe endpoint (Epic 5.5; PRD §6 home
 * newsletter block + §5.8 gemstones "Notify Me" share it with a source tag).
 *
 * Body: { email: string, source?: string }
 *  - source whitelist: gemstones_notify | weekly_panchang | website
 * Upsert on email conflict: a previously unsubscribed address re-activates
 * (unsubscribed_at cleared); the newest source wins.
 *
 * NOTE (Epic 7.2): Cloudflare Turnstile + WAF rate-limiting wrap this endpoint
 * at the edge; a defensive in-memory throttle below covers same-isolate bursts
 * only (documented limitation — Workers isolates are per-colo).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SOURCES = new Set(["gemstones_notify", "weekly_panchang", "website"]);

/** Same-isolate throttle: 5 requests per IP per 10 minutes. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return true;
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) {
    for (const [k, v] of recent) {
      if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
    }
  }
  return false;
}

export const newsletterRoute = new Hono<AppEnv>();

newsletterRoute.post("/newsletter", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (throttled(ip)) {
    return c.json(
      { error: { code: "rate_limited", message: "Too many requests. Try again later." } },
      429,
    );
  }

  let body: { email?: unknown; source?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "validation_error", message: "Body must be JSON" } }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const source = typeof body.source === "string" ? body.source : "website";

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return c.json(
      { error: { code: "validation_error", message: "A valid email is required" } },
      400,
    );
  }
  if (!SOURCES.has(source)) {
    return c.json(
      {
        error: {
          code: "validation_error",
          message: "source must be one of: gemstones_notify, weekly_panchang, website",
        },
      },
      400,
    );
  }

  const supabaseUrl = c.env?.SUPABASE_URL;
  const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return c.json(
      {
        error: {
          code: "service_unavailable",
          message:
            "Subscriptions require backend database credentials, which are not configured yet.",
        },
      },
      503,
    );
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/newsletter_subscribers?on_conflict=email`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ email, source, unsubscribed_at: null }),
  });

  if (!res.ok) {
    return c.json(
      { error: { code: "internal_error", message: "Could not save subscription" } },
      500,
    );
  }
  return c.json({ data: { subscribed: true } }, 200);
});
