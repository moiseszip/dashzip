-- Regras automáticas de campanhas (docs/features/25-rules). Aditiva.

CREATE TABLE IF NOT EXISTS public.dashboard_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  enabled boolean NOT NULL DEFAULT true,
  -- Filtro e alvo, condições, janela e ação, no formato do contrato.
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  last_run_at timestamptz,
  runs_day date,
  runs_today integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dashboard_rules_workspace ON public.dashboard_rules (workspace_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_rules_enabled ON public.dashboard_rules (enabled) WHERE enabled;

-- Uma linha por execução (agendada ou manual), com o que a regra fez.
CREATE TABLE IF NOT EXISTS public.dashboard_rule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.dashboard_rules(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  ran_at timestamptz NOT NULL DEFAULT now(),
  since date,
  until date,
  evaluated integer NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actions) = 'array'),
  error text
);
CREATE INDEX IF NOT EXISTS idx_dashboard_rule_runs_rule ON public.dashboard_rule_runs (rule_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboard_rule_runs_workspace ON public.dashboard_rule_runs (workspace_id, ran_at DESC);

ALTER TABLE public.dashboard_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_rule_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_rules, public.dashboard_rule_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_rules, public.dashboard_rule_runs TO service_role;

-- Log enxuto: execuções com mais de 90 dias saem.
-- Agendamento: a cada 5 minutos o pg_cron chama POST /api/rules-cron/tick do
-- painel, com o CRON_SECRET. URL e segredo ficam no Supabase Vault, nunca
-- nesta migration. Configuração única no SQL Editor:
--   select vault.create_secret('https://painel.seudominio.com.br/api/rules-cron/tick', 'dash_rules_cron_url');
--   select vault.create_secret('<o mesmo CRON_SECRET da Vercel>', 'dash_cron_secret');
-- Sem os dois segredos, o job roda e não chama nada.
CREATE OR REPLACE FUNCTION public.dash_rules_tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  target text;
  secret text;
BEGIN
  SELECT decrypted_secret INTO target FROM vault.decrypted_secrets WHERE name = 'dash_rules_cron_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret';
  IF target IS NULL OR secret IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dashboard_rules WHERE enabled) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := target,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.dash_rules_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('dash-rules-tick', '*/5 * * * *', 'SELECT public.dash_rules_tick();');
  PERFORM cron.schedule('dash-rule-runs-retention', '45 4 * * *',
    $job$ DELETE FROM public.dashboard_rule_runs WHERE ran_at < now() - interval '90 days'; $job$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel, regras nao agendadas (%).', SQLERRM;
END;
$$;
