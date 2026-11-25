import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../shared/services/supabase.service';
import {
  buildPageDetail,
  ClickRow,
  HeatmapDevice,
  HeatmapPageDetail,
  overlayPoints,
  ScrollRow,
} from './heatmap';
import { safeEqual } from '../../shared/helpers/safe-equal';

/** O link do mapa (página real com ?stl_heatmap=<token>) vale por 12 horas. */
const TOKEN_HOURS = 12;
/** Token com menos que isso de vida é trocado por um novo ao abrir a aba. */
const TOKEN_MIN_LEFT_MS = 60 * 60_000;
const MAX_CLICK_ROWS = 5000;
const MAX_SCROLL_ROWS = 20000;
const TOKEN = /^[a-f0-9]{48}$/;

export interface HeatmapPageRow {
  url: string;
  views: number;
  avgDepth: number | null;
  reachedEnd: number;
  clicks: number;
}

/** Período em UTC: início inclusivo, fim exclusivo. */
export interface HeatmapRange {
  from: string;
  to: string;
}

/** Filtros da aba Hotjar; null = todos. */
export interface HeatmapFilters {
  device: HeatmapDevice | null;
  source: string | null;
  campaign: string | null;
}

export interface HeatmapScrollRow extends ScrollRow {
  seconds: number | null;
}

export type HeatmapOverlayData =
  | ({ ok: true; points: ReturnType<typeof overlayPoints> } & HeatmapPageDetail)
  | { ok: false; reason: string };

