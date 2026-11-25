# Funcionalidades do Dash.zip

Mapa das funcionalidades e regras do Dash.zip. O histórico, a organização do código e a implantação estão no [README](../../README.md).

## Como usar esta documentacao

- **Desenvolvedores**: Consulte os endpoints, hooks e modelos de dados de cada feature antes de modificar
- **Product Managers**: Leia o Proposito e Regras de Negocio de cada feature para entender o comportamento esperado
- **QA / Testers**: Use o Checklist de Testes e a tabela de Regras de Negocio para criar casos de teste

Cada documento segue o [template padrao](TEMPLATE.md). Consulte o [glossario](GLOSSARY.md) para definicoes de termos.

---

## Indice

### Fundamentos
| Doc | Descricao |
|-----|-----------|
| [Autenticacao e Autorizacao](01-auth/auth-and-authorization.md) | Login, JWT, guards, RLS |
| [Workspaces](02-workspaces/workspaces.md) | Containers (areas): cada um com snippet, pixel, webhooks e preview |

### Preview e debug
| Doc | Descricao |
|-----|-----------|
| [Modo preview](20-preview/preview-debug.md) | Debug web (navegador) e server (requisicoes, tags, HTTP de saida, console), no estilo do GTM |
| [Mapa de calor](21-heatmap/heatmap.md) | Coleta de cliques e rolagem e o desenho sobre a pagina real. A tela agora fica na aba Hotjar |

### Rastreio e API de Conversoes
| Doc | Descricao |
|-----|-----------|
| [Rastreio de Visitantes](18-visitor-tracking/visitor-tracking.md) | Snippet da pagina de vendas, indexador, casamento com a venda |
| [API de Conversoes do Meta](18-visitor-tracking/meta-capi.md) | PageView, InitiateCheckout e Purchase pelo servidor, no subdominio do cliente |

### Integracoes
| Doc | Descricao |
|-----|-----------|
| [Visao Geral](07-integrations/integrations-overview.md) | Pagina de integracoes e como funciona |
| [Integracoes de Checkout](07-integrations/checkout-integrations.md) | Webhooks das plataformas de pagamento |
| [Wiapy (MCP)](07-integrations/wiapy.md) | Conexão OAuth e vendas da Wiapy lidas na hora para qualquer período |

### Webhooks (por plataforma)
| Doc | Descricao |
|-----|-----------|
| [Visao Geral dos Webhooks](08-webhook-processing/webhook-processing-overview.md) | Fluxo comum, fila, retry |
| [Hotmart](08-webhook-processing/hotmart.md) | Regras especificas Hotmart |
| [Kiwify](08-webhook-processing/kiwify.md) | Regras especificas Kiwify |
| [Kirvano](08-webhook-processing/kirvano.md) | Regras especificas Kirvano |
| [Guru](08-webhook-processing/guru.md) | Regras especificas Guru |
| [PerfectPay](08-webhook-processing/perfectpay.md) | Regras especificas PerfectPay |
| [Ticto](08-webhook-processing/ticto.md) | Regras especificas Ticto |
| [PayT](08-webhook-processing/payt.md) | Regras especificas PayT |
| [Cakto](08-webhook-processing/cakto.md) | Regras especificas Cakto |
| [Hubla](08-webhook-processing/hubla.md) | Regras especificas Hubla |
| [CartPanda](08-webhook-processing/cartpanda.md) | Regras especificas CartPanda |
| [GG Checkout](08-webhook-processing/ggcheckout.md) | Regras especificas GG Checkout |
| [LastLink](08-webhook-processing/lastlink.md) | Regras especificas LastLink (integracao por produto) |
| [Eduzz](08-webhook-processing/eduzz.md) | Regras especificas Eduzz (HMAC SHA-256) |
| [Mundpay](08-webhook-processing/mundpay.md) | Regras especificas Mundpay (token via ?token= query param) |
| [Monetizze](08-webhook-processing/monetizze.md) | Regras especificas Monetizze (codigos de status numericos) |
| [Greenn](08-webhook-processing/greenn.md) | Regras especificas Greenn (UTMs em saleMetas) |

### Midia paga
| Doc | Descricao |
|-----|-----------|
| [Campanhas Meta](22-campaigns/campaigns.md) | Conta, campanha, conjunto e anuncio com as vendas do painel atribuidas pela UTM; pausar, ativar e orcamento |
| [Taxas e despesas](23-fees-expenses/fees-expenses.md) | Impostos e taxas por meio de pagamento, custo sobre midia, custo de produto e despesas |
| [Resumo](24-summary/summary.md) | Cards e graficos da operacao com layout personalizavel; preferencias de tela |
| [Regras automaticas](25-rules/rules.md) | Pausar, ativar e ajustar orcamento por condicao, com simulacao, historico e agendamento pelo pg_cron |
| [Acompanhamento de testes](26-tests/tests.md) | Campanha x dia com lucro, ofertas pelo codigo no nome, ultima mudanca e saude do checkout |
| [Hotjar](27-hotjar/hotjar.md) | Comportamento por pagina: mapa de cliques e de rolagem, retencao da pagina (rolagem, abandono, tempo), funil do quiz e retencao da VSL ([detalhe da VSL](27-hotjar/vsl.md)) |
| [Vendas](28-sales/sales.md) | Pedidos dos webhooks com Data padrao e cards de faturamento liquido, aprovadas, Pix, cartao e pendentes |

### Configuracoes
| Doc | Descricao |
|-----|-----------|
| [Configuracoes](10-settings/settings.md) | Conta, aparencia, usuarios |
| [Senha, dois fatores e fuso](30-settings/settings.md) | Troca de senha com a atual, 2FA TOTP no login e fuso horario por painel (hoje/ontem e corte dos dias) |
| [Aparencia](11-appearance/README.md) | Tema claro/escuro |
| [Modo streaming](29-streaming-mode/streaming-mode.md) | Botao no menu que troca nomes de oferta, campanha, produto, conta e cliente por apelidos para gravar a tela |
| [Celular primeiro e velocidade](31-mobile/mobile.md) | Barra inferior, gaveta, safe-area, Campanhas em cards no celular, bottom sheets e numeros de performance |
| [Logs no Discord](13-discord-logs/DISCORD_LOGS.md) | Avisos de venda e erro |
