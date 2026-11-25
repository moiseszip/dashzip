# Campanhas Meta

> **Modulo:** `packages/backend/src/modules/campaigns` | **Pagina:** `packages/frontend/src/pages/Campaigns.tsx`
> **Ultima atualizacao:** 2026-11-22
> **Status:** Revisao

---

## 1. Proposito

Gestão das campanhas Meta dentro do painel. Cada linha (conta, campanha, conjunto, anúncio) junta o que a Meta informa (gasto, cliques, vídeo, status, orçamento) com as **vendas do próprio painel**, atribuídas pelo ID que chega na UTM. Na mesma tela é possível pausar, ativar e mudar o orçamento, individualmente ou em lote. A referência de produto é a engenharia reversa da UTMify, seção 11.2. Do rastreamento da UTMify nada é copiado: a atribuição usa a sessão first-party do dash.zip.

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

Item **Campanhas** no menu lateral (entra com a branch `visual-organizacao`). Rota do painel selecionado.

### 2.2 Fluxo de UI

1. Abas por nível: Contas, Campanhas, Conjuntos e Anúncios. Selecionar linhas filtra o nível seguinte (`parentIds`).
2. Botão **Data** igual ao do Resultado (`ResultDatePicker`): predefinidos (hoje, ontem, últimos 7 e 30 dias, este mês, mês passado), calendário de intervalo em dois cliques, até 92 dias, Aplicar/Limpar. A tela pede sempre `since`/`until`; o padrão é hoje.
3. Filtros de status e busca por nome. A ordenação é feita na tela. A tabela mostra 25 linhas por página (o total e a seleção "todos" valem para o filtro inteiro).
4. Ações por linha no menu **⋮** à esquerda do Status: ativar, pausar, mudar orçamento (diário ou total, quando o orçamento é do próprio nível), ver o nível seguinte e abrir no Gerenciador de Anúncios. Pausar e ativar pedem confirmação no diálogo do app; orçamento confirma no diálogo com antes e depois. O resultado aparece em aviso de sucesso ou erro. Ações em lote: pausar e ativar até 40 itens, com um resultado por item.
5. Coluna **Status** com o status efetivo da Meta e ponto colorido (verde ativo, cinza pausado, âmbar em análise, vermelho com problema). A coluna **Nome** tem largura ajustável arrastando a borda do cabeçalho (teclado: setas; duplo clique volta ao padrão); a largura fica salva por usuário no navegador.
6. Em **Contas de anúncio**, a tela lista as contas que o token do System User enxerga e o usuário marca as do painel.

### 2.3 Permissoes

Só o dono do painel (`workspaces.user_id`). Painel redirecionado (legado) responde 403, como no `/api/finance`.

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Fonte da atribuição | Venda aprovada com sessão casada | Usa as UTMs da sessão (`tracking_sessions`, primeira chegada). Sem sessão, usa as UTMs gravadas na venda e depois `sales.ad_id` |
| RN-02 | Formato do ID | `utm_content`, `utm_medium` e `utm_campaign` | O ID é o trecho numérico depois do último `\|` (antes de qualquer `::`). Um valor só de dígitos (6+) também vale. `utm_source` e `utm_term` nunca são usados: ferramentas como a UTMify reescrevem o `utm_source` (`…jLj…`) e o `utm_term` pode levar o indexador `stl_<sessão>` |
| RN-03 | Nível da venda | Venda com ID de anúncio encontrado numa conta do painel | Conta no anúncio, no conjunto, na campanha e na conta |
| RN-04 | Venda sem anúncio | Só ID de conjunto ou de campanha | Conta só do nível encontrado para cima |
| RN-05 | Não trackeada | Nenhum ID casa com objeto das contas do painel | Entra em `untrackedSales`, nunca em linha |
| RN-06 | Venda devolvida | Pedido com linha `refunded` ou `chargeback` | Fora das vendas e do faturamento (mesma regra do Resultado) |
| RN-07 | Moeda | Conta em USD | `spend` em BRL pela PTAX de venda do dia; `mediaTax` = custo sobre mídia USD do painel. `spendNative` fica na moeda da conta |
| RN-08 | Indisponível ≠ zero | Métrica sem dado (ex.: PTAX fora, conta falhou) | O campo vem `null`, nunca `0` |
| RN-09 | Falha isolada | Uma conta falha na Meta | As outras respondem. A falha vai em `warnings` |
| RN-10 | Conta de um painel só | Conta já ativa em outro painel | `available-accounts` mostra `linkedDashboardId`. Vincular devolve erro `ACCOUNT_IN_OTHER_DASHBOARD` para aquele item |
| RN-11 | Ação só em conta do painel | Objeto de conta fora do painel | Item recusado com `OBJECT_NOT_IN_DASHBOARD`. Nada é enviado à Meta |
| RN-12 | Orçamento no nível certo | Orçamento diário num conjunto de campanha CBO (ou o inverso) | Item recusado com `BUDGET_NOT_ON_THIS_LEVEL` |
| RN-13 | Teste sem aplicar | `validateOnly: true` | Envia `execution_options=["validate_only"]`. A Meta valida e nada muda |
| RN-14 | Lote | Até 40 itens | Executados em série. Um erro de limite da Meta (`RATE_LIMITED`) interrompe os restantes, que voltam com `SKIPPED` |

