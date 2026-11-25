# Hotjar

> **Modulo:** `packages/backend/src/modules/hotjar` (+ `tracking/heatmap*`, `vsl/`) | **Pagina:** aba **Hotjar** (`/hotjar`), entre Acompanhamento de testes e Vendas
> **Ultima atualizacao:** 2026-11-23
> **Status:** Publicado

---

## 1. Proposito

Uma aba só para o comportamento nas páginas do painel, no lugar da antiga aba VSL. Para cada página (LP) ela junta:

1. **Mapa de calor**: mapa de cliques e mapa de rolagem desenhados sobre a página real.
2. **Retenção da página**: até onde rolam, por % da página e por dobra, onde abandonam e quanto tempo ficam.
3. **Tempo até a compra**: quanto tempo quem comprou ficou na página antes de ir para o checkout (e até a venda ser aprovada).
4. **Quiz**: funil por etapa, quando a página é um quiz (ex.: `lp.seudominio.com.br/quiz`).
5. **VSL**: a curva de retenção da mini VSL, quando a página tem uma ([detalhe](vsl.md)).

Os dados de comportamento vêm do código da página do Dash.zip (`tracker.js`), o mesmo snippet do rastreio. Nada de script de terceiro na LP. A VSL, quando ligada, vem da tabela de origem descrita em [vsl.md](vsl.md).

Endereços antigos: `/vsl` e `/heatmap` (Tracking → Mapa de calor) redirecionam para `/hotjar`.

## 2. Comportamento para o Usuario

1. **Filtros (topo):** Página (lista das páginas com visitas no filtro, com o número de visitas e as marcas "quiz"/"VSL"), Data (seletor padrão `ResultDatePicker`, padrão "Últimos 7 dias", até 92 dias), Aparelho (Celular/Computador), Origem (`utm_source` da sessão) e Campanha (`utm_campaign`, mostrada só com o nome antes do `|`). A página escolhida fica lembrada por painel no navegador (localStorage).
2. **Mapa de calor:** a página real abre dentro do card num iframe com `?stl_heatmap=<token>&stl_hm_embed=1`. No celular, na largura de um iPhone (390 px); no computador, 1280 px reduzidos para caber. **Cliques/Rolagem** troca o desenho sem recarregar (postMessage). **Abrir em nova aba** abre a página com a barra própria do mapa. A visita aberta pelo painel não é contada. Abaixo, os 10 elementos mais clicados.
3. **Retenção da página:** cards (visitas, rolagem média, viram até o fim = 90% ou mais, tempo na página = mediana com a média ao lado); barras de alcance a cada 10% com a marca do fim da 1ª tela; alcance por dobra (1ª tela, 2ª tela…); **onde abandonam** (faixa de 10% onde a rolagem parou, com a maior saída depois da 1ª tela em destaque e numa frase); **tempo na página** em faixas (até 10 s … 5 min ou mais).
4. **Tempo até a compra** (abaixo da retenção): alternador **Até o checkout** (do primeiro carregamento da página na sessão até o clique no checkout, o principal) / **Até a compra** (até a aprovação da venda). Cards de mediana, média, P75 e P90 em formato legível ("1 min 20 s", "1 h 15 min"), a frase "Metade foi para o checkout em até X; 90% em até Y" e uma barra por faixa (0–10 s, 10–30 s, 30–60 s, 1–2 min, 2–5 min, 5–10 min, 10–30 min, 30 min–2 h, mais de 2 h) com a % e a contagem de compras e o **% acumulado**. A barra de cada faixa começa onde a anterior terminou, então a ponta direita é o acumulado ("70% compraram em até 10 s"). No rodapé: quantas compras entraram e o que ficou de fora (vendas sem sessão do rastreio, descartadas por tempo absurdo, sem o carregamento registrado, compras com sessão sem clique de checkout registrado nesta página — que pode ter ocorrido em outra página). Sem compras com sessão na página: aviso no lugar do gráfico. Os números ficam visíveis no modo streaming.
5. **Quiz:** aparece quando a página mandou etapas (ou o caminho tem `/quiz`). Cards (começaram, chegaram ao fim, conclusão) e uma barra por etapa com as sessões, a % do início e "↓ X% avançaram"; a etapa que mais perde gente fica em vermelho.
6. **VSL:** aparece quando a página tem a mini VSL (ver [vsl.md](vsl.md)), com o mesmo período da aba.
7. **Modo streaming:** a página vira "Página N" no seletor, a campanha vira "Campanha N", o texto e o seletor dos elementos clicados são mascarados e o iframe fica escondido até tocar em **Mostrar a página** (o conteúdo mostraria a oferta). Nenhum domínio ou caminho aparece no DOM.
8. **Celular (390 px):** filtros empilhados em largura total, seções uma embaixo da outra, iframe na largura do card.

