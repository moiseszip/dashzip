import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

/**
 * Acesso às tabelas das passkeys (migration 20261123200000_passkeys.sql).
 * Separado do serviço para os testes trocarem por uma versão em memória.
 */

export type ChallengeKind = 'registration' | 'authentication';

export interface StoredCredential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[];
  device_type: string | null;
  backed_up: boolean;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ConsumedChallenge {
  id: string;
  challenge: string;
  rp_id: string;
  origin: string;
}

export interface NewChallenge {
  user_id: string;
  session_id: string;
  kind: ChallengeKind;
  challenge: string;
  rp_id: string;
  origin: string;
  expires_at: string;
}

export type NewCredential = Omit<StoredCredential, 'id' | 'created_at' | 'last_used_at'>;

export abstract class PasskeysRepository {
  abstract countChallengesSince(userId: string, sinceIso: string): Promise<number>;
  abstract countFailuresSince(userId: string, sinceIso: string): Promise<number>;
  abstract insertChallenge(row: NewChallenge): Promise<string>;
  /** Marca como usado e devolve, só se for da sessão, do tipo, não usado e não expirado. */
  abstract consumeChallenge(q: { id: string; userId: string; sessionId: string; kind: ChallengeKind; nowIso: string }): Promise<ConsumedChallenge | null>;
  abstract finishChallenge(id: string, succeeded: boolean): Promise<void>;
  abstract purgeChallenges(userId: string, beforeIso: string): Promise<void>;
  abstract listCredentials(userId: string): Promise<StoredCredential[]>;
  abstract findByCredentialId(userId: string, credentialId: string): Promise<StoredCredential | null>;
  abstract findById(userId: string, id: string): Promise<StoredCredential | null>;
  abstract insertCredential(row: NewCredential): Promise<StoredCredential>;
  abstract recordUse(id: string, counter: number, usedAtIso: string): Promise<void>;
  abstract deleteCredential(userId: string, id: string): Promise<boolean>;
  abstract elevateSession(sessionId: string, userId: string, credentialRowId: string): Promise<void>;
  abstract sessionState(userId: string, sessionId: string): Promise<{ hasPasskeys: boolean; elevated: boolean }>;
}

const CREDENTIAL_COLUMNS = 'id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at';

/** Erro de banco sem detalhe de linha: nada de desafio ou credencial no log. */
function dbError(op: string, error: { code?: string } | null): Error {
  return new Error(`passkeys.${op}: ${error?.code ?? 'erro'}`);
}

@Injectable()
export class SupabasePasskeysRepository extends PasskeysRepository {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  private get db() {
    return this.supabase.getClient();
  }

  async countChallengesSince(userId: string, sinceIso: string) {
    const { count, error } = await this.db.from('webauthn_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', sinceIso);
    if (error) throw dbError('countChallenges', error);
    return count ?? 0;
  }

  async countFailuresSince(userId: string, sinceIso: string) {
    const { count, error } = await this.db.from('webauthn_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('kind', 'authentication').eq('succeeded', false).gte('used_at', sinceIso);
    if (error) throw dbError('countFailures', error);
    return count ?? 0;
  }

  async insertChallenge(row: NewChallenge) {
    const { data, error } = await this.db.from('webauthn_challenges').insert(row).select('id').single();
    if (error || !data) throw dbError('insertChallenge', error);
    return data.id as string;
  }

  async consumeChallenge(q: { id: string; userId: string; sessionId: string; kind: ChallengeKind; nowIso: string }) {
    // Um UPDATE só: duas respostas ao mesmo desafio não passam as duas.
    const { data, error } = await this.db.from('webauthn_challenges')
      .update({ used_at: q.nowIso })
      .eq('id', q.id).eq('user_id', q.userId).eq('session_id', q.sessionId).eq('kind', q.kind)
      .is('used_at', null).gt('expires_at', q.nowIso)
      .select('id, challenge, rp_id, origin')
      .maybeSingle();
    if (error) throw dbError('consumeChallenge', error);
    return (data as ConsumedChallenge | null) ?? null;
  }

  async finishChallenge(id: string, succeeded: boolean) {
    const { error } = await this.db.from('webauthn_challenges').update({ succeeded }).eq('id', id);
    if (error) throw dbError('finishChallenge', error);
  }

  async purgeChallenges(userId: string, beforeIso: string) {
    await this.db.from('webauthn_challenges').delete().eq('user_id', userId).lt('created_at', beforeIso);
  }

  async listCredentials(userId: string) {
    const { data, error } = await this.db.from('webauthn_credentials')
      .select(CREDENTIAL_COLUMNS).eq('user_id', userId).order('created_at', { ascending: true });
    if (error) throw dbError('listCredentials', error);
    return (data ?? []) as StoredCredential[];
  }

  async findByCredentialId(userId: string, credentialId: string) {
    const { data, error } = await this.db.from('webauthn_credentials')
      .select(CREDENTIAL_COLUMNS).eq('user_id', userId).eq('credential_id', credentialId).maybeSingle();
    if (error) throw dbError('findByCredentialId', error);
    return (data as StoredCredential | null) ?? null;
  }

  async findById(userId: string, id: string) {
    const { data, error } = await this.db.from('webauthn_credentials')
      .select(CREDENTIAL_COLUMNS).eq('user_id', userId).eq('id', id).maybeSingle();
    if (error) throw dbError('findById', error);
    return (data as StoredCredential | null) ?? null;
  }

  async insertCredential(row: NewCredential) {
    const { data, error } = await this.db.from('webauthn_credentials').insert(row).select(CREDENTIAL_COLUMNS).single();
    if (error) {
      if (error.code === '23505') throw Object.assign(new Error('duplicate'), { code: 'duplicate' });
      throw dbError('insertCredential', error);
    }
    return data as StoredCredential;
  }

  async recordUse(id: string, counter: number, usedAtIso: string) {
    const { error } = await this.db.from('webauthn_credentials').update({ counter, last_used_at: usedAtIso }).eq('id', id);
    if (error) throw dbError('recordUse', error);
  }

  async deleteCredential(userId: string, id: string) {
    const { data, error } = await this.db.from('webauthn_credentials').delete().eq('user_id', userId).eq('id', id).select('id');
    if (error) throw dbError('deleteCredential', error);
    return (data ?? []).length > 0;
  }

  async elevateSession(sessionId: string, userId: string, credentialRowId: string) {
    const { error } = await this.db.from('mfa_session_elevations').upsert(
      { session_id: sessionId, user_id: userId, method: 'webauthn', credential_id: credentialRowId },
      { onConflict: 'session_id' },
    );
    if (error) throw dbError('elevateSession', error);
  }

  sessionState(userId: string, sessionId: string) {
    return this.supabase.passkeySessionState(userId, sessionId);
  }
}
