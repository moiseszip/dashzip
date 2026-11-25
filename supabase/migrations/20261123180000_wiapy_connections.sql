-- Conexão OAuth com a Wiapy por painel (docs/features/07-integrations/wiapy.md). Aditiva.
--
-- Guarda só a credencial: as vendas da Wiapy são lidas na hora, nunca gravadas.
-- client_id e tokens ficam cifrados (AES-256-GCM, EncryptionService), como o
-- token da Meta/CAPI. Só a service role do backend lê estas tabelas.

CREATE TABLE IF NOT EXISTS public.wiapy_connections (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  client_id_enc text NOT NULL,
  refresh_token_enc text NOT NULL,
  access_token_enc text,
  access_expires_at timestamptz,
  scope text,
  -- Nome da conta na Wiapy, para o card mostrar com quem está conectado.
  account_name text,
  -- Produtos da Wiapy deste painel (ids). Vazio = todas as vendas da conta.
  product_ids text[] NOT NULL DEFAULT '{}',
  -- 'reauth': a Wiapy recusou o refresh token e é preciso conectar de novo.
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'reauth')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Um "state" por clique em Conectar: uso único (apagado ao voltar) e validade de 10 minutos.
CREATE TABLE IF NOT EXISTS public.wiapy_oauth_states (
  state_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  client_id_enc text NOT NULL,
  code_verifier_enc text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wiapy_oauth_states_expires ON public.wiapy_oauth_states (expires_at);

ALTER TABLE public.wiapy_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiapy_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wiapy_connections, public.wiapy_oauth_states FROM anon, authenticated;
