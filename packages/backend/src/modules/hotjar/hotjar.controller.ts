import { BadRequestException, Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DebugService } from '../debug/debug.service';
import { cleanUrl } from '../tracking/collect-payload';
import { filterValue, HEATMAP_DEVICES, HeatmapDevice, validDayRange } from '../tracking/heatmap';
import { HotjarService } from './hotjar.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class PagesQueryDto {
  @IsUUID()
  workspace_id!: string;

  @Matches(DAY)
  since!: string;

  @Matches(DAY)
  until!: string;

  @IsOptional()
  @IsIn(HEATMAP_DEVICES)
  device?: HeatmapDevice;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  campaign?: string;
}

class PageQueryDto extends PagesQueryDto {
  @IsString()
  @MaxLength(1000)
  url!: string;
}

/** A aba Hotjar do painel (docs/features/27-hotjar). */
@Controller('hotjar')
@UseGuards(AuthGuard)
export class HotjarController {
  constructor(
    private readonly hotjar: HotjarService,
    private readonly debug: DebugService,
  ) {}

  private async scope(userId: string, q: PagesQueryDto) {
    const days = validDayRange(q.since, q.until);
    if (!days) throw new BadRequestException('Período inválido (até 92 dias).');
    await this.debug.assertOwner(userId, q.workspace_id);
    return {
      range: await this.hotjar.range(q.workspace_id, days.since, days.until),
      filters: {
        device: q.device ?? 'mobile',
        source: filterValue(q.source),
        campaign: filterValue(q.campaign),
      },
    };
  }

  @Get('pages')
  @Header('Cache-Control', 'private, no-store')
  async pages(@CurrentUser('id') userId: string, @Query() q: PagesQueryDto) {
    const { range, filters } = await this.scope(userId, q);
    return this.hotjar.pages(q.workspace_id, range, filters);
  }

  @Get('page')
  @Header('Cache-Control', 'private, no-store')
  async page(@CurrentUser('id') userId: string, @Query() q: PageQueryDto) {
    const { range, filters } = await this.scope(userId, q);
    const url = cleanUrl(q.url);
    if (!url) throw new BadRequestException('Página inválida.');
    return this.hotjar.page(q.workspace_id, url, range, filters);
  }

  @Get('purchase-timing')
  @Header('Cache-Control', 'private, no-store')
  async purchaseTiming(@CurrentUser('id') userId: string, @Query() q: PageQueryDto) {
    const { range, filters } = await this.scope(userId, q);
    const url = cleanUrl(q.url);
    if (!url) throw new BadRequestException('Página inválida.');
    return this.hotjar.purchaseTiming(q.workspace_id, url, range, filters);
  }
}
