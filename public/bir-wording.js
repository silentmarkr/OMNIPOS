/*
 * OmniPOS — BIR wording guard v2 (non-BIR mode)
 *
 * Habang HINDI pa fully BIR-accredited ang system (BIR Compliance module naka-lock, o naka-unlock pero walang
 * naka-configure na permit details), ang mga salitang nagpapahiwatig ng opisyal na BIR document
 * ("Receipt", "Invoice", "Official Receipt", "Sales Invoice") ay pinapalitan ng "Order Slip", at ang mga BIR-term
 * sa Shift module ("Z-Reading", "X-Reading", "official cash count") ay pinapalitan ng "Shift Close" / "Mid-Shift Report".
 * Kapag naka-unlock na ang BIR mode, ibinabalik ang EKSAKTONG orihinal na text. Hindi ginagalaw ang "BIR Z-Reading"
 * (ang BIR module mismo) at ang FAQ/AI chat (para sa Z/X-Reading lang).
 *
 * BAGONG FLOW (v2) — iisang rule engine, apat na layer para wala nang madaanan:
 *   1. DOM layer      : text nodes + attributes ng main page AT ng same-origin <iframe> (hal. e-receipt preview).
 *                       Live (MutationObserver) at nababalik ang orihinal kapag na-unlock.
 *   2. Document layer : bawat window.open() popup (X-Reading print, debt print, atbp.) — ang HTML na isusulat ng
 *                       document.write() ay dumadaan muna sa rule engine bago lumabas / ma-print.
 *   3. Dialog layer   : native alert() / confirm() / prompt() (hindi sila DOM kaya hindi naaabot ng layer 1).
 *   4. File layer     : pangalan ng downloaded file (a.download), hal. "receipt-123.png" -> "order-slip-123.png".
 *   + audit()         : OmniBirWording.audit() — ulat ng anumang BIR-term na nakikita pa o nasa protected zone.
 *
 * Context-aware: "confirm receipt" (natanggap na stock sa branch transfer) at "Purchase Order receipt" ay hindi BIR
 * document kaya ginagawang "arrival" / "receiving" (hindi "Order Slip"). Ang supplier/purchase invoice ay hindi ginagalaw.
 *
 * Fail-safe: kung hindi pa alam ang status (hindi pa loaded ang app.js / offline), ituturing na NAKA-LOCK.
 * Hindi ginagalaw: data cells (td), input/textarea, product/cart data, code, at anumang may [data-bir-keep]
 * (hal. ang legal notice at Terms and Conditions). Para i-opt-in ang isang label na nasa loob ng data zone (hal. td
 * o option na label lang), lagyan ng [data-bir-label].
 */
