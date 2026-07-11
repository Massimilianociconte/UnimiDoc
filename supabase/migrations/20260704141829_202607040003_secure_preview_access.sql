-- ============================================================================
-- Secure document preview + access control.
--
-- Threat model: a viewer who has not purchased a document must NEVER receive
-- the original PDF bytes. They only ever get short-lived signed URLs to
-- pre-rendered, watermarked page IMAGES stored in the private `derived-previews`
-- bucket. Full access (all pages / original download) requires ownership or a
-- purchase, subject to the document's preview_policy.
--
-- Serving is done by the `document-access` Edge Function (service role), which
-- checks entitlement before signing any URL. Direct client reads remain limited
-- by the owner-scoped storage RLS from 202607030001.
-- ============================================================================

-- Rendered, watermarked preview page images (the only artifact served to
-- non-owners). Row-level metadata lets the access function decide what to sign.
create table if not exists public.document_previews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  storage_bucket text not null default 'derived-previews',
  storage_path text not null,
  is_free_preview boolean not null default false,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  watermarked boolean not null default true,
  created_at timestamptz not null default now(),
  unique (document_id, page_number)
);
create index if not exists document_previews_document_idx on public.document_previews (document_id, page_number);

-- A purchase grants a buyer access to the full set of previews (and to the
-- original download when the document's preview_policy allows it).
create table if not exists public.document_purchases (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  credits_spent integer not null default 0 check (credits_spent >= 0),
  created_at timestamptz not null default now(),
  unique (document_id, buyer_id)
);
create index if not exists document_purchases_buyer_idx on public.document_purchases (buyer_id, created_at desc);

alter table public.document_previews enable row level security;
alter table public.document_purchases enable row level security;

-- Owners can read their own preview rows directly; everyone else goes through
-- the access Edge Function (service role), which signs specific images only.
drop policy if exists "Owners read own preview rows" on public.document_previews;
create policy "Owners read own preview rows" on public.document_previews for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Buyers read own purchases" on public.document_purchases;
create policy "Buyers read own purchases" on public.document_purchases for select to authenticated
  using ((select auth.uid()) = buyer_id);

drop policy if exists "Buyers create own purchases" on public.document_purchases;
create policy "Buyers create own purchases" on public.document_purchases for insert to authenticated
  with check ((select auth.uid()) = buyer_id);
