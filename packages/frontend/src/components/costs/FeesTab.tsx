import { useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMask } from '@/contexts/StreamingModeContext';
import {
  LEGACY_USD_RULE_ID,
  PAYMENT_LABELS,
  newId,
  type CostSettings,
  type CostSettingsInput,
  type ExtraFee,
  type MediaTaxRule,
} from '@/lib/costs';
import { findTrackingPlatform } from '@/lib/trackingPlatforms';

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

const platformName = (id: string) => findTrackingPlatform(id)?.name ?? id;

function numberValue(raw: string) {
  if (raw.trim() === '') return 0;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

/** Escolha múltipla compacta; lista vazia significa "todos". */
function MultiPick({ label, allLabel, options, value, onChange }: {
  label: string;
  allLabel: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const text = value.length === 0
    ? allLabel
    : value.length === 1 ? (options.find((o) => o.id === value[0])?.name ?? value[0]) : `${value.length} selecionados`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 w-full justify-between font-normal" aria-label={label}>
          <span className="truncate">{text}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 w-60 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Nada marcado = {allLabel.toLowerCase()}</DropdownMenuLabel>
        {options.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma opção ainda</p>}
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={value.includes(option.id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(on) => onChange(on ? [...value, option.id] : value.filter((v) => v !== option.id))}
          >
            {option.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FeesTab({ settings, value, onChange }: {
  settings: CostSettings;
  value: CostSettingsInput;
  onChange: (next: CostSettingsInput) => void;
}) {
  const [newPlatform, setNewPlatform] = useState('');
  const { mask } = useMask();
  const platformOptions = settings.options.platforms.map((id) => ({ id, name: platformName(id) }));
  const feePlatforms = new Set(settings.options.checkouts
    .filter((checkout) => checkout.active && checkout.needsFeeRule)
    .map((checkout) => checkout.platform));
  const checkoutOptions = platformOptions.filter((platform) => feePlatforms.has(platform.id));
  const accountOptions = settings.accounts.map((a) => ({ id: a.accountId.startsWith('act_') ? a.accountId : `act_${a.accountId}`, name: `${mask('account', a.name)} (${a.currency})` }));
  const currencies = [...new Set(['USD', 'BRL', ...settings.accounts.map((a) => a.currency)])];

  const setFee = (feeId: string, patch: Partial<ExtraFee>) =>
    onChange({ ...value, extraFees: value.extraFees.map((f) => (f.id === feeId ? { ...f, ...patch } : f)) });
  const setRule = (ruleId: string, patch: Partial<MediaTaxRule>) =>
    onChange({ ...value, mediaTaxRules: value.mediaTaxRules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)) });
  const setCheckout = (platform: string, patch: { percent?: number; fixedBRL?: number }) =>
    onChange({ ...value, checkoutRules: value.checkoutRules.map((r) => (r.platform === platform ? { ...r, ...patch } : r)) });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Imposto sobre vendas</CardTitle>
          <CardDescription>Percentual sobre o faturamento líquido de cada pedido aprovado, após as taxas do checkout. Deixe em branco se não houver alíquota.</CardDescription>
        </CardHeader>
        <CardContent>
          <Label className="grid max-w-xs gap-1.5">Alíquota (%)
            <Input
              type="number" min="0" max="100" step="0.01" placeholder="Sem imposto"
              value={value.salesTaxPercent ?? ''}
              onChange={(e) => onChange({ ...value, salesTaxPercent: e.target.value === '' ? null : numberValue(e.target.value) })}
            />
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Impostos e taxas extras</CardTitle>
          <CardDescription>
            Cobranças por pedido que o checkout não informa: ISS, antecipação, gateway, parcelamento. Valem uma vez por pedido aprovado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {value.extraFees.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma cadastrada.</p>}
          {value.extraFees.map((fee) => (
            <div key={fee.id} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-12 md:items-end">
              <Label className="grid gap-1 md:col-span-3">Descrição
                <Input value={fee.description} maxLength={80} placeholder="Ex.: ISS" onChange={(e) => setFee(fee.id, { description: e.target.value })} />
              </Label>
              <Label className="grid gap-1 md:col-span-2">Tipo
                <select className={selectClass} value={fee.kind} onChange={(e) => setFee(fee.id, { kind: e.target.value as ExtraFee['kind'] })}>
                  <option value="tax">Imposto</option>
                  <option value="fee">Taxa</option>
                </select>
              </Label>
              <Label className="grid gap-1 md:col-span-2">Meio de pagamento
                <select className={selectClass} value={fee.paymentMethod} onChange={(e) => setFee(fee.id, { paymentMethod: e.target.value as ExtraFee['paymentMethod'] })}>
                  {settings.options.paymentMethods.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                </select>
              </Label>
              <div className="grid gap-1 md:col-span-2">
                <span className="text-sm font-medium">Checkouts</span>
                <MultiPick label="Checkouts da taxa" allLabel="Todos os checkouts" options={platformOptions} value={fee.platforms} onChange={(platforms) => setFee(fee.id, { platforms })} />
              </div>
              <Label className="grid gap-1 md:col-span-3">Base
                <select className={selectClass} value={fee.base} onChange={(e) => setFee(fee.id, { base: e.target.value as ExtraFee['base'] })}>
                  <option value="gross">Valor cheio do pedido</option>
                  <option value="net">Após a taxa do checkout</option>
                </select>
              </Label>
              <Label className="grid gap-1 md:col-span-2">Percentual (%)
                <Input type="number" min="0" max="100" step="0.01" value={fee.percent} onChange={(e) => setFee(fee.id, { percent: numberValue(e.target.value) })} />
              </Label>
              <Label className="grid gap-1 md:col-span-2">Fixo por pedido (R$)
                <Input type="number" min="0" max="100000" step="0.01" value={fee.fixedBRL} onChange={(e) => setFee(fee.id, { fixedBRL: numberValue(e.target.value) })} />
              </Label>
              <div className="flex md:col-span-8 md:justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...value, extraFees: value.extraFees.filter((f) => f.id !== fee.id) })}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remover
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button" variant="outline" size="sm" disabled={value.extraFees.length >= 50}
            onClick={() => onChange({
              ...value,
              extraFees: [...value.extraFees, { id: newId(), description: '', kind: 'tax', paymentMethod: 'all', platforms: [], base: 'net', percent: 0, fixedBRL: 0 }],
            })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar imposto ou taxa
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custo sobre a mídia</CardTitle>
          <CardDescription>
            Percentual somado ao gasto em anúncios, como o IOF das contas em dólar. As regras que valem para a mesma conta se somam.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {value.mediaTaxRules.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma regra. O gasto entra sem acréscimo.</p>}
          {value.mediaTaxRules.map((rule) => (
            <div key={rule.id} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-12 md:items-end">
              <Label className="grid gap-1 md:col-span-4">Descrição
                <Input value={rule.description} maxLength={80} placeholder="Ex.: IOF cartão internacional" onChange={(e) => setRule(rule.id, { description: e.target.value })} />
              </Label>
              <Label className="grid gap-1 md:col-span-2">Percentual (%)
                <Input type="number" min="0" max="100" step="0.01" value={rule.percent} onChange={(e) => setRule(rule.id, { percent: numberValue(e.target.value) })} />
              </Label>
              <Label className="grid gap-1 md:col-span-3">Vale para
                <select
                  className={selectClass} value={rule.scope}
                  onChange={(e) => {
                    const scope = e.target.value as MediaTaxRule['scope'];
                    setRule(rule.id, { scope, currency: scope === 'currency' ? (rule.currency ?? 'USD') : null, accountIds: scope === 'accounts' ? rule.accountIds : [] });
                  }}
                >
                  <option value="all">Todas as contas</option>
                  <option value="currency">Contas numa moeda</option>
                  <option value="accounts">Contas específicas</option>
                </select>
              </Label>
              <div className="grid gap-1 md:col-span-3">
                {rule.scope === 'currency' && (
                  <Label className="grid gap-1">Moeda
                    <select className={selectClass} value={rule.currency ?? 'USD'} onChange={(e) => setRule(rule.id, { currency: e.target.value })}>
                      {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Label>
                )}
                {rule.scope === 'accounts' && (
                  <>
                    <span className="text-sm font-medium">Contas</span>
                    <MultiPick label="Contas da regra" allLabel="Nenhuma conta" options={accountOptions} value={rule.accountIds} onChange={(accountIds) => setRule(rule.id, { accountIds })} />
                  </>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 md:col-span-12">
                <span className="text-xs text-muted-foreground">
                  {rule.id === LEGACY_USD_RULE_ID && 'Regra que veio da configuração anterior (taxa sobre anúncios em USD).'}
                  {rule.scope === 'accounts' && rule.accountIds.length === 0 && ' Marque ao menos uma conta.'}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...value, mediaTaxRules: value.mediaTaxRules.filter((r) => r.id !== rule.id) })}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remover
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button" variant="outline" size="sm" disabled={value.mediaTaxRules.length >= 50}
            onClick={() => onChange({
              ...value,
              mediaTaxRules: [...value.mediaTaxRules, { id: newId(), description: '', percent: 0, scope: 'currency', currency: 'USD', accountIds: [] }],
            })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar regra de mídia
          </Button>
        </CardContent>
      </Card>

      {checkoutOptions.length > 0 && <Card>
        <CardHeader>
          <CardTitle className="text-base">Taxa do checkout sem informação no webhook</CardTitle>
          <CardDescription>
            Usada quando o checkout envia o valor cheio do pedido sem informar a taxa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {value.checkoutRules.filter((rule) => feePlatforms.has(rule.platform)).map((rule) => (
            <div key={rule.platform} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-end">
              <span className="text-sm font-medium sm:pb-2">{platformName(rule.platform)}</span>
              <Label className="grid gap-1">Percentual (%)
                <Input type="number" min="0" max="100" step="0.01" value={rule.percent} onChange={(e) => setCheckout(rule.platform, { percent: numberValue(e.target.value) })} />
              </Label>
              <Label className="grid gap-1">Fixo (R$)
                <Input type="number" min="0" max="100000" step="0.01" value={rule.fixedBRL} onChange={(e) => setCheckout(rule.platform, { fixedBRL: numberValue(e.target.value) })} />
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...value, checkoutRules: value.checkoutRules.filter((r) => r.platform !== rule.platform) })}>
                Remover
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Checkout" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={newPlatform} onChange={(e) => setNewPlatform(e.target.value)}>
              <option value="">Selecionar checkout</option>
              {checkoutOptions.filter((p) => !value.checkoutRules.some((r) => r.platform === p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Button
              type="button" variant="outline" size="sm" disabled={!newPlatform}
              onClick={() => {
                onChange({ ...value, checkoutRules: [...value.checkoutRules, { platform: newPlatform, percent: 0, fixedBRL: 0 }] });
                setNewPlatform('');
              }}
            >
              Adicionar regra
            </Button>
          </div>
        </CardContent>
      </Card>}
    </div>
  );
}
