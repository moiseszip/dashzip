import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { SupabaseService } from '../../shared/services/supabase.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Diz se quem esta logado administra. A tela usa isso so para mostrar ou
   * esconder a aba — quem protege sao os guards abaixo, no servidor.
   */
  @Get('permissions')
  @UseGuards(AuthGuard)
  permissions(@CurrentUser() user: any): { is_admin: boolean } {
    // O AuthGuard já validou o token no Supabase (auth.getUser): o e-mail vem
    // dali, sem uma segunda ida ao Auth. As rotas de admin seguem no AdminGuard.
    return { is_admin: this.supabase.isAdminEmail(user?.email) };
  }

  @Get()
  @UseGuards(AuthGuard, AdminGuard)
  list() {
    return this.usersService.list();
  }

  @Post()
  @UseGuards(AuthGuard, AdminGuard)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
}
