# Modo streaming

> **Módulo:** só frontend | **Código:** `packages/frontend/src/contexts/StreamingModeContext.tsx`, `src/lib/streamingMask.ts`, `src/components/Masked.tsx`, `src/components/StreamingModeButton.tsx`
> **Última atualização:** 2026-11-23
> **Status:** Aprovado

---

## 1. Propósito

Gravar vídeo da tela do dash.zip (aula, explicação para cliente ou equipe) sem mostrar o que identifica as ofertas: nomes de painel, oferta, produto, campanha, conjunto, anúncio, conta de anúncio, cliente, domínios e tokens. Os números continuam na tela (faturamento, vendas, gasto, ROAS, CPA, datas, contagens).

## 2. Como usar

- **Botão:** no menu lateral, no rodapé, entre **Documentação** e **Configurações**: "Modo streaming". À direita fica um switch: ligado, o switch e o ícone ficam vermelhos. Com o menu recolhido, o ícone ganha um ponto vermelho, e o tooltip diz só "Ligar/Desligar modo streaming". No celular, a barra do topo mostra o selo **Streaming**.
- **Atalho:** `Alt+Shift+S` (no Mac, `Option+Shift+S`), fora de campos de texto.
- **Persistência:** o estado fica no `localStorage` (`dashzip:streaming-mode`). Se você der F5 ou abrir outra aba, o modo continua ligado.
- **Busca:** com o modo ligado, as buscas de Campanhas e Vendas também acham pelo apelido ("campanha 3", "cliente 2").
- **Edição:** formulário que traria o valor real (nome do painel, ofertas, pixel, domínio, token, integração de checkout, URL do preview) fica travado com o apelido ou a máscara. Para editar, desligue o modo.

## 3. O que é escondido e como

### 3.1 Apelido estável (para você citar no vídeo)

| Tipo | Apelido | Onde aparece |
|---|---|---|
| Painel (workspace) | Painel 1, Painel 2… | seletor do menu, cabeçalho das telas, Configurações > Painéis |
| Oferta | Oferta 1… | Acompanhamento de testes (filtro, subtotal, saúde do checkout), VSL (mercado) |
| Produto | Produto 1… | Resultado (filtro e gráfico "Vendas por produto"), Vendas, Custos |
| Campanha / Conjunto / Anúncio | Campanha 1, Conjunto 1, Anúncio 1… | Campanhas, Testes, Regras, Vendas, Ao vivo, VSL (criativos) |
| Conta de anúncio | Conta 1… | Campanhas, Testes, Resultado, Custos, Integrações, Regras |
| Integração de checkout | Integração 1… | Integrações |
| Página (LP) | Página 1… | Ao vivo, Mapa de calor, Preview |
| Cliente | Cliente 1… | Vendas |
| Pessoa (usuário, autor da mudança na Meta) | Pessoa 1… | Configurações > Usuários, histórico dos Testes |
| Grupo de produto | Grupo 1… | Custos > Custo de produto |
| Elemento clicado | Elemento 1… | Mapa de calor |

Regras dos apelidos:

1. O mesmo nome real vira sempre o mesmo apelido, em todas as telas: a campanha que é "Campanha 3" em Campanhas também é "Campanha 3" na UTM da venda e no Ao vivo (o nome da UTM é a parte antes do `|`, que é o nome da campanha/conjunto/anúncio na Meta).
2. A numeração segue a ordem em que o nome aparece pela primeira vez na sessão, separada por tipo. O mapa fica no `sessionStorage` (`dashzip:streaming-map`): sobrevive a F5 e a ligar/desligar o modo; zera ao fechar a aba.
3. Desligado, tudo aparece com o valor real.

### 3.2 Máscara `•••••` (não faz sentido numerar)

E-mail, telefone, documento, IDs (conta, campanha, pixel, pedido, anúncio), URLs, domínios, tokens e códigos de teste. A máscara tem tamanho fixo (não revela o comprimento) e o valor real **não vai para o DOM**: nem texto, nem `title`, nem `aria-label`, então não dá para selecionar, copiar ou ler no tooltip.

### 3.3 Blocos inteiros ocultos

- JSON bruto (payload e resposta do Purchase em Vendas; corpo, variáveis e chamadas no Preview): aparece "Conteúdo bruto oculto no modo streaming" e o botão Copiar some.
- Editor de ofertas (Testes): "desligue o modo streaming para editar".
- Snippet de Integrações: mostra a estrutura com `•••••` no lugar do domínio e do ID do painel (o botão Copiar continua copiando o código real).

