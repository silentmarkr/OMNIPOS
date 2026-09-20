(function () {
    'use strict';

    const API = (typeof API_URL === 'string' ? API_URL : '/api') + '/phase1';
    const QUEUE_KEY = 'omnipos_phase1_attendance_queue';
    let selfieDataUrl = '';
    let activeTab = 'dashboard';

    function token() {
        return localStorage.getItem('omnipos_token') || '';
    }

    function isManager() {
        try {
            const user = JSON.parse(localStorage.getItem('omnipos_user') || 'null');
            return ['admin', 'manager', 'supervisor'].includes(String(user?.role || '').toLowerCase());
        } catch (_) {
            return false;
        }
    }

    async function request(path, options) {
        const opts = Object.assign({}, options || {});
        opts.headers = Object.assign({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, opts.headers || {});
        const response = typeof authFetch === 'function'
            ? await authFetch(`${API}${path}`, opts)
            : await fetch(`${API}${path}`, opts);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
        return data;
    }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function queued() {
        try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (_) { return []; }
    }

    function saveQueue(items) {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-10)));
            return true;
        } catch (_) {
            return false;
        }
    }

    function syncVisibility() {
        const launcher = document.getElementById('phase1-launcher');
        if (!launcher) return;
        const loggedIn = Boolean(token());
        launcher.style.display = loggedIn ? 'inline-flex' : 'none';
        if (!loggedIn) document.getElementById('phase1-panel')?.classList.remove('is-open');
    }

    function syncTabs() {
        const panel = document.getElementById('phase1-panel');
        if (!panel) return;
        const manager = isManager();
        panel.querySelectorAll('[data-manager-only="true"]').forEach((button) => {
            button.style.display = manager ? '' : 'none';
        });
        if (!manager && ['dashboard', 'performance', 'cash'].includes(activeTab)) {
            activeTab = 'attendance';
            panel.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item.dataset.tab === activeTab));
        }
    }

    function renderShell() {
        if (document.getElementById('phase1-launcher')) return;
        const launcher = document.createElement('button');
        launcher.id = 'phase1-launcher';
        launcher.className = 'phase1-launcher';
        launcher.innerHTML = '<i class="fa-solid fa-users-gear"></i><span>Phase 1</span>';
        launcher.onclick = () => {
            document.getElementById('phase1-panel').classList.toggle('is-open');
            if (document.getElementById('phase1-panel').classList.contains('is-open')) loadTab(activeTab);
        };
        document.body.appendChild(launcher);

        const panel = document.createElement('section');
        panel.id = 'phase1-panel';
        panel.className = 'phase1-panel';
        panel.innerHTML = `
          <div class="phase1-panel-head">
            <div><strong>Phase 1 Operations</strong><small>Attendance, reconciliation & owner monitoring</small></div>
            <button type="button" class="phase1-close" aria-label="Close">&times;</button>
          </div>
          <div id="phase1-alerts" class="phase1-alerts"></div>
          <nav class="phase1-tabs" aria-label="Phase 1">
            <button data-tab="dashboard" data-manager-only="true">Owner Dashboard</button>
            <button data-tab="attendance">Attendance</button>
            <button data-tab="performance" data-manager-only="true">Staff Report</button>
            <button data-tab="cash" data-manager-only="true">Cash Reconciliation</button>
          </nav>
          <div id="phase1-content" class="phase1-content"></div>`;
        document.body.appendChild(panel);
        panel.querySelector('.phase1-close').onclick = () => panel.classList.remove('is-open');
        panel.querySelectorAll('[data-tab]').forEach((button) => {
            button.onclick = () => {
                activeTab = button.dataset.tab;
                panel.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
                loadTab(activeTab);
            };
        });
        syncTabs();
        panel.querySelector(`[data-tab="${activeTab}"]`).classList.add('active');
        syncVisibility();
        if (token()) loadAlerts();
    }

    async function loadAlerts() {
        try {
            const data = await request('/alerts');
            const el = document.getElementById('phase1-alerts');
            if (!el) return;
            const backup = data.backupStatus;
            const backupFailed = backup && backup.lastFailureAt && (!backup.lastSuccessAt || new Date(backup.lastFailureAt) > new Date(backup.lastSuccessAt));
            el.innerHTML = backupFailed
                ? `<div class="phase1-alert critical"><i class="fa-solid fa-triangle-exclamation"></i> Backup failed: ${esc(backup.lastFailureMessage || 'check backup settings')}</div>`
                : (data.alerts || []).slice(0, 3).map((alert) => `<div class="phase1-alert"><i class="fa-solid fa-bell"></i> ${esc(alert.message || alert.type || 'New alert')}</div>`).join('');
        } catch (_) {}
    }

    function metric(label, value, tone) {
        return `<div class="phase1-metric ${tone || ''}"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;
    }

    async function renderDashboard(el) {
        const data = await request('/mobile-dashboard');
        el.innerHTML = `<div class="phase1-grid">
          ${metric("Today's Sales", `₱${Number(data.today?.sales || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, 'accent')}
          ${metric("Today's Orders", data.today?.orders || 0)}
          ${metric('Active Staff', (data.activeStaff || []).length, 'success')}
          ${metric('Open Shifts', data.openShifts || 0)}
        </div>
        <div class="phase1-card"><h3>Active Staff</h3><p>${(data.activeStaff || []).length ? data.activeStaff.map(esc).join(', ') : 'Walang naka-Time In ngayon.'}</p></div>
        <div class="phase1-card"><h3>Low Stock</h3>${(data.lowStock || []).length ? `<ul class="phase1-list">${data.lowStock.map((item) => `<li>${esc(item.name || item.code)} <b>${esc(item.stock)}</b></li>`).join('')}</ul>` : '<p>Walang low-stock alert.</p>'}</div>`;
    }

    function attendanceForm() {
        return `<div class="phase1-card">
          <h3>Staff Attendance</h3>
          <p class="phase1-muted">Kailangan ang selfie para sa bawat Time In at Time Out. Kapag offline, ise-save muna ito sa device at isi-sync kapag online.</p>
          <input id="phase1-selfie" type="file" accept="image/*" capture="user">
          <div id="phase1-selfie-preview" class="phase1-selfie-preview">Walang selfie na napili.</div>
          <div class="phase1-actions"><button id="phase1-time-in" class="phase1-primary">Time In</button><button id="phase1-time-out" class="phase1-secondary">Time Out</button></div>
          <small id="phase1-queue-status" class="phase1-muted"></small>
        </div><div class="phase1-card"><h3>Recent Attendance</h3><div id="phase1-attendance-list">Loading...</div></div>`;
    }

    async function renderAttendance(el) {
        el.innerHTML = attendanceForm();
        const input = el.querySelector('#phase1-selfie');
        input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return;
            if (file.size > 1500000) { input.value = ''; alert('Gumamit ng selfie na hanggang 1.5MB lamang.'); return; }
            const reader = new FileReader();
            reader.onload = () => {
                selfieDataUrl = reader.result;
                el.querySelector('#phase1-selfie-preview').innerHTML = `<img src="${selfieDataUrl}" alt="Selfie preview">`;
            };
            reader.readAsDataURL(file);
        };
        const submit = async (eventType) => {
            if (!selfieDataUrl) return alert('Kailangan munang kumuha ng selfie.');
            const payload = { eventType, selfieDataUrl, source: 'live', device: navigator.userAgent };
            try {
                await request('/attendance', { method: 'POST', body: JSON.stringify(payload) });
                selfieDataUrl = ''; input.value = '';
                await loadAttendanceList();
                alert(`${eventType === 'time_in' ? 'Time In' : 'Time Out'} recorded.`);
            } catch (error) {
                if (!navigator.onLine || /network|fetch|failed/i.test(error.message)) {
                    const items = queued(); items.push(payload); saveQueue(items);
                    el.querySelector('#phase1-queue-status').textContent = `Offline queue: ${items.length} attendance record(s)`;
                } else alert(error.message);
            }
        };
        el.querySelector('#phase1-time-in').onclick = () => submit('time_in');
        el.querySelector('#phase1-time-out').onclick = () => submit('time_out');
        await loadAttendanceList();
    }

    async function loadAttendanceList() {
        const target = document.getElementById('phase1-attendance-list');
        if (!target) return;
        try {
            const data = await request('/attendance');
            target.innerHTML = (data.records || []).slice(0, 20).map((record) => `<div class="phase1-row"><span>${esc(record.eventType === 'time_in' ? 'Time In' : 'Time Out')}<small>${esc(new Date(record.capturedAt).toLocaleString())}</small></span><b>${esc(record.status)}</b></div>`).join('') || '<p>Wala pang attendance.</p>';
        } catch (error) { target.textContent = error.message; }
    }

    async function renderPerformance(el) {
        const today = new Date().toISOString().slice(0, 10);
        el.innerHTML = `<div class="phase1-card phase1-filter"><label>From <input id="phase1-from" type="date" value="${today}"></label><label>To <input id="phase1-to" type="date" value="${today}"></label><button id="phase1-performance-refresh" class="phase1-primary">Load Report</button><button id="phase1-performance-csv" class="phase1-secondary">Export CSV</button></div><div class="phase1-card"><div id="phase1-performance-table">Loading...</div></div>`;
        const load = async () => {
            const data = await request(`/staff-performance?from=${encodeURIComponent(el.querySelector('#phase1-from').value)}&to=${encodeURIComponent(el.querySelector('#phase1-to').value)}`);
            const rows = data.rows || [];
            el.querySelector('#phase1-performance-table').innerHTML = `<div class="phase1-table-wrap"><table><thead><tr><th>Staff</th><th>Hours</th><th>Sales</th><th>Txns</th><th>Void</th><th>Refund</th><th>Discount</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.username)}</td><td>${row.hoursWorked}</td><td>₱${Number(row.sales).toFixed(2)}</td><td>${row.transactions}</td><td>${row.voids}</td><td>${row.refunds}</td><td>${row.discounts}</td></tr>`).join('')}</tbody></table></div>`;
            el.querySelector('#phase1-performance-csv').onclick = () => {
                const csv = ['Staff,Hours,Sales,Transactions,Voids,Refunds,Discounts'].concat(rows.map((row) => [row.username, row.hoursWorked, row.sales, row.transactions, row.voids, row.refunds, row.discounts].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))).join('\n');
                const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `staff-performance-${today}.csv`; link.click(); URL.revokeObjectURL(link.href);
            };
        };
        el.querySelector('#phase1-performance-refresh').onclick = load;
        await load().catch((error) => { el.querySelector('#phase1-performance-table').textContent = error.message; });
    }

    async function renderCash(el) {
        el.innerHTML = `<div class="phase1-card"><h3>Cash Reconciliation</h3><form id="phase1-cash-form" class="phase1-form"><label>Expected Cash<input name="expectedCash" type="number" min="0" step="0.01" required></label><label>Actual Cash<input name="actualCash" type="number" min="0" step="0.01" required></label><label>Note<textarea name="note" maxlength="500"></textarea></label><button class="phase1-primary">Submit for Review</button></form></div><div class="phase1-card"><h3>Recent Reconciliations</h3><div id="phase1-cash-list">Loading...</div></div>`;
        el.querySelector('#phase1-cash-form').onsubmit = async (event) => {
            event.preventDefault();
            const form = new FormData(event.target);
            try { await request('/cash-reconciliation', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) }); event.target.reset(); await renderCash(el); alert('Na-submit ang reconciliation.'); } catch (error) { alert(error.message); }
        };
        try {
            const data = await request('/cash-reconciliation');
            el.querySelector('#phase1-cash-list').innerHTML = (data.records || []).slice(0, 20).map((row) => `<div class="phase1-row"><span>${esc(row.username)}<small>${esc(new Date(row.createdAt).toLocaleString())}</small></span><b class="${Number(row.variance) < 0 ? 'danger' : ''}">₱${Number(row.variance).toFixed(2)} · ${esc(row.status)}</b></div>`).join('') || '<p>Wala pang records.</p>';
        } catch (error) { el.querySelector('#phase1-cash-list').textContent = error.message; }
    }

    async function loadTab(tab) {
        const el = document.getElementById('phase1-content');
        if (!el) return;
        el.innerHTML = '<div class="phase1-loading">Loading...</div>';
        try {
            if (tab === 'dashboard') await renderDashboard(el);
            else if (tab === 'attendance') await renderAttendance(el);
            else if (tab === 'performance') await renderPerformance(el);
            else await renderCash(el);
            loadAlerts();
        } catch (error) { el.innerHTML = `<div class="phase1-error">${esc(error.message)}</div>`; }
    }

    async function flushQueue() {
        const items = queued();
        if (!items.length || !navigator.onLine) return;
        const remaining = [];
        for (const item of items) {
            try { await request('/attendance', { method: 'POST', body: JSON.stringify({ ...item, source: 'offline_queue' }) }); }
            catch (_) { remaining.push(item); }
        }
        saveQueue(remaining);
        if (remaining.length === 0) loadAttendanceList();
    }

    window.addEventListener('online', flushQueue);
    window.addEventListener('DOMContentLoaded', () => {
        renderShell();
        flushQueue();
        syncVisibility();
        syncTabs();
        window.setInterval(() => {
            syncVisibility();
            syncTabs();
        }, 1000);
    });
})();