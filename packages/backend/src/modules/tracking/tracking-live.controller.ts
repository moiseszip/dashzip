import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsUUID } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DebugService } from '../debug/debug.service';
import { buildLiveSnapshot, LiveCapiRow, LiveEventRow, LiveSessionRow, LiveSnapshot } from './live-visitors';

/** A aba mostra quem teve atividade nesta janela. */
const WINDOW_MS = 30 * 60_000;
/**
 * Corte em started_at, para a busca usar o índice (workspace_id, started_at).
 * Uma sessão ativa há mais que isso some da aba, o que na prática não acontece.
 */
const MAX_SESSION_AGE_MS = 12 * 60 * 60_000;
const MAX_SESSIONS = 300;
const MAX_CAPI = 200;

class LiveQueryDto {
  @IsUUID()
  workspace_id!: string;
}

/**
 * Acessos ao vivo. Fora do throttle global: o painel consulta a cada poucos
 * segundos enquanto a aba está aberta.
 */
@SkipThrottle()
@Controller('live')
@UseGuards(AuthGuard)
export class TrackingLiveController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly debug: DebugService,
  ) {}

  @Get()
  async live(@CurrentUser('id') userId: string, @Query() query: LiveQueryDto): Promise<LiveSnapshot> {
    const workspaceId = query.workspace_id;
    await this.debug.assertOwner(userId, workspaceId);

    const now = Date.now();
    const since = new Date(now - WINDOW_MS).toISOString();
    const client = this.supabase.getClient();

    // Os envios à Meta da janela, em paralelo com as sessões. Sem eles a aba
    // ainda serve: um erro aqui não derruba o resto.
    // (o builder só dispara no then; o Promise.resolve faz a busca sair já)
    const capiQuery = Promise.resolve(client
      .from('capi_events')
      .select(
        'id, event_name, session_id, status, error, created_at, sent_at, custom_data:payload->custom_data, source_url:payload->>event_source_url',
      )
      .eq('workspace_id', workspaceId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_CAPI));

    const { data: sessions, error } = await client
      .from('tracking_sessions')
      .select(
        'session_id, visitor_id, started_at, ended_at, landing_page, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, ad_id, device_type, country, region, city, pageviews, had_checkout_click',
      )
      .eq('workspace_id', workspaceId)
      .gte('started_at', new Date(now - MAX_SESSION_AGE_MS).toISOString())
      .gte('ended_at', since)
      .order('ended_at', { ascending: false })
      .limit(MAX_SESSIONS);
    if (error) throw new Error(error.message);

    const rows = (sessions ?? []) as LiveSessionRow[];
    let events: LiveEventRow[] = [];
    if (rows.length) {
      const { data, error: eventsError } = await client
        .from('tracking_events')
        .select('session_id, event_type, url, occurred_at')
        .eq('workspace_id', workspaceId)
        .in('session_id', rows.map((s) => s.session_id))
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(3000);
      if (eventsError) throw new Error(eventsError.message);
      events = (data ?? []) as LiveEventRow[];
    }

    const capi = await capiQuery;
    const capiRows = capi.error ? [] : ((capi.data ?? []) as unknown as LiveCapiRow[]);

    return buildLiveSnapshot(rows, events, now, capiRows);
  }
}