### 3.4 Textos livres

Toasts, avisos e mensagens de erro da API passam por `scrub()`: troca qualquer nome que já ganhou apelido, além de qualquer e-mail e URL, pela versão mascarada. Os links que mostrariam IDs ou a URL da LP no rodapé do navegador ao passar o mouse ("Abrir no Gerenciador", "Ver cliques na página") viram botões sem `href` enquanto o modo está ligado.

### 3.5 O que continua visível (de propósito)

- Números, datas, status, métricas, rótulos fixos do app.
- Nome das plataformas de checkout (Hotmart, Kiwify…) e meios de pagamento: são marcas de terceiros, não nomes das suas ofertas. O nome que **você** dá à integração é mascarado.
- `utm_source` e `utm_term` (FB, Instagram_Feed): não carregam nome.
- Nomes de regras, descrições de despesas e de taxas: são textos seus, passam só pelo `scrub()`.
- Cidade/estado/país do visitante no Ao vivo.
- O título da aba do navegador é sempre "dash.zip".

### 3.6 Limites

- Abrir a página real (Preview "Abrir site em preview", Mapa de calor "Ver cliques/rolagem", "Abrir no Gerenciador") abre outra aba com o domínio e o conteúdo reais. Isso fica fora do dash.zip.
- Os valores das opções de `<select>` não aparecem na tela; no filtro de conta dos Testes eles também viram índice com o modo ligado.
- O que você digita num campo de busca aparece como digitou.

## 4. Como mascarar uma tela nova

1. Pegue o hook: `const { mask, maskUtm, scrub, enabled } = useMask();` (de `@/contexts/StreamingModeContext`).
2. Nome que se cita no vídeo: `mask('campaign', row.name)`. Use o tipo certo (`workspace`, `offer`, `product`, `campaign`, `adset`, `ad`, `account`, `integration`, `page`, `customer`, `person`, `group`, `element`). Para linhas da Meta use o nível: `mask(row.level, row.name)`.
3. Dado sem sentido numerar: `mask('email' | 'phone' | 'document' | 'id' | 'url' | 'domain' | 'token', valor)` devolve `•••••`. Em JSX, `<Masked kind="email" value={...} />` faz o mesmo e cuida de vazio/fallback.
4. UTM: `maskUtm('utm_campaign', valor)` (também `utm_medium` → conjunto, `utm_content` → anúncio; as demais passam).
5. Texto livre (aviso, erro, toast): `scrub(texto)`. O `Toaster` já faz isso para todos os toasts.
6. **Todo** lugar onde o nome sai: texto, `title`, `aria-label`, legenda e tooltip de gráfico (mapeie os pontos antes de passar ao gráfico), opções de filtro, diálogos de confirmação, links (`href` com ID ou URL vira botão com `window.open` quando `enabled`).
7. Campo de formulário com valor real: troque `<Input>` por `<MaskedInput kind="...">` (trava e mostra o apelido/máscara). Bloco grande: `<StreamingHidden>`.
8. Teste: em `src/pages/streamingMode.render.test.tsx`, renderize a tela com `<StreamingModeProvider initialEnabled>` e use `expectNoSecrets()`, que procura os nomes de teste no `outerHTML` e nos atributos `title`/`aria-label`.

## 5. Testes

- `src/lib/streamingMask.test.ts`: estabilidade dos apelidos, tipos independentes, máscara fixa, snapshot (F5), `scrub`, `utmNamePart`.
- `src/contexts/StreamingModeContext.test.tsx`: desligado = valor real, ligado mascara, persistência, atalho.
- `src/pages/streamingMode.render.test.tsx`: Vendas, Campanhas e Acompanhamento de testes com o modo ligado, sem nenhum nome de teste no DOM nem em atributos.

## 6. Checklist manual

- [ ] Ligar pelo botão e pelo atalho; recarregar e ver que continua ligado.
- [ ] Menu recolhido: ícone com ponto vermelho, tooltip sem nome.
- [ ] Em cada tela, procurar no console: `document.documentElement.outerHTML.includes('<nome real>')` deve dar `false`.
- [ ] Abrir os três pontinhos, o diálogo de pausar e o de orçamento: só apelidos.
- [ ] Toast de erro com nome de campanha: aparece o apelido.