## 4. Modelo de Dados

### 4.1 Tabelas Principais

Nenhuma tabela nova.

- `facebook_connections`: uma linha por conta vinculada ao painel (`workspace_id`, `ad_account_id`, `access_token` cifrado, `account_currency`, `account_timezone`, `is_active`). É a mesma usada pelo Resultado.
- `dashboard_finance_settings`: taxa do checkout, imposto sobre vendas e custo sobre mídia USD.
- `sales`: `status`, `amount`, `currency`, `metadata` (taxa), `utm_campaign`, `utm_medium`, `utm_content`, `ad_id` e `session_id`.
- `tracking_sessions`: as UTMs de entrada, ligadas por `sale_id`. A busca é por `sale_id`, então também acha sessões que ficaram em painéis legados redirecionados.

### 4.2 Relacionamentos

`sales.workspace_id` = painel. `tracking_sessions.sale_id` → `sales.id`. A conta pertence ao painel por `facebook_connections.workspace_id`.

## 5. API / Backend

Todas as rotas usam `AuthGuard` (JWT do Supabase) e checam que o painel é do usuário. Valores monetários vêm em reais (número com 2 casas), salvo `spendNative`, orçamentos e `cycleSpend`/`totalSpend`, que ficam na moeda da conta.

### 5.1 Endpoints

| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | `/api/campaigns/:painel/objects` | Linhas de um nível com métricas Meta + vendas |
| POST | `/api/campaigns/:painel/actions` | Pausar, ativar ou mudar orçamento (1 a 40 itens) |
| GET | `/api/campaigns/:painel/available-accounts` | Contas que os tokens salvos enxergam, com vínculo |
| POST | `/api/campaigns/:painel/available-accounts` | Mesmo formato, para um token novo (`{ accessToken }`), sem salvar nada |
| PUT | `/api/campaigns/:painel/accounts` | Define quais contas ficam no painel |

#### GET `/objects`

Query:

| Param | Tipo | Observação |
|---|---|---|
| `level` | `account` \| `campaign` \| `adset` \| `ad` | obrigatório |
| `days` | `7` \| `30` \| `90` | ou `since` + `until` |
| `since`, `until` | `YYYY-MM-DD` | dias de São Paulo, até 92 dias, `until` ≤ hoje |
| `parentIds` | lista separada por vírgula | IDs do nível de cima (conta `act_…`, campanha ou conjunto) |
| `status` | `ACTIVE`, `PAUSED`, `ARCHIVED` (vírgula) | filtra pelo `status` configurado |
| `q` | texto | nome contém, sem diferenciar maiúsculas |

Resposta:

