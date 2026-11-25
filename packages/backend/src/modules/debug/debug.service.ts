import { WorkspaceRoutingService } from '../../shared/services/workspace-routing.service';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';
import { DebugTrace, limitBody } from './debug-context';

/** Quanto tempo o preview fica ligado a cada "Iniciar" (o painel renova enquanto está aberto). */
const PREVIEW_MINUTES = 60;
/** O /collect e o webhook consultam o estado do preview; 5s segura o banco sem atrasar o "Iniciar". */
const STATUS_TTL_MS = 5_000;
const RETENTION_MS = 24 * 3600_000;
const MAX_WEB_MESSAGES = 30;
const MAX_WEB_MESSAGE_CHARS = 30_000;

export const DEBUG_TOKEN = /^[a-f0-9]{48}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreviewStatus {
  active: boolean;
  until: string | null;
  token: string | null;
}

/** Uma mensagem do navegador em preview, como o tracker.js a manda. */
interface WebMessage {
  type: string;
  title: string;
  page_id: string | null;
  data: unknown;
}

@Injectable()
export class DebugService {
  private readonly logger = new Logger(DebugService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
    private readonly workspaceRouting: WorkspaceRoutingService,
  ) {}

  // -------------------------------------------------------------------------
  // Estado do preview
  // -------------------------------------------------------------------------

  /** Estado do preview da área, cacheado: é lido em todo /collect e webhook. */
  async status(workspaceId: string): Promise<PreviewStatus> {
    const key = `debug:status:${workspaceId}`;
    const cached = this.cache.get<PreviewStatus>(key);
    if (cached) return this.fresh(cached);

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('debug_until, debug_token')
      .eq('id', workspaceId)
      .maybeSingle();

    // Sem a migration (coluna inexistente) o preview simplesmente não liga.
    if (error) {
      if (!/debug_/.test(error.message)) this.logger.warn(`Estado do preview ${workspaceId}: ${error.message}`);
      const off = { active: false, until: null, token: null };
      this.cache.set(key, off, STATUS_TTL_MS);
      return off;
    }

    const status = this.fresh({ active: true, until: data?.debug_until ?? null, token: data?.debug_token ?? null });
    this.cache.set(key, status, STATUS_TTL_MS);
    return status;
  }

  private fresh(status: PreviewStatus): PreviewStatus {
    const active = !!status.until && !!status.token && new Date(status.until).getTime() > Date.now();
    return { ...status, active };
  }

  /**
   * Liga (ou renova) o preview. O token continua o mesmo enquanto o preview
   * estiver ligado: a aba do site já aberta com ele segue funcionando.
   */
  async start(userId: string, workspaceId: string): Promise<PreviewStatus> {
    await this.assertOwner(userId, workspaceId);
    const current = await this.status(workspaceId);
    const token = current.active && current.token ? current.token : randomBytes(24).toString('hex');
    const until = new Date(Date.now() + PREVIEW_MINUTES * 60_000).toISOString();

    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .update({ debug_until: until, debug_token: token })
      .eq('id', workspaceId);
    if (error) throw new Error(this.migrationHint(error.message));

    this.cache.invalidate(`debug:status:${workspaceId}`);
    await this.purgeOld(workspaceId);
    return { active: true, until, token };
  }

  async stop(userId: string, workspaceId: string): Promise<PreviewStatus> {
    await this.assertOwner(userId, workspaceId);
    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .update({ debug_until: null })
      .eq('id', workspaceId);
    if (error) throw new Error(this.migrationHint(error.message));
    this.cache.invalidate(`debug:status:${workspaceId}`);
    return { active: false, until: null, token: null };
  }

  async getStatus(userId: string, workspaceId: string): Promise<PreviewStatus> {
    await this.assertOwner(userId, workspaceId);
    this.cache.invalidate(`debug:status:${workspaceId}`);
    const status = await this.status(workspaceId);
    return status.active ? status : { active: false, until: null, token: null };
  }

  // -------------------------------------------------------------------------
  // Gravação
  // -------------------------------------------------------------------------

  /**
   * Grava o rastro de uma requisição do servidor, se a área estiver em
   * preview. Nunca lança: o debug não pode derrubar o /collect nem o webhook.
   */
  async saveServerTrace(trace: DebugTrace, fallbackToken?: string | null): Promise<void> {
    try {
      if (!trace.workspaceId && fallbackToken) {
        trace.setWorkspace(await this.workspaceByWebhookToken(fallbackToken));
      }
      if (!trace.workspaceId) return;

      const status = await this.status(trace.workspaceId);
      if (!status.active) return;

      const { error } = await this.supabase
        .getClient()
        .from('debug_traces')
        .insert({
          workspace_id: trace.workspaceId,
          source: 'server',
          kind: trace.kind,
          title: trace.title.slice(0, 200),
          status: trace.status,
          browser_token: trace.browserToken && trace.browserToken === status.token ? trace.browserToken : null,
          data: trace.toJSON(),
        });
      if (error) this.logger.warn(`Rastro do preview: ${error.message}`);
    } catch (err: any) {
      this.logger.warn(`Rastro do preview: ${err?.message}`);
    }
  }

