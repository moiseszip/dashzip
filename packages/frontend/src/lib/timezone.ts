/**
 * Fuso horário do painel. Cada painel guarda um fuso IANA (padrão
 * America/Sao_Paulo) e ele decide o que é "hoje", "ontem" e "este mês" nos
 * seletores de data. O backend usa o mesmo fuso para cortar os dias.
 * Doc: docs/features/30-settings/settings.md.
 */

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Os mais usados aparecem primeiro no seletor; o resto vem da lista IANA do navegador. */
export const COMMON_TIMEZONES: { id: string; label: string }[] = [
  { id: 'America/Sao_Paulo', label: 'São Paulo, Brasília' },
  { id: 'America/Manaus', label: 'Manaus' },
  { id: 'America/Fortaleza', label: 'Fortaleza, Recife, Salvador' },
  { id: 'America/Cuiaba', label: 'Cuiabá, Campo Grande' },
  { id: 'America/Rio_Branco', label: 'Rio Branco' },
  { id: 'America/Noronha', label: 'Fernando de Noronha' },
  { id: 'Europe/Lisbon', label: 'Lisboa' },
  { id: 'America/New_York', label: 'Nova York' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'America/Mexico_City', label: 'Cidade do México' },
  { id: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { id: 'Europe/London', label: 'Londres' },
  { id: 'UTC', label: 'UTC' },
];

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(value: unknown): string {
  return isValidTimezone(value) ? value : DEFAULT_TIMEZONE;
}

/** "2026-11-23": o dia do calendário daquele instante no fuso. */
export function dayInTimezone(timeZone: string, date: Date = new Date()): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

/** "UTC−03:00" naquele instante (muda com o horário de verão). */
export function timezoneOffsetLabel(timeZone: string, date: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const offset = part.replace('GMT', '');
    return `UTC${offset ? offset.replace('-', '−') : '+00:00'}`;
  } catch {
    return '';
  }
}

/** Lista IANA do navegador; navegador antigo fica só com os comuns. */
export function allTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let list: string[] = [];
  try {
    list = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    list = [];
  }
  const ids = new Set([...COMMON_TIMEZONES.map((tz) => tz.id), ...list]);
  return [...ids];
}

export function timezoneLabel(id: string): string {
  return COMMON_TIMEZONES.find((tz) => tz.id === id)?.label ?? id.replace(/_/g, ' ').split('/').slice(-1)[0];
}

/** Busca sem acento e sem caixa no id, no nome amigável e no deslocamento. */
export function searchTimezones(query: string, ids: string[] = allTimezones(), now = new Date()): string[] {
  const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/_/g, ' ');
  const q = fold(query.trim());
  if (!q) return ids;
  return ids.filter((id) => fold(`${id} ${timezoneLabel(id)} ${timezoneOffsetLabel(id, now)}`).includes(q));
}

// ---------------------------------------------------------------------------
// Fuso ativo: o do painel selecionado. Fica num módulo (e no localStorage, por
// painel) para que os seletores de data saibam o "hoje" já no primeiro render,
// antes da lista de painéis chegar da API.
// ---------------------------------------------------------------------------

const CACHE_PREFIX = 'dashzip:workspace-timezone:';
let activeTimezone = DEFAULT_TIMEZONE;

export function getActiveTimezone(): string {
  return activeTimezone;
}

export function setActiveTimezone(timeZone: string | null | undefined, workspaceId?: string | null) {
  activeTimezone = normalizeTimezone(timeZone);
  if (!workspaceId) return;
  try {
    localStorage.setItem(CACHE_PREFIX + workspaceId, activeTimezone);
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
}

export function cachedTimezone(workspaceId: string | null | undefined): string | null {
  if (!workspaceId) return null;
  try {
    const value = localStorage.getItem(CACHE_PREFIX + workspaceId);
    return isValidTimezone(value) ? value : null;
  } catch {
    return null;
  }
}

/** "Hoje" no fuso do painel ativo. */
export function dayInPanel(date: Date = new Date()): string {
  return dayInTimezone(activeTimezone, date);
}
