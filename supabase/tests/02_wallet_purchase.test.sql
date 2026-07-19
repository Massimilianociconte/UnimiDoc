-- Invarianti del wallet e flusso di acquisto atomico:
-- crediti di benvenuto unici, acquisti idempotenti, errori autorizzativi.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice.test@unimidoc.local', now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bruno.test@unimidoc.local', now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'carla.test@unimidoc.local', now());

-- Benvenuto: il provisioning assegna il bonus una sola volta.
select is(
  (select balance from public.user_credit_accounts where owner_id = '22222222-2222-2222-2222-222222222222'),
  30,
  'il provisioning assegna 30 crediti di benvenuto'
);

select public.grant_welcome_credits('22222222-2222-2222-2222-222222222222');
select is(
  (select balance from public.user_credit_accounts where owner_id = '22222222-2222-2222-2222-222222222222'),
  30,
  'grant_welcome_credits è idempotente: nessun secondo bonus'
);

insert into public.documents (id, owner_id, title, course_name, original_file_sha256, storage_path, original_size_bytes, visibility, price_credits)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Dispensa 10cr', 'Biologia', repeat('b', 64), 'test/published.pdf', 1000, 'published', 10),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Dispensa 100cr', 'Biologia', repeat('d', 64), 'test/expensive.pdf', 1000, 'published', 100),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bozza privata', 'Biologia', repeat('a', 64), 'test/private.pdf', 1000, 'private', 10);

-- ── Bruno compra la dispensa da 10 crediti ───────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.purchase_document('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'acquisto riuscito con saldo sufficiente'
);

reset role;
select is(
  (select balance from public.user_credit_accounts where owner_id = '22222222-2222-2222-2222-222222222222'),
  20,
  'il saldo scende esattamente del prezzo (30 → 20)'
);

-- Secondo acquisto dello stesso documento: mai una seconda riga né un secondo addebito.
set local role authenticated;
do $$
begin
  perform public.purchase_document('aaaaaaaa-0000-0000-0000-000000000002');
exception when others then
  null; -- un errore esplicito è accettabile: l'invariante è sotto
end $$;
reset role;

select is(
  (select count(*) from public.document_purchases
   where buyer_id = '22222222-2222-2222-2222-222222222222'
     and document_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1::bigint,
  'nessun acquisto duplicato per lo stesso documento'
);
select is(
  (select balance from public.user_credit_accounts where owner_id = '22222222-2222-2222-2222-222222222222'),
  20,
  'nessun doppio addebito dopo il retry'
);

-- ── Errori autorizzativi ─────────────────────────────────────────────────────
set local role authenticated;

-- Carla (30 crediti) non può comprare la dispensa da 100.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select throws_ok(
  $$select public.purchase_document('aaaaaaaa-0000-0000-0000-000000000003')$$,
  'P0001',
  'insufficient_credits',
  'acquisto rifiutato con saldo insufficiente'
);

-- Un documento privato non è acquistabile.
select throws_ok(
  $$select public.purchase_document('aaaaaaaa-0000-0000-0000-000000000001')$$,
  'P0001',
  null,
  'un documento privato non è acquistabile'
);

-- Alice non può comprare il proprio documento.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select throws_ok(
  $$select public.purchase_document('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'P0001',
  'own_document',
  'l''autore non può acquistare il proprio documento'
);

select * from finish();
rollback;
