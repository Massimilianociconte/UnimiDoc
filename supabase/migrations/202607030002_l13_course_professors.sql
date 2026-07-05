-- Source: official UniMi Scienze biologiche Docenti page, extracted 2026-07-03.
-- Refresh from https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti before each academic-year launch.

create extension if not exists pgcrypto;

create table if not exists public.l13_professors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  profile_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.l13_course_offerings (
  id uuid primary key default gen_random_uuid(),
  course_name text not null,
  course_slug text not null,
  cohort_code text not null check (cohort_code in ('FAI', 'F62')),
  cohort_label text not null,
  academic_year text not null,
  source_course_url text,
  is_elective boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_slug, cohort_code, academic_year)
);

create table if not exists public.l13_course_instructors (
  id uuid primary key default gen_random_uuid(),
  course_offering_id uuid not null references public.l13_course_offerings(id) on delete cascade,
  professor_id uuid not null references public.l13_professors(id) on delete cascade,
  surname_group text not null default 'Tutti' check (surname_group in ('A-L', 'M-Z', 'Tutti')),
  source_page_url text not null,
  verified_at date not null default date '2026-07-03',
  created_at timestamptz not null default now(),
  unique (course_offering_id, professor_id, surname_group)
);

create index if not exists l13_course_offerings_lookup_idx on public.l13_course_offerings (academic_year, cohort_code, course_slug);
create index if not exists l13_course_instructors_course_idx on public.l13_course_instructors (course_offering_id, surname_group);
create index if not exists l13_course_instructors_professor_idx on public.l13_course_instructors (professor_id);

alter table public.l13_professors enable row level security;
alter table public.l13_course_offerings enable row level security;
alter table public.l13_course_instructors enable row level security;

drop policy if exists "Public can read l13_professors" on public.l13_professors;
create policy "Public can read l13_professors" on public.l13_professors for select to anon, authenticated using (true);
drop policy if exists "Public can read l13_course_offerings" on public.l13_course_offerings;
create policy "Public can read l13_course_offerings" on public.l13_course_offerings for select to anon, authenticated using (true);
drop policy if exists "Public can read l13_course_instructors" on public.l13_course_instructors;
create policy "Public can read l13_course_instructors" on public.l13_course_instructors for select to anon, authenticated using (true);

