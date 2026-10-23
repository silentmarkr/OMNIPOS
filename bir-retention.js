// bir-retention.js
// -----------------------------------------------------------------------------
// BIR record-retention safeguards for OmniPOS.
//
// WHY THIS FILE EXISTS
// BIR books/records (invoices, Z-Readings, AGT, void log, the sales that carry
// BIR invoice numbers) must be kept and producible on audit for the legally
// required retention period. A client who can wipe them from the app on their own
// puts the CLIENT in breach of record-keeping rules and exposes the DEVELOPER
// who shipped the "delete" button. This module closes that gap with four layers:
//
//  1. DEVELOPER PASS KEY  - every BIR reset (System Hard Reset when BIR records
//     exist, and the AGT reset) needs a one-time pass key that only the developer
//     can sign (Ed25519, same RELAY key pair that already signs feature tokens).
//     The flow is challenge/response and works fully OFFLINE:
//         client app  --request code-->  developer (RELAY admin)  --pass key--> client app
//     A pass key is bound to: this installation, this device, the exact action
//     (purpose + whether BIR counters are wiped), and the one request nonce the
//     app generated. It expires, and it can be used exactly once.
//  2. SEALED RETENTION VAULT - right before anything is deleted, a compressed
//     copy of all BIR records is written to <database>/bir-retention-vault/ with a
//     SHA-256 fingerprint, set read-only, and chained into a tamper-evident
//     ledger. The vault is NEVER touched by Hard Reset / restore / any API; the
//     app has no delete function for it. (After the retention period only the
//     owner may remove it manually, with advice from their accountant.)
//  3. AUDIT LEDGER - every archive and every pass-key use is appended to a
//     hash-chained ledger (each line commits to the one before), so edited or
//     removed lines are detectable.
//  4. RESTORE GUARD - restoring an older backup can no longer roll the BIR
//     counters (invoice number, Z counter, reset counter, logs) backwards.
//
// This is record-keeping tooling, not legal advice. Confirm the retention period
// and reset rules with a BIR consultant / accountant.
//
// The module is a factory so it can be unit tested without the real database:
//   require('./bir-retention')({ readData, vaultDir, birCompliance, publicKey })
// -----------------------------------------------------------------------------
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PURPOSE_HARD_RESET = 'bir-hard-reset';
const PURPOSE_AGT_RESET = 'bir-agt-reset';
const ALLOWED_PURPOSES = Object.freeze([PURPOSE_HARD_RESET, PURPOSE_AGT_RESET]);

const REQUEST_PREFIX = 'BIRRQ1.';
const PASSKEY_PREFIX = 'BIRPK1.';

const HOUR_MS = 60 * 60 * 1000;
const REQUEST_TTL_MS = 24 * HOUR_MS;          // how long a request code stays valid
const REQUEST_REUSE_MIN_LEFT_MS = HOUR_MS;    // an open request is re-shown only while it has > 1h left
const MAX_PASSKEY_VALIDITY_MS = 4 * HOUR_MS;  // developer-issued keys can never live longer than this
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_PENDING_REQUESTS = 10;
const MAX_INPUT_LENGTH = 8192;

// Conservative default. Philippine books-of-account / CRM-POS record retention is commonly cited as 10 years;
// the archive is stamped with this so the owner can see when it may (manually) be released. Verify with an accountant.
const RETENTION_YEARS = 10;

// The single place that defines what the developer signs. RELAY/bir-passkey.js MUST build the identical string
// (same keys, same order) or every signature check fails. Covered by the cross-check test.
function canonicalTicketString(p) {
    return JSON.stringify({
        installationId: p.installationId,
        deviceTag: p.deviceTag,
        purpose: p.purpose,
        nonce: p.nonce,
        includeBirData: p.includeBirData,
        reference: p.reference,
        ticketId: p.ticketId,
        issuedAt: p.issuedAt,
        expiresAt: p.expiresAt
    });
}