## 3. Regras de Negocio

| # | Regra | Resultado |
|---|---|---|
| RN-01 | Visita | Um carregamento de página (`heatmap_scrolls`, uma linha por sessão + `page_id`) |
| RN-02 | Período | Dias do fuso do painel: de `since` 00:00 a `until` 23:59 (`dayRangeUtc`). Máximo de 92 dias |
| RN-03 | Aparelho | Pela largura da janela: abaixo de 768 px é celular (mesma regra do mapa de calor) |
| RN-04 | Origem/Campanha | `utm_source`/`utm_campaign` da sessão (`tracking_sessions`), valor exato. Vazio = todas |
| RN-05 | Alcance | % das visitas cuja rolagem máxima chegou a cada ponto (a cada 5%; a tela mostra de 10 em 10) |
| RN-06 | Dobra | Fim da 1ª tela = média de `fold_pct`. A tela k termina em k × dobra; até 10 telas |
| RN-07 | Abandono | Rolagem máxima de cada visita numa faixa de 10% (100% entra em 90–100%). A "maior saída" ignora faixas que terminam dentro da 1ª tela e a última faixa (fim da página) |
| RN-08 | Tempo na página | Segundos com a aba visível (aba em segundo plano não conta), medidos desde 23/11/2026. Linhas antigas ficam fora da mediana, da média e das faixas |
| RN-09 | Etapa do quiz | Evento próprio `quiz_step` com `{ step, index }`. Uma sessão conta uma vez por etapa |
| RN-10 | Ordem das etapas | Pelo menor `index` recebido; sem `index`, pela posição média em que as sessões viram a etapa |
| RN-11 | Funil | A etapa mais funda de cada sessão conta nela e em todas as anteriores (quem recarregou e caiu direto num passo adiante passou pelos de antes). "Avançaram" = sessões na etapa seguinte ÷ sessões na etapa |
| RN-12 | Etapa que mais perde | Menor "avançaram" entre as etapas que têm próxima, se for abaixo de 100% |
| RN-14 | Compra da página (tempo até a compra) | Venda aprovada no período (`sales.sold_at`, a data de aprovação), com `session_id`, sem order bump, **uma por sessão** (a primeira; upsell e bump da mesma sessão não contam de novo), cuja sessão tem um `checkout_click` nesta página |
| RN-15 | Início da contagem | Primeiro `pageview` da página na sessão; se o pageview se perdeu, a primeira linha de `heatmap_scrolls` da página na sessão (a rolagem é gravada no primeiro lote, então pode marcar alguns segundos depois do carregamento) |
| RN-16 | Até o checkout / até a compra | Até o primeiro `checkout_click` da página na sessão / até `sales.sold_at`. Segundos inteiros |
| RN-17 | Descarte | Tempo negativo ou acima de 24 h sai do gráfico e é contado como "descartada". Sem início registrado conta como "sem o carregamento" |
| RN-18 | Filtros do tempo até a compra | Período pela data da venda; aparelho pela rolagem da página na sessão (sem ela, `tracking_sessions.device_type`: `desktop` = computador, o resto = celular); origem/campanha da sessão. As vendas **sem sessão** são do painel inteiro no período (não dá para ligar a uma página), com origem/campanha da própria venda e sem filtro de aparelho |
| RN-19 | Percentis | Interpolação linear (como `percentile_cont`); mediana = P50. Faixas com início inclusivo e fim exclusivo; o acumulado sai das contagens |
| RN-13 | VSL da página | Domínio em `VSL_HOSTS` (`hotjar.aggregate.ts`) + caminho em `VSL_MARKETS` (`/`, `/b`, `/quiz` no BR; `/` nos EUA), e o painel em `VSL_ENABLED_WORKSPACE_ID` |

