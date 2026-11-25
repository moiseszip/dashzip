/** "Não perguntar de novo" do pausar/ativar, lembrado neste navegador. */
const KEY = 'dashzip:skip-status-confirm';

export function skipStatusConfirm(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setSkipStatusConfirm(value: boolean) {
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* sem storage: vale só nesta visita */ }
}
