import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const plist = fileURLToPath(new URL('../ios/App/App/Info.plist', import.meta.url));
if (existsSync(plist)) {
  const defaults = readFileSync(new URL('../../web/.env.mobile', import.meta.url), 'utf8');
  const origin = process.env.VITE_CORTEX_API_ORIGIN ?? defaults.match(/^VITE_CORTEX_API_ORIGIN=(.+)$/m)?.[1];
  const server = new URL(origin);
  if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password || server.pathname !== '/' || server.search || server.hash) {
    throw new Error('VITE_CORTEX_API_ORIGIN must be an HTTP(S) origin');
  }
  const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  const ats = info.NSAppTransportSecurity ?? {};
  const previous = info.CortexHTTPExceptionHost;
  if (previous && (server.protocol !== 'http:' || previous !== server.hostname)) {
    const exception = ats.NSExceptionDomains?.[previous];
    if (exception) {
      delete exception.NSExceptionAllowsInsecureHTTPLoads;
      if (!Object.keys(exception).length) delete ats.NSExceptionDomains[previous];
    }
    execFileSync('plutil', ['-remove', 'CortexHTTPExceptionHost', plist]);
  }
  if (server.protocol === 'http:') {
    ats.NSExceptionDomains ??= {};
    ats.NSExceptionDomains[server.hostname] = {
      ...ats.NSExceptionDomains[server.hostname], NSExceptionAllowsInsecureHTTPLoads: true,
    };
    // Scope HTTP access to the selected host; retain all other plist/signing settings.
    execFileSync('plutil', [previous === server.hostname ? '-replace' : '-insert', 'CortexHTTPExceptionHost', '-string', server.hostname, plist]);
  }
  execFileSync('plutil', [info.NSAppTransportSecurity ? '-replace' : '-insert', 'NSAppTransportSecurity', '-json', JSON.stringify(ats), plist]);
}
