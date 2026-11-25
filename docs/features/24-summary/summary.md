# Resumo personalizável

> **Modulo:** `packages/backend/src/modules/summary` | **Pagina:** tela Resultado
> **Ultima atualizacao:** 2026-11-23
> **Status:** Revisao

---

## 1. Proposito

A tela inicial de números da operação. O usuário monta a tela numa grade: arrasta os cards e gráficos para onde quiser (inclusive para outra seção), redimensiona pela alça do canto, cria seções e põe qualquer item do catálogo em qualquer seção; pode exportar ou importar o layout. Os números usam a mesma régua do Resultado e de Campanhas. As vendas vêm do webhook do checkout, o gasto da Meta e o rastreio da sessão first-party do dash.zip.

## 2. Comportamento para o Usuario

1. O seletor de data oferece Hoje, Ontem, Últimos 7 dias, Últimos 30 dias, Este mês e Mês passado. Use o calendário para selecionar um intervalo personalizado de até 92 dias. Os filtros de contas de anúncio, produtos e checkouts ficam ao lado.
2. A opção Comparar com o último período começa desligada. Ao aplicá-la, os cards mostram a variação contra o período anterior de mesmo tamanho (`previous`).
3. O ícone de lápis ao lado dos filtros abre o modo Personalizar. **Atualizar** fica à direita, com texto e ícone; no celular, sobe para a linha do título. No modo Personalizar:
   - **Arrastar**: pega o card e solta onde quiser na grade da seção; solto sobre outra seção, ele muda de seção (a seção de destino fica destacada durante o arraste).
   - **Redimensionar**: alça no canto inferior direito; para a direita aumenta a largura, para baixo a altura, encaixando nos passos da grade (12 colunas, linhas de 44 px, 12 px de espaço).
   - **Adicionar card**: abre o catálogo inteiro por categoria (Geral, Vendas, Impostos/taxas/despesas, Mídia, Rastreio), com busca. Qualquer card ou gráfico vai para qualquer seção; o que já está em outra seção é movido.
   - Seções: criar (Nova seção), renomear, subir/descer, começar recolhida e remover (os cards dela voltam para o catálogo).
   - Teclado e alternativa ao arraste: cada card é focável; setas movem, Shift + setas redimensionam, Delete remove. O menu "…" do card tem Mover para cima/baixo e Mover para seção….
   - Salvar, Cancelar, Exportar (JSON v2), Importar (v1 ou v2) e Restaurar padrão.
   - Celular (até 640 px): os cards empilham em largura total, na ordem de leitura (linha, depois coluna). No modo Personalizar o celular usa o menu do card (sem arrastar).
