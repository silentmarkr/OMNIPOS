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
body.dark-mode .di-watch-row:hover{background:rgba(124,92,255,.12)}
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
                authFetch(`${API_URL}/products`),
                authFetch(`${API_URL}/transactions`)
            ]);
            const products = resProd.ok ? await resProd.json() : JSON.parse(localStorage.getItem('cached_products') || '[]');
            const serverTxs = resTx.ok ? await resTx.json() : JSON.parse(localStorage.getItem('cached_transactions') || '[]');
            const rawOffline = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
            const offlineTxs = rawOffline.map(item => item.transaction || item);
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
