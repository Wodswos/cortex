import { afterEach, expect, it, vi } from 'vitest';
import { configureApiOrigin, apiUrl, socketUrl } from '../src/endpoint';
import { api, setApiUserId } from '../src/api';
import { SyncClient } from '../src/sync';

afterEach(() => { configureApiOrigin(''); setApiUserId(null); vi.unstubAllGlobals(); });

it('keeps browser API and sockets on their current origin', () => {
  vi.stubGlobal('location', { protocol: 'https:', host: 'cortex.example.com' });
  expect(apiUrl('/api/auth/me')).toBe('/api/auth/me');
  expect(SyncClient.defaultUrl()).toBe('wss://cortex.example.com/api/sync');
});

it('uses one configured backend for native login, identity checks, sync and terminal sockets', async () => {
  vi.stubGlobal('location', { protocol: 'capacitor:', host: 'localhost' });
  configureApiOrigin('https://cortex.example.com:8443');
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'account-a' }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  setApiUserId('account-a');
  await api.login('alice', 'fixture-password');
  expect(fetch).toHaveBeenCalledWith('https://cortex.example.com:8443/api/auth/login', expect.objectContaining({
    method: 'POST', credentials: 'include', headers: expect.objectContaining({ 'X-Cortex-User': 'account-a' }),
  }));
  expect(SyncClient.defaultUrl()).toBe('wss://cortex.example.com:8443/api/sync');
  expect(socketUrl('/api/tmux/attach')).toBe('wss://cortex.example.com:8443/api/tmux/attach');
  configureApiOrigin('http://127.0.0.1:39901');
  expect(socketUrl('/api/sync')).toBe('ws://127.0.0.1:39901/api/sync');
});

it('rejects credentials and non-origin URLs in server configuration', () => {
  for (const value of ['file:///tmp/backend', 'https://user:password@server.invalid', 'https://server.invalid/api', 'https://server.invalid/?token=secret']) {
    expect(() => configureApiOrigin(value)).toThrow();
  }
});
