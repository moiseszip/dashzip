// This worker only handles notifications and supports older push payloads.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    data = {};
  }
  const notification = self.registration.showNotification(data?.title ?? 'Dash.zip', {
    body: data?.body ?? 'Abra o Dash.zip para ver as vendas.',
    icon: '/apple-touch-icon.png',
    tag: data?.tag,
    silent: false,
    data: { url: data?.url },
  });
  const foregroundSound = data?.sale === true ? self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((windows) => {
      const visible = windows.find((client) => client.focused && client.visibilityState === 'visible')
        ?? windows.find((client) => client.visibilityState === 'visible');
      visible?.postMessage({ type: 'dashzip:sale-push' });
    }).catch(() => undefined) : undefined;
  event.waitUntil(Promise.all([notification, foregroundSound]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url ?? '/sales', self.location.origin);
    if (target.origin !== self.location.origin) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url === target.href);
    if (existing) return existing.focus();
    return self.clients.openWindow(target.href);
  })());
});
