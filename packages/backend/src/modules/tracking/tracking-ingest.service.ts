import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CollectBatch, deviceType } from './collect-payload';
import { traced } from '../debug/debug-context';

export interface RequestContext {
  /** IP do visitante. Vai para a sessão porque a CAPI precisa dele (client_ip_address). */
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

@Injectable()
export class TrackingIngestService {
  private readonly logger = new Logger(TrackingIngestService.name);

  constructor(
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Grava o lote numa ida só ao banco (RPC tracking_ingest). Devolve quantos
   * eventos entraram.
   *
   * Aguarda a gravação antes de o controller responder, ao contrário do que
   * o desenho "responde e enfileira" sugeriria: na Vercel a função congela
   * assim que a resposta sai, e o trabalho pendente morre junto (ver o fix
   * da sincronização do Meta, c03642e). Nunca lança — o visitante não tem o
   * que fazer com um erro nosso.
   */
  async ingest(batch: CollectBatch, ctx: RequestContext): Promise<number> {
    try {
      const params = {
        p_workspace_id: batch.workspaceId,
        p_visitor_id: batch.visitorId,
        p_session_id: batch.sessionId,
        p_ctx: {
          user_agent: ctx.userAgent,
          screen_resolution: batch.screenResolution,
          language: batch.language,
          device_type: deviceType(ctx.userAgent),
          country: ctx.country,
          region: ctx.region,
          city: ctx.city,
          fbp: batch.fbp,
          fbc: batch.fbc,
          ip_address: ctx.ip,
        },
        p_events: batch.events,
      };
      // O RPC grava visitante, sessão e eventos numa ida só.
      const { data, error } = await traced(
        'tracking_visitors + tracking_sessions + tracking_events',
        'rpc',
        params,
        () => this.supabase.getClient().rpc('tracking_ingest', params),
      );

      if (error) {
        this.logger.warn(`tracking_ingest falhou: ${error.message}`);
        return 0;
      }
      return typeof data === 'number' ? data : 0;
    } catch (err: any) {
      this.logger.warn(`tracking_ingest erro: ${err?.message}`);
      return 0;
    }
  }

  /**
   * Cliques e rolagem do mapa de calor. Tabelas próprias, fora do
   * tracking_ingest: um clique não é evento da visita. Nunca lança; sem a
   * migration do mapa de calor, só avisa no log.
   */
  async ingestHeatmap(batch: CollectBatch): Promise<void> {
    const hm = batch.heatmap;
    if (!hm) return;
    const client = this.supabase.getClient();
    try {
      const writes: PromiseLike<{ error: { message: string } | null }>[] = [
        client.from('heatmap_scrolls').upsert(
          {
            workspace_id: batch.workspaceId,
            session_id: batch.sessionId,
            page_id: hm.pageId,
            url: hm.url,
            device: hm.device,
            depth_pct: hm.depthPct,
            fold_pct: hm.foldPct,
            doc_h: hm.docH,
            ...(hm.seconds !== null ? { seconds: hm.seconds } : {}),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,session_id,page_id' },
        ),
      ];
      if (hm.clicks.length) {
        writes.push(
          client.from('heatmap_clicks').insert(
            hm.clicks.map((c) => ({
              workspace_id: batch.workspaceId,
              session_id: batch.sessionId,
              page_id: hm.pageId,
              url: hm.url,
              device: hm.device,
              selector: c.selector,
              rx: c.rx,
              ry: c.ry,
              px: c.px,
              py: c.py,
              doc_w: hm.docW,
              doc_h: hm.docH,
              label: c.label,
            })),
          ),
        );
      }
      for (const { error } of await Promise.all(writes)) {
        if (error) this.logger.warn(`mapa de calor: ${error.message}`);
      }
    } catch (err: any) {
      this.logger.warn(`mapa de calor erro: ${err?.message}`);
    }
  }
}
