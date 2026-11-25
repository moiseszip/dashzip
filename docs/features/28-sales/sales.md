# Vendas

> **Modulo:** `packages/backend/src/modules/sales` (`sales.controller.ts`, `sales-list.ts`) | **Pagina:** `packages/frontend/src/pages/Sales.tsx` (rota `/sales`)
> **Ultima atualizacao:** 2026-11-22
> **Status:** Revisao

---

## 1. Proposito

Os pedidos que chegaram pelos webhooks dos checkouts, com o resumo do período no topo. Só lê a tabela `sales` (e `capi_events` para o status do Purchase); nada novo é gravado. O dash.zip não importa vendas antigas: a lista começa no webhook de cada checkout.

## 2. Comportamento para o Usuario

1. Botão **Data** igual ao do Resultado (`ResultDatePicker`, sem "comparar"): predefinidos, calendário de intervalo em dois cliques, até 92 dias. Padrão: últimos 7 dias. Os cards e a lista seguem o período.
2. Cards do topo:
   - **Faturamento líquido**: pedidos aprovados menos a taxa do checkout, com a mesma conta do card do Resultado (`salesTotals(...).checkoutNetBRL`). Embaixo, o bruto.
   - **Vendas aprovadas**: quantidade de pedidos aprovados (o order bump conta junto com o principal) e o valor bruto.
   - **Pix aprovado** e **Cartão aprovado**: valor e quantidade de pedidos aprovados do meio, e a aprovação do meio (pagos ÷ gerados no período).
   - **Vendas pendentes**: valor e quantidade de pedidos gerados e ainda não pagos.
3. Filtro por status (todas, aprovadas, pendentes, reembolsadas), busca por cliente, e-mail ou produto, e o detalhe do pedido com o Purchase enviado ao Meta (sem mudança).

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Período | `since`/`until` (dias de São Paulo) | `sold_at` ≥ `since` 03:00 UTC e < dia seguinte a `until` 03:00 UTC. Intervalo invertido ou maior que 92 dias: 400. Sem datas, vale o `period` antigo (`today`, `7`, `30`, `90`) |
| RN-02 | Pedido | Linhas com o mesmo `order_external_id` | Um pedido; estorno ou chargeback em qualquer linha vale para o pedido |
| RN-03 | Meio de pagamento | `sales.payment_method` | Normalizado como nas taxas (`normalizePaymentMethod`): texto com "pix" é Pix; "credit", "crédito", "card", "cartão" é cartão |
| RN-04 | Aprovado do meio | Status `approved` | Soma e conta só os aprovados sem estorno |
| RN-05 | Aprovação do meio | Pedidos do meio no período | (aprovados + reembolsados + chargebacks) ÷ todos os pedidos gerados do meio. Sem pedidos: vazio |
| RN-06 | Pendentes | Status `pending` | Quantidade e soma dos valores |
| RN-09 | Recusadas | Status `refused` (cartão negado, cancelado ou expirado antes de pagar; desde 23/11/2026) | Aparece na lista com o selo "Recusada" (filtro Todas), conta nos gerados da aprovação do meio e não entra em vendas, faturamento nem pendentes |
| RN-07 | Faturamento líquido | Regras de taxa do painel | Mesma função do Resultado. Venda em USD usa a PTAX do dia; sem cotação ou sem as regras, o card mostra "—" e o resto da aba continua |
| RN-08 | Limite | Mais de 2000 linhas no período | A aba avisa que mostra as 2000 mais recentes; os cards usam as mesmas linhas |

## 5. API / Backend

| Metodo | Path | Descricao |
|---|---|---|
| GET | `/api/sales?workspace_id=…&since=YYYY-MM-DD&until=YYYY-MM-DD` | Pedidos e resumo do período (`period` continua aceito) |
| GET | `/api/sales/purchase?workspace_id=…&sale_ids=…` | Purchase do pedido como saiu para o Meta |

```ts
interface SalesSummary {
  orders: number;               // pedidos aprovados
  revenue: number;              // bruto dos aprovados
  netRevenue: number | null;    // depois da taxa do checkout
  refunded: number;
  pending: number;
  pendingAmount: number;
  matched: number;
  purchaseSent: number;
  pix: MethodSummary;
  card: MethodSummary;
  currency: string;
}

interface MethodSummary {
  approved: number;
  approvedAmount: number;
  generated: number;
  approvalRate: number | null;  // 0–1
}
```

## 9. Checklist de Testes

- [x] Pix e cartão separados, aprovação pagos ÷ gerados, pendentes (`sales-list.spec.ts`)
- [x] Limites UTC do intervalo e recusa acima de 92 dias (`sales-list.spec.ts`)
- [x] Tela com dados de teste em 1440 px e 390 px (Playwright)
- [ ] Conferir o faturamento líquido com o card do Resultado no mesmo período, em produção
