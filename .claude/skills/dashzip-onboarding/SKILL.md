---
name: dashzip-onboarding
description: Use quando pedirem para instalar, implantar ou configurar o Dash.zip ("instala o Dash.zip", "configura meu painel", "quero migrar minha oferta para o Dash.zip", "adicionar uma oferta nova"). Entrevista o operador sobre a operação, decide entre criar do zero ou migrar, levanta tudo o que o setup precisa e grava .setup/operacao.md antes de seguir o INSTALL.md.
---

# Onboarding do Dash.zip

Você vai conduzir a conversa de entrada de um operador de mídia/infoproduto que quer o Dash.zip rodando. Objetivo: sair com um plano de instalação completo em `.setup/operacao.md` e, com o "pode" do operador, executar o [INSTALL.md](../../../INSTALL.md).

## Como conduzir

- Fale como um implantador experiente: simples, direto, em português, sem jargão de programação. Explique o porquê de cada pergunta só quando ajudar.
- **Um bloco por vez**, no máximo 3–4 perguntas por mensagem. Use a ferramenta de perguntas com opções quando existir (no Claude Code, `AskUserQuestion`).
- Ofereça o padrão recomendado em cada escolha ("Recomendo X porque…"). Se o operador não souber, anote o padrão e siga.
- **Nunca peça para colar token, senha ou chave no chat.** Diga onde o valor vai entrar (tela de Integrações, `vercel env`, `.setup/`) e só pergunte se ele já tem o acesso.
- Pule o que não se aplica (ex.: sem assinatura, não pergunte de plano anual).
- Ao fim de cada bloco, atualize `.setup/operacao.md` (crie a pasta se não existir; ela está no `.gitignore`).

## Bloco 1 — A operação

1. Nome da operação ou marca e o que vende (nicho, tipo: low ticket, high ticket, assinatura/SaaS, e-commerce, lançamento).
2. Países e moeda das vendas (só BRL ou também USD/EUR) e o fuso do dia a dia (padrão `America/Sao_Paulo`).
3. Faturamento e investimento aproximados por mês — só para dimensionar (planos gratuitos atendem a maioria).
4. Quem mais vai usar o painel (e-mails dos admins e da equipe).

## Bloco 2 — Do zero ou migração

Pergunte: **"Você quer criar a oferta e o painel do zero ou migrar uma oferta que já vende?"**

- **Do zero:** oferta nova ou que ainda não tem rastreio. Siga para o Bloco 3.
- **Migrar:** já existe rastreio. Pergunte:
  - De onde vem hoje: UTMify, Stape/GTM server-side, pixel colado na página, outro tracker, nenhum CAPI.
  - O que precisa continuar funcionando durante a troca (pixel atual, CAPI atual, relatórios).
  - Padrão de UTM usado hoje nos anúncios e quantas campanhas ativas.
  - Se aceita rodar **em paralelo** por um ciclo de vendas antes de trocar (recomendado).
  - Leia o [guia de migração](../../../docs/instalacao/migracao.md) e planeje a troca com ele.

Pode haver as duas coisas: uma oferta nova e outra migrada. Cada oferta vira um **painel**.

## Bloco 3 — Ofertas (um painel por oferta)

Para cada oferta:

1. Nome e um emoji (aparece no seletor e nas notificações).
2. Páginas de venda: URLs e onde estão hospedadas (Vercel, WordPress, Lovable, construtor de páginas…) e se o agente tem acesso ao código.
3. Checkout: plataforma (Hotmart, Kiwify, Cakto, Ticto, Eduzz, Monetizze, Greenn, Lastlink, Kirvano, PerfectPay, Payt, Hubla, Guru, CartPanda, Yampi, Mundpay, GGCheckout, Wiven, Frendz, Herospark, Kavoo, PagTrust, Assiny, Doppus, AbacatePay, Wiapy) e se tem acesso admin para criar webhook.
4. Produtos, order bumps e upsells (nomes como aparecem no checkout).
5. Código curto da oferta usado nos nomes das campanhas (ex.: `CUR` em `CUR | Vídeo 03 | ABO`) — liga campanhas à oferta em Acompanhamento de testes.
6. Contas de anúncio do Meta que rodam a oferta.

