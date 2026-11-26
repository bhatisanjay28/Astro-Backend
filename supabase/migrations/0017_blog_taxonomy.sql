-- 0017_blog_taxonomy.sql — Phase 3 additive columns (admin program).
-- Architecture §13 divergence (story note): display_order (not sort_order);
-- post_revisions / translation_of / status widening intentionally NOT here.
-- Additive only: new columns inherit the table-level RLS from 0014
-- (blog_posts_staff_all FOR ALL) — no policy changes needed.

alter table public.blog_categories
  add column if not exists name_hi text,
  add column if not exists description text,
  add column if not exists display_order integer not null default 0;

-- lang backfill is metadata-only in PG11+ (not null + default): existing
-- rows get 'en' without a table rewrite.
alter table public.blog_posts
  add column if not exists lang text not null default 'en'
    check (lang in ('en', 'hi'));
