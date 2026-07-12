#!/usr/bin/env python3
"""Genera le migration SQL (schema + seed) dal catalog.json dello scraper.
Output: file numerati in ./sql/ pronti per apply_migration, più un riepilogo."""

import json
import os
import re
import uuid

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRATCH, 'sql')
os.makedirs(OUT, exist_ok=True)

data = json.load(open(os.path.join(SCRATCH, 'catalog.json')))
catalog, teachers = data['catalog'], data['teachers']


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def qn(s):
    return q(s) if s not in (None, '') else 'null'


def num(s):
    m = re.match(r'^\d+(?:[.,]\d+)?$', str(s).strip())
    return str(s).strip().replace(',', '.') if m else 'null'


SCHEMA = """-- Catalogo insegnamenti per tutti i CdL triennali della Statale (fonte
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
"""

open(os.path.join(OUT, '01_schema.sql'), 'w').write(SCHEMA)

# --- Professori unici -------------------------------------------------------
prof_ids = {}
prof_rows = []
for key, t in teachers.items():
    for p in t['teachers']:
        if p['slug'] not in prof_ids:
            pid = str(uuid.uuid5(uuid.NAMESPACE_URL, 'unimidoc-prof:' + p['slug']))
            prof_ids[p['slug']] = pid
            prof_rows.append(f"({q(pid)}, {q(p['slug'])}, {q(p['name'])})")

# --- Righe corso + junction --------------------------------------------------
course_values = []
teacher_values = []
n_courses = 0
degrees_with_rows = set()
for slug, rows in sorted(catalog.items()):
    if not rows:
        continue
    degrees_with_rows.add(slug)
    for i, r in enumerate(rows):
        cid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"unimidoc-course:{slug}|{r['href']}|{r['curriculum']}|{r['year']}|{r['period']}|{r['grouping']}|{i}"))
        unimi_slug = r['href'].rsplit('/', 1)[-1]
        hours = num(r['hours'])
        course_values.append(
            f"({q(cid)}, {q(slug)}, {q(r['name'])}, {q(unimi_slug)}, {qn(r['curriculum'])}, "
            f"{r['year']}, {qn(r['year_label'])}, {qn(r['period'])}, {qn(r['grouping'])}, "
            f"{num(r['cfu'])}, {hours if hours == 'null' else str(int(float(hours)))}, {qn(r['lang'])}, {qn(r['ssd'])}, {i})"
        )
        n_courses += 1
        t = teachers.get(f"{slug}|{r['href']}")
        if t:
            for p in t['teachers']:
                teacher_values.append(f"({q(cid)}, {q(prof_ids[p['slug']])}, {q(p['role'])})")

# --- Scrittura file seed a chunk ---------------------------------------------


def write_chunks(prefix, header, values, chunk_size):
    files = []
    for n, start in enumerate(range(0, len(values), chunk_size), 1):
        chunk = values[start:start + chunk_size]
        path = os.path.join(OUT, f'{prefix}_{n:02d}.sql')
        open(path, 'w').write(header + ',\n'.join(chunk) + '\non conflict do nothing;\n')
        files.append(path)
    return files


# Reset per idempotenza del seed (i dati sono interamente rigenerabili)
open(os.path.join(OUT, '02_reset.sql'), 'w').write(
    'delete from public.degree_course_teachers;\ndelete from public.degree_courses;\ndelete from public.professors;\n')

prof_files = write_chunks(
    '03_professors',
    'insert into public.professors (id, unimi_slug, full_name) values\n',
    prof_rows, 1500)
course_files = write_chunks(
    '04_courses',
    'insert into public.degree_courses (id, degree_slug, name, unimi_slug, curriculum, year_number, year_label, period, grouping, cfu, total_hours, language, ssd, sort_order) values\n',
    course_values, 900)
teacher_files = write_chunks(
    '05_teachers',
    'insert into public.degree_course_teachers (course_id, professor_id, role) values\n',
    teacher_values, 2500)

ready = "', '".join(sorted(degrees_with_rows))
open(os.path.join(OUT, '06_catalog_ready.sql'), 'w').write(
    f"update public.degree_programs set catalog_ready = true, updated_at = now() where slug in ('{ready}');\n")

print(f"professori: {len(prof_rows)} | righe corso: {n_courses} | junction: {len(teacher_values)}")
print(f"CdL con catalogo: {len(degrees_with_rows)}/72 | senza: {sorted(set(catalog) - degrees_with_rows)}")
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)))
