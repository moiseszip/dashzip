# Taxas, impostos, custo de produto e despesas

> **Modulo:** `packages/backend/src/modules/finance` | **Pagina:** tela de Taxas e Despesas (branch da tela, a partir de `preview/campanhas`)
> **Ultima atualizacao:** 2026-11-22
> **Status:** Revisao

---

## 1. Proposito

Cadastrar tudo o que sai entre o valor da venda e o lucro e que o checkout não informa: impostos e taxas extras por meio de pagamento, custo sobre o gasto em mídia, custo de cada produto e despesas da operação. Tudo cai numa régua só: Resultado, Campanhas e Resumo usam o mesmo `finance-totals.ts`.

## 2. Comportamento para o Usuario

1. **Taxas:** a lista de impostos e taxas extras, a lista de custos sobre mídia, o imposto sobre vendas (campo já existente) e as regras por checkout (já existentes). Um botão Salvar envia a configuração inteira.
2. **Custo de produto:** um custo em BRL por nome de produto, com grupo opcional. A tela oferece os produtos já vistos nas vendas do painel.
3. **Despesas:** uma lista de cadastros e as ocorrências do período, com as recorrentes já expandidas. Cada uma pode ser criada, editada e apagada.
4. **Permissão:** só o dono do painel. Painel legado (redirecionado) responde 403.

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Uma configuração por painel | `PUT /settings` | Substitui imposto, regras por checkout, taxas extras, custo sobre mídia e custo de produto de uma vez |
| RN-02 | Taxa extra por pedido | Pedido aprovado e não devolvido | Cada taxa extra com meio de pagamento `all` ou igual ao do pedido, e plataforma vazia ou igual à do checkout, soma `base × percent/100 + fixedBRL` uma vez por pedido |
| RN-03 | Base da taxa | `base` | `gross` = valor cheio do pedido. `net` = valor cheio − taxa do checkout |
| RN-04 | Imposto × taxa | `kind` | `tax` entra em `taxesBRL`; `fee` entra em `feesBRL`. Os dois são deduzidos no cálculo do lucro |
| RN-05 | Meio de pagamento | `sales.payment_method` | Normalizado para `pix`, `credit_card`, `boleto` ou `other`. Sem meio informado, só as taxas `all` valem |
| RN-06 | Custo de produto | Linha aprovada cujo `product_name` bate com o cadastro (sem diferenciar maiúsculas e espaços) | Soma o custo uma vez por linha (o bump é linha própria) |
| RN-07 | Custo sobre mídia | Conta de anúncio | Soma os percentuais das regras que valem para a conta: `all`, `currency` igual à moeda da conta ou `accounts` contendo a conta |
| RN-08 | Coluna antiga | `usd_ad_tax_percent` sem regras cadastradas | Vira a regra `legacy-usd` (moeda USD). A migration grava essa regra, e o PATCH antigo do Resultado continua atualizando ela |
| RN-09 | Sem alíquota presumida | Nada cadastrado | Nenhum imposto é aplicado (diferente da UTMify, que presume 12% em contas BRL) |
| RN-10 | Despesa avulsa | `kind = single` | Conta na `date` |
| RN-11 | Despesa recorrente | `kind = recurring` | Conta todo mês no `recurringDay` (1 a 28), de `startDate` até `endDate` (ou sem fim) |
| RN-14 | Imposto geral sobre vendas | `sales_tax_percent` | Incide sobre o valor líquido de cada pedido aprovado, após as taxas do checkout. |
| RN-13 | Taxa de checkout só quando faz diferença | `options.checkouts[].needsFeeRule` | A tela só mostra a regra de taxa de checkout para checkouts que mandam o valor cheio sem informar a taxa. Na Wiapy e na AbacatePay, o webhook já traz a taxa, então a regra não aparece |
| RN-12 | Lucro | Resultado | `resultBRL` = faturamento após taxas, impostos e custo de produtos − gasto − custo sobre mídia − despesas do período. `resultBeforeExpensesBRL` mantém o valor sem despesas |

