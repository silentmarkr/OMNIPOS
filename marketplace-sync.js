// PATH: OMNIPOS/marketplace-sync.js
//
// Marketplace Hub (Shopee / Lazada / TikTok Shop) — OMNIPOS (client/store) side.
//
// Ano ang ginagawa nito:
//   1. Connections  — humihingi ng OAuth URL sa RELAY; ang tokens/secrets ay nasa RELAY lang.
//   2. Product links — ine-map ang marketplace listing (item+model/SKU) sa POS product code.
//   3. Order import — hinihila ang orders sa RELAY, nire-record sa 'marketplaceOrders', at
//      dine-deduct ang stock (FEFO via deductProductStock) nang idempotent (isang beses lang
//      bawat order); auto-restock kapag na-cancel bago maipadala.
//   4. Stock/price push — kino-compute ang available stock mula sa POS at ipinapasa sa RELAY
//      (diff-based, kaya hindi nag-sasayang ng API calls).
//   5. Shipping label — hinihingi sa RELAY (ang platform mismo ang gumagawa ng label/waybill).
//
// Hindi ito gumagawa ng POS "transaction" (walang BIR/AGT/OR number, walang shift/cashier):
// ang marketplace ang nag-iisyu ng sariling resibo/invoice sa buyer. Ang stock lang ang
// dine-deduct, at may sariling audit trail (marketplaceOrders + logAction).

'use strict';
const FEATURE_ID = 'marketplace_hub';
const PERMISSION = 'marketplace';
const FILE_LINKS = 'marketplaceLinks';
const FILE_ORDERS = 'marketplaceOrders';
const FILE_STATE = 'marketplaceState';
const PLATFORM_IDS = ['shopee', 'lazada', 'tiktok'];
const HOLD_STATUSES = new Set(['to_ship', 'shipped', 'completed']); // paid orders that hold stock
const ORDERS_CAP = 4000;

const DEFAULT_SETTINGS = {
    autoSync: true,
    intervalMin: 3,        // gaano kadalas mag-sync (minuto)
    pushStock: true,       // ipasa ang POS stock sa mga naka-link na listing
    stockBuffer: 0,        // ilang piraso ang "itatabi" at hindi ipapakita sa marketplace
    backfillDays: 3        // ilang araw na lumang open orders ang ilalabas pagka-connect (HINDI dine-deduct)
};
const DEFAULT_STATE = { settings: { ...DEFAULT_SETTINGS }, cursors: {}, connections: [], lastSync: null };

