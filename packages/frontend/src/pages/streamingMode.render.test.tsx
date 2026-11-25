import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingModeProvider } from '@/contexts/StreamingModeContext';
import type { ObjectRow, ObjectsResponse } from '@/lib/campaigns';
import type { SaleOrder } from '@/hooks/useSales';

/** Nomes "reais" de teste: nenhum pode aparecer no DOM nem em atributos com o modo ligado. */
const SECRETS = [
  'Painel Secreto Arch',
  'Kit Arch Frio',
  'CA Loja Exemplo 03',
  '1234567890',
  'Maria da Silva',
  'maria@cliente.com',
  '11999990000',
  'Método Arch Premium',
  'cbo-kit-arch',
  'ad07-depoimento',
  'PED-998877',
];

vi.mock('@/contexts/WorkspaceContext', () => {
  const ws = { id: 'w1', name: 'Painel Secreto Arch' };
  return {
    useWorkspaceContext: () => ({ activeWorkspaceId: ws.id, activeWorkspace: ws, workspaces: [ws], setActiveWorkspace: () => {} }),
  };
});
vi.mock('@/lib/api', () => ({ api: { get: async () => ({}), post: async () => ({}), put: async () => ({}) } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useWorkspaces', () => ({ useWorkspaces: () => ({ isLoading: false }) }));

const order: SaleOrder = {
  id: '1', orderId: 'PED-998877', lineIds: ['l1'], soldAt: '2026-11-21T15:00:00Z', status: 'approved', amount: 97,
  currency: 'BRL', paymentMethod: 'pix', platform: 'hotmart',
  products: [{ name: 'Método Arch Premium', amount: 97, isOrderBump: false }],
  customer: { name: 'Maria da Silva', email: 'maria@cliente.com', phone: '11999990000' },
  utm: { source: 'FB', medium: 'aberto|111', campaign: 'cbo-kit-arch|1202568', content: 'ad07-depoimento|333', term: 'Instagram_Feed' },
  adId: '333', matched: true, matchMethod: 'indexador', purchase: 'sent', purchaseError: null,
};
vi.mock('@/hooks/useSales', () => ({
  useSales: () => ({
    data: { summary: { orders: 1, revenue: 97, refunded: 0, pending: 0, matched: 1, purchaseSent: 1, currency: 'BRL' }, orders: [order], truncated: false },
    loading: false, fetching: false, error: null,
  }),
  usePurchaseEvents: () => ({ events: [], loading: false, error: null }),
}));

const campaignRow = {
  id: '1234567890', name: 'Kit Arch Frio', level: 'campaign', accountId: 'act_555', campaignId: '1234567890', adsetId: null,
  parentId: 'act_555', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudget: 100, lifetimeBudget: null, budgetLevel: 'campaign',
  accountCurrency: 'BRL', spend: 50, grossRevenue: 200, sales: 2,
} as unknown as ObjectRow;
vi.mock('@/lib/campaigns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/campaigns')>();
  const response: ObjectsResponse = {
    level: 'campaign', since: '2026-11-22', until: '2026-11-22', currency: 'BRL', rows: [campaignRow], totals: {},
    untrackedSales: { count: 0, grossRevenue: null },
    accounts: [{ id: 'act_555', connectionId: 'c', name: 'CA Loja Exemplo 03', currency: 'BRL', accountStatus: '1', cycleSpend: 0, totalSpend: 0, spendCap: null }],
    warnings: [],
  };
  return {
    ...actual,
    campaignsApi: { ...actual.campaignsApi, objects: async () => response, columns: async () => ({ columns: {} }) },
  };
});

vi.mock('@/lib/testTracking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/testTracking')>();
  const cell = { spend: 50, mediaTax: 0, grossRevenue: 150, netRevenue: 140, salesTax: 0, profit: 90, sales: 2, impressions: 4000, clicks: 90, initiateCheckouts: 10 };
  const matrix = {
    since: '2026-11-21', until: '2026-11-22', days: ['2026-11-21', '2026-11-22'],
    rows: [{
      id: '1234567890', name: 'Kit Arch Frio', accountId: 'act_555', accountCurrency: 'BRL', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
      dailyBudget: 100, lifetimeBudget: null, budgetLevel: 'campaign', accountName: 'CA Loja Exemplo 03', offerId: 'o1',
      byDay: { '2026-11-21': cell, '2026-11-22': cell },
    }],
    accounts: [{ id: 'act_555', connectionId: 'c', name: 'CA Loja Exemplo 03', currency: 'BRL', accountStatus: '1', cycleSpend: 0, totalSpend: 0, spendCap: null }],
    offers: [{ id: 'o1', name: 'Método Arch Premium', codes: ['ARCH'], accountIds: [], products: [] }],
    untrackedSales: { count: 0 }, warnings: [],
  };
  return {
    ...actual,
    testsApi: {
      ...actual.testsApi,
      matrix: async () => matrix,
      changes: async () => ({ changes: { '1234567890': [{ kind: 'paused', objectName: 'cbo-kit-arch', at: '2026-11-21T12:00:00Z', actor: 'Maria da Silva' }] }, warnings: [] }),
    },
  };
});

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StreamingModeProvider initialEnabled>{children}</StreamingModeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function expectNoSecrets() {
  const html = document.documentElement.outerHTML;
  for (const secret of SECRETS) expect(html, secret).not.toContain(secret);
  for (const el of document.querySelectorAll('[title],[aria-label]')) {
    for (const attr of ['title', 'aria-label']) {
      const value = el.getAttribute(attr) ?? '';
      for (const secret of SECRETS) expect(value, `${attr}: ${secret}`).not.toContain(secret);
    }
  }
}

describe('modo streaming nas telas', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('Vendas: cliente, produto, UTMs e pedido mascarados, números visíveis', async () => {
    const { default: Sales } = await import('./Sales');
    render(wrap(<Sales />));
    expect(screen.getByText('Cliente 1')).toBeInTheDocument();
    expect(screen.getByText('Campanha 1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cliente 1'));
    expect(screen.getAllByText('Produto 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R$ 97,00').length).toBeGreaterThan(0);
    expectNoSecrets();
  });

  it('Campanhas: nome da campanha e do painel viram apelido', async () => {
    const { default: Campaigns } = await import('./Campaigns');
    render(wrap(<Campaigns />));
    await waitFor(() => expect(screen.getByText('Campanha 1')).toBeInTheDocument());
    expect(screen.getAllByText('Painel 1').length).toBeGreaterThan(0);
    expectNoSecrets();
  });

  it('Acompanhamento de testes: campanha, conta e oferta viram apelido', async () => {
    const { default: TestTracking } = await import('./TestTracking');
    render(wrap(<TestTracking />));
    await waitFor(() => expect(screen.getByText('Campanha 1')).toBeInTheDocument());
    expect(screen.getByText(/Conta 1/)).toBeInTheDocument();
    expectNoSecrets();
  });
});
