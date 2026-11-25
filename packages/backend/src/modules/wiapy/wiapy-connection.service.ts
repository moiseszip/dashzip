import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../shared/services/cache.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WiapyMcpClient, WiapyMcpError } from './wiapy-mcp.client';
import {
  authorizeUrl, exchangeCode, FetchFn, hashState, newState, pkcePair, refreshTokens,
  registerClient, revokeToken, WIAPY_ISSUER, WIAPY_LOOPBACK_REDIRECT, WiapyOAuthError, WiapyTokens,
} from './wiapy-oauth';

const STATE_TTL_MS = 10 * 60_000;
/** Renova o access token um minuto antes de vencer. */
const REFRESH_MARGIN_MS = 60_000;

interface ConnectionRow {
  workspace_id: string;
  user_id: string;
  client_id_enc: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
  account_name: string | null;
  product_ids: string[] | null;
  status: 'connected' | 'reauth';
  connected_at: string;
}

export interface WiapyStatus {
  connected: boolean;
  /** A Wiapy recusou a renovação: o card pede para conectar de novo. */
  needsReconnect: boolean;
  accountName: string | null;
  connectedAt: string | null;
}

/** Sem conexão ativa no painel (nunca conectou, desconectou ou precisa reconectar). */
export class WiapyDisconnectedError extends Error {}

/**
 * A conexão OAuth com a Wiapy de cada painel: começar (registro + PKCE +
 * state), concluir no callback, renovar o access token e desconectar.
 *
 * Os tokens nunca saem daqui: não vão para log, nem para o front. Ficam
 * cifrados no banco e o access token, também em memória até vencer.
 */
