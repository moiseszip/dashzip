# Mapa de calor

Coleta e desenho do mapa de calor: onde as pessoas clicam e até onde rolam a página de vendas, no estilo do Clarity. Sem gravação de sessão.

> **23/11/2026:** a tela saiu de Tracking → Mapa de calor e virou a seção **Mapa de calor** da aba [Hotjar](../27-hotjar/hotjar.md). `/heatmap` redireciona para `/hotjar`. A coleta, as tabelas e o `heatmap.js` são os mesmos; o `heatmap.js` ganhou o modo iframe (`stl_hm_embed=1`), período exato e filtros de origem e campanha. A rolagem leva também o tempo com a página visível (`heatmap_scrolls.seconds`).

## Como funciona

1. O `tracker.js` guarda cada clique e a maior rolagem da página e manda no campo `hm` do lote do `/api/t/collect`, junto com os eventos que já iam (a saída da página sempre leva o que faltou).
   - Clique: seletor CSS do elemento (para no primeiro `id`), posição relativa dentro dele (0–1), posição em pixels da página (reserva) e o texto curto de botão/link. Nada digitado é coletado.
   - Rolagem: `(rolagem + altura da janela) / altura da página`, uma linha por carregamento de página.
   - Dispositivo pela largura da janela: abaixo de 768px é celular.
2. O servidor grava em `heatmap_clicks` e `heatmap_scrolls` (fora do `tracking_ingest`). Retenção de 90 dias (pg_cron `heatmap-retencao`).
3. A aba lista as páginas (visitas, cliques, rolagem média, % que chegou ao fim), o alcance a cada 10% e os elementos mais clicados.
4. "Ver cliques/rolagem na página" abre a página real com `?stl_heatmap=<token>`. O tracker, vendo o token, **não rastreia** a visita e carrega `/api/t/heatmap.js`, que busca `/api/t/heatmap-data` e desenha por cima da página.

## Regras

| # | Regra | Resultado |
|---|---|---|
| RN-01 | Token do mapa | 48 hex em `workspaces.heatmap_token`, vale 12 h; o painel renova quando falta menos de 1 h |
| RN-02 | Posição do clique | Pelo elemento (seletor + rx/ry); sem o elemento na página, pelos pixels ajustados à largura atual |
| RN-03 | Limites | 200 cliques por página carregada, 50 por lote; o desenho lê os 5.000 cliques mais recentes |
| RN-04 | URL | Origem + caminho, sem query (igual a `tracking_events.url`) |

## Arquivos

- `supabase/schema_completo.sql` (trecho `20261107130000_mapa_de_calor.sql`)
- `packages/backend/src/modules/tracking/heatmap.ts` (validação e agregação), `heatmap.service.ts`, `heatmap.controller.ts`, `heatmap-script.ts`
- Tela: `packages/frontend/src/components/hotjar/HeatmapSection.tsx` (aba Hotjar) e `hooks/useHeatmap.ts` (token do link)
