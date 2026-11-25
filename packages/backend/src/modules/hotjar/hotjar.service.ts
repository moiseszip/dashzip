import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { dayRangeUtc } from '../../shared/helpers/timezone';
import { HeatmapFilters, HeatmapRange, HeatmapService } from '../tracking/heatmap.service';
import { topElements, TopElement } from '../tracking/heatmap';
import { VslService } from '../vsl/vsl.service';
import {
  buildPurchaseTiming,
  buildQuizFunnel,
  buildRetention,
  PurchaseTiming,
  PurchaseTimingRow,
  PageRetention,
  QuizFunnel,
  QuizRow,
  vslForUrl,
} from './hotjar.aggregate';

export interface HotjarPage {
  url: string;
  views: number;
  avgDepth: number | null;
  reachedEnd: number;
  clicks: number;
  quiz: boolean;
  vsl: { market: 'br' | 'us'; version: 'a' | 'b' | 'quiz' } | null;
}

export interface HotjarFilterOption {
  value: string;
  sessions: number;
}

export interface HotjarPageDetail {
  retention: PageRetention;
  clicks: { total: number; topElements: TopElement[] };
  quiz: QuizFunnel | null;
  vsl: HotjarPage['vsl'];
}

function hint(message: string): string {
  if (/hotjar_purchase_timing/i.test(message)) {
    return 'O banco ainda não tem o "Tempo até a compra": aplique a migration 20261123220000_hotjar_purchase_timing.sql.';
  }
  return /hotjar_|seconds|does not exist|schema cache/i.test(message)
    ? 'O banco ainda não tem a aba Hotjar: aplique a migration 20261123200000_hotjar.sql.'
    : message;
}

/**
 * A aba Hotjar: mapa de calor, retenção da página, funil do quiz e a VSL da
 * página. Lê o que o coletor já grava (heatmap_* e tracking_events); nada de
 * cópia nem histórico novo.
 */
@Injectable()
export class HotjarService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly heatmap: HeatmapService,
    private readonly vsl: VslService,
    private readonly timezones: WorkspaceTimezoneService,
  ) {}

  async range(workspaceId: string, since: string, until: string): Promise<HeatmapRange> {
    return dayRangeUtc(since, until, await this.timezones.get(workspaceId));
  }

  private vslOf(workspaceId: string, url: string): HotjarPage['vsl'] {
    if (!this.vsl.isEnabled(workspaceId)) return null;
    const found = vslForUrl(url, this.vsl.hosts());
    return found ? { market: found.market, version: found.version } : null;
  }

  async pages(workspaceId: string, range: HeatmapRange, filters: HeatmapFilters) {
    const client = this.supabase.getClient();
    const [pages, options] = await Promise.all([
      client.rpc('hotjar_pages', {
        p_workspace_id: workspaceId,
        p_from: range.from,
        p_to: range.to,
        p_device: filters.device,
        p_source: filters.source,
        p_campaign: filters.campaign,
      }),
      client.rpc('hotjar_filters', {
        p_workspace_id: workspaceId,
        p_from: range.from,
        p_to: range.to,
        p_device: filters.device,
      }),
    ]);
    if (pages.error) throw new Error(hint(pages.error.message));
    if (options.error) throw new Error(hint(options.error.message));

    const rows: HotjarPage[] = ((pages.data ?? []) as any[]).map((r) => ({
      url: r.url,
      views: Number(r.views) || 0,
      avgDepth: r.avg_depth === null ? null : Number(r.avg_depth),
      reachedEnd: Number(r.reached_end) || 0,
      clicks: Number(r.clicks) || 0,
      quiz: Number(r.quiz_sessions) > 0,
      vsl: this.vslOf(workspaceId, r.url),
    }));
    const opts = (options.data ?? []) as { kind: string; value: string; sessions: number }[];
    const pick = (kind: string): HotjarFilterOption[] =>
      opts.filter((o) => o.kind === kind && o.value).map((o) => ({ value: o.value, sessions: Number(o.sessions) || 0 }));
    return { pages: rows, filters: { sources: pick('source'), campaigns: pick('campaign') } };
  }

  async page(workspaceId: string, url: string, range: HeatmapRange, filters: HeatmapFilters): Promise<HotjarPageDetail> {
    const [clicks, scrolls, quiz] = await Promise.all([
      this.heatmap.clicksInRange(workspaceId, url, range, filters),
      this.heatmap.scrollsInRange(workspaceId, url, range, filters),
      this.supabase.getClient().rpc('hotjar_quiz', {
        p_workspace_id: workspaceId,
        p_url: url,
        p_from: range.from,
        p_to: range.to,
        p_device: filters.device,
        p_source: filters.source,
        p_campaign: filters.campaign,
      }),
    ]);
    if (quiz.error) throw new Error(hint(quiz.error.message));
    const quizRows: QuizRow[] = ((quiz.data ?? []) as any[]).map((r) => ({
      session_id: String(r.session_id),
      step: String(r.step),
      idx: r.idx === null || r.idx === undefined ? null : Number(r.idx),
      first_at: String(r.first_at),
    }));
    return {
      retention: buildRetention(scrolls),
      clicks: { total: clicks.length, topElements: topElements(clicks) },
      quiz: buildQuizFunnel(quizRows),
      vsl: this.vslOf(workspaceId, url),
    };
  }

  /**
   * Tempo até a compra: do primeiro carregamento da página na sessão até o
   * clique no checkout e até a aprovação, para as vendas aprovadas com sessão
   * que começaram o checkout nesta página. Calculado na hora.
   */
  async purchaseTiming(workspaceId: string, url: string, range: HeatmapRange, filters: HeatmapFilters): Promise<PurchaseTiming> {
    const { data, error } = await this.supabase.getClient().rpc('hotjar_purchase_timing', {
      p_workspace_id: workspaceId,
      p_url: url,
      p_from: range.from,
      p_to: range.to,
      p_device: filters.device,
      p_source: filters.source,
      p_campaign: filters.campaign,
    });
    if (error) throw new Error(hint(error.message));
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const rows: PurchaseTimingRow[] = ((data ?? []) as any[]).map((r) => ({
      kind: r.kind,
      to_checkout: num(r.to_checkout),
      to_purchase: num(r.to_purchase),
      n: Number(r.n) || 0,
    }));
    return buildPurchaseTiming(rows);
  }
}
