import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { normalizeOffers, offerMatcher, offersError, TestOffer } from './offers';

/** Acompanhamento de testes (docs/features/26-tests/tests.md). */
@Injectable()
export class TestsService {
  constructor(private readonly supabase: SupabaseService, private readonly campaigns: CampaignsService) {}

  async matrix(workspaceId: string, query: { days?: number; since?: string; until?: string }) {
    const [offers, matrix] = await Promise.all([this.readOffers(workspaceId), this.campaigns.campaignDays(workspaceId, query)]);
    const offerOf = offerMatcher(offers);
    return {
      ...matrix,
      rows: matrix.rows.map((row) => ({ ...row, offerId: offerOf(row.name, row.accountId) })),
      offers,
    };
  }

  changes(workspaceId: string) {
    return this.campaigns.recentChanges(workspaceId);
  }

  async offers(workspaceId: string) {
    return { offers: await this.readOffers(workspaceId) };
  }

  async saveOffers(workspaceId: string, value: unknown) {
    const error = offersError(value);
    if (error) throw new BadRequestException(error);
    const offers = normalizeOffers(value as TestOffer[]);
    const { error: dbError } = await this.supabase.getClient().from('dashboard_preferences')
      .upsert({ workspace_id: workspaceId, test_offers: offers, updated_at: new Date().toISOString() });
    if (dbError) throw new InternalServerErrorException('Não foi possível salvar as ofertas.');
    return { offers };
  }

  /** Tolera o banco sem a migration 20261122190000 (coluna ausente): sem ofertas. */
  private async readOffers(workspaceId: string): Promise<TestOffer[]> {
    const { data, error } = await this.supabase.getClient().from('dashboard_preferences')
      .select('test_offers').eq('workspace_id', workspaceId).maybeSingle();
    if (error?.code === '42703') return [];
    if (error) throw new InternalServerErrorException('Não foi possível ler as ofertas.');
    return Array.isArray(data?.test_offers) ? (data!.test_offers as TestOffer[]) : [];
  }
}
