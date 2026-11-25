import { Module } from '@nestjs/common';
import { DebugModule } from '../debug/debug.module';
import { SalesPushController, SalesPushCronController } from './sales-push.controller';
import { SalesPushService } from './sales-push.service';

@Module({
  imports: [DebugModule],
  controllers: [SalesPushController, SalesPushCronController],
  providers: [SalesPushService],
})
export class SalesPushModule {}
