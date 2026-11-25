import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';

@Module({
  imports: [CampaignsModule],
  controllers: [TestsController],
  providers: [TestsService],
})
export class TestsModule {}
