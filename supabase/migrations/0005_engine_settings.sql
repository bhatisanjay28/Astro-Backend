-- 0005_engine_settings.sql — Epic 1.9 (PRD §8 engine configurability)
-- Public engine-configuration rows in site_settings (RLS public-read for
-- `public.%` keys already exists from 0001). Admin-managed later (Epic 6.4).
-- Apply ONCE via the Supabase MCP — do NOT re-run.

insert into site_settings (key, value) values
  ('public.engine_ayanamsha',    '"lahiri"'::jsonb),
  ('public.engine_month_system', '"purnimanta"'::jsonb),
  ('public.engine_house_system', '"whole_sign"'::jsonb),
  ('public.engine_chart_style',  '"north_indian"'::jsonb)
on conflict (key) do nothing;
