-- 0015_inbox_workflow.sql — Phase 2 (admin panel program).
-- One-way inbox status workflow with verification-before-close, scheduling,
-- assignment, notes and test/archive flags (03-winston-architecture §4).
--
-- ADDITIVE ONLY: CHECK widening + new columns + one new table + one backfill.
-- No column is dropped; every existing row stays valid ('closed' remains a
-- legal value and stays terminal). Backup: _bmad-output/admin/backups/
-- 2026-11-26-pre-0015.json. Test rows are FLAGGED (is_test), never deleted
-- (owner decision D2 — purge remains owner-gated).
--
-- NOTE: request ids are UUID on both request tables (verified live), so
-- request_notes.request_id is uuid — not bigint as the architecture doc
-- first sketched.

-- 1. Widen status CHECKs (drop + re-add; names verified in the live DB).
alter table public.consultation_requests
  drop constraint if exists consultation_requests_status_check;
alter table public.consultation_requests
  add constraint consultation_requests_status_check
  check (status in ('new', 'contacted', 'scheduled', 'completed', 'closed', 'cancelled'));

alter table public.puja_requests
  drop constraint if exists puja_requests_status_check;
alter table public.puja_requests
  add constraint puja_requests_status_check
  check (status in ('new', 'contacted', 'scheduled', 'completed', 'closed', 'cancelled'));

alter table public.contact_messages
  drop constraint if exists contact_messages_status_check;
alter table public.contact_messages
  add constraint contact_messages_status_check
  check (status in ('new', 'read', 'closed', 'cancelled'));

-- 2. Workflow columns on both request tables.
-- closed_at: stamped by the transition handler on status→closed — gives the
-- dashboard's closed_7d stat a real source (story review finding 2).
alter table public.consultation_requests
  add column if not exists scheduled_for timestamptz,
  add column if not exists assignee_id uuid references public.admin_users (user_id) on delete set null,
  add column if not exists is_test boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.admin_users (user_id) on delete set null,
  add column if not exists closed_reason text,
  add column if not exists closed_at timestamptz;

alter table public.puja_requests
  add column if not exists scheduled_for timestamptz,
  add column if not exists assignee_id uuid references public.admin_users (user_id) on delete set null,
  add column if not exists is_test boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.admin_users (user_id) on delete set null,
  add column if not exists closed_reason text,
  add column if not exists closed_at timestamptz;

alter table public.contact_messages
  add column if not exists is_test boolean not null default false,
  add column if not exists archived_at timestamptz;

-- 3. Internal notes: multi-note history (never a single mutable column).
create table if not exists public.request_notes (
  id bigserial primary key,
  request_kind text not null check (request_kind in ('consultation', 'puja', 'message')),
  request_id uuid not null,
  author_id uuid references public.admin_users (user_id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists request_notes_request_idx
  on public.request_notes (request_kind, request_id, created_at desc);

-- 4. Staff RLS on notes (same rank-helper floors as phase 1): editor-tier+
-- read/write; the backend service-role path is the real gate anyway.
alter table public.request_notes enable row level security;

drop policy if exists "request_notes_staff_read" on public.request_notes;
create policy "request_notes_staff_read" on public.request_notes
  for select using (public.admin_role_rank(auth.uid()) >= 3);

drop policy if exists "request_notes_staff_write" on public.request_notes;
create policy "request_notes_staff_write" on public.request_notes
  for insert with check (public.admin_role_rank(auth.uid()) >= 3);

-- 5. Backfill: the QA S18 rows (phone 9999999999) become test-flagged —
-- hidden by default in the panel, purge still owner-gated (D2).
update public.consultation_requests set is_test = true where phone = '9999999999';
update public.puja_requests set is_test = true where phone = '9999999999';
