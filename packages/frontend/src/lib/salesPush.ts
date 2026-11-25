import { api } from './api';
import { disableSaleSound } from './salesSound';

function validWorker(registration: ServiceWorkerRegistration | undefined) {
  return registration?.active?.scriptURL === new URL('/sales-push-sw.js', window.location.origin).href;
}

export function supportsSalesPush() {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return standalone !== false && window.isSecureContext
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function existingSalesPush() {
  if (!supportsSalesPush()) return null;
  const worker = await navigator.serviceWorker.getRegistration('/');
  return worker && validWorker(worker) ? worker.pushManager.getSubscription() : null;
}

export async function enableSalesPush(worker: ServiceWorkerRegistration, publicKey: string) {
  // Permission must be requested directly from the button press on iPhone.
  if (await Notification.requestPermission() !== 'granted') {
    throw new Error('Permita as notificações do Dash.zip nos Ajustes do iPhone e tente novamente.');
  }
  const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  let subscription = await worker.pushManager.getSubscription();
  const activeKey = subscription?.options.applicationServerKey;
  if (activeKey && (activeKey.byteLength !== bytes.length
    || new Uint8Array(activeKey).some((byte, index) => byte !== bytes[index]))) {
    await removeSalesPush();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ applicationServerKey: bytes, userVisibleOnly: true });
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('O aparelho não gerou as chaves de notificações.');
  await api.post('/sales-push/devices', { endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth });
  return subscription.endpoint;
}

export async function removeSalesPush() {
  disableSaleSound();
  const current = await existingSalesPush();
  if (!current) return;
  // Stop this subscription even if the API fails (for example when signing out offline).
  await Promise.all([
    current.unsubscribe(),
    api.post('/sales-push/devices/remove', { endpoint: current.endpoint }, { signal: AbortSignal.timeout(3000) }),
  ]);
}
