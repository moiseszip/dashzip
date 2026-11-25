import { BadRequestException, Body, Controller, Delete, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WiapyConnectionService } from './wiapy-connection.service';
import { appOrigin, parsePastedCallback, WiapyOAuthError } from './wiapy-oauth';

class WorkspaceQueryDto {
  @IsUUID() workspace_id!: string;
}

class CompleteDto {
  @IsUUID() workspace_id!: string;
  @IsString() @MaxLength(4096) url!: string;
}

const headerOf = (req: { headers: Record<string, string | string[] | undefined> }, name: string) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Card "Wiapy" de Integrações: status, conectar e desconectar. Nunca devolve token. */
@Controller('integrations/wiapy')
export class WiapyController {
  constructor(private readonly wiapy: WiapyConnectionService) {}

  @Get()
  @UseGuards(AuthGuard)
  async status(@CurrentUser('id') userId: string, @Query() q: WorkspaceQueryDto) {
    await this.wiapy.assertOwner(userId, q.workspace_id);
    return this.wiapy.status(q.workspace_id);
  }

  /** Devolve o endereço do consentimento na Wiapy; o front navega até ele. */
  @Post('connect')
  @UseGuards(AuthGuard)
  async connect(@CurrentUser('id') userId: string, @Body() body: WorkspaceQueryDto) {
    await this.wiapy.assertOwner(userId, body.workspace_id);
    return this.wiapy.start(userId, body.workspace_id);
  }

  /**
   * Segundo passo: o consentimento volta para http://localhost/dashzip-wiapy
   * (a Wiapy recusa o domínio do Dash.zip) e o operador cola esse endereço aqui.
   */
  @Post('complete')
  @UseGuards(AuthGuard)
  async complete(@CurrentUser('id') userId: string, @Body() body: CompleteDto) {
    await this.wiapy.assertOwner(userId, body.workspace_id);
    try {
      await this.wiapy.complete(parsePastedCallback(body.url), { userId, workspaceId: body.workspace_id });
    } catch (error) {
      throw new BadRequestException(error instanceof WiapyOAuthError ? error.message : 'Não foi possível concluir a conexão com a Wiapy.');
    }
    return { connected: true };
  }

  @Delete()
  @UseGuards(AuthGuard)
  async disconnect(@CurrentUser('id') userId: string, @Query() q: WorkspaceQueryDto) {
    await this.wiapy.assertOwner(userId, q.workspace_id);
    return this.wiapy.disconnect(q.workspace_id);
  }

  /**
   * Volta do consentimento (redirect do navegador, sem o token do dash.zip):
   * quem prova a origem é o state de uso único. Termina em Integrações.
   */
  @Get('callback')
  async callback(@Req() req: any, @Res() reply: any) {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const read = (key: string) => (typeof query[key] === 'string' ? (query[key] as string).slice(0, 2048) : undefined);
    const origin = appOrigin(headerOf(req, 'x-forwarded-host') ?? headerOf(req, 'host'));
    let target = `${origin}/integrations?wiapy=connected`;
    try {
      await this.wiapy.complete({ state: read('state'), code: read('code'), iss: read('iss'), error: read('error') });
    } catch (error) {
      const message = error instanceof WiapyOAuthError ? error.message : 'Não foi possível concluir a conexão com a Wiapy.';
      target = `${origin}/integrations?wiapy=error&message=${encodeURIComponent(message)}`;
    }
    reply.code(302).header('Location', target).header('Cache-Control', 'no-store').send();
  }
}
