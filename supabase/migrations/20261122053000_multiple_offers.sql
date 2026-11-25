-- Cada oferta usa um workspace, e cada login pode gerenciar várias ofertas.
DROP INDEX IF EXISTS public.idx_workspaces_one_per_user;
