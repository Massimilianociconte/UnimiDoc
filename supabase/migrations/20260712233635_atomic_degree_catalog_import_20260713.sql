-- Import del catalogo in staging private: i chunk possono essere caricati in
-- piu richieste senza esporre un catalogo parziale. Solo finalize compie lo
-- swap, dopo aver verificato conteggi e integrita referenziale.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.degree_catalog_import_batches (
  id uuid primary key,
  expected_professors integer not null check (expected_professors >= 0),
  expected_courses integer not null check (expected_courses >= 0),
  expected_teacher_links integer not null check (expected_teacher_links >= 0),
  ready_slugs text[] not null,
  source_domain text not null,
  plan_academic_year text not null,
  generated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists private.degree_catalog_professors_stage (
  batch_id uuid not null references private.degree_catalog_import_batches(id) on delete cascade,
  id uuid not null,
  unimi_slug text not null,
  full_name text not null,
  primary key (batch_id, id),
  unique (batch_id, unimi_slug)
);

create table if not exists private.degree_catalog_courses_stage (
  batch_id uuid not null references private.degree_catalog_import_batches(id) on delete cascade,
  id uuid not null,
  degree_slug text not null,
  name text not null,
  unimi_slug text not null,
  curriculum text,
  year_number smallint not null,
  year_label text,
  period text,
  grouping text,
  cfu numeric,
  total_hours integer,
  language text,
  ssd text,
  academic_year text not null,
  teachers_academic_year text,
  sort_order integer not null,
  primary key (batch_id, id)
);

create table if not exists private.degree_catalog_teachers_stage (
  batch_id uuid not null references private.degree_catalog_import_batches(id) on delete cascade,
  course_id uuid not null,
  professor_id uuid not null,
  role text not null,
  academic_year text not null,
  primary key (batch_id, course_id, professor_id, academic_year)
);

create or replace function private.finalize_degree_catalog_import(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  batch private.degree_catalog_import_batches%rowtype;
  professor_count integer;
  course_count integer;
  teacher_link_count integer;
begin
  select * into batch
  from private.degree_catalog_import_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'degree_catalog_batch_not_found' using errcode = '22023';
  end if;

  select count(*) into professor_count
  from private.degree_catalog_professors_stage where batch_id = p_batch_id;
  select count(*) into course_count
  from private.degree_catalog_courses_stage where batch_id = p_batch_id;
  select count(*) into teacher_link_count
  from private.degree_catalog_teachers_stage where batch_id = p_batch_id;

  if professor_count <> batch.expected_professors
    or course_count <> batch.expected_courses
    or teacher_link_count <> batch.expected_teacher_links then
    raise exception 'degree_catalog_batch_count_mismatch'
      using errcode = '23514',
      detail = format('professors %s/%s, courses %s/%s, links %s/%s',
        professor_count, batch.expected_professors,
        course_count, batch.expected_courses,
        teacher_link_count, batch.expected_teacher_links);
  end if;

  if exists (
    select 1 from private.degree_catalog_courses_stage staged
    left join public.degree_programs program on program.slug = staged.degree_slug
    where staged.batch_id = p_batch_id and program.slug is null
  ) then
    raise exception 'degree_catalog_unknown_degree_slug' using errcode = '23503';
  end if;

  if exists (
    select 1 from private.degree_catalog_teachers_stage link
    left join private.degree_catalog_courses_stage course
      on course.batch_id = link.batch_id and course.id = link.course_id
    left join private.degree_catalog_professors_stage professor
      on professor.batch_id = link.batch_id and professor.id = link.professor_id
    where link.batch_id = p_batch_id
      and (course.id is null or professor.id is null)
  ) then
    raise exception 'degree_catalog_staging_fk_mismatch' using errcode = '23503';
  end if;

  delete from public.degree_course_teachers;
  delete from public.degree_courses;
  delete from public.professors;

  insert into public.professors (id, unimi_slug, full_name)
  select id, unimi_slug, full_name
  from private.degree_catalog_professors_stage
  where batch_id = p_batch_id;

  insert into public.degree_courses (
    id, degree_slug, name, unimi_slug, curriculum, year_number, year_label,
    period, grouping, cfu, total_hours, language, ssd, academic_year,
    teachers_academic_year, sort_order
  )
  select id, degree_slug, name, unimi_slug, curriculum, year_number, year_label,
    period, grouping, cfu, total_hours, language, ssd, academic_year,
    teachers_academic_year, sort_order
  from private.degree_catalog_courses_stage
  where batch_id = p_batch_id;

  insert into public.degree_course_teachers (
    course_id, professor_id, role, academic_year
  )
  select course_id, professor_id, role, academic_year
  from private.degree_catalog_teachers_stage
  where batch_id = p_batch_id;

  update public.degree_programs
  set catalog_ready = (slug = any(batch.ready_slugs)), updated_at = now();

  delete from private.degree_catalog_import_batches where id = p_batch_id;

  return jsonb_build_object(
    'professors', professor_count,
    'courses', course_count,
    'teacherLinks', teacher_link_count,
    'readyPrograms', cardinality(batch.ready_slugs)
  );
end;
$$;

revoke all on
  private.degree_catalog_import_batches,
  private.degree_catalog_professors_stage,
  private.degree_catalog_courses_stage,
  private.degree_catalog_teachers_stage
from public, anon, authenticated;
grant select, insert, update, delete on
  private.degree_catalog_import_batches,
  private.degree_catalog_professors_stage,
  private.degree_catalog_courses_stage,
  private.degree_catalog_teachers_stage
to service_role;
revoke all on function private.finalize_degree_catalog_import(uuid)
  from public, anon, authenticated;
grant execute on function private.finalize_degree_catalog_import(uuid)
  to service_role;
