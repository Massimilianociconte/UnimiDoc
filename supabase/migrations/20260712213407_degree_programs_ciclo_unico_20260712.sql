-- Estende il registro dei corsi di laurea con le lauree magistrali a ciclo
-- unico della Statale (offerta 2026/27) e aggiunge la colonna degree_type.

alter table public.degree_programs
  add column if not exists degree_type text not null default 'triennale';

alter table public.degree_programs
  drop constraint if exists degree_programs_degree_type_check;
alter table public.degree_programs
  add constraint degree_programs_degree_type_check
  check (degree_type in ('triennale', 'ciclo-unico'));

insert into public.degree_programs (
  slug, name, classe, area, unimi_path, interateneo, degree_type,
  sort_order, catalog_ready
)
values
  ('medicina-chirurgia-polo-centrale', 'Medicina e chirurgia - Polo Centrale', 'LM-41', 'Medicina e professioni sanitarie', '/it/corsi/laurea-magistrale-ciclo-unico/medicina-e-chirurgia-polo-centrale', null, 'ciclo-unico', 100, false),
  ('medicina-chirurgia-polo-san-paolo', 'Medicina e chirurgia - Polo San Paolo', 'LM-41', 'Medicina e professioni sanitarie', '/it/corsi/laurea-magistrale-ciclo-unico/medicina-e-chirurgia-polo-san-paolo', null, 'ciclo-unico', 101, false),
  ('medicina-chirurgia-polo-vialba', 'Medicina e chirurgia - Polo Vialba', 'LM-41', 'Medicina e professioni sanitarie', '/it/corsi/laurea-magistrale-ciclo-unico/medicina-e-chirurgia-polo-vialba', null, 'ciclo-unico', 102, false),
  ('medicina-chirurgia-ims', 'Medicina e chirurgia - International Medical School', 'LM-41', 'Medicina e professioni sanitarie', '/it/corsi/laurea-magistrale-ciclo-unico/medicina-e-chirurgia-international-medical-school', null, 'ciclo-unico', 103, false),
  ('odontoiatria-protesi-dentaria', 'Odontoiatria e protesi dentaria', 'LM-46', 'Medicina e professioni sanitarie', '/it/corsi/laurea-magistrale-ciclo-unico/odontoiatria-e-protesi-dentaria', null, 'ciclo-unico', 104, false),
  ('medicina-veterinaria', 'Medicina veterinaria', 'LM-42', 'Medicina e professioni sanitarie', '/it/corsi/laurea-magistrale-ciclo-unico/medicina-veterinaria-ciclo-unico', null, 'ciclo-unico', 105, false),
  ('farmacia', 'Farmacia', 'LM-13', 'Farmacia e scienze del farmaco', '/it/corsi/laurea-magistrale-ciclo-unico/farmacia-ciclo-unico', null, 'ciclo-unico', 106, false),
  ('chimica-tecnologia-farmaceutiche', 'Chimica e tecnologia farmaceutiche', 'LM-13', 'Farmacia e scienze del farmaco', '/it/corsi/laurea-magistrale-ciclo-unico/chimica-e-tecnologia-farmaceutiche-ciclo-unico', null, 'ciclo-unico', 107, false),
  ('giurisprudenza', 'Giurisprudenza', 'LMG/01', 'Giurisprudenza', '/it/corsi/laurea-magistrale-ciclo-unico/giurisprudenza-ciclo-unico', null, 'ciclo-unico', 108, false)
on conflict (slug) do update set
  name = excluded.name,
  classe = excluded.classe,
  area = excluded.area,
  unimi_path = excluded.unimi_path,
  degree_type = excluded.degree_type,
  updated_at = now();
