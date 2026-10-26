import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError, setApiUserId, type AuthUser, attachPersistence, type PersistenceHandle, CortexStore, currentStore, setCortexStore, SyncClient, type SyncStatus, DOC_IDS } from '@cortex/crdt';
import { bindTimer, unbindTimer } from '@/focus/timer';

const PROFILE_KEY = 'cortex-active-user';
function remembered(): AuthUser | null {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    return value && typeof value.id === 'string' && typeof value.username === 'string' ? { id: value.id, username: value.username, isAdmin: value.isAdmin === true } : null;
  } catch { return null; }
}
type AuthPhase = 'loading' | 'local' | 'authed';
interface AuthCtx {
  phase: AuthPhase; user: AuthUser | null; serverReachable: boolean; syncStatus: SyncStatus;
  initialized: boolean | null; error: string | null;
  login(u: string, p: string): Promise<void>;
  register(u: string, p: string, invite?: string): Promise<void>;
  logout(): Promise<void>; refreshStatus(): Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);
export function useAuth(): AuthCtx { const ctx = useContext(Ctx); if (!ctx) throw new Error('AuthProvider missing'); return ctx; }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [serverReachable, setServerReachable] = useState(true);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('offline');
  const [error, setError] = useState<string | null>(null);
  const client = useRef<SyncClient | null>(null);
  const persistence = useRef<PersistenceHandle | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const authEpoch = useRef(0);
  const stopSync = () => { client.current?.destroy(); client.current = null; setSyncStatus('offline'); };

  const switchUser = (nextUser: AuthUser | null, absorb = false): Promise<void> => {
    const epoch = authEpoch.current;
    stopSync();
    setPhase('loading');
    setError(null);
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!mounted.current || epoch !== authEpoch.current) return;
      stopSync();
      unbindTimer();
      setApiUserId(nextUser?.id ?? null);
      const previous = currentStore();
      if (absorb && previous?.userId === 'local' && !persistence.current) persistence.current = await attachPersistence(previous);
      const id = nextUser?.id ?? 'local';
      const store = previous?.userId === id ? previous : new CortexStore(id);
      const handle = store === previous && persistence.current ? persistence.current : await attachPersistence(store);
      if (!mounted.current || epoch !== authEpoch.current) { if (handle !== persistence.current) await handle.destroy(); return; }
      if (absorb && previous?.userId === 'local' && nextUser) {
        store.absorbLocal(previous);
        await handle.flush();
        previous.consumeLocal(nextUser.id);
        await persistence.current?.flush();
      }
      if (!mounted.current || epoch !== authEpoch.current) { if (handle !== persistence.current) await handle.destroy(); return; }
      if (handle !== persistence.current) await persistence.current?.destroy();
      if (!mounted.current || epoch !== authEpoch.current) { if (handle !== persistence.current) await handle.destroy(); persistence.current = null; return; }
      persistence.current = handle;
      setCortexStore(store);
      bindTimer(store);
      setUser(nextUser);
      setPhase(nextUser ? 'authed' : 'local');
      try {
        if (nextUser) localStorage.setItem(PROFILE_KEY, JSON.stringify(nextUser));
        else localStorage.removeItem(PROFILE_KEY);
      } catch { /* the active in-memory account is still valid */ }
      if (nextUser) {
        const sync = new SyncClient(async () => {
          const active = () => mounted.current && epoch === authEpoch.current && client.current === sync;
          try {
            if (!active()) return null;
            const registered = await api.servers();
            if (!active()) return null;
            // Move legacy credentials into this account's vault before publishing root updates.
            const legacy = store.getData().settings.servers;
            for (const server of legacy) if (server.registered === undefined && !registered.some((item) => item.id === server.id)) {
              if (!active()) return null;
              registered.push(await api.saveServer(server.id, { name: server.name, host: server.host, password: server.password }));
              if (!active()) return null;
            }
            const metadata = [...registered, ...legacy.filter((server) => !registered.some((item) => item.id === server.id)).map(({ password: _password, ...server }) => ({ ...server, registered: false }))];
            if (JSON.stringify(legacy) !== JSON.stringify(metadata)) store.updateSettings({ servers: metadata });
            return await api.ticket(nextUser.id);
          }
          catch (failure) {
            if (active() && failure instanceof ApiError && failure.status === 409) {
              sync.destroy();
              void reconcile();
            }
            return null;
          }
        });
        sync.onStatus(setSyncStatus);
        for (const docId of DOC_IDS) sync.register(docId, store.docs[docId]);
        client.current = sync;
        sync.start();
      }
    }).catch((failure) => { if (mounted.current) setError((failure as Error).message); throw failure; });
    return queue.current;
  };

  const refreshStatus = async () => {
    try { const status = await api.status(); setInitialized(status.initialized); setServerReachable(true); }
    catch { setServerReachable(false); }
  };
  const reconcile = async () => {
    const epoch = ++authEpoch.current;
    let me: AuthUser | null;
    try {
      me = await api.me();
      if (!mounted.current || epoch !== authEpoch.current) return;
      setServerReachable(true);
    } catch (failure) {
      if (!mounted.current || epoch !== authEpoch.current) return;
      setServerReachable(false);
      if (failure instanceof ApiError) throw failure;
      me = remembered();
    }
    await switchUser(me);
  };
  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    void reconcile().catch((failure) => setError((failure as Error).message));
    const storage = (event: StorageEvent) => {
      if (event.key !== PROFILE_KEY) return;
      stopSync(); // stop before awaiting the server or local persistence
      void reconcile().catch((failure) => setError((failure as Error).message));
    };
    window.addEventListener('storage', storage);
    return () => {
      mounted.current = false;
      window.removeEventListener('storage', storage);
      stopSync(); unbindTimer();
      void persistence.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const login = async (username: string, password: string) => { const epoch = ++authEpoch.current; stopSync(); const me = await api.login(username, password); if (epoch === authEpoch.current) await switchUser(me, true); };
  const register = async (username: string, password: string, invite?: string) => { const epoch = ++authEpoch.current; stopSync(); const me = await api.register(username, password, invite); if (epoch === authEpoch.current) await switchUser(me, true); };
  const logout = async () => {
    ++authEpoch.current;
    stopSync();
    try { await api.logout(); } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) { await reconcile(); return; }
      // Offline logout clears the local active identity; its documents remain in its namespace.
    }
    await switchUser(null);
    await refreshStatus();
  };
  return <Ctx.Provider value={{ phase, user, serverReachable, syncStatus, initialized, error, login, register, logout, refreshStatus }}>{children}</Ctx.Provider>;
}
export function useStore(): CortexStore { const store = currentStore(); if (!store) throw new Error('CortexStore not initialized'); return store; }
