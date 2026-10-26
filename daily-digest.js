// PATH: OMNIPOS/daily-digest.js
//
// Daily Owner Summary (additive — walang ginagalaw na existing route o data).
// Sinusunod ang parehong pattern ng kiosk.js: require('./daily-digest')({ ...deps }) sa dulo ng server.js.
//
//   GET /api/reports/daily-digest            benta ng ngayon (oras sa Pilipinas, UTC+8)
//   GET /api/reports/daily-digest?date=YYYY-MM-DD   benta ng piniling araw
//   GET /api/reports/daily-digest/config     setting ng awtomatikong email tuwing gabi (admin lang)
//   PUT /api/reports/daily-digest/config     { enabled, email, hour }  (admin lang)
//   POST /api/reports/daily-digest/send-now  magpadala ng email ngayon para masubukan (admin lang)
//
// AWTOMATIKONG EMAIL: kapag naka-enable, nagpapadala ng buod sa email ng may-ari tuwing {hour}:00 (oras sa Pilipinas),
// isang beses lang kada araw. Gumagamit ng parehong sender email ng OTP/fraud alert (Receipt Settings > OTP sender).
//
// Sagot: gross / refund / net, bilang ng transaksyon, average basket, hatian ng bayad (cash/GCash/card...),
// top items, benta kada oras, benta kada cashier, void count, at paghahambing sa kahapon at sa parehong
// araw noong nakaraang linggo. May kasamang "text" na handa nang i-copy sa Viber/Messenger/SMS ng may-ari.
//
// READ-ONLY: walang sinusulat sa database. Parehong net-of-refund rule ng computeRemoteOperationsPayload() sa server.js.

'use strict';

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;   // Asia/Manila = UTC+8, walang DST
const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function phDayKey(ms) { return new Date(ms + PH_OFFSET_MS).toISOString().slice(0, 10); }
function phHour(ms) { return new Date(ms + PH_OFFSET_MS).getUTCHours(); }
function dayStartMs(key) { return Date.parse(key + 'T00:00:00Z') - PH_OFFSET_MS; }
function shiftKey(key, days) { return phDayKey(dayStartMs(key) + days * DAY_MS + 12 * 60 * 60 * 1000); }
function isValidKey(k) { return /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(Date.parse(k + 'T00:00:00Z')); }
const peso = n => '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function netOf(tx) {
    const gross = Math.max(0, Number(tx.total) || 0);
    const refunded = tx.refundStatus === 'full' ? gross : Math.min(gross, Math.max(0, Number(tx.totalRefunded) || 0));
    return { gross, refunded, net: Math.max(0, gross - refunded) };
}

function summarize(txs, key) {
    const out = { date: key, transactions: 0, gross: 0, refunds: 0, net: 0, avgBasket: 0, payments: {}, topItems: [], hourly: {}, cashiers: {} };
    const items = {};
    for (const tx of txs) {
        const at = new Date(tx.isoDate || tx.createdAt || 0).getTime();
        if (!Number.isFinite(at) || at <= 0 || phDayKey(at) !== key) continue;
        const { gross, refunded, net } = netOf(tx);
        out.gross += gross; out.refunds += refunded; out.net += net;
        if (net > 0.009) out.transactions += 1;
        const pays = Array.isArray(tx.payments) && tx.payments.length ? tx.payments : [{ method: tx.payment_method || tx.method || 'UNKNOWN', amount: gross }];
        // Ang payments[].amount ng CASH ay madalas ang BINAYAD (bago ang sukli). Bawasan ng sobra para tumugma sa halaga ng benta.
        let excess = Math.max(0, pays.reduce((a, p) => a + (Number(p.amount) || 0), 0) - gross);
        for (const p of pays) {
            const m = String(p.method || 'UNKNOWN').toUpperCase();
            let amt = Number(p.amount) || 0;
            if (excess > 0 && m === 'CASH') { const cut = Math.min(excess, amt); amt -= cut; excess -= cut; }
            out.payments[m] = round2((out.payments[m] || 0) + amt);
        }
        const h = phHour(at);
        out.hourly[h] = round2((out.hourly[h] || 0) + net);
        const c = String(tx.cashierDisplayName || tx.cashier || 'Unknown');
        out.cashiers[c] = round2((out.cashiers[c] || 0) + net);
        if (refunded < gross) {
            for (const it of (Array.isArray(tx.items) ? tx.items : [])) {
                const code = String(it.code || it.name || '?');
                const t = items[code] || (items[code] = { code, name: it.name || code, qty: 0, sales: 0 });
                const q = Number(it.quantity) || 0;
                t.qty = round2(t.qty + q);
                t.sales = round2(t.sales + Math.max(0, (Number(it.price) || 0) * q - Math.max(0, Number(it.itemDiscount) || 0)));   // net ng item discount (halaga, hindi %)
            }
        }
    }
    out.gross = round2(out.gross); out.refunds = round2(out.refunds); out.net = round2(out.net);
    out.avgBasket = out.transactions ? round2(out.net / out.transactions) : 0;
    out.topItems = Object.values(items).sort((a, b) => b.qty - a.qty || b.sales - a.sales).slice(0, 5);
    return out;
}

