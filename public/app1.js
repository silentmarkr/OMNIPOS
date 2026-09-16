/* OMNIPOS app1.js — Branch Intelligence & Safety Extension
 * Keeps the large app.js core untouched. Enhances the existing Branches page
 * with health KPIs, search/sort/filter, CSV export, sync state, and safer UX.
 */
(function () {
    'use strict';
    if (window.__OMNI_BRANCH_INTELLIGENCE__) return;
    window.__OMNI_BRANCH_INTELLIGENCE__ = true;

    const state = {
        query: '',
        health: 'all',
        sort: 'status',
        transferQuery: '',
        transferStatus: 'all'
    };

    const esc = (v) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    const money = (n) => {
        const symbol = (window.storeSettingsCache && window.storeSettingsCache.currencySymbol) || '₱';
        return symbol + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const ageMs = (ts) => ts ? Math.max(0, Date.now() - Number(ts)) : Infinity;
    const isStale = (b) => !b.isSelf && ageMs(b.updatedAt) > 30 * 60 * 1000;
    const health = (b) => {
        if (b.isSelf && ageMs(b.updatedAt) > 15 * 60 * 1000) return 'attention';
        if (isStale(b)) return 'offline';
        if ((Number(b.summary && b.summary.lowStockCount) || 0) > 0) return 'low';
        return 'online';
    };

    function injectStyle() {
        if (document.getElementById('omni-branch-intelligence-style')) return;
        const style = document.createElement('style');
        style.id = 'omni-branch-intelligence-style';
        style.textContent = `
#branches-intel-toolbar{display:grid;grid-template-columns:minmax(180px,1fr) auto auto auto;gap:8px;align-items:center;margin:0 0 14px}
#branches-intel-toolbar input,#branches-intel-toolbar select{min-height:38px;padding:7px 10px;border:1px solid var(--border-color);border-radius:8px;background:#fff;color:var(--text-primary);box-sizing:border-box}
#branches-intel-toolbar .bi-btn{min-height:38px;padding:7px 11px;border:1px solid var(--border-color);border-radius:8px;background:transparent;color:inherit;cursor:pointer}
#branches-intel-toolbar .bi-btn:hover{filter:brightness(.97)}
.bi-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:14px}
.bi-kpi{border:1px solid var(--border-color);border-radius:10px;padding:12px;background:#fff;color:var(--text-primary);min-width:0}
.bi-kpi .v{font-size:1.25rem;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bi-kpi .l{font-size:.72rem;color:var(--text-muted);margin-top:3px}
.bi-health-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--success-green);vertical-align:middle}
.bi-health-dot.offline{background:var(--danger-red)}.bi-health-dot.attention{background:var(--warning-gold)}.bi-health-dot.low{background:var(--warning-gold)}
.bi-branch-card-hidden{display:none!important}
.bi-branch-card{position:relative;overflow:hidden;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}
.bi-branch-card [onclick]{touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none}
.bi-branch-card [onclick]:active{opacity:.86}
.bi-touch-hint{display:none}
.bi-mobile-filter-row{display:none}
.bi-mobile-sort-row{display:none}
.bi-branch-mobile-metrics{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:14px}
.bi-sync-line{font-size:.72rem;color:var(--text-muted);margin:-5px 0 12px}
/* Branches theme hardening: never force light/dark colors on the existing theme. */
#view-branches .view-header-row .btn-action-outline,
#view-branches .bi-btn{
  background:transparent !important;
  color:var(--text-primary);
  border-color:var(--border-color);
}
#view-branches .view-header-row .btn-action-outline:hover,
#view-branches .bi-btn:hover{
  background:rgba(127,127,127,.10) !important;
  color:var(--text-primary);
}
/* branches-new-transfer-btn is intentionally excluded above: it now carries
   its own permanent gradient "connection" styling below, independent of
   light/dark theme (see the Branches header actions block). */
#view-branches .branches-transfer-row,
#view-branches .branches-transfer-list .branches-transfer-row{
  background:transparent !important;
  color:var(--text-primary);
  border-color:var(--border-color);
}
#view-branches .branches-transfer-row .secondary,
#view-branches .branches-transfer-row .muted{color:var(--text-muted);}

/* --- Branches header actions: Refresh + New Transfer Request ------------
   A more deliberate "network / branch connection" look for the two header
   actions: Refresh becomes a compact circular icon button that spins and
   pulses (like a device re-syncing with the network) while a refresh is
   in flight, and New Transfer Request becomes a bold gradient pill with a
   traveling light-sweep — it's the primary, branch-to-branch action on
   this page, so it should read as the obvious next step. */
#view-branches #branches-header-refresh-btn{
  position:relative;
  width:42px;height:42px;min-width:42px;min-height:42px;
  padding:0!important;
  border-radius:50%;
  justify-content:center;
  border:1.5px solid var(--border-color);
  flex-shrink:0;
}
#view-branches #branches-header-refresh-btn i{font-size:15px;transition:transform .5s cubic-bezier(.4,0,.2,1);}
#view-branches #branches-header-refresh-btn:hover{
  border-color:#2563eb;
  box-shadow:0 0 0 5px rgba(37,99,235,.12);
  transform:translateY(-1px);
}
#view-branches #branches-header-refresh-btn::after{
  content:'';position:absolute;inset:-4px;border-radius:50%;
  border:1.5px solid #2563eb;opacity:0;transform:scale(.82);
  pointer-events:none;
  transition:opacity .25s ease, transform .25s ease;
}
#view-branches #branches-header-refresh-btn.is-refreshing i{animation:branches-refresh-spin .7s linear infinite;}
#view-branches #branches-header-refresh-btn.is-refreshing::after{
  opacity:.55;animation:branches-refresh-pulse 1.1s ease-out infinite;
}
body.dark-mode #view-branches #branches-header-refresh-btn:hover{
  border-color:var(--dm-accent);
  box-shadow:0 0 0 5px rgba(56,189,248,.16);
}
@keyframes branches-refresh-spin{to{transform:rotate(360deg);}}
@keyframes branches-refresh-pulse{0%{opacity:.55;transform:scale(.86);}100%{opacity:0;transform:scale(1.35);}}

#view-branches #branches-new-transfer-btn{
  background:linear-gradient(135deg,#2563eb,#7c3aed)!important;
  color:#fff!important;
  border:none!important;
  border-radius:999px;
  padding:10px 18px 10px 15px;
  position:relative;
  overflow:hidden;
  box-shadow:0 4px 14px rgba(37,99,235,.35);
}
#view-branches #branches-new-transfer-btn::before{
  content:'';position:absolute;inset:0;
  background:linear-gradient(120deg,transparent,rgba(255,255,255,.35),transparent);
  transform:translateX(-130%);
  pointer-events:none;
}
#view-branches #branches-new-transfer-btn:hover::before{transform:translateX(130%);transition:transform .7s ease;}
#view-branches #branches-new-transfer-btn:hover{box-shadow:0 6px 20px rgba(37,99,235,.45);transform:translateY(-1px);}
#view-branches #branches-new-transfer-btn:active{transform:translateY(0);box-shadow:0 3px 10px rgba(37,99,235,.35);}

/* Dark mode: this app applies dark-mode colors per component via body.dark-mode
   overrides (see .overview-trend-card etc. in style.css), not through a global
   variable swap — --text-primary/--border-color/--top-header-bg stay at their
   light values on this view otherwise. Mirror that same convention here so every
   piece we injected actually follows the active theme instead of defaulting to
   hardcoded light (or, previously, an always-dark fallback) colors. */
body.dark-mode #branches-intel-toolbar input,
body.dark-mode #branches-intel-toolbar select{
  background:var(--dm-surface-alt);
  border-color:var(--dm-border);
  color:var(--dm-text-primary);
}
body.dark-mode #branches-intel-toolbar input::placeholder{color:var(--dm-text-muted)}
body.dark-mode #branches-intel-toolbar select option{background:var(--dm-surface-alt);color:var(--dm-text-primary)}
body.dark-mode .bi-kpi{
  background:var(--dm-surface);
  border-color:var(--dm-border);
  color:var(--dm-text-primary);
}
body.dark-mode .bi-kpi .l{color:var(--dm-text-secondary)}
body.dark-mode .bi-sync-line{color:var(--dm-text-secondary)}
body.dark-mode #view-branches .view-header-row .btn-action-outline,
body.dark-mode #view-branches .bi-btn{
  color:var(--dm-text-primary);
  border-color:var(--dm-border);
}
body.dark-mode #view-branches .branches-transfer-row,
body.dark-mode #view-branches .branches-transfer-list .branches-transfer-row{
  color:var(--dm-text-primary);
  border-color:var(--dm-border);
}
body.dark-mode #view-branches .branches-transfer-row .secondary,
body.dark-mode #view-branches .branches-transfer-row .muted{color:var(--dm-text-secondary);}
@media (pointer:coarse){#branches-intel-toolbar input,#branches-intel-toolbar select,#branches-intel-toolbar .bi-btn{min-height:44px;touch-action:manipulation}.bi-branch-card [onclick]{min-height:52px}}
@media(max-width:900px){.bi-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}#branches-intel-toolbar{grid-template-columns:1fr 1fr}.bi-export{grid-column:span 2}}
/* Desktop: match the fixed-width search box already used on the Transactions
   page (see #view-transactions .terminal-top-controls .search-box-container
   in style.css) instead of letting the grid's 1fr column stretch this input
   across all the free space in the toolbar row. */
@media(min-width:1025px){
  #branches-intel-toolbar{grid-template-columns:400px auto auto auto}
  #bi-branch-search{max-width:400px}
}
@media(max-width:600px){
  #view-branches{padding-left:8px;padding-right:8px}
  #view-branches .view-header-row{position:sticky;top:0;z-index:5;background:var(--bg-page,#fff);padding:8px 0;margin-bottom:10px!important}
  body.dark-mode #view-branches .view-header-row{background:var(--dm-bg)}
  #view-branches .view-header-row h2{font-size:1.05rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}
  #view-branches .view-header-row>div{gap:6px!important}
  #view-branches .view-header-row button{min-width:44px;min-height:44px;padding:8px;font-size:0;touch-action:manipulation}
  #view-branches .view-header-row button i{font-size:16px;margin:0}
  #view-branches #branches-new-transfer-btn{font-size:0}
  #view-branches #branches-new-transfer-btn i{font-size:16px}
  #branches-intel-toolbar{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
  #branches-intel-toolbar input{width:100%;min-height:46px;font-size:16px}
  #branches-intel-toolbar select{width:100%;min-height:44px;font-size:15px}
  #branches-intel-toolbar .bi-export{width:100%;min-height:44px}
  .bi-kpis{display:flex;overflow-x:auto;gap:8px;padding:1px 1px 8px;margin-bottom:6px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
  .bi-kpi{flex:0 0 min(72vw,210px);scroll-snap-align:start;padding:11px 12px;min-height:64px}
  .bi-kpi .v{font-size:1.05rem}
  .bi-sync-line{font-size:.7rem;line-height:1.45;margin:0 0 10px}
  .bi-branch-card{margin-bottom:8px!important;border-radius:12px!important}
  .bi-branch-card>div:first-child{padding:4px 0;gap:8px!important}
  .bi-branch-card>div:first-child>div:first-child{min-width:0;flex:1}
  .bi-branch-card>div:first-child>div:last-child{flex:0 0 auto}
  .bi-branch-card .bi-touch-hint{display:block;font-size:.66rem;color:var(--text-muted);margin-top:4px}
  body.dark-mode .bi-branch-card .bi-touch-hint{color:var(--dm-text-secondary)}
  .bi-branch-card .bi-touch-hint i{margin-right:4px}
  .bi-branch-card .bi-branch-mobile-metrics{display:grid!important;grid-template-columns:1fr 1fr;gap:8px!important;margin:10px 0 12px!important}
  .bi-branch-card .bi-branch-mobile-metrics>div{padding:8px 9px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-page,#fff)}
  body.dark-mode .bi-branch-card .bi-branch-mobile-metrics>div{background:var(--dm-surface-alt);border-color:var(--dm-border)}
  .bi-branch-card .bi-branch-mobile-metrics>div:nth-child(n+3){display:none}
  .bi-branch-card svg{width:100%!important;max-width:100%!important;height:auto!important;min-height:115px}
  #branches-page-body>h3{font-size:.88rem!important;margin:14px 0 8px!important}
  #branches-page-body .overview-trend-card{max-width:100%;box-sizing:border-box}
}
@media(max-width:380px){.bi-kpi{flex-basis:78vw}.bi-branch-card>div:first-child>div:last-child>div{font-size:.9rem!important}.bi-branch-card>div:first-child>div:last-child{gap:5px!important}.bi-branch-card{padding:10px!important}}
`;
        document.head.appendChild(style);
    }

    function branchStats(branches) {
        const online = branches.filter(b => !isStale(b)).length;
        const offline = branches.filter(isStale).length;
        const low = branches.reduce((n,b) => n + (Number(b.summary && b.summary.lowStockCount) || 0), 0);
        const shifts = branches.reduce((n,b) => n + (Number(b.summary && b.summary.activeShiftCount) || 0), 0);
        const sales = branches.reduce((n,b) => n + (Number(b.summary && (b.summary.netSalesToday ?? b.summary.grossSalesToday)) || 0), 0);
        const tx = branches.reduce((n,b) => n + (Number(b.summary && b.summary.transactionCountToday) || 0), 0);
        return { online, offline, low, shifts, sales, tx };
    }

    function exportCsv() {
        const branches = Array.isArray(window.branchesPageState && window.branchesPageState.branches) ? window.branchesPageState.branches : [];
        if (!branches.length) return;
        const rows = [['Branch','Installation ID','Status','Last Update','Net Sales Today','Transactions Today','Low Stock','Active Shifts']];
        branches.forEach(b => rows.push([
            b.branchName || 'Unnamed Branch', b.installationId || '', health(b), b.updatedAt ? new Date(b.updatedAt).toISOString() : '',
            Number(b.summary && (b.summary.netSalesToday ?? b.summary.grossSalesToday)) || 0,
            Number(b.summary && b.summary.transactionCountToday) || 0,
            Number(b.summary && b.summary.lowStockCount) || 0,
            Number(b.summary && b.summary.activeShiftCount) || 0
        ]));
        const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `omnipos-branches-${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function getBranchCards() {
        const body = document.getElementById('branches-page-body');
        if (!body) return [];
        const heading = [...body.querySelectorAll('h3')].find(h => /Per-Branch Detail/i.test(h.textContent || ''));
        if (!heading) return [];
        const out = [];
        let el = heading.nextElementSibling;
        while (el) {
            if (el.classList && el.classList.contains('overview-trend-card')) out.push(el);
            if (el.querySelector && /Stock Transfer Requests/i.test(el.textContent || '')) break;
            el = el.nextElementSibling;
        }
        return out;
    }

    function applyFilters() {
        const branches = Array.isArray(window.branchesPageState && window.branchesPageState.branches) ? window.branchesPageState.branches : [];
        const cards = getBranchCards();
        const q = state.query.trim().toLowerCase();
        const byId = new Map(branches.map(b => [String(b.installationId), b]));
        const indexed = cards.map(card => ({ card, b: byId.get(String(card.dataset.branchId || '')) })).filter(x => x.b);
        indexed.forEach(x => {
            const b=x.b;
            const matchQ=!q || String(b.branchName||'').toLowerCase().includes(q) || String(b.installationId||'').toLowerCase().includes(q);
            const matchH=state.health==='all'||health(b)===state.health;
            x.card.classList.toggle('bi-branch-card-hidden',!(matchQ&&matchH));
        });
        const parent=cards[0] && cards[0].parentElement;
        if (parent && state.sort) {
            indexed.sort((a,z)=>{
                const A=a.b,B=z.b;
                if(state.sort==='sales') return (Number(B.summary?.netSalesToday ?? B.summary?.grossSalesToday)||0)-(Number(A.summary?.netSalesToday ?? A.summary?.grossSalesToday)||0);
                if(state.sort==='name') return String(A.branchName||'').localeCompare(String(B.branchName||''));
                if(state.sort==='updated') return (Number(B.updatedAt)||0)-(Number(A.updatedAt)||0);
                const rank={offline:0,attention:1,low:2,online:3};
                return (rank[health(A)]??9)-(rank[health(B)]??9);
            });
            // FIX (branch cards jumping below "Stock Transfer Requests"):
            // `parent` here is #branches-page-body itself, which also holds
            // the combined-sales card, the "Per-Branch Detail" heading, and
            // — right after all the branch cards — the entire Stock
            // Transfer Requests section. appendChild() re-parents an
            // existing node to the very END of its parent, so re-appending
            // every branch card on each sort pushed them all past that
            // transfer section instead of just reordering them among
            // themselves — that's why the transfer list/filter tabs ended
            // up rendering ABOVE the branch list in the screenshot instead
            // of below it. Anchoring the inserts to the node that follows
            // the branch cards (the "Stock Transfer Requests" heading)
            // keeps the sort scoped to just the branch cards.
            // NOTE: the Stock Transfer Requests heading now lives INSIDE
            // the #branches-transfers-section wrapper (see app.js), so it
            // is no longer a direct child of `parent` — insertBefore()
            // requires the reference node to be a direct child, so we
            // anchor on the wrapper itself instead of the nested heading.
            const anchor=parent.querySelector(':scope > #branches-transfers-section') || null;
            indexed.forEach(x=>parent.insertBefore(x.card, anchor));
        }
    }

    function installToolbar() {
        const body=document.getElementById('branches-page-body');
        if(!body || body.querySelector('#branches-intel-toolbar')) return;
        const branches=Array.isArray(window.branchesPageState?.branches)?window.branchesPageState.branches:[];
        if(!branches.length) return;
        const s=branchStats(branches);
        const wrap=document.createElement('div');
        wrap.id='branches-intel-toolbar';
        wrap.innerHTML=`
          <input id="bi-branch-search" type="search" placeholder="Search branch or installation ID…" value="${esc(state.query)}" autocomplete="off">
          <select id="bi-branch-health"><option value="all">All health</option><option value="online">Online</option><option value="low">Low stock</option><option value="attention">Attention</option><option value="offline">Offline</option></select>
          <select id="bi-branch-sort"><option value="status">Sort: Health</option><option value="sales">Sort: Net sales</option><option value="name">Sort: Name</option><option value="updated">Sort: Last update</option></select>
          <button type="button" class="bi-btn bi-export" id="bi-export-branches"><i class="fa-solid fa-file-csv"></i> Export CSV</button>`;
        body.prepend(wrap);
        document.getElementById('bi-branch-health').value=state.health;
        document.getElementById('bi-branch-sort').value=state.sort;
        document.getElementById('bi-branch-search').addEventListener('input',e=>{state.query=e.target.value;applyFilters();});
        document.getElementById('bi-branch-health').addEventListener('change',e=>{state.health=e.target.value;applyFilters();});
        document.getElementById('bi-branch-sort').addEventListener('change',e=>{state.sort=e.target.value;applyFilters();});
        document.getElementById('bi-export-branches').addEventListener('click',exportCsv);
        const k=document.createElement('div'); k.className='bi-kpis'; k.innerHTML=`
          <div class="bi-kpi"><div class="v">${s.online}/${branches.length}</div><div class="l">Online branches</div></div>
          <div class="bi-kpi"><div class="v">${money(s.sales)}</div><div class="l">Combined net sales today</div></div>
          <div class="bi-kpi"><div class="v">${s.tx.toLocaleString()}</div><div class="l">Transactions today</div></div>
          <div class="bi-kpi"><div class="v">${s.low.toLocaleString()}</div><div class="l">Low-stock snapshots</div></div>
          <div class="bi-kpi"><div class="v">${s.shifts.toLocaleString()}</div><div class="l">Active shifts</div></div>`;
        body.insertBefore(k,body.children[1] || null);
        const sync=document.createElement('div'); sync.className='bi-sync-line'; sync.innerHTML=`<i class="fa-solid fa-shield-halved"></i> Branch Intelligence active · ${s.offline ? `${s.offline} branch${s.offline>1?'es':''} need attention` : 'all branches recently checked in'}`;
        body.insertBefore(sync,body.children[2] || null);
        applyFilters();
    }

    // Adds the mobile "quick metrics" box + tap hint to a single card, and tags it
    // with its branch id / marker classes. Pulled out of markCards() so the same
    // per-card decoration can be re-applied to just one card after a lite toggle,
    // without having to touch (or re-render) any of the other cards.
    function decorateCard(card,b) {
        if(!card) return;
        if(b) { card.dataset.branchId=String(b.installationId||''); card.classList.add('bi-branch-card'); }
        if(!card.querySelector('.bi-branch-marker')) { const m=document.createElement('span'); m.className='bi-branch-marker'; m.style.display='none'; card.appendChild(m); }
        const clickable=card.firstElementChild;
        if(clickable && !clickable.querySelector('.bi-touch-hint')) {
            const hint=document.createElement('div'); hint.className='bi-touch-hint'; hint.innerHTML='<i class="fa-solid fa-hand-pointer"></i> Tap to view branch details';
            const left=clickable.firstElementChild;
            if(left) left.appendChild(hint);
        }
        const expanded=card.querySelector(':scope > .bi-expanded-panel');
        if(expanded && !expanded.querySelector('.bi-branch-mobile-metrics')) {
            const values=[...expanded.querySelectorAll(':scope > div:first-child > div')].slice(0,2);
            if(values.length) {
                const box=document.createElement('div'); box.className='bi-branch-mobile-metrics';
                values.forEach(v=>box.appendChild(v.cloneNode(true)));
                expanded.querySelector(':scope > div:first-child')?.remove();
                expanded.prepend(box);
            }
        }
    }

    function markCards() {
        const cards=getBranchCards();
        const branches=Array.isArray(window.branchesPageState?.branches)?window.branchesPageState.branches:[];
        cards.forEach((card,i)=>decorateCard(card,branches[i]));
    }

    function enhance() {
        const view=document.getElementById('view-branches');
        if(!view || view.style.display==='none') return;
        injectStyle();
        // Existing renderer creates the cards; mark them before installing the toolbar.
        markCards();
        installToolbar();
        applyFilters();
    }

    const originalRender=window.renderBranchesPage;
    if(typeof originalRender==='function'){
        window.renderBranchesPage=function(){
            originalRender.apply(this,arguments);
            setTimeout(enhance,0);
        };
    }
    const originalLoad=window.loadBranchesPage;
    if(typeof originalLoad==='function'){
        window.loadBranchesPage=async function(silent){
            // Only spin the header Refresh button for an explicit, visible
            // reload (not the silent 60s background poll) — otherwise the
            // icon would be spinning constantly in the background, which
            // would misleadingly suggest something is wrong/slow.
            const refreshBtn = !silent ? document.getElementById('branches-header-refresh-btn') : null;
            if (refreshBtn) refreshBtn.classList.add('is-refreshing');
            try {
                const result=await originalLoad.apply(this,arguments);
                return result;
            } finally {
                if (refreshBtn) refreshBtn.classList.remove('is-refreshing');
                setTimeout(enhance,0);
            }
        };
    }

    // --- No-blink branch expand/collapse -----------------------------------
    // The stock toggleBranchDrilldown() re-renders the ENTIRE #branches-page-body
    // (every card, the combined card, alerts, transfers) just to open/close one
    // card, then our own renderBranchesPage wrapper immediately tears the toolbar
    // and KPIs back out and rebuilds them — two full teardown/rebuild passes on
    // every tap, which is what shows up as the whole page blinking. We patch it
    // to update only the one card that changed. If anything about the page isn't
    // in the shape we expect, we fall back to the original full re-render so the
    // feature never breaks — it just occasionally loses the no-blink benefit.
    function getCardByBranchId(id) {
        const body=document.getElementById('branches-page-body');
        if(!body || id==null) return null;
        return [...body.querySelectorAll('.bi-branch-card')].find(c=>c.dataset.branchId===String(id)) || null;
    }
    function buildExpandedPanelHtml(b,currency) {
        const trendCache=window.branchesPageState && window.branchesPageState.trendCache;
        const svg=typeof window.renderTrendSvg==='function' ? window.renderTrendSvg(trendCache && trendCache[b.installationId]) : '';
        return `<div class="bi-expanded-panel" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-color);">
            <div style="display:flex;flex-wrap:wrap;gap:18px;margin-bottom:14px;">
                <div><div style="font-weight:700;">${currency}${(Number(b.summary&&b.summary.netSalesToday)||0).toFixed(2)}</div><div style="font-size:0.7rem;color:#94a3b8;">Net Sales Today</div></div>
                <div><div style="font-weight:700;">${Number(b.summary&&b.summary.activeShiftCount)||0}</div><div style="font-size:0.7rem;color:#94a3b8;">Active Shifts</div></div>
            </div>
            <div style="font-size:0.75rem;color:#64748b;margin-bottom:4px;">Hourly Sales Trend</div>
            ${svg}
        </div>`;
    }
    // FIX (duplicated / "stuck" expanded panels): this used to locate the
    // panel with a POSITIONAL selector (`:scope > div:nth-child(2)`). But
    // decorateCard() appends a `.bi-branch-marker` <span> as a plain child
    // of the same card, which shifts what sits at index 2 — once that
    // marker occupies position 2, `div:nth-child(2)` can never match the
    // real (div) panel again, no matter where it actually is. The
    // practical effect: collapsing a branch flipped the chevron back to
    // "down" but could never actually find/remove the real panel, and the
    // next expand — still unable to find it — inserted ANOTHER panel on
    // top of the old one. Repeated taps kept stacking more copies (this is
    // exactly the bug from the screenshot: several duplicated "Net Sales
    // Today / Hourly Sales Trend" blocks under a single branch header).
    //
    // Fixed by giving the panel a stable, unambiguous class
    // (`.bi-expanded-panel`, see buildExpandedPanelHtml() and the matching
    // class added on the app.js side) and looking it up by that class
    // instead of by DOM position. We also defensively remove *every*
    // matching panel (not just the first) before deciding whether to
    // re-insert one, so the toggle self-heals even if duplicates already
    // piled up in this session before the fix took effect.
    function setCardExpanded(card,b,isExpanded,currency) {
        if(!card) return;
        const header=card.firstElementChild;
        const chevronHolder=header && header.lastElementChild;
        const chevron=chevronHolder && chevronHolder.querySelector('i.fa-solid');
        if(chevron) { chevron.classList.toggle('fa-chevron-up',isExpanded); chevron.classList.toggle('fa-chevron-down',!isExpanded); }
        card.querySelectorAll(':scope > .bi-expanded-panel').forEach(p=>p.remove());
        if(isExpanded && b) {
            card.insertAdjacentHTML('beforeend',buildExpandedPanelHtml(b,currency));
            decorateCard(card,b);
        }
    }
    function installLiteToggle() {
        const originalToggle=window.toggleBranchDrilldown;
        if(typeof originalToggle!=='function') return;
        window.toggleBranchDrilldown=function(installationId){
            const state=window.branchesPageState;
            const branches=Array.isArray(state && state.branches) ? state.branches : [];
            const branch=branches.find(x=>String(x.installationId)===String(installationId));
            const view=document.getElementById('view-branches');
            const card=getCardByBranchId(installationId);
            // Anything unexpected (page not ready, card not found/decorated yet) → do the
            // safe thing and use the original full-render behavior instead of guessing.
            if(!branch || !view || view.style.display==='none' || !card) {
                return originalToggle.apply(this,arguments);
            }
            const prevId=state.expandedBranchId;
            const nextId=(prevId===installationId) ? null : installationId;
            state.expandedBranchId=nextId;
            const currency=(window.storeSettingsCache && window.storeSettingsCache.currencySymbol) || '₱';
            if(prevId && prevId!==nextId) {
                const prevCard=getCardByBranchId(prevId);
                if(prevCard) setCardExpanded(prevCard,null,false,currency);
            }
            setCardExpanded(card,branch,nextId===installationId,currency);
        };
    }
    installLiteToggle();

    // --- No-blink transfer filter tabs --------------------------------------
    // Same root cause as the branch expand/collapse blink: tapping a filter
    // tab (All / Needs My Action / Incoming / Outgoing) called the stock
    // setBranchTransferFilter(), which just re-ran the ENTIRE full-page
    // renderBranchesPage() — tearing down and rebuilding the combined-sales
    // card, every branch card, and the transfer list just to re-filter one
    // list — then our renderBranchesPage wrapper immediately did its own
    // full toolbar/KPI teardown-and-rebuild on top of that. Two full
    // rebuilds on every tap is what shows up as the whole page blinking.
    // Patched to update only the transfer section (#branches-transfers-section,
    // see app.js) in place. Falls back to the original full-render behavior
    // if anything isn't in the expected shape, so the feature never breaks.
    function installLiteTransferFilter() {
        const originalSetFilter=window.setBranchTransferFilter;
        if(typeof originalSetFilter!=='function') return;
        window.setBranchTransferFilter=function(filter){
            const state=window.branchesPageState;
            const wrapper=document.getElementById('branches-transfers-section');
            const view=document.getElementById('view-branches');
            if(!state || !wrapper || !view || view.style.display==='none' || typeof window.renderBranchTransfersHtml!=='function') {
                return originalSetFilter.apply(this,arguments);
            }
            state.transferFilter=filter;
            wrapper.innerHTML=window.renderBranchTransfersHtml();
            if(typeof window.populateBranchTransferDestinations==='function') window.populateBranchTransferDestinations();
        };
    }
    installLiteTransferFilter();

    window.BranchIntelligence = Object.freeze({version:'1.0', refresh:enhance, exportCsv});
    document.addEventListener('DOMContentLoaded',()=>setTimeout(enhance,300));
})();