```ts
interface CampaignsResponse {
  level: 'account' | 'campaign' | 'adset' | 'ad';
  since: string; until: string;
  currency: 'BRL';
  rows: CampaignRow[];
  totals: Metrics;                       // soma das linhas devolvidas, com as razões recalculadas
  untrackedSales: { count: number; grossRevenue: number | null };
  accounts: AccountInfo[];
  warnings: string[];
}

interface AccountInfo {
  id: string;                 // act_…
  connectionId: string;       // facebook_connections.id
  name: string;
  currency: string;
  accountStatus: string | null;   // ACTIVE, DISABLED, UNSETTLED, PENDING_RISK_REVIEW, IN_GRACE_PERIOD, CLOSED…
  cycleSpend: number | null;      // saldo a cobrar (balance), moeda da conta
  totalSpend: number | null;      // amount_spent da vida da conta, moeda da conta
  spendCap: number | null;        // limite de gasto da conta, moeda da conta
}

interface CampaignRow extends Metrics {
  id: string;                 // conta: act_…
  level: 'account' | 'campaign' | 'adset' | 'ad';
  name: string;
  parentId: string | null;    // pai imediato (conta act_… para campanha)
  accountId: string;          // act_…
  campaignId: string | null;
  adsetId: string | null;
  accountCurrency: string;
  status: string | null;          // ACTIVE | PAUSED | ARCHIVED | DELETED
  effectiveStatus: string | null; // ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED, WITH_ISSUES, IN_PROCESS, PENDING_REVIEW…
  dailyBudget: number | null;     // moeda da conta; null se o orçamento não mora neste nível
  lifetimeBudget: number | null;
  budgetLevel: 'campaign' | 'adset' | null; // onde o orçamento mora (CBO = campaign)
}

interface Metrics {
  spendNative: number | null;     // só nas linhas (moeda da conta); null em totals se houver moedas misturadas
  spend: number | null;           // BRL
  mediaTax: number | null;        // BRL, custo sobre mídia USD
  impressions: number | null;
  reach: number | null;           // só nas linhas (não soma)
  frequency: number | null;
  clicks: number | null;          // inline_link_clicks
  ctr: number | null;             // clicks ÷ impressions (0 a 1)
  cpc: number | null;             // spend ÷ clicks
  cpm: number | null;             // spend ÷ impressions × 1000
  landingPageViews: number | null;
  initiateCheckouts: number | null; // IC informado pela Meta
  videoPlays: number | null;
  video3s: number | null;
  video75: number | null;
  hook: number | null;            // video3s ÷ impressions
  hold: number | null;            // video75 ÷ impressions
  sales: number | null;           // pedidos aprovados atribuídos
  grossRevenue: number | null;    // BRL, valor cheio do pedido
  netRevenue: number | null;      // BRL, bruto − taxa do checkout − imposto sobre vendas
  profit: number | null;          // netRevenue − spend − mediaTax
  salesTax: number | null;        // imposto sobre venda, separado do IOF
  roi: number | null;             // (netRevenue − salesTax) ÷ (spend + mediaTax)
  roas: number | null;            // grossRevenue ÷ spend
  cpa: number | null;             // spend ÷ sales
}
```

`accounts` sempre traz todas as contas ativas do painel, independente do nível. No nível `account`, cada linha também corresponde a uma delas.

Linhas incluídas: objetos com entrega no período **ou** com `status` ACTIVE, mais os que receberam venda atribuída. No nível de anúncio, sem `parentIds`, só aparecem anúncios com entrega ou venda no período (limite da Meta).

#### POST `/actions`

```ts
// body
{
  validateOnly?: boolean;
  items: { objectId: string; level: 'campaign' | 'adset' | 'ad';
           action: 'pause' | 'activate' | 'set_daily_budget' | 'set_lifetime_budget';
           value?: number }[];   // orçamento na moeda da conta (ex.: 25.5), mínimo 1
}
// resposta
{
  validateOnly: boolean;
  results: { objectId: string; ok: boolean; code?: ActionErrorCode; message?: string;
             row?: { status, effectiveStatus, dailyBudget, lifetimeBudget, budgetLevel } }[];
}
```

`row` é o estado lido da Meta depois da mudança. Com `validateOnly`, é o estado atual.

Códigos de erro estáveis: `OBJECT_NOT_IN_DASHBOARD`, `BUDGET_NOT_ON_THIS_LEVEL`, `INVALID_VALUE`, `UNSUPPORTED_CURRENCY`, `TOKEN_INVALID`, `MISSING_PERMISSION`, `ACCOUNT_RESTRICTED`, `RATE_LIMITED`, `LOW_BUDGET`, `HIGH_BUDGET`, `META_REJECTED` (com a mensagem da Meta), `META_UNAVAILABLE`, `SKIPPED`.

#### GET `/available-accounts`

```ts
{
  needsToken: boolean;         // true se o usuário ainda não tem nenhum token salvo
  accounts: { id: string; name: string; currency: string; timezone: string | null;
              accountStatus: string | null; linked: boolean; linkedDashboardId: string | null }[];
  warnings: string[];
}
```

