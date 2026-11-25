import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { Check, ChevronRight, CircleCheck, CircleSlash, CircleX, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMask } from '@/contexts/StreamingModeContext';
import { SecretMask, StreamingHidden } from '@/components/Masked';
import type { DebugTag, TraceStatus } from '@/hooks/usePreview';

export function time(iso: string | number): string {
  return format(new Date(iso), 'HH:mm:ss');
}

export function StatusDot({ status, className }: { status: TraceStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        status === 'error' ? 'bg-destructive' : status === 'warning' ? 'bg-warning' : 'bg-success',
        className,
      )}
    />
  );
}

/** Um item da coluna da esquerda, como a lista de mensagens do Tag Assistant. */
export function TimelineItem({
  n,
  title,
  subtitle,
  status,
  selected,
  badge,
  onClick,
}: {
  n: number;
  title: string;
  subtitle?: string;
  status: TraceStatus;
  selected: boolean;
  badge?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{n}</span>
      <StatusDot status={status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        {subtitle && <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>}
      </span>
      {badge && (
        <span className="shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">{badge}</span>
      )}
    </button>
  );
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    // Corpo JSON que chegou como texto (sendBeacon) fica legível.
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  const [copied, setCopied] = useState(false);
  const { enabled } = useMask();
  const text = stringify(value);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* sem permissão de clipboard: nada a fazer */
    }
  };
  // Modo streaming: payload bruto traz URL, produto, e-mail e IDs; não há o que salvar nele.
  if (enabled) return <StreamingHidden className={className}>Conteúdo bruto oculto no modo streaming.</StreamingHidden>;
  return (
    <div className={cn('group relative', className)}>
      <pre className="max-h-[520px] overflow-auto rounded-md border border-foreground/10 bg-foreground/[0.03] p-3 font-mono text-xs leading-relaxed text-foreground">
        {text || '—'}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded border border-foreground/10 bg-background p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        aria-label="Copiar"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function isPlain(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);
}

/** Variáveis no formato nome → valor; objetos abrem como JSON. */
export function VariablesTable({ vars }: { vars: Record<string, unknown> | undefined | null }) {
  const { enabled } = useMask();
  const entries = Object.entries(vars ?? {});
  if (entries.length === 0) return <Empty>Sem variáveis nesta mensagem.</Empty>;
  return (
    <div className="divide-y divide-foreground/5 rounded-md border border-foreground/10">
      {entries.map(([key, value]) =>
        isPlain(value) ? (
          <div key={key} className="grid gap-1 px-3 py-2 text-xs sm:grid-cols-[220px_1fr]">
            <span className="font-mono text-muted-foreground">{key}</span>
            <span className="break-all font-mono text-foreground">
              {value === null || value === undefined ? '—' : enabled && typeof value === 'string' ? <SecretMask /> : String(value)}
            </span>
          </div>
        ) : (
          <Expandable key={key} label={key} value={value} />
        ),
      )}
    </div>
  );
}

function Expandable({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="px-3 py-2 text-xs">
      <button type="button" className="flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        {label}
        {Array.isArray(value) && <span className="text-muted-foreground/70">({value.length})</span>}
      </button>
      {open && <JsonBlock value={value} className="mt-2" />}
    </div>
  );
}

const TAG_GROUPS: { status: DebugTag['status']; label: string }[] = [
  { status: 'failed', label: 'Com falha' },
  { status: 'fired', label: 'Disparadas' },
  { status: 'not_fired', label: 'Não disparadas' },
];

export function TagList({
  tags,
  onOpenHttp,
}: {
  tags: DebugTag[] | undefined;
  onOpenHttp?: (index: number) => void;
}) {
  const { scrub } = useMask();
  if (!tags?.length) return <Empty>Nenhuma tag avaliada nesta mensagem.</Empty>;
  return (
    <div className="space-y-4">
      {TAG_GROUPS.map(({ status, label }) => {
        const group = tags.filter((t) => t.status === status);
        if (!group.length) return null;
        return (
          <div key={status} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {label} ({group.length})
            </p>
            {group.map((tag, i) => (
              <div key={`${tag.name}-${i}`} className="flex items-start gap-2.5 rounded-md border border-foreground/10 px-3 py-2">
                <TagIcon status={tag.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{tag.name}</p>
                  {tag.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{scrub(tag.detail)}</p>}
                </div>
                {tag.httpIndex !== undefined && onOpenHttp && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-accent-readable underline-offset-2 hover:underline"
                    onClick={() => onOpenHttp(tag.httpIndex!)}
                  >
                    Ver requisição
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TagIcon({ status }: { status: DebugTag['status'] }) {
  if (status === 'fired') return <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Disparada" />;
  if (status === 'failed') return <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Falhou" />;
  return <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Não disparada" />;
}

/** Explicação do user_data (meta-user-data.ts no servidor): original, normalizado e o que saiu. */
interface UserDataField {
  key: string;
  label: string;
  original: string | null;
  normalized: string | null;
  sent: string | null;
  hashed: boolean;
  matches: boolean;
}

export function isUserData(value: unknown): value is UserDataField[] {
  return Array.isArray(value) && value.every((v) => v && typeof v === 'object' && 'key' in v && 'sent' in v);
}

export function UserDataTable({ fields }: { fields: UserDataField[] }) {
  const { enabled } = useMask();
  const hide = (value: ReactNode) => (enabled ? <SecretMask /> : value);
  return (
    <div className="overflow-x-auto rounded-md border border-foreground/10">
      <table className="w-full text-xs">
        <thead className="bg-foreground/[0.03] text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Campo</th>
            <th className="px-3 py-2 font-medium">Original</th>
            <th className="px-3 py-2 font-medium">Normalizado</th>
            <th className="px-3 py-2 font-medium">Enviado ao Meta</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/5">
          {fields.map((f) => (
            <tr key={f.key}>
              <td className="px-3 py-2 align-top">
                <span className="text-foreground">{f.label}</span>
                <span className="block font-mono text-[10px] text-muted-foreground">{f.key}</span>
              </td>
              <td className="max-w-[220px] break-all px-3 py-2 align-top font-mono">{f.original ? hide(f.original) : '—'}</td>
              <td className="max-w-[180px] break-all px-3 py-2 align-top font-mono">{f.hashed ? (f.normalized ? hide(f.normalized) : '—') : 'em claro'}</td>
              <td className="max-w-[260px] break-all px-3 py-2 align-top font-mono text-muted-foreground">
                {f.sent ? hide(f.hashed ? `${f.sent.slice(0, 16)}…` : f.sent) : <span className="text-warning">não enviado</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-foreground/10 px-3 py-6 text-center text-xs text-muted-foreground">{children}</p>;
}
