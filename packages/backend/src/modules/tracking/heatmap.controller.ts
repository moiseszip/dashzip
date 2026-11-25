import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DebugService } from '../debug/debug.service';
import { HeatmapService } from './heatmap.service';
import { filterValue, HEATMAP_DEVICES, HeatmapDevice, validDayRange } from './heatmap';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { dayRangeUtc } from '../../shared/helpers/timezone';
import { HEATMAP_SCRIPT } from './heatmap-script';
import { cleanUrl } from './collect-payload';

const DAYS = ['7', '30', '90'];

class WorkspaceDto {
  @IsUUID()
  workspace_id!: string;
}

class PagesQueryDto extends WorkspaceDto {
  @IsOptional()
  @IsIn(DAYS)
  days?: string;

  @IsOptional()
  @IsIn(HEATMAP_DEVICES)
  device?: HeatmapDevice;
}

class PageQueryDto extends PagesQueryDto {
  @IsString()
  @MaxLength(1000)
  url!: string;
}

function days(value?: string): number {
  return DAYS.includes(value ?? '') ? Number(value) : 30;
}

function device(value?: string): HeatmapDevice {
  return value === 'mobile' ? 'mobile' : 'desktop';
}

/** A aba "Mapa de calor" do painel. */
@Controller('heatmap')
@UseGuards(AuthGuard)
export class HeatmapController {
  constructor(
    private readonly heatmap: HeatmapService,
    private readonly debug: DebugService,
  ) {}

  @Get('pages')
  async pages(@CurrentUser('id') userId: string, @Query() q: PagesQueryDto) {
    await this.debug.assertOwner(userId, q.workspace_id);
    return { pages: await this.heatmap.pages(q.workspace_id, days(q.days), device(q.device)) };
  }

  @Get('page')
  async page(@CurrentUser('id') userId: string, @Query() q: PageQueryDto) {
    await this.debug.assertOwner(userId, q.workspace_id);
    const url = cleanUrl(q.url) ?? q.url;
    const { detail } = await this.heatmap.detail(q.workspace_id, url, days(q.days), device(q.device));
    return detail;
  }

  /** Token do link que abre a página real com o mapa desenhado por cima. */
  @Post('token')
  async token(@CurrentUser('id') userId: string, @Body() body: WorkspaceDto) {
    await this.debug.assertOwner(userId, body.workspace_id);
    return this.heatmap.token(body.workspace_id);
  }
}

/**
 * O lado público: o script que desenha e os dados dele. Chamados de dentro
 * da página do cliente, por isso o CORS aberto; os dados só saem com o token.
 */
@Controller('t')
export class HeatmapPublicController {
  constructor(
    private readonly heatmap: HeatmapService,
    private readonly timezones: WorkspaceTimezoneService,
  ) {}

  @Get('heatmap.js')
  script(@Res() res: FastifyReply): void {
    res.header('Content-Type', 'application/javascript; charset=utf-8');
    res.header('Cache-Control', 'public, max-age=300');
    res.status(200).send(HEATMAP_SCRIPT);
  }

  @Get('heatmap-data')
  async data(
    @Query('tid') tid: string | undefined,
    @Query('token') token: string | undefined,
    @Query('url') url: string | undefined,
    @Query('device') dev: string | undefined,
    @Query('days') d: string | undefined,
    @Query('since') since: string | undefined,
    @Query('until') until: string | undefined,
    @Query('src') src: string | undefined,
    @Query('cmp') cmp: string | undefined,
    @Res() res: FastifyReply,
  ): Promise<void> {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cache-Control', 'no-store');
    const workspaceId = (tid ?? '').trim().toLowerCase();
    const page = cleanUrl(url);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(workspaceId) || !page) {
      res.status(200).send({ ok: false, reason: 'pedido inválido' });
      return;
    }
    // Aba Hotjar: período exato (dias do fuso do painel) e filtros de origem/campanha.
    const range = validDayRange(since, until);
    let scope: Parameters<HeatmapService['overlay']>[5];
    if (range) {
      const tz = await this.timezones.get(workspaceId);
      scope = {
        range: dayRangeUtc(range.since, range.until, tz),
        filters: { device: device(dev), source: filterValue(src), campaign: filterValue(cmp) },
      };
    }
    res.status(200).send(await this.heatmap.overlay(workspaceId, token ?? '', page, days(d), device(dev), scope));
  }
}
