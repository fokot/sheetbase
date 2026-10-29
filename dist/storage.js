import { asError, SheetbaseError } from './types.js';
const locks = new Map();
async function memoryLock(name, task) {
    const work = (locks.get(name) ?? Promise.resolve()).catch(() => { }).then(task);
    locks.set(name, work);
    try {
        return await work;
    }
    finally {
        if (locks.get(name) === work)
            locks.delete(name);
    }
}
export function createMemoryStorage() {
    const records = new Map(), listeners = new Set(), lockId = crypto.randomUUID();
    let tail = Promise.resolve();
    return {
        kind: 'memory',
        async list() { return structuredClone([...records.values()]); },
        async read(key) { return structuredClone(records.get(key) ?? null); },
        update(key, change) {
            const work = tail.catch(() => { }).then(() => { const old = records.get(key); const record = structuredClone({ ...change(structuredClone(old ?? null)), revision: (old?.revision ?? 0) + 1 }); records.set(key, record); for (const listener of listeners) {
                try {
                    listener(key);
                }
                catch { /* Save already committed. */ }
            } return structuredClone(record); });
            tail = work;
            return work;
        },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        withLock: (name, task) => memoryLock(`${lockId}:${name}`, task),
        close() { listeners.clear(); },
    };
}
export function createIndexedDBStorage(name = 'sheetbase') {
    let opening = null, closed = false, channel = null;
    const listeners = new Set();
    const notify = (key, broadcast = true) => { for (const listener of listeners) {
        try {
            listener(key);
        }
        catch { /* Isolate consumers. */ }
    } if (broadcast) {
        try {
            channel?.postMessage(key);
        }
        catch { /* Notifications are optional. */ }
    } };
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            channel = new BroadcastChannel(`${name}:changes`);
            channel.onmessage = (event) => { if (typeof event.data === 'string')
                notify(event.data, false); };
        }
    }
    catch { /* Storage still works without broadcasts. */ }
    const database = () => {
        if (closed)
            return Promise.reject(new SheetbaseError('closed', 'Storage is closed.'));
        if (opening)
            return opening;
        opening = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new SheetbaseError('storage', 'IndexedDB is unavailable.'));
                return;
            }
            const request = indexedDB.open(name, 2);
            request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('tables'))
                request.result.createObjectStore('tables', { keyPath: 'key' }); if (!request.result.objectStoreNames.contains('leases'))
                request.result.createObjectStore('leases', { keyPath: 'key' }); };
            request.onerror = () => reject(new SheetbaseError('storage', 'Cannot open local storage.'));
            request.onblocked = () => reject(new SheetbaseError('storage', 'Close older tabs before upgrading storage.'));
            request.onsuccess = () => { const db = request.result; if (closed) {
                db.close();
                reject(new SheetbaseError('closed', 'Storage is closed.'));
                return;
            } db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
        }).catch((error) => { opening = null; throw error; });
        return opening;
    };
    const lease = async (key, owner, action) => {
        const db = await database();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('leases', 'readwrite'), store = transaction.objectStore('leases');
            let acquired = false;
            const request = store.get(key);
            request.onsuccess = () => {
                const current = request.result;
                if (action === 'release') {
                    if (current?.owner === owner)
                        store.delete(key);
                    return;
                }
                if (action === 'acquire' ? !current || current.expires <= Date.now() || current.owner === owner : current?.owner === owner && current.expires > Date.now()) {
                    acquired = true;
                    store.put({ key, owner, expires: Date.now() + 90000 });
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
                const transaction = db.transaction('tables', 'readwrite'), store = transaction.objectStore('tables');
                let result, failure;
                const request = store.get(key);
                request.onsuccess = () => { try {
                    result = { ...change(request.result ?? null), revision: (request.result?.revision ?? 0) + 1 };
                    store.put(result);
                }
                catch (error) {
                    failure = error;
                    transaction.abort();
                } };
                transaction.oncomplete = () => { notify(key); resolve(result); };
                transaction.onerror = transaction.onabort = () => reject(asError(failure ?? transaction.error ?? new Error('The local write failed. Check storage permissions and free space.'), 'storage'));
            });
        },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async withLock(key, task) {
            if (typeof navigator !== 'undefined' && navigator.locks)
                return navigator.locks.request(`${name}:lock:${key}`, task);
            const owner = crypto.randomUUID();
            while (!await lease(key, owner, 'acquire'))
                await new Promise(resolve => setTimeout(resolve, 50));
            let valid = true;
            const renewal = setInterval(() => { void lease(key, owner, 'renew').then(renewed => { if (!renewed)
                valid = false; }).catch(() => { valid = false; }); }, 20000);
            try {
                const result = await task();
                if (!valid)
                    throw new SheetbaseError('storage', 'The synchronization lease was lost. Retry to recover the saved batch.');
                return result;
            }
            finally {
                clearInterval(renewal);
                await lease(key, owner, 'release').catch(() => { });
            }
        },
        close() { closed = true; void opening?.then((db) => db.close()).catch(() => { }); channel?.close(); listeners.clear(); },
    };
}
//# sourceMappingURL=storage.js.map