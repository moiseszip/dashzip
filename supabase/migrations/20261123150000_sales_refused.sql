-- Status "refused" em sales: pagamento recusado (cartão negado, Pix expirado,
-- pedido cancelado antes de pagar). Entra na taxa de aprovação do Resultado,
-- nunca nas vendas. Aditiva: troca só o CHECK do status, sem tocar nas linhas.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.sales'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
      AND pg_get_constraintdef(c.oid) ILIKE '%pending%'
  LOOP
    EXECUTE format('ALTER TABLE public.sales DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'refused'::text, 'refunded'::text, 'chargeback'::text]));