## 4. Modelo de Dados

Sem tabela nova. Migration aditiva `supabase/migrations/20261123200000_hotjar.sql` (aplicada em produção em 23/11/2026):

- `heatmap_scrolls.seconds INTEGER` (0–86400): tempo com a página visível, do campo `ts` do `hm`.
- Índice parcial `idx_tracking_events_custom_name (workspace_id, event_name, occurred_at) WHERE event_type = 'custom'`.
- Funções (só `service_role`): `hotjar_pages`, `hotjar_scrolls`, `hotjar_clicks`, `hotjar_quiz`, `hotjar_filters`. Todas com período (início inclusivo, fim exclusivo), aparelho e filtros de origem/campanha.

Migration aditiva `supabase/migrations/20261123220000_hotjar_purchase_timing.sql` (aplicada em produção em 23/11/2026): função `hotjar_purchase_timing(workspace, url, from, to, device, source, campaign)`, somente leitura, `security definer` com `search_path = public`, só `service_role`. Devolve uma linha `page` por compra da página (`to_checkout`, `to_purchase`) e duas linhas de contagem (`n`): `other` (compras com sessão sem clique de checkout registrado nesta página; pode ter sido em outra página) e `no_session`. Lê `sales`, `tracking_sessions`, `tracking_events` e `heatmap_scrolls` na hora, sem tabela de histórico.

Retenção: `heatmap_clicks`/`heatmap_scrolls` têm 90 dias (pg_cron `heatmap-retencao`); os eventos `quiz_step` ficam em `tracking_events`, com a retenção de 90 dias do rastreio.

## 5. Coleta (tracker.js)

- **Tempo na página:** o `hm` do lote leva `ts` (segundos com a aba visível). A saída da página (aba escondida, `pagehide`, `beforeunload`) sempre manda o `hm`, mesmo sem rolagem nova.
- **Etapa de quiz:** `dashzip('track', 'quiz_step', { step: 'momento', index: 1 })`. Vai como evento `custom` no lote de 2 s (ou na saída), com o `page_id` do carregamento.
- Quiz novo em outra LP: chamar o mesmo `dashzip('track', 'quiz_step', …)` a cada etapa. O snippet do layout cria a fila `window.dashzip` antes do tracker carregar.

## 6. API / Backend

| Metodo | Path | Descricao |
|---|---|---|
| GET | `/api/hotjar/pages?workspace_id&since&until&device&source&campaign` | Páginas com visitas no filtro (`url`, `views`, `avgDepth`, `reachedEnd`, `clicks`, `quiz`, `vsl`) e as opções dos filtros (`sources`, `campaigns`) |
| GET | `/api/hotjar/page?…&url=` | `retention` (alcance, abandono, dobras, tempo), `clicks` (total e elementos mais clicados), `quiz` (funil ou `null`) e `vsl` |
| GET | `/api/hotjar/purchase-timing?…&url=` | Tempo até a compra: `purchases`, `otherPages`, `noSession` e, para `checkout` e `purchase`, `measured`, `discarded`, `missing`, `median`, `average`, `p75`, `p90` e `buckets` (`label`, `min`, `max`, `purchases`, `share`, `cumulative`) |
| GET | `/api/t/heatmap-data?…&since&until&src&cmp` | Dados do desenho (público, com o token do mapa). Sem `since`/`until`, volta ao modo antigo por `days` |
| GET | `/api/vsl/:painel?since&until&market&versions` | Retenção da VSL no período exato ([vsl.md](vsl.md)) |

