import { Module } from '@nestjs/common';
import { PasskeysController } from './passkeys.controller';
import { PasskeysService } from './passkeys.service';
import { PasskeysRepository, SupabasePasskeysRepository } from './passkeys.repository';

@Module({
  controllers: [PasskeysController],
  providers: [PasskeysService, { provide: PasskeysRepository, useClass: SupabasePasskeysRepository }],
})
export class PasskeysModule {}
