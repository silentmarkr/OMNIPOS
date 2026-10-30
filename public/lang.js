/*
 * OmniPOS — Language engine (lang.js)
 *
 * DISPLAY-ONLY translator. Walang binabago sa data, database, o logic ng system.
 *  - Default: English (walang binabago hangga't hindi pinipili ang ibang wika).
 *  - Exact-match dictionary lang: ang text na wala sa dictionary ay nananatiling English (fallback).
 *  - Nababalik ang orihinal na text kapag ibinalik sa English.
 *  - Hindi ginagalaw: resibo/BIR/print area, input values, user-typed fields, <script>/<style>, FAQ/Help chat,
 *    at mga text na hawak ng bir-wording.js (hindi isinasalin ang mga ito sa dictionary).
 *  - Gumagana sa browser at sa OPInstaller (WebView -> http://localhost:3000).
 *  - Language packs: lang/<code>.json — dina-download, kinakabit sa localStorage (offline-ready), at may background refresh.
 *
 * Magdagdag ng bagong wika: ilagay ang pack sa public/lang/<code>.json at idagdag sa LANGS sa ibaba.
 */
(function () {
  'use strict';
  if (window.OmniLang) return;

  var LS_LANG = 'omnipos_ui_lang';          // hiwalay sa 'omnipos_faq_lang' (Help Center)
  var LS_PACK = 'omnipos_lang_pack_';       // + code
  var PACK_VER = '20261030-1';              // taasan kapag nagpalit ng laman ng pack
  var LS_INDEX = 'omnipos_lang_index';      // list of downloaded packs (kept for offline use)
  var BUILTIN = {
    en: { name: 'English', native: 'English' },
    tl: { name: 'Tagalog', native: 'Tagalog', file: 'lang/tl.json' }
  };
  var LANGS = {};
  // Built-in languages + the packs downloaded from RELAY (served by the local server at /lang-dl/<code>.json).
  function applyIndex(packs) {
    var out = {};
    for (var c in BUILTIN) if (Object.prototype.hasOwnProperty.call(BUILTIN, c)) out[c] = BUILTIN[c];
    (packs || []).forEach(function (p) {
      if (!p || !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(String(p.code)) || p.code === 'en') return;
      out[p.code] = { name: String(p.name || p.code), native: String(p.native || p.name || p.code), file: 'lang-dl/' + p.code + '.json', ver: 'dl-' + String(p.version || '0'), dl: true };
    });
    LANGS = out;
  }
  (function () {
    var idx = null;
    try { idx = JSON.parse(ls(LS_INDEX) || 'null'); } catch (e) {}
    applyIndex(idx);
  })();
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, SVG: 1, CANVAS: 1, IFRAME: 1 };
  // Hindi isinasalin: resibo/print areas, BIR module, FAQ/AI chat, at kahit anong may data-no-translate.
  var SKIP_SEL = [
    '[data-no-translate]', '[contenteditable="true"]',
    '#printable-receipt-area', '.receipt-paper-layout', '#receipt-items-table',
    '#barcode-sheet-print-container', '#view-bir_compliance',
    '[class*="faq"]', '[id*="faq"]', '[class*="ai-chat"]', '[id*="ai-chat"]',
    '#category-chips', '#cart-items-container', '#overview-top-products-list', '#profit-by-product-list', '#slow-products-list', '[class*="t-prod"]'   // pangalan ng produkto = data ng user
  ].join(',');

  var lang = 'en';
  var dict = null;            // { exact: Map, rules: [[RegExp, string]] }
  var textRec = new WeakMap(); // Text node -> { orig, out }
  var observer = null;
  var busy = false;           // guard laban sa sariling mutation
  var listeners = [];

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }

  /* ---------- dictionary ---------- */
  function buildDict(pack) {
    var exact = new Map(), rules = [];
    var ex = (pack && pack.exact) || {};
    for (var k in ex) if (Object.prototype.hasOwnProperty.call(ex, k) && ex[k]) exact.set(k, ex[k]);
    ((pack && pack.rules) || []).forEach(function (r) {
      // Packs write group references as \1; JavaScript's replace() needs $1.
      try { rules.push([new RegExp(r[0]), String(r[1]).replace(/\\(\d)/g, '$$$1')]); } catch (e) {}
    });
    var rev = new Map(), rv = (pack && pack.rev) || {};
    for (var r in rv) if (Object.prototype.hasOwnProperty.call(rv, r)) rev.set(r, rv[r]);
    return { exact: exact, rules: rules, rev: rev };
  }
  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function tr(s) {
    if (!dict || !s) return null;
    var key = norm(s);
    if (!key) return null;
    var out = dict.exact.get(key);
    if (out === undefined && key.length <= 160) {     // long text is never matched against patterns (keeps the UI fast)
      for (var i = 0; i < dict.rules.length; i++) {
        if (dict.rules[i][0].test(key)) { out = key.replace(dict.rules[i][0], dict.rules[i][1]); break; }
      }
    }
    if (!out || out === key) return null;
    var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];   // panatilihin ang puwang sa harap/likod
    return lead + out + trail;
  }

  /* ---------- skip logic ---------- */
  function skipEl(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP_TAGS[String(n.tagName).toUpperCase()]) return true;
    }
    try {
      if (el && el.closest) return !!el.closest(SKIP_SEL);
      for (var m = el; m && m.nodeType === 1; m = m.parentNode) {          // lumang WebView na walang closest()
        var mt = m.matches || m.webkitMatchesSelector || m.msMatchesSelector;
        if (mt && mt.call(m, SKIP_SEL)) return true;
      }
      return false;
    } catch (e) { return true; }
  }

  /* ---------- apply / revert ---------- */
  function doText(node) {
    var cur = node.nodeValue, rec = textRec.get(node);
    if (rec) {
      if (cur === rec.out) return;            // naisalin na natin
      textRec.delete(node);                   // binago ng app -> bagong orihinal
    }
    if (!/[A-Za-z]{2}/.test(cur)) return;
    var p = node.parentNode;
    if (!p || skipEl(p.nodeType === 1 ? p : p.parentNode)) return;
    if (p.nodeName === 'OPTION' && !p.hasAttribute('value')) return;   // value ng <option> = text niya; huwag galawin
    var out = tr(cur);
    if (out) { textRec.set(node, { orig: cur, out: out }); node.nodeValue = out; }
  }
  function doAttrs(el) {
    if (!el.getAttribute || skipEl(el)) return;
    var store = el.__olAttr;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v == null) continue;
      if (store && store[a] && v === store[a].out) continue;
      if (store && store[a]) delete store[a];
      var out = tr(v);
      if (out) { store = el.__olAttr || (el.__olAttr = {}); store[a] = { orig: v, out: out }; el.setAttribute(a, out); }
    }
    // Mga button-type input (value ay label lang, hindi data)
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) {
      var vv = el.getAttribute('value'), st = el.__olAttr;
      if (vv != null && !(st && st.value && vv === st.value.out)) {
        var o2 = tr(vv);
        if (o2) { st = el.__olAttr || (el.__olAttr = {}); st.value = { orig: vv, out: o2 }; el.setAttribute('value', o2); }
      }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP_TAGS[String(root.tagName).toUpperCase()]) return; doAttrs(root); }
    var w = document.createTreeWalker(root, 1 | 4, {
      acceptNode: function (n) { return n.nodeType === 1 && SKIP_TAGS[String(n.tagName).toUpperCase()] ? 2 : 1; }   // 2 = REJECT (buong subtree)
    });
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function revertAll() {
    var w = document.createTreeWalker(document.documentElement, 1 | 4, null), n, texts = [], els = [];
    while ((n = w.nextNode())) { if (n.nodeType === 3) texts.push(n); else if (n.__olAttr) els.push(n); }
    texts.forEach(function (t) { var r = textRec.get(t); if (r && t.nodeValue === r.out) t.nodeValue = r.orig; textRec.delete(t); });
    els.forEach(function (e) {
      var s = e.__olAttr; for (var a in s) if (e.getAttribute(a) === s[a].out) e.setAttribute(a, s[a].orig);
      e.__olAttr = null;
    });
    if (document.title && document.__olTitle && document.title === document.__olTitle.out) document.title = document.__olTitle.orig;
    document.__olTitle = null;
  }
  // Mga button na nire-restore ng app gamit ang naitabing innerHTML/textContent (hal. "Saving..." -> dating label)
  // ay bagong text node na walang record. Ibinabalik dito sa English, pero sa mga BUTTON lang at kung iisa lang ang English na pinagmulan.
  function sweepButtons() {
    if (!dict || !dict.rev) return;
    var btns = document.querySelectorAll('button, [role="button"], .btn');
    for (var i = 0; i < btns.length; i++) {
      if (skipEl(btns[i])) continue;
      var w = document.createTreeWalker(btns[i], 4, null), n;
      while ((n = w.nextNode())) {
        if (textRec.has(n)) continue;
        var key = norm(n.nodeValue), en = key && dict.rev.get(key);
        if (en) n.nodeValue = n.nodeValue.match(/^\s*/)[0] + en + n.nodeValue.match(/\s*$/)[0];
      }
    }
  }
  function doTitle() {
    var t = document.title, rec = document.__olTitle;
    if (rec && t === rec.out) return;
    var out = tr(t);
    if (out) { document.__olTitle = { orig: t, out: out }; document.title = out; } else document.__olTitle = null;
  }

  /* ---------- live observer ---------- */
  function startObserver() {
    if (observer || typeof MutationObserver !== 'function' || !document.body) return;
    observer = new MutationObserver(function (records) {
      if (busy || !dict) return;
      busy = true;
      try {
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (r.type === 'characterData') doText(r.target);
          else if (r.type === 'attributes') doAttrs(r.target);
          else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
        }
      } catch (e) { /* hindi dapat makasira ng app */ }
      busy = false;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
  }
  function stopObserver() { if (observer) { observer.disconnect(); observer = null; } }

  /* ---------- popups ng SweetAlert2 (nasa main document din, kaya sakop ng observer) ---------- */

  /* ---------- pack loading ---------- */
  function readCached(code) {
    var raw = ls(LS_PACK + code);
    if (!raw) return null;
    try { var o = JSON.parse(raw); return o && o.ver === packVer(code) && o.pack && typeof o.pack.exact === 'object' ? o.pack : null; } catch (e) { return null; }
  }
  function packVer(code) { return (LANGS[code] && LANGS[code].ver) || PACK_VER; }
  function fetchPack(code, cb) {
    var f = LANGS[code] && LANGS[code].file;
    if (!f) return cb(null);
    var x = new XMLHttpRequest();
    x.open('GET', f + '?v=' + encodeURIComponent(packVer(code)), true);
    x.timeout = 15000;
    x.onload = function () {
      if (x.status !== 200) return cb(null);
      try {
        var p = JSON.parse(x.responseText);
        if (!p || typeof p.exact !== 'object' || Array.isArray(p.exact)) return cb(null);   // not a usable pack -> stay in English
        ls(LS_PACK + code, JSON.stringify({ ver: packVer(code), pack: p }));
        cb(p);
      } catch (e) { cb(null); }
    };
    x.onerror = x.ontimeout = function () { cb(null); };
    x.send();
  }
  function activate(pack) {
    dict = buildDict(pack);
    busy = true;
    try { walk(document.body || document.documentElement); doTitle(); } catch (e) {}
    busy = false;
    startObserver();
  }
  function deactivate() {
    stopObserver();
    busy = true;
    try { revertAll(); sweepButtons(); } catch (e) {}
    busy = false;
    dict = null;
  }

  function emit() { listeners.forEach(function (f) { try { f(lang); } catch (e) {} }); }

  function setLang(code, opts) {
    if (!LANGS[code]) code = 'en';
    lang = code;
    if (!(opts && opts.noPersist)) ls(LS_LANG, code);
    if (code === 'en') { deactivate(); emit(); return Promise.resolve(); }
    return new Promise(function (resolve) {
      var cached = readCached(code);
      if (cached) { if (lang === code) activate(cached); emit(); resolve(); fetchPack(code, function () {}); return; }  // refresh sa background
      fetchPack(code, function (p) {
        if (lang !== code) return resolve();
        if (p) activate(p); else lang = 'en';      // walang pack at walang internet -> manatiling English
        emit(); resolve();
      });
    });
  }

  /* ---------- UI: pang-Settings ---------- */
  function mountSelector(sel) {
    if (!sel || sel.__olMounted) return;
    sel.__olMounted = true;
    sel.setAttribute('data-no-translate', '');
    fillSelector(sel);
    sel.addEventListener('change', function () {
      if (sel.value === '__more__') { sel.value = lang; openDownloader(); return; }
      sel.disabled = true;
      setLang(sel.value).then(function () { sel.disabled = false; sel.value = lang; });
    });
    listeners.push(function (l) { sel.value = l; });
    selectors.push(sel);
  }
  var selectors = [];
  function fillSelector(sel) {
    sel.innerHTML = '';
    Object.keys(LANGS).forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = LANGS[c].native; sel.appendChild(o);
    });
    var more = document.createElement('option'); more.value = '__more__'; more.textContent = '+ More languages...'; sel.appendChild(more);
    sel.value = LANGS[lang] ? lang : 'en';
  }

  /* ---------- language pack downloader ---------- */
  function refreshIndex(done) {
    var x = new XMLHttpRequest();
    x.open('GET', 'lang-dl/index.json?t=' + Date.now(), true);
    x.timeout = 8000;
    x.onload = function () {
      try {
        var d = JSON.parse(x.responseText);
        if (x.status === 200 && d && Array.isArray(d.packs)) {
          ls(LS_INDEX, JSON.stringify(d.packs));
          applyIndex(d.packs);
          selectors.forEach(fillSelector);
        }
      } catch (e) {}
      if (done) done();
    };
    x.onerror = x.ontimeout = function () { if (done) done(); };
    x.send();
  }
  function api(method, url, body) {
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      x.open(method, url, true);
      x.timeout = 45000;
      var tok = ls('omnipos_token');
      if (tok) x.setRequestHeader('Authorization', 'Bearer ' + tok);
      if (body) x.setRequestHeader('Content-Type', 'application/json');
      x.onload = function () { var d = null; try { d = JSON.parse(x.responseText); } catch (e) {} resolve({ status: x.status, data: d }); };
      x.onerror = x.ontimeout = function () { resolve({ status: 0, data: null }); };
      x.send(body ? JSON.stringify(body) : null);
    });
  }
  function openDownloader() {
    if (document.getElementById('omni-lang-dl')) return;
    var st = document.createElement('style');
    st.id = 'omni-lang-dl-css';
    st.textContent = '#omni-lang-dl{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '#omni-lang-dl .ol-box{background:var(--card-bg,#fff);color:var(--text-color,#1f2937);width:100%;max-width:440px;max-height:85vh;overflow:auto;border-radius:14px;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.35);font-family:inherit}' +
      '#omni-lang-dl h3{margin:0 0 4px;font-size:1.1rem}#omni-lang-dl p{margin:0 0 12px;font-size:.8rem;opacity:.75}' +
      '#omni-lang-dl .ol-row{display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--border-color,#e5e7eb)}' +
      '#omni-lang-dl .ol-name{flex:1;min-width:0;font-weight:600}#omni-lang-dl .ol-name small{display:block;font-weight:400;opacity:.7}' +
      '#omni-lang-dl button{border:0;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;background:var(--primary,#4f46e5);color:#fff}' +
      '#omni-lang-dl button.ol-sec{background:transparent;color:inherit;border:1px solid var(--border-color,#cbd5e1)}#omni-lang-dl button[disabled]{opacity:.6;cursor:default}' +
      '#omni-lang-dl .ol-msg{font-size:.82rem;margin:8px 0;min-height:1.1em}';
    document.head.appendChild(st);
    var wrap = document.createElement('div');
    wrap.id = 'omni-lang-dl';
    wrap.setAttribute('data-no-translate', '');
    wrap.innerHTML = '<div class="ol-box" role="dialog" aria-modal="true"><h3>Language packs</h3>' +
      '<p>Download more display languages. Only the screen text changes; receipts, BIR documents and your data stay as they are.</p>' +
      '<div class="ol-msg" id="ol-msg"></div><div id="ol-list"></div>' +
      '<div style="text-align:right;margin-top:10px"><button class="ol-sec" id="ol-close">Close</button></div></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); var s2 = document.getElementById('omni-lang-dl-css'); if (s2) s2.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('#ol-close').addEventListener('click', close);
    var msg = wrap.querySelector('#ol-msg'), list = wrap.querySelector('#ol-list');
    function say(t, bad) { msg.textContent = t || ''; msg.style.color = bad ? '#dc2626' : 'inherit'; }
    function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function render(d) {
      var rows = '';
      (d.available || []).forEach(function (p) {
        var label = p.installed ? (p.updateAvailable ? 'Update' : 'Installed') : 'Download';
        rows += '<div class="ol-row"><div class="ol-name">' + esc(p.native) + '<small>' + esc(p.name) + (p.count ? ' · ' + p.count + ' texts' : '') + '</small></div>' +
          (p.installed ? '<button class="ol-sec" data-rm="' + esc(p.code) + '">Remove</button>' : '') +
          '<button data-dl="' + esc(p.code) + '"' + (p.installed && !p.updateAvailable ? ' disabled' : '') + '>' + label + '</button></div>';
      });
      (d.installed || []).forEach(function (p) {
        if ((d.available || []).some(function (a) { return a.code === p.code; })) return;
        rows += '<div class="ol-row"><div class="ol-name">' + esc(p.native) + '<small>' + esc(p.name) + ' · installed</small></div><button class="ol-sec" data-rm="' + esc(p.code) + '">Remove</button></div>';
      });
      list.innerHTML = rows || '<div class="ol-row">No extra languages are available right now.</div>';
    }
    function load() {
      say('Loading…');
      api('GET', 'api/lang/packs').then(function (r) {
        if (r.status === 401 || r.status === 403) return say('Please log in as a user who can change Appearance settings.', true);
        if (!r.data || !r.data.success) return say('Could not load the language list.', true);
        say(r.data.offline ? 'No internet: showing downloaded languages only.' : '');
        render(r.data);
      });
    }
    list.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b || b.disabled) return;
      var code = b.getAttribute('data-dl') || b.getAttribute('data-rm');
      if (!code) return;
      b.disabled = true;
      if (b.getAttribute('data-dl')) {
        say('Downloading…');
        api('POST', 'api/lang/packs/download', { code: code }).then(function (r) {
          if (r.data && r.data.success) {
            delete_cache(code);
            say('Downloaded.');
            refreshIndex(function () { load(); });
          } else { say((r.data && r.data.message) || 'Download failed. Check the internet connection.', true); b.disabled = false; }
        });
      } else {
        api('DELETE', 'api/lang/packs/' + encodeURIComponent(code)).then(function (r) {
          if (!(r.data && r.data.success)) { say((r.data && r.data.message) || 'Could not remove it.', true); b.disabled = false; return; }
          delete_cache(code);
          if (lang === code && !BUILTIN[code]) setLang('en');   // never leave the UI on a language that no longer exists
          refreshIndex(function () { load(); });
        });
      }
    });
    load();
  }
  function delete_cache(code) { ls(LS_PACK + code, null); }

  window.OmniLang = {
    get lang() { return lang; },
    languages: function () { return Object.keys(LANGS).map(function (c) { return { code: c, name: LANGS[c].name, native: LANGS[c].native }; }); },
    set: setLang,
    openDownloader: openDownloader,
    mountSelector: mountSelector,
    onChange: function (f) { listeners.push(f); },
    // Ibinabalik ang ORIHINAL (English) na text ng isang element — para sa code na naghahanap ng text (hal. button na "Search").
    originalText: function (el) {
      if (!el) return '';
      var w = document.createTreeWalker(el, 4, null), n, s = '';
      while ((n = w.nextNode())) { var r = textRec.get(n); s += (r && n.nodeValue === r.out) ? r.orig : n.nodeValue; }
      return s;
    },
    translate: function (s) { return tr(s) || s; }
  };

  /* ---------- boot ---------- */
  var saved = ls(LS_LANG);
  if (saved && LANGS[saved] && saved !== 'en') {
    lang = saved;
    var cached = readCached(saved);
    var start = function () {
      if (cached) { activate(cached); fetchPack(saved, function () {}); }
      else fetchPack(saved, function (p) { if (p && lang === saved) activate(p); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
  var mount = function () { mountSelector(document.getElementById('ui-language-select')); refreshIndex(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
