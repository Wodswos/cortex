import type { CapacitorConfig } from '@capacitor/cli';

// Default to the bundled offline app. A deployment can opt into its HTTPS origin.
const remote = process.env.CORTEX_MOBILE_URL;
if (remote && new URL(remote).protocol !== 'https:') throw new Error('CORTEX_MOBILE_URL must use HTTPS');
const config: CapacitorConfig = {
  appId: 'app.cortex.ios',
  appName: 'Cortex',
  webDir: 'www',
  ...(remote ? { server: { url: remote, cleartext: false } } : {}),
  // The web app owns safe-area padding and scrolls individual panes. Letting
  // WKWebView add another inset/scroll container shifts the entire application.
  ios: { contentInset: 'never', scrollEnabled: false },
  // Native networking owns the server's HttpOnly session cookie. Browser CORS
  // and third-party cookie rules must not turn the bundled app into a login loop.
  plugins: { CapacitorHttp: { enabled: true }, Keyboard: { resize: 'native' } },
};
export default config;
