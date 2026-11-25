import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DEFAULT_LAYOUT, layoutError, SummaryLayout, SummaryLayoutV1, toLayoutV2 } from './summary-metrics';

/**
 * Preferências de tela por painel (dashboard_preferences): o layout do Resumo
 * e as colunas da tela de Campanhas.
 */

export type CampaignColumns = Partial<Record<'account' | 'campaign' | 'adset' | 'ad', {
  columns: string[];
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
}>>;

const COLUMN_KEY = /^[A-Za-z0-9_]{1,40}$/;

/** Valida as colunas de Campanhas. Devolve a mensagem do erro ou null. */
export function campaignColumnsError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Colunas inválidas.';
  for (const [level, config] of Object.entries(value as Record<string, unknown>)) {
    if (!['account', 'campaign', 'adset', 'ad'].includes(level)) return `Nível desconhecido: ${level}.`;
    const c = config as { columns?: unknown; sort?: { key?: unknown; dir?: unknown } | null };
    if (!c || !Array.isArray(c.columns) || c.columns.length > 60) return `Colunas de ${level} inválidas.`;
    if (c.columns.some((key) => typeof key !== 'string' || !COLUMN_KEY.test(key))) return `Coluna inválida em ${level}.`;
    if (new Set(c.columns).size !== c.columns.length) return `Coluna repetida em ${level}.`;
    if (c.sort != null) {
      if (typeof c.sort.key !== 'string' || !COLUMN_KEY.test(c.sort.key)) return `Ordenação inválida em ${level}.`;
      if (c.sort.dir !== 'asc' && c.sort.dir !== 'desc') return `Direção de ordenação inválida em ${level}.`;
    }
    const extra = Object.keys(c).filter((key) => key !== 'columns' && key !== 'sort');
    if (extra.length) return `Campo desconhecido em ${level}: ${extra[0]}.`;
  }
  return null;
}

const MAX_BYTES = 32_000;

@Injectable()
export class PreferencesService {
  constructor(private readonly supabase: SupabaseService) {}

  async summaryLayout(workspaceId: string) {
    const row = await this.read(workspaceId, 'summary_layout');
    const saved = row as SummaryLayout | SummaryLayoutV1 | null;
    // Layout antigo (v1) abre convertido para a grade; volta a ser gravado no próximo salvar.
    return { layout: saved && !layoutError(saved) ? toLayoutV2(saved) : DEFAULT_LAYOUT, saved: !!saved, defaultLayout: DEFAULT_LAYOUT };
  }

  async saveSummaryLayout(workspaceId: string, layout: unknown) {
    const error = layoutError(layout);
    if (error) throw new BadRequestException(error);
    await this.write(workspaceId, 'summary_layout', toLayoutV2(layout as SummaryLayout | SummaryLayoutV1));
    return this.summaryLayout(workspaceId);
  }

  async resetSummaryLayout(workspaceId: string) {
    await this.write(workspaceId, 'summary_layout', null);
    return this.summaryLayout(workspaceId);
  }

  async campaignColumns(workspaceId: string) {
    return { columns: ((await this.read(workspaceId, 'campaign_columns')) ?? {}) as CampaignColumns };
  }

  async saveCampaignColumns(workspaceId: string, columns: unknown) {
    const error = campaignColumnsError(columns);
    if (error) throw new BadRequestException(error);
    await this.write(workspaceId, 'campaign_columns', columns);
    return this.campaignColumns(workspaceId);
  }

  private async read(workspaceId: string, column: 'summary_layout' | 'campaign_columns') {
    const { data, error } = await this.supabase.getClient().from('dashboard_preferences')
      .select(column).eq('workspace_id', workspaceId).maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível ler as preferências.');
    return (data as Record<string, unknown> | null)?.[column] ?? null;
  }

  private async write(workspaceId: string, column: 'summary_layout' | 'campaign_columns', value: unknown) {
    if (value !== null && JSON.stringify(value).length > MAX_BYTES) throw new BadRequestException('Configuração grande demais.');
    const { error } = await this.supabase.getClient().from('dashboard_preferences')
      .upsert({ workspace_id: workspaceId, [column]: value, updated_at: new Date().toISOString() });
    if (error) throw new InternalServerErrorException('Não foi possível salvar as preferências.');
  }
}
