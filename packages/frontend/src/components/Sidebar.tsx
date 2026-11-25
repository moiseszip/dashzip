import { useEffect, useId, useState } from 'react';
import { readSidebarCollapsed, writeSidebarCollapsed } from '@/lib/sidebarState';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeftOpen, ArrowUpRight, BarChart3, BookOpen, Bug, ChevronDown, DollarSign, Flame, FlaskConical, Link2, Megaphone, Radar, Radio, Receipt, Settings, X } from 'lucide-react';
import { preloadPath } from '@/lib/routes';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Logo } from '@/components/Logo';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { StreamingModeButton } from '@/components/StreamingModeButton';

type NavGroupItem = { to?: string; icon?: typeof BarChart3; label: string };
type NavItem = { icon: typeof BarChart3; label: string } & ({ to: string } | { items: NavGroupItem[] });

const navItems: NavItem[] = [
  { to: '/finance', icon: BarChart3, label: 'Resultado' },
  {
    icon: Megaphone,
    label: 'Campanhas',
    items: [
      { to: '/campaigns/meta', label: 'Meta Ads' },
      { label: 'Google Ads' },
      { label: 'TikTok Ads' },
      { label: 'Pinterest Ads' },
    ],
  },
  { to: '/tests', icon: FlaskConical, label: 'Acompanhamento de testes' },
  { to: '/hotjar', icon: Flame, label: 'Hotjar' },
  { to: '/sales', icon: DollarSign, label: 'Vendas' },
  { to: '/costs', icon: Receipt, label: 'Custos' },
  {
    icon: Radar,
    label: 'Tracking',
    items: [
      { to: '/live', icon: Radio, label: 'Ao vivo' },
      { to: '/preview', icon: Bug, label: 'Preview e debug' },
      { to: '/integrations', icon: Link2, label: 'Integrações' },
    ],
  },
];

const navLinkClass = (isActive: boolean) =>
  cn(
    // py-3 no celular (alvo de 44px), py-2.5 no desktop.
    'flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-all duration-200 lg:py-2.5',
    isActive
      ? 'bg-foreground/8 text-foreground font-medium'
      : 'text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5'
  );

/** Baixa o chunk da tela ao passar o mouse, focar ou tocar no link. */
const preloadProps = (to: string) => ({
  onPointerEnter: () => preloadPath(to),
  onPointerDown: () => preloadPath(to),
  onFocus: () => preloadPath(to),
});

function NavGroup({ label, icon: Icon, items, collapsed, onNavClick }: {
  label: string;
  icon: typeof BarChart3;
  items: NavGroupItem[];
  collapsed: boolean;
  onNavClick?: () => void;
}) {
  const { pathname } = useLocation();
  const groupId = useId();
  const inGroup = items.some(({ to }) => to && (pathname === to || pathname.startsWith(`${to}/`)));
  const [open, setOpen] = useState(inGroup);

  useEffect(() => {
    if (inGroup) setOpen(true);
  }, [inGroup]);

  const comingSoon = (name: string) => (
    <>
      <span className="flex-1">{name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">Em breve</span>
    </>
  );

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            className={cn(navLinkClass(inGroup), 'w-full justify-center px-0')}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-48">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
          {items.map((item) => item.to ? (
            <DropdownMenuItem key={item.label} asChild>
              <NavLink to={item.to} onClick={onNavClick} className="flex items-center gap-2 aria-[current=page]:bg-foreground/8 aria-[current=page]:font-medium">
                {item.icon && <item.icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
                <span>{item.label}</span>
              </NavLink>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.label} disabled className="gap-2 text-muted-foreground data-[disabled]:opacity-100">
              {comingSoon(item.label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? groupId : undefined}
        className={cn(navLinkClass(inGroup && !open), 'w-full')}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div id={groupId} className="ml-[1.3rem] mt-1 space-y-1 border-l border-foreground/10 pl-2">
          {items.map((item) => item.to ? (
            <NavLink
              key={item.label}
              to={item.to}
              onClick={onNavClick}
              {...preloadProps(item.to)}
              className={({ isActive }) => cn(navLinkClass(isActive), 'lg:py-2')}
            >
              {item.icon && <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />}
              <span>{item.label}</span>
            </NavLink>
          ) : (
            <div key={item.label} aria-disabled="true" className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              {comingSoon(item.label)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ onNavClick, onCollapsedChange, onClose }: {
  onNavClick?: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Menu do celular: botão de fechar no lugar do recolher. */
  onClose?: () => void;
}) {
  const [collapsedPref, setCollapsed] = useState(readSidebarCollapsed);
  const mobile = !!onClose;
  const collapsed = collapsedPref && !mobile;

  const toggleCollapsed = (val: boolean) => {
    setCollapsed(val);
    writeSidebarCollapsed(val);
    onCollapsedChange?.(val);
  };

  const renderItem = (item: NavItem) => 'items' in item ? (
    <NavGroup key={item.label} {...item} collapsed={collapsed} onNavClick={onNavClick} />
  ) : (
    <NavLink
      key={item.to}
      to={item.to}
      onClick={onNavClick}
      {...preloadProps(item.to)}
      aria-label={item.label}
      className={({ isActive }) => cn(navLinkClass(isActive), collapsed && 'justify-center px-0')}
    >
      <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );

  return (
    <aside
      className={cn(
        'h-full glass-sidebar pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] transition-all duration-300',
        collapsed ? 'w-16' : 'w-full lg:w-64'
      )}
    >
      <div className="flex h-full flex-col">
        <div className={cn('flex shrink-0 items-center justify-between border-b border-foreground/5', collapsed ? 'justify-center px-0 py-3' : 'h-16 px-4')}>
          {collapsed ? (
            // Encolhida: logo no topo e, logo abaixo, a seta para expandir.
            <div className="hidden flex-col items-center gap-1 lg:flex">
              <Logo showText={false} />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleCollapsed(false)}
                className="h-7 w-10 text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                aria-label="Expandir menu"
                title="Expandir menu"
              >
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>
          ) : (
            <>
              <Logo />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleCollapsed(true)}
                className="hidden text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground lg:inline-flex"
                aria-label="Recolher menu"
              >
                <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-11 w-11 text-muted-foreground hover:bg-foreground/5 hover:text-foreground lg:hidden"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          )}
        </div>

        <WorkspaceSwitcher collapsed={collapsed} onNavClick={onNavClick} />

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3 pt-4">
          {navItems.map(renderItem)}
        </nav>

        <div className="mt-auto shrink-0 space-y-1 border-t border-foreground/5 p-3">
          <Link
            to="/docs"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onNavClick}
            title="Documentação (abre em nova aba)"
            aria-label="Documentação (abre em nova aba)"
            className={cn(navLinkClass(false), collapsed && 'justify-center px-0')}
          >
            <BookOpen className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {!collapsed && (
              <span className="inline-flex items-center gap-1.5">
                Documentação
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              </span>
            )}
          </Link>
          <StreamingModeButton collapsed={collapsed} className={navLinkClass(false)} />
          <NavLink
            to="/settings"
            onClick={onNavClick}
            {...preloadProps('/settings')}
            aria-label="Configurações"
            className={({ isActive }) => cn(navLinkClass(isActive), collapsed && 'justify-center px-0')}
          >
            <Settings className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
            {!collapsed && <span>Configurações</span>}
          </NavLink>
        </div>
      </div>
    </aside>
  );
}