  /**
   * Mensagens do navegador em preview (POST /api/t/debug). Só entram com o
   * token do preview ligado: sem ele, qualquer um gravaria na área alheia.
   */
  async saveWebMessages(body: unknown): Promise<{ ok: boolean; reason?: string }> {
    let data: any = body;
    if (typeof body === 'string') {
      try {
        data = JSON.parse(body);
      } catch {
        return { ok: false, reason: 'corpo inválido' };
      }
    }
    const requestedId = typeof data?.tid === 'string' ? data.tid.toLowerCase() : '';
    const token = typeof data?.dbg === 'string' ? data.dbg : '';
    if (!UUID.test(requestedId) || !DEBUG_TOKEN.test(token) || !Array.isArray(data?.msgs)) {
      return { ok: false, reason: 'corpo inválido' };
    }

    const workspaceId = await this.workspaceRouting.resolve(requestedId);
    if (!workspaceId) return { ok: false, reason: 'preview encerrado' };

    const status = await this.status(workspaceId);
    if (!status.active || status.token !== token) return { ok: false, reason: 'preview encerrado' };

    const rows = (data.msgs as unknown[])
      .slice(0, MAX_WEB_MESSAGES)
      .map((m) => this.webMessage(m))
      .filter((m): m is WebMessage => m !== null)
      .map((m) => ({
        workspace_id: workspaceId,
        source: 'web',
        kind: m.type,
        title: m.title,
        status: this.webStatus(m.data),
        browser_token: token,
        page_id: m.page_id,
        data: m.data,
      }));
    if (rows.length === 0) return { ok: true };

    const { error } = await this.supabase.getClient().from('debug_traces').insert(rows);
    if (error) {
      this.logger.warn(`Mensagens do preview: ${error.message}`);
      return { ok: false, reason: 'falha ao gravar' };
    }
    return { ok: true };
  }

  private webMessage(raw: unknown): WebMessage | null {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as Record<string, unknown>;
    const type = typeof m.type === 'string' ? m.type.slice(0, 40) : '';
    const title = typeof m.title === 'string' ? m.title.slice(0, 200) : '';
    if (!type || !title) return null;
    let json: string;
    try {
      json = JSON.stringify(m.data ?? {});
    } catch {
      return null;
    }
    return {
      type,
      title,
      page_id: typeof m.page_id === 'string' && /^[0-9a-f]{8}$/.test(m.page_id) ? m.page_id : null,
      data: json.length > MAX_WEB_MESSAGE_CHARS ? limitBody(json) : JSON.parse(json),
    };
  }

  /** Tag com falha → erro; aviso declarado pelo navegador → warning. */
  private webStatus(data: any): string {
    const tags: any[] = Array.isArray(data?.tags) ? data.tags : [];
    if (tags.some((t) => t?.status === 'failed') || data?.level === 'error') return 'error';
    if (data?.level === 'warning') return 'warning';
    return 'ok';
  }

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  /**
   * Mensagens em ordem cronológica. Sem `after` (painel abrindo), as mais
   * recentes; com `after`, as que chegaram depois da última que o painel tem.
   */
  async list(userId: string, workspaceId: string, after?: string | null, limit = 300) {
    await this.assertOwner(userId, workspaceId);
    const query = this.supabase
      .getClient()
      .from('debug_traces')
      .select('id, source, kind, title, status, browser_token, page_id, data, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: !!after })
      .limit(Math.min(Math.max(limit, 1), 500));

    const { data, error } = after
      ? await query.gt('created_at', after)
      : await query.gte('created_at', new Date(Date.now() - RETENTION_MS).toISOString());
    if (error) throw new Error(this.migrationHint(error.message));
    return after ? data ?? [] : (data ?? []).reverse();
  }

  async clear(userId: string, workspaceId: string): Promise<{ success: true }> {
    await this.assertOwner(userId, workspaceId);
    const { error } = await this.supabase.getClient().from('debug_traces').delete().eq('workspace_id', workspaceId);
    if (error) throw new Error(this.migrationHint(error.message));
    return { success: true };
  }

  // -------------------------------------------------------------------------

  private async purgeOld(workspaceId: string): Promise<void> {
    await this.supabase
      .getClient()
      .from('debug_traces')
      .delete()
      .eq('workspace_id', workspaceId)
      .lt('created_at', new Date(Date.now() - RETENTION_MS).toISOString());
  }

  /** Webhook recusado antes de achar a área: o token dele diz de quem é. */
  private async workspaceByWebhookToken(token: string): Promise<string | null> {
    const { data } = await this.supabase
      .getClient()
      .from('checkout_integrations')
      .select('workspace_id')
      .eq('webhook_secret', token)
      .not('workspace_id', 'is', null)
      .limit(1)
      .maybeSingle();
    return data?.workspace_id ?? null;
  }

  private migrationHint(message: string): string {
    return /debug_/.test(message)
      ? 'O banco ainda não tem o modo preview: rode no SQL Editor o trecho 20261015120000_preview_debug.sql do supabase/schema_completo.sql.'
      : message;
  }

  async assertOwner(userId: string, workspaceId: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Area nao encontrada');
  }
}
