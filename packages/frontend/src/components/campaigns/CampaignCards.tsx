import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CampaignStatusBadge, adsManagerUrl, type ControlRow } from '@/components/campaigns/CampaignRowControls';
import { useMask } from '@/contexts/StreamingModeContext';
import {
  CARD_METRICS, accountStatusLabel, formatCreated, formatCurrency, formatMetric, metricTone,
  type ColumnDef, type ColumnKey, type Level, type Metrics, type ObjectRow, type ViewCurrency,
} from '@/lib/campaigns';
import { cn } from '@/lib/utils';

/**
 * Visão de Campanhas no celular: um card por objeto, com os controles de 44px
 * (seleção, ativar/pausar, orçamento, descer de nível). Os mesmos callbacks da
 * tabela: nada aqui fala com a Meta sem passar pela confirmação de quem chama.
 */

const LABELS: Partial<Record<ColumnKey, string>> = { spend: 'Gasto', sales: 'Vendas', profit: 'Lucro', roi: 'ROI', margin: 'Margem', cpa: 'CPA' };

const toneClass = (key: ColumnKey, value: number | null | undefined) => {
  const tone = metricTone(key, value);
  return tone === 'gain' ? 'text-success' : tone === 'loss' ? 'text-destructive' : '';
};

export interface CardFormat {
  currency: ViewCurrency;
  /** Métrica em BRL → moeda da tela. */
  money: (value: number | null | undefined) => number | null;
  /** Orçamento/saldo na moeda da conta → moeda da tela. */
  budget: (value: number | null | undefined, accountCurrency: string) => number | null;
}

function metricText(def: Pick<ColumnDef, 'key' | 'kind'>, value: number | null | undefined, fmt: CardFormat) {
  if (def.key === 'createdTime') return '';
  return formatMetric(def.kind === 'money' ? fmt.money(value ?? null) : value ?? null, def.kind, fmt.currency);
}

function MetricCell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-sm font-medium tabular-nums', className)}>{children}</dd>
    </div>
  );
}

function MetricGrid({ values, columns, fmt }: { values: Partial<Metrics>; columns: ColumnDef[]; fmt: CardFormat }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
      {columns.map((c) => (
        <MetricCell key={c.key} label={LABELS[c.key] ?? c.label} className={toneClass(c.key, values[c.key as keyof Metrics])}>
          {metricText(c, values[c.key as keyof Metrics], fmt)}
        </MetricCell>
      ))}
    </dl>
  );
}

/** Totais do filtro atual, no topo da lista. */
export function CampaignTotalsCard({ count, totals, filtered, columns, fmt }: {
  count: number;
  totals: Partial<Metrics>;
  filtered: boolean;
  columns: ColumnDef[];
  fmt: CardFormat;
}) {
  return (
    <section aria-label="Totais" className="rounded-xl border border-border bg-foreground/[0.03] p-4">
      <p className="mb-3 text-sm font-medium">
        Total ({count}){filtered && <span className="ml-1 text-xs font-normal text-muted-foreground">filtrado</span>}
      </p>
      <MetricGrid values={totals} columns={columns} fmt={fmt} />
    </section>
  );
}

