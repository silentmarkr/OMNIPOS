// bir-compliance.js
// -----------------------------------------------------------------------------
// Store-level BIR record-keeping: Accumulated Grand Total (AGT), sequential
// invoice numbering, void logging (to explain gaps in the invoice sequence),
// Z-Reading (BIR sense: AGT snapshot, NOT the existing per-cashier cash-count
// Z-reading already in server.js), AGT reset, and three export formats
// (e-Journal .txt, Sales Book .csv, EIS-ready .json).
//
// This module is intentionally decoupled from server.js: it only needs the
// db.js readData/writeData API and a plain "context" object passed in by the
// caller (store name/address/TIN, etc.) It does no authentication itself —
// the route layer in server.js is responsible for requiring the admin
// password + a reason before calling resetAGT(), and for permission-gating
// the routes.
//
// IMPORTANT CAVEATS (confirm with a BIR consultant before relying on this for
// an audit):
//  - AGT here follows: Beginning AGT + Net Sales (this Z period) = Ending AGT.
//  - A VOID does NOT decrement the AGT. The sale already accumulated into the
//    running total when it happened; the void is logged separately
//    (birVoids) purely so the gap in invoice numbers is explained. This
//    mirrors how a traditional cash register / POS-as-CRM keeps its grand
//    total tamper-evident.
//  - Resetting the AGT (resetAGT) zeroes the AGT/baseline and bumps
//    resetCounter, but deliberately does NOT reset invoice numbering —
//    invoice/OR numbers stay sequential across a reset. The same is true of
//    the System Hard Reset's BIR wipe (resetAllBirData): numbering and the
//    Z-Counter continue, the reset counter goes up, and bir-retention.js
//    archives the wiped records first. Both resets need a developer pass key
//    (see bir-retention.js).
//  - "Zero-rated sales" is not a concept this codebase tracks anywhere yet,
//    so the Sales Book / EIS export always reports it as 0.00. If the store
//    has zero-rated transactions, that column needs a real source field
//    added to the transaction record first.
//  - exportEIS() only prepares an EIS-shaped JSON payload. It does NOT
//    transmit anything to the BIR. Live e-invoicing transmission requires
//    either a direct EIS integration or an accredited service provider.
// -----------------------------------------------------------------------------

const crypto = require('crypto');
const { readData, writeData, runDatabaseTransaction, db: sqliteDb } = require('./db');

const MODULE_STATE = 'birState';
const MODULE_VOIDS = 'birVoids';
const MODULE_ZHISTORY = 'birZReadingHistory';
const MODULE_RESET_HISTORY = 'birResetHistory';
const MODULE_TRANSACTIONS = 'transactions';

// Every data module owned by this file. The System Hard Reset uses this list to (a) split BIR data
// out of the main emailed backup into its own attachment and (b) wipe it when the operator opts in.
// If a new BIR module is ever added above, add it here too so the Hard Reset stays complete.
const BIR_MODULE_NAMES = [MODULE_STATE, MODULE_VOIDS, MODULE_ZHISTORY, MODULE_RESET_HISTORY];

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila has no DST — fixed UTC+8 year-round.

