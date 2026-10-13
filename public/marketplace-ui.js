/* OMNIPOS public/marketplace-ui.js — Marketplace Hub (Shopee / Lazada / TikTok Shop)
 * Self-contained UI for #view-marketplace. Gamit ang authFetch/API_URL/escapeHtml/Swal ng app.js.
 * Entry points na tinatawag ng switchView(): OmniMarketplace.open() / .close(). */
(function () {
    'use strict';
    if (window.OmniMarketplace) return;

    const PLATFORMS = [
        { id: 'shopee', label: 'Shopee', color: '#ee4d2d', icon: 'fa-bag-shopping' },
        { id: 'lazada', label: 'Lazada', color: '#0f146d', icon: 'fa-cart-shopping' },
        { id: 'tiktok', label: 'TikTok Shop', color: '#111111', icon: 'fa-music' }
    ];
    const STATUS = {
        unpaid: ['Unpaid', '#64748b'], to_ship: ['To ship', '#b45309'], shipped: ['Shipped', '#2563eb'],
        completed: ['Completed', '#15803d'], cancelled: ['Cancelled', '#dc2626'], returned: ['Returned', '#9333ea']
    };
    const S = { tab: 'connections', overview: null, orders: [], links: [], listings: [], listingCursor: null, listingConn: '', products: null, filters: { platform: 'all', status: 'to_ship', q: '' }, poll: null, timer: null, busy: false, locked: false };

    const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const base = () => (typeof API_URL !== 'undefined' ? API_URL : '/api');
    const money = (n) => '₱' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const ago = (ms) => { if (!ms) return '—'; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ms).toLocaleString(); };
    const root = () => document.getElementById('mp-root');
    const isApk = () => !!(window.OmniAndroid || /OmniPOS-APK/.test(navigator.userAgent || ''));
    const editing = () => { const a = document.activeElement; const r = root(); return !!(a && r && r.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)); };
    const toast = (icon, title, text) => { if (typeof Swal !== 'undefined') Swal.fire({ icon, title, text, timer: icon === 'success' ? 1800 : undefined, showConfirmButton: icon !== 'success' }); else alert(`${title}\n${text || ''}`); };

    async function api(path, opts = {}) {
        const o = { method: opts.method || 'GET', headers: {} };
        if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
        if (opts.timeoutMs) o.timeoutMs = opts.timeoutMs;
        const res = await authFetch(`${base()}${path}`, o);
        if (opts.raw) return res;
        let data = {}; try { data = await res.json(); } catch (_) { /* empty */ }
        if (res.status === 402 && data.featureLocked) S.locked = true; // authFetch na ang nagpapakita ng subscription prompt
        if (!res.ok && data.success === undefined) data.success = false;
        data.__status = res.status;
        return data;
    }

    function injectStyle() {
        if (document.getElementById('mp-style')) return;
        const st = document.createElement('style'); st.id = 'mp-style';
        st.textContent = `
#mp-root{padding:4px 2px 40px;color:var(--mp-text);color-scheme:light;
--mp-text:#1e293b;--mp-muted:#64748b;--mp-border:#e2e8f0;--mp-card:#ffffff;--mp-soft:rgba(100,116,139,.08);--mp-input-bg:#ffffff;
--mp-accent:#2563eb;--mp-accent-ink:#ffffff;--mp-accent-soft:#eff6ff;--mp-ok:#15803d;--mp-bad:#dc2626;--mp-warn:#b45309;
--mp-note-bg:#fff7e6;--mp-note-border:#fcd9a1;--mp-note-ink:#8a5a00;--mp-radius:12px;--mp-radius-sm:8px}
body.dark-mode #mp-root{color-scheme:dark;--mp-text:var(--dm-text-primary,#f5f5f7);--mp-muted:var(--dm-text-secondary,#9a9ba8);
--mp-border:var(--dm-border,#262733);--mp-card:var(--dm-surface,#1c1c24);--mp-soft:var(--dm-surface-alt,#22232d);--mp-input-bg:var(--dm-bg,#121218);
--mp-accent:var(--dm-accent,#7c5cff);--mp-accent-soft:var(--dm-accent-soft,rgba(124,92,255,.16));--mp-ok:#4ade80;--mp-bad:#f87171;--mp-warn:#fbbf24;
--mp-note-bg:rgba(251,191,36,.12);--mp-note-border:rgba(251,191,36,.38);--mp-note-ink:#fcd34d;--mp-radius:var(--dm-radius-lg,12px);--mp-radius-sm:var(--dm-radius-sm,8px)}
#mp-root a{color:var(--mp-accent)}
#mp-root label{color:var(--mp-text)}
#mp-root input[type=checkbox]{accent-color:var(--mp-accent)}
.mp-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:14px}
.mp-head h2{margin:0;font-size:1.35rem;color:var(--mp-text)}
.mp-sub{font-size:.8rem;color:var(--mp-muted)}
.mp-tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--mp-border);margin-bottom:16px}
.mp-tab{padding:9px 14px;border:0;background:none;font-weight:600;color:var(--mp-muted);cursor:pointer;border-bottom:3px solid transparent}
.mp-tab:hover{color:var(--mp-text)}
.mp-tab.on{color:var(--mp-accent);border-bottom-color:var(--mp-accent)}
.mp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.mp-card{background:var(--mp-card);border:1px solid var(--mp-border);border-radius:var(--mp-radius);padding:16px;color:var(--mp-text)}
.mp-card h3{margin:0 0 6px;font-size:1rem;display:flex;align-items:center;gap:8px;color:var(--mp-text)}
.mp-plogo{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;color:#fff;font-size:.8rem;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
.mp-conn{margin:8px 0;padding:8px;border:1px solid var(--mp-border);border-radius:var(--mp-radius-sm);background:var(--mp-soft)}
.mp-btn{border:1px solid var(--mp-border);background:var(--mp-card);color:var(--mp-text);border-radius:var(--mp-radius-sm);padding:7px 12px;font-weight:600;cursor:pointer;font-size:.85rem}
.mp-btn:hover:not(:disabled){border-color:var(--mp-accent);color:var(--mp-accent)}
.mp-btn.pri{background:var(--mp-accent);color:var(--mp-accent-ink);border-color:var(--mp-accent)}
.mp-btn.pri:hover:not(:disabled){color:var(--mp-accent-ink);filter:brightness(1.08)}
.mp-btn.dng{color:var(--mp-bad)}
.mp-btn.dng:hover:not(:disabled){border-color:var(--mp-bad);color:var(--mp-bad)}
.mp-btn:disabled{opacity:.55;cursor:default}
.mp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.mp-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:700;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
.mp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.mp-kpi b{display:block;font-size:1.5rem;color:var(--mp-text)}.mp-kpi span{font-size:.75rem;color:var(--mp-muted)}
.mp-table-wrap{overflow:auto;border:1px solid var(--mp-border);border-radius:var(--mp-radius);background:var(--mp-card)}
.mp-table{width:100%;border-collapse:collapse;font-size:.85rem;color:var(--mp-text)}
.mp-table th,.mp-table td{padding:9px 10px;border-bottom:1px solid var(--mp-border);text-align:left;vertical-align:top;color:var(--mp-text)}
.mp-table th{font-size:.72rem;text-transform:uppercase;color:var(--mp-muted);background:var(--mp-soft)}
.mp-table .mp-sub{color:var(--mp-muted)}
.mp-in{border:1px solid var(--mp-border);border-radius:var(--mp-radius-sm);padding:6px 8px;font-size:.85rem;max-width:100%;background:var(--mp-input-bg);color:var(--mp-text)}
.mp-in::placeholder{color:var(--mp-muted);opacity:.8}
.mp-in:focus{outline:none;border-color:var(--mp-accent);box-shadow:0 0 0 3px var(--mp-accent-soft)}
.mp-in option{background:var(--mp-input-bg);color:var(--mp-text)}
.mp-note{background:var(--mp-note-bg);border:1px solid var(--mp-note-border);color:var(--mp-note-ink);border-radius:10px;padding:10px 12px;font-size:.82rem;margin-bottom:14px}
.mp-note b{color:inherit}
.mp-warn{color:var(--mp-warn);font-size:.78rem}.mp-ok{color:var(--mp-ok);font-size:.78rem}.mp-bad{color:var(--mp-bad);font-size:.78rem}
.mp-empty{padding:28px;text-align:center;color:var(--mp-muted)}
@media(max-width:700px){.mp-table th:nth-child(n+5),.mp-table td:nth-child(n+5){font-size:.8rem}}`;
        document.head.appendChild(st);
    }

    // Kinukuha ang accent ng kasalukuyang theme at pinipili ang itim/puting text na mababasa sa ibabaw nito
    // (hal. ang Ocean/Mint na maliwanag na accent ay hindi puti ang text).
    function readableInk(cssColor) {
        try {
            const el = document.createElement('span'); el.style.color = cssColor; document.body.appendChild(el);
            const m = (getComputedStyle(el).color || '').match(/[\d.]+/g); el.remove();
            if (!m || m.length < 3) return '#ffffff';
            const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
            const L = 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
            return L > 0.4 ? '#0b1220' : '#ffffff';
        } catch (_) { return '#ffffff'; }
    }
    function syncThemeInk() {
        const r = root(); if (!r) return;
        const dark = document.body.classList.contains('dark-mode');
        const accent = dark ? (getComputedStyle(document.body).getPropertyValue('--dm-accent') || '').trim() : '#2563eb';
        r.style.setProperty('--mp-accent-ink', accent ? readableInk(accent) : '#ffffff');
    }
    let themeWatch = null;
    function watchTheme() {
        if (themeWatch || typeof MutationObserver === 'undefined') return;
        themeWatch = new MutationObserver(() => syncThemeInk());
        themeWatch.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
    function platformMeta(id) { return PLATFORMS.find((p) => p.id === id) || { label: id, color: '#475569', icon: 'fa-store' }; }
    const badge = (id) => { const p = platformMeta(id); return `<span class="mp-pill" style="background:${p.color}">${esc(p.label)}</span>`; };
    const stChip = (s) => { const [t, c] = STATUS[s] || [s, '#64748b']; return `<span class="mp-pill" style="background:${c}">${esc(t)}</span>`; };
    const conns = () => (S.overview && S.overview.connections) || [];
    const activeConns = () => conns().filter((c) => c.status === 'active');

    // ------------------------------------------------------------------ shell
    function shell(inner) {
        const o = S.overview; const ls = o && o.lastSync;
        const tabs = [['connections', 'Connections'], ['orders', 'Orders'], ['links', 'Products & Links'], ['settings', 'Settings']];
        const review = o && o.counts ? o.counts.review : 0;
        root().innerHTML = `
<div class="mp-head"><div><h2><i class="fa-solid fa-store"></i> Marketplace Hub</h2>
<div class="mp-sub">${ls ? `Last sync ${ago(ls.at)} — ${ls.ok ? '<span class="mp-ok">OK</span>' : '<span class="mp-bad">with errors</span>'}` : 'Not synced yet'}${o && o.syncing ? ' · syncing…' : ''}</div></div>
<div class="mp-row"><button class="mp-btn pri" id="mp-sync" ${S.busy ? 'disabled' : ''}><i class="fa-solid fa-rotate"></i> Sync now</button></div></div>
<div class="mp-tabs">${tabs.map(([k, l]) => `<button class="mp-tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}${k === 'orders' && review ? ` <span class="mp-pill" style="background:#dc2626">${review}</span>` : ''}</button>`).join('')}</div>
<div id="mp-body">${inner}</div>`;
        root().querySelectorAll('.mp-tab').forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; render(); });
        root().querySelector('#mp-sync').onclick = () => syncNow(false);
    }

    async function syncNow(force) {
        if (S.busy) return; S.busy = true; render();
        const d = await api('/marketplace/sync', { method: 'POST', body: { force }, timeoutMs: 180000 });
        S.busy = false;
        if (d.summary) {
            const s = d.summary;
            const parts = [`${s.newOrders} new order(s)`, `${s.updatedOrders} updated`, `${s.pushed} stock/price update(s) pushed`];
            if (s.unmapped) parts.push(`${s.unmapped} unmapped item(s)`);
            if (s.shortages) parts.push(`${s.shortages} short on stock`);
            toast(d.success ? 'success' : 'warning', d.success ? 'Sync complete' : 'Sync finished with issues', d.success ? parts.join(' · ') : (d.message || '') + '\n' + parts.join(' · '));
        } else if (!d.featureLocked) toast('error', 'Sync failed', d.message || 'Unknown error');
        await refresh(true);
    }

    async function refresh(full) {
        const d = await api(`/marketplace/overview${full ? '?refresh=1' : ''}`);
        if (d.success) S.overview = d;
        else if (d.__status === 402) { clearInterval(S.timer); clearInterval(S.poll); return; }
        else S.overview = S.overview || { connections: [], platforms: [], counts: {}, relayError: d.message };
        if (S.tab === 'orders') await loadOrders(); else if (S.tab === 'links') await loadLinks();
        render();
    }

    // ----------------------------------------------------------- connections
    function viewConnections() {
        const o = S.overview || { counts: {}, platforms: [] };
        const cards = PLATFORMS.map((p) => {
            const meta = (o.platforms || []).find((x) => x.id === p.id) || { configured: true };
            const mine = conns().filter((c) => c.platform === p.id);
            const body = mine.length ? mine.map((c) => `
<div class="mp-conn">
<b>${esc(c.shopName || c.shopId)}</b> <span class="${c.status === 'active' ? 'mp-ok' : 'mp-bad'}">${c.status === 'active' ? '● Connected' : '● Reconnect needed'}</span>
<div class="mp-sub">Shop ID ${esc(c.shopId)} · since ${new Date(c.connectedAt).toLocaleDateString()}</div>
${c.lastError ? `<div class="mp-bad">${esc(c.lastError)}</div>` : ''}
<div class="mp-row" style="margin-top:6px">${c.status !== 'active' ? `<button class="mp-btn pri" data-connect="${p.id}">Reconnect</button>` : ''}<button class="mp-btn dng" data-disc="${p.id}|${esc(c.shopId)}">Disconnect</button></div></div>`).join('')
                : `<div class="mp-sub" style="margin:8px 0">${meta.configured ? 'Not connected.' : '<span class="mp-warn">Not yet enabled by the developer (app credentials missing on the relay).</span>'}</div>`;
            return `<div class="mp-card"><h3><span class="mp-plogo" style="background:${p.color}"><i class="fa-solid ${p.icon}"></i></span> ${p.label}</h3>${body}
<button class="mp-btn ${mine.length ? '' : 'pri'}" data-connect="${p.id}" ${meta.configured ? '' : 'disabled'}><i class="fa-solid fa-link"></i> ${mine.length ? 'Connect another shop' : 'Connect shop'}</button></div>`;
        }).join('');
        const c = o.counts || {};
        return `${o.relayError ? `<div class="mp-note">Could not reach the relay: ${esc(o.relayError)}</div>` : ''}
<div class="mp-kpis">
<div class="mp-card mp-kpi"><b>${c.toShip || 0}</b><span>Orders to ship</span></div>
<div class="mp-card mp-kpi"><b>${c.links || 0}</b><span>Linked products</span></div>
<div class="mp-card mp-kpi"><b>${c.unmapped || 0}</b><span>Orders with unlinked items</span></div>
<div class="mp-card mp-kpi"><b>${c.review || 0}</b><span>Need your review</span></div></div>
<div class="mp-grid">${cards}</div>
<div class="mp-note" style="margin-top:16px">How it works: connect a shop, link your marketplace listings to POS products (Products &amp; Links), and OmniPOS will import paid orders, deduct stock, and keep each listing's stock in step with your POS. Orders placed before you connected are shown for label printing but their stock is <b>not</b> deducted.</div>`;
    }

    async function startConnect(platform) {
        // Browser: buksan muna ang blank tab (kailangan pa ang user gesture); APK: external browser ang bubukas pagkatapos.
        const w = isApk() ? null : window.open('', '_blank');
        const d = await api('/marketplace/connect', { method: 'POST', body: { platform } });
        if (!d.success || !d.url) { if (w) w.close(); if (!d.featureLocked) toast('error', 'Cannot connect', d.message || 'Failed.'); return; }
        let opened = false;
        try {
            if (w && !w.closed) { w.location.href = d.url; opened = true; }
            else { const w2 = window.open(d.url, '_blank'); opened = !!w2; }
        } catch (_) { opened = false; }
        if (!opened && typeof Swal !== 'undefined') {
            await Swal.fire({ icon: 'info', title: 'Open the authorization page', html: `<a href="${esc(d.url)}" target="_blank" rel="noopener">Tap here to continue to ${esc(platformMeta(platform).label)}</a>` });
        } else if (!opened) window.location.href = d.url;
        const before = conns().length; const started = Date.now();
        clearInterval(S.poll);
        S.poll = setInterval(async () => {
            if (document.hidden) return;
            await refresh(true);
            if (conns().length > before) { clearInterval(S.poll); toast('success', 'Shop connected', ''); syncNow(false); }
            else if (Date.now() - started > 10 * 60 * 1000) clearInterval(S.poll);
        }, 3000);
    }

    // ---------------------------------------------------------------- orders
    async function loadOrders() {
        const f = S.filters; const q = new URLSearchParams({ platform: f.platform, status: f.status === 'review' ? 'all' : f.status, q: f.q });
        if (f.status === 'review') q.set('review', '1');
        const d = await api(`/marketplace/orders?${q}`); S.orders = d.success ? d.orders : [];
    }
    function stockCell(o) {
        if (o.restocked) return '<span class="mp-ok">Restocked</span>';
        if (o.preConnection) return '<span class="mp-sub">Before connect — not deducted</span>';
        if (o.stockDeducted) {
            const short = (o.deductions || []).reduce((s, d) => s + (d.short || 0), 0);
            return `<span class="mp-ok">Deducted</span>${short ? `<div class="mp-warn">${short} short — stock ran out</div>` : ''}`;
        }
        if (o.status === 'unpaid') return '<span class="mp-sub">Waiting for payment</span>';
        return '<span class="mp-warn">Not deducted</span>';
    }
    function viewOrders() {
        const f = S.filters;
        const sel = (id, opts, val) => `<select class="mp-in" id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        const rows = S.orders.map((o) => {
            const unm = (o.unmapped || []).length ? `<div class="mp-warn">${o.unmapped.length} item(s) not linked to a POS product</div>` : '';
            const canLabel = ['to_ship', 'shipped', 'completed'].includes(o.status);
            return `<tr><td>${badge(o.platform)}<div><b>${esc(o.orderNo)}</b></div><div class="mp-sub">${new Date(o.createdAt).toLocaleString()}</div></td>
<td>${esc(o.buyer || '—')}</td>
<td>${(o.items || []).map((i) => `${esc(i.name)}${i.variation ? ` (${esc(i.variation)})` : ''} × ${i.qty}${i.sku ? ` <span class="mp-sub">[${esc(i.sku)}]</span>` : ''}`).join('<br>')}</td>
<td>${money(o.total)}</td><td>${stChip(o.status)}${o.cancelRequested ? '<div class="mp-warn">Cancel requested</div>' : ''}${o.trackingNumber ? `<div class="mp-sub">${esc(o.carrier || '')} ${esc(o.trackingNumber)}</div>` : ''}</td>
<td>${stockCell(o)}${unm}${o.review ? `<div class="mp-bad">Needs review: ${o.review === 'returned' ? 'returned by buyer' : 'cancelled after shipping'}</div>` : ''}</td>
<td><div class="mp-row">${canLabel ? `<button class="mp-btn" data-label="${esc(o.key)}" data-arrange="0"><i class="fa-solid fa-print"></i> Label</button>` : ''}${o.status === 'to_ship' && !o.trackingNumber ? `<button class="mp-btn pri" data-label="${esc(o.key)}" data-arrange="1" title="Arrange shipment with the marketplace, then print">Arrange &amp; print</button>` : ''}
${o.review ? `<button class="mp-btn" data-rv="restock|${esc(o.key)}">Restock</button><button class="mp-btn" data-rv="dismiss|${esc(o.key)}">Dismiss</button>` : ''}</div></td></tr>`;
        }).join('');
        return `<div class="mp-row" style="margin-bottom:12px">
${sel('mp-f-platform', [['all', 'All platforms'], ...PLATFORMS.map((p) => [p.id, p.label])], f.platform)}
${sel('mp-f-status', [['to_ship', 'To ship'], ['all', 'All statuses'], ['unpaid', 'Unpaid'], ['shipped', 'Shipped'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['returned', 'Returned'], ['review', 'Needs review']], f.status)}
<input class="mp-in" id="mp-f-q" placeholder="Search order #, buyer, SKU…" value="${esc(f.q)}"></div>
<div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Order</th><th>Buyer</th><th>Items</th><th>Total</th><th>Status</th><th>POS stock</th><th></th></tr></thead>
<tbody>${rows || `<tr><td colspan="7" class="mp-empty">No orders match. Connect a shop and press “Sync now”.</td></tr>`}</tbody></table></div>`;
    }
    async function printLabel(key, arrange) {
        const apk = isApk();
        const w = apk ? null : window.open('', '_blank');
        if (w) { try { w.document.write('<p style="font-family:sans-serif;padding:20px">Preparing shipping label…</p>'); } catch (_) { /* ignore */ } }
        let res;
        try { res = await api(`/marketplace/orders/${encodeURIComponent(key)}/label`, { method: 'POST', body: { arrange }, raw: true, timeoutMs: 150000 }); }
        catch (e) { if (w) w.close(); toast('error', 'Label unavailable', e.message || 'Network error.'); return; }
        if (!res.ok) {
            let m = 'Could not get the label.'; try { m = (await res.json()).message || m; } catch (_) { /* ignore */ }
            if (w) w.close(); if (res.status !== 402) toast('error', 'Label unavailable', m); return;
        }
        const blob = await res.blob();
        const type = (blob.type || '').toLowerCase();
        const ext = type.includes('pdf') ? 'pdf' : type.includes('zip') ? 'zip' : 'html';
        const name = `label-${String(key).replace(/[^\w.-]+/g, '_')}.${ext}`;
        const url = URL.createObjectURL(blob);
        if (apk) {
            // WebView ng APK: walang PDF viewer — i-save sa Downloads (may "Open" button) gamit ang download interception ng Shim.
            const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        } else if (w && !w.closed) w.location.href = url;
        else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
        setTimeout(() => loadOrders().then(render), 800);
    }
    async function reviewOrder(action, key) {
        if (action === 'restock' && typeof Swal !== 'undefined') {
            const r = await Swal.fire({ icon: 'question', title: 'Put the items back in stock?', text: 'Only do this if the parcel was physically returned and is sellable.', showCancelButton: true, confirmButtonText: 'Restock' });
            if (!r.isConfirmed) return;
        }
        const d = await api(`/marketplace/orders/${encodeURIComponent(key)}/review`, { method: 'POST', body: { action } });
        if (!d.success) toast('error', 'Failed', d.message); await refresh(false);
    }

    // ---------------------------------------------------------- products & links
    async function ensureProducts() {
        if (S.products) return;
        try { const r = await authFetch(`${base()}/products?lite=1`); const j = await r.json(); S.products = (Array.isArray(j) ? j : []).map((p) => ({ code: p.code, name: p.name, stock: p.stock })); } catch (_) { S.products = []; }
    }
    async function loadLinks() { await ensureProducts(); const d = await api('/marketplace/links'); S.links = d.success ? d.links : []; }
    function viewLinks() {
        const ac = activeConns();
        const dl = `<datalist id="mp-products">${(S.products || []).map((p) => `<option value="${esc(p.code)}">${esc(p.name)} (stock ${esc(p.stock)})</option>`).join('')}</datalist>`;
        const linkRows = S.links.map((l) => `<tr data-link="${esc(l.id)}"><td>${badge(l.platform)}<div>${esc(l.listingName || l.itemId)}</div><div class="mp-sub">${esc(l.sku || '')}</div></td>
<td><b>${esc(l.productName || '— missing —')}</b><div class="mp-sub">${esc(l.productCode)} · POS stock ${l.productStock == null ? '—' : esc(l.productStock)}</div></td>
<td><input class="mp-in" style="width:56px" data-f="qtyMultiplier" type="number" min="1" value="${l.qtyMultiplier || 1}" title="POS units used by 1 listing unit (e.g. 6 for a 6-pack)"></td>
<td><input class="mp-in" style="width:56px" data-f="stockBuffer" type="number" min="0" value="${l.stockBuffer || 0}" title="Hold back this many units"></td>
<td><label><input type="checkbox" data-f="pushStock" ${l.pushStock !== false ? 'checked' : ''}> stock</label><br><label><input type="checkbox" data-f="pushPrice" ${l.pushPrice ? 'checked' : ''}> price</label>
<div><input class="mp-in" style="width:64px" data-f="priceMarkupPct" type="number" step="0.5" value="${l.priceMarkupPct || 0}" title="Markup % over POS price"> %</div></td>
<td class="mp-sub">${l.lastPushedAt ? `Pushed ${ago(l.lastPushedAt)}<br>Stock ${l.lastPushedStock == null ? '—' : l.lastPushedStock}` : 'Not pushed'}${l.lastError ? `<div class="mp-bad">${esc(l.lastError)}</div>` : ''}</td>
<td><div class="mp-row"><button class="mp-btn pri" data-lsave="${esc(l.id)}">Save</button><button class="mp-btn" data-lpush="${esc(l.id)}">Push now</button><button class="mp-btn dng" data-lrm="${esc(l.id)}">Unlink</button></div></td></tr>`).join('');
        const listRows = S.listings.map((it, i) => `<tr><td>${esc(it.name)}${it.variation ? ` <span class="mp-sub">(${esc(it.variation)})</span>` : ''}<div class="mp-sub">SKU ${esc(it.sku || '—')} · item ${esc(it.itemId)}</div></td>
<td>${esc(it.stock)}</td><td>${money(it.price)}</td>
<td>${it.linkId ? `<span class="mp-ok">Linked → ${esc(it.productCode)}</span>` : `<div class="mp-row"><input class="mp-in" list="mp-products" data-lc="${i}" placeholder="POS product code" value="${esc(it.suggestedCode || '')}" style="width:150px"><button class="mp-btn pri" data-lnew="${i}">Link</button></div>${it.suggestedCode ? `<div class="mp-sub">Suggested: ${esc(it.suggestedName)}</div>` : ''}`}</td></tr>`).join('');
        return `${dl}
<h3 style="margin:0 0 8px">Linked products</h3>
<div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Listing</th><th>POS product</th><th>Units each</th><th>Buffer</th><th>Sync</th><th>Status</th><th></th></tr></thead>
<tbody>${linkRows || '<tr><td colspan="7" class="mp-empty">No links yet. Use auto-match or browse your listings below.</td></tr>'}</tbody></table></div>
<h3 style="margin:22px 0 8px">Browse marketplace listings</h3>
${ac.length ? `<div class="mp-row" style="margin-bottom:10px"><select class="mp-in" id="mp-lconn">${ac.map((c) => `<option value="${esc(c.platform)}|${esc(c.shopId)}" ${S.listingConn === `${c.platform}|${c.shopId}` ? 'selected' : ''}>${esc(platformMeta(c.platform).label)} — ${esc(c.shopName || c.shopId)}</option>`).join('')}</select>
<button class="mp-btn" id="mp-load">Load listings</button><button class="mp-btn pri" id="mp-auto"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-match by SKU</button>
<button class="mp-btn" id="mp-pushall" title="Send current POS stock to all linked listings">Push all stock</button></div>` : '<div class="mp-note">Connect a shop first.</div>'}
${S.listings.length ? `<div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Listing</th><th>Shop stock</th><th>Price</th><th>Link to POS product</th></tr></thead><tbody>${listRows}</tbody></table></div>${S.listingCursor ? '<div style="margin-top:10px"><button class="mp-btn" id="mp-more">Load more</button></div>' : ''}` : ''}`;
    }
    function selConn() { const v = (root().querySelector('#mp-lconn') || {}).value || ''; const [platform, shopId] = v.split('|'); S.listingConn = v; return { platform, shopId }; }
    async function loadListings(more) {
        const { platform, shopId } = selConn(); if (!platform) return;
        const d = await api(`/marketplace/listings?platform=${platform}&shopId=${encodeURIComponent(shopId)}${more && S.listingCursor ? `&cursor=${encodeURIComponent(S.listingCursor)}` : ''}`, { timeoutMs: 120000 });
        if (!d.success) { toast('error', 'Could not load listings', d.message); return; }
        S.listings = more ? S.listings.concat(d.items) : d.items; S.listingCursor = d.nextCursor; render();
    }
    function linkPayload(tr) {
        const o = {}; tr.querySelectorAll('[data-f]').forEach((el) => { o[el.dataset.f] = el.type === 'checkbox' ? el.checked : Number(el.value); }); return o;
    }

    // -------------------------------------------------------------- settings
    function viewSettings() {
        const s = (S.overview && S.overview.settings) || {};
        return `<div class="mp-card" style="max-width:560px"><div style="display:grid;gap:12px">
<label><input type="checkbox" id="mp-s-auto" ${s.autoSync ? 'checked' : ''}> Sync automatically in the background</label>
<label>Sync every <input class="mp-in" id="mp-s-int" type="number" min="1" max="60" style="width:70px" value="${s.intervalMin || 3}"> minutes</label>
<label><input type="checkbox" id="mp-s-push" ${s.pushStock !== false ? 'checked' : ''}> Push POS stock to linked listings</label>
<label>Hold back <input class="mp-in" id="mp-s-buf" type="number" min="0" style="width:70px" value="${s.stockBuffer || 0}"> unit(s) per listing (safety stock)</label>
<label>On first connect, show open orders from the last <input class="mp-in" id="mp-s-bf" type="number" min="0" max="14" style="width:70px" value="${s.backfillDays == null ? 3 : s.backfillDays}"> day(s) <span class="mp-sub">(for label printing; their stock is never deducted)</span></label>
<div><button class="mp-btn pri" id="mp-s-save">Save settings</button></div></div></div>`;
    }

    // ---------------------------------------------------------------- render
    function render() {
        if (!root()) return;
        const keepFocus = document.activeElement && document.activeElement.id;
        const body = S.tab === 'connections' ? viewConnections() : S.tab === 'orders' ? viewOrders() : S.tab === 'links' ? viewLinks() : viewSettings();
        shell(body); bind(); syncThemeInk();
        if (keepFocus === 'mp-f-q') { const el = root().querySelector('#mp-f-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    }
    function bind() {
        const R = root();
        R.querySelectorAll('[data-connect]').forEach((b) => b.onclick = () => startConnect(b.dataset.connect));
        R.querySelectorAll('[data-disc]').forEach((b) => b.onclick = async () => {
            const [platform, shopId] = b.dataset.disc.split('|');
            if (typeof Swal !== 'undefined') { const r = await Swal.fire({ icon: 'warning', title: 'Disconnect this shop?', text: 'Order import and stock sync will stop. Existing records are kept.', showCancelButton: true, confirmButtonText: 'Disconnect' }); if (!r.isConfirmed) return; }
            const d = await api('/marketplace/disconnect', { method: 'POST', body: { platform, shopId } });
            toast(d.success ? 'success' : 'error', d.success ? 'Disconnected' : 'Failed', d.message); refresh(true);
        });
        const fp = R.querySelector('#mp-f-platform'), fs = R.querySelector('#mp-f-status'), fq = R.querySelector('#mp-f-q');
        if (fp) fp.onchange = () => { S.filters.platform = fp.value; loadOrders().then(render); };
        if (fs) fs.onchange = () => { S.filters.status = fs.value; loadOrders().then(render); };
        if (fq) { let t; fq.oninput = () => { clearTimeout(t); t = setTimeout(() => { S.filters.q = fq.value; loadOrders().then(render); }, 350); }; }
        R.querySelectorAll('[data-label]').forEach((b) => b.onclick = () => printLabel(b.dataset.label, b.dataset.arrange === '1'));
        R.querySelectorAll('[data-rv]').forEach((b) => b.onclick = () => { const [a, k] = b.dataset.rv.split('|'); reviewOrder(a, k); });
        const ld = R.querySelector('#mp-load'); if (ld) ld.onclick = () => { S.listings = []; loadListings(false); };
        const more = R.querySelector('#mp-more'); if (more) more.onclick = () => loadListings(true);
        const auto = R.querySelector('#mp-auto'); if (auto) auto.onclick = async () => {
            const { platform, shopId } = selConn(); auto.disabled = true;
            const d = await api('/marketplace/links/auto-match', { method: 'POST', body: { platform, shopId }, timeoutMs: 240000 });
            if (d.success) toast('success', 'Auto-match done', `${d.matched} new link(s) · ${d.already} already linked · ${d.unmatchedCount} without a matching SKU`); else toast('error', 'Auto-match failed', d.message);
            await loadLinks(); render();
        };
        const pa = R.querySelector('#mp-pushall'); if (pa) pa.onclick = async () => {
            const { platform } = selConn(); const d = await api('/marketplace/push', { method: 'POST', body: { platform }, timeoutMs: 180000 });
            toast(d.success ? 'success' : 'warning', 'Push finished', d.message); await loadLinks(); render();
        };
        R.querySelectorAll('[data-lnew]').forEach((b) => b.onclick = async () => {
            const it = S.listings[Number(b.dataset.lnew)]; const code = (R.querySelector(`[data-lc="${b.dataset.lnew}"]`) || {}).value;
            if (!code) return toast('warning', 'Pick a product', 'Enter the POS product code to link.');
            const { platform, shopId } = selConn();
            const d = await api('/marketplace/links', { method: 'POST', body: { platform, shopId, itemId: it.itemId, modelId: it.modelId, sku: it.sku, listingName: [it.name, it.variation].filter(Boolean).join(' — '), productCode: code, meta: it.meta } });
            if (!d.success) return toast('error', 'Could not link', d.message);
            it.linkId = d.link.id; it.productCode = code; await loadLinks(); render();
        });
        R.querySelectorAll('[data-lsave]').forEach((b) => b.onclick = async () => {
            const l = S.links.find((x) => x.id === b.dataset.lsave); const tr = b.closest('tr');
            const d = await api('/marketplace/links', { method: 'POST', body: { ...l, ...linkPayload(tr) } });
            toast(d.success ? 'success' : 'error', d.success ? 'Saved' : 'Failed', d.message); await loadLinks(); render();
        });
        R.querySelectorAll('[data-lpush]').forEach((b) => b.onclick = async () => {
            const l = S.links.find((x) => x.id === b.dataset.lpush);
            const d = await api('/marketplace/push', { method: 'POST', body: { platform: l.platform, linkIds: [l.id], prices: true }, timeoutMs: 120000 });
            toast(d.success ? 'success' : 'warning', 'Push finished', d.message); await loadLinks(); render();
        });
        R.querySelectorAll('[data-lrm]').forEach((b) => b.onclick = async () => {
            const d = await api(`/marketplace/links/${encodeURIComponent(b.dataset.lrm)}`, { method: 'DELETE' });
            if (!d.success) toast('error', 'Failed', d.message); await loadLinks(); render();
        });
        const sv = R.querySelector('#mp-s-save'); if (sv) sv.onclick = async () => {
            const d = await api('/marketplace/settings', { method: 'PUT', body: { autoSync: R.querySelector('#mp-s-auto').checked, intervalMin: Number(R.querySelector('#mp-s-int').value), pushStock: R.querySelector('#mp-s-push').checked, stockBuffer: Number(R.querySelector('#mp-s-buf').value), backfillDays: Number(R.querySelector('#mp-s-bf').value) } });
            if (d.success) { S.overview.settings = d.settings; toast('success', 'Settings saved', ''); } else toast('error', 'Failed', d.message);
        };
    }

    window.OmniMarketplace = {
        async open() {
            injectStyle(); if (!root()) return; S.products = null; S.locked = false; watchTheme(); syncThemeInk();
            root().innerHTML = '<div class="mp-empty">Loading Marketplace Hub…</div>';
            await refresh(true);
            clearInterval(S.timer); S.timer = setInterval(() => { if (!document.hidden && !S.busy && !editing() && (S.tab === 'connections' || S.tab === 'orders')) refresh(false); }, 60 * 1000);
        },
        close() { clearInterval(S.timer); clearInterval(S.poll); }
    };
})();
