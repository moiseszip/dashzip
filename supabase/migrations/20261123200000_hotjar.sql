-- Aba Hotjar (docs/features/27-hotjar): comportamento nas páginas.
--
-- Aditiva. Nada de tabela nova: a rolagem e os cliques continuam em
-- heatmap_scrolls/heatmap_clicks (retenção de 90 dias, pg_cron
-- heatmap-retencao) e as etapas do quiz são eventos custom "quiz_step" em
-- tracking_events (retenção de 90 dias do rastreio).
--
--   1. heatmap_scrolls.seconds: tempo com a página visível, em segundos. O
--      tracker manda junto da rolagem (campo `ts` do `hm`); linhas antigas
--      ficam nulas.
--   2. Índice parcial para achar os eventos custom por nome (quiz_step).
--   3. Leituras da aba com período (início inclusivo, fim exclusivo),
--      aparelho e filtros de origem (utm_source) e campanha (utm_campaign)
--      da sessão. Só a service role executa.

ALTER TABLE public.heatmap_scrolls
  ADD COLUMN IF NOT EXISTS seconds INTEGER CHECK (seconds BETWEEN 0 AND 86400);

CREATE INDEX IF NOT EXISTS idx_tracking_events_custom_name
  ON public.tracking_events (workspace_id, event_name, occurred_at)
  WHERE event_type = 'custom';

