import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useMask } from '@/contexts/StreamingModeContext';
import { isSecretKind, SECRET_MASK, type MaskKind } from '@/lib/streamingMask';
import { cn } from '@/lib/utils';

const HIDDEN_LABEL = 'Oculto no modo streaming';

/** Máscara visual: o valor real não vai para o DOM, nem para title ou aria-label. */
export function SecretMask({ className }: { className?: string }) {
  return (
    <span
      className={cn('select-none tracking-widest text-muted-foreground', className)}
      aria-label={HIDDEN_LABEL}
      role="img"
    >
      {SECRET_MASK}
    </span>
  );
}

/**
 * Um nome, ID ou dado pessoal na tela. Com o modo streaming ligado vira o apelido
 * estável do tipo ("Campanha 3") ou, para e-mail, telefone, URL e afins, a máscara.
 */
export function Masked({ kind, value, fallback = null, className }: {
  kind: MaskKind;
  value: string | null | undefined;
  fallback?: ReactNode;
  className?: string;
}) {
  const { enabled, mask } = useMask();
  if (!value || !value.trim()) return <>{fallback}</>;
  if (enabled && isSecretKind(kind)) return <SecretMask className={className} />;
  const text = mask(kind, value);
  return className ? <span className={className}>{text}</span> : <>{text}</>;
}

/**
 * Campo de formulário com valor sensível (domínio, pixel, nome de integração).
 * No modo streaming fica travado e mostra só o apelido ou a máscara: a edição
 * volta ao desligar o modo.
 */
export const MaskedInput = forwardRef<HTMLInputElement, ComponentProps<typeof Input> & { kind: MaskKind }>(
  ({ kind, value, ...props }, ref) => {
    const { enabled, mask } = useMask();
    if (!enabled) return <Input ref={ref} value={value} {...props} />;
    const raw = value === undefined || value === null ? '' : String(value);
    const shown = raw ? mask(kind, raw) : '';
    return (
      <Input
        ref={ref}
        id={props.id}
        className={props.className}
        value={shown}
        placeholder={raw ? undefined : props.placeholder}
        readOnly
        disabled
        title={HIDDEN_LABEL}
        aria-label={HIDDEN_LABEL}
      />
    );
  },
);
MaskedInput.displayName = 'MaskedInput';

/** Bloco inteiro escondido (JSON bruto, snippet, formulário de edição). */
export function StreamingHidden({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 rounded-md border border-dashed border-foreground/10 px-3 py-3 text-xs text-muted-foreground', className)}>
      <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children ?? `${HIDDEN_LABEL}.`}
    </p>
  );
}
