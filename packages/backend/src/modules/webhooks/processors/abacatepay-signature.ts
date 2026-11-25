import { createHmac, timingSafeEqual } from 'node:crypto';

// Chave pública v2 da AbacatePay. O segredo da integração autentica a origem.
// https://docs.abacatepay.com/pages/notificacoes/seguranca
const ABACATEPAY_PUBLIC_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

export function validAbacatePaySignature(rawBody: Buffer | undefined, signature: unknown): boolean {
  if (!rawBody || typeof signature !== 'string') return false;

  const expected = Buffer.from(createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(rawBody).digest('base64'));
  const received = Buffer.from(signature);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
