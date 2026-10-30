import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { IncomingHttpHeaders } from 'node:http';

const derive = promisify(scrypt);

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const hash = await derive(password, salt, 64) as Buffer;
  return { hash: hash.toString('hex'), salt };
}

export async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Origin comes from the browser; proxy deployments must set PUBLIC_ORIGIN explicitly. */
export function originAllowed(headers: IncomingHttpHeaders): boolean {
  const origin = headers.origin;
  if (!origin) return true; // authenticated non-browser clients
  try {
    const actual = new URL(origin).origin;
    const configured = process.env.PUBLIC_ORIGIN;
    if (configured) return actual === new URL(configured).origin;
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === headers.host;
  } catch {
    return false;
  }
}

export function upgradeUrl(url: string | undefined): URL | null {
  try { return new URL(url ?? '/', 'http://localhost'); } catch { return null; }
}

/** Native sockets cannot override Origin; the handshake still requires a one-use session ticket. */
export function socketOriginAllowed(headers: IncomingHttpHeaders): boolean {
  return headers.origin === 'capacitor://localhost' || originAllowed(headers);
}

export interface WsIdentity { userId: string; sessionToken: string }

/** Bounded fixed-window limiter. A shared proxy gets a shared budget, never an XFF bypass. */
export class RateLimit {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(private limit: number, private windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    for (const [k, value] of this.entries) if (value.until <= now) this.entries.delete(k);
    const existing = this.entries.get(key);
    if (existing) return ++existing.count <= this.limit;
    if (this.entries.size >= 10_000) return false;
    this.entries.set(key, { count: 1, until: now + this.windowMs });
    return true;
  }
}
