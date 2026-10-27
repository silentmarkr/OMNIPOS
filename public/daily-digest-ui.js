// PATH: OMNIPOS/public/daily-digest-ui.js
//
// Daily Summary card for the Overview and Dashboard pages. Standalone file (app.js is not modified).
// Uses GET /api/reports/daily-digest (see daily-digest.js on the server).
// - The card hides itself if the user has no permission (403) or is not logged in.
// - Only admins see "Email settings" (automatic nightly email).
(function () {
    'use strict';
    if (window.__dailyDigestUiLoaded) return;
    window.__dailyDigestUiLoaded = true;

    var API = '/api/reports/daily-digest';
    var CARD_CLASS = 'dd-card';
    var lastLoad = 0, inflight = false, denied = false, data = null, lastToken = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function peso(n) { return '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function isAdmin() {
        try { var u = JSON.parse(localStorage.getItem('omnipos_user') || 'null'); return !!u && String(u.role || '').toLowerCase() === 'admin'; }
        catch (e) { return false; }
    }
    function api(url, opts) {
        if (typeof authFetch === 'function') return authFetch(url, opts || {});
        var t = localStorage.getItem('omnipos_token');
        var o = Object.assign({}, opts || {});
        o.headers = Object.assign({}, o.headers || {}, t ? { Authorization: 'Bearer ' + t } : {});
        return fetch(url, o);
    }

    function injectStyle() {
        if (document.getElementById('dd-style')) return;
        var st = document.createElement('style');
        st.id = 'dd-style';
        st.textContent =
            '.dd-card{margin:20px 0;padding:18px;border-radius:14px;border:1px solid var(--ops-border,var(--dm-border,#e2e8f0));background:var(--ops-surface,var(--dm-surface,#fff));color:var(--ops-ink,var(--dm-text-primary,#0f172a));box-shadow:var(--ops-shadow,0 1px 3px rgba(0,0,0,.06))}' +
            '.dd-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}' +
            '.dd-title{font-weight:700;font-size:16px}.dd-sub{font-size:12px;color:var(--ops-muted,var(--dm-text-muted,#64748b))}' +
            '.dd-actions{display:flex;gap:8px;flex-wrap:wrap}' +
            '.dd-btn{border:1px solid var(--ops-border,var(--dm-border,#cbd5e1));background:transparent;color:inherit;border-radius:10px;padding:7px 12px;font-size:13px;cursor:pointer}' +
            '.dd-btn:hover{background:var(--dm-accent-soft,rgba(59,130,246,.1))}' +
            '.dd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:12px}' +
            '.dd-stat{padding:10px;border-radius:10px;background:var(--ops-surface-soft,var(--dm-surface-alt,rgba(100,116,139,.08)))}' +
            '.dd-stat small{display:block;font-size:11px;letter-spacing:.04em;color:var(--ops-muted,var(--dm-text-muted,#64748b))}' +
            '.dd-stat b{font-size:18px}.dd-up{color:#059669}.dd-down{color:#dc2626}' +
            '.dd-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;font-size:13px}' +
            '.dd-cols h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:var(--ops-muted,var(--dm-text-muted,#64748b))}' +
            '.dd-row{display:flex;justify-content:space-between;gap:8px;padding:3px 0}' +
            '.dd-err{font-size:13px;color:var(--ops-muted,#64748b)}';
        document.head.appendChild(st);
    }

    function pct(p) {
        if (p == null) return '<span class="dd-sub">no baseline</span>';
        return p >= 0 ? '<span class="dd-up">▲ ' + p + '%</span>' : '<span class="dd-down">▼ ' + Math.abs(p) + '%</span>';
    }

    function render() {
        document.querySelectorAll('.' + CARD_CLASS).forEach(function (card) {
            if (denied) { card.style.display = 'none'; return; }
            card.style.display = '';
            if (!data) { card.innerHTML = '<div class="dd-head"><span class="dd-title">📊 Daily Summary</span></div><div class="dd-err">Loading sales…</div>'; return; }
            var d = data, c = d.comparison || {};
            var pay = Object.keys(d.payments || {}).sort(function (a, b) { return d.payments[b] - d.payments[a]; })
                .map(function (m) { return '<div class="dd-row"><span>' + esc(m) + '</span><b>' + peso(d.payments[m]) + '</b></div>'; }).join('') || '<div class="dd-sub">No payments yet</div>';
            var top = (d.topItems || []).map(function (i) {
                return '<div class="dd-row"><span>' + esc(i.name) + ' ×' + esc(i.qty) + '</span><b>' + peso(i.sales) + '</b></div>';
            }).join('') || '<div class="dd-sub">No sales yet</div>';
            var hours = Object.keys(d.hourly || {}).sort(function (a, b) { return d.hourly[b] - d.hourly[a]; })[0];
            card.innerHTML =
                '<div class="dd-head"><div><div class="dd-title">📊 Daily Summary</div><div class="dd-sub">' + esc(d.date) + ' • Philippine time</div></div>' +
                '<div class="dd-actions"><button type="button" class="dd-btn" data-dd="refresh">Refresh</button>' +
                '<button type="button" class="dd-btn" data-dd="copy">Copy</button>' +
                (isAdmin() ? '<button type="button" class="dd-btn" data-dd="settings">Email settings</button>' : '') + '</div></div>' +
                '<div class="dd-grid">' +
                '<div class="dd-stat"><small>NET SALES</small><b>' + peso(d.net) + '</b></div>' +
                '<div class="dd-stat"><small>VS YESTERDAY</small><b>' + pct(c.vsYesterdayPct) + '</b></div>' +
                '<div class="dd-stat"><small>VS LAST WEEK</small><b>' + pct(c.vsLastWeekPct) + '</b></div>' +
                '<div class="dd-stat"><small>TRANSACTIONS</small><b>' + esc(d.transactions) + '</b></div>' +
                '<div class="dd-stat"><small>AVG BASKET</small><b>' + peso(d.avgBasket) + '</b></div>' +
                '<div class="dd-stat"><small>REFUND / VOID</small><b>' + peso(d.refunds) + ' / ' + esc(d.voids || 0) + '</b></div></div>' +
                '<div class="dd-cols"><div><h4>PAYMENTS</h4>' + pay + '</div><div><h4>TOP ITEMS</h4>' + top + '</div></div>' +
                (hours !== undefined && d.hourly[hours] > 0 ? '<div class="dd-sub" style="margin-top:10px">Peak hour: ' + String(hours).padStart(2, '0') + ':00</div>' : '');
        });
    }

    function load(force) {
        var tok = localStorage.getItem('omnipos_token');
        if (tok !== lastToken) { lastToken = tok; denied = false; data = null; lastLoad = 0; force = true; }   // a different user may have different permissions
        if (inflight || denied) return;
        if (!tok) return;
        if (!force && Date.now() - lastLoad < 60000) return;
        inflight = true;
        api(API, { timeoutMs: 15000 }).then(function (r) {
            if (r.status === 403 || r.status === 402) { denied = true; render(); return null; }
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (j) {
            if (j && j.success) { data = j; lastLoad = Date.now(); render(); }
        }).catch(function () {
            document.querySelectorAll('.' + CARD_CLASS).forEach(function (card) {
                if (!data) card.innerHTML = '<div class="dd-head"><span class="dd-title">📊 Daily Summary</span></div><div class="dd-err">Could not load sales right now. Please try again later.</div>';
            });
        }).then(function () { inflight = false; });
    }

    function copyText() {
        if (!data || !data.text) return;
        var done = function () { toast('Copied — paste it into Viber/Messenger'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(data.text).then(done, fallback);
        else fallback();
        function fallback() {
            var ta = document.createElement('textarea'); ta.value = data.text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy automatically. Please copy the text manually.'); }
            document.body.removeChild(ta);
        }
    }
    function toast(msg) {
        if (window.Swal) { window.Swal.fire({ toast: true, position: 'top', timer: 2200, showConfirmButton: false, icon: 'info', title: msg }); }
        else { alert(msg); }
    }

    function openSettings() {
        if (!window.Swal) return;
        api(API + '/config').then(function (r) { return r.json(); }).then(function (j) {
            if (!j || !j.success) throw new Error((j && j.message) || 'Could not open the settings.');
            var c = j.config, hours = '';
            for (var h = 0; h < 24; h++) {
                var label = (h % 12 === 0 ? 12 : h % 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
                hours += '<option value="' + h + '"' + (h === c.hour ? ' selected' : '') + '>' + label + '</option>';
            }
            return window.Swal.fire({
                title: 'Daily Summary Email',
                html: '<div style="text-align:left;font-size:14px">' +
                    '<label style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="dd-en"' + (c.enabled ? ' checked' : '') + '> Send every night</label>' +
                    '<label>Owner email</label><input id="dd-em" class="swal2-input" style="margin:6px 0 12px;width:100%" type="email" value="' + esc(c.email) + '" placeholder="owner@email.com">' +
                    '<label>Send time (Philippine time)</label><select id="dd-hr" class="swal2-select" style="margin:6px 0 12px;width:100%">' + hours + '</select>' +
                    '<div class="dd-sub">Uses the OTP sender email from Receipt Settings. ' + (j.emailAvailable ? '' : '<b>Email sender is not available.</b>') + '</div></div>',
                showCancelButton: true, showDenyButton: true,
                confirmButtonText: 'Save', denyButtonText: 'Send test now', cancelButtonText: 'Close',
                preConfirm: function () { return collect(); },
                preDeny: function () { return collect(true); }
            }).then(function (res) {
                if (res.isConfirmed) return save(res.value);
                if (res.isDenied) return sendNow(res.value && res.value.email);
            });
        }).catch(function (e) { toast(e && e.message ? e.message : 'Something went wrong.'); });

        function collect(forTest) {
            return {
                enabled: document.getElementById('dd-en').checked,
                email: document.getElementById('dd-em').value.trim(),
                hour: Number(document.getElementById('dd-hr').value),
                forTest: !!forTest
            };
        }
        function save(v) {
            return api(API + '/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: v.enabled, email: v.email, hour: v.hour }) })
                .then(function (r) { return r.json(); }).then(function (j) { toast(j.success ? 'Settings saved.' : (j.message || 'Could not save.')); });
        }
        function sendNow(email) {
            return api(API + '/send-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }), timeoutMs: 60000 })
                .then(function (r) { return r.json(); }).then(function (j) { toast(j.message || (j.success ? 'Sent.' : 'Could not send.')); });
        }
    }

    function ensureCards() {
        ['view-overview', 'view-dashboard'].forEach(function (id) {
            var host = document.getElementById(id);
            if (!host || host.querySelector('.' + CARD_CLASS)) return;
            var card = document.createElement('div');
            card.className = CARD_CLASS;
            host.appendChild(card);
        });
    }

    document.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest && ev.target.closest('[data-dd]');
        if (!b) return;
        var a = b.getAttribute('data-dd');
        if (a === 'refresh') load(true);
        else if (a === 'copy') copyText();
        else if (a === 'settings') openSettings();
    });

    function boot() {
        injectStyle();
        ensureCards();
        render();
        load(true);
        // Refresh while the card is visible (no fetching while the page is hidden) — at most once per minute.
        setInterval(function () {
            ensureCards();
            var visible = Array.prototype.some.call(document.querySelectorAll('.' + CARD_CLASS), function (c) { return c.offsetParent !== null; });
            if (visible && document.visibilityState !== 'hidden') load(false);
        }, 5000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
