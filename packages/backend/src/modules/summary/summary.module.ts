import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { FinanceModule } from '../finance/finance.module';
import { PreferencesService } from './preferences.service';
import { PreferencesController, SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';
import { WiapyModule } from '../wiapy/wiapy.module';

@Module({
  imports: [FinanceModule, CampaignsModule, WiapyModule],
  controllers: [SummaryController, PreferencesController],
  providers: [SummaryService, PreferencesService],
})
export class SummaryModule {}
