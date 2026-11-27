-- 0019_horoscope_alerts.sql
-- S23 cron-repair: horoscope watchdog alert store. The watchdog cron (06:20 IST)
-- writes a row when today's IST content is still missing or the last generation
-- run still failed after a repair attempt; /health surfaces open alerts and the
-- published content dates. Service-role access only (RLS enabled, no policies),
-- matching horoscopes / horoscope_run_log / horoscope_library.
-- Applied to the remote project via the Supabase MCP (same-day as commit).
create table if not exists horoscope_alerts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('content_missing', 'run_failed')),
  detail      jsonb not null default '{}'::jsonb,
  resolved_at timestamptz
);

create index if not exists horoscope_alerts_open_idx
  on horoscope_alerts (created_at desc) where resolved_at is null;

alter table horoscope_alerts enable row level security;
