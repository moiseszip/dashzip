-- Situação da instalação, para o verificador da instalação (scripts/setup/verify.mjs).
-- Só diz SE cada peça existe; nunca devolve o valor de um segredo.
CREATE OR REPLACE FUNCTION public.dashzip_setup_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  jobs jsonb := '[]'::jsonb;
  has_vault boolean := EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault');
  cron_url boolean := false;
  cron_secret boolean := false;
  push_keys boolean := false;
BEGIN
  IF has_vault THEN
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'dash_rules_cron_url'
      AND decrypted_secret ~ '^https://[^/]+/api/rules-cron/tick$') INTO cron_url;
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret'
      AND length(decrypted_secret) >= 32) INTO cron_secret;
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'dash_sales_web_push_vapid'
      AND decrypted_secret::jsonb ?& ARRAY['publicKey', 'privateKey', 'subject']) INTO push_keys;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    EXECUTE $q$SELECT coalesce(jsonb_agg(jobname ORDER BY jobname), '[]'::jsonb) FROM cron.job WHERE jobname LIKE 'dash-%'$q$ INTO jobs;
  END IF;
  RETURN jsonb_build_object(
    'vault', has_vault,
    'cron_url', cron_url,
    'cron_secret', cron_secret,
    'web_push_keys', push_keys,
    'cron_jobs', jobs,
    'workspaces', (SELECT count(*) FROM public.workspaces)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.dashzip_setup_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashzip_setup_status() TO service_role;