with professor_seed(full_name, profile_url) as (
  values
    ('AMADEO ALIDA', 'https://www.unimi.it/it/ugov/rubrica/person0000012445'),
    ('BANDI CLAUDIO', 'https://www.unimi.it/it/ugov/rubrica/person0000013975'),
    ('BELTRAME MONICA DANIELA ALESSANDRA', 'https://www.unimi.it/it/ugov/rubrica/person0000012275'),
    ('BENEDIKTER NIELS PATRIZ', 'https://www.unimi.it/it/ugov/rubrica/person0000132566'),
    ('BENZONI PATRIZIA', 'https://www.unimi.it/it/ugov/rubrica/person0000054005'),
    ('BERNARDINI ANDREA', 'https://www.unimi.it/it/ugov/rubrica/person0000824608'),
    ('BERTONI GIOVANNI', 'https://www.unimi.it/it/ugov/rubrica/person0000015259'),
    ('BESUSSO DARIO', 'https://www.unimi.it/it/ugov/rubrica/person0000053647'),
    ('BIFFO STEFANO', 'https://www.unimi.it/it/ugov/rubrica/person0000017921'),
    ('BINELLI ANDREA PAOLO', 'https://www.unimi.it/it/ugov/rubrica/person0000015275'),
    ('BONALDO BRIGITTA', 'https://www.unimi.it/it/ugov/rubrica/person0000182957'),
    ('BONASORO FRANCESCO', 'https://www.unimi.it/it/ugov/rubrica/person0000013371'),
    ('BONZA MARIA CRISTINA', 'https://www.unimi.it/it/ugov/rubrica/person0000016441'),
    ('BRIANI FEDERICA', 'https://www.unimi.it/it/ugov/rubrica/person0000016181'),
    ('CACCIA SILVIA', 'https://www.unimi.it/it/ugov/rubrica/person0000044888'),
    ('CAMILLONI CARLO', 'https://www.unimi.it/it/ugov/rubrica/person0000102759'),
    ('CAPORALI ELISABETTA', 'https://www.unimi.it/it/ugov/rubrica/person0000011607'),
    ('CARETTI GIUSEPPINA', 'https://www.unimi.it/it/ugov/rubrica/person0000016405'),
    ('CARLUCCI LUCIA', 'https://www.unimi.it/it/ugov/rubrica/person0000012876'),
    ('CAUTERUCCIO SILVIA', 'https://www.unimi.it/it/ugov/rubrica/person0000018027'),
    ('CIVERA MONICA', 'https://www.unimi.it/it/ugov/rubrica/person0000041773'),
    ('COLOMBO ALESSIA', 'https://www.unimi.it/it/ugov/rubrica/person0000046253'),
    ('COLOMBO GRAZIANO', 'https://www.unimi.it/it/ugov/rubrica/person0000017812'),
    ('COLOMBO LUCIA', 'https://www.unimi.it/it/ugov/rubrica/person0000014557'),
    ('COSTA ALEX', 'https://www.unimi.it/it/ugov/rubrica/person0000017590'),
    ('COSTANZO ALESSANDRA', 'https://www.unimi.it/it/ugov/rubrica/person0000803600'),
    ('CUCINOTTA MARA', 'https://www.unimi.it/it/ugov/rubrica/person0000053782'),
    ('DAL CORSO ALBERTO', 'https://www.unimi.it/it/ugov/rubrica/person0000823845'),
    ('DALLE DONNE ISABELLA', 'https://www.unimi.it/it/ugov/rubrica/person0000014562'),
    ('DAMIANO CATERINA', 'https://www.unimi.it/it/ugov/rubrica/person0000825872'),
    ('DEL GIACCO LUCA PASQUALE CARMELO', 'https://www.unimi.it/it/ugov/rubrica/person0000014385'),
    ('DELLA TORRE CAMILLA', 'https://www.unimi.it/it/ugov/rubrica/person0000047943'),
    ('DOLFINI DILETTA', 'https://www.unimi.it/it/ugov/rubrica/person0000047364'),
    ('EZQUER GARIN JUAN IGNACIO', 'https://www.unimi.it/it/ugov/rubrica/person0000047162'),
    ('FAGNANI FRANCESCO', 'https://www.unimi.it/it/ugov/rubrica/person0000105521'),
    ('FANTIN ALESSANDRO', 'https://www.unimi.it/it/ugov/rubrica/person0000118581'),
    ('FERRARO ALESSANDRO', 'https://www.unimi.it/it/ugov/rubrica/person0000089970'),
    ('GABRIELI PAOLO', 'https://www.unimi.it/it/ugov/rubrica/person0000120685'),
    ('GAETA GIUSEPPE', 'https://www.unimi.it/it/ugov/rubrica/person0000016444'),
    ('GANDELLINI PAOLO', 'https://www.unimi.it/it/ugov/rubrica/person0000123310'),
    ('GIANNUZZI GIULIANA', 'https://www.unimi.it/it/ugov/rubrica/person0000141289'),
    ('GNESUTTA NERINA BRUNA', 'https://www.unimi.it/it/ugov/rubrica/person0000016192'),
    ('GOURLAY LOUISE JANE', 'https://www.unimi.it/it/ugov/rubrica/person0000018028'),
    ('GREGIS VERONICA', 'https://www.unimi.it/it/ugov/rubrica/person0000018020'),
    ('GUBBIOTTI GIORGIO', 'https://www.unimi.it/it/ugov/rubrica/person0000132889'),
    ('HORNER DAVID STEPHEN', 'https://www.unimi.it/it/ugov/rubrica/person0000015791'),
    ('LA PORTA CATERINA ANNA MARIA', 'https://www.unimi.it/it/ugov/rubrica/person0000014273'),
    ('LAMBERTINI CARLA', 'https://www.unimi.it/it/ugov/rubrica/person0000147582'),
    ('LANDINI PAOLO', 'https://www.unimi.it/it/ugov/rubrica/person0000016471'),
    ('LAZZARO FEDERICO', 'https://www.unimi.it/it/ugov/rubrica/person0000017620'),
    ('MAGNI STEFANO', 'https://www.unimi.it/it/ugov/rubrica/person0000054112'),
    ('MANENTI RAOUL', 'https://www.unimi.it/it/ugov/rubrica/person0000100003'),
    ('MANFRINI NICOLA', 'https://www.unimi.it/it/ugov/rubrica/person0000115006'),
    ('MANTOVANI ROBERTO', 'https://www.unimi.it/it/ugov/rubrica/person0000012736'),
    ('MANZO STEFANO GIUSTINO', 'https://www.unimi.it/it/ugov/rubrica/person0000159479'),
    ('MARINI FEDERICA', 'https://www.unimi.it/it/ugov/rubrica/person0000017047'),
    ('MASIERO SIMONA', 'https://www.unimi.it/it/ugov/rubrica/person0000017463'),
    ('MAZZANTI MICHELE', 'https://www.unimi.it/it/ugov/rubrica/person0000011871'),
    ('MENEGOLA ELENA', 'https://www.unimi.it/it/ugov/rubrica/person0000014410'),
    ('MERCANDELLI PIERLUIGI', 'https://www.unimi.it/it/ugov/rubrica/person0000015786'),
    ('MIGLIORINI LORENZO', 'https://www.unimi.it/it/ugov/rubrica/person0000804676'),
    ('MINUCCI SAVERIO', 'https://www.unimi.it/it/ugov/rubrica/person0000015809'),
    ('MIRAMONTI LINO', 'https://www.unimi.it/it/ugov/rubrica/person0000016489'),
    ('MIRANDA MENDES MARTA ADELINA', 'https://www.unimi.it/it/ugov/rubrica/person0000101481'),
    ('MUZI FALCONI MARCO', 'https://www.unimi.it/it/ugov/rubrica/person0000014887'),
    ('NEGRI AGATA', null),
    ('PALEARI RENATA', 'https://www.unimi.it/it/ugov/rubrica/person0000014822'),
    ('PANIGATI MONICA', 'https://www.unimi.it/it/ugov/rubrica/person0000016150'),
    ('PAROLI BRUNO', 'https://www.unimi.it/it/ugov/rubrica/person0000047273'),
    ('PAROLINI MARCO', 'https://www.unimi.it/it/ugov/rubrica/person0000017811'),
    ('PARONI MOIRA', 'https://www.unimi.it/it/ugov/rubrica/person0000018232'),
    ('PENATI TIZIANO', 'https://www.unimi.it/it/ugov/rubrica/person0000017482'),
    ('PERRELLA GIORGIO', 'https://www.unimi.it/it/ugov/rubrica/person0000151848'),
    ('PESARESI PAOLO', 'https://www.unimi.it/it/ugov/rubrica/person0000016609'),
    ('PETRONI KATIA', 'https://www.unimi.it/it/ugov/rubrica/person0000014494'),
    ('POLIDORI CARLO', 'https://www.unimi.it/it/ugov/rubrica/person0000044403'),
    ('RICAGNO STEFANO', 'https://www.unimi.it/it/ugov/rubrica/person0000017467'),
    ('RICCIARDI SARA', 'https://www.unimi.it/it/ugov/rubrica/person0000113725'),
    ('RUBOLINI DIEGO', 'https://www.unimi.it/it/ugov/rubrica/person0000016375'),
    ('RUFINI ALESSANDRO', 'https://www.unimi.it/it/ugov/rubrica/person0000154945'),
    ('SACERDOTE PAOLA GIUSEPPINA', 'https://www.unimi.it/it/ugov/rubrica/person0000011115'),
    ('SATTIN SARA', 'https://www.unimi.it/it/ugov/rubrica/person0000047428'),
    ('SAU FEDERICO', 'https://www.unimi.it/it/ugov/rubrica/person0000181116'),
    ('SCARI'' GIORGIO ULISSE SALVATORE', 'https://www.unimi.it/it/ugov/rubrica/person0000009659'),
    ('SERTIC SARAH', 'https://www.unimi.it/it/ugov/rubrica/person0000047246'),
    ('SUGNI MICHELA', 'https://www.unimi.it/it/ugov/rubrica/person0000017652'),
    ('TADINI LUCA', 'https://www.unimi.it/it/ugov/rubrica/person0000054066'),
    ('VALENZA MARTA', 'https://www.unimi.it/it/ugov/rubrica/person0000018034'),
    ('VANONI MARIA ANTONIETTA', 'https://www.unimi.it/it/ugov/rubrica/person0000010505'),
    ('VILLA ELENA', 'https://www.unimi.it/it/ugov/rubrica/person0000017244'),
    ('VISENTIN CRISTINA', 'https://www.unimi.it/it/ugov/rubrica/person0000114460'),
    ('ZAMBELLI FEDERICO', 'https://www.unimi.it/it/ugov/rubrica/person0000090180'),
    ('ZUCCATO CHIARA', 'https://www.unimi.it/it/ugov/rubrica/person0000017241')
)
insert into public.l13_professors (full_name, profile_url)
select full_name, profile_url from professor_seed
on conflict (full_name) do update set profile_url = excluded.profile_url;

