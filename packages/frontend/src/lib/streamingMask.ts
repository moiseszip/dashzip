/**
 * Modo streaming: troca nomes reais por apelidos estáveis ("Campanha 3") e
 * esconde dados que não faz sentido numerar (e-mail, telefone, URL, token).
 * Este arquivo é só a lógica pura; o estado ligado/desligado e o hook ficam
 * em `contexts/StreamingModeContext.tsx`. Doc: docs/features/29-streaming-mode.
 */

/** Tipos que viram apelido numerado: o mesmo nome real sempre vira o mesmo número. */
export const PLACEHOLDER_LABELS = {
  workspace: 'Painel',
  offer: 'Oferta',
  product: 'Produto',
  campaign: 'Campanha',
  adset: 'Conjunto',
  ad: 'Anúncio',
  account: 'Conta',
  integration: 'Integração',
  page: 'Página',
  customer: 'Cliente',
  person: 'Pessoa',
  group: 'Grupo',
  element: 'Elemento',
  utm: 'UTM',
} as const;

/** Tipos que viram máscara fixa: não há o que numerar (ou numerar ajudaria a identificar). */
export const SECRET_KINDS = ['email', 'phone', 'document', 'id', 'url', 'domain', 'token', 'text'] as const;

export type PlaceholderKind = keyof typeof PLACEHOLDER_LABELS;
export type SecretKind = (typeof SECRET_KINDS)[number];
export type MaskKind = PlaceholderKind | SecretKind;

/** Máscara de tamanho fixo: não deixa adivinhar o comprimento do valor real. */
export const SECRET_MASK = '•••••';

export function isSecretKind(kind: MaskKind): kind is SecretKind {
  return (SECRET_KINDS as readonly string[]).includes(kind);
}

const normalizeKey = (value: string) => value.trim().replace(/\s+/g, ' ');

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Snapshot = Partial<Record<PlaceholderKind, [string, number][]>>;

export interface MaskRegistry {
  /** Apelido (ou máscara) do valor; vazio e nulo passam como vieram. */
  mask: (kind: MaskKind, value: string) => string;
  /** Troca, num texto livre, todo nome já apelidado, e-mail e URL pela versão mascarada. */
  scrub: (text: string) => string;
  snapshot: () => Snapshot;
}

/**
 * Registro dos apelidos. A numeração segue a ordem em que cada nome aparece
 * pela primeira vez e não muda mais durante a sessão (o `onChange` persiste
 * o mapa para sobreviver a um F5 no meio da gravação).
 */
export function createMaskRegistry(initial?: Snapshot | null, onChange?: (snapshot: Snapshot) => void): MaskRegistry {
  const maps = new Map<PlaceholderKind, Map<string, number>>();
  for (const kind of Object.keys(PLACEHOLDER_LABELS) as PlaceholderKind[]) {
    const entries = initial?.[kind];
    const map = new Map<string, number>();
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && Number.isInteger(entry[1])) map.set(entry[0], entry[1]);
      }
    }
    maps.set(kind, map);
  }

  const snapshot = (): Snapshot =>
    Object.fromEntries([...maps].filter(([, map]) => map.size > 0).map(([kind, map]) => [kind, [...map]]));

  const placeholder = (kind: PlaceholderKind, raw: string) => {
    const key = normalizeKey(raw);
    const map = maps.get(kind)!;
    let n = map.get(key);
    if (n === undefined) {
      n = map.size + 1;
      map.set(key, n);
      onChange?.(snapshot());
    }
    return `${PLACEHOLDER_LABELS[kind]} ${n}`;
  };

  const mask = (kind: MaskKind, value: string) => {
    if (typeof value !== 'string' || value.trim() === '') return value;
    if (isSecretKind(kind)) return SECRET_MASK;
    return placeholder(kind, value);
  };

  const scrub = (text: string) => {
    if (typeof text !== 'string' || !text) return text;
    const known: [string, string][] = [];
    for (const [kind, map] of maps) {
      for (const [name, n] of map) if (name.length >= 3) known.push([name, `${PLACEHOLDER_LABELS[kind]} ${n}`]);
    }
    known.sort((a, b) => b[0].length - a[0].length);
    let out = text.replace(URL_RE, SECRET_MASK).replace(EMAIL_RE, SECRET_MASK);
    for (const [name, label] of known) out = out.replace(new RegExp(escapeRegExp(name), 'gi'), label);
    return out;
  };

  return { mask, scrub, snapshot };
}

/** "cbo-kit|120256873073380460" → "cbo-kit": o padrão de UTM do painel é nome|id. */
export function utmNamePart(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.split('|')[0].trim() || value;
}

/** Tipo de apelido para cada nível da Meta. */
export const LEVEL_KIND = { account: 'account', campaign: 'campaign', adset: 'adset', ad: 'ad' } as const satisfies Record<string, PlaceholderKind>;

/** Tipo de apelido para cada UTM que carrega nome (o padrão do painel põe campanha, conjunto e anúncio nelas). */
export const UTM_KIND: Partial<Record<string, PlaceholderKind>> = {
  campaign: 'campaign',
  utm_campaign: 'campaign',
  medium: 'adset',
  utm_medium: 'adset',
  content: 'ad',
  utm_content: 'ad',
};
