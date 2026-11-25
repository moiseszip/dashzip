import { Module } from '@nestjs/common';
import { DebugModule } from '../debug/debug.module';
import { TrackingModule } from '../tracking/tracking.module';
import { VslModule } from '../vsl/vsl.module';
import { HotjarController } from './hotjar.controller';
import { HotjarService } from './hotjar.service';

/** Aba Hotjar: comportamento nas páginas (mapa de calor, retenção, quiz e VSL). */
@Module({
  imports: [DebugModule, TrackingModule, VslModule],
  controllers: [HotjarController],
  providers: [HotjarService],
})
export class HotjarModule {}
