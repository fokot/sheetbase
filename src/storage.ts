import { asError, SheetbaseError, type Storage, type StoredTable } from './types.js';
const locks = new Map<string, Promise<unknown>>();
async function memoryLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const work = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(task); locks.set(name, work);
  try { return await work; } finally { if (locks.get(name) === work) locks.delete(name); }
}
export function createMemoryStorage(): Storage {
  const records = new Map<string, StoredTable>(), listeners = new Set<(key: string) => void>(), lockId = crypto.randomUUID();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    kind: 'memory',
    async list() { return structuredClone([...records.values()]); },
    async read(key) { return structuredClone(records.get(key) ?? null); },
    update(key, change) {
      const work = tail.catch(() => {}).then(() => { const old = records.get(key); const record = structuredClone({ ...change(structuredClone(old ?? null)), revision: (old?.revision ?? 0) + 1 }); records.set(key, record); for (const listener of listeners) { try { listener(key); } catch { /* Save already committed. */ } } return structuredClone(record); });
      tail = work; return work;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    withLock: (name, task) => memoryLock(`${lockId}:${name}`, task),
    close() { listeners.clear(); },
  };
}
export function createIndexedDBStorage(name = 'sheetbase'): Storage {
  let opening: Promise<IDBDatabase> | null = null, closed = false, channel: BroadcastChannel | null = null;
  const listeners = new Set<(key: string) => void>();
  const notify = (key: string, broadcast = true) => { for (const listener of listeners) { try { listener(key); } catch { /* Isolate consumers. */ } } if (broadcast) { try { channel?.postMessage(key); } catch { /* Notifications are optional. */ } } };
  try { if (typeof BroadcastChannel !== 'undefined') { channel = new BroadcastChannel(`${name}:changes`); channel.onmessage = (event) => { if (typeof event.data === 'string') notify(event.data, false); }; } } catch { /* Storage still works without broadcasts. */ }
  const database = (): Promise<IDBDatabase> => {
    if (closed) return Promise.reject(new SheetbaseError('closed', 'Storage is closed.'));
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new SheetbaseError('storage', 'IndexedDB is unavailable.')); return; }
      const request = indexedDB.open(name, 2);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('tables')) request.result.createObjectStore('tables', { keyPath: 'key' }); if (!request.result.objectStoreNames.contains('leases')) request.result.createObjectStore('leases', { keyPath: 'key' }); };
      request.onerror = () => reject(new SheetbaseError('storage', 'Cannot open local storage.'));
      request.onblocked = () => reject(new SheetbaseError('storage', 'Close older tabs before upgrading storage.'));
      request.onsuccess = () => { const db = request.result; if (closed) { db.close(); reject(new SheetbaseError('closed', 'Storage is closed.')); return; } db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    }).catch((error: unknown) => { opening = null; throw error; });
    return opening;
  };
  const lease = async (key: string, owner: string, action: 'acquire' | 'renew' | 'release'): Promise<boolean> => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('leases', 'readwrite'), store = transaction.objectStore('leases'); let acquired = false;
      const request = store.get(key);
      request.onsuccess = () => {
        const current = request.result as { owner: string; expires: number } | undefined;
        if (action === 'release') { if (current?.owner === owner) store.delete(key); return; }
        if (action === 'acquire' ? !current || current.expires <= Date.now() || current.owner === owner : current?.owner === owner && current.expires > Date.now()) {
          acquired = true; store.put({ key, owner, expires: Date.now() + 90000 });
        }
      };
      transaction.oncomplete = () => resolve(acquired);
      transaction.onabort = transaction.onerror = () => reject(new SheetbaseError('storage', 'Cannot coordinate local synchronization.'));
    });
  };
  return {
    kind: 'indexeddb',
    async list() {
      const db = await database();
      return new Promise((resolve, reject) => { const request = db.transaction('tables').objectStore('tables').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(asError(request.error, 'storage')); });
    },
    async read(key) {
      const db = await database();
      return new Promise((resolve, reject) => { const request = db.transaction('tables').objectStore('tables').get(key); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(asError(request.error, 'storage')); });
    },
    async update(key, change) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('tables', 'readwrite'), store = transaction.objectStore('tables'); let result: StoredTable, failure: unknown;
        const request = store.get(key);
        request.onsuccess = () => { try { result = { ...change(request.result ?? null), revision: (request.result?.revision ?? 0) + 1 }; store.put(result); } catch (error) { failure = error; transaction.abort(); } };
        transaction.oncomplete = () => { notify(key); resolve(result); };
        transaction.onerror = transaction.onabort = () => reject(asError(failure ?? transaction.error ?? new Error('The local write failed. Check storage permissions and free space.'), 'storage'));
      });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
      if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`${name}:lock:${key}`, task);
      const owner = crypto.randomUUID();
      while (!await lease(key, owner, 'acquire')) await new Promise(resolve => setTimeout(resolve, 50));
      let valid = true;
      const renewal = setInterval(() => { void lease(key, owner, 'renew').then(renewed => { if (!renewed) valid = false; }).catch(() => { valid = false; }); }, 20000);
      try {
        const result = await task();
        if (!valid) throw new SheetbaseError('storage', 'The synchronization lease was lost. Retry to recover the saved batch.');
        return result;
      } finally { clearInterval(renewal); await lease(key, owner, 'release').catch(() => {}); }
    },
    close() { closed = true; void opening?.then((db) => db.close()).catch(() => {}); channel?.close(); listeners.clear(); },
  };
}
