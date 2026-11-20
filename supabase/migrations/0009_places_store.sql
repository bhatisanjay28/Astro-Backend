-- 0009_places_store.sql — birthplace integration hardening (owner directive
-- 2026-11-20: every selected place is validated, stored, and returned in
-- structured form; worldwide city coverage without waiting on a Google key).
--
-- 1) `places` — resolved-place store. Reference data ONLY (a place is public
--    knowledge); no user records and no birth records (PRD §10 no-PII).
--    Rows are written by /places/resolve (city or Google source) and read back
--    as a resolution cache so repeat selections skip upstream calls.
-- 2) `cities` — add full country name ("city, state, country" suggestions) and
--    the indexes needed once the Geonames worldwide seed (~75k rows) lands:
--    pg_trgm GIN for substring search, population for relevance ranking.
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('google','cities')),
  place_id text not null unique,
  name text not null,
  admin1 text,
  country text,
  country_code text,
  latitude double precision not null check (latitude >= -90 and latitude <= 90),
  longitude double precision not null check (longitude >= -180 and longitude <= 180),
  timezone text not null,
  label text not null,
  hits integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.places enable row level security;
create index if not exists places_country_idx on public.places (country_code);

create extension if not exists pg_trgm;
create index if not exists cities_name_trgm_idx on public.cities using gin (name gin_trgm_ops);
create index if not exists cities_population_idx on public.cities (population desc nulls last);

alter table public.cities add column if not exists country text;
-- search_names = name + capped alternate names (exonyms like "Calcutta",
-- romanizations, native scripts) so typed variants find the right city.
alter table public.cities add column if not exists search_names text;
create index if not exists cities_search_trgm_idx on public.cities using gin (search_names gin_trgm_ops);
