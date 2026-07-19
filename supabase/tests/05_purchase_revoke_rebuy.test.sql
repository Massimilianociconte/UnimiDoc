-- Re-purchase after access revoke and active-only uniqueness.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'seller.revoke@unimidoc.local', now()),
  ('00000000-0000-0000-0000-000000000000', 'a2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'buyer.revoke@unimidoc.local', now());

insert into public.documents (id, owner_id, title, course_name, original_file_sha256, storage_path, original_size_bytes, visibility, price_credits)
values
  ('b1111111-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'Dispensa revoke', 'Biologia', repeat('e', 64), 'test/revoke.pdf', 1000, 'published', 10);

-- Grant extra credits so buyer can purchase twice.
update public.user_credit_accounts
set free_credits = free_credits + 20,
    balance = balance + 20
where owner_id = 'a2222222-2222-2222-2222-222222222222';

select set_config('request.jwt.claims', '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.purchase_document('b1111111-0000-0000-0000-000000000001')$$,
  'primo acquisto riuscito'
);

reset role;

update public.document_purchases
set status = 'revoked',
    refunded_at = now()
where buyer_id = 'a2222222-2222-2222-2222-222222222222'
  and document_id = 'b1111111-0000-0000-0000-000000000001'
  and status = 'active';

select is(
  (select count(*) from public.document_purchases
   where buyer_id = 'a2222222-2222-2222-2222-222222222222'
     and document_id = 'b1111111-0000-0000-0000-000000000001'
     and status = 'active'),
  0::bigint,
  'nessun acquisto active dopo revoke'
);

set local role authenticated;
select lives_ok(
  $$select public.purchase_document('b1111111-0000-0000-0000-000000000001')$$,
  're-buy dopo revoke riuscito'
);
reset role;

select is(
  (select count(*) from public.document_purchases
   where buyer_id = 'a2222222-2222-2222-2222-222222222222'
     and document_id = 'b1111111-0000-0000-0000-000000000001'
     and status = 'active'),
  1::bigint,
  'esiste un solo acquisto active dopo re-buy'
);

select * from finish();
rollback;
