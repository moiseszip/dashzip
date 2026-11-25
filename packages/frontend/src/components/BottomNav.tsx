import { DialogTrigger } from '@/components/ui/dialog';
import { NavLink } from 'react-router-dom';
import { BarChart3, Megaphone, MoreHorizontal, Video, VideoOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { preloadPath } from '@/lib/routes';
import { useStreamingMode } from '@/contexts/StreamingModeContext';
import { PanelSheet } from '@/components/PanelSheet';

const ITEMS = [
  { to: '/campaigns/meta', label: 'Campanhas', icon: Megaphone },
  { to: '/finance', label: 'Resultado', icon: BarChart3 },
];

const itemClass = 'group flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-none transition-colors';

/**
 * Barra inferior do celular e tablet (some no lg): Painéis, Campanhas, Resultado,
 * modo streaming e "Mais", que abre o menu em tela cheia.
 */
export function BottomNav() {
  const { enabled, toggle } = useStreamingMode();
  const StreamingIcon = enabled ? Video : VideoOff;

  return (
    <nav aria-label="Atalhos" className="app-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden">
      <div className="mx-auto flex max-w-xl">
        <PanelSheet itemClass={itemClass} />
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onPointerDown={() => preloadPath(to)}
            onFocus={() => preloadPath(to)}
            className={({ isActive }) => cn(itemClass, isActive ? 'text-foreground' : 'text-muted-foreground')}
          >
            {({ isActive }) => (
              <>
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-150 group-active:scale-90 motion-reduce:group-active:scale-100', isActive && 'bg-foreground/10')}>
                  <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2 : 1.6} aria-hidden="true" />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? 'Desligar modo streaming' : 'Ligar modo streaming'}
          onClick={toggle}
          className={cn(itemClass, enabled ? 'text-foreground' : 'text-muted-foreground')}
        >
          <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-150 group-active:scale-90 motion-reduce:group-active:scale-100', enabled && 'bg-foreground/10')}>
            <StreamingIcon className={cn('h-[18px] w-[18px]', enabled && 'text-destructive')} strokeWidth={enabled ? 2 : 1.6} aria-hidden="true" />
          </span>
          Streaming
        </button>
        <DialogTrigger asChild>
          <button type="button" className={cn(itemClass, 'text-muted-foreground')}>
            <span className="flex h-7 w-12 items-center justify-center rounded-full transition-transform duration-150 group-active:scale-90 motion-reduce:group-active:scale-100">
              <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
            </span>
            Mais
          </button>
        </DialogTrigger>
      </div>
    </nav>
  );
}
