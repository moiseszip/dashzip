import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { isValidTimezone } from '../../shared/helpers/timezone';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly timezones: WorkspaceTimezoneService,
  ) {}

  async list(userId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id, user_id, name, timezone, emoji, created_at, updated_at')
      .eq('user_id', userId)
      .is('redirect_workspace_id', null)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data;
  }

  async create(userId: string, name: string, emoji?: string | null) {
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .insert({ user_id: userId, name, emoji: normalizeWorkspaceEmoji(emoji) })
      .select()
      .single();

    if (error) throw error;


    return data;
  }

  async update(userId: string, workspaceId: string, changes: { name?: string; timezone?: string; emoji?: string | null }) {
    const patch: { name?: string; timezone?: string; emoji?: string | null } = {};
    if (changes.name !== undefined) {
      const name = changes.name.trim();
      if (!name) throw new BadRequestException('O nome do painel não pode ficar vazio.');
      patch.name = name;
    }
    if (changes.timezone !== undefined) {
      if (!isValidTimezone(changes.timezone)) throw new BadRequestException('Fuso horário inválido.');
      patch.timezone = changes.timezone;
    }
    if (changes.emoji !== undefined) {
      patch.emoji = normalizeWorkspaceEmoji(changes.emoji);
    }
    if (!workspaceId || !Object.keys(patch).length) {
      throw new BadRequestException('workspace_id and name, timezone or emoji required');
    }

    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .update(patch)
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .is('redirect_workspace_id', null);

    if (error) throw error;
    if (patch.timezone) this.timezones.invalidate(workspaceId);
    return { success: true };
  }

  async remove(userId: string, workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspace_id required');
    }

    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .delete()
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .is('redirect_workspace_id', null);

    if (error) throw error;
    return { success: true };
  }

}

function normalizeWorkspaceEmoji(value?: string | null) {
  const emoji = value?.trim() || null;
  if (emoji && !isEmoji(emoji)) throw new BadRequestException('Use um emoji só.');
  return emoji;
}

/** Um único emoji (com modificadores, ZWJ e bandeiras), sem letras nem números soltos. */
export function isEmoji(value: string): boolean {
  if (value.length > 16) return false;
  const segments = [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(value)];
  if (segments.length !== 1) return false;
  // Pictogramas, emojis com apresentação de emoji, bandeiras e teclas (1️⃣, #️⃣).
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\u20E3/u.test(value);
}
