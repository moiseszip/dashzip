CREATE TABLE IF NOT EXISTS public.sales_push_preferences (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pending boolean NOT NULL DEFAULT false,
  approved boolean NOT NULL DEFAULT false,
  sale_value text NOT NULL DEFAULT 'total' CHECK (sale_value IN ('total', 'net', 'hidden')),
  show_product boolean NOT NULL DEFAULT false,
  show_campaign boolean NOT NULL DEFAULT false,
  show_workspace boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.sales_push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL
);

CREATE INDEX IF NOT EXISTS sales_push_devices_user ON public.sales_push_devices(user_id);

CREATE TABLE IF NOT EXISTS public.sales_push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  anchor_sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.sales_push_devices(id) ON DELETE CASCADE,
  integration_key uuid NOT NULL,
  order_key text NOT NULL,
  sale_status text NOT NULL CHECK (sale_status IN ('pending', 'approved')),
  attempts integer NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL DEFAULT (now() + interval '15 seconds'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (workspace_id, integration_key, order_key, sale_status, device_id)
);

CREATE INDEX IF NOT EXISTS sales_push_outbox_due ON public.sales_push_outbox(due_at)
  WHERE finished_at IS NULL AND attempts < 5;

ALTER TABLE public.sales_push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_push_preferences, public.sales_push_devices, public.sales_push_outbox
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_push_preferences, public.sales_push_devices TO service_role;
GRANT SELECT, UPDATE ON public.sales_push_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_sale_web_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    OR NEW.workspace_id IS NULL OR NEW.status IS NULL OR NEW.status NOT IN ('pending', 'approved')
    OR NEW.metadata ->> 'sale_push_webhook' IS DISTINCT FROM 'true' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.sales_push_outbox
    (workspace_id, anchor_sale_id, device_id, integration_key, order_key, sale_status)
  SELECT NEW.workspace_id, NEW.id, d.id,
    COALESCE(NEW.checkout_integration_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(NULLIF(NEW.order_external_id, ''), NULLIF(NEW.external_id, ''), NEW.id::text),
    NEW.status
  FROM public.sales_push_preferences p
  JOIN public.sales_push_devices d ON d.user_id = NEW.user_id
  WHERE p.workspace_id = NEW.workspace_id
    AND CASE NEW.status WHEN 'approved' THEN p.approved ELSE p.pending END
  ON CONFLICT (workspace_id, integration_key, order_key, sale_status, device_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_sale_web_push() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sales_enqueue_web_push ON public.sales;
CREATE TRIGGER sales_enqueue_web_push AFTER INSERT OR UPDATE OF status ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_sale_web_push();

CREATE OR REPLACE FUNCTION public.claim_sales_web_push()
RETURNS SETOF public.sales_push_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH due AS (
    SELECT id FROM public.sales_push_outbox
    WHERE finished_at IS NULL AND attempts < 5 AND due_at <= now()
      AND created_at > now() - interval '1 hour'
    ORDER BY due_at, id LIMIT 20 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sales_push_outbox o SET attempts = o.attempts + 1, due_at = now() + interval '2 minutes'
  FROM due WHERE o.id = due.id RETURNING o.*;
$$;
REVOKE ALL ON FUNCTION public.claim_sales_web_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sales_web_push() TO service_role;

CREATE OR REPLACE FUNCTION public.read_sales_web_push_keys() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret::jsonb FROM vault.decrypted_secrets
    WHERE name = 'dash_sales_web_push_vapid';
$$;
REVOKE ALL ON FUNCTION public.read_sales_web_push_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_web_push_keys() TO service_role;

CREATE OR REPLACE FUNCTION public.sales_web_push_tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sales_push_outbox
    WHERE finished_at IS NULL AND attempts < 5 AND due_at <= now()
      AND created_at > now() - interval '1 hour') THEN RETURN; END IF;

  SELECT decrypted_secret INTO target FROM vault.decrypted_secrets WHERE name = 'dash_rules_cron_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret';
  IF target IS NULL OR secret IS NULL OR target !~ '/api/rules-cron/tick$' THEN RETURN; END IF;

  PERFORM net.http_post(
    url := regexp_replace(target, '/api/rules-cron/tick$', '/api/sales-push-cron/tick'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.sales_web_push_tick() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('dash-sales-web-push', '* * * * *', 'SELECT public.sales_web_push_tick();');
  PERFORM cron.schedule('dash-sales-web-push-retention', '47 4 * * *',
    $job$ DELETE FROM public.sales_push_outbox WHERE created_at < now() - interval '30 days'; $job$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Agendamento de Web Push indisponível (%).', SQLERRM;
END $$;