// DOMAIN SEPARATION: what the developer signs is this label + the canonical string, so a signature made for any other
// purpose with the same RELAY key (feature tokens, licences) can never be replayed as a BIR pass key.
// MUST be identical to SIGNING_DOMAIN in RELAY/bir-passkey.js.
const SIGNING_DOMAIN = 'omnipos-bir-passkey-v1\n';
function signedMessage(p) {
    return Buffer.from(SIGNING_DOMAIN + canonicalTicketString(p), 'utf8');
}

function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function errorWith(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

module.exports = function createBirRetention(deps) {
    const { readData, vaultDir, birCompliance, publicKey } = deps || {};
    if (typeof readData !== 'function') throw new Error('bir-retention: readData is required');
    if (!vaultDir || typeof vaultDir !== 'string') throw new Error('bir-retention: vaultDir is required');
    if (!birCompliance || typeof birCompliance.getBirState !== 'function') throw new Error('bir-retention: birCompliance is required');
    if (!publicKey) throw new Error('bir-retention: publicKey is required');

    const archivesDir = path.join(vaultDir, 'archives');
    const ledgerFile = path.join(vaultDir, 'ledger.jsonl');
    const stateFile = path.join(vaultDir, 'passkey-state.json');
    const reservedTickets = new Set(); // in-memory only: stops two reset jobs using one key at the same moment

    function ensureDirs() {
        fs.mkdirSync(archivesDir, { recursive: true });
    }

    // ---- small durable-file helpers -----------------------------------------------------------------------------
    function atomicWrite(file, data, mode) {
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        const fd = fs.openSync(tmp, 'w', mode || 0o600);
        try {
            fs.writeSync(fd, data);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
    }

    function freshState() {
        return { v: 1, pending: [], consumed: [] };
    }

    // Pass-key bookkeeping (pending requests + used keys). A corrupt file is quarantined, never silently trusted:
    // with the pending list gone every previously issued key is dead (no matching request), so nothing can be replayed.
    function loadState() {
        let raw;
        try {
            raw = fs.readFileSync(stateFile, 'utf8');
        } catch (err) {
            if (err && err.code === 'ENOENT') return freshState();
            throw err;
        }
        try {
            const parsed = JSON.parse(raw);
            if (!isPlainObject(parsed) || !Array.isArray(parsed.pending) || !Array.isArray(parsed.consumed)) throw new Error('bad shape');
            return { v: 1, pending: parsed.pending, consumed: parsed.consumed };
        } catch (_e) {
            try { fs.renameSync(stateFile, `${stateFile}.corrupt-${Date.now()}`); } catch (_e2) { /* keep going with a fresh state */ }
            return freshState();
        }
    }

    function saveState(state) {
        ensureDirs();
        atomicWrite(stateFile, JSON.stringify(state));
    }

    // ---- hash-chained ledger ------------------------------------------------------------------------------------
    function entryHash(prevHash, entry) {
        const body = JSON.stringify({ seq: entry.seq, id: entry.id, type: entry.type, at: entry.at, payload: entry.payload });
        return sha256Hex(`${prevHash}\n${body}`);
    }

    function readLedgerRaw() {
        let raw;
        try {
            raw = fs.readFileSync(ledgerFile, 'utf8');
        } catch (err) {
            if (err && err.code === 'ENOENT') return [];
            throw err;
        }
        const lines = raw.split('\n').filter((l) => l.trim() !== '');
        return lines.map((line) => {
            try { return JSON.parse(line); } catch (_e) { return { _unreadable: true, _line: line }; }
        });
    }

    function appendLedger(type, payload, now) {
        ensureDirs();
        const entries = readLedgerRaw().filter((e) => !e._unreadable && typeof e.hash === 'string');
        const last = entries.length ? entries[entries.length - 1] : null;
        const entry = {
            seq: last ? (Number(last.seq) || 0) + 1 : 1,
            id: `BIRLEDGER-${now}-${crypto.randomBytes(3).toString('hex')}`,
            type,
            at: new Date(now).toISOString(),
            payload
        };
        const prevHash = last ? last.hash : 'GENESIS';
        entry.prevHash = prevHash;
        entry.hash = entryHash(prevHash, entry);
        const fd = fs.openSync(ledgerFile, 'a', 0o600);
        try {
            fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        return entry;
    }

    // A pass key counts as used when EITHER the state file OR the hash-chained ledger says so. Deleting or rewriting
    // passkey-state.json alone therefore cannot make an already-used key work again.
    function ledgerHasConsumed(ticketId, nonce) {
        return readLedgerRaw().some((e) => e && !e._unreadable && e.type === 'PASSKEY_CONSUMED' && e.payload &&
            (e.payload.ticketId === ticketId || e.payload.nonce === nonce));
    }

    // ---- BIR data facts -----------------------------------------------------------------------------------------
    function isBirTransaction(tx) {
        return !!tx && typeof tx === 'object' && (typeof tx.birInvoiceNumberValue === 'number' || (typeof tx.birInvoiceNumber === 'string' && tx.birInvoiceNumber !== ''));
    }

    function listLen(moduleName) {
        const v = readData(moduleName, []);
        return Array.isArray(v) ? v.length : 0;
    }

    // True when the store holds anything a BIR audit could ask for.
    function birRecordsExist() {
        const st = birCompliance.getBirState();
        if ((Number(st.nextInvoiceNumber) || 1) > 1 || (Number(st.zCounter) || 0) > 0 || (Number(st.resetCounter) || 0) > 0 || (parseFloat(st.agt) || 0) > 0) return true;
        if (listLen('birVoids') > 0 || listLen('birZReadingHistory') > 0 || listLen('birResetHistory') > 0) return true;
        const tx = readData('transactions', []);
        return Array.isArray(tx) && tx.some(isBirTransaction);
    }

    // A reading period is "open" while invoices were issued after the last Z-Reading.
    function hasOpenReadingPeriod() {
        const st = birCompliance.getBirState();
        return (Number(st.nextInvoiceNumber) || 1) > (Number(st.invoiceNumberAtPeriodStart) || 1);
    }

    function buildSummary(now) {
        const st = birCompliance.getBirState();
        const tx = readData('transactions', []);
        const ledger = readLedgerRaw().filter((e) => !e._unreadable && e.type === 'ARCHIVE');
        return {
            nextInvoiceNumber: Number(st.nextInvoiceNumber) || 1,
            zCounter: Number(st.zCounter) || 0,
            resetCounter: Number(st.resetCounter) || 0,
            agt: Math.round((parseFloat(st.agt) || 0) * 100) / 100,
            birTransactionCount: Array.isArray(tx) ? tx.filter(isBirTransaction).length : 0,
            voidCount: listLen('birVoids'),
            openReadingPeriod: hasOpenReadingPeriod(),
            vaultArchives: ledger.length,
            generatedAt: new Date(now || Date.now()).toISOString()
        };
    }

    // ---- 1. request code (app -> developer) ---------------------------------------------------------------------
    function buildRequestCode(core, summary) {
        const body = {
            v: 1,
            installationId: core.installationId,
            deviceTag: core.deviceTag,
            purpose: core.purpose,
            nonce: core.nonce,
            includeBirData: core.includeBirData,
            storeName: core.storeName || '',
            createdAt: core.createdAt,
            expiresAt: core.expiresAt,
            summary
        };
        return REQUEST_PREFIX + Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    }

    // Creates (or re-shows) the one open request for this exact action. Returns the code the client sends to the developer.
    // forceNew: true drops the open request(s) of this exact action first and makes a brand-new one (new nonce). The reset dialog
    // uses it when the developer's pass key was lost or expired unused: RELAY signs each request only once, so a fresh request
    // is the only way to get another key. Any pass key issued for a dropped request stops working.
    function createResetRequest({ installationId, deviceTag, purpose, includeBirData, storeName, now, forceNew } = {}) {
        const ts = typeof now === 'number' ? now : Date.now();
        if (!ALLOWED_PURPOSES.includes(purpose)) throw errorWith('BIR_BAD_PURPOSE', 'Unknown BIR reset purpose.');
        if (typeof installationId !== 'string' || !installationId.trim()) throw errorWith('BIR_NO_INSTALLATION', 'This installation has no ID yet, so a pass key cannot be requested.');
        const wipe = purpose === PURPOSE_HARD_RESET ? includeBirData === true : false;
        const tag = String(deviceTag || 'unknown').slice(0, 64);
        const state = loadState();
        state.pending = state.pending.filter((p) => p && typeof p.expiresAt === 'number' && p.expiresAt > ts);
        const sameAction = (p) => p.installationId === installationId && p.deviceTag === tag && p.purpose === purpose && p.includeBirData === wipe;
        if (forceNew === true) state.pending = state.pending.filter((p) => !sameAction(p));
        let core = state.pending.find((p) => sameAction(p) && (p.expiresAt - ts) > REQUEST_REUSE_MIN_LEFT_MS);
        let reused = true;
        if (!core) {
            reused = false;
            core = {
                installationId,
                deviceTag: tag,
                purpose,
                includeBirData: wipe,
                nonce: crypto.randomBytes(16).toString('hex'),
                storeName: String(storeName || '').slice(0, 120),
                createdAt: ts,
                expiresAt: ts + REQUEST_TTL_MS
            };
            state.pending.push(core);
            while (state.pending.length > MAX_PENDING_REQUESTS) state.pending.shift();
        }
        saveState(state);
        return {
            requestCode: buildRequestCode(core, buildSummary(ts)),
            nonce: core.nonce,
            expiresAt: core.expiresAt,
            reused
        };
    }

    // Read-only: the open request with this nonce (as created by createResetRequest), or null when it is gone, expired, or belongs to
    // another installation. The reset dialog polls RELAY with this code; everything about the action comes from here, not from the browser.
    function getOpenRequest({ installationId, nonce, now } = {}) {
        const ts = typeof now === 'number' ? now : Date.now();
        if (typeof installationId !== 'string' || !installationId || typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) return null;
        const state = loadState();
        const core = state.pending.find((p) => p && p.nonce === nonce && p.installationId === installationId && typeof p.expiresAt === 'number' && p.expiresAt > ts);
        if (!core) return null;
        return {
            requestCode: buildRequestCode(core, buildSummary(ts)),
            nonce: core.nonce,
            deviceTag: core.deviceTag,
            purpose: core.purpose,
            includeBirData: core.includeBirData,
            expiresAt: core.expiresAt
        };
    }

    // ---- 2. pass key verification (developer -> app) ------------------------------------------------------------
    function fail(code, message) {
        return { ok: false, code, message };
    }

    function verifyPassKey(passKeyInput, { installationId, deviceTag, purpose, includeBirData, now } = {}) {
        const ts = typeof now === 'number' ? now : Date.now();
        if (typeof passKeyInput !== 'string') return fail('BIR_PASSKEY_REQUIRED', 'A developer pass key is required for this BIR reset.');
        const compact = passKeyInput.replace(/\s+/g, '');
        if (!compact) return fail('BIR_PASSKEY_REQUIRED', 'A developer pass key is required for this BIR reset.');
        if (compact.length > MAX_INPUT_LENGTH || !compact.startsWith(PASSKEY_PREFIX)) return fail('BIR_PASSKEY_MALFORMED', 'That is not a valid pass key. Paste the full key exactly as the developer sent it.');
        let parsed;
        try {
            parsed = JSON.parse(Buffer.from(compact.slice(PASSKEY_PREFIX.length), 'base64url').toString('utf8'));
        } catch (_e) {
            return fail('BIR_PASSKEY_MALFORMED', 'That is not a valid pass key. Paste the full key exactly as the developer sent it.');
        }
        if (!isPlainObject(parsed) || !isPlainObject(parsed.payload) || typeof parsed.signature !== 'string') {
            return fail('BIR_PASSKEY_MALFORMED', 'That is not a valid pass key. Paste the full key exactly as the developer sent it.');
        }
        const p = parsed.payload;
        const shapeOk =
            typeof p.installationId === 'string' && typeof p.deviceTag === 'string' && typeof p.purpose === 'string' &&
            typeof p.nonce === 'string' && typeof p.includeBirData === 'boolean' && typeof p.reference === 'string' &&
            typeof p.ticketId === 'string' && Number.isFinite(p.issuedAt) && Number.isFinite(p.expiresAt) &&
            /^[0-9a-f]{32}$/.test(p.nonce) && p.ticketId.length > 0 && p.ticketId.length <= 80 && p.reference.length <= 160;
        if (!shapeOk) return fail('BIR_PASSKEY_MALFORMED', 'That is not a valid pass key. Paste the full key exactly as the developer sent it.');

        let signatureOk = false;
        try {
            signatureOk = crypto.verify(null, signedMessage(p), publicKey, Buffer.from(parsed.signature, 'base64'));
        } catch (_e) {
            signatureOk = false;
        }
        if (!signatureOk) return fail('BIR_PASSKEY_INVALID', 'This pass key was not issued by the developer (signature check failed).');

        const wantWipe = purpose === PURPOSE_HARD_RESET ? includeBirData === true : false;
        if (!ALLOWED_PURPOSES.includes(purpose) || p.purpose !== purpose) return fail('BIR_PASSKEY_WRONG_ACTION', 'This pass key was issued for a different BIR action.');
        if (p.includeBirData !== wantWipe) return fail('BIR_PASSKEY_WRONG_ACTION', 'This pass key was issued for a different reset scope (BIR counters included or not). Request a new key for exactly what you are about to do.');
        if (p.installationId !== installationId) return fail('BIR_PASSKEY_WRONG_DEVICE', 'This pass key was issued for a different installation.');
        if (p.deviceTag !== String(deviceTag || 'unknown').slice(0, 64)) return fail('BIR_PASSKEY_WRONG_DEVICE', 'This pass key was issued for a different device.');
        if (p.issuedAt > ts + CLOCK_SKEW_MS) return fail('BIR_PASSKEY_INVALID', 'This pass key is dated in the future. Check this device\'s clock.');
        if (p.expiresAt <= ts) return fail('BIR_PASSKEY_EXPIRED', 'This pass key has expired. Request a new one from the developer.');
        if (p.expiresAt - p.issuedAt > MAX_PASSKEY_VALIDITY_MS + CLOCK_SKEW_MS) return fail('BIR_PASSKEY_INVALID', 'This pass key has an invalid validity period.');

        const state = loadState();
        let usedInLedger;
        try {
            usedInLedger = ledgerHasConsumed(p.ticketId, p.nonce);
        } catch (_ledgerErr) {
            // Fail closed: if the used-key ledger cannot be read, no key is accepted.
            return fail('BIR_VAULT_UNREADABLE', 'The BIR retention ledger on this device could not be read, so the pass key cannot be checked. Contact the developer.');
        }
        if (usedInLedger || state.consumed.some((c) => c && (c.ticketId === p.ticketId || c.nonce === p.nonce))) {
            return fail('BIR_PASSKEY_ALREADY_USED', 'This pass key was already used. Each key works only once — request a new one.');
        }
        const request = state.pending.find((r) =>
            r && r.nonce === p.nonce && r.installationId === p.installationId && r.deviceTag === p.deviceTag &&
            r.purpose === p.purpose && r.includeBirData === p.includeBirData && typeof r.expiresAt === 'number' && r.expiresAt > ts
        );
        if (!request) return fail('BIR_PASSKEY_NO_REQUEST', 'No matching open request was found for this key on this device. Generate a new request code, send it to the developer, and use the key issued for that code.');
        if (reservedTickets.has(p.ticketId)) return fail('BIR_PASSKEY_IN_USE', 'This pass key is already being used by a reset that is in progress.');

        return { ok: true, ticket: { ticketId: p.ticketId, nonce: p.nonce, reference: p.reference, purpose: p.purpose, includeBirData: p.includeBirData, issuedAt: p.issuedAt, expiresAt: p.expiresAt } };
    }

    function reservePassKey(ticketId) {
        if (typeof ticketId !== 'string' || !ticketId || reservedTickets.has(ticketId)) return false;
        reservedTickets.add(ticketId);
        return true;
    }

    function releasePassKey(ticketId) {
        reservedTickets.delete(ticketId);
    }

    // Burns the key permanently (written to disk before the caller deletes anything).
    function consumePassKey(ticket, { authorizedBy, archiveId, now } = {}) {
        const ts = typeof now === 'number' ? now : Date.now();
        const state = loadState();
        if (ledgerHasConsumed(ticket.ticketId, ticket.nonce) || state.consumed.some((c) => c && (c.ticketId === ticket.ticketId || c.nonce === ticket.nonce))) {
            throw errorWith('BIR_PASSKEY_ALREADY_USED', 'This pass key was already used.');
        }
        state.pending = state.pending.filter((r) => r && r.nonce !== ticket.nonce);
        const record = {
            ticketId: ticket.ticketId,
            nonce: ticket.nonce,
            purpose: ticket.purpose,
            includeBirData: ticket.includeBirData,
            reference: ticket.reference,
            issuedAt: ticket.issuedAt,
            expiresAt: ticket.expiresAt,
            consumedAt: ts,
            authorizedBy: authorizedBy || null,
            archiveId: archiveId || null
        };
        state.consumed.push(record);
        saveState(state);
        try {
            appendLedger('PASSKEY_CONSUMED', record, ts);
        } catch (ledgerErr) {
            // The key is already burnt on disk (the important part). Losing the ledger line must not undo that.
            console.error('BIR vault: could not append the pass-key ledger entry:', ledgerErr.message);
        }
        releasePassKey(ticket.ticketId);
        return record;
    }

    // ---- 3. sealed archive --------------------------------------------------------------------------------------
    // Writes a compressed, fingerprinted, read-only copy of every BIR record BEFORE anything is deleted.
    // Throws if the copy cannot be written and verified - the caller must then stop and delete nothing.
    function archiveBirRecords({ purpose, reason, authorizedBy, ticket, extra, now } = {}) {
        const ts = typeof now === 'number' ? now : Date.now();
        ensureDirs();
        const modules = {};
        for (const name of birCompliance.BIR_MODULE_NAMES) {
            modules[name] = name === 'birState' ? birCompliance.getBirState() : readData(name, []);
        }
        const allTx = readData('transactions', []);
        const birTransactions = Array.isArray(allTx) ? allTx.filter(isBirTransaction) : [];
        const counts = {
            birTransactions: birTransactions.length,
            voids: Array.isArray(modules.birVoids) ? modules.birVoids.length : 0,
            zReadings: Array.isArray(modules.birZReadingHistory) ? modules.birZReadingHistory.length : 0,
            agtResets: Array.isArray(modules.birResetHistory) ? modules.birResetHistory.length : 0
        };
        const retainUntil = new Date(ts);
        retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + RETENTION_YEARS);
        const body = {
            schema: 1,
            kind: 'omnipos-bir-retention-archive',
            createdAt: new Date(ts).toISOString(),
            purpose: purpose || null,
            reason: reason || null,
            authorizedBy: authorizedBy || null,
            passKey: ticket ? { ticketId: ticket.ticketId, reference: ticket.reference, issuedAt: ticket.issuedAt, expiresAt: ticket.expiresAt } : null,
            retentionYears: RETENTION_YEARS,
            retainUntil: retainUntil.toISOString(),
            counts,
            modules,
            transactions: birTransactions,
            extra: extra || null
        };
        const json = Buffer.from(JSON.stringify(body), 'utf8');
        const rawSha256 = sha256Hex(json);
        const gz = zlib.gzipSync(json, { level: 9 });
        const gzSha256 = sha256Hex(gz);
        const archiveId = `BIRARC-${ts}-${crypto.randomBytes(3).toString('hex')}`;
        const fileName = `${archiveId}.json.gz`;
        const filePath = path.join(archivesDir, fileName);
        atomicWrite(filePath, gz, 0o600);
        // Read it back from disk and compare the fingerprint: a vault copy that cannot be read back is worthless.
        const readBack = fs.readFileSync(filePath);
        if (readBack.length !== gz.length || sha256Hex(readBack) !== gzSha256) {
            try { fs.unlinkSync(filePath); } catch (_e) { /* ignore */ }
            throw errorWith('BIR_ARCHIVE_VERIFY_FAILED', 'The BIR retention copy could not be verified after writing, so nothing was deleted.');
        }
        try { fs.chmodSync(filePath, 0o400); } catch (_e) { /* filesystems without chmod (some shared storage) */ }
        const ledgerEntry = appendLedger('ARCHIVE', {
            archiveId,
            file: fileName,
            purpose: purpose || null,
            reason: reason || null,
            authorizedBy: authorizedBy || null,
            ticketId: ticket ? ticket.ticketId : null,
            rawSha256,
            gzSha256,
            bytes: gz.length,
            counts,
            retainUntil: body.retainUntil
        }, ts);
        return { archiveId, file: fileName, rawSha256, gzSha256, bytes: gz.length, counts, retainUntil: body.retainUntil, ledgerSeq: ledgerEntry.seq, ledgerHash: ledgerEntry.hash };
    }

    // ---- 4. vault health ----------------------------------------------------------------------------------------
    // shallow = ledger chain + archive files exist with the recorded size. deep = also re-hash every archive file.
    function verifyVaultIntegrity({ deep } = {}) {
        const problems = [];
        let entries;
        try {
            entries = readLedgerRaw();
        } catch (err) {
            return { ok: false, entries: 0, archives: 0, problems: [`Ledger unreadable: ${err.message}`] };
        }
        let prevHash = 'GENESIS';
        let expectedSeq = 1;
        let archives = 0;
        for (const e of entries) {
            if (e._unreadable) { problems.push('An unreadable line was found in the ledger.'); continue; }
            if (e.seq !== expectedSeq) problems.push(`Ledger sequence gap at entry ${e.seq} (expected ${expectedSeq}).`);
            if (e.prevHash !== prevHash) problems.push(`Ledger chain broken at entry ${e.seq}.`);
            if (entryHash(e.prevHash, e) !== e.hash) problems.push(`Ledger entry ${e.seq} was altered.`);
            prevHash = e.hash;
            expectedSeq = (Number(e.seq) || 0) + 1;
            if (e.type === 'ARCHIVE' && e.payload && e.payload.file) {
                archives += 1;
                const file = path.join(archivesDir, path.basename(String(e.payload.file)));
                let stat = null;
                try { stat = fs.statSync(file); } catch (_e) { stat = null; }
                if (!stat) { problems.push(`Archive file missing: ${e.payload.file}`); continue; }
                if (stat.size !== e.payload.bytes) problems.push(`Archive file size changed: ${e.payload.file}`);
                else if (deep) {
                    try {
                        if (sha256Hex(fs.readFileSync(file)) !== e.payload.gzSha256) problems.push(`Archive file content changed: ${e.payload.file}`);
                    } catch (readErr) {
                        problems.push(`Archive file unreadable: ${e.payload.file} (${readErr.message})`);
                    }
                }
            }
        }
        return { ok: problems.length === 0, entries: entries.length, archives, problems };
    }

    function getRetentionSummary() {
        let ledger = [];
        try { ledger = readLedgerRaw().filter((e) => !e._unreadable); } catch (_e) { ledger = []; }
        const archives = ledger.filter((e) => e.type === 'ARCHIVE');
        const last = archives.length ? archives[archives.length - 1] : null;
        const integrity = verifyVaultIntegrity({ deep: false });
        return {
            retentionYears: RETENTION_YEARS,
            archiveCount: archives.length,
            lastArchiveAt: last ? last.at : null,
            lastArchiveId: last && last.payload ? last.payload.archiveId : null,
            retainUntil: archives.reduce((m, e) => (e.payload && e.payload.retainUntil && (!m || e.payload.retainUntil > m) ? e.payload.retainUntil : m), null),
            integrityOk: integrity.ok,
            integrityProblems: integrity.problems.slice(0, 5)
        };
    }

    // ---- 5. restore guard ---------------------------------------------------------------------------------------
    // A backup may be older than the live data. Restoring its BIR modules would roll the invoice/Z/reset counters and
    // logs backwards (duplicate invoice numbers, missing Z-Readings). Returns { allow, touched, reason }.
    function evaluateBirRestore(backupModules) {
        const names = birCompliance.BIR_MODULE_NAMES;
        const incoming = isPlainObject(backupModules) ? backupModules : {};
        const touched = names.some((n) => incoming[n] !== undefined && incoming[n] !== null);
        if (!touched) return { allow: true, touched: false, reason: null };
        if (!birRecordsExist()) return { allow: true, touched: true, reason: null };
        const cur = birCompliance.getBirState();
        const b = incoming.birState;
        if (b !== undefined && b !== null && isPlainObject(b)) {
            if ((Number(b.nextInvoiceNumber) || 1) < (Number(cur.nextInvoiceNumber) || 1)) return { allow: false, touched: true, reason: 'the backup has an older invoice number than this device' };
            if ((Number(b.zCounter) || 0) < (Number(cur.zCounter) || 0)) return { allow: false, touched: true, reason: 'the backup has fewer Z-Readings than this device' };
            if ((Number(b.resetCounter) || 0) < (Number(cur.resetCounter) || 0)) return { allow: false, touched: true, reason: 'the backup has an older reset counter than this device' };
        } else if (b !== undefined && b !== null) {
            return { allow: false, touched: true, reason: 'the backup BIR state is not in a valid format' };
        }
        const lists = [['birVoids', 'void log'], ['birZReadingHistory', 'Z-Reading history'], ['birResetHistory', 'AGT reset history']];
        for (const [name, label] of lists) {
            const inc = incoming[name];
            if (inc === undefined || inc === null) continue;
            if (!Array.isArray(inc)) return { allow: false, touched: true, reason: `the backup ${label} is not in a valid format` };
            if (inc.length < listLen(name)) return { allow: false, touched: true, reason: `the backup ${label} is shorter than this device's` };
        }
        return { allow: true, touched: true, reason: null };
    }

    return {
        PURPOSE_HARD_RESET,
        PURPOSE_AGT_RESET,
        ALLOWED_PURPOSES,
        REQUEST_PREFIX,
        PASSKEY_PREFIX,
        RETENTION_YEARS,
        canonicalTicketString,
        isBirTransaction,
        birRecordsExist,
        hasOpenReadingPeriod,
        buildSummary,
        createResetRequest,
        getOpenRequest,
        verifyPassKey,
        reservePassKey,
        releasePassKey,
        consumePassKey,
        archiveBirRecords,
        verifyVaultIntegrity,
        getRetentionSummary,
        evaluateBirRestore
    };
};
module.exports.canonicalTicketString = canonicalTicketString;
module.exports.SIGNING_DOMAIN = SIGNING_DOMAIN;
module.exports.PURPOSE_HARD_RESET = PURPOSE_HARD_RESET;
module.exports.PURPOSE_AGT_RESET = PURPOSE_AGT_RESET;
