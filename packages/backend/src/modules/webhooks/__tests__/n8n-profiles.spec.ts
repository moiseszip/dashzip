import { N8nProfilesProcessor } from '../processors/n8n-profiles.processor';

/** Supabase que falha o teste se alguém tentar escrever no perfil. */
function untouchableSupabase() {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      throw new Error(`não devia tocar em ${table}`);
    },
  };
  return { supabase: { getClient: () => client } as any, calls };
}

const config = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] }) as any;

describe('N8nProfilesProcessor — rota pública fechada', () => {
  it('sem N8N_PROFILES_TOKEN responde 404 e não toca no banco', async () => {
    const { supabase, calls } = untouchableSupabase();
    const processor = new N8nProfilesProcessor(supabase, config({}));
    const result = await processor.process({ email: 'alvo@example.com', name: 'x' }, null);
    expect(result.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('com a variável, recusa token ausente ou errado', async () => {
    const { supabase, calls } = untouchableSupabase();
    const processor = new N8nProfilesProcessor(supabase, config({ N8N_PROFILES_TOKEN: 'segredo-de-teste-longo' }));
    expect((await processor.process({ email: 'alvo@example.com', name: 'x' }, null)).status).toBe(401);
    expect((await processor.process({ email: 'alvo@example.com', name: 'x' }, 'outro')).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('com o token certo, atualiza e devolve só o id (sem CPF nem e-mail)', async () => {
    const row = { user_id: 'u1', email: 'alvo@example.com', name: 'Alvo', cpf: '00000000000' };
    const client = {
      from: () => {
        const b: any = { update: () => b, eq: () => b, select: async () => ({ data: [row], error: null }) };
        return b;
      },
    };
    const processor = new N8nProfilesProcessor({ getClient: () => client } as any, config({ N8N_PROFILES_TOKEN: 'segredo-de-teste-longo' }));
    const result = await processor.process({ user_id: 'u1', name: 'Novo' }, 'segredo-de-teste-longo');
    expect(result).toEqual({ status: 200, body: { success: true, user_id: 'u1' } });
  });
});
