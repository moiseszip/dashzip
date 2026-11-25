import { NotFoundException } from '@nestjs/common';
import { SalesPushService, saleNotification } from './sales-push.service';

const workspace = { id: 'dashboard', name: 'Painel', emoji: '🎯' };
const preferences = {
  approved: true, pending: false, sale_value: 'total',
  show_workspace_icon: true, show_workspace: false, show_product: false, show_campaign: false,
} as const;
const sale = {
  id: 'sale', amount: 149.90, currency: 'BRL', product_name: 'Produto', utm_campaign: 'campanha',
  status: 'approved', order_external_id: null, checkout_integration_id: null, is_order_bump: false, metadata: null,
};

describe('notificação de venda', () => {
  it.each([
    ['pix', 'Pix'],
    ['credit_card', 'Cartão de crédito'],
    ['cartão de débito', 'Cartão de débito'],
    ['boleto', 'Boleto'],
  ])('mostra status e ícone no título e valor junto do pagamento %s', (method, label) => {
    const push = saleNotification('approved', [{ ...sale, payment_method: method }], preferences, workspace, false);
    expect(push.title).toBe('Venda aprovada · 🎯');
    expect(push.body.replace(/\u00a0/g, ' ')).toBe(`R$ 149,90 · ${label}`);
  });

  it('mantém apenas os detalhes escolhidos e omite o separador quando o valor está oculto', () => {
    const settings = { ...preferences, sale_value: 'hidden', show_workspace: true, show_product: true } as const;
    const push = saleNotification('pending', [{ ...sale, payment_method: 'pix' }], settings, workspace, false);
    expect(push.title).toBe('Venda pendente · 🎯 Painel');
    expect(push.body).toBe('Pix\nProduto');
  });
});

describe('teste para os outros aparelhos', () => {
  const devices = [
    { id: 'd1', user_id: 'u', endpoint: 'https://web.push.apple.com/celular', p256dh: 'k', auth: 'a' },
    { id: 'd2', user_id: 'u', endpoint: 'https://fcm.googleapis.com/computador', p256dh: 'k', auth: 'a' },
  ];
  function build(list = devices) {
    const db = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: list, error: null }) }) }) };
    const service = new SalesPushService({ getClient: () => db } as any, {} as any, {} as any);
    const sent: string[] = [];
    jest.spyOn(service as any, 'samplePayload').mockResolvedValue({ payload: { title: 't', body: 'b', url: '/sales' }, vapidDetails: {} });
    jest.spyOn(service as any, 'send').mockImplementation(async (device: any) => { sent.push(device.id); });
    return { service, sent };
  }

  it('envia para todos os aparelhos menos o atual', async () => {
    const { service, sent } = build();
    await expect(service.testOthers('u', 'w', 'https://fcm.googleapis.com/computador')).resolves.toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual(['d1']);
  });

  it('sem outro aparelho, pede para ativar no celular', async () => {
    const { service } = build([devices[1]]);
    await expect(service.testOthers('u', 'w', devices[1].endpoint)).rejects.toBeInstanceOf(NotFoundException);
  });
});
