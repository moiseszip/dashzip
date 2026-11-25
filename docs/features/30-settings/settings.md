# Configurações: senha, dois fatores, passkeys e fuso horário

> **Módulos:** `packages/frontend/src/components/settings/` (PasswordCard, TwoFactorCard, PasskeysCard, TimezoneCard), `src/lib/password.ts`, `src/lib/mfa.ts`, `src/lib/passkeys.ts`, `src/lib/timezone.ts`, `src/contexts/AuthContext.tsx`, `src/pages/Login.tsx` | `packages/backend/src/shared/helpers/timezone.ts`, `src/shared/services/workspace-timezone.service.ts`, `src/common/guards/auth.guard.ts`, `src/modules/passkeys/`
> **Migrations:** [20261123010000_workspace_timezone.sql](../../../supabase/migrations/20261123010000_workspace_timezone.sql), [20261123200000_passkeys.sql](../../../supabase/migrations/20261123200000_passkeys.sql)
> **Última atualização:** 2026-11-23 (passkeys)
> **Status:** Aprovado

---

## 1. Propósito

Três ajustes de conta e de painel em Configurações:

- **Conta > Senha:** trocar a senha logado, confirmando a atual.
- **Conta > Autenticação em dois fatores:** app autenticador (TOTP) e passkeys no mesmo card.
- **Conta > Passkeys:** segundo fator com Face ID, Touch ID, Windows Hello ou chave de segurança (seção 3.7). Convive com o TOTP.
- **Painéis > Fuso horário:** cada painel escolhe o fuso que decide o que é "hoje", "ontem" e "este mês" e onde cada dia começa e termina, nas telas e no backend.
- **Usuários:** administradores abrem o formulário em **Adicionar usuário**. A lista exibe **Admin** quando o e-mail da conta no Auth pertence a `ADMIN_EMAILS` e **Usuário** para as demais contas.

A doc antiga de Configurações ([10-settings](../10-settings/settings.md)) descreve a versão com plano e cobrança, que saiu do produto.

## 2. Senha

1. Campos: **Senha atual**, **Nova senha**, **Repita a nova senha** (com olho para mostrar).
2. Regras (`lib/password.ts`):
   - bloqueiam: senha atual vazia, nova com menos de **8** caracteres, espaço no começo ou no fim, igual à atual, confirmação diferente;
   - só avisam: força (barra de 4 passos: Fraca, Razoável, Forte). Senha comum (`12345678`, `senha123`…), sequência ou com o nome do e-mail fica "Fraca". Dá para salvar, com o aviso "é fácil de adivinhar".
3. Ao salvar, `AuthContext.changePassword`:
   - confere a senha atual com `signInWithPassword` num **cliente Supabase descartável** (`createIsolatedAuthClient`, sessão só em memória). Reautenticar no cliente principal trocaria a sessão do painel e derrubaria o nível aal2 de quem usa dois fatores;
   - grava com `supabase.auth.updateUser({ password })` na sessão do painel;
   - se o projeto pedir reautenticação recente ("Secure password change"), tenta de novo pela sessão recém-aberta, mas só quando não há dois fatores;
   - encerra a sessão de conferência com `signOut({ scope: 'local' })`, sem mexer nas outras.
4. Mensagens: "A senha atual está incorreta.", "A nova senha precisa ser diferente da atual.", senha fraca recusada pelo Supabase, limite de tentativas e reautenticação.
5. Link **Esqueci a senha atual** leva para `/forgot-password`. Esse fluxo manda o e-mail com `resetPasswordForEmail` e volta para `/reset-password`. O link precisa estar na lista de URLs de redirecionamento do Supabase Auth. Quem tem dois fatores digita o código do app nessa tela antes de salvar, porque a sessão do link é aal1. Mínimo de 8 caracteres também ali.

## 3. Autenticação em dois fatores (TOTP)

Usa o MFA nativo do Supabase Auth (`supabase.auth.mfa`). Funções em `lib/mfa.ts`, testadas com mock.

### 3.1 Ativar

1. **Ativar** apaga tentativas anteriores não confirmadas (`unenroll` dos fatores `unverified`) e chama `mfa.enroll({ factorType: 'totp', issuer: 'dash.zip' })`.
2. A tela mostra o **QR code** e a **chave** em grupos de 4, com botão de copiar. O supabase-js devolve o SVG cru num data URI; `svgDataUri` recodifica para o `#` de cor não quebrar a imagem.
3. A pessoa digita o primeiro código: `mfa.challengeAndVerify`. O fator vira `verified` e a sessão sobe para **aal2**. **Cancelar** apaga o fator não confirmado.

### 3.2 Login

1. Depois da senha, `getAuthenticatorAssuranceLevel()`: com `nextLevel = aal2` e `currentLevel = aal1`, o formulário vira **Verificação em duas etapas** (código de 6 dígitos, `autocomplete="one-time-code"`).
2. O código válido sobe a sessão para aal2 e invalida as consultas que levaram 401 antes disso. **Entrar com outra conta** encerra a sessão.
3. `ProtectedRoute` manda de volta para `/login` qualquer sessão aal1 de quem tem fator verificado (F5, link direto). A lista de painéis só é buscada depois do código.

### 3.3 Desativar

**Desativar** abre um diálogo que pede um código válido (`challengeAndVerify`) antes do `unenroll`. Depois, `refreshSession` pega um token sem o fator.

### 3.4 Backend

`AuthGuard` valida o token no Supabase (`auth.getUser`) e, se o usuário tem fator `verified`, **recusa token aal1** com 401 "Confirme o código de dois fatores para continuar." Sem fator, nada muda. Quem ativa já sai da tela com sessão aal2. No dia da entrega nenhum usuário de produção tinha fator, então ninguém ficou trancado do lado de fora.

### 3.5 Supabase

O TOTP vem ligado por padrão nos projetos Supabase (Authentication > Multi-Factor > TOTP: *Enabled*). Se estiver desligado, o **Ativar** mostra "A autenticação em dois fatores está desligada no Supabase deste projeto." Para ligar: Dashboard do Supabase > Authentication > Sign In / Providers > **Multi-Factor Authentication** > TOTP = Enabled (ou `mfa_totp_enroll_enabled` e `mfa_totp_verify_enabled` = true na Management API).

### 3.6 Modo streaming

E-mail da conta mascarado (também no campo oculto do gerenciador de senhas). QR code trocado por "QR code oculto no modo streaming." Chave TOTP vira `•••••`. O botão de copiar continua funcionando.

### 3.7 Passkeys (WebAuthn)

**Por que no backend.** O SDK do Supabase (`@supabase/auth-js` 2.112.3) já tem `factorType: 'webauthn'`, mas o projeto hospedado recusa ligar: `PATCH /v1/projects/<ref>/config/auth` com `mfa_web_authn_enroll_enabled` devolve "Enabling of MFA with WebAuthn not currently supported" (23/11/2026; a config ficou como estava). A doc oficial de MFA só lista TOTP e telefone, e as "Passkeys (Beta)" do Supabase são login sem senha (primeiro fator), não segundo fator. Por isso a cerimônia é do backend Nest com `@simplewebauthn/server` 14.0.3 e `@simplewebauthn/browser` 14.0.0 (versões fixas).

**Tabelas** (migration aditiva `20261123200000_passkeys.sql`, aplicada em produção em 23/11/2026; RLS ligada, só o `service_role` escreve, quem está logado lê as próprias linhas):

| Tabela | O que guarda |
|---|---|
| `webauthn_credentials` | id da credencial, chave pública (base64url), contador, transports, tipo (single/multiDevice), backup, nome, criação e último uso |
| `webauthn_challenges` | desafio de uso único (5 min) amarrado ao usuário, à sessão do Supabase, ao tipo, ao rpID e à origem; `used_at` e `succeeded` servem ao limite de tentativas |
| `mfa_session_elevations` | sessão do Supabase (`auth.sessions.id`, `ON DELETE CASCADE`) que já confirmou a passkey |

Função `passkey_session_state(user, session)`: tem passkey? a sessão está elevada? Só `service_role` executa.

**Rotas** (`/api/passkeys`):

