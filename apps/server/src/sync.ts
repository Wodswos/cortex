import type { ServerType } from '@hono/node-server';
import type { Duplex } from 'node:stream';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { WebSocketServer, WebSocket } from 'ws';
import { DB } from './db';
import { decodeFrame, encodeFrame } from '../../../packages/crdt/src/framing';
import { socketOriginAllowed, upgradeUrl, type WsIdentity } from './security';

export const DOC_NAMES = ['root', 'tasks', 'events', 'links', 'sessions', 'habits', 'habitLogs'] as const;
interface Room { doc: Y.Doc; conns: Set<WebSocket>; dirty: boolean }

export function setupSync(server: ServerType, db: DB, verifyTicket: (ticket: string) => WsIdentity | null) {
  const rooms = new Map<string, Room>();
  const identities = new Map<WebSocket, WsIdentity>();
  const alive = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  server.on('upgrade', (req, socket: Duplex, head) => {
    const url = upgradeUrl(req.url);
    if (url?.pathname !== '/api/sync') return;
    const deny = (status: string) => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (!socketOriginAllowed(req.headers)) return deny('403 Forbidden');
    const identity = verifyTicket(url.searchParams.get('ticket') ?? '');
    if (!identity) return deny('401 Unauthorized');
    if (identities.size >= 128 || [...identities.values()].filter((value) => value.userId === identity.userId).length >= 16) return deny('429 Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => {
      identities.set(ws, identity);
      alive.add(ws);
      ws.on('pong', () => alive.add(ws));
      ws.binaryType = 'arraybuffer';
      const joined = new Set<string>();
      ws.on('error', () => { ws.terminate(); });
      ws.on('message', (data, binary) => {
        if (!binary) return ws.close(1003, 'binary protocol required');
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as Buffer);
        const frame = decodeFrame(bytes);
        if (!frame || !(DOC_NAMES as readonly string[]).includes(frame.docId)) return ws.close(1008, 'invalid document');
        const { docId, payload } = frame;
        const key = `${identity.userId}:${docId}`;
        try {
          let room = rooms.get(key);
          if (!room) {
            const doc = new Y.Doc();
            const snapshot = db.loadDocSnapshot(identity.userId, docId);
            if (snapshot?.length) Y.applyUpdate(doc, snapshot);
            const created: Room = { doc, conns: new Set(), dirty: false };
            doc.on('update', (update: Uint8Array, origin: unknown) => {
              created.dirty = true;
              const message = encodeFrame(docId, writeUpdate(update));
              for (const peer of created.conns) if (peer !== origin && peer.readyState === WebSocket.OPEN) {
                if (peer.bufferedAmount > 8 * 1024 * 1024) peer.close(1013, 'slow client');
                else peer.send(message);
              }
            });
            room = created;
            rooms.set(key, room);
          }
          if (!room.conns.has(ws)) {
            room.conns.add(ws);
            joined.add(key);
            ws.send(encodeFrame(docId, writeSyncStep1(room.doc)));
          }
          const reply = encoding.createEncoder();
          syncProtocol.readSyncMessage(decoding.createDecoder(payload), reply, room.doc, ws);
          const bytes = encoding.toUint8Array(reply);
          if (bytes.length > 1) ws.send(encodeFrame(docId, bytes));
        } catch {
          ws.close(1007, 'invalid sync payload');
        }
      });
      ws.on('close', () => {
        identities.delete(ws);
        alive.delete(ws);
        for (const key of joined) {
          const room = rooms.get(key);
          if (!room) continue;
          room.conns.delete(ws);
          if (!room.conns.size) { flush(key, room); room.doc.destroy(); rooms.delete(key); }
        }
      });
    });
  });
  function flush(key: string, room: Room) {
    if (!room.dirty) return;
    const [userId, docId] = key.split(':');
    db.saveDocSnapshot(userId!, docId!, Y.encodeStateAsUpdate(room.doc));
    room.dirty = false;
  }
  const timer = setInterval(() => { for (const [key, room] of rooms) flush(key, room); }, 5000);
  timer.unref();
  const heartbeat = setInterval(() => {
    for (const [ws, identity] of identities) {
      if (!alive.has(ws) || db.getSession(identity.sessionToken)?.user_id !== identity.userId) ws.terminate();
      else { alive.delete(ws); ws.ping(); }
    }
  }, 30000);
  heartbeat.unref();
  return {
    snapshots(userId: string) {
      return Object.fromEntries(DOC_NAMES.map((name) => {
        const room = rooms.get(`${userId}:${name}`);
        const update = room ? Y.encodeStateAsUpdate(room.doc) : db.loadDocSnapshot(userId, name);
        return [name, update?.length ? Buffer.from(update).toString('base64') : ''];
      }));
    },
    disconnectSession(token: string) { for (const [ws, identity] of identities) if (identity.sessionToken === token) ws.close(1008, 'session ended'); },
    close() {
      clearInterval(timer); clearInterval(heartbeat);
      for (const [key, room] of rooms) flush(key, room);
      for (const ws of identities.keys()) ws.close(1001, 'server shutdown');
      wss.close();
    },
  };
}
function writeSyncStep1(doc: Y.Doc): Uint8Array { const enc = encoding.createEncoder(); syncProtocol.writeSyncStep1(enc, doc); return encoding.toUint8Array(enc); }
function writeUpdate(update: Uint8Array): Uint8Array { const enc = encoding.createEncoder(); syncProtocol.writeUpdate(enc, update); return encoding.toUint8Array(enc); }
