import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { RulesController, RulesCronController } from './rules.controller';
import { RulesService } from './rules.service';

@Module({
  imports: [CampaignsModule],
  controllers: [RulesController, RulesCronController],
  providers: [RulesService],
})
export class RulesModule {}
