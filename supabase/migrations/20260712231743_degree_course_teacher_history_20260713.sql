-- Conserva la relazione docente-insegnamento per anno accademico, anziché
-- mantenere soltanto l'ultima edizione trovata. Il campo sul corso continua a
-- indicare l'edizione più recente e rende economica la query principale.

alter table public.degree_course_teachers
  add column if not exists academic_year text;

update public.degree_course_teachers link
set academic_year = coalesce(course.teachers_academic_year, course.academic_year)
from public.degree_courses course
where course.id = link.course_id
  and link.academic_year is null;

alter table public.degree_course_teachers
  alter column academic_year set not null;

alter table public.degree_course_teachers
  drop constraint if exists degree_course_teachers_pkey;
alter table public.degree_course_teachers
  add constraint degree_course_teachers_pkey
  primary key (course_id, professor_id, academic_year);

create index if not exists degree_course_teachers_course_year_idx
  on public.degree_course_teachers (course_id, academic_year);