@Injectable()
export class WiapyConnectionService {
  private readonly logger = new Logger('Wiapy');
  /** Renovação em andamento por painel: chamadas paralelas esperam a mesma. */
  private readonly refreshing = new Map<string, Promise<string>>();
  fetchFn: FetchFn = (input, init) => fetch(input, init);
  readonly mcp = new WiapyMcpClient((input, init) => this.fetchFn(input, init));

  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly cache: CacheService,
  ) {}

  async assertOwner(userId: string, workspaceId: string) {
    const { data, error } = await this.supabase.getClient().from('workspaces').select('id')
      .eq('id', workspaceId).eq('user_id', userId).maybeSingle();
    if (error || !data) throw new ForbiddenException('Painel indisponível para este usuário.');
  }

  async status(workspaceId: string): Promise<WiapyStatus> {
    const row = await this.read(workspaceId);
    return {
      connected: !!row && row.status === 'connected',
      needsReconnect: row?.status === 'reauth',
      accountName: row?.account_name ?? null,
      connectedAt: row?.connected_at ?? null,
    };
  }

  /** Primeiro passo: registra o dash.zip na Wiapy e devolve o endereço do consentimento. */
  async start(userId: string, workspaceId: string): Promise<{ url: string }> {
    const redirectUri = WIAPY_LOOPBACK_REDIRECT;
    const clientId = await registerClient(this.fetchFn, [redirectUri]).catch((error) => {
      throw new BadRequestException(error instanceof WiapyOAuthError ? error.message : 'Não foi possível falar com a Wiapy.');
    });
    const state = newState();
    const { verifier, challenge } = pkcePair();
    const db = this.supabase.getClient();
    await db.from('wiapy_oauth_states').delete().lt('expires_at', new Date().toISOString());
    const { error } = await db.from('wiapy_oauth_states').insert({
      state_hash: hashState(state),
      workspace_id: workspaceId,
      user_id: userId,
      client_id_enc: this.encryption.encrypt(clientId),
      code_verifier_enc: this.encryption.encrypt(verifier),
      redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    });
    if (error) throw new BadRequestException('Não foi possível iniciar a conexão com a Wiapy.');
    return { url: authorizeUrl({ clientId, redirectUri, state, challenge }) };
  }

  /**
   * Volta do consentimento. O state é apagado na leitura (uso único) e precisa
   * estar dentro da validade. Devolve o painel conectado.
   */
  async complete(
    params: { state?: string; code?: string; iss?: string; error?: string },
    expected?: { userId: string; workspaceId: string },
  ): Promise<{ workspaceId: string }> {
    if (!params.state) throw new WiapyOAuthError('Retorno da Wiapy sem state.');
    const db = this.supabase.getClient();
    const { data, error } = await db.from('wiapy_oauth_states').delete().eq('state_hash', hashState(params.state))
      .select('workspace_id,user_id,client_id_enc,code_verifier_enc,redirect_uri,expires_at').maybeSingle();
    if (error || !data) throw new WiapyOAuthError('Link de conexão inválido ou já usado. Clique em Conectar Wiapy de novo.');
    if (Date.parse(data.expires_at) < Date.now()) throw new WiapyOAuthError('A conexão expirou. Clique em Conectar Wiapy de novo.');
    if (expected && (data.user_id !== expected.userId || data.workspace_id !== expected.workspaceId)) {
      throw new WiapyOAuthError('Este endereço é de outra conexão. Clique em Conectar Wiapy de novo.');
    }
    if (params.error) throw new WiapyOAuthError(params.error === 'access_denied' ? 'Conexão cancelada na Wiapy.' : `A Wiapy recusou a conexão (${params.error}).`);
    if (params.iss && params.iss !== WIAPY_ISSUER) throw new WiapyOAuthError('Retorno de um emissor desconhecido.');
    if (!params.code) throw new WiapyOAuthError('Retorno da Wiapy sem código.');

    const clientId = this.encryption.decrypt(data.client_id_enc);
    const tokens = await exchangeCode(this.fetchFn, {
      clientId, code: params.code, redirectUri: data.redirect_uri, verifier: this.encryption.decrypt(data.code_verifier_enc),
    });
    if (!tokens.refreshToken) throw new WiapyOAuthError('A Wiapy não devolveu refresh token.');

    // A conexão anterior deste painel (se havia) é revogada antes de ser trocada.
    await this.revokeStored(data.workspace_id);
    const accountName = await this.mcp.callTool(tokens.accessToken, 'wiapy_account', {})
      .then((r) => (typeof (r as { name?: unknown })?.name === 'string' ? ((r as { name: string }).name).slice(0, 120) : null))
      .catch(() => null);
    const { error: saveError } = await db.from('wiapy_connections').upsert({
      workspace_id: data.workspace_id,
      user_id: data.user_id,
      client_id_enc: this.encryption.encrypt(clientId),
      refresh_token_enc: this.encryption.encrypt(tokens.refreshToken),
      access_token_enc: this.encryption.encrypt(tokens.accessToken),
      access_expires_at: new Date(tokens.expiresAt).toISOString(),
      scope: tokens.scope,
      account_name: accountName,
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });
    if (saveError) throw new WiapyOAuthError('Não foi possível salvar a conexão.');
    this.cache.invalidateByPrefix(`wiapy:${data.workspace_id}:`);
    this.logger.log(`Wiapy conectada ao painel ${data.workspace_id}`);
    return { workspaceId: data.workspace_id };
  }

  async disconnect(workspaceId: string): Promise<{ success: true }> {
    await this.revokeStored(workspaceId);
    const { error } = await this.supabase.getClient().from('wiapy_connections').delete().eq('workspace_id', workspaceId);
    if (error) throw new BadRequestException('Não foi possível desconectar a Wiapy.');
    this.cache.invalidateByPrefix(`wiapy:${workspaceId}:`);
    return { success: true };
  }

  /** Produtos da Wiapy vinculados ao painel (vazio = conta inteira). Lança WiapyDisconnectedError sem conexão. */
  async productIds(workspaceId: string): Promise<string[]> {
    const row = await this.read(workspaceId);
    if (!row || row.status !== 'connected') throw new WiapyDisconnectedError();
    return (row.product_ids ?? []).filter((id) => /^[0-9a-f]{24}$/i.test(id));
  }

  /** Chama uma ferramenta do MCP com o token do painel, renovando-o se vencido ou recusado. */
  async callTool(workspaceId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const token = await this.accessToken(workspaceId);
    try {
      return await this.mcp.callTool(token, name, args);
    } catch (error) {
      if (!(error instanceof WiapyMcpError) || error.kind !== 'auth') throw error;
      this.mcp.forget(token);
      this.cache.invalidate(this.tokenKey(workspaceId));
      return this.mcp.callTool(await this.accessToken(workspaceId, true), name, args);
    }
  }

  private tokenKey(workspaceId: string) {
    return `wiapy:${workspaceId}:access`;
  }

  private async accessToken(workspaceId: string, force = false): Promise<string> {
    if (!force) {
      const cached = this.cache.get<string>(this.tokenKey(workspaceId));
      if (cached) return cached;
    }
    const pending = this.refreshing.get(workspaceId);
    if (pending) return pending;
    const work = this.loadToken(workspaceId, force).finally(() => this.refreshing.delete(workspaceId));
    this.refreshing.set(workspaceId, work);
    return work;
  }

  private async loadToken(workspaceId: string, force: boolean): Promise<string> {
    const row = await this.read(workspaceId);
    if (!row || row.status !== 'connected') throw new WiapyDisconnectedError();
    const expiresAt = row.access_expires_at ? Date.parse(row.access_expires_at) : 0;
    if (!force && row.access_token_enc && expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      const token = this.encryption.decrypt(row.access_token_enc);
      this.cache.set(this.tokenKey(workspaceId), token, expiresAt - REFRESH_MARGIN_MS - Date.now());
      return token;
    }

    const clientId = this.encryption.decrypt(row.client_id_enc);
    let tokens: WiapyTokens;
    try {
      tokens = await refreshTokens(this.fetchFn, { clientId, refreshToken: this.encryption.decrypt(row.refresh_token_enc) });
    } catch (error) {
      if (error instanceof WiapyOAuthError && error.invalidGrant) {
        await this.supabase.getClient().from('wiapy_connections')
          .update({ status: 'reauth', access_token_enc: null, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId);
        this.logger.warn(`Wiapy do painel ${workspaceId} precisa ser reconectada`);
        throw new WiapyDisconnectedError();
      }
      throw error;
    }
    const update: Record<string, unknown> = {
      access_token_enc: this.encryption.encrypt(tokens.accessToken),
      access_expires_at: new Date(tokens.expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Refresh token rotativo: o novo substitui o anterior.
    if (tokens.refreshToken) update.refresh_token_enc = this.encryption.encrypt(tokens.refreshToken);
    await this.supabase.getClient().from('wiapy_connections').update(update).eq('workspace_id', workspaceId);
    this.cache.set(this.tokenKey(workspaceId), tokens.accessToken, Math.max(0, tokens.expiresAt - REFRESH_MARGIN_MS - Date.now()));
    return tokens.accessToken;
  }

  private async revokeStored(workspaceId: string) {
    const row = await this.read(workspaceId);
    if (!row) return;
    try {
      await revokeToken(this.fetchFn, {
        clientId: this.encryption.decrypt(row.client_id_enc),
        token: this.encryption.decrypt(row.refresh_token_enc),
      });
    } catch {
      // chave trocada ou token ilegível: desconecta assim mesmo
    }
    this.cache.invalidate(this.tokenKey(workspaceId));
  }

  private async read(workspaceId: string): Promise<ConnectionRow | null> {
    const { data, error } = await this.supabase.getClient().from('wiapy_connections')
      .select('workspace_id,user_id,client_id_enc,refresh_token_enc,access_token_enc,access_expires_at,account_name,product_ids,status,connected_at')
      .eq('workspace_id', workspaceId).maybeSingle();
    // Tabela ausente (migration não aplicada) ou erro: trata como desconectado.
    if (error) return null;
    return (data as ConnectionRow | null) ?? null;
  }
}
