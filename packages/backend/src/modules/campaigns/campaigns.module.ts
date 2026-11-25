import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { CampaignActionsService } from './campaign-actions.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { MetaGraphClient } from './meta-graph.client';
import { WiapyModule } from '../wiapy/wiapy.module';

@Module({
  imports: [FinanceModule, WiapyModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignActionsService, MetaGraphClient],
  // Resumo e Regras usam os objetos, as ações e o cliente da Graph API.
  exports: [CampaignsService, CampaignActionsService, MetaGraphClient],
})
export class CampaignsModule {}