## Bloco 4 — Domínio e infraestrutura

1. Domínio das páginas de venda e onde o DNS é gerenciado; quem tem acesso.
2. Subdomínio do painel — recomende `painel.<dominio>` no **mesmo domínio** das páginas (rastreio first-party). Vira o `APP_URL`.
   - Ofertas em domínios diferentes: um painel por domínio funciona, mas o first-party completo só vale no domínio do painel. Registre e explique.
3. Contas: GitHub (usuário ou organização), Vercel (pessoal ou time), Supabase (organização). Se não tiver, guie a criação (gratuitas).
4. Ferramentas na máquina: confirme `node`, `gh` e `vercel` (Etapa 0 do INSTALL.md) e combine os logins que o operador vai rodar.

## Bloco 5 — Meta e mídia

1. Business Manager com Pixel (dataset) de cada oferta — anote o ID do Pixel (não é segredo).
2. Token da API de Conversões: tem um usuário do sistema com acesso ao Pixel? Se não, explique como gerar no Gerenciador de Eventos → Configurações → API de Conversões.
3. Para Campanhas: acesso às contas de anúncio com token do Meta (a tela de Integrações conduz).
4. Outras plataformas (Google Ads, TikTok): registre; hoje o Dash.zip opera Meta.

## Bloco 6 — Custos e lucro

1. Imposto sobre vendas (%), se houver (Simples, MEI, etc.).
2. Taxas do checkout (o Dash.zip usa o líquido quando o checkout informa; senão, cadastra a taxa).
3. IOF/custo sobre mídia em contas em dólar (%).
4. Custo de produto por item (CMV), se houver, e despesas fixas mensais (ferramentas, equipe).

## Bloco 7 — Rotina e avisos

1. Notificações de venda no celular: quer receber pendentes, aprovadas ou as duas; valor total ou líquido.
2. Usa iPhone? Explique o app pelo Safari (Compartilhar → Adicionar à Tela de Início) e que o aviso usa o som padrão do iOS.
3. Recursos extras: mapa de calor e Hotjar, quiz, regras automáticas de pausa/orçamento.

## Fechamento

1. Escreva `.setup/operacao.md` neste formato:

```markdown
# Operação: <nome>
- Caminho: do zero | migração (de <origem>) | misto
- APP_URL: https://painel.<dominio>
- DNS: <provedor> (acesso: <quem>)
- Admins: <emails>
- Fuso/moeda: <fuso> / <moedas>
- Contas: GitHub <conta>, Vercel <conta/time>, Supabase <org>

## Painéis
| Painel | Emoji | Páginas | Checkout | Código | Contas de anúncio | Pixel |
|---|---|---|---|---|---|---|

## Custos
- Imposto: <%> · IOF: <%> · CMV: <...> · Despesas: <...>

## Migração (se houver)
- Origem atual, o que roda em paralelo, data prevista da troca, critério de conciliação

## Pendências do operador
- <acessos ou decisões que faltam>
```

2. Mostre um resumo curto do plano (o que será criado, onde, e o que o operador precisa fazer) e **peça o "pode"**.
3. Com o "pode", siga o [INSTALL.md](../../../INSTALL.md) a partir da Etapa 0/2, atualizando `.setup/operacao.md` com os IDs criados (projeto Supabase, projeto Vercel, IDs dos painéis).

## Oferta nova numa instância que já existe

Se o Dash.zip já está instalado e o pedido é só "adicionar uma oferta": faça os Blocos 2, 3, 5 e 6 para a oferta, crie o painel (`npm run setup -- workspace …` ou Configurações → Painéis) e siga as Etapas 7 e 8 do INSTALL.md.
