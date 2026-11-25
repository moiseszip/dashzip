# Dash.zip

**Rastreio first-party, vendas, mídia e lucro da sua operação num painel só — instalado na sua própria infraestrutura.**

O Dash.zip é um sistema plug and play para operadores de tráfego e infoprodutores. Cada operador sobe a própria instância (domínio, banco e contas dele) e acompanha cada oferta num painel: da visita na página de vendas ao pedido aprovado no checkout e ao evento entregue ao Meta.

## O que vem nele

- **Tracking e conversões.** Snippet servido pelo seu domínio, webhooks de 26 checkouts brasileiros, venda ligada à visita e API de Conversões do Meta com deduplicação entre navegador e servidor. Um "GTM simplificado", só para o Meta.
- **Preview e debug.** Abra a página pelo painel e veja, ao vivo, cada passo no navegador e cada requisição no servidor: o webhook que chegou, o `user_data` montado e a resposta do Meta.
- **Resultado.** Faturamento, lucro, ROI, margem, funil e gráficos, com cards que você escolhe e organiza.
- **Campanhas.** Campanhas, conjuntos e anúncios do Meta com as vendas do painel ao lado; pause, ative e ajuste orçamento dali.
- **Testes, vendas e custos.** Acompanhamento de testes por oferta, todos os pedidos com origem e status de envio, impostos, taxas, CMV e despesas para o lucro real.
- **Hotjar.** Rolagem, cliques, mapa de calor, quiz e tempo até a compra por página.
- **Celular.** Painel responsivo, app pelo Safari no iPhone e notificação de venda por painel.
- **Segurança.** Login com segundo fator, passkeys, painéis isolados e modo streaming para gravar a tela sem expor dados.

## Instalar com o seu agente de IA

Envie este repositório para o seu agente (Claude Code, Codex, Cursor…) e peça:

> Instale o Dash.zip para mim a partir de https://github.com/moiseszip/dashzip seguindo o INSTALL.md.

O agente conduz tudo a partir do [INSTALL.md](INSTALL.md):

1. **Onboarding:** perguntas sobre a sua operação, se a oferta é nova ou vem migrada de outra ferramenta, checkouts, domínio, Meta e custos.
2. **Infraestrutura:** seu repositório privado no GitHub, banco no Supabase, publicação na Vercel e o subdomínio do painel.
3. **Conta e painéis:** seu usuário admin e um painel por oferta.
4. **Integrações:** pixel e API de Conversões, webhook do checkout, snippet nas páginas e padrão de UTM.
5. **Testes:** verificação automática da instalação, evento de teste no Meta, venda de teste e notificação no celular.

No primeiro acesso, o painel abre um tutorial das seções.

Você vai precisar de contas (gratuitas para começar) no GitHub, na Vercel e no Supabase, acesso ao DNS do domínio das suas páginas e ao Meta Business. Prefere fazer à mão? Siga a [instalação manual](docs/instalacao/manual.md).

## Atualizar

```bash
git pull upstream main
npm run setup -- migration --file supabase/migrations/<arquivo-novo>.sql   # quando houver
git push   # a Vercel publica sozinha
```

## Documentação

- [INSTALL.md](INSTALL.md) — roteiro de instalação para o agente.
- [Instalação manual](docs/instalacao/manual.md) e [migração de ofertas](docs/instalacao/migracao.md).
- [Funcionalidades](docs/features/README.md) — cada área, com regras de negócio e testes.
- [Contexto de desenvolvimento](AGENTS.md) — para quem (ou qual agente) for alterar o código.
- `supabase/schema_completo.sql` — o banco inteiro; `supabase/migrations/` traz cada mudança.
- A rota `/docs` da sua instância tem o guia de uso.

## Licença

Código-fonte disponível para consulta. O uso, a instalação e a modificação exigem uma licença comercial do Dash.zip. Veja [LICENSE](LICENSE).

© 2026 Moises Melo. Dash.zip é uma marca de Moises Melo.
