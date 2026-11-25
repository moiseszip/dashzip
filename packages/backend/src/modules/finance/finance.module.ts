import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { MetaSpendService } from './meta-spend.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, MetaSpendService],
  // Campanhas reaproveita o vínculo de contas, a PTAX e o cálculo de vendas.
  exports: [FinanceService, MetaSpendService],
})
export class FinanceModule {}
