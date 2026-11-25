# Acompanhamento de testes

> **Modulo:** `packages/backend/src/modules/tests` (+ `campaignDays` e `recentChanges` em `modules/campaigns`) | **Pagina:** aba Acompanhamento de testes, abaixo de Campanhas
> **Ultima atualizacao:** 2026-11-22
> **Status:** Revisao

---

## 1. Proposito

Cada teste de oferta é uma campanha. A tabela mostra campanha × dia, semana ou mês, com o lucro em degradê, os filtros por oferta e por condição, a "Última mudança" e a Saúde do checkout. Os números vêm do próprio Dash.zip: vendas do período atribuídas pela UTM (o banco, alimentado pelo webhook, unido às vendas da Wiapy buscadas na hora, como em Campanhas) e gasto da Meta Insights pela PTAX do dia. A aba VSL virou a seção VSL da aba Hotjar, documentada em [`27-hotjar`](../27-hotjar/vsl.md).

## 2. Comportamento para o Usuario

1. Botão **Data** igual ao do Resultado (`ResultDatePicker`, sem "comparar"): predefinidos, calendário de intervalo em dois cliques, até 92 dias. Padrão: últimos 7 dias. **Colunas** por dia, semana ou mês, agrupadas na tela.
2. **Busca** por nome ou ID: vírgula = OU, `-termo` exclui, sem diferença de acento e caixa.
3. **Filtros e ordem** (popover, com contador de filtros ativos), no formato do filtro do testes.zip:
   - Oferta em múltipla escolha, com quantas campanhas cada uma tem no período, mais "Sem oferta (código não cadastrado)".
   - Status (todas, ativas, pausadas e outras) e conta (múltipla escolha).
   - **Ordenar**: atalhos (mais lucro, mais prejuízo, maior ROI, mais gasto, mais vendas, nome A-Z) e até 3 critérios em sequência ("Por" + "Depois por"), cada um com direção. Campos: lucro, gasto, faturamento, vendas, ROI, margem, CPA, CPC, CPM, nome, status e o lucro de qualquer coluna de dia/semana/mês. Vazio fica sempre por último.
   - Condições sobre os totais do período (métrica, operador ≥ > = < ≤, valor; margem em %).
   - Limpar filtros (mantém a busca).
4. Clique no cabeçalho (Status, Campanha, Lucro, Gasto, Vendas, ROI ou uma coluna de período) ordena: decrescente, crescente, volta ao padrão (mais lucro). Com vários critérios, o cabeçalho mostra a posição de cada um.
5. **Agrupar por oferta** (botão na barra ou no popover): a tabela ganha uma linha por oferta com o subtotal (lucro, gasto, vendas, ROI e lucro por coluna). As ofertas seguem o primeiro critério de ordenação aplicado ao total delas; "Sem oferta" vai por último. Dentro de cada oferta vale a ordenação completa.
6. Filtros, ordenação e agrupamento ficam salvos no navegador por painel (`dashzip:tests:filters:<painel>`); a ordenação por coluna de período não é salva porque depende das datas.
7. Tabela: ⋮ (ações), **Status** (status efetivo com ponto colorido), **Campanha** (largura ajustável arrastando a borda, salva por usuário), Última mudança, Lucro, Gasto, Vendas, ROI e o lucro por coluna em degradê. Linha de total do filtro no topo. **25 campanhas por página.** Em telas a partir de 640 px as três primeiras colunas ficam presas à esquerda; no celular a tabela rola na horizontal dentro do próprio quadro.
8. Hover na célula: gasto, custo sobre mídia, faturamento, ROI, margem, CPC, CPM, vendas, CPA e IC.
9. Coluna "Última mudança": a mais recente por campanha; ao clicar (ou pelo ⋮), as últimas 5.
10. Saúde do checkout quando exatamente uma oferta está marcada: `GET /api/summary/:painel?products=…` com os produtos da oferta (cards `pixConversion`, `refundRate`, `chargebackRate`, `avgTicket`, `pendingSales` e o gráfico `byPaymentMethod`).
11. Menu ⋮ por linha: ativar, pausar, mudar orçamento (diário ou total, quando o orçamento é da campanha), últimas mudanças e abrir no Gerenciador. Usa o `POST /api/campaigns/:painel/actions` (contrato 22). Ativar e pausar pedem confirmação no diálogo do app; orçamento confirma com antes e depois. Sucesso e erro aparecem em aviso.
12. Cadastro de ofertas: nome, códigos no nome da campanha, contas e produtos.

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Linhas | Período | Campanhas com entrega ou venda no período, ou com status `ACTIVE` |
| RN-02 | Venda no dia | Pedido atribuído à campanha | Conta no dia (São Paulo) da primeira linha do pedido. O bump acompanha o pedido |
| RN-03 | Atribuição | Igual a Campanhas (contrato 22, RN-01 a RN-05) | Sessão casada, depois UTMs da venda, depois `ad_id`. Pedido sem campanha conhecida vai para `untrackedSales` |
| RN-04 | Gasto | Conta em USD | `spend` = gasto do dia × PTAX do dia. `mediaTax` pelas regras de custo sobre mídia da conta |
| RN-05 | Lucro | Célula | `profit` = `netRevenue` − `spend` − `mediaTax` |
| RN-06 | Derivadas | Na tela, sobre as somas | ROI = (líquido − imposto sobre venda) ÷ (gasto + IOF); margem = lucro ÷ líquido; CPC = gasto ÷ cliques; CPM = gasto ÷ impressões × 1000; CPA = gasto ÷ vendas. Mesma régua de Campanhas e Resultado |
| RN-07 | Indisponível ≠ zero | Conta com erro ou sem PTAX | Métricas de mídia `null` e o motivo em `warnings` |
| RN-08 | Oferta | Nome da campanha | O código aparece como palavra inteira, respeitando maiúsculas, e a conta está na oferta (ou a oferta não tem contas). Vale a primeira oferta da lista que casar. Sem nenhuma: `offerId: null` ("Sem oferta") |
| RN-09 | Última mudança | Log de atividades da Meta, 14 dias | Só status e orçamento, de campanha, conjunto ou anúncio, levados à campanha. O System User aparece como "dash.zip". Orçamento em unidade cheia da moeda da conta |

