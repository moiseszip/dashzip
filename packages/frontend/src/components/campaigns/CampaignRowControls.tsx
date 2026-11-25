import { useEffect, useRef, useState, type ReactNode } from 'react';
import { setSkipStatusConfirm, skipStatusConfirm } from '@/lib/confirmPrefs';
import { ExternalLink, MoreVertical, Pause, Play, Wallet } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCurrency, statusLabel, type ObjectRow } from '@/lib/campaigns';
import { cn } from '@/lib/utils';
import { useMask } from '@/contexts/StreamingModeContext';

/** O mínimo de uma linha de campanha, conjunto ou anúncio para status e ações. */
export type ControlRow = Pick<ObjectRow, 'id' | 'name' | 'accountId' | 'accountCurrency' | 'status' | 'effectiveStatus' | 'dailyBudget' | 'lifetimeBudget' | 'budgetLevel'> & {
  level: 'campaign' | 'adset' | 'ad';
};

const NOUN = { campaign: 'campanha', adset: 'conjunto', ad: 'anúncio' } as const;

type Tone = 'active' | 'paused' | 'warning' | 'error' | 'muted';

function toneOf(status: string | null, effective: string | null): Tone {
  const value = effective ?? status;
  if (value === 'ACTIVE') return 'active';
  if (value === 'PAUSED' || value === 'CAMPAIGN_PAUSED' || value === 'ADSET_PAUSED') return 'paused';
  if (value === 'WITH_ISSUES' || value === 'DISAPPROVED' || value === 'PENDING_BILLING_INFO') return 'error';
  if (value === 'IN_PROCESS' || value === 'PENDING_REVIEW' || value === 'PREAPPROVED') return 'warning';
  return 'muted';
}

const TONE_CLASS: Record<Tone, { pill: string; dot: string }> = {
  active: { pill: 'bg-success/15 text-success', dot: 'bg-success' },
  paused: { pill: 'bg-foreground/[0.07] text-muted-foreground', dot: 'bg-muted-foreground' },
  warning: { pill: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  error: { pill: 'bg-destructive/15 text-destructive', dot: 'bg-destructive' },
  muted: { pill: 'bg-foreground/[0.05] text-muted-foreground', dot: 'bg-muted-foreground/60' },
};

/** Status efetivo da Meta com ponto colorido: verde ativo, cinza pausado, âmbar em análise, vermelho com problema. */
export function CampaignStatusBadge({ status, effectiveStatus, busy }: { status: string | null; effectiveStatus: string | null; busy?: boolean }) {
  const tone = TONE_CLASS[toneOf(status, effectiveStatus)];
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', tone.pill, busy && 'opacity-60')}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot, busy && 'animate-pulse')} aria-hidden="true" />
      <span className="truncate">{busy ? 'Aplicando…' : statusLabel(effectiveStatus ?? status)}</span>
    </span>
  );
}

/**
 * Status compacto (coluna estreita): bolinha verde se ativa, ícone de pausa se
 * pausada, bolinha âmbar/vermelha em análise ou com problema. O nome completo
 * fica na dica e no texto para leitores de tela.
 */
export function CampaignStatusIcon({ status, effectiveStatus, busy }: { status: string | null; effectiveStatus: string | null; busy?: boolean }) {
  const tone = toneOf(status, effectiveStatus);
  const label = busy ? 'Aplicando…' : statusLabel(effectiveStatus ?? status);
  return (
    <span className={cn('inline-flex h-5 w-5 items-center justify-center', busy && 'opacity-60')} title={label} role="img" aria-label={label}>
      {tone === 'paused'
        ? <Pause className="h-3.5 w-3.5 fill-current text-muted-foreground" aria-hidden="true" />
        : <span className={cn('h-2.5 w-2.5 rounded-full', TONE_CLASS[tone].dot, tone === 'active' && 'ring-4 ring-success/15', busy && 'animate-pulse')} aria-hidden="true" />}
    </span>
  );
}

export function adsManagerUrl(row: Pick<ControlRow, 'id' | 'accountId' | 'level'>) {
  const account = row.accountId.replace(/^act_/, '');
  const path = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' }[row.level];
  const param = { campaign: 'selected_campaign_ids', adset: 'selected_adset_ids', ad: 'selected_ad_ids' }[row.level];
  return `https://adsmanager.facebook.com/adsmanager/manage/${path}?act=${account}&${param}=${row.id}`;
}

