/* OMNIPOS app1.js
 * NOTE: the "Branch Intelligence" extension (KPIs, search / health filter / sort,
 * CSV export, no-blink toggles) that used to live here has been moved into
 * app.js (see renderBranchesPage / renderBranchesList). It patched the DOM
 * AFTER app.js rendered the Branches page and tagged cards by position, which
 * made the wrong branch open when the card order differed from the data order.
 */

/* ------------------------------------------------------------------------
 * OMNIPOS app1.js — Dashboard Intelligence Extension
 * Adds actionable widgets to the existing "Inventory Dashboard Overview"
 * page (#view-dashboard) without touching app.js: Inventory Value, Avg
 * Order Value Today, Top Payment Method Today, a clickable Stock Watchlist
 * (low stock / no stock / expiring / expired, jumps straight into the
 * existing product edit modal), and a Payments Today breakdown. Fetches its
 * own data and refreshes automatically whenever the core app reloads the
 * dashboard (product/sale/user changes, tab switches), so it never gets
 * out of sync with the metric cards above it.
 * ------------------------------------------------------------------------ */
(function () {
    'use strict';
    if (window.__OMNI_DASHBOARD_INTELLIGENCE__) return;
    window.__OMNI_DASHBOARD_INTELLIGENCE__ = true;

    const esc = (v) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    const money = (n) => {
        const symbol = (window.storeSettingsCache && window.storeSettingsCache.currencySymbol) || '₱';
        return symbol + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const PAYMENT_LABELS = { CASH: 'Cash', GCASH: 'GCash', MAYA: 'Maya', CARD: 'Card', CCREDIT: 'Credit (Utang)', SPLIT: 'Split' };
    const methodLabel = (m) => PAYMENT_LABELS[String(m || '').toUpperCase()] || (m ? esc(m) : 'Other');

    function injectStyle() {
        if (document.getElementById('omni-dashboard-intelligence-style')) return;
        const style = document.createElement('style');
        style.id = 'omni-dashboard-intelligence-style';
        style.textContent = `
#di-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-bottom:35px}
.di-panel{background-color:#fff;border:1px solid var(--border-color);border-radius:12px;padding:20px;box-shadow:0 4px 6px -1px rgba(0,0,0,.05),0 2px 4px -1px rgba(0,0,0,.02);transition:background-color .15s ease,border-color .15s ease}
.di-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700;font-size:.95rem;color:var(--text-primary);margin-bottom:14px}
.di-panel-head i{color:#3b82f6;margin-right:6px}
.di-panel-sub{font-size:.72rem;font-weight:600;color:var(--text-muted)}
.di-empty{font-size:.82rem;color:var(--text-muted);margin:0;padding:6px 0}
.di-watch-row{display:flex;align-items:center;gap:10px;padding:9px 6px;border-radius:8px;cursor:pointer;border-bottom:1px solid var(--border-color)}
.di-watch-row:last-child{border-bottom:none}
.di-watch-row:hover{background:rgba(59,130,246,.07)}
.di-watch-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.di-watch-dot.expired{background:var(--danger-red)}
.di-watch-dot.nostock{background:var(--danger-red)}
.di-watch-dot.expiring{background:var(--warning-gold)}
.di-watch-dot.low{background:var(--warning-gold)}
.di-watch-name{flex:1;min-width:0;font-size:.85rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.di-watch-tag{font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.di-watch-tag.expired,.di-watch-tag.nostock{background:var(--pos-danger-soft,#fee2e2);color:var(--danger-red)}
.di-watch-tag.expiring,.di-watch-tag.low{background:var(--pos-warning-soft,#fef3c7);color:#b45309}
.di-view-all{margin-top:12px;width:100%;background:transparent;border:1px solid var(--border-color);color:var(--text-primary);border-radius:8px;padding:8px;font-size:.8rem;font-weight:600;cursor:pointer}
.di-view-all:hover{background:rgba(127,127,127,.08)}
.di-pay-row{margin-bottom:12px}
.di-pay-row:last-child{margin-bottom:0}
.di-pay-row-top{display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:5px}
.di-pay-name{font-weight:600;color:var(--text-primary)}
.di-pay-amt{color:var(--text-muted);font-variant-numeric:tabular-nums}
.di-pay-bar-track{height:7px;border-radius:999px;background:rgba(127,127,127,.15);overflow:hidden}
.di-pay-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#3b82f6,#7c3aed)}
/* Theme support: the rules above only cover Day Mode. Every other theme
   (Dark Mode + all Pro themes) sets body.dark-mode and drives its colors
   through the --dm-* variables instead of --text-primary/--text-muted/
   --border-color, so without the block below the two panels rendered
   here (Stock Watchlist / Payments Today) keep the light-only text and
   border colors baked in above -- invisible against any dark/Pro
   background. Mirrors the same var(--dm-surface)/var(--dm-border)/
   var(--dm-text-primary) pattern already used by .metric-card elsewhere
   in the app, so it automatically follows whichever of the 11 themes
   (Day, Dark, + 9 Pro themes) is active, radius included, without
   listing themes one by one. */
body.dark-mode .di-panel{
    background-color:var(--dm-surface,#1e293b);
    border-color:var(--dm-border,var(--border-color));
    border-radius:var(--dm-radius,12px);
    box-shadow:0 4px 6px -1px rgba(0,0,0,.25),0 2px 4px -1px rgba(0,0,0,.15);
}
body.dark-mode .di-panel-head{color:var(--dm-text-primary)}
body.dark-mode .di-panel-sub,
body.dark-mode .di-empty,
body.dark-mode .di-pay-amt{color:var(--dm-text-muted)}
body.dark-mode .di-watch-row{border-bottom-color:var(--dm-border,var(--border-color))}
body.dark-mode .di-watch-row:hover{background:color-mix(in srgb, var(--dm-accent, #7c5cff) 12%, transparent)}
body.dark-mode .di-watch-name,
body.dark-mode .di-pay-name{color:var(--dm-text-primary)}
body.dark-mode .di-view-all{
    border-color:var(--dm-border,var(--border-color));
    color:var(--dm-text-primary);
    border-radius:var(--dm-radius-sm,8px);
}
body.dark-mode .di-view-all:hover{background:rgba(255,255,255,.06)}
body.dark-mode .di-pay-bar-track{background:rgba(255,255,255,.1)}
`;
        document.head.appendChild(style);
    }

    function isViewActive() {
        const v = document.getElementById('view-dashboard');
        return !!v && v.style.display !== 'none';
    }

    function ensureMount() {
        const grid = document.querySelector('#view-dashboard .dashboard-metrics-grid');
        if (!grid) return null;
        if (!document.getElementById('metric-inv-value')) {
            grid.insertAdjacentHTML('beforeend', `
                <div class="metric-card">
                    <div class="metric-icon accent"><i class="fa-solid fa-warehouse"></i></div>
                    <div><p class="metric-label">INVENTORY VALUE</p><h3 id="metric-inv-value">—</h3></div>
                </div>
                <div class="metric-card">
                    <div class="metric-icon neutral"><i class="fa-solid fa-chart-pie"></i></div>
                    <div><p class="metric-label">AVG ORDER VALUE (TODAY)</p><h3 id="metric-aov">—</h3></div>
                </div>
                <div class="metric-card">
                    <div class="metric-icon accent"><i class="fa-solid fa-credit-card"></i></div>
                    <div><p class="metric-label">TOP PAYMENT METHOD (TODAY)</p><h3 id="metric-top-payment">—</h3></div>
                </div>`);
        }
        let panels = document.getElementById('di-panels');
        if (!panels) {
            panels = document.createElement('div');
            panels.id = 'di-panels';
            panels.innerHTML = `
                <div class="di-panel">
                    <div class="di-panel-head"><span><i class="fa-solid fa-triangle-exclamation"></i>Stock Watchlist</span><span class="di-panel-sub" id="di-watchlist-count"></span></div>
                    <div id="di-watchlist-body"><p class="di-empty">Loading…</p></div>
                    <button type="button" class="di-view-all" onclick="switchView('products')">View all products <i class="fa-solid fa-arrow-right"></i></button>
                </div>
                <div class="di-panel">
                    <div class="di-panel-head"><span><i class="fa-solid fa-wallet"></i>Payments Today</span></div>
                    <div id="di-payments-body"><p class="di-empty">Loading…</p></div>
                </div>`;
            grid.insertAdjacentElement('afterend', panels);
        }
        return panels;
    }

    function renderInventoryValue(products) {
        const el = document.getElementById('metric-inv-value');
        if (!el) return;
        const total = (products || []).reduce((sum, p) => sum + ((parseFloat(p.price) || 0) * (parseInt(p.stock, 10) || 0)), 0);
        el.innerText = money(total);
    }

    function watchEntry(p) {
        const stock = parseInt(p.stock, 10) || 0;
        const threshold = (p.lowStockThreshold !== undefined && p.lowStockThreshold !== null && p.lowStockThreshold !== '') ? parseInt(p.lowStockThreshold, 10) : 5;
        let daysLeft = null;
        if (p.expiryDate) {
            const exp = new Date(p.expiryDate);
            if (!isNaN(exp.getTime())) daysLeft = Math.ceil((exp - new Date()) / (1000 * 60 * 60 * 24));
        }
        if (daysLeft !== null && daysLeft < 0) return { severity: 0, tag: 'expired', label: 'Expired' };
        if (stock <= 0) return { severity: 1, tag: 'nostock', label: 'No stock' };
        if (daysLeft !== null && daysLeft <= 7) return { severity: 2, tag: 'expiring', label: daysLeft === 0 ? 'Expires today' : `${daysLeft}d left` };
        if (stock <= threshold) return { severity: 3, tag: 'low', label: `${stock} left` };
        return null;
    }

    function renderWatchlist(products) {
        const body = document.getElementById('di-watchlist-body');
        const countEl = document.getElementById('di-watchlist-count');
        if (!body) return;
        const entries = (products || [])
            .map(p => { const w = watchEntry(p); return w ? Object.assign({ p }, w) : null; })
            .filter(Boolean)
            .sort((a, b) => a.severity - b.severity);
        if (countEl) countEl.innerText = entries.length ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : '';
        if (!entries.length) {
            body.innerHTML = '<p class="di-empty">All good — no low stock, no-stock, or expiring items.</p>';
            return;
        }
        const shown = entries.slice(0, 8);
        body.innerHTML = shown.map(e => {
            const code = esc(e.p.code || '');
            return `<div class="di-watch-row" onclick="if(typeof openProductModal==='function'){openProductModal('UPDATE','${code}');}">
                <span class="di-watch-dot ${e.tag}"></span>
                <span class="di-watch-name" title="${esc(e.p.name || '')}">${esc(e.p.name || 'Unnamed product')}</span>
                <span class="di-watch-tag ${e.tag}">${esc(e.label)}</span>
            </div>`;
        }).join('') + (entries.length > shown.length ? `<p class="di-empty">+${entries.length - shown.length} more — see Products</p>` : '');
    }

    function isTodayTx(tx) {
        const today = new Date();
        const cy = today.getFullYear(), cm = today.getMonth(), cd = today.getDate();
        const timestamp = tx.timestamp || tx.date;
        if (!timestamp && !tx.isoDate) return false;
        const txDate = tx.isoDate ? new Date(tx.isoDate) : new Date(timestamp);
        if (isNaN(txDate.getTime())) return false;
        return txDate.getFullYear() === cy && txDate.getMonth() === cm && txDate.getDate() === cd;
    }

    function renderPaymentsAndAov(uniqueTxs) {
        const aovEl = document.getElementById('metric-aov');
        const topPayEl = document.getElementById('metric-top-payment');
        const body = document.getElementById('di-payments-body');
        if (!body) return;
        const isCountable = typeof window.ovIsCountableSale === 'function' ? window.ovIsCountableSale : (() => true);
        const netAmount = typeof window.ovGetNetSalesAmount === 'function' ? window.ovGetNetSalesAmount : (tx => parseFloat(tx.total) || 0);
        const todaysSales = (uniqueTxs || []).filter(tx => isTodayTx(tx) && isCountable(tx));
        if (aovEl) {
            const totalRevenue = todaysSales.reduce((s, tx) => s + netAmount(tx), 0);
            aovEl.innerText = todaysSales.length ? money(totalRevenue / todaysSales.length) : money(0);
        }
        const byMethod = {};
        todaysSales.forEach(tx => {
            const amt = netAmount(tx);
            if (amt <= 0) return;
            if (Array.isArray(tx.payments) && tx.payments.length) {
                const paySum = tx.payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) || amt;
                tx.payments.forEach(p => {
                    const m = String(p.method || 'OTHER').toUpperCase();
                    const share = paySum > 0 ? (parseFloat(p.amount) || 0) / paySum * amt : 0;
                    byMethod[m] = (byMethod[m] || 0) + share;
                });
            } else {
                const m = String(tx.payment_method || tx.method || 'OTHER').toUpperCase();
                byMethod[m] = (byMethod[m] || 0) + amt;
            }
        });
        const rows = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
        if (topPayEl) topPayEl.innerText = rows.length ? methodLabel(rows[0][0]) : '—';
        if (!rows.length) {
            body.innerHTML = '<p class="di-empty">No sales recorded yet today.</p>';
            return;
        }
        const maxVal = rows[0][1] || 1;
        body.innerHTML = rows.map(([m, amt]) => `
            <div class="di-pay-row">
                <div class="di-pay-row-top"><span class="di-pay-name">${methodLabel(m)}</span><span class="di-pay-amt">${money(amt)}</span></div>
                <div class="di-pay-bar-track"><div class="di-pay-bar-fill" style="width:${Math.max(4, (amt / maxVal) * 100)}%"></div></div>
            </div>`).join('');
    }

    async function refresh() {
        if (!isViewActive()) return;
        injectStyle();
        const panels = ensureMount();
        if (!panels) return;
        try {
            const [resProd, resTx] = await Promise.all([
                authFetch(`${API_URL}/products?lite=1`),
                // SCALE FIX: ang benta ng ngayon lang ang ginagamit dito, kaya ang huling 2 araw lang ang hinihingi (hindi ang buong history).
                authFetch(`${API_URL}/transactions?from=${Date.now() - 2 * 24 * 60 * 60 * 1000}`)
            ]);
            const products = resProd.ok ? await resProd.json() : JSON.parse(localStorage.getItem('cached_products') || '[]');
            const serverTxs = resTx.ok ? await resTx.json() : JSON.parse(localStorage.getItem('cached_transactions') || '[]');
            let offlineTxs = [];
            if (window.OfflineStorage?.getQueue) {
                let deviceId = localStorage.getItem('omnipos_offline_device_id') || '';
                if (!deviceId) {
                    const browserCrypto = globalThis.crypto;
                    deviceId = browserCrypto?.randomUUID
                        ? browserCrypto.randomUUID()
                        : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    localStorage.setItem('omnipos_offline_device_id', deviceId);
                }
                const activeUser = typeof currentUser !== 'undefined' ? currentUser : null;
                const username = String(activeUser?.username || '').trim().toLowerCase();
                const queueUserKey = `${deviceId}::${username}`;
                const queued = await window.OfflineStorage.getQueue(queueUserKey);
                offlineTxs = queued.map(item => item.transaction || item);
            } else {
                const rawOffline = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
                offlineTxs = rawOffline.map(item => item.transaction || item);
            }
            const allTxs = [...offlineTxs, ...(Array.isArray(serverTxs) ? serverTxs : [])];
            const uniqueMap = new Map();
            allTxs.forEach(tx => { if (tx && tx.id) uniqueMap.set(tx.id, tx); });
            renderInventoryValue(Array.isArray(products) ? products : []);
            renderWatchlist(Array.isArray(products) ? products : []);
            renderPaymentsAndAov(Array.from(uniqueMap.values()));
        } catch (e) {
            console.warn('Dashboard Intelligence: refresh failed', e);
        }
    }

    // Piggyback on the core app's own dashboard reload — it already fires on
    // every event that could change these numbers (sale completed, product
    // added/edited, tab switched to Dashboard, etc.), so this stays in sync
    // for free instead of running its own polling loop.
    const originalLoad = window.loadDashboardMetrics;
    if (typeof originalLoad === 'function') {
        window.loadDashboardMetrics = async function () {
            const result = await originalLoad.apply(this, arguments);
            setTimeout(refresh, 0);
            return result;
        };
    }

    document.addEventListener('DOMContentLoaded', () => setTimeout(refresh, 350));
    window.DashboardIntelligence = Object.freeze({ version: '1.0', refresh });
})();