## 4. Modelo de Dados

- Migration [`20261122190000_test_offers.sql`](../../../supabase/migrations/20261122190000_test_offers.sql): `dashboard_preferences.test_offers` (jsonb, array).

## 5. API / Backend

| Metodo | Path | Descricao |
|---|---|---|
| GET | `/api/tests/:painel/matrix?days\|since&until` | Campanha × dia |
| GET | `/api/tests/:painel/changes` | Última mudança por campanha (14 dias) |
| GET | `/api/tests/:painel/offers` | `{ offers }` |
| PUT | `/api/tests/:painel/offers` | `{ offers }` substitui o cadastro. 400 com mensagem se inválido |

Todas aceitam `source=meta` (opcional) para a futura escolha de fonte de tráfego.

```ts
interface TestCell {                 // um dia de uma campanha; somável
  spendNative: number | null;        // moeda da conta
  spend: number | null;              // BRL
  mediaTax: number | null;           // BRL
  grossRevenue: number | null;       // BRL
  netRevenue: number | null;         // BRL
  profit: number | null;             // BRL
  sales: number;
  impressions: number | null;
  clicks: number | null;
  landingPageViews: number | null;
  initiateCheckouts: number | null;
}

interface MatrixResponse {
  since: string; until: string;
  days: string[];                    // todos os dias do período, em ordem
  currency: 'BRL';
  rows: {
    id: string; name: string; level: 'campaign'; parentId: string; accountId: string; accountName: string;
    campaignId: string; adsetId: null; accountCurrency: string;
    status: string | null; effectiveStatus: string | null;
    dailyBudget: number | null; lifetimeBudget: number | null; budgetLevel: 'campaign' | 'adset' | null;
    offerId: string | null;
    byDay: Record<string, TestCell>; // só dias com entrega ou venda; dia ausente = zero
  }[];
  untrackedSales: { count: number; byDay: Record<string, number> };
  accounts: AccountInfo[];           // mesmo formato de Campanhas
  offers: TestOffer[];
  warnings: string[];
}

interface TestOffer {
  id: string;                        // [A-Za-z0-9_-]{1,40}
  name: string;                      // 1–80
  codes: string[];                   // 1–10, até 40 caracteres cada
  accountIds: string[];              // act_…; [] = todas
  products: string[];                // até 50, para a Saúde do checkout
}

interface ChangesResponse {
  since: string; until: string;
  changes: Record<string, {          // chave = campaignId; mais recente primeiro
    campaignId: string;
    kind: 'activated' | 'paused' | 'budget';
    level: 'campaign' | 'adset' | 'ad';
    objectId: string; objectName: string | null;
    at: string;                      // ISO
    actor: string;                   // nome da pessoa, "dash.zip" (System User) ou "Meta"
    from?: number; to?: number;      // orçamento, moeda da conta
  }[]>;
  warnings: string[];
}
```

## 6. Implementacao no Frontend

Tela em `packages/frontend/src/pages/TestTracking.tsx` (rota `/tests`), A lógica de filtro, ordenação em vários níveis, agrupamento por oferta e paginação é pura e testada em `lib/testFilters.ts` (`testFilters.test.ts`); roda no navegador sobre a matriz já carregada. Peças compartilhadas com Campanhas (seletor de data, ⋮, status, coluna arrastável, paginação) estão descritas no contrato 22, seção 6. Nenhum histórico de campanha é gravado: os números vêm da Meta na hora.

## 7. Pontos de Integracao

- Campanhas: mesma hierarquia, mesmo cache por conta, mesma atribuição e mesmas ações.
- Resultado: `/api/summary` com `products` para a Saúde do checkout.
- Custos: despesas e taxas aplicadas às mesmas contas.

## 8. Edge Cases e Tratamento de Erros

- Banco sem a migration 20261122190000: `offers` vem vazio, todas as campanhas ficam "Sem oferta" e o resto funciona.
- Período longo com muitas campanhas: a Meta pagina até 60 páginas de Insights por conta; acima disso, a conta vai para `warnings`.

## 9. Checklist de Testes

- [x] Código como palavra inteira, maiúsculas, contas da oferta (`tests.spec.ts`)
- [x] Validação e normalização do cadastro
- [x] Log de atividades: status, orçamento pelo conjunto e System User como "dash.zip"
- [x] Filtro, ordenação em vários níveis, agrupamento por oferta e paginação (`testFilters.test.ts`)
- [x] Tela com dados de teste (Playwright, 1440 px e 390 px): filtros, agrupamento, ⋮ com confirmação, coluna arrastável salva, sem rolagem horizontal da página

## Colunas travadas e status compacto (25/11/2026)

- Ficam travadas à esquerda: menu, status, Campanha, **Lucro** e **ROI**. Última mudança, Gasto, Vendas e os períodos rolam por baixo.
- O status é só um ícone: bolinha verde (ativa), pausa (pausada), âmbar (em análise) ou vermelha (com problema). O nome completo aparece na dica.
