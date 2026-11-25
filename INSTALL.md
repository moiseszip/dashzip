# Instalar o Dash.zip — roteiro para o agente

Este arquivo é para o **agente de IA** (Claude Code, Codex, Cursor ou outro) que recebeu o pedido "instale o Dash.zip". Ele leva uma instância do zero até o primeiro evento rastreado: repositório, banco, publicação, domínio, contas, integrações e testes.

O operador é quem tem as contas e decide. O agente conduz, executa e explica em linguagem simples.

## Regras para o agente

1. **Comece pelo onboarding.** Siga a skill [`dashzip-onboarding`](.claude/skills/dashzip-onboarding/SKILL.md). No Claude Code ela é carregada sozinha; em outros agentes, abra o arquivo e siga do mesmo jeito. Não crie nada antes de ter as respostas em `.setup/operacao.md`.
2. **Segredo não aparece na conversa.** Tokens, chaves e senhas ficam em `.setup/` (fora do Git, permissão 0600) e nas variáveis da Vercel. Nunca cole um segredo no chat, num commit ou num arquivo versionado.
3. **Peça confirmação antes de gastar ou publicar.** Criar projeto pago, mudar DNS de um domínio em uso ou trocar o rastreio de uma oferta que já vende: explique o efeito e espere o "pode".
4. **Login é do operador.** Quando um CLI pedir login, mostre o comando para ele rodar (no Claude Code: `! gh auth login`, `! vercel login`).
5. **Cada etapa termina verificada.** Rode a checagem indicada antes de seguir. Se falhar, resolva ou explique o bloqueio — não pule.
6. **Retome de onde parou.** Os comandos são idempotentes e o estado fica em `.setup/`. Se a conversa cair, leia `.setup/` e continue.

## Etapa 0 — Preparar a máquina e as contas

| Precisa | Como conferir |
|---|---|
| Node 20+ e npm | `node -v` |
| Git e GitHub CLI | `git --version`, `gh auth status` |
| Vercel CLI | `npm i -g vercel`, depois `vercel whoami` |
| Conta Supabase + Personal Access Token | supabase.com/dashboard/account/tokens → exporte `SUPABASE_ACCESS_TOKEN` só no terminal da sessão |
| Acesso ao DNS do domínio das páginas de venda | Registro.br, Cloudflare, Hostinger, GoDaddy… |
| Meta Business: Pixel (dataset) e token da API de Conversões | Gerenciador de Eventos → Configurações |
| Acesso admin ao checkout | Para criar o webhook |

Os planos gratuitos de GitHub, Vercel e Supabase atendem o começo.

## Etapa 1 — Onboarding

Siga a skill [`dashzip-onboarding`](.claude/skills/dashzip-onboarding/SKILL.md). Ela pergunta sobre a operação, decide entre **criar do zero** ou **migrar** uma oferta e grava `.setup/operacao.md`. Desse arquivo saem o domínio do painel (`APP_URL`), os painéis, os checkouts e os testes.

## Etapa 2 — Repositório do operador

O código público fica em `https://github.com/moiseszip/dashzip`. O operador trabalha numa cópia privada, que recebe as atualizações:

```bash
git clone https://github.com/moiseszip/dashzip.git dashzip
cd dashzip
gh repo create <nome-do-repo> --private --source . --remote origin --push
git remote add upstream https://github.com/moiseszip/dashzip.git
npm install
```

Confira: `git remote -v` mostra `origin` (privado do operador) e `upstream` (Dash.zip).

## Etapa 3 — Banco (Supabase)

Use o domínio decidido no onboarding como `APP_URL` desde já (ex.: `https://painel.seudominio.com.br`).

```bash
npm run setup -- supabase-orgs
npm run setup -- supabase-create --name dashzip --org <ORG_ID> --region sa-east-1
npm run setup -- schema
npm run setup -- auth --app-url https://painel.seudominio.com.br
npm run setup -- secrets --app-url https://painel.seudominio.com.br --email <email-do-operador>
npm run setup -- vault --app-url https://painel.seudominio.com.br
```

- `supabase-create` espera o projeto ficar pronto e salva URL e chaves em `.setup/supabase.json`.
- `schema` cria tabelas, regras de acesso, rotinas e agendamentos (pg_cron).
- `auth` fecha o cadastro público e aponta o login e o "esqueci a senha" para o painel.
- `secrets` gera `CRON_SECRET`, `ENCRYPTION_KEY` e as chaves do Web Push. Não gere de novo depois de publicar.
- `vault` grava no banco a URL e o segredo dos agendamentos e as chaves do Web Push.

Se a API do Supabase recusar algum passo, faça pelo painel: SQL Editor (colar `supabase/schema_completo.sql`), Authentication → Sign In (desligar cadastro) e URL Configuration. O [guia manual](docs/instalacao/manual.md) mostra cada tela.

