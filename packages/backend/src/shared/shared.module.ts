import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './services/supabase.service';
import { EncryptionService } from './services/encryption.service';
import { CacheService } from './services/cache.service';
import { WorkspaceRoutingService } from './services/workspace-routing.service';
import { WorkspaceTimezoneService } from './services/workspace-timezone.service';

@Global()
@Module({
  providers: [SupabaseService, EncryptionService, CacheService, WorkspaceRoutingService, WorkspaceTimezoneService],
  exports: [SupabaseService, EncryptionService, CacheService, WorkspaceRoutingService, WorkspaceTimezoneService],
})
export class SharedModule {}
