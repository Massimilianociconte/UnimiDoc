-- Harden the SECURITY DEFINER functions added in 040008/040009.
-- grant_welcome_credits: the signup trigger (handle_new_user) already grants the
-- welcome bonus. Expose this helper to NO client role — admin/service only — so
-- a signed-in user can't grant credits to arbitrary confirmed accounts.
revoke execute on function public.grant_welcome_credits(uuid) from anon;
revoke execute on function public.grant_welcome_credits(uuid) from authenticated;

-- purchase_document: intended for signed-in buyers only (uses auth.uid()).
-- Remove the anon grant; keep authenticated.
revoke execute on function public.purchase_document(uuid) from anon;