4. Só o dono do painel acessa.

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Mesma régua | Bruto, líquido, taxas, impostos, custo de produto | `salesTotals` do Resultado, com faturamento líquido após as taxas do checkout e antes do imposto sobre venda |
| RN-02 | Lucro | — | faturamento líquido − CMV − imposto sobre venda − gasto em anúncios − IOF. Taxas extras e despesas seguem disponíveis como indicadores separados. |
| RN-03 | ROI, margem e ROAS | Base conhecida e diferente de zero | ROI = (faturamento líquido − imposto sobre venda) ÷ (gasto em anúncios + IOF). Margem = lucro ÷ faturamento líquido. ROAS = bruto ÷ gasto. Cada razão fica indisponível com denominador zero. |
| RN-04 | Gasto | Contas ativas do painel | Totais do nível conta de Campanhas (PTAX por dia, custo sobre mídia por regra) |
| RN-05 | Filtro de produto e plataforma | Pedido com alguma linha do produto ou do checkout | O pedido entra inteiro (o bump acompanha). O gasto **não** é filtrado por produto, igual à UTMify |
| RN-06 | Filtro de conta | `accountIds` | Filtra o gasto e as métricas de mídia. As vendas não mudam |
| RN-07 | Origem e posicionamento | `byUtmSource`, `byUtmTerm` | Usa a sessão casada primeiro. Remove o lead da UTMify (`…jLj…`) do `utm_source` e ignora `stl_…` no `utm_term` |
| RN-08 | Pix | `pixConversion` | Pedidos Pix pagos (aprovados, reembolsados ou chargeback) ÷ todos os pedidos Pix do período |
| RN-09 | Reembolso | `refundRate` | Pedidos reembolsados ÷ (aprovados + reembolsados + chargeback) |
| RN-10 | Rastreio | `sessions`, `checkoutClicks` | Sessões iniciadas no período no painel e nos containers legados que redirecionam para ele |
| RN-11 | Por hora | `hourly` | Faturamento pela hora da venda em São Paulo. Gasto pela hora da conta (`hourly_stats_aggregated_by_advertiser_time_zone`), convertido pela taxa média do período da conta. Só para períodos de até 31 dias; acima disso o gasto por hora vem `null` |
| RN-12 | Período anterior | `compare=1` (padrão) | Mesmos cards no intervalo anterior de mesmo tamanho. Se falhar, `previous` vem `null` e o resto responde |
| RN-13 | Indisponível ≠ zero | Conta sem PTAX ou com erro na Meta | O card vem `null` e o motivo vai em `warnings` |
| RN-14 | ARPU (`avgTicket`) | Pedidos aprovados | Faturamento bruto ÷ compradores únicos. Comprador = e-mail em minúsculas; sem e-mail, documento; sem documento, telefone (só dígitos); sem nada, o pedido conta como um comprador. A chave continua `avgTicket` para os layouts salvos; o rótulo virou "ARPU" |
| RN-15 | País | `byCountry` | `customer_country` normalizado para ISO-2: aceita ISO-2, ISO-3, nome em pt/en/es ("Brasil", "Portugal") e apelidos (USA, EUA). Desconhecido ou vazio ("OTHER" da Ticto) = sem país; sem país mas com UF válida = Brasil. Cada pedido aprovado conta uma vez. Em 23/11/2026 o banco só tinha vendas Wiapy, todas com `BR` e a UF em sigla |
| RN-16 | Estado | `byState` | Pedidos brasileiros por UF de `customer_state` ("SP", "sp", "BR-SP" ou o nome); sem UF reconhecida = sem estado |
| RN-17 | Funil da Meta | `funnelMeta` | Cliques → Visualizações da página → Inícios de checkout → Vendas pendentes → Vendas aprovadas. "Vendas pendentes" soma todos os pedidos gerados (pendentes, aprovados, reembolsados e chargeback), porque toda venda aprovada passou por pendente; o número só das ainda pendentes vai em `pendingNow`. Cada etapa traz `pctOfFirst` e `stepRate` |
| RN-19 | Taxa de aprovação | `approvalRate` | Por meio de pagamento (Cartão de crédito, Cartão de débito, Pix, Boleto, sempre nessa ordem): pedidos aprovados ÷ pedidos gerados do meio no período. Aprovado inclui os que depois foram reembolsados ou tiveram chargeback (foram pagos). Gerado = aprovado + pendente + recusado + reembolsado + chargeback. Sem pedido do meio, `rate` = `null` e a tela mostra "—". O meio vem de `approvalMethod`, que separa débito (`debit`, `débito`) de crédito; `normalizePaymentMethod` continua juntando os dois em `credit_card` porque é a chave das regras de taxa do checkout. Segue período e filtros de produto/checkout como os demais. Só tem sentido com os pedidos não pagos gravados (ver `08-webhook-processing`): antes de 23/11/2026 a Wiapy só mandava `payment_paid`, então pedidos anteriores dão 100% |
| RN-18 | Cor de ganho/perda | Lucro e Margem (pelo sinal), ROI e ROAS (contra 1) | Verde (`text-success`) acima, vermelho (`text-destructive`) abaixo, cor normal no empate ou sem dado. Vale também para a série Lucro dos gráficos. A seta da comparação com o período anterior segue a regra de melhor/pior, separada. ROI aparece sem o "x"; ROAS mantém |
| RN-19 | Ajuda dos cards | Ícone de informação ao lado do nome | Ao passar o mouse, tocar ou acionar pelo teclado, mostra o significado e a fórmula ou a origem do dado. |
| RN-20 | Dia da semana e hora | `byDayOfWeek`, `byHour` | Pedidos aprovados e faturamento pelo dia da semana (sempre os 7, de domingo a sábado) e pela hora (sempre as 24) no fuso do painel; sem venda = zero. No gráfico, o dia aparece abreviado (Dom…Sáb) e a dica abre ao passar o mouse ou ao tocar na coluna |

## 4. Modelo de Dados

