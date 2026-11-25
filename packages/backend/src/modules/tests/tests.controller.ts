import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SupabaseService } from '../../shared/services/supabase.service';
import { TestsService } from './tests.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class MatrixQueryDto {
  @IsOptional() @IsIn(['meta']) source?: 'meta';
  @IsOptional() @IsIn(['7', '30', '90']) days?: '7' | '30' | '90';
  @IsOptional() @Matches(DAY) since?: string;
  @IsOptional() @Matches(DAY) until?: string;
}

@Controller('tests/:workspaceId')
@UseGuards(AuthGuard)
export class TestsController {
  constructor(private readonly tests: TestsService, private readonly supabase: SupabaseService) {}

  @Get('matrix')
  async matrix(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Query() q: MatrixQueryDto) {
    await this.assertDashboard(userId, id);
    return this.tests.matrix(id, { days: q.days ? Number(q.days) : undefined, since: q.since, until: q.until });
  }

  @Get('changes')
  async changes(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string) {
    await this.assertDashboard(userId, id);
    return this.tests.changes(id);
  }

  @Get('offers')
  async offers(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string) {
    await this.assertDashboard(userId, id);
    return this.tests.offers(id);
  }

  @Put('offers')
  async saveOffers(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: { offers: unknown }) {
    await this.assertDashboard(userId, id);
    return this.tests.saveOffers(id, body?.offers);
  }

  private async assertDashboard(userId: string, workspaceId: string) {
    const { data, error } = await this.supabase.getClient().from('workspaces').select('id')
      .eq('id', workspaceId).eq('user_id', userId).is('redirect_workspace_id', null).maybeSingle();
    if (error || !data) throw new ForbiddenException('Painel indisponível para este usuário.');
  }
}
