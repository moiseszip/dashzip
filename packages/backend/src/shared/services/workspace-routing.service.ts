import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from './cache.service';
import { SupabaseService } from './supabase.service';

const WORKSPACE_TTL_MS = 60_000;

@Injectable()
export class WorkspaceRoutingService {
  private readonly logger = new Logger(WorkspaceRoutingService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async resolve(workspaceId: string): Promise<string | null> {
    const key = `tracking:workspace-route:${workspaceId}`;
    const cached = this.cache.get<string | false>(key);
    if (cached !== null) return cached || null;

    const { data, error } = await this.supabase.getClient()
      .from('workspaces')
      .select('id, redirect_workspace_id')
      .eq('id', workspaceId)
      .maybeSingle();

    // A indisponibilidade temporária do banco não deve invalidar snippets no cache.
    if (error) {
      this.logger.warn(`Falha ao resolver o painel ${workspaceId}: ${error.message}`);
      return workspaceId;
    }

    const target = data?.redirect_workspace_id ?? data?.id ?? null;
    this.cache.set(key, target ?? false, WORKSPACE_TTL_MS);
    return target;
  }
}
