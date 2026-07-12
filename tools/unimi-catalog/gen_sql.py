#!/usr/bin/env python3
"""Genera schema e seed SQL dal catalogo ufficiale UniMi validato.

L'output viene scritto in ``./sql`` e rispecchiato in
``supabase/seed/degree_catalog``. Nessun dato esterno o ``extra_*`` viene
caricato: i corsi privi di piano strutturato UniMi restano a inserimento libero.
"""

import hashlib
import json
import os
import re
import shutil
import uuid
from pathlib import Path

SCRATCH = Path(__file__).resolve().parent
OUT = SCRATCH / 'sql'
MIRROR = SCRATCH.parents[1] / 'supabase' / 'seed' / 'degree_catalog'
OUT.mkdir(parents=True, exist_ok=True)
MIRROR.mkdir(parents=True, exist_ok=True)
for directory in (OUT, MIRROR):
    for path in directory.glob('*.sql'):
        path.unlink()
    for name in ('manifest.json', 'README.md'):
        path = directory / name
        if path.exists():
            path.unlink()

data = json.load(open(SCRATCH / 'catalog.json'))
catalog, teachers = data['catalog'], data['teachers']
metadata = data.get('metadata', {})
plan_academic_year = metadata.get('plan_academic_year', '2026/2027')
batch_id = str(uuid.uuid5(
    uuid.NAMESPACE_URL,
    f"unimidoc-degree-catalog:{metadata.get('generated_at')}:{plan_academic_year}",
))


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def qn(s):
    return q(s) if s not in (None, '') else 'null'


def num(s):
    m = re.match(r'^\d+(?:[.,]\d+)?$', str(s).strip())
    return str(s).strip().replace(',', '.') if m else 'null'


