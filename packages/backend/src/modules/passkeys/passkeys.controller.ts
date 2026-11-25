import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard, SessionGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PasskeysService } from './passkeys.service';
import { AuthenticationVerifyDto, RegistrationVerifyDto, RemovePasskeyDto } from './passkeys.dto';

/** Até 10 cerimônias por minuto por IP, além do limite por conta no banco. */
const CEREMONY_LIMIT = { default: { limit: 10, ttl: 60_000 } };

function originOf(req: any): string | undefined {
  const origin = req.headers?.origin;
  return typeof origin === 'string' ? origin : undefined;
}

/**
 * Passkeys como segundo fator. As rotas do login (status e autenticação)
 * aceitam sessão só com a senha; cadastrar, listar e remover exigem o
 * segundo fator, se a conta já tiver um.
 */
@Controller('passkeys')
export class PasskeysController {
  constructor(private readonly passkeys: PasskeysService) {}

  @Get('status')
  @UseGuards(SessionGuard)
  status(@CurrentUser() user: any, @Req() req: any) {
    return this.passkeys.status(user.id, req.sessionId);
  }

  @Post('authentication/options')
  @HttpCode(200)
  @Throttle(CEREMONY_LIMIT)
  @UseGuards(SessionGuard)
  authenticationOptions(@CurrentUser() user: any, @Req() req: any) {
    return this.passkeys.authenticationOptions(user, req.sessionId, originOf(req));
  }

  @Post('authentication/verify')
  @HttpCode(200)
  @Throttle(CEREMONY_LIMIT)
  @UseGuards(SessionGuard)
  authenticationVerify(@CurrentUser() user: any, @Req() req: any, @Body() dto: AuthenticationVerifyDto) {
    return this.passkeys.authenticationVerify(user, req.sessionId, dto as any);
  }

  @Get()
  @UseGuards(AuthGuard)
  list(@CurrentUser() user: any) {
    return this.passkeys.list(user.id);
  }

  @Post('registration/options')
  @HttpCode(200)
  @Throttle(CEREMONY_LIMIT)
  @UseGuards(AuthGuard)
  registrationOptions(@CurrentUser() user: any, @Req() req: any) {
    return this.passkeys.registrationOptions(user, req.sessionId, originOf(req));
  }

  @Post('registration/verify')
  @HttpCode(200)
  @Throttle(CEREMONY_LIMIT)
  @UseGuards(AuthGuard)
  registrationVerify(@CurrentUser() user: any, @Req() req: any, @Body() dto: RegistrationVerifyDto) {
    return this.passkeys.registrationVerify(user, req.sessionId, dto as any);
  }

  @Post(':id/remove')
  @HttpCode(200)
  @Throttle(CEREMONY_LIMIT)
  @UseGuards(AuthGuard)
  remove(
    @CurrentUser() user: any, @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RemovePasskeyDto,
  ) {
    return this.passkeys.remove(user, req.sessionId, id, dto as any);
  }
}
