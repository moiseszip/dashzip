# Celular primeiro (mobile) e velocidade

> **Modulo:** só frontend | **Pagina:** `packages/frontend/src/components/DashboardLayout.tsx`, `pages/Campaigns.tsx` e as demais telas
> **Ultima atualizacao:** 2026-11-24
> **Status:** Aprovado

---

## 1. Proposito

O operador gere as campanhas pelo celular. O painel precisa abrir rápido e ser
usável numa tela de ~390×844 com o dedo: pausar/ativar, mudar orçamento, descer
de campanha para conjunto e anúncio, ver resultado e vendas. É também a base do
app web instalável no iPhone.

## 2. Comportamento para o Usuario

### 2.1 Shell (todas as telas logadas)

| Largura | Navegação |
|---------|-----------|
| < 1024px (`lg`) | Topo fixo com a logo centralizada; **barra inferior** com **Painéis** (emoji do painel ativo; abre a lista de painéis de baixo para cima), Campanhas, Resultado, modo streaming e **Mais** (abre o menu em tela cheia, subindo de baixo; sem animação se o sistema pedir menos movimento). |
| ≥ 1024px | Menu lateral fixo, recolhível, como antes. Sem barra inferior. |

- O menu fecha no ✕, no Esc e ao escolher um destino. Enquanto está aberto,
  o conteúdo atrás fica fora da navegação por teclado e sem rolagem.
- Safe-area do iPhone: topo, barra inferior, menu e diálogos usam
  `env(safe-area-inset-*)` (`viewport-fit=cover` no `index.html`).
- Variáveis CSS: `--app-header-h` (altura do topo no celular, `0px` no `lg`) e
  `--app-bottom-nav-h`. Barra que gruda na tela usa
  `top-[var(--app-header-h)]`; elemento fixo acima da barra inferior usa
  `bottom-[calc(var(--app-bottom-nav-h)+…)]`.
- As telas logadas ficam dentro do `AppShell` (`components/DashboardLayout.tsx`):
  menu, topo e barra inferior são montados uma vez e só o conteúdo troca, com
  um fade de 180 ms (`animate-page-in`, só opacidade). Cada tela continua
  declarando `<DashboardLayout wide?>`; dentro do shell ele só repassa a largura.
- Enquanto o chunk de uma tela chega, a tela anterior continua visível (o React
  Router 7 navega em transição). O `RouteFallback` só aparece se a espera
  passar de ~150 ms (`animate-fallback-in`).

### 2.2 Campanhas no celular (< 768px)

1. Topo grudado: níveis (Contas, Campanhas, Conjuntos, Anúncios), data,
   **Filtros e ordem** (com contador) e atualizar. Abaixo, a busca.
2. **Card de totais** do filtro atual (gasto, vendas, lucro, ROI, margem, CPA).
3. **Um card por objeto** (`CampaignCard`):
   - caixa de seleção (alvo de 44px), nome (mascarável), status e ID;
   - switch ativar/pausar → abre a **mesma confirmação** da tabela (nada vai
     para a Meta sem confirmar);
   - gasto, vendas, lucro, ROI, margem, CPA, com lucro/margem pelo sinal e ROI
     em relação a 1 (verde/vermelho);
   - "Mais métricas" mostra as colunas visíveis da tabela que não estão no card;
   - botão de orçamento (quando o orçamento mora naquele nível), abrir no
     Gerenciador e **Conjuntos ›/Anúncios ›** para descer de nível.
4. Descer de nível volta a lista ao topo e mostra o filtro herdado como **chip**
   ("Campanha: X ✕"): tocar volta ao nível, ✕ tira o filtro.
5. Seleção abre a **barra fixa de lote** (Ativar / Pausar / limpar) acima da
   barra inferior, com a mesma confirmação do desktop.
6. A lista cresce com **Mostrar mais** (25 por vez), em vez de páginas.
7. Gaveta de filtros (bottom sheet): status, moeda (R$/US$) e ordenação
   (coluna + maior/menor primeiro). A ordem é a mesma salva no painel.
8. Orçamento (bottom sheet): teclado decimal, 16px no campo (sem zoom do iOS),
   atalhos −20% / −10% / +10% / +20% sobre o valor atual; aceita "50,5",
   "1.234,56" e "50.5".

No desktop (≥ 768px) a tabela continua igual: grade, colunas reordenáveis e
redimensionáveis, moeda e paginação.

