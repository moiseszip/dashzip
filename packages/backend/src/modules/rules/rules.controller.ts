import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Put, Query,
  ServiceUnavailableException, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { createHash } from 'node:crypto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SupabaseService } from '../../shared/services/supabase.service';
import { ACTIONS, FREQUENCIES, OPERATORS, RULE_METRICS, RuleDefinition, WINDOWS } from './rules-engine';
import { RuleInput, RulesService } from './rules.service';

class ConditionDto {
  @IsIn(Object.keys(RULE_METRICS)) metric!: keyof typeof RULE_METRICS;
  @IsIn([...OPERATORS]) operator!: (typeof OPERATORS)[number];
  @IsNumber() @Min(-1_000_000_000) @Max(1_000_000_000) valueA!: number;
  @ValidateIf((c: ConditionDto) => c.operator === 'between' || c.operator === 'not_between')
  @IsNumber() @Min(-1_000_000_000) @Max(1_000_000_000) valueB!: number | null;
}

class ActionDto {
  @IsIn([...ACTIONS]) type!: (typeof ACTIONS)[number];
  @ValidateIf((a: ActionDto) => a.valueType !== null && a.valueType !== undefined) @IsIn(['percentage', 'amount']) valueType!: 'percentage' | 'amount' | null;
  @ValidateIf((a: ActionDto) => a.value !== null && a.value !== undefined) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) value!: number | null;
  @ValidateIf((a: ActionDto) => a.limit !== null && a.limit !== undefined) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(1_000_000) limit!: number | null;
}

class RuleDefinitionDto {
  @IsIn(['campaign', 'adset', 'ad']) level!: 'campaign' | 'adset' | 'ad';
  @IsIn(['active', 'paused']) targetStatus!: 'active' | 'paused';
  @IsArray() @ArrayMaxSize(50) @Matches(/^(act_)?\d{5,22}$/, { each: true }) accountIds!: string[];
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsString() @Length(1, 80) nameContains!: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ConditionDto) conditions!: ConditionDto[];
  @IsIn([...WINDOWS]) window!: (typeof WINDOWS)[number];
  @ValidateNested() @Type(() => ActionDto) action!: ActionDto;
  @IsIn([...FREQUENCIES]) frequencyMinutes!: (typeof FREQUENCIES)[number];
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsInt() @Min(0) @Max(23) dailyHour!: number | null;
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsInt() @Min(1) @Max(288) maxRunsPerDay!: number | null;
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsInt() @Min(0) @Max(23) hourStart!: number | null;
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsInt() @Min(0) @Max(23) hourEnd!: number | null;
}

class RuleDto extends RuleDefinitionDto {
  @IsString() @Length(1, 80) name!: string;
  @IsBoolean() enabled!: boolean;
}

class EnabledDto {
  @IsBoolean() enabled!: boolean;
}

class RunsQueryDto {
  @IsOptional() @Matches(/^[0-9a-f-]{36}$/i) ruleId?: string;
  @IsOptional() @Matches(/^\d{1,3}$/) limit?: string;
  @IsOptional() @IsString() @Length(10, 40) before?: string;
}

