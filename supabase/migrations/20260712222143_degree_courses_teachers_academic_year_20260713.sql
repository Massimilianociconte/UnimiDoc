-- A.A. dell'edizione da cui provengono i docenti di un insegnamento. Il piano
-- linka spesso un'edizione futura senza docenti: lo scraper risale all'A.A.
-- attivo più recente e la UI rende esplicita la provenienza temporale.
-- NULL significa che nessun docente è stato pubblicato nelle edizioni ammesse.

alter table public.degree_courses
  add column if not exists teachers_academic_year text;
