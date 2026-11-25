-- 0016_admin_pii_floors.sql — Phase 2 pre-commit review, finding 2 (P2).
--
-- The rank-based SELECT floors (>= 1, i.e. viewer) on the request tables and
-- newsletter_subscribers let a low-privilege staffer bypass the API masking
-- layer (mask.ts) by calling PostgREST directly with their own JWT. The owner
-- requirement is "mask personal data (phone, email, birth details) for roles
-- that don't need it" — enforced server-side AND with RLS — so the DB layer
-- must agree with the API layer: only roles holding inbox.read_pii /
-- newsletter.read may SELECT these rows directly.
--
-- Rank alone cannot express this (content_editor and booking_manager both
-- rank 3, but only booking_manager holds read_pii), hence a role-list helper.
--
-- Additive: replaces 4 SELECT policies; no data touched. Backend reads keep
-- working — the API uses the service-role key, which bypasses RLS entirely.

-- 1. PII-read helper (same definer/stable/pinned-search_path shape as
--    admin_role_rank; EXECUTE revoked from all client roles).
create or replace function public.admin_can_read_pii(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from admin_users
     where user_id = uid
       and is_active
       and role in ('super_admin', 'admin', 'booking_manager')
  )
$$;

revoke execute on function public.admin_can_read_pii(uuid) from public;
revoke execute on function public.admin_can_read_pii(uuid) from anon, authenticated;

-- 2. Request tables: staff SELECT now requires a read_pii role. The anon
--    INSERT policies (public booking form) are untouched; staff UPDATE
--    policies stay at rank >= 3 (workflow writes are masked-role-safe — the
--    API is what governs which columns a write may set).
drop policy if exists "consultation_requests_staff_read" on public.consultation_requests;
create policy "consultation_requests_staff_read" on public.consultation_requests
  for select using (public.admin_can_read_pii(auth.uid()));

drop policy if exists "puja_requests_staff_read" on public.puja_requests;
create policy "puja_requests_staff_read" on public.puja_requests
  for select using (public.admin_can_read_pii(auth.uid()));

drop policy if exists "contact_staff_read" on public.contact_messages;
create policy "contact_staff_read" on public.contact_messages
  for select using (public.admin_can_read_pii(auth.uid()));

-- 3. Newsletter subscriber emails — same PII class, same set.
drop policy if exists "newsletter_staff_read" on public.newsletter_subscribers;
create policy "newsletter_staff_read" on public.newsletter_subscribers
  for select using (public.admin_can_read_pii(auth.uid()));
