CREATE TABLE IF NOT EXISTS public.dashboard_finance_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sales_tax_percent numeric(7, 4) CHECK (sales_tax_percent BETWEEN 0 AND 100),
  usd_ad_tax_percent numeric(7, 4) CHECK (usd_ad_tax_percent BETWEEN 0 AND 100),
  checkout_rules jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(checkout_rules) = 'array')
);

ALTER TABLE public.dashboard_finance_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_finance_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_finance_settings TO service_role;

ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS account_currency text,
  ADD COLUMN IF NOT EXISTS account_timezone text;