## 4. Modelo de Dados

Migration [`20261122170000_fees_expenses_preferences.sql`](../../../supabase/migrations/20261122170000_fees_expenses_preferences.sql), aditiva.

- `dashboard_finance_settings` ganha três colunas `jsonb` (arrays): `extra_fees`, `media_tax_rules` e `product_costs`. `sales_tax_percent`, `usd_ad_tax_percent` e `checkout_rules` continuam.
- `dashboard_expenses`: `id`, `workspace_id`, `description` (1–120), `category` (`ads` | `tools` | `team` | `accounting` | `other`), `amount_brl` > 0, `kind` (`single` | `recurring`), `date`, `start_date`, `end_date`, `recurring_day` (1–28), `created_at` e `updated_at`. Um CHECK exige `date` na avulsa, e `start_date` mais `recurring_day` na recorrente.
- `dashboard_preferences` (`workspace_id`, `summary_layout`, `campaign_columns`, `updated_at`). Formato e rotas no contrato do Resumo, [`24-summary`](../24-summary/summary.md).

As três tabelas usam RLS sem policy: só a service role lê e grava, pelo backend.

## 5. API / Backend

Todas em `/api/finance/:painel`, com JWT do Supabase e dono do painel.

| Metodo | Path | Descricao |
|---|---|---|
| GET | `/settings` | Configuração completa, contas e opções dos selects |
| PUT | `/settings` | Substitui a configuração inteira |
| PATCH | `/settings` | Formato antigo do Resultado (continua funcionando) |
| GET | `/expenses?since&until` | Cadastros e ocorrências do período (até 400 dias) |
| POST | `/expenses` | Cria despesa |
| PATCH | `/expenses/:id` | Substitui a despesa (mesmo corpo do POST) |
| DELETE | `/expenses/:id` | Apaga |
| GET | `/` (`?days=7\|30\|90`) | Resultado. Ganhou `expensesBRL`, `resultBeforeExpensesBRL` e `sales.productCostsBRL` |

