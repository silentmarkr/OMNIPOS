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
//   GET  /api/kiosk/status           lisensya ng module (Self-Order Kiosk subscription): unlocked? grace period? presyo?
//   GET  /api/kiosk/slots?date=      bakanteng oras para sa booking/appointment (serbisyo) — may capacity bawat slot
//
// Catalog (/api/kiosk/catalog) ay may kasamang: "hot" (🔥 best seller, galing sa benta ng kiosk sa nakaraang 30 araw) at
// "wait" (tinatayang hintay, galing sa bukas na order at sa aktwal na bilis ng paghahanda). Walang binago sa POS transaction.
//
// LISENSYA: ang Self-Order Kiosk ay isang module subscription (feature id 'self_order_kiosk', monthly/yearly, presyo galing sa RELAY).
// Ang LAHAT ng /api/kiosk/* route (maliban sa /status) ay nasa likod ng server-side gate sa ibaba: kapag hindi naka-activate (o
// expired na kasama ang grace period) ay 402 { featureLocked:true } ang sagot, kaya hindi ito ma-bypass sa kiosk app/counter page.
// Fail-closed: kung hindi makuha ang lisensya (lumang hook sa server.js), naka-lock din.
//
// HINDI ito gumagawa ng POS "transaction" (BIR invoice/OR number, shift, cashier). Ang order ay "pay at counter":
// ang cashier pa rin ang magri-ring up sa POS, kaya buo ang BIR/AGT/audit trail ng POS. Ang stock ay "reserved" lang
// (binabawas sa available habang bukas pa ang order) at hindi dine-deduct dito.

'use strict';

const FEATURE_ID = 'self_order_kiosk';
const FILE_CONFIG = 'kioskConfig';
const FILE_ORDERS = 'kioskOrders';
const ORDERS_CAP = 3000;
const OPEN_STATUSES = new Set(['new', 'preparing', 'ready']);
const ALL_STATUSES = new Set(['new', 'preparing', 'ready', 'done', 'cancelled']);

const DEFAULT_CONFIG = {
    businessType: 'general',            // general | restaurant | minimart | sari | service | pharmacy | hardware
    storeName: '',
    tagline: '',
    brandColor: '',                     // '' = kulay ng OmniPOS (day #2563eb / dark #7c5cff). Hex lang kapag custom.
    language: 'tl',                     // tl | en
    modes: { order: true, priceCheck: true, queueBoard: true },
    orderTypes: ['Walk-in'],
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
    upsellCodes: [],
    // Best sellers (🔥 tag + "Patok" category) — kinukuwenta ng server mula sa benta ng kiosk
    bestSellers: true,
    // Tinatayang hintay (restaurant/mini-mart/etc.; hindi para sa serbisyo na slot ang gamit)
    showWait: true,
    prepMinutes: 5,                     // default na minuto bawat order habang wala pang sapat na datos
    stations: 1,                        // ilang order ang sabay na naihahanda
    // Booking slots (serbisyo/appointment)
    slotMinutes: 30,
    slotOpen: '09:00',
    slotClose: '18:00',
    slotCapacity: 1,                    // ilang booking ang pwede sa isang slot
    slotDays: 7,                        // ilang araw (kasama ngayon) ang pwedeng i-book
    slotLead: 15                        // minimum na minuto bago ang slot (para hindi mag-book ng papalipas na oras)
};
const LEGACY_BRAND = '#e4572e';        // dating default na kulay; ngayon ay sumusunod na sa OmniPOS

// Dine-in / table ay para sa restaurant lang. Ang ibang negosyo ay may sariling default na order type.
const BIZ_TYPES = ['general', 'restaurant', 'minimart', 'sari', 'service', 'pharmacy', 'hardware'];
const BIZ_ORDER_TYPES = {
    restaurant: ['Dine-in', 'Take-out'], minimart: ['Pick-up'], sari: ['Walk-in'], service: ['Walk-in'],
    pharmacy: ['Pick-up'], hardware: ['Pick-up', 'Delivery'], general: ['Walk-in']
};
// Default na mga mode ng kiosk bawat uri ng negosyo (ia-apply kapag nagpalit ng uri gamit ang Developer PIN)
const BIZ_MODES = {
    restaurant: { order: true, priceCheck: false, queueBoard: true },
    minimart: { order: true, priceCheck: true, queueBoard: false },
    sari: { order: false, priceCheck: true, queueBoard: false },
    service: { order: true, priceCheck: true, queueBoard: true }, // price check = service price list; queue board = schedule status
    pharmacy: { order: true, priceCheck: true, queueBoard: false },
    hardware: { order: true, priceCheck: true, queueBoard: false },
    general: { order: true, priceCheck: true, queueBoard: true }
};