Lista `/me/adaccounts` de cada token distinto já salvo pelo usuário (System User). Sem token salvo, devolve `needsToken: true` e lista vazia.

**Primeiro token:** com `needsToken: true`, a tela pede o token e chama `POST /available-accounts { accessToken }`. A resposta tem o mesmo formato e lista as contas daquele token, sem gravar nada. Um token recusado pela Meta devolve 400 com a mensagem. Depois a tela envia `PUT /accounts { accountIds, accessToken }` com as contas marcadas, e o token é salvo cifrado junto com cada conta. Não existe token salvo sem conta: `facebook_connections` guarda o token por conta.

#### PUT `/accounts`

```ts
// body
{ accountIds: string[]; accessToken?: string }   // lista final de contas do painel (até 50)
// resposta
{ results: { accountId: string; ok: boolean; code?: 'ACCOUNT_IN_OTHER_DASHBOARD' | 'NOT_VISIBLE_TO_TOKEN' | 'META_REJECTED'; message?: string }[];
  accounts: AdAccountSummary[] }  // mesmo formato de /api/finance/:painel/settings → accounts
```

Contas novas são verificadas na Meta e gravadas com o token que as enxerga (ou com `accessToken`, se enviado). Contas que saíram da lista são desativadas (`is_active = false`), sem apagar.

### 5.2 Logica do Service

- `CampaignsService.objects` lê, em paralelo por conta, a hierarquia (`/campaigns`, `/adsets`, `/ads` com status e orçamento), os Insights do nível pedido por dia (`time_increment=1`) e os dados da conta. Converte por dia com a PTAX, atribui as vendas e monta as linhas. Os Insights ficam 5 min em cache por conta × nível × período. Cada ação limpa o cache das contas afetadas.
- A atribuição (`campaign-attribution.ts`) é pura e testada. O faturamento de cada objeto usa o mesmo `salesTotals` do Resultado, então taxa, imposto e devoluções seguem uma regra só.
- `CampaignActionsService` lê o objeto (`account_id`, orçamento da campanha), confere a conta no painel e grava com o token daquela conta.

## 6. Implementacao no Frontend

Tela em `packages/frontend/src/pages/Campaigns.tsx` (rota `/campaigns/meta`). Ela consome o contrato acima e filtra por conta, campanha e conjunto na própria tela. Peças compartilhadas com o Acompanhamento de testes:

- `components/summary/ResultDatePicker.tsx`: seletor de data padrão do app (Resultado, Testes, Campanhas, Vendas). `showCompare={false}` esconde "Comparar com o último período" onde a tela não compara; `align="end"` para botão na borda direita.
- `components/campaigns/CampaignRowControls.tsx`: `CampaignStatusBadge`, `CampaignActionsMenu` (⋮) e `StatusConfirmDialog`. Usam o mesmo `POST /actions`; nenhuma API nova.
- `components/table/ColumnResizeHandle.tsx` + `hooks/useColumnWidth.ts`: coluna arrastável, largura em `localStorage` com chave por usuário (`dashzip:<userId>:col-width:<nome>`), com try/catch.
- `components/table/TablePagination.tsx` + `lib/pagination.ts`: 25 linhas por página.

Nada disso grava histórico de campanha: os números continuam vindo da Meta na hora.

## 7. Pontos de Integracao

- **Resultado (`/finance`)**: as mesmas contas, a mesma PTAX, o mesmo custo sobre mídia e o mesmo `salesTotals`.
- **Vendas e tracking**: a atribuição depende do casamento venda × sessão (`visitor-matching.service`).
- **Regras automáticas** (etapa 4): vão usar `objects` para avaliar as condições e `actions` para agir.

## 8. Edge Cases e Tratamento de Erros

- Conta sem token válido ou sem `ads_read`: entra em `warnings` e as métricas dela vêm `null`.
- PTAX indisponível com conta em USD: `spend` vem `null`, `spendNative` continua, com aviso em `warnings`.
- Venda em USD sem PTAX: conta como venda, mas o faturamento do objeto vem `null`.
- Paginação da Meta limitada. Período grande demais com muitos anúncios devolve o aviso para reduzir o intervalo.
- Moedas sem centavos (ex.: JPY) não aceitam ação de orçamento (`UNSUPPORTED_CURRENCY`).

