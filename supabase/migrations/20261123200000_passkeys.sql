-- Passkeys (WebAuthn) como segundo fator (docs/features/30-settings). Aditiva.
--
-- O MFA nativo do Supabase recusa WebAuthn no projeto hospedado ("Enabling of
-- MFA with WebAuthn not currently supported"), então o backend Nest faz a
-- cerimônia com @simplewebauthn/server e guarda tudo aqui. Só o backend
-- (service_role) escreve; quem está logado lê as próprias linhas.

-- Uma linha por passkey cadastrada. A chave pública é pública por natureza;
-- o segredo fica no autenticador e nunca chega ao servidor.
CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Id da credencial (base64url), único no mundo.
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  -- Contador de assinaturas: se voltar para trás, a credencial pode ter sido clonada.
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON public.webauthn_credentials (user_id);

-- Desafios de uso único: o backend marca used_at no mesmo UPDATE que confere
-- se ainda não foi usado e não expirou. Falhas contam para o limite de tentativas.
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Sessão do Supabase que pediu o desafio; só ela pode responder.
  session_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('registration', 'authentication')),
  challenge text NOT NULL,
  rp_id text NOT NULL,
  origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  succeeded boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user ON public.webauthn_challenges (user_id, created_at DESC);

-- Sessão do Supabase que já confirmou a passkey: vale como aal2 no backend e
-- no ProtectedRoute. Some junto com a sessão (logout, revogação), porque a
-- sessão é a dona: não há como reaproveitar em outro login.
CREATE TABLE IF NOT EXISTS public.mfa_session_elevations (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('webauthn')),
  credential_id uuid REFERENCES public.webauthn_credentials(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfa_session_elevations_user ON public.mfa_session_elevations (user_id);

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_session_elevations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.webauthn_credentials, public.webauthn_challenges, public.mfa_session_elevations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webauthn_credentials, public.webauthn_challenges, public.mfa_session_elevations TO service_role;

-- Leitura das próprias linhas (sem escrita: cadastrar e remover passam pelo backend).
GRANT SELECT ON public.webauthn_credentials, public.mfa_session_elevations TO authenticated;
DROP POLICY IF EXISTS webauthn_credentials_select_own ON public.webauthn_credentials;
CREATE POLICY webauthn_credentials_select_own ON public.webauthn_credentials
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS mfa_session_elevations_select_own ON public.mfa_session_elevations;
CREATE POLICY mfa_session_elevations_select_own ON public.mfa_session_elevations
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Estado da passkey numa ida só, para o AuthGuard de cada requisição.
CREATE OR REPLACE FUNCTION public.passkey_session_state(p_user uuid, p_session uuid)
RETURNS TABLE (has_passkeys boolean, elevated boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.webauthn_credentials c WHERE c.user_id = p_user),
    EXISTS (
      SELECT 1 FROM public.mfa_session_elevations e
      WHERE e.session_id = p_session AND e.user_id = p_user
    );
$$;
REVOKE ALL ON FUNCTION public.passkey_session_state(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.passkey_session_state(uuid, uuid) TO service_role;
