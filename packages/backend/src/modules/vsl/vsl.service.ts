import { BadGatewayException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_TIMEZONE, dayInTimezone, dayRangeUtc, dayStartUtc } from '../../shared/helpers/timezone';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { parseVslHosts } from '../hotjar/hotjar.aggregate';
import { buildReport, VSL_MARKETS, type VslMarket, type VslRow, type VslVersion } from './vsl.aggregate';

const PAGE_SIZE = 1000;
const MAX_ROWS = 200_000;
/** Data de hoje (YYYY-MM-DD) no fuso do painel; sem fuso, Brasília. */
export function todayBrt(now = new Date(), timeZone: string = DEFAULT_TIMEZONE) {
  return dayInTimezone(now, timeZone);
}

export function addDays(day: string, delta: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * Lê as visitas da VSL no Supabase de origem (`VSL_SOURCE_*`, o mesmo que as
 * LPs gravam) e agrega na hora. O Dash.zip não guarda cópia: cada abertura da
 * aba consulta a fonte.
 */
@Injectable()
export class VslService {
  constructor(private readonly config: ConfigService, private readonly timezones: WorkspaceTimezoneService) {}

  /** Tabela das visitas no Supabase de origem (`VSL_SOURCE_TABLE`, padrão `vsl_views`). */
  private sourceTable() {
    const table = this.config.get<string>('VSL_SOURCE_TABLE')?.trim() ?? '';
    return /^[a-z_][a-z0-9_]{0,62}$/.test(table) ? table : 'vsl_views';
  }

  /** Domínios das LPs com VSL (`VSL_HOSTS`). */
  hosts() {
    return parseVslHosts(this.config.get<string>('VSL_HOSTS'));
  }

  isEnabled(workspaceId: string) {
    const enabled = (this.config.get<string>('VSL_ENABLED_WORKSPACE_ID') ?? '')
      .split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
    return enabled.includes(workspaceId.toLowerCase());
  }

  /**
   * `range` (dias inclusivos no fuso do painel) troca os últimos `days` dias
   * por um período exato: é o que a aba Hotjar manda, com o seletor padrão.
   */
  async report(
    workspaceId: string,
    days: number,
    market: VslMarket,
    versions: VslVersion[],
    now = new Date(),
    range?: { since: string; until: string },
  ) {
    if (!this.isEnabled(workspaceId)) {
      throw new ForbiddenException('A retenção de VSL não está habilitada para este workspace.');
    }

    const base = this.config.get<string>('VSL_SOURCE_SUPABASE_URL')?.trim() ?? '';
    const key = this.config.get<string>('VSL_SOURCE_SERVICE_ROLE_KEY')?.trim() ?? '';
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base) || !key) {
      throw new ServiceUnavailableException('A fonte de retenção de VSL ainda precisa ser configurada.');
    }

    const timeZone = await this.timezones.get(workspaceId);
    const until = range?.until ?? todayBrt(now, timeZone);
    const since = range?.since ?? addDays(until, -(days - 1));
    const bounds = range ? dayRangeUtc(since, until, timeZone) : { from: dayStartUtc(since, timeZone).toISOString(), to: null };
    const rows = await this.fetchRows(base, key, VSL_MARKETS[market].video, bounds.from, bounds.to);
    const { selected, versions: groups, total } = buildReport(rows, market, versions);
    return { since, until, market, selected, versions: groups, total };
  }

  private async fetchRows(base: string, key: string, video: string, start: string, end: string | null = null): Promise<VslRow[]> {
    const rows: VslRow[] = [];
    try {
      for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const url = new URL(`/rest/v1/${this.sourceTable()}`, base);
        url.searchParams.set('select', 'pagina,video,duracao,som,seg_som,cta,utm_content');
        url.searchParams.set('video', `eq.${video}`);
        url.searchParams.set('criado_em', `gte.${start}`);
        if (end) url.searchParams.append('criado_em', `lt.${end}`);
        url.searchParams.set('order', 'criado_em.asc,sessao.asc');
        url.searchParams.set('limit', String(PAGE_SIZE));
        url.searchParams.set('offset', String(offset));
        const response = await fetch(url, {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const page = (await response.json()) as VslRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
    } catch {
      throw new BadGatewayException('Não foi possível consultar a retenção de VSL agora.');
    }
    return rows;
  }
}