with offering_seed(course_name, course_slug, cohort_code, cohort_label, academic_year, source_course_url, is_elective) as (
  values
    ('Analisi biochimico-cliniche', 'analisi-biochimico-cliniche', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-55', false),
    ('Anatomia comparata', 'anatomia-comparata', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-66', false),
    ('Approcci di genomica vegetale per adattare le piante ai cambiamenti climatici e ambientali', 'approcci-di-genomica-vegetale-per-adattare-le-piante-ai-cambiamenti-climatici-e-ambientali', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-85', true),
    ('Biologia dello sviluppo', 'biologia-dello-sviluppo', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-21', false),
    ('Biologia e sistematica animale', 'biologia-e-sistematica-animale', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-11', false),
    ('Biologia e sistematica vegetale', 'biologia-e-sistematica-vegetale', 'FAI', 'Immatricolati nell''anno accademico 2025/2026 (FAI)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000fai-22', false),
    ('Biologia molecolare e bioinformatica', 'biologia-molecolare-e-bioinformatica', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-17', false),
    ('Chimica biologica', 'chimica-biologica', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-13', false),
    ('Chimica generale con elementi di chimica-fisica', 'chimica-generale-con-elementi-di-chimica-fisica', 'FAI', 'Immatricolati nell''anno accademico 2025/2026 (FAI)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000fai-15', false),
    ('Chimica organica e laboratorio di chimica', 'chimica-organica-e-laboratorio-di-chimica', 'FAI', 'Immatricolati nell''anno accademico 2025/2026 (FAI)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000fai-14', false),
    ('Citologia e istologia', 'citologia-e-istologia', 'FAI', 'Immatricolati nell''anno accademico 2025/2026 (FAI)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000fai-20', false),
    ('Ecologia', 'ecologia', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-18', false),
    ('Elementi di anatomia umana, farmacologia e immunologia', 'elementi-di-anatomia-umana-farmacologia-e-immunologia', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-65', false),
    ('Evoluzione biologica e storia della biologia', 'evoluzione-biologica-e-storia-della-biologia', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-12', false),
    ('Fisica, laboratorio di fisica, laboratorio di metodi matematici e statistici', 'fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', 'Immatricolati nell''anno accademico 2025/2026 (FAI)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000fai-17', false),
    ('Fisiologia generale e animale', 'fisiologia-generale-e-animale', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-15', false),
    ('Fisiologia vegetale', 'fisiologia-vegetale', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-16', false),
    ('Genetica', 'genetica', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-14', false),
    ('Genetics', 'genetics', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-73', false),
    ('Matematica generale e laboratorio di informatica', 'matematica-generale-e-laboratorio-di-informatica', 'FAI', 'Immatricolati nell''anno accademico 2025/2026 (FAI)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000fai-16', false),
    ('Metodologie di biologia molecolare', 'metodologie-di-biologia-molecolare', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-59', false),
    ('Metodologie di ecologia applicata', 'metodologie-di-ecologia-applicata', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-63', true),
    ('Metodologie di embriologia sperimentale', 'metodologie-di-embriologia-sperimentale', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-62', true),
    ('Metodologie di genetica e genomica umana', 'metodologie-di-genetica-e-genomica-umana', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-83', true),
    ('Metodologie di indagine in biologia cellulare animale e istolgia', 'metodologie-di-indagine-in-biologia-cellulare-animale-e-istolgia', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-86', true),
    ('Metodologie farmacologiche e tossicologiche', 'metodologie-farmacologiche-e-tossicologiche', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-53', true),
    ('Metodologie innovative di biologia vegetale', 'metodologie-innovative-di-biologia-vegetale', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-84', true),
    ('Microbiologia generale', 'microbiologia-generale', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-51', false),
    ('Molecular biology and bioinformatics', 'molecular-biology-and-bioinformatics', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-75', false),
    ('Tirocinio interno presso laboratori universitari (stage interno)', 'tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', 'Immatricolati a partire dall''a.a. 2019/2020 al 2024/25 (F62)', '2025/2026', 'https://www.unimi.it/it/ugov/of/af20260000f62-37', true)
)
insert into public.l13_course_offerings (course_name, course_slug, cohort_code, cohort_label, academic_year, source_course_url, is_elective)
select course_name, course_slug, cohort_code, cohort_label, academic_year, source_course_url, is_elective from offering_seed
on conflict (course_slug, cohort_code, academic_year) do update set
  course_name = excluded.course_name,
  cohort_label = excluded.cohort_label,
  source_course_url = excluded.source_course_url,
  is_elective = excluded.is_elective;

with assignment_seed(course_slug, cohort_code, academic_year, professor_name, surname_group, source_page_url) as (
  values
    ('matematica-generale-e-laboratorio-di-informatica', 'FAI', '2025/2026', 'BENEDIKTER NIELS PATRIZ', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'CAMILLONI CARLO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-vegetale', 'FAI', '2025/2026', 'CAPORALI ELISABETTA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 'CARLUCCI LUCIA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 'CAUTERUCCIO SILVIA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 'CIVERA MONICA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 'COLOMBO ALESSIA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-vegetale', 'FAI', '2025/2026', 'COLOMBO LUCIA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-vegetale', 'FAI', '2025/2026', 'CUCINOTTA MARA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 'DAL CORSO ALBERTO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('citologia-e-istologia', 'FAI', '2025/2026', 'DALLE DONNE ISABELLA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('citologia-e-istologia', 'FAI', '2025/2026', 'DALLE DONNE ISABELLA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-generale-con-elementi-di-chimica-fisica', 'FAI', '2025/2026', 'DAMIANO CATERINA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-vegetale', 'FAI', '2025/2026', 'EZQUER GARIN JUAN IGNACIO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 'FAGNANI FRANCESCO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'FERRARO ALESSANDRO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('matematica-generale-e-laboratorio-di-informatica', 'FAI', '2025/2026', 'GAETA GIUSEPPE', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('matematica-generale-e-laboratorio-di-informatica', 'FAI', '2025/2026', 'GUBBIOTTI GIORGIO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-vegetale', 'FAI', '2025/2026', 'LAMBERTINI CARLA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 'MERCANDELLI PIERLUIGI', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'MIGLIORINI LORENZO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'MIRAMONTI LINO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-generale-con-elementi-di-chimica-fisica', 'FAI', '2025/2026', 'PANIGATI MONICA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'PAROLI BRUNO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('matematica-generale-e-laboratorio-di-informatica', 'FAI', '2025/2026', 'PENATI TIZIANO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-organica-e-laboratorio-di-chimica', 'FAI', '2025/2026', 'SATTIN SARA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'SAU FEDERICO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'SAU FEDERICO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'VILLA ELENA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisica-laboratorio-di-fisica-laboratorio-di-metodi-matematici-e-statistici', 'FAI', '2025/2026', 'VILLA ELENA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('elementi-di-anatomia-umana-farmacologia-e-immunologia', 'F62', '2025/2026', 'AMADEO ALIDA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'AMADEO ALIDA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('evoluzione-biologica-e-storia-della-biologia', 'F62', '2025/2026', 'BANDI CLAUDIO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'BELTRAME MONICA DANIELA ALESSANDRA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'BENZONI PATRIZIA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('genetics', 'F62', '2025/2026', 'BERNARDINI ANDREA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'BERNARDINI ANDREA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('microbiologia-generale', 'F62', '2025/2026', 'BERTONI GIOVANNI', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('elementi-di-anatomia-umana-farmacologia-e-immunologia', 'F62', '2025/2026', 'BESUSSO DARIO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-dello-sviluppo', 'F62', '2025/2026', 'BIFFO STEFANO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('ecologia', 'F62', '2025/2026', 'BINELLI ANDREA PAOLO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'BONALDO BRIGITTA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-animale', 'F62', '2025/2026', 'BONASORO FRANCESCO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisiologia-vegetale', 'F62', '2025/2026', 'BONZA MARIA CRISTINA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('microbiologia-generale', 'F62', '2025/2026', 'BRIANI FEDERICA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-animale', 'F62', '2025/2026', 'CACCIA SILVIA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'CARETTI GIUSEPPINA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'COLOMBO GRAZIANO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-dello-sviluppo', 'F62', '2025/2026', 'COLOMBO LUCIA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisiologia-vegetale', 'F62', '2025/2026', 'COSTA ALEX', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('ecologia', 'F62', '2025/2026', 'COSTANZO ALESSANDRA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('elementi-di-anatomia-umana-farmacologia-e-immunologia', 'F62', '2025/2026', 'DALLE DONNE ISABELLA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('anatomia-comparata', 'F62', '2025/2026', 'DEL GIACCO LUCA PASQUALE CARMELO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-dello-sviluppo', 'F62', '2025/2026', 'DEL GIACCO LUCA PASQUALE CARMELO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'DELLA TORRE CAMILLA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('genetics', 'F62', '2025/2026', 'DOLFINI DILETTA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-di-genetica-e-genomica-umana', 'F62', '2025/2026', 'DOLFINI DILETTA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'DOLFINI DILETTA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-innovative-di-biologia-vegetale', 'F62', '2025/2026', 'EZQUER GARIN JUAN IGNACIO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'FANTIN ALESSANDRO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-animale', 'F62', '2025/2026', 'GABRIELI PAOLO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'GANDELLINI PAOLO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'GIANNUZZI GIULIANA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'GNESUTTA NERINA BRUNA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'GOURLAY LOUISE JANE', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('approcci-di-genomica-vegetale-per-adattare-le-piante-ai-cambiamenti-climatici-e-ambientali', 'F62', '2025/2026', 'GREGIS VERONICA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('molecular-biology-and-bioinformatics', 'F62', '2025/2026', 'HORNER DAVID STEPHEN', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('elementi-di-anatomia-umana-farmacologia-e-immunologia', 'F62', '2025/2026', 'LA PORTA CATERINA ANNA MARIA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('microbiologia-generale', 'F62', '2025/2026', 'LANDINI PAOLO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-molecolare-e-bioinformatica', 'F62', '2025/2026', 'LAZZARO FEDERICO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-di-biologia-molecolare', 'F62', '2025/2026', 'LAZZARO FEDERICO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-di-ecologia-applicata', 'F62', '2025/2026', 'MAGNI STEFANO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'MAGNI STEFANO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'MANENTI RAOUL', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'MANFRINI NICOLA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('genetics', 'F62', '2025/2026', 'MANTOVANI ROBERTO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-di-genetica-e-genomica-umana', 'F62', '2025/2026', 'MANTOVANI ROBERTO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-di-biologia-molecolare', 'F62', '2025/2026', 'MANZO STEFANO GIUSTINO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'MANZO STEFANO GIUSTINO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'MARINI FEDERICA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'MASIERO SIMONA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('fisiologia-generale-e-animale', 'F62', '2025/2026', 'MAZZANTI MICHELE', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('anatomia-comparata', 'F62', '2025/2026', 'MENEGOLA ELENA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('elementi-di-anatomia-umana-farmacologia-e-immunologia', 'F62', '2025/2026', 'MINUCCI SAVERIO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-dello-sviluppo', 'F62', '2025/2026', 'MIRANDA MENDES MARTA ADELINA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-innovative-di-biologia-vegetale', 'F62', '2025/2026', 'MIRANDA MENDES MARTA ADELINA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('molecular-biology-and-bioinformatics', 'F62', '2025/2026', 'MUZI FALCONI MARCO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('evoluzione-biologica-e-storia-della-biologia', 'F62', '2025/2026', 'NEGRI AGATA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('analisi-biochimico-cliniche', 'F62', '2025/2026', 'PALEARI RENATA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'PAROLINI MARCO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('microbiologia-generale', 'F62', '2025/2026', 'PARONI MOIRA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('genetica', 'F62', '2025/2026', 'PERRELLA GIORGIO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'PESARESI PAOLO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('genetica', 'F62', '2025/2026', 'PETRONI KATIA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-e-sistematica-animale', 'F62', '2025/2026', 'POLIDORI CARLO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-biologica', 'F62', '2025/2026', 'RICAGNO STEFANO', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-di-embriologia-sperimentale', 'F62', '2025/2026', 'RICCIARDI SARA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-di-indagine-in-biologia-cellulare-animale-e-istolgia', 'F62', '2025/2026', 'RICCIARDI SARA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('ecologia', 'F62', '2025/2026', 'RUBOLINI DIEGO', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'RUFINI ALESSANDRO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('elementi-di-anatomia-umana-farmacologia-e-immunologia', 'F62', '2025/2026', 'SACERDOTE PAOLA GIUSEPPINA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'SCARI'' GIORGIO ULISSE SALVATORE', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'SERTIC SARAH', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'SUGNI MICHELA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('approcci-di-genomica-vegetale-per-adattare-le-piante-ai-cambiamenti-climatici-e-ambientali', 'F62', '2025/2026', 'TADINI LUCA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('metodologie-farmacologiche-e-tossicologiche', 'F62', '2025/2026', 'VALENZA MARTA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-biologica', 'F62', '2025/2026', 'VANONI MARIA ANTONIETTA', 'M-Z', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('chimica-biologica', 'F62', '2025/2026', 'VISENTIN CRISTINA', 'A-L', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('biologia-molecolare-e-bioinformatica', 'F62', '2025/2026', 'ZAMBELLI FEDERICO', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti'),
    ('tirocinio-interno-presso-laboratori-universitari-stage-interno', 'F62', '2025/2026', 'ZUCCATO CHIARA', 'Tutti', 'https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti')
)
insert into public.l13_course_instructors (course_offering_id, professor_id, surname_group, source_page_url, verified_at)
select offerings.id, professors.id, assignment_seed.surname_group, assignment_seed.source_page_url, date '2026-07-03'
from assignment_seed
join public.l13_course_offerings offerings
  on offerings.course_slug = assignment_seed.course_slug
  and offerings.cohort_code = assignment_seed.cohort_code
  and offerings.academic_year = assignment_seed.academic_year
join public.l13_professors professors
  on professors.full_name = assignment_seed.professor_name
on conflict (course_offering_id, professor_id, surname_group) do update set
  source_page_url = excluded.source_page_url,
  verified_at = excluded.verified_at;
