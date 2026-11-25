/**
 * Imports das páginas, num lugar só: o App usa para o lazy de cada rota e o menu
 * usa para pré-carregar a tela antes do toque (hover, foco ou touchstart). Assim
 * o chunk já está no cache quando a navegação acontece.
 */
export const pageImports = {
  login: () => import('@/pages/Login'),
  forgotPassword: () => import('@/pages/ForgotPassword'),
  resetPassword: () => import('@/pages/ResetPassword'),
  preview: () => import('@/pages/Preview'),
  live: () => import('@/pages/Live'),
  campaigns: () => import('@/pages/Campaigns'),
  costs: () => import('@/pages/Costs'),
  result: () => import('@/pages/Result'),
  tests: () => import('@/pages/TestTracking'),
  hotjar: () => import('@/pages/Hotjar'),
  rules: () => import('@/pages/Rules'),
  sales: () => import('@/pages/Sales'),
  integrations: () => import('@/pages/Integrations'),
  settings: () => import('@/pages/Settings'),
  terms: () => import('@/pages/Terms'),
  docs: () => import('@/pages/Documentation'),
  privacy: () => import('@/pages/Privacy'),
  notFound: () => import('@/pages/NotFound'),
} as const;

export type PageName = keyof typeof pageImports;

/** Caminho do menu → página. Só as rotas que aparecem na navegação. */
const BY_PATH: Record<string, PageName> = {
  '/finance': 'result',
  '/campaigns/meta': 'campaigns',
  '/tests': 'tests',
  '/hotjar': 'hotjar',
  '/sales': 'sales',
  '/costs': 'costs',
  '/live': 'live',
  '/preview': 'preview',
  '/integrations': 'integrations',
  '/rules': 'rules',
  '/settings': 'settings',
};

/** Telas da barra inferior: os dados entram no cache logo depois do primeiro carregamento. */
export const MAIN_DATA_PATHS = ['/finance', '/campaigns/meta'];

const requested = new Set<PageName>();

export function pageForPath(path: string): PageName | null {
  return BY_PATH[path] ?? null;
}

// Busca de dados por tela: registrada por lib/pageQueries (evita puxar a API para cá).
let prefetchPageData: (path: string) => void = () => {};

export function registerDataPrefetch(fn: (path: string) => void) {
  prefetchPageData = fn;
}

function preloadChunk(path: string) {
  const page = pageForPath(path);
  if (!page || requested.has(page)) return;
  requested.add(page);
  pageImports[page]().catch(() => requested.delete(page));
}

/**
 * Intenção de abrir a tela (hover, foco ou toque no menu): baixa o chunk e busca
 * os dados no período padrão. O chunk é baixado uma vez; os dados, só se não
 * estiverem frescos no cache.
 */
export function preloadPath(path: string) {
  preloadChunk(path);
  prefetchPageData(path);
}

/** Com o navegador ocioso: o código de todas as telas do menu e os dados das da barra inferior. */
export function preloadMainPages() {
  const run = () => {
    Object.keys(BY_PATH).forEach(preloadChunk);
    MAIN_DATA_PATHS.forEach((path) => prefetchPageData(path));
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else window.setTimeout(run, 2000);
}