- Lê `sales` (`status`, `amount`, `currency`, `metadata`, `payment_method`, `product_name`, `customer_country`, `customer_state`, `customer_email`, `customer_doc` e `customer_phone` (só para contar compradores; não saem na resposta), `utm_source`, `utm_term`, `session_id`), `tracking_sessions` (UTMs da chegada e contagem), `dashboard_finance_settings`, `dashboard_expenses` e `facebook_connections`.
- Grava `dashboard_preferences.summary_layout` e `dashboard_preferences.campaign_columns` (migration `20261122170000_fees_expenses_preferences.sql`).

## 5. API / Backend

| Metodo | Path | Descricao |
|---|---|---|
| GET | `/api/summary/:painel` | Cards, gráficos, catálogo e filtros disponíveis |
| GET | `/api/preferences/:painel/summary-layout` | Layout salvo (ou o padrão) e o padrão |
| PUT | `/api/preferences/:painel/summary-layout` | Salva `{ layout }` |
| DELETE | `/api/preferences/:painel/summary-layout` | Restaura o padrão (apaga o salvo) |
| GET | `/api/preferences/:painel/campaign-columns` | Colunas da tela de Campanhas |
| PUT | `/api/preferences/:painel/campaign-columns` | Salva `{ columns }` |

### GET `/api/summary/:painel`

Query: `days=7|30|90` ou `since`+`until` (`YYYY-MM-DD`); `accountIds` (vírgula, `act_…`); `products` (vírgula, nomes codificados na URL); `platforms` (vírgula); `compare=0|1` (padrão 1).

```ts
type Unit = 'BRL' | 'int' | 'pct' | 'ratio';    // pct é fração (0,12 = 12%); ratio é número puro (ROAS 2,1)

interface SummaryResponse {
  since: string; until: string;
  previousPeriod: { since: string; until: string } | null;
  currency: 'BRL';
  cards: { key: string; label: string; value: number | null; unit: Unit; previous?: number | null }[];
  charts: Record<ChartKey, SeriesPoint[]>;
  catalog: {
    categories: { key: string; title: string }[];   // agrupamento do "Adicionar card"
    cards: { key: string; label: string; unit: Unit; category: string; hint?: string }[];
    charts: { key: string; label: string; category: string }[];
  };
  filters: { accounts: { id: string; name: string | null; currency: string | null }[]; products: string[]; platforms: string[] };
  warnings: string[];
}
interface SeriesPoint { label: string; [metric: string]: string | number | null }
```

**Cards** (`key`, unidade), na ordem padrão. A categoria só agrupa o catálogo; o layout pode pôr qualquer item em qualquer seção:

| Categoria | Cards |
|---|---|
| `general` | `grossRevenue`, `netRevenue`, `spend`, `profit` (BRL); `roi`, `roas` (ratio); `margin` (pct); `cpa` (BRL) |
| `sales` | `sales` (int); `avgTicket` = ARPU (BRL); `pendingSales` (int); `pendingRevenue` (BRL); `pixConversion`, `refundRate` (pct); `refundedRevenue` (BRL); `chargebackRate` (pct) |
| `costs` | `fees`, `taxes`, `mediaTax`, `productCosts`, `expenses` (BRL) |
| `media` | `impressions`, `clicks` (int); `ctr` (pct); `cpc`, `cpm` (BRL); `landingPageViews`, `initiateCheckouts` (int); `costPerCheckout` (BRL) |
| `tracking` | `sessions`, `checkoutClicks` (int); `checkoutClickRate`, `sessionConversion` (pct) |

**Gráficos** (`charts`). Categorias: `hourly` e `daily` em `general`; `funnelMeta` em `media`; `funnelTracking` em `tracking`; os demais em `sales`.

