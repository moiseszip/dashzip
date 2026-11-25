import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Hotjar from './Hotjar';
import { StreamingModeProvider } from '@/contexts/StreamingModeContext';
import { duration, type HotjarPageDetail, type HotjarPagesResponse, type PurchaseTiming, type TimingSummary } from '@/lib/hotjar';
import type { VslGroup } from '@/lib/vsl';

const fixtures = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  workspace: { id: 'fixture-workspace', name: 'Painel Exemplo' },
}));
vi.mock('@/lib/api', () => ({ api: { get: fixtures.get, post: fixtures.post } }));
vi.mock('@/components/DashboardLayout', () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspaceContext: () => ({ activeWorkspace: fixtures.workspace, activeWorkspaceId: fixtures.workspace.id }),
}));

const QUIZ_URL = 'https://arch.fixture.test/quiz';

const pagesResponse: HotjarPagesResponse = {
  pages: [
    { url: QUIZ_URL, views: 40, avgDepth: 62, reachedEnd: 10, clicks: 80, quiz: true, vsl: { market: 'br', version: 'quiz' } },
    { url: 'https://mapas.fixture.test/', views: 12, avgDepth: 40, reachedEnd: 2, clicks: 5, quiz: false, vsl: null },
  ],
  filters: { sources: [{ value: 'facebook', sessions: 30 }], campaigns: [{ value: 'cbo-arch|123', sessions: 20 }] },
};

const reach = Array.from({ length: 21 }, (_, i) => Math.max(0, 100 - i * 4));
const detail: HotjarPageDetail = {
  retention: {
    views: 40,
    reach,
    avgDepth: 62,
    reachedEnd: 25,
    fold: 20,
    dropoff: Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, share: i === 5 ? 40 : 6.7 })),
    biggestDrop: { from: 50, to: 60, share: 40 },
    screens: [{ screen: 1, at: 20, reach: 84 }, { screen: 2, at: 40, reach: 68 }],
    time: {
      measured: 30,
      median: 75,
      average: 90,
      buckets: [
        { label: 'até 10 s', min: 0, visits: 3, share: 10 },
        { label: '10–30 s', min: 10, visits: 6, share: 20 },
        { label: '30 s–1 min', min: 30, visits: 6, share: 20 },
        { label: '1–2 min', min: 60, visits: 9, share: 30 },
        { label: '2–5 min', min: 120, visits: 6, share: 20 },
        { label: '5 min ou mais', min: 300, visits: 0, share: 0 },
      ],
    },
  },
  clicks: { total: 80, topElements: [{ selector: '#comprar', label: 'Quero o Arch', clicks: 30, share: 37.5 }] },
  quiz: {
    started: 40,
    finished: 10,
    worstStep: 'tempo',
    steps: [
      { step: 'capa', index: 0, sessions: 40, ofStart: 100, fromPrevious: null, advanced: 75 },
      { step: 'momento', index: 1, sessions: 30, ofStart: 75, fromPrevious: 75, advanced: 66.7 },
      { step: 'tempo', index: 2, sessions: 20, ofStart: 50, fromPrevious: 66.7, advanced: 50 },
      { step: 'oferta', index: 3, sessions: 10, ofStart: 25, fromPrevious: 50, advanced: null },
    ],
  },
  vsl: { market: 'br', version: 'quiz' },
};

const vslGroup: VslGroup = {
  duration: 4,
  visits: 10,
  plays: 4,
  averageRetention: 0.75,
  finish: 0.5,
  checkout: { all: 0.3, played: 0.5, muted: 1 / 6, half: 0.5 },
  curve: [1, 0.75, 0.5, 0.25],
  milestones: [{ label: '50%', second: 2, retention: 0.5 }],
  creatives: [],
};

const LABELS = ['0–10 s', '10–30 s', '30–60 s', '1–2 min', '2–5 min', '5–10 min', '10–30 min', '30 min–2 h', 'mais de 2 h'];
const MINS = [0, 10, 30, 60, 120, 300, 600, 1800, 7200];
function summary(counts: number[], extra: Partial<TimingSummary>): TimingSummary {
  const total = counts.reduce((a, b) => a + b, 0);
  let run = 0;
  return {
    measured: total,
    discarded: 0,
    missing: 0,
    median: null,
    average: null,
    p75: null,
    p90: null,
    ...extra,
    buckets: counts.map((n, i) => {
      run += n;
      return { label: LABELS[i], min: MINS[i], max: MINS[i + 1] ?? null, purchases: n, share: (n / total) * 100, cumulative: (run / total) * 100 };
    }),
  };
}
const timing: PurchaseTiming = {
  purchases: 11,
  otherPages: 4,
  noSession: 3,
  checkout: summary([7, 1, 1, 0, 1, 0, 0, 0, 0], { median: 8, average: 25, p75: 15, p90: 80, discarded: 1 }),
  purchase: summary([0, 0, 0, 0, 6, 2, 1, 1, 0], { median: 160, average: 600, p75: 420, p90: 4500 }),
};