-- Páginas com dados no período, com os filtros. quiz_sessions > 0 quando a
-- página mandou etapas de quiz.
CREATE OR REPLACE FUNCTION public.hotjar_pages(
  p_workspace_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_device TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_campaign TEXT DEFAULT NULL
)
RETURNS TABLE (url TEXT, views BIGINT, avg_depth NUMERIC, reached_end BIGINT, clicks BIGINT, quiz_sessions BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sess AS (
    SELECT ts.session_id
      FROM tracking_sessions ts
     WHERE ts.workspace_id = p_workspace_id
       AND (p_source IS NULL OR ts.utm_source = p_source)
       AND (p_campaign IS NULL OR ts.utm_campaign = p_campaign)
  ), s AS (
    SELECT hs.url,
           count(*) AS views,
           round(avg(hs.depth_pct)::numeric, 1) AS avg_depth,
           count(*) FILTER (WHERE hs.depth_pct >= 90) AS reached_end
      FROM heatmap_scrolls hs
     WHERE hs.workspace_id = p_workspace_id
       AND (p_device IS NULL OR hs.device = p_device)
       AND hs.created_at >= p_from AND hs.created_at < p_to
       AND (p_source IS NULL AND p_campaign IS NULL OR hs.session_id IN (SELECT session_id FROM sess))
     GROUP BY hs.url
  ), c AS (
    SELECT hc.url, count(*) AS clicks
      FROM heatmap_clicks hc
     WHERE hc.workspace_id = p_workspace_id
       AND (p_device IS NULL OR hc.device = p_device)
       AND hc.created_at >= p_from AND hc.created_at < p_to
       AND (p_source IS NULL AND p_campaign IS NULL OR hc.session_id IN (SELECT session_id FROM sess))
     GROUP BY hc.url
  ), q AS (
    SELECT te.url, count(DISTINCT te.session_id) AS quiz_sessions
      FROM tracking_events te
     WHERE te.workspace_id = p_workspace_id
       AND te.event_type = 'custom'
       AND te.event_name = 'quiz_step'
       AND te.occurred_at >= p_from AND te.occurred_at < p_to
     GROUP BY te.url
  )
  SELECT s.url, s.views, s.avg_depth, s.reached_end, coalesce(c.clicks, 0), coalesce(q.quiz_sessions, 0)
    FROM s
    LEFT JOIN c ON c.url = s.url
    LEFT JOIN q ON q.url = s.url
   ORDER BY s.views DESC
   LIMIT 200;
$$;

-- Rolagem e tempo de cada carregamento da página.
CREATE OR REPLACE FUNCTION public.hotjar_scrolls(
  p_workspace_id UUID,
  p_url TEXT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_device TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_campaign TEXT DEFAULT NULL
)
RETURNS TABLE (depth_pct SMALLINT, fold_pct SMALLINT, seconds INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hs.depth_pct, hs.fold_pct, hs.seconds
    FROM heatmap_scrolls hs
    LEFT JOIN tracking_sessions ts
      ON ts.workspace_id = hs.workspace_id AND ts.session_id = hs.session_id
   WHERE hs.workspace_id = p_workspace_id
     AND hs.url = p_url
     AND (p_device IS NULL OR hs.device = p_device)
     AND hs.created_at >= p_from AND hs.created_at < p_to
     AND (p_source IS NULL OR ts.utm_source = p_source)
     AND (p_campaign IS NULL OR ts.utm_campaign = p_campaign)
   ORDER BY hs.created_at DESC
   LIMIT 20000;
$$;

-- Cliques da página (os 5.000 mais recentes), no formato do desenho.
CREATE OR REPLACE FUNCTION public.hotjar_clicks(
  p_workspace_id UUID,
  p_url TEXT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_device TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_campaign TEXT DEFAULT NULL
)
RETURNS TABLE (selector TEXT, rx REAL, ry REAL, px INTEGER, py INTEGER, doc_w INTEGER, label TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hc.selector, hc.rx, hc.ry, hc.px, hc.py, hc.doc_w, hc.label
    FROM heatmap_clicks hc
    LEFT JOIN tracking_sessions ts
      ON ts.workspace_id = hc.workspace_id AND ts.session_id = hc.session_id
   WHERE hc.workspace_id = p_workspace_id
     AND hc.url = p_url
     AND (p_device IS NULL OR hc.device = p_device)
     AND hc.created_at >= p_from AND hc.created_at < p_to
     AND (p_source IS NULL OR ts.utm_source = p_source)
     AND (p_campaign IS NULL OR ts.utm_campaign = p_campaign)
   ORDER BY hc.created_at DESC
   LIMIT 5000;
$$;

-- Etapas do quiz: uma linha por sessão e etapa. O aparelho vem da rolagem do
-- mesmo carregamento (page_id), para bater com a classificação do mapa.
CREATE OR REPLACE FUNCTION public.hotjar_quiz(
  p_workspace_id UUID,
  p_url TEXT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_device TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_campaign TEXT DEFAULT NULL
)
RETURNS TABLE (session_id TEXT, step TEXT, idx INTEGER, first_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT te.session_id,
         left(te.metadata->'props'->>'step', 60) AS step,
         max(CASE WHEN te.metadata->'props'->>'index' ~ '^[0-9]{1,3}$'
                  THEN (te.metadata->'props'->>'index')::int END) AS idx,
         min(te.occurred_at) AS first_at
    FROM tracking_events te
    LEFT JOIN heatmap_scrolls hs
      ON hs.workspace_id = te.workspace_id AND hs.session_id = te.session_id
     AND hs.page_id = te.metadata->>'page_id'
    LEFT JOIN tracking_sessions ts
      ON ts.workspace_id = te.workspace_id AND ts.session_id = te.session_id
   WHERE te.workspace_id = p_workspace_id
     AND te.event_type = 'custom'
     AND te.event_name = 'quiz_step'
     AND te.url = p_url
     AND te.occurred_at >= p_from AND te.occurred_at < p_to
     AND coalesce(te.metadata->'props'->>'step', '') <> ''
     AND (p_device IS NULL OR hs.device = p_device)
     AND (p_source IS NULL OR ts.utm_source = p_source)
     AND (p_campaign IS NULL OR ts.utm_campaign = p_campaign)
   GROUP BY te.session_id, left(te.metadata->'props'->>'step', 60)
   LIMIT 100000;
$$;

-- Opções dos filtros: origens e campanhas das sessões com rolagem no período.
CREATE OR REPLACE FUNCTION public.hotjar_filters(
  p_workspace_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_device TEXT DEFAULT NULL
)
RETURNS TABLE (kind TEXT, value TEXT, sessions BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT DISTINCT ts.session_id, ts.utm_source, ts.utm_campaign
      FROM heatmap_scrolls hs
      JOIN tracking_sessions ts
        ON ts.workspace_id = hs.workspace_id AND ts.session_id = hs.session_id
     WHERE hs.workspace_id = p_workspace_id
       AND (p_device IS NULL OR hs.device = p_device)
       AND hs.created_at >= p_from AND hs.created_at < p_to
  ), src AS (
    SELECT 'source'::text AS kind, utm_source AS value, count(*) AS sessions
      FROM s WHERE utm_source IS NOT NULL GROUP BY utm_source ORDER BY 3 DESC LIMIT 50
  ), cmp AS (
    SELECT 'campaign'::text AS kind, utm_campaign AS value, count(*) AS sessions
      FROM s WHERE utm_campaign IS NOT NULL GROUP BY utm_campaign ORDER BY 3 DESC LIMIT 50
  )
  SELECT * FROM src UNION ALL SELECT * FROM cmp;
$$;

REVOKE ALL ON FUNCTION public.hotjar_pages(uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotjar_pages(uuid, timestamptz, timestamptz, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.hotjar_scrolls(uuid, text, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotjar_scrolls(uuid, text, timestamptz, timestamptz, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.hotjar_clicks(uuid, text, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotjar_clicks(uuid, text, timestamptz, timestamptz, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.hotjar_quiz(uuid, text, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotjar_quiz(uuid, text, timestamptz, timestamptz, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.hotjar_filters(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotjar_filters(uuid, timestamptz, timestamptz, text) TO service_role;