| Chave | Pontos |
|---|---|
| `hourly` | 24 pontos `00h…23h`: `revenue`, `spend`, `revenueCum`, `spendCum`, `profitCum` |
| `daily` | um ponto por dia `YYYY-MM-DD`: `revenue`, `sales`, `spend`, `profit` |
| `funnelMeta` | `Cliques → Visualizações da página → Inícios de checkout → Vendas pendentes → Vendas aprovadas` (`value`, `pctOfFirst`, `stepRate`; `pendingNow` na etapa pendente) |
| `funnelTracking` | `Sessões → Cliques no checkout → Vendas casadas com a sessão` (`value`, `pctOfFirst`, `stepRate`) |
| `byProduct` | `label` = produto: `sales`, `revenue` (linha a linha, bump conta como produto) |
| `byPaymentMethod` | `Pix`, `Cartão`, `Boleto`, `Outro`, `Não informado`: `approved`, `pending`, `revenue` |
| `approvalRate` | 4 pontos fixos (`Cartão de crédito`, `Cartão de débito`, `Pix`, `Boleto`): `method` (`credit_card`, `debit_card`, `pix`, `boleto`), `approved`, `generated`, `rate` (fração ou `null`) |
| `byDayOfWeek` | `Domingo…Sábado`: `sales`, `revenue` |
| `byHour` | 24 pontos: `sales`, `revenue` |
| `byCountry` | `label` = nome em português, `code` = ISO-2, `iso3`, `numeric` (ISO 3166 numérico, o id do mapa): `sales`, `revenue`, `share` (fração das vendas). O ponto com `code` vazio é "Sem país" e vem por último |
| `byState` | `label` = nome do estado, `code` = UF: `sales`, `revenue`, `share` (fração das vendas brasileiras). `code` vazio = "Sem estado" |
| `byUtmSource` | origem: `sales`, `revenue` |
| `byUtmTerm` | posicionamento: `sales`, `revenue` |

`profitCum` e `profit` por dia são aproximações: aplicam ao faturamento a proporção faturamento após deduções ÷ bruto do período, porque taxa e imposto são calculados por pedido e não por hora.

### Layout

```ts
interface SummaryLayout {
  version: 2;
  sections: {
    key: string;                 // [A-Za-z0-9_-]{1,40}, sem repetir
    title: string;               // até 60
    collapsed: boolean;
    items: { key: string; x: number; y: number; w: number; h: number }[];
    // chave do catálogo (sem repetir no layout inteiro), até 60 por seção.
    // Grade de 12 colunas: x 0–11, w 1–12, x + w ≤ 12; y 0–600, h 1–30 (linhas de 44 px). Sem sobreposição na seção.
  }[];                           // 1 a 12 seções
}
// GET  → { layout: SummaryLayout (v2); saved: boolean; defaultLayout: SummaryLayout }
// PUT  { layout } (v2, ou o v1 antigo) → mesmo formato do GET; grava sempre o v2. Inválido = 400 com a mensagem
// DELETE → mesmo formato do GET, com saved: false
```

**Migração do v1** (`{ version: 1, sections[].items: { key, size: 'sm'|'md'|'lg' }[] }`, ordem por seção): o validador continua aceitando o v1; o GET devolve o layout salvo já convertido e o próximo Salvar grava o v2. A conversão (`migrateLayout`, igual no backend e no frontend) mantém seções, títulos, recolhidas e a ordem, e põe os itens em fila da esquerda para a direita, quebrando a linha quando não cabem. Tamanhos equivalentes aos do v1 (que usava 6 colunas no desktop): card pequeno 2×2, médio 4×2, largura toda 12×2; gráfico pequeno 4×7, médio 6×7, largura toda 12×7 (mapas com 9 linhas). Importar um arquivo v1 também funciona.

Exportar é baixar o `layout` v2 como JSON. Importar é enviar o arquivo no PUT, que valida.

### Colunas de Campanhas

```ts
type CampaignColumns = Partial<Record<'account' | 'campaign' | 'adset' | 'ad', {
  columns: string[];                                   // [A-Za-z0-9_]{1,40}, sem repetir, até 60
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
}>>;
// GET → { columns: CampaignColumns }   ({} quando nada foi salvo)
// PUT { columns } → { columns }
```

As chaves das colunas são as da tela (os campos de `CampaignRow`). O backend não as restringe.

## 6. Implementacao no Frontend