## Etapa 4 — Publicar (Vercel)

```bash
vercel link --yes --project <nome-do-projeto>
vercel git connect
npm run setup -- env --app-url https://painel.seudominio.com.br --admin-emails <email1,email2>
npm run setup -- vercel-env --environment production
vercel --prod
```

O `vercel.json` já define build, saída, região (São Paulo) e o cron diário. Confira com o endereço `*.vercel.app` que o deploy imprimir:

```bash
curl -s https://<projeto>.vercel.app/health   # "status":"ok"
```

`degraded` = chave do Supabase errada ou schema que não rodou.

## Etapa 5 — Domínio

O painel, o script de rastreio e os webhooks saem do **mesmo subdomínio da marca** (first-party: o bloqueador não barra e o Meta recebe IP e cookies reais).

```bash
vercel domains add painel.seudominio.com.br <nome-do-projeto>
```

No DNS do domínio, crie `CNAME painel → cname.vercel-dns.com` (no Cloudflare, nuvem **cinza**). Se o operador der um token da Cloudflare, o agente pode criar o registro pela API dela; senão, mostre a linha exata para ele criar. Espere `vercel domains inspect painel.seudominio.com.br` ficar válido e rode:

```bash
npm run setup -- verify --app-url https://painel.seudominio.com.br
```

## Etapa 6 — Acesso e painéis

```bash
npm run setup -- admin --email <email-do-operador>
npm run setup -- workspace --owner <email-do-operador> --name "<Oferta>" --emoji "🎯" --timezone America/Sao_Paulo
```

Repita `workspace` para cada oferta do onboarding. A senha inicial fica em `.setup/admin.json`: entregue ao operador e peça para trocar em Configurações → Conta e ativar o segundo fator. Outros usuários entram por Configurações → Usuários.

No primeiro acesso, o painel abre o **tutorial das seções**. Ele pode ser revisto em Configurações → Conta.

## Etapa 7 — Integrações (com o operador logado)

Faça junto com o operador, em **Tracking → Integrações** de cada painel:

1. **API de Conversões do Meta.** ID do Pixel e token. Preencha o código de teste do Gerenciador de Eventos para a validação.
2. **Checkout e rastreio.** Escolha a plataforma; a tela mostra a URL do webhook e o token. Crie o webhook no checkout com o evento de pagamento indicado.
3. **Snippet.** Cole o código antes do `</body>` de cada página de venda. Se a página está num repositório a que o agente tem acesso, edite e publique; senão, entregue o trecho ao operador.
4. **Padrão de UTM.** Cole em *Parâmetros de URL* de cada anúncio.
5. **Contas de anúncio** (para Campanhas e Testes): vincule as contas Meta do onboarding.
6. Opcionais: conexão Wiapy, custos e taxas em **Custos**, regras automáticas, notificações de venda (Configurações → Notificações).

Para **migração**, siga também o [guia de migração](docs/instalacao/migracao.md): rastreio novo em paralelo, conciliação e só então a troca.

## Etapa 8 — Testar rastreio e eventos

1. `npm run setup -- verify --app-url https://painel.seudominio.com.br --workspace <ID_DO_PAINEL>`: tudo ✅.
2. **Preview e debug** → cole a URL da página → **Abrir site em preview**. Na aba **Web** devem aparecer *Snippet carregado*, *PageView* e, ao clicar no botão de compra, *InitiateCheckout* com o link decorado. Na aba **Servidor**, os `/collect` e a CAPI disparada.
3. No Gerenciador de Eventos do Meta, em **Eventos de teste**, PageView e InitiateCheckout chegam do navegador e do servidor, deduplicados.
4. **Venda de teste**: compra de teste ou reenvio do webhook pelo checkout, com o preview ligado. A venda aparece em **Vendas**, o webhook na aba **Servidor** e o **Purchase** nos Eventos de teste.
5. Notificação: ative no celular (Configurações → Notificações) e use **Enviar teste para os outros aparelhos** pelo computador.
6. Apague o código de teste do Meta ao terminar.

## Etapa 9 — Entrega

Resuma ao operador: endereço do painel, painéis criados, o que foi testado, o que ficou pendente e onde está cada coisa. Lembre:

- `.setup/` guarda segredos: não compartilhe e não suba para o Git. Guarde uma cópia num cofre de senhas.
- **Atualizar o Dash.zip:** `git pull upstream main`, aplicar migrations novas com `npm run setup -- migration --file supabase/migrations/<arquivo>.sql` e `git push` (a Vercel publica sozinha).
- Problemas comuns: [guia manual → Problemas comuns](docs/instalacao/manual.md#problemas-comuns).
