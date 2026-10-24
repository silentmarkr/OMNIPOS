// PATH: OMNIPOS/kiosk.js
//
// Self-Order / Customer Kiosk add-on para sa OMNIPOS (additive — walang ginagalaw na existing route).
// Sinusunod nito ang parehong pattern ng marketplace-sync.js: registerKiosk({ ...deps }) na tinatawag sa dulo ng server.js.
//
// Ano ang ginagawa:
//   GET  /api/kiosk/catalog          products + categories + store info + kiosk config (para sa OMNIKiosk app)
//   GET  /api/kiosk/lookup?code=     price check / barcode scan (kasama ang price-level alias barcodes)
//   POST /api/kiosk/orders           tumanggap ng order mula sa kiosk (presyo/stock ay RE-COMPUTE ng server, hindi pinagkakatiwalaan ang client)
//   GET  /api/kiosk/queue            "Now preparing / Ready" board (walang sensitibong data)
//   GET  /api/kiosk/orders           para sa counter/kitchen screen
//   POST /api/kiosk/orders/:id/status  new -> preparing -> ready -> done | cancelled
//   GET  /api/kiosk/summary          benta ng kiosk ngayon + top items (para sa owner)
//   GET/PUT /api/kiosk/config        i-customize ng Admin ang kiosk (business type, options/add-ons, hidden items, atbp.)
//
// HINDI ito gumagawa ng POS "transaction" (BIR invoice/OR number, shift, cashier). Ang order ay "pay at counter":
// ang cashier pa rin ang magri-ring up sa POS, kaya buo ang BIR/AGT/audit trail ng POS. Ang stock ay "reserved" lang
// (binabawas sa available habang bukas pa ang order) at hindi dine-deduct dito.

'use strict';

const FILE_CONFIG = 'kioskConfig';
const FILE_ORDERS = 'kioskOrders';
const ORDERS_CAP = 3000;
const OPEN_STATUSES = new Set(['new', 'preparing', 'ready']);
const ALL_STATUSES = new Set(['new', 'preparing', 'ready', 'done', 'cancelled']);

const DEFAULT_CONFIG = {
    businessType: 'general',            // general | restaurant | store | service
    storeName: '',
    tagline: '',
    brandColor: '#e4572e',
    language: 'tl',                     // tl | en
    modes: { order: true, priceCheck: true, queueBoard: true },
    orderTypes: ['Dine-in', 'Take-out'],
    askName: false,
    askPhone: false,
    askTable: false,
    orderNote: true,
    showStock: false,
    hideOutOfStock: true,
    upsell: true,
    maxQtyPerLine: 20,
    idleSeconds: 60,
    unitLabel: 'pcs',
    hiddenCodes: [],
    featuredCodes: [],
    categoryOrder: [],
    // productOptions: { "<code>": [ { name:"Size", type:"single"|"multi", required:true, choices:[ {name:"Large", price:15} ] } ] }
    productOptions: {},
    // upsellCodes: mga code na iaalok bago mag-checkout (hal. inumin, fries)
    upsellCodes: []
};

