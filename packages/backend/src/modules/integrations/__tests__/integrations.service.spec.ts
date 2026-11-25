import { ForbiddenException } from '@nestjs/common';
import { IntegrationsService } from '../integrations.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MY_WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THEIR_WS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Supabase falso: workspaces responde pelo dono; checkout_integrations registra a escrita. */
function fakeSupabase() {
  const writes: { op: string; row: any }[] = [];
  const workspaces = [{ id: MY_WS, user_id: OWNER }, { id: THEIR_WS, user_id: OTHER }];
  const client = {
    from(table: string) {
      const filters: Record<string, string> = {};
      let op = 'select';
      let row: any = null;
      const builder: any = {
        select: () => builder,
        eq: (col: string, value: string) => { filters[col] = value; return builder; },
        insert: (r: any) => { op = 'insert'; row = r; return builder; },
        update: (r: any) => { op = 'update'; row = r; return builder; },
        maybeSingle: async () => {
          const hit = workspaces.find((w) => w.id === filters.id && w.user_id === filters.user_id);
          return { data: hit ? { id: hit.id } : null, error: null };
        },
        single: async () => {
          writes.push({ op, row });
          return { data: { id: 'new', ...row }, error: null };
        },
      };
      if (table !== 'workspaces' && table !== 'checkout_integrations') throw new Error(table);
      return builder;
    },
  };
  return { supabase: { getClient: () => client } as any, writes };
}

describe('IntegrationsService.saveCheckoutIntegration — dono do painel', () => {
  it('cria a integração no painel do próprio usuário', async () => {
    const { supabase, writes } = fakeSupabase();
    const service = new IntegrationsService(supabase);
    await service.saveCheckoutIntegration(OWNER, { platform: 'hotmart', workspace_id: MY_WS });
    expect(writes).toEqual([{ op: 'insert', row: { platform: 'hotmart', workspace_id: MY_WS, user_id: OWNER } }]);
  });

  it('recusa criar a integração no painel de outra conta', async () => {
    const { supabase, writes } = fakeSupabase();
    const service = new IntegrationsService(supabase);
    await expect(
      service.saveCheckoutIntegration(OWNER, { platform: 'hotmart', workspace_id: THEIR_WS }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toHaveLength(0);
  });

  it('recusa mover uma integração existente para o painel de outra conta', async () => {
    const { supabase, writes } = fakeSupabase();
    const service = new IntegrationsService(supabase);
    await expect(
      service.saveCheckoutIntegration(OWNER, { id: 'x', platform: 'hotmart', workspace_id: THEIR_WS }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toHaveLength(0);
  });
});
