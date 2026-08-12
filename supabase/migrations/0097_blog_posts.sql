-- Blog articles for ssj.in's /blog section. Previously hardcoded in
-- ssj-website's src/blog/posts.js, edited by redeploy only. This table lets
-- staff create/edit/schedule articles via a CRM admin screen with no
-- deploy — ssj-website's api/sitemap.js and blog pages now fetch from
-- ssjbots' api/blog.js instead of importing a static file.
--
-- `body` mirrors the block-array shape the frontend already renders:
-- [{ h2 }, { h3 }, { p }, { ul: [...] }, { quote }] — kept as jsonb so the
-- admin editor and the public renderer share one format with zero mapping.
-- `published_at` in the future = scheduled, not yet public — matches the
-- isPublished() gate that used to live client-side in posts.js.

create table public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.ssj_tenant_id(),
  slug             text not null,
  category         text not null,
  title            text not null,
  description      text not null,
  hero_image       text not null,
  hero_image_alt   text not null,
  cta_heading      text,
  cta_text         text,
  cta_href         text,
  cta_label        text,
  body             jsonb not null default '[]'::jsonb,
  published_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  created_by       text
);

create unique index blog_posts_tenant_slug_idx on public.blog_posts (tenant_id, slug);
create index blog_posts_published_idx on public.blog_posts (tenant_id, published_at);

alter table public.blog_posts enable row level security;
create policy anon_tenant on public.blog_posts for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());
