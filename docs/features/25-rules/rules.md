# Regras automáticas

> **Modulo:** `packages/backend/src/modules/rules` | **Pagina:** tela de Regras (branch da tela)
> **Ultima atualizacao:** 2026-11-22
> **Status:** Revisao

---

## 1. Proposito

Regras que pausam, ativam ou ajustam o orçamento de campanhas, conjuntos e anúncios da Meta quando as condições batem. As regras leem os mesmos números da tela de Campanhas, com as vendas atribuídas pelo rastreio do dash.zip, e agem pelo mesmo endpoint de ações. A escrita usa o token do System User, então aparece no log da Meta como o System User, não como uma pessoa.

## 2. Comportamento para o Usuario

1. Lista de regras do painel, com liga e desliga, última execução e execuções de hoje.
2. Editor: alvo (nível, ativos ou pausados, contas, nome contém), condições (todas precisam bater), janela, ação, frequência, hora fixa, limite por dia e faixa de horas.
3. **Simular**: mostra os objetos que casariam agora, o valor de cada condição e a ação (antes → depois), sem agir.
4. **Executar agora** e **Histórico** de execuções.
5. Avisos de configuração arriscada aparecem ao salvar e ao simular.

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Números | Avaliação | `GET /api/campaigns/:painel/objects` no nível da regra e no período da janela (gasto em BRL, vendas do painel) |
| RN-02 | Alvo ativo | `targetStatus = active` | Só objetos com status efetivo `ACTIVE`. Anúncio ativo em campanha pausada não entra |
| RN-03 | Alvo pausado | `targetStatus = paused` | Só objetos com status `PAUSED` |
| RN-04 | Condições | Todas | Casam com E. Métrica indisponível (`null`, ex.: CPA sem venda) nunca casa |
| RN-05 | Unidades | Condições em dinheiro | BRL, como na tela de Campanhas. `dailyBudget` na moeda da conta. `ctr`, `hook` e `hold` em fração |
| RN-06 | Orçamento | Ações de orçamento | Só no nível onde o orçamento diário mora (`budgetLevel`). Aumento respeita o teto (`limit`) e redução respeita o piso. Valor mínimo de 1 na moeda da conta |
| RN-07 | Combinações | Salvar | Anúncio não aceita ação de orçamento. Pausar exige alvo ativo e ativar exige alvo pausado |
| RN-08 | Frequência | `frequencyMinutes` | 5, 10, 15, 30, 60, 120, 180, 360 ou 1440 (uma vez por dia, com `dailyHour` opcional) |
| RN-09 | Limites | `maxRunsPerDay`, `hourStart`–`hourEnd` | Horas de São Paulo. A faixa pode virar a meia-noite (22 → 6) |
| RN-10 | Teto por execução | Mais de 40 objetos casando | Age nos 40 primeiros; o resto fica para a próxima |
| RN-11 | Log | Toda execução | Uma linha em `dashboard_rule_runs`, com cada ação (antes, depois, ok e erro). Apagada depois de 90 dias |
| RN-12 | Aviso de janela "hoje" | Pausa por falta de venda, janela "hoje" e gasto mínimo abaixo do CPA dos últimos 7 dias | Aviso em `warnings`. Foi o que pausou o vencedor toda manhã no Novo IR |
| RN-13 | Outros avisos | Pausa por IC; ajuste de orçamento a cada ≤ 10 min sem limite diário | Aviso em `warnings` |

O CPA do aviso usa as vendas do dash.zip. Enquanto o histórico de vendas do painel for curto (painel recém-instalado), esse CPA sai inflado e o aviso aparece mesmo para gatilhos razoáveis.

## 4. Modelo de Dados

Migration [`20261122180000_dashboard_rules.sql`](../../../supabase/migrations/20261122180000_dashboard_rules.sql):

- `dashboard_rules`: `id`, `workspace_id`, `name`, `enabled`, `definition` (jsonb com tudo do contrato abaixo, menos nome e liga/desliga), `last_run_at`, `runs_day`, `runs_today`, `created_at` e `updated_at`.
- `dashboard_rule_runs`: `rule_id`, `workspace_id`, `trigger` (`schedule` | `manual`), `ran_at`, `since`, `until`, `evaluated`, `matched`, `succeeded`, `failed`, `actions` (jsonb) e `error`.
- Função `dash_rules_tick()` e jobs do `pg_cron`: `dash-rules-tick` a cada 5 min e `dash-rule-runs-retention` diário.

### Agendamento (uma vez, em produção)

1. Aplicar [a migration de validação do Vault](../../../supabase/migrations/20261122200000_rules_cron_vault.sql).
2. No SQL Editor do Supabase, criar os valores ausentes no Vault.

```sql
select vault.create_secret('https://painel.seudominio.com.br/api/rules-cron/tick', 'dash_rules_cron_url')
where not exists (select 1 from vault.secrets where name = 'dash_rules_cron_url');
select vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'dash_cron_secret')
where not exists (select 1 from vault.secrets where name = 'dash_cron_secret');
```

O job envia o token do Vault. O endpoint calcula seu SHA-256 e confere o resumo no banco por meio de uma função acessível à `service_role`. O job só chama o endpoint quando os dois valores do Vault existem e há alguma regra ligada.

## 5. API / Backend

