import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CreateUserDto } from './dto/create-user.dto';

interface UserProfile {
  user_id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  active: boolean | null;
}

type UserRole = 'admin' | 'user';

export interface UserRow extends UserProfile {
  role: UserRole;
}

/**
 * Criacao de usuarios pelo admin.
 *
 * O cadastro publico saiu do produto: nao ha mais tela de "criar conta" nem
 * rota aberta que crie usuario. Quem entra no painel foi criado aqui, por
 * alguem cujo e-mail esta em ADMIN_EMAILS.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(): Promise<UserRow[]> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('profiles')
      .select('user_id, name, email, created_at, active')
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    const profiles = (data ?? []) as UserProfile[];
    const remaining = new Set(profiles.map(({ user_id }) => user_id));
    const admins = new Set<string>();
    const pageSize = 100;

    // O perfil é editável. O papel segue o e-mail da conta no Auth.
    for (let page = 1; remaining.size > 0; page++) {
      const auth = await client.auth.admin.listUsers({ page, perPage: pageSize });
      if (auth.error) throw new BadRequestException('Não foi possível consultar os papéis dos usuários.');

      for (const user of auth.data.users) {
        if (remaining.delete(user.id) && this.supabase.isAdminEmail(user.email)) {
          admins.add(user.id);
        }
      }
      if (auth.data.users.length < pageSize) break;
    }

    return profiles.map((profile) => ({
      ...profile,
      role: admins.has(profile.user_id) ? 'admin' : 'user',
    }));
  }

  async create(dto: CreateUserDto): Promise<UserRow> {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();

    const { data, error } = await this.supabase.getClient().auth.admin.createUser({
      email,
      password: dto.password,
      // Sem envio de e-mail de confirmacao: o admin entrega a senha em maos.
      email_confirm: true,
      user_metadata: { name },
    });

    if (error) {
      if (
        (error as { code?: string }).code === 'email_exists' ||
        /already (been )?registered|already exists/i.test(error.message)
      ) {
        throw new ConflictException('Ja existe um usuario com este e-mail');
      }
      // A senha nunca entra no log — so o motivo da recusa.
      this.logger.error(`falha ao criar usuario: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    if (!data?.user) {
      throw new BadRequestException('Nao foi possivel criar o usuario');
    }

    // O gatilho handle_new_user cria o perfil e a area. Ele roda dentro do
    // INSERT em auth.users, entao a linha ja existe quando chegamos aqui.
    return {
      user_id: data.user.id,
      name,
      email,
      created_at: data.user.created_at,
      active: true,
      role: this.supabase.isAdminEmail(data.user.email) ? 'admin' : 'user',
    };
  }
}
