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
  var LANGS = {
    en: { name: 'English', native: 'English' },
    tl: { name: 'Tagalog', native: 'Tagalog', file: 'lang/tl.json' }
  };
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
      try { rules.push([new RegExp(r[0]), r[1]]); } catch (e) {}
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
    if (out === undefined) {
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
    try { var o = JSON.parse(raw); return o && o.ver === PACK_VER ? o.pack : null; } catch (e) { return null; }
  }
  function fetchPack(code, cb) {
    var f = LANGS[code] && LANGS[code].file;
    if (!f) return cb(null);
    var x = new XMLHttpRequest();
    x.open('GET', f + '?v=' + PACK_VER, true);
    x.timeout = 15000;
    x.onload = function () {
      if (x.status !== 200) return cb(null);
      try { var p = JSON.parse(x.responseText); ls(LS_PACK + code, JSON.stringify({ ver: PACK_VER, pack: p })); cb(p); } catch (e) { cb(null); }
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
    sel.innerHTML = '';
    Object.keys(LANGS).forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = LANGS[c].native; sel.appendChild(o);
    });
    sel.value = lang;
    sel.addEventListener('change', function () { sel.disabled = true; setLang(sel.value).then(function () { sel.disabled = false; sel.value = lang; }); });
    listeners.push(function (l) { sel.value = l; });
  }

  window.OmniLang = {
    get lang() { return lang; },
    languages: function () { return Object.keys(LANGS).map(function (c) { return { code: c, name: LANGS[c].name, native: LANGS[c].native }; }); },
    set: setLang,
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
  var mount = function () { mountSelector(document.getElementById('ui-language-select')); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
