import { safeEqual } from '../safe-equal';
import { describePayload, maskEmail } from '../log-safe';
import { clientTracker } from '../../../common/guards/real-ip-throttler.guard';

describe('safeEqual', () => {
  it('compara segredos sem lançar com tamanhos diferentes', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'abc')).toBe(false);
  });

  it('nunca aceita segredo esperado vazio ou valor que não é texto', () => {
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
    expect(safeEqual({}, 'abc')).toBe(false);
  });
});

describe('describePayload / maskEmail', () => {
  it('resume o payload sem dados pessoais', () => {
    const text = describePayload({ event: 'PURCHASE_APPROVED', buyer: { email: 'fulano@gmail.com', document: '12345678900' }, token: 'segredo' });
    expect(text).toBe('evento=PURCHASE_APPROVED chaves=[event,buyer,token]');
    expect(text).not.toContain('fulano');
    expect(text).not.toContain('segredo');
  });

  it('mascara o e-mail', () => {
    expect(maskEmail('fulano@gmail.com')).toBe('fu***@gmail.com');
    expect(maskEmail(null)).toBe('(sem e-mail)');
  });
});

describe('clientTracker (limite por IP real)', () => {
  it('usa o IP que a borda da Vercel informa, não o do socket', () => {
    expect(clientTracker({ headers: { 'x-real-ip': '200.1.2.3' }, ip: '10.0.0.1' })).toBe('200.1.2.3');
    expect(clientTracker({ headers: { 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }, ip: '10.0.0.1' })).toBe('200.1.2.3');
    expect(clientTracker({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('descarta valor fora do formato de IP', () => {
    expect(clientTracker({ headers: { 'x-real-ip': '<script>' } })).toBe('desconhecido');
  });
});