/* ---------- Developer PIN (isa para sa LAHAT ng client, itinatakda sa RELAY) ----------
   Hindi nakaimbak sa client ang PIN o ang hash. Tinatanong ng OMNIPOS ang RELAY (/relay/client/kiosk-dev-pin/verify)
   gamit ang credential ng activation. Kailangan ng internet; walang local na kopya na pwedeng i-bruteforce ng owner.
   Itakda ito ng developer sa RELAY admin > Kiosk Developer PIN. */
async function checkDevPin(deps, pin) {
    const relayFetch = deps && deps.relayFetch;
    const base = deps && typeof deps.relayUrl === 'function' ? deps.relayUrl() : '';
    if (typeof relayFetch !== 'function' || !base) return { ok: false, code: 'norelay', message: 'Hindi nakakonekta sa RELAY. I-update ang hook ng kiosk sa server.js (install-kiosk-addon.js).' };
    const p = String(pin == null ? '' : pin);
    if (!p || p.length > 64) return { ok: false, code: 'bad', message: 'Ilagay ang Developer PIN.' };
    try {
        const r = await relayFetch(`${base}/relay/client/kiosk-dev-pin/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }) }, 15000);
        let j = {};
        try { j = await r.json(); } catch (e) { /* ignore */ }
        if (r.status === 429) return { ok: false, code: 'locked', message: 'Masyadong maraming subok. Subukan ulit mamaya.' };
        if (r.ok && j && j.ok === true) return { ok: true };
        if (j && j.code === 'LOCKED') return { ok: false, code: 'locked', message: 'Masyadong maraming maling PIN. Subukan ulit pagkalipas ng ' + Math.ceil((j.retryAfterSec || 900) / 60) + ' minuto.' };
        if (j && j.code === 'UNSET') return { ok: false, code: 'unset', message: 'Wala pang Developer PIN sa RELAY.' };
        if (r.ok) return { ok: false, code: 'bad', message: 'Maling Developer PIN.' };
        return { ok: false, code: 'relay', message: (j && j.message) || ('Hindi tinanggap ng RELAY (HTTP ' + r.status + ').') };
    } catch (e) {
        return { ok: false, code: 'offline', message: 'Kailangan ng internet para ma-verify ang Developer PIN sa RELAY.' };
    }
}

function normBiz(v) { v = v === 'store' ? 'minimart' : v; return BIZ_TYPES.includes(v) ? v : 'general'; }

function sanitizeConfig(input, base) {
    const out = sanitizeConfigRaw(input, base);
    if (String(out.brandColor || '').toLowerCase() === LEGACY_BRAND) out.brandColor = '';
    out.businessType = normBiz(out.businessType);
    if (out.businessType !== 'restaurant') {
        out.orderTypes = (out.orderTypes || []).filter(x => !/dine/i.test(x));
        out.askTable = false;
    }
    if (!out.orderTypes || !out.orderTypes.length) out.orderTypes = BIZ_ORDER_TYPES[out.businessType].slice();
    return out;
}

function sanitizeConfigRaw(input, base) {
    const c = { ...DEFAULT_CONFIG, ...(base || {}) };
    const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const b = v => !!v;
    const arr = (v, n, m) => (Array.isArray(v) ? v : []).map(x => s(x, n)).filter(Boolean).slice(0, m);
    if (!input || typeof input !== 'object') return c;
    if ('businessType' in input) {
        const nb = normBiz(input.businessType);
        // Kung nagpalit ng uri at hindi nagbigay ng bagong order types, gamitin ang default ng bagong uri.
        if (nb !== c.businessType && !('orderTypes' in input)) c.orderTypes = BIZ_ORDER_TYPES[nb].slice();
        c.businessType = nb;
    }
    if ('storeName' in input) c.storeName = s(input.storeName, 60);
    if ('tagline' in input) c.tagline = s(input.tagline, 100);
    if ('brandColor' in input) c.brandColor = /^#[0-9a-fA-F]{6}$/.test(input.brandColor) ? input.brandColor : '';
    if ('language' in input) c.language = input.language === 'en' ? 'en' : 'tl';
    if (input.modes && typeof input.modes === 'object') {
        c.modes = { order: b(input.modes.order), priceCheck: b(input.modes.priceCheck), queueBoard: b(input.modes.queueBoard) };
        if (!c.modes.order && !c.modes.priceCheck) c.modes.order = true;
    }
    if ('orderTypes' in input) { c.orderTypes = arr(input.orderTypes, 24, 6); if (!c.orderTypes.length) c.orderTypes = ['Take-out']; }
    ['askName', 'askPhone', 'askTable', 'orderNote', 'showStock', 'hideOutOfStock', 'upsell', 'bestSellers', 'showWait'].forEach(k => { if (k in input) c[k] = b(input[k]); });
    const num = (v, lo, hi, d) => { const n = parseInt(v, 10); return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : d)); };
    if ('prepMinutes' in input) c.prepMinutes = num(input.prepMinutes, 1, 120, 5);
    if ('stations' in input) c.stations = num(input.stations, 1, 20, 1);
    if ('slotMinutes' in input) c.slotMinutes = num(input.slotMinutes, 10, 240, 30);
    if ('slotCapacity' in input) c.slotCapacity = num(input.slotCapacity, 1, 50, 1);
    if ('slotDays' in input) c.slotDays = num(input.slotDays, 1, 60, 7);
    if ('slotLead' in input) c.slotLead = num(input.slotLead, 0, 600, 15);
    ['slotOpen', 'slotClose'].forEach(k => { if (k in input) c[k] = hmToMin(input[k]) == null ? DEFAULT_CONFIG[k] : minToHM(hmToMin(input[k])); });
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

const pad2 = n => String(n).padStart(2, '0');
// 'HH:MM' <-> minuto ng araw (lokal na oras ng server, parehong batayan ng todayKey)
function hmToMin(v) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v).trim()); if (!m) return null; const h = +m[1], mi = +m[2]; return h < 24 && mi < 60 ? h * 60 + mi : null; }
function minToHM(m) { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
function dateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

// Mga petsa na pwedeng i-book: ngayon hanggang slotDays-1 araw pagkatapos.
function bookableDays(cfg, now) {
    const out = [];
    for (let i = 0; i < cfg.slotDays; i++) out.push(dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)));
    return out;
}
// Mga slot ng isang petsa, kasama ang natitirang capacity (bukas na order lang ang bumibilang).
function buildSlots(cfg, date, orders, now) {
    now = now || new Date();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !bookableDays(cfg, now).includes(date)) return null;
    const open = hmToMin(cfg.slotOpen), close = hmToMin(cfg.slotClose), step = cfg.slotMinutes;
    if (open == null || close == null || close <= open) return [];
    const taken = {};
    (orders || []).forEach(o => { if (OPEN_STATUSES.has(o.status) && o.appt && o.appt.date === date) taken[o.appt.time] = (taken[o.appt.time] || 0) + 1; });
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const isToday = date === dateStr(now);
    const out = [];
    for (let t = open; t + step <= close; t += step) {
        const time = minToHM(t);
        const left = Math.max(0, cfg.slotCapacity - (taken[time] || 0));
        const past = isToday && t < nowMin + cfg.slotLead;
        out.push({ time, left, past, available: left > 0 && !past });
    }
    return out;
}

// Bilis ng paghahanda: average ng aktwal na oras (preparing -> ready) ng huling 30 order; kung kulang pa ang datos, ang prepMinutes sa settings.
function avgPrepMinutes(cfg, orders) {
    const d = [];
    for (let i = orders.length - 1; i >= 0 && d.length < 30; i--) {
        const o = orders[i];
        if (!o.prepAt || !o.readyAt) continue;
        const m = (Date.parse(o.readyAt) - Date.parse(o.prepAt)) / 60000;
        if (m > 0 && m < 120) d.push(m);
    }
    const avg = d.length >= 3 ? d.reduce((a, b) => a + b, 0) / d.length : cfg.prepMinutes;
    return Math.min(60, Math.max(1, avg));
}
// Tinatayang hintay ng bagong order: (mga order na hindi pa ready + 1) x bilis / dami ng sabay na naihahanda, itinataas sa 5 minuto.
function waitInfo(cfg, orders) {
    if (!cfg.showWait || !cfg.modes.order || cfg.businessType === 'service') return null;
    const day = todayKey();
    const ahead = orders.filter(o => o.dayKey === day && (o.status === 'new' || o.status === 'preparing')).length;
    const raw = ((ahead + 1) * avgPrepMinutes(cfg, orders)) / cfg.stations;
    return { ahead, minutes: Math.max(5, Math.ceil(raw / 5) * 5) };
}
// Best sellers: pinakamaraming nabenta sa kiosk sa nakaraang 30 araw (hindi kasama ang cancelled). Kailangan ng hindi bababa sa 3 piraso para hindi mag-"best seller" ang bago pa lang.
const BEST_MIN_QTY = 3, BEST_MAX = 5;
function bestSellerCodes(cfg, orders) {
    if (!cfg.bestSellers) return [];
    const from = todayKey(new Date(Date.now() - 30 * 86400000));
    const q = {};
    orders.forEach(o => {
        if (o.status === 'cancelled' || !o.dayKey || o.dayKey < from) return;
        (o.items || []).forEach(i => { q[i.code] = (q[i.code] || 0) + (Number(i.qty) || 0); });
    });
    return Object.keys(q).filter(c => q[c] >= BEST_MIN_QTY).sort((a, b) => q[b] - q[a]).slice(0, BEST_MAX);
}

function todayKey(d) {
    const x = d || new Date();
    return x.getFullYear() + String(x.getMonth() + 1).padStart(2, '0') + String(x.getDate()).padStart(2, '0');
}
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

module.exports = function registerKiosk(deps) {
    const { app, readData, writeData, readProductsNoImages, logAction, rateLimit } = deps; // deps.relayFetch / deps.relayUrl: para sa Developer PIN sa RELAY
    const noop = (req, res, next) => next();
    const limit = (name, max, ms) => (typeof rateLimit === 'function' ? rateLimit(name, max, ms) : noop);

    // ---- License gate (Self-Order Kiosk subscription) ----
    // deps.getKioskFeatureStatus() comes from server.js. If it is missing (old hook), everything stays locked (fail-closed).
    function licenseStatus() {
        try { return typeof deps.getKioskFeatureStatus === 'function' ? deps.getKioskFeatureStatus() : null; } catch (e) { return null; }
    }
    function lockedBody(st) {
        return {
            success: false,
            featureLocked: true,
            featureId: FEATURE_ID,
            featureName: (st && st.featureName) || 'Self-Order Kiosk (OMNIKiosk)',
            isSubscription: true,
            subscriptionPrice: (st && st.subscriptionPrice) || null,
            hookOutdated: !st,
            message: st
                ? 'Self-Order Kiosk is not active on this store (subscription inactive or expired). Ask the store owner/admin to activate it in OMNIPOS.'
                : 'Self-Order Kiosk license check is unavailable. Re-run install-kiosk-addon.js on the OMNIPOS server to update the kiosk hook in server.js, then restart the server.'
        };
    }
    const gate = (req, res, next) => {
        const st = licenseStatus();
        if (st && st.unlocked === true) return next();
        noStore(res);
        return res.status(402).json(lockedBody(st));
    };
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

    function publicProduct(p, reserved, cfg, hot) {
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
            options: cfg.productOptions[String(p.code)] || [],
            hot: !!(hot && hot.has(String(p.code)))
        };
    }

    // Not gated: the kiosk app and the Counter screen call this first to decide between the normal screens and the "not activated" screen.
    app.get('/api/kiosk/status', (req, res) => {
        noStore(res);
        const st = licenseStatus();
        if (!st) return res.json({ success: true, unlocked: false, featureId: FEATURE_ID, hookOutdated: true, message: lockedBody(null).message });
        res.json({
            success: true,
            unlocked: st.unlocked === true,
            featureId: FEATURE_ID,
            featureName: st.featureName,
            demo: !!st.demo,
            inGracePeriod: !!st.inGracePeriod,
            expiresAt: st.expiresAt || null,
            graceEndsAt: st.graceEndsAt || null,
            billingCycle: st.billingCycle || null,
            subscriptionPrice: st.subscriptionPrice || null,
            isAdmin: isAdmin(req)
        });
    });

    app.get('/api/kiosk/catalog', gate, (req, res) => {
        noStore(res);
        const cfg = getConfig();
        const hidden = new Set(cfg.hiddenCodes);
        const allOrders = getOrders();
        const reserved = reservedByCode(allOrders);
        const hot = new Set(bestSellerCodes(cfg, allOrders));
        const products = (readProductsNoImages() || [])
            .filter(p => p && p.code != null && p.name && !hidden.has(String(p.code)) && !p.archived && !p.disabled)
            .map(p => publicProduct(p, reserved, cfg, hot))
            .filter(p => !(cfg.hideOutOfStock && !p.inStock));
        const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
        const order = cfg.categoryOrder;
        cats.sort((a, b) => {
            const ia = order.indexOf(a), ib = order.indexOf(b);
            if (ia !== -1 || ib !== -1) return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
            return a.localeCompare(b);
        });
        const bestSellers = Array.from(hot).filter(c => products.some(p => p.code === c));
        res.json({ success: true, config: cfg, store: storeInfo(), categories: cats, products, bestSellers, wait: waitInfo(cfg, allOrders), serverTime: new Date().toISOString() });
    });

    // Bakanteng oras para sa booking. Ang kiosk ay hindi gumagawa ng sariling kuwenta ng oras: ang server ang batayan (hindi ang orasan ng tablet).
    app.get('/api/kiosk/slots', gate, (req, res) => {
        noStore(res);
        const cfg = getConfig();
        const now = new Date();
        const days = bookableDays(cfg, now);
        const date = String(req.query.date || days[0]);
        const slots = buildSlots(cfg, date, getOrders(), now);
        if (!slots) return res.status(400).json({ success: false, message: 'Hindi pwedeng i-book ang petsang iyon.' });
        res.json({ success: true, date, days, today: days[0], slots, open: cfg.slotOpen, close: cfg.slotClose, step: cfg.slotMinutes, capacity: cfg.slotCapacity });
    });

    app.get('/api/kiosk/lookup', gate, (req, res) => {
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

    app.post('/api/kiosk/orders', gate, limit('kiosk-order', 120, 10 * 60 * 1000), (req, res) => {
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

        // Booking slot (serbisyo): sa server ito ni-validate (petsa, oras, capacity). Sync ang handler kaya walang dobleng booking sa parehong slot.
        let appt = null;
        if (body.appt && typeof body.appt === 'object') {
            const ad = cleanStr(body.appt.date, 10), at = cleanStr(body.appt.time, 5);
            const slots = buildSlots(cfg, ad, orders, new Date());
            if (!slots) return res.status(400).json({ success: false, message: 'Hindi pwedeng i-book ang petsang iyon.' });
            const sl = slots.find(x => x.time === at);
            if (!sl) return res.status(400).json({ success: false, message: 'Walang ganoong oras sa schedule.' });
            if (sl.past) return res.status(409).json({ success: false, slotTaken: true, message: 'Lampas na ang oras na iyon. Pumili ng ibang oras.' });
            if (!sl.available) return res.status(409).json({ success: false, slotTaken: true, message: 'Puno na ang oras na iyon. Pumili ng ibang oras.' });
            appt = { date: ad, time: at };
        }
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
            note: cleanStr(body.note, 200),
            appt,
            items, total,
            itemCount: round2(items.reduce((a, i) => a + i.qty, 0)),
            createdAt: new Date().toISOString(),
            kioskDevice: cleanStr(body.device, 40),
            createdBy: req.authUser && req.authUser.username
        };
        const waitBefore = waitInfo(cfg, orders); // bago idagdag ang order na ito: ilan ang nauuna sa kanya
        orders.push(order);
        writeData(FILE_ORDERS, orders.length > ORDERS_CAP ? orders.slice(-ORDERS_CAP) : orders);
        try { logAction(req.authUser.username, `Kiosk order ${order.id} (${items.length} line(s), total ${total})`); } catch (e) { /* ignore */ }
        res.json({ success: true, order: { id: order.id, orderNo: order.orderNo, total, orderType, createdAt: order.createdAt, appt, wait: waitBefore } });
    });

    app.get('/api/kiosk/queue', gate, (req, res) => {
        noStore(res);
        const day = todayKey();
        const list = getOrders().filter(o => o.dayKey === day && (o.status === 'preparing' || o.status === 'ready'));
        res.json({
            success: true,
            preparing: list.filter(o => o.status === 'preparing').map(o => o.orderNo),
            ready: list.filter(o => o.status === 'ready').map(o => o.orderNo),
            wait: waitInfo(getConfig(), getOrders())
        });
    });

    app.get('/api/kiosk/orders', gate, (req, res) => {
        noStore(res);
        const status = String(req.query.status || 'open');
        const day = req.query.all === '1' ? null : todayKey();
        let list = getOrders().filter(o => !day || o.dayKey === day || OPEN_STATUSES.has(o.status));
        if (status === 'open') list = list.filter(o => OPEN_STATUSES.has(o.status));
        else if (ALL_STATUSES.has(status)) list = list.filter(o => o.status === status);
        res.json({ success: true, orders: list.slice(-300) });
    });

    app.post('/api/kiosk/orders/:id/status', gate, (req, res) => {
        const next = String((req.body || {}).status || '');
        if (!ALL_STATUSES.has(next)) return res.status(400).json({ success: false, message: 'Maling status.' });
        const orders = getOrders();
        const o = orders.find(x => x.id === req.params.id);
        if (!o) return res.status(404).json({ success: false, message: 'Hindi nahanap ang order.' });
        if (!OPEN_STATUSES.has(o.status) && !isAdmin(req)) return res.status(409).json({ success: false, message: 'Sarado na ang order na ito.' });
        o.status = next;
        o.statusAt = new Date().toISOString();
        o.statusBy = req.authUser && req.authUser.username;
        if (next === 'preparing' && !o.prepAt) o.prepAt = o.statusAt;
        if (next === 'ready' && !o.readyAt) o.readyAt = o.statusAt;
        if (next === 'done' && (req.body || {}).paidMethod) o.paidMethod = String(req.body.paidMethod).slice(0, 20);
        writeData(FILE_ORDERS, orders);
        try { logAction(req.authUser.username, `Kiosk order ${o.id} -> ${next}`); } catch (e) { /* ignore */ }
        res.json({ success: true, order: o });
    });

    app.get('/api/kiosk/summary', gate, (req, res) => {
        noStore(res);
        const day = todayKey();
        const list = getOrders().filter(o => o.dayKey === day);
        const valid = list.filter(o => o.status !== 'cancelled');
        const top = {};
        valid.forEach(o => o.items.forEach(i => {
            const t = top[i.code] || (top[i.code] = { code: i.code, name: i.name, qty: 0, sales: 0 });
            t.qty = round2(t.qty + i.qty); t.sales = round2(t.sales + i.lineTotal);
        }));
        const cfg = getConfig(), all = getOrders();
        const names = new Map((readProductsNoImages() || []).map(p => [String(p.code), p.name]));
        res.json({
            success: true,
            orders: valid.length,
            cancelled: list.length - valid.length,
            open: list.filter(o => OPEN_STATUSES.has(o.status)).length,
            sales: round2(valid.reduce((a, o) => a + o.total, 0)),
            top: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 10),
            hot: bestSellerCodes(cfg, all).map(c => ({ code: c, name: names.get(c) || c })),   // 🔥 best sellers (30 araw)
            wait: waitInfo(cfg, all),                                                          // tinatayang hintay ngayon (null kung serbisyo/naka-off)
            avgPrepMinutes: Math.round(avgPrepMinutes(cfg, all) * 10) / 10
        });
    });

    app.get('/api/kiosk/config', gate, (req, res) => { noStore(res); res.json({ success: true, config: getConfig() }); });
    app.put('/api/kiosk/config', gate, async (req, res) => {
        if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Admin lang ang pwedeng mag-edit ng kiosk settings.' });
        const cur = getConfig();
        const cfg = sanitizeConfig((req.body || {}).config, cur);
        // Ang pagpapalit ng Uri ng negosyo (na nagtatakda ng buttons/rules/order types) ay Developer PIN lang.
        if (cfg.businessType !== cur.businessType) {
            const chk = await checkDevPin(deps, (req.body || {}).devPin);
            if (!chk.ok) return res.status(403).json({ success: false, devPinRequired: true, message: 'Developer PIN ang kailangan para palitan ang Uri ng negosyo. ' + chk.message });
            cfg.modes = { ...BIZ_MODES[cfg.businessType] };
            try { logAction(req.authUser.username, 'Kiosk business type: ' + cur.businessType + ' -> ' + cfg.businessType); } catch (e) { /* ignore */ }
        }
        writeData(FILE_CONFIG, cfg);
        try { logAction(req.authUser.username, 'Updated Kiosk settings'); } catch (e) { /* ignore */ }
        res.json({ success: true, config: cfg });
    });
    app.post('/api/kiosk/dev-verify', gate, limit('kiosk-dev', 20, 10 * 60 * 1000), async (req, res) => {
        if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Admin lang.' });
        const chk = await checkDevPin(deps, (req.body || {}).devPin);
        res.status(chk.ok ? 200 : 403).json({ success: chk.ok, message: chk.message || '' });
    });
};
module.exports.sanitizeConfig = sanitizeConfig;
module.exports.BIZ_MODES = BIZ_MODES;
