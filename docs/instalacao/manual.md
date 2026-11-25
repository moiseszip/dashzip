# Instalação manual

Prefira instalar com um agente de IA seguindo o [INSTALL.md](../../INSTALL.md): ele cria tudo e testa no fim. Este guia é o mesmo caminho feito à mão, tela por tela.

## Passo a passo

**Leva uns 30 minutos, em 5 etapas.** Você precisa de conta no [Supabase](https://supabase.com), no [GitHub](https://github.com) e na [Vercel](https://vercel.com) (as três grátis), e acesso ao DNS do domínio do site.

| Etapa | Onde | O que sai dela |
|---|---|---|
| [1. Banco de dados](#etapa-1--banco-de-dados-supabase) | Supabase | o banco pronto e 3 chaves copiadas |
| [2. Código no GitHub](#etapa-2--código-no-github) | GitHub | o repositório com o código |
| [3. Publicar](#etapa-3--publicar-vercel) | Vercel | o painel no ar |
| [4. Seu domínio](#etapa-4--seu-domínio) | Vercel + DNS | `painel.seudominio.com.br` servindo painel, rastreio e webhooks |
| [5. Agendamentos e avisos](#etapa-5--agendamentos-e-avisos) | Supabase | regras automáticas, notificações de venda e reenvio ao Meta funcionando |

---

## Etapa 1 — Banco de dados (Supabase)

**1.1 Criar o projeto.** Em [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Região **South America (São Paulo)**. Guarde a senha do banco em algum lugar.

**1.2 Rodar o SQL inteiro.** No menu lateral, **SQL Editor** → **New query**. Abra o arquivo

```
supabase/schema_completo.sql
```

copie **tudo** (Ctrl+A, Ctrl+C), cole no editor e clique **Run**. Espere o `Success`. É uma vez só, num projeto novo e vazio — o arquivo cria as tabelas, as regras de acesso e as rotinas de limpeza.

> Deu erro porque o banco já tinha algo? O arquivo é para projeto vazio: crie um projeto novo no Supabase e rode nele.

**1.3 Fechar o cadastro.** **Authentication** → **Sign In / Providers** → **Email**: desligue **Allow new users to sign up** e salve. Só quem você criar consegue entrar.

**1.4 Criar o seu usuário.** **Authentication** → **Users** → **Add user** → **Create new user**: seu e-mail, uma senha, e **Auto Confirm User** marcado.

**1.5 Copiar as chaves.** **Project Settings** (engrenagem) → **API Keys** → aba **Legacy API Keys**, e **Data API** para a URL:

| No Supabase | Copie para a variável |
|---|---|
| Project URL (`https://xxxx.supabase.co`) | `SUPABASE_URL` |
| `anon` `public` | `SUPABASE_ANON_KEY` |
| `service_role` (clique em **Reveal**) | `SUPABASE_SERVICE_ROLE_KEY` |

Deixe as três num bloco de notas, neste formato — é o que você vai colar na Vercel na Etapa 3:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ADMIN_EMAILS=seu@email.com
APP_URL=https://painel.seudominio.com.br
CRON_SECRET=<valor aleatório>
ENCRYPTION_KEY=<valor aleatório>
```

- `ADMIN_EMAILS` é o e-mail do usuário que você criou no 1.4. Quem estiver nela cria os outros usuários pelo próprio painel.
- `APP_URL` é o endereço final do painel (Etapa 4). Passkeys e o retorno da conexão Wiapy usam esse endereço.
- `CRON_SECRET` e `ENCRYPTION_KEY`: gere cada um com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Não troque a `ENCRYPTION_KEY` depois de salvar tokens.

> A `service_role` abre o banco inteiro. Ela vai **só** na Vercel — nunca no código, nunca num arquivo que vá para o GitHub, nunca com prefixo `VITE_`.

---

## Etapa 2 — Código no GitHub

**2.1 Criar o repositório.** Em [github.com/new](https://github.com/new): um nome (ex.: `painel-tracking`), **Private**, e **nada** marcado embaixo (sem README, sem .gitignore). **Create repository.** Copie a URL que aparece, `https://github.com/SEU-USUARIO/painel-tracking.git`.

**2.2 Enviar o código.** Num terminal, clone o Dash.zip e envie para o seu repositório, trocando a URL pela sua:

```bash
git clone https://github.com/moiseszip/dashzip.git painel-tracking
cd painel-tracking
git remote rename origin upstream
git remote add origin https://github.com/SEU-USUARIO/painel-tracking.git
git push -u origin main
```

O `upstream` aponta para o Dash.zip: `git pull upstream main` traz as atualizações. Os arquivos de senha (`.env*`, `.setup/`) nunca sobem: o `.gitignore` já barra.

Atualizar depois é só `git add -A`, `git commit -m "..."` e `git push`: a Vercel publica sozinha a cada push.

---

## Etapa 3 — Publicar (Vercel)

**3.1 Importar.** Em [vercel.com/new](https://vercel.com/new) → **Import** no repositório da Etapa 2 (na primeira vez, autorize a Vercel a ver seus repositórios do GitHub).

**3.2 Não mexa em Framework, Build nem Output.** O `vercel.json` do projeto já define tudo, inclusive a região São Paulo.

**3.3 Variáveis.** Abra **Environment Variables** e cole o bloco da Etapa 1.5 inteiro no primeiro campo — a Vercel separa as variáveis sozinha.

**3.4 Deploy.** Clique **Deploy** e espere uns 3 minutos. Para conferir, abra

```
https://SEU-PROJETO.vercel.app/health
```

Tem que aparecer `"status":"ok"`. Se aparecer `degraded`, alguma chave do Supabase está errada: corrija em **Settings → Environment Variables** e faça **Redeploy** (aba Deployments → ⋯ → Redeploy).

---

## Etapa 4 — Seu domínio

O **único** ponto de DNS. Um subdomínio aponta para a Vercel e passa a servir o painel, o código de rastreio e os webhooks dos checkouts. Isso é o que deixa o rastreio *first-party*: as requisições saem do domínio do próprio site, com o IP real do visitante, e bloqueador de anúncio não barra.

Use um subdomínio **do mesmo domínio da página de vendas**. Página em `seudominio.com.br` → `painel.seudominio.com.br`.

**4.1 Na Vercel.** Projeto → **Settings** → **Domains** → digite `painel.seudominio.com.br` → **Add**.

**4.2 No DNS.** Onde o domínio é gerenciado (Registro.br, Cloudflare, Hostinger, GoDaddy…), crie:

| Tipo | Nome | Valor |
|---|---|---|
| `CNAME` | `painel` | `cname.vercel-dns.com` |

No **Cloudflare**, deixe a nuvem **cinza** (*DNS only*). Com a nuvem laranja a Vercel não emite o certificado.

**4.3 Esperar.** Em alguns minutos a Vercel mostra **Valid Configuration** ao lado do domínio.

**4.4 Avisar o Supabase.** **Authentication** → **URL Configuration**:
- **Site URL:** `https://painel.seudominio.com.br`
- **Redirect URLs** → **Add URL:** `https://painel.seudominio.com.br/**`

É o que faz o link de "esqueci minha senha" voltar para o painel certo.

**4.5 Pronto.** Entre em `https://painel.seudominio.com.br` com o usuário da Etapa 1.4 e use sempre esse endereço. Em **Integrações**, o código de rastreio e as URLs de webhook já saem com o seu domínio — não há mais nada de domínio para configurar.

---

## Etapa 5 — Agendamentos e avisos

As regras automáticas, as notificações de venda e o reenvio ao Meta rodam por agendamentos do banco (pg_cron), que chamam o painel com um segredo. No **SQL Editor** do Supabase, rode trocando os valores:

```sql
select vault.create_secret('https://painel.seudominio.com.br/api/rules-cron/tick', 'dash_rules_cron_url');
select vault.create_secret('<o mesmo CRON_SECRET da Vercel>', 'dash_cron_secret');
select vault.create_secret('{"publicKey":"<VAPID público>","privateKey":"<VAPID privado>","subject":"mailto:seu@email.com"}', 'dash_sales_web_push_vapid');
```

As chaves VAPID das notificações saem de `npx web-push generate-vapid-keys`. Para conferir, rode `select public.dashzip_setup_status();`: `cron_url`, `cron_secret` e `web_push_keys` precisam vir `true`.

> O assistente `npm run setup` faz esta etapa sozinho (comandos `secrets` e `vault`). Veja o [INSTALL.md](../../INSTALL.md).

---

## Usar no iPhone

Abra seu painel publicado no Safari e use **Compartilhar → Adicionar à Tela de Início**. O ícone dá acesso ao mesmo dashboard, com as integrações da sua instância. Veja o [passo a passo para instalar e testar no iPhone](../features/31-mobile/mobile.md#7-instalação-no-iphone).

## Depois de entrar

Em **Configurações → Painéis**, **Novo painel** cria uma operação. Um painel reúne várias páginas, produtos e checkouts com seu próprio snippet, Pixel e Preview.

### Integrações

Tudo pela tela, nesta ordem:

1. **API de Conversões do Meta** — ID do pixel e token de acesso. Para conferir no Meta, preencha o código de teste e veja os eventos em *Eventos de teste* no Gerenciador de Eventos; apague o código depois.
2. **Checkout e rastreio** — um passo a passo só, no mesmo card:
   1. **Escolha seu checkout** — a plataforma onde você vende.
   2. **Domínio first-party** — aberto pelo seu domínio (Etapa 4), já vem pronto.
   3. **Código da página** — copie para antes do `</body>` da página de vendas.
   4. **Criar o webhook** — o botão abre o checkout escolhido; cole a URL e o token na plataforma, como a tela mostra.
   5. **Padrão de UTM** — cole no campo *Parâmetros de URL* de cada anúncio.

### Preview e debug

1. Cole a URL da página de vendas e clique **Abrir site em preview**. O site abre numa aba nova com `?stl_debug=…` e um selo "Preview" no canto; o modo vale para as próximas páginas do site por 1 hora (o `×` do selo sai dele).
2. **Web** mostra o que o navegador fez, página a página: *Snippet carregado* (visitante, sessão, fbp/fbc e de onde vieram, UTMs, indexador), *PageView* e *InitiateCheckout* com as tags (pixel no navegador e envio ao servidor), os links de checkout decorados, os `dataLayer.push` da página e os avisos (pixel bloqueado, página sem link de checkout, pixel colado à mão).
3. **Servidor** mostra cada requisição que chegou enquanto o preview está ligado — os `/collect` do snippet e **todos** os webhooks do checkout, inclusive os recusados. Em cada uma: *Tags* (Meta CAPI disparada, com falha ou não disparada, e por quê), *Request* (query, corpo e headers, com tokens mascarados), *Variáveis* (o visitante, a venda que o processor entendeu, a visita casada e o `user_data` campo a campo: original, normalizado e o hash enviado), *HTTP de saída* (o corpo mandado ao Graph e a resposta do Meta) e *Console*.
4. Para depurar uma venda, faça um pedido de teste (ou reenvie o webhook pelo painel do checkout) com o preview ligado. "Ligar só o servidor" serve para isso sem abrir o site.

O preview liga por 60 minutos e se renova enquanto a tela está aberta. Fora dele nada é gravado; o que foi gravado some em 24 horas.

---

## Opcionais

Variáveis que você pode acrescentar na Vercel depois (Settings → Environment Variables, e Redeploy):

| Variável | Para quê |
|---|---|
| `PASSKEY_RP_ID` / `PASSKEY_ORIGINS` | Para a mesma passkey valer em mais de um subdomínio: `PASSKEY_RP_ID=seudominio.com.br` e `PASSKEY_ORIGINS=https://outro.seudominio.com.br`. |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | Alternativa ao Vault para as chaves das notificações de venda. |
| `META_API_VERSION` | Versão da Graph API do Meta (API de Conversões). Padrão: `v25.0`. Só preencha para usar outra. |

---

## Mudou o banco?

O banco inteiro está num arquivo só, `supabase/schema_completo.sql`. Mudança no banco entra direto nele, no fim ou junto da tabela que muda.

Quem já tem o painel no ar não roda o arquivo de novo (ele é para banco vazio): roda só a migration nova, pelo SQL Editor ou com `npm run setup -- migration --file supabase/migrations/<arquivo>.sql`. Por isso, escreva o trecho novo de forma que rode em banco existente (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`…).

Depois, `git push` para a Vercel publicar o código novo.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Tela branca ao abrir o painel | `SUPABASE_URL` ou `SUPABASE_ANON_KEY` ausente na Vercel. Cadastre e faça **Redeploy** — elas entram no build. |
| `/health` responde `degraded` | `SUPABASE_SERVICE_ROLE_KEY` errada, ou o SQL da Etapa 1.2 não rodou. |
| Login diz credencial inválida | Usuário criado sem **Auto Confirm User**. Recrie com a opção marcada. |
| Não aparece a aba de criar usuários | Seu e-mail não está em `ADMIN_EMAILS`. |
| Notificações de venda ou regras não disparam | Etapa 5 pendente: confira `select public.dashzip_setup_status();`. |
| Passkey diz que só funciona no endereço oficial | `APP_URL` ausente ou diferente do endereço aberto. |
| Domínio fica em *Invalid Configuration* | CNAME com nome ou valor errado, ou nuvem laranja no Cloudflare. |
| "Esqueci minha senha" leva para outro endereço | Etapa 4.4 pendente. |
| Selo do preview diz "preview encerrado" | O preview foi desligado ou expirou. Clique **Abrir site em preview** de novo. |
| Selo do preview não aparece | O snippet não está na página, ou o Do Not Track do navegador está ligado (o snippet não roda com ele). |
| Aba Servidor vazia com o selo "conectado" | O `/collect` sai por `sendBeacon`; bloqueador de anúncio barra quando o snippet não está no seu subdomínio (Etapa 4). |

---