| Metodo | Path | Descricao |
|---|---|---|
| GET | `/api/rules/:painel` | `{ rules, catalog }` |
| POST | `/api/rules/:painel` | Cria. `{ rule, warnings }` |
| PUT | `/api/rules/:painel/:id` | Substitui. `{ rule, warnings }` |
| PATCH | `/api/rules/:painel/:id/enabled` | `{ enabled }` → `{ rule }` |
| DELETE | `/api/rules/:painel/:id` | Apaga (e o histórico dela) |
| POST | `/api/rules/:painel/simulate` | Corpo = definição (sem nome). Não age |
| POST | `/api/rules/:painel/:id/run` | Executa agora. Devolve a linha do histórico |
| GET | `/api/rules/:painel/runs?ruleId&limit&before` | Histórico, do mais novo ao mais antigo. `limit` até 100 (padrão 20); `before` = `ran_at` da última linha recebida |
| POST | `/api/rules-cron/tick` | Só o pg_cron, com `Authorization: Bearer $dash_cron_secret` |

```ts
type Metric = 'spend' | 'sales' | 'cpa' | 'roi' | 'roas' | 'profit' | 'netRevenue' | 'grossRevenue' | 'cpc' | 'cpm'
  | 'ctr' | 'impressions' | 'clicks' | 'landingPageViews' | 'initiateCheckouts' | 'costPerCheckout' | 'frequency'
  | 'hook' | 'hold' | 'dailyBudget';
type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'not_between';
type Window = 'today' | 'yesterday'
  | 'last_2_days' | 'last_3_days' | 'last_7_days' | 'last_14_days' | 'last_30_days'            // até ontem
  | 'last_2_days_with_today' | 'last_3_days_with_today' | 'last_7_days_with_today'
  | 'last_14_days_with_today' | 'last_30_days_with_today';

interface RuleBody {
  name: string;                                   // 1–80
  enabled: boolean;
  level: 'campaign' | 'adset' | 'ad';
  targetStatus: 'active' | 'paused';
  accountIds: string[];                           // [] = todas as contas do painel
  nameContains: string | null;
  conditions: { metric: Metric; operator: Operator; valueA: number; valueB: number | null }[];  // 1–10
  window: Window;
  action: {
    type: 'pause' | 'activate' | 'increase_budget' | 'decrease_budget' | 'set_budget';
    valueType: 'percentage' | 'amount' | null;    // aumento/redução; definir = amount; pausar/ativar = null
    value: number | null;                         // % (0–100) ou valor na moeda da conta
    limit: number | null;                         // teto do aumento ou piso da redução, moeda da conta
  };
  frequencyMinutes: 5 | 10 | 15 | 30 | 60 | 120 | 180 | 360 | 1440;
  dailyHour: number | null;                       // só com 1440
  maxRunsPerDay: number | null;                   // 1–288
  hourStart: number | null; hourEnd: number | null;  // os dois ou nenhum
}

// GET → { rules: (RuleBody & { id, lastRunAt, runsToday, createdAt, updatedAt, lastRun: RunSummary | null })[],
//         catalog: { metrics: { key, label, unit }[], operators, windows, actions, frequencies } }

// POST /simulate → {
//   since, until, evaluated: number,
//   matches: { objectId, name, accountId, level, status, accountCurrency,
//              conditions: { metric, operator, valueA, valueB, actual: number | null, ok: boolean }[],
//              action: { action: 'pause' | 'activate' | 'set_daily_budget', before, after, value?, skipped? } }[],
//   warnings: string[] }

// Linha do histórico (run e GET /runs):
// { id, rule_id, trigger, ran_at, since, until, evaluated, matched, succeeded, failed, error,
//   actions: { objectId, name, accountId, action, before, after, ok, code?, message? }[] }
// GET /runs → { runs, nextBefore: string | null }
```

Erros: 400 com a mensagem (combinação inválida, campo fora da faixa), 403 (painel de outro usuário) e 404 (regra não encontrada).

## 6. Implementacao no Frontend

Tela na branch da sessão das telas.

## 7. Pontos de Integracao

- `CampaignsService.objects`: números da avaliação (cache de 5 min por conta, nível e período).
- `CampaignActionsService.run`: escrita, com erro por item e parada em `RATE_LIMITED`.
- Cada ação limpa o cache de Campanhas da conta, então a próxima avaliação vê o estado novo.

## 8. Edge Cases e Tratamento de Erros

- Falha da Meta numa conta: a avaliação segue com as outras, e a execução registra os avisos e os erros por ação.
- Tique que passa de 45 s: as regras que faltaram rodam no próximo tique, por ordem de `last_run_at`.
- A UTMify e o dash.zip agindo nas mesmas campanhas: desligue a regra da UTMify antes de ligar a equivalente aqui, senão as duas pausam e reativam em conflito.

## 9. Checklist de Testes

- [x] Janela, condições, `null` nunca casa, `between` com valores invertidos (`rules.spec.ts`)
- [x] Alvo por status efetivo, conta e nome
- [x] Aumento com teto, redução com piso e orçamento em outro nível
- [x] Agenda: frequência, limite diário, faixa de horas e uma vez por dia
- [x] Avisos de janela "hoje", IC e orçamento sem limite
- [x] Validação de combinações
- [ ] Executar agora numa campanha de teste pausada (regra de ativar com `validateOnly` não existe; use uma campanha sem entrega)
- [ ] Produção: migrations e os dois valores no Vault
