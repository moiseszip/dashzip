import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { createHash } from 'node:crypto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SupabaseService } from '../../shared/services/supabase.service';
import { SalesPushService } from './sales-push.service';

class DeviceEndpointDto {
  @IsString() @MaxLength(2048) endpoint!: string;
}

class DeviceDto extends DeviceEndpointDto {
  @Matches(/^[A-Za-z0-9_-]{87}$/) p256dh!: string;
  @Matches(/^[A-Za-z0-9_-]{22}$/) auth!: string;
}

class TestSaleDto extends DeviceEndpointDto {
  @IsUUID() workspace_id!: string;
  /** Espera antes de enviar, para dar tempo de bloquear a tela (com o app aberto o iOS não toca o som). */
  @IsOptional() @IsInt() @Min(0) @Max(10) delay_seconds?: number;
}

class TestOthersDto {
  @IsUUID() workspace_id!: string;
  /** Canal deste aparelho, para não receber o próprio teste. */
  @IsOptional() @IsString() @MaxLength(2048) except_endpoint?: string;
}

class PreferencesDto {
  @IsBoolean() pending!: boolean;
  @IsBoolean() approved!: boolean;
  @IsIn(['total', 'net', 'hidden']) sale_value!: 'total' | 'net' | 'hidden';
  @IsBoolean() show_product!: boolean;
  @IsBoolean() show_campaign!: boolean;
  @IsBoolean() show_workspace!: boolean;
  @IsOptional() @IsBoolean() show_workspace_icon?: boolean;
}

@Controller('sales-push')
@UseGuards(AuthGuard)
export class SalesPushController {
  constructor(private readonly push: SalesPushService) {}

  @Post('devices')
  register(@CurrentUser('id') userId: string, @Body() body: DeviceDto) {
    return this.push.register(userId, body);
  }

  @Post('devices/remove')
  remove(@CurrentUser('id') userId: string, @Body() body: DeviceEndpointDto) {
    return this.push.remove(userId, body.endpoint);
  }

  @Post('devices/test')
  test(@CurrentUser('id') userId: string, @Body() body: TestSaleDto) {
    return this.push.test(userId, body.endpoint, body.workspace_id, body.delay_seconds ?? 0);
  }

  @Post('devices/test-others')
  testOthers(@CurrentUser('id') userId: string, @Body() body: TestOthersDto) {
    return this.push.testOthers(userId, body.workspace_id, body.except_endpoint);
  }

  @Get('preferences/:id')
  get(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.push.preferences(userId, id);
  }

  @Put('preferences/:id')
  put(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: PreferencesDto) {
    return this.push.save(userId, id, body);
  }
}

@Controller('sales-push-cron')
@SkipThrottle()
export class SalesPushCronController {
  constructor(private readonly push: SalesPushService, private readonly supabase: SupabaseService) {}

  @Post('tick')
  async tick(@Headers('authorization') authorization: string | undefined) {
    const token = /^Bearer ([^\s]+)$/.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    const digest = createHash('sha256').update(token).digest('hex');
    const { data, error } = await this.supabase.getClient().rpc('verify_dash_rules_cron', { p_digest: digest });
    if (error) throw new ServiceUnavailableException('Validação do agendamento indisponível.');
    if (data !== true) throw new UnauthorizedException();
    return this.push.tick();
  }
}
