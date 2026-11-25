import { SupabaseService } from '../../../shared/services/supabase.service';
import { UsersService } from '../users.service';

it('classifica pelo e-mail do Auth mesmo quando o e-mail no perfil é diferente', async () => {
  const profiles = [
    { user_id: '1', email: 'admin@example.test' },
    { user_id: '2', email: 'viewer@example.test' },
  ];
  const order = jest.fn().mockResolvedValue({ data: profiles, error: null });
  const listUsers = jest.fn().mockResolvedValue({
    data: { users: [
      { id: '1', email: 'other@example.test' },
      { id: '2', email: 'admin@example.test' },
    ] },
    error: null,
  });
  const supabase = {
    getClient: () => ({ from: () => ({ select: () => ({ order }) }), auth: { admin: { listUsers } } }),
    isAdminEmail: (email: string) => email === 'admin@example.test',
  } as unknown as SupabaseService;

  await expect(new UsersService(supabase).list()).resolves.toEqual([
    { ...profiles[0], role: 'user' },
    { ...profiles[1], role: 'admin' },
  ]);
});