export function CampaignCard({
  row, level, checked, busy, nextLabel, extraColumns, cardColumns, fmt, accountStatus, cycleSpend,
  onSelect, onDrill, onStatus, onBudget,
}: {
  row: ObjectRow;
  level: Level;
  checked: boolean;
  busy: boolean;
  /** "conjuntos", "anúncios"…; null no último nível. */
  nextLabel: string | null;
  cardColumns: ColumnDef[];
  /** Colunas visíveis da tabela que não estão no card: aparecem em "Mais métricas". */
  extraColumns: ColumnDef[];
  fmt: CardFormat;
  accountStatus?: string | null;
  cycleSpend?: number | null;
  onSelect: (on: boolean) => void;
  onDrill: () => void;
  onStatus: (row: ControlRow, action: 'pause' | 'activate') => void;
  onBudget: (row: ControlRow) => void;
}) {
  const { enabled: streaming, mask } = useMask();
  const [expanded, setExpanded] = useState(false);
  const name = mask(row.level, row.name);
  const control: ControlRow | null = row.level === 'account' ? null : { ...row, level: row.level };
  const canToggle = row.status === 'ACTIVE' || row.status === 'PAUSED';
  const ownBudget = row.budgetLevel === row.level && (row.dailyBudget != null || row.lifetimeBudget != null);
  const budgetLabel = row.dailyBudget != null
    ? `${formatCurrency(fmt.budget(row.dailyBudget, row.accountCurrency), fmt.currency)}/dia`
    : `${formatCurrency(fmt.budget(row.lifetimeBudget, row.accountCurrency), fmt.currency)} total`;
  const idText = row.level === 'account' ? `${row.accountCurrency} · ${mask('id', row.id.replace(/^act_/, ''))}` : mask('id', row.id);

  return (
    <article
      aria-label={name}
      className={cn('rounded-xl border border-border bg-card transition-colors', checked && 'border-primary/50 bg-primary/[0.04]')}
    >
      <div className="flex items-start gap-1 p-1.5 pb-0">
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="h-5 w-5 accent-primary"
            aria-label={`Selecionar ${name}`}
            checked={checked}
            onChange={(e) => onSelect(e.target.checked)}
          />
        </label>
        <button
          type="button"
          className="min-w-0 flex-1 py-2 pr-1 text-left disabled:cursor-default"
          onClick={onDrill}
          disabled={!nextLabel}
          title={nextLabel ? `Ver ${nextLabel}` : undefined}
        >
          <span className="line-clamp-2 break-words text-sm font-medium leading-snug">{name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {row.level === 'account'
              ? <span className="text-xs text-muted-foreground">{accountStatusLabel(accountStatus)}</span>
              : <CampaignStatusBadge status={row.status} effectiveStatus={row.effectiveStatus} busy={busy} />}
            <span className="truncate text-[11px] text-muted-foreground">{idText}</span>
          </span>
        </button>
        {control && canToggle && (
          <label className="flex h-11 shrink-0 cursor-pointer items-center pl-1 pr-2.5">
            <Switch
              checked={row.status === 'ACTIVE'}
              disabled={busy}
              onCheckedChange={(on) => onStatus(control, on ? 'activate' : 'pause')}
              aria-label={row.status === 'ACTIVE' ? `Pausar ${name}` : `Ativar ${name}`}
            />
          </label>
        )}
      </div>

      <div className="space-y-3 px-4 pb-2 pt-2">
        <MetricGrid values={row} columns={cardColumns} fmt={fmt} />

        {expanded && extraColumns.length > 0 && (
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-border/60 pt-3">
            {extraColumns.map((c) => (
              <MetricCell key={c.key} label={c.label} className={c.key !== 'createdTime' ? toneClass(c.key, row[c.key as keyof Metrics]) : ''}>
                {c.key === 'createdTime' ? formatCreated(row.createdTime) : metricText(c, row[c.key as keyof Metrics], fmt)}
              </MetricCell>
            ))}
          </dl>
        )}
        {extraColumns.length > 0 && (
          <button type="button" className="flex h-10 w-full items-center justify-center gap-1 rounded-md text-xs text-muted-foreground hover:bg-foreground/5"
            aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Menos métricas' : `Mais métricas (${extraColumns.length})`}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-border/60 px-2 py-2">
        {level === 'account' && (
          <span className="px-2 text-xs text-muted-foreground">
            Ciclo: <span className="tabular-nums text-foreground">{formatCurrency(fmt.budget(cycleSpend ?? null, row.accountCurrency), fmt.currency)}</span>
          </span>
        )}
        {(level === 'campaign' || level === 'adset') && (ownBudget && control ? (
          <Button type="button" variant="outline" className="h-11 min-w-0 shrink gap-1.5 px-3 tabular-nums" disabled={busy} onClick={() => onBudget(control)}
            aria-label={`Mudar orçamento de ${name}: ${budgetLabel}`}>
            <span className="truncate">{budgetLabel}</span>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </Button>
        ) : (
          <span className="min-w-0 px-2 text-xs text-muted-foreground">
            {row.budgetLevel === 'campaign' ? 'Orçamento na campanha' : row.budgetLevel === 'adset' ? 'Orçamento nos conjuntos' : 'Sem orçamento'}
          </span>
        ))}
        <div className="ml-auto flex shrink-0 items-center">
          {control && (
            <Button
              type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={`Abrir ${name} no Gerenciador`}
              // Sem href: no modo streaming o rodapé do navegador não mostra os IDs.
              onClick={() => window.open(adsManagerUrl(control), '_blank', 'noopener,noreferrer')}
              title={streaming ? undefined : 'Abrir no Gerenciador de Anúncios'}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          {nextLabel && (
            <Button type="button" variant="ghost" className="h-11 gap-0.5 px-2 text-foreground" onClick={onDrill} aria-label={`Ver ${nextLabel} de ${name}`}>
              {nextLabel[0].toUpperCase() + nextLabel.slice(1)}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

export function cardColumnsFrom(columnByKey: Map<ColumnKey, ColumnDef>, visible: ColumnDef[]) {
  const card = CARD_METRICS.map((k) => columnByKey.get(k)).filter((c): c is ColumnDef => !!c);
  const inCard = new Set(CARD_METRICS);
  return { card, extra: visible.filter((c) => !inCard.has(c.key)) };
}

/** Barra fixa da seleção em lote, acima da barra inferior. */
export function BulkActionBar({ count, onActivate, onPause, onClear }: {
  count: number;
  onActivate: () => void;
  onPause: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Ações em lote"
      className="fixed inset-x-3 bottom-[calc(var(--app-bottom-nav-h)+0.75rem)] z-30 flex items-center gap-2 rounded-xl border border-border bg-popover p-2 shadow-xl lg:hidden"
    >
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Limpar seleção" onClick={onClear}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
        {count}<span className="hidden min-[380px]:inline"> selecionado{count === 1 ? '' : 's'}</span>
      </span>
      <Button type="button" variant="outline" className="h-11 px-4" onClick={onActivate}>Ativar</Button>
      <Button type="button" variant="outline" className="h-11 px-4" onClick={onPause}>Pausar</Button>
    </div>
  );
}
