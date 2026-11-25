# Wiapy: vendas lidas na hora pelo MCP

Com a conta Wiapy conectada a um painel, Resultado, Vendas e Campanhas buscam as
vendas do período **direto na Wiapy, no momento em que a tela abre**. Assim
qualquer período tem o faturamento completo, inclusive os anteriores à migração
para o dash.zip (o webhook só existe desde 22/11/2026).

**Decisão:** o dash.zip não grava histórico de vendas. A Wiapy é a fonte e o
dash.zip guarda no máximo um cache em memória. O webhook continua gravando as
vendas novas, porque é ele que liga a venda à visita (`session_id`) e dispara o
Purchase da API de Conversões. Esta integração não altera o webhook nem a CAPI.

## Fonte

A Wiapy não tem API REST pública, só um servidor MCP (`https://mcp.wiapy.com/mcp`,
transporte HTTP streamable, JSON-RPC). O backend fala com ele por um cliente
JSON-RPC próprio (`wiapy-mcp.client.ts`), com `initialize`,
`notifications/initialized` e `tools/call`. A resposta pode vir em JSON ou SSE.
O SDK oficial ficou de fora porque é ESM e traz servidor, transportes e zod, que
o backend Nest (CommonJS, empacotado para a Vercel) não usa.

| Ferramenta | Uso |
|---|---|
| `my_sales_list` | Vendas do período: `period: range`, `date_start`/`date_end`, `limit: 100`, `page`. Traz `date` (criação), `last_update`, `status`, `payment_method`, `sale_amount` (pago pelo cliente), `fee` (taxa Wiapy) e `received` (líquido). |
| `my_sales_get` | Detalhe de uma venda: `origin` com as UTMs. Só Campanhas usa, para atribuir a anúncios. |
| `wiapy_account` | Nome da conta, mostrado no card. |

Nenhuma ferramenta que altera dados é chamada.

## Conexão (OAuth 2.1)

Card **Wiapy** em Integrações (`WiapyCard.tsx`), com os estados Conectada,
Desconectada e Reconectar.

1. **Conectar Wiapy** chama `POST /api/integrations/wiapy/connect`. O backend
   faz o registro dinâmico (RFC 7591: `client_name` "dash.zip", cliente público
   `token_endpoint_auth_method: none`, `redirect_uris` com o callback de produção
   e, em dev, o de localhost). Depois gera o PKCE S256 e um `state` aleatório e
   devolve o endereço de `/oauth/authorize` (escopo `producer`,
   `resource=https://mcp.wiapy.com/mcp`).
2. A pessoa autoriza na Wiapy, que redireciona para
   `GET /api/integrations/wiapy/callback`. Essa rota é pública, porque é um
   redirect do navegador. Quem prova a origem é o `state`: só o hash SHA-256 dele
   fica em `wiapy_oauth_states`, a linha é **apagada na leitura** (uso único) e
   vale 10 minutos. Se a Wiapy mandar `iss`, ele precisa ser
   `https://mcp.wiapy.com`.
3. O código é trocado por tokens (`authorization_code` + `code_verifier`). A
   conexão anterior do painel, se havia, é revogada. O fluxo termina em
   `/integrations?wiapy=connected`, ou em `?wiapy=error&message=...`.
4. **Desconectar** (`DELETE /api/integrations/wiapy`) revoga o refresh token em
   `/oauth/revoke` (melhor esforço) e apaga a linha.

O retorno para o painel usa o `APP_URL` da instância (ou `http://localhost:*` em desenvolvimento).
Qualquer outro host, como um preview da Vercel ou um header forjado, cai na produção.

### Onde ficam os tokens

Tabela `wiapy_connections` (uma linha por painel). `client_id`, refresh token e
access token ficam cifrados com AES-256-GCM pelo `EncryptionService`, o mesmo do
token da Meta e da CAPI. A chave vem de `ENCRYPTION_KEY` ou, sem ela, da service
role. RLS ligada e sem acesso para anon/authenticated. Os tokens nunca vão para
log nem para o front: `GET /api/integrations/wiapy` devolve só
`{ connected, needsReconnect, accountName, connectedAt }`.

### Renovação

O access token fica em memória até um minuto antes de vencer. Vencido, é
renovado pelo refresh token, e se a Wiapy rotacionar o refresh token o novo
substitui o anterior. Chamadas paralelas esperam a mesma renovação. Um 401 do
MCP força uma renovação e uma nova tentativa. Se a Wiapy recusar o refresh token
(`invalid_grant`), a conexão vira `status = 'reauth'`, as telas voltam ao webhook
e o card pede **Reconectar**.

## Leitura na hora

`WiapySalesService.merge()` entra nas leituras de vendas:

| Tela | Endpoint | Origem (UTMs) |
|---|---|---|
| Resultado | `GET /api/summary/:workspaceId` (período e comparação) | só a que estiver em cache |
| Vendas | `GET /api/sales` | só a que estiver em cache |
| Campanhas | `GET /api/campaigns/:id/objects` | busca (`my_sales_get`) |

Regras, o Acompanhamento de testes e o gasto do Resultado continuam lendo só o
banco.

### Período