function route(overrides: { vsl?: () => Promise<unknown>; pages?: () => Promise<unknown>; timing?: () => Promise<unknown> } = {}) {
  fixtures.post.mockResolvedValue({ token: 'a'.repeat(48), until: '2026-11-24T00:00:00Z' });
  fixtures.get.mockImplementation((path: string) => {
    if (path.startsWith('/hotjar/pages')) return overrides.pages?.() ?? Promise.resolve(pagesResponse);
    if (path.startsWith('/hotjar/purchase-timing')) return overrides.timing?.() ?? Promise.resolve(timing);
    if (path.startsWith('/hotjar/page')) return Promise.resolve(detail);
    if (path.startsWith('/vsl/')) {
      return overrides.vsl?.() ?? Promise.resolve({ since: '2026-11-17', until: '2026-11-23', market: 'br', selected: ['quiz'], versions: { a: vslGroup, quiz: vslGroup }, total: null });
    }
    return Promise.reject(new Error(`rota inesperada ${path}`));
  });
}

function view(streaming = false) {
  localStorage.clear();
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StreamingModeProvider initialEnabled={streaming}>
        <MemoryRouter>
          <Hotjar />
        </MemoryRouter>
      </StreamingModeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  fixtures.get.mockReset();
  fixtures.post.mockReset();
});

