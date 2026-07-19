-- Regression test della vulnerabilità corretta il 2026-07-15:
-- match_rag_chunks (SECURITY DEFINER) deve restituire chunk SOLO dei
-- documenti accessibili al chiamante (propri, acquistati, gratuiti pubblici).
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice.test@unimidoc.local', now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bruno.test@unimidoc.local', now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'carla.test@unimidoc.local', now());

-- Documento a pagamento di Alice, indicizzato per il RAG.
insert into public.documents (id, owner_id, title, course_name, original_file_sha256, storage_path, original_size_bytes, visibility, price_credits)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Dispensa 10cr', 'Biologia', repeat('b', 64), 'test/published.pdf', 1000, 'published', 10);

insert into public.pdf_chunks (id, document_id, owner_id, page_start, page_end, chunk_index, content, content_sha256, is_active, processing_state)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1, 1, 0, 'Contenuto riservato della dispensa a pagamento.', repeat('e', 64), true, 'ready');

insert into public.rag_chunk_embeddings (chunk_id, document_id, owner_id, embedding_model, embedding_version, embedding_status, content_hash, embedding)
values (
  'cccccccc-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000002',
  '11111111-1111-1111-1111-111111111111',
  'test-model', 'v1', 'embedded', repeat('f', 64),
  (select array_fill(0.1::float4, array[768])::extensions.vector(768))
);

-- Bruno acquista il documento.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.purchase_document('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'acquisto del documento indicizzato'
);

-- Il compratore recupera i chunk.
select is(
  (select count(*) from public.match_rag_chunks(
     (select array_fill(0.1::float4, array[768])::extensions.vector(768)),
     'test-model', 'v1', 8, null, 0.0, null, 0.25)),
  1::bigint,
  'il compratore recupera i chunk del documento acquistato'
);

-- Carla NON ha acquistato: zero chunk, anche chiedendo esplicitamente il documento.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is(
  (select count(*) from public.match_rag_chunks(
     (select array_fill(0.1::float4, array[768])::extensions.vector(768)),
     'test-model', 'v1', 8, array['aaaaaaaa-0000-0000-0000-000000000002']::uuid[], 0.0, null, 0.25)),
  0::bigint,
  'senza acquisto match_rag_chunks non restituisce chunk (regression fix 2026-07-15)'
);

-- L'autrice vede i propri chunk.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(
  (select count(*) from public.match_rag_chunks(
     (select array_fill(0.1::float4, array[768])::extensions.vector(768)),
     'test-model', 'v1', 8, null, 0.0, null, 0.25)),
  1::bigint,
  'l''autrice recupera i chunk dei propri documenti'
);

select * from finish();
rollback;