function since(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function migrationHint(message: string): string {
  return /heatmap_|does not exist|schema cache/i.test(message)
    ? 'O banco ainda não tem o mapa de calor: aplique a migration 20261107130000_mapa_de_calor.sql.'
    : /hotjar_|seconds/i.test(message)
    ? 'O banco ainda não tem a aba Hotjar: aplique a migration 20261123200000_hotjar.sql.'
    : message;
}

@Injectable()
export class HeatmapService {
  constructor(private readonly supabase: SupabaseService) {}

  async token(workspaceId: string): Promise<{ token: string; until: string }> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('workspaces')
      .select('heatmap_token, heatmap_until')
      .eq('id', workspaceId)
      .maybeSingle();
    if (error) throw new Error(migrationHint(error.message));

    const until = data?.heatmap_until ? new Date(data.heatmap_until).getTime() : 0;
    if (data?.heatmap_token && until - Date.now() > TOKEN_MIN_LEFT_MS) {
      return { token: data.heatmap_token, until: new Date(until).toISOString() };
    }

    const token = randomBytes(24).toString('hex');
    const next = new Date(Date.now() + TOKEN_HOURS * 3_600_000).toISOString();
    const { error: updateError } = await client
      .from('workspaces')
      .update({ heatmap_token: token, heatmap_until: next })
      .eq('id', workspaceId);
    if (updateError) throw new Error(migrationHint(updateError.message));
    return { token, until: next };
  }

  async pages(workspaceId: string, days: number, device: HeatmapDevice): Promise<HeatmapPageRow[]> {
    const { data, error } = await this.supabase.getClient().rpc('heatmap_pages', {
      p_workspace_id: workspaceId,
      p_since: since(days),
      p_device: device,
    });
    if (error) throw new Error(migrationHint(error.message));
    return ((data ?? []) as any[]).map((r) => ({
      url: r.url,
      views: Number(r.views) || 0,
      avgDepth: r.avg_depth === null ? null : Number(r.avg_depth),
      reachedEnd: Number(r.reached_end) || 0,
      clicks: Number(r.clicks) || 0,
    }));
  }

  async detail(
    workspaceId: string,
    url: string,
    days: number,
    device: HeatmapDevice,
  ): Promise<{ detail: HeatmapPageDetail; clicks: ClickRow[] }> {
    const client = this.supabase.getClient();
    const from = since(days);
    const [clicks, scrolls] = await Promise.all([
      client
        .from('heatmap_clicks')
        .select('selector, rx, ry, px, py, doc_w, label')
        .eq('workspace_id', workspaceId)
        .eq('url', url)
        .eq('device', device)
        .gte('created_at', from)
        .order('created_at', { ascending: false })
        .limit(MAX_CLICK_ROWS),
      client
        .from('heatmap_scrolls')
        .select('depth_pct, fold_pct')
        .eq('workspace_id', workspaceId)
        .eq('url', url)
        .eq('device', device)
        .gte('created_at', from)
        .order('created_at', { ascending: false })
        .limit(MAX_SCROLL_ROWS),
    ]);
    if (clicks.error) throw new Error(migrationHint(clicks.error.message));
    if (scrolls.error) throw new Error(migrationHint(scrolls.error.message));
    const clickRows = (clicks.data ?? []) as ClickRow[];
    return { detail: buildPageDetail(clickRows, (scrolls.data ?? []) as ScrollRow[]), clicks: clickRows };
  }

  private rpcParams(workspaceId: string, url: string | null, range: HeatmapRange, filters: HeatmapFilters) {
    return {
      p_workspace_id: workspaceId,
      ...(url !== null ? { p_url: url } : {}),
      p_from: range.from,
      p_to: range.to,
      p_device: filters.device,
      p_source: filters.source,
      p_campaign: filters.campaign,
    };
  }

  /** Cliques da página no período, com os filtros da aba Hotjar. */
  async clicksInRange(workspaceId: string, url: string, range: HeatmapRange, filters: HeatmapFilters): Promise<ClickRow[]> {
    const { data, error } = await this.supabase.getClient().rpc('hotjar_clicks', this.rpcParams(workspaceId, url, range, filters));
    if (error) throw new Error(migrationHint(error.message));
    return ((data ?? []) as any[]).map((r) => ({
      selector: r.selector ?? null,
      rx: r.rx === null ? null : Number(r.rx),
      ry: r.ry === null ? null : Number(r.ry),
      px: Number(r.px) || 0,
      py: Number(r.py) || 0,
      doc_w: Number(r.doc_w) || 0,
      label: r.label ?? null,
    }));
  }

  /** Rolagem e tempo de cada carregamento da página no período. */
  async scrollsInRange(workspaceId: string, url: string, range: HeatmapRange, filters: HeatmapFilters): Promise<HeatmapScrollRow[]> {
    const { data, error } = await this.supabase.getClient().rpc('hotjar_scrolls', this.rpcParams(workspaceId, url, range, filters));
    if (error) throw new Error(migrationHint(error.message));
    return ((data ?? []) as any[]).map((r) => ({
      depth_pct: Number(r.depth_pct) || 0,
      fold_pct: r.fold_pct === null ? null : Number(r.fold_pct),
      seconds: r.seconds === null || r.seconds === undefined ? null : Number(r.seconds),
    }));
  }

  /** Dados do desenho sobre a página: só com o token do mapa válido. */
  async overlay(
    workspaceId: string,
    token: string,
    url: string,
    days: number,
    device: HeatmapDevice,
    /** Aba Hotjar: período exato e filtros, no lugar dos últimos `days` dias. */
    scope?: { range: HeatmapRange; filters: HeatmapFilters },
  ): Promise<HeatmapOverlayData> {
    if (!TOKEN.test(token)) return { ok: false, reason: 'link do mapa inválido' };
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('heatmap_token, heatmap_until')
      .eq('id', workspaceId)
      .maybeSingle();
    if (error || !data?.heatmap_token || !safeEqual(token, data.heatmap_token)) {
      return { ok: false, reason: 'link do mapa inválido: abra de novo pelo painel' };
    }
    if (!data.heatmap_until || new Date(data.heatmap_until).getTime() < Date.now()) {
      return { ok: false, reason: 'link do mapa expirou: abra de novo pelo painel' };
    }
    try {
      if (scope) {
        const [clicks, scrolls] = await Promise.all([
          this.clicksInRange(workspaceId, url, scope.range, scope.filters),
          this.scrollsInRange(workspaceId, url, scope.range, scope.filters),
        ]);
        return { ok: true, ...buildPageDetail(clicks, scrolls), points: overlayPoints(clicks) };
      }
      const { detail, clicks } = await this.detail(workspaceId, url, days, device);
      return { ok: true, ...detail, points: overlayPoints(clicks) };
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? 'erro ao ler os dados' };
    }
  }
}
