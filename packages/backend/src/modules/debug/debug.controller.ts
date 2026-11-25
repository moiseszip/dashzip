import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DebugService } from './debug.service';

class WorkspaceDto {
  @IsUUID()
  workspace_id!: string;
}

class TracesQueryDto extends WorkspaceDto {
  /** created_at da última mensagem já recebida: o painel só busca as novas. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/)
  after?: string;
}

/**
 * O modo preview do painel. Fora do throttle global: o painel consulta a
 * cada 2 segundos enquanto o preview está aberto.
 */
@SkipThrottle()
@Controller('debug')
@UseGuards(AuthGuard)
export class DebugController {
  constructor(private readonly debug: DebugService) {}

  @Get('status')
  status(@CurrentUser('id') userId: string, @Query() query: WorkspaceDto) {
    return this.debug.getStatus(userId, query.workspace_id);
  }

  @Post('start')
  start(@CurrentUser('id') userId: string, @Body() body: WorkspaceDto) {
    return this.debug.start(userId, body.workspace_id);
  }

  @Post('stop')
  stop(@CurrentUser('id') userId: string, @Body() body: WorkspaceDto) {
    return this.debug.stop(userId, body.workspace_id);
  }

  @Get('traces')
  traces(@CurrentUser('id') userId: string, @Query() query: TracesQueryDto) {
    return this.debug.list(userId, query.workspace_id, query.after ?? null);
  }

  @Delete('traces')
  clear(@CurrentUser('id') userId: string, @Query() query: WorkspaceDto) {
    return this.debug.clear(userId, query.workspace_id);
  }
}