/** Normaliza e confere a coerência da regra. Exportada para teste. */
export function normalizeRule(body: RuleDefinitionDto): RuleDefinition {
  const action = body.action;
  const budget = ['increase_budget', 'decrease_budget', 'set_budget'].includes(action.type);
  if (budget && body.level === 'ad') throw new BadRequestException('Anúncio não tem orçamento: use campanha ou conjunto.');
  if (action.type === 'pause' && body.targetStatus !== 'active') throw new BadRequestException('Pausar só vale para objetos ativos.');
  if (action.type === 'activate' && body.targetStatus !== 'paused') throw new BadRequestException('Ativar só vale para objetos pausados.');
  if (budget && (action.value === null || action.value === undefined || action.value <= 0)) {
    throw new BadRequestException('Informe o valor do ajuste de orçamento.');
  }
  if ((action.type === 'increase_budget' || action.type === 'decrease_budget') && !action.valueType) {
    throw new BadRequestException('Informe se o ajuste é em percentual ou em valor.');
  }
  if (action.valueType === 'percentage' && (action.value ?? 0) > 100) throw new BadRequestException('O percentual vai até 100.');
  if ((body.hourStart === null || body.hourStart === undefined) !== (body.hourEnd === null || body.hourEnd === undefined)) {
    throw new BadRequestException('Informe o início e o fim da faixa de horas, ou nenhum dos dois.');
  }
  if (body.frequencyMinutes !== 1440 && body.dailyHour !== null && body.dailyHour !== undefined) {
    throw new BadRequestException('A hora fixa só vale para a frequência de uma vez por dia.');
  }
  return {
    level: body.level,
    targetStatus: body.targetStatus,
    accountIds: body.accountIds.map((id) => `act_${id.replace(/^act_/, '')}`),
    nameContains: body.nameContains?.trim() || null,
    conditions: body.conditions.map((c) => ({
      metric: c.metric, operator: c.operator, valueA: c.valueA,
      valueB: c.operator === 'between' || c.operator === 'not_between' ? c.valueB : null,
    })),
    window: body.window,
    action: {
      type: action.type,
      valueType: budget ? (action.type === 'set_budget' ? 'amount' : action.valueType) : null,
      value: budget ? action.value : null,
      limit: action.type === 'increase_budget' || action.type === 'decrease_budget' ? action.limit ?? null : null,
    },
    frequencyMinutes: body.frequencyMinutes,
    dailyHour: body.frequencyMinutes === 1440 ? body.dailyHour ?? null : null,
    maxRunsPerDay: body.maxRunsPerDay ?? null,
    hourStart: body.hourStart ?? null,
    hourEnd: body.hourEnd ?? null,
  };
}

@Controller('rules/:workspaceId')
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private readonly rules: RulesService, private readonly supabase: SupabaseService) {}

  @Get()
  async list(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string) {
    await this.assertDashboard(userId, id);
    return this.rules.list(id);
  }

  @Post()
  async create(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: RuleDto) {
    await this.assertDashboard(userId, id);
    return this.rules.create(id, this.input(body));
  }

  @Post('simulate')
  async simulate(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Body() body: RuleDefinitionDto) {
    await this.assertDashboard(userId, id);
    return this.rules.simulate(id, normalizeRule(body));
  }

  @Get('runs')
  async runs(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Query() q: RunsQueryDto) {
    await this.assertDashboard(userId, id);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 20)));
    if (q.before && Number.isNaN(Date.parse(q.before))) throw new BadRequestException('Data inválida em before.');
    return this.rules.runs(id, q.ruleId, limit, q.before);
  }

  @Put(':ruleId')
  async update(
    @CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string, @Body() body: RuleDto,
  ) {
    await this.assertDashboard(userId, id);
    return this.rules.update(id, ruleId, this.input(body));
  }

  @Patch(':ruleId/enabled')
  async enable(
    @CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string, @Body() body: EnabledDto,
  ) {
    await this.assertDashboard(userId, id);
    return this.rules.setEnabled(id, ruleId, body.enabled);
  }

  @Post(':ruleId/run')
  async run(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    await this.assertDashboard(userId, id);
    return this.rules.runNow(id, ruleId);
  }

  @Delete(':ruleId')
  async remove(@CurrentUser('id') userId: string, @Param('workspaceId', ParseUUIDPipe) id: string, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    await this.assertDashboard(userId, id);
    return this.rules.remove(id, ruleId);
  }

  private input(body: RuleDto): RuleInput {
    return { ...normalizeRule(body), name: body.name, enabled: body.enabled };
  }

  private async assertDashboard(userId: string, workspaceId: string) {
    const { data, error } = await this.supabase.getClient().from('workspaces').select('id')
      .eq('id', workspaceId).eq('user_id', userId).is('redirect_workspace_id', null).maybeSingle();
    if (error || !data) throw new ForbiddenException('Painel indisponível para este usuário.');
  }
}

/**
 * Tique das regras, chamado pelo pg_cron a cada 5 minutos (migration
 * 20261122180000). O token do Vault é verificado sem exportar o valor.
 */
@SkipThrottle()
@Controller('rules-cron')
export class RulesCronController {
  constructor(private readonly rules: RulesService, private readonly supabase: SupabaseService) {}

  @Post('tick')
  async tick(@Headers('authorization') authorization: string | undefined) {
    const token = /^Bearer ([^\s]+)$/.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    const digest = createHash('sha256').update(token).digest('hex');
    const { data, error } = await this.supabase.getClient().rpc('verify_dash_rules_cron', { p_digest: digest });
    if (error) throw new ServiceUnavailableException('Validação do agendamento indisponível.');
    if (data !== true) throw new UnauthorizedException();
    return this.rules.tick();
  }
}
