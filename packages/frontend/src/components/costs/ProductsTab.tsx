import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MaskedInput } from '@/components/Masked';
import { useMask } from '@/contexts/StreamingModeContext';
import { newId, type CostSettings, type CostSettingsInput, type ProductCost } from '@/lib/costs';

const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

function numberValue(raw: string) {
  if (raw.trim() === '') return 0;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Custo em BRL por nome de produto, igual ao nome que chega na venda (sem diferenciar
 * maiúsculas e espaços). Order bump é linha própria e tem custo próprio.
 */
export function ProductsTab({ settings, value, onChange }: {
  settings: CostSettings;
  value: CostSettingsInput;
  onChange: (next: CostSettingsInput) => void;
}) {
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState('');
  const { enabled: streaming, mask } = useMask();
  const registered = new Set(value.productCosts.map((p) => key(p.productName)));
  const pending = settings.options.products.filter((name) => !registered.has(key(name)));

  const add = (productName: string) => {
    const name = productName.trim();
    if (!name || registered.has(key(name)) || value.productCosts.length >= 500) return;
    onChange({ ...value, productCosts: [...value.productCosts, { id: newId(), productName: name, costBRL: 0, group: null }] });
  };
  const set = (id: string, patch: Partial<ProductCost>) =>
    onChange({ ...value, productCosts: value.productCosts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const needle = key(search);
  const rows = value.productCosts.filter((p) => !needle || key(p.productName).includes(needle) || key(p.group ?? '').includes(needle));
  const groups = [...new Set(value.productCosts.map((p) => p.group).filter((g): g is string => !!g))];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custo por produto</CardTitle>
          <CardDescription>
            Quanto custa entregar cada produto (ferramenta, licença, impressão). Entra uma vez por item vendido; o order bump é um item próprio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {value.productCosts.length > 8 && (
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto ou grupo" className="h-9 max-w-xs" aria-label="Buscar produto" />
          )}
          {value.productCosts.length === 0 && <p className="text-sm text-muted-foreground">Nenhum custo cadastrado. Produtos digitais sem custo de entrega podem ficar de fora.</p>}
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-2">Produto</th>
                    <th className="w-40 p-2">Custo (R$)</th>
                    <th className="w-48 p-2">Grupo</th>
                    <th className="w-12 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product) => (
                    <tr key={product.id} className="border-b border-border/60">
                      <td className="p-2">{mask('product', product.productName)}</td>
                      <td className="p-2">
                        <Input
                          type="number" min="0" step="0.01" className="h-8" aria-label={`Custo de ${mask('product', product.productName)}`}
                          value={product.costBRL} onChange={(e) => set(product.id, { costBRL: numberValue(e.target.value) })}
                        />
                      </td>
                      <td className="p-2">
                        <MaskedInput
                          kind="group"
                          className="h-8" list="product-groups" maxLength={60} placeholder="Opcional" aria-label={`Grupo de ${product.productName}`}
                          value={product.group ?? ''} onChange={(e) => set(product.id, { group: e.target.value.trim() ? e.target.value : null })}
                        />
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remover ${mask('product', product.productName)}`}
                          onClick={() => onChange({ ...value, productCosts: value.productCosts.filter((p) => p.id !== product.id) })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!streaming && <datalist id="product-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adicionar produtos</CardTitle>
          <CardDescription>Produtos já vendidos neste painel. Para um produto que ainda não vendeu, digite o nome exato do checkout.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {pending.map((name) => (
                <Button key={name} type="button" variant="outline" size="sm" onClick={() => add(name)}>
                  <Plus className="mr-1 h-3 w-3" /> {mask('product', name)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Todos os produtos vendidos já estão na lista.</p>
          )}
          <form
            className="flex max-w-lg gap-2"
            onSubmit={(e) => { e.preventDefault(); add(custom); setCustom(''); }}
          >
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Nome do produto no checkout" aria-label="Nome do produto" />
            <Button type="submit" variant="outline" disabled={!custom.trim() || registered.has(key(custom))}>Adicionar</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
