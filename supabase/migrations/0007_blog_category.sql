-- Epic 6.2 — Post category link. blog_posts (0001) had categories as a
-- standalone table without a FK; PRD §7 requires per-post category + category
-- pages. Additive change only.

alter table public.blog_posts
  add column if not exists category_id uuid references public.blog_categories (id) on delete set null;

create index if not exists blog_posts_category_idx on public.blog_posts (category_id)
  where deleted_at is null;
