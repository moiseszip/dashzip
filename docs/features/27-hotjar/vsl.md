# Retenção de VSL (avançado)

Seção da aba **Hotjar** que mostra a curva de retenção do vídeo de vendas (VSL): quantos visitantes que deram play continuam assistindo em cada segundo, por versão da página, e quantos clicaram no CTA.

**Desligada por padrão.** Ela lê as visitas de uma tabela gravada pelas próprias páginas de venda num Supabase de origem e só aparece nos painéis listados em `VSL_ENABLED_WORKSPACE_ID`. O Dash.zip só lê e agrega na hora; não guarda cópia.

## Como ligar

1. A página de venda grava uma linha por sessão na tabela de origem, com as colunas `sessao`, `pagina`, `video`, `duracao` (segundos), `som` (deu play com som), `seg_som` (array dos segundos assistidos com som), `cta` (clicou), `utm_content` e `criado_em`.
2. Configure na Vercel:

| Variável | Valor |
|---|---|
| `VSL_ENABLED_WORKSPACE_ID` | ID do painel (vários: separe por vírgula) |
| `VSL_SOURCE_SUPABASE_URL` | URL do Supabase onde a tabela está |
| `VSL_SOURCE_SERVICE_ROLE_KEY` | Service role desse Supabase (só no servidor) |
| `VSL_SOURCE_TABLE` | Nome da tabela (padrão `vsl_views`) |
| `VSL_HOSTS` | Domínios das páginas por mercado, em JSON: `{"br":["lp.seudominio.com.br"],"us":[]}` |

3. Os vídeos e as versões de página de cada mercado ficam em `VSL_MARKETS` (`packages/backend/src/modules/vsl/vsl.aggregate.ts`). Ajuste para os seus vídeos.

## Regras

| ID | Regra |
|---|---|
| RN-01 | Uma linha por sessão; a página sobrescreve o estado acumulado. |
| RN-02 | A base da retenção é quem deu play com som (`som = true`); autoplay mudo não entra. |
| RN-03 | Período no fuso do painel; leitura paginada até 200 mil linhas. |
| RN-04 | Sem as variáveis, a seção não aparece e a API responde 403. |
