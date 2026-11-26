-- 0018_catalog_phase4.sql — Admin Phase 4 (catalog lifecycle + listing consent)
-- Story: _bmad-output/admin/stories/phase-4-catalog-settings-newsletter-nav/story.md
-- Winston §6 (soft delete + consent gate) and review amendment [R2]: the
-- public-read RLS floors tighten WITH the new gates so an unconsented sample
-- astrologer and a soft-deleted row are invisible at the data layer (anon
-- PostgREST), not just filtered by the API ("never only by hiding buttons").
-- Additive-only. Pre-apply snapshots: backup_0018_astrologers / backup_0018_pujas
-- / backup_0018_newsletter_subscribers. Applied once via Supabase MCP against
-- vyotish-dev (owgszyhxvyomxyxhoeed). Do NOT re-run.

-- ---- astrologers: Hindi copy, listing consent, soft delete ----
alter table astrologers
  add column if not exists title_hi text,
  add column if not exists about_hi text,
  add column if not exists listing_consent_confirmed_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- ---- pujas: Hindi description, gallery images, dakshina-on-request, soft delete ----
alter table pujas
  add column if not exists description_hi text,
  add column if not exists images jsonb not null default '[]'::jsonb,
  add column if not exists dakshina_on_request boolean not null default false,
  add column if not exists deleted_at timestamptz;

-- partial indexes matching both public (RLS-filtered) and admin (deleted_at
-- is null) listings
create index if not exists astrologers_live_sort_idx on astrologers (sort_order) where deleted_at is null;
create index if not exists pujas_live_sort_idx on pujas (sort_order) where deleted_at is null;

-- ---- public-read floors ----
drop policy if exists "astrologers_public_read" on astrologers;
create policy "astrologers_public_read" on astrologers
  for select using (
    is_active = true
    and listing_consent_confirmed_at is not null
    and deleted_at is null
  );

drop policy if exists "pujas_public_read" on pujas;
create policy "pujas_public_read" on pujas
  for select using (is_active = true and deleted_at is null);

-- ---- stable admin ordering: reseed sort_order 10,20,30… preserving the
-- current relative order (gives /reorder deterministic slot arithmetic) ----
with ranked as (
  select id, row_number() over (order by sort_order asc, name asc) as rn
  from astrologers
)
update astrologers a set sort_order = r.rn * 10 from ranked r where a.id = r.id;

with ranked as (
  select id, row_number() over (order by sort_order asc, name asc) as rn
  from pujas
)
update pujas p set sort_order = r.rn * 10 from ranked r where p.id = r.id;
