CREATE INDEX IF NOT EXISTS sales_push_outbox_waiting_anchor
  ON public.sales_push_outbox(anchor_sale_id)
  WHERE finished_at IS NULL AND attempts = 0;

-- The checkout processor calls this only after all sale lines have been written.
-- The minute job remains the fallback and retains its two-minute retry lease.
CREATE OR REPLACE FUNCTION public.kick_sales_web_push(p_sale_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.sales_push_outbox
  SET due_at = LEAST(due_at, now())
  WHERE anchor_sale_id = ANY(p_sale_ids)
    AND finished_at IS NULL AND attempts = 0
    AND created_at > now() - interval '5 minutes';

  IF FOUND THEN
    PERFORM public.sales_web_push_tick();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kick_sales_web_push(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kick_sales_web_push(uuid[]) TO service_role;
