import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ECDH, createHash } from 'node:crypto';
import { sendNotification, type PushSubscription } from 'web-push';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DebugService } from '../debug/debug.service';
import { normalizePaymentMethod } from '../finance/finance-totals';

type Status = 'pending' | 'approved';
type Preferences = Record<Status, boolean> & {
  sale_value: 'total' | 'net' | 'hidden';
  show_product: boolean;
  show_campaign: boolean;
  show_workspace: boolean;
  show_workspace_icon: boolean;
};
const DEFAULTS: Preferences = {
  pending: false, approved: false, sale_value: 'total',
  show_product: false, show_campaign: false, show_workspace: true, show_workspace_icon: false,
};
const PREFERENCE_FIELDS = 'pending,approved,sale_value,show_product,show_campaign,show_workspace,show_workspace_icon';
type Vapid = { publicKey: string; privateKey: string; subject: string };
type Device = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Event = {
  id: string; workspace_id: string; anchor_sale_id: string; device_id: string; sale_status: Status;
  attempts: number;
};
type Sale = {
  id: string; amount: number | string; currency: string | null; product_name: string | null;
  utm_campaign: string | null; payment_method: string | null; status: string | null; order_external_id: string | null;
  checkout_integration_id: string | null; is_order_bump: boolean | null;
  metadata: { gross_amount?: number; payment_fee?: number; amount_is_net?: boolean } | null;
};
const SAMPLE_SALE: Sale = {
  id: 'simulation', amount: 149.90, currency: 'BRL', product_name: 'Produto exemplo',
  utm_campaign: 'campanha-exemplo', payment_method: 'pix', status: 'approved', order_external_id: null,
  checkout_integration_id: null, is_order_bump: false, metadata: { payment_fee: 10 },
};
const SALE_FIELDS = 'id,amount,currency,product_name,utm_campaign,payment_method,status,order_external_id,checkout_integration_id,is_order_bump,metadata';

export function isPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const apple = /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname);
    const chrome = url.hostname === 'fcm.googleapis.com' && url.pathname.startsWith('/fcm/send/');
    const firefox = url.hostname === 'updates.push.services.mozilla.com' && url.pathname.startsWith('/wpush/');
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash
      && (apple || chrome || firefox);
  } catch {
    return false;
  }
}

function paymentLabel(value: string | null | undefined): string {
  const method = value?.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!method) return '';
  if (/debit/.test(method)) return 'Cartão de débito';
  if (/^(card|cartao)$/.test(method)) return 'Cartão';
  if (/paypal/.test(method)) return 'PayPal';
  if (/transfer|wire|\bted\b/.test(method)) return 'Transferência bancária';
  if (/dinheiro|^cash$/.test(method)) return 'Dinheiro';
  const normalized = normalizePaymentMethod(method);
  if (normalized === 'pix') return 'Pix';
  if (normalized === 'credit_card') return 'Cartão de crédito';
  if (normalized === 'boleto') return 'Boleto';
  return '';
}

export function saleNotification(
  status: Status, lines: Sale[], preferences: Preferences,
  workspace: { id: string; name: string; emoji: string | null }, usesCommission: boolean,
) {
  const product = lines.find((line) => !line.is_order_bump) ?? lines[0];
  const values: string[] = [];
  if (preferences.sale_value !== 'hidden') {
    const amounts = new Map<string, number>();
    let known = true;
    for (const line of lines) {
      const currency = /^[A-Z]{3}$/.test(line.currency ?? '') ? line.currency! : 'BRL';
      const isNet = line.metadata?.amount_is_net ?? usesCommission;
      const recorded = Number(line.amount);
      const gross = line.metadata?.gross_amount ?? (isNet ? undefined : recorded);
      const fee = line.metadata?.payment_fee;
      const net = isNet ? recorded : fee == null || gross == null ? undefined : gross - fee;
      const value = preferences.sale_value === 'total' ? gross : net;
      if (value == null || !Number.isFinite(value)) {
        known = false;
        break;
      }
      amounts.set(currency, (amounts.get(currency) ?? 0) + value);
    }
    if (known) for (const [currency, amount] of amounts) {
      values.push(new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount));
    }
  }
  const statusLabel = status === 'approved' ? 'Venda aprovada' : 'Venda pendente';
  const icon = preferences.show_workspace_icon ? workspace.emoji : null;
  const name = preferences.show_workspace ? workspace.name.slice(0, 90) : null;
  const panel = [icon, name].filter(Boolean).join(' ');
  const title = [statusLabel, panel].filter(Boolean).join(' · ');
  const payment = paymentLabel(product?.payment_method) || lines.map((line) => paymentLabel(line.payment_method)).find(Boolean);
  const summary = [values.join(' / '), payment].filter(Boolean).join(' · ');
  const optional = [
    preferences.show_product && product?.product_name?.slice(0, 90),
    preferences.show_campaign && product?.utm_campaign?.slice(0, 90),
  ].filter(Boolean).join(' · ');
  return {
    title,
    body: [summary, optional].filter(Boolean).join('\n') || 'Abra o Dash.zip para ver o pedido.',
    url: `/sales?workspace=${workspace.id}`,
  };
}

