-- Ofertas do Acompanhamento de testes (docs/features/26-tests). Aditiva.
-- Uma oferta é reconhecida pelo código no nome da campanha (ARC, GMD…).
ALTER TABLE public.dashboard_preferences
  ADD COLUMN IF NOT EXISTS test_offers jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  ALTER TABLE public.dashboard_preferences
    ADD CONSTRAINT dashboard_preferences_test_offers_array CHECK (jsonb_typeof(test_offers) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
