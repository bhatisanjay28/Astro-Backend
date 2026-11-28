-- Admin Phase 5 — direct user creation & first-login password set (story
-- _bmad-output/admin/stories/phase-5-users-legal-cms).
-- must_change_password: set true by POST /admin/users (direct create); the
-- Super Admin shares a one-time server-generated temp password out-of-band and
-- requireAdmin() 403s every /admin/* route until the user clears the flag via
-- POST /auth/change-password. Service-role only table (RLS: no policies) —
-- the flag is admin plane, never user-writable.
alter table public.admin_users
  add column if not exists must_change_password boolean not null default false;
