import type { CapacitorConfig } from '@capacitor/cli';

// Default to the bundled offline app. A deployment can opt into its HTTPS origin.
const remote = process.env.CORTEX_MOBILE_URL;
if (remote && new URL(remote).protocol !== 'https:') throw new Error('CORTEX_MOBILE_URL must use HTTPS');
const config: CapacitorConfig = {
  appId: 'app.cortex.ios',
  appName: 'Cortex',
  webDir: 'www',
  ...(remote ? { server: { url: remote, cleartext: false } } : {}),
  ios: { contentInset: 'always', backgroundColor: '#09090f' },
};
export default config;