function sanitizeConfig(input, base) {
    const c = { ...DEFAULT_CONFIG, ...(base || {}) };
    const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const b = v => !!v;
    const arr = (v, n, m) => (Array.isArray(v) ? v : []).map(x => s(x, n)).filter(Boolean).slice(0, m);
    if (!input || typeof input !== 'object') return c;
    if ('businessType' in input) c.businessType = ['general', 'restaurant', 'store', 'service'].includes(input.businessType) ? input.businessType : 'general';
    if ('storeName' in input) c.storeName = s(input.storeName, 60);
    if ('tagline' in input) c.tagline = s(input.tagline, 100);
    if ('brandColor' in input) c.brandColor = /^#[0-9a-fA-F]{6}$/.test(input.brandColor) ? input.brandColor : DEFAULT_CONFIG.brandColor;
    if ('language' in input) c.language = input.language === 'en' ? 'en' : 'tl';
    if (input.modes && typeof input.modes === 'object') {
        c.modes = { order: b(input.modes.order), priceCheck: b(input.modes.priceCheck), queueBoard: b(input.modes.queueBoard) };
        if (!c.modes.order && !c.modes.priceCheck) c.modes.order = true;
    }
    if ('orderTypes' in input) { c.orderTypes = arr(input.orderTypes, 24, 6); if (!c.orderTypes.length) c.orderTypes = ['Take-out']; }
    ['askName', 'askPhone', 'askTable', 'orderNote', 'showStock', 'hideOutOfStock', 'upsell'].forEach(k => { if (k in input) c[k] = b(input[k]); });
    if ('maxQtyPerLine' in input) c.maxQtyPerLine = Math.min(999, Math.max(1, parseInt(input.maxQtyPerLine, 10) || 20));
    if ('idleSeconds' in input) c.idleSeconds = Math.min(600, Math.max(15, parseInt(input.idleSeconds, 10) || 60));
    if ('unitLabel' in input) c.unitLabel = s(input.unitLabel, 12) || 'pcs';
    ['hiddenCodes', 'featuredCodes', 'categoryOrder', 'upsellCodes'].forEach(k => { if (k in input) c[k] = arr(input[k], 80, 500); });
    if (input.productOptions && typeof input.productOptions === 'object' && !Array.isArray(input.productOptions)) {
        const out = {};
        Object.keys(input.productOptions).slice(0, 500).forEach(code => {
            const groups = (Array.isArray(input.productOptions[code]) ? input.productOptions[code] : []).slice(0, 8).map(g => {
                const choices = (Array.isArray(g && g.choices) ? g.choices : []).slice(0, 20).map(ch => ({
                    name: s(ch && ch.name, 40),
                    price: Math.max(0, Math.round((parseFloat(ch && ch.price) || 0) * 100) / 100)
                })).filter(ch => ch.name);
                return { name: s(g && g.name, 30), type: g && g.type === 'multi' ? 'multi' : 'single', required: !!(g && g.required), choices };
            }).filter(g => g.name && g.choices.length);
            if (groups.length) out[s(code, 80)] = groups;
        });
        c.productOptions = out;
    }
    return c;
}

function todayKey(d) {
    const x = d || new Date();
    return x.getFullYear() + String(x.getMonth() + 1).padStart(2, '0') + String(x.getDate()).padStart(2, '0');
}
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

