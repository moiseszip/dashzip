import { Module } from '@nestjs/common';
import { TrackingCollectController } from './tracking-collect.controller';
import { TrackingLiveController } from './tracking-live.controller';
import { HeatmapController, HeatmapPublicController } from './heatmap.controller';
import { HeatmapService } from './heatmap.service';
import { TrackingIngestService } from './tracking-ingest.service';
import { VisitorMatchingService } from './visitor-matching.service';
import { MetaCapiModule } from '../meta-capi/meta-capi.module';
import { DebugModule } from '../debug/debug.module';

/**
 * O "client" web do servidor: o snippet da página de vendas, a ingestão das
 * visitas e o casamento da visita com a venda que chega pelo webhook.
 *
 * Sem fila (BullMQ/Redis): a API roda como função da Vercel, que não mantém
 * um worker de pé. A ingestão grava direto, numa chamada só ao banco, e o
 * casamento roda dentro do próprio webhook. A retenção é um job do pg_cron.
 */
@Module({
  imports: [MetaCapiModule, DebugModule],
  controllers: [TrackingCollectController, TrackingLiveController, HeatmapController, HeatmapPublicController],
  providers: [TrackingIngestService, VisitorMatchingService, HeatmapService],
  exports: [VisitorMatchingService, HeatmapService],
})
export class TrackingModule {}
