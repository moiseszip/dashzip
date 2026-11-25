import type { Workspace } from '@/hooks/useWorkspaces';

/** Última lista de painéis vista neste aparelho, por usuário: abre o app já no painel. */
export const CACHE_PREFIX = 'dashzip_workspaces:';

export function readCachedWorkspaces(userId: string | undefined): Workspace[] | undefined {
  if (!userId) return undefined;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    const list = raw ? JSON.parse(raw) : undefined;
    return Array.isArray(list) && list.length > 0 ? list : undefined;
  } catch {
    return undefined;
  }
}

const ADMIN_PREFIX = 'dashzip_is_admin:';

/** Última resposta de "é admin?" deste usuário: mostra a aba Usuários sem esperar o servidor. */
export function readCachedAdmin(userId: string | undefined): boolean | undefined {
  if (!userId) return undefined;
  try {
    const raw = localStorage.getItem(ADMIN_PREFIX + userId);
    return raw === null ? undefined : raw === '1';
  } catch {
    return undefined;
  }
}

export function writeCachedAdmin(userId: string, isAdmin: boolean) {
  try { localStorage.setItem(ADMIN_PREFIX + userId, isAdmin ? '1' : '0'); } catch { /* sem armazenamento: segue sem cache */ }
}

/** Apaga o que fica guardado do usuário no aparelho (no logout). */
export function clearCachedUserData() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(CACHE_PREFIX) || key.startsWith(ADMIN_PREFIX)) localStorage.removeItem(key);
  }
}
