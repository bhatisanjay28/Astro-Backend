-- ============================================================================
-- 0014_admin_roles — Admin Phase 1 (users / roles / RLS / audit)
-- Design of record: _bmad-output/admin/03-winston-architecture.md §1–2;
-- permission matrix: 02-mary-gap-analysis.md §C.
--
-- What changes:
--   1. admin_users.role widens admin|editor → the 5-role model.
--   2. The single existing admin (vyotish@gmail.com) is promoted to super_admin.
--   3. admin_users gains is_active (deactivate flow) and display_name.
--   4. admin_role_rank(): security-definer helper so RLS policies can read
--      admin_users (admin_users itself stays RLS service-role-only).
--   5. Every staff policy is rewritten from the inert user_roles check
--      (table has 0 rows — policies matched nobody) to live admin_users ranks.
--      Coarse floors only: read = viewer(1)+, manage = editor-tier(3)+.
--      Fine-grained per-capability control lives in the backend middleware.
--   6. audit_log gains its first client policy (staff read, rank 3+).
--
-- All changes are additive; public policies and the user_roles table itself
-- are left untouched. Pre-migration snapshot: _bmad-output/admin/backups/.
-- ============================================================================

-- 1. Five-role model ---------------------------------------------------------
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check
  check (role in ('super_admin', 'admin', 'content_editor', 'booking_manager', 'viewer'));

-- 2. Owner promotion (single admin today — zero human impact) -----------------
update public.admin_users
   set role = 'super_admin', updated_at = now()
 where email = 'vyotish@gmail.com'
   and role <> 'super_admin';

-- 3. Lifecycle fields ----------------------------------------------------------
alter table public.admin_users
  add column if not exists is_active    boolean not null default true,
  add column if not exists display_name text;

comment on column public.admin_users.is_active is
  'false = deactivated via admin UI; requireAdmin rejects the account (backend also bans the auth user).';
comment on column public.admin_users.display_name is
  'Shown in the admin sidebar and audit log; optional.';

-- 4. Rank helper (definer: policies must read admin_users regardless of its
--    own RLS; stable: called per row scan) --------------------------------------
create or replace function public.admin_role_rank(uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(case role
           when 'super_admin'     then 5
           when 'admin'           then 4
           when 'content_editor'  then 3
           when 'booking_manager' then 3
           when 'viewer'          then 1
           else 0
         end), 0)
    from admin_users
   where user_id = uid
     and is_active
$$;

revoke execute on function public.admin_role_rank(uuid) from public;
revoke execute on function public.admin_role_rank(uuid) from anon, authenticated;
-- Postgres auto-grants EXECUTE to PUBLIC on function creation, so the revokes
-- above strip every grant path (PUBLIC + anon + authenticated) — anon clients
-- cannot RPC-probe admin ranks (QA phase-1 finding 2).

-- 5. Staff policy rewrite -------------------------------------------------------
-- floors: 1 = viewer can read staff-visible operational data (masked in UI),
--         3 = editor-tier can manage content/workflow rows.

drop policy if exists "profiles_staff_read" on public.profiles;
create policy "profiles_staff_read" on public.profiles
  for select using (public.admin_role_rank(auth.uid()) >= 1);

drop policy if exists "astrologers_staff_all" on public.astrologers;
create policy "astrologers_staff_all" on public.astrologers
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "consultation_requests_staff_read" on public.consultation_requests;
create policy "consultation_requests_staff_read" on public.consultation_requests
  for select using (public.admin_role_rank(auth.uid()) >= 1);

drop policy if exists "consultation_requests_staff_update" on public.consultation_requests;
create policy "consultation_requests_staff_update" on public.consultation_requests
  for update using (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "horoscopes_staff_all" on public.horoscopes;
create policy "horoscopes_staff_all" on public.horoscopes
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "festivals_staff_all" on public.festivals;
create policy "festivals_staff_all" on public.festivals
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "muhurat_rules_staff_read" on public.muhurat_rules;
create policy "muhurat_rules_staff_read" on public.muhurat_rules
  for select using (public.admin_role_rank(auth.uid()) >= 1);

drop policy if exists "pujas_staff_all" on public.pujas;
create policy "pujas_staff_all" on public.pujas
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "puja_requests_staff_read" on public.puja_requests;
create policy "puja_requests_staff_read" on public.puja_requests
  for select using (public.admin_role_rank(auth.uid()) >= 1);

drop policy if exists "puja_requests_staff_update" on public.puja_requests;
create policy "puja_requests_staff_update" on public.puja_requests
  for update using (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "blog_categories_staff_all" on public.blog_categories;
create policy "blog_categories_staff_all" on public.blog_categories
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "blog_tags_staff_all" on public.blog_tags;
create policy "blog_tags_staff_all" on public.blog_tags
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "blog_posts_staff_all" on public.blog_posts;
create policy "blog_posts_staff_all" on public.blog_posts
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "post_tags_staff_all" on public.post_tags;
create policy "post_tags_staff_all" on public.post_tags
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "media_staff_all" on public.media;
create policy "media_staff_all" on public.media
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "newsletter_staff_read" on public.newsletter_subscribers;
create policy "newsletter_staff_read" on public.newsletter_subscribers
  for select using (public.admin_role_rank(auth.uid()) >= 1);

drop policy if exists "contact_staff_read" on public.contact_messages;
create policy "contact_staff_read" on public.contact_messages
  for select using (public.admin_role_rank(auth.uid()) >= 1);

drop policy if exists "contact_staff_update" on public.contact_messages;
create policy "contact_staff_update" on public.contact_messages
  for update using (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "site_settings_staff_all" on public.site_settings;
create policy "site_settings_staff_all" on public.site_settings
  for all using (public.admin_role_rank(auth.uid()) >= 3)
  with check (public.admin_role_rank(auth.uid()) >= 3);

-- 6. audit_log: first client policy — staff (editor-tier+) can read the trail.
drop policy if exists "audit_log_staff_read" on public.audit_log;
create policy "audit_log_staff_read" on public.audit_log
  for select using (public.admin_role_rank(auth.uid()) >= 3);
