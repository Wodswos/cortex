import { configureApiOrigin } from '@cortex/crdt';

const capacitor = (globalThis as { Capacitor?: { isNativePlatform(): boolean } }).Capacitor;
// Remote-web mode already has the right origin. Preserve the bundled origin and
// its IndexedDB data when connecting the normal native app to its account server.
if (capacitor?.isNativePlatform() && (location.protocol === 'capacitor:' || location.hostname === 'localhost')) {
  configureApiOrigin(import.meta.env.VITE_CORTEX_API_ORIGIN ?? '');
}
