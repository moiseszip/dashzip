BEGIN;

ALTER TABLE public.checkout_integrations
  DROP CONSTRAINT IF EXISTS checkout_integrations_platform_check;

ALTER TABLE public.checkout_integrations
  ADD CONSTRAINT checkout_integrations_platform_check
  CHECK (platform = ANY (ARRAY[
    'hotmart'::text,
    'kiwify'::text,
    'kirvano'::text,
    'guru'::text,
    'perfectpay'::text,
    'ticto'::text,
    'payt'::text,
    'cakto'::text,
    'hubla'::text,
    'cartpanda'::text,
    'ggcheckout'::text,
    'lastlink'::text,
    'eduzz'::text,
    'mundpay'::text,
    'monetizze'::text,
    'greenn'::text,
    'wiven'::text,
    'frendz'::text,
    'herospark'::text,
    'kavoo'::text,
    'pagtrust'::text,
    'assiny'::text,
    'yampi'::text,
    'wiapy'::text,
    'doppus'::text,
    'abacatepay'::text
  ]));

COMMIT;
