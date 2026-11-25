import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createMaskRegistry, utmNamePart, UTM_KIND, type MaskKind, type MaskRegistry } from '@/lib/streamingMask';

const ENABLED_KEY = 'dashzip:streaming-mode';
const MAP_KEY = 'dashzip:streaming-map';

type Maskable = string | null | undefined;

interface StreamingModeValue {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  toggle: () => void;
  /** Com o modo ligado, devolve o apelido ("Campanha 3") ou a máscara; desligado, o valor real. */
  mask: <T extends Maskable>(kind: MaskKind, value: T) => T;
  /** Para UTM: campaign/medium/content viram o apelido da campanha/conjunto/anúncio; as demais passam. */
  maskUtm: <T extends Maskable>(key: string, value: T) => T;
  /** Texto livre (toast, erro da API): troca nomes já apelidados, e-mails e URLs. */
  scrub: <T extends Maskable>(text: T) => T;
}

function readEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function readMap() {
  try {
    const raw = sessionStorage.getItem(MAP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMap(snapshot: unknown) {
  try {
    sessionStorage.setItem(MAP_KEY, JSON.stringify(snapshot));
  } catch {
    /* sem armazenamento: a numeração só não sobrevive ao F5 */
  }
}

const identity = <T,>(_kind: unknown, value: T) => value;

const StreamingModeContext = createContext<StreamingModeValue>({
  enabled: false,
  setEnabled: () => {},
  toggle: () => {},
  mask: identity,
  maskUtm: identity,
  scrub: (text) => text,
});

/** Atalho: Alt+Shift+S (Option+Shift+S no Mac), fora de campos de texto. */
function isShortcut(event: KeyboardEvent) {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyS') return false;
  const target = event.target as HTMLElement | null;
  return !(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
}

export function StreamingModeProvider({ children, initialEnabled }: { children: ReactNode; initialEnabled?: boolean }) {
  const [enabled, setEnabledState] = useState<boolean>(() => initialEnabled ?? readEnabled());
  const registry = useRef<MaskRegistry | null>(null);
  if (!registry.current) registry.current = createMaskRegistry(readMap(), writeMap);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    } catch {
      /* navegação privada: vale só nesta aba */
    }
  }, []);
  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-streaming', enabled);
  }, [enabled]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const value = useMemo<StreamingModeValue>(() => {
    const reg = registry.current!;
    const mask = <T extends Maskable>(kind: MaskKind, raw: T): T =>
      (enabled && typeof raw === 'string' ? reg.mask(kind, raw) : raw) as T;
    const maskUtm = <T extends Maskable>(key: string, raw: T): T => {
      const kind = UTM_KIND[key];
      if (!enabled || !kind || typeof raw !== 'string') return raw;
      return reg.mask(kind, utmNamePart(raw) ?? raw) as T;
    };
    const scrub = <T extends Maskable>(text: T): T => (enabled && typeof text === 'string' ? reg.scrub(text) : text) as T;
    return { enabled, setEnabled, toggle, mask, maskUtm, scrub };
  }, [enabled, setEnabled, toggle]);

  return <StreamingModeContext.Provider value={value}>{children}</StreamingModeContext.Provider>;
}

export function useStreamingMode() {
  return useContext(StreamingModeContext);
}

/** Atalho para quem só precisa mascarar. */
export const useMask = useStreamingMode;
