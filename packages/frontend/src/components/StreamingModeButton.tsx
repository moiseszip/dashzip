import { Video, VideoOff } from 'lucide-react';
import { useStreamingMode } from '@/contexts/StreamingModeContext';
import { cn } from '@/lib/utils';

/**
 * Liga e desliga o modo streaming (gravar a tela sem mostrar nomes de ofertas,
 * campanhas, produtos, contas e clientes). Fica no rodapé do menu lateral,
 * entre Documentação e Configurações. Atalho: Alt+Shift+S.
 */
export function StreamingModeButton({ collapsed, className }: { collapsed: boolean; className?: string }) {
  const { enabled, toggle } = useStreamingMode();
  const label = enabled ? 'Desligar modo streaming (Alt+Shift+S)' : 'Ligar modo streaming (Alt+Shift+S)';
  const Icon = enabled ? Video : VideoOff;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        className,
        'w-full text-left',
        collapsed && 'relative justify-center px-0',
        enabled && 'text-foreground',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', enabled && 'text-destructive')} strokeWidth={1.5} aria-hidden="true" />
      {collapsed ? (
        enabled && <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />
      ) : (
        <>
          <span className="flex-1">Modo streaming</span>
          {/* Switch só visual: o botão inteiro já é o controle (role="switch"). */}
          <span
            className={cn(
              'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
              enabled ? 'bg-destructive' : 'bg-foreground/15',
            )}
            aria-hidden="true"
          >
            <span
              className={cn(
                'block h-3 w-3 rounded-full bg-background shadow transition-transform',
                enabled ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </span>
        </>
      )}
    </button>
  );
}