export function budgetText(row: Pick<ControlRow, 'dailyBudget' | 'lifetimeBudget' | 'accountCurrency'>) {
  if (row.dailyBudget != null) return `${formatCurrency(row.dailyBudget, row.accountCurrency)}/dia`;
  if (row.lifetimeBudget != null) return `${formatCurrency(row.lifetimeBudget, row.accountCurrency)} total`;
  return null;
}

/**
 * Menu ⋮ da linha: ativar/pausar, alterar orçamento e abrir no Gerenciador. As ações que
 * mudam a Meta só abrem a confirmação; quem chama executa depois do "confirmar".
 */
export function CampaignActionsMenu({ row, busy, onStatus, onBudget, extra }: {
  row: ControlRow;
  busy?: boolean;
  onStatus: (row: ControlRow, action: 'pause' | 'activate') => void;
  onBudget: (row: ControlRow) => void;
  extra?: ReactNode;
}) {
  const noun = NOUN[row.level];
  const { enabled: streaming, mask } = useMask();
  const name = mask(row.level, row.name);
  const canToggle = row.status === 'ACTIVE' || row.status === 'PAUSED';
  const ownBudget = row.budgetLevel === row.level && (row.dailyBudget != null || row.lifetimeBudget != null);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={busy} aria-label={`Ações de ${name}`}>
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground" title={name}>{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canToggle && (row.status === 'ACTIVE' ? (
          <DropdownMenuItem onSelect={() => onStatus(row, 'pause')}><Pause className="mr-2 h-4 w-4" aria-hidden="true" />Pausar {noun}</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onStatus(row, 'activate')}><Play className="mr-2 h-4 w-4" aria-hidden="true" />Ativar {noun}</DropdownMenuItem>
        ))}
        {!canToggle && <DropdownMenuItem disabled>Status {statusLabel(row.status).toLowerCase()}: sem ação aqui</DropdownMenuItem>}
        {ownBudget ? (
          <DropdownMenuItem onSelect={() => onBudget(row)}>
            <Wallet className="mr-2 h-4 w-4" aria-hidden="true" />
            <span className="flex-1">Mudar orçamento {row.dailyBudget != null ? 'diário' : 'total'}</span>
            <span className="ml-2 text-xs text-muted-foreground">{budgetText(row)}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <Wallet className="mr-2 h-4 w-4" aria-hidden="true" />
            {row.budgetLevel === 'adset' ? 'Orçamento nos conjuntos' : row.budgetLevel === 'campaign' ? 'Orçamento na campanha' : 'Sem orçamento editável'}
          </DropdownMenuItem>
        )}
        {extra}
        <DropdownMenuSeparator />
        {streaming ? (
          // Modo streaming: sem href, para o rodapé do navegador não mostrar os IDs da conta e do objeto.
          <DropdownMenuItem onSelect={() => window.open(adsManagerUrl(row), '_blank', 'noopener,noreferrer')}>
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />Abrir no Gerenciador
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <a href={adsManagerUrl(row)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />Abrir no Gerenciador
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Confirmação própria do app para pausar/ativar; fica aberta até a Meta responder. */
export function StatusConfirmDialog({ target, busy, onCancel, onConfirm }: {
  target: { row: ControlRow; action: 'pause' | 'activate' } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const verb = target?.action === 'pause' ? 'Pausar' : 'Ativar';
  const noun = target ? NOUN[target.row.level] : 'campanha';
  const { mask } = useMask();
  const [dontAsk, setDontAsk] = useState(false);
  // Com "não perguntar de novo" ligado, a ação vai direto, uma vez por pedido.
  const skipping = target !== null && skipStatusConfirm();
  const fired = useRef<typeof target>(null);
  useEffect(() => {
    if (!target) { fired.current = null; return; }
    if (skipping && fired.current !== target) {
      fired.current = target;
      onConfirm();
    }
  }, [target, skipping, onConfirm]);
  const confirm = () => {
    if (dontAsk) setSkipStatusConfirm(true);
    onConfirm();
  };
  return (
    <AlertDialog open={target !== null && !skipping} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{verb} {noun}?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {target && mask(target.row.level, target.row.name)}
            <span className="mt-2 block">
              {target?.action === 'pause'
                ? 'A veiculação para assim que a Meta aplicar a mudança.'
                : 'A veiculação volta assim que a Meta aplicar a mudança e aprovar o que estiver em análise.'}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} disabled={busy} />
          Não perguntar de novo
        </label>
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button>
          <Button type="button" variant={target?.action === 'pause' ? 'destructive' : 'default'} disabled={busy} onClick={confirm}>
            {busy ? 'Aplicando…' : `${verb} na Meta`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
