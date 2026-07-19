-- Voti qualità flashcard univoci per utente + accesso SRS limitato a chi
-- possiede o ha acquistato il documento.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice.test@unimidoc.local', now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bruno.test@unimidoc.local', now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'carla.test@unimidoc.local', now());

insert into public.documents (id, owner_id, title, course_name, original_file_sha256, storage_path, original_size_bytes, visibility, price_credits)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Dispensa 10cr', 'Biologia', repeat('b', 64), 'test/published.pdf', 1000, 'published', 10);

insert into public.flashcards (id, document_id, owner_id, card_type, front, back, status)
values ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'qa', 'Domanda?', 'Risposta.', 'approved');

-- ── Senza acquisto: il voto è rifiutato ──────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select public.set_flashcard_quality_vote('ffffffff-0000-0000-0000-000000000001', 1::smallint)$$,
  '42501',
  'purchase_required_for_quality_vote',
  'il voto richiede un acquisto attivo'
);

-- ── Bruno compra e vota ─────────────────────────────────────────────────────
select lives_ok(
  $$select public.purchase_document('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'acquisto propedeutico al voto'
);
select lives_ok(
  $$select public.set_flashcard_quality_vote('ffffffff-0000-0000-0000-000000000001', 1::smallint)$$,
  'primo voto registrato'
);
-- Un secondo voto sostituisce il precedente, non lo duplica.
select lives_ok(
  $$select public.set_flashcard_quality_vote('ffffffff-0000-0000-0000-000000000001', -1::smallint)$$,
  'secondo voto accettato come aggiornamento'
);

reset role;
select is(
  (select count(*) from public.flashcard_quality_votes
   where flashcard_id = 'ffffffff-0000-0000-0000-000000000001'
     and owner_id = '22222222-2222-2222-2222-222222222222'),
  1::bigint,
  'un solo voto per utente per flashcard'
);

-- ── L'autore non può votarsi ────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_flashcard_quality_vote('ffffffff-0000-0000-0000-000000000001', 1::smallint)$$,
  '42501',
  'author_cannot_vote',
  'l''autore non può votare le proprie flashcard'
);

-- ── SRS: chi non ha accesso non registra progressi ──────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select throws_ok(
  $$select public.record_flashcard_study_event('ffffffff-0000-0000-0000-000000000001', 'correct', now() + interval '1 day', now())$$,
  null,
  'senza acquisto lo studio della flashcard è rifiutato'
);

select * from finish();
rollback;
