import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_TIMEZONE, normalizeTimezone } from '../helpers/timezone';
import { CacheService } from './cache.service';
import { SupabaseService } from './supabase.service';

const TTL_MS = 60_000;

/**
 * Lê o fuso do painel (`workspaces.timezone`) com cache curto. Falha de leitura
 * ou coluna ausente caem em São Paulo, o comportamento de antes do fuso existir.
 */
@Injectable()
export class WorkspaceTimezoneService {
  private readonly logger = new Logger(WorkspaceTimezoneService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async get(workspaceId: string): Promise<string> {
    const key = WorkspaceTimezoneService.key(workspaceId);
    const cached = this.cache.get<string>(key);
    if (cached) return cached;
    const { data, error } = await this.supabase.getClient()
      .from('workspaces').select('timezone').eq('id', workspaceId).maybeSingle();
    if (error) {
      this.logger.warn(`Fuso do painel ${workspaceId} indisponível: ${error.message}`);
      return DEFAULT_TIMEZONE;
    }
    const timeZone = normalizeTimezone((data as { timezone?: string } | null)?.timezone);
    this.cache.set(key, timeZone, TTL_MS);
    return timeZone;
  }

  /** Depois de salvar um fuso novo, a próxima leitura já vem do banco. */
  invalidate(workspaceId: string) {
    this.cache.invalidate(WorkspaceTimezoneService.key(workspaceId));
  }

  private static key(workspaceId: string) {
    return `workspace-timezone:${workspaceId}`;
  }
}