### 2.3 Demais telas

- **Resultado**: filtros em grade de 2 colunas (data em largura total);
  números lado a lado e gráficos em largura total; esqueleto no carregamento.
- **Vendas, Mapa de calor**: `Segmented` com opções de 40px; busca de 40px.
- **Ao vivo**: sem rolagem horizontal (UTMs longas ficam cortadas dentro do card); números em 2 colunas.
- **Custos**: abas roláveis na horizontal.
- **Seletor de data**: no celular abre como bottom sheet, dias e pré-definidos
  com 44px.
- Tabelas (Acompanhamento de testes, Mapa de calor) rolam dentro do próprio
  contêiner; a página nunca rola na horizontal.

### 2.4 Permissoes

Sem mudança: as mesmas da tela de cada funcionalidade.

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Sem rolagem horizontal | Qualquer tela logada em 360, 390 e 430px | `document.documentElement.scrollWidth <= innerWidth` |
| RN-02 | Confirmação antes da Meta | Switch, lote ou orçamento no celular | Abre o diálogo de confirmação; só chama `/actions` depois de confirmar |
| RN-03 | Modo streaming | Modo ligado, Campanhas no celular | Nomes viram apelido ("Campanha 1"), IDs viram máscara, inclusive nos chips e diálogos |
| RN-04 | Sem zoom no iOS | Foco em input/select/textarea abaixo de 768px | Fonte de 16px |
| RN-05 | Sessão preservada | Deploy com o cliente enxuto do Supabase | A chave `sb-<ref>-auth-token` é a mesma do supabase-js; ninguém é deslogado |
| RN-06 | Cache só em memória | Trocar de aba e voltar em < 1 min | Não refaz a chamada (React Query `staleTime` 60s, `gcTime` 15 min); nada de histórico de campanhas no banco |

## 4. Padroes para telas novas

- **Celular = < 768px** (`useIsPhone()` em `hooks/useMediaQuery.ts`). Tabela
  larga vira **cards** no celular; renderize só uma das visões (não as duas
  escondidas por CSS) para não dobrar o trabalho do React.
- **Alvo de toque ≥ 44px**: botões de ação `h-11`, ícones `h-11 w-11`; caixa
  de seleção dentro de um `<label>` de 44×44. Do `sm` para cima pode voltar ao
  compacto (`sm:h-9`).
- **Diálogos**: use `Dialog`/`AlertDialog` de `components/ui` — no celular já
  abrem como bottom sheet, com alça, safe-area e botões empilhados.
- **Escolha única**: `Segmented` (`components/ui/segmented.tsx`), com `fill`
  para ocupar a largura no celular.
- **Filtros**: no celular, topo grudado com o essencial (nível/data) e o resto
  numa gaveta (bottom sheet) com contador no botão.
- **Grade**: em grid de uma coluna use `grid-cols-1` (que é `minmax(0,1fr)`),
  senão filho com texto longo estoura a largura.
- **Rolagem horizontal** só dentro do contêiner da tabela
  (`overflow-x-auto`), nunca na página.
- **Modo streaming**: todo nome/ID novo passa por `mask()`/`<Masked>`.
- **Rota nova**: adicione o import em `lib/routes.ts` (lazy + pré-carregamento
  no menu) e o caminho em `BY_PATH` se aparecer na navegação. Rota logada vai
  dentro do `<Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>`
  do `App.tsx`. Se a tela tem uma busca principal, declare a chave e a função
  em `lib/pageQueries.ts` e inclua o caminho em `prefetchPageData`.

## 5. Performance

Build de produção (`vite build`), antes = `f2d1ade`, depois = esta entrega.

| Medida | Antes | Depois |
|--------|-------|--------|
| Chunk principal (`index-*.js`) | 524,9 kB (152,1 kB gz) | 208,7 kB (69,1 kB gz) |
| JS do shell (entrada + vendors estáticos) | 749 kB (220,8 kB gz) | 557 kB (167,8 kB gz) |
| JS para abrir `/finance` | 872 kB (263,1 kB gz) | 661 kB (203,2 kB gz) |
| JS para abrir `/campaigns/meta` | 810 kB (243,5 kB gz) | 672 kB (208,3 kB gz) |
| Chunk do Resultado | 100,1 kB | 49,0 kB (+ 53 kB do Personalizar, sob demanda) |
| Lighthouse mobile `/login` (vite preview, 4G lento simulado) | 83–85 | 96 |
| FCP / LCP | 3,4 s / 3,4 s | 2,2 s / 2,3 s |
| JS transferido (`/login`) | 223 kB | 174 kB |

