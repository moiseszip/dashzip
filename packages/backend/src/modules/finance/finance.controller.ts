import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { EXPENSE_CATEGORIES, ExpenseCategory } from './expenses';
import { PAYMENT_METHODS } from './finance-totals';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SupabaseService } from '../../shared/services/supabase.service';
import { FinanceService } from './finance.service';

class FinancePeriodDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['7', '30', '90'])
  days?: '7' | '30' | '90';
}

class CheckoutRuleDto {
  @Matches(/^[a-z0-9-]{2,40}$/)
  platform!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  percent!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  fixedBRL!: number;
}

class FinanceSettingsDto {
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  salesTaxPercent!: number | null;

  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  usdAdTaxPercent!: number | null;

  @IsArray()
  @ArrayMaxSize(40)
  @ArrayUnique((rule: CheckoutRuleDto) => rule?.platform)
  @ValidateNested({ each: true })
  @Type(() => CheckoutRuleDto)
  checkoutRules!: CheckoutRuleDto[];
}

const RULE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class ExtraFeeDto {
  @Matches(RULE_ID) id!: string;
  @IsString() @Length(1, 80) description!: string;
  @IsIn(['tax', 'fee']) kind!: 'tax' | 'fee';
  @IsIn(['all', ...PAYMENT_METHODS]) paymentMethod!: 'all' | 'pix' | 'credit_card' | 'boleto' | 'other';
  @IsArray() @ArrayMaxSize(20) @Matches(/^[a-z0-9-]{2,40}$/, { each: true }) platforms!: string[];
  @IsIn(['gross', 'net']) base!: 'gross' | 'net';
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) percent!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) fixedBRL!: number;
}

class MediaTaxRuleDto {
  @Matches(RULE_ID) id!: string;
  @IsString() @Length(1, 80) description!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) percent!: number;
  @IsIn(['all', 'currency', 'accounts']) scope!: 'all' | 'currency' | 'accounts';
  @ValidateIf((rule: MediaTaxRuleDto) => rule.scope === 'currency') @Matches(/^[A-Z]{3}$/) currency!: string | null;
  @IsArray() @ArrayMaxSize(50) @Matches(/^(act_)?\d{5,22}$/, { each: true }) accountIds!: string[];
}

class ProductCostDto {
  @Matches(RULE_ID) id!: string;
  @IsString() @Length(1, 200) productName!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) costBRL!: number;
  @ValidateIf((_, value) => value !== null) @IsString() @Length(1, 60) group!: string | null;
}

class FullSettingsDto {
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100)
  salesTaxPercent!: number | null;

  @IsArray() @ArrayMaxSize(40) @ArrayUnique((rule: CheckoutRuleDto) => rule?.platform)
  @ValidateNested({ each: true }) @Type(() => CheckoutRuleDto)
  checkoutRules!: CheckoutRuleDto[];

  @IsArray() @ArrayMaxSize(50) @ArrayUnique((fee: ExtraFeeDto) => fee?.id)
  @ValidateNested({ each: true }) @Type(() => ExtraFeeDto)
  extraFees!: ExtraFeeDto[];

  @IsArray() @ArrayMaxSize(50) @ArrayUnique((rule: MediaTaxRuleDto) => rule?.id)
  @ValidateNested({ each: true }) @Type(() => MediaTaxRuleDto)
  mediaTaxRules!: MediaTaxRuleDto[];

  @IsArray() @ArrayMaxSize(500) @ArrayUnique((cost: ProductCostDto) => cost?.productName?.trim().toLowerCase())
  @ValidateNested({ each: true }) @Type(() => ProductCostDto)
  productCosts!: ProductCostDto[];
}

class ExpenseDto {
  @IsString() @Length(1, 120) description!: string;
  @IsIn([...EXPENSE_CATEGORIES]) category!: ExpenseCategory;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) amountBRL!: number;
  @IsIn(['single', 'recurring']) kind!: 'single' | 'recurring';
  @ValidateIf((e: ExpenseDto) => e.kind === 'single') @Matches(DAY) date!: string | null;
  @ValidateIf((e: ExpenseDto) => e.kind === 'recurring') @Matches(DAY) startDate!: string | null;
  @ValidateIf((e: ExpenseDto) => e.kind === 'recurring' && e.endDate !== null && e.endDate !== undefined) @Matches(DAY) endDate!: string | null;
  @ValidateIf((e: ExpenseDto) => e.kind === 'recurring') @IsInt() @Min(1) @Max(28) recurringDay!: number | null;
}

