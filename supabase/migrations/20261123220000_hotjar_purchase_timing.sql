-- Aba Hotjar (docs/features/27-hotjar): "Tempo até a compra".
--
-- Aditiva e somente leitura. Nada de tabela nova: o tempo sai na hora de
-- sales (venda aprovada com session_id), tracking_events (pageview e
-- checkout_click) e heatmap_scrolls (o carregamento da página).
--
-- Uma linha por compra que começou o checkout na página (kind = 'page'):
--   to_checkout: segundos do primeiro carregamento da página na sessão até o
--                primeiro checkout_click nela (o InitiateCheckout).
--   to_purchase: segundos do mesmo ponto até a aprovação (sales.sold_at).
-- O primeiro carregamento é o primeiro pageview da página na sessão ou, se o
-- pageview se perdeu, a primeira rolagem gravada dela (heatmap_scrolls).
--
-- Uma compra por sessão: a primeira venda aprovada, sem order bump (o bump e
-- o upsell da mesma sessão não contam de novo).
--
-- Mais duas linhas de contagem (n):
--   'other'      vendas com sessão no período, com os filtros, que não
--                começaram o checkout nesta página;
--   'no_session' vendas aprovadas no período sem sessão do rastreio (não dá
--                para ligar a uma página). Origem e campanha vêm da própria
--                venda; o aparelho não se aplica.
--
-- Filtros como as outras hotjar_*: período (início inclusivo, fim exclusivo)
-- pela data da venda, aparelho (o da rolagem da página na sessão; sem ela, o
-- device_type da sessão), utm_source e utm_campaign da sessão. O descarte de
-- valores absurdos (negativos, mais de 24 h) fica no serviço, que conta o que
-- saiu. Só a service role executa.

CREATE OR REPLACE FUNCTION public.hotjar_purchase_timing(
  p_workspace_id UUID,
  p_url TEXT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_device TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_campaign TEXT DEFAULT NULL
)
RETURNS TABLE (kind TEXT, to_checkout INTEGER, to_purchase INTEGER, n BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sale AS (
    SELECT DISTINCT ON (s.session_id) s.session_id, s.sold_at AS paid_at
      FROM sales s
     WHERE s.workspace_id = p_workspace_id
       AND s.status = 'approved'
       AND s.session_id IS NOT NULL
       AND NOT coalesce(s.is_order_bump, false)
       AND s.sold_at >= p_from AND s.sold_at < p_to
     ORDER BY s.session_id, s.sold_at
  ), facts AS (
    SELECT sale.paid_at,
           ts.utm_source,
           ts.utm_campaign,
           CASE WHEN ts.device_type = 'desktop' THEN 'desktop' ELSE 'mobile' END AS session_device,
           pg.device AS page_device,
           pg.loaded_at,
           ck.clicked_at,
           pv.viewed_at
      FROM sale
      LEFT JOIN tracking_sessions ts
        ON ts.workspace_id = p_workspace_id AND ts.session_id = sale.session_id
      LEFT JOIN LATERAL (
        SELECT hs.device, hs.created_at AS loaded_at
          FROM heatmap_scrolls hs
         WHERE hs.workspace_id = p_workspace_id
           AND hs.session_id = sale.session_id
           AND hs.url = p_url
         ORDER BY hs.created_at
         LIMIT 1
      ) pg ON true
      LEFT JOIN LATERAL (
        SELECT min(te.occurred_at) AS viewed_at
          FROM tracking_events te
         WHERE te.workspace_id = p_workspace_id
           AND te.session_id = sale.session_id
           AND te.event_type = 'pageview'
           AND te.url = p_url
      ) pv ON true
      LEFT JOIN LATERAL (
        SELECT min(te.occurred_at) AS clicked_at
          FROM tracking_events te
         WHERE te.workspace_id = p_workspace_id
           AND te.session_id = sale.session_id
           AND te.event_type = 'checkout_click'
           AND te.url = p_url
      ) ck ON true
     WHERE (p_source IS NULL OR ts.utm_source = p_source)
       AND (p_campaign IS NULL OR ts.utm_campaign = p_campaign)
  ), filtered AS (
    SELECT f.*, least(f.viewed_at, f.loaded_at) AS first_at
      FROM facts f
     WHERE p_device IS NULL OR coalesce(f.page_device, f.session_device) = p_device
  )
  SELECT 'page'::text,
         round(extract(epoch FROM (clicked_at - first_at)))::integer,
         round(extract(epoch FROM (paid_at - first_at)))::integer,
         1::bigint
    FROM filtered
   WHERE clicked_at IS NOT NULL
  UNION ALL
  SELECT 'other'::text, NULL, NULL, count(*)
    FROM filtered
   WHERE clicked_at IS NULL
  UNION ALL
  SELECT 'no_session'::text, NULL, NULL, count(*)
    FROM sales s
   WHERE s.workspace_id = p_workspace_id
     AND s.status = 'approved'
     AND s.session_id IS NULL
     AND NOT coalesce(s.is_order_bump, false)
     AND s.sold_at >= p_from AND s.sold_at < p_to
     AND (p_source IS NULL OR s.utm_source = p_source)
     AND (p_campaign IS NULL OR s.utm_campaign = p_campaign);
$$;

REVOKE ALL ON FUNCTION public.hotjar_purchase_timing(uuid, text, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotjar_purchase_timing(uuid, text, timestamptz, timestamptz, text, text, text) TO service_role;
