import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SupabaseService } from '../../shared/services/supabase.service';
import { PreferencesService } from './preferences.service';
import { SummaryService } from './summary.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const split = (value?: string) => value?.split(',').map((item) => item.trim()).filter(Boolean);

class SummaryQueryDto {
  @IsOptional() @IsIn(['7', '30', '90']) days?: '7' | '30' | '90';
  @IsOptional() @Matches(DAY) since?: string;
  @IsOptional() @Matches(DAY) until?: string;
  @IsOptional() @Matches(/^(act_)?\d{5,22}(,(act_)?\d{5,22}){0,49}$/) accountIds?: string;
  /** Nomes de produto separados por vírgula (codificados na URL). */
  @IsOptional() @IsString() @Length(1, 4000) products?: string;
  @IsOptional() @Matches(/^[a-z0-9-]{2,40}(,[a-z0-9-]{2,40}){0,19}$/) platforms?: string;
  @IsOptional() @IsIn(['0', '1']) compare?: '0' | '1';
}

abstract class DashboardGuard {
  constructor(protected readonly supabase: SupabaseService) {}

  protected async assertDashboard(userId: string, workspaceId: string) {
    const { data, error } = await this.supabase.getClient().from('workspaces').select('id')
      .eq('id', workspaceId).eq('user_id', userId).is('redirect_workspace_id', null).maybeSingle();
    if (error || !data) throw new ForbiddenException('Painel indisponível para este usuário.');
  }
}

@Controller('summary/:workspaceId')
@UseGuards(AuthGuard)
export class SummaryController extends DashboardGuard {
  constructor(private readonly summaries: SummaryService, supabase: SupabaseService) {
    super(supabase);
  }

  @Get()
  async summary(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Query() q: SummaryQueryDto) {
    await this.assertDashboard(userId, id);
    return this.summaries.summary(id, {
      days: q.days ? Number(q.days) : undefined,
      since: q.since,
      until: q.until,
      accountIds: split(q.accountIds),
      products: split(q.products),
      platforms: split(q.platforms),
      compare: q.compare !== '0',
    });
  }
}

@Controller('preferences/:workspaceId')
@UseGuards(AuthGuard)
export class PreferencesController extends DashboardGuard {
  constructor(private readonly preferences: PreferencesService, supabase: SupabaseService) {
    super(supabase);
  }

  @Get('summary-layout')
  async layout(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string) {
    await this.assertDashboard(userId, id);
    return this.preferences.summaryLayout(id);
  }

  @Put('summary-layout')
  async saveLayout(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: { layout: unknown }) {
    await this.assertDashboard(userId, id);
    return this.preferences.saveSummaryLayout(id, body?.layout);
  }

  /** Restaurar o padrão: apaga o layout salvo. */
  @Delete('summary-layout')
  async resetLayout(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string) {
    await this.assertDashboard(userId, id);
    return this.preferences.resetSummaryLayout(id);
  }

  @Get('campaign-columns')
  async columns(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string) {
    await this.assertDashboard(userId, id);
    return this.preferences.campaignColumns(id);
  }

  @Put('campaign-columns')
  async saveColumns(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: { columns: unknown }) {
    await this.assertDashboard(userId, id);
    return this.preferences.saveCampaignColumns(id, body?.columns);
  }
}
