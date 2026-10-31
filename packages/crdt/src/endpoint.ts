let apiOrigin = '';

/** Web clients stay same-origin; native clients configure their account server once at startup. */
export function configureApiOrigin(value: string): void {
  if (!value) { apiOrigin = ''; return; }
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('服务器地址必须是 HTTP(S) 来源地址');
  }
  apiOrigin = url.origin;
}

export function apiUrl(path: string): string { return `${apiOrigin}${path}`; }

export function socketUrl(path: string): string {
  const location = (globalThis as { location?: { protocol: string; host: string } }).location;
  const origin = apiOrigin || (location ? `${location.protocol}//${location.host}` : 'http://localhost:30090');
  const url = new URL(path, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