function round2(n) {
    return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function nowIso() {
    return new Date().toISOString();
}

function genId(prefix) {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function pad(n, width) {
    return String(n).padStart(width, '0');
}

function defaultState() {
    return {
        agt: 0,                     // Accumulated Grand Total (never decreases except on an explicit reset)
        baselineAGT: 0,              // AGT value at the start of the CURRENT (still-open) reading period
        resetCounter: 0,
        zCounter: 0,
        nextInvoiceNumber: 1,
        invoiceNumberAtPeriodStart: 1,
        lastZReadingAt: null,
        lastResetAt: null,
        createdAt: nowIso()
    };
}

function getBirState() {
    const raw = readData(MODULE_STATE, null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultState();
    // Defensive merge so old/partial records pick up any new fields added later.
    return Object.assign(defaultState(), raw);
}

function saveBirState(state) {
    writeData(MODULE_STATE, state);
    return state;
}

function formatInvoiceNumber(n) {
    return `INV-${pad(n, 6)}`;
}

// --- Manila calendar-date helpers (PH has no DST, so a fixed +8h shift is exact) ---

function isoToManilaParts(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    const shifted = new Date(d.getTime() + MANILA_OFFSET_MS);
    return {
        y: shifted.getUTCFullYear(),
        m: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hh: shifted.getUTCHours(),
        mm: shifted.getUTCMinutes(),
        ss: shifted.getUTCSeconds()
    };
}

function manilaDateStr(isoStr) {
    const p = isoToManilaParts(isoStr);
    if (!p) return null;
    return `${p.y}-${pad(p.m, 2)}-${pad(p.day, 2)}`;
}

function manilaDateTimeDisplay(isoStr) {
    const p = isoToManilaParts(isoStr);
    if (!p) return '';
    return `${p.y}-${pad(p.m, 2)}-${pad(p.day, 2)} ${pad(p.hh, 2)}:${pad(p.mm, 2)}:${pad(p.ss, 2)}+08:00`;
}

function transactionIso(tx) {
    // isoDate is the reliable machine timestamp the client sends; `timestamp` is a
    // locale-formatted display string and is not safe to parse.
    if (!tx) return null;
    if (tx.isoDate && !isNaN(new Date(tx.isoDate).getTime())) return tx.isoDate;
    if (tx.createdAt && !isNaN(new Date(tx.createdAt).getTime())) return tx.createdAt;
    return null;
}

function isWithinManilaRange(isoStr, fromDateStr, toDateStr) {
    const d = manilaDateStr(isoStr);
    if (!d) return false;
    if (fromDateStr && d < fromDateStr) return false;
    if (toDateStr && d > toDateStr) return false;
    return true;
}

// -----------------------------------------------------------------------------
// Core hooks — called from server.js
// -----------------------------------------------------------------------------

// Call once, right after the final grandTotal for a sale is known and BEFORE the
// transaction is committed/persisted. Mutates and persists birState, and returns
// the fields that should be stamped onto the transaction record.
function onTransactionCommitted(grandTotal) {
    const state = getBirState();
    const invoiceNumberValue = state.nextInvoiceNumber;
    const invoiceNumber = formatInvoiceNumber(invoiceNumberValue);
    state.nextInvoiceNumber += 1;
    state.agt = round2(state.agt + round2(grandTotal));
    saveBirState(state);
    return { invoiceNumber, invoiceNumberValue, agtAfter: state.agt };
}

// Call from processVoidTransaction() BEFORE the transaction is spliced out of the
// transactions list — it needs the transaction's stamped BIR fields.
function onTransactionVoided({ transaction, voidedBy, reason }) {
    if (!transaction) throw new Error('onTransactionVoided requires the transaction being voided.');
    const state = getBirState();
    const voids = readData(MODULE_VOIDS, []);
    const record = {
        id: genId('BIRVOID'),
        invoiceNumber: transaction.birInvoiceNumber || null,
        invoiceNumberValue: typeof transaction.birInvoiceNumberValue === 'number' ? transaction.birInvoiceNumberValue : null,
        transactionId: transaction.id,
        amount: round2(transaction.total),
        itemCount: Array.isArray(transaction.items) ? transaction.items.length : 0,
        cashier: transaction.cashier || null,
        originalIsoDate: transactionIso(transaction),
        voidedAt: nowIso(),
        voidedBy: voidedBy || null,
        reason: String(reason || '').trim() || null,
        zCounterAtVoid: state.zCounter
        // Deliberately NOT touching state.agt — see module header note.
    };
    voids.unshift(record);
    writeData(MODULE_VOIDS, voids);
    return record;
}

// Counts the offline-synced sales whose BIR invoice number lies in [invoiceFrom, invoiceTo], and how many of them were rung
// up before the period started (periodStartMs). The invoice numbers of a period are the NEWEST ones, and a sale's row
// sequence grows together with its invoice number, so the transactions table is read newest-first in small pages and the
// scan stops as soon as it has passed the period. This replaces a read of the WHOLE transactions table (which on a
// multi-GB database means loading every sale into memory just to close the day). Falls back to the plain full read when
// the row store cannot be queried directly.
function summarizeOfflineSalesInInvoiceRange(invoiceFrom, invoiceTo, periodStartMs) {
    const summary = { offlineSyncedCount: 0, lateSyncedCount: 0, lateSyncedAmount: 0 };
    if (!(invoiceTo >= invoiceFrom)) return summary;
    const consider = (n, isOffline, soldAtRaw, isoRaw, total) => {
        if (!isOffline || typeof n !== 'number' || n < invoiceFrom || n > invoiceTo) return;
        summary.offlineSyncedCount += 1;
        const soldMs = new Date(soldAtRaw || isoRaw).getTime();
        if (Number.isFinite(periodStartMs) && Number.isFinite(soldMs) && soldMs < periodStartMs) {
            summary.lateSyncedCount += 1;
            summary.lateSyncedAmount = round2(summary.lateSyncedAmount + (parseFloat(total) || 0));
        }
    };
    let scannedRowStore = false;
    try {
        if (sqliteDb && typeof sqliteDb.prepare === 'function') {
            const stmt = sqliteDb.prepare(
                "SELECT seq, json_extract(data, '$.birInvoiceNumberValue') AS n, json_extract(data, '$.offlineSale') AS offline, " +
                "json_extract(data, '$.soldAt') AS soldAt, json_extract(data, '$.isoDate') AS isoDate, json_extract(data, '$.total') AS total " +
                'FROM row_store WHERE module = ? AND seq < ? ORDER BY seq DESC LIMIT ?'
            );
            const PAGE = 500;
            let cursor = Number.MAX_SAFE_INTEGER;
            for (;;) {
                const rows = stmt.all(MODULE_TRANSACTIONS, cursor, PAGE);
                if (!rows.length) break;
                scannedRowStore = true;
                let numberedAtOrAbove = false;
                let numberedBelow = false;
                for (const r of rows) {
                    const n = typeof r.n === 'number' ? r.n : NaN;
                    if (Number.isFinite(n)) {
                        if (n >= invoiceFrom) numberedAtOrAbove = true; else numberedBelow = true;
                    }
                    consider(Number.isFinite(n) ? n : null, Number(r.offline) === 1, r.soldAt, r.isoDate, r.total);
                }
                // This page only holds sales numbered BEFORE this period: everything after it is older still.
                if (numberedBelow && !numberedAtOrAbove) break;
                if (rows.length < PAGE) break;
                const last = Number(rows[rows.length - 1].seq);
                if (!Number.isFinite(last) || last >= cursor) break;
                cursor = last;
            }
        }
    } catch (e) {
        console.error('Z-Reading: the paged read of the sales failed, using the full read instead:', e.message);
        scannedRowStore = false;
        summary.offlineSyncedCount = 0;
        summary.lateSyncedCount = 0;
        summary.lateSyncedAmount = 0;
    }
    if (!scannedRowStore) {
        for (const t of readData(MODULE_TRANSACTIONS, [])) {
            if (!t) continue;
            consider(t.birInvoiceNumberValue, !!t.offlineSale, t.soldAt, t.isoDate, t.total);
        }
    }
    return summary;
}

// BIR-sense Z-Reading: snapshots Beginning AGT -> Ending AGT for the period since the
// last Z-Reading (or since install/last reset if there hasn't been one yet), and
// advances the period boundary. Distinct from the existing per-cashier shift
// Z-Reading (/api/shift/close) in server.js, which is a cash-count/variance report.
function performZReading({ authorizedBy } = {}) {
    const state = getBirState();
    const allVoids = readData(MODULE_VOIDS, []);
    const invoiceFrom = state.invoiceNumberAtPeriodStart;
    const invoiceTo = state.nextInvoiceNumber - 1; // may be < invoiceFrom if nothing was sold this period
    const periodVoids = allVoids.filter(v =>
        typeof v.invoiceNumberValue === 'number' && v.invoiceNumberValue >= invoiceFrom && v.invoiceNumberValue <= invoiceTo
    );
    const beginningAGT = state.baselineAGT;
    const endingAGT = state.agt;
    const record = {
        id: genId('ZREAD'),
        zCounter: state.zCounter + 1,
        beginningAGT: round2(beginningAGT),
        endingAGT: round2(endingAGT),
        netSales: round2(endingAGT - beginningAGT),
        invoiceFrom,
        invoiceTo,
        invoiceCount: Math.max(0, invoiceTo - invoiceFrom + 1),
        voidCount: periodVoids.length,
        voidAmount: round2(periodVoids.reduce((s, v) => s + (parseFloat(v.amount) || 0), 0)),
        resetCounterAtReading: state.resetCounter,
        authorizedBy: authorizedBy || null,
        performedAt: nowIso()
    };
    // Offline-queued sales get their invoice number when they SYNC, not when they were rung up. Report how many sales of
    // this period were offline sales and how many of them were rung up BEFORE the period started, so the Z-Reading
    // explains why they are counted here. Never allowed to break the Z-Reading itself.
    record.offlineSyncedCount = 0;
    record.lateSyncedCount = 0;
    record.lateSyncedAmount = 0;
    try {
        const startMs = state.lastZReadingAt ? new Date(state.lastZReadingAt).getTime() : NaN;
        const offlineSummary = summarizeOfflineSalesInInvoiceRange(invoiceFrom, invoiceTo, startMs);
        record.offlineSyncedCount = offlineSummary.offlineSyncedCount;
        record.lateSyncedCount = offlineSummary.lateSyncedCount;
        record.lateSyncedAmount = offlineSummary.lateSyncedAmount;
    } catch (e) {
        console.error('Could not compute the offline-sale summary for the Z-Reading:', e.message);
    }
    state.zCounter += 1;
    state.baselineAGT = endingAGT;
    state.invoiceNumberAtPeriodStart = state.nextInvoiceNumber;
    state.lastZReadingAt = record.performedAt;
    // ATOMICITY FIX: dati magkahiwalay na write ang state at ang history — kapag pumalya sa gitna, umusad na ang
    // Z-counter/baseline pero walang Z-Reading record (nawawalang report sa BIR audit). Iisang transaction na ngayon.
    const history = readData(MODULE_ZHISTORY, []);
    history.unshift(record);
    runDatabaseTransaction([
        { module: MODULE_STATE, data: state },
        { module: MODULE_ZHISTORY, data: history }
    ]);
    return record;
}

function getZReadingHistory(limit) {
    const history = readData(MODULE_ZHISTORY, []);
    return typeof limit === 'number' ? history.slice(0, limit) : history;
}

// Zeroes the AGT display and bumps resetCounter. Does NOT touch invoice numbering.
// The caller (route) is responsible for requiring an admin password before this runs.
function resetAGT({ authorizedBy, reason, archiveId, ticketId } = {}) {
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
        const err = new Error('A reason is required to reset the Accumulated Grand Total.');
        err.code = 'REASON_REQUIRED';
        throw err;
    }
    const state = getBirState();
    const record = {
        id: genId('BIRRESET'),
        resetCounter: state.resetCounter + 1,
        previousAGT: round2(state.agt),
        previousBaselineAGT: round2(state.baselineAGT),
        reason: cleanReason,
        authorizedBy: authorizedBy || null,
        archiveId: archiveId || null,
        ticketId: ticketId || null,
        performedAt: nowIso()
    };
    state.resetCounter += 1;
    state.agt = 0;
    state.baselineAGT = 0;
    state.lastResetAt = record.performedAt;
    // ATOMICITY FIX: state + reset history sa iisang transaction (dati kapag pumalya sa gitna, na-zero na ang AGT
    // pero walang audit record ng reset).
    const history = readData(MODULE_RESET_HISTORY, []);
    history.unshift(record);
    runDatabaseTransaction([
        { module: MODULE_STATE, data: state },
        { module: MODULE_RESET_HISTORY, data: history }
    ]);
    return record;
}

// Wipes the BIR compliance DATA (AGT, baseline, void log, Z-Reading history, AGT reset history) for the System
// Hard Reset. It is NOT the same as resetAGT(): resetAGT() is an audited, reason-required operation on the AGT only.
//
// LEGAL-CONTINUITY RULES (changed): issued invoice / OR numbers must never be issued twice, the Z-Counter must keep
// counting, and the reset counter must only ever go UP. So this keeps the invoice numbering (nextInvoiceNumber) and
// the Z-Counter exactly where they were, starts a fresh reading period at the current invoice number, and bumps
// resetCounter by one. The wiped history is NOT lost: the caller must have written the sealed retention archive
// (bir-retention.js) first, and one audit record that points at that archive is left in the reset history.
//
// All four modules are written inside ONE SQLite transaction, so a failure rolls everything back and leaves the BIR
// data exactly as it was (runDatabaseTransaction throws on failure - the caller must not treat a throw as success).
// buildBirResetPlan() returns { modules, auditRecord }; resetAllBirData() writes it and returns the audit record.
function buildBirResetPlan({ authorizedBy, reason, archiveId, ticketId } = {}) {
    const prev = getBirState();
    const performedAt = nowIso();
    const fresh = defaultState();
    fresh.nextInvoiceNumber = prev.nextInvoiceNumber;
    fresh.invoiceNumberAtPeriodStart = prev.nextInvoiceNumber;
    fresh.zCounter = prev.zCounter;
    fresh.lastZReadingAt = prev.lastZReadingAt;
    fresh.resetCounter = (parseInt(prev.resetCounter, 10) || 0) + 1;
    fresh.lastResetAt = performedAt;
    const auditRecord = {
        id: genId('BIRRESET'),
        type: 'HARD_RESET',
        resetCounter: fresh.resetCounter,
        previousAGT: round2(prev.agt),
        previousBaselineAGT: round2(prev.baselineAGT),
        reason: String(reason || 'System Hard Reset').trim() || 'System Hard Reset',
        authorizedBy: authorizedBy || null,
        archiveId: archiveId || null,
        ticketId: ticketId || null,
        performedAt
    };
    return {
        auditRecord,
        modules: [
            { module: MODULE_STATE, data: fresh },
            { module: MODULE_VOIDS, data: [] },
            { module: MODULE_ZHISTORY, data: [] },
            { module: MODULE_RESET_HISTORY, data: [auditRecord] }
        ]
    };
}
// Builds the BIR wipe WITHOUT writing anything. The System Hard Reset adds plan.modules to its own single SQLite
// transaction, so the BIR wipe and the main reset succeed or fail together (no half-reset state).
function resetAllBirData(options) {
    const plan = buildBirResetPlan(options);
    runDatabaseTransaction(plan.modules);
    return plan.auditRecord;
}

// Cheap fingerprint of the BIR data (counters + record counts). The System Hard Reset takes it when the backup
// snapshot is captured and compares it again right before wiping, so a sale/void/Z-Reading that happened while
// the backup email was still being sent is detected instead of being silently deleted without being in the backup.
function getBirSignature() {
    const st = getBirState();
    const transactions = readData(MODULE_TRANSACTIONS, []);
    const transactionHash = crypto.createHash('sha256');
    if (Array.isArray(transactions)) {
        for (const transaction of transactions) transactionHash.update(JSON.stringify(transaction)).update('\n');
    }
    return [
        st.agt, st.nextInvoiceNumber, st.zCounter, st.resetCounter,
        readData(MODULE_VOIDS, []).length,
        readData(MODULE_ZHISTORY, []).length,
        readData(MODULE_RESET_HISTORY, []).length,
        Array.isArray(transactions) ? transactions.length : 0,
        transactionHash.digest('hex')
    ].join('|');
}

function getVoidLog(limit) {
    const voids = readData(MODULE_VOIDS, []);
    return typeof limit === 'number' ? voids.slice(0, limit) : voids;
}

function getResetHistory(limit) {
    const history = readData(MODULE_RESET_HISTORY, []);
    return typeof limit === 'number' ? history.slice(0, limit) : history;
}

// -----------------------------------------------------------------------------
// Reporting / exports
// -----------------------------------------------------------------------------

function getTransactionsInManilaRange(fromDateStr, toDateStr) {
    const all = readData(MODULE_TRANSACTIONS, []);
    return all
        .filter(t => isWithinManilaRange(transactionIso(t), fromDateStr, toDateStr))
        .slice()
        .sort((a, b) => {
            const av = typeof a.birInvoiceNumberValue === 'number' ? a.birInvoiceNumberValue : 0;
            const bv = typeof b.birInvoiceNumberValue === 'number' ? b.birInvoiceNumberValue : 0;
            return av - bv;
        });
}

function getVoidsInManilaRange(fromDateStr, toDateStr) {
    const all = readData(MODULE_VOIDS, []);
    return all
        .filter(v => isWithinManilaRange(v.voidedAt, fromDateStr, toDateStr))
        .slice()
        .sort((a, b) => (a.invoiceNumberValue || 0) - (b.invoiceNumberValue || 0));
}

function classify(tx) {
    // subtotalBeforeTax already INCLUDES the VAT when prices are VAT-inclusive (tx.taxInclusive),
    // so the VATable base is subtotal - VAT in that case; when VAT is added on top it is the subtotal itself.
    const subtotal = parseFloat(tx.subtotalBeforeTax) || 0;
    const vatAmount = round2(tx.vatExempt ? 0 : (parseFloat(tx.taxAmount) || 0));
    const chargesVat = !tx.vatExempt && (parseFloat(tx.taxRate) || 0) > 0;
    const netOfVat = round2(tx.taxInclusive ? subtotal - vatAmount : subtotal);
    // Sales with no VAT charged (Senior/PWD exempt, or a store/rate with VAT off) go to the VAT-exempt column
    // so the columns always add up to Net Sales. Confirm this mapping with your BIR consultant for non-VAT stores.
    const vatExemptSales = chargesVat ? 0 : round2(netOfVat);
    const zeroRatedSales = 0; // not tracked anywhere in this codebase yet — see module header note.
    const vatableSales = chargesVat ? netOfVat : 0;
    const discountAmount = round2(tx.discount && typeof tx.discount === 'object' ? (parseFloat(tx.discount.amount) || 0) : (parseFloat(tx.discount) || 0));
    const netSales = round2(parseFloat(tx.total) || 0);
    return { grossSales: round2(netOfVat + discountAmount), vatableSales, vatExemptSales, zeroRatedSales, vatAmount, discountAmount, netSales };
}

// Plaintext e-Journal covering [fromDateStr, toDateStr] (Manila calendar dates, inclusive).
// Sales and voids are interleaved in invoice-number order so the sequence — and any gaps
// left by a void — reads the way a BIR examiner expects a journal tape to read.
function exportEJournal({ fromDateStr, toDateStr, context = {} }) {
    const sales = getTransactionsInManilaRange(fromDateStr, toDateStr);
    const voids = getVoidsInManilaRange(fromDateStr, toDateStr);
    const entries = []
        .concat(sales.map(t => ({ kind: 'SALE', invoiceNumberValue: t.birInvoiceNumberValue || 0, tx: t })))
        .concat(voids.map(v => ({ kind: 'VOID', invoiceNumberValue: v.invoiceNumberValue || 0, v })))
        .sort((a, b) => a.invoiceNumberValue - b.invoiceNumberValue || (a.kind === 'VOID' ? 1 : -1));

    const lines = [];
    lines.push('='.repeat(64));
    lines.push((context.storeName || 'STORE NAME NOT SET').toUpperCase());
    if (context.storeAddress) lines.push(context.storeAddress);
    if (context.tin) lines.push(`TIN: ${context.tin}`);
    lines.push('E-JOURNAL');
    lines.push(`Period: ${fromDateStr} to ${toDateStr} (Asia/Manila)`);
    lines.push(`Generated: ${manilaDateTimeDisplay(nowIso())}`);
    lines.push('='.repeat(64));
    lines.push('');

    let periodGross = 0;
    let periodVoidAmount = 0;
    for (const e of entries) {
        if (e.kind === 'SALE') {
            const t = e.tx;
            const c = classify(t);
            lines.push(`${t.birInvoiceNumber || '(no invoice #)'}  ${manilaDateTimeDisplay(transactionIso(t))}`);
            if (t.offlineSale) {
                lines.push(`  *** OFFLINE SALE: rung up ${manilaDateTimeDisplay(t.soldAt || transactionIso(t))}; invoice number assigned on sync ${manilaDateTimeDisplay(t.syncedAt || t.createdAt)} ***`);
            }
            lines.push(`  Cashier: ${t.cashier || ''}`);
            (t.items || []).forEach(it => {
                lines.push(`  ${String(it.quantity)} x ${it.name}  @ ${(parseFloat(it.price) || 0).toFixed(2)}`);
            });
            lines.push(`  Gross: ${c.grossSales.toFixed(2)}  Discount: ${c.discountAmount.toFixed(2)}  VAT: ${c.vatAmount.toFixed(2)}  Net: ${c.netSales.toFixed(2)}`);
            lines.push(`  Payment: ${t.method || (Array.isArray(t.payments) ? t.payments.map(p => p.method).join('+') : '')}`);
            lines.push('-'.repeat(64));
            periodGross = round2(periodGross + c.netSales);
        } else {
            const v = e.v;
            lines.push(`${v.invoiceNumber || '(no invoice #)'}  ${manilaDateTimeDisplay(v.voidedAt)}  *** VOID ***`);
            lines.push(`  Original Transaction: ${v.transactionId}  Amount: ${(parseFloat(v.amount) || 0).toFixed(2)}`);
            lines.push(`  Voided by: ${v.voidedBy || ''}  Reason: ${v.reason || ''}`);
            lines.push('-'.repeat(64));
            periodVoidAmount = round2(periodVoidAmount + (parseFloat(v.amount) || 0));
        }
    }
    lines.push('');
    lines.push(`Period Net Sales: ${periodGross.toFixed(2)}`);
    lines.push(`Period Voids: ${voids.length} (${periodVoidAmount.toFixed(2)})`);
    const state = getBirState();
    lines.push(`Current Accumulated Grand Total (AGT): ${state.agt.toFixed(2)}`);
    lines.push('='.repeat(64));
    return lines.join('\n');
}

function csvEscape(val) {
    const s = String(val === null || val === undefined ? '' : val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

// BIR-style Sales Book CSV for [fromDateStr, toDateStr] (Manila calendar dates, inclusive).
function exportSalesBookCsv({ fromDateStr, toDateStr }) {
    const sales = getTransactionsInManilaRange(fromDateStr, toDateStr);
    const voids = getVoidsInManilaRange(fromDateStr, toDateStr);
    const voidedByInvoiceValue = new Map(voids.map(v => [v.invoiceNumberValue, v]));
    const header = ['Date', 'Invoice No.', 'Customer', 'Gross Sales', 'VAT-Exempt Sales', 'Zero-Rated Sales', 'VATable Sales', 'VAT Amount', 'Discount', 'Net Sales', 'Payment Method', 'Cashier', 'Status', 'Notes'];
    const rows = [header];
    sales.forEach(t => {
        const c = classify(t);
        rows.push([
            manilaDateStr(transactionIso(t)) || '',
            t.birInvoiceNumber || '',
            t.customerName || 'Walk-in',
            c.grossSales.toFixed(2),
            c.vatExemptSales.toFixed(2),
            c.zeroRatedSales.toFixed(2),
            c.vatableSales.toFixed(2),
            c.vatAmount.toFixed(2),
            c.discountAmount.toFixed(2),
            c.netSales.toFixed(2),
            t.method || (Array.isArray(t.payments) ? t.payments.map(p => p.method).join('+') : ''),
            t.cashier || '',
            'SALE',
            t.offlineSale ? `Offline sale; invoice no. assigned on sync ${manilaDateTimeDisplay(t.syncedAt || t.createdAt)}` : ''
        ]);
    });
    voids.forEach(v => {
        rows.push([
            manilaDateStr(v.voidedAt) || '', v.invoiceNumber || '', '', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '', v.voidedBy || '', `VOID (${v.reason || ''})`, ''
        ]);
    });
    return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

// EIS-ready JSON payload for [fromDateStr, toDateStr]. This only PREPARES the data —
// it does not transmit anything to the BIR. See module header note.
function exportEIS({ fromDateStr, toDateStr, context = {} }) {
    const sales = getTransactionsInManilaRange(fromDateStr, toDateStr);
    const voids = getVoidsInManilaRange(fromDateStr, toDateStr);
    return {
        note: 'EIS-ready export only. Live transmission to the BIR Electronic Invoicing/Receipting System requires a direct EIS integration or an accredited service provider.',
        seller: { name: context.storeName || null, address: context.storeAddress || null, tin: context.tin || null },
        period: { fromDateStr, toDateStr, timezone: 'Asia/Manila' },
        generatedAt: nowIso(),
        invoices: sales.map(t => {
            const c = classify(t);
            return {
                invoiceNumber: t.birInvoiceNumber || null,
                dateIssued: manilaDateTimeDisplay(transactionIso(t)),
                buyerName: t.customerName || 'Walk-in',
                lineItems: (t.items || []).map(it => ({
                    description: it.name,
                    quantity: it.quantity,
                    unitPrice: round2(it.price),
                    amount: round2((parseFloat(it.price) || 0) * (parseFloat(it.quantity) || 0))
                })),
                vatableSales: c.vatableSales,
                vatExemptSales: c.vatExemptSales,
                zeroRatedSales: c.zeroRatedSales,
                vatAmount: c.vatAmount,
                discountAmount: c.discountAmount,
                totalAmount: c.netSales,
                paymentMethod: t.method || (Array.isArray(t.payments) ? t.payments.map(p => p.method).join('+') : ''),
                cashier: t.cashier || null,
                offlineSale: !!t.offlineSale,
                soldAt: t.offlineSale ? manilaDateTimeDisplay(t.soldAt || transactionIso(t)) : null,
                syncedAt: t.offlineSale ? manilaDateTimeDisplay(t.syncedAt || t.createdAt) : null,
                status: 'issued'
            };
        }),
        voids: voids.map(v => ({
            invoiceNumber: v.invoiceNumber || null,
            originalTransactionId: v.transactionId,
            voidedAt: manilaDateTimeDisplay(v.voidedAt),
            voidedBy: v.voidedBy || null,
            reason: v.reason || null,
            amount: round2(v.amount)
        }))
    };
}

module.exports = {
    BIR_MODULE_NAMES,
    resetAllBirData,
    buildBirResetPlan,
    getBirSignature,
    getBirState,
    saveBirState,
    formatInvoiceNumber,
    onTransactionCommitted,
    onTransactionVoided,
    performZReading,
    getZReadingHistory,
    resetAGT,
    getResetHistory,
    getVoidLog,
    getTransactionsInManilaRange,
    getVoidsInManilaRange,
    manilaDateStr,
    exportEJournal,
    exportSalesBookCsv,
    exportEIS,
    // exported for tests
    _round2: round2
};