O que mudou:

1. **Todas as rotas lazy** (Login e Preview eram estáticas) e pré-carregamento
   das 4 telas da barra inferior quando o navegador fica ocioso, mais o
   pré-carregamento da tela no hover/foco/toque do link (`lib/routes.ts`).
2. **Cliente do Supabase enxuto** (`integrations/supabase/client.ts`):
   `AuthClient` + `PostgrestClient` no lugar do `createClient`, sem Realtime,
   Storage e Functions (~90 kB a menos no caminho crítico).
3. **Grade do Personalizar** (react-grid-layout) num chunk sob demanda.
4. Toaster do `sonner` removido (não era usado).
5. `manualChunks` por biblioteca (react, query, supabase, ícones): cache do
   navegador sobrevive a deploys que só mudam o app.
6. Fonte Inter por `preload` + troca para `stylesheet`, fora do caminho
   crítico (era um `@import` dentro do CSS).
7. Listas longas: Campanhas pagina de 25 em 25 (tabela) ou "Mostrar mais"
   (cards) e Vendas filtra no cliente; nenhuma lista renderiza centenas de
   linhas de uma vez, então não houve necessidade de virtualização.

### 5.1 Navegação entre telas (2026-11-25)

1. **Layout persistente** (`AppShell`): trocar de tela não desmonta menu,
   barra inferior nem o cabeçalho.
2. **Dados antes do toque** (`lib/pageQueries.ts`): cada tela principal
   declara chave e busca num lugar só. O hover/foco/toque no menu
   (`preloadPath`) baixa o chunk **e** busca os dados no período padrão; com o
   navegador ocioso, baixa o código de todas as telas do menu e os dados de
   Resultado e Campanhas. Teste com API simulada a 0,8 s: Campanhas abriu em
   65 ms.
3. **Sem tela vazia ao trocar período**: Resultado, Campanhas (no mesmo
   nível), Testes e Vendas mantêm os dados anteriores na tela enquanto chegam
   os novos (`placeholderData`).
4. **Microinterações**: fade do conteúdo na troca de tela, toque com leve
   escala nos itens da barra inferior e loading que só aparece após ~150 ms.
   Todas respeitam "reduzir movimento".

## 6. Checklist de Testes

- [ ] 390×844 e 360×780: todas as telas sem rolagem horizontal.
- [ ] Campanhas no celular: switch → confirmação → status muda; orçamento com
      ±10% → salvar; "Conjuntos ›" → chip da campanha; seleção → barra de lote.
- [ ] Modo streaming ligado: cards, chips e diálogos sem nome/ID real.
- [ ] Barra inferior: com o streaming ligado, o ícone da câmera fica vermelho.
- [ ] Menu: abre em tela cheia pelo botão Mais subindo de baixo e desce ao fechar no ✕, no Esc ou ao escolher um destino.
- [ ] Painéis: mostra o emoji do painel ativo; a lista troca o painel e fecha; streaming mascara os nomes.
- [ ] Abrir o app: vai direto para o loading do painel, sem o aviso "Nenhum painel" (a última lista de painéis fica guardada no aparelho e é apagada no logout).
- [ ] Navegar entre Resultado, Campanhas e Vendas: menu e barra inferior não piscam; conteúdo entra com fade; Campanhas abre com dados já carregados.
- [ ] iPhone: topo e barra inferior respeitam o notch e a barra de gestos.
- [ ] Desktop 1440×900, claro e escuro: tabela de Campanhas e Resultado iguais
      ao de antes.
- [ ] Login, sessão salva após recarregar e 2FA continuam funcionando.

## 7. Instalação no iPhone

1. No Safari, abra o endereço HTTPS da sua instância (o `APP_URL`). Para
   criar uma instância própria, siga o [INSTALL.md](../../../INSTALL.md).
2. Toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
3. Ative **Abrir como App da Web**, se essa opção aparecer, e toque em **Adicionar**.
4. Abra o ícone **dash.zip**. Entre com a conta do painel se o app pedir login.

O ícone abre o mesmo painel em uma janela própria. O Safari usa o ícone MM
e o manifest define a rota inicial e o modo standalone. O painel funciona
online e recebe as atualizações do site pelo mesmo endereço.

