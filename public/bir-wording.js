/*
 * OmniPOS — BIR wording guard (non-BIR mode)
 *
 * Habang HINDI pa fully BIR-accredited ang system (BIR Compliance module naka-lock, o naka-unlock pero walang
 * naka-configure na permit details), ang mga salitang nagpapahiwatig ng opisyal na BIR document
 * ("Receipt", "Invoice", "Official Receipt", "Sales Invoice") ay pinapalitan ng "Order Slip" sa LAHAT ng
 * nakikitang text ng app (modal, button, label, toast, SweetAlert, tooltip/placeholder).
 * Kapag naka-unlock na ang BIR document mode, ibinabalik ang EKSAKTONG orihinal na text.
 *
 * Fail-safe: kung hindi pa alam ang status (hindi pa loaded ang app.js / offline), ituturing na NAKA-LOCK.
 * Hindi ginagalaw: data cells (td), input/textarea, product/cart data, code, at anumang may [data-bir-keep]
 * (hal. ang legal notice at Terms and Conditions) para hindi masira ang pangalan ng produkto o legal na teksto.
 */
(function () {
    'use strict';
    if (window.OmniBirWording) return;

    var SKIP_SELECTOR = [
        'script', 'style', 'textarea', 'input', 'select', 'option', 'pre', 'code', 'td',
        '[contenteditable="true"]', '[data-bir-keep]',
        '.receipt-document-mode', '.receipt-nonbir-notice', '.r-item-line', '.r-item-detail-line',
        '.swal2-input', '.swal2-textarea',
        '[class*="product-"]', '[class*="-product"]', '[class*="cart-item"]', '[class*="item-name"]', '[class*="prod-name"]',
        '[id*="product-grid"]', '[id*="cart-items"]'
    ].join(',');
    // Ang placeholder/title ng input ay label (hindi data), kaya pinoproseso ang attributes ng input/textarea/select.
    var ATTR_SKIP_SELECTOR = SKIP_SELECTOR.replace('textarea,input,select,option,', '');
    var ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'aria-description', 'data-label', 'data-tooltip', 'data-title', 'data-original-title'];
    // <input type=button|submit|reset value="..."> is a visible label too (value of other inputs is data and is never touched).
    var BUTTON_INPUT = /^(button|submit|reset)$/i;
    function attrsFor(el) {
        if (el.tagName === 'INPUT' && BUTTON_INPUT.test(el.getAttribute('type') || '')) return ATTRS.concat(['value']);
        return ATTRS;
    }
    var SUPPLIER_CONTEXT = /(supplier|vendor|purchase|delivery|billing|goods|vendor's|supplier's)\s+$/i;

    var applied = new WeakMap();      // Text node -> { orig, out }
    var locked = true;
    var observer = null;
    var applying = false;

    function computeLocked() {
        try {
            if (typeof isBirDocumentModeEnabled === 'function') return !isBirDocumentModeEnabled();
        } catch (e) { /* fail-safe: locked */ }
        return true;
    }

    function matchCase(src, titleWord, lowerWord) {
        if (src === src.toUpperCase() && /[A-Z]/.test(src)) return titleWord.toUpperCase();
        if (/^[A-Z]/.test(src)) return titleWord;
        return lowerWord;
    }

    // Ang pagkakasunod-sunod ay mahalaga: pinakamahabang parirala muna.
    function transform(str) {
        if (!str || typeof str !== 'string') return str;
        if (!/receipt|invoic|resibo/i.test(str) && !/\b(?:OR|SI)\s+(?:No|Number|#)/.test(str)) return str;
        var out = str;
        out = out.replace(/\bsales\s+invoices?\b/gi, function (m) { return matchCase(m, /s$/i.test(m) ? 'Order Slips' : 'Order Slip', /s$/i.test(m) ? 'order slips' : 'order slip'); });
        out = out.replace(/\bofficial\s+receipts?\b/gi, function (m) { return matchCase(m, /s$/i.test(m) ? 'Order Slips' : 'Order Slip', /s$/i.test(m) ? 'order slips' : 'order slip'); });
        out = out.replace(/\breceipt\s+invoice\b/gi, function (m) { return matchCase(m, 'Order Slip', 'order slip'); });
        // "Invoice No." -> "Slip No." (but a supplier/purchase invoice number is not a BIR sales document: keep it)
        out = out.replace(/\binvoice\s+(no\.?|number|#)/gi, function (m, tail, offset, whole) {
            if (SUPPLIER_CONTEXT.test(whole.slice(Math.max(0, offset - 14), offset))) return m;
            return matchCase(m, 'Slip ', 'slip ') + tail;
        });
        // Official-document abbreviations: "OR No.", "SI No." (case-sensitive so a normal "or"/"si" is never touched)
        out = out.replace(/\b(?:OR|SI)(\s+)(No\.?|Number|#)/g, function (m, sp, tail) { return 'Slip' + sp + tail; });
        out = out.replace(/\be-?receipts?\b/gi, function (m) { return matchCase(m, /s$/i.test(m) ? 'Order Slips' : 'Order Slip', /s$/i.test(m) ? 'order slips' : 'order slip'); });
        out = out.replace(/\breceipts\b/gi, function (m) { return matchCase(m, 'Order Slips', 'order slips'); });
        out = out.replace(/\breceipt\b/gi, function (m) { return matchCase(m, 'Order Slip', 'order slip'); });
        out = out.replace(/\binvoices?\b/gi, function (m, offset, whole) {
            if (SUPPLIER_CONTEXT.test(whole.slice(Math.max(0, offset - 14), offset))) return m; // supplier/purchase invoice: hindi BIR sales document
            return matchCase(m, /s$/i.test(m) ? 'Order Slips' : 'Order Slip', /s$/i.test(m) ? 'order slips' : 'order slip');
        });
        // Verb / gerund forms: "invoicing system" -> "order slip system", "invoiced" -> "recorded"
        out = out.replace(/\binvoicing\b/gi, function (m) { return matchCase(m, 'Order Slip', 'order slip'); });
        out = out.replace(/\binvoiced\b/gi, function (m) { return matchCase(m, 'Recorded', 'recorded'); });
        // Filipino: "resibong ito" -> "order slip na ito"
        out = out.replace(/\bresibong\b/gi, function (m) { return matchCase(m, 'Order Slip na', 'order slip na'); });
        out = out.replace(/\bresibo\b/gi, function (m) { return matchCase(m, 'Order Slip', 'order slip'); });
        return out;
    }

    function shouldSkip(el) {
        if (!el || el.nodeType !== 1) return true;
        // <option> is normally skipped (it can hold product/customer data). A static option that is only a LABEL opts in
        // with data-bir-label, so e.g. "Email Receipt" in a dropdown follows the same wording rule as the rest of the UI.
        if (el.tagName === 'OPTION' && el.hasAttribute('data-bir-label')) return false;
        try { return !!el.closest(SKIP_SELECTOR); } catch (e) { return true; }
    }

    function processText(node) {
        if (!node || node.nodeType !== 3) return;
        var parent = node.parentElement;
        if (!parent || shouldSkip(parent)) return;
        var cur = node.nodeValue;
        var rec = applied.get(node);
        if (rec && rec.out === cur) return;                 // ito pa rin ang ginawa natin
        var out = transform(cur);
        if (out !== cur) { applied.set(node, { orig: cur, out: out }); node.nodeValue = out; }
        else if (rec) applied.delete(node);
    }

    function restoreText(node) {
        var rec = applied.get(node);
        if (rec && node.nodeValue === rec.out) node.nodeValue = rec.orig;
        applied.delete(node);
    }

    function shouldSkipAttrs(el) {
        try { return !!el.closest(ATTR_SKIP_SELECTOR); } catch (e) { return true; }
    }

    function processAttrs(el) {
        if (!el || el.nodeType !== 1 || shouldSkipAttrs(el)) return;
        var list = attrsFor(el);
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var v = el.getAttribute(a);
            if (!v) continue;
            var store = el.__birAttr || (el.__birAttr = {});
            var rec = store[a];
            if (rec && rec.out === v) continue;
            var out = transform(v);
            if (out !== v) { store[a] = { orig: v, out: out }; el.setAttribute(a, out); }
            else if (rec) delete store[a];
        }
    }

    function restoreAttrs(el) {
        var store = el.__birAttr;
        if (!store) return;
        Object.keys(store).forEach(function (a) {
            if (el.getAttribute(a) === store[a].out) el.setAttribute(a, store[a].orig);
        });
        el.__birAttr = null;
    }

    function walk(root, onText, onEl) {
        if (!root) return;
        if (root.nodeType === 3) { onText(root); return; }
        if (root.nodeType !== 1) return;
        onEl(root);
        var tw = document.createTreeWalker(root, 1 | 4, null);   // elements + text
        var n = tw.nextNode();
        while (n) {
            if (n.nodeType === 3) onText(n); else onEl(n);
            n = tw.nextNode();
        }
    }

    var origTitle = null;
    function handleDocumentTitle() {
        try {
            if (locked) {
                var t = document.title;
                var o = transform(t);
                if (o !== t) { origTitle = origTitle === null ? t : origTitle; document.title = o; }
            } else if (origTitle !== null) { document.title = origTitle; origTitle = null; }
        } catch (e) { /* ignore */ }
    }

    function fullScan() {
        applying = true;
        try {
            walk(document.body, locked ? processText : restoreText, locked ? processAttrs : restoreAttrs);
            handleDocumentTitle();
        } finally { applying = false; }
    }

    function onMutations(records) {
        if (!locked || applying) return;
        applying = true;
        try {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (r.type === 'childList') {
                    for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j], processText, processAttrs);
                } else if (r.type === 'characterData') {
                    processText(r.target);
                } else if (r.type === 'attributes') {
                    processAttrs(r.target);
                }
            }
        } finally { applying = false; }
    }

    function refresh() {
        var next = computeLocked();
        if (next === locked && observer) return;
        locked = next;
        fullScan();
    }

    function start() {
        if (!document.body) { document.addEventListener('DOMContentLoaded', start, { once: true }); return; }
        locked = computeLocked();
        fullScan();
        if (typeof MutationObserver === 'function') {
            observer = new MutationObserver(onMutations);
            observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(["value"]) });
        }
        // Sinusuri ang status kada 2.5s (nagbabago ito kapag na-load ang unlocked features / store settings, o na-unlock ang BIR module).
        setInterval(refresh, 2500);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    }

    window.OmniBirWording = {
        refresh: refresh,
        isLocked: function () { return locked; },
        t: function (s) { return computeLocked() ? transform(s) : s; }
    };
    start();
})();
