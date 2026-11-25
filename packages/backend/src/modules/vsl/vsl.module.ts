import { Module } from '@nestjs/common';
import { VslController } from './vsl.controller';
import { VslService } from './vsl.service';

@Module({
  controllers: [VslController],
  providers: [VslService],
  exports: [VslService],
})
export class VslModule {}
