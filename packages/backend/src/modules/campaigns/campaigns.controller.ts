import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Length, Matches, ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CampaignActionsService } from './campaign-actions.service';
import { CampaignsService } from './campaigns.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Fonte de tráfego. Só a Meta existe por enquanto; as outras entram com a integração. */
export const TRAFFIC_SOURCES = ['meta'] as const;

class ObjectsQueryDto {
  @IsOptional() @IsIn([...TRAFFIC_SOURCES])
  source?: (typeof TRAFFIC_SOURCES)[number];

  @IsIn(['account', 'campaign', 'adset', 'ad'])
  level!: 'account' | 'campaign' | 'adset' | 'ad';

  @IsOptional() @IsIn(['7', '30', '90'])
  days?: '7' | '30' | '90';

  @IsOptional() @Matches(DAY)
  since?: string;

  @IsOptional() @Matches(DAY)
  until?: string;

  @IsOptional() @Matches(/^(act_)?\d{5,25}(,(act_)?\d{5,25}){0,199}$/)
  parentIds?: string;

  @IsOptional() @Matches(/^(ACTIVE|PAUSED|ARCHIVED|DELETED)(,(ACTIVE|PAUSED|ARCHIVED|DELETED)){0,3}$/)
  status?: string;

  @IsOptional() @IsString() @Length(0, 100)
  q?: string;
}

class ActionItemDto {
  @Matches(/^\d{5,25}$/)
  objectId!: string;

  @IsIn(['campaign', 'adset', 'ad'])
  level!: 'campaign' | 'adset' | 'ad';

  @IsIn(['pause', 'activate', 'set_daily_budget', 'set_lifetime_budget'])
  action!: 'pause' | 'activate' | 'set_daily_budget' | 'set_lifetime_budget';

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 })
  value?: number;
}

class ActionsDto {
  @IsOptional() @IsIn([...TRAFFIC_SOURCES])
  source?: (typeof TRAFFIC_SOURCES)[number];

  @IsOptional() @IsBoolean()
  validateOnly?: boolean;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40)
  @ValidateNested({ each: true }) @Type(() => ActionItemDto)
  items!: ActionItemDto[];
}

class TokenDto {
  @IsOptional() @IsString() @Length(20, 2_000) @Matches(/^\S+$/)
  accessToken?: string;
}

class AccountsDto extends TokenDto {
  @IsArray() @ArrayMaxSize(50)
  @Matches(/^(act_)?\d{5,22}$/, { each: true })
  accountIds!: string[];
}

@Controller('campaigns/:workspaceId')
@UseGuards(AuthGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly actions: CampaignActionsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('objects')
  async objects(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Query() q: ObjectsQueryDto) {
    await this.assertDashboard(userId, id);
    return this.campaigns.objects(id, {
      level: q.level,
      days: q.days ? Number(q.days) : undefined,
      since: q.since,
      until: q.until,
      parentIds: q.parentIds?.split(','),
      status: q.status?.split(','),
      q: q.q,
      liveSales: true,
    });
  }

  @Post('actions')
  async run(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: ActionsDto) {
    await this.assertDashboard(userId, id);
    return this.actions.run(id, body.items, body.validateOnly === true);
  }

  @Get('available-accounts')
  async available(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string) {
    await this.assertDashboard(userId, id);
    return this.actions.availableAccounts(userId, id);
  }

  /** Lista as contas de um token novo, sem salvar. A gravação é no PUT /accounts. */
  @Post('available-accounts')
  async availableForToken(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: TokenDto) {
    await this.assertDashboard(userId, id);
    return this.actions.availableAccounts(userId, id, body.accessToken);
  }

  @Put('accounts')
  async setAccounts(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: AccountsDto) {
    await this.assertDashboard(userId, id);
    return this.actions.setAccounts(userId, id, body.accountIds, body.accessToken);
  }

  private async assertDashboard(userId: string, workspaceId: string) {
    const { data, error } = await this.supabase.getClient().from('workspaces').select('id')
      .eq('id', workspaceId).eq('user_id', userId).is('redirect_workspace_id', null).maybeSingle();
    if (error || !data) throw new ForbiddenException('Painel indisponível para este usuário.');
  }
}
