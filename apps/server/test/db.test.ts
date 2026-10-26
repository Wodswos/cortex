import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { DB } from '../src/db';

let dir: string;
let db: DB;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cortex-test-'));
  db = new DB(dir);
});

describe('DB', () => {
  it('用户 CRUD + 首用户为管理员', () => {
    expect(db.countUsers()).toBe(0);
    const u1 = db.createUser('alice', 'h1', 's1', true);
    expect(u1.is_admin).toBe(1);
    const u2 = db.createUser('bob', 'h2', 's2', false);
    expect(u2.is_admin).toBe(0);
    expect(db.getUserByUsername('alice')!.id).toBe(u1.id);
    expect(db.countUsers()).toBe(2);
  });

  it('会话签发与过期', () => {
    const u = db.getUserByUsername('alice')!;
    const token = db.createSession(u.id, 60_000);
    expect(db.getSession(token)!.user_id).toBe(u.id);
    db.deleteSession(token);
    expect(db.getSession(token)).toBeNull();
    // 过期会话被清
    const t2 = db.createSession(u.id, -1);
    expect(db.getSession(t2)).toBeNull();
  });

  it('邀请码:创建/使用/撤销', () => {
    const admin = db.getUserByUsername('alice')!;
    const inv = db.createInvite(admin.id);
    expect(db.getInvite(inv.code)!.revoked).toBe(0);
    db.markInviteUsed(inv.code, 'user-x');
    expect(db.getInvite(inv.code)!.used_by).toBe('user-x');
    db.revokeInvite(inv.code);
    expect(db.getInvite(inv.code)!.revoked).toBe(1);
  });

  it('Yjs 快照存取 roundtrip', () => {
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    db.saveDocSnapshot('alice', 'tasks', blob);
    const loaded = db.loadDocSnapshot('alice', 'tasks');
    expect(Array.from(loaded ?? [])).toEqual([1, 2, 3, 4, 5]);
    db.saveDocSnapshot('alice', 'tasks', new Uint8Array([9]));
    expect(db.loadDocSnapshot('alice', 'tasks')!.length).toBe(1);
  });

  it('scrypt 口令哈希可验证', () => {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync('secret123', salt, 64).toString('hex');
    const ok = timingSafeEqual(scryptSync('secret123', salt, 64), Buffer.from(hash, 'hex'));
    expect(ok).toBe(true);
    const bad = timingSafeEqual(scryptSync('wrong', salt, 64), Buffer.from(hash, 'hex'));
    expect(bad).toBe(false);
  });

  it('并发同名用户唯一约束', () => {
    expect(() => db.createUser('alice', 'x', 'y', false)).toThrow();
  });
});

process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* tmp 自动清理 */
  }
});
