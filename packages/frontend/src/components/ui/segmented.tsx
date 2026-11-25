import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

/**
 * Grupo de botões de escolha única (status, período, aparelho). No celular cada
 * opção tem 40px de altura e, com `fill`, o grupo ocupa a largura toda; do `sm`
 * para cima volta ao tamanho compacto.
 */
export function Segmented<T extends string>({ value, options, onChange, label, fill, className }: {
  value: T;
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[];
  onChange: (value: T) => void;
  /** Nome do grupo para leitor de tela. */
  label?: string;
  /** Ocupa a largura toda no celular, com as opções divididas por igual. */
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('max-w-full rounded-md border border-foreground/10 p-0.5', fill ? 'flex w-full sm:inline-flex sm:w-auto' : 'inline-flex', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 truncate rounded px-3 text-sm transition-colors sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs',
            fill && 'flex-1 sm:flex-none',
            value === o.value ? 'bg-foreground/10 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.icon && <o.icon className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