(function () {
    'use strict';
    if (window.OmniBirWording) return;

    // ---------------------------------------------------------------------------------------------------------
    // Skip zones. HARD = hindi kailanman ginagalaw. SOFT = data zone, ginagalaw lang kung may [data-bir-label].
    // ---------------------------------------------------------------------------------------------------------
    var HARD = [
        'script', 'style', 'textarea', 'input', 'pre', 'code',
        '[contenteditable="true"]', '[data-bir-keep]',
        '.receipt-document-mode', '.receipt-nonbir-notice',
        '.swal2-input', '.swal2-textarea'
    ];
    var SOFT = [
        'select', 'option', 'td',
        '.r-item-line', '.r-item-detail-line',
        '[class*="product-"]', '[class*="-product"]', '[class*="cart-item"]', '[class*="item-name"]', '[class*="prod-name"]',
        '[id*="product-grid"]', '[id*="cart-items"]'
    ];
    function without(list, drop) { return list.filter(function (s) { return drop.indexOf(s) === -1; }); }
    var TEXT_HARD = HARD.join(',');
    var TEXT_SOFT = SOFT.join(',');
    // Ang placeholder/title ng input ay label (hindi data), kaya pinoproseso ang attributes ng input/textarea/select/option.
    var ATTR_HARD = without(HARD, ['textarea', 'input']).join(',');
    var ATTR_SOFT = without(SOFT, ['select', 'option']).join(',');
    var ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'aria-description', 'data-label', 'data-tooltip', 'data-title', 'data-original-title'];
    // <input type=button|submit|reset value="..."> is a visible label too (value of other inputs is data and is never touched).
    var BUTTON_INPUT = /^(button|submit|reset)$/i;
    function attrsFor(el) {
        if (el.tagName === 'INPUT' && BUTTON_INPUT.test(el.getAttribute('type') || '')) return ATTRS.concat(['value']);
        return ATTRS;
    }
    // Ang FAQ / AI chat ay nagpapaliwanag ng iba't ibang module (kasama ang BIR), kaya hindi pinapalitan doon ang Z/X-Reading.
    var READING_SKIP_SELECTOR = '[class*="faq"], [id*="faq"], [class*="ai-chat"], [id*="ai-chat"], #view-bir_compliance';
    var SUPPLIER_CONTEXT = /(supplier|vendor|purchase|delivery|billing|goods|vendor's|supplier's)\s+$/i;
    // Mabilis na pre-check: may BIR-term ba ang string? (iwas sa mabibigat na regex sa karamihan ng text)
    var QUICK_DOC = /receipt|invoic|resibo/i;
    var QUICK_ABBR = /\b(?:OR|SI)\s+(?:No|Number|#)/;
    var QUICK_READING = /[xz][-\s]?reading|official\s+cash/i;

    var locked = true;
    var readingLocked = true;
    var observer = null;
    var titleObserver = null;
    var mainScanner = null;
    var frameScanners = [];

    function computeLocked() {
        try {
            if (typeof isBirDocumentModeEnabled === 'function') return !isBirDocumentModeEnabled();
        } catch (e) { /* fail-safe: locked */ }
        return true;
    }

    // Z-Reading / X-Reading ay BIR-regulated na termino: habang naka-lock ang BIR Compliance module ay "Shift Close"
    // at "Mid-Shift Report" ang gamit. Fail-safe: kung hindi pa alam ang status, ituturing na NAKA-LOCK.
    function computeReadingLocked() {
        try {
            if (typeof isFeatureUnlockedCached === 'function') return !isFeatureUnlockedCached('bir_compliance');
        } catch (e) { /* fail-safe: locked */ }
        return true;
    }

    function matchCase(src, titleWord, lowerWord) {
        if (src === src.toUpperCase() && /[A-Z]/.test(src)) return titleWord.toUpperCase();
        if (/^[A-Z]/.test(src)) return titleWord;
        return lowerWord;
    }
    function slipWord(m) { return matchCase(m, /s$/i.test(m) ? 'Order Slips' : 'Order Slip', /s$/i.test(m) ? 'order slips' : 'order slip'); }

    // ---------------------------------------------------------------------------------------------------------
    // RULE ENGINE (iisa lang — ito ang ginagamit ng lahat ng layer)
    // ---------------------------------------------------------------------------------------------------------

    // Ang pagkakasunod-sunod ay mahalaga: pinakamahabang parirala muna.
    function transformReadingWords(str) {
        if (!QUICK_READING.test(str)) return str;
        var out = str;
        // "X-READING (Mid-Shift Reading)" -> "Mid-Shift Report"
        out = out.replace(/\bx[-\s]?reading\s*\(\s*mid-?shift\s+reading\s*\)/gi, function (m) { return matchCase(m, 'Mid-Shift Report', 'mid-shift report'); });
        out = out.replace(/\bx[-\s]?readings?\b/gi, function (m) { return matchCase(m, /s$/i.test(m) ? 'Mid-Shift Reports' : 'Mid-Shift Report', /s$/i.test(m) ? 'mid-shift reports' : 'mid-shift report'); });
        // "Shift / Z-Reading Report" -> "Shift Report"; "shift / Z-Reading" -> "shift"
        out = out.replace(/\bshift\s*\/\s*z[-\s]?readings?\s+report\b/gi, function (m) { return matchCase(m, 'Shift Report', 'shift report'); });
        out = out.replace(/\bshift\s*\/\s*z[-\s]?readings?\b/gi, function (m) { return matchCase(m, 'Shift Report', 'shift'); });
        // "Close Shift (Z-Reading)" -> "Close Shift"
        out = out.replace(/\s*\(\s*z[-\s]?readings?\s*\)/gi, '');
        out = out.replace(/\bofficial\s+cash\s+count\b/gi, function (m) { return matchCase(m, 'Cash Count', 'cash count'); });
        // "BIR Z-Reading" is the BIR module's own term (not the shift close): keep it.
        out = out.replace(/\bz[-\s]?readings?\b/gi, function (m, offset, whole) {
            if (/\bBIR\s+$/i.test(whole.slice(Math.max(0, offset - 6), offset))) return m;
            return matchCase(m, /s$/i.test(m) ? 'Shift Closes' : 'Shift Close', /s$/i.test(m) ? 'shift closes' : 'shift close');
        });
        return out;
    }

    function transformDocWords(str) {
        if (!QUICK_DOC.test(str) && !QUICK_ABBR.test(str)) return str;
        var out = str;
        // Pagtanggap ng stock / goods (branch transfer, Purchase Order, consignment) ay HINDI BIR document:
        // "confirm receipt" -> "confirm arrival", "Purchase Order receipt" -> "Purchase Order receiving".
        out = out.replace(/\bconfirm(?:s|ed|ing)?\s+receipt\b/gi, function (m) {
            return m.replace(/receipt$/i, function (w) { return matchCase(w, 'Arrival', 'arrival'); });
        });
        out = out.replace(/\b(?:purchase\s+orders?|po|goods|stock|consignment|inventory)\s+receipts?\b/gi, function (m) {
            return m.replace(/receipts?$/i, function (w) { return matchCase(w, 'Receiving', 'receiving'); });
        });
        out = out.replace(/\breceipt\s+of(?=\s+(?:(?:the|this|these|that|your|a|an)\s+)?(?:transfers?|stocks?|goods|shipments?|deliver(?:y|ies)|supplies|inventory|purchase\s+orders?)\b)/gi, function (m) {
            return m.replace(/^receipt/i, function (w) { return matchCase(w, 'Arrival', 'arrival'); });
        });
        out = out.replace(/\bsales\s+invoices?\b/gi, slipWord);
        out = out.replace(/\bofficial\s+receipts?\b/gi, slipWord);
        out = out.replace(/\breceipt\s+invoice\b/gi, function (m) { return matchCase(m, 'Order Slip', 'order slip'); });
        // "Invoice No." -> "Slip No." (but a supplier/purchase invoice number is not a BIR sales document: keep it)
        out = out.replace(/\binvoice\s+(no\.?|number|#)/gi, function (m, tail, offset, whole) {
            if (SUPPLIER_CONTEXT.test(whole.slice(Math.max(0, offset - 14), offset))) return m;
            return matchCase(m, 'Slip ', 'slip ') + tail;
        });
        // Official-document abbreviations: "OR No.", "SI No." (case-sensitive so a normal "or"/"si" is never touched)
        out = out.replace(/\b(?:OR|SI)(\s+)(No\.?|Number|#)/g, function (m, sp, tail) { return 'Slip' + sp + tail; });
        out = out.replace(/\be-?receipts?\b/gi, slipWord);
        out = out.replace(/\be-?invoices?\b/gi, slipWord);
        out = out.replace(/\breceipts\b/gi, function (m) { return matchCase(m, 'Order Slips', 'order slips'); });
        out = out.replace(/\breceipt\b/gi, function (m) { return matchCase(m, 'Order Slip', 'order slip'); });
        out = out.replace(/\binvoices?\b/gi, function (m, offset, whole) {
            if (SUPPLIER_CONTEXT.test(whole.slice(Math.max(0, offset - 14), offset))) return m; // supplier/purchase invoice: hindi BIR sales document
            return slipWord(m);
        });
        // Verb / gerund forms: "invoicing system" -> "order slip system", "invoiced" -> "recorded"
        out = out.replace(/\binvoicing\b/gi, function (m) { return matchCase(m, 'Order Slip', 'order slip'); });
        out = out.replace(/\binvoiced\b/gi, function (m) { return matchCase(m, 'Recorded', 'recorded'); });
        // Filipino: "resibong ito" -> "order slip na ito"
        out = out.replace(/\bresibong\b/gi, function (m) { return matchCase(m, 'Order Slip na', 'order slip na'); });
        out = out.replace(/\bresibo\b/gi, function (m) { return matchCase(m, 'Order Slip', 'order slip'); });
        return out;
    }

    // lk / rl: i-override ang "locked" flags (undefined = gamitin ang kasalukuyang estado ng module).
    function transform(str, lk, rl) {
        if (!str || typeof str !== 'string') return str;
        var out = str;
        if (lk === undefined ? locked : lk) out = transformDocWords(out);
        if (rl === undefined ? readingLocked : rl) out = transformReadingWords(out);
        return out;
    }

    // Pangalan ng file: "receipt-123.png" -> "order-slip-123.png", "x_reading.csv" -> "mid-shift-report.csv".
    function transformFileName(name, lk, rl) {
        if (!name || typeof name !== 'string') return name;
        var out = name;
        if (lk) {
            out = out.replace(/(?:official[-_ ]?)?receipts?/gi, 'order-slip');
            out = out.replace(/(?:sales[-_ ]?)?invoices?/gi, function (m, offset, whole) {
                return /(supplier|vendor|purchase|delivery|billing)[-_ ]?$/i.test(whole.slice(Math.max(0, offset - 10), offset)) ? m : 'order-slip';
            });
            out = out.replace(/resibo/gi, 'order-slip');
        }
        if (rl) {
            out = out.replace(/x[-_ ]?readings?/gi, 'mid-shift-report');
            out = out.replace(/(bir[-_ ]?)?z[-_ ]?readings?/gi, function (m, bir) { return bir ? m : 'shift-close'; });
        }
        return out;
    }

    function readingAllowed(el) {
        try { return !(el && el.closest && el.closest(READING_SKIP_SELECTOR)); } catch (e) { return false; }
    }

    function isSkipped(el, hardSel, softSel) {
        if (!el || el.nodeType !== 1) return true;
        try {
            if (el.closest(hardSel)) return true;
            var soft = el.closest(softSel);
            if (!soft) return false;
            // Opt-in: isang label (hal. static <option>, <td>) na may [data-bir-label] ay sumusunod sa wording rule.
            var lab = el.closest('[data-bir-label]');
            return !(lab && soft.contains(lab));
        } catch (e) { return true; }
    }
    function shouldSkip(el) { return isSkipped(el, TEXT_HARD, TEXT_SOFT); }
    function shouldSkipAttrs(el) { return isSkipped(el, ATTR_HARD, ATTR_SOFT); }

    // ---------------------------------------------------------------------------------------------------------
    // DOM layer — Scanner bawat Document (main page, same-origin iframe, o inert na parsed popup HTML)
    // ---------------------------------------------------------------------------------------------------------
    function Scanner(doc, fixedFlags) {
        this.doc = doc;
        this.fixed = fixedFlags || null;       // { lk, rl } para sa one-shot na pag-transform ng popup HTML
        this.applied = new WeakMap();           // Text node -> { orig, out }
        this.applying = false;
        this.observer = null;
        this.titleRec = null;
    }
    Scanner.prototype.flag = function (which) {
        if (this.fixed) return which === 'lk' ? this.fixed.lk : this.fixed.rl;
        return which === 'lk' ? locked : readingLocked;
    };
    Scanner.prototype.alive = function () {
        try { return !!(this.doc && this.doc.defaultView && this.doc.documentElement); } catch (e) { return false; }
    };
    Scanner.prototype.processText = function (node) {
        if (!node || node.nodeType !== 3) return;
        var parent = node.parentElement;
        if (!parent || shouldSkip(parent)) return;
        var cur = node.nodeValue;
        var rec = this.applied.get(node);
        if (rec && rec.out === cur) return;                 // ito pa rin ang ginawa natin
        var out = transform(cur, this.flag('lk'), readingAllowed(parent) ? this.flag('rl') : false);
        if (out !== cur) { this.applied.set(node, { orig: cur, out: out }); node.nodeValue = out; }
        else if (rec) this.applied.delete(node);
    };
    Scanner.prototype.restoreText = function (node) {
        var rec = this.applied.get(node);
        if (rec && node.nodeValue === rec.out) node.nodeValue = rec.orig;
        this.applied.delete(node);
    };
    Scanner.prototype.processAttrs = function (el) {
        if (!el || el.nodeType !== 1 || shouldSkipAttrs(el)) return;
        var list = attrsFor(el);
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var v = el.getAttribute(a);
            if (!v) continue;
            var store = el.__birAttr || (el.__birAttr = {});
            var rec = store[a];
            if (rec && rec.out === v) continue;
            var out = transform(v, this.flag('lk'), readingAllowed(el) ? this.flag('rl') : false);
            if (out !== v) { store[a] = { orig: v, out: out }; el.setAttribute(a, out); }
            else if (rec) delete store[a];
        }
    };
    Scanner.prototype.restoreAttrs = function (el) {
        var store = el.__birAttr;
        if (!store) return;
        Object.keys(store).forEach(function (a) {
            if (el.getAttribute(a) === store[a].out) el.setAttribute(a, store[a].orig);
        });
        el.__birAttr = null;
    };
    Scanner.prototype.walk = function (root, onText, onEl) {
        if (!root) return;
        if (root.nodeType === 3) { onText(root); return; }
        if (root.nodeType !== 1) return;
        onEl(root);
        var tw = this.doc.createTreeWalker(root, 1 | 4, null);   // elements + text
        var n = tw.nextNode();
        while (n) {
            if (n.nodeType === 3) onText(n); else onEl(n);
            n = tw.nextNode();
        }
    };
    // <title> ng page: ibinabalik din ang orihinal kapag na-unlock.
    Scanner.prototype.handleTitle = function () {
        try {
            var d = this.doc;
            var t = d.title;
            var rec = this.titleRec;
            if (this.flag('lk') || this.flag('rl')) {
                if (rec && rec.out === t) return;
                var o = transform(t, this.flag('lk'), this.flag('rl'));
                if (o !== t) { this.titleRec = { orig: t, out: o }; d.title = o; }
                else this.titleRec = null;
            } else if (rec) {
                if (t === rec.out) d.title = rec.orig;
                this.titleRec = null;
            }
        } catch (e) { /* ignore */ }
    };
    Scanner.prototype.fullScan = function () {
        var self = this;
        if (!this.doc.body) return;
        this.applying = true;
        try {
            // Una ibinabalik ang lahat (para tama ang resulta kapag nagbago ang isa sa dalawang lock status), saka muling pinoproseso.
            this.walk(this.doc.body, function (n) { self.restoreText(n); }, function (e) { self.restoreAttrs(e); });
            if (this.flag('lk') || this.flag('rl')) {
                this.walk(this.doc.body, function (n) { self.processText(n); }, function (e) { self.processAttrs(e); watchFrame(e); });
            }
            this.handleTitle();
        } finally { this.applying = false; }
    };
    Scanner.prototype.onMutations = function (records) {
        var self = this;
        if ((!this.flag('lk') && !this.flag('rl')) || this.applying) return;
        this.applying = true;
        try {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (r.type === 'childList') {
                    for (var j = 0; j < r.addedNodes.length; j++) {
                        this.walk(r.addedNodes[j], function (n) { self.processText(n); }, function (e) { self.processAttrs(e); watchFrame(e); });
                    }
                } else if (r.type === 'characterData') {
                    this.processText(r.target);
                } else if (r.type === 'attributes') {
                    this.processAttrs(r.target);
                }
            }
        } finally { this.applying = false; }
    };
    Scanner.prototype.observe = function () {
        var self = this;
        if (typeof MutationObserver !== 'function' || !this.doc.body) return;
        this.observer = new MutationObserver(function (records) { self.onMutations(records); });
        this.observer.observe(this.doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
    };

    // Same-origin <iframe> (hal. e-receipt preview na srcdoc): sariling Scanner bawat dokumento.
    function watchFrame(el) {
        if (!el || el.nodeType !== 1 || el.tagName !== 'IFRAME' || el.__birWatched) return;
        el.__birWatched = true;
        var attach = function () {
            try {
                var d = el.contentDocument;
                if (!d || !d.body || el.__birDoc === d) return;
                el.__birDoc = d;
                liveFrameScanners();                      // alisin ang scanner ng mga iframe na wala na (iwas memory leak)
                var sc = new Scanner(d);
                frameScanners.push(sc);
                sc.fullScan();
                sc.observe();
            } catch (e) { /* cross-origin / not ready: ignore */ }
        };
        el.addEventListener('load', attach);
        attach();
    }
    function liveFrameScanners() {
        frameScanners = frameScanners.filter(function (s) { return s.alive(); });
        return frameScanners;
    }

    function fullScanAll() {
        if (mainScanner) mainScanner.fullScan();
        liveFrameScanners().forEach(function (s) { s.fullScan(); });
    }

    function refresh() {
        var next = computeLocked();
        var nextReading = computeReadingLocked();
        if (next === locked && nextReading === readingLocked && observer) return;
        locked = next;
        readingLocked = nextReading;
        fullScanAll();
    }

    // ---------------------------------------------------------------------------------------------------------
    // Document layer — HTML na isusulat sa popup / print window
    // ---------------------------------------------------------------------------------------------------------
    function transformHtmlLoose(html, lk, rl) {
        // Fallback para sa hindi kumpletong HTML fragment: text lang sa pagitan ng tags, at hindi ginagalaw ang loob ng
        // script/style/textarea/pre/code/td.
        var skip = 0;
        return html.replace(/<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+/gi, function (tok, close, tag) {
            if (tag) {
                var t = tag.toLowerCase();
                if (t === 'script' || t === 'style' || t === 'textarea' || t === 'pre' || t === 'code' || t === 'td') {
                    skip += close ? -1 : 1;
                    if (skip < 0) skip = 0;
                }
                return tok;
            }
            if (tok.charAt(0) === '<' || skip > 0) return tok;
            return transform(tok, lk, rl);
        });
    }
    function needsTransform(s) { return QUICK_DOC.test(s) || QUICK_ABBR.test(s) || QUICK_READING.test(s); }
    function transformHtml(html) {
        if (!html || typeof html !== 'string') return html;
        var lk = computeLocked();
        var rl = computeReadingLocked();
        if (!lk && !rl) return html;
        if (!needsTransform(html)) return html;
        try {
            if (/<\/(?:html|body)>/i.test(html) && /<(?:html|body)[\s>]/i.test(html) && typeof DOMParser === 'function') {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var sc = new Scanner(doc, { lk: lk, rl: rl });
                var self = sc;
                sc.walk(doc.documentElement, function (n) { self.processText(n); }, function (e) { self.processAttrs(e); });
                var dt = /^\s*<!doctype[^>]*>/i.exec(html);
                return (dt ? dt[0] + '\n' : '') + doc.documentElement.outerHTML;
            }
            return transformHtmlLoose(html, lk, rl);
        } catch (e) {
            try { return transformHtmlLoose(html, lk, rl); } catch (e2) { return html; }
        }
    }

    function hookPopup(w) {
        try {
            if (!w || w.closed) return w;
            var d = w.document;
            if (!d || d.__birHooked) return w;
            ['write', 'writeln'].forEach(function (name) {
                var orig = d[name];
                if (typeof orig !== 'function') return;
                d[name] = function () {
                    var args = Array.prototype.map.call(arguments, function (a) { return typeof a === 'string' ? transformHtml(a) : a; });
                    return orig.apply(d, args);
                };
            });
            d.__birHooked = true;
        } catch (e) { /* cross-origin popup: hindi naaabot, ignore */ }
        return w;
    }

    function installSinks() {
        // Layer 2: popup / print windows
        try {
            var nativeOpen = window.open;
            if (typeof nativeOpen === 'function') {
                window.open = function () { return hookPopup(nativeOpen.apply(this, arguments)); };
            }
        } catch (e) { /* ignore */ }
        // Layer 3: native dialogs (hindi DOM)
        ['alert', 'confirm', 'prompt'].forEach(function (name) {
            try {
                var orig = window[name];
                if (typeof orig !== 'function') return;
                window[name] = function () {
                    var args = Array.prototype.slice.call(arguments);
                    if (typeof args[0] === 'string') args[0] = transform(args[0], computeLocked(), computeReadingLocked());
                    return orig.apply(window, args);
                };
            } catch (e) { /* ignore */ }
        });
        // Layer 4: pangalan ng downloaded file
        try {
            var desc = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'download');
            if (desc && typeof desc.set === 'function') {
                Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
                    configurable: true,
                    enumerable: desc.enumerable,
                    get: desc.get,
                    set: function (v) { desc.set.call(this, transformFileName(v, computeLocked(), computeReadingLocked())); }
                });
            }
        } catch (e) { /* ignore */ }
    }

    // ---------------------------------------------------------------------------------------------------------
    // Audit — para sa QA: ano pa ang nakikitang BIR-term? (OmniBirWording.audit() sa console)
    //   leaks     : text/attribute na dapat nang napalitan pero hindi (dapat laging walang laman)
    //   protected : may BIR-term pero nasa protected zone (data cell, product name, legal notice…) — i-review lang
    // ---------------------------------------------------------------------------------------------------------
    function describeZone(el, attrMode) {
        var sels = (attrMode ? ATTR_HARD : TEXT_HARD).split(',').concat((attrMode ? ATTR_SOFT : TEXT_SOFT).split(','));
        for (var i = 0; i < sels.length; i++) {
            try { if (el.closest(sels[i])) return sels[i]; } catch (e) { /* ignore */ }
        }
        return '';
    }
    function nodePath(el) {
        var parts = [];
        while (el && el.nodeType === 1 && parts.length < 4) {
            parts.unshift(el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
            el = el.parentElement;
        }
        return parts.join(' > ');
    }
    function auditDocument(doc, where, report) {
        if (!doc || !doc.body) return;
        var lk = locked, rl = readingLocked;
        var tw = doc.createTreeWalker(doc.body, 1 | 4, null);
        var n = tw.nextNode();
        while (n) {
            if (n.nodeType === 3) {
                var p = n.parentElement;
                if (p && !p.closest('script,style')) {
                    var txt = n.nodeValue;
                    var would = transform(txt, lk, readingAllowed(p) ? rl : false);
                    if (would !== txt) {
                        var skipped = shouldSkip(p);
                        (skipped ? report.protectedZones : report.leaks).push({ where: where, kind: 'text', text: txt.trim().slice(0, 120), path: nodePath(p), zone: skipped ? describeZone(p, false) : 'visible' });
                    }
                }
            } else {
                var list = attrsFor(n);
                for (var i = 0; i < list.length; i++) {
                    var v = n.getAttribute(list[i]);
                    if (!v) continue;
                    var w = transform(v, lk, readingAllowed(n) ? rl : false);
                    if (w !== v) {
                        var sk = shouldSkipAttrs(n);
                        (sk ? report.protectedZones : report.leaks).push({ where: where, kind: 'attr:' + list[i], text: v.slice(0, 120), path: nodePath(n), zone: sk ? describeZone(n, true) : 'visible' });
                    }
                }
            }
            n = tw.nextNode();
        }
        var t = doc.title;
        if (t && transform(t, lk, rl) !== t) report.leaks.push({ where: where, kind: 'title', text: t, path: 'title', zone: 'visible' });
    }
    function audit() {
        var report = { locked: locked, readingLocked: readingLocked, leaks: [], protectedZones: [] };
        auditDocument(document, 'page', report);
        liveFrameScanners().forEach(function (s, i) { auditDocument(s.doc, 'iframe#' + i, report); });
        return report;
    }

    function start() {
        if (!document.body) { document.addEventListener('DOMContentLoaded', start, { once: true }); return; }
        locked = computeLocked();
        readingLocked = computeReadingLocked();
        mainScanner = new Scanner(document);
        fullScanAll();
        mainScanner.observe();
        observer = mainScanner.observer;
        // Ang <title> ay nasa labas ng <body>: hiwalay na observer para mahuli ang pagbabago ng app.
        try {
            var tEl = document.querySelector('title');
            if (tEl && typeof MutationObserver === 'function') {
                titleObserver = new MutationObserver(function () { if (!mainScanner.applying) mainScanner.handleTitle(); });
                titleObserver.observe(tEl, { childList: true, characterData: true, subtree: true });
            }
        } catch (e) { /* ignore */ }
        // Sinusuri ang status kada 2.5s (nagbabago ito kapag na-load ang unlocked features / store settings, o na-unlock ang BIR module).
        setInterval(refresh, 2500);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    }

    window.OmniBirWording = {
        version: '2026-10-21.4',
        refresh: refresh,
        isLocked: function () { return locked; },
        isReadingLocked: function () { return readingLocked; },
        t: function (s) { return transform(s, computeLocked(), computeReadingLocked()); },
        tHtml: transformHtml,
        fileName: function (s) { return transformFileName(s, computeLocked(), computeReadingLocked()); },
        hookWindow: hookPopup,
        audit: audit
    };
    installSinks();
    start();
})();
