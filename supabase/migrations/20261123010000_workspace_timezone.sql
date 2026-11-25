-- Fuso horário por painel (docs/features/30-settings). Aditiva.
-- Define o que é "hoje", "ontem" e "este mês" e onde cada dia começa e termina
-- nas telas e no backend. Painéis existentes ficam em São Paulo, o padrão de antes.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

COMMENT ON COLUMN public.workspaces.timezone IS
  'Fuso IANA do painel (ex.: America/Sao_Paulo). Validado pelo backend; corta os dias de vendas, campanhas e regras.';
