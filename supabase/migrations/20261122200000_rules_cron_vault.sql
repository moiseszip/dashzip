-- O endpoint verifica o SHA-256 do token sem ler o segredo do Vault.
CREATE OR REPLACE FUNCTION public.verify_dash_rules_cron(p_digest text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'dash_cron_secret'
      AND length(decrypted_secret) > 0
      AND encode(sha256(convert_to(decrypted_secret, 'UTF8')), 'hex') = p_digest
  );
$$;

REVOKE ALL ON FUNCTION public.verify_dash_rules_cron(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_dash_rules_cron(text) TO service_role;
