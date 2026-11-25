import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { VisitorMatchingService } from '../tracking/visitor-matching.service';
import { webhookContext } from '../../shared/helpers/webhook-context';
import { debugContext, traced } from '../debug/debug-context';

/** Pedido ainda não pago: pode virar outro status não pago ou aprovado. */
const OPEN_STATUSES = new Set(['pending', 'refused']);
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/**
 * Gravação da venda que o webhook do checkout trouxe. A venda é o que liga o
 * comprador à visita (indexador stl_<sessão>) e de onde sai o Purchase da CAPI.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly visitorMatching: VisitorMatchingService,
  ) {}

  async upsertFromWebhook(sale: Record<string, any>): Promise<Record<string, any>> {
    // O snippet de rastreio escreve sck=stl_<sessao> no link do checkout.
    // Alguns processors usam o sck como último recurso para achar o ad_id,
    // e sem esta limpeza o id da sessão ia parar em sales.ad_id. O marcador
    // vai para o metadata, que é onde o casamento com a visita o procura.
    if (typeof sale.ad_id === 'string' && sale.ad_id.startsWith('stl_')) {
      sale = { ...sale, ad_id: null, metadata: { ...(sale.metadata ?? {}), tracking_ref: sale.ad_id } };
    }

    // O indexador achado no corpo cru do webhook (webhook-context). Cobre as
    // plataformas cujo processor não guarda o parâmetro em lugar nenhum.
    const ctx = webhookContext.getStore();
    if (ctx?.trackingRef && !sale.metadata?.tracking_ref) {
      sale = { ...sale, metadata: { ...(sale.metadata ?? {}), tracking_ref: ctx.trackingRef } };
    }
    if (ctx) {
      sale = { ...sale, metadata: { ...(sale.metadata ?? {}), sale_push_webhook: true } };
    }

    // O debug do servidor mostra a venda como o processor a entendeu.
    const debug = debugContext.getStore();
    debug?.setWorkspace(sale.workspace_id ?? null);
    debug?.variable('Venda', {
      status: sale.status,
      external_id: sale.external_id,
      amount: sale.amount,
      currency: sale.currency,
      product_name: sale.product_name,
      customer_email: sale.customer_email,
      customer_phone: sale.customer_phone,
      tracking_ref: sale.metadata?.tracking_ref ?? null,
    });

    // Mais de uma tentativa só quando outra entrega do mesmo pedido grava a
    // linha entre a nossa busca e o insert (índice único external_id+painel).
    for (let attempt = 0; ; attempt++) {
      const existing = await this.findByExternalId(sale);
      try {
        return await this.write(sale, existing, ctx, debug);
      } catch (err: any) {
        if (attempt === 0 && !existing && err?.code === UNIQUE_VIOLATION) continue;
        if (err?.code === CHECK_VIOLATION && sale.status === 'refused') {
          // Banco sem a migration 20261123150000_sales_refused: a recusa não
          // tem onde ficar. Não derruba o webhook (a plataforma reenviaria).
          debug?.log(`Venda ${sale.external_id} recusada não gravada: o banco ainda não aceita o status "refused".`, 'warn');
          return { id: existing?.id ?? null, status: existing?.status ?? null, skipped: 'refused_not_supported' };
        }
        throw err;
      }
    }
  }

  /**
   * Decide entre gravar, atualizar ou não fazer nada, pelo status que chegou e
   * pelo da linha que já existe com o mesmo external_id:
   *
   *   chegou não aprovada (pending/refused)
   *     sem linha            → grava
   *     linha pending/refused → atualiza (Pix gerado → expirado, por exemplo)
   *     linha approved/refunded/chargeback → nada: nunca rebaixa o que foi pago
   *   chegou aprovada
   *     sem linha            → grava, casa com a visita, Purchase
   *     linha pending/refused → vira approved com os dados novos, casa com a
   *                             visita, Purchase (uma vez: só nesta transição)
   *     linha approved/refunded/chargeback → reentrega, nada a fazer
   */
  private async write(
    sale: Record<string, any>,
    existing: { id: string; status: string | null } | null,
    ctx: ReturnType<typeof webhookContext.getStore>,
    debug: ReturnType<typeof debugContext.getStore>,
  ): Promise<Record<string, any>> {
    const approved = sale.status === 'approved';
    const existingOpen = !!existing && OPEN_STATUSES.has(existing.status ?? '');

    if (!approved) {
      if (!existing) {
        const saved = await this.persist(sale);
        if (sale.status === 'pending') ctx?.notificationSaleIds.push(saved.id);
        debug?.log(`Venda ${sale.external_id} gravada com status "${sale.status}": Purchase não sai.`);
        return { ...saved, status: sale.status };
      }
      if (existingOpen) {
        await this.update(existing.id, sale);
        if (sale.status === 'pending' && existing.status !== 'pending') ctx?.notificationSaleIds.push(existing.id);
        debug?.log(`Venda ${sale.external_id}: "${existing.status}" → "${sale.status}". Purchase não sai.`);
        return { id: existing.id, status: sale.status };
      }
      debug?.log(`Venda ${sale.external_id} já está "${existing.status}": o status "${sale.status}" não rebaixa.`);
      return existing;
    }

    if (existing && !existingOpen) {
      // Idempotência: a reentrega do webhook não grava nem envia de novo.
      debug?.log(`Venda ${sale.external_id} já existia: reentrega do webhook, nada a fazer.`);
      return existing;
    }

    let id: string;
    if (existing) {
      await this.update(existing.id, sale);
      id = existing.id;
      debug?.log(`Venda ${sale.external_id}: "${existing.status}" → "approved" (pagamento confirmado).`);
    } else {
      id = (await this.persist(sale)).id;
    }

    // Liga a venda à visita rastreada, se houver. Aguardado: na Vercel a
    // função congela quando o webhook responde. Nunca lança. Só a aprovada:
    // pedido não pago não conta como venda da visita no rastreio.
    await this.visitorMatching.matchSale(id);

    // Venda aprovada nova (ou que acabou de ser paga): entra na lista do
    // Purchase da CAPI, enviado quando o webhook terminar (WebhookQueueService).
    ctx?.approvedSaleIds.push(id);
    ctx?.notificationSaleIds.push(id);
    return { id, status: 'approved' };
  }

  private async findByExternalId(sale: Record<string, any>): Promise<{ id: string; status: string | null } | null> {
    if (!sale.external_id) return null;
    let query = this.supabase
      .getClient()
      .from('sales')
      .select('id, status')
      .eq('external_id', sale.external_id)
      .eq('user_id', sale.user_id);
    // O índice único é (external_id, workspace_id): o mesmo dono pode ter o
    // mesmo id de transação em dois painéis.
    if (sale.workspace_id) query = query.eq('workspace_id', sale.workspace_id);
    const { data } = await query.maybeSingle();
    return data ?? null;
  }

  private async update(id: string, sale: Record<string, any>): Promise<void> {
    // Dono, painel e integração não mudam; o resto vem da entrega mais nova.
    const { user_id: _user, workspace_id: _workspace, checkout_integration_id: _integration, ...fields } = sale;
    const { error } = await traced('sales', 'update', fields, () =>
      this.supabase.getClient().from('sales').update(fields).eq('id', id),
    );
    if (error) throw Object.assign(new Error(error.message), { code: (error as any).code });
  }

  private async persist(sale: Record<string, any>): Promise<Record<string, any>> {
    const { data, error } = await traced('sales', 'insert', sale, () =>
      this.supabase.getClient().from('sales').insert(sale).select('id').single(),
    );
    if (error) throw Object.assign(new Error(error.message), { code: (error as any).code });
    return data;
  }
}
