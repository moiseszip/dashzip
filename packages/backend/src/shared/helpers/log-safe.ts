/**
 * Resumo de um payload de webhook para o log, sem dados pessoais nem tokens:
 * só as chaves do primeiro nível e o evento, quando houver. Antes o corpo
 * inteiro (nome, e-mail, CPF e telefone do comprador, e às vezes o token do
 * checkout) ia para os logs da Vercel com JSON.stringify(payload).
 */
export function describePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return `(${typeof payload})`;
  const obj = payload as Record<string, unknown>;
  const event = ['event', 'event_type', 'type', 'webhook_event_type', 'status', 'order_status']
    .map((key) => obj[key])
    .find((value) => typeof value === 'string');
  const keys = Object.keys(obj).slice(0, 20).join(',');
  return `${event ? `evento=${String(event).slice(0, 60)} ` : ''}chaves=[${keys}]`;
}

/** E-mail para o log: "fu***@gmail.com". */
export function maskEmail(email: unknown): string {
  if (typeof email !== 'string' || !email.includes('@')) return '(sem e-mail)';
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}
