-- Emoji do painel (aparece antes do nome no seletor e no menu recolhido). Aditiva.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS emoji text;

COMMENT ON COLUMN public.workspaces.emoji IS
  'Emoji opcional do painel, mostrado antes do nome. Validado pelo backend (um emoji, até 16 caracteres).';
