-- ============================================================================
-- Extended document metadata collected in the upload form.
--
-- Mirrors the new fields in src/data.ts DocumentItem so the public material page
-- and SEO/GEO markup can be served from the DB. university and degree_course are
-- constant for the L-13 catalog but stored explicitly for clean querying and
-- future multi-course support.
-- ============================================================================

alter table public.documents
  add column if not exists description text check (description is null or char_length(description) <= 2000),
  add column if not exists exam_type text,
  add column if not exists semester text,
  add column if not exists degree_course text not null default 'Scienze Biologiche (L-13)',
  add column if not exists university text not null default 'Università degli Studi di Milano',
  add column if not exists tags text[] not null default '{}',
  add column if not exists compatible_exams text[] not null default '{}',
  -- Auto-extracted SEO/GEO metadata (keywords/topics/abstract/flags/level).
  add column if not exists insights jsonb;

-- Full-text-ish search helpers: index tags and the course/professor for the
-- internal search and the material pages.
create index if not exists documents_tags_idx on public.documents using gin (tags);
create index if not exists documents_course_prof_idx on public.documents (course_name, professor);
