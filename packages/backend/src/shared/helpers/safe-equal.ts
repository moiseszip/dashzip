import { createHash, timingSafeEqual } from 'crypto';

/**
 * Compara dois segredos em tempo constante. Os dois lados passam por SHA-256
 * antes: assim o tamanho diferente não encurta a comparação nem lança.
 */
export function safeEqual(received: unknown, expected: unknown): boolean {
  if (typeof received !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = createHash('sha256').update(received, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