- `pages/Result.tsx` (rota `/finance`): filtros, seções e o modo Personalizar (rascunho `draft`, Salvar/Cancelar/Exportar/Importar/Restaurar padrão).
- `components/summary/SummaryGrid.tsx`: `StaticGrid` (CSS grid de 12 colunas fora do modo Personalizar e no celular) e `EditGrid` (react-grid-layout 2.3.0: arraste, alça `se` de redimensionar, compactação vertical). Soltar em outra seção: `onDragStop` acha a seção sob o ponteiro (`data-section-drop`) e calcula a posição na grade dela. `EditFrame` é a moldura com menu, teclado e remover.
- `lib/summaryLayout.ts`: constantes da grade, `migrateLayout`/`normalizeLayout`, `appendItem`, `nudgeItem` (teclado), `resizeItem`, `moveToSection` e `cleanLayout` (só `key, x, y, w, h` vai para a API).
- `components/summary/AddCardDialog.tsx`: catálogo por categoria, com busca.
- `components/summary/FunnelFlow.tsx`: funil em faixa única (SVG próprio), espessura proporcional à primeira etapa, curvas entre as colunas, degradê `--viz-1` → `--viz-3`, percentual sobre a primeira no meio, número embaixo e taxa sobre a anterior na dica. Abaixo de 420 px de largura vira vertical.
- `components/summary/GeoCard.tsx`: Vendas por país e por estado, com alternância Mapa/Ranking, intensidade por vendas ou faturamento e o resumo "Sem país/estado" no canto. Os mapas carregam sob demanda, em chunks próprios: `maps/WorldMap.tsx` (d3-geo + topojson-client + world-atlas 1:110m, Natural Earth, domínio público) e `maps/BrazilMap.tsx` (@svg-maps/brazil, CC BY 4.0, VictorCazanave/svg-maps).
- `components/summary/ApprovalCard.tsx`: Taxa de aprovação. Uma linha por meio com anel de progresso (SVG, `--viz-1` sobre trilha `foreground/10`, claro e escuro), "X de Y pedidos" e a taxa à direita; "—" e anel vazio sem pedido do meio. Com o card a partir de 520 px de largura, as linhas vão em duas colunas. Dica no título e em cada linha: aprovados ÷ gerados do método (reembolso e chargeback contam como aprovados). Não mostra nome sensível, então o modo streaming não muda nada.
- Modo streaming: os nomes de produto do gráfico por produto seguem mascarados; nenhum lugar novo mostra nome de produto ou de conta.

## 7. Pontos de Integracao

- Campanhas: `CampaignsService.objects` (nível conta) fornece o gasto e a mídia, com o mesmo cache de 5 min.
- Resultado: `FinanceService.readSettings`, `readExpenses` e `MetaSpendService.campaignDays` (cache de 10 min).
- Regras: o escopo "resumo do painel" usa estes cards.

## 8. Edge Cases e Tratamento de Erros

- Banco sem a migration 20261122170000: as taxas novas e as despesas são ignoradas (leitura tolerante) e o resto responde.
- Pedido em USD sem PTAX: conta como venda, mas o faturamento do período fica `null`.
- Painel sem conta de anúncio: gasto 0 e mídia 0; ROI e ROAS `null`.

## 9. Checklist de Testes

- [x] Cards de faturamento, lucro, ROI, ROAS, margem e ticket (`summary.spec.ts`)
- [x] Pendente, reembolso e Pix pago ÷ gerado
- [x] Séries por hora no fuso de São Paulo e por dia
- [x] Vendas por dia da semana com os 7 dias e por hora com as 24 (`summary.spec.ts`)
- [x] Origem e posicionamento pela sessão, sem `jLj` e sem `stl_`
- [x] Gasto indisponível deixa lucro e ROI em `null`
- [x] Período anterior de mesmo tamanho
- [x] Layout padrão válido, item desconhecido e repetido recusados; validação das colunas
- [x] Layout v2 (posição, tamanho, sobreposição, campos) e v1 aceitos; migração v1 → v2 (`summary.spec.ts` e `lib/summaryLayout.test.ts`)
- [x] ARPU por compradores únicos (e-mail, documento, telefone)
- [x] Normalização de país (ISO-2, ISO-3, nome) e UF; agregação por país e estado
- [x] Etapas e percentuais do funil
- [x] Taxa de aprovação: classificador que separa débito de crédito, aprovados (com reembolso/chargeback) ÷ gerados, pedido com bump conta uma vez, meio sem pedido `null` (`summary.spec.ts`); card renderiza as quatro linhas e "—" (`ApprovalCard.render.test.tsx`); no navegador com API simulada em claro, escuro e 390 px
- [x] Cor de ganho/perda e ROI sem "x" (`lib/summary.test.ts`)
- [x] Tela no navegador com API simulada (validador e migração reais): arrastar, redimensionar pela alça, soltar em outra seção, adicionar card de outra categoria, salvar, recarregar e 390 px
