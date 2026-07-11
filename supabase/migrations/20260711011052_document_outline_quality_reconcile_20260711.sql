-- ============================================================================
-- Document outline quality metadata.
--
-- The first document_intelligence migration created document_outline as a flat
-- list. The improved parser now emits a hierarchy with provenance/evidence, so
-- persist parent links, source block references and quality metadata without
-- changing existing RLS semantics.
-- ============================================================================

alter table public.document_outline
  add column if not exists parent_id uuid references public.document_outline(id) on delete set null,
  add column if not exists source_block_ids uuid[] not null default '{}',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists document_outline_parent_idx on public.document_outline (parent_id);
create index if not exists document_outline_source_blocks_gin_idx on public.document_outline using gin (source_block_ids);
create index if not exists document_outline_metadata_gin_idx on public.document_outline using gin (metadata jsonb_path_ops);

alter table public.document_quality_reports
  add column if not exists outline_confidence numeric(5,4) check (outline_confidence is null or (outline_confidence >= 0 and outline_confidence <= 1)),
  add column if not exists outline_strategy text check (outline_strategy is null or outline_strategy in ('native', 'layout', 'section', 'page', 'hybrid')),
  add column if not exists outline_ai_recommended boolean not null default false;
