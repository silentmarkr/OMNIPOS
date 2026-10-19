/* OmniPOS offline storage: IndexedDB-backed queue and large-cache mirror. */
(function () {
    'use strict';
    const DB_NAME = 'omnipos-offline-v2';
    const DB_VERSION = 2;
    const QUEUE_STORE = 'transactionQueue';
    const CACHE_STORE = 'largeCache';
    // v2: one record per product ({ code, ver, image, images }) instead of one giant
    // 'cached_product_images' record inside largeCache.
    const IMAGE_STORE = 'productImages';
    const LEGACY_IMAGE_CACHE_KEY = 'cached_product_images';
    let dbPromise = null;

    // If another OmniPOS tab still holds the OLD (v1) database open, the v2 upgrade is
    // "blocked" until that tab closes. There is only ever ONE open request (a second one would
    // just queue behind it). Callers stop waiting after a short time so they can fall back
    // (products still load; photos are re-downloaded) instead of hanging; the single request
    // keeps waiting and later calls succeed as soon as the old tab is closed.
    const BLOCKED_UPGRADE_TIMEOUT_MS = 3000;
    let dbBlocked = false;

    function openDb() {
        if (!dbPromise) {
            dbBlocked = false;
            const opening = new Promise((resolve, reject) => {
                if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not available.'));
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(QUEUE_STORE)) {
                        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'localQueueId' });
                        store.createIndex('queueUserKey', 'queueUserKey', { unique: false });
                    }
                    if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
                    if (!db.objectStoreNames.contains(IMAGE_STORE)) {
                        const imageStore = db.createObjectStore(IMAGE_STORE, { keyPath: 'code' });
                        // Lets us read only code + ver (key cursor) without loading the HD photos.
                        imageStore.createIndex('ver', 'ver', { unique: false });
                    }
                };
                req.onblocked = () => {
                    dbBlocked = true;
                    console.warn('[OfflineStorage] Database upgrade is waiting for other OmniPOS tabs to close.');
                };
                req.onsuccess = () => {
                    dbBlocked = false;
                    const db = req.result;
                    // Let a newer version of the app (another tab) upgrade the database.
                    db.onversionchange = () => { try { db.close(); } catch (e) {} if (dbPromise === opening) dbPromise = null; };
                    resolve(db);
                };
                req.onerror = () => reject(req.error || new Error('Unable to open offline database.'));
            });
            dbPromise = opening;
            opening.catch(() => { if (dbPromise === opening) dbPromise = null; });
        }
        const pending = dbPromise;
        return new Promise((resolve, reject) => {
            let done = false;
            let timer = null;
            const check = () => {
                timer = null;
                if (done) return;
                if (dbBlocked) {
                    done = true;
                    reject(new Error('Offline database upgrade is blocked by another open OmniPOS tab.'));
                } else {
                    timer = setTimeout(check, BLOCKED_UPGRADE_TIMEOUT_MS);
                }
            };
            timer = setTimeout(check, BLOCKED_UPGRADE_TIMEOUT_MS);
            pending.then(db => {
                if (timer) { clearTimeout(timer); timer = null; }
                if (!done) { done = true; resolve(db); }
            }, err => {
                if (timer) { clearTimeout(timer); timer = null; }
                if (!done) { done = true; reject(err); }
            });
        });
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

    // Single-flight: getQueue() and the load handler can both ask for a migration at the same time.
    let legacyQueueMigration = null;
    function migrateLegacyQueue() {
        if (!legacyQueueMigration) {
            legacyQueueMigration = migrateLegacyQueueOnce().finally(() => { legacyQueueMigration = null; });
        }
        return legacyQueueMigration;
    }

    function hasLegacyQueueItems() {
        try {
            const raw = localStorage.getItem('offline_transactions');
            return !!raw && raw !== '[]';
        } catch (e) { return false; }
    }

    async function migrateLegacyQueueOnce() {
        let legacy = [];
        try { legacy = JSON.parse(localStorage.getItem('offline_transactions') || '[]'); } catch (e) { legacy = []; }
        if (!Array.isArray(legacy) || !legacy.length) return;
        const deviceId = localStorage.getItem('omnipos_offline_device_id') || '';
        const now = new Date().toISOString();
        const migratedSerialized = new Set();
        for (let index = 0; index < legacy.length; index += 1) {
            const item = legacy[index];
            if (!item?.transaction) continue;
            const username = String(item.username || item.transaction.cashier || '').trim().toLowerCase();
            if (!username) continue;
            const migrated = {
                ...item,
                version: 2,
                queueUserKey: `${deviceId}::${username}`,
                localQueueId: item.localQueueId || item.transaction.syncId || item.transaction.id,
                queuedAt: item.queuedAt || now,
                // Ang "needs-review" ay hindi dapat ibalik sa "pending" ng migration — kung hindi, uulit-ulitin ang pagpapadala
                // ng benta na tinanggihan na ng server at mawawala ang babala sa cashier/admin.
                status: item.status === 'needs-review' ? 'needs-review' : 'pending',
                attempts: Number(item.attempts) || 0
            };
            try {
                // CRITICAL FIX: gamitin ang IndexedDB-only na pag-save. Ang normal na enqueue() ay bumabagsak sa localStorage
                // (parehong 'offline_transactions' key) kapag pumalya ang IndexedDB — kaya noon, ang "migration" ay isinusulat
                // ang parehong item pabalik sa key na buburahin sa dulo (removeItem), at NAWAWALA ang mga offline na benta.
                await transaction(QUEUE_STORE, 'readwrite', store => store.put({ ...migrated, localQueueId: makeQueueId(migrated) }));
                migratedSerialized.add(JSON.stringify(item));
            } catch (e) {
                break; // IndexedDB is failing: leave this item and the rest in localStorage for the next attempt.
            }
        }
        if (!migratedSerialized.size) return;
        try {
            // Re-read localStorage NOW and drop only the items that were really moved. Anything another call
            // appended to the localStorage fallback while we were awaiting IndexedDB must not be lost.
            const current = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
            const left = Array.isArray(current) ? current.filter(x => !migratedSerialized.has(JSON.stringify(x))) : [];
            if (left.length) localStorage.setItem('offline_transactions', JSON.stringify(left));
            else localStorage.removeItem('offline_transactions');
        } catch (e) {}
    }

    async function getQueue(queueUserKey) {
        try {
            const db = await openDb();
            // Sales that were saved in the localStorage fallback while IndexedDB was unavailable (e.g. a blocked upgrade)
            // would otherwise stay invisible, and never sync, until the next page reload. Move them in now that it works.
            if (hasLegacyQueueItems()) {
                try { await migrateLegacyQueue(); } catch (e) {}
            }
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

    // Lahat ng nakapila sa device na ito, kahit sinong cashier ang may-ari (para sa Admin na magre-review ng mga benta
    // na tinanggihan ng server). Ang pag-sync ay nananatiling per-cashier: ang server mismo ang tumatanggi sa benta ng iba.
    async function getAllQueue() {
        const sortByQueuedAt = list => list.sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')));
        try {
            const db = await openDb();
            if (hasLegacyQueueItems()) {
                try { await migrateLegacyQueue(); } catch (e) {}
            }
            const items = await new Promise((resolve, reject) => {
                const req = db.transaction(QUEUE_STORE, 'readonly').objectStore(QUEUE_STORE).getAll();
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => reject(req.error);
            });
            return sortByQueuedAt(items);
        } catch (e) {
            try {
                const raw = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
                return Array.isArray(raw) ? sortByQueuedAt(raw.filter(x => x && x.queueUserKey)) : [];
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
            const next = Array.isArray(raw) ? raw.filter(x => x && x.localQueueId !== record.localQueueId) : [];
            // CRITICAL FIX: dati, ang slice(-500) ay TAHIMIK na nagtatapon ng pinakamatandang benta na hindi pa na-sync kapag
            // lumampas sa 500. Mas mabuting tanggihan ang bagong save (makikita ng cashier ang "Sale NOT Saved" at mananatili ang cart)
            // kaysa tahimik na mawala ang benta na may resibo na sa customer.
            if (next.length >= 500) throw new Error('The offline fallback queue on this device is full (500 sales). Reconnect so the queued sales can sync first.');
            next.push(record);
            localStorage.setItem('offline_transactions', JSON.stringify(next));
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
        } catch (e) {
            // Kapag nasa localStorage fallback ang item (pumalya ang IndexedDB nang i-queue), doon din dapat i-update —
            // kung hindi, hindi kailanman magbabago ang status nito at uulit-ulitin ang pag-sync.
            try {
                const raw = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
                if (Array.isArray(raw)) {
                    const next = raw.map(x => (x && x.queueUserKey === queueUserKey && (x.localQueueId || x.transaction?.syncId || x.transaction?.id) === id) ? { ...x, ...patch } : x);
                    localStorage.setItem('offline_transactions', JSON.stringify(next));
                }
            } catch (fallbackError) {}
        }
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
        } catch (e) {
            try {
                const raw = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
                if (Array.isArray(raw)) {
                    const next = raw.filter(x => !(x && x.queueUserKey === queueUserKey && (x.localQueueId || x.transaction?.syncId || x.transaction?.id) === id));
                    if (next.length) localStorage.setItem('offline_transactions', JSON.stringify(next));
                    else localStorage.removeItem('offline_transactions');
                }
            } catch (fallbackError) {}
        }
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

    // ---------------------------------------------------------------------------
    // Product photos: one record per product in the 'productImages' store.
    // ---------------------------------------------------------------------------
    let legacyImageMigration = null;

    function normalizeImageRecord(rec) {
        return {
            code: String(rec.code),
            ver: String(rec.ver ?? ''),
            image: typeof rec.image === 'string' ? rec.image : '',
            images: Array.isArray(rec.images) ? rec.images : []
        };
    }

    // Single transaction: removes first, then writes, so a code that is both removed and
    // re-added in the same call always ends up saved. All-or-nothing.
    function writeProductImages(records, removeCodes) {
        return openDb().then(db => new Promise((resolve, reject) => {
            let tx;
            try { tx = db.transaction(IMAGE_STORE, 'readwrite'); } catch (e) { reject(e); return; }
            const store = tx.objectStore(IMAGE_STORE);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('Unable to save product photos.'));
            tx.onabort = () => reject(tx.error || new Error('Saving product photos was aborted.'));
            try {
                for (const code of removeCodes || []) store.delete(String(code));
                for (const rec of records || []) store.put(normalizeImageRecord(rec));
            } catch (e) {
                try { tx.abort(); } catch (_) {}
                reject(e);
            }
        }));
    }

    // One-time move from the old single 'cached_product_images' record. Every product-photo
    // API waits for this, so nothing can be overwritten by stale legacy data. The photos are
    // only a cache (the server is the source of truth), so the legacy record is removed even
    // if copying fails; otherwise every startup would re-read the huge record.
    function migrateLegacyProductImages() {
        if (legacyImageMigration) return legacyImageMigration;
        legacyImageMigration = (async () => {
            let legacy = null;
            try { legacy = await getLargeCache(LEGACY_IMAGE_CACHE_KEY); } catch (e) { legacy = null; }
            if (legacy === null || legacy === undefined) return;
            try {
                const records = [];
                if (typeof legacy === 'object') {
                    for (const [code, value] of Object.entries(legacy)) {
                        if (!value || typeof value !== 'object') continue;
                        records.push({ code, ver: value.ver, image: value.image, images: value.images });
                    }
                }
                for (let i = 0; i < records.length; i += 50) {
                    await writeProductImages(records.slice(i, i + 50), []);
                }
            } catch (e) {
                console.warn('[OfflineStorage] Could not fully migrate cached product photos; they will be re-downloaded.', e);
            }
            try {
                await transaction(CACHE_STORE, 'readwrite', store => store.delete(LEGACY_IMAGE_CACHE_KEY));
            } catch (e) {
                console.warn('[OfflineStorage] Could not remove the legacy product photo cache.', e);
            }
        })();
        return legacyImageMigration;
    }

    // Returns Map(code -> ver) using a key cursor on the 'ver' index, so the HD photos
    // themselves are NOT loaded. Never rejects; on any problem it returns what it has.
    async function getProductImageVersions() {
        const out = new Map();
        try {
            // Open first: if the database is blocked this fails once (fast) instead of twice.
            const db = await openDb();
            await migrateLegacyProductImages();
            await new Promise(resolve => {
                let tx;
                try { tx = db.transaction(IMAGE_STORE, 'readonly'); } catch (e) { resolve(); return; }
                const req = tx.objectStore(IMAGE_STORE).index('ver').openKeyCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (!cursor) return;
                    out.set(String(cursor.primaryKey), String(cursor.key));
                    cursor.continue();
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
                tx.onabort = () => resolve();
            });
        } catch (e) {}
        return out;
    }

    // Returns Map(code -> { code, ver, image, images }) for the codes that were found.
    // Never rejects; a missing code simply is not in the map.
    async function getProductImages(codes) {
        const out = new Map();
        try {
            const db = await openDb();
            await migrateLegacyProductImages();
            await new Promise(resolve => {
                let tx;
                try { tx = db.transaction(IMAGE_STORE, 'readonly'); } catch (e) { resolve(); return; }
                const store = tx.objectStore(IMAGE_STORE);
                for (const code of codes || []) {
                    const key = String(code);
                    const req = store.get(key);
                    req.onsuccess = () => { if (req.result) out.set(key, req.result); };
                }
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
                tx.onabort = () => resolve();
            });
        } catch (e) {}
        return out;
    }

    // Writes only the given records and removes the given codes, in ONE transaction.
    // Rejects if the write fails (e.g. quota) so the caller can retry later.
    async function putProductImages(records, removeCodes) {
        await openDb();
        await migrateLegacyProductImages();
        return writeProductImages(records, removeCodes);
    }

    let persistentStorageRequested = false;
    function requestPersistentStorage() {
        if (persistentStorageRequested) return;
        persistentStorageRequested = true;
        try {
            const manager = navigator.storage;
            if (!manager || typeof manager.persist !== 'function') return;
            const ask = () => { try { Promise.resolve(manager.persist()).catch(() => {}); } catch (e) {} };
            if (typeof manager.persisted === 'function') {
                Promise.resolve(manager.persisted()).then(already => { if (!already) ask(); }).catch(() => {});
            } else {
                ask();
            }
        } catch (e) {}
    }

    window.OfflineStorage = { getQueue, getAllQueue, enqueue, replaceQueue, updateQueueItem, removeQueueItem, putLargeCache, getLargeCache, mirrorLocalCaches, hydrateLocalCaches, migrateLegacyQueue, getProductImageVersions, getProductImages, putProductImages };
    window.addEventListener('load', async () => {
        try {
            if (!localStorage.getItem('omnipos_offline_device_id')) {
                const browserCrypto = globalThis.crypto;
                const id = browserCrypto?.randomUUID ? browserCrypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                localStorage.setItem('omnipos_offline_device_id', id);
            }
            requestPersistentStorage();
            await migrateLegacyQueue();
            await hydrateLocalCaches();
            await mirrorLocalCaches();
        } catch (e) { console.warn('[OfflineStorage] initialization warning:', e); }
    });
})();
