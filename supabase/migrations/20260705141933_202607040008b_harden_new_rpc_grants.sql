-- purchase_document is intended for signed-in buyers only (uses auth.uid()).
-- This numeric timestamp is accepted by the Supabase CLI and orders the grant
-- hardening after 040008, where the function is created.
revoke execute on function public.purchase_document(uuid) from anon;