/* ------------------------------------------------------------------------
 * OMNIPOS app1.js — Recipe / Ingredient Tracking + Product Variants
 * Adds two buttons to the Edit Product form:
 *   - "Recipe / Ingredients": the ingredients used per 1 unit sold. Selling the product deducts the ingredients; the
 *     product's own stock becomes "how many can I still make" (computed by the server).
 *   - "Variants (Size / Color)": creates several products (own code/barcode, price, cost, stock) tied to one group.
 * Server endpoints: GET/PUT /api/products/:code/recipe, GET/POST /api/products/:code/variants.
 * ------------------------------------------------------------------------ */
(function () {
    'use strict';
    if (window.__OMNI_RECIPE_VARIANTS__) return;
    window.__OMNI_RECIPE_VARIANTS__ = true;

    const esc = (v) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    const fmt = (n) => (Math.round(num(n) * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
    const money = (n) => ((window.storeSettingsCache && window.storeSettingsCache.currencySymbol) || '₱') + num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const currentCode = () => { const el = document.getElementById('p-form-code'); return el ? String(el.value || '').trim() : ''; };
    const isEditMode = () => { const el = document.getElementById('p-form-mode'); return !!el && el.value !== 'ADD' && !!currentCode(); };
    const products = () => (typeof globalProducts !== 'undefined' && Array.isArray(globalProducts)) ? globalProducts : [];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const unitOf = (p) => (p && p.baseUnit) ? String(p.baseUnit) : '';
    const when = (at) => { const d = new Date(at); return isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
    // Same rule as the server (variantCodeSlug) so the auto barcode can be previewed before saving.
    const variantSlug = (label) => String(label || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'V';

    async function api(method, path, body) {
        const res = await authFetch(`${API_URL}${path}`, {
            method, cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* not JSON */ }
        if (!res.ok || !data || data.success === false) {
            const err = new Error((data && data.message) || `Request failed (${res.status})`);
            err.code = data && data.code; err.status = res.status;
            throw err;
        }
        return data;
    }

    function injectStyle() {
        if (document.getElementById('rv-style')) return;
        const st = document.createElement('style');
        st.id = 'rv-style';
        // Every colour comes from the app theme variables (--dm-*); the fallbacks only apply if a theme lacks a variable.
        st.textContent = `
#rv-tools .rv-btns{display:flex;gap:8px;flex-wrap:wrap}
#rv-tools .rv-note{font-size:.75rem;color:var(--dm-text-muted,#64748b);margin-top:6px}
.rv-dlg,.rvt-root,#rv-bc-bar{--rv-bg:var(--dm-surface,#ffffff);--rv-bg2:var(--dm-surface-alt,#f1f5f9);--rv-tx:var(--dm-text-primary,#0f172a);--rv-mu:var(--dm-text-muted,#64748b);--rv-ac:var(--dm-accent,#3b82f6);--rv-bd:var(--dm-border,rgba(148,163,184,.45));--rv-bad:#ef4444;--rv-good:#22c55e;--rv-warn:#f59e0b}
.rv-dlg{text-align:left;font-size:.9rem;color:var(--rv-tx);font-family:var(--dm-font-body,inherit)}
.rv-dlg .rv-hint{font-size:.8rem;color:var(--rv-mu);margin:0 0 10px;line-height:1.4}
.rv-card{background:var(--rv-bg2);border:1px solid var(--rv-bd);border-radius:12px;padding:8px;margin-bottom:8px}
.rv-pick{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;width:100%;min-height:48px;box-sizing:border-box;padding:8px 10px;border:1px solid var(--rv-bd);border-radius:10px;background:var(--rv-bg);color:var(--rv-tx);text-align:left;cursor:pointer;font:inherit;font-size:.9rem;line-height:1.25}
.rv-pick b{display:block;max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:break-word}
.rv-pick small{display:block;max-width:100%;color:var(--rv-mu);font-size:.76rem;white-space:normal;overflow-wrap:anywhere}
.rv-pick.rv-empty{color:var(--rv-mu);border-style:dashed}
.rv-pick.rv-bad,.rv-qtywrap.rv-bad,.rv-vcard input.rv-bad{border-color:var(--rv-bad)}
.rv-qtyrow{display:flex;align-items:center;gap:8px;margin-top:8px}
.rv-qtyrow label{flex:1 1 auto;min-width:0;font-size:.76rem;color:var(--rv-mu);line-height:1.2}
.rv-qtywrap{flex:0 0 auto;display:flex;align-items:center;width:150px;border:1px solid var(--rv-bd);border-radius:10px;background:var(--rv-bg);overflow:hidden}
.rv-qtywrap input{flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box;padding:8px 8px;border:none;outline:none;background:transparent;color:var(--rv-tx);font-size:.95rem}
.rv-qtywrap .rv-u{flex:none;padding:0 8px 0 2px;color:var(--rv-mu);font-size:.78rem;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rv-x{flex:none;width:36px;height:36px;border:1px solid var(--rv-bd);background:transparent;color:var(--rv-bad);border-radius:10px;cursor:pointer;font-size:1rem}
.rv-unit{font-size:.76rem;color:var(--rv-mu);margin:6px 2px 0;line-height:1.35}
.rv-unit b{color:var(--rv-tx)}
.rv-unit .rv-neg,.rv-sum .rv-neg{color:var(--rv-bad)}
.rv-add{margin:4px 0 10px;background:transparent;border:1px dashed var(--rv-mu);border-radius:10px;padding:8px 12px;cursor:pointer;color:var(--rv-tx);font:inherit}
.rv-sum{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;padding:10px;background:var(--dm-accent-soft,rgba(59,130,246,.10));border:1px solid var(--rv-bd);border-radius:12px;font-size:.84rem}
.rv-sum>div{display:flex;flex-direction:column;gap:1px}
.rv-sum span{color:var(--rv-mu);font-size:.74rem}
.rv-sum b{font-size:1rem}
.rv-sum .rv-sum-note{grid-column:1 / -1;font-size:.78rem;color:var(--rv-mu);flex-direction:row;flex-wrap:wrap;gap:4px}
.rv-sum .rv-sum-note b{font-size:.85rem;color:var(--rv-tx);overflow-wrap:anywhere}
.rv-sum .rv-sum-warn{grid-column:1 / -1;font-size:.78rem;color:var(--rv-bad)}
.rv-vmem{margin-bottom:8px}
.rv-vm{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--rv-bd);border-radius:10px;background:var(--rv-bg2);margin-bottom:6px}
.rv-vm.rv-arch{opacity:.62}
.rv-vm-act a.rv-rm{color:var(--rv-bad,#ef4444);cursor:pointer}
.rv-vm-act a.rv-rs{color:var(--rv-good,#16a34a);cursor:pointer}
.rv-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;font-size:.66rem;font-weight:600;background:rgba(148,163,184,.25);color:var(--rv-mu);vertical-align:middle}
.rv-vm-main{min-width:0;display:flex;flex-direction:column;gap:1px}
.rv-vm-main b{overflow-wrap:anywhere}
.rv-vm-main small{color:var(--rv-mu);font-size:.76rem;overflow-wrap:anywhere}
.rv-vm-act{flex:none;display:flex;gap:10px;font-size:.8rem}
.rv-vm-act a{color:var(--rv-ac);cursor:pointer;text-decoration:underline}
.rv-vcard{border:1px solid var(--rv-bd);background:var(--rv-bg2);border-radius:12px;padding:8px;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px}
.rv-vcard .rv-f{display:flex;flex-direction:column;gap:2px;min-width:0}
.rv-vcard .rv-f.rv-wide{grid-column:1 / -1}
.rv-vcard .rv-f label{font-size:.72rem;color:var(--rv-mu)}
.rv-vcard input,#rv-base-label{width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid var(--rv-bd);border-radius:10px;font-size:.9rem;background:var(--rv-bg);color:var(--rv-tx)}
.rv-vcard .rv-x{grid-column:1 / -1;width:auto;height:32px}
.rv-chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.7rem;font-weight:600;background:var(--dm-accent-soft,rgba(59,130,246,.16));color:var(--rv-ac);vertical-align:middle}
.swal2-container.rv-top{align-items:flex-start!important;padding-top:6px!important}
.swal2-container.rv-top .swal2-popup{display:flex!important;flex-direction:column;align-items:stretch;width:min(560px,96vw)!important;max-width:96vw;max-height:calc(100vh - 14px);max-height:calc(100dvh - 14px);padding:12px 10px!important;box-sizing:border-box}
.swal2-container.rv-top .swal2-title{font-size:1.2rem;padding:2px 6px 0;margin:0}
.swal2-container.rv-top .swal2-html-container{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;margin:8px 0 6px;padding:0 2px}
.swal2-container.rv-top .swal2-actions{flex:none;margin:6px 0 0;gap:6px;flex-wrap:wrap}
.swal2-container.rv-top .swal2-validation-message{flex:none}
/* ---------- tracker ---------- */
.rvt-root{position:fixed;inset:0;z-index:2147482000;font-family:var(--dm-font-body,system-ui,-apple-system,Segoe UI,Roboto,sans-serif)}
.rvt-dim{position:absolute;inset:0;background:rgba(2,6,23,.62)}
.rvt-sheet{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--rv-bg);color:var(--rv-tx);overflow:hidden}
.rvt-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:max(12px,env(safe-area-inset-top)) 14px 6px}
.rvt-title{font-size:1.05rem;font-weight:700;min-width:0}
.rvt-close{flex:none;width:38px;height:38px;border:none;border-radius:50%;background:var(--rv-bg2);color:var(--rv-tx);font-size:1rem;cursor:pointer}
.rvt-tabs{display:flex;gap:6px;padding:4px 12px;overflow-x:auto}
.rvt-tabs button{flex:1 0 auto;padding:8px 12px;border:1px solid var(--rv-bd);border-radius:999px;background:transparent;color:var(--rv-tx);font:inherit;font-size:.85rem;cursor:pointer;white-space:nowrap}
.rvt-tabs button.on{background:var(--rv-ac);border-color:var(--rv-ac);color:#fff}
.rvt-tabs .rvt-n{margin-left:4px;font-size:.72rem;opacity:.85}
.rvt-tabs .rvt-n.bad{color:var(--rv-bad);font-weight:700;opacity:1}
.rvt-tabs button.on .rvt-n.bad{color:#fff}
.rvt-filters{display:flex;gap:8px;padding:6px 12px}
.rvt-filters select,.rvt-filters input{height:40px;box-sizing:border-box;border:1px solid var(--rv-bd);border-radius:10px;background:var(--rv-bg2);color:var(--rv-tx);font:inherit;font-size:.9rem;padding:0 10px}
.rvt-filters select{flex:0 0 auto}
.rvt-filters input{flex:1 1 auto;min-width:0}
.rvt-scope{margin:0 12px 4px;font-size:.78rem;color:var(--rv-mu)}
.rvt-scope a{color:var(--rv-ac);text-decoration:underline;cursor:pointer;margin-left:6px}
.rvt-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:6px 12px max(16px,env(safe-area-inset-bottom))}
.rvt-empty{padding:28px 12px;text-align:center;color:var(--rv-mu);line-height:1.45}
.rvt-note{font-size:.8rem;color:var(--rv-mu);margin:2px 0 10px;line-height:1.4}
.rvt-h{font-size:.82rem;font-weight:700;color:var(--rv-mu);margin:12px 0 6px;text-transform:uppercase;letter-spacing:.03em}
.rvt-card{background:var(--rv-bg2);border:1px solid var(--rv-bd);border-radius:12px;padding:10px 12px;margin-bottom:10px}
.rvt-card.rvt-bad{border-color:var(--rv-bad)}
.rvt-row1{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.rvt-row1 b{min-width:0;overflow-wrap:anywhere;line-height:1.25}
.rvt-sub{font-size:.78rem;color:var(--rv-mu);margin-top:3px;line-height:1.4;overflow-wrap:anywhere}
.rvt-pill{flex:none;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:700;background:rgba(148,163,184,.22);color:var(--rv-mu);white-space:nowrap}
.rvt-pill.ok{background:rgba(34,197,94,.18);color:var(--rv-good)}
.rvt-pill.low{background:rgba(245,158,11,.2);color:var(--rv-warn)}
.rvt-pill.bad{background:rgba(239,68,68,.18);color:var(--rv-bad)}
.rvt-warn{margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(239,68,68,.12);color:var(--rv-bad);font-size:.78rem;line-height:1.35}
.rvt-warn.soft{background:rgba(245,158,11,.14);color:var(--rv-warn)}
.rvt-ing{display:flex;flex-direction:column;gap:1px;padding:6px 0;border-top:1px solid var(--rv-bd)}
.rvt-ing:first-of-type{border-top:none}
.rvt-ing .n{font-size:.88rem;font-weight:600;overflow-wrap:anywhere}
.rvt-ing .v{font-size:.78rem;color:var(--rv-mu);overflow-wrap:anywhere}
.rvt-ing.bn .v{color:var(--rv-warn)}
.rvt-ing .neg{color:var(--rv-bad)}
.rvt-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.rvt-act button{padding:7px 12px;border:1px solid var(--rv-bd);border-radius:10px;background:transparent;color:var(--rv-tx);font:inherit;font-size:.82rem;cursor:pointer}
.rvt-act button.pri{background:var(--rv-ac);border-color:var(--rv-ac);color:#fff}
.rvt-use{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--rv-bd);font-size:.85rem}
.rvt-use:first-child{border-top:none}
.rvt-use span:first-child{min-width:0;overflow-wrap:anywhere}
.rvt-use span:last-child{flex:none;text-align:right;color:var(--rv-mu);font-size:.78rem}
.rvt-vrow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--rv-bd)}
.rvt-vrow:first-of-type{border-top:none}
.rvt-vrow .m{min-width:0;display:flex;flex-direction:column;gap:1px}
.rvt-vrow .m b{font-size:.88rem;overflow-wrap:anywhere}
.rvt-vrow .m small{font-size:.76rem;color:var(--rv-mu);overflow-wrap:anywhere}
.rvt-vrow button{flex:none;padding:5px 10px;border:1px solid var(--rv-bd);border-radius:8px;background:transparent;color:var(--rv-ac);font:inherit;font-size:.78rem;cursor:pointer}
@media (min-width:720px){.rvt-sheet{left:50%;right:auto;width:640px;transform:translateX(-50%);top:5vh;bottom:5vh;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.5)}}
/* ---------- barcode page ---------- */
#rv-bc-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px;padding:8px 10px;border:1px solid var(--rv-bd);border-radius:12px;background:var(--rv-bg2);color:var(--rv-tx)}
#rv-bc-bar select{min-width:0;max-width:100%;padding:6px 8px;border:1px solid var(--rv-bd);border-radius:8px;background:var(--rv-bg);color:var(--rv-tx);font:inherit}
#rv-bc-bar label{display:flex;align-items:center;gap:6px;font-size:.82rem}
#rv-bc-bar button{padding:6px 10px;border:1px solid var(--rv-bd);border-radius:8px;background:transparent;color:var(--rv-tx);font:inherit;font-size:.82rem;cursor:pointer}
#rv-bc-bar .rv-bc-hint{flex:1 1 100%;font-size:.74rem;color:var(--rv-mu)}
`;
        document.head.appendChild(st);
    }

    /* ---------------- Edit Product form: buttons + state ---------------- */
    function ensureTools() {
        let box = document.getElementById('rv-tools');
        if (box) return box;
        const anchorBtn = document.getElementById('p-form-specs-btn');
        const group = anchorBtn && anchorBtn.closest('.input-field-group');
        if (!group || !group.parentNode) return null;
        injectStyle();
        box = document.createElement('div');
        box.id = 'rv-tools';
        box.className = 'input-field-group pf-span2';
        box.innerHTML = `
            <label>Recipe &amp; Variants <span class="pf-hint" style="font-weight:normal;color:var(--dm-text-muted,#94a3b8);">(optional)</span></label>
            <div class="rv-btns">
                <button type="button" class="btn-action-outline" id="rv-recipe-btn"><i class="fa-solid fa-mortar-pestle"></i> <span>Recipe / Ingredients</span></button>
                <button type="button" class="btn-action-outline" id="rv-variants-btn"><i class="fa-solid fa-layer-group"></i> <span>Variants (Size / Color)</span></button>
                <button type="button" class="btn-action-outline" id="rv-track-btn"><i class="fa-solid fa-chart-line"></i> <span>Tracker</span></button>
            </div>
            <div class="rv-note" id="rv-note"></div>`;
        group.parentNode.insertBefore(box, group.nextSibling);
        document.getElementById('rv-recipe-btn').addEventListener('click', () => openRecipeDialog(currentCode()));
        document.getElementById('rv-variants-btn').addEventListener('click', () => openVariantsDialog(currentCode()));
        document.getElementById('rv-track-btn').addEventListener('click', () => openTracker({ code: currentCode() }));
        return box;
    }
    function setStockLocked(locked) {
        const stock = document.getElementById('p-form-stock');
        if (!stock) return;
        stock.readOnly = !!locked;
        stock.title = locked ? 'Stock of a recipe product is computed from its ingredients.' : '';
        stock.style.opacity = locked ? '.65' : '';
    }
    async function refreshToolState() {
        const box = ensureTools();
        if (!box) return;
        const note = document.getElementById('rv-note');
        const rBtn = document.getElementById('rv-recipe-btn');
        const vBtn = document.getElementById('rv-variants-btn');
        const tBtn = document.getElementById('rv-track-btn');
        const edit = isEditMode();
        rBtn.disabled = vBtn.disabled = tBtn.disabled = !edit;
        if (!edit) { note.textContent = 'Save the product first, then reopen it to add a recipe or variants.'; setStockLocked(false); return; }
        note.textContent = '';
        const code = currentCode();
        try {
            const [r, v] = await Promise.all([api('GET', `/products/${encodeURIComponent(code)}/recipe`), api('GET', `/products/${encodeURIComponent(code)}/variants`)]);
            if (code !== currentCode()) return;
            rBtn.querySelector('span').textContent = r.hasRecipe ? `Recipe (${r.lines.length} ingredient${r.lines.length === 1 ? '' : 's'})` : 'Recipe / Ingredients';
            vBtn.querySelector('span').textContent = v.hasGroup ? `Variants (${v.members.length} in group)` : 'Variants (Size / Color)';
            setStockLocked(r.hasRecipe);
            const parts = [];
            if (r.hasRecipe) parts.push(`Stock is computed from the ingredients: you can make ${fmt(r.canMake)} more.`);
            if (v.hasGroup) parts.push(`Part of the variant group "${esc(v.group)}".`);
            note.innerHTML = parts.join(' ');
        } catch (e) { /* user may lack the Products permission: keep the buttons, errors show when used */ }
    }
    function watchProductModal() {
        const modal = document.getElementById('product-modal');
        if (!modal) return false;
        let wasOpen = false;
        const check = () => {
            const open = modal.style.display && modal.style.display !== 'none';
            if (open && !wasOpen) { ensureTools(); setTimeout(refreshToolState, 700); }
            wasOpen = !!open;
        };
        new MutationObserver(check).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
        check();
        return true;
    }

    /* ---------------- Recipe dialog ---------------- */
    async function openRecipeDialog(code, opts) {
        if (!code) return;
        injectStyle();
        let info;
        try { info = await api('GET', `/products/${encodeURIComponent(code)}/recipe`); }
        catch (e) { return Swal.fire('Recipe', esc(e.message), 'error'); }
        if (!window.OmniPicker) return Swal.fire('Recipe', 'The product picker did not load. Please reload the app and try again.', 'error');
        const self = products().find(p => String(p.code).toLowerCase() === code.toLowerCase()) || { name: code, code };
        const selfUnit = unitOf(self) || 'unit';
        const candidates = products().filter(p => p && String(p.code).toLowerCase() !== code.toLowerCase() && !(Array.isArray(p.recipe) && p.recipe.length));
        const byCode = new Map(candidates.map(p => [String(p.code).toLowerCase(), p]));
        const startLines = info.lines.length ? info.lines : [{ code: '', qty: '' }];

        const pickHtml = (p, name, codeVal) => codeVal
            ? `<b>${esc(name || codeVal)}</b><small>${esc(codeVal)}${p ? ' · stock ' + fmt(p.stock) + (unitOf(p) ? ' ' + esc(unitOf(p)) : '') : ' · product not found'}</small>`
            : '<span><i class="fa-solid fa-magnifying-glass"></i> Tap to choose ingredient</span>';
        const rowHtml = (l) => {
            const p = l.code ? byCode.get(String(l.code).toLowerCase()) : null;
            const codeVal = p ? p.code : (l.code || '');
            return `<div class="rv-line" data-code="${esc(codeVal)}"><div class="rv-card">
                <button type="button" class="rv-pick${codeVal ? '' : ' rv-empty'}">${pickHtml(p, p ? p.name : l.name, codeVal)}</button>
                <div class="rv-qtyrow">
                    <label>Quantity used for 1 ${esc(selfUnit)}</label>
                    <div class="rv-qtywrap"><input class="rv-qty" type="number" inputmode="decimal" min="0" step="any" placeholder="Qty" value="${esc(l.qty)}"><span class="rv-u">${esc(unitOf(p))}</span></div>
                    <button type="button" class="rv-x" title="Remove" aria-label="Remove ingredient">✕</button>
                </div>
                <div class="rv-unit"></div></div></div>`;
        };
        const html = `<div class="rv-dlg">
            <p class="rv-hint">What is used to make <b>1</b> ${esc(selfUnit)} of <b>${esc(self.name)}</b>? Each sale deducts these from the ingredients' stock. Use small units (grams, ml, pieces) so quantities stay under 3 decimals.</p>
            <div id="rv-lines">${startLines.map(rowHtml).join('')}</div>
            <button type="button" class="rv-add" id="rv-add-line"><i class="fa-solid fa-plus"></i> Add ingredient</button>
            <div class="rv-sum" id="rv-sum"></div></div>`;

        const usedCodes = (root, exceptLine) => {
            const used = new Set();
            root.querySelectorAll('.rv-line').forEach(l => { if (l !== exceptLine && l.dataset.code) used.add(l.dataset.code.toLowerCase()); });
            return used;
        };
        const pickerItems = (used) => candidates.filter(p => !used.has(String(p.code).toLowerCase())).map(p => ({
            value: p.code, label: p.name,
            sub: `${p.code} · stock ${fmt(p.stock)} ${p.baseUnit || ''}`.trim(),
            search: `${p.name} ${p.code} ${p.category || ''}`,
            badge: num(p.stock) <= 0 ? 'Out of stock' : '', tone: 'bad'
        }));
        const choose = async (root, line) => {
            const btn = line.querySelector('.rv-pick');
            const res = await window.OmniPicker.open({
                title: 'Choose ingredient', placeholder: 'Search name, code or category',
                items: pickerItems(usedCodes(root, line)), selected: line.dataset.code || '',
                emptyText: 'No product matches your search.'
            });
            if (!res) return;
            const p = byCode.get(String(res.value).toLowerCase());
            if (!p) return;
            line.dataset.code = p.code;
            btn.innerHTML = pickHtml(p, p.name, p.code);
            btn.classList.remove('rv-empty', 'rv-bad');
            line.querySelector('.rv-u').textContent = unitOf(p);
            refreshSummary(root);
            line.querySelector('.rv-qty').focus();
        };
        const readLines = (root, mark) => {
            const out = []; let bad = false;
            root.querySelectorAll('.rv-line').forEach(line => {
                const btn = line.querySelector('.rv-pick'), qtyEl = line.querySelector('.rv-qty'), wrap = line.querySelector('.rv-qtywrap');
                const chosen = (line.dataset.code || '').toLowerCase();
                if (!chosen && !qtyEl.value.trim()) return;               // empty row: ignore
                const p = chosen ? byCode.get(chosen) : null;
                const q = parseFloat(qtyEl.value);
                const badIng = !p, badQty = !(q > 0);
                if (mark) { btn.classList.toggle('rv-bad', badIng); wrap.classList.toggle('rv-bad', badQty); }
                if (badIng || badQty) { bad = true; return; }
                out.push({ code: p.code, qty: q });
            });
            return { lines: out, bad };
        };
        const refreshSummary = (root) => {
            let cost = 0, can = Infinity, any = false, limiting = '';
            root.querySelectorAll('.rv-line').forEach(line => {
                const p = line.dataset.code ? byCode.get(line.dataset.code.toLowerCase()) : null;
                const q = parseFloat(line.querySelector('.rv-qty').value);
                const info = line.querySelector('.rv-unit');
                const u = unitOf(p);
                if (p && q > 0) {
                    any = true;
                    const lineCost = num(p.cost) * q;
                    cost += lineCost;
                    const makes = Math.floor(num(p.stock) / q + 1e-9);
                    if (makes < can) { can = makes; limiting = p.name; }
                    const after = num(p.stock) - q;
                    info.innerHTML = `Cost ${money(p.cost)} per ${esc(u || 'unit')} × ${fmt(q)} = <b>${money(lineCost)}</b><br>After 1 sale: stock ${fmt(p.stock)} → <b class="${after < 0 ? 'rv-neg' : ''}">${fmt(after)}</b> ${esc(u)}`;
                } else if (p) {
                    info.textContent = `Cost ${money(p.cost)} per ${u || 'unit'}`;
                } else { info.textContent = ''; }
            });
            const sum = root.querySelector('#rv-sum');
            if (!any) { sum.innerHTML = '<div class="rv-sum-note">Add at least one ingredient.</div>'; return; }
            const price = num(self.price);
            const margin = (price > 0 && cost > 0) ? Math.round((1 - cost / price) * 100) : null;
            sum.innerHTML = `
                <div><span>Cost per ${esc(selfUnit)}</span><b>${money(cost)}</b></div>
                <div><span>Selling price</span><b>${price > 0 ? money(price) : '—'}</b></div>
                <div><span>Margin</span><b class="${margin !== null && margin < 0 ? 'rv-neg' : ''}">${margin !== null ? margin + '%' : '—'}</b></div>
                <div><span>Can make now</span><b>${isFinite(can) ? fmt(can) : '—'}</b></div>
                ${isFinite(can) && limiting ? `<div class="rv-sum-note">Limited by: <b>${esc(limiting)}</b></div>` : ''}
                ${margin !== null && margin < 0 ? '<div class="rv-sum-warn">The ingredient cost is higher than the selling price.</div>' : ''}`;
        };

        const result = await Swal.fire({
            title: 'Recipe / Ingredients',
            html, width: 560, heightAuto: false, customClass: { container: 'rv-top' }, showCancelButton: true, confirmButtonText: 'Save recipe',
            showDenyButton: info.hasRecipe, denyButtonText: 'Remove recipe', focusConfirm: false,
            didOpen: (popup) => {
                const root = popup.querySelector('.rv-dlg');
                root.addEventListener('input', () => refreshSummary(root));
                root.addEventListener('click', (ev) => {
                    const pick = ev.target.closest('.rv-pick');
                    if (pick) { choose(root, pick.closest('.rv-line')); return; }
                    const x = ev.target.closest('.rv-x');
                    if (x) {
                        const line = x.closest('.rv-line'); const all = root.querySelectorAll('.rv-line');
                        if (all.length > 1) line.remove();
                        else {
                            line.dataset.code = '';
                            line.querySelector('.rv-pick').className = 'rv-pick rv-empty';
                            line.querySelector('.rv-pick').innerHTML = pickHtml(null, '', '');
                            line.querySelector('.rv-qty').value = '';
                            line.querySelector('.rv-u').textContent = '';
                            line.querySelector('.rv-qtywrap').classList.remove('rv-bad');
                        }
                        refreshSummary(root);
                        return;
                    }
                    if (ev.target.closest('#rv-add-line')) {
                        const holder = root.querySelector('#rv-lines');
                        holder.insertAdjacentHTML('beforeend', rowHtml({ code: '', qty: '' }));
                        choose(root, holder.lastElementChild);   // open the picker right away
                    }
                });
                refreshSummary(root);
            },
            preConfirm: () => {
                const root = Swal.getHtmlContainer().querySelector('.rv-dlg');
                const { lines, bad } = readLines(root, true);
                if (bad) { Swal.showValidationMessage('Choose an ingredient and enter a quantity above zero for every row.'); return false; }
                if (!lines.length) { Swal.showValidationMessage('Add at least one ingredient (or use "Remove recipe").'); return false; }
                return lines;
            }
        });
        try {
            if (result.isConfirmed) {
                const saved = await api('PUT', `/products/${encodeURIComponent(code)}/recipe`, { recipe: result.value });
                await Swal.fire({ icon: 'success', title: 'Recipe saved', text: `You can make ${fmt(saved.canMake)} more with the current ingredient stock.`, timer: 1800, showConfirmButton: false });
            } else if (result.isDenied) {
                const ok = await Swal.fire({ icon: 'warning', title: 'Remove this recipe?', text: 'The product will use its own stock again (set the stock in the form).', showCancelButton: true, confirmButtonText: 'Yes, remove' });
                if (!ok.isConfirmed) return;
                await api('PUT', `/products/${encodeURIComponent(code)}/recipe`, { recipe: [] });
            } else return;
            if (typeof loadInventoryProductsTable === 'function') loadInventoryProductsTable();
            if (typeof loadDashboardMetrics === 'function') loadDashboardMetrics();
            if (opts && opts.returnToTracker) { openTracker(opts.returnToTracker); return; }
            if (typeof openProductModal === 'function') { openProductModal('UPDATE', code); setTimeout(refreshToolState, 900); } // reload the form with the new stock
        } catch (e) { Swal.fire('Could not save', esc(e.message), 'error'); }
    }

    /* ---------------- Variants dialog ---------------- */
    // Opens the Barcode page, ticks the given product codes and opens the print preview (1 label each, change the copies there).
    async function printBarcodes(codes) {
        const list = (Array.isArray(codes) ? codes : []).map(c => String(c).toLowerCase()).filter(Boolean);
        if (!list.length || typeof switchView !== 'function') return;
        window.__rvBarcodeReady = null;
        switchView('barcode');
        for (let i = 0; i < 20 && !window.__rvBarcodeReady; i++) await sleep(150);
        try { if (window.__rvBarcodeReady) await window.__rvBarcodeReady; } catch (e) { /* page shows its own error */ }
        const want = new Set(list);
        let hit = 0;
        document.querySelectorAll('.barcode-select-item').forEach(cb => {
            const tr = cb.closest('tr');
            if (tr) tr.style.display = '';
            const on = want.has(String(cb.dataset.code || '').toLowerCase());
            cb.checked = on;
            if (on) { hit++; const q = tr && tr.querySelector('.barcode-qty-input'); if (q) q.value = '1'; }
        });
        const bar = document.getElementById('rv-bc-filter'); if (bar) bar.value = '';
        const master = document.getElementById('select-all-barcodes'); if (master) master.checked = false;
        if (!hit) { Swal.fire('Barcode', 'Those products were not found in the Barcode list. Reload the app and try again.', 'info'); return; }
        if (typeof generateSelectedBarcodePreview === 'function') generateSelectedBarcodePreview();
    }

    /* ---------------- Remove / hide / restore a variant ---------------- */
    function afterVariantChange() {
        if (typeof loadInventoryProductsTable === 'function') loadInventoryProductsTable();
        if (typeof loadDashboardMetrics === 'function') loadDashboardMetrics();
    }
    async function removeVariantFlow(m, code, opts) {
        const name = esc(m.label || m.name);
        const stockNote = Number(m.stock) > 0 ? `<br><br><b>Stock on hand: ${fmt(m.stock)}</b>. If this variant was never sold and you delete it, that stock record is lost.` : '';
        const baseNote = m.isBase ? '<br><br>This is the <b>base</b> of the group. The group will move to the next active variant automatically.' : '';
        const c = await Swal.fire({
            icon: 'warning', title: `Remove "${name}"?`, width: 560,
            html: `<div style="text-align:left;font-size:.92rem;line-height:1.4"><b>Remove</b> deletes it if it was never sold. If it already has sales, it is <b>hidden</b> instead so old receipts, refunds and BIR logs stay correct.<br><br><b>Hide only</b> keeps it but removes it from the POS, Products and Barcode lists (you can restore it later).${stockNote}${baseNote}</div>`,
            showCancelButton: true, showDenyButton: true, confirmButtonText: 'Remove', denyButtonText: 'Hide only', cancelButtonText: 'Cancel', focusCancel: true
        });
        if (c.isDismissed) { openVariantsDialog(code, opts); return; }
        const mode = c.isDenied ? 'archive' : 'auto';
        let adminPassword = '';
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const r = await api('POST', `/products/${encodeURIComponent(m.code)}/variants/remove`, { mode, adminPassword });
                afterVariantChange();
                await Swal.fire({ icon: 'success', title: r.action === 'deleted' ? 'Variant deleted' : 'Variant hidden', text: r.message, timer: r.action === 'deleted' ? 1400 : undefined, confirmButtonText: 'OK' });
                if (r.lastActive) {
                    const last = (r.members || []).find(x => String(x.code) === String(r.lastActive));
                    const q = await Swal.fire({ icon: 'question', title: 'Only one variant left', text: `Turn "${(last && (last.label || last.name)) || r.lastActive}" back into a normal product?`, showCancelButton: true, confirmButtonText: 'Yes, make it normal', cancelButtonText: 'Keep as variant' });
                    if (q.isConfirmed) {
                        try { const u = await api('POST', `/products/${encodeURIComponent(r.lastActive)}/variants/ungroup`, {}); afterVariantChange(); await Swal.fire({ icon: 'success', title: 'Done', text: u.message, timer: 1400 }); }
                        catch (e) { await Swal.fire('Could not change it', esc(e.message), 'error'); }
                    }
                }
                openVariantsDialog(r.group || code, opts);
                return;
            } catch (e) {
                if (e.code === 'PASSWORD_REQUIRED' || e.code === 'WRONG_ADMIN_PASSWORD') {
                    const pw = await Swal.fire({
                        title: 'Admin password', text: e.code === 'WRONG_ADMIN_PASSWORD' ? 'Incorrect password. Try again.' : `"${m.label || m.name}" was never sold, so it will be deleted.`,
                        input: 'password', inputAttributes: { autocapitalize: 'off', autocomplete: 'off' }, showCancelButton: true, confirmButtonText: 'Delete variant',
                        inputValidator: (v) => (!v ? 'Enter the password.' : undefined)
                    });
                    if (!pw.isConfirmed) { openVariantsDialog(code, opts); return; }
                    adminPassword = pw.value; continue;
                }
                await Swal.fire('Could not remove', esc(e.message), 'error');
                openVariantsDialog(code, opts);
                return;
            }
        }
        openVariantsDialog(code, opts);
    }
    async function restoreVariantFlow(vcode, code, opts) {
        try {
            const r = await api('POST', `/products/${encodeURIComponent(vcode)}/variants/restore`, {});
            afterVariantChange();
            await Swal.fire({ icon: 'success', title: 'Variant restored', text: r.message, timer: 1300 });
        } catch (e) { await Swal.fire('Could not restore', esc(e.message), 'error'); }
        openVariantsDialog(code, opts);
    }

    async function openVariantsDialog(code, opts) {
        if (!code) return;
        injectStyle();
        let info;
        try { info = await api('GET', `/products/${encodeURIComponent(code)}/variants`); }
        catch (e) { return Swal.fire('Variants', esc(e.message), 'error'); }
        const baseCode = info.baseCode || code;
        const vRow = () => `<div class="rv-vcard">
            <div class="rv-f rv-wide"><label>Variant name (e.g. Large, Red)</label><input class="rv-v-label" maxlength="40" placeholder="Label"></div>
            <div class="rv-f"><label>Price</label><input class="rv-v-price" type="number" inputmode="decimal" min="0" step="any" placeholder="Same as base"></div>
            <div class="rv-f"><label>Starting stock</label><input class="rv-v-stock" type="number" inputmode="decimal" min="0" step="any" placeholder="0"></div>
            <div class="rv-f rv-wide"><label>Barcode / code (leave blank = auto)</label><input class="rv-v-code" placeholder="${esc(baseCode)}-…"></div>
            <button type="button" class="rv-x" title="Remove">✕ Remove</button></div>`;
        const activeMembers = info.members.filter(m => !m.archived);
        const isThis = (m) => String(m.code).toLowerCase() === code.toLowerCase();
        const memberHtml = info.members.length ? `<div class="rv-vmem">${info.members.map(m => `
            <div class="rv-vm${m.archived ? ' rv-arch' : ''}"><div class="rv-vm-main"><b>${esc(m.label || m.name)}${m.archived ? '<span class="rv-tag">hidden</span>' : (m.isBase ? '<span class="rv-tag">base</span>' : '')}</b><small>${esc(m.code)} · ${money(m.price)} · stock ${fmt(m.stock)}</small></div>
            <div class="rv-vm-act">${isThis(m) ? '<i>this</i>' : (m.archived ? '' : `<a class="rv-edit" data-code="${esc(m.code)}">Edit</a>`)}${m.archived ? '' : `<a class="rv-print" data-code="${esc(m.code)}">Barcode</a>`}${info.canManage ? (m.archived ? `<a class="rv-rs" data-code="${esc(m.code)}">Restore</a>` : (isThis(m) ? '' : `<a class="rv-rm" data-code="${esc(m.code)}">Remove</a>`)) : ''}</div></div>`).join('')}</div>
            ${activeMembers.length ? `<button type="button" class="rv-add" id="rv-print-all"><i class="fa-solid fa-barcode"></i> Print barcode labels (all ${activeMembers.length})</button>` : ''}
            ${info.canManage && activeMembers.length > 1 ? '<div class="rv-hint" style="margin-top:6px">To remove this product itself, open another variant (Edit) and remove it from there.</div>' : ''}` : '';
        const needBaseLabel = !info.hasGroup;
        const html = `<div class="rv-dlg">
            <p class="rv-hint">Each variant becomes its own product (own barcode, price and stock) so it scans and sells normally. Price/cost default to this product's values; stock starts at 0 unless you enter it.</p>
            ${memberHtml}
            ${needBaseLabel ? `<div style="margin-bottom:8px"><label style="font-size:.78rem;color:var(--dm-text-muted,#64748b)">What is <b>${esc(info.baseName)}</b> itself called in the group?</label><input id="rv-base-label" value="Standard"></div>` : ''}
            <div style="font-weight:600;margin:6px 0">Add variants</div>
            <div id="rv-vlines">${vRow()}</div>
            <button type="button" class="rv-add" id="rv-add-v"><i class="fa-solid fa-plus"></i> Add another</button></div>`;
        const result = await Swal.fire({
            title: 'Variants (Size / Color)', html, width: 640, heightAuto: false, customClass: { container: 'rv-top' }, showCancelButton: true, confirmButtonText: 'Create variants', focusConfirm: false,
            didOpen: (popup) => {
                const root = popup.querySelector('.rv-dlg');
                root.addEventListener('input', (ev) => {
                    const lab = ev.target.closest('.rv-v-label');
                    if (!lab) return;
                    const codeInput = lab.closest('.rv-vcard').querySelector('.rv-v-code');
                    codeInput.placeholder = lab.value.trim() ? `${baseCode}-${variantSlug(lab.value)} (auto)` : `${baseCode}-…`;
                });
                root.addEventListener('click', (ev) => {
                    if (ev.target.closest('#rv-add-v')) { root.querySelector('#rv-vlines').insertAdjacentHTML('beforeend', vRow()); return; }
                    const x = ev.target.closest('.rv-x');
                    if (x) { const rows = root.querySelectorAll('.rv-vcard'); if (rows.length > 1) x.closest('.rv-vcard').remove(); else x.closest('.rv-vcard').querySelectorAll('input').forEach(i => i.value = ''); return; }
                    const ed = ev.target.closest('.rv-edit');
                    if (ed) { ev.preventDefault(); Swal.close(); if (typeof openProductModal === 'function') openProductModal('UPDATE', ed.getAttribute('data-code')); return; }
                    const pr = ev.target.closest('.rv-print');
                    if (pr) { ev.preventDefault(); const c = pr.getAttribute('data-code'); Swal.close(); printBarcodes([c]); return; }
                    if (ev.target.closest('#rv-print-all')) { Swal.close(); printBarcodes(activeMembers.map(m => m.code)); return; }
                    const rm = ev.target.closest('.rv-rm');
                    if (rm) { ev.preventDefault(); const m = info.members.find(x => String(x.code) === rm.getAttribute('data-code')); Swal.close(); if (m) removeVariantFlow(m, code, opts); return; }
                    const rs = ev.target.closest('.rv-rs');
                    if (rs) { ev.preventDefault(); const c = rs.getAttribute('data-code'); Swal.close(); restoreVariantFlow(c, code, opts); return; }
                });
            },
            preConfirm: () => {
                const root = Swal.getHtmlContainer().querySelector('.rv-dlg');
                const variants = [];
                root.querySelectorAll('.rv-vcard').forEach(r => {
                    const label = r.querySelector('.rv-v-label').value.trim();
                    const price = r.querySelector('.rv-v-price').value, stock = r.querySelector('.rv-v-stock').value, vcode = r.querySelector('.rv-v-code').value.trim();
                    if (!label && !price && !stock && !vcode) return;
                    r.querySelector('.rv-v-label').classList.toggle('rv-bad', !label);
                    variants.push({ label, price, stock, code: vcode });
                });
                if (!variants.length || variants.some(v => !v.label)) { Swal.showValidationMessage('Every variant needs a label (for example "Large" or "Red").'); return false; }
                const bl = root.querySelector('#rv-base-label');
                return { variants, baseLabel: bl ? bl.value.trim() : '' };
            }
        });
        if (!result.isConfirmed) return;
        try {
            const saved = await api('POST', `/products/${encodeURIComponent(code)}/variants`, result.value);
            const before = new Set(info.members.map(m => String(m.code).toLowerCase()));
            before.add(String(code).toLowerCase());
            const newCodes = (saved.members || []).filter(m => !before.has(String(m.code).toLowerCase())).map(m => m.code);
            if (typeof loadInventoryProductsTable === 'function') loadInventoryProductsTable();
            if (typeof loadDashboardMetrics === 'function') loadDashboardMetrics();
            const ask = await Swal.fire({
                icon: 'success', title: 'Variants created', text: `${saved.message} Each one has its own barcode (its code).`,
                showCancelButton: newCodes.length > 0, showConfirmButton: newCodes.length > 0, confirmButtonText: 'Print barcode labels', cancelButtonText: 'Later',
                timer: newCodes.length ? undefined : 1600
            });
            if (ask.isConfirmed && newCodes.length) { printBarcodes(newCodes); return; }
            if (opts && opts.returnToTracker) { openTracker(opts.returnToTracker); return; }
            if (typeof openProductModal === 'function') { openProductModal('UPDATE', code); setTimeout(refreshToolState, 900); }
        } catch (e) { Swal.fire('Could not create variants', esc(e.message), 'error'); }
    }

    /* ---------------- Tracker: do recipes really deduct? how are variants doing? ---------------- */
    const trk = { root: null, data: null, tab: 'recipes', days: 30, code: '', q: '', seq: 0 };
    function closeTracker() {
        if (trk.root) { trk.root.remove(); trk.root = null; }
        document.removeEventListener('keydown', trkKey);
    }
    function trkKey(e) { if (e.key === 'Escape') closeTracker(); }
    const trkState = () => ({ code: trk.code, tab: trk.tab, days: trk.days });

    async function openTracker(opts) {
        opts = opts || {};
        injectStyle();
        closeTracker();
        trk.code = opts.code || '';
        trk.tab = opts.tab || 'recipes';
        trk.days = opts.days || trk.days || 30;
        trk.q = '';
        const root = document.createElement('div');
        root.className = 'rvt-root';
        root.innerHTML = `<div class="rvt-dim"></div><div class="rvt-sheet" role="dialog" aria-label="Recipe and variants tracker">
            <div class="rvt-head"><div class="rvt-title"><i class="fa-solid fa-chart-line"></i> Recipe &amp; Variants Tracker</div><button type="button" class="rvt-close" aria-label="Close">✕</button></div>
            <div class="rvt-tabs"></div>
            <div class="rvt-filters">
                <select class="rvt-days" aria-label="Period"><option value="1">Today</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>
                <input class="rvt-q" type="search" placeholder="Search product or ingredient" autocomplete="off">
            </div>
            <div class="rvt-scope"></div>
            <div class="rvt-body"><div class="rvt-empty">Loading…</div></div></div>`;
        document.body.appendChild(root);
        trk.root = root;
        document.addEventListener('keydown', trkKey);
        const daysSel = root.querySelector('.rvt-days');
        daysSel.value = String(trk.days);
        if (daysSel.value !== String(trk.days)) { daysSel.insertAdjacentHTML('beforeend', `<option value="${trk.days}">${trk.days} days</option>`); daysSel.value = String(trk.days); }
        root.querySelector('.rvt-dim').addEventListener('click', closeTracker);
        root.querySelector('.rvt-close').addEventListener('click', closeTracker);
        daysSel.addEventListener('change', () => { trk.days = parseInt(daysSel.value, 10) || 30; loadTracker(); });
        root.querySelector('.rvt-q').addEventListener('input', (ev) => { trk.q = String(ev.target.value || '').trim().toLowerCase(); renderTrackerBody(); });
        root.querySelector('.rvt-tabs').addEventListener('click', (ev) => {
            const b = ev.target.closest('button[data-tab]');
            if (!b) return;
            trk.tab = b.dataset.tab; renderTracker();
        });
        root.querySelector('.rvt-scope').addEventListener('click', (ev) => {
            if (ev.target.closest('.rvt-all')) { trk.code = ''; loadTracker(); }
        });
        root.querySelector('.rvt-body').addEventListener('click', onTrackerAction);
        await loadTracker();
    }
    async function loadTracker() {
        if (!trk.root) return;
        const seq = ++trk.seq;
        const body = trk.root.querySelector('.rvt-body');
        body.innerHTML = '<div class="rvt-empty">Loading…</div>';
        try {
            const d = await api('GET', `/recipe-variant-tracker?days=${trk.days}${trk.code ? '&code=' + encodeURIComponent(trk.code) : ''}`);
            if (!trk.root || seq !== trk.seq) return;
            trk.data = d;
            renderTracker();
        } catch (e) {
            if (!trk.root || seq !== trk.seq) return;
            body.innerHTML = `<div class="rvt-empty">${esc(e.message)}</div>`;
        }
    }
    function renderTracker() {
        if (!trk.root || !trk.data) return;
        const d = trk.data, s = d.summary || {};
        const bad = s.recipesBroken + s.notDeducted;
        trk.root.querySelector('.rvt-tabs').innerHTML = [
            ['recipes', 'Recipes', s.recipes, bad > 0],
            ['log', 'Deductions', s.deductions, false],
            ['variants', 'Variants', s.variantGroups, false]
        ].map(([k, label, n, isBad]) => `<button type="button" data-tab="${k}" class="${trk.tab === k ? 'on' : ''}">${label}<span class="rvt-n${isBad ? ' bad' : ''}">${fmt(n)}${isBad ? ' !' : ''}</span></button>`).join('');
        const scope = trk.root.querySelector('.rvt-scope');
        scope.innerHTML = trk.code ? `Showing only: <b>${esc(trk.code)}</b> <a class="rvt-all">Show all</a>` : '';
        renderTrackerBody();
    }
    function renderTrackerBody() {
        if (!trk.root || !trk.data) return;
        const body = trk.root.querySelector('.rvt-body');
        body.innerHTML = trk.tab === 'log' ? trkLogHtml() : (trk.tab === 'variants' ? trkVariantsHtml() : trkRecipesHtml());
    }
    const hit = (parts) => !trk.q || parts.join(' ').toLowerCase().includes(trk.q);
    const periodLabel = () => trk.days === 1 ? 'today' : `in the last ${trk.days} days`;

    function trkRecipesHtml() {
        const d = trk.data;
        const list = d.recipes.filter(r => hit([r.name, r.code, r.lines.map(l => l.name + ' ' + l.code).join(' ')]));
        if (!d.recipes.length) return '<div class="rvt-empty">No recipe products yet.<br>Open a product, then use <b>Recipe / Ingredients</b> to set what each sale should deduct.</div>';
        if (!list.length) return '<div class="rvt-empty">Nothing matches your search.</div>';
        const head = `<div class="rvt-note">${d.summary.deductions} recipe sale${d.summary.deductions === 1 ? '' : 's'} with ingredient deductions recorded ${periodLabel()}. Open the <b>Deductions</b> tab to see the stock before → after of every ingredient.</div>`;
        return head + list.map(r => {
            const pill = r.status === 'broken' ? ['bad', 'Fix recipe'] : r.status === 'out' ? ['bad', 'Out of ingredients'] : r.status === 'low' ? ['low', `Can make ${fmt(r.canMake)}`] : ['ok', `Can make ${fmt(r.canMake)}`];
            const warns = [];
            if (r.status === 'broken') warns.push(['', 'An ingredient was deleted from your products. Edit the recipe and replace it.']);
            if (r.notDeducted > 0) warns.push(['', `${r.notDeducted} sale${r.notDeducted === 1 ? '' : 's'} after the recipe was saved show NO ingredient deduction (Sale ${r.notDeductedTx.filter(Boolean).join(', ')}). Check the stock of the ingredients.`]);
            if (r.margin !== null && r.margin < 0) warns.push(['soft', 'The ingredient cost is higher than the selling price.']);
            if (r.soldQty > 0 && r.deductions === 0 && r.notDeducted === 0) warns.push(['soft', 'Sold in this period but no deduction is recorded. These sales were probably made before the recipe was set or before deductions were tracked.']);
            const lines = r.lines.map(l => {
                const bn = r.lines.length > 1 && l.code === r.bottleneck && r.status !== 'broken';
                return `<div class="rvt-ing${bn ? ' bn' : ''}"><span class="n">${esc(l.name)}</span>
                    <span class="v">${fmt(l.qty)} ${esc(l.unit)} per 1 sale · stock ${fmt(l.stock)} ${esc(l.unit)} → enough for ${fmt(l.makes)}${bn ? ' (limits this recipe)' : ''}${l.missing ? ' · <span class="neg">deleted</span>' : ''}</span></div>`;
            }).join('');
            return `<div class="rvt-card${r.status === 'broken' || r.notDeducted > 0 ? ' rvt-bad' : ''}">
                <div class="rvt-row1"><b>${esc(r.name)}</b><span class="rvt-pill ${pill[0]}">${esc(pill[1])}</span></div>
                <div class="rvt-sub">${esc(r.code)} · Price ${money(r.price)} · Cost ${money(r.unitCost)} · Margin ${r.margin !== null ? r.margin + '%' : '—'}</div>
                ${warns.map(w => `<div class="rvt-warn ${w[0]}">${esc(w[1])}</div>`).join('')}
                <div style="margin-top:6px">${lines}</div>
                <div class="rvt-sub">Sold ${periodLabel()}: <b>${fmt(r.soldQty)}</b> · Deductions recorded: <b>${r.deductions}</b>${r.lastDeductionAt ? ' · Last: ' + esc(when(r.lastDeductionAt)) : ''}</div>
                <div class="rvt-act"><button type="button" class="pri" data-act="edit" data-code="${esc(r.code)}">Edit recipe</button><button type="button" data-act="log" data-name="${esc(r.name)}">View deductions</button></div>
            </div>`;
        }).join('');
    }

    function trkLogHtml() {
        const d = trk.data;
        const usage = d.usage.filter(u => hit([u.name, u.code]));
        const log = d.log.filter(e => hit([e.name, e.code, e.txId, e.cashier, e.lines.map(l => l.name + ' ' + l.code).join(' ')]));
        const vw = Array.isArray(d.voidWaste) ? d.voidWaste.filter(g => hit([g.txId, g.by, g.lines.map(l => l.name + ' ' + l.code).join(' ')])) : [];
        const voidHtml = vw.length ? `<div class="rvt-h">Voided after preparation (${fmt(d.summary.voidWasteSales || vw.length)})</div><div class="rvt-note">These sales were voided after the food was prepared, so the ingredients were NOT returned to stock. They were logged as waste (est. loss ${money(d.summary.voidWasteCost || 0)}). Voids of orders that were not prepared put the ingredients back.</div>` + vw.map(g => `<div class="rvt-card"><div class="rvt-row1"><b>${g.txId ? 'Sale ' + esc(g.txId) : 'Voided sale'}</b><span class="rvt-sub" style="margin:0;white-space:nowrap">${esc(when(g.at))}</span></div>
            <div class="rvt-sub">${g.by ? esc(g.by) + ' · ' : ''}Loss ${money(g.cost)}</div>
            <div style="margin-top:4px">${g.lines.map(l => `<div class="rvt-ing"><span class="n">${esc(l.name || l.code)}</span><span class="v">${fmt(l.qty)} ${esc(l.unit)} wasted</span></div>`).join('')}</div></div>`).join('') : '';
        if (!d.log.length) return voidHtml + `<div class="rvt-empty">No recipe sale ${periodLabel()} yet.<br>Sell a recipe product once. It will appear here with the stock <b>before → after</b> of every ingredient, so you can confirm the deduction works.</div>`;
        let out = '';
        if (usage.length) {
            out += '<div class="rvt-h">Ingredients used</div><div class="rvt-card">' + usage.map(u =>
                `<div class="rvt-use"><span>${esc(u.name)}${u.missing ? ' <small>(deleted)</small>' : ''}</span><span><b>${fmt(u.qty)} ${esc(u.unit)}</b> used in ${u.sales} sale${u.sales === 1 ? '' : 's'}<br>stock now ${fmt(u.stock)} ${esc(u.unit)}</span></div>`).join('') + '</div>';
        }
        out += `<div class="rvt-h">Sales log (${fmt(d.logTotal)})</div>`;
        if (!log.length) return out + voidHtml + '<div class="rvt-empty">Nothing matches your search.</div>';
        out += log.map(e => `<div class="rvt-card"><div class="rvt-row1"><b>${esc(e.name)} × ${fmt(e.qty)}</b><span class="rvt-sub" style="margin:0;white-space:nowrap">${esc(when(e.at))}</span></div>
            <div class="rvt-sub">${e.txId ? 'Sale ' + esc(e.txId) : 'Sale'}${e.cashier ? ' · ' + esc(e.cashier) : ''}</div>
            <div style="margin-top:4px">${e.lines.map(l => `<div class="rvt-ing"><span class="n">${esc(l.name)}</span><span class="v">−${fmt(l.qty)} ${esc(l.unit)}${l.before !== null && l.after !== null ? ` · stock ${fmt(l.before)} → <b>${fmt(l.after)}</b>` : ''}</span></div>`).join('')}</div></div>`).join('');
        if (d.logTruncated) out += `<div class="rvt-note">Showing the newest ${d.log.length} of ${fmt(d.logTotal)}. Choose a shorter period to see the rest.</div>`;
        return out + voidHtml;
    }

    function trkVariantsHtml() {
        const d = trk.data;
        if (!d.variants.length) return '<div class="rvt-empty">No variants yet.<br>Open a product, then use <b>Variants (Size / Color)</b>. Every variant gets its own barcode that you can print here.</div>';
        const list = d.variants.filter(v => hit([v.baseName, v.baseCode, v.members.map(m => m.name + ' ' + m.code + ' ' + m.label).join(' ')]));
        if (!list.length) return '<div class="rvt-empty">Nothing matches your search.</div>';
        return `<div class="rvt-note">Each variant is its own product with its own barcode (its code). Sold ${periodLabel()} is shown per variant.</div>` + list.map(v => `<div class="rvt-card${v.issues.some(i => /unsupported/.test(i)) ? ' rvt-bad' : ''}">
            <div class="rvt-row1"><b>${esc(v.baseName)}</b><span class="rvt-pill">${v.members.length} variants</span></div>
            <div class="rvt-sub">Group ${esc(v.group)} · Stock ${fmt(v.totalStock)} · Sold ${fmt(v.totalSold)} (${money(v.totalGross)})</div>
            <div style="margin-top:6px">${v.members.map(m => `<div class="rvt-vrow"><div class="m"><b>${esc(m.label || m.name)}</b><small>${esc(m.code)} · ${money(m.price)} · ${m.hasRecipe ? 'from recipe' : 'stock ' + fmt(m.stock)} · sold ${fmt(m.soldQty)}</small></div><button type="button" data-act="print" data-codes="${esc(m.code)}">Barcode</button></div>`).join('')}</div>
            ${v.issues.map(i => `<div class="rvt-warn soft">${esc(i)}</div>`).join('')}
            <div class="rvt-act"><button type="button" class="pri" data-act="print" data-codes="${esc(v.members.map(m => m.code).join('\u0001'))}">Print all barcodes</button><button type="button" data-act="variants" data-code="${esc(v.baseCode)}">Add variants</button></div>
        </div>`).join('');
    }

    function onTrackerAction(ev) {
        const b = ev.target.closest('button[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'log') {
            trk.tab = 'log'; trk.q = String(b.dataset.name || '').toLowerCase();
            const qi = trk.root.querySelector('.rvt-q'); if (qi) qi.value = b.dataset.name || '';
            renderTracker();
        } else if (act === 'edit') {
            const st = trkState(); closeTracker(); openRecipeDialog(b.dataset.code, { returnToTracker: st });
        } else if (act === 'variants') {
            const st = trkState(); closeTracker(); openVariantsDialog(b.dataset.code, { returnToTracker: st });
        } else if (act === 'print') {
            const codes = String(b.dataset.codes || '').split('\u0001').filter(Boolean);
            closeTracker(); printBarcodes(codes);
        }
    }

    function ensureHeaderBtn() {
        const grp = document.querySelector('#view-products .header-action-group');
        if (!grp || document.getElementById('rv-open-tracker')) return;
        injectStyle();
        const b = document.createElement('button');
        b.type = 'button'; b.id = 'rv-open-tracker'; b.className = 'btn-action-outline';
        b.title = 'Track recipe ingredient deductions and product variants';
        b.innerHTML = '<i class="fa-solid fa-chart-line"></i><span class="btn-action-label"> Recipe &amp; Variants</span>';
        b.addEventListener('click', () => openTracker({}));
        grp.insertBefore(b, grp.firstChild);
    }

    /* ---------------- Barcode page: variant filter, group select, copies = stock ---------------- */
    async function decorateBarcodePage() {
        const tbody = document.getElementById('barcode-table-body');
        if (!tbody) return;
        // Concurrent runs (the page can be reloaded twice in quick succession) must not each insert a bar:
        // only the most recent run may draw, and any older bar is removed right before the new one goes in.
        const runId = (window.__rvBcRun = (window.__rvBcRun || 0) + 1);
        let list = [];
        try { const res = await authFetch(`${API_URL}/products?lite=1`); list = await res.json(); } catch (e) { list = products(); }
        if (!Array.isArray(list)) list = products();
        if (runId !== window.__rvBcRun) return; // a newer run took over while we were fetching
        const byCode = new Map(list.filter(Boolean).map(p => [String(p.code), p]));
        const groups = new Map();
        tbody.querySelectorAll('tr').forEach(tr => {
            const cb = tr.querySelector('.barcode-select-item');
            if (!cb) return;
            const p = byCode.get(String(cb.dataset.code));
            if (!p) return;
            tr.dataset.stock = String(num(p.stock));
            if (!p.variantGroup) return;
            tr.dataset.vgroup = String(p.variantGroup);
            const nameCell = tr.children[3];
            if (nameCell && !nameCell.querySelector('.rv-chip')) nameCell.insertAdjacentHTML('beforeend', ` <span class="rv-chip">${esc(p.variantLabel || 'Variant')}</span>`);
            const g = groups.get(p.variantGroup) || { id: String(p.variantGroup), n: 0 };
            g.n++; groups.set(p.variantGroup, g);
        });
        document.querySelectorAll('#rv-bc-bar').forEach(el => el.remove());
        if (!groups.size) return;
        injectStyle();
        groups.forEach(g => { const base = byCode.get(g.id); g.name = base ? base.name : g.id; });
        const table = tbody.closest('table');
        if (!table || !table.parentNode) return;
        let anchor = table;
        try { const o = getComputedStyle(table.parentNode).overflowX; if ((o === 'auto' || o === 'scroll') && table.parentNode.parentNode) anchor = table.parentNode; } catch (e) { /* keep table */ }
        const bar = document.createElement('div');
        bar.id = 'rv-bc-bar';
        bar.innerHTML = `<select id="rv-bc-filter" aria-label="Filter variants"><option value="">All products</option><option value="__variants">Variants only</option>${Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name)).map(g => `<option value="${esc(g.id)}">${esc(g.name)} (${g.n} variants)</option>`).join('')}</select>
            <label><input type="checkbox" id="rv-bc-stock"> Copies = stock</label>
            <button type="button" id="rv-bc-sel">Select shown</button>
            <button type="button" id="rv-bc-print"><i class="fa-solid fa-print"></i> Print shown</button>
            <div class="rv-bc-hint">Pick a variant group to print the labels of all its sizes/colors together. Each label uses the variant's own code.</div>`;
        anchor.parentNode.insertBefore(bar, anchor);
        const rows = () => Array.from(tbody.querySelectorAll('tr'));
        const visible = (tr) => tr.style.display !== 'none';
        const applyCopies = () => {
            const useStock = document.getElementById('rv-bc-stock').checked;
            rows().filter(visible).forEach(tr => {
                const q = tr.querySelector('.barcode-qty-input'); if (!q) return;
                q.value = useStock ? String(Math.max(1, Math.floor(num(tr.dataset.stock)))) : '1';
            });
        };
        const applyFilter = () => {
            const v = document.getElementById('rv-bc-filter').value;
            rows().forEach(tr => {
                const g = tr.dataset.vgroup || '';
                const show = v === '' || (v === '__variants' ? !!g : g === v);
                tr.style.display = show ? '' : 'none';
                if (!show) { const cb = tr.querySelector('.barcode-select-item'); if (cb) cb.checked = false; }
            });
            const master = document.getElementById('select-all-barcodes'); if (master) master.checked = false;
            applyCopies();
        };
        const selectShown = () => rows().filter(visible).forEach(tr => { const cb = tr.querySelector('.barcode-select-item'); if (cb) cb.checked = true; });
        document.getElementById('rv-bc-filter').addEventListener('change', applyFilter);
        document.getElementById('rv-bc-stock').addEventListener('change', applyCopies);
        document.getElementById('rv-bc-sel').addEventListener('click', selectShown);
        document.getElementById('rv-bc-print').addEventListener('click', () => {
            selectShown();
            if (typeof generateSelectedBarcodePreview === 'function') generateSelectedBarcodePreview();
        });
    }
    function hookBarcodePage() {
        if (window.__rvBarcodeHooked) return true;
        if (typeof window.loadBarcodeGeneratorModule !== 'function') return false;
        window.__rvBarcodeHooked = true;
        const orig = window.loadBarcodeGeneratorModule;
        window.loadBarcodeGeneratorModule = function () {
            const p = Promise.resolve(orig.apply(this, arguments)).then(() => decorateBarcodePage()).catch(() => { /* the page already reports its own errors */ });
            window.__rvBarcodeReady = p;
            return p;
        };
        // "Select all" must not tick rows hidden by the variant filter.
        if (typeof window.toggleSelectAllBarcodes === 'function') {
            window.toggleSelectAllBarcodes = function (master) {
                document.querySelectorAll('.barcode-select-item').forEach(cb => {
                    const tr = cb.closest('tr');
                    if (!tr || tr.style.display !== 'none') cb.checked = master.checked;
                });
            };
        }
        return true;
    }

    function boot() {
        if (!watchProductModal()) { setTimeout(boot, 600); return; }
        hookBarcodePage();
        ensureHeaderBtn();
        setInterval(() => { ensureHeaderBtn(); hookBarcodePage(); }, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 300)); else setTimeout(boot, 300);
    window.RecipeVariants = Object.freeze({ version: '1.1', openRecipeDialog, openVariantsDialog, openTracker, printBarcodes, refreshToolState });
})();


/* ------------------------------------------------------------------------
 * OmniPicker — one searchable picker for the whole app (replaces the native <datalist> popup).
 *  - Full-height sheet that follows the visible area, so the keyboard can never cover the list.
 *  - Big tap rows, highlighted matches, stock/status badges, "Use what I typed" for free text.
 *  - Colours come from the app theme variables (--dm-*), so it matches dark and light mode.
 * Usage:  const r = await OmniPicker.open({ title, items:[{value,label,sub,badge,tone,search}], selected, allowCustom });
 *         r = { value, label, custom, item } or null when closed without choosing.
 * Every <input list="..."> in the app is upgraded automatically (supplier and category fields use it too).
 * ------------------------------------------------------------------------ */
(function () {
    'use strict';
    if (window.OmniPicker) return;
    const h = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tokens = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    // -1 = no match. Higher = better: a match at the start of the name beats one in the middle or only in the code/sub text.
    function score(item, words) {
        const label = String(item.label == null ? '' : item.label).toLowerCase();
        const hay = String(item.search || (label + ' ' + (item.sub || ''))).toLowerCase();
        let s = 0;
        for (const w of words) {
            if (hay.indexOf(w) < 0) return -1;
            const i = label.indexOf(w);
            if (i === 0) s += 100;
            else if (i > 0 && /[\s\-(/]/.test(label[i - 1])) s += 60;
            else if (i > 0) s += 30;
            else s += 10;
        }
        return s;
    }
    function highlight(text, words) {
        const t = String(text == null ? '' : text);
        if (!words.length || !t) return h(t);
        const lower = t.toLowerCase(), marks = new Array(t.length).fill(false);
        for (const w of words) { let i = lower.indexOf(w); while (i > -1) { for (let k = i; k < i + w.length; k++) marks[k] = true; i = lower.indexOf(w, i + w.length); } }
        let out = '', openTag = false;
        for (let i = 0; i < t.length; i++) {
            if (marks[i] && !openTag) { out += '<mark>'; openTag = true; }
            if (!marks[i] && openTag) { out += '</mark>'; openTag = false; }
            out += h(t[i]);
        }
        return openTag ? out + '</mark>' : out;
    }
    function injectCss() {
        if (document.getElementById('omp-style')) return;
        const st = document.createElement('style');
        st.id = 'omp-style';
        st.textContent = `
.omp-root{position:fixed;inset:0;z-index:2147483000;font-family:var(--dm-font-body,system-ui,-apple-system,Segoe UI,Roboto,sans-serif);
 --omp-bg:var(--dm-surface,#0f1b3a);--omp-bg2:var(--dm-surface-alt,#17274f);--omp-tx:var(--dm-text-primary,#f1f5f9);--omp-mu:var(--dm-text-muted,#94a3b8);
 --omp-ac:var(--dm-accent,#3b82f6);--omp-bd:var(--dm-border,rgba(148,163,184,.28))}
.omp-root.omp-light{--omp-bg:#ffffff;--omp-bg2:#f1f5f9;--omp-tx:#0f172a;--omp-mu:#64748b;--omp-bd:#dbe3ee}
.omp-dim{position:absolute;inset:0;background:rgba(2,6,23,.62);animation:omp-fade .15s ease-out}
.omp-sheet{position:absolute;left:0;right:0;top:0;height:100%;display:flex;flex-direction:column;background:var(--omp-bg);color:var(--omp-tx);overflow:hidden;animation:omp-up .18s ease-out}
.omp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:max(12px,env(safe-area-inset-top)) 14px 6px}
.omp-title{font-size:1.05rem;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.omp-close,.omp-clear{flex:none;width:38px;height:38px;border:none;border-radius:50%;background:var(--omp-bg2);color:var(--omp-tx);font-size:1rem;cursor:pointer}
.omp-search{display:flex;align-items:center;gap:8px;margin:6px 12px 8px;padding:0 6px 0 12px;border:2px solid var(--omp-ac);border-radius:12px;background:var(--omp-bg2)}
.omp-search i{color:var(--omp-mu)}
.omp-input{flex:1;min-width:0;height:46px;border:none;outline:none;background:transparent;color:var(--omp-tx);font-size:1rem;font-family:inherit}
.omp-input::placeholder{color:var(--omp-mu)}
.omp-clear{width:32px;height:32px;font-size:.85rem}
.omp-list{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0 8px 8px}
.omp-row{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;margin:0 0 4px;padding:8px 12px;border:1px solid transparent;border-radius:12px;background:transparent;color:var(--omp-tx);text-align:left;font:inherit;cursor:pointer}
.omp-row:active,.omp-row.omp-act{background:var(--omp-bg2);border-color:var(--omp-bd)}
.omp-row.omp-sel{border-color:var(--omp-ac)}
.omp-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.omp-main b{font-weight:600;font-size:.95rem;line-height:1.25;overflow-wrap:anywhere}
.omp-main small{color:var(--omp-mu);font-size:.78rem;line-height:1.25;overflow-wrap:anywhere}
.omp-main mark{background:rgba(250,204,21,.38);color:inherit;border-radius:3px;padding:0 1px}
.omp-badge{flex:none;padding:2px 8px;border-radius:999px;font-size:.7rem;font-weight:600;background:rgba(148,163,184,.22);color:var(--omp-mu)}
.omp-badge.omp-bad{background:rgba(239,68,68,.16);color:#dc2626}body.dark-mode .omp-badge.omp-bad{color:#f87171}
.omp-badge.omp-good{background:rgba(34,197,94,.16);color:#15803d}body.dark-mode .omp-badge.omp-good{color:#4ade80}
.omp-check{flex:none;color:var(--omp-ac);font-weight:800}
.omp-plus{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:var(--omp-ac);color:#fff;font-weight:700}
.omp-empty{padding:28px 16px;text-align:center;color:var(--omp-mu)}
.omp-foot{padding:6px 14px max(8px,env(safe-area-inset-bottom));font-size:.75rem;color:var(--omp-mu);text-align:center;min-height:18px}
@keyframes omp-up{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}
@keyframes omp-fade{from{opacity:0}to{opacity:1}}
@media (min-width:720px){.omp-sheet{left:50%;right:auto;width:560px;transform:translateX(-50%);top:7vh!important;height:auto!important;max-height:86vh;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.5);animation:none}}
@media (prefers-reduced-motion:reduce){.omp-sheet,.omp-dim{animation:none}}`;
        document.head.appendChild(st);
    }
    function pageIsLight() {
        try {
            if (getComputedStyle(document.body).getPropertyValue('--dm-surface').trim()) return false; // the app theme variables live on <body> and already match
            const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor || '');
            return !!m && (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) > 160;
        } catch (e) { return false; }
    }

    function open(opts) {
        injectCss();
        return new Promise((resolve) => {
            const o = Object.assign({ title: 'Choose', placeholder: 'Search…', items: [], selected: '', allowCustom: false, customLabel: 'Use', emptyText: 'No matches.', initialQuery: '', maxRows: 60 }, opts || {});
            const root = document.createElement('div');
            root.className = 'omp-root' + (pageIsLight() ? ' omp-light' : '');
            root.innerHTML = `<div class="omp-dim"></div>
                <div class="omp-sheet" role="dialog" aria-modal="true" aria-label="${h(o.title)}">
                    <div class="omp-head"><div class="omp-title">${h(o.title)}</div><button type="button" class="omp-close" aria-label="Close">✕</button></div>
                    <div class="omp-search"><i class="fa-solid fa-magnifying-glass"></i>
                        <input type="text" class="omp-input" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" placeholder="${h(o.placeholder)}">
                        <button type="button" class="omp-clear" aria-label="Clear" hidden>✕</button></div>
                    <div class="omp-list" role="listbox"></div>
                    <div class="omp-foot"></div>
                </div>`;
            document.body.appendChild(root);
            const sheet = root.querySelector('.omp-sheet'), input = root.querySelector('.omp-input'), list = root.querySelector('.omp-list');
            const foot = root.querySelector('.omp-foot'), clearBtn = root.querySelector('.omp-clear');
            const prevOverflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = 'hidden';
            let shown = [], active = 0, done = false;
            const selectedKey = String(o.selected == null ? '' : o.selected).toLowerCase();

            function fit() {
                const vv = window.visualViewport;
                sheet.style.top = (vv ? vv.offsetTop : 0) + 'px';
                sheet.style.height = (vv ? vv.height : window.innerHeight) + 'px';
            }
            // While the picker is open it owns the keyboard: Escape closes ONLY the picker (not the dialog below it), and focus
            // can never slip to a button of the dialog underneath.
            const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); finish(null); } };
            const onFocusIn = (ev) => { if (!done && !root.contains(ev.target)) input.focus({ preventScroll: true }); };
            window.addEventListener('keydown', onKey, true);
            document.addEventListener('focusin', onFocusIn, true);
            function finish(val) {
                if (done) return; done = true;
                window.removeEventListener('keydown', onKey, true);
                document.removeEventListener('focusin', onFocusIn, true);
                if (window.visualViewport) { window.visualViewport.removeEventListener('resize', fit); window.visualViewport.removeEventListener('scroll', fit); }
                window.removeEventListener('resize', fit);
                document.documentElement.style.overflow = prevOverflow;
                root.remove();
                resolve(val);
            }
            function render() {
                const q = input.value.trim(), words = tokens(q);
                clearBtn.hidden = !input.value;
                const scored = [];
                for (const it of o.items) { const sc = words.length ? score(it, words) : 0; if (sc >= 0) scored.push({ it, sc }); }
                scored.sort((a, b) => (b.sc - a.sc) || String(a.it.label).localeCompare(String(b.it.label), undefined, { numeric: true, sensitivity: 'base' }));
                const slice = scored.slice(0, o.maxRows);
                shown = [];
                if (o.allowCustom && q && !o.items.some(it => String(it.label).toLowerCase() === q.toLowerCase())) shown.push({ kind: 'custom', value: q });
                slice.forEach(x => shown.push({ kind: 'item', item: x.it }));
                active = 0;
                if (!words.length && selectedKey) { const si = shown.findIndex(r => r.kind === 'item' && String(r.item.value).toLowerCase() === selectedKey); if (si > -1) active = si; }
                list.innerHTML = shown.length ? shown.map((r, i) => {
                    if (r.kind === 'custom') return `<button type="button" class="omp-row${i === active ? ' omp-act' : ''}" data-i="${i}" role="option"><span class="omp-plus">+</span><span class="omp-main"><b>${h(o.customLabel)} “${h(r.value)}”</b><small>Not in the list — use what you typed</small></span></button>`;
                    const it = r.item, isSel = selectedKey && String(it.value).toLowerCase() === selectedKey;
                    const badge = it.badge ? `<span class="omp-badge ${it.tone === 'bad' ? 'omp-bad' : it.tone === 'good' ? 'omp-good' : ''}">${h(it.badge)}</span>` : '';
                    return `<button type="button" class="omp-row${isSel ? ' omp-sel' : ''}${i === active ? ' omp-act' : ''}" data-i="${i}" role="option"><span class="omp-main"><b>${highlight(it.label, words)}</b>${it.sub ? `<small>${highlight(it.sub, words)}</small>` : ''}</span>${badge}${isSel ? '<span class="omp-check">✓</span>' : ''}</button>`;
                }).join('') : `<div class="omp-empty">${h(o.emptyText)}</div>`;
                foot.textContent = scored.length > slice.length ? `Showing ${slice.length} of ${scored.length} — keep typing to narrow down` : (scored.length ? `${scored.length} item${scored.length === 1 ? '' : 's'}` : '');
                const act = list.querySelector('.omp-act'); if (act && active > 0) act.scrollIntoView({ block: 'nearest' }); else list.scrollTop = 0;
            }
            function setActive(i) {
                if (!shown.length) return;
                active = (i + shown.length) % shown.length;
                list.querySelectorAll('.omp-row').forEach((el, k) => el.classList.toggle('omp-act', k === active));
                const el = list.querySelectorAll('.omp-row')[active]; if (el) el.scrollIntoView({ block: 'nearest' });
            }
            function choose(i) {
                const r = shown[i]; if (!r) return;
                if (r.kind === 'custom') return finish({ value: r.value, label: r.value, custom: true, item: null });
                finish({ value: r.item.value, label: r.item.label, custom: false, item: r.item });
            }
            root.querySelector('.omp-dim').addEventListener('click', () => finish(null));
            root.querySelector('.omp-close').addEventListener('click', () => finish(null));
            clearBtn.addEventListener('click', () => { input.value = ''; render(); input.focus(); });
            input.addEventListener('input', render);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') { ev.preventDefault(); finish(null); }
                else if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
                else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
                else if (ev.key === 'Enter') { ev.preventDefault(); if (shown.length) choose(active); }
            });
            list.addEventListener('click', (ev) => { const row = ev.target.closest('.omp-row'); if (row) choose(parseInt(row.dataset.i, 10)); });
            if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); }
            window.addEventListener('resize', fit);
            fit();
            input.value = o.initialQuery || '';
            render();
            input.focus({ preventScroll: true });            // right away, so no keypress can reach the dialog underneath
            if (input.value) input.select();
            setTimeout(() => { if (!done && document.activeElement !== input) input.focus({ preventScroll: true }); }, 80);
        });
    }

    /* Every <input list="..."> (supplier on Purchase Orders, bulk "Change category", ...) opens the picker instead of the
       native popup that floats over dialogs and fights with the keyboard. Typing a new value is still allowed. */
    const skipUntil = new WeakMap();
    const TITLES = [[/^inv-bulk-cat/, 'Choose category'], [/^po-supplier/, 'Choose supplier']];
    async function openForListInput(input) {
        if (!input || input.disabled || input.readOnly || input.dataset.ompBusy === '1') return;
        if (Date.now() < (skipUntil.get(input) || 0)) return;
        const listId = input.getAttribute('list') || input.dataset.ompList;
        const dl = listId ? document.getElementById(listId) : null;
        if (!dl) return;
        input.dataset.ompList = listId;
        input.removeAttribute('list');                      // switch the native popup off for this field
        const items = Array.from(dl.options).map(op => ({ value: op.value, label: op.value, sub: op.label && op.label !== op.value ? op.label : '' }));
        const cur = input.value.trim();
        const exact = items.some(it => it.value.toLowerCase() === cur.toLowerCase());
        const hit = TITLES.find(t => t[0].test(input.id || ''));
        input.dataset.ompBusy = '1';
        let res = null;
        try {
            res = await OmniPicker.open({
                title: hit ? hit[1] : (input.getAttribute('placeholder') || 'Choose'),
                placeholder: 'Search, or type a new one', items, selected: cur,
                allowCustom: true, customLabel: 'Use', initialQuery: exact ? '' : cur,
                emptyText: items.length ? 'No match — type a new one and tap “Use”.' : 'Nothing saved yet — type a new one and tap “Use”.'
            });
        } finally { input.dataset.ompBusy = ''; skipUntil.set(input, Date.now() + 600); }
        if (res) {
            input.value = res.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        input.blur();
    }
    const onListInput = (ev) => {
        const t = ev.target;
        if (t && t.matches && t.matches('input[list], input[data-omp-list]')) openForListInput(t);
    };
    document.addEventListener('focusin', onListInput, true);
    document.addEventListener('click', onListInput, true);   // also when the field is already focused

    /* Any other dialog field: when the keyboard opens, scroll the field into view instead of letting it hide behind it. */
    document.addEventListener('focusin', (ev) => {
        const t = ev.target;
        if (t && t.closest && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.closest('.swal2-popup') && !t.closest('.omp-root')) {
            setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* old WebView */ } }, 320);
        }
    });

    window.OmniPicker = Object.freeze({ version: '1.0', open, _test: { tokens, score, highlight } });
})();
