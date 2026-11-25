import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  async getUserFromToken(token: string) {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  }

  /**
   * A conta tem passkey? A sessão já a confirmou? Uma ida ao banco por
   * requisição aal1 (função `passkey_session_state`). Erro sobe: o guard fecha.
   */
  async passkeySessionState(userId: string, sessionId: string): Promise<{ hasPasskeys: boolean; elevated: boolean }> {
    const { data, error } = await this.client.rpc('passkey_session_state', { p_user: userId, p_session: sessionId });
    if (error) throw new Error(`passkey_session_state: ${error.code ?? 'erro'}`);
    const row = (Array.isArray(data) ? data[0] : data) as { has_passkeys?: boolean; elevated?: boolean } | null;
    return { hasPasskeys: !!row?.has_passkeys, elevated: !!row?.elevated };
  }

  /**
   * ADMIN_EMAILS é a fonte da autorização. O e-mail deve vir do Supabase Auth,
   * que é quem confirma a identidade da conta.
   */
  private adminEmails(): string[] {
    return (this.config.get<string>('ADMIN_EMAILS') ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }

  isAdminEmail(email?: string): boolean {
    return !!email && this.adminEmails().includes(email.toLowerCase());
  }

  async isAdmin(userId: string): Promise<boolean> {
    const allowed = this.adminEmails();
    if (allowed.length === 0 || !userId) return false;

    const { data, error } = await this.client.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    return !error && !!email && allowed.includes(email.toLowerCase());
  }
}
