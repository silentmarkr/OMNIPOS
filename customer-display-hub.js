'use strict';
// OMNIPOS Customer Display Hub: relays live POS cart events to Android customer-display devices (SSE).
const crypto = require('crypto');

const VALID_TYPES = new Set(['cart', 'ewallet', 'paid', 'idle-content']);
const VALID_LAYOUTS = ['ledger', 'receipt', 'hero', 'spotlight'];
const MAX_PAYLOAD_BYTES = 3 * 1024 * 1024;
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

function safeEqual(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function cleanId(v) {
    const s = String(v || '').trim().slice(0, 40);
    return /^[A-Za-z0-9_.-]+$/.test(s) ? s : '';
}

function register(app, { requirePermission, getSettings }) {
    const failures = new Map(); // ip -> [timestamps] of wrong pairing codes (brute-force guard)
    const terminals = new Map();
    const allClients = new Set();

    function entry(id) {
        if (!terminals.has(id)) terminals.set(id, { clients: new Set(), last: {}, lastAt: 0 });
        return terminals.get(id);
    }
    function configOf(s) {
        return {
            enabled: !!s.customerDisplayEnabled && s.customerDisplayMode !== 'window',
            layout: VALID_LAYOUTS.includes(s.customerDisplayLayout) ? s.customerDisplayLayout : 'ledger',
            compactThreshold: s.customerDisplayCompactThreshold || 8
        };
    }
    function send(res, event, data) {
        try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (_e) { /* client gone */ }
    }
    function activeIds() {
        const now = Date.now();
        return [...terminals.entries()].filter(([, t]) => now - t.lastAt < ACTIVE_WINDOW_MS).map(([id]) => id);
    }

    // Public (no login): lets the Android app recognise this server during LAN auto-scan. Reveals no secrets.
    app.get('/api/customer-display/ping', (req, res) => {
        const s = getSettings();
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true, omnipos: true, customerDisplay: true,
            enabled: configOf(s).enabled,
            pairConfigured: /^\d{6}$/.test(s.customerDisplayPairCode || ''),
            terminals: activeIds()
        });
    });

    // Called by the POS terminal (logged-in cashier) on every cart / payment / idle event.
    app.post('/api/customer-display/push', requirePermission('terminal'), (req, res) => {
        const s = getSettings();
        const cfg = configOf(s);
        if (!cfg.enabled) return res.json({ success: true, skipped: true });
        const body = req.body || {};
        const id = cleanId(body.terminal) || 'main';
        if (!VALID_TYPES.has(body.type)) return res.status(400).json({ success: false, message: 'Invalid display event type.' });
        let size = 0;
        try { size = Buffer.byteLength(JSON.stringify(body.data || {})); } catch (_e) { size = Infinity; }
        if (size > MAX_PAYLOAD_BYTES) return res.status(413).json({ success: false, message: 'Display payload too large.' });
        const msg = { type: body.type, data: body.data || {}, at: Date.now() };
        const t = entry(id);
        t.lastAt = msg.at;
        if (msg.type === 'cart' || msg.type === 'ewallet' || msg.type === 'paid') t.last.state = msg;
        else t.last[msg.type] = msg;
        for (const c of t.clients) send(c, 'msg', msg);
        for (const c of allClients) send(c, 'msg', { ...msg, terminal: id });
        res.json({ success: true, delivered: t.clients.size + allClients.size });
    });

    // Called by the Android display. Protected by the 6-digit pairing code set in Advanced Settings.
    app.get('/api/customer-display/stream', (req, res) => {
        const s = getSettings();
        const code = s.customerDisplayPairCode || '';
        if (!/^\d{6}$/.test(code)) return res.status(403).json({ success: false, message: 'Set a 6-digit pairing code in Advanced Settings first.' });
        const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
        const now0 = Date.now();
        const recent = (failures.get(ip) || []).filter(ts => now0 - ts < 60000);
        if (recent.length >= 10) return res.status(429).json({ success: false, message: 'Too many wrong codes. Wait a minute and try again.' });
        if (!safeEqual(req.query.code, code)) {
            recent.push(now0);
            failures.set(ip, recent);
            return res.status(401).json({ success: false, message: 'Wrong pairing code.' });
        }
        const wanted = String(req.query.terminal || 'any');
        const any = wanted === 'any';
        const id = any ? null : cleanId(wanted);
        if (!any && !id) return res.status(400).json({ success: false, message: 'Invalid terminal.' });

        res.writeHead(200, {
            'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform',
            'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
        });
        let lastCfg = JSON.stringify(configOf(s));
        send(res, 'config', JSON.parse(lastCfg));
        const sources = any ? [...terminals.values()] : [entry(id)];
        for (const t of sources) {
            if (t.last['idle-content']) send(res, 'msg', t.last['idle-content']);
            if (t.last.state) send(res, 'msg', t.last.state);
        }
        const bucket = any ? allClients : entry(id).clients;
        bucket.add(res);
        const beat = setInterval(() => {
            try { res.write(': hb\n\n'); } catch (_e) { /* ignore */ }
            const now = JSON.stringify(configOf(getSettings()));
            if (now !== lastCfg) { lastCfg = now; send(res, 'config', JSON.parse(now)); }
        }, 5000);
        res.on('close', () => { clearInterval(beat); bucket.delete(res); });
    });
}

module.exports = { register, VALID_LAYOUTS };
