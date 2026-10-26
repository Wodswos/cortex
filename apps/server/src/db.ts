import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SQLite 存储:账号 / 会话 / 邀请码 / Yjs 文档快照。
 * node:sqlite 零原生依赖(node ≥ 22.5),Docker alpine 免编译。
 */
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  is_admin: number;
  created_at: number;
}

export interface InviteRow {
  code: string;
  created_by: string;
  used_by: string | null;
  revoked: number;
  created_at: number;
}

export interface SessionRow {
  token: string;
  user_id: string;
  expires_at: number;
}

export interface ServerRow {
  id: string;
  user_id: string;
  name: string;
  host: string;
  password_cipher: string | null;
}

export class DB {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'cortex.db'));
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        created_by TEXT NOT NULL,
        used_by TEXT,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS docs (
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        snapshot BLOB,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, name)
      );
      CREATE TABLE IF NOT EXISTS servers (
        user_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        password_cipher TEXT,
        PRIMARY KEY (user_id, id)
      );
    `);
  }

  // users
  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }
  getUserByUsername(username: string): UserRow | null {
    return (this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as unknown as UserRow) ?? null;
  }
  getUser(id: string): UserRow | null {
    return (this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow) ?? null;
  }
  createUser(username: string, passwordHash: string, salt: string, isAdmin: boolean): UserRow {
    const id = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO users (id, username, password_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, username, passwordHash, salt, isAdmin ? 1 : 0, Date.now());
    return this.getUser(id)!;
  }

  registerUser(username: string, hash: string, salt: string, inviteCode?: string): UserRow {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.getUserByUsername(username)) throw new Error('用户名已存在');
      const first = this.countUsers() === 0;
      if (!first) {
        const invite = inviteCode ? this.getInvite(inviteCode) : null;
        if (!invite || invite.revoked || invite.used_by) throw new Error('邀请码无效');
      }
      const user = this.createUser(username, hash, salt, first);
      if (!first) this.markInviteUsed(inviteCode!, user.id);
      this.db.exec('COMMIT');
      return user;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listServers(userId: string): ServerRow[] {
    return this.db.prepare('SELECT * FROM servers WHERE user_id = ? ORDER BY name, id').all(userId) as unknown as ServerRow[];
  }
  getServer(userId: string, id: string): ServerRow | null {
    return this.db.prepare('SELECT * FROM servers WHERE user_id = ? AND id = ?').get(userId, id) as unknown as ServerRow ?? null;
  }
  saveServer(server: ServerRow): void {
    this.db.prepare(`INSERT INTO servers (user_id, id, name, host, password_cipher) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, id) DO UPDATE SET name=excluded.name, host=excluded.host, password_cipher=excluded.password_cipher`)
      .run(server.user_id, server.id, server.name, server.host, server.password_cipher);
  }
  deleteServer(userId: string, id: string): void {
    this.db.prepare('DELETE FROM servers WHERE user_id = ? AND id = ?').run(userId, id);
  }
  close(): void { this.db.close(); }

  // sessions
  createSession(userId: string, ttlMs = 180 * 86400_000): string {
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    this.db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + ttlMs);
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    return token;
  }
  getSession(token: string): SessionRow | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as SessionRow | undefined;
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    return row;
  }
  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // invites
  createInvite(createdBy: string): InviteRow {
    const code = crypto.randomUUID().replace(/-/g, '');
    this.db.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)').run(code, createdBy, Date.now());
    return this.getInvite(code)!;
  }
  getInvite(code: string): InviteRow | null {
    return (this.db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as unknown as InviteRow) ?? null;
  }
  listInvites(): InviteRow[] {
    return this.db.prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT 50').all() as unknown as InviteRow[];
  }
  markInviteUsed(code: string, userId: string): void {
    this.db.prepare('UPDATE invites SET used_by = ? WHERE code = ?').run(userId, code);
  }
  revokeInvite(code: string): void {
    this.db.prepare('UPDATE invites SET revoked = 1 WHERE code = ?').run(code);
  }

  // docs
  loadDocSnapshot(userId: string, name: string): Uint8Array | null {
    const row = this.db.prepare('SELECT snapshot FROM docs WHERE user_id = ? AND name = ?').get(userId, name) as { snapshot: Uint8Array | null } | undefined;
    return row?.snapshot ?? null;
  }
  saveDocSnapshot(userId: string, name: string, snapshot: Uint8Array): void {
    this.db
      .prepare(
        `INSERT INTO docs (user_id, name, snapshot, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, name) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
      )
      .run(userId, name, snapshot, Date.now());
  }
}