| Rota | Guard | Uso |
|---|---|---|
| `GET /status` | `SessionGuard` (só senha) | `{ hasPasskeys, elevated }` para o login e o `ProtectedRoute` |
| `POST /authentication/options` e `/verify` | `SessionGuard` | segundo fator do login; assinatura válida eleva a sessão |
| `GET /` | `AuthGuard` | lista (nome, criação, último uso) |
| `POST /registration/options` e `/verify` | `AuthGuard` | cadastra com nome; eleva a sessão que cadastrou (como o TOTP sobe para aal2 ao ativar) |
| `POST /:id/remove` | `AuthGuard` | remove; se for o último segundo fator (nenhuma outra passkey e nenhum TOTP), exige `{ challengeId, response }` de uma assinatura feita agora |

**Elevação da sessão (equivalente ao aal2).** O Supabase não deixa o backend subir o token para aal2, então a sessão elevada fica em `mfa_session_elevations`, pela claim `session_id` do JWT (estável entre refreshes). Logout ou revogação apaga a sessão em `auth.sessions` e, em cascata, a elevação: não existe atalho para reaproveitar em outro login. O `AuthGuard` passa quando o token é aal2 (TOTP) **ou** a sessão está elevada; recusa aal1 de quem tem TOTP verificado **ou** passkey, com "Confirme o código de dois fatores para continuar." Se a consulta ao banco falhar, devolve 503 (fecha). Token sem `session_id` só sai de quem tem o segredo JWT (que já poderia assinar aal2); para ele vale só a regra do TOTP.

**Domínio.** A origem é o `APP_URL` da instância e o `rpID` é o host dele. Para a mesma passkey valer em mais de um subdomínio, `PASSKEY_RP_ID` define o domínio-pai e `PASSKEY_ORIGINS` as outras origens. Sem `APP_URL`, as passkeys ficam indisponíveis em produção. Fora da Vercel (`VERCEL` ≠ `1`) também aceita `http://localhost:<porta>` com rpID `localhost`, para dev. A origem e o rpID esperados ficam gravados no desafio e a verificação confere os dois.

**Opções do autenticador.** `residentKey: preferred`, `userVerification: preferred`, sem forçar tipo (plataforma ou chave), `attestation: none`, tempo de 2 min. Face ID/Touch ID (iPhone, iPad, Mac), Windows Hello, Android (Chrome/Google Password Manager), celular por QR e chave de segurança.

**Segurança.**
- Desafio de uso único: um `UPDATE … WHERE used_at IS NULL AND expires_at > now()` marca e devolve; só a mesma sessão responde.
- Contador: a biblioteca recusa contador que volta (credencial clonada); o novo valor é gravado.
- Limite: 10 cerimônias por minuto por IP (`@Throttle`) e, por conta, 5 respostas erradas ou 30 desafios em 15 minutos → 429 "Muitas tentativas com passkey. Espere 15 minutos ou use o código do app."
- Nada é logado: desafio, credencial, chave e token não vão para console nem para mensagem de erro (erros de banco só levam o código).

**Tela: Configurações > Conta > Autenticação em dois fatores > Passkeys** (`PasskeysCard`).
- Mostra se o navegador tem `PublicKeyCredential` ("Este navegador suporta passkey." ou "não suporta"; sem suporte, o botão fica desativado).
- **Adicionar passkey:** diálogo com o nome do dispositivo (sugestão pelo aparelho: iPhone, Mac, Android, Windows) e **Criar passkey**.
- Lista com nome, "Criada em" e "usada em". Lixeira abre a confirmação; se for o último segundo fator, o botão vira **Confirmar com passkey e remover**.
- O card do TOTP avisa, ao desativar, se a passkey continua valendo.

**Login.** Com qualquer segundo fator ativo, depois da senha aparece **Verificação em duas etapas**. Com passkey, o padrão é o botão grande **Usar passkey** (56 px); com TOTP também, o link **Usar código** troca (e **Usar passkey** volta). Navegador sem suporte abre direto no código. Mensagens: cancelado ("Confirmação cancelada. Toque no botão para tentar de novo."), tempo esgotado, sem suporte, passkey já cadastrada, domínio errado, limite e desafio expirado.

**iPhone (Safari e app da tela inicial).** O Safari só abre o Face ID se o navegador for chamado logo depois do toque. Por isso o desafio é buscado **antes** do toque: ao abrir o passo do login, ao abrir o diálogo de cadastro e ao abrir a confirmação de remoção (vale 4 min no cliente, 5 no servidor; vencido, busca outro). No toque, `startAuthentication`/`startRegistration` roda direto. O app da tela inicial usa a mesma origem do painel, então as mesmas passkeys valem nos dois.