@Injectable()
export class SalesPushService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly debug: DebugService,
  ) {}

  private get db() { return this.supabase.getClient(); }

  private async vapid(): Promise<Vapid | null> {
    const publicKey = this.config.get<string>('WEB_PUSH_PUBLIC_KEY');
    const privateKey = this.config.get<string>('WEB_PUSH_PRIVATE_KEY');
    const subject = this.config.get<string>('WEB_PUSH_SUBJECT');
    if (publicKey && privateKey && subject) return { publicKey, privateKey, subject };
    const { data, error } = await this.db.rpc('read_sales_web_push_keys');
    if (error) throw new ServiceUnavailableException('Configuração de Web Push indisponível.');
    return data;
  }

  private async readPreferences(workspaceId: string): Promise<Preferences> {
    const { data, error } = await this.db.from('sales_push_preferences').select(PREFERENCE_FIELDS)
      .eq('workspace_id', workspaceId).maybeSingle();
    if (error) throw new ServiceUnavailableException('Preferências de notificações indisponíveis.');
    return data ?? DEFAULTS;
  }

  async preferences(userId: string, workspaceId: string) {
    await this.debug.assertOwner(userId, workspaceId);
    const [settings, vapidDetails] = await Promise.all([this.readPreferences(workspaceId), this.vapid()]);
    return { settings, publicKey: vapidDetails?.publicKey ?? null };
  }

  async save(userId: string, workspaceId: string, settings: Omit<Preferences, 'show_workspace_icon'> & { show_workspace_icon?: boolean }) {
    await this.debug.assertOwner(userId, workspaceId);
    const showIcon = settings.show_workspace_icon ?? (await this.readPreferences(workspaceId)).show_workspace_icon;
    const { error } = await this.db.from('sales_push_preferences').upsert({
      workspace_id: workspaceId, ...settings, show_workspace_icon: showIcon,
    });
    if (error) throw new ServiceUnavailableException('Não foi possível salvar as notificações.');
    return { ok: true };
  }

  async register(userId: string, device: PushSubscription['keys'] & { endpoint: string }) {
    if (!await this.vapid()) throw new ServiceUnavailableException('Web Push indisponível nesta instância.');
    if (!isPushEndpoint(device.endpoint)) throw new BadRequestException('Canal de notificações inválido.');
    try {
      const key = Buffer.from(device.p256dh, 'base64url');
      if (key[0] !== 4) throw new Error('Invalid point');
      ECDH.convertKey(key, 'prime256v1');
    } catch {
      throw new BadRequestException('Chave do aparelho inválida.');
    }
    const { error } = await this.db.from('sales_push_devices')
      .upsert({ user_id: userId, ...device }, { onConflict: 'endpoint' });
    if (error) throw new ServiceUnavailableException('Não foi possível ativar este aparelho.');
    return { ok: true };
  }

  async remove(userId: string, endpoint: string) {
    const { error } = await this.db.from('sales_push_devices').delete().eq('user_id', userId).eq('endpoint', endpoint);
    if (error) throw new ServiceUnavailableException('Não foi possível remover este aparelho.');
    return { ok: true };
  }

  /** Venda de exemplo com as preferências salvas do painel. */
  private async samplePayload(userId: string, workspaceId: string) {
    const [workspace, preferences, vapidDetails] = await Promise.all([
      this.db.from('workspaces').select('id,name,emoji').eq('user_id', userId).eq('id', workspaceId)
        .is('redirect_workspace_id', null).maybeSingle(),
      this.readPreferences(workspaceId),
      this.vapid(),
    ]);
    if (workspace.error) throw new ServiceUnavailableException('Simulação de venda indisponível.');
    if (!workspace.data) throw new NotFoundException('Painel indisponível.');
    if (!vapidDetails) throw new ServiceUnavailableException('Web Push indisponível nesta instância.');
    const status = preferences.pending && !preferences.approved ? 'pending' : 'approved';
    return { payload: saleNotification(status, [SAMPLE_SALE], preferences, workspace.data, false), vapidDetails };
  }

  async test(userId: string, endpoint: string, workspaceId: string, delaySeconds = 0) {
    const [device, sample] = await Promise.all([
      this.db.from('sales_push_devices').select('*').eq('user_id', userId).eq('endpoint', endpoint).maybeSingle(),
      this.samplePayload(userId, workspaceId),
    ]);
    if (device.error) throw new ServiceUnavailableException('Simulação de venda indisponível.');
    if (!device.data) throw new NotFoundException('Ative as notificações neste aparelho.');
    // Valida tudo antes de esperar: o erro volta na hora, e só o envio aguarda.
    if (delaySeconds > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(delaySeconds, 10) * 1000));
    try {
      await this.send(device.data, sample.vapidDetails, sample.payload);
    } catch (error) {
      if (await this.removeExpired(device.data, error)) throw new NotFoundException('Ative as notificações novamente.');
      throw new ServiceUnavailableException('O provedor de notificações recusou o teste.');
    }
    return { ok: true };
  }

  /**
   * Venda de exemplo para os outros aparelhos da conta (ex.: do computador para
   * o celular, que pode estar bloqueado e tocar o som do sistema).
   */
  async testOthers(userId: string, workspaceId: string, exceptEndpoint?: string) {
    const [devices, sample] = await Promise.all([
      this.db.from('sales_push_devices').select('*').eq('user_id', userId),
      this.samplePayload(userId, workspaceId),
    ]);
    if (devices.error) throw new ServiceUnavailableException('Simulação de venda indisponível.');
    const targets = ((devices.data ?? []) as Device[]).filter((d) => d.endpoint !== exceptEndpoint);
    if (!targets.length) throw new NotFoundException('Nenhum outro aparelho com notificações ativas. Ative no celular primeiro.');
    const results = await Promise.all(targets.map(async (device) => {
      try {
        await this.send(device, sample.vapidDetails, sample.payload);
        return 'sent' as const;
      } catch (error) {
        return (await this.removeExpired(device, error)) ? 'expired' as const : 'failed' as const;
      }
    }));
    const sent = results.filter((r) => r === 'sent').length;
    if (!sent) {
      throw results.every((r) => r === 'expired')
        ? new NotFoundException('Os aparelhos cadastrados expiraram. Ative as notificações no celular de novo.')
        : new ServiceUnavailableException('O provedor de notificações recusou o teste.');
    }
    return { sent, failed: results.length - sent };
  }

  async tick() {
    const vapidDetails = await this.vapid();
    if (!vapidDetails) return { claimed: 0, sent: 0 };
    const { data, error } = await this.db.rpc('claim_sales_web_push');
    if (error) throw new ServiceUnavailableException('Fila de notificações indisponível.');
    const events = (data ?? []) as Event[];
    let sent = 0;
    for (let offset = 0; offset < events.length; offset += 5) {
      const batch = await Promise.all(events.slice(offset, offset + 5).map((event) => this.deliver(event, vapidDetails)));
      sent += batch.filter(Boolean).length;
    }
    return { claimed: events.length, sent };
  }

  private async deliver(event: Event, vapidDetails: Vapid) {
    try {
      const sent = await this.deliverToDevice(event, vapidDetails);
      await this.finish(event);
      return sent;
    } catch {
      // A concessão expira sozinha para uma nova tentativa, sem interferir nas vendas.
      return false;
    }
  }

  private async finish(event: Event) {
    const { error } = await this.db.from('sales_push_outbox').update({ finished_at: new Date().toISOString() })
      .eq('id', event.id).eq('attempts', event.attempts);
    if (error) throw error;
  }

  private async deliverToDevice(event: Event, vapidDetails: Vapid) {
    const [deviceResult, workspaceResult, anchorResult, preferences] = await Promise.all([
      this.db.from('sales_push_devices').select('*').eq('id', event.device_id).maybeSingle(),
      this.db.from('workspaces').select('id,user_id,name,emoji').eq('id', event.workspace_id)
        .is('redirect_workspace_id', null).maybeSingle(),
      this.db.from('sales').select(SALE_FIELDS).eq('id', event.anchor_sale_id).eq('workspace_id', event.workspace_id).maybeSingle(),
      this.readPreferences(event.workspace_id),
    ]);
    if (deviceResult.error || workspaceResult.error || anchorResult.error) throw new Error('Push event lookup failed');
    const device = deviceResult.data as Device | null;
    const workspace = workspaceResult.data;
    const anchor = anchorResult.data as Sale | null;
    if (!device || !workspace || device.user_id !== workspace.user_id || !preferences[event.sale_status]
      || !anchor || anchor.status !== event.sale_status) return false;

    const [lines, usesCommission] = await Promise.all([
      this.readOrder(anchor, event.workspace_id),
      this.usesCommission(anchor.checkout_integration_id, event.workspace_id),
    ]);
    if (lines.some((line) => line.status === 'refunded' || line.status === 'chargeback')) return false;
    const matching = lines.filter((line) => line.status === event.sale_status);
    if (!matching.length) return false;

    const payload = saleNotification(event.sale_status, matching, preferences, workspace, usesCommission);
    try {
      await this.send(device, vapidDetails, payload, event.id);
      return true;
    } catch (error) {
      if (await this.removeExpired(device, error)) return false;
      throw error;
    }
  }

  private async readOrder(anchor: Sale, workspaceId: string): Promise<Sale[]> {
    if (!anchor.order_external_id) return [anchor];
    const query = this.db.from('sales').select(SALE_FIELDS).eq('workspace_id', workspaceId)
      .eq('order_external_id', anchor.order_external_id).order('id');
    const { data, error } = await (anchor.checkout_integration_id
      ? query.eq('checkout_integration_id', anchor.checkout_integration_id)
      : query.is('checkout_integration_id', null));
    if (error) throw error;
    return data;
  }

  private async usesCommission(id: string | null, workspaceId: string) {
    if (!id) return false;
    const { data, error } = await this.db.from('checkout_integrations').select('use_commission_value')
      .eq('id', id).eq('workspace_id', workspaceId).maybeSingle();
    if (error) throw error;
    return data?.use_commission_value ?? false;
  }

  private async send(device: Device, vapidDetails: Vapid, payload: { title: string; body: string; url: string }, eventId?: string) {
    if (!isPushEndpoint(device.endpoint)) throw new Error('Push provider unavailable');
    const topic = eventId ? createHash('sha256').update(eventId).digest('base64url').slice(0, 32) : undefined;
    await sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      JSON.stringify({ ...payload, tag: topic, sale: Boolean(eventId) }), { vapidDetails, TTL: 3600, urgency: 'high', timeout: 6000, topic });
  }

  private async removeExpired(device: Device, error: unknown) {
    const status = (error as { statusCode?: number } | null)?.statusCode;
    if (status !== 404 && status !== 410) return false;
    const { error: removalError } = await this.db.from('sales_push_devices').delete()
      .eq('id', device.id).eq('user_id', device.user_id).eq('p256dh', device.p256dh).eq('auth', device.auth);
    if (removalError) throw removalError;
    return true;
  }
}