## 8. Continuidade do mobile

A frente ativa é o painel web instalado pelo Safari. Cada operador pode
implantar a própria instância e usar o mesmo fluxo no iPhone. A prioridade
para validar o modelo plug and play é um operador conseguir montar a própria
instância, entrar pelo iPhone e ver a primeira venda no painel.

- No iPhone, testar instalação, reabertura pelo ícone, login e 2FA conforme
  a conta, sessão ao reabrir e navegação entre Resultado, Campanhas e Vendas.
- Ajustar navegação e áreas seguras em `DashboardLayout.tsx` e `BottomNav.tsx`.
  Evoluir as telas em `pages/Result.tsx`, `pages/Campaigns.tsx` e `pages/Sales.tsx`.
- O ícone de instalação é servido pelo `apple-touch-icon` em
  `packages/frontend/index.html`. O nome e o modo de abertura ficam no
  `packages/frontend/public/manifest.webmanifest`. O iPhone usa o ícone
  padrão da instância.
- Acompanhamento de testes ainda usa tabela com rolagem dentro do contêiner.

### Notificações de venda no iPhone

1. Abra o Dash.zip pelo ícone da Tela de Início (iOS 16.4 ou posterior).
2. Entre em **Mais → Configurações → Notificações**.
3. Escolha o painel, os status e os dados que poderão aparecer na tela bloqueada.
   O ícone definido em **Configurações → Painéis** e o nome podem ser
   ligados separadamente após o status no título. Valor e meio de pagamento
   aparecem juntos na linha seguinte. Confira a prévia e salve.
4. Toque em **Ativar neste aparelho** e permita as notificações.
5. Use **Simular venda** para enviar um aviso com os campos salvos. A simulação
   usa valores de exemplo e não grava pedidos nem envia eventos ao Meta.
   Depois, valide um pedido real via webhook e abra o aviso para ver Vendas.

**Simular venda** só envia o aviso, sem tocar som dentro do app. O envio
sai 5 segundos depois do toque, para dar tempo de bloquear a tela ou sair do
app: com o Dash.zip aberto na tela, o iOS mostra o aviso sem som.

**Enviar teste para os outros aparelhos** manda a mesma venda de exemplo
para todos os aparelhos com notificações ativas na conta, menos o atual.
Aparece também no computador, mesmo sem ativar o push nele: é o jeito de
testar o aviso com o celular já bloqueado (`POST /sales-push/devices/test-others`).

O som do aviso é sempre o som padrão de notificação do iPhone. O Web Push
de app web (incluindo o Declarative Web Push) não aceita som personalizado,
então o `sale-sound.mp3` só toca dentro do app, em vendas reais com o app
aberto, e depende de o navegador repassar o evento à janela. Se o aviso
chegar mudo com a tela bloqueada, confira **Ajustes → Notificações →
Dash.zip → Sons**.

Os avisos começam após a ativação. O webhook aciona o envio assim que
termina de gravar os itens do pedido. A fila agrupa o pedido por status e
aparelho, e o agendamento de um minuto recupera avisos que ficaram na fila. O valor líquido é exibido quando
o checkout informa o líquido ou os dados necessários para calculá-lo.

#### Ativar em outra instância

- Para uma instância existente, aplique as migrations
  `20261124190000_sales_web_push.sql`, `20261124200000_sales_push_workspace_icon.sql`
  e `20261124210000_fast_sales_web_push.sql`.
  A instalação do zero já as inclui no
  `supabase/schema_completo.sql`.
- Gere chaves VAPID uma vez com `npx --yes web-push@3.6.7 generate-vapid-keys --json`.
  Configure `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` e `WEB_PUSH_SUBJECT`
  no backend. O assunto pode ser o endereço HTTPS do painel. Também é possível
  guardar o JSON com `publicKey`, `privateKey` e `subject` no segredo
  `dash_sales_web_push_vapid` no Supabase Vault.
- O agendamento reutiliza `dash_rules_cron_url` (terminado em
  `/api/rules-cron/tick`) e `dash_cron_secret` no Vault. Em domínios novos,
  use a URL pública do seu painel e um segredo próprio.
- Publique frontend e backend da mesma revisão. Verifique que
  `/sales-push-sw.js` é servido como JavaScript na origem do painel.

