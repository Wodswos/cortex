import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncClient } from '../src/sync';
import * as Y from 'yjs';

class Socket {
  static OPEN = 1;
  static created: Socket[] = [];
  readyState = 0; binaryType = ''; sent: unknown[] = [];
  onopen?: () => void; onclose?: () => void;
  constructor(public url: string) { Socket.created.push(this); }
  send(value: unknown) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); Socket.created = []; });
describe('sync lifecycle', () => {
  it('cannot open a socket after stop while its ticket is pending', async () => {
    vi.stubGlobal('WebSocket', Socket);
    let release!: (value: string) => void;
    const client = new SyncClient(() => new Promise((resolve) => { release = resolve; }));
    client.start(); client.stop(); release('ticket');
    await Promise.resolve();
    expect(Socket.created).toHaveLength(0);
  });
  it('ignores stale connection events and removes document listeners on destroy', async () => {
    vi.stubGlobal('WebSocket', Socket);
    const doc = new Y.Doc();
    const client = new SyncClient(async () => 'ticket'); client.register('tasks', doc);
    client.start(); await Promise.resolve();
    const first = Socket.created[0]!; client.stop(); first.open();
    expect(client.status).toBe('offline'); expect(first.sent).toHaveLength(0);
    client.start(); await Promise.resolve();
    const second = Socket.created[1]!; second.open();
    const sent = second.sent.length;
    client.destroy(); doc.getMap('items').set('new', 'value');
    expect(second.sent).toHaveLength(sent);
  });
});
