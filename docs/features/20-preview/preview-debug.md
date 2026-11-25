# Modo preview (debug web e server)

## Proposito

Ver, ao vivo, o caminho de cada evento ate o Meta — o papel do *Tag Assistant* (debug web) e do *preview do GTM Server* (debug server) num painel so. Serve para instalar o snippet, conferir um webhook novo e descobrir por que um Purchase nao saiu.

## Como funciona

```
Painel ──POST /api/debug/start──▶ workspaces.debug_until (+60 min), debug_token
   │
   ├─ abre https://site/oferta?stl_debug=<token>
   │        │
   │        ├─ tracker.js entra em modo debug (cookie _stl_dbg, 1 h)
   │        ├─ POST /api/t/debug  ── mensagens do navegador ──▶ debug_traces (source=web)
   │        └─ POST /api/t/collect  (leva dbg=<token>)
   │                    │
   │                    └─ DebugTrace (AsyncLocalStorage) ──▶ debug_traces (source=server)
   │
   ├─ webhooks /api/webhooks/:plataforma ── DebugTrace ──▶ debug_traces (source=server)
   │
   └─ GET /api/debug/traces?after=<created_at>  a cada 2 s
```

- **Ligado por area.** `workspaces.debug_until` diz ate quando; `debug_token` (48 hex) autentica o navegador. O painel renova sozinho enquanto a tela esta aberta.
- **Web.** O `tracker.js` so manda mensagens com o token, e o servidor so grava se o token for o do preview ligado. So eventos do Meta: *PageView* e *InitiateCheckout* (com pixel, external_id, fbp, fbc, sessao, indexador e as tags do pixel e do servidor) e o erro do pixel que nao carregou.
- **Server.** Toda requisicao de `/collect` e de webhook roda dentro de um `DebugTrace` (`modules/debug/debug-context.ts`). O controller abre; `MetaCapiService`, `SalesService`, `VisitorMatchingService` e o `DebugLogger` escrevem nele sem receber parametro. No fim, `DebugService.saveServerTrace` grava se a area estiver em preview. Fora do preview o rastro e descartado. No `/collect`, so entram requisicoes com PageView ou InitiateCheckout (saida de pagina, evento proprio e robo ficam de fora).
- **Banco de dados.** Cada gravacao feita na requisicao passa por `traced()` (`debug-context.ts`) e aparece na aba *Banco de dados*: tabela, operacao, os dados escritos e o que o banco devolveu (ou o erro). Cobre `tracking_ingest` (visitante, sessao, eventos), `sales`, `tracking_match_sale` e `capi_events` (registro, reserva e resultado do envio).
- **Webhook sem area conhecida** (token errado, assinatura invalida): a area sai do token do webhook (`checkout_integrations.webhook_secret`). Sem token reconhecivel, nao ha a quem mostrar e nada e gravado.

## Regras de negocio

| Regra | Onde |
|---|---|
| Preview dura 60 min por "Iniciar"; o painel renova quando faltam < 30 min | `debug.service.ts`, `usePreview.ts` |
| Token continua o mesmo enquanto o preview estiver ligado (a aba ja aberta segue funcionando) | `DebugService.start` |
| Mensagem web so entra com o token do preview ligado da mesma area | `DebugService.saveWebMessages` |
| `stl_debug` sai da URL e nunca vai para o checkout | `tracker-script.ts` (`dropDebugParam`, `readQuery`) |
| `?stl_debug=off` ou o `×` do selo saem do modo | `tracker-script.ts` |
| Headers `cookie`/`authorization` nao sao gravados; token, assinatura e hottok vao mascarados | `debug-context.ts` |
| O `access_token` da CAPI nunca aparece (nem mascarado com o valor real) | `MetaCapiService.post` |
| Corpo acima de 60 mil caracteres vira um resumo | `limitBody` |
| Rastros duram 24 h (limpeza ao iniciar + job do pg_cron) | migration `20261015120000_preview_debug.sql` |
| `/collect` aceita 300 req/min por IP (o preview manda mais que uma visita comum) | `tracking-collect.controller.ts` |

## Tags do servidor

| Tag | Disparada | Nao disparada | Falha |
|---|---|---|---|
| Meta CAPI — PageView / InitiateCheckout | Graph respondeu ok | sem pixel ou token | erro do Graph ou timeout (4 s) |
| Meta CAPI — Purchase | idem | sem pixel/token; venda nao aprovada; reentrega (event_id ja enviado) | idem |
| Gravar visita no banco | `tracking_ingest` gravou | — | RPC falhou |
| Cookies first-party | servidor regravou no dominio raiz | snippet fora de um subdominio do site | — |

## Endpoints

| Metodo | Rota | Auth |
|---|---|---|
| GET | `/api/debug/status?workspace_id=` | login |
| POST | `/api/debug/start` `{workspace_id}` | login |
| POST | `/api/debug/stop` `{workspace_id}` | login |
| GET | `/api/debug/traces?workspace_id=&after=` | login |
| DELETE | `/api/debug/traces?workspace_id=` | login |
| POST | `/api/t/debug` (text/plain, do navegador) | token do preview |

## Testes

- `tracking/__tests__/tracker-script.spec.ts` → *Modo preview*: selo, token fora da URL e do checkout, cookie entre paginas, `off`, InitiateCheckout, dataLayer, aviso sem checkout, preview encerrado.
- `tracking/__tests__/tracking.http.spec.ts` → *preview (debug do servidor)*: nada fora do preview, rastro completo em preview, robo aparece como descartado, mensagens web so com o token certo.
