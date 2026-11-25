ALTER TABLE public.sales_push_preferences
  ADD COLUMN IF NOT EXISTS show_workspace_icon boolean NOT NULL DEFAULT false;
