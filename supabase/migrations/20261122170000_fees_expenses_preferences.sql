-- Taxas, despesas e preferências do painel (docs/features/23-fees-expenses).
-- Aditiva: roda em banco existente sem apagar nada.

-- Listas novas na mesma linha de configuração do Resultado.
--   extra_fees:      impostos e taxas por meio de pagamento e plataforma
--   media_tax_rules: custo sobre mídia (todas as contas, por moeda ou por conta)
--   product_costs:   custo por produto
ALTER TABLE public.dashboard_finance_settings
  ADD COLUMN IF NOT EXISTS extra_fees jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS media_tax_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS product_costs jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  ALTER TABLE public.dashboard_finance_settings
    ADD CONSTRAINT dashboard_finance_settings_lists_are_arrays CHECK (
      jsonb_typeof(extra_fees) = 'array'
      AND jsonb_typeof(media_tax_rules) = 'array'
      AND jsonb_typeof(product_costs) = 'array'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- O custo sobre mídia em USD vira a regra "legacy-usd". Daqui em diante a
-- regra é a fonte; a coluna antiga só acompanha o PATCH antigo do Resultado.
UPDATE public.dashboard_finance_settings
SET media_tax_rules = jsonb_build_array(jsonb_build_object(
  'id', 'legacy-usd',
  'description', 'Custo sobre mídia em USD (IOF)',
  'percent', usd_ad_tax_percent,
  'scope', 'currency',
  'currency', 'USD',
  'accountIds', '[]'::jsonb
))
WHERE usd_ad_tax_percent IS NOT NULL AND media_tax_rules = '[]'::jsonb;

-- Despesas da operação: avulsas (numa data) ou recorrentes (um dia do mês).
CREATE TABLE IF NOT EXISTS public.dashboard_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('ads', 'tools', 'team', 'accounting', 'other')),
  amount_brl numeric(12, 2) NOT NULL CHECK (amount_brl > 0),
  kind text NOT NULL CHECK (kind IN ('single', 'recurring')),
  date date,
  start_date date,
  end_date date,
  recurring_day smallint CHECK (recurring_day BETWEEN 1 AND 28),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'single' AND date IS NOT NULL)
    OR (kind = 'recurring' AND start_date IS NOT NULL AND recurring_day IS NOT NULL
        AND (end_date IS NULL OR end_date >= start_date))
  )
);
CREATE INDEX IF NOT EXISTS idx_dashboard_expenses_workspace ON public.dashboard_expenses (workspace_id);

ALTER TABLE public.dashboard_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_expenses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_expenses TO service_role;

-- Preferências de tela por painel: layout do Resumo e colunas de Campanhas.
CREATE TABLE IF NOT EXISTS public.dashboard_preferences (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  summary_layout jsonb,
  campaign_columns jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dashboard_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_preferences TO service_role;
