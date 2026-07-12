-- Registro normalizzato dei corsi di laurea triennale della Statale di Milano
-- (offerta 2025/26, fonte unimi.it, verificata il 2026-07-12). Il piano di studi
-- dettagliato con i docenti resta nelle tabelle l13_* già esistenti (Scienze
-- biologiche); i cataloghi degli altri corsi verranno aggiunti progressivamente
-- collegandoli a questo registro. documents.degree_slug collega ogni documento
-- al proprio CdL in modo normalizzato (i documenti storici sono tutti L-13).
-- Dati pubblici di catalogo: lettura anon+authenticated, scrittura solo service role.

create table if not exists public.degree_programs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  classe text not null,
  area text not null,
  unimi_path text not null,
  interateneo text,
  active_from text,
  catalog_ready boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.degree_programs enable row level security;

drop policy if exists degree_programs_public_read on public.degree_programs;
create policy degree_programs_public_read on public.degree_programs
  for select to anon, authenticated using (true);

revoke all on public.degree_programs from anon, authenticated;
grant select on public.degree_programs to anon, authenticated;

-- Seed: 72 corsi di laurea triennale attivi (ordinati per area, poi nome)
insert into public.degree_programs (slug, name, classe, area, unimi_path, interateneo, active_from, catalog_ready, sort_order) values
('artificial-intelligence', 'Artificial Intelligence', 'L-31', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/artificial-intelligence', 'Università di Pavia · Milano-Bicocca', null, false, 0),
('beni-culturali-scienze-tecnologie-diagnostica', 'Beni culturali: scienze, tecnologie e diagnostica', 'L-43', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/beni-culturali-scienze-tecnologie-e-diagnostica', null, null, false, 1),
('biotecnologia', 'Biotecnologia', 'L-2', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/biotecnologia', null, null, false, 2),
('chimica', 'Chimica', 'L-27', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/chimica', null, null, false, 3),
('chimica-industriale', 'Chimica industriale', 'L-27', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/chimica-industriale', null, null, false, 4),
('fisica', 'Fisica', 'L-30', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/fisica', null, null, false, 5),
('informatica', 'Informatica', 'L-31', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/informatica', null, null, false, 6),
('informatica-musicale', 'Informatica musicale', 'L-31', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/informatica-musicale', null, null, false, 7),
('informatica-comunicazione-digitale', 'Informatica per la comunicazione digitale', 'L-31', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/informatica-la-comunicazione-digitale', null, null, false, 8),
('matematica', 'Matematica', 'L-35', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/matematica-triennale', null, null, false, 9),
('scienze-ambientali-politiche-sostenibilita', 'Scienze ambientali e politiche per la sostenibilità', 'L-32', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/scienze-ambientali-e-politiche-la-sostenibilita', null, null, false, 10),
('scienze-biologiche', 'Scienze biologiche', 'L-13', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/scienze-biologiche', null, null, true, 11),
('scienze-geologiche', 'Scienze geologiche', 'L-34', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/scienze-geologiche', null, null, false, 12),
('scienze-naturali', 'Scienze naturali', 'L-32', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/scienze-naturali', null, null, false, 13),
('sicurezza-sistemi-reti-informatiche', 'Sicurezza dei sistemi e delle reti informatiche', 'L-31', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/sicurezza-dei-sistemi-e-delle-reti-informatiche', null, null, false, 14),
('sicurezza-informatica-intelligenza-artificiale', 'Sicurezza informatica e intelligenza artificiale', 'L-31', 'Scienze e tecnologie', '/it/corsi/laurea-triennale/sicurezza-informatica-e-intelligenza-artificiale', null, null, false, 15),
('assistenza-sanitaria', 'Assistenza sanitaria', 'L/SNT4', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/assistenza-sanitaria', null, null, false, 16),
('biotecnologie-mediche', 'Biotecnologie mediche', 'L-2', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/biotecnologie-mediche', null, null, false, 17),
('dietistica', 'Dietistica', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/dietistica', null, null, false, 18),
('fisioterapia', 'Fisioterapia', 'L/SNT2', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/fisioterapia', null, null, false, 19),
('igiene-dentale', 'Igiene dentale', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/igiene-dentale', null, null, false, 20),
('infermieristica', 'Infermieristica', 'L/SNT1', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/infermieristica', null, null, false, 21),
('logopedia', 'Logopedia', 'L/SNT2', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/logopedia', null, null, false, 22),
('ortottica-assistenza-oftalmologica', 'Ortottica ed assistenza oftalmologica', 'L/SNT2', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/ortottica-ed-assistenza-oftalmologica', null, null, false, 23),
('ostetricia', 'Ostetricia', 'L/SNT1', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/ostetricia', null, null, false, 24),
('podologia', 'Podologia', 'L/SNT2', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/podologia', null, null, false, 25),
('scienze-motorie-sport-salute', 'Scienze motorie, sport e salute', 'L-22', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/scienze-motorie-sport-e-salute', null, null, false, 26),
('scienze-psicologiche-prevenzione-cura', 'Scienze psicologiche per la prevenzione e la cura', 'L-24', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/scienze-psicologiche-la-prevenzione-e-la-cura', null, null, false, 27),
('tecnica-riabilitazione-psichiatrica', 'Tecnica della riabilitazione psichiatrica', 'L/SNT2', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecnica-della-riabilitazione-psichiatrica', null, null, false, 28),
('tecniche-audiometriche', 'Tecniche audiometriche', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecniche-audiometriche', null, null, false, 29),
('tecniche-audioprotesiche', 'Tecniche audioprotesiche', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecniche-audioprotesiche', null, null, false, 30),
('tecniche-prevenzione-ambiente-lavoro', 'Tecniche della prevenzione nell''ambiente e nei luoghi di lavoro', 'L/SNT4', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecniche-della-prevenzione-nellambiente-e-nei-luoghi-di-lavoro', null, null, false, 31),
('tecniche-fisiopatologia-cardiocircolatoria', 'Tecniche di fisiopatologia cardiocircolatoria e perfusione cardiovascolare', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecniche-di-fisiopatologia-cardiocircolatoria-e-perfusione-cardiovascolare', null, null, false, 32),
('tecniche-laboratorio-biomedico', 'Tecniche di laboratorio biomedico', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecniche-di-laboratorio-biomedico', null, null, false, 33),
('tecniche-neurofisiopatologia', 'Tecniche di neurofisiopatologia', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecniche-di-neurofisiopatologia', null, null, false, 34),
('tecniche-radiologia-medica', 'Tecniche di radiologia medica, per immagini e radioterapia', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecniche-di-radiologia-medica-immagini-e-radioterapia', null, null, false, 35),
('tecniche-ortopediche', 'Tecniche ortopediche', 'L/SNT3', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/tecniche-ortopediche', null, null, false, 36),
('terapia-neuro-psicomotricita-eta-evolutiva', 'Terapia della neuro e psicomotricità dell’età evolutiva', 'L/SNT2', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/terapia-della-neuro-e-psicomotricita-delleta-evolutiva', null, null, false, 37),
('terapia-occupazionale', 'Terapia occupazionale', 'L/SNT2', 'Medicina e professioni sanitarie', '/it/corsi/laurea-triennale/terapia-occupazionale', null, null, false, 38),
('agricoltura-sostenibile', 'Agricoltura sostenibile', 'L-25', 'Agraria e alimentare', '/it/corsi/laurea-triennale/agricoltura-sostenibile', null, null, false, 39),
('allevamento-benessere-animali-affezione', 'Allevamento e benessere degli animali d''affezione', 'L-38', 'Agraria e alimentare', '/it/corsi/laurea-triennale/allevamento-e-benessere-degli-animali-daffezione', null, null, false, 40),
('produzione-protezione-piante-verde', 'Produzione e protezione delle piante e dei sistemi del verde', 'L-25', 'Agraria e alimentare', '/it/corsi/laurea-triennale/produzione-e-protezione-delle-piante-e-dei-sistemi-del-verde', null, null, false, 41),
('scienze-ristorazione-distribuzione-alimenti', 'Scienze della ristorazione e distribuzione degli alimenti', 'L-26', 'Agraria e alimentare', '/it/corsi/laurea-triennale/scienze-della-ristorazione-e-distribuzione-degli-alimenti', null, null, false, 42),
('scienze-produzioni-animali', 'Scienze delle produzioni animali', 'L-38', 'Agraria e alimentare', '/it/corsi/laurea-triennale/scienze-delle-produzioni-animali', null, null, false, 43),
('scienze-tecnologie-alimenti-sostenibili', 'Scienze e tecnologie per alimenti sostenibili', 'L-26', 'Agraria e alimentare', '/it/corsi/laurea-triennale/scienze-e-tecnologie-alimenti-sostenibili', null, null, false, 44),
('sistemi-digitali-agricoltura', 'Sistemi digitali in agricoltura', 'L-P02', 'Agraria e alimentare', '/it/corsi/laurea-triennale/sistemi-digitali-agricoltura', null, null, false, 45),
('tecnologie-gestione-impresa-casearia', 'Tecnologie e gestione dell''impresa casearia', 'L-P02', 'Agraria e alimentare', '/it/corsi/laurea-triennale/tecnologie-e-gestione-dellimpresa-casearia-l-p02-interateneo', 'Interateneo', null, false, 46),
('valorizzazione-tutela-ambiente-territorio-montano', 'Valorizzazione e tutela dell''ambiente e del territorio montano', 'L-25', 'Agraria e alimentare', '/it/corsi/laurea-triennale/valorizzazione-e-tutela-dellambiente-e-del-territorio-montano', null, null, false, 47),
('viticoltura-enologia', 'Viticoltura ed enologia', 'L-25', 'Agraria e alimentare', '/it/corsi/laurea-triennale/viticoltura-ed-enologia', null, null, false, 48),
('scienze-prodotti-naturali-salute-sepnas', 'Scienze dei prodotti naturali per la salute – SEPNAS', 'L-29', 'Farmacia e scienze del farmaco', '/it/corsi/laurea-triennale/scienze-dei-prodotti-naturali-la-salute-sepnas', null, null, false, 49),
('tossicologia-sicurezza-umana-ambientale-tops', 'Tossicologia per la sicurezza umana e ambientale – TopS', 'L-29', 'Farmacia e scienze del farmaco', '/it/corsi/laurea-triennale/tossicologia-la-sicurezza-umana-e-ambientale-tops', null, null, false, 50),
('ancient-civilizations-contemporary-world', 'Ancient Civilizations for the Contemporary World', 'L-1', 'Studi umanistici', '/it/corsi/laurea-triennale/ancient-civilizations-contemporary-world', null, null, false, 51),
('filosofia', 'Filosofia', 'L-5', 'Studi umanistici', '/it/corsi/laurea-triennale/filosofia', null, null, false, 52),
('geografia-ambiente-territorio', 'Geografia, ambiente e territorio', 'L-6', 'Studi umanistici', '/it/corsi/laurea-triennale/geografia-ambiente-e-territorio', null, null, false, 53),
('interpretariato-traduzione-lis-list', 'Interpretariato e traduzione in lingua dei segni italiana (LIS) e tattile (LIST)', 'L-20', 'Studi umanistici', '/it/corsi/laurea-triennale/interpretariato-e-traduzione-lingua-dei-segni-italiana-lis-e-lingua-dei', 'Milano-Bicocca', null, false, 54),
('lettere', 'Lettere', 'L-10', 'Studi umanistici', '/it/corsi/laurea-triennale/lettere', null, null, false, 55),
('lingue-letterature-moderne', 'Lingue e letterature moderne', 'L-11', 'Studi umanistici', '/it/corsi/laurea-triennale/lingue-e-letterature-moderne', null, null, false, 56),
('mediazione-linguistica-culturale', 'Mediazione linguistica e culturale', 'L-12', 'Studi umanistici', '/it/corsi/laurea-triennale/mediazione-linguistica-e-culturale-applicata-allambito-economico-giuridico-e', null, null, false, 57),
('scienze-beni-culturali', 'Scienze dei beni culturali', 'L-1', 'Studi umanistici', '/it/corsi/laurea-triennale/scienze-dei-beni-culturali', null, null, false, 58),
('scienze-umanistiche-comunicazione', 'Scienze umanistiche per la comunicazione', 'L-20', 'Studi umanistici', '/it/corsi/laurea-triennale/scienze-umanistiche-la-comunicazione', null, null, false, 59),
('storia', 'Storia', 'L-42', 'Studi umanistici', '/it/corsi/laurea-triennale/storia', null, null, false, 60),
('scienze-servizi-giuridici', 'Scienze dei servizi giuridici', 'L-14', 'Giurisprudenza', '/it/corsi/laurea-triennale/scienze-dei-servizi-giuridici', null, null, false, 61),
('comunicazione-societa-ces', 'Comunicazione e società (CES)', 'L-20', 'Economia, politica e società', '/it/corsi/laurea-triennale/comunicazione-e-societa-ces', null, null, false, 62),
('economia-aziendale', 'Economia aziendale', 'L-18', 'Economia, politica e società', '/it/corsi/laurea-triennale/economia-aziendale', null, '2026/27', false, 63),
('economia-management-ema', 'Economia e management (EMA)', 'L-18', 'Economia, politica e società', '/it/corsi/laurea-triennale/economia-e-management-ema', null, null, false, 64),
('economics-behavior-data-policy', 'Economics: behavior, data and policy', 'L-33', 'Economia, politica e società', '/it/corsi/laurea-triennale/economics-behavior-data-and-policy', null, null, false, 65),
('international-politics-law-economics-iple', 'International Politics, Law and Economics (IPLE)', 'L-36', 'Economia, politica e società', '/it/corsi/laurea-triennale/international-politics-law-and-economics-iple', null, null, false, 66),
('management-governance-innovazione-magips', 'Management, governance e innovazione nel pubblico e nel socio-sanitario (MAGIPS)', 'L-16', 'Economia, politica e società', '/it/corsi/laurea-triennale/management-governance-e-innovazione-nel-pubblico-e-nel-socio-sanitario', null, null, false, 67),
('management-organizzazioni-lavoro-mol', 'Management delle organizzazioni e del lavoro (MOL)', 'L-16', 'Economia, politica e società', '/it/corsi/laurea-triennale/management-delle-organizzazioni-e-del-lavoro-mol', null, null, false, 68),
('scienze-internazionali-istituzioni-europee-sie', 'Scienze internazionali e istituzioni europee (SIE)', 'L-36', 'Economia, politica e società', '/it/corsi/laurea-triennale/scienze-internazionali-e-istituzioni-europee-sie', null, null, false, 69),
('scienze-politiche-spo', 'Scienze politiche (SPO)', 'L-36', 'Economia, politica e società', '/it/corsi/laurea-triennale/scienze-politiche-spo', null, null, false, 70),
('scienze-sociali-globalizzazione-glo', 'Scienze sociali per la globalizzazione (GLO)', 'L-37', 'Economia, politica e società', '/it/corsi/laurea-triennale/scienze-sociali-la-globalizzazione-glo', null, null, false, 71)
on conflict (slug) do update set
  name = excluded.name, classe = excluded.classe, area = excluded.area,
  unimi_path = excluded.unimi_path, interateneo = excluded.interateneo,
  active_from = excluded.active_from, catalog_ready = excluded.catalog_ready,
  sort_order = excluded.sort_order, updated_at = now();

alter table public.documents
  add column if not exists degree_slug text references public.degree_programs(slug) on update cascade;

create index if not exists documents_degree_slug_idx on public.documents (degree_slug);

update public.documents set degree_slug = 'scienze-biologiche' where degree_slug is null;
