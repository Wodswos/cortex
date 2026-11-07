import { configureApiOrigin, configureApiTransport } from '@cortex/crdt';
import { invoke, isTauri } from '@tauri-apps/api/core';

const { Capacitor: capacitor, __CORTEX_DESKTOP_ORIGIN__: desktopOrigin } = globalThis as {
  Capacitor?: { isNativePlatform(): boolean };
  __CORTEX_DESKTOP_ORIGIN__?: string;
};
// Remote-web mode already has the right origin. Preserve the bundled origin and
// its IndexedDB data when connecting the normal native app to its account server.
if (isTauri() && location.protocol === 'tauri:' && desktopOrigin) {
  configureApiOrigin(desktopOrigin);
  configureApiTransport((request) => invoke<{ status: number; body: string }>('desktop_api_request', request)
    .catch((error: unknown) => { throw error instanceof Error ? error : new Error(String(error)); }));
} else if (capacitor?.isNativePlatform() && (location.protocol === 'capacitor:' || location.hostname === 'localhost')) {
  configureApiOrigin(import.meta.env.VITE_CORTEX_API_ORIGIN ?? '');
}
