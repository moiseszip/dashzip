import { BadRequestException, Controller, ForbiddenException, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { validDayRange } from '../tracking/heatmap';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SupabaseService } from '../../shared/services/supabase.service';
import type { VslVersion } from './vsl.aggregate';
import { VslService } from './vsl.service';

class VslQuery {
  @IsOptional() @IsIn(['1', '3', '7', '14', '30']) days?: string;
  @IsOptional() @IsIn(['br', 'us']) market?: 'br' | 'us';
  @IsOptional() @Matches(/^(a|b|quiz)(,(a|b|quiz)){0,2}$/) versions?: string;
  /** Período exato (aba Hotjar), no lugar de `days`. Os dois juntos ou nenhum. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) since?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) until?: string;
}

@Controller('vsl/:workspaceId')
@UseGuards(AuthGuard)
export class VslController {
  constructor(private readonly vsl: VslService, private readonly supabase: SupabaseService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async report(
    @CurrentUser('id') userId: string,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: VslQuery,
  ) {
    const { data, error } = await this.supabase.getClient().from('workspaces').select('id')
      .eq('id', workspaceId).eq('user_id', userId).is('redirect_workspace_id', null).maybeSingle();
    if (error || !data) throw new ForbiddenException('Painel indisponível para este usuário.');

    let range: { since: string; until: string } | undefined;
    if (query.since || query.until) {
      range = validDayRange(query.since, query.until) ?? undefined;
      if (!range) throw new BadRequestException('Período inválido.');
    }
    return this.vsl.report(
      workspaceId,
      Number(query.days ?? '7'),
      query.market ?? 'br',
      (query.versions?.split(',') ?? []) as VslVersion[],
      new Date(),
      range,
    );
  }
}
