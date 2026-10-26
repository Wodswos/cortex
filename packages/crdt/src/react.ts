import { useSyncExternalStore } from 'react';
import { CortexData, EMPTY_DATA } from '@cortex/core';
import { CortexStore, DOC_IDS } from './store';

/**
 * 全局单例 store(按 userId 切换重建)。
 * - 未登录:userId = 'local'(纯本地模式)
 * - 登录后:userId = 账号 id,本地数据由 absorbLocal 迁入
 */

let current: CortexStore | null = null;
const storeListeners = new Set<() => void>();

export function currentStore(): CortexStore | null {
  return current;
}

export function setCortexUser(userId: string): CortexStore {
  if (current?.userId === userId) return current;
  return setCortexStore(new CortexStore(userId));
}

export function setCortexStore(store: CortexStore): CortexStore {
  if (current === store) return store;
  current?.destroy();
  current = store;
  for (const fn of storeListeners) fn();
  return current;
}

function subscribeStore(fn: () => void): () => void {
  storeListeners.add(fn);
  return () => storeListeners.delete(fn);
}

export function useCortex(): CortexStore {
  const store = useSyncExternalStore(subscribeStore, () => current);
  if (!store) throw new Error('CortexStore not initialized — call setCortexUser first');
  return store;
}

export function useCortexData(): CortexData {
  const store = useCortex();
  return useSyncExternalStore(store.subscribe, store.getData);
}

/** 浏览器端:每个 doc 挂 y-indexeddb 持久化;返回清理函数 */
export interface PersistenceHandle { destroy(): Promise<void>; flush(): Promise<void> }
export async function attachPersistence(store: CortexStore): Promise<PersistenceHandle> {
  if (!(globalThis as { indexedDB?: unknown }).indexedDB) return { async destroy() {}, async flush() {} };
  const { IndexeddbPersistence } = await import('y-indexeddb');
  const providers = DOC_IDS.map(
    (id) => new IndexeddbPersistence(`cortex:${store.userId}:${id}`, store.docs[id]),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(providers.map((provider) => provider.whenSynced)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('本地数据库读取超时,请重试')), 15000); }),
    ]);
  } catch (error) { await Promise.all(providers.map((provider) => provider.destroy())); throw error; }
  finally { clearTimeout(timer); }
  const handle: PersistenceHandle = {
    async destroy() {
      if (store.flushPersistence === handle.flush) store.flushPersistence = async () => {};
      await Promise.all(providers.map((provider) => provider.destroy()));
    },
    async flush() {
      await Promise.all(providers.map((provider) => new Promise<void>((resolve, reject) => {
        if (!provider.db) { reject(new Error('本地数据库未就绪')); return; }
        const transaction = provider.db.transaction('updates', 'readwrite');
        // This transaction runs after every update already queued by y-indexeddb.
        transaction.objectStore('updates').count();
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('本地数据库保存失败'));
      })));
    },
  };
  store.flushPersistence = handle.flush;
  return handle;
}

export { EMPTY_DATA };
