import { request, type FullConfig } from '@playwright/test';

export default async function setup(config: FullConfig) {
  const client = await request.newContext({ baseURL: config.projects[0]!.use.baseURL });
  try {
    const response = await client.post('/api/auth/register', { data: { username: 'e2e_admin', password: 'fixture-password' } });
    if (!response.ok()) throw new Error(`Cannot initialize isolated test server: ${response.status()}`);
    process.env.E2E_ADMIN_COOKIE = response.headers()['set-cookie']!.split(';')[0];
  } finally { await client.dispose(); }
}
