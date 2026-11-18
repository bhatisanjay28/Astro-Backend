-- ============================================================================
-- Vyotish-Astro — Schema V1 (Epic 0.4)
-- 20 tables from PRD §10. RLS enabled on EVERY table (D3), deny-by-default:
--   public:  read public content only; insert own requests only
--   admin/editor: via inline user_roles EXISTS (no stored functions — D3)
--   service_role (backend only): bypasses RLS by Supabase design
-- No triggers/business logic in DB — all owned by the backend (D3).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- cities (GeoNames-derived; PRD §8 — no per-request geocoding APIs)
-- ----------------------------------------------------------------------------
create table cities (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  name_hi       text,
  country_code  text not null default 'IN',
  admin1        text,
  latitude      numeric(9, 6) not null check (latitude between -90 and 90),
  longitude     numeric(9, 6) not null check (longitude between -180 and 180),
  timezone      text not null, -- IANA tz (PRD §8)
  geonames_id   bigint unique,
  population    integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index cities_country_idx on cities (country_code);
create index cities_name_idx on cities (name);

-- ----------------------------------------------------------------------------
-- profiles & user_roles (Supabase Auth, administered through the backend — D4)
-- ----------------------------------------------------------------------------
create table profiles (
  id            uuid primary key, -- = auth.users.id
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table user_roles (
  user_id     uuid primary key references profiles (id) on delete cascade,
  role        text not null check (role in ('admin', 'editor')),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- astrologers (sample data until real — PRD §5.1)
-- ----------------------------------------------------------------------------
create table astrologers (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  photo_url         text,
  about             text,
  expertise         text[] not null default '{}',
  languages         text[] not null default '{}',
  experience_years  integer check (experience_years >= 0),
  price_per_minute  numeric(10, 2) check (price_per_minute >= 0),
  session_types     jsonb not null default '[]', -- [{type, duration_min}]
  rating_avg        numeric(3, 2), -- stays NULL until real reviews exist (P17)
  is_active         boolean not null default true,
  is_sample         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- consultation_requests (PRD §5.1 — anon can insert own only)
-- ----------------------------------------------------------------------------
create table consultation_requests (
  id                      uuid primary key default gen_random_uuid(),
  astrologer_id           uuid references astrologers (id) on delete set null,
  name                    text not null,
  phone                   text not null,
  email                   text,
  topic                   text not null,
  preferred_date          date,
  preferred_time          text,
  birth_details           jsonb, -- optional, only with explicit consent
  birth_details_consent   boolean not null default false,
  message                 text,
  status                  text not null default 'new'
                          check (status in ('new', 'contacted', 'scheduled', 'closed')),
  created_at              timestamptz not null default now()
);
create index consultation_requests_created_idx on consultation_requests (created_at desc);
create index consultation_requests_status_idx on consultation_requests (status);

-- ----------------------------------------------------------------------------
-- horoscopes (content in DB, admin-editable, schedulable — PRD §5.2)
-- ----------------------------------------------------------------------------
create table horoscopes (
  id           uuid primary key default gen_random_uuid(),
  sign         text not null check (sign in (
                 'aries','taurus','gemini','cancer','leo','virgo',
                 'libra','scorpio','sagittarius','capricorn','aquarius','pisces')),
  period       text not null check (period in
                 ('yesterday','daily','tomorrow','weekly','monthly','yearly')),
  date_key     text not null default 'rolling', -- ISO date for dated items, 'rolling' otherwise
  lang         text not null default 'en' check (lang in ('en', 'hi')),
  overview     text,
  love         text,
  career       text,
  finance      text,
  health       text,
  status       text not null default 'draft' check (status in ('draft', 'published')),
  publish_at   timestamptz,
  is_sample    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (sign, period, date_key, lang)
);
create index horoscopes_lookup_idx on horoscopes (sign, period, lang, status);

-- ----------------------------------------------------------------------------
-- panchang_cache (deterministic per city+date — PRD §8/§10; service-role only)
-- ----------------------------------------------------------------------------
create table panchang_cache (
  city_id      uuid not null references cities (id) on delete cascade,
  date         date not null,
  timezone     text not null,
  payload      jsonb not null,
  engine_version text not null,
  computed_at  timestamptz not null default now(),
  primary key (city_id, date)
);

-- ----------------------------------------------------------------------------
-- festivals & vrats
-- ----------------------------------------------------------------------------
create table festivals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_hi     text,
  date        date, -- exact Gregorian date (solar festivals)
  month_rule  jsonb, -- lunar/tithi-based rule for recurring festivals
  description text,
  is_sample   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index festivals_date_idx on festivals (date);

-- ----------------------------------------------------------------------------
-- muhurat_rules (rules as data with documented sources — PRD §5.4; Jyotishi
-- review required before public launch P11)
-- ----------------------------------------------------------------------------
create table muhurat_rules (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null check (event_type in (
                 'marriage','engagement','griha_pravesh','vehicle','property',
                 'business','naamkaran','mundan','annaprashan','travel')),
  rule_name    text not null,
  conditions   jsonb not null, -- structured rule payload interpreted by the engine
  source_doc   text not null, -- documented source of each rule (PRD §5.4)
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index muhurat_rules_event_idx on muhurat_rules (event_type);

-- ----------------------------------------------------------------------------
-- pujas & puja_requests (PRD §5.6)
-- ----------------------------------------------------------------------------
create table pujas (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  name_hi        text,
  category       text not null, -- graha_shanti | satyanarayan | griha_pravesh | rudrabhishek | navagraha | kaal_sarp | other
  purpose        text,
  samagri        jsonb not null default '[]',
  duration       text,
  mode           text[] not null default '{}', -- online | home | temple
  sample_price   numeric(10, 2),
  muhurat_note   text,
  description    text,
  is_sample      boolean not null default true,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index pujas_category_idx on pujas (category);

create table puja_requests (
  id           uuid primary key default gen_random_uuid(),
  puja_id      uuid references pujas (id) on delete set null,
  name         text not null,
  gotra        text,
  phone        text not null,
  email        text,
  date         date,
  location     text,
  language     text,
  message      text,
  status       text not null default 'new'
               check (status in ('new', 'contacted', 'scheduled', 'closed')),
  created_at   timestamptz not null default now()
);
create index puja_requests_created_idx on puja_requests (created_at desc);

-- ----------------------------------------------------------------------------
-- blog (PRD §7 — posts/categories/tags/media; soft delete)
-- ----------------------------------------------------------------------------
create table blog_categories (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique,
  name  text not null
);

create table blog_tags (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique,
  name  text not null
);

create table blog_posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  title            text not null,
  content_md       text not null,
  excerpt          text,
  featured_image_url text,
  alt_text         text,
  author_id        uuid, -- admin user id; not FK to profiles to allow editorial flow
  status           text not null default 'draft'
                   check (status in ('draft', 'published', 'archived')),
  publish_at       timestamptz,
  seo_title        text,
  seo_description  text,
  canonical_url    text,
  og_image_url     text,
  reading_minutes  integer check (reading_minutes >= 0),
  deleted_at       timestamptz, -- soft delete
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index blog_posts_public_idx on blog_posts (status, publish_at desc)
  where deleted_at is null;
create index blog_posts_slug_idx on blog_posts (slug);

create table post_tags (
  post_id  uuid not null references blog_posts (id) on delete cascade,
  tag_id   uuid not null references blog_tags (id) on delete cascade,
  primary key (post_id, tag_id)
);

create table media (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid,
  bucket      text not null,
  path        text not null,
  mime        text,
  size_bytes  bigint,
  alt         text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- newsletter & contact (PRD §6/§7 — anon insert only)
-- ----------------------------------------------------------------------------
create table newsletter_subscribers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  confirmed_at     timestamptz,
  unsubscribed_at  timestamptz,
  source           text,
  created_at       timestamptz not null default now()
);

create table contact_messages (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  subject      text,
  message      text not null,
  status       text not null default 'new' check (status in ('new', 'read', 'closed')),
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- site_settings (drives GEMSTONES_SITE_URL etc. — PRD §5.8, §7)
-- ----------------------------------------------------------------------------
create table site_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- audit_log (admin actions — PRD §14)
-- ----------------------------------------------------------------------------
create table audit_log (
  id          bigint generated always as identity primary key,
  actor       uuid,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY — enabled on every table (D3, PRD §14)
-- Inline user_roles EXISTS subqueries (no stored functions).
-- ============================================================================
alter table cities                 enable row level security;
alter table profiles               enable row level security;
alter table user_roles             enable row level security;
alter table astrologers            enable row level security;
alter table consultation_requests  enable row level security;
alter table horoscopes             enable row level security;
alter table panchang_cache         enable row level security;
alter table festivals              enable row level security;
alter table muhurat_rules          enable row level security;
alter table pujas                  enable row level security;
alter table puja_requests          enable row level security;
alter table blog_categories        enable row level security;
alter table blog_tags              enable row level security;
alter table blog_posts             enable row level security;
alter table post_tags              enable row level security;
alter table media                  enable row level security;
alter table newsletter_subscribers enable row level security;
alter table contact_messages       enable row level security;
alter table site_settings          enable row level security;
alter table audit_log              enable row level security;

-- cities: public read
create policy "cities_public_read" on cities
  for select using (true);

-- profiles: read own; staff read all
create policy "profiles_read_own" on profiles
  for select using (auth.uid() = id);
create policy "profiles_staff_read" on profiles
  for select using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- user_roles: read own only (admins manage via backend/service)
create policy "user_roles_read_own" on user_roles
  for select using (auth.uid() = user_id);

-- astrologers: public read of active entries; staff full CRUD
create policy "astrologers_public_read" on astrologers
  for select using (is_active = true);
create policy "astrologers_staff_all" on astrologers
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- consultation_requests: anyone can INSERT their own request; no public select;
-- staff read/update
create policy "consultation_requests_public_insert" on consultation_requests
  for insert with check (true);
create policy "consultation_requests_staff_read" on consultation_requests
  for select using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );
create policy "consultation_requests_staff_update" on consultation_requests
  for update using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- horoscopes: public read of published; staff full CRUD
create policy "horoscopes_public_read" on horoscopes
  for select using (status = 'published');
create policy "horoscopes_staff_all" on horoscopes
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- panchang_cache: NO client policies at all — service-role (backend) only
-- festivals: public read; staff CRUD
create policy "festivals_public_read" on festivals
  for select using (true);
create policy "festivals_staff_all" on festivals
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- muhurat_rules: NO public read (engine reads via service); staff read
create policy "muhurat_rules_staff_read" on muhurat_rules
  for select using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- pujas: public read of active; staff CRUD
create policy "pujas_public_read" on pujas
  for select using (is_active = true);
create policy "pujas_staff_all" on pujas
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- puja_requests: insert-only for public; staff read/update
create policy "puja_requests_public_insert" on puja_requests
  for insert with check (true);
create policy "puja_requests_staff_read" on puja_requests
  for select using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );
create policy "puja_requests_staff_update" on puja_requests
  for update using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- blog public read
create policy "blog_categories_public_read" on blog_categories
  for select using (true);
create policy "blog_categories_staff_all" on blog_categories
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

create policy "blog_tags_public_read" on blog_tags
  for select using (true);
create policy "blog_tags_staff_all" on blog_tags
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

create policy "blog_posts_public_read" on blog_posts
  for select using (status = 'published' and deleted_at is null);
create policy "blog_posts_staff_all" on blog_posts
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

create policy "post_tags_public_read" on post_tags
  for select using (true);
create policy "post_tags_staff_all" on post_tags
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- media: staff only
create policy "media_staff_all" on media
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- newsletter_subscribers: public insert own; staff read (export via backend)
create policy "newsletter_public_insert" on newsletter_subscribers
  for insert with check (true);
create policy "newsletter_staff_read" on newsletter_subscribers
  for select using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- contact_messages: public insert; staff read/update
create policy "contact_public_insert" on contact_messages
  for insert with check (true);
create policy "contact_staff_read" on contact_messages
  for select using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );
create policy "contact_staff_update" on contact_messages
  for update using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- site_settings: public read only for explicitly public keys; staff manage
create policy "site_settings_public_read" on site_settings
  for select using (key like 'public.%');
create policy "site_settings_staff_all" on site_settings
  for all using (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  ) with check (
    exists (select 1 from user_roles ur
            where ur.user_id = auth.uid() and ur.role in ('admin','editor'))
  );

-- audit_log: no client policies (service-role writes; staff read via backend)
