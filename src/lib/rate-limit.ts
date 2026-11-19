/**
 * Epic 7.2 — best-effort fixed-window rate limiter for abuse-prone POST
 * endpoints (login brute-force, newsletter/requests spam). In Workers this
 * is per-isolate memory (each edge may have several isolates), which still
 * blunts simple floods; real volumetric defence is Cloudflare WAF (7.2
 * follow-up with owner keys). Tests opt out via RATE_LIMIT_DISABLED.
 */

interface WindowConfig {
  limit: number;
  seconds: number;
}

const WINDOWS: Record<string, WindowConfig> = {
  "/api/v1/auth/login": { limit: 10, seconds: 60 },
  "/api/v1/auth/refresh": { limit: 20, seconds: 60 },
  "/api/v1/newsletter": { limit: 5, seconds: 60 },
  "/api/v1/requests/consultation": { limit: 5, seconds: 60 },
  "/api/v1/requests/puja": { limit: 5, seconds: 60 },
};

const hits = new Map<string, { count: number; windowStart: number }>();

// occasional sweep so the Map cannot grow unbounded
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, v] of hits) {
    const path = key.split("|")[0];
    const cfg = path ? WINDOWS[path] : undefined;
    if (cfg && now - v.windowStart > cfg.seconds * 1000) hits.delete(key);
  }
}

export function rateLimitExceeded(path: string, ip: string, env: Record<string, unknown>): boolean {
  const cfg = WINDOWS[path];
  if (!cfg) return false;
  if (env.RATE_LIMIT_DISABLED) return false;
  const now = Date.now();
  sweep(now);
  const key = `${path}|${ip}`;
  const entry = hits.get(key);
  if (!entry || now - entry.windowStart > cfg.seconds * 1000) {
    hits.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > cfg.limit;
}