**Frontend.** `secondFactorState` (`lib/mfa.ts`) junta o AAL do Supabase e o `/passkeys/status`: pede o segundo fator se há TOTP ou passkey e a sessão não é aal2 nem elevada; se o backend não responder, decide só pelo TOTP (o backend continua recusando). `api.ts` dispara `dashzip:mfa-required` quando o backend responde 401 com a mensagem do segundo fator, e o `AuthContext` relê o estado (volta ao login).

**Limitações conhecidas.**
- Quem tem TOTP e entrou com passkey continua aal1 para o Supabase: ações que o próprio Supabase protege com aal2 (trocar a senha) pedem o código do app.
- Passkey criada em `localhost` não vale em produção (rpID diferente), e vice-versa.
- Recuperação: sem passkey e sem TOTP à mão, o acesso volta apagando as linhas de `webauthn_credentials` do usuário pelo SQL Editor (só quem administra o Supabase).

## 4. Fuso horário do painel

### 4.1 Persistência

`workspaces.timezone text not null default 'America/Sao_Paulo'` (migration aditiva, aplicada em produção em 23/11/2026). `GET /api/workspaces` devolve o campo; `PATCH /api/workspaces/:id` aceita `{ timezone }` (e/ou `{ name }`) e recusa fuso que o `Intl` não conhece. O backend lê o fuso por `WorkspaceTimezoneService` (cache de 60 s, limpo ao salvar). Fuso ausente ou inválido cai em São Paulo.

### 4.2 Tela

Em **Configurações > Painéis**, use **Novo painel** para abrir o formulário de nome e emoji opcional. A criação grava ambos em `POST /api/workspaces` e seleciona o painel criado.

O card **Fuso horário** mostra o fuso, o deslocamento e a hora local do painel ativo. Toque na linha do fuso atual para abrir os mais usados e buscar na lista IANA por ID, nome ou deslocamento. **Salvar fuso** confirma a escolha.

### 4.3 Helpers

| Onde | Função | Uso |
|---|---|---|
| backend `shared/helpers/timezone.ts` | `dayInTimezone`, `hourInTimezone`, `weekdayInTimezone` | dia, hora e dia da semana de um instante no fuso |
| | `dayStartUtc(day, tz)`, `dayRangeUtc(since, until, tz)` | limites UTC do dia local (fim exclusivo). Respeita horário de verão: dia de 23 h ou 25 h, meia-noite que não existe |
| frontend `lib/timezone.ts` | `dayInTimezone`, `dayInPanel()`, `getActiveTimezone()` | "hoje" do painel ativo. `WorkspaceContext` atualiza o fuso ativo e o guarda no `localStorage` por painel, para o primeiro render já saber o "hoje" antes da lista chegar |

Para São Paulo, o resultado é idêntico ao corte fixo antigo (`T03:00:00Z`).

### 4.4 Onde o fuso vale

| Tela / rotina | O que segue o fuso do painel |
|---|---|
| Seletores de data (Resultado, Campanhas, Testes, Vendas) | "Hoje", "Ontem", "Últimos N dias", "Este mês", "Mês passado" (`resultPresetRange` usa `dayInPanel`) |
| Resultado (`summary`) | período padrão e limite de futuro, corte das vendas e das sessões, dia/hora/dia da semana dos gráficos, dia da cotação |
| Campanhas e Acompanhamento de testes | período, corte das vendas, dia de cada pedido na matriz campanha × dia, cache de "período aberto", início do log de atividades |
| Vendas | intervalo do seletor, "hoje" do período rápido, dia da cotação |
| Regras automáticas | janela (hoje, ontem, N dias), faixa de horas, horário diário e "execuções hoje" (`isDue` com o fuso de cada painel no tique do pg_cron) |
| Resumo financeiro (`finance/overview`) e VSL | "hoje" e corte do período |
| Custos > Despesas | data padrão de uma despesa nova |
| Datas e horas exibidas | criação na Meta (Campanhas), última execução (Regras), últimas mudanças (Testes) |

### 4.5 O que não é convertido (de propósito)

