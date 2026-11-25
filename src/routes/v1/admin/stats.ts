/**
 * Admin Phase 2 — dashboard stats (03-winston-architecture §9). Counts only,
 * no PII — every role has stats.read (02 §C) so viewer-safe by construction.
 *
 * This endpoint is the dashboard's source of truth: Mary's audit (01) found
 * the old cards counting the wrong sets (all posts instead of published vs
 * drafts; ALL astrologers instead of active ones). Card labels must match
 * what these numbers actually count. A failed count is a 500, never a
 * silent zero (honest states).
 */
import { Hono } from "hono";
import type { AppEnvWithAdmin } from "../../../env";
import { requireCapability } from "../../../lib/admin-auth";
import { restList, type SupabaseCreds, supabaseCreds } from "../../../lib/supabase";

type Env = AppEnvWithAdmin;

export const adminStatsRoute = new Hono<Env>();

interface StatsShape {
  posts: { published: number; draft: number; trashed: number };
  astrologers: { active: number; inactive: number };
  pujas: { active: number };
  inbox: { new: number; older_24h: number; scheduled_today: number; closed_7d: number };
  subscribers: { confirmed: number; unsubscribed: number };
  media: { count: number };
}

async function gather(
  creds: SupabaseCreds,
  dayWindow: string,
  today: string,
  dayAgo: string,
  weekAgo: string,
): Promise<StatsShape> {
  const one = async (query: string): Promise<number> => {
    const listing = await restList(creds, query);
    if (!listing.ok) throw new Error(`stats: count failed for ${query.split("?")[0]}`);
    return listing.total;
  };

  const [
    postsPublished,
    postsDraft,
    postsTrashed,
    astroActive,
    astroInactive,
    pujasActive,
    inboxNewC,
    inboxNewP,
    inboxOlderC,
    inboxOlderP,
    inboxTodayC,
    inboxTodayP,
    inboxClosed7dC,
    inboxClosed7dP,
    subsConfirmed,
    subsUnsub,
    mediaCount,
  ] = await Promise.all([
    one("blog_posts?select=id&status=eq.published&deleted_at=is.null"),
    one("blog_posts?select=id&status=eq.draft&deleted_at=is.null"),
    one("blog_posts?select=id&deleted_at=not.is.null"),
    one("astrologers?select=id&is_active=eq.true"),
    one("astrologers?select=id&is_active=eq.false"),
    one("pujas?select=id&is_active=eq.true"),
    // inbox.new = unarchived, non-test, status=new across both request kinds
    one("consultation_requests?select=id&status=eq.new&is_test=eq.false&archived_at=is.null"),
    one("puja_requests?select=id&status=eq.new&is_test=eq.false&archived_at=is.null"),
    // older than 24h and still awaiting first action (new/contacted) — the
    // site's 24–48h response promise (owner-confirmed wording)
    one(
      `consultation_requests?select=id&status=in.(new,contacted)&is_test=eq.false&archived_at=is.null&created_at=lt.${dayAgo}`,
    ),
    one(
      `puja_requests?select=id&status=in.(new,contacted)&is_test=eq.false&archived_at=is.null&created_at=lt.${dayAgo}`,
    ),
    // scheduled today: scheduled_for within today OR the table's own date
    // column = today (consultation preferred_date, puja `date` — story
    // review #6; `preferred_date` does not exist on puja_requests)
    one(
      `consultation_requests?select=id&status=eq.scheduled&or=(${dayWindow},preferred_date.eq.${today})&archived_at=is.null`,
    ),
    one(
      `puja_requests?select=id&status=eq.scheduled&or=(${dayWindow},date.eq.${today})&archived_at=is.null`,
    ),
    // closed in the last 7 days, per the closed_at stamp (0015)
    one(`consultation_requests?select=id&status=eq.closed&closed_at=gte.${weekAgo}`),
    one(`puja_requests?select=id&status=eq.closed&closed_at=gte.${weekAgo}`),
    one("newsletter_subscribers?select=email&confirmed_at=not.is.null&unsubscribed_at=is.null"),
    one("newsletter_subscribers?select=email&unsubscribed_at=not.is.null"),
    one("media?select=id"),
  ]);

  return {
    posts: { published: postsPublished, draft: postsDraft, trashed: postsTrashed },
    astrologers: { active: astroActive, inactive: astroInactive },
    pujas: { active: pujasActive },
    inbox: {
      new: inboxNewC + inboxNewP,
      older_24h: inboxOlderC + inboxOlderP,
      scheduled_today: inboxTodayC + inboxTodayP,
      closed_7d: inboxClosed7dC + inboxClosed7dP,
    },
    subscribers: { confirmed: subsConfirmed, unsubscribed: subsUnsub },
    media: { count: mediaCount },
  };
}

adminStatsRoute.get("/admin/stats", requireCapability("stats.read"), async (c) => {
  const creds = supabaseCreds(c);
  if (!creds) {
    return c.json(
      { error: { code: "service_unavailable", message: "Stats require backend credentials." } },
      503,
    );
  }

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const t0 = new Date(now);
  t0.setHours(0, 0, 0, 0);
  const t1 = new Date(now);
  t1.setHours(23, 59, 59, 999);
  const today = t0.toISOString().slice(0, 10);
  const dayWindow = `and(scheduled_for.gte.${t0.toISOString()},scheduled_for.lte.${t1.toISOString()})`;

  let data: StatsShape;
  try {
    data = await gather(creds, dayWindow, today, dayAgo, weekAgo);
  } catch {
    return c.json({ error: { code: "internal_error", message: "Could not compute stats." } }, 500);
  }
  return c.json({ data });
});
