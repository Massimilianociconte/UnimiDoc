-- Adds durable metadata used by upload/search filters and documents the Word-to-PDF upload path.
-- Source baseline: official UniMi Scienze biologiche L-13 A.A. 2025/2026 plan and Docenti page.

alter table public.l13_course_offerings
  add column if not exists cfu integer check (cfu is null or cfu > 0),
  add column if not exists semester text,
  add column if not exists course_year text,
  add column if not exists activity_type text,
  add column if not exists show_in_catalog boolean not null default true;

update public.l13_course_offerings
set
  course_name = 'Metodologie di indagine in biologia cellulare animale e istologia',
  course_slug = 'metodologie-di-indagine-in-biologia-cellulare-animale-e-istologia'
where course_slug = 'metodologie-di-indagine-in-biologia-cellulare-animale-e-istolgia';

insert into public.l13_course_offerings (
  course_name,
  course_slug,
  cohort_code,
  cohort_label,
  academic_year,
  source_course_url,
  is_elective,
  cfu,
  semester,
  course_year,
  activity_type,
  show_in_catalog
)
values
  (
    'Accertamento di lingua inglese B1',
    'accertamento-di-lingua-inglese-b1',
    'F62',
    'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)',
    '2025/2026',
    'https://scienzebiologiche.cdl.unimi.it/it/ugovcdl/of/cdsi20260000f62of3',
    false,
    3,
    'Non definito',
    '1 anno',
    'Accertamento',
    false
  ),
  (
    'Prova finale',
    'prova-finale',
    'F62',
    'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)',
    '2025/2026',
    'https://scienzebiologiche.cdl.unimi.it/it/ugovcdl/of/cdsi20260000f62of3',
    false,
    3,
    'Non definito',
    '3 anno',
    'Prova finale',
    false
  )
on conflict (course_slug, cohort_code, academic_year) do update set
  course_name = excluded.course_name,
  source_course_url = excluded.source_course_url,
  is_elective = excluded.is_elective,
  cfu = excluded.cfu,
  semester = excluded.semester,
  course_year = excluded.course_year,
  activity_type = excluded.activity_type,
  show_in_catalog = excluded.show_in_catalog;

with metadata(course_slug, cohort_code, academic_year, cfu, semester, course_year, activity_type, is_elective, show_in_catalog) as (
  values
    ('chimica-generale-con-elementi-di-chimica-fisica', 'FAI', '2025/2026', 6, '1 semestre', '1 anno', 'Obbligatorio', false, true),
    ('citologia-e-istologia', 'FAI', '2025/2026', 9, '1 semestre', '1 anno', 'Obbligatorio', false, true),
    ('matematica-generale-e-laboratorio-di-informatica', 'FAI', '2025/2026', 9, '1 semestre', '1 anno', 'Obbligatorio', false, true),
    ('biologia-e-sistematica-vegetale', 'FAI', '2025/2026', 9, '2 semestre', '1 anno', 'Obbligatorio', false, true),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 9, '2 semestre', '1 anno', 'Obbligatorio', false, true),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 12, '2 semestre', '1 anno', 'Obbligatorio', false, true),
    ('biologia-e-sistematica-animale', 'F62', '2025/2026', 9, '1 semestre', '2 anno', 'Obbligatorio', false, true),
    ('chimica-biologica', 'F62', '2025/2026', 9, '1 semestre', '2 anno', 'Obbligatorio', false, true),
    ('evoluzione-biologica-e-storia-della-biologia', 'F62', '2025/2026', 6, '1 semestre', '2 anno', 'Obbligatorio', false, true),
    ('genetica', 'F62', '2025/2026', 9, '1 semestre', '2 anno', 'Alternativa obbligatoria', false, true),
    ('genetics', 'F62', '2025/2026', 9, '1 semestre', '2 anno', 'Alternativa obbligatoria', false, true),
    ('anatomia-comparata', 'F62', '2025/2026', 6, '2 semestre', '2 anno', 'Obbligatorio', false, true),
    ('fisiologia-vegetale', 'F62', '2025/2026', 9, '2 semestre', '2 anno', 'Obbligatorio', false, true),
    ('biologia-molecolare-e-bioinformatica', 'F62', '2025/2026', 12, '2 semestre', '2 anno', 'Alternativa obbligatoria', false, true),
    ('molecular-biology-and-bioinformatics', 'F62', '2025/2026', 12, '2 semestre', '2 anno', 'Alternativa obbligatoria', false, true),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 6, 'Annuale', '3 anno', 'Tirocinio', false, false),
    ('biologia-dello-sviluppo', 'F62', '2025/2026', 6, '1 semestre', '3 anno', 'Obbligatorio', false, true),
    ('ecologia', 'F62', '2025/2026', 9, '1 semestre', '3 anno', 'Obbligatorio', false, true),
    ('elementi-di-anatomia-umana-farmacologia-e-immunologia', 'F62', '2025/2026', 9, '1 semestre', '3 anno', 'Obbligatorio', false, true),
    ('microbiologia-generale', 'F62', '2025/2026', 9, '2 semestre', '3 anno', 'Obbligatorio', false, true),
    ('fisiologia-generale-e-animale', 'F62', '2025/2026', 9, '2 semestre', '3 anno', 'Alternativa obbligatoria', false, true),
    ('analisi-biochimico-cliniche', 'F62', '2025/2026', 6, '1 semestre', 'Scelta', 'Scelta libera consigliata', true, true),
    ('metodologie-di-biologia-molecolare', 'F62', '2025/2026', 6, '1 semestre', 'Scelta', 'Scelta libera consigliata', true, true),
    ('metodologie-di-embriologia-sperimentale', 'F62', '2025/2026', 6, '1 semestre', 'Scelta', 'Scelta libera consigliata', true, true),
    ('metodologie-innovative-di-biologia-vegetale', 'F62', '2025/2026', 6, '1 semestre', 'Scelta', 'Scelta libera consigliata', true, true),
    ('approcci-di-genomica-vegetale-per-adattare-le-piante-ai-cambiamenti-climatici-e-ambientali', 'F62', '2025/2026', 6, '2 semestre', 'Scelta', 'Scelta libera consigliata', true, true),
    ('metodologie-di-ecologia-applicata', 'F62', '2025/2026', 6, '2 semestre', 'Scelta', 'Scelta libera consigliata', true, true),
    ('metodologie-di-genetica-e-genomica-umana', 'F62', '2025/2026', 6, '2 semestre', 'Scelta', 'Scelta libera consigliata', true, true),
    ('metodologie-di-indagine-in-biologia-cellulare-animale-e-istologia', 'F62', '2025/2026', 6, '2 semestre', 'Scelta', 'Scelta libera consigliata', true, true),
    ('metodologie-farmacologiche-e-tossicologiche', 'F62', '2025/2026', 6, '2 semestre', 'Scelta', 'Scelta libera consigliata', true, true)
)
update public.l13_course_offerings offerings
set
  cfu = metadata.cfu,
  semester = metadata.semester,
  course_year = metadata.course_year,
  activity_type = metadata.activity_type,
  is_elective = metadata.is_elective,
  show_in_catalog = metadata.show_in_catalog
from metadata
where offerings.course_slug = metadata.course_slug
  and offerings.cohort_code = metadata.cohort_code
  and offerings.academic_year = metadata.academic_year;

comment on column public.l13_course_offerings.show_in_catalog is
  'False for administrative activities such as language assessment, internship, and final exam that should not appear as subject cards.';
