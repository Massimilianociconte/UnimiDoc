-- Isolamento RLS di base: l'utente A non può leggere o modificare i dati
-- privati dell'utente B (documenti, consensi legali). Eseguito da
-- `supabase test db` sul database locale con le migrazioni applicate.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- Utenti di test (il trigger handle_new_user provvede profilo e crediti).
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice.test@unimidoc.local', now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bruno.test@unimidoc.local', now());

-- Documento privato di Alice + documento pubblicato a pagamento.
insert into public.documents (id, owner_id, title, course_name, original_file_sha256, storage_path, original_size_bytes, visibility, price_credits)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bozza privata', 'Biologia', repeat('a', 64), 'test/private.pdf', 1000, 'private', 10),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Dispensa pubblicata', 'Biologia', repeat('b', 64), 'test/published.pdf', 1000, 'published', 10);

-- ── Bruno autenticato ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*) from public.documents where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'RLS: B non vede il documento privato di A'
);

select is(
  (select count(*)
   from public.documents
   where id = 'aaaaaaaa-0000-0000-0000-000000000002'
     and owner_id <> '22222222-2222-2222-2222-222222222222'),
  (select count(*) from public.documents where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'RLS: la visibilità del documento pubblicato non dipende da un falso ownership'
);

-- La scrittura diretta sui documenti è riservata alle RPC/service role:
-- per authenticated l'UPDATE è negato a livello di grant.
select throws_ok(
  $$update public.documents set title = 'HACK' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'B non può modificare il documento di A (grant negato)'
);

-- INSERT con owner_id falsificato deve fallire.
select throws_ok(
  $$insert into public.documents (owner_id, title, course_name, original_file_sha256, storage_path, original_size_bytes)
    values ('11111111-1111-1111-1111-111111111111', 'Falso', 'Chimica', repeat('c', 64), 'test/fake.pdf', 10)$$,
  '42501',
  null,
  'RLS: B non può inserire documenti a nome di A'
);

-- ── Consensi legali ──────────────────────────────────────────────────────────
select lives_ok(
  $$select public.record_legal_acceptance(array['terms','privacy'], '2026-07-15', 'it-IT')$$,
  'record_legal_acceptance registra il consenso per B'
);

select is(
  (select count(*) from public.legal_consents),
  2::bigint,
  'B vede soltanto i propri consensi (terms + privacy)'
);

-- Idempotenza: ripetere la stessa accettazione non duplica righe.
select lives_ok(
  $$select public.record_legal_acceptance(array['terms','privacy'], '2026-07-15', 'it-IT')$$,
  'record_legal_acceptance è idempotente'
);
select is(
  (select count(*) from public.legal_consents),
  2::bigint,
  'nessuna riga duplicata dopo la seconda accettazione'
);

-- ── Alice non vede i consensi di Bruno ──────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(
  (select count(*) from public.legal_consents),
  0::bigint,
  'RLS: A non vede i consensi di B'
);

select * from finish();
rollback;
