-- ============================================================================
-- Document intelligence — structured representation of each document.
--
-- Beyond extracted text + flashcards, we persist a per-page / per-block / per-
-- asset model so the document becomes navigable, citable, searchable, indexable
-- and transformable into study tools:
--   • page classification + quality  → route only the pages that need OCR/vision
--   • blocks (text/heading/table/figure/formula/caption) with bbox + reading
--     order + source + confidence → viewer highlight, page-anchored flashcards,
--     clickable outline, internal search, precise citations, SEO, occlusion.
--   • assets (figures/tables/formulas) with crop + user approval → image
--     occlusion works on curated assets, not the whole PDF.
--   • outline entries with multi-signal provenance + QC.
--   • quality report per document (drives commercial surfacing + gating).
--
-- All tables are owner-scoped (RLS) and indexed on document_id. Heavy analysis
-- runs in a background worker (pdf_processing_jobs); these tables are its output.
-- ============================================================================

-- ---- Page classification / profile ---------------------------------------
-- pdf_pages already holds native_text, ocr_status, has_images/tables/formulas.
-- Add the "profile" the pipeline assigns to each page.
alter table public.pdf_pages
  add column if not exists page_class text check (page_class is null or page_class in (
    'digital_text', 'scanned', 'mixed', 'figure_heavy', 'table_heavy',
    'formula_heavy', 'low_text', 'index_candidate', 'low_ocr_quality', 'blank'
  )),
  add column if not exists is_index_candidate boolean not null default false,
  add column if not exists ocr_confidence numeric(5,2) check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 100)),
  add column if not exists block_count integer not null default 0 check (block_count >= 0),
  add column if not exists asset_count integer not null default 0 check (asset_count >= 0);

create index if not exists pdf_pages_class_idx on public.pdf_pages (document_id, page_class);

-- ---- document_blocks (the core structured unit) --------------------------
create table if not exists public.document_blocks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  block_type text not null check (block_type in (
    'paragraph', 'heading', 'title', 'list', 'table', 'figure', 'formula', 'caption', 'footnote', 'other'
  )),
  text text,
  -- Normalised bbox [x, y, width, height] in 0..1 page coordinates.
  bbox jsonb,
  reading_order integer,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source text not null default 'native' check (source in ('native', 'tesseract', 'ocrmypdf', 'docling', 'paddle', 'vision')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists document_blocks_doc_page_idx on public.document_blocks (document_id, page_number, reading_order);
create index if not exists document_blocks_type_idx on public.document_blocks (document_id, block_type);

-- ---- document_assets (figures / tables / formulas as reusable assets) -----
create table if not exists public.document_assets (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  asset_type text not null check (asset_type in ('figure', 'table', 'formula', 'chart', 'scheme', 'diagram')),
  bbox jsonb,
  storage_bucket text default 'derived-previews',
  storage_path text,
  caption text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source text not null default 'layout_detection' check (source in ('layout_detection', 'vision', 'manual')),
  approved_by_user boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists document_assets_doc_idx on public.document_assets (document_id, page_number);
create index if not exists document_assets_type_idx on public.document_assets (document_id, asset_type);

-- ---- ocr_runs (per-run OCR metadata, for cache + audit) -------------------
create table if not exists public.ocr_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  engine text not null check (engine in ('tesseract', 'ocrmypdf', 'docling', 'paddle')),
  pages integer[] not null default '{}',
  mean_confidence numeric(5,2),
  chars_recovered integer not null default 0 check (chars_recovered >= 0),
  language text,
  status text not null default 'succeeded' check (status in ('queued', 'running', 'succeeded', 'failed')),
  cost_usd numeric(10,5) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ocr_runs_doc_idx on public.ocr_runs (document_id, created_at desc);

-- ---- document_outline (structured, multi-signal index) --------------------
create table if not exists public.document_outline (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  level integer not null default 1 check (level between 1 and 4),
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end > 0),
  ordinal integer not null default 0,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- Which signals produced this entry: ['bookmark','font','layout','pattern','llm_validation'].
  sources text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists document_outline_doc_idx on public.document_outline (document_id, ordinal);

-- ---- document_quality_reports (drives gating + public surfacing) ----------
create table if not exists public.document_quality_reports (
  document_id uuid primary key references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  native_text_quality numeric(5,2),      -- 0..100
  ocr_quality numeric(5,2),
  scanned_pages_pct numeric(5,2),
  figures_detected integer not null default 0,
  tables_detected integer not null default 0,
  formulas_detected integer not null default 0,
  outline_reliable boolean not null default false,
  readability numeric(5,2),
  overall_score numeric(5,2),             -- 0..100, the headline quality number
  issues jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

-- Broaden the job vocabulary so the worker can queue the new stages.
alter table public.pdf_processing_jobs
  drop constraint if exists pdf_processing_jobs_job_type_check;
alter table public.pdf_processing_jobs
  add constraint pdf_processing_jobs_job_type_check
  check (job_type in ('compress', 'extract', 'ocr', 'flashcards', 'quality_review', 'classify', 'layout', 'figures', 'outline'));

-- ---- RLS: owner-scoped read/write on all new tables -----------------------
alter table public.document_blocks enable row level security;
alter table public.document_assets enable row level security;
alter table public.ocr_runs enable row level security;
alter table public.document_outline enable row level security;
alter table public.document_quality_reports enable row level security;

-- Owners read their own document intelligence. Writes happen via the service
-- role (worker), so only SELECT policies are exposed to `authenticated`.
do $$
declare t text;
begin
  foreach t in array array['document_blocks','document_assets','ocr_runs','document_outline','document_quality_reports']
  loop
    execute format('drop policy if exists "Owners read own %1$s" on public.%1$s', t);
    execute format('create policy "Owners read own %1$s" on public.%1$s for select to authenticated using ((select auth.uid()) = owner_id)', t);
  end loop;
end $$;