class ExpensesQueryDto {
  @Matches(DAY) since!: string;
  @Matches(DAY) until!: string;
}

class AdvertisingAccountDto {
  @Matches(/^(act_)?\d{5,22}$/)
  accountId!: string;

  @IsString()
  @Length(20, 2_000)
  @Matches(/^\S+$/)
  accessToken!: string;
}

@Controller('finance/:workspaceId')
@UseGuards(AuthGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService, private readonly supabase: SupabaseService) {}

  @Get()
  async overview(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Query() q: FinancePeriodDto) {
    await this.assertDashboard(userId, id);
    return this.finance.overview(id, Number(q.days ?? '7'));
  }

  @Get('settings')
  async settings(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string) {
    await this.assertDashboard(userId, id);
    return this.finance.settings(id);
  }

  @Patch('settings')
  async save(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: FinanceSettingsDto) {
    await this.assertDashboard(userId, id);
    return this.finance.saveSettings(id, body);
  }

  @Put('settings')
  async replace(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: FullSettingsDto) {
    await this.assertDashboard(userId, id);
    return this.finance.replaceSettings(id, {
      ...body,
      usdAdTaxPercent: null,
      mediaTaxRules: body.mediaTaxRules.map((rule) => ({
        ...rule, currency: rule.scope === 'currency' ? rule.currency : null,
        accountIds: rule.scope === 'accounts' ? rule.accountIds.map((a) => `act_${a.replace(/^act_/, '')}`) : [],
      })),
      productCosts: body.productCosts.map((cost) => ({ ...cost, productName: cost.productName.trim() })),
    });
  }

  @Get('expenses')
  async expenses(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Query() q: ExpensesQueryDto) {
    await this.assertDashboard(userId, id);
    if (q.since > q.until) throw new BadRequestException('O início do período é depois do fim.');
    if ((Date.parse(q.until) - Date.parse(q.since)) / 86_400_000 > 400) throw new BadRequestException('O período pode ter no máximo 400 dias.');
    return this.finance.listExpenses(id, q.since, q.until);
  }

  @Post('expenses')
  async createExpense(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: ExpenseDto) {
    await this.assertDashboard(userId, id);
    return this.finance.createExpense(id, this.expense(body));
  }

  @Patch('expenses/:expenseId')
  async updateExpense(
    @CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string, @Body() body: ExpenseDto,
  ) {
    await this.assertDashboard(userId, id);
    return this.finance.updateExpense(id, expenseId, this.expense(body));
  }

  @Delete('expenses/:expenseId')
  async deleteExpense(
    @CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    await this.assertDashboard(userId, id);
    return this.finance.deleteExpense(id, expenseId);
  }

  @Post('accounts')
  async connect(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: AdvertisingAccountDto) {
    await this.assertDashboard(userId, id);
    return this.finance.connect(userId, id, body.accountId, body.accessToken);
  }

  @Delete('accounts/:connectionId')
  async deactivate(
    @CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    await this.assertDashboard(userId, id);
    return this.finance.deactivate(userId, id, connectionId);
  }

  private expense(body: ExpenseDto) {
    const recurring = body.kind === 'recurring';
    if (recurring && body.endDate && body.startDate && body.endDate < body.startDate) {
      throw new BadRequestException('O fim da despesa recorrente é antes do início.');
    }
    return {
      description: body.description, category: body.category, amountBRL: body.amountBRL, kind: body.kind,
      date: recurring ? null : body.date,
      startDate: recurring ? body.startDate : null,
      endDate: recurring ? body.endDate ?? null : null,
      recurringDay: recurring ? body.recurringDay : null,
    };
  }

  private async assertDashboard(userId: string, workspaceId: string) {
    const { data, error } = await this.supabase.getClient().from('workspaces').select('id')
      .eq('id', workspaceId).eq('user_id', userId).is('redirect_workspace_id', null).maybeSingle();
    if (error || !data) throw new ForbiddenException('Painel indisponível para este usuário.');
  }
}
