-- Triggers do Auth continuam autorizados pelo vínculo existente em auth.users.
-- Os papéis da API não precisam de execução direta nem de criar triggers com elas.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_email() FROM PUBLIC, anon, authenticated;
