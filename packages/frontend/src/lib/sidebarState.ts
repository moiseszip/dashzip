/** Menu lateral recolhido ou não, lembrado neste navegador entre as telas. */
const KEY = 'dashzip:sidebar-collapsed';

export function readSidebarCollapsed(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function writeSidebarCollapsed(value: boolean) {
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* sem storage: vale só nesta tela */ }
}
