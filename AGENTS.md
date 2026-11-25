# Dash.zip

O Dash.zip reúne tracking first-party, vendas, mídia, análise de funil e avisos de venda num painel por oferta. É um produto plug and play: cada operador implanta a própria instância (GitHub, Vercel, Supabase e domínio dele). Leia o [README](README.md) e o [índice de funcionalidades](docs/features/README.md) antes de alterar uma área.

**Pediram para instalar ou configurar o Dash.zip?** Siga o [INSTALL.md](INSTALL.md), começando pela skill de onboarding em [`.claude/skills/dashzip-onboarding/SKILL.md`](.claude/skills/dashzip-onboarding/SKILL.md) (agentes sem suporte a skills: abra o arquivo e siga as instruções).

**Contexto da instância.** Se existir `AGENTS.local.md` na raiz, leia antes de editar: ele traz o domínio, o projeto da Vercel e os combinados daquela instalação.

## Git e ambientes

- `origin` é o repositório privado da instância; `upstream` é o Dash.zip (`moiseszip/dashzip`), de onde vêm as atualizações (`git pull upstream main`).
- A Vercel publica a partir da `main` de `origin`. Salvar código no Git e publicar em produção são etapas distintas.
- Antes de editar, confira `git status -sb`, atualize as referências com `git fetch origin` e veja o que já existe em `origin/main`. Se outra sessão estiver trabalhando no projeto, registre quais arquivos ela alterou e isole sua frente em uma branch ou worktree.
- Use `.env.example` como referência. Chaves ficam na Vercel e em `.setup/` (fora do Git). Para mudanças de banco, crie a migration em `supabase/migrations/` e acrescente o mesmo trecho ao fim de `supabase/schema_completo.sql`.
- Nada específico de uma instância (domínio, IDs, nomes de ofertas, e-mails) entra no código: use variáveis de ambiente (`APP_URL`, `PASSKEY_*`, `VSL_*`) ou dados do banco.

## Onde alterar

| Pedido | Ponto de entrada |
| --- | --- |
| Rotas e loading | `packages/frontend/src/App.tsx`, `components/DashboardLayout.tsx` (`AppShell`, layout montado uma vez) e `components/RouteFallback.tsx`. O spinner central de `RouteFallback` é compartilhado pela troca de rota, autenticação e carga inicial de Resultado, Campanhas, Vendas e webhooks, e só aparece após ~150 ms. Chaves e buscas das telas principais ficam em `lib/pageQueries.ts`, usadas também para buscar os dados antes do toque no menu. |
| Menu e navegação no celular | `components/Sidebar.tsx`, `DashboardLayout.tsx` e `BottomNav.tsx`. Integrações fica em **Tracking** e continua na rota `/integrations`. |
| Resultado, Campanhas e Vendas | `packages/frontend/src/pages` e os módulos correspondentes em `packages/backend/src/modules`. Resultado usa a rota `/finance`. |
| Integrações, tracking e Purchase | Frontend `pages/Integrations.tsx`. No menu, abra **Tracking → Integrações**. Backend `integrations`, `webhooks`, `sales`, `tracking`, `meta-capi` e `wiapy`. Preserve atribuição, deduplicação e isolamento por painel. |
| Notificações | Frontend `pages/Settings.tsx`, `components/settings/SalesNotificationsCard.tsx` e `public/sales-push-sw.js`. Backend `modules/sales-push` e migrations de Web Push. |
| iPhone | [App web instalado pelo Safari](docs/features/31-mobile/mobile.md), com o ícone padrão do app. O aviso de venda usa o som padrão do iOS (Web Push não aceita som próprio). |
| Instalação e onboarding | `INSTALL.md`, `.claude/skills/dashzip-onboarding/`, `scripts/setup/dashzip-setup.mjs` (`npm run setup`) e `docs/instalacao/`. O tutorial do primeiro acesso é `components/WelcomeTour.tsx`. |

Os caminhos `components` e `pages` da tabela são relativos a `packages/frontend/src`, salvo quando já vêm completos.

## Validação

- Frontend: `npm run typecheck -w @dashzip/frontend` e `npm test -w @dashzip/frontend`. Verifique desktop e celular se mexer na interface.
- Backend: `npm test -w @dashzip/backend -- --runInBand`. Webhooks e segurança exigem verificar o fluxo afetado.
- Rode `npm run build` antes de publicar. Registre o que foi testado e o que ainda requer um iPhone físico ou dados de produção.
