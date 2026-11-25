import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { GRAPH_API_URL } from '../../shared/constants/meta-api';
import { CacheService } from '../../shared/services/cache.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { CampaignDay, shiftDay } from './finance-totals';

interface MetaAccount {
  name: string;
  currency: string;
  timezone_name?: string;
  account_status?: number;
}

interface InsightsPage {
  data: {
    campaign_id: string;
    campaign_name: string;
    date_start: string;
    spend: string;
  }[];
  paging?: { next?: string; cursors?: { after?: string } };
}

const PTAX_URL = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)';
const CACHE_MS = 10 * 60_000;
const MAX_INSIGHTS_PAGES = 80;

@Injectable()
export class MetaSpendService {
  constructor(private readonly encryption: EncryptionService, private readonly cache: CacheService) {}

  async verify(accountId: string, token: string) {
    const [account] = await Promise.all([
      this.graph<MetaAccount>(accountId, '', token, { fields: 'name,currency,timezone_name,account_status' }),
      this.graph<InsightsPage>(accountId, '/insights', token, { fields: 'spend', date_preset: 'last_7d', limit: '1' }),
    ]);
    if (!account.name || !/^[A-Z]{3}$/.test(account.currency)) {
      throw new BadRequestException('A Meta não retornou o nome e a moeda da conta.');
    }
    return account;
  }

  async campaignDays(connectionId: string, accountId: string, secret: string, since: string, until: string) {
    const cacheKey = `finance:media:${connectionId}:${since}:${until}`;
    const cached = this.cache.get<CampaignDay[]>(cacheKey);
    if (cached !== null) return cached;

    const token = this.encryption.decryptIfNeeded(secret);
    const rows: CampaignDay[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_INSIGHTS_PAGES; page++) {
      const result = await this.graph<InsightsPage>(accountId, '/insights', token, {
        fields: 'campaign_id,campaign_name,date_start,spend',
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify({ since, until }),
        limit: '250',
        ...(after ? { after } : {}),
      });
      if (!Array.isArray(result.data)) throw new BadGatewayException('Resposta inválida da Meta.');
      for (const record of result.data) {
        const spend = Number(record.spend);
        if (!record.campaign_id || !/^\d{4}-\d{2}-\d{2}$/.test(record.date_start)
          || typeof record.spend !== 'string' || !record.spend.trim() || !Number.isFinite(spend) || spend < 0) {
          throw new BadGatewayException('A Meta retornou uma linha de gasto inválida.');
        }
        rows.push({
          campaignId: record.campaign_id, campaignName: record.campaign_name || record.campaign_id,
          day: record.date_start, spend,
        });
      }
      if (!result.paging?.next) {
        this.cache.set(cacheKey, rows, CACHE_MS);
        return rows;
      }
      const next = result.paging.cursors?.after;
      if (!next || next === after) throw new BadGatewayException('A paginação da Meta não avançou.');
      after = next;
    }
    throw new BadGatewayException('A Meta retornou mais páginas do que este período pode carregar.');
  }

  async ptax(since: string, until: string): Promise<Map<string, number>> {
    const cacheKey = `finance:ptax:${since}:${until}`;
    const cached = this.cache.get<Map<string, number>>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      '@dataInicial': `'${this.bcbDay(shiftDay(since, -7))}'`,
      '@dataFinalCotacao': `'${this.bcbDay(until)}'`,
      '$select': 'cotacaoVenda,dataHoraCotacao',
      '$format': 'json',
      '$top': '200',
    });
    const response = await fetch(`${PTAX_URL}?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error('PTAX indisponível');
    const body = await response.json() as { value: { cotacaoVenda: number; dataHoraCotacao: string }[] };
    const quotes = new Map<string, number>();
    const ordered = body.value.sort((a, b) => a.dataHoraCotacao.localeCompare(b.dataHoraCotacao));
    for (const quote of ordered) {
      if (Number.isFinite(quote.cotacaoVenda) && quote.cotacaoVenda > 0) {
        quotes.set(quote.dataHoraCotacao.slice(0, 10), quote.cotacaoVenda);
      }
    }
    if (!quotes.size) throw new Error('PTAX sem cotações');
    this.cache.set(cacheKey, quotes, CACHE_MS);
    return quotes;
  }

  private async graph<T>(id: string, path: string, token: string, params: Record<string, string>): Promise<T> {
    const account = id.replace(/^act_/, '');
    if (!/^\d{5,22}$/.test(account)) throw new BadRequestException('ID de conta de anúncios inválido.');
    const response = await fetch(`${GRAPH_API_URL}/act_${account}${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) {
        throw new BadRequestException('A Meta recusou a leitura. Confira o ID da conta e a permissão ads_read.');
      }
      throw new BadGatewayException('A Meta não respondeu à consulta de anúncios.');
    }
    return await response.json() as T;
  }

  private bcbDay(iso: string) {
    const [year, month, day] = iso.split('-');
    return `${month}-${day}-${year}`;
  }
}
