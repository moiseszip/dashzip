import {
  CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

/** Mensagem que o frontend reconhece para mandar a pessoa ao passo do segundo fator. */
export const MFA_REQUIRED_MESSAGE = 'Confirme o código de dois fatores para continuar.';

/**
 * Claims do JWT do Supabase. O token já foi validado pelo Auth em
 * `getUserFromToken`; aqui só se leem as claims, nunca antes disso.
 */
export function tokenClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Nível de garantia (aal1/aal2) do token. */
export function tokenAal(token: string): string | null {
  const aal = tokenClaims(token)?.aal;
  return typeof aal === 'string' ? aal : null;
}

/** Id da sessão do Supabase (claim `session_id`), estável entre refreshes. */
export function tokenSessionId(token: string): string | null {
  const id = tokenClaims(token)?.session_id;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export interface PasskeyState {
  /** A conta tem ao menos uma passkey cadastrada. */
  hasPasskeys: boolean;
  /** Esta sessão já confirmou uma passkey (vale como aal2). */
  elevated: boolean;
}

/**
 * Falta o segundo fator? Quem tem TOTP verificado no Supabase ou passkey
 * cadastrada só passa com sessão aal2 (código) ou sessão elevada pela passkey.
 */
export function needsSecondFactor(
  user: { factors?: { status?: string }[] | null },
  token: string,
  passkeys: PasskeyState = { hasPasskeys: false, elevated: false },
): boolean {
  if (tokenAal(token) === 'aal2' || passkeys.elevated) return false;
  const totp = (user.factors ?? []).some((factor) => factor?.status === 'verified');
  return totp || passkeys.hasPasskeys;
}

/** Valida o Bearer e devolve usuário, token e id da sessão. */
async function authenticate(supabase: SupabaseService, request: any) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing or invalid authorization header');
  }
  const token = authHeader.replace('Bearer ', '');
  const user = await supabase.getUserFromToken(token);
  if (!user) {
    throw new UnauthorizedException('Invalid or expired token');
  }
  return { user, token, sessionId: tokenSessionId(token) };
}

async function passkeyState(supabase: SupabaseService, userId: string, sessionId: string): Promise<PasskeyState> {
  try {
    return await supabase.passkeySessionState(userId, sessionId);
  } catch {
    // Fechado: sem saber se há passkey, ninguém passa só com a senha.
    throw new ServiceUnavailableException('Não foi possível conferir o segundo fator. Tente de novo.');
  }
}

/** Rotas do painel: exige login e, para quem tem 2FA, o segundo fator. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { user, token, sessionId } = await authenticate(this.supabase, request);
    // Todo token do login do Supabase traz session_id. Um token sem ele só
    // sai de quem tem o segredo JWT do projeto, que já poderia assinar aal2:
    // para esse caso não há passkey a conferir, vale só a regra do TOTP.
    if (tokenAal(token) !== 'aal2') {
      const state = sessionId
        ? await passkeyState(this.supabase, user.id, sessionId)
        : { hasPasskeys: false, elevated: false };
      if (needsSecondFactor(user, token, state)) {
        throw new UnauthorizedException(MFA_REQUIRED_MESSAGE);
      }
    }
    request.user = user;
    request.sessionId = sessionId;
    return true;
  }
}

/**
 * Só o login (senha), sem o segundo fator. Usado apenas pelas rotas que fazem
 * o próprio segundo fator: estado da sessão e verificação da passkey no login.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { user, sessionId } = await authenticate(this.supabase, request);
    if (!sessionId) throw new UnauthorizedException('Invalid or expired token');
    request.user = user;
    request.sessionId = sessionId;
    return true;
  }
}