module.exports = function registerMarketplace(deps) {
    const {
        app, readData, commitDataModules, readProductsNoImages, deductProductStock, addBaseStock,
        requirePermission, requireFeature, getUnlockedFeatureIds, relayFetch, RELAY_URL, RELAY_API_KEY,
        getInstallationId, logAction, transactionsMutexRunExclusive, rateLimit, FILE_PRODUCTS, isDemoActive
    } = deps;

    const now = () => Date.now();
    const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    const lc = (v) => String(v == null ? '' : v).trim().toLowerCase();
    const round2 = (n) => Math.round(num(n) * 100) / 100;
    const orderKey = (o) => `${o.platform}:${o.shopId}:${o.orderId}`;
    const connKey = (platform, shopId) => `${platform}:${shopId}`;
    const linkId = (l) => `${l.platform}:${l.shopId}:${l.itemId}:${l.modelId || '0'}`;
    const isUnlocked = () => { try { return getUnlockedFeatureIds().includes(FEATURE_ID); } catch (_) { return false; } };
    // Demo Mode: ang products ay ibinabalik sa snapshot pagkatapos, kaya HUWAG mag-import/deduct/push habang demo.
    const inDemo = () => { try { return typeof isDemoActive === 'function' && !!isDemoActive(); } catch (_) { return false; } };

    function getState() {
        const s = readData(FILE_STATE, {});
        const st = (s && typeof s === 'object') ? s : {};
        return { ...DEFAULT_STATE, ...st, settings: { ...DEFAULT_SETTINGS, ...(st.settings || {}) }, cursors: st.cursors || {}, connections: st.connections || [] };
    }
    const saveState = (st) => commitDataModules([{ module: FILE_STATE, data: st }]);

    // ------------------------------------------------------------ RELAY client
    async function relayCall(path, body, timeoutMs = 30000) {
        // relayFetch resolves the credential dynamically after first-install activation.
        // Do not gate this module on the stale value captured during startup.
        let res;
        try {
            res = await relayFetch(`${RELAY_URL}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
                body: JSON.stringify({ installationId: getInstallationId(), ...body })
            }, timeoutMs);
        } catch (err) {
            const e = new Error(err.code === 'NO_INTERNET' ? 'No internet connection. Marketplace sync will resume automatically when you are back online.' : `Could not reach the relay: ${err.message}`);
            e.status = 502; e.offline = true; throw e;
        }
        let data; try { data = await res.json(); } catch (_) { data = { success: false, message: `The relay returned HTTP ${res.status}.` }; }
        if (!data.success) {
            const e = new Error(data.message || `The relay returned HTTP ${res.status}.`);
            e.status = res.status === 402 ? 402 : (res.status >= 400 && res.status < 600 ? res.status : 502);
            e.relay = data; throw e;
        }
        return data;
    }
    const sendError = (res, e) => {
        const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
        if (e.relay) return res.status(status).json({ ...e.relay, success: false, message: e.message });
        res.status(status).json({ success: false, message: e.message || 'Marketplace request failed.' });
    };

    // --------------------------------------------------------- link / product helpers
    function buildProductIndex(products) {
        const byCode = new Map(); const byBarcode = new Map();
        for (const p of products) {
            if (p && p.code != null) byCode.set(lc(p.code), p);
            if (p && p.barcode) byBarcode.set(lc(p.barcode), p);
        }
        return { byCode, byBarcode, find: (v) => byCode.get(lc(v)) || byBarcode.get(lc(v)) || null };
    }
    function findLink(links, o, it) {
        return links.find((l) => l.platform === o.platform && l.shopId === o.shopId && l.itemId === String(it.itemId) && String(l.modelId || '0') === String(it.modelId || '0')) || null;
    }

    // -------------------------------------------------------------- order import
    function restockFromDeduction(prod, d) {
        // Isauli sa DIN lot (kasama expiry) kung may allocation, gaya ng void/refund flow.
        const lots = Array.isArray(d.lots) ? d.lots : [];
        if (lots.length) {
            lots.forEach((l) => addBaseStock(prod, l.qty, { lotNumber: l.lotNumber, expiryDate: l.expiryDate, costPrice: l.costPrice, mergeIfSame: true, notes: 'Marketplace order cancelled before shipping' }));
        } else addBaseStock(prod, d.qty);
    }

    function applyOrder(o, ctx) {
        const { links, productIndex, existing, orders, conn, summary } = ctx;
        const key = orderKey(o);
        let rec = existing.get(key);
        const items = (o.items || []).map((it) => ({
            itemId: String(it.itemId || ''), modelId: String(it.modelId || '0'), sku: String(it.sku || ''), name: it.name || '', variation: it.variation || '',
            qty: num(it.qty, 1), unitPrice: round2(it.unitPrice)
        }));
        if (!rec) {
            rec = {
                key, platform: o.platform, shopId: o.shopId, orderId: o.orderId, orderNo: o.orderNo,
                status: o.status, rawStatus: o.rawStatus || '', createdAt: o.createdAt, updatedAt: o.updatedAt,
                buyer: o.buyer || '', total: round2(o.total), shippingFee: round2(o.shippingFee), currency: o.currency || 'PHP',
                paymentMethod: o.paymentMethod || '', carrier: o.carrier || '', trackingNumber: o.trackingNumber || '',
                items, meta: { ...(o.meta || {}), itemMeta: (o.items || []).map((i) => i.meta || null) },
                firstSeenAt: now(), stockDeducted: false, deductions: [], unmapped: [], shippedSeen: false,
                preConnection: !!(conn && conn.connectedAt && o.createdAt && o.createdAt < conn.connectedAt - 5 * 60 * 1000),
                review: null, labelCount: 0, history: [{ at: now(), status: o.status }]
            };
            orders.unshift(rec); existing.set(key, rec); summary.newOrders++;
        } else {
            if (rec.status !== o.status) { rec.history.push({ at: now(), status: o.status }); summary.updatedOrders++; }
            Object.assign(rec, {
                status: o.status, rawStatus: o.rawStatus || rec.rawStatus, updatedAt: o.updatedAt || rec.updatedAt, total: round2(o.total) || rec.total,
                carrier: o.carrier || rec.carrier, trackingNumber: o.trackingNumber || rec.trackingNumber, buyer: o.buyer || rec.buyer
            });
            if (items.length) {
                // panatilihin ang "deducted" flag ng bawat item para hindi madoble ang deduct
                rec.items = items.map((n) => { const old = (rec.items || []).find((x) => x.itemId === n.itemId && x.modelId === n.modelId && x.sku === n.sku); return old && old.deducted ? { ...n, deducted: true } : n; });
                rec.meta = { ...rec.meta, ...(o.meta || {}), itemMeta: (o.items || []).map((i) => i.meta || null) }; }
        }
        if (o.status === 'shipped' || o.status === 'completed') rec.shippedSeen = true;
        rec.cancelRequested = !!o.cancelRequested;

        // 1) Deduct once, only for paid orders created AFTER the connection (older ones are already reflected in stock).
        // Per-item: ang mga item na hindi pa naka-link ay susubukan ulit sa susunod na sync (kapag na-link na).
        if (HOLD_STATUSES.has(o.status) && !rec.preConnection && !rec.restocked && rec.items.some((x) => !x.deducted)) {
            const deductions = Array.isArray(rec.deductions) ? rec.deductions.slice() : []; const unmapped = [];
            const priorCount = deductions.length;
            for (const it of rec.items) {
                if (it.deducted) continue;
                const link = findLink(links, o, it);
                const prod = link ? productIndex.find(link.productCode) : (it.sku ? productIndex.find(it.sku) : null);
                if (!prod) { unmapped.push({ sku: it.sku, name: it.name, qty: it.qty }); continue; }
                const mult = link ? Math.max(1, num(link.qtyMultiplier, 1)) : 1;
                const want = it.qty * mult;
                const have = Math.max(0, num(prod.stock));
                const take = Math.min(want, have);
                let lots = [];
                if (take > 0) lots = deductProductStock(prod, take).map((a) => ({ batchId: a.batchId, lotNumber: a.lotNumber, expiryDate: a.expiryDate, costPrice: a.costPrice, qty: a.qty }));
                deductions.push({ code: prod.code, name: prod.name || '', qty: take, wanted: want, short: Math.max(0, want - take), lots });
                it.deducted = true;
                ctx.touchedProducts = true;
                if (take < want) summary.shortages++;
            }
            rec.stockDeducted = deductions.length > 0;
            rec.deductions = deductions; rec.unmapped = unmapped; rec.deductedAt = now();
            if (unmapped.length) summary.unmapped += unmapped.length;
            const fresh = deductions.slice(priorCount);
            if (fresh.length) logAction('MARKETPLACE', `Order ${o.platform.toUpperCase()} ${rec.orderNo}: deducted ${fresh.map((d) => `${d.qty} x ${d.name || d.code}`).join(', ')}${unmapped.length ? ` (${unmapped.length} unmapped item(s))` : ''}`);
        }
        // 2) Cancelled / returned handling.
        if (o.status === 'cancelled' && rec.stockDeducted && !rec.restocked) {
            if (!rec.shippedSeen) {
                for (const d of rec.deductions) { const prod = productIndex.find(d.code); if (prod && d.qty > 0) { restockFromDeduction(prod, d); ctx.touchedProducts = true; } }
                rec.stockDeducted = false; rec.restocked = true; rec.restockedAt = now(); rec.review = null;
                summary.restocked++;
                logAction('MARKETPLACE', `Order ${o.platform.toUpperCase()} ${rec.orderNo} cancelled before shipping — stock restored.`);
            } else if (!rec.reviewDismissedAt) rec.review = 'cancelled_after_ship';
        } else if (o.status === 'returned' && rec.stockDeducted && !rec.restocked) {
            if (!rec.reviewDismissedAt) rec.review = 'returned';
        }
        return rec;
    }

    async function importOrdersForConnection(conn, st, summary) {
        const ck = connKey(conn.platform, conn.shopId);
        // Pagkatapos ng Hard Reset (bagong stock), huwag ibalik/i-deduct ang mga order na mas luma sa reset.
        if (num(st.resetAt) > num(conn.connectedAt)) conn = { ...conn, connectedAt: num(st.resetAt) };
        const backfill = Math.max(0, num(st.settings.backfillDays, 3)) * 24 * 3600 * 1000;
        const since = st.cursors[ck] || Math.max(0, num(conn.connectedAt, now()) - backfill);
        const data = await relayCall('/relay/marketplace/orders', { platform: conn.platform, shopId: conn.shopId, sinceMs: since }, 90000);
        const incoming = Array.isArray(data.orders) ? data.orders : [];
        let newest = since;
        await transactionsMutexRunExclusive(async () => {
            const links = readData(FILE_LINKS, []);
            const orders = readData(FILE_ORDERS, []);
            const products = readProductsNoImages([]);
            const ctx = { links, productIndex: buildProductIndex(products), existing: new Map(orders.map((r) => [r.key, r])), orders, conn, summary, touchedProducts: false };
            incoming.sort((a, b) => num(a.updatedAt) - num(b.updatedAt)).forEach((o) => { applyOrder(o, ctx); newest = Math.max(newest, num(o.updatedAt)); });
            if (orders.length > ORDERS_CAP) {
                // buang ang pinakaluma na tapos na (completed/cancelled) lang
                const keep = []; let excess = orders.length - ORDERS_CAP;
                for (let i = orders.length - 1; i >= 0; i--) { const r = orders[i]; if (excess > 0 && ['completed', 'cancelled'].includes(r.status) && !r.review) { excess--; continue; } keep.unshift(r); }
                orders.length = 0; orders.push(...keep);
            }
            const changes = [{ module: FILE_ORDERS, data: orders }];
            if (ctx.touchedProducts) changes.push({ module: FILE_PRODUCTS, data: products });
            if (incoming.length) commitDataModules(changes);
        });
        st.cursors[ck] = Math.max(since, newest - 2 * 60 * 1000); // 2-minute overlap; idempotent kaya ligtas
        summary.fetched += incoming.length;
    }

    // ----------------------------------------------------------- stock / price push
    function computeAvailable(prod, link, settings) {
        const mult = Math.max(1, num(link.qtyMultiplier, 1));
        const buffer = Math.max(0, num(settings.stockBuffer, 0)) + Math.max(0, num(link.stockBuffer, 0));
        return Math.max(0, Math.floor((num(prod.stock) - buffer) / mult));
    }
    function computePrice(prod, link) {
        if (num(link.fixedPrice) > 0) return round2(link.fixedPrice);
        return round2(num(prod.price) * (1 + num(link.priceMarkupPct, 0) / 100));
    }

    async function pushForConnection(conn, st, summary, { force = false, onlyLinkIds = null, prices = false } = {}) {
        const links = readData(FILE_LINKS, []);
        const products = readProductsNoImages([]);
        const idx = buildProductIndex(products);
        const mine = links.filter((l) => l.platform === conn.platform && l.shopId === conn.shopId && (!onlyLinkIds || onlyLinkIds.includes(l.id)));
        const stockUpdates = []; const priceUpdates = [];
        for (const l of mine) {
            const prod = idx.find(l.productCode);
            if (!prod) { l.lastError = 'Linked product no longer exists.'; continue; }
            if ((l.pushStock !== false) && st.settings.pushStock) {
                const avail = computeAvailable(prod, l, st.settings);
                if (force || l.lastPushedStock !== avail) stockUpdates.push({ link: l, avail, payload: { itemId: l.itemId, modelId: l.modelId, sku: l.sku, stock: avail, meta: l.meta || {} } });
            }
            if (l.pushPrice && (prices || l.pushPrice)) {
                const price = computePrice(prod, l);
                if (price > 0 && (force || l.lastPushedPrice !== price)) priceUpdates.push({ link: l, price, payload: { itemId: l.itemId, modelId: l.modelId, sku: l.sku, price, meta: l.meta || {} } });
            }
        }
        const apply = (updates, route, mark) => async () => {
            for (let i = 0; i < updates.length; i += 100) {
                const chunk = updates.slice(i, i + 100);
                const data = await relayCall(route, { platform: conn.platform, shopId: conn.shopId, updates: chunk.map((c) => c.payload) }, 90000);
                const results = data.results || [];
                chunk.forEach((c, n) => {
                    const r = results[n] || {};
                    if (r.ok) { mark(c); c.link.lastPushedAt = now(); c.link.lastError = null; summary.pushed++; }
                    else { c.link.lastError = r.error || 'Push failed.'; summary.pushErrors++; }
                });
            }
        };
        try {
            if (stockUpdates.length) await apply(stockUpdates, '/relay/marketplace/push-stock', (c) => { c.link.lastPushedStock = c.avail; })();
            if (priceUpdates.length) await apply(priceUpdates, '/relay/marketplace/push-price', (c) => { c.link.lastPushedPrice = c.price; })();
        } finally {
            if (stockUpdates.length || priceUpdates.length) {
                // i-merge lang ang push-bookkeeping sa pinakabagong links (iwas overwrite sa edits habang tumatakbo)
                const fresh = readData(FILE_LINKS, []);
                const byId = new Map(mine.map((l) => [l.id, l]));
                fresh.forEach((l) => { const m = byId.get(l.id); if (m) { l.lastPushedStock = m.lastPushedStock; l.lastPushedPrice = m.lastPushedPrice; l.lastPushedAt = m.lastPushedAt; l.lastError = m.lastError; } });
                commitDataModules([{ module: FILE_LINKS, data: fresh }]);
            }
        }
    }

    // ----------------------------------------------------------------- sync cycle
    let syncing = null;
    async function refreshConnections(st) {
        const data = await relayCall('/relay/marketplace/status', {}, 20000);
        st.connections = data.connections || [];
        st.platforms = data.platforms || [];
        return st.connections;
    }
    async function runSync({ force = false, trigger = 'manual' } = {}) {
        if (syncing) return syncing;
        syncing = (async () => {
            const summary = { fetched: 0, newOrders: 0, updatedOrders: 0, restocked: 0, unmapped: 0, shortages: 0, pushed: 0, pushErrors: 0, errors: [], trigger };
            const st = getState();
            if (inDemo()) {
                summary.errors.push('Marketplace sync is paused while Demo Mode is active.');
                return summary;
            }
            try {
                const conns = (await refreshConnections(st)).filter((c) => c.status === 'active');
                for (const conn of conns) {
                    try {
                        await importOrdersForConnection(conn, st, summary);
                        await pushForConnection(conn, st, summary, { force });
                    } catch (e) {
                        summary.errors.push(`${conn.platform}: ${e.message}`);
                        if (e.status === 402) throw e;
                    }
                }
            } catch (e) {
                summary.errors.push(e.message); summary.locked = e.status === 402; summary.offline = !!e.offline;
            } finally {
                st.lastSync = { at: now(), ok: summary.errors.length === 0, summary };
                try { const cur = getState(); cur.cursors = st.cursors; cur.connections = st.connections; cur.platforms = st.platforms; cur.lastSync = st.lastSync; saveState(cur); } catch (e) { console.error('marketplace state save failed:', e.message); }
            }
            return summary;
        })().finally(() => { syncing = null; });
        return syncing;
    }

    // Auto-sync tick (hindi nag-oorasyon kung locked/off/walang connection).
    const tick = setInterval(async () => {
        try {
            if (!isUnlocked() || syncing || inDemo()) return;
            const st = getState();
            if (!st.settings.autoSync) return;
            if (!(st.connections || []).some((c) => c.status === 'active') && st.lastSync && now() - st.lastSync.at < 15 * 60 * 1000) return;
            const gap = Math.max(1, num(st.settings.intervalMin, 3)) * 60 * 1000;
            if (st.lastSync && now() - st.lastSync.at < gap) return;
            await runSync({ trigger: 'auto' });
        } catch (e) { console.error('marketplace auto-sync error:', e.message); }
    }, 30 * 1000);
    if (tick.unref) tick.unref();

    // ------------------------------------------------------------------- routes
    const guards = [requirePermission(PERMISSION), requireFeature(FEATURE_ID)];
    const rl = (name, max, ms) => rateLimit(name, max, ms);

    app.get('/api/marketplace/overview', ...guards, async (req, res) => {
        const st = getState();
        try { if (req.query.refresh === '1' || !st.connections.length) { await refreshConnections(st); saveState({ ...getState(), connections: st.connections, platforms: st.platforms }); } } catch (e) { st.relayError = e.message; }
        const orders = readData(FILE_ORDERS, []);
        const links = readData(FILE_LINKS, []);
        res.json({
            success: true, settings: st.settings, connections: st.connections, platforms: st.platforms || PLATFORM_IDS.map((id) => ({ id, label: id, configured: true })),
            lastSync: st.lastSync, relayError: st.relayError || null, syncing: !!syncing,
            counts: {
                links: links.length,
                toShip: orders.filter((o) => o.status === 'to_ship').length,
                review: orders.filter((o) => o.review).length,
                unmapped: orders.filter((o) => (o.unmapped || []).length && o.status !== 'cancelled').length
            }
        });
    });

    app.post('/api/marketplace/connect', ...guards, rl('marketplace-connect', 20, 10 * 60 * 1000), async (req, res) => {
        try {
            const platform = lc(req.body.platform);
            if (!PLATFORM_IDS.includes(platform)) return res.status(400).json({ success: false, message: 'Unknown marketplace.' });
            const data = await relayCall('/relay/marketplace/connect-url', { platform });
            logAction(req.authUser && req.authUser.username, `MARKETPLACE: started ${platform} connection.`);
            res.json({ success: true, url: data.url, redirectUri: data.redirectUri });
        } catch (e) { sendError(res, e); }
    });

    app.post('/api/marketplace/disconnect', ...guards, rl('marketplace-disconnect', 20, 10 * 60 * 1000), async (req, res) => {
        try {
            const platform = lc(req.body.platform); const shopId = String(req.body.shopId || '');
            const data = await relayCall('/relay/marketplace/disconnect', { platform, shopId });
            const st = getState(); st.connections = (st.connections || []).filter((c) => !(c.platform === platform && c.shopId === shopId)); delete st.cursors[connKey(platform, shopId)]; saveState(st);
            logAction(req.authUser && req.authUser.username, `MARKETPLACE: disconnected ${platform} shop ${shopId}.`);
            res.json({ success: true, message: data.message });
        } catch (e) { sendError(res, e); }
    });

    app.put('/api/marketplace/settings', ...guards, (req, res) => {
        const st = getState(); const b = req.body || {};
        st.settings = {
            autoSync: b.autoSync !== undefined ? !!b.autoSync : st.settings.autoSync,
            intervalMin: Math.min(60, Math.max(1, Math.floor(num(b.intervalMin, st.settings.intervalMin)))),
            pushStock: b.pushStock !== undefined ? !!b.pushStock : st.settings.pushStock,
            stockBuffer: Math.max(0, Math.floor(num(b.stockBuffer, st.settings.stockBuffer))),
            backfillDays: Math.min(14, Math.max(0, Math.floor(num(b.backfillDays, st.settings.backfillDays))))
        };
        saveState(st);
        logAction(req.authUser && req.authUser.username, 'MARKETPLACE: settings updated.');
        res.json({ success: true, settings: st.settings });
    });

    app.post('/api/marketplace/sync', ...guards, rl('marketplace-sync-now', 12, 10 * 60 * 1000), async (req, res) => {
        const summary = await runSync({ force: !!(req.body && req.body.force), trigger: 'manual' });
        if (summary.locked) return res.status(402).json({ success: false, featureLocked: true, featureId: FEATURE_ID, message: summary.errors[0] });
        res.json({ success: summary.errors.length === 0, summary, message: summary.errors.length ? summary.errors.join(' | ') : 'Sync complete.' });
    });

    // -------- orders
    app.get('/api/marketplace/orders', ...guards, (req, res) => {
        let list = readData(FILE_ORDERS, []);
        const { status, platform, q, review } = req.query;
        if (status && status !== 'all') list = list.filter((o) => o.status === status);
        if (platform && platform !== 'all') list = list.filter((o) => o.platform === platform);
        if (review === '1') list = list.filter((o) => o.review);
        if (q) { const needle = lc(q); list = list.filter((o) => lc(o.orderNo).includes(needle) || lc(o.buyer).includes(needle) || (o.items || []).some((i) => lc(i.name).includes(needle) || lc(i.sku).includes(needle))); }
        list = list.slice().sort((a, b) => num(b.createdAt) - num(a.createdAt)).slice(0, 300);
        res.json({ success: true, orders: list });
    });

    app.post('/api/marketplace/orders/:key/label', ...guards, rl('marketplace-label', 40, 10 * 60 * 1000), async (req, res) => {
        try {
            const key = decodeURIComponent(req.params.key);
            const orders = readData(FILE_ORDERS, []);
            const rec = orders.find((o) => o.key === key);
            if (!rec) return res.status(404).json({ success: false, message: 'Order not found.' });
            if (rec.status === 'cancelled') return res.status(400).json({ success: false, message: 'This order was cancelled — no label to print.' });
            if (rec.status === 'unpaid') return res.status(400).json({ success: false, message: 'This order is still unpaid.' });
            const data = await relayCall('/relay/marketplace/label', {
                platform: rec.platform, shopId: rec.shopId, orderId: rec.orderId, arrange: !!(req.body && req.body.arrange),
                meta: { ...(rec.meta || {}), orderItemIds: (rec.meta && rec.meta.orderItemIds) || undefined }
            }, 120000);
            const fresh = readData(FILE_ORDERS, []); const r2 = fresh.find((o) => o.key === key);
            if (r2) { r2.labelCount = (r2.labelCount || 0) + 1; r2.lastLabelAt = now(); if (data.trackingNumber) r2.trackingNumber = data.trackingNumber; commitDataModules([{ module: FILE_ORDERS, data: fresh }]); }
            const buf = Buffer.from(String(data.dataBase64 || ''), 'base64');
            if (!buf.length) return res.status(502).json({ success: false, message: 'The marketplace returned an empty label. Please try again.' });
            const mime = data.mimeType || 'application/pdf';
            const ext = mime === 'application/pdf' ? 'pdf' : mime === 'application/zip' ? 'zip' : 'html';
            logAction(req.authUser && req.authUser.username, `MARKETPLACE: label ${rec.platform.toUpperCase()} ${rec.orderNo}${req.body && req.body.arrange ? ' (arranged shipment)' : ''}.`);
            res.set({ 'Content-Type': mime, 'Content-Disposition': `inline; filename="label-${rec.platform}-${String(rec.orderNo).replace(/[^\w.-]/g, '')}.${ext}"`, 'X-Tracking-Number': data.trackingNumber || rec.trackingNumber || '', 'Cache-Control': 'no-store' });
            res.send(buf);
        } catch (e) { sendError(res, e); }
    });

    // Manual restock/dismiss ng orders na na-flag for review (cancelled-after-ship / returned).
    app.post('/api/marketplace/orders/:key/review', ...guards, rl('marketplace-review', 60, 10 * 60 * 1000), async (req, res) => {
        await transactionsMutexRunExclusive(async () => {
            const key = decodeURIComponent(req.params.key);
            const action = lc(req.body && req.body.action);
            const orders = readData(FILE_ORDERS, []);
            const rec = orders.find((o) => o.key === key);
            if (!rec || !rec.review) return res.status(404).json({ success: false, message: 'No pending review for this order.' });
            if (action === 'restock') {
                const products = readProductsNoImages([]); const idx = buildProductIndex(products);
                (Array.isArray(rec.deductions) ? rec.deductions : []).forEach((d) => { const p = idx.find(d.code); if (p && d.qty > 0) restockFromDeduction(p, d); });
                rec.stockDeducted = false; rec.restocked = true; rec.restockedAt = now(); rec.review = null;
                commitDataModules([{ module: FILE_PRODUCTS, data: products }, { module: FILE_ORDERS, data: orders }]);
                logAction(req.authUser && req.authUser.username, `MARKETPLACE: manual restock for ${rec.platform.toUpperCase()} ${rec.orderNo}.`);
            } else if (action === 'dismiss') {
                rec.review = null; rec.reviewDismissedAt = now();
                commitDataModules([{ module: FILE_ORDERS, data: orders }]);
            } else return res.status(400).json({ success: false, message: 'action must be restock or dismiss.' });
            res.json({ success: true });
        });
    });

    // -------- links & listings
    app.get('/api/marketplace/links', ...guards, (req, res) => {
        const links = readData(FILE_LINKS, []); const idx = buildProductIndex(readProductsNoImages([]));
        res.json({ success: true, links: links.map((l) => { const p = idx.find(l.productCode); return { ...l, productName: p ? p.name : null, productStock: p ? num(p.stock) : null, productPrice: p ? num(p.price) : null }; }) });
    });

    app.get('/api/marketplace/listings', ...guards, rl('marketplace-listings', 120, 10 * 60 * 1000), async (req, res) => {
        try {
            const platform = lc(req.query.platform); const shopId = String(req.query.shopId || '');
            const data = await relayCall('/relay/marketplace/products', { platform, shopId, cursor: req.query.cursor || '' }, 90000);
            const links = readData(FILE_LINKS, []); const idx = buildProductIndex(readProductsNoImages([]));
            const items = (data.items || []).map((it) => {
                const id = linkId({ platform, shopId, itemId: it.itemId, modelId: it.modelId });
                const link = links.find((l) => l.id === id) || null;
                const suggest = !link && it.sku ? idx.find(it.sku) : null;
                return { ...it, linkId: link ? link.id : null, productCode: link ? link.productCode : null, suggestedCode: suggest ? suggest.code : null, suggestedName: suggest ? suggest.name : null };
            });
            res.json({ success: true, items, nextCursor: data.nextCursor || null });
        } catch (e) { sendError(res, e); }
    });

    function upsertLink(links, b) {
        const platform = lc(b.platform); const shopId = String(b.shopId || '');
        if (!PLATFORM_IDS.includes(platform) || !shopId || !b.itemId || !b.productCode) return null;
        const link = { platform, shopId, itemId: String(b.itemId), modelId: String(b.modelId || '0') };
        link.id = linkId(link);
        const prev = links.find((l) => l.id === link.id);
        const merged = {
            ...(prev || { createdAt: now(), lastPushedStock: null, lastPushedPrice: null }), ...link,
            sku: String(b.sku || (prev && prev.sku) || ''), listingName: String(b.listingName || (prev && prev.listingName) || ''),
            productCode: String(b.productCode), qtyMultiplier: Math.max(1, Math.floor(num(b.qtyMultiplier, (prev && prev.qtyMultiplier) || 1))),
            pushStock: b.pushStock !== undefined ? !!b.pushStock : (prev ? prev.pushStock !== false : true),
            pushPrice: b.pushPrice !== undefined ? !!b.pushPrice : !!(prev && prev.pushPrice),
            priceMarkupPct: b.priceMarkupPct !== undefined ? num(b.priceMarkupPct) : num(prev && prev.priceMarkupPct, 0),
            fixedPrice: b.fixedPrice !== undefined ? num(b.fixedPrice) : num(prev && prev.fixedPrice, 0),
            stockBuffer: b.stockBuffer !== undefined ? Math.max(0, Math.floor(num(b.stockBuffer))) : num(prev && prev.stockBuffer, 0),
            meta: b.meta || (prev && prev.meta) || {}, updatedAt: now()
        };
        if (prev) links[links.indexOf(prev)] = merged; else links.push(merged);
        return merged;
    }

    app.post('/api/marketplace/links', ...guards, rl('marketplace-link', 200, 10 * 60 * 1000), (req, res) => {
        const idx = buildProductIndex(readProductsNoImages([]));
        if (!idx.find(req.body && req.body.productCode)) return res.status(404).json({ success: false, message: 'That POS product code does not exist.' });
        const links = readData(FILE_LINKS, []);
        const saved = upsertLink(links, req.body || {});
        if (!saved) return res.status(400).json({ success: false, message: 'platform, shopId, itemId and productCode are required.' });
        commitDataModules([{ module: FILE_LINKS, data: links }]);
        logAction(req.authUser && req.authUser.username, `MARKETPLACE: linked ${saved.platform} ${saved.sku || saved.itemId} -> ${saved.productCode}.`);
        res.json({ success: true, link: saved });
    });

    app.delete('/api/marketplace/links/:id', ...guards, (req, res) => {
        const id = decodeURIComponent(req.params.id);
        const links = readData(FILE_LINKS, []); const next = links.filter((l) => l.id !== id);
        if (next.length === links.length) return res.status(404).json({ success: false, message: 'Link not found.' });
        commitDataModules([{ module: FILE_LINKS, data: next }]);
        logAction(req.authUser && req.authUser.username, `MARKETPLACE: unlinked ${id}.`);
        res.json({ success: true });
    });

    // Auto-match: SKU ng listing == POS product code (o barcode). Mag-scan ng hanggang 20 pages ng listings.
    app.post('/api/marketplace/links/auto-match', ...guards, rl('marketplace-automatch', 6, 10 * 60 * 1000), async (req, res) => {
        try {
            const platform = lc(req.body.platform); const shopId = String(req.body.shopId || '');
            const idx = buildProductIndex(readProductsNoImages([]));
            const links = readData(FILE_LINKS, []);
            let cursor = ''; let scanned = 0; let matched = 0; let already = 0; const unmatched = [];
            try {
            for (let page = 0; page < 20; page++) {
                const data = await relayCall('/relay/marketplace/products', { platform, shopId, cursor }, 90000);
                for (const it of (data.items || [])) {
                    scanned++;
                    const id = linkId({ platform, shopId, itemId: it.itemId, modelId: it.modelId });
                    if (links.some((l) => l.id === id)) { already++; continue; }
                    const prod = it.sku ? idx.find(it.sku) : null;
                    if (!prod) { if (unmatched.length < 50) unmatched.push({ sku: it.sku, name: it.name }); continue; }
                    upsertLink(links, { platform, shopId, itemId: it.itemId, modelId: it.modelId, sku: it.sku, listingName: [it.name, it.variation].filter(Boolean).join(' — '), productCode: prod.code, meta: it.meta });
                    matched++;
                }
                if (!data.nextCursor) break; cursor = data.nextCursor;
            }
            } finally {
                // i-save ang mga na-match na kahit pumalya ang relay sa kalagitnaan
                if (matched) commitDataModules([{ module: FILE_LINKS, data: links }]);
            }
            logAction(req.authUser && req.authUser.username, `MARKETPLACE: auto-match ${platform}: ${matched} new link(s) of ${scanned} listing(s).`);
            res.json({ success: true, scanned, matched, already, unmatchedCount: scanned - matched - already, unmatched });
        } catch (e) { sendError(res, e); }
    });

    app.post('/api/marketplace/push', ...guards, rl('marketplace-push', 12, 10 * 60 * 1000), async (req, res) => {
        const summary = { pushed: 0, pushErrors: 0, errors: [] };
        try {
            const st = getState(); const conns = (await refreshConnections(st)).filter((c) => c.status === 'active');
            const only = Array.isArray(req.body && req.body.linkIds) ? req.body.linkIds : null;
            for (const conn of conns) {
                if (req.body && req.body.platform && conn.platform !== lc(req.body.platform)) continue;
                try { await pushForConnection(conn, st, summary, { force: true, onlyLinkIds: only, prices: !!(req.body && req.body.prices) }); } catch (e) { summary.errors.push(`${conn.platform}: ${e.message}`); }
            }
            res.json({ success: summary.errors.length === 0, summary, message: summary.errors.join(' | ') || `Pushed ${summary.pushed} update(s).` });
        } catch (e) { sendError(res, e); }
    });

    return { runSync, _internal: { applyOrder, computeAvailable, computePrice, buildProductIndex } };
};
module.exports.FEATURE_ID = FEATURE_ID;
module.exports.FILE_LINKS = FILE_LINKS;
module.exports.FILE_ORDERS = FILE_ORDERS;
module.exports.FILE_STATE = FILE_STATE;
