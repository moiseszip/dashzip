import { useMemo } from 'react';
import { AlertTriangle, Globe } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { WebTrace } from '@/hooks/usePreview';
import { Empty, JsonBlock, TagList, TimelineItem, VariablesTable, time } from './parts';
import { useFollowSelection } from './useFollowSelection';
import { useMask } from '@/contexts/StreamingModeContext';

interface PageGroup {
  pageId: string;
  url: string;
  items: { trace: WebTrace; n: number }[];
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Lado web: o que o navegador aberto em preview fez, página a página. */
export function WebDebug({ traces }: { traces: WebTrace[] }) {
  const { selected, select } = useFollowSelection(traces);
  const { enabled, mask } = useMask();

  const pages = useMemo(() => {
    const out: PageGroup[] = [];
    traces.forEach((trace, i) => {
      const pageId = trace.page_id ?? trace.id;
      let group = out[out.length - 1];
      if (!group || group.pageId !== pageId) {
        group = { pageId, url: trace.data?.url ?? '', items: [] };
        out.push(group);
      }
      group.items.push({ trace, n: i + 1 });
    });
    return out;
  }, [traces]);

  if (traces.length === 0) {
    return (
      <Empty>
        Nenhum evento do navegador ainda. Abra o site pelo botão "Abrir site em preview": a página carrega com o selo
        "Preview" no canto, e o PageView e o InitiateCheckout aparecem aqui.
      </Empty>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="max-h-[70vh] space-y-3 overflow-y-auto rounded-lg border border-foreground/10 p-2">
        {pages.map((page) => (
          <div key={page.pageId + page.items[0].trace.id}>
            <p className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground" title={enabled ? mask('page', pathOf(page.url)) : page.url}>
              <Globe className="h-3 w-3 shrink-0" />
              <span className="truncate">{mask('page', pathOf(page.url))}</span>
            </p>
            {page.items.map(({ trace, n }) => (
              <TimelineItem
                key={trace.id}
                n={n}
                title={trace.title}
                subtitle={time(trace.created_at)}
                status={trace.status}
                selected={selected?.id === trace.id}
                onClick={() => select(trace.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {selected && <WebDetail trace={selected} />}
    </div>
  );
}

function WebDetail({ trace }: { trace: WebTrace }) {
  const { mask } = useMask();
  const d = trace.data ?? ({} as WebTrace['data']);
  const tags = d.tags ?? [];
  return (
    <div className="min-w-0 space-y-4 rounded-lg border border-foreground/10 p-4">
      <div>
        <p className="text-base font-medium text-foreground">{trace.title}</p>
        <p className="mt-0.5 break-all text-xs text-muted-foreground">
          {time(trace.created_at)} · {mask('url', d.url)}
        </p>
      </div>

      {d.aviso && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
          {d.aviso}
        </p>
      )}

      <Tabs defaultValue={tags.length ? 'tags' : 'vars'}>
        <TabsList>
          <TabsTrigger value="tags">Tags ({tags.length})</TabsTrigger>
          <TabsTrigger value="vars">Variáveis</TabsTrigger>
          <TabsTrigger value="event">Evento</TabsTrigger>
          <TabsTrigger value="raw">Mensagem</TabsTrigger>
        </TabsList>
        <TabsContent value="tags">
          <TagList tags={tags} />
        </TabsContent>
        <TabsContent value="vars">
          <VariablesTable vars={{ ...(d.vars ?? {}), visitor_id: d.vid, session_id: d.sid }} />
        </TabsContent>
        <TabsContent value="event">
          {d.event ? <JsonBlock value={d.event} /> : <Empty>Esta mensagem não gerou evento para o servidor.</Empty>}
        </TabsContent>
        <TabsContent value="raw">
          <JsonBlock value={trace} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
