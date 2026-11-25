import { createHmac } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { WebhooksController } from '../webhooks.controller';
import { WebhookQueueService } from '../webhook-queue.service';
import { DebugService } from '../../debug/debug.service';
import { N8nProfilesProcessor } from '../processors/n8n-profiles.processor';
import { CHECKOUT_SPECS } from '../processors/generic/checkout-specs';
import { parseCheckout } from '../processors/generic/checkout-parser';

const checkout = {
  id: 'bill_test',
  externalId: 'meu-app-monthly-bb6ffd89-8827-4d0a-8450-a1b0c768ee7b',
  status: 'PAID',
  paidAmount: 4700,
  metadata: { sck: 'stl_ffffffff-0000-4111-8222-333333333333', utm_campaign: 'qa' },
};
const body = {
  event: 'subscription.completed',
  apiVersion: 2,
  devMode: false,
  data: {
    checkout,
    payment: { id: 'card_test', status: 'APPROVED', paidAmount: 4700 },
    subscription: { currency: 'BRL', method: 'CARD' },
  },
};
// HMAC-SHA256 em base64 da serialização acima com a chave pública v2 (a mesma do processor).
const ABACATEPAY_V2_PUBLIC_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
const signature = createHmac('sha256', ABACATEPAY_V2_PUBLIC_KEY).update(Buffer.from(JSON.stringify(body))).digest('base64');

async function deliver(raw: Buffer | undefined, secret?: string) {
  const processDirect = jest.fn().mockResolvedValue({ status: 200, body: { success: true } });
  const saveServerTrace = jest.fn().mockResolvedValue(undefined);
  const controller = new WebhooksController(
    { processDirect } as unknown as WebhookQueueService,
    {} as N8nProfilesProcessor,
    { saveServerTrace } as unknown as DebugService,
  );
  const send = jest.fn();
  const status = jest.fn().mockReturnValue({ send });
  await controller.handleWebhook(
    { platform: 'abacatepay' },
    body,
    {
      headers: { 'x-webhook-signature': signature },
      query: { ...(secret ? { webhookSecret: secret } : {}), token: 'nao-aceito' },
      rawBody: raw,
    } as unknown as FastifyRequest,
    { status } as unknown as FastifyReply,
  );
  return { status, processDirect, saveServerTrace };
}

describe('AbacatePay v2', () => {
  it('usa somente o segredo da AbacatePay e encaminha compra assinada com seu indexador', async () => {
    const response = await deliver(Buffer.from(JSON.stringify(body)), 'segredo-fixture');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.processDirect).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'abacatepay',
      authToken: 'segredo-fixture',
      queryParams: {},
    }));
    const parsed = parseCheckout(CHECKOUT_SPECS.abacatepay, response.processDirect.mock.calls[0][0].body);
    expect(parsed).toMatchObject({
      decision: 'approved',
      productName: 'Meu App · Mensal',
      grossAmount: 47,
      externalId: 'card_test',
      indexer: checkout.metadata.sck,
      utmCampaign: 'qa',
    });
  });

  it('recusa assinatura com bytes alterados, corpo cru ausente e token genérico', async () => {
    for (const [raw, secret] of [
      [Buffer.from(JSON.stringify(body) + ' '), 'segredo-fixture'],
      [undefined, 'segredo-fixture'],
      [Buffer.from(JSON.stringify(body)), undefined],
    ] as const) {
      const response = await deliver(raw, secret);
      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.processDirect).not.toHaveBeenCalled();
    }
  });
});
