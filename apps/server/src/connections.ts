import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DB, ServerRow } from './db';

export interface SshConnection {
  userId: string;
  host: string;
  password: string;
  sshDir: string;
}

/** Each account owns its credentials; the master key belongs in the data-volume backup. */
export class Connections {
  private key: Buffer;
  constructor(private db: DB, private dataDir: string) {
    const path = join(dataDir, 'credentials.key');
    try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    this.key = readFileSync(path);
    if (this.key.length !== 32) throw new Error('Invalid credentials.key');
  }
  encrypt(password: string): string | null {
    if (!password) return null;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  private decrypt(value: string | null): string {
    if (!value) return '';
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  }
  resolve(userId: string, id: string): SshConnection | null {
    const server = this.db.getServer(userId, id);
    if (!server) return null;
    const sshDir = join(this.dataDir, 'ssh', userId);
    mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    return { userId, host: server.host, password: this.decrypt(server.password_cipher), sshDir };
  }
  public(server: ServerRow) {
    return { id: server.id, name: server.name, host: server.host, passwordSet: !!server.password_cipher, registered: true };
  }
}

export function parseSshHost(value: string): { target: string; port?: string } | null {
  const match = /^(?:([A-Za-z_][A-Za-z0-9_.-]{0,63})@)?([A-Za-z0-9][A-Za-z0-9.-]{0,127}|\[[0-9a-fA-F:]+\])(?::([0-9]{1,5}))?$/.exec(value);
  if (!match || (match[3] && (+match[3] < 1 || +match[3] > 65535))) return null;
  const host = match[2]!.replace(/^\[|\]$/g, '');
  return { target: `${match[1] ? `${match[1]}@` : ''}${host}`, port: match[3] };
}

export function sshArgs(connection: SshConnection): string[] {
  const host = parseSshHost(connection.host);
  if (!host) throw new Error('无效的 SSH 目标');
  const args = ['-F', '/dev/null', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes',
    '-o', `UserKnownHostsFile=${join(connection.sshDir, 'known_hosts')}`,
    '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=6', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2'];
  // An explicit identity disables OpenSSH's default ~/.ssh identity search, even when absent.
  const keys = ['id_ed25519', 'id_rsa'].map((name) => join(connection.sshDir, name));
  for (const path of keys.filter(existsSync)) args.push('-i', path);
  if (!keys.some(existsSync)) args.push('-o', 'IdentityFile=none');
  if (host.port) args.push('-p', host.port);
  return [...args, host.target];
}

export function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }
