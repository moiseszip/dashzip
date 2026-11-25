-- Auditoria de segurança de 2026-11-23 (docs/auditorias/2026-11-23-seguranca.md).
--
-- Aditiva: só cria políticas e reduz permissões de execução. Nenhum dado muda.
--
-- 1. Acesso direto ao banco só pelo backend.
--    O navegador e o app iOS leem tudo pela API (service role, que ignora
--    RLS). As políticas antigas de "dono lê/escreve" deixavam qualquer token
--    de sessão do Supabase consultar o PostgREST direto, e isso:
--      - pulava o segundo fator: o token aal1 (só a senha) lia vendas com
--        e-mail/telefone/CPF dos compradores, o webhook_secret dos checkouts,
--        o token do mapa de calor e as sessões de rastreio, e escrevia em
--        sales, workspaces e checkout_integrations;
--      - deixava uma conta gravar workspace_id de outra conta (sales,
--        checkout_integrations), porque as políticas só conferem user_id.
--    Uma política RESTRICTIVE com `false` vale por cima das permissivas:
--    anon e authenticated não leem nem escrevem nada nessas tabelas.
--    Fica de fora só `profiles`, que o front lê e atualiza (nome e avatar).
--
-- 2. admin_list_users (SECURITY DEFINER) podia ser executada por anon e
--    authenticated. Hoje ela quebra (plan_rules/user_roles não existem
--    mais), mas se essas tabelas voltassem ela devolveria e-mail e CPF de
--    todos os usuários para qualquer um. Só a service role executa.
--    O mesmo para as funções antigas que anon ainda podia chamar.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> 'profiles'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t.relname AND policyname = 'somente_backend'
    ) THEN
      EXECUTE format(
        'CREATE POLICY somente_backend ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t.relname
      );
    END IF;
  END LOOP;
END $$;

-- profiles: o dono continua lendo e atualizando, mas sem trocar de dono.
DROP POLICY IF EXISTS profiles_sem_trocar_dono ON public.profiles;
CREATE POLICY profiles_sem_trocar_dono ON public.profiles
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('admin_list_users', 'dashboard_metrics', 'sales_summary', 'sales_grouped_by_ad', 'extract_numeric_ad_id')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;