O período do `my_sales_list` filtra pela **última movimentação**, não pela data
da venda. Por isso o backend pede a janela que vai da véspera de `since` até 31
dias depois de `until` (limitada a hoje) e fica só com as vendas cuja `date`
(criação) cai no período, no fuso do painel. Ficam de fora apenas as vendas
cuja última movimentação veio mais de um mês depois, como um estorno tardio, que
já não contariam como faturamento. Paginação de 100 em 100, com até 4 páginas em
paralelo e teto de 60 páginas. Passando disso, a tela recebe o aviso de que o
período foi cortado.

### Produtos

`wiapy_connections.product_ids` limita a busca aos produtos do painel
(parâmetro `checkouts`). Fica vazio quando o painel usa a integração "todos os produtos". A busca usa então todas as
vendas da conta, inclusive as de coprodução e afiliação (`my_role`).

### União com o webhook

A chave é o id da venda na Wiapy, que é o `external_id` do webhook
(`payment.id`). A linha do webhook **manda**: sessão, UTMs, anúncio e produto
continuam os dela. A da Wiapy só preenche campos vazios, inclusive a taxa
(`metadata.payment_fee`), e avança o status quando a venda andou (pendente →
paga, paga → estornada/chargeback), mas nunca o faz voltar. As vendas que só
a Wiapy conhece entram com id `wiapy-<id>` e
`checkout_integration_id` = a integração Wiapy do painel. Assim usam as mesmas
regras de taxa e a mesma chave de pedido. Esses ids não são uuid e ficam fora
das consultas por `sale_id` (sessões e `capi_events`).

Mapeamento: `paid` vira approved, `unpaid` vira pending, `refunded` vira refunded,
`chargedback` vira chargeback e qualquer outro status (recusado, expirado,
cancelado) vira refused. O valor é `sale_amount`, a taxa é `fee` e o líquido fica
igual ao `received` da Wiapy. Com isso, taxa de aprovação, Pix/cartão e
pendentes passam a contar os pedidos da Wiapy.

### Atribuição das vendas antigas

Funciona. O `my_sales_get` devolve em `origin` as UTMs da época da UTMify
(`utm_content` = `nome|id do anúncio`, `utm_medium` = `conjunto|id`,
`utm_campaign` = `campanha|id`), e o `attribute()` de Campanhas já lê esse
formato. A origem só é buscada para vendas pagas, estornadas ou com chargeback
que o webhook não tem. A busca roda com 8 chamadas em paralelo, no máximo 300 por
carregamento e um orçamento de 25 s, e cada origem fica em cache por 12 horas. O
que não couber aparece como "não rastreado", com o aviso de que a origem ainda
está carregando, e entra na próxima atualização. Venda sem UTM de anúncio
continua não rastreada, sem atribuição inventada.

### Cache (memória, por instância)

| Chave | Validade |
|---|---|
| Período (painel + since + until + fuso) | 2 min se inclui hoje, 30 min se já fechou |
| Falha da Wiapy | 30 s, para não esperar a Wiapy a cada recarga |
| Origem de uma venda | 12 h |
| Access token | até 1 min antes de vencer |

Duas telas pedindo o mesmo período ao mesmo tempo fazem uma busca só. Conectar
ou desconectar limpa o cache do painel. Nada disso vai para o banco.

### Falha ou desconexão

- **Desconectada:** as telas mostram só as vendas do webhook, sem aviso.
- **Wiapy fora do ar ou com erro:** as telas também mostram só as do webhook,
  com o aviso discreto "Faturamento da Wiapy indisponível agora", em `warnings`.

## Contrato

Só campos opcionais foram acrescentados, porque o app iOS consome
`/api/summary/:workspaceId` e `/api/workspaces`:

- `/api/summary/:workspaceId`: `salesSource?: 'wiapy' | 'webhook'`. O aviso usa o
  `warnings` que já existia.
- `/api/sales`: `source?` e `warnings?` na resposta e `source` em cada pedido.
  Pedidos `wiapy` não têm visita nem Purchase no dash.zip, e a aba diz isso.
- `/api/workspaces`: sem mudança.

## Arquivos

- `packages/backend/src/modules/wiapy/`: OAuth, cliente MCP, conexão, leitura e
  união, controller e testes.
- `supabase/migrations/20261123180000_wiapy_connections.sql`: `wiapy_connections`
  e `wiapy_oauth_states` (aditiva).
- `packages/frontend/src/components/integrations/WiapyCard.tsx` e
  `hooks/useWiapy.ts`.

## Retorno pelo localhost (23/11/2026)

A Wiapy só aceita `redirect_uri` de uma lista fixa (claude.ai, chatgpt.com e `localhost`): o callback no domínio do painel é recusado no registro com `invalid_redirect_uri` ("redirect_uris não permitidas"). Por isso:

- O registro e o consentimento usam `http://localhost/dashzip-wiapy`.
- "Conectar Wiapy" abre a autorização numa aba nova. Depois de autorizar, essa aba para numa página que não carrega. O operador copia o endereço dela e cola no card, e `POST /api/integrations/wiapy/complete` (`workspace_id`, `url`) faz a troca do código.
- O código só vale com o verifier PKCE, que fica cifrado no servidor, e o state é de uso único e precisa ser do mesmo usuário e painel.
- A renovação pelo refresh token não usa redirect, então só esse primeiro passo é manual.
- O `GET /callback` continua no código para quando a Wiapy liberar o domínio.

No card de Integrações, o título passou a ser **Checkout** (dados passados, vendas retroativas). O card de webhook e código da página virou **Rastreio de Vendas**.