```ts
type PaymentMethod = 'pix' | 'credit_card' | 'boleto' | 'other';

interface ExtraFee {
  id: string;                    // [A-Za-z0-9_-]{1,40}, gerado pela tela
  description: string;           // 1–80
  kind: 'tax' | 'fee';
  paymentMethod: 'all' | PaymentMethod;
  platforms: string[];           // plataformas de checkout; [] = todas
  base: 'gross' | 'net';
  percent: number;               // 0–100
  fixedBRL: number;              // 0–100000, por pedido
}

interface MediaTaxRule {
  id: string;                    // 'legacy-usd' é o que veio da coluna antiga
  description: string;
  percent: number;               // 0–100
  scope: 'all' | 'currency' | 'accounts';
  currency: string | null;       // 'USD', 'BRL'… quando scope = currency
  accountIds: string[];          // act_… quando scope = accounts
}

interface ProductCost {
  id: string;
  productName: string;           // igual ao nome que chega na venda
  costBRL: number;
  group: string | null;
}

// GET /settings
interface SettingsResponse {
  salesTaxPercent: number | null;
  usdAdTaxPercent: number | null;           // espelho da regra legacy-usd, só leitura
  checkoutRules: { platform: string; percent: number; fixedBRL: number }[];
  extraFees: ExtraFee[];
  mediaTaxRules: MediaTaxRule[];
  productCosts: ProductCost[];
  accounts: { id: string; accountId: string; name: string; currency: string; timezone: string | null; active: boolean }[];
  options: {
    paymentMethods: ('all' | PaymentMethod)[];
    platforms: string[];                    // plataformas de checkout do painel
    products: string[];                     // produtos já vendidos no painel + os do cadastro
    expenseCategories: ('ads' | 'tools' | 'team' | 'accounting' | 'other')[];
    checkouts: {                            // um por integração de checkout do painel
      integrationId: string; name: string; platform: string; active: boolean;
      receivesCommission: boolean;          // a venda chega pela comissão (já sem a taxa do checkout)
      feeReportedByProvider: boolean;       // o webhook traz a taxa (Wiapy, AbacatePay) ou as vendas recentes trouxeram
      needsFeeRule: boolean;                // !receivesCommission && !feeReportedByProvider
      recentSales: number;                  // vendas aprovadas consideradas (até 30)
    }[];
  };
}

// PUT /settings → body
interface PutSettings {
  salesTaxPercent: number | null;
  checkoutRules: { platform: string; percent: number; fixedBRL: number }[];  // até 40
  extraFees: ExtraFee[];          // até 50, id único
  mediaTaxRules: MediaTaxRule[];  // até 50, id único
  productCosts: ProductCost[];    // até 500, produto único
}
// resposta: SettingsResponse

interface Expense {
  id: string;
  description: string;
  category: 'ads' | 'tools' | 'team' | 'accounting' | 'other';
  amountBRL: number;
  kind: 'single' | 'recurring';
  date: string | null;          // YYYY-MM-DD, avulsa
  startDate: string | null;     // recorrente
  endDate: string | null;       // recorrente, opcional
  recurringDay: number | null;  // 1–28, recorrente
}

// GET /expenses?since=YYYY-MM-DD&until=YYYY-MM-DD
interface ExpensesResponse {
  since: string; until: string;
  expenses: Expense[];                 // todos os cadastros do painel
  occurrences: { expenseId: string; date: string; description: string; category: Expense['category']; amountBRL: number }[];
  totalBRL: number;
}
// POST e PATCH /expenses: body = Expense sem id; resposta = Expense
```

Erros: 400 com a mensagem do class-validator (campo inválido), 403 (painel de outro usuário), 404 (despesa não encontrada).

## 6. Implementacao no Frontend

Tela na branch da sessão das telas. O Resultado antigo (`Finance.tsx`) continua funcionando com o PATCH antigo até ser trocado.

## 7. Pontos de Integracao

- `salesTotals` e `mediaTotals` (`finance-totals.ts`) aplicam tudo; `parseSettingsRow` lê a linha do banco para o Resultado e para Campanhas.
- Campanhas: `mediaTax` de cada linha usa as regras da conta, e `netRevenue` desconta taxas extras e custo de produto.
- Resumo: cards de taxas, impostos, custo de produto e despesas.
- Salvar a configuração limpa o cache de Campanhas.

## 8. Edge Cases e Tratamento de Erros

- Pedido gravado pelo líquido sem `gross_amount`: o valor ainda serve como base do imposto geral. Uma taxa adicional percentual configurada sobre o bruto deixa o total após deduções indisponível quando se aplica a esse pedido.
- Taxa com base `net` maior que a base: o percentual não deixa a base negativa.
- Despesa recorrente com dia 29–31 não é aceita (1–28 garante o dia em todo mês).
- Apagar a regra `legacy-usd` pela tela nova zera `usd_ad_tax_percent`, para a regra não voltar sozinha.

## 9. Checklist de Testes

- [x] Imposto geral aplicado uma vez por pedido sobre o líquido após as taxas do checkout (`fees-expenses.spec.ts`)
- [x] Filtro de meio de pagamento e de plataforma
- [x] Custo de produto por linha, sem diferenciar maiúsculas
- [x] Normalização do meio de pagamento
- [x] Soma das regras de mídia por escopo e regra `legacy-usd`
- [x] Expansão das recorrentes com início, fim e período
- [ ] Tela: salvar configuração e conferir o Resultado
- [ ] Tela: despesa recorrente aparece todo mês no período
- [ ] Produção: aplicar a migration no SQL Editor antes do deploy do backend
