import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { CacheService } from '../../shared/services/cache.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { dayInTimezone, dayRangeUtc } from '../../shared/helpers/timezone';
import {
  AdAccountSummary, FinanceCheckout, FinanceSale, FinanceSettings,
  mediaTotals, PAYMENT_METHODS, parseSettingsRow, roundMoney, salesTotals, SETTINGS_COLUMNS, shiftDay, usdRateForDay,
} from './finance-totals';
import { Expense, EXPENSE_CATEGORIES, expenseFromRow, expenseOccurrences, ExpenseRow, sumOccurrences } from './expenses';
import { MetaSpendService } from './meta-spend.service';
import { CHECKOUT_SPECS } from '../webhooks/processors/generic/checkout-specs';

const ACCOUNT_FIELDS = 'id,ad_account_id,account_name,account_currency,account_timezone,is_active';

interface AccountRow {
  id: string;
  ad_account_id: string;
  account_name: string | null;
  account_currency: string | null;
  account_timezone: string | null;
  is_active: boolean;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly cache: CacheService,
    private readonly meta: MetaSpendService,
    private readonly timezones: WorkspaceTimezoneService,
  ) {}

  async settings(workspaceId: string) {
    const db = this.supabase.getClient();
    const [settings, accounts] = await Promise.all([
      this.readSettings(workspaceId),
      db.from('facebook_connections').select(ACCOUNT_FIELDS).eq('workspace_id', workspaceId).order('created_at'),
    ]);
    if (accounts.error) throw new InternalServerErrorException('Não foi possível listar as contas.');
    return {
      ...settings,
      accounts: (accounts.data ?? []).map((row) => this.account(row)),
      options: await this.settingsOptions(workspaceId, settings),
    };
  }

  /**
   * PATCH antigo do Resultado (imposto, custo USD e regras por checkout). O
   * custo USD continua indo para a regra "legacy-usd", para haver uma fonte só.
   */
  async saveSettings(workspaceId: string, legacy: Pick<FinanceSettings, 'salesTaxPercent' | 'usdAdTaxPercent' | 'checkoutRules'>) {
    const current = await this.readSettings(workspaceId);
    const others = current.mediaTaxRules.filter((rule) => rule.id !== 'legacy-usd');
    const mediaTaxRules = legacy.usdAdTaxPercent === null ? others : [{
      id: 'legacy-usd', description: 'Custo sobre mídia em USD (IOF)', percent: legacy.usdAdTaxPercent,
      scope: 'currency' as const, currency: 'USD', accountIds: [],
    }, ...others];
    return this.replaceSettings(workspaceId, { ...current, ...legacy, mediaTaxRules });
  }

  /** PUT: substitui a configuração inteira (já validada no controller). */
  async replaceSettings(workspaceId: string, settings: FinanceSettings) {
    const legacyUsd = settings.mediaTaxRules.find((rule) => rule.id === 'legacy-usd');
    const { error } = await this.supabase.getClient().from('dashboard_finance_settings').upsert({
      workspace_id: workspaceId,
      sales_tax_percent: settings.salesTaxPercent,
      usd_ad_tax_percent: legacyUsd ? legacyUsd.percent : null,
      checkout_rules: settings.checkoutRules,
      extra_fees: settings.extraFees,
      media_tax_rules: settings.mediaTaxRules,
      product_costs: settings.productCosts,
    });
    if (error) throw new InternalServerErrorException('Não foi possível salvar as taxas.');
    this.cache.invalidateByPrefix('campaigns:');
    return this.settings(workspaceId);
  }

  /** Opções dos selects da tela: meios de pagamento, plataformas do painel e produtos já vendidos. */
  private async settingsOptions(workspaceId: string, settings: FinanceSettings) {
    const db = this.supabase.getClient();
    const [checkouts, products] = await Promise.all([
      db.from('checkout_integrations').select('id,name,platform,is_active,use_commission_value').eq('workspace_id', workspaceId),
      db.from('sales').select('product_name').eq('workspace_id', workspaceId).not('product_name', 'is', null)
        .order('sold_at', { ascending: false }).limit(3000),
    ]);
    const productNames = new Set<string>();
    for (const row of products.data ?? []) if (row.product_name?.trim()) productNames.add(row.product_name.trim());
    for (const cost of settings.productCosts) productNames.add(cost.productName);
    return {
      paymentMethods: ['all', ...PAYMENT_METHODS],
      platforms: [...new Set((checkouts.data ?? []).map((row) => row.platform))].sort(),
      checkouts: await this.checkoutFeeNeeds(workspaceId, checkouts.data ?? []),
      products: [...productNames].sort((a, b) => a.localeCompare(b)),
      expenseCategories: [...EXPENSE_CATEGORIES],
    };
  }

  /**
   * Para cada checkout do painel: a venda chega pela comissão (já sem a taxa)
   * ou pelo valor cheio? E o provedor informa a taxa no webhook? Só quando
   * chega o valor cheio sem taxa informada a regra de taxa de checkout faz
   * diferença. A conferência olha as últimas 30 vendas aprovadas.
   */
  private async checkoutFeeNeeds(
    workspaceId: string,
    checkouts: { id: string; name: string | null; platform: string; is_active: boolean | null; use_commission_value: boolean | null }[],
  ) {
    const db = this.supabase.getClient();
    return Promise.all(checkouts.map(async (checkout) => {
      const { data } = await db.from('sales').select('metadata').eq('workspace_id', workspaceId)
        .eq('checkout_integration_id', checkout.id).eq('status', 'approved').order('sold_at', { ascending: false }).limit(30);
      const recent = (data ?? []) as { metadata: FinanceSale['metadata'] }[];
      const receivesCommission = !!checkout.use_commission_value || recent.some((row) => row.metadata?.amount_is_net === true);
      // O parser da plataforma lê a taxa do webhook (Wiapy: payment.fee; AbacatePay: platformFee),
      // ou as vendas recentes já trouxeram a taxa.
      const feeReportedByProvider = !!CHECKOUT_SPECS[checkout.platform]?.fee
        || recent.some((row) => typeof row.metadata?.payment_fee === 'number');
      return {
        integrationId: checkout.id,
        name: checkout.name || checkout.platform,
        platform: checkout.platform,
        active: checkout.is_active !== false,
        receivesCommission,
        feeReportedByProvider,
        needsFeeRule: !receivesCommission && !feeReportedByProvider,
        recentSales: recent.length,
      };
    }));
  }

  // ---- Despesas ------------------------------------------------------------

  async listExpenses(workspaceId: string, since: string, until: string) {
    const expenses = await this.readExpenses(workspaceId);
    const occurrences = expenseOccurrences(expenses, since, until);
    return { since, until, expenses, occurrences, totalBRL: sumOccurrences(occurrences) };
  }

  async createExpense(workspaceId: string, expense: Omit<Expense, 'id'>) {
    const { data, error } = await this.supabase.getClient().from('dashboard_expenses')
      .insert({ workspace_id: workspaceId, ...this.expenseRow(expense) }).select('*').single();
    if (error || !data) throw new InternalServerErrorException('Não foi possível salvar a despesa.');
    return expenseFromRow(data as ExpenseRow);
  }

  async updateExpense(workspaceId: string, id: string, expense: Omit<Expense, 'id'>) {
    const { data, error } = await this.supabase.getClient().from('dashboard_expenses')
      .update({ ...this.expenseRow(expense), updated_at: new Date().toISOString() })
      .eq('id', id).eq('workspace_id', workspaceId).select('*').maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível salvar a despesa.');
    if (!data) throw new NotFoundException('Despesa não encontrada.');
    return expenseFromRow(data as ExpenseRow);
  }

  async deleteExpense(workspaceId: string, id: string) {
    const { data, error } = await this.supabase.getClient().from('dashboard_expenses')
      .delete().eq('id', id).eq('workspace_id', workspaceId).select('id').maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível apagar a despesa.');
    if (!data) throw new NotFoundException('Despesa não encontrada.');
    return { success: true };
  }

  async readExpenses(workspaceId: string): Promise<Expense[]> {
    const { data, error } = await this.supabase.getClient().from('dashboard_expenses')
      .select('id,description,category,amount_brl,kind,date,start_date,end_date,recurring_day')
      .eq('workspace_id', workspaceId).order('created_at');
    // Tabela ainda não criada (migration pendente): sem despesas.
    if (error?.code === '42P01' || error?.code === 'PGRST205') return [];
    if (error) throw new InternalServerErrorException('Não foi possível ler as despesas.');
    return (data ?? []).map((row) => expenseFromRow(row as ExpenseRow));
  }

  private expenseRow(expense: Omit<Expense, 'id'>) {
    const single = expense.kind === 'single';
    return {
      description: expense.description.trim(), category: expense.category, amount_brl: expense.amountBRL, kind: expense.kind,
      date: single ? expense.date : null,
      start_date: single ? null : expense.startDate,
      end_date: single ? null : expense.endDate,
      recurring_day: single ? null : expense.recurringDay,
    };
  }

  async connect(userId: string, workspaceId: string, accountId: string, accessToken: string) {
    const canonicalId = `act_${accountId.replace(/^act_/, '')}`;
    const db = this.supabase.getClient();
    const existing = await db.from('facebook_connections').select('id,workspace_id')
      .eq('user_id', userId).in('ad_account_id', [canonicalId, canonicalId.slice(4)]).maybeSingle();
    if (existing.error) throw new InternalServerErrorException('Não foi possível conferir esta conta.');
    if (existing.data && existing.data.workspace_id !== workspaceId) {
      throw new ConflictException('Esta conta já está vinculada a outro painel.');
    }

    const verified = await this.meta.verify(canonicalId, accessToken);
    const values = {
      ad_account_id: canonicalId,
      account_name: verified.name.trim(),
      account_currency: verified.currency,
      account_timezone: verified.timezone_name ?? null,
      account_status: verified.account_status ?? null,
      access_token: this.encryption.encrypt(accessToken),
      is_valid: true,
      is_active: true,
      last_validated_at: new Date().toISOString(),
    };
    const result = existing.data
      ? await db.from('facebook_connections').update(values)
        .eq('id', existing.data.id).eq('workspace_id', workspaceId).eq('user_id', userId).select(ACCOUNT_FIELDS).single()
      : await db.from('facebook_connections').insert({ ...values, workspace_id: workspaceId, user_id: userId })
        .select(ACCOUNT_FIELDS).single();
    if (result.error?.code === '23505') throw new ConflictException('Esta conta já foi cadastrada.');
    if (result.error || !result.data) throw new InternalServerErrorException('Não foi possível vincular a conta.');
    this.cache.invalidateByPrefix(`finance:media:${result.data.id}:`);
    return this.account(result.data);
  }

  async deactivate(userId: string, workspaceId: string, connectionId: string) {
    const { data, error } = await this.supabase.getClient().from('facebook_connections').update({ is_active: false })
      .eq('id', connectionId).eq('workspace_id', workspaceId).eq('user_id', userId).select('id').maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível desativar a conta.');
    if (!data) throw new NotFoundException('Conta de anúncios não encontrada.');
    this.cache.invalidateByPrefix(`finance:media:${connectionId}:`);
    return { success: true };
  }

  async overview(workspaceId: string, days: number) {
    const timeZone = await this.timezones.get(workspaceId);
    const until = dayInTimezone(new Date(), timeZone);
    const since = shiftDay(until, 1 - days);
    const db = this.supabase.getClient();
    const [settings, sales, connections, checkouts, expenses] = await Promise.all([
      this.readSettings(workspaceId),
      this.readSales(workspaceId, since, until, timeZone),
      db.from('facebook_connections').select(`${ACCOUNT_FIELDS},access_token`)
        .eq('workspace_id', workspaceId).eq('is_active', true).order('created_at'),
      db.from('checkout_integrations').select('id,platform,use_commission_value').eq('workspace_id', workspaceId),
      this.readExpenses(workspaceId),
    ]);
    if (connections.error || checkouts.error) throw new InternalServerErrorException('Não foi possível carregar as integrações.');

    const requiresUSD = sales.some((sale) => sale.currency?.toUpperCase() === 'USD')
      || (connections.data ?? []).some((row) => row.account_currency === 'USD');
    const [quotes, activities] = await Promise.all([
      requiresUSD ? this.meta.ptax(since, until).catch(() => new Map<string, number>()) : new Map<string, number>(),
      Promise.all((connections.data ?? []).map(async (row) => ({
        account: this.account(row),
        days: await this.meta.campaignDays(row.id, row.ad_account_id, row.access_token, since, until).catch(() => null),
      }))),
    ]);
    const exchangeRate = (currency: string, day: string) => {
      if (currency === 'BRL') return 1;
      return currency === 'USD' ? usdRateForDay(quotes, day) : null;
    };
    const salesReport = salesTotals(sales, (checkouts.data ?? []) as FinanceCheckout[], settings, exchangeRate, timeZone);
    const media = mediaTotals(activities, exchangeRate, settings.mediaTaxRules);
    const expensesBRL = sumOccurrences(expenseOccurrences(expenses, since, until));
    const resultBeforeExpensesBRL = salesReport.afterDeductionsBRL === null || media.spendBRL === null || media.taxBRL === null
      ? null : roundMoney(salesReport.afterDeductionsBRL - media.spendBRL - media.taxBRL);
    return {
      since, until, sales: salesReport, media, expensesBRL, resultBeforeExpensesBRL,
      resultBRL: resultBeforeExpensesBRL === null ? null : roundMoney(resultBeforeExpensesBRL - expensesBRL),
      salesTaxConfigured: settings.salesTaxPercent !== null,
      usdAdTaxConfigured: settings.mediaTaxRules.length > 0,
    };
  }

  /**
   * Tolera o banco sem a migration 20261122170000 (colunas novas ausentes,
   * erro 42703): lê só as colunas antigas. Assim o deploy do backend antes da
   * migration não derruba o Resultado.
   */
  async readSettings(workspaceId: string): Promise<FinanceSettings> {
    const table = () => this.supabase.getClient().from('dashboard_finance_settings');
    let result = await table().select(SETTINGS_COLUMNS).eq('workspace_id', workspaceId).maybeSingle();
    if (result.error?.code === '42703') {
      result = await table().select('sales_tax_percent,usd_ad_tax_percent,checkout_rules').eq('workspace_id', workspaceId).maybeSingle();
    }
    if (result.error) throw new InternalServerErrorException('Não foi possível carregar as taxas.');
    return parseSettingsRow(result.data);
  }

  private async readSales(workspaceId: string, since: string, until: string, timeZone: string): Promise<FinanceSale[]> {
    const db = this.supabase.getClient();
    const { from, to } = dayRangeUtc(since, until, timeZone);
    const sales: FinanceSale[] = [];
    const size = 500;
    const maxRows = 25_000;
    for (let offset = 0; offset <= maxRows; offset += size) {
      const { data, error } = await db.from('sales')
        .select('id,external_id,order_external_id,checkout_integration_id,amount,currency,status,sold_at,metadata,payment_method,product_name')
        .eq('workspace_id', workspaceId)
        .gte('sold_at', from).lt('sold_at', to)
        .order('sold_at', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + size - 1);
      if (error) throw new InternalServerErrorException('Não foi possível ler as vendas.');
      sales.push(...((data ?? []) as FinanceSale[]));
      if (sales.length > maxRows) break;
      if ((data ?? []).length < size) return sales;
    }
    throw new InternalServerErrorException('Há vendas demais neste período. Selecione um intervalo menor.');
  }

  private account(row: AccountRow): AdAccountSummary {
    return {
      id: row.id,
      accountId: row.ad_account_id,
      name: row.account_name || row.ad_account_id,
      currency: row.account_currency || '—',
      timezone: row.account_timezone,
      active: row.is_active,
    };
  }
}
