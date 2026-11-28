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
  // Phase 5 — first-login password set (needs a valid bearer, but it is a
  // password-bearing POST; keep it in the same class as login)
  "/api/v1/auth/change-password": { limit: 10, seconds: 60 },
  "/api/v1/newsletter": { limit: 5, seconds: 60 },
  "/api/v1/requests/consultation": { limit: 5, seconds: 60 },
  "/api/v1/requests/puja": { limit: 5, seconds: 60 },
  // place pickers type as they type — keep the Google bill bounded
  "/api/v1/places/autocomplete": { limit: 30, seconds: 60 },
  "/api/v1/places/resolve": { limit: 60, seconds: 60 },
};

const hits = new Map<string, { count: number; windowStart: number }>();

// occasional sweep so the Map cannot grow unbounded
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  const allWindows = WINDOWS as Record<string, WindowConfig | undefined>;
  const adminWindows = ADMIN_WINDOWS as Record<string, WindowConfig | undefined>;
  for (const [key, v] of hits) {
    // key shape: "<windows-scope>|<id>" — scope is the path (IP buckets) or
    // the admin bucket name (per-user buckets).
    const scope = key.split("|")[0] ?? "";
    const cfg = allWindows[scope] ?? adminWindows[scope];
    if (!cfg || now - v.windowStart > cfg.seconds * 1000) hits.delete(key);
  }
}

/**
 * Admin Phase 1 — per-user buckets, applied by requireCapability (writes)
 * and the export routes. Keyed by admin user id, not IP, because the panel
 * is small and one office NAT would otherwise throttle everyone together.
 */
export type AdminRateBucket = "admin:write" | "admin:export";

const ADMIN_WINDOWS: Record<AdminRateBucket, WindowConfig> = {
  "admin:write": { limit: 60, seconds: 60 },
  "admin:export": { limit: 5, seconds: 60 },
};

/** True when this admin user has exhausted the bucket in the current window. */
export function adminActionLimited(
  bucket: AdminRateBucket,
  userId: string,
  env: Record<string, unknown>,
): boolean {
  const cfg = ADMIN_WINDOWS[bucket];
  if (!cfg || !userId) return false;
  if (env.RATE_LIMIT_DISABLED) return false;
  const now = Date.now();
  sweep(now);
  const key = `${bucket}|${userId}`;
  const entry = hits.get(key);
  if (!entry || now - entry.windowStart > cfg.seconds * 1000) {
    hits.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > cfg.limit;
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
