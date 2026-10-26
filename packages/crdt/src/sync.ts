import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { encodeFrame, decodeFrame } from './framing';
import type { DocId } from './store';

export type SyncStatus = 'offline' | 'connecting' | 'online';

const REMOTE = Symbol('remote');

function writeSyncStep1(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  syncProtocol.writeSyncStep1(enc, doc);
  return encoding.toUint8Array(enc);
}

function writeUpdate(update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  syncProtocol.writeUpdate(enc, update);
  return encoding.toUint8Array(enc);
}

/**
 * 单 WebSocket 同步客户端:所有 doc 多路复用一条连接;
 * 断线指数退避重连,恢复后重新握手(state vector 差量补齐,离线写入自动合并)。
 */
export class SyncClient {
  private ws: WebSocket | null = null;
  private registered = new Map<DocId, Y.Doc>();
  private unsubs = new Map<DocId, () => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private statusListeners = new Set<(s: SyncStatus) => void>();
  private _status: SyncStatus = 'offline';
  private generation = 0;

  constructor(
    private getTicket: () => Promise<string | null>,
    private url: string = SyncClient.defaultUrl(),
  ) {}

  static defaultUrl(): string {
    const loc = (globalThis as { location?: { protocol: string; host: string } }).location;
    if (!loc) return 'ws://localhost:30090/api/sync';
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}/api/sync`;
  }

  get status(): SyncStatus {
    return this._status;
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: SyncStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  register(docId: DocId, doc: Y.Doc): void {
    if (this.registered.has(docId)) return;
    this.registered.set(docId, doc);
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return; // 远端来的不再回传
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeFrame(docId, writeUpdate(update)));
    };
    doc.on('update', handler);
    this.unsubs.set(docId, () => doc.off('update', handler));
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeFrame(docId, writeSyncStep1(doc)));
  }

  start(): void {
    if (this.ws || this._status === 'connecting') return;
    this.closedByUser = false;
    void this.connect();
  }

  stop(): void {
    this.closedByUser = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.timer = null;
    this.setStatus('offline');
  }

  destroy(): void {
    this.stop();
    for (const unsubscribe of this.unsubs.values()) unsubscribe();
    this.unsubs.clear();
    this.registered.clear();
    this.statusListeners.clear();
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    const delay = Math.min(1000 * 2 ** this.retry, 30000);
    this.retry++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, delay);
  }

  private async connect(): Promise<void> {
    if (this.closedByUser) return;
    if (typeof WebSocket === 'undefined') return; // 测试环境
    this.setStatus('connecting');
    const generation = ++this.generation;
    let ticket: string | null = null;
    try {
      ticket = await this.getTicket();
    } catch {
      if (this.closedByUser || generation !== this.generation) return;
      this.setStatus('offline');
      this.scheduleReconnect();
      return;
    }
    if (this.closedByUser || generation !== this.generation) return;
    if (!ticket) {
      this.setStatus('offline');
      this.scheduleReconnect();
      return;
    }
    const ws = new WebSocket(`${this.url}?ticket=${encodeURIComponent(ticket)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      if (this.closedByUser || generation !== this.generation) { ws.close(); return; }
      this.retry = 0;
      this.setStatus('online');
      for (const [docId, doc] of this.registered) {
        ws.send(encodeFrame(docId, writeSyncStep1(doc)));
      }
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.closedByUser || generation !== this.generation) return;
      const data =
        ev.data instanceof ArrayBuffer
          ? new Uint8Array(ev.data)
          : (ev.data as Uint8Array);
      const frame = decodeFrame(data);
      if (!frame) return;
      const doc = this.registered.get(frame.docId as DocId);
      if (!doc) return;
      const dec = decoding.createDecoder(frame.payload);
      const reply = encoding.createEncoder();
      try {
        syncProtocol.readSyncMessage(dec, reply, doc, REMOTE);
      } catch (e) {
        console.error('[sync] read error', frame.docId, e);
      }
      const replyBytes = encoding.toUint8Array(reply);
      if (replyBytes.length > 1 && ws.readyState === WebSocket.OPEN) {
        ws.send(encodeFrame(frame.docId, replyBytes));
      }
    };
    ws.onclose = () => {
      if (this.closedByUser || generation !== this.generation) return;
      if (this.ws === ws) this.ws = null;
      this.setStatus('offline');
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose 会跟随 */
    };
  }
}
