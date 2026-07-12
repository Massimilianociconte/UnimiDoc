-- Catalogo insegnamenti per tutti i CdL triennali della Statale (fonte
-- unimi.it, piani didattici offerta più recente; docenti dall'edizione attiva
-- più recente del medesimo CdS). Dati pubblici di catalogo: lettura
-- anon+authenticated, scrittura solo service role.

create table if not exists public.degree_courses (
  id uuid primary key default gen_random_uuid(),
  degree_slug text not null references public.degree_programs(slug) on update cascade on delete cascade,
  name text not null,
  unimi_slug text not null,
  curriculum text,
  year_number smallint not null default 0,
  year_label text,
  period text,
  grouping text,
  cfu numeric,
  total_hours integer,
  language text,
  ssd text,
  academic_year text not null default '2026/2027',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.professors (
  id uuid primary key default gen_random_uuid(),
  unimi_slug text not null unique,
  full_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.degree_course_teachers (
  course_id uuid not null references public.degree_courses(id) on delete cascade,
  professor_id uuid not null references public.professors(id) on delete cascade,
  role text not null default 'docente',
  primary key (course_id, professor_id)
);

create index if not exists degree_courses_degree_slug_idx on public.degree_courses (degree_slug, sort_order);
create index if not exists degree_course_teachers_professor_idx on public.degree_course_teachers (professor_id);

alter table public.degree_courses enable row level security;
alter table public.professors enable row level security;
alter table public.degree_course_teachers enable row level security;

drop policy if exists degree_courses_public_read on public.degree_courses;
create policy degree_courses_public_read on public.degree_courses
  for select to anon, authenticated using (true);
drop policy if exists professors_public_read on public.professors;
create policy professors_public_read on public.professors
  for select to anon, authenticated using (true);
drop policy if exists degree_course_teachers_public_read on public.degree_course_teachers;
create policy degree_course_teachers_public_read on public.degree_course_teachers
  for select to anon, authenticated using (true);

revoke all on public.degree_courses from anon, authenticated;
revoke all on public.professors from anon, authenticated;
revoke all on public.degree_course_teachers from anon, authenticated;
grant select on public.degree_courses to anon, authenticated;
grant select on public.professors to anon, authenticated;
grant select on public.degree_course_teachers to anon, authenticated;
