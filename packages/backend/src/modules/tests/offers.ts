/**
 * Ofertas do Acompanhamento de testes (docs/features/26-tests). A oferta é
 * reconhecida pelo código no nome da campanha, como palavra inteira e
 * respeitando maiúsculas ("IR" não pega "ir" no meio de uma frase).
 */

export interface TestOffer {
  id: string;
  name: string;
  codes: string[];
  /** act_…; vazio = qualquer conta do painel. */
  accountIds: string[];
  /** Produtos da oferta, para a Saúde do checkout (filtro products do /summary). */
  products: string[];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function offerMatcher(offers: TestOffer[]) {
  const rules = offers
    .filter((offer) => offer.codes.length)
    .map((offer) => ({
      id: offer.id,
      accounts: offer.accountIds.map((id) => id.replace(/^act_/, '')),
      re: new RegExp(`(^|[^A-Za-z0-9])(${offer.codes.map(escape).join('|')})([^A-Za-z0-9]|$)`),
    }));
  return (campaignName: string, accountId: string): string | null => {
    const account = accountId.replace(/^act_/, '');
    for (const rule of rules) {
      if (rule.re.test(campaignName) && (!rule.accounts.length || rule.accounts.includes(account))) return rule.id;
    }
    return null;
  };
}

/** Valida o cadastro vindo da tela. Devolve a mensagem do erro ou null. */
export function offersError(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > 100) return 'Envie de 0 a 100 ofertas.';
  const ids = new Set<string>();
  for (const item of value as Partial<TestOffer>[]) {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(item.id)) return 'Oferta com id inválido.';
    if (ids.has(item.id)) return `Oferta repetida: ${item.id}.`;
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) return `Nome inválido em ${item.id}.`;
    if (!Array.isArray(item.codes) || item.codes.length === 0 || item.codes.length > 10
      || item.codes.some((code) => typeof code !== 'string' || !code.trim() || code.length > 40)) return `Códigos inválidos em ${item.name}.`;
    if (!Array.isArray(item.accountIds) || item.accountIds.some((id) => typeof id !== 'string' || !/^(act_)?\d{5,22}$/.test(id))) return `Contas inválidas em ${item.name}.`;
    if (!Array.isArray(item.products) || item.products.length > 50 || item.products.some((p) => typeof p !== 'string' || p.length > 200)) return `Produtos inválidos em ${item.name}.`;
    const extra = Object.keys(item).filter((key) => !['id', 'name', 'codes', 'accountIds', 'products'].includes(key));
    if (extra.length) return `Campo desconhecido em ${item.name}: ${extra[0]}.`;
  }
  return null;
}

export function normalizeOffers(offers: TestOffer[]): TestOffer[] {
  return offers.map((offer) => ({
    id: offer.id,
    name: offer.name.trim(),
    codes: [...new Set(offer.codes.map((code) => code.trim()))],
    accountIds: [...new Set(offer.accountIds.map((id) => `act_${id.replace(/^act_/, '')}`))],
    products: [...new Set(offer.products.map((p) => p.trim()).filter(Boolean))],
  }));
}
