-- Epic 6.1 — Admin auth foundation (DECISIONS.md D12: all data in Supabase).
-- Identity lives in Supabase Auth (auth.users); authorization lives here.
--
-- admin_users: one row per platform administrator/editor.
-- RLS is ENABLED with NO public policies — only the service-role key (backend)
-- can read it. Public write attempts are denied by default.
--
-- The first admin row is created by scripts/setup-first-admin.ts (never by
-- signup); further admins are promoted by an existing admin (Epic 6.4).

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       text not null default 'admin' check (role in ('admin', 'editor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.admin_users is
  'Platform admins (Epic 6.1). Identity in auth.users; service-role only.';

alter table public.admin_users enable row level security;

-- Keep updated_at fresh on role changes.
create or replace function public.touch_admin_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_users_touch_updated_at on public.admin_users;
create trigger admin_users_touch_updated_at
  before update on public.admin_users
  for each row execute function public.touch_admin_users_updated_at();
