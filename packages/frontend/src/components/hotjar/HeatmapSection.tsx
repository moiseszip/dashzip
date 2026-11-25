import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Eye, Flame, MousePointerClick, ScrollText } from 'lucide-react';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { SecretMask } from '@/components/Masked';
import { useMask } from '@/contexts/StreamingModeContext';
import { heatmapEmbedLink, type HotjarFilters, type HotjarTopElement } from '@/lib/hotjar';
import type { SummaryDateRange } from '@/lib/summary';
import { cn } from '@/lib/utils';
import { Section } from './Section';

type Mode = 'clicks' | 'scroll';

/** Largura de layout de cada aparelho dentro do iframe. */
const FRAME = { mobile: { w: 390, h: 720 }, desktop: { w: 1280, h: 800 } } as const;

/**
 * Mapa de cliques e de rolagem: a página real num iframe com o heatmap.js
 * desenhando por cima (sem a barra do topo; os controles ficam aqui). A visita
 * aberta pelo painel não é contada.
 */
export function HeatmapSection({ url, token, tokenError, range, filters, clicks, topElements }: {
  url: string;
  token: string | null;
  tokenError: string | null;
  range: SummaryDateRange;
  filters: HotjarFilters;
  clicks: number;
  topElements: HotjarTopElement[];
}) {
  const { enabled: streaming } = useMask();
  const [mode, setMode] = useState<Mode>('clicks');
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // O src não depende do modo: trocar Cliques/Rolagem vai por postMessage, sem recarregar a página.
  const src = useMemo(
    () => (token ? heatmapEmbedLink(url, token, 'clicks', range, filters, true) : null),
    [url, token, range, filters],
  );
  const newTab = token ? heatmapEmbedLink(url, token, mode, range, filters, false) : null;

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ stlHm: mode }, '*');
  }, [mode]);

  useEffect(() => setStatus(null), [src]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const s = e.data && typeof e.data === 'object' ? (e.data as { stlHmStatus?: unknown }).stlHmStatus : undefined;
      if (typeof s === 'string') setStatus(s === 'ok' ? null : s.slice(0, 200));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frame = FRAME[filters.device];
  // Celular: até 390px de largura real. Computador: 1280px reduzidos para caber no card.
  const scale = filters.device === 'desktop' && boxWidth ? Math.min(1, boxWidth / frame.w) : 1;
  const frameWidth = filters.device === 'mobile' ? Math.min(frame.w, boxWidth || frame.w) : frame.w;
  const hidden = streaming && !reveal;

  return (
    <Section icon={Flame} title="Mapa de calor" description="Onde as pessoas clicam ou tocam e até onde a página é vista">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          label="Tipo de mapa"
          options={[
            { value: 'clicks', label: 'Cliques', icon: MousePointerClick },
            { value: 'scroll', label: 'Rolagem', icon: ScrollText },
          ]}
        />
        {newTab && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => window.open(newTab, '_blank', 'noopener,noreferrer')}
          >
            Abrir em nova aba <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div ref={boxRef} className="w-full">
        {tokenError ? (
          <p className="text-sm text-destructive">{tokenError}</p>
        ) : !src ? (
          <div className="h-64 animate-pulse rounded-lg bg-foreground/5" />
        ) : hidden ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-foreground/15 px-4 text-center text-sm text-muted-foreground">
            <p>Modo streaming ligado: a página fica escondida para não mostrar o conteúdo da oferta.</p>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setReveal(true)}>
              <Eye className="h-3.5 w-3.5" /> Mostrar a página
            </Button>
          </div>
        ) : (
          <div
            className={cn('relative mx-auto overflow-hidden rounded-lg border border-foreground/10 bg-white')}
            style={{ width: frameWidth * scale, height: frame.h * scale }}
          >
            <iframe
              ref={frameRef}
              key={src}
              src={src}
              title="Página com o mapa de calor"
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin"
              onLoad={() => frameRef.current?.contentWindow?.postMessage({ stlHm: modeRef.current }, '*')}
              style={{ width: frameWidth, height: frame.h, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0 }}
            />
          </div>
        )}
        {status && <p className="mt-2 text-xs text-destructive">{status}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {clicks.toLocaleString('pt-BR')} {clicks === 1 ? 'clique' : 'cliques'} no período.{' '}
          {filters.device === 'desktop'
            ? 'Layout de computador (1280 px) reduzido para caber aqui.'
            : 'Layout de celular, na largura de um iPhone.'}{' '}
          A visita aberta pelo painel não é contada.
        </p>
      </div>

      <TopElements elements={topElements} />
    </Section>
  );
}

function shortSelector(selector: string | null): string {
  if (!selector) return '(sem elemento)';
  const parts = selector.split('>');
  return parts.length > 3 ? `…>${parts.slice(-3).join('>')}` : selector;
}

function TopElements({ elements }: { elements: HotjarTopElement[] }) {
  // Modo streaming: o texto do botão pode trazer o nome do produto; o seletor, classes com o nome da oferta.
  const { enabled, mask } = useMask();
  if (elements.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum clique nesta página no período.</p>;
  }
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Elementos mais clicados</h3>
      <ul className="divide-y divide-foreground/5 rounded-md border border-foreground/10">
        {elements.slice(0, 10).map((e, i) => (
          <li key={`${e.selector}-${i}`} className="flex items-center gap-3 px-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="truncate">{e.label ? mask('element', e.label) : <span className="text-muted-foreground">Sem texto</span>}</p>
              {enabled ? (
                <p className="truncate font-mono text-[10px]"><SecretMask /></p>
              ) : (
                <p className="truncate font-mono text-[10px] text-muted-foreground" title={e.selector ?? ''}>
                  {shortSelector(e.selector)}
                </p>
              )}
            </div>
            <span className="tabular-nums">{e.clicks}</span>
            <span className="w-12 text-right tabular-nums text-muted-foreground">{e.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
