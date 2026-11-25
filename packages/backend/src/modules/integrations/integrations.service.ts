import { ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

/** Webhooks dos checkouts: o "client" do servidor que recebe as vendas. */
@Injectable()
export class IntegrationsService {
  constructor(private supabase: SupabaseService) {}

  async listCheckoutIntegrations(userId: string, workspaceId?: string) {
    const db = this.supabase.getClient();
    let query = db
      .from('checkout_integrations')
      .select('id, platform, name, webhook_secret, is_active, last_webhook_at, use_commission_value')
      .eq('user_id', userId);
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    const { data, error } = await query.order('created_at');
    if (error) throw error;
    return data || [];
  }

  async saveCheckoutIntegration(userId: string, body: any) {
    const db = this.supabase.getClient();
    // O painel de destino precisa ser de quem salva. Sem esta checagem, uma
    // conta ligava o próprio webhook ao painel de outra e injetava vendas
    // (e Purchases na CAPI dela) por lá.
    if (body.workspace_id) await this.assertWorkspaceOwner(userId, body.workspace_id);
    if (body.id) {
      const { id, ...updates } = body;
      const { data, error } = await db
        .from('checkout_integrations')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await db
      .from('checkout_integrations')
      .insert({ ...body, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async toggleCheckoutIntegration(userId: string, id: string, isActive: boolean) {
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('checkout_integrations')
      .update({ is_active: isActive })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteCheckoutIntegration(userId: string, id: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('checkout_integrations').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  }

  private async assertWorkspaceOwner(userId: string, workspaceId: string) {
    const { data, error } = await this.supabase.getClient().from('workspaces').select('id')
      .eq('id', workspaceId).eq('user_id', userId).maybeSingle();
    if (error || !data) throw new ForbiddenException('Painel indisponível para este usuário.');
  }
}