- **Gasto e entrega da Meta** (Insights por dia, `date_start`, gasto por hora `hourly_stats_aggregated_by_advertiser_time_zone`): a Meta já entrega no fuso de cada conta de anúncio. O painel pede o mesmo intervalo de dias e não reconverte. Se o fuso do painel for diferente do da conta, o dia do gasto (fuso da conta) e o dia da venda (fuso do painel) podem não bater nas bordas.
- **Datas que os checkouts mandam sem fuso** (Payt, Ticto, Kiwify, PerfectPay, Cartpanda, Lastlink): continuam lidas como `-03:00`, porque é o horário em que a plataforma as emite, não o do painel.
- **Cotação dentro da atribuição por campanha** (`revenueOf` em `campaign-attribution.ts`): o dia do PTAX segue São Paulo. A diferença só aparece em pedido em dólar perto da meia-noite.
- `dayInSaoPaulo` continua exportado (frontend `lib/costs.ts`, backend `finance-totals.ts`) para quem ainda precisa de São Paulo explícito.

## 5. Testes

- Backend `shared/helpers/__tests__/timezone.spec.ts`: virada de dia em São Paulo, Manaus, Lisboa e UTC; horário de verão de Nova York (dia de 23 h e de 25 h) e Lisboa; meia-noite inexistente no horário de verão antigo do Brasil (2018/2019); Vendas, regra diária e gráficos do Resultado no fuso; claim `aal` e regra aal2 do `AuthGuard`.
- Frontend `lib/timezone.test.ts`, `lib/password.test.ts`, `lib/mfa.test.ts` (enroll, verify, login, unenroll com mock), `components/settings/securityCards.render.test.tsx` (modo streaming esconde e-mail, QR e chave; ativação; validação da troca de senha).
- Backend `modules/passkeys/__tests__/passkeys.service.spec.ts`: rpID/origem (localhost só fora da Vercel), nome, opções sem tipo de autenticador forçado, desafio de uso único, de outra sessão e expirado, credencial repetida (409), contador e elevação, credencial de outra conta, trava após 5 falhas (429), último fator exige confirmação, regra do `AuthGuard`/`SessionGuard` com passkey (elevada passa, aal2 não consulta o banco, erro fecha com 503).
- Frontend `lib/passkeys.test.ts` (`navigator.credentials` e `PublicKeyCredential` simulados: cadastro, login, cancelado, mensagens; `secondFactorState`), `components/settings/passkeysCard.render.test.tsx` (lista, suporte, adicionar, cancelado, remover o último com confirmação, remover com TOTP ativo), `pages/Login.passkey.test.tsx` (passkey padrão com desafio antes do toque, erro, troca para código, só TOTP, navegador sem suporte).
- Navegador com passkey (Playwright + autenticador virtual do Chrome via CDP `WebAuthn.addVirtualAuthenticator`, 1280 px e 390 px): mock do Auth e servidor com o `PasskeysService` e o `needsSecondFactor` reais compilados (criptografia real do `@simplewebauthn/server`), rpID `localhost`. Cadastro, logout, login pede passkey, F5 em `/finance` volta ao login, API recusa (401) antes e aceita (200) depois com o mesmo token, cancelamento com mensagem, remoção do último fator confirmada com a passkey.
- Navegador (Playwright, Vite local com Auth e API simulados): troca de senha com a atual errada e certa; ativar com código errado e certo; F5 com sessão aal1 volta ao login; login com código; desativar; fuso salvo e "hoje" em Lisboa; 390 px; tema claro e escuro; modo streaming.

## Emoji do painel (23/11/2026)

- Em **Configurações → Painéis**, o botão à esquerda do nome abre o seletor completo (`emoji-picker-react` 4.12.0, carregado só ao abrir): todas as categorias, busca, tons de pele e recentes; "Tirar o emoji" volta ao padrão.
- O emoji aparece antes do nome no seletor de painel da barra lateral e, com o menu recolhido, no lugar do ícone de caixa.
- Banco: coluna `workspaces.emoji` (`20261123120000_workspace_emoji.sql`, aditiva, aplicada em produção). O backend aceita um único emoji (com tom de pele, ZWJ e bandeiras) ou vazio para tirar (`PATCH /workspaces/:id { emoji }`).