Acesso: bearer do dash.zip e dono do painel (`DebugService.assertOwner`). Período inválido ou acima de 92 dias: 400. `Cache-Control: private, no-store`.

Arquivos: `modules/hotjar/hotjar.aggregate.ts` (contas puras), `hotjar.service.ts`, `hotjar.controller.ts`; `tracking/heatmap.service.ts` (`clicksInRange`, `scrollsInRange`, `overlay` com período), `tracking/heatmap.ts` (`validDayRange`, `filterValue`, `ts`), `tracking/heatmap-script.ts` (modo iframe), `tracking/tracker-script.ts`.

## 7. Implementacao no Frontend

- `pages/Hotjar.tsx`: filtros e consultas (`@tanstack/react-query`).
- `components/hotjar/HeatmapSection.tsx`, `RetentionSection.tsx`, `PurchaseTimingSection.tsx` (consulta própria, abaixo da retenção), `QuizSection.tsx`, `VslSection.tsx`, `Section.tsx`.
- `lib/hotjar.ts`: tipos, chamadas, `heatmapEmbedLink`, formatação.
- `hooks/useHeatmap.ts`: token do link do mapa (12 h, renova sozinho).
- Menu: item **Hotjar** (ícone `Flame`) no lugar de **VSL**; o item Tracking → Mapa de calor saiu.

## 8. Edge Cases

- Página sem `X-Frame-Options`/`frame-ancestors`: o iframe funciona (a maioria das LPs não manda esses cabeçalhos). Se uma LP passar a bloquear iframe, use **Abrir em nova aba**.
- Link do mapa expirado ou inválido: o `heatmap.js` avisa o painel por postMessage e a mensagem aparece abaixo do iframe.
- Sem visitas no filtro: aviso no lugar das seções. Sem tempo medido: aviso de que a medição começou em 23/11/2026.
- Limites de leitura: 20 mil carregamentos, 5 mil cliques e 100 mil linhas de etapa por consulta.

## 9. Checklist de Testes

- [x] `hotjar/__tests__/hotjar.aggregate.spec.ts`: alcance, abandono e maior saída, dobras, tempo (mediana/faixas), funil do quiz (ordem por `index` e sem `index`, recarga no meio, repetição), VSL por domínio e caminho
- [x] `hotjar/__tests__/hotjar.aggregate.spec.ts` (tempo até a compra): faixas, acumulado, mediana/média/P75/P90, descarte de negativos e acima de 24 h, contagens de outras páginas e sem sessão, vazio
- [x] `hotjar/__tests__/hotjar.purchase-timing.spec.ts`: filtros (página, período, aparelho, origem, campanha) chegam à função; aviso da migration
- [x] `hotjar_purchase_timing` testada em produção dentro de `begin; … rollback;` (com e sem filtro de aparelho) antes de aplicar
- [x] `tracking/__tests__/heatmap.spec.ts`: `ts`, `validDayRange`, `filterValue`, modo iframe do `heatmap.js`
- [x] `tracking/__tests__/tracker-script.spec.ts`: `ts` na saída, aba escondida não conta, `quiz_step` com `page_id`
- [x] `vsl/__tests__/vsl.http.spec.ts`: período exato e 400
- [x] `pages/Hotjar.test.tsx`: seções, chamadas com período/aparelho, troca de aparelho, modo streaming, vazio, VSL 403, tempo até a compra (destaques, faixas com acumulado, alternador, vazio no modo streaming, duração com horas)
- [x] Navegador com API simulada, desktop e 390 px
- [x] Produção: navegador limpo no `/quiz?utm_source=map_qa`, eventos `capa`, `momento` e `tempo` gravados em `tracking_events` e lidos por `hotjar_quiz`
