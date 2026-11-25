import { SupabaseService } from '../../../shared/services/supabase.service';
import { WorkspaceTimezoneService } from '../../../shared/services/workspace-timezone.service';
import { isEmoji, WorkspacesService } from '../workspaces.service';

describe('isEmoji (emoji do painel)', () => {
  it('aceita um emoji, inclusive com ZWJ, tom de pele e bandeira', () => {
    for (const value of ['🏛️', '📐', '👩‍💻', '👍🏽', '🇧🇷', '❤️', '1️⃣', '#️⃣', '🫠', '🏳️‍🌈']) expect(isEmoji(value)).toBe(true);
  });
  it('recusa texto, números, vários emojis e vazio', () => {
    for (const value of ['A', 'ab', '1', '🏛️📐', 'Abc', '', '#']) expect(isEmoji(value)).toBe(false);
  });
});

describe('Emoji ao criar painel', () => {
  const insert = jest.fn();
  const single = jest.fn();
  const supabase = {
    getClient: () => ({ from: () => ({ insert }) }),
  } as unknown as SupabaseService;
  const service = new WorkspacesService(supabase, {} as WorkspaceTimezoneService);

  beforeEach(() => {
    jest.clearAllMocks();
    insert.mockReturnValue({ select: () => ({ single }) });
    single.mockResolvedValue({ data: { id: 'novo-painel', emoji: '😀' }, error: null });
  });

  it('grava nome e emoji na mesma inserção', async () => {
    await expect(service.create('u1', 'Painel', '😀')).resolves.toMatchObject({ emoji: '😀' });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({ user_id: 'u1', name: 'Painel', emoji: '😀' });
  });

  it('recusa emoji inválido antes de gravar e aceita criação sem emoji', async () => {
    await expect(service.create('u1', 'Painel', '😀😀')).rejects.toThrow('Use um emoji só.');
    expect(insert).not.toHaveBeenCalled();
    await service.create('u1', 'Painel');
    expect(insert).toHaveBeenCalledWith({ user_id: 'u1', name: 'Painel', emoji: null });
  });
});
