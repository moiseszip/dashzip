import { HotjarService } from '../hotjar.service';

function service(result: { data: unknown; error: { message: string } | null }) {
  const rpc = jest.fn().mockResolvedValue(result);
  const supabase = { getClient: () => ({ rpc }) } as any;
  return { rpc, hotjar: new HotjarService(supabase, {} as any, {} as any, {} as any) };
}

const range = { from: '2026-11-17T03:00:00.000Z', to: '2026-11-24T03:00:00.000Z' };

describe('HotjarService.purchaseTiming', () => {
  it('manda página, período, aparelho, origem e campanha para hotjar_purchase_timing', async () => {
    const { rpc, hotjar } = service({
      data: [
        { kind: 'page', to_checkout: 14, to_purchase: '135', n: '1' },
        { kind: 'page', to_checkout: null, to_purchase: null, n: 1 },
        { kind: 'other', to_checkout: null, to_purchase: null, n: '4' },
        { kind: 'no_session', to_checkout: null, to_purchase: null, n: '2' },
      ],
      error: null,
    });
    const r = await hotjar.purchaseTiming('ws', 'https://lp.test/', range, { device: 'desktop', source: 'FB', campaign: 'cbo|1' });
    expect(rpc).toHaveBeenCalledWith('hotjar_purchase_timing', {
      p_workspace_id: 'ws',
      p_url: 'https://lp.test/',
      p_from: range.from,
      p_to: range.to,
      p_device: 'desktop',
      p_source: 'FB',
      p_campaign: 'cbo|1',
    });
    expect(r).toMatchObject({ purchases: 2, otherPages: 4, noSession: 2 });
    expect(r.checkout).toMatchObject({ measured: 1, missing: 1, median: 14 });
    expect(r.purchase.median).toBe(135);
  });

  it('sem a migration, o erro diz qual aplicar', async () => {
    const { hotjar } = service({ data: null, error: { message: 'Could not find the function public.hotjar_purchase_timing in the schema cache' } });
    await expect(hotjar.purchaseTiming('ws', 'https://lp.test/', range, { device: 'mobile', source: null, campaign: null })).rejects.toThrow(
      /20261123220000_hotjar_purchase_timing\.sql/,
    );
  });
});
