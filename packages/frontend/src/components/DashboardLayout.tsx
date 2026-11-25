import { ReactNode, Suspense, createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { readSidebarCollapsed } from '@/lib/sidebarState';
import { Outlet, useLocation } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { Sidebar } from '@/components/Sidebar';
import { BottomNav } from '@/components/BottomNav';
import { RouteFallback } from '@/components/RouteFallback';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { WelcomeTour } from '@/components/WelcomeTour';
import { cn } from '@/lib/utils';
import { preloadMainPages } from '@/lib/routes';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface DashboardLayoutProps {
  children: ReactNode;
  /** Ocupa a largura toda, sem o respiro lateral grande (o preview precisa de espaço). */
  wide?: boolean;
}

/** Presente quando a tela está dentro do AppShell: o layout já está montado. */
const ShellContext = createContext<{ setWide: (wide: boolean) => void } | null>(null);

let preloaded = false;

function Frame({ children, wide }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const { pathname } = useLocation();
  const desktop = useMediaQuery('(min-width: 1024px)');

  useEffect(() => {
    if (preloaded) return;
    preloaded = true;
    preloadMainPages();
  }, []);

  useEffect(() => setSidebarOpen(false), [pathname, desktop]);

  return (
    <div className="min-h-screen bg-background">
      {desktop && (
        <div className={cn('fixed inset-y-0 left-0 z-40 transition-all duration-300', sidebarCollapsed ? 'w-16' : 'w-64')}>
          <Sidebar onCollapsedChange={setSidebarCollapsed} />
        </div>
      )}

      <div className={cn('transition-all duration-300', sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64')}>
        <header className="app-header sticky top-0 z-30 flex items-center justify-center glass-header pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden">
          <Logo />
        </header>

        <main className={cn('pb-[calc(var(--app-bottom-nav-h)+1.5rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4', wide ? 'lg:px-6 lg:py-6' : 'lg:px-8 lg:pb-8 lg:pt-10')}>{children}</main>
      </div>

      {!desktop && (
        <Dialog.Root open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <BottomNav />
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:!animate-none lg:hidden" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-0 z-50 h-dvh w-full overflow-hidden bg-[hsl(var(--sidebar-background))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-300 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none lg:hidden"
            >
              <Dialog.Title className="sr-only">Menu de navegação</Dialog.Title>
              <Sidebar onClose={() => setSidebarOpen(false)} onNavClick={() => setSidebarOpen(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}

/**
 * Layout das telas logadas, montado uma vez: menu, barra inferior e cabeçalho
 * ficam na tela ao navegar e só o conteúdo troca, com um fade curto.
 */
export function AppShell() {
  const [wide, setWide] = useState(false);
  const { pathname } = useLocation();
  const shell = useMemo(() => ({ setWide }), []);
  return (
    <ShellContext.Provider value={shell}>
      <Frame wide={wide}>
        {/* Erro numa tela fica nela: o menu continua para ir a outra. */}
        <AppErrorBoundary inline resetKey={pathname}>
          <Suspense fallback={<RouteFallback />}>
            <div key={pathname} className="animate-page-in">
              <Outlet />
            </div>
          </Suspense>
        </AppErrorBoundary>
      </Frame>
      <WelcomeTour />
    </ShellContext.Provider>
  );
}

/**
 * Cada tela continua declarando o próprio layout. Dentro do AppShell só repassa
 * o conteúdo (e a largura); fora dele (testes) monta o layout completo.
 */
export function DashboardLayout({ children, wide }: DashboardLayoutProps) {
  const shell = useContext(ShellContext);
  useLayoutEffect(() => { shell?.setWide(!!wide); }, [shell, wide]);
  if (shell) return <>{children}</>;
  return <Frame wide={wide}>{children}</Frame>;
}
