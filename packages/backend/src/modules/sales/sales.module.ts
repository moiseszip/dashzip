import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { TrackingModule } from '../tracking/tracking.module';
import { DebugModule } from '../debug/debug.module';
import { FinanceModule } from '../finance/finance.module';
import { WiapyModule } from '../wiapy/wiapy.module';

@Module({
  imports: [TrackingModule, DebugModule, FinanceModule, WiapyModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
