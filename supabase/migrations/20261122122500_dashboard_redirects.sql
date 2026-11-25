ALTER TABLE public.workspaces
  ADD COLUMN redirect_workspace_id uuid,
  ADD CONSTRAINT workspaces_id_and_owner_key UNIQUE (id, user_id),
  ADD CONSTRAINT workspaces_redirect_same_owner_fk
    FOREIGN KEY (redirect_workspace_id, user_id) REFERENCES public.workspaces (id, user_id),
  ADD CONSTRAINT workspaces_redirect_not_self
    CHECK (redirect_workspace_id IS DISTINCT FROM id);

COMMENT ON COLUMN public.workspaces.redirect_workspace_id IS
  'Painel que recebe o tracking deste ID legado. NULL identifica um painel selecionável.';