SCHEMA = f"""-- Catalogo insegnamenti per CdL triennali e magistrali a ciclo unico
-- della Statale (fonte esclusiva: unimi.it; piano A.A. {plan_academic_year}).
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
  academic_year text not null default {q(plan_academic_year)},
  teachers_academic_year text,
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
  academic_year text not null,
  primary key (course_id, professor_id, academic_year)
);

alter table public.degree_courses add column if not exists teachers_academic_year text;
alter table public.degree_course_teachers add column if not exists academic_year text;
update public.degree_course_teachers link
set academic_year = coalesce(course.teachers_academic_year, course.academic_year)
from public.degree_courses course
where course.id = link.course_id and link.academic_year is null;
alter table public.degree_course_teachers alter column academic_year set not null;
alter table public.degree_course_teachers drop constraint if exists degree_course_teachers_pkey;
alter table public.degree_course_teachers
  add constraint degree_course_teachers_pkey primary key (course_id, professor_id, academic_year);

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

(OUT / '01_schema.sql').write_text(SCHEMA, encoding='utf-8')

# --- Professori unici -------------------------------------------------------
prof_ids = {}
prof_rows = []
for result in teachers.values():
    editions = result.get('history') or ([result] if result.get('teachers') else [])
    for edition in editions:
        for p in edition['teachers']:
            if p['slug'] not in prof_ids:
                pid = str(uuid.uuid5(uuid.NAMESPACE_URL, 'unimidoc-prof:' + p['slug']))
                prof_ids[p['slug']] = pid
                prof_rows.append(f"({q(batch_id)}, {q(pid)}, {q(p['slug'])}, {q(p['name'])})")

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
        t = teachers.get(f"{slug}|{r['href']}")
        # A.A. dell'edizione dei docenti: valorizzato solo se abbiamo trovato
        # almeno un docente (altrimenti null → "non ancora pubblicato" in UI).
        teach_aa = t['aa'] if (t and t.get('teachers') and t.get('aa')) else None
        course_values.append(
            f"({q(batch_id)}, {q(cid)}, {q(slug)}, {q(r['name'])}, {q(unimi_slug)}, {qn(r['curriculum'])}, "
            f"{r['year']}, {qn(r['year_label'])}, {qn(r['period'])}, {qn(r['grouping'])}, "
            f"{num(r['cfu'])}, {hours if hours == 'null' else str(int(float(hours)))}, {qn(r['lang'])}, {qn(r['ssd'])}, {q(plan_academic_year)}, {qn(teach_aa)}, {i})"
        )
        n_courses += 1
        if t:
            editions = t.get('history') or ([t] if t.get('teachers') else [])
            for edition in editions:
                if not edition.get('aa'):
                    continue
                for p in edition['teachers']:
                    teacher_values.append(
                        f"({q(batch_id)}, {q(cid)}, {q(prof_ids[p['slug']])}, {q(p['role'])}, {q(edition['aa'])})"
                    )

# --- Scrittura file seed a chunk ---------------------------------------------


def write_chunks(prefix, header, values, chunk_size):
    files = []
    for n, start in enumerate(range(0, len(values), chunk_size), 1):
        chunk = values[start:start + chunk_size]
        path = OUT / f'{prefix}_{n:02d}.sql'
        path.write_text(header + ',\n'.join(chunk) + '\non conflict do nothing;\n', encoding='utf-8')
        files.append(path)
    return files


ready_values = ', '.join(q(slug) for slug in sorted(degrees_with_rows))
(OUT / '02_batch.sql').write_text(
    'insert into private.degree_catalog_import_batches '
    '(id, expected_professors, expected_courses, expected_teacher_links, ready_slugs, source_domain, plan_academic_year, generated_at) values\n'
    f"({q(batch_id)}, {len(prof_rows)}, {n_courses}, {len(teacher_values)}, "
    f"array[{ready_values}]::text[], {q(metadata.get('source_domain'))}, {q(plan_academic_year)}, {q(metadata.get('generated_at'))}::timestamptz)\n"
    'on conflict (id) do nothing;\n',
    encoding='utf-8')

prof_files = write_chunks(
    '03_professors',
    'insert into private.degree_catalog_professors_stage (batch_id, id, unimi_slug, full_name) values\n',
    prof_rows, 1500)
course_files = write_chunks(
    '04_courses',
    'insert into private.degree_catalog_courses_stage (batch_id, id, degree_slug, name, unimi_slug, curriculum, year_number, year_label, period, grouping, cfu, total_hours, language, ssd, academic_year, teachers_academic_year, sort_order) values\n',
    course_values, 900)
teacher_files = write_chunks(
    '05_teachers',
    'insert into private.degree_catalog_teachers_stage (batch_id, course_id, professor_id, role, academic_year) values\n',
    teacher_values, 2500)

(OUT / '06_finalize.sql').write_text(
    f"select private.finalize_degree_catalog_import({q(batch_id)}::uuid);\n",
    encoding='utf-8',
)

readme = f"""# Seed catalogo UniMi

Generato automaticamente da `tools/unimi-catalog/gen_sql.py`.
Fonte esclusiva: `unimi.it`; piano A.A. {plan_academic_year}.
Programmi: {len(catalog)}; cataloghi strutturati: {len(degrees_with_rows)}.
I file `02`-`05` caricano un batch riprendibile nelle tabelle private; soltanto
`06_finalize.sql` valida i conteggi e sostituisce atomicamente il catalogo live.
"""
(OUT / 'README.md').write_text(readme, encoding='utf-8')

manifest = {
    'generated_at': metadata.get('generated_at'),
    'source_domain': metadata.get('source_domain'),
    'plan_academic_year': plan_academic_year,
    'batch_id': batch_id,
    'programs': len(catalog),
    'ready_programs': len(degrees_with_rows),
    'professors': len(prof_rows),
    'course_rows': n_courses,
    'teacher_links': len(teacher_values),
    'files': {},
}
for path in sorted(OUT.glob('*.sql')):
    manifest['files'][path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

for path in OUT.iterdir():
    if path.is_file():
        shutil.copy2(path, MIRROR / path.name)

print(f"professori: {len(prof_rows)} | righe corso: {n_courses} | junction: {len(teacher_values)}")
print(f"CdL con catalogo: {len(degrees_with_rows)}/{len(catalog)} | senza: {sorted(set(catalog) - degrees_with_rows)}")
for path in sorted(OUT.iterdir()):
    print(path.name, path.stat().st_size)
