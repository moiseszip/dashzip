import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import {
  normalizeState,
  normalizeCity,
} from '../../shared/helpers/normalize-state';
import {
  getStateFromPhone,
  getStateFromDDD,
} from '../../shared/helpers/ddd-to-state';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Extracts a long numeric ad_id from composite tracking strings.
   * Supports separators: | (pipe) and / (slash)
   */
  extractNumericAdId(raw: string | null): string | null {
    if (!raw) return null;
    const parts = raw.split(/[|\/]/);
    const numericPart = parts.find((p) => /^\d{6,}$/.test(p.trim()));
    return numericPart?.trim() || raw;
  }

  /**
   * Extracts the ad_id from tracking parameters based on priority
   */
  extractAdId(tracking: Record<string, any>): string | null {
    return (
      tracking?.ad_id ||
      tracking?.utm_term ||
      tracking?.utm_content ||
      tracking?.src ||
      tracking?.sck ||
      null
    );
  }

  /**
   * Maps checkout platform status to our internal status
   */
  mapStatus(
    status: string,
    platform: 'hotmart' | 'kiwify' | 'kirvano',
  ): string {
    const normalizedStatus = status.toLowerCase();

    if (platform === 'hotmart') {
      const hotmartStatusMap: Record<string, string> = {
        approved: 'approved',
        purchase_approved: 'approved',
        completed: 'approved',
        purchase_complete: 'approved',
        refunded: 'refunded',
        purchase_refunded: 'refunded',
        canceled: 'refunded',
        purchase_canceled: 'refunded',
        protest: 'refunded',
        purchase_protest: 'refunded',
        chargeback: 'refunded',
        purchase_chargeback: 'refunded',
        billet_printed: 'pending',
        waiting_payment: 'pending',
        pending: 'pending',
      };
      return hotmartStatusMap[normalizedStatus] || 'pending';
    }

    if (platform === 'kiwify') {
      const kiwifyStatusMap: Record<string, string> = {
        paid: 'approved',
        approved: 'approved',
        completed: 'approved',
        refunded: 'refunded',
        chargedback: 'refunded',
        cancelled: 'refunded',
        waiting: 'pending',
        pending: 'pending',
      };
      return kiwifyStatusMap[normalizedStatus] || 'pending';
    }

    if (platform === 'kirvano') {
      const kirvanoStatusMap: Record<string, string> = {
        approved: 'approved',
        paid: 'approved',
        completed: 'approved',
        refunded: 'refunded',
        chargeback: 'refunded',
        cancelled: 'refunded',
        pending: 'pending',
        waiting: 'pending',
      };
      return kirvanoStatusMap[normalizedStatus] || 'pending';
    }

    return 'pending';
  }

  /**
   * Fallback refund resolution: when external_id lookup fails for a refund webhook,
   * finds the most recent approved sale matching customer_email + product_name +
   * checkout_integration_id and updates its status to 'refunded'.
   *
   * Returns the matched sale { id } or null if no match found.
   */
  async findAndRefundOriginalSale(params: {
    userId: string;
    customerEmail: string | null;
    productName: string | null;
    checkoutIntegrationId: string;
    platform: string;
  }): Promise<{ id: string } | null> {
    const { userId, customerEmail, productName, checkoutIntegrationId, platform } = params;

    if (!customerEmail) {
      this.logger.warn(
        `[findAndRefundOriginalSale] No customer email for ${platform} refund — cannot match`,
      );
      return null;
    }

    const supabaseAdmin = this.supabase.getClient();

    let query = supabaseAdmin
      .from('sales')
      .select('id')
      .eq('user_id', userId)
      .eq('checkout_integration_id', checkoutIntegrationId)
      .eq('status', 'approved')
      .eq('customer_email', customerEmail);

    if (productName) {
      query = query.eq('product_name', productName);
    }

    const { data: match, error } = await query
      .order('sold_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `[findAndRefundOriginalSale] Query error for ${platform}: ${error.message}`,
      );
      return null;
    }

    if (!match) {
      this.logger.warn(
        `[findAndRefundOriginalSale] No matching approved sale for ${platform} refund`,
      );
      return null;
    }

    const { error: updateError } = await supabaseAdmin
      .from('sales')
      .update({ status: 'refunded' })
      .eq('id', match.id);

    if (updateError) {
      this.logger.error(
        `[findAndRefundOriginalSale] Failed to update sale ${match.id}: ${updateError.message}`,
      );
      return null;
    }

    this.logger.log(
      `[findAndRefundOriginalSale] Matched ${platform} refund to sale ${match.id} via fallback`,
    );
    return { id: match.id };
  }

  // Proxy methods for helpers
  normalizeState(input: string | null | undefined): string | null {
    return normalizeState(input);
  }

  normalizeCity(input: string | null | undefined): string | null {
    return normalizeCity(input);
  }

  getStateFromPhone(phone: string | null | undefined): string | null {
    return getStateFromPhone(phone);
  }

  getStateFromDDD(ddd: string | null | undefined): string | null {
    return getStateFromDDD(ddd);
  }
}
