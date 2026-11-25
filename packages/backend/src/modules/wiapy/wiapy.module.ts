import { Module } from '@nestjs/common';
import { WiapyConnectionService } from './wiapy-connection.service';
import { WiapySalesService } from './wiapy-sales.service';
import { WiapyController } from './wiapy.controller';

/** Wiapy pelo MCP: conexão OAuth por painel e vendas lidas na hora. */
@Module({
  controllers: [WiapyController],
  providers: [WiapyConnectionService, WiapySalesService],
  exports: [WiapySalesService],
})
export class WiapyModule {}