module.exports = function registerKiosk(deps) {
    const { app, readData, writeData, readProductsNoImages, logAction, rateLimit } = deps;
    const noop = (req, res, next) => next();
    const limit = (name, max, ms) => (typeof rateLimit === 'function' ? rateLimit(name, max, ms) : noop);

    const isAdmin = req => String((req.authUser && req.authUser.role) || '').toLowerCase() === 'admin';
    const getConfig = () => sanitizeConfig(readData(FILE_CONFIG, {}), null);
    const getOrders = () => { const o = readData(FILE_ORDERS, []); return Array.isArray(o) ? o : []; };
    const noStore = res => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); res.set('Pragma', 'no-cache'); };

    // Stock na naka-reserve ng mga bukas pang kiosk order (para hindi ma-oversell ng dalawang kiosk/customer).
    function reservedByCode(orders) {
        const r = {};
        orders.forEach(o => {
            if (!OPEN_STATUSES.has(o.status)) return;
            (o.items || []).forEach(it => { r[it.code] = (r[it.code] || 0) + (Number(it.baseQty != null ? it.baseQty : it.qty) || 0); });
        });
        return r;
    }

    function storeInfo() {
        const s = readData('storeSettings', {}) || {};
        return {
            currencySymbol: s.currencySymbol || '₱',
            currencyCode: s.currencyCode || 'PHP',
            taxEnabled: !!s.taxEnabled,
            taxLabel: s.taxLabel || 'VAT',
            taxRate: Number(s.taxRate) || 0,
            pricesIncludeTax: s.pricesIncludeTax !== false,
            branchName: s.branchName || ''
        };
    }

    function publicProduct(p, reserved, cfg) {
        const stock = Math.max(0, (parseFloat(p.stock) || 0) - (reserved[p.code] || 0));
        const uom = Array.isArray(p.uom) ? p.uom : [];
        return {
            code: String(p.code),
            name: p.name,
            category: p.category || '',
            price: round2(p.price),
            stock: round2(stock),
            inStock: stock > 0,
            allowDecimal: !!p.allowDecimal,
            baseUnit: p.baseUnit || '',
            uom: uom.map(u => ({ name: u.name, factor: u.factor, fixedPrice: u.fixedPrice || null })),
            imageVer: p.imageVer || null,
            hasImage: !!(p.image || p.imageCount || p.hasImage || p.imageVer),
            description: p.description ? String(p.description).slice(0, 200) : '',
            options: cfg.productOptions[String(p.code)] || []
        };
    }

    app.get('/api/kiosk/catalog', (req, res) => {
        noStore(res);
        const cfg = getConfig();
        const hidden = new Set(cfg.hiddenCodes);
        const reserved = reservedByCode(getOrders());
        const products = (readProductsNoImages() || [])
            .filter(p => p && p.code != null && p.name && !hidden.has(String(p.code)) && !p.archived && !p.disabled)
            .map(p => publicProduct(p, reserved, cfg))
            .filter(p => !(cfg.hideOutOfStock && !p.inStock));
        const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
        const order = cfg.categoryOrder;
        cats.sort((a, b) => {
            const ia = order.indexOf(a), ib = order.indexOf(b);
            if (ia !== -1 || ib !== -1) return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
            return a.localeCompare(b);
        });
        res.json({ success: true, config: cfg, store: storeInfo(), categories: cats, products, serverTime: new Date().toISOString() });
    });

    app.get('/api/kiosk/lookup', (req, res) => {
        noStore(res);
        const code = String(req.query.code || '').trim().toLowerCase();
        if (!code) return res.status(400).json({ success: false, message: 'Walang code.' });
        const cfg = getConfig();
        const reserved = reservedByCode(getOrders());
        const hidden = new Set(cfg.hiddenCodes);
        let found = null, level = null;
        for (const p of (readProductsNoImages() || [])) {
            if (!p || p.code == null) continue;
            if (String(p.code).trim().toLowerCase() === code) { found = p; break; }
            const alias = p.priceLevelBarcodes && typeof p.priceLevelBarcodes === 'object' ? p.priceLevelBarcodes : null;
            if (alias) {
                const lv = Object.keys(alias).find(k => String(alias[k] || '').trim().toLowerCase() === code);
                if (lv) { found = p; level = lv; break; }
            }
        }
        if (!found || hidden.has(String(found.code))) return res.status(404).json({ success: false, message: 'Hindi nahanap ang item.' });
        const out = publicProduct(found, reserved, cfg);
        if (level && found.priceLevels && found.priceLevels[level] > 0) { out.price = round2(found.priceLevels[level]); out.priceLevel = level; }
        res.json({ success: true, product: out });
    });

    app.post('/api/kiosk/orders', limit('kiosk-order', 120, 10 * 60 * 1000), (req, res) => {
        const cfg = getConfig();
        if (!cfg.modes.order) return res.status(403).json({ success: false, message: 'Naka-off ang self-order sa kiosk na ito.' });
        const body = req.body || {};
        const lines = Array.isArray(body.items) ? body.items : [];
        if (!lines.length || lines.length > 80) return res.status(400).json({ success: false, message: 'Walang laman o sobrang dami ng items.' });
        const cleanStr = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

        const products = readProductsNoImages() || [];
        const byCode = new Map(products.map(p => [String(p.code), p]));
        const orders = getOrders();
        const reserved = reservedByCode(orders);
        const need = {};
        const items = [];
        const problems = [];
        for (const ln of lines) {
            const p = byCode.get(String(ln && ln.code));
            if (!p) { problems.push(`Hindi nahanap: ${cleanStr(ln && (ln.name || ln.code), 40)}`); continue; }
            let qty = parseFloat(ln.qty);
            if (!(qty > 0)) { problems.push(`Maling dami: ${p.name}`); continue; }
            if (!p.allowDecimal) qty = Math.round(qty);
            if (qty < 1 && !p.allowDecimal) continue;
            qty = Math.min(qty, cfg.maxQtyPerLine);

            // Unit of measure (hal. "Box" = 12 pcs). Presyo ay galing sa server.
            let unit = null, factor = 1, unitPrice = round2(p.price);
            if (ln.unit) {
                const u = (Array.isArray(p.uom) ? p.uom : []).find(x => x.name === ln.unit);
                if (!u) { problems.push(`Maling unit: ${p.name}`); continue; }
                unit = u.name; factor = Number(u.factor) || 1;
                unitPrice = u.fixedPrice > 0 ? round2(u.fixedPrice) : round2(p.price * factor);
            }
            // Options / add-ons — i-validate laban sa config (hindi sa sinabi ng client).
            const groups = cfg.productOptions[String(p.code)] || [];
            const picked = [];
            let optErr = null;
            for (const g of groups) {
                const sel = (Array.isArray(ln.options) ? ln.options : []).filter(o => o && o.group === g.name).map(o => o.name);
                const uniq = Array.from(new Set(sel));
                if (g.required && uniq.length === 0) { optErr = `Pumili ng ${g.name} para sa ${p.name}`; break; }
                if (g.type === 'single' && uniq.length > 1) { optErr = `Isa lang ang pwede sa ${g.name}`; break; }
                for (const nm of uniq) {
                    const ch = g.choices.find(c => c.name === nm);
                    if (!ch) { optErr = `Maling option: ${nm}`; break; }
                    picked.push({ group: g.name, name: ch.name, price: ch.price });
                }
                if (optErr) break;
            }
            if (optErr) { problems.push(optErr); continue; }
            const optTotal = round2(picked.reduce((a, o) => a + o.price, 0));
            const baseQty = round2(qty * factor);
            need[p.code] = round2((need[p.code] || 0) + baseQty);
            items.push({
                code: String(p.code), name: p.name, category: p.category || '', qty, unit, factor, baseQty,
                unitPrice, options: picked, optionsTotal: optTotal,
                lineTotal: round2((unitPrice + optTotal) * qty),
                note: cleanStr(ln.note, 80)
            });
        }
        if (problems.length) return res.status(400).json({ success: false, message: problems.join('; ') });
        if (!items.length) return res.status(400).json({ success: false, message: 'Walang valid na item.' });
        const short = Object.keys(need).filter(code => {
            const p = byCode.get(code);
            return need[code] > (Math.max(0, (parseFloat(p.stock) || 0) - (reserved[code] || 0))) + 1e-6;
        }).map(code => byCode.get(code).name);
        if (short.length) return res.status(409).json({ success: false, outOfStock: true, message: `Kulang na ang stock: ${short.join(', ')}` });

        const orderType = cfg.orderTypes.includes(body.orderType) ? body.orderType : cfg.orderTypes[0];
        const dayKey = todayKey();
        const sameDay = orders.filter(o => o.dayKey === dayKey);
        const seq = sameDay.reduce((m, o) => Math.max(m, o.seq || 0), 0) + 1;
        const total = round2(items.reduce((a, i) => a + i.lineTotal, 0));
        const order = {
            id: `K${dayKey}-${String(seq).padStart(3, '0')}`,
            orderNo: String(seq).padStart(3, '0'),
            dayKey, seq,
            status: 'new',
            orderType,
            customerName: cfg.askName ? cleanStr(body.customerName, 40) : '',
            phone: cfg.askPhone ? cleanStr(body.phone, 20) : '',
            table: cfg.askTable ? cleanStr(body.table, 10) : '',
            note: cfg.orderNote ? cleanStr(body.note, 140) : '',
            items, total,
            itemCount: round2(items.reduce((a, i) => a + i.qty, 0)),
            createdAt: new Date().toISOString(),
            kioskDevice: cleanStr(body.device, 40),
            createdBy: req.authUser && req.authUser.username
        };
        orders.push(order);
        writeData(FILE_ORDERS, orders.length > ORDERS_CAP ? orders.slice(-ORDERS_CAP) : orders);
        try { logAction(req.authUser.username, `Kiosk order ${order.id} (${items.length} line(s), total ${total})`); } catch (e) { /* ignore */ }
        res.json({ success: true, order: { id: order.id, orderNo: order.orderNo, total, orderType, createdAt: order.createdAt } });
    });

    app.get('/api/kiosk/queue', (req, res) => {
        noStore(res);
        const day = todayKey();
        const list = getOrders().filter(o => o.dayKey === day && (o.status === 'preparing' || o.status === 'ready'));
        res.json({
            success: true,
            preparing: list.filter(o => o.status === 'preparing').map(o => o.orderNo),
            ready: list.filter(o => o.status === 'ready').map(o => o.orderNo)
        });
    });

    app.get('/api/kiosk/orders', (req, res) => {
        noStore(res);
        const status = String(req.query.status || 'open');
        const day = req.query.all === '1' ? null : todayKey();
        let list = getOrders().filter(o => !day || o.dayKey === day || OPEN_STATUSES.has(o.status));
        if (status === 'open') list = list.filter(o => OPEN_STATUSES.has(o.status));
        else if (ALL_STATUSES.has(status)) list = list.filter(o => o.status === status);
        res.json({ success: true, orders: list.slice(-300) });
    });

    app.post('/api/kiosk/orders/:id/status', (req, res) => {
        const next = String((req.body || {}).status || '');
        if (!ALL_STATUSES.has(next)) return res.status(400).json({ success: false, message: 'Maling status.' });
        const orders = getOrders();
        const o = orders.find(x => x.id === req.params.id);
        if (!o) return res.status(404).json({ success: false, message: 'Hindi nahanap ang order.' });
        if (!OPEN_STATUSES.has(o.status) && !isAdmin(req)) return res.status(409).json({ success: false, message: 'Sarado na ang order na ito.' });
        o.status = next;
        o.statusAt = new Date().toISOString();
        o.statusBy = req.authUser && req.authUser.username;
        if (next === 'done' && (req.body || {}).paidMethod) o.paidMethod = String(req.body.paidMethod).slice(0, 20);
        writeData(FILE_ORDERS, orders);
        try { logAction(req.authUser.username, `Kiosk order ${o.id} -> ${next}`); } catch (e) { /* ignore */ }
        res.json({ success: true, order: o });
    });

    app.get('/api/kiosk/summary', (req, res) => {
        noStore(res);
        const day = todayKey();
        const list = getOrders().filter(o => o.dayKey === day);
        const valid = list.filter(o => o.status !== 'cancelled');
        const top = {};
        valid.forEach(o => o.items.forEach(i => {
            const t = top[i.code] || (top[i.code] = { code: i.code, name: i.name, qty: 0, sales: 0 });
            t.qty = round2(t.qty + i.qty); t.sales = round2(t.sales + i.lineTotal);
        }));
        res.json({
            success: true,
            orders: valid.length,
            cancelled: list.length - valid.length,
            open: list.filter(o => OPEN_STATUSES.has(o.status)).length,
            sales: round2(valid.reduce((a, o) => a + o.total, 0)),
            top: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 10)
        });
    });

    app.get('/api/kiosk/config', (req, res) => { noStore(res); res.json({ success: true, config: getConfig() }); });
    app.put('/api/kiosk/config', (req, res) => {
        if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Admin lang ang pwedeng mag-edit ng kiosk settings.' });
        const cfg = sanitizeConfig((req.body || {}).config, getConfig());
        writeData(FILE_CONFIG, cfg);
        try { logAction(req.authUser.username, 'Updated Kiosk settings'); } catch (e) { /* ignore */ }
        res.json({ success: true, config: cfg });
    });
};
module.exports.sanitizeConfig = sanitizeConfig;
