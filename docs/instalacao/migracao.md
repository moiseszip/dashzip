# Migrar uma oferta para o Dash.zip

Para quem já rastreia a oferta com outra ferramenta (tracker de UTM, GTM server-side, pixel colado na página ou CAPI de outro serviço). A regra é **rodar em paralelo, conciliar e só então trocar**, com volta fácil se algo não bater.

## 1. Levantar o que existe

Anote, por oferta:

- Páginas de venda e onde estão hospedadas.
- Pixel do Meta: colado na página, via GTM ou via outra ferramenta. Quem manda o PageView, o InitiateCheckout e o Purchase hoje, e de onde (navegador, servidor ou os dois).
- Webhooks do checkout já ativos (cada ferramenta costuma ter o seu).
- Padrão de UTM dos anúncios e onde ele está (Parâmetros de URL de cada anúncio).
- Relatório que serve de referência para a conciliação (vendas por dia).

## 2. Instalar em paralelo (sem desligar nada)

1. Crie o painel da oferta e a integração do checkout no Dash.zip. **Crie um webhook novo** no checkout para o Dash.zip; não substitua o da ferramenta atual.
2. Cole o snippet do Dash.zip nas páginas. Ele convive com o pixel e com outros scripts.
3. Na API de Conversões do Dash.zip, deixe o **Pixel configurado, mas com o envio ao Meta só em teste** (código de teste do Gerenciador de Eventos) enquanto a outra ferramenta continua mandando os eventos de verdade. Assim não há evento em dobro.
4. Confira no **Preview e debug** que o snippet carrega, o PageView sai e o link do checkout é decorado com o identificador da visita.

## 3. Conciliar por um ciclo de vendas

Durante alguns dias (ou pelo menos 20–30 vendas):

- Compare as vendas aprovadas por dia em **Vendas** com o relatório de referência, pelo ID do pagamento e no mesmo fuso.
- Diferenças comuns: webhook criado depois do início do período, produto ou order bump fora do filtro do webhook, venda de teste, fuso diferente entre as ferramentas.
- Confira quantas vendas chegam ligadas à visita (origem e UTM preenchidas). Venda sem visita costuma ser link de checkout sem decoração ou snippet ausente numa variante da página.

## 4. Trocar

Com a conciliação batendo:

1. **Eventos do Meta.** Ligue o envio real na API de Conversões do Dash.zip e, no mesmo momento, desligue o envio da ferramenta antiga (CAPI e pixel duplicado). O Dash.zip já envia PageView e InitiateCheckout com o mesmo `event_id` no navegador e no servidor, e o Meta deduplica.
2. **Pixel colado à mão.** Remova da página quando o snippet do Dash.zip estiver carregando o pixel (o Preview avisa "pixel colado à mão").
3. **UTMs.** Troque os Parâmetros de URL dos anúncios pelo padrão do Dash.zip (Integrações → Padrão de UTM). Faça por conta de anúncio, numa janela de pouca entrega.
4. **Webhooks antigos.** Desative só depois de alguns dias com tudo certo.

## 5. Voltar atrás

Se algo der errado depois da troca: religue o envio da ferramenta antiga, desligue o envio real do Dash.zip (volte para o código de teste) e investigue no Preview e debug. Snippet e webhook do Dash.zip podem continuar rodando em paralelo sem afetar a outra ferramenta.

## Uma oferta por vez

Migre uma oferta, confirme por um ciclo e só então passe para a próxima. Comece pela que tem mais volume diário: a conciliação fica estatisticamente mais confiável.