## 9. Checklist de Testes

- [ ] Venda com sessão casada usa as UTMs da sessão, mesmo que a venda tenha outras
- [ ] `utm_source` reescrito (`…jLj…`) e `utm_term=stl_…` não atrapalham a atribuição
- [ ] Venda com só o ID da campanha não aparece em conjuntos nem anúncios
- [ ] Venda com ID que não existe nas contas entra em `untrackedSales`
- [ ] Pedido reembolsado sai das vendas
- [ ] Conta USD: `spend` = Σ gasto do dia × PTAX do dia; `mediaTax` = custo sobre mídia
- [ ] `roi` e `roas` nulos com gasto zero ou nulo; `cpa` nulo sem venda e zero com venda sem gasto; `profit` nulo só quando o gasto ou o faturamento é indisponível
- [ ] Uma conta com erro na Meta não derruba as outras e aparece em `warnings`
- [ ] Ação em objeto de conta fora do painel é recusada sem chamar a Meta
- [ ] `validateOnly` não muda nada na Meta
- [ ] Lote interrompe em `RATE_LIMITED` e marca o resto como `SKIPPED`

## Ajustes de visual (23/11/2026)

- Linhas verticais entre as colunas (`GRID_TABLE` em `components/table/gridTable.ts`, também no Acompanhamento de testes) e células com mais respiro (`px-4 py-3`).
- Colunas reordenáveis: arraste o cabeçalho ou use as setas em **Colunas → Ordem**. A ordem fica salva com as preferências do painel (`campaign_columns`).
- Colunas novas: **Margem** (lucro ÷ faturamento líquido, calculada no servidor junto das outras métricas) e **Criação** (`created_time` da Meta), que fica por último. As duas entram uma vez nas preferências já salvas.
- **IC** no lugar de "Checkouts" (InitiateCheckout) e **IOF** no lugar de "Custo mídia" (o percentual sobre o gasto das contas em dólar, configurado em Custos).
- ROI sem o "x", verde acima de 1 e vermelho abaixo de 1. ROI de 1 indica que o líquido após o imposto cobre anúncios e IOF. O lucro também considera o CMV. Margem segue o sinal do lucro.
- Seletor de moeda (R$ / US$) ao lado do status. O servidor manda as métricas em BRL e a PTAX do período (`usdBrl.period`, média dos dias) e do último dia (`usdBrl.latest`). Em dólar, as métricas dividem pela média do período; orçamento e saldo do ciclo, que vêm na moeda da conta, convertem pela PTAX do último dia. O diálogo de orçamento continua na moeda da conta, que é a que a Meta grava.
- Saiu o texto do período abaixo dos filtros. O aviso de vendas sem anúncio virou "X vendas não rastreadas no período selecionado (R$ Y)".

## No celular

Abaixo de 768px a tabela vira cards (um por objeto), com switch de ativar/pausar, orçamento em um toque, filtros numa gaveta e ações em lote numa barra fixa. Detalhes e padrões em [Celular primeiro e velocidade](../31-mobile/mobile.md).

## Status em switch, largura de todas as colunas e ordenação visível (23/11/2026)

- Coluna **Status** da tabela virou um switch (ativo/pausado). Mexer no switch abre a mesma confirmação do menu ⋮; nada vai para a Meta sem confirmar. Quando a entrega efetiva difere do status (ex.: conjunto pausado, em revisão), o texto aparece ao lado em cinza. Status que não dá para alternar (arquivado, excluído) continua como etiqueta.
- **Toda coluna tem largura ajustável**: Status, Orçamento/Gasto do ciclo e cada métrica ganharam a alça na borda direita do cabeçalho (arrastar, setas do teclado, duplo clique volta ao padrão). As larguras ficam salvas por usuário neste navegador (`useColumnWidths('campaigns')`). Arrastar pela alça não dispara a reordenação da coluna.
- **Ordenação**: todo cabeçalho mostra o ícone de ordenar; clique ordena do maior para o menor e o segundo clique inverte, com a seta indicando a ordem atual.

## Colunas travadas até o nome (25/11/2026)

Seleção, ações, Status e Nome ficam travados à esquerda ao rolar a tabela para o lado; as demais colunas passam por baixo.
