/**
 * 单 WebSocket 多路复用帧: [1B idLen][id utf8][y-protocols payload]
 * 同一实现用于客户端与服务器。
 */
export const MAX_ID_LEN = 32;

export function encodeFrame(docId: string, payload: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode(docId);
  if (id.length > MAX_ID_LEN) throw new Error('docId too long');
  const out = new Uint8Array(1 + id.length + payload.length);
  out[0] = id.length;
  out.set(id, 1);
  out.set(payload, 1 + id.length);
  return out;
}

export function decodeFrame(data: Uint8Array): { docId: string; payload: Uint8Array } | null {
  if (data.length < 2) return null;
  const idLen = data[0]!;
  if (idLen < 1 || idLen > MAX_ID_LEN || idLen + 1 >= data.length) return null;
  const docId = new TextDecoder().decode(data.subarray(1, 1 + idLen));
  const payload = data.subarray(1 + idLen);
  return { docId, payload };
}
