/*
 * OmniPOS - Settings Hub (settings-hub.js)
 *
 * Layers a List / Grid / classic Tabs chooser on top of the existing Settings (#view-users) page.
 *
 * SAFE BY DESIGN
 *  - Hindi binabago o pinapalitan ang kahit anong existing na tab button, panel, o function.
 *  - Ang lahat ng lumang .tab-btn ay nananatili sa DOM (nakatago lang sa List/Grid). Ang hub ay
 *    nagki-click lang sa mga ito, kaya tumatakbo pa rin ang orihinal na onclick
 *    (switchUserTab + loadXxxPanel) at ang permission checks (isUserTabAllowed).
 *  - Ang mga item ay binubuo mula sa tunay na tab buttons, kaya ang bagong tab o permission
 *    change ay awtomatikong sumusunod. Walang section na mawawala.
 *  - Piliin ang "Tabs" para bumalik sa dating scrollable tabs anumang oras.
 *  - Display-only. Walang data, setting, o API call na hinahawakan dito.
 */
(function () {
  'use strict';
  if (window.__omniSettingsHub) return;
  window.__omniSettingsHub = true;

  var LS_KEY = 'omnipos_settings_layout';
  var LAYOUTS = ['list', 'grid', 'tabs'];
  var DEFAULT_LAYOUT = 'list';

  // panel id (first argument of switchUserTab) -> group. Unknown panels fall into "Other", so nothing is ever hidden.
  var GROUPS = [
    { id: 'people', title: 'People and access', panels: ['manage-users-tab', 'pending-requests-tab', 'roles-permissions-tab'] },
    { id: 'store', title: 'Store', panels: ['store-settings-tab', 'receipt-custom-tab', 'online-payments-tab'] },
    { id: 'system', title: 'System', panels: ['ux-settings-tab', 'fraud-alerts-tab', 'advanced-settings-tab', 'reset-restore-panel'] }
  ];
  var OTHER_GROUP = { id: 'other', title: 'Other', panels: [] };

  var META = {
    'manage-users-tab': { icon: 'fa-users', tone: 'accent' },
    'pending-requests-tab': { icon: 'fa-user-clock', tone: 'warning' },
    'roles-permissions-tab': { icon: 'fa-shield-halved', tone: 'accent' },
    'store-settings-tab': { icon: 'fa-store', tone: 'success' },
    'receipt-custom-tab': { icon: 'fa-receipt', tone: 'success' },
    'online-payments-tab': { icon: 'fa-credit-card', tone: 'success' },
    'ux-settings-tab': { icon: 'fa-palette', tone: 'accent' },
    'fraud-alerts-tab': { icon: 'fa-triangle-exclamation', tone: 'danger' },
    'advanced-settings-tab': { icon: 'fa-sliders', tone: 'neutral' },
    'reset-restore-panel': { icon: 'fa-database', tone: 'neutral' }
  };
  var DEFAULT_META = { icon: 'fa-gear', tone: 'neutral' };

  var view = null;
  var tabsEl = null;
  var barEl = null;
  var hubEl = null;
  var searchInput = null;
  var titleEl = null;
  var layout = DEFAULT_LAYOUT;
  var state = 'hub';
  var query = '';
  var wasVisible = false;
  var renderQueued = false;

  function readLayout() {
    try {
      var v = localStorage.getItem(LS_KEY);
      return LAYOUTS.indexOf(v) > -1 ? v : DEFAULT_LAYOUT;
    } catch (e) { return DEFAULT_LAYOUT; }
  }
  function saveLayout(v) {
    try { localStorage.setItem(LS_KEY, v); } catch (e) { /* storage blocked: layout just won't persist */ }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function panelIdOf(btn) {
    var oc = btn.getAttribute('onclick') || '';
    var m = oc.match(/switchUserTab\(\s*['"]([^'"]+)['"]/);
    return m ? m[1] : '';
  }

  // Reads the live tab buttons (the source of truth).
  function readTabs() {
    var out = [];
    var btns = tabsEl.querySelectorAll('.tab-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var raw = (b.textContent || '').replace(/\s+/g, ' ').trim();
      var count = 0;
      var cm = raw.match(/\s*\((\d+)\)\s*$/);
      if (cm) count = parseInt(cm[1], 10) || 0;
      var label = raw.replace(/\s*\(\d+\)\s*$/, '');
      out.push({
        btn: b,
        panelId: panelIdOf(b),
        label: label,
        count: count,
        hidden: b.style.display === 'none',
        active: b.classList.contains('active')
      });
    }
    return out;
  }

  function panelText(panelId) {
    var p = panelId ? document.getElementById(panelId) : null;
    return p ? (p.textContent || '').replace(/\s+/g, ' ').toLowerCase() : '';
  }

  function matches(item, q) {
    if (!q) return true;
    if (item.label.toLowerCase().indexOf(q) > -1) return true;
    return panelText(item.panelId).indexOf(q) > -1;
  }

  function buildItem(item) {
    var meta = META[item.panelId] || DEFAULT_META;
    var b = el('button', 'sh-item' + (item.active ? ' is-active' : ''));
    b.type = 'button';
    b.setAttribute('data-panel', item.panelId);
    var ico = el('span', 'sh-ico sh-tone-' + meta.tone);
    var i = el('i', 'fa-solid ' + meta.icon);
    i.setAttribute('aria-hidden', 'true');
    ico.appendChild(i);
    b.appendChild(ico);
    b.appendChild(el('span', 'sh-label', item.label));
    if (item.count > 0) b.appendChild(el('span', 'sh-badge', String(item.count > 99 ? '99+' : item.count)));
    var chev = el('i', 'fa-solid fa-chevron-right sh-chev');
    chev.setAttribute('aria-hidden', 'true');
    b.appendChild(chev);
    b.addEventListener('click', function () { openItem(item.btn); });
    return b;
  }

  function renderHub() {
    if (!hubEl) return;
    var items = readTabs().filter(function (t) { return !t.hidden; });
    var q = query.trim().toLowerCase();
    var byPanel = {};
    items.forEach(function (t) { byPanel[t.panelId || ('idx' + items.indexOf(t))] = t; });

    var placed = {};
    var groups = GROUPS.map(function (g) {
      var list = [];
      g.panels.forEach(function (pid) {
        if (byPanel[pid]) { list.push(byPanel[pid]); placed[pid] = true; }
      });
      return { title: g.title, items: list };
    });
    var rest = items.filter(function (t) { return !(t.panelId && placed[t.panelId]); });
    if (rest.length) groups.push({ title: OTHER_GROUP.title, items: rest });

    var body = el('div', 'sh-body');
    var shown = 0;
    groups.forEach(function (g) {
      var vis = g.items.filter(function (t) { return matches(t, q); });
      if (!vis.length) return;
      var gEl = el('div', 'sh-group');
      gEl.appendChild(el('div', 'sh-group-title', g.title));
      var list = el('div', 'sh-items');
      vis.forEach(function (t) { list.appendChild(buildItem(t)); shown++; });
      gEl.appendChild(list);
      body.appendChild(gEl);
    });
    if (!shown) body.appendChild(el('div', 'sh-empty', 'No matching settings'));

    while (hubEl.firstChild) hubEl.removeChild(hubEl.firstChild);
    hubEl.appendChild(body);
  }

  function updateDetailTitle() {
    if (!titleEl) return;
    var active = null;
    var tabs = readTabs();
    for (var i = 0; i < tabs.length; i++) { if (tabs[i].active) { active = tabs[i]; break; } }
    titleEl.textContent = active ? active.label : '';
  }

  function applyUi() {
    if (!view) return;
    var modeOn = layout !== 'tabs';
    view.classList.toggle('sh-mode', modeOn);
    view.classList.toggle('sh-state-hub', modeOn && state === 'hub');
    view.classList.toggle('sh-state-detail', modeOn && state === 'detail');
    if (hubEl) {
      hubEl.classList.toggle('sh-layout-list', layout === 'list');
      hubEl.classList.toggle('sh-layout-grid', layout === 'grid');
    }
    var segBtns = barEl ? barEl.querySelectorAll('.sh-seg button') : [];
    for (var i = 0; i < segBtns.length; i++) {
      var on = segBtns[i].getAttribute('data-layout') === layout;
      segBtns[i].classList.toggle('active', on);
      segBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    updateDetailTitle();
    renderHub();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    var run = function () { renderQueued = false; applyUi(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 16);
  }

  function openItem(btn) {
    // Runs the ORIGINAL onclick (switchUserTab + loader). The tabs container click listener below
    // switches to the detail state only if the tab really became active (permission allowed).
    btn.click();
  }

  function goHub() {
    state = 'hub';
    // Mirror what switchUserTab does when leaving these panels, so nothing is left open.
    try { if (typeof window.closeGoogleAppVerificationFloatingBox === 'function') window.closeGoogleAppVerificationFloatingBox(); } catch (e) { /* ignore */ }
    try { if (typeof window.closeAllResetRestoreCards === 'function') window.closeAllResetRestoreCards(); } catch (e) { /* ignore */ }
    applyUi();
    scrollTop();
  }

  function scrollTop() {
    try {
      if (barEl && typeof barEl.scrollIntoView === 'function') barEl.scrollIntoView({ block: 'nearest' });
    } catch (e) { /* ignore */ }
  }

  function setLayout(next) {
    if (LAYOUTS.indexOf(next) < 0 || next === layout) return;
    var prev = layout;
    layout = next;
    saveLayout(next);
    if (next !== 'tabs' && prev === 'tabs') state = 'hub';
    applyUi();
  }

  function buildBar() {
    barEl = el('div', 'sh-bar');
    barEl.id = 'sh-bar';

    var hubRow = el('div', 'sh-bar-hub');
    var search = el('label', 'sh-search');
    var si = el('i', 'fa-solid fa-magnifying-glass');
    si.setAttribute('aria-hidden', 'true');
    search.appendChild(si);
    searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.id = 'sh-search-input';
    searchInput.placeholder = 'Search settings';
    searchInput.setAttribute('aria-label', 'Search settings');
    searchInput.autocomplete = 'off';
    searchInput.addEventListener('input', function () { query = searchInput.value || ''; renderHub(); });
    search.appendChild(searchInput);
    hubRow.appendChild(search);

    var seg = el('div', 'sh-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Layout');
    [['list', 'fa-list', 'List'], ['grid', 'fa-table-cells-large', 'Grid'], ['tabs', 'fa-folder-tree', 'Tabs']].forEach(function (d) {
      var b = el('button');
      b.type = 'button';
      b.setAttribute('data-layout', d[0]);
      b.setAttribute('title', d[2]);
      var ic = el('i', 'fa-solid ' + d[1]);
      ic.setAttribute('aria-hidden', 'true');
      b.appendChild(ic);
      b.appendChild(el('span', '', d[2]));
      b.addEventListener('click', function () { setLayout(d[0]); });
      seg.appendChild(b);
    });
    hubRow.appendChild(seg);
    barEl.appendChild(hubRow);

    var detailRow = el('div', 'sh-bar-detail');
    var back = el('button', 'sh-back');
    back.type = 'button';
    var bi = el('i', 'fa-solid fa-arrow-left');
    bi.setAttribute('aria-hidden', 'true');
    back.appendChild(bi);
    back.appendChild(el('span', '', 'Back'));
    back.addEventListener('click', goHub);
    detailRow.appendChild(back);
    titleEl = el('span', 'sh-detail-title');
    detailRow.appendChild(titleEl);
    barEl.appendChild(detailRow);

    hubEl = el('div', 'sh-hub');
    hubEl.id = 'sh-hub';
  }

  function isViewVisible() {
    return !!view && view.getClientRects().length > 0 && getComputedStyle(view).display !== 'none';
  }

  function onViewMaybeShown() {
    var vis = isViewVisible();
    if (vis && !wasVisible && layout !== 'tabs') {
      // Every time Settings is opened, start from the overview.
      state = 'hub';
      query = '';
      if (searchInput) searchInput.value = '';
      applyUi();
    }
    wasVisible = vis;
  }

  function init() {
    view = document.getElementById('view-users');
    if (!view) return false;
    tabsEl = view.querySelector('.tabs-container');
    if (!tabsEl) return false;
    if (document.getElementById('sh-bar')) return true;

    layout = readLayout();
    buildBar();
    tabsEl.parentNode.insertBefore(barEl, tabsEl);
    tabsEl.parentNode.insertBefore(hubEl, tabsEl.nextSibling);

    // A real tab click (hub item, swipe, or other code such as "open-store-settings") -> show that section.
    tabsEl.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.tab-btn') : null;
      if (!b || layout === 'tabs') return;
      if (b.classList.contains('active')) {
        state = 'detail';
        applyUi();
        scrollTop();
      }
    });

    // Keep the hub in sync with permission changes, renamed counters (Pending Requests (3)), language, etc.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(scheduleRender).observe(tabsEl, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class']
      });
      new MutationObserver(onViewMaybeShown).observe(view, { attributes: true, attributeFilter: ['style', 'class'] });
      var host = view.parentNode;
      if (host && host !== document.body) {
        new MutationObserver(onViewMaybeShown).observe(host, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    }

    // While the overview is showing, swiping must not jump into another section (the old swipe-tabs feature).
    var swipeGuard = function (e) {
      if (layout === 'tabs' || state !== 'hub') return;
      var t = e.target;
      if (t && t.closest && t.closest('#view-users')) e.stopPropagation();
    };
    document.addEventListener('touchstart', swipeGuard, { capture: true, passive: true });
    document.addEventListener('touchend', swipeGuard, { capture: true, passive: true });

    wasVisible = false;
    applyUi();
    onViewMaybeShown();
    return true;
  }

  function boot() {
    if (init()) return;
    // The page markup may be injected late; retry a few times, then give up quietly (old tabs keep working).
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (init() || tries > 40) clearInterval(t);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.OmniSettingsHub = {
    setLayout: setLayout,
    getLayout: function () { return layout; },
    showOverview: goHub
  };
})();
