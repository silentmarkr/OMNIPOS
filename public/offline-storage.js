/* OmniPOS offline storage: IndexedDB-backed queue and large-cache mirror. */
(function () {
    'use strict';
    const DB_NAME = 'omnipos-offline-v2';
    const DB_VERSION = 1;
    const QUEUE_STORE = 'transactionQueue';
    const CACHE_STORE = 'largeCache';
    let dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not available.'));
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(QUEUE_STORE)) {
                    const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'localQueueId' });
                    store.createIndex('queueUserKey', 'queueUserKey', { unique: false });
                }
                if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Unable to open offline database.'));
        }).catch(err => { dbPromise = null; throw err; });
        return dbPromise;
    }

    function transaction(storeName, mode, operation) {
        return openDb().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            let result;
            try { result = operation(store); } catch (e) { reject(e); return; }
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
        }));
    }

    function makeQueueId(item) {
        return item.localQueueId || item.transaction?.syncId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    async function migrateLegacyQueue() {
        let legacy = [];
        try { legacy = JSON.parse(localStorage.getItem('offline_transactions') || '[]'); } catch (e) { legacy = []; }
        if (!Array.isArray(legacy) || !legacy.length) return;
        const deviceId = localStorage.getItem('omnipos_offline_device_id') || '';
        const now = new Date().toISOString();
        const remaining = [];
        for (let index = 0; index < legacy.length; index += 1) {
            const item = legacy[index];
            if (!item?.transaction) {
                remaining.push(item);
                continue;
            }
            const username = String(item.username || item.transaction.cashier || '').trim().toLowerCase();
            if (!username) {
                remaining.push(item);
                continue;
            }
            const migrated = {
                ...item,
                version: 2,
                queueUserKey: `${deviceId}::${username}`,
                localQueueId: item.localQueueId || item.transaction.syncId || item.transaction.id,
                queuedAt: item.queuedAt || now,
                status: 'pending',
                attempts: Number(item.attempts) || 0
            };
            try {
                await enqueue(migrated);
            } catch (e) {
                remaining.push(item);
                remaining.push(...legacy.slice(index + 1));
                break;
            }
        }
        try {
            if (remaining.length) localStorage.setItem('offline_transactions', JSON.stringify(remaining));
            else localStorage.removeItem('offline_transactions');
        } catch (e) {}
    }

    async function getQueue(queueUserKey) {
        try {
            const db = await openDb();
            const items = await new Promise((resolve, reject) => {
                const tx = db.transaction(QUEUE_STORE, 'readonly');
                const index = tx.objectStore(QUEUE_STORE).index('queueUserKey');
                const req = index.getAll(queueUserKey);
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => reject(req.error);
            });
            return items.sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')));
        } catch (e) {
            try {
                const raw = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
                return Array.isArray(raw) ? raw.filter(x => x?.queueUserKey === queueUserKey) : [];
            } catch (fallbackError) { return []; }
        }
    }

    async function enqueue(item) {
        const record = { ...item, localQueueId: makeQueueId(item) };
        try {
            await transaction(QUEUE_STORE, 'readwrite', store => store.put(record));
            return record;
        } catch (e) {
            const raw = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
            const next = Array.isArray(raw) ? raw.filter(x => x.localQueueId !== record.localQueueId) : [];
            next.push(record);
            localStorage.setItem('offline_transactions', JSON.stringify(next.slice(-500)));
            return record;
        }
    }

    async function replaceQueue(queueUserKey, items) {
        try {
            const db = await openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(QUEUE_STORE, 'readwrite');
                const store = tx.objectStore(QUEUE_STORE);
                const index = store.index('queueUserKey');
                const req = index.getAllKeys(queueUserKey);
                req.onsuccess = () => {
                    for (const key of req.result || []) store.delete(key);
                    for (const item of items || []) store.put({ ...item, localQueueId: makeQueueId(item), queueUserKey });
                };
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            const raw = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
            const others = Array.isArray(raw) ? raw.filter(x => x?.queueUserKey !== queueUserKey) : [];
            localStorage.setItem('offline_transactions', JSON.stringify([...others, ...(items || [])].slice(-500)));
        }
    }

    async function updateQueueItem(queueUserKey, id, patch) {
        try {
            const db = await openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(QUEUE_STORE, 'readwrite');
                const store = tx.objectStore(QUEUE_STORE);
                const req = store.get(id);
                req.onsuccess = () => {
                    const current = req.result;
                    if (current && current.queueUserKey === queueUserKey) store.put({ ...current, ...patch });
                };
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {}
    }

    async function removeQueueItem(queueUserKey, id) {
        try {
            const db = await openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(QUEUE_STORE, 'readwrite');
                const store = tx.objectStore(QUEUE_STORE);
                const req = store.get(id);
                req.onsuccess = () => { if (req.result?.queueUserKey === queueUserKey) store.delete(id); };
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {}
    }

    async function putLargeCache(key, value) {
        try { await transaction(CACHE_STORE, 'readwrite', store => store.put({ key, value, updatedAt: Date.now() })); } catch (e) {}
    }

    async function getLargeCache(key) {
        try {
            const db = await openDb();
            return await new Promise((resolve, reject) => {
                const req = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
                req.onsuccess = () => resolve(req.result?.value ?? null);
                req.onerror = () => reject(req.error);
            });
        } catch (e) { return null; }
    }

    async function mirrorLocalCaches() {
        for (const key of ['cached_products', 'cached_transactions']) {
            try {
                const raw = localStorage.getItem(key);
                if (raw) await putLargeCache(key, JSON.parse(raw));
            } catch (e) {}
        }
    }

    async function hydrateLocalCaches() {
        // The IndexedDB mirror is the durable copy. Restore it even when localStorage still
        // contains an older value left behind by a previous quota-limited write.
        for (const key of ['cached_products', 'cached_transactions']) {
            try {
                const value = await getLargeCache(key);
                if (value !== null) localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {}
        }
    }

    window.OfflineStorage = { getQueue, enqueue, replaceQueue, updateQueueItem, removeQueueItem, putLargeCache, getLargeCache, mirrorLocalCaches, hydrateLocalCaches, migrateLegacyQueue };
    window.addEventListener('load', async () => {
        try {
            if (!localStorage.getItem('omnipos_offline_device_id')) {
                const browserCrypto = globalThis.crypto;
                const id = browserCrypto?.randomUUID ? browserCrypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                localStorage.setItem('omnipos_offline_device_id', id);
            }
            await migrateLegacyQueue();
            await hydrateLocalCaches();
            await mirrorLocalCaches();
        } catch (e) { console.warn('[OfflineStorage] initialization warning:', e); }
    });
})();
