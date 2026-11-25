import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

type Headers = Record<string, string | string[] | undefined>;

function first(headers: Headers, name: string): string | null {
  const value = headers?.[name];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0].trim() || null;
}

/**
 * IP de quem fez a requisição, para o limite por IP.
 *
 * Na Vercel o req.ip é o da borda: todos os usuários dividiam o mesmo
 * contador (60 por minuto no app inteiro; 10 cerimônias de passkey por
 * minuto para todo mundo). A borda da Vercel sobrescreve x-real-ip e
 * x-forwarded-for com o IP real, então o cliente não consegue forjá-los lá.
 */
export function clientTracker(req: { headers?: Headers; ip?: string }): string {
  const headers = req.headers ?? {};
  const ip = first(headers, 'x-real-ip') ?? first(headers, 'x-forwarded-for') ?? req.ip ?? 'desconhecido';
  return /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : 'desconhecido';
}

@Injectable()
export class RealIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return clientTracker(req);
  }
}