describe('Hotjar', () => {
  it('mostra mapa de calor, retenção, quiz e VSL da página mais visitada', async () => {
    route();
    view();
    expect(await screen.findByRole('region', { name: 'Retenção da página' })).toBeInTheDocument();

    const [pagesCall] = fixtures.get.mock.calls.map(([p]) => p as string).filter((p) => p.startsWith('/hotjar/pages'));
    expect(pagesCall).toMatch(/workspace_id=fixture-workspace&since=\d{4}-\d{2}-\d{2}&until=\d{4}-\d{2}-\d{2}&device=mobile$/);
    const pageCall = fixtures.get.mock.calls.map(([p]) => p as string).find((p) => p.startsWith('/hotjar/page?'));
    expect(pageCall).toContain(`url=${encodeURIComponent(QUIZ_URL)}`);

    const retention = screen.getByRole('region', { name: 'Retenção da página' });
    expect(within(retention).getByText('1 min 15 s')).toBeInTheDocument();
    expect(within(retention).getByText(/entre/)).toHaveTextContent('entre 50% e 60% da página: 40% das visitas param ali');
    expect(within(retention).getByText('2ª tela')).toBeInTheDocument();

    const quiz = await screen.findByRole('region', { name: 'Quiz' });
    expect(within(quiz).getByText('Momento')).toBeInTheDocument();
    expect(within(quiz).getByText(/etapa que mais perde gente/)).toHaveTextContent('50% avançaram');

    const heatmap = screen.getByRole('region', { name: 'Mapa de calor' });
    const frame = await within(heatmap).findByTitle('Página com o mapa de calor');
    const src = new URL(frame.getAttribute('src')!);
    expect(src.origin + src.pathname).toBe(QUIZ_URL);
    expect(src.searchParams.get('stl_heatmap')).toBe('a'.repeat(48));
    expect(src.searchParams.get('stl_hm_embed')).toBe('1');
    expect(src.searchParams.get('stl_hm_dev')).toBe('mobile');
    expect(src.searchParams.get('stl_hm_since')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(within(heatmap).getByText('Quero o Arch')).toBeInTheDocument();

    expect(await screen.findByRole('slider', { name: 'Curva de retenção por segundo' })).toBeInTheDocument();
    const vslCall = fixtures.get.mock.calls.map(([p]) => p as string).find((p) => p.startsWith('/vsl/'));
    expect(vslCall).toMatch(/^\/vsl\/fixture-workspace\?since=\d{4}-\d{2}-\d{2}&until=\d{4}-\d{2}-\d{2}&market=br&versions=quiz$/);
  });

  it('trocar o aparelho refaz a leitura com device=desktop', async () => {
    route();
    view();
    await screen.findByRole('region', { name: 'Retenção da página' });
    fireEvent.click(screen.getByRole('radio', { name: 'Computador' }));
    await waitFor(() =>
      expect(fixtures.get.mock.calls.some(([p]) => (p as string).startsWith('/hotjar/pages') && (p as string).includes('device=desktop'))).toBe(true),
    );
  });

  it('modo streaming: página vira apelido, sem domínio no DOM, e o iframe só aparece se pedir', async () => {
    route();
    const { container } = view(true);
    const heatmap = await screen.findByRole('region', { name: 'Mapa de calor' });
    await screen.findByRole('region', { name: 'Retenção da página' });
    expect(container.innerHTML).not.toContain('fixture.test');
    expect(screen.getByRole('combobox', { name: 'Página' })).toHaveTextContent('Página 1');
    expect(within(heatmap).queryByTitle('Página com o mapa de calor')).not.toBeInTheDocument();
    fireEvent.click(within(heatmap).getByRole('button', { name: /Mostrar a página/ }));
    expect(within(heatmap).getByTitle('Página com o mapa de calor')).toBeInTheDocument();
  });

  it('sem visitas no filtro mostra o aviso', async () => {
    route({ pages: () => Promise.resolve({ pages: [], filters: { sources: [], campaigns: [] } }) });
    view();
    expect(await screen.findByText(/Nenhuma visita medida no celular/)).toBeInTheDocument();
  });

  it('VSL sem acesso mostra o erro sem botão de tentar de novo', async () => {
    route({ vsl: () => Promise.reject(Object.assign(new Error('Workspace desabilitado.'), { status: 403 })) });
    view();
    expect(await screen.findByText('Workspace desabilitado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });

  it('tempo até a compra: destaques, faixas com acumulado e alternador', async () => {
    route();
    view();
    const section = await screen.findByRole('region', { name: 'Tempo até a compra' });
    await within(section).findByText('Mediana');
    const call = fixtures.get.mock.calls.map(([p]) => p as string).find((p) => p.startsWith('/hotjar/purchase-timing?'));
    expect(call).toContain(`url=${encodeURIComponent(QUIZ_URL)}`);
    expect(call).toContain('device=mobile');

    expect(within(section).getAllByText('8 s').length).toBeGreaterThan(0);
    expect(within(section).getAllByText('1 min 20 s').length).toBeGreaterThan(0);
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(9);
    expect(rows[0]).toHaveTextContent('0–10 s');
    expect(rows[0]).toHaveTextContent('70% (7)');
    expect(rows[2]).toHaveTextContent('90%');
    expect(within(section).getByText(/compras entraram/)).toHaveTextContent(
      '10 compras entraram no gráfico. Ficaram de fora: 3 vendas aprovadas sem sessão do rastreio',
    );
    expect(within(section).getByText(/compras entraram/)).toHaveTextContent('1 descartada por tempo negativo ou acima de 24 h');

    fireEvent.click(within(section).getByRole('radio', { name: 'Até a compra' }));
    expect(within(section).getAllByText('2 min 40 s').length).toBeGreaterThan(0);
    expect(within(section).getAllByText('1 h 15 min').length).toBeGreaterThan(0);
    expect(within(section).getAllByRole('listitem')[4]).toHaveTextContent('60% (6)');
  });

  it('tempo até a compra sem vendas com sessão mostra o estado vazio', async () => {
    const empty = summary([0, 0, 0, 0, 0, 0, 0, 0, 0], {});
    empty.buckets.forEach((b) => Object.assign(b, { share: 0, cumulative: 0 }));
    route({ timing: () => Promise.resolve({ purchases: 0, otherPages: 0, noSession: 2, checkout: empty, purchase: empty }) });
    view(true);
    const section = await screen.findByRole('region', { name: 'Tempo até a compra' });
    expect(await within(section).findByText(/Nenhuma venda aprovada com sessão/)).toBeInTheDocument();
    expect(within(section).getByText(/0 compras entraram/)).toHaveTextContent('2 vendas aprovadas sem sessão do rastreio');
  });

  it('duração legível com horas', () => {
    expect(duration(80)).toBe('1 min 20 s');
    expect(duration(3600)).toBe('1 h');
    expect(duration(4500)).toBe('1 h 15 min');
  });
});