function pctChange(now, before) {
    if (!before) return now > 0 ? null : 0;    // walang basehan — hindi makalkula ang %
    return Math.round(((now - before) / before) * 1000) / 10;
}

function buildText(storeName, d, cmp, voids) {
    const arrow = p => p == null ? '' : (p >= 0 ? ` (▲ ${p}%)` : ` (▼ ${Math.abs(p)}%)`);
    const lines = [];
    lines.push(`📊 ${storeName || 'OmniPOS'} — Benta ${d.date}`);
    lines.push(`Net sales: ${peso(d.net)}${arrow(cmp.vsYesterdayPct)} kumpara sa kahapon`);
    if (cmp.vsLastWeekPct != null) lines.push(`Kumpara sa parehong araw noong nakaraang linggo:${arrow(cmp.vsLastWeekPct).trim()}`);
    lines.push(`Transaksyon: ${d.transactions} • Average basket: ${peso(d.avgBasket)}`);
    if (d.refunds > 0) lines.push(`Refund: ${peso(d.refunds)}`);
    if (voids > 0) lines.push(`Void: ${voids}`);
    const pay = Object.entries(d.payments).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${peso(v)}`);
    if (pay.length) lines.push(`Bayad: ${pay.join(' • ')}`);
    if (d.topItems.length) lines.push(`Top: ${d.topItems.slice(0, 3).map(i => `${i.name} x${i.qty}`).join(', ')}`);
    const peak = Object.entries(d.hourly).sort((a, b) => b[1] - a[1])[0];
    if (peak && peak[1] > 0) lines.push(`Pinakamabentang oras: ${String(peak[0]).padStart(2, '0')}:00`);
    return lines.join('\n');
}

const FILE_CONFIG = 'dailyDigestConfig';
const DEFAULT_CONFIG = { enabled: false, email: '', hour: 21, lastSentDay: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function registerDailyDigest(deps) {
    const { app, readData, writeData, requirePermission, readRowsInIsoWindow, sendMail, logAction } = deps;
    const guard = typeof requirePermission === 'function' ? requirePermission('reports') : (req, res, next) => next();
    const isAdmin = req => String((req.authUser && req.authUser.role) || '').toLowerCase() === 'admin';
    const adminOnly = (req, res, next) => isAdmin(req) ? next() : res.status(403).json({ success: false, message: 'Admin lang ang puwedeng magbago nito.' });
    const getConfig = () => {
        let c = {};
        try { c = readData(FILE_CONFIG, {}) || {}; } catch (_e) { c = {}; }
        const hour = Number.isInteger(Number(c.hour)) && Number(c.hour) >= 0 && Number(c.hour) <= 23 ? Number(c.hour) : DEFAULT_CONFIG.hour;
        return { enabled: c.enabled === true, email: typeof c.email === 'string' ? c.email.trim() : '', hour, lastSentDay: typeof c.lastSentDay === 'string' ? c.lastSentDay : '' };
    };
    // Ibinabalik ang true kung talagang na-save (ang writeData ay nagre-return ng false kapag pumalya ang database).
    const saveConfig = c => { try { return typeof writeData === 'function' && writeData(FILE_CONFIG, c) !== false; } catch (_e) { return false; } };

    function loadWindow(startMs, endMs) {
        try {
            if (typeof readRowsInIsoWindow === 'function') {
                const rows = readRowsInIsoWindow('transactions', 'isoDate', startMs, endMs);
                if (Array.isArray(rows)) return rows;
            }
        } catch (_e) { /* fall back sa buong read */ }
        const all = readData('transactions', []);
        return Array.isArray(all) ? all : [];
    }

    function buildDigest(key) {
            const startMs = dayStartMs(shiftKey(key, -7));
            const endMs = dayStartMs(shiftKey(key, 1));
            const txs = loadWindow(startMs, endMs);
            const today = summarize(txs, key);
            const yKey = shiftKey(key, -1), wKey = shiftKey(key, -7);
            const yesterday = summarize(txs, yKey), lastWeek = summarize(txs, wKey);
            const cmp = {
                yesterday: { date: yKey, net: yesterday.net, transactions: yesterday.transactions },
                lastWeekSameDay: { date: wKey, net: lastWeek.net, transactions: lastWeek.transactions },
                vsYesterdayPct: pctChange(today.net, yesterday.net),
                vsLastWeekPct: pctChange(today.net, lastWeek.net)
            };
            let voids = 0;
            try {
                const v = readData('birVoids', []);
                if (Array.isArray(v)) voids = v.filter(x => {
                    const t = new Date((x && (x.isoDate || x.voidedAt || x.createdAt || x.timestamp)) || 0).getTime();
                    return Number.isFinite(t) && t > 0 && phDayKey(t) === key;
                }).length;
            } catch (_e) { /* optional */ }
            let storeName = '';
            try { const s = readData('storeSettings', {}); storeName = (s && (s.storeName || s.name)) || ''; } catch (_e) { /* optional */ }
            return { success: true, ...today, voids, comparison: cmp, text: buildText(storeName, today, cmp, voids), storeName };
    }

    app.get('/api/reports/daily-digest', guard, (req, res) => {
        try {
            res.set('Cache-Control', 'no-store');
            const key = req.query.date ? String(req.query.date) : phDayKey(Date.now());
            if (!isValidKey(key)) return res.status(400).json({ success: false, message: 'Invalid date. Use YYYY-MM-DD.' });
            res.json(buildDigest(key));
        } catch (e) {
            console.error('daily-digest error:', e && e.message);
            res.status(500).json({ success: false, message: 'Failed to build daily digest.' });
        }
    });

    app.get('/api/reports/daily-digest/config', guard, adminOnly, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, config: getConfig(), emailAvailable: typeof sendMail === 'function' });
    });

    app.put('/api/reports/daily-digest/config', guard, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const cur = getConfig();
            const next = { ...cur };
            if (b.enabled !== undefined) next.enabled = b.enabled === true;
            if (b.email !== undefined) next.email = String(b.email || '').trim().slice(0, 200);
            if (b.hour !== undefined) {
                const h = Number(b.hour);
                if (!Number.isInteger(h) || h < 0 || h > 23) return res.status(400).json({ success: false, message: 'Ang oras ay dapat 0 hanggang 23.' });
                next.hour = h;
            }
            if (next.enabled && !EMAIL_RE.test(next.email)) return res.status(400).json({ success: false, message: 'Maglagay ng tamang email address para ma-enable.' });
            if (next.enabled && !cur.enabled) next.lastSentDay = '';   // i-enable ngayon: payagan ang pagpapadala sa araw na ito kung lampas na ang oras
            if (!saveConfig(next)) return res.status(500).json({ success: false, message: 'Hindi na-save ang settings (database error). Subukan ulit.' });
            try { if (typeof logAction === 'function') logAction(req.authUser.username, `Daily Summary email ${next.enabled ? 'ENABLED (' + next.hour + ':00)' : 'DISABLED'}`); } catch (_e) { /* optional */ }
            res.json({ success: true, config: next });
        } catch (e) {
            console.error('daily-digest config error:', e && e.message);
            res.status(500).json({ success: false, message: 'Failed to save settings.' });
        }
    });

    async function emailDigest(to, key) {
        if (typeof sendMail !== 'function') throw new Error('Email sender is not available.');
        const d = buildDigest(key);
        await sendMail(to, `📊 ${d.storeName || 'OmniPOS'} — Benta ${key}`, d.text);
        return d;
    }

    app.post('/api/reports/daily-digest/send-now', guard, adminOnly, async (req, res) => {
        try {
            const cfg = getConfig();
            const to = String((req.body && req.body.email) || cfg.email || '').trim();
            if (!EMAIL_RE.test(to)) return res.status(400).json({ success: false, message: 'Maglagay muna ng tamang email address.' });
            await emailDigest(to, phDayKey(Date.now()));
            res.json({ success: true, message: 'Naipadala na ang summary sa ' + to });
        } catch (e) {
            res.status(502).json({ success: false, message: 'Hindi naipadala: ' + ((e && e.message) || 'unknown error') + ' (I-check ang OTP sender email sa Receipt Settings.)' });
        }
    });

    // Scheduler: tuwing 60s, tingnan kung oras na (PH time) at hindi pa napapadala ngayong araw.
    let sending = false, retryAfter = 0;
    async function tick() {
        if (sending || Date.now() < retryAfter) return;
        try {
            const cfg = getConfig();
            if (!cfg.enabled || !EMAIL_RE.test(cfg.email) || typeof sendMail !== 'function') return;
            const now = Date.now(), key = phDayKey(now);
            if (cfg.lastSentDay === key || phHour(now) < cfg.hour) return;
            sending = true;
            // I-mark muna bago ipadala para hindi magdoble kung bumagal ang email; ibabalik kapag nabigo para maulit sa susunod na tick.
            if (!saveConfig({ ...cfg, lastSentDay: key })) { retryAfter = Date.now() + 15 * 60 * 1000; console.error('Daily Summary: hindi ma-save ang status — hindi muna magpapadala para hindi madoble.'); return; }
            try {
                await emailDigest(cfg.email, key);
                if (typeof logAction === 'function') logAction('Daily Summary', `Email sent to ${cfg.email} for ${key}`);
            } catch (err) {
                const latest = getConfig();
                if (latest.lastSentDay === key) saveConfig({ ...latest, lastSentDay: cfg.lastSentDay });
                retryAfter = Date.now() + 15 * 60 * 1000;   // subukan ulit pagkalipas ng 15 minuto
                console.error('Daily Summary email failed (uulitin sa loob ng 15 minuto):', err && err.message);
            }
        } catch (e) {
            console.error('Daily Summary scheduler error:', e && e.message);
        } finally { sending = false; }
    }
    const timer = setInterval(tick, 60 * 1000);
    if (timer && typeof timer.unref === 'function') timer.unref();
    module.exports._tick = tick;
};

module.exports._test = { summarize, phDayKey, dayStartMs, shiftKey, pctChange, buildText };
