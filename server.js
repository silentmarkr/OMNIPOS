const net = require('net');
const dns = require('dns');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const multer = require('multer');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const { execSync, spawn } = require('child_process');
const { readData, writeData, vacuumDatabase, runLocalDatabaseBackup, checkModuleBlobSizes, mirrorBackupToDownloads, getCloudBackupPayload, getFullDatabaseSnapshot, getBackupStatus } = require('./db');
const webauthn = require('./webauthn');

try {

    require('./env-loader')();
} catch (err) {

}

process.on('uncaughtException', (err) => {
    console.error('🔥 [CRASH-SAFETY] Uncaught Exception (hindi pinatay ang server):', err);
});

function createAsyncMutex() {
    let chain = Promise.resolve();

    return function runExclusive(fn) {
        const result = chain.then(fn, fn);
        chain = result.then(() => {}, () => {});
        return result;
    };
}
const transactionsMutexRunExclusive = createAsyncMutex();

process.on('unhandledRejection', (reason) => {
    console.error('🔥 [CRASH-SAFETY] Unhandled Promise Rejection (hindi pinatay ang server):', reason);
});

const { sendMailSmart, verifyMailCredentialsSmart, SMTP_TIMEOUTS } = require('./mailer');

const app = express();

app.set('trust proxy', true);

function getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return cfIp.trim().replace(/^::ffff:/, '');

    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        const first = xff.split(',')[0].trim();
        if (first) return first.replace(/^::ffff:/, '');
    }

    const raw = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    return raw.replace(/^::ffff:/, '');
}

function getServerLanSubnets() {
    const subnets = [];
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                subnets.push({ address: iface.address, netmask: iface.netmask });
            }
        }
    }
    return subnets;
}

function ipToLong(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => Number.isNaN(p))) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isSameLanAsServer(ip) {
    if (!ip || ip === 'unknown') return false;
    if (ip === '127.0.0.1' || ip === '::1') return true;
    const ipLong = ipToLong(ip);
    if (ipLong === null) return false;

    const subnets = getServerLanSubnets();
    for (const { address, netmask } of subnets) {
        const addrLong = ipToLong(address);
        const maskLong = ipToLong(netmask);
        if (addrLong === null || maskLong === null) continue;
        if ((ipLong & maskLong) === (addrLong & maskLong)) return true;
    }
    return false;
}

app.get('/api/system/network-info', (req, res) => {
    const subnets = getServerLanSubnets();
    res.json({
        success: true,
        addresses: subnets.map(s => s.address),
        port: PORT
    });
});

let helmet;
try {
    helmet = require('helmet');
} catch (err) {
    console.warn('⚠️ Hindi pa naka-install ang "helmet" package. Patakbuhin ang `npm install` para magamit ito. Gagamitin muna ang manual security headers bilang fallback.');
}

if (helmet) {
    app.use(helmet({

        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
    }));
} else {
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options','nosniff');
        res.setHeader('X-Frame-Options','DENY');
        res.setHeader('Referrer-Policy','same-origin');
        res.removeHeader('X-Powered-By');
        next();
    });
}

const RATE_LIMIT_BUCKETS = new Map();

function rateLimit(routeKey, maxAttempts, windowMs, customMessage) {
    return (req, res, next) => {
        const ip = req.ip || req.connection?.remoteAddress ||'unknown';
        const key = `${routeKey}:${ip}`;
        const now = Date.now();
        let attempts = RATE_LIMIT_BUCKETS.get(key) || [];
        attempts = attempts.filter(ts => now - ts < windowMs);
        if (attempts.length >= maxAttempts) {
            const retryAfterSec = Math.ceil((windowMs - (now - attempts[0])) / 1000);
            res.setHeader('Retry-After', retryAfterSec);
            return res.status(429).json({
                success: false,
                message: customMessage
                    ? customMessage(retryAfterSec)
                    : `Sobra na sa allowed attempts. Subukan muli pagkatapos ng ${retryAfterSec} segundo.`
            });
        }
        attempts.push(now);
        RATE_LIMIT_BUCKETS.set(key, attempts);
        next();
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [key, attempts] of RATE_LIMIT_BUCKETS.entries()) {
        const fresh = attempts.filter(ts => now - ts < 15 * 60 * 1000);
        if (fresh.length === 0) RATE_LIMIT_BUCKETS.delete(key);
        else RATE_LIMIT_BUCKETS.set(key, fresh);
    }
}, 5 * 60 * 1000).unref();

function checkLoginRateLimit(req, res, maxAttemptsPerAccount, maxAttemptsPerIp, windowMs) {
    const ip = req.ip || req.connection?.remoteAddress ||'unknown';
    const username = ((req.body && req.body.username) ||'').toString().trim().toLowerCase();
    const now = Date.now();

    const ipKey = `login-ip:${ip}`;
    const ipAttempts = (RATE_LIMIT_BUCKETS.get(ipKey) || []).filter(ts => now - ts < windowMs);
    if (ipAttempts.length >= maxAttemptsPerIp) {
        const retryAfterSec = Math.ceil((windowMs - (now - ipAttempts[0])) / 1000);
        res.setHeader('Retry-After', retryAfterSec);
        res.status(429).json({
            success: false,
            message: `Too many login attempts from this terminal. Please try again in ${retryAfterSec} seconds.`
        });
        return false;
    }

    if (username) {
        const acctKey = `login-account:${username}`;
        const acctAttempts = (RATE_LIMIT_BUCKETS.get(acctKey) || []).filter(ts => now - ts < windowMs);
        if (acctAttempts.length >= maxAttemptsPerAccount) {
            const retryAfterSec = Math.ceil((windowMs - (now - acctAttempts[0])) / 1000);
            res.setHeader('Retry-After', retryAfterSec);
            res.status(429).json({
                success: false,
                message: `Too many attempts for account '${username}'. Please try again in ${retryAfterSec} seconds. Other accounts are not affected.`
            });
            return false;
        }
    }

    return true;
}

function recordLoginAttempt(req, windowMs) {
    const ip = req.ip || req.connection?.remoteAddress ||'unknown';
    const username = ((req.body && req.body.username) ||'').toString().trim().toLowerCase();
    const now = Date.now();

    const ipKey = `login-ip:${ip}`;
    const ipAttempts = (RATE_LIMIT_BUCKETS.get(ipKey) || []).filter(ts => now - ts < windowMs);
    ipAttempts.push(now);
    RATE_LIMIT_BUCKETS.set(ipKey, ipAttempts);

    if (username) {
        const acctKey = `login-account:${username}`;
        const acctAttempts = (RATE_LIMIT_BUCKETS.get(acctKey) || []).filter(ts => now - ts < windowMs);
        acctAttempts.push(now);
        RATE_LIMIT_BUCKETS.set(acctKey, acctAttempts);
    }
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||'')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

app.use(cors(ALLOWED_ORIGINS.length > 0 ? {
    origin(origin, callback) {

        if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS: hindi pinapayagang origin — ${origin}`));
    }
} : undefined));

app.use(express.json({ limit:'1gb' }));

// Kapag na-reject ng body-parser yung request (halimbawa: sobrang laki ng
// backup file na ipinadala, o sira ang JSON), default na plain-text/HTML na
// error page ang ibabalik ni Express — na hindi nababasa ng res.json() sa
// client, kaya nagiging misleading yung "Server Connection Error / Make sure
// server.js is running" kahit tumatakbo naman talaga ang server. Dito, sinisigurado
// nating JSON pa rin ang isasagot para tama ang lalabas na error sa client.
app.use((err, req, res, next) => {
    if (err && err.type ==='entity.too.large') {
        return res.status(413).json({
            success: false,
            message:'Masyadong malaki ang file/data na ipinadala. Paki-check ang laki ng backup file.'
        });
    }
    if (err && (err.type ==='entity.parse.failed' || err instanceof SyntaxError)) {
        return res.status(400).json({
            success: false,
            message:'Hindi mabasa ang datos na ipinadala — maaaring sira o maling format ang file.'
        });
    }
    next(err);
});

app.use(express.static(path.join(__dirname,'public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res) => {
        res.setHeader('Cache-Control','no-cache');
    }
}));

const SESSIONS = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const SESSIONS_MODULE ='sessions';

function persistSessions() {
    const snapshot = {};
    for (const [token, session] of SESSIONS.entries()) snapshot[token] = session;
    writeData(SESSIONS_MODULE, snapshot);
}

function loadSessionsFromDisk() {
    const snapshot = readData(SESSIONS_MODULE, {});
    const now = Date.now();
    let restored = 0;
    for (const [token, session] of Object.entries(snapshot)) {
        if (session && session.expiresAt > now) {
            SESSIONS.set(token, session);
            restored++;
        }
    }
    if (restored > 0) console.log(`🔄 Naibalik ang ${restored} aktibong session mula sa huling pagkaka-save (bago pa mag-restart).`);
}
loadSessionsFromDisk();

function parseDeviceInfo(userAgent) {
    const ua = (userAgent ||'');

    let deviceType ='Desktop';
    if (/Tablet|iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
        deviceType ='Tablet';
    } else if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) {
        deviceType ='Mobile';
    }

    let os ='Unknown OS';
    if (/Windows NT/i.test(ua)) os ='Windows';
    else if (/Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) os ='macOS';
    else if (/Android/i.test(ua)) os ='Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os ='iOS';
    else if (/Linux/i.test(ua)) os ='Linux';

    let browser ='Unknown Browser';
    if (/Edg\//i.test(ua)) browser ='Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser ='Opera';
    else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser ='Chrome';
    else if (/CriOS\//i.test(ua)) browser ='Chrome';
    else if (/Firefox\//i.test(ua)) browser ='Firefox';
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser ='Safari';

    return { deviceType, os, browser, label: `${deviceType} · ${os} · ${browser}` };
}

function createSession(username, role, userAgent, ip) {
    const token = crypto.randomBytes(32).toString('hex');

    SESSIONS.set(token, { username, role, loginAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, device: parseDeviceInfo(userAgent), ip: ip || 'unknown' });
    persistSessions();
    return token;
}

function getSession(token) {
    const session = SESSIONS.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        SESSIONS.delete(token);
        return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session;
}

function destroySession(token) {
    SESSIONS.delete(token);
    persistSessions();
}

function renameUsernameEverywhere(oldUsername, newUsername) {
    for (const session of SESSIONS.values()) {
        if (session.username.toLowerCase() === oldUsername.toLowerCase()) {
            session.username = newUsername;
        }
    }
    persistSessions();
    const cartsData = readData(FILE_CARTS, {});
    const cartKey = Object.keys(cartsData).find(k => k.toLowerCase() === oldUsername.toLowerCase());
    if (cartKey && cartKey !== newUsername) {
        cartsData[newUsername] = cartsData[cartKey];
        delete cartsData[cartKey];
        writeData(FILE_CARTS, cartsData);
    }
}

setInterval(() => {
    const now = Date.now();
    let removedAny = false;
    for (const [token, session] of SESSIONS.entries()) {
        if (now > session.expiresAt) {
            SESSIONS.delete(token);
            removedAny = true;
        }
    }
    if (removedAny) persistSessions();
}, 15 * 60 * 1000).unref();

setInterval(persistSessions, 2 * 60 * 1000).unref();

const AUTO_BACKUP_DISABLED = String(process.env.DISABLE_AUTO_BACKUP ||'').trim().toLowerCase() ==='true';

const INTEGRITY_MONITOR_DISABLED = String(process.env.DISABLE_INTEGRITY_MONITOR || '').trim().toLowerCase() === 'true';

if (INTEGRITY_MONITOR_DISABLED) {
    console.log('⏸️  Naka-disable ang file integrity monitor (DISABLE_INTEGRITY_MONITOR=true sa .env). Alisin/i-false ang env var para i-enable ulit ito.');
}

if (AUTO_BACKUP_DISABLED) {
    console.log('⏸️  Naka-disable ang auto-backup (DISABLE_AUTO_BACKUP=true sa .env). Alisin/i-false ang env var para i-enable ulit ito.');
} else {
    setTimeout(() => runLocalDatabaseBackup(14), 30 * 1000);
    setInterval(() => runLocalDatabaseBackup(14), 24 * 60 * 60 * 1000).unref();
}

setTimeout(() => checkModuleBlobSizes(), 45 * 1000);
setInterval(() => checkModuleBlobSizes(), 24 * 60 * 60 * 1000).unref();

function extractToken(req) {
    const authHeader = req.headers['authorization'] ||'';
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
    return req.headers['x-auth-token'] ||'';
}

const PUBLIC_API_PATHS = new Set(['/api/auth/login','/api/auth/login/verify-otp','/api/auth/webauthn/login-options','/api/auth/webauthn/login-verify','/api/admin/request-password-reset','/api/admin/confirm-password-reset']);

app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (PUBLIC_API_PATHS.has(req.path)) return next();

    if (req.path.startsWith('/api/system/reset/status/')) return next();

    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ success: false, code:'NO_TOKEN', message:'Kailangan mag-login muna. Walang session token.' });
    }

    const session = getSession(token);
    if (!session) {
        return res.status(401).json({ success: false, code:'INVALID_TOKEN', message:'Expired o invalid na ang session. Mangyaring mag-login muli.' });
    }

    const currentDeviceData = readFeatureUnlocks();
    if (currentDeviceData.relayAuthorized === false) {
        destroySession(token);
        return res.status(401).json({
            success: false,
            code:'DEVICE_REVOKED',
            message:'Inalis ng developer/store owner ang device na ito sa listahan ng mga pinapayagang device. Awtomatikong na-logout ka. Kontakin ang developer/store owner.'
        });
    }

    if (Date.now() - lastLiveRecheckAt > DEVICE_REVOCATION_RECHECK_MS) {
        lastLiveRecheckAt = Date.now();
        recheckDeviceAuthorizationLive();
    }

    req.authUser = { username: session.username, role: session.role };
    req.authToken = token;

    if (req.body && typeof req.body ==='object') {
        if (typeof req.body.username ==='string') req.body.username = req.authUser.username;
        if (typeof req.body.user ==='string') req.body.user = req.authUser.username;
        if (typeof req.body.requester ==='string') req.body.requester = req.authUser.username;
    }
    if (req.query && typeof req.query ==='object') {
        if ('requester' in req.query) req.query.requester = req.authUser.username;
    }

    next();
});

const FILE_USERS ='users';
const FILE_PRODUCTS ='products';
const FILE_TRANSACTIONS ='transactions';
const FILE_REFUNDS ='refunds';
const FILE_USERLOGS ='userlogs';
const FILE_REQUESTS ='requests';
const DEFAULT_CATEGORIES = ['Beverages','Dairy','Snacks','Bakery','Grains'];
const FILE_CATEGORIES ='categories';
const FILE_CARTS ='carts';
const FILE_CUSTOMERS ='customers';
const FILE_DEBTS ='debts';
const FILE_PROMOCODES ='promocodes';
const FILE_SHIFTS ='shifts';
const FILE_SHIFT_META ='shiftMeta';
const FILE_PURCHASE_ORDERS ='purchaseOrders';

const FILE_LOWSTOCK_TRACKING ='lowStockTracking';

const MENU_REGISTRY = [

    { key:'overview',     label:'Overview / Home Dashboard (Landing Page After Login)', group:'Core' },
    { key:'terminal',     label:'POS Terminal', group:'Core' },
    { key:'dashboard',    label:'Inventory Dashboard', group:'Core' },
    { key:'products',     label:'Products', group:'Core' },
    { key:'products_direct_apply', label:'Products — Add/Update/Delete Direct Apply (No Approval Needed)', group:'Core' },
    { key:'barcode',      label:'Barcode', group:'Core' },

    { key:'transactions', label:'Transactions', group:'Transactions' },
    { key:'transactions_view_all', label:'Transactions — View All Cashiers', group:'Transactions' },
    { key:'void_own_password', label:'Transactions — Void gamit ang Sariling Password (Hindi na kailangan ng Admin Password)', group:'Transactions' },
    { key:'refund', label:'Transactions — Pwedeng Mag-process ng Refund (Full o Partial)', group:'Transactions' },
    { key:'refund_own_password', label:'Transactions — Refund gamit ang Sariling Password (Hindi na kailangan ng Admin Password)', group:'Transactions' },
    { key:'manual_discount_own_password', label:'Transactions — Authorize Manual Discount With Own Password (Admin Password Not Required)', group:'Transactions' },

    { key:'reports',      label:'Sales Report', group:'Reports' },

    { key:'customers', label:'Customers & Loyalty', group:'Customers & Loyalty' },
    { key:'loyalty_card_issue', label:'Customers & Loyalty — Issue/Regenerate Loyalty Card or QR (Authorized Personnel Only, e.g. New Customer Enrollment or Lost Card Replacement)', group:'Customers & Loyalty' },
    { key:'loyalty_redeem_own_password', label:'Transactions — Authorize MANUAL Loyalty Points Redemption With Own Password (No Card/QR Scan, Admin Password Not Required)', group:'Customers & Loyalty' },

    { key:'shiftreport', label:'Shift / Z-Reading', group:'Shift / Z-Reading' },
    { key:'shiftreport_view_all', label:'Shift / Z-Reading — View All Cashiers', group:'Shift / Z-Reading' },
    { key:'shiftreport_view_amounts', label:'Shift / Z-Reading — View Sales Amounts (Gross/Discount/Net)', group:'Shift / Z-Reading' },
    { key:'shift_close_control', label:'Shift / Z-Reading — Admin/Supervisor Control (Close Other Cashiers\' Shift)', group:'Shift / Z-Reading' },
    { key:'shift_close_own_password', label:'Shift / Z-Reading — Pwedeng Mag-authorize ng Close gamit ang Sariling Password (Hindi na kailangan ng Admin Password)', group:'Shift / Z-Reading' },

    { key:'reorder', label:'Reorder Alerts / Purchase Orders', group:'Reorder / Purchase Orders' },
    { key:'restock_direct_apply', label:'Reorder Alerts — Quick Restock Direct Apply (No Approval Needed)', group:'Reorder / Purchase Orders' },

    { key:'branches_view', label:'Overview — "All Branches" Widget (View Combined Sales ng Ibang Branch, Premium Feature)', group:'Multi-Branch' },

    { key:'users',        label:'Users', group:'Users & Access' },
    { key:'users_manage', label:'Users — Users Management Tab (view/add accounts)', group:'Users & Access' },
    { key:'pending_requests', label:'Users — Pending Requests Tab', group:'Users & Access' },
    { key:'roles_permissions_view', label:'Users — Roles & Permissions Tab (opening/viewing the RBAC matrix)', group:'Users & Access' },
    { key:'edit_user_profile', label:'Edit User Profile (Widget)', group:'Users & Access' },
    { key:'logs',         label:'User Logs', group:'Users & Access' },

    { key:'receipt_settings_view', label:'Users — Receipt Customization Tab (view/open access)', group:'Settings' },
    { key:'receipt_settings_direct_apply', label:'Receipt Customization — Direct Apply (No Approval Needed)', group:'Settings' },
    { key:'store_settings_view', label:'Users — Store & Sales Settings Tab (view/open access)', group:'Settings' },
    { key:'store_settings_direct_apply', label:'Store & Sales Settings — Direct Apply (No Approval Needed)', group:'Settings' },
    { key:'ux_settings_view', label:'Users — Appearance/UX Settings Tab (view/open access)', group:'Settings' },
    { key:'ux_settings_direct_apply', label:'Appearance/UX Settings — Direct Apply (No Approval Needed)', group:'Settings' },
    { key:'advanced_settings_view', label:'Users — Advanced Settings Tab (view/open access)', group:'Settings' },
    { key:'advanced_settings_direct_apply', label:'Advanced Settings — Direct Apply (No Approval Needed)', group:'Settings' },
    { key:'reset_restore', label:'Users — Reset/Restore Tab', group:'Settings' },
    { key:'fraud_alerts_view', label:'Users — Fraud & Anomaly Alerts Tab (view access to flagged transactions/voids/refunds)', group:'Settings' },

    { key:'relay_unlock_request', label:'Features/Themes — Pwedeng Mag-send ng Unlock/Demo OTP Request sa Relay', group:'Features & Themes' },
];

const FILE_ROLES ='roles';

const DEFAULT_ROLES = [
    {
        name:'Admin',

        protected: true,
        permissions: MENU_REGISTRY.reduce((acc, m) => { acc[m.key] = true; return acc; }, {})
    },
    {
        name:'Staff',
        protected: false,
        permissions: { overview: true, terminal: true, dashboard: true, products: true, barcode: true, transactions: true, transactions_view_all: false, void_own_password: false, refund: false, refund_own_password: false, reports: false, users: false, logs: false, edit_user_profile: false, customers: true, loyalty_card_issue: false, loyalty_redeem_own_password: false, shiftreport: true, shiftreport_view_amounts: true, shift_close_control: false, shift_close_own_password: false, restock_direct_apply: false, products_direct_apply: false, users_manage: false, pending_requests: false, roles_permissions_view: false, reset_restore: false, receipt_settings_view: false, receipt_settings_direct_apply: false, store_settings_view: false, store_settings_direct_apply: false, ux_settings_view: false, ux_settings_direct_apply: false, advanced_settings_view: false, advanced_settings_direct_apply: false, fraud_alerts_view: false, relay_unlock_request: false, branches_view: false }
    },
    {
        name:'Cashier',
        protected: false,

        // Cashier role is intentionally locked down to the POS Terminal only.
        // "overview" (the home/landing dashboard shown right after login) is
        // explicitly disabled so that Terminal is the only screen that opens
        // for this role. All other menu keys stay false for the same reason.
        permissions: { overview: false, terminal: true, dashboard: false, products: false, barcode: false, transactions: false, transactions_view_all: false, void_own_password: false, refund: false, refund_own_password: false, reports: false, users: false, logs: false, edit_user_profile: false, customers: false, loyalty_card_issue: false, loyalty_redeem_own_password: false, shiftreport: false, shiftreport_view_amounts: false, shift_close_control: false, shift_close_own_password: false, restock_direct_apply: false, products_direct_apply: false, users_manage: false, pending_requests: false, roles_permissions_view: false, reset_restore: false, receipt_settings_view: false, receipt_settings_direct_apply: false, store_settings_view: false, store_settings_direct_apply: false, ux_settings_view: false, ux_settings_direct_apply: false, advanced_settings_view: false, advanced_settings_direct_apply: false, fraud_alerts_view: false, relay_unlock_request: false, branches_view: false }
    }
];

function getRoles() {
    let roles = readData(FILE_ROLES, DEFAULT_ROLES);

    let changed = false;
    roles.forEach(r => {
        if (!r.permissions) { r.permissions = {}; changed = true; }
        MENU_REGISTRY.forEach(m => {
            if (!(m.key in r.permissions)) {
                r.permissions[m.key] = !!r.protected;
                changed = true;
            }
        });
    });
    if (changed) writeData(FILE_ROLES, roles);
    return roles;
}

function getPermissionsForRole(roleName) {
    const roles = getRoles();
    const role = roles.find(r => r.name.toLowerCase() === (roleName ||'').toLowerCase());
    if (!role) {

        if ((roleName ||'').toLowerCase() ==='admin') {
            return MENU_REGISTRY.reduce((acc, m) => { acc[m.key] = true; return acc; }, {});
        }
        return {};
    }
    return role.permissions;
}

async function findPasswordAuthorizer(users, password, permissionKey) {
    if (!password) return null;
    for (const u of users) {
        let match = false;
        try {
            match = await bcrypt.compare(password, u.password);
        } catch (e) {
            match = (password === u.password);
        }
        if (!match) continue;

        const role = (u.role ||'').toLowerCase();
        if (role ==='admin') return { user: u, isAdmin: true };
        if (permissionKey && !!getPermissionsForRole(u.role)[permissionKey]) return { user: u, isAdmin: false };

        return null;
    }
    return null;
}

function findVoidAuthorizer(users, password) {
    return findPasswordAuthorizer(users, password,'void_own_password');
}

function findRefundAuthorizer(users, password) {
    return findPasswordAuthorizer(users, password,'refund_own_password');
}

function findManualDiscountAuthorizer(users, password) {
    return findPasswordAuthorizer(users, password,'manual_discount_own_password');
}

function findShiftCloseAuthorizer(users, password) {
    return findPasswordAuthorizer(users, password,'shift_close_own_password');
}

const FILE_LOYALTY_SECURITY ='loyaltySecurity';

function getLoyaltyCardSigningKey() {
    const data = readData(FILE_LOYALTY_SECURITY, {});
    if (data.cardSigningKey) return data.cardSigningKey;
    data.cardSigningKey = crypto.randomBytes(32).toString('hex');
    writeData(FILE_LOYALTY_SECURITY, data);
    return data.cardSigningKey;
}

function hashLoyaltyCardSecret(secret) {
    return crypto.createHmac('sha256', getLoyaltyCardSigningKey()).update(secret).digest('hex');
}

function timingSafeEqualHex(a, b) {
    try {
        const bufA = Buffer.from(String(a || ''), 'hex');
        const bufB = Buffer.from(String(b || ''), 'hex');
        if (bufA.length !== bufB.length || bufA.length === 0) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    } catch (e) {
        return false;
    }
}

function issueLoyaltyCard(customer, mode, issuedByUsername) {
    const secret = crypto.randomBytes(24).toString('base64url');
    const versionNo = ((customer.loyaltyCard && customer.loyaltyCard.versionNo) || 0) + 1;
    const cardId = (customer.loyaltyCard && customer.loyaltyCard.cardId) || ('LC-' + crypto.randomBytes(6).toString('hex').toUpperCase());
    customer.loyaltyCard = {
        cardId,
        versionNo,
        secretHash: hashLoyaltyCardSecret(secret),
        mode: mode ==='static' ? 'static' : 'rotating',
        revoked: false,
        issuedBy: issuedByUsername,
        issuedAt: new Date().toISOString()
    };
    const token = `LC1.${customer.id}.${versionNo}.${secret}`;
    return { token, card: customer.loyaltyCard };
}

function verifyLoyaltyCardToken(customer, rawToken) {
    if (!rawToken || typeof rawToken !=='string') return { valid:false, message:'Missing card/QR token.' };
    const parts = rawToken.split('.');
    if (parts.length !== 4 || parts[0] !=='LC1') return { valid:false, message:'Invalid card/QR format.' };
    const [, customerId, versionStr, secret] = parts;
    if (customerId !== customer.id) return { valid:false, message:'Ang card/QR na ito ay hindi sa piniling customer.' };
    const card = customer.loyaltyCard;
    if (!card) return { valid:false, message:'Wala pang naka-issue na loyalty card/QR ang customer na ito.' };
    if (card.revoked) return { valid:false, message:'Na-revoke na ang card/QR na ito. Magpa-issue ng bago.' };
    if (parseInt(versionStr, 10) !== card.versionNo) return { valid:false, message:'Luma na o na-rotate na ang QR code na ito. Ipa-refresh ang bagong QR sa customer.' };
    const candidateHash = hashLoyaltyCardSecret(secret);
    if (!timingSafeEqualHex(candidateHash, card.secretHash)) return { valid:false, message:'Invalid o pekeng card/QR token.' };
    return { valid:true, mode: card.mode };
}

function findLoyaltyRedeemAuthorizer(users, password) {
    return findPasswordAuthorizer(users, password,'loyalty_redeem_own_password');
}

function sanitizeCustomerForClient(c) {
    if (!c) return c;
    const { loyaltyCard, ...rest } = c;
    return {
        ...rest,
        loyaltyCard: loyaltyCard ? {
            cardId: loyaltyCard.cardId,
            mode: loyaltyCard.mode,
            revoked: !!loyaltyCard.revoked,
            issuedBy: loyaltyCard.issuedBy,
            issuedAt: loyaltyCard.issuedAt
        } : null
    };
}

function requirePermission(menuKey) {
    return (req, res, next) => {
        const role = req.authUser && req.authUser.role;
        if (role && role.toLowerCase() ==='admin') return next();
        const perms = getPermissionsForRole(role);
        if (!perms[menuKey]) {
            return res.status(403).json({ success: false, message:'Akses Denied: Wala kang pahintulot na gamitin ang feature na ito.' });
        }
        next();
    };
}

const FILE_RECEIPT_SETTINGS ='receiptSettings';
const FREE_CUSTOMIZE_LIMIT = 2;

const OTP_RECIPIENT_EMAIL = Buffer.from('cml2ZXJvbWFyazE3QGdtYWlsLmNvbQ==','base64').toString('utf8');

const OTP_TTL_MS = 10 * 60 * 1000;

function getOtpMailCredentials(settings) {
    if (process.env.OTP_MAIL_USER && process.env.OTP_MAIL_PASS) {
        return { user: process.env.OTP_MAIL_USER, pass: process.env.OTP_MAIL_PASS };
    }
    const s = settings || readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    if (s.otpSenderEmail && s.otpSenderAppPassword) {
        return { user: s.otpSenderEmail, pass: s.otpSenderAppPassword };
    }
    return null;
}

const DEFAULT_RECEIPT_SETTINGS = {
    storeName:'OmniPOS',
    storeAddress:'Your Store Address Here',
    storeContact:'(xxx) xxx-xxxx',
    headerText:'',
    footerText:'Thank you for shopping!',
    paperSize:'80mm',

    headerType:'text',
    headerImage: null,
    headerImageStyle: {
        widthPct: 55,
        align:'center',
        maxHeightPx: 90,
        opacityPct: 100,
        grayscale: false,
        cornerRadiusPx: 0,
        marginTopPx: 4,
        marginBottomPx: 8
    },

    barcodeSettings: {
        show: true,
        width: 1.5,
        height: 40,
        margin: 0,
        displayValue: true,
        fontSize: 11
    },

    advancedSettings: {
        fontSize:'normal',
        divider:'dashed',
        accentColor:'#000000',
        boldTotal: true,
        uppercaseStoreName: false,

        itemDetailGapPx: 0,

        itemCounterGapTopPx: 6,
        itemCounterGapBottomPx: 6,

        metaRowGapPx: 4,
        itemsRowGapPx: 6,
        totalsRowGapPx: 4
    },

    loyaltyQrSettings: {
        enabled: true,
        sizePx: 160,
        moduleSize: 6,
        position: 'below_barcode',
        showNote: true,

        printOn: 'all',

        correctLevel: 'M',

        gapPx: 15,

        noteText: '',

        showDivider: true,

        doubleCopy: false,

        copyGapPx: 15
    },

    taiwanTemplateSettings: {
        enabled: false,
        widthMm: 57
    },

    transactionIdSettings: {
        format: 'xs'
    },
    customizeCount: 0,
    firstCustomizedAt: null,
    pendingOtp: null,
    pendingResetOtp: null,
    resetHistory: [],
    otpSenderEmail: null,
    otpSenderAppPassword: null
};

const VALID_PAPER_SIZES = ['58mm','80mm'];
const VALID_HEADER_TYPES = ['text','image'];
const VALID_HEADER_IMAGE_ALIGNS = ['left','center','right'];
const VALID_RECEIPT_FONT_SIZES = ['small','normal','large'];
const VALID_RECEIPT_DIVIDER_STYLES = ['dashed','solid','dotted','none'];
const VALID_HEX_COLOR =/^#[0-9a-fA-F]{6}$/;
const VALID_LOYALTY_QR_POSITIONS = ['above_barcode','below_barcode'];
const VALID_LOYALTY_QR_PRINT_ON = ['all','bluetooth','regular'];
const VALID_LOYALTY_QR_CORRECT_LEVELS = ['L','M','Q','H'];

const VALID_TRANSACTION_ID_FORMATS = ['xs','sm','md','lg','original'];

const MAX_HEADER_IMAGE_DATAURL_LENGTH = 450 * 1024;

function sanitizeReceiptHeaderImageDataUrl(val) {
    if (typeof val !== 'string' || !val.trim()) return null;
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(val)) return null;
    if (val.length > MAX_HEADER_IMAGE_DATAURL_LENGTH) return null;
    return val;
}

function clampNumber(val, min, max, fallback) {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function sanitizeHeaderImageStyle(raw) {
    const d = DEFAULT_RECEIPT_SETTINGS.headerImageStyle;
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        widthPct: clampNumber(s.widthPct, 20, 100, d.widthPct),
        align: VALID_HEADER_IMAGE_ALIGNS.includes(s.align) ? s.align : d.align,
        maxHeightPx: clampNumber(s.maxHeightPx, 24, 200, d.maxHeightPx),
        opacityPct: clampNumber(s.opacityPct, 10, 100, d.opacityPct),
        grayscale: !!s.grayscale,
        cornerRadiusPx: clampNumber(s.cornerRadiusPx, 0, 100, d.cornerRadiusPx),
        marginTopPx: clampNumber(s.marginTopPx, 0, 40, d.marginTopPx),
        marginBottomPx: clampNumber(s.marginBottomPx, 0, 40, d.marginBottomPx)
    };
}

function sanitizeBarcodeSettings(raw) {
    const d = DEFAULT_RECEIPT_SETTINGS.barcodeSettings;
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        show: s.show === undefined ? d.show : !!s.show,
        width: clampNumber(s.width, 1, 4, d.width),
        height: clampNumber(s.height, 20, 100, d.height),
        margin: clampNumber(s.margin, 0, 20, d.margin),
        displayValue: s.displayValue === undefined ? d.displayValue : !!s.displayValue,
        fontSize: clampNumber(s.fontSize, 8, 16, d.fontSize)
    };
}

function sanitizeAdvancedSettings(raw) {
    const d = DEFAULT_RECEIPT_SETTINGS.advancedSettings;
    const s = raw && typeof raw === 'object' ? raw : {};

    const legacyCounterGap = Number.isFinite(parseFloat(s.itemCounterGapPx)) ? parseFloat(s.itemCounterGapPx) : undefined;

    return {
        fontSize: VALID_RECEIPT_FONT_SIZES.includes(s.fontSize) ? s.fontSize : d.fontSize,
        divider: VALID_RECEIPT_DIVIDER_STYLES.includes(s.divider) ? s.divider : d.divider,
        accentColor: VALID_HEX_COLOR.test(s.accentColor) ? s.accentColor : d.accentColor,
        boldTotal: s.boldTotal === undefined ? d.boldTotal : !!s.boldTotal,
        uppercaseStoreName: s.uppercaseStoreName === undefined ? d.uppercaseStoreName : !!s.uppercaseStoreName,
        itemDetailGapPx: clampNumber(s.itemDetailGapPx, 0, 40, d.itemDetailGapPx),
        itemCounterGapTopPx: clampNumber(
            s.itemCounterGapTopPx !== undefined ? s.itemCounterGapTopPx : legacyCounterGap, 0, 40, d.itemCounterGapTopPx
        ),
        itemCounterGapBottomPx: clampNumber(
            s.itemCounterGapBottomPx !== undefined ? s.itemCounterGapBottomPx : legacyCounterGap, 0, 40, d.itemCounterGapBottomPx
        ),

        metaRowGapPx: clampNumber(s.metaRowGapPx, 0, 20, d.metaRowGapPx),
        itemsRowGapPx: clampNumber(s.itemsRowGapPx, 0, 20, d.itemsRowGapPx),
        totalsRowGapPx: clampNumber(s.totalsRowGapPx, 0, 20, d.totalsRowGapPx)
    };
}

function sanitizeLoyaltyQrSettings(raw) {
    const d = DEFAULT_RECEIPT_SETTINGS.loyaltyQrSettings;
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: s.enabled === undefined ? d.enabled : !!s.enabled,

        sizePx: clampNumber(s.sizePx, 80, 400, d.sizePx),

        moduleSize: clampNumber(s.moduleSize, 2, 16, d.moduleSize),
        position: VALID_LOYALTY_QR_POSITIONS.includes(s.position) ? s.position : d.position,
        showNote: s.showNote === undefined ? d.showNote : !!s.showNote,
        printOn: VALID_LOYALTY_QR_PRINT_ON.includes(s.printOn) ? s.printOn : d.printOn,
        correctLevel: VALID_LOYALTY_QR_CORRECT_LEVELS.includes(s.correctLevel) ? s.correctLevel : d.correctLevel,

        gapPx: clampNumber(s.gapPx, 0, 40, d.gapPx),
        noteText: typeof s.noteText === 'string' ? s.noteText.trim().slice(0, 120) : d.noteText,

        showDivider: s.showDivider === undefined ? d.showDivider : !!s.showDivider,
        doubleCopy: s.doubleCopy === undefined ? d.doubleCopy : !!s.doubleCopy,
        copyGapPx: clampNumber(s.copyGapPx, 0, 80, d.copyGapPx)
    };
}

function sanitizeTaiwanTemplateSettings(raw) {
    const d = DEFAULT_RECEIPT_SETTINGS.taiwanTemplateSettings;
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: s.enabled === undefined ? d.enabled : !!s.enabled,
        widthMm: clampNumber(s.widthMm, 40, 80, d.widthMm)
    };
}

function sanitizeTransactionIdSettings(raw) {
    const d = DEFAULT_RECEIPT_SETTINGS.transactionIdSettings;
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        format: VALID_TRANSACTION_ID_FORMATS.includes(s.format) ? s.format : d.format
    };
}

function getReceiptSettingsPublic(rawSettings) {
    const s = rawSettings || DEFAULT_RECEIPT_SETTINGS;
    const customizeCount = s.customizeCount || 0;
    const headerType = VALID_HEADER_TYPES.includes(s.headerType) ? s.headerType : DEFAULT_RECEIPT_SETTINGS.headerType;
    const headerImage = headerType ==='image' ? sanitizeReceiptHeaderImageDataUrl(s.headerImage) : null;
    return {
        storeName: s.storeName ?? DEFAULT_RECEIPT_SETTINGS.storeName,
        storeAddress: s.storeAddress ?? DEFAULT_RECEIPT_SETTINGS.storeAddress,
        storeContact: s.storeContact ?? DEFAULT_RECEIPT_SETTINGS.storeContact,
        headerText: s.headerText ??'',
        footerText: s.footerText ?? DEFAULT_RECEIPT_SETTINGS.footerText,
        paperSize: VALID_PAPER_SIZES.includes(s.paperSize) ? s.paperSize : DEFAULT_RECEIPT_SETTINGS.paperSize,
        headerType: headerImage ?'image' :'text',
        headerImage: headerImage,
        headerImageStyle: sanitizeHeaderImageStyle(s.headerImageStyle),
        barcodeSettings: sanitizeBarcodeSettings(s.barcodeSettings),
        advancedSettings: sanitizeAdvancedSettings(s.advancedSettings),
        loyaltyQrSettings: sanitizeLoyaltyQrSettings(s.loyaltyQrSettings),
        taiwanTemplateSettings: sanitizeTaiwanTemplateSettings(s.taiwanTemplateSettings),
        transactionIdSettings: sanitizeTransactionIdSettings(s.transactionIdSettings),
        customizeCount: customizeCount,
        firstCustomizedAt: s.firstCustomizedAt || null,
        freeAttemptsRemaining: Math.max(0, FREE_CUSTOMIZE_LIMIT - customizeCount),
        otpRequired: customizeCount >= FREE_CUSTOMIZE_LIMIT,

        otpSenderConfigured: !!(s.otpSenderEmail && s.otpSenderAppPassword),
        otpSenderEmailMasked: maskEmail(s.otpSenderEmail)
    };
}

function maskEmail(email) {
    if (!email || typeof email !=='string' || !email.includes('@')) return null;
    const [local, domain] = email.split('@');
    const visible = local.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

const UPLOAD_TMP_DIR = path.join(__dirname,'uploads_tmp');
if (!fs.existsSync(UPLOAD_TMP_DIR)) {
    fs.mkdirSync(UPLOAD_TMP_DIR);
}

const productImportUpload = multer({ dest: UPLOAD_TMP_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

const productBulkPhotoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 300 }
});

app.get('/api/categories', (req, res) => {

    const data = readData(FILE_CATEGORIES, DEFAULT_CATEGORIES);
    res.json(data);
});

app.post('/api/categories', (req, res) => {
    const { category } = req.body;
    let categories = readData(FILE_CATEGORIES, DEFAULT_CATEGORIES);

    if (!categories.includes(category)) {
        categories.push(category);
        writeData(FILE_CATEGORIES, categories);
    }
    res.json({ success: true, categories });
});

app.get('/api/receipt-settings', (req, res) => {
    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    res.json(getReceiptSettingsPublic(settings));
});

app.post('/api/receipt-settings/paper-size', requirePermission('receipt_settings_view'), (req, res) => {
    const { paperSize, username } = req.body;

    if (!VALID_PAPER_SIZES.includes(paperSize)) {
        return res.status(400).json({ success: false, message: `Invalid paper size. Choose from: ${VALID_PAPER_SIZES.join(', ')}` });
    }

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).receipt_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id:'REQ-' + Date.now(),
            requester: req.authUser.username,
            type:'RECEIPT_PAPER_SIZE',
            data: { paperSize },
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, `Submitted a Receipt Paper Size change request (${paperSize}) for Admin approval`);
        return res.json({ success: true, pending: true, message:'The paper size request has been submitted for Admin approval.' });
    }

    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    settings.paperSize = paperSize;
    writeData(FILE_RECEIPT_SETTINGS, settings);
    logAction(username || req.authUser.username, `Changed the Receipt Paper Size to ${paperSize}`);

    res.json({ success: true, message:'Paper size updated.', settings: getReceiptSettingsPublic(settings) });
});

app.post('/api/receipt-settings/barcode', requirePermission('receipt_settings_view'), (req, res) => {
    const sanitized = sanitizeBarcodeSettings(req.body.barcodeSettings);
    const { username } = req.body;

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).receipt_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id:'REQ-' + Date.now(),
            requester: req.authUser.username,
            type:'RECEIPT_BARCODE',
            data: { barcodeSettings: sanitized },
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, `Submitted a Receipt Barcode Settings change request for Admin approval`);
        return res.json({ success: true, pending: true, message:'The barcode settings request has been submitted for Admin approval.' });
    }

    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    settings.barcodeSettings = sanitized;
    writeData(FILE_RECEIPT_SETTINGS, settings);
    logAction(username || req.authUser.username, `Updated the Receipt Barcode Settings`);

    res.json({ success: true, message:'Barcode settings updated.', settings: getReceiptSettingsPublic(settings) });
});

app.post('/api/receipt-settings/loyalty-qr', requirePermission('receipt_settings_view'), (req, res) => {
    const sanitized = sanitizeLoyaltyQrSettings(req.body.loyaltyQrSettings);
    const { username } = req.body;

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).receipt_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id:'REQ-' + Date.now(),
            requester: req.authUser.username,
            type:'RECEIPT_LOYALTY_QR',
            data: { loyaltyQrSettings: sanitized },
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, `Submitted a Receipt Loyalty QR Settings change request for Admin approval`);
        return res.json({ success: true, pending: true, message:'The loyalty QR settings request has been submitted for Admin approval.' });
    }

    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    settings.loyaltyQrSettings = sanitized;
    writeData(FILE_RECEIPT_SETTINGS, settings);
    logAction(username || req.authUser.username, `Updated the Receipt Loyalty QR Settings`);

    res.json({ success: true, message:'Loyalty QR settings updated.', settings: getReceiptSettingsPublic(settings) });
});

app.post('/api/receipt-settings/taiwan-template', requirePermission('receipt_settings_view'), (req, res) => {
    const sanitized = sanitizeTaiwanTemplateSettings(req.body.taiwanTemplateSettings);
    const { username } = req.body;

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).receipt_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id:'REQ-' + Date.now(),
            requester: req.authUser.username,
            type:'RECEIPT_TAIWAN_TEMPLATE',
            data: { taiwanTemplateSettings: sanitized },
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, `Submitted a Taiwan Receipt Template change request for Admin approval`);
        return res.json({ success: true, pending: true, message:'The Taiwan Receipt Template request has been submitted for Admin approval.' });
    }

    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    settings.taiwanTemplateSettings = sanitized;
    writeData(FILE_RECEIPT_SETTINGS, settings);
    logAction(username || req.authUser.username, `Updated the Taiwan Receipt Template settings`);

    res.json({ success: true, message:'Taiwan Receipt Template settings updated.', settings: getReceiptSettingsPublic(settings) });
});

app.post('/api/receipt-settings/transaction-id', requirePermission('receipt_settings_view'), (req, res) => {
    const sanitized = sanitizeTransactionIdSettings(req.body.transactionIdSettings);
    const { username } = req.body;

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).receipt_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id:'REQ-' + Date.now(),
            requester: req.authUser.username,
            type:'RECEIPT_TRANSACTION_ID',
            data: { transactionIdSettings: sanitized },
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, `Submitted a Transaction ID Format change request for Admin approval`);
        return res.json({ success: true, pending: true, message:'The Transaction ID Format request has been submitted for Admin approval.' });
    }

    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    settings.transactionIdSettings = sanitized;
    writeData(FILE_RECEIPT_SETTINGS, settings);
    logAction(username || req.authUser.username, `Updated the Transaction ID Format (${sanitized.format})`);

    res.json({ success: true, message:'Transaction ID Format updated.', settings: getReceiptSettingsPublic(settings) });
});

app.post('/api/receipt-settings/advanced', requirePermission('receipt_settings_view'), (req, res) => {
    const sanitized = sanitizeAdvancedSettings(req.body.advancedSettings);
    const { username } = req.body;

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).receipt_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id:'REQ-' + Date.now(),
            requester: req.authUser.username,
            type:'RECEIPT_ADVANCED',
            data: { advancedSettings: sanitized },
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, `Submitted an Advanced Receipt Style change request for Admin approval`);
        return res.json({ success: true, pending: true, message:'The advanced style request has been submitted for Admin approval.' });
    }

    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    settings.advancedSettings = sanitized;
    writeData(FILE_RECEIPT_SETTINGS, settings);
    logAction(username || req.authUser.username, `Updated the Advanced Receipt Style`);

    res.json({ success: true, message:'Advanced receipt style updated.', settings: getReceiptSettingsPublic(settings) });
});

app.post('/api/receipt-settings/otp-sender', rateLimit('otp-sender-config', 5, 15 * 60 * 1000), async (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Action Denied: Admin privileges only can configure the OTP sender.' });
    }

    const { username } = req.body;

    const otpSenderEmail = (req.body.otpSenderEmail ||'').trim();
    const otpSenderAppPassword = (req.body.otpSenderAppPassword ||'').replace(/\s+/g,'');

    const emailPattern =/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(otpSenderEmail)) {
        return res.status(400).json({ success: false, message:'Invalid email address.' });
    }
    if (!otpSenderAppPassword || otpSenderAppPassword.length < 12) {
        return res.status(400).json({ success: false, message:'Invalid App Password (must be a 16-character Gmail App Password, not the normal account password).' });
    }

    try {
        const verifyResult = await verifyMailCredentialsSmart(otpSenderEmail, otpSenderAppPassword);

        const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
        settings.otpSenderEmail = otpSenderEmail;
        settings.otpSenderAppPassword = otpSenderAppPassword;
        writeData(FILE_RECEIPT_SETTINGS, settings);

        logAction(username ||'Unknown', `Configured the OTP Sender Email (${maskEmail(otpSenderEmail)})`);

        let message = 'Sender Gmail + App Password verified and saved.';
        if (verifyResult.viaFallback) {
            message = 'Verified (via Gmail API/HTTPS fallback, since SMTP is blocked here) and saved the Sender Gmail + App Password.';
        } else if (!verifyResult.verified) {
            message = 'Saved the Sender Gmail + App Password (not verified because this cloud host blocks outbound SMTP ports — common on the Render free tier, not a sign of a wrong password). It will still be used when actually sending the OTP.';
        }
        res.json({ success: true, message, settings: getReceiptSettingsPublic(settings) });
    } catch (err) {
        console.error('OTP sender verification failed:', err.message);
        res.status(400).json({ success: false, message: `Unable to verify the Gmail credentials: ${err.message}. Make sure the email is correct and that you're using a 16-character App Password (not the normal password).` });
    }
});

app.post('/api/receipt-settings/otp-sender/clear', rateLimit('otp-sender-clear', 5, 15 * 60 * 1000), (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Action Denied: Admin privileges only can clear the OTP sender.' });
    }

    const { username } = req.body;
    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    const hadEmail = maskEmail(settings.otpSenderEmail);

    settings.otpSenderEmail = null;
    settings.otpSenderAppPassword = null;
    writeData(FILE_RECEIPT_SETTINGS, settings);

    logAction(username ||'Unknown', `Cleared the OTP Sender Email${hadEmail ? ` (previously: ${hadEmail})` :''}`);
    res.json({ success: true, message:'The configured Sender Gmail + App Password has been cleared.', settings: getReceiptSettingsPublic(settings) });
});

app.post('/api/receipt-settings/request-otp', rateLimit('otp-request', 3, 10 * 60 * 1000), requirePermission('receipt_settings_view'), async (req, res) => {
    const { username } = req.body;
    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);

    if ((settings.customizeCount || 0) < FREE_CUSTOMIZE_LIMIT) {

        return res.json({ success: true, otpNeeded: false, message:'You still have free customizations left — no OTP needed.' });
    }

    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    settings.pendingOtp = {
        code: otpCode,
        expiresAt: Date.now() + OTP_TTL_MS,
        requestedBy: username ||'Unknown'
    };
    writeData(FILE_RECEIPT_SETTINGS, settings);

    const otpMailCreds = getOtpMailCredentials(settings);

    if (!otpMailCreds) {
        console.error('⚠️ Unable to send the Receipt Customization OTP: no Sender Gmail / App Password has been configured yet in the Receipt Customization panel (or OTP_MAIL_USER/OTP_MAIL_PASS env vars).');
        return res.status(500).json({
            success: false,
            message:'The OTP sender email is not configured yet. Please set up the Gmail + App Password in the Receipt Customization panel first (this is showing now because the 2 free attempts have been used up).'
        });
    }
    const senderUser = otpMailCreds.user;
    const senderPass = otpMailCreds.pass;

    try {
        await sendMailSmart(senderUser, senderPass, {
            from: `"OmniPOS Receipt Customization" <${senderUser}>`,
            to: OTP_RECIPIENT_EMAIL,
            subject: `🔐 OmniPOS: OTP for Receipt Customization Request`,
            text: `Someone requested a receipt customization (Store Name/Address/Contact/Header/Footer) after using up the 2 free attempts.\n\n` +
                  `Requested by: ${username ||'Unknown'}\n` +
                  `OTP Code: ${otpCode}\n` +
                  `This will expire in 10 minutes.\n\n` +
                  `If you did not request this, you can ignore this email.`
        });

        logAction(username ||'Unknown','Requested an OTP for Receipt Customization (2 free attempts used up)');
        res.json({ success: true, otpNeeded: true, message:'The OTP was successfully sent to the registered email.' });
    } catch (err) {
        console.error('OTP send failure:', err);
        res.status(500).json({ success: false, message: `Failed to send the OTP: ${err.message}` });
    }
});

app.post('/api/receipt-settings', rateLimit('otp-verify-save', 120, 10 * 60 * 1000), requirePermission('receipt_settings_view'), (req, res) => {
    const { storeName, storeAddress, storeContact, headerText, footerText, headerType, headerImage, headerImageStyle, otp, username } = req.body;

    if (!storeName || !storeName.trim()) {
        return res.status(400).json({ success: false, message:'Store Name is required.' });
    }

    const normalizedHeaderType = VALID_HEADER_TYPES.includes(headerType) ? headerType :'text';
    let sanitizedHeaderImage = null;
    if (normalizedHeaderType ==='image') {
        sanitizedHeaderImage = sanitizeReceiptHeaderImageDataUrl(headerImage);
        if (!sanitizedHeaderImage) {
            return res.status(400).json({ success: false, message:'Invalid Header Image — please upload a PNG/JPEG/WEBP that does not exceed the size limit.' });
        }
    }
    const sanitizedHeaderImageStyle = sanitizeHeaderImageStyle(headerImageStyle);

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).receipt_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id:'REQ-' + Date.now(),
            requester: req.authUser.username,
            type:'RECEIPT_UPDATE',
            data: {
                storeName: storeName.trim(),
                storeAddress: (storeAddress ||'').trim(),
                storeContact: (storeContact ||'').trim(),
                headerText: (headerText ||'').trim(),
                footerText: (footerText ||'').trim(),
                headerType: normalizedHeaderType,
                headerImage: sanitizedHeaderImage,
                headerImageStyle: sanitizedHeaderImageStyle
            },
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, `Submitted a Receipt Customization update request for Admin approval`);
        return res.json({ success: true, pending: true, message:'The Receipt Customization request has been submitted for Admin approval.' });
    }

    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    const currentCount = settings.customizeCount || 0;
    const needsOtp = currentCount >= FREE_CUSTOMIZE_LIMIT;

    if (needsOtp) {
        if (!otp || !String(otp).trim()) {
            return res.json({ success: false, requiresOtp: true, message:'OTP verification is now required to continue customizing the receipt.' });
        }

        const pending = settings.pendingOtp;
        if (!pending || !pending.code) {
            return res.status(400).json({ success: false, requiresOtp: true, message:'No active OTP request. Please request a new OTP first.' });
        }
        if (Date.now() > pending.expiresAt) {
            settings.pendingOtp = null;
            writeData(FILE_RECEIPT_SETTINGS, settings);
            return res.status(400).json({ success: false, requiresOtp: true, message:'The OTP code has expired. Please request a new one.' });
        }
        if (String(otp).trim() !== pending.code) {
            return res.status(400).json({ success: false, requiresOtp: true, message:'Incorrect OTP code.' });
        }

        settings.pendingOtp = null;
    }

    settings.storeName = storeName.trim();
    settings.storeAddress = (storeAddress ||'').trim();
    settings.storeContact = (storeContact ||'').trim();
    settings.headerText = (headerText ||'').trim();
    settings.footerText = (footerText ||'').trim() || DEFAULT_RECEIPT_SETTINGS.footerText;
    settings.headerType = normalizedHeaderType;
    settings.headerImage = normalizedHeaderType ==='image' ? sanitizedHeaderImage : null;
    settings.headerImageStyle = sanitizedHeaderImageStyle;

    settings.customizeCount = currentCount + 1;

    if (!settings.firstCustomizedAt) {
        settings.firstCustomizedAt = new Date().toISOString();
    }

    writeData(FILE_RECEIPT_SETTINGS, settings);
    logAction(username ||'Unknown', `Updated the Receipt Customization details (attempt #${settings.customizeCount})`);

    res.json({ success: true, message:'Receipt details updated successfully.', settings: getReceiptSettingsPublic(settings) });
});

app.post('/api/receipt-settings/request-reset-otp', rateLimit('otp-reset-request', 3, 10 * 60 * 1000), requirePermission('receipt_settings_view'), async (req, res) => {
    const { username } = req.body;
    const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);

    if ((settings.customizeCount || 0) < FREE_CUSTOMIZE_LIMIT) {
        return res.status(400).json({
            success: false,
            message: `You still have ${FREE_CUSTOMIZE_LIMIT - (settings.customizeCount || 0)} free customization(s) left — no need to reset the counter yet.`
        });
    }

    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message: 'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    try {
        const featureData = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(featureData);
        const storeName = settings.storeName || null;

        const relayRes = await relayFetch(`${RELAY_URL}/relay/request-receipt-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId, storeName, requestedBy: username || 'Unknown' })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayData.success) {
            logAction(username || 'Unknown', 'Requested an OTP (via Relay) to reset the Receipt Customization counter');
        }
        res.status(relayRes.status).json(relayData);
    } catch (err) {
        console.error('Hindi ma-abot ang Unlock Relay (receipt-reset):', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}.` });
    }
});

app.post('/api/receipt-settings/reset-counter', rateLimit('otp-reset-verify', 120, 10 * 60 * 1000), requirePermission('receipt_settings_view'), async (req, res) => {
    const { otp, username } = req.body;

    if (!otp || !String(otp).trim()) {
        return res.status(400).json({ success: false, message:'The OTP code is required.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message: 'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    try {
        const featureData = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(featureData);

        const relayRes = await relayFetch(`${RELAY_URL}/relay/confirm-receipt-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId, otp: String(otp).trim() })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayData.pending) {
            return res.status(202).json({ success: false, pending: true, message: relayData.message || 'Tama ang OTP! Naghihintay pa lang ng approval mula sa developer.' });
        }

        if (!relayData.success) {
            return res.status(relayRes.status === 200 ? 400 : relayRes.status).json(relayData);
        }

        if (!verifyReceiptResetTicket(relayData.ticket, installationId)) {
            console.error('⚠️ Natanggap ang isang receipt-reset ticket mula sa relay pero HINDI valid ang signature nito.');
            return res.status(400).json({ success: false, message: 'Hindi valid ang reset ticket na natanggap. Subukan ulit.' });
        }

        const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
        settings.customizeCount = 0;
        settings.pendingResetOtp = null;
        settings.resetHistory = Array.isArray(settings.resetHistory) ? settings.resetHistory : [];
        settings.resetHistory.push({ resetAt: new Date().toISOString(), resetBy: username || 'Unknown' });

        writeData(FILE_RECEIPT_SETTINGS, settings);
        logAction(username || 'Unknown', 'Reset the Receipt Customization counter (back to 2 free attempts, via Relay-verified OTP)');

        res.json({ success: true, message:'Counter reset — 2 free customizations are available again.', settings: getReceiptSettingsPublic(settings) });
    } catch (err) {
        console.error('Hindi ma-abot ang Unlock Relay (receipt-reset):', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}.` });
    }
});

const FILE_STORE_SETTINGS = 'storeSettings';

const DEFAULT_STORE_SETTINGS = {
    currencyCode: 'PHP',
    currencySymbol: '₱',
    taxEnabled: false,
    taxLabel: 'VAT',
    taxRate: 12,
    pricesIncludeTax: true,
    paymentMethods: { cash: true, gcash: false, maya: false, card: false, bankTransfer: false },

    gcashQrImage: null,
    mayaQrImage: null,
    seniorPwdDiscountEnabled: false,
    seniorPwdDiscountRate: 20,
    loyaltyEnabled: true,
    loyaltyEarnRate: 100,
    loyaltyPointValue: 1,

    branchName: '',
    branchGroupKey: '',
    updatedAt: null
};

const VALID_CURRENCY_CODES = ['PHP', 'USD', 'EUR', 'JPY', 'SGD'];

const MAX_QR_IMAGE_DATAURL_LENGTH = 400 * 1024;

function sanitizeQrImageDataUrl(val) {
    if (typeof val !== 'string' || !val.trim()) return null;
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(val)) return null;
    if (val.length > MAX_QR_IMAGE_DATAURL_LENGTH) return null;
    return val;
}

function getStoreSettingsPublic(rawSettings) {
    const s = rawSettings || DEFAULT_STORE_SETTINGS;
    const pm = s.paymentMethods || DEFAULT_STORE_SETTINGS.paymentMethods;
    return {
        currencyCode: VALID_CURRENCY_CODES.includes(s.currencyCode) ? s.currencyCode : DEFAULT_STORE_SETTINGS.currencyCode,
        currencySymbol: s.currencySymbol || DEFAULT_STORE_SETTINGS.currencySymbol,
        taxEnabled: !!s.taxEnabled,
        taxLabel: s.taxLabel || DEFAULT_STORE_SETTINGS.taxLabel,
        taxRate: Number.isFinite(s.taxRate) ? s.taxRate : DEFAULT_STORE_SETTINGS.taxRate,
        pricesIncludeTax: s.pricesIncludeTax !== false,
        paymentMethods: {
            cash: pm.cash !== false,
            gcash: !!pm.gcash,
            maya: !!pm.maya,
            card: !!pm.card,
            bankTransfer: !!pm.bankTransfer
        },
        gcashQrImage: sanitizeQrImageDataUrl(s.gcashQrImage),
        mayaQrImage: sanitizeQrImageDataUrl(s.mayaQrImage),
        seniorPwdDiscountEnabled: !!s.seniorPwdDiscountEnabled,
        seniorPwdDiscountRate: Number.isFinite(s.seniorPwdDiscountRate) ? s.seniorPwdDiscountRate : DEFAULT_STORE_SETTINGS.seniorPwdDiscountRate,
        loyaltyEnabled: s.loyaltyEnabled !== false,
        loyaltyEarnRate: Number.isFinite(s.loyaltyEarnRate) && s.loyaltyEarnRate > 0 ? s.loyaltyEarnRate : DEFAULT_STORE_SETTINGS.loyaltyEarnRate,
        loyaltyPointValue: Number.isFinite(s.loyaltyPointValue) && s.loyaltyPointValue >= 0 ? s.loyaltyPointValue : DEFAULT_STORE_SETTINGS.loyaltyPointValue,
        branchName: typeof s.branchName === 'string' ? s.branchName.trim().slice(0, 60) : '',
        branchGroupKey: typeof s.branchGroupKey === 'string' ? s.branchGroupKey.trim().slice(0, 120) : '',
        updatedAt: s.updatedAt || null
    };
}

app.get('/api/store-settings', (req, res) => {
    const settings = readData(FILE_STORE_SETTINGS, DEFAULT_STORE_SETTINGS);
    res.json(getStoreSettingsPublic(settings));
});

app.post('/api/store-settings', requirePermission('store_settings_view'), (req, res) => {
    const { username } = req.body;

    for (const [field, label] of [['gcashQrImage', 'GCash QR'], ['mayaQrImage', 'Maya QR']]) {
        const raw = (req.body || {})[field];
        if (raw !== undefined && raw !== null && raw !== '' && sanitizeQrImageDataUrl(raw) === null) {
            return res.status(400).json({
                success: false,
                message: `Di-wasto o masyadong malaki ang ${label} image (max ~400KB, PNG/JPEG/WebP lang). Subukang mag-upload ng mas maliit/naka-compress na larawan.`
            });
        }
    }

    const incoming = getStoreSettingsPublic(req.body || {});

    if (!VALID_CURRENCY_CODES.includes(incoming.currencyCode)) {
        return res.status(400).json({ success: false, message: `Di-wastong currency. Pumili sa: ${VALID_CURRENCY_CODES.join(', ')}` });
    }
    if (incoming.taxRate < 0 || incoming.taxRate > 100) {
        return res.status(400).json({ success: false, message: 'Ang tax rate ay dapat nasa pagitan ng 0 at 100.' });
    }
    if (incoming.seniorPwdDiscountRate < 0 || incoming.seniorPwdDiscountRate > 100) {
        return res.status(400).json({ success: false, message: 'Ang Senior/PWD discount rate ay dapat nasa pagitan ng 0 at 100.' });
    }
    if (incoming.loyaltyEarnRate <= 0) {
        return res.status(400).json({ success: false, message: 'Ang Loyalty earn rate (₱ kada point) ay dapat higit sa 0.' });
    }
    if (incoming.loyaltyPointValue < 0) {
        return res.status(400).json({ success: false, message: 'Ang Loyalty point value ay hindi puwedeng negative.' });
    }

    const isAdminRole = (req.authUser.role || '').toLowerCase() === 'admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).store_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id: 'REQ-' + Date.now(),
            requester: req.authUser.username,
            type: 'STORE_SETTINGS_UPDATE',
            data: incoming,
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, 'Nag-submit ng Store & Sales Settings change request para sa Admin approval');
        return res.json({ success: true, pending: true, message: 'Isinumite ang Store & Sales Settings request para sa Admin approval.' });
    }

    incoming.updatedAt = new Date().toISOString();
    writeData(FILE_STORE_SETTINGS, incoming);
    logAction(username || req.authUser.username, 'Binago ang Store & Sales Settings (tax/payment methods/discount)');

    res.json({ success: true, message: 'Na-update ang Store & Sales Settings.', settings: incoming });
});

const FILE_UX_SETTINGS = 'uxSettings';

const DEFAULT_UX_SETTINGS = {
    darkModeDefault: false,
    lowStockAlertThreshold: 10,
    scannerSound: true,
    dashboardWidgets: { salesToday: true, lowStock: true, topProducts: true, recentTransactions: true },
    updatedAt: null
};

function getUxSettingsPublic(rawSettings) {
    const s = rawSettings || DEFAULT_UX_SETTINGS;
    const w = s.dashboardWidgets || DEFAULT_UX_SETTINGS.dashboardWidgets;
    return {
        darkModeDefault: !!s.darkModeDefault,
        lowStockAlertThreshold: Number.isFinite(s.lowStockAlertThreshold) ? s.lowStockAlertThreshold : DEFAULT_UX_SETTINGS.lowStockAlertThreshold,
        scannerSound: s.scannerSound !== false,
        dashboardWidgets: {
            salesToday: w.salesToday !== false,
            lowStock: w.lowStock !== false,
            topProducts: w.topProducts !== false,
            recentTransactions: w.recentTransactions !== false
        },
        updatedAt: s.updatedAt || null
    };
}

app.get('/api/ux-settings', (req, res) => {
    const settings = readData(FILE_UX_SETTINGS, DEFAULT_UX_SETTINGS);
    res.json(getUxSettingsPublic(settings));
});

app.post('/api/ux-settings', requirePermission('ux_settings_view'), (req, res) => {
    const { username } = req.body;
    const incoming = getUxSettingsPublic(req.body || {});

    if (incoming.lowStockAlertThreshold < 0) {
        return res.status(400).json({ success: false, message: 'The low-stock threshold cannot be negative.' });
    }

    const isAdminRole = (req.authUser.role || '').toLowerCase() === 'admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).ux_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id: 'REQ-' + Date.now(),
            requester: req.authUser.username,
            type: 'UX_SETTINGS_UPDATE',
            data: incoming,
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, 'Submitted an Appearance/UX Settings change request for Admin approval');
        return res.json({ success: true, pending: true, message: 'The Appearance/UX Settings request has been submitted for Admin approval.' });
    }

    incoming.updatedAt = new Date().toISOString();
    writeData(FILE_UX_SETTINGS, incoming);
    logAction(username || req.authUser.username, 'Updated Appearance/UX Settings (dark mode/low-stock/widgets)');

    res.json({ success: true, message: 'Appearance/UX Settings have been updated.', settings: incoming });
});

const FILE_ADVANCED_SETTINGS = 'advancedSettings';

const DEFAULT_ADVANCED_SETTINGS = {
    idleAutoLockEnabled: false,
    idleAutoLockMinutes: 5,
    customerDisplayEnabled: false,

    customerDisplayCompactThreshold: 8,
    saleWebhookEnabled: false,
    saleWebhookUrl: '',

    twoFactorLoginEnabled: false,
    twoFactorRecipientEmail: '',

    fraudDetectionEnabled: false,
    fraudDetectionSensitivity: 'medium',
    fraudAlertEmailEnabled: false,
    fraudAlertRecipientEmail: '',
    updatedAt: null
};

function getAdvancedSettingsPublic(rawSettings) {
    const s = rawSettings || DEFAULT_ADVANCED_SETTINGS;
    let minutes = parseInt(s.idleAutoLockMinutes, 10);
    if (!Number.isFinite(minutes) || minutes < 1) minutes = DEFAULT_ADVANCED_SETTINGS.idleAutoLockMinutes;
    if (minutes > 120) minutes = 120;
    let webhookUrl = typeof s.saleWebhookUrl === 'string' ? s.saleWebhookUrl.trim() : '';

    if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) webhookUrl = '';

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let twoFactorRecipientEmail = typeof s.twoFactorRecipientEmail === 'string' ? s.twoFactorRecipientEmail.trim() : '';
    if (twoFactorRecipientEmail && !emailPattern.test(twoFactorRecipientEmail)) twoFactorRecipientEmail = '';

    let compactThreshold = parseInt(s.customerDisplayCompactThreshold, 10);
    if (!Number.isFinite(compactThreshold) || compactThreshold < 3) compactThreshold = DEFAULT_ADVANCED_SETTINGS.customerDisplayCompactThreshold;
    if (compactThreshold > 50) compactThreshold = 50;

    const validSensitivities = ['low', 'medium', 'high'];
    let fraudDetectionSensitivity = validSensitivities.includes(s.fraudDetectionSensitivity) ? s.fraudDetectionSensitivity : 'medium';
    let fraudAlertRecipientEmail = typeof s.fraudAlertRecipientEmail === 'string' ? s.fraudAlertRecipientEmail.trim() : '';
    if (fraudAlertRecipientEmail && !emailPattern.test(fraudAlertRecipientEmail)) fraudAlertRecipientEmail = '';

    return {
        idleAutoLockEnabled: !!s.idleAutoLockEnabled,
        idleAutoLockMinutes: minutes,
        customerDisplayEnabled: !!s.customerDisplayEnabled,
        customerDisplayCompactThreshold: compactThreshold,
        saleWebhookEnabled: !!s.saleWebhookEnabled && !!webhookUrl,
        saleWebhookUrl: webhookUrl,

        twoFactorLoginEnabled: !!s.twoFactorLoginEnabled && !!twoFactorRecipientEmail,
        twoFactorRecipientEmail,
        fraudDetectionEnabled: !!s.fraudDetectionEnabled,
        fraudDetectionSensitivity,

        fraudAlertEmailEnabled: !!s.fraudAlertEmailEnabled && !!fraudAlertRecipientEmail,
        fraudAlertRecipientEmail,
        updatedAt: s.updatedAt || null
    };
}

app.get('/api/advanced-settings', (req, res) => {
    const settings = readData(FILE_ADVANCED_SETTINGS, DEFAULT_ADVANCED_SETTINGS);
    res.json(getAdvancedSettingsPublic(settings));
});

app.post('/api/advanced-settings', requirePermission('advanced_settings_view'), (req, res) => {
    const { username } = req.body;
    const incoming = getAdvancedSettingsPublic(req.body || {});

    if (req.body && req.body.saleWebhookEnabled && !incoming.saleWebhookUrl) {
        return res.status(400).json({ success: false, message: 'Enter a valid http:// or https:// webhook URL to enable the Sale Webhook.' });
    }
    if (req.body && req.body.twoFactorLoginEnabled && !incoming.twoFactorRecipientEmail) {
        return res.status(400).json({ success: false, message: 'Maglagay ng valid na email address para makatanggap ng Admin Login OTP bago i-enable ang Two-Factor Authentication.' });
    }
    if (req.body && req.body.fraudAlertEmailEnabled && !incoming.fraudAlertRecipientEmail) {
        return res.status(400).json({ success: false, message: 'Maglagay ng valid na email address para makatanggap ng Fraud Alert email bago i-enable ang email notifications.' });
    }

    const isAdminRole = (req.authUser.role || '').toLowerCase() === 'admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).advanced_settings_direct_apply;

    if (!canApplyDirectly) {
        let requests = readData(FILE_REQUESTS);
        requests.push({
            id: 'REQ-' + Date.now(),
            requester: req.authUser.username,
            type: 'ADVANCED_SETTINGS_UPDATE',
            data: incoming,
            timestamp: new Date().toLocaleString()
        });
        writeData(FILE_REQUESTS, requests);
        logAction(req.authUser.username, 'Submitted an Advanced Settings change request for Admin approval');
        return res.json({ success: true, pending: true, message: 'The Advanced Settings request has been submitted for Admin approval.' });
    }

    incoming.updatedAt = new Date().toISOString();
    writeData(FILE_ADVANCED_SETTINGS, incoming);
    logAction(username || req.authUser.username, 'Updated Advanced Settings (idle auto-lock/customer display/sale webhook/2FA/fraud detection)');

    res.json({ success: true, message: 'Advanced Settings have been updated.', settings: incoming });
});

const FILE_FRAUD_ALERTS = 'fraudAlerts';
const FRAUD_ALERTS_MAX_STORED = 500;

const fraudVelocityLog = new Map();

function getFraudSensitivityThresholds(sensitivity) {
    const presets = {
        low: { zScore: 3.5, minDiscountPct: 40, voidWindowCount: 6, refundWindowCount: 5, largeRefundMultiplier: 6, unusualHourStart: 1, unusualHourEnd: 4 },
        medium: { zScore: 2.5, minDiscountPct: 30, voidWindowCount: 4, refundWindowCount: 3, largeRefundMultiplier: 4, unusualHourStart: 0, unusualHourEnd: 5 },
        high: { zScore: 1.8, minDiscountPct: 20, voidWindowCount: 3, refundWindowCount: 2, largeRefundMultiplier: 3, unusualHourStart: 23, unusualHourEnd: 5 }
    };
    return presets[sensitivity] || presets.medium;
}

function pushFraudAlert(alert) {
    let alerts = readData(FILE_FRAUD_ALERTS, []);
    const record = {
        id: 'FRD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }),
        isoTimestamp: new Date().toISOString(),
        reviewed: false,
        reviewedBy: null,
        reviewedAt: null,
        note: '',
        ...alert
    };
    alerts.unshift(record);
    if (alerts.length > FRAUD_ALERTS_MAX_STORED) alerts = alerts.slice(0, FRAUD_ALERTS_MAX_STORED);
    writeData(FILE_FRAUD_ALERTS, alerts);

    logAction('AI Fraud Detection', `[${record.severity.toUpperCase()}] ${record.type} — ${record.summary}`);

    try {
        const advSettings = getAdvancedSettingsPublic(readData(FILE_ADVANCED_SETTINGS, DEFAULT_ADVANCED_SETTINGS));
        if (advSettings.fraudAlertEmailEnabled && advSettings.fraudAlertRecipientEmail) {
            const mailCreds = getOtpMailCredentials();
            if (mailCreds) {
                sendMailSmart(mailCreds.user, mailCreds.pass, {
                    from: `"OmniPOS Fraud Detection" <${mailCreds.user}>`,
                    to: advSettings.fraudAlertRecipientEmail,
                    subject: `🚨 OmniPOS Fraud Alert [${record.severity.toUpperCase()}]: ${record.type}`,
                    text: `May na-flag na anomaly ang AI Fraud Detection Engine.\n\n`
                        + `Type: ${record.type}\n`
                        + `Severity: ${record.severity}\n`
                        + `Cashier: ${record.cashier || 'N/A'}\n`
                        + `Details: ${record.summary}\n`
                        + `Timestamp: ${record.timestamp}\n\n`
                        + `Buksan ang Users > Fraud Alerts tab sa OmniPOS para sa detalye at para markahan bilang reviewed.`
                }).catch(err => console.error('Fraud alert email delivery failed:', err.message));
            }
        }
    } catch (mailErr) {
        console.error('Fraud alert email error:', mailErr.message);
    }

    return record;
}

function recordAndCountVelocity(cashier, kind, windowMinutes) {
    const key = `${cashier || 'unknown'}:${kind}`;
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    let events = (fraudVelocityLog.get(key) || []).filter(ts => now - ts < windowMs);
    events.push(now);
    fraudVelocityLog.set(key, events);
    return events.length;
}

function checkDiscountAnomaly(transaction, thresholds) {
    const cashier = transaction.cashier;
    const grossSubtotal = (transaction.items || []).reduce((sum, it) => sum + (parseFloat(it.price) || 0) * (parseInt(it.quantity) || 0), 0);
    if (grossSubtotal <= 0) return null;

    const totalDiscount = (parseFloat(transaction.discount) || 0) + (transaction.items || []).reduce((s, it) => s + (parseFloat(it.itemDiscount) || 0), 0);
    const currentPct = (totalDiscount / grossSubtotal) * 100;
    if (currentPct < thresholds.minDiscountPct) return null;

    const history = readData(FILE_TRANSACTIONS, [])
        .filter(t => t.cashier === cashier && t.id !== transaction.id)
        .slice(0, 30)
        .map(t => {
            const g = (t.items || []).reduce((sum, it) => sum + (parseFloat(it.price) || 0) * (parseInt(it.quantity) || 0), 0);
            if (g <= 0) return null;
            const d = (parseFloat(t.discount) || 0) + (t.items || []).reduce((s, it) => s + (parseFloat(it.itemDiscount) || 0), 0);
            return (d / g) * 100;
        })
        .filter(v => v !== null);

    if (history.length < 5) {

        if (currentPct >= thresholds.minDiscountPct * 1.5) {
            return { severity: 'medium', summary: `Cashier ${cashier} gave a ${currentPct.toFixed(1)}% discount on Transaction ${transaction.id} — no sufficient sales history yet to baseline, flagged on absolute threshold alone.` };
        }
        return null;
    }

    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    const variance = history.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / history.length;
    const stddev = Math.sqrt(variance);
    if (stddev < 1) return currentPct >= thresholds.minDiscountPct * 1.5 ? { severity: 'medium', summary: `Cashier ${cashier} gave a ${currentPct.toFixed(1)}% discount on Transaction ${transaction.id} vs. a near-constant historical average of ${mean.toFixed(1)}%.` } : null;

    const zScore = (currentPct - mean) / stddev;
    if (zScore >= thresholds.zScore) {
        const severity = zScore >= thresholds.zScore * 1.6 ? 'high' : 'medium';
        return { severity, summary: `Cashier ${cashier} gave a ${currentPct.toFixed(1)}% discount on Transaction ${transaction.id} — ${zScore.toFixed(1)}σ above their own ${mean.toFixed(1)}% average (last ${history.length} sales).` };
    }
    return null;
}

function checkUnusualHour(transaction, thresholds) {
    const hour = new Date().getHours();
    const inWindow = thresholds.unusualHourStart <= thresholds.unusualHourEnd
        ? (hour >= thresholds.unusualHourStart && hour < thresholds.unusualHourEnd)
        : (hour >= thresholds.unusualHourStart || hour < thresholds.unusualHourEnd);
    if (!inWindow) return null;
    return { severity: 'low', summary: `Transaction ${transaction.id} by ${transaction.cashier} was processed at an unusual hour (${new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' })}).` };
}

function runFraudChecks(kind, ctx) {
    try {
        const advSettings = getAdvancedSettingsPublic(readData(FILE_ADVANCED_SETTINGS, DEFAULT_ADVANCED_SETTINGS));
        if (!advSettings.fraudDetectionEnabled) return;
        const thresholds = getFraudSensitivityThresholds(advSettings.fraudDetectionSensitivity);

        if (kind === 'sale') {
            const discountFlag = checkDiscountAnomaly(ctx.transaction, thresholds);
            if (discountFlag) {
                pushFraudAlert({ type: 'discount_anomaly', cashier: ctx.transaction.cashier, transactionId: ctx.transaction.id, ...discountFlag });
            }
            const hourFlag = checkUnusualHour(ctx.transaction, thresholds);
            if (hourFlag) {
                pushFraudAlert({ type: 'unusual_hour_sale', cashier: ctx.transaction.cashier, transactionId: ctx.transaction.id, ...hourFlag });
            }
        } else if (kind === 'void') {
            const count = recordAndCountVelocity(ctx.cashier, 'void', 30);
            if (count >= thresholds.voidWindowCount) {
                pushFraudAlert({
                    type: 'void_velocity', cashier: ctx.cashier, transactionId: ctx.transactionId,
                    severity: count >= thresholds.voidWindowCount * 1.5 ? 'high' : 'medium',
                    summary: `${ctx.cashier || 'Unknown'} has voided ${count} transaction(s) in the last 30 minutes (latest: ${ctx.transactionId}, ₱${(ctx.voidedAmount || 0).toFixed(2)}).`
                });
            }
        } else if (kind === 'refund') {
            const count = recordAndCountVelocity(ctx.cashier, 'refund', 30);
            if (count >= thresholds.refundWindowCount) {
                pushFraudAlert({
                    type: 'refund_velocity', cashier: ctx.cashier, transactionId: ctx.transactionId,
                    severity: count >= thresholds.refundWindowCount * 1.5 ? 'high' : 'medium',
                    summary: `${ctx.cashier || 'Unknown'} has processed ${count} refund(s) in the last 30 minutes (latest: ${ctx.transactionId}, ₱${(ctx.refundAmount || 0).toFixed(2)}).`
                });
            }

            const allTx = readData(FILE_TRANSACTIONS, []);
            const avgTxTotal = allTx.length > 0 ? allTx.reduce((s, t) => s + (parseFloat(t.total) || 0), 0) / allTx.length : 0;
            if (avgTxTotal > 0 && ctx.refundAmount >= avgTxTotal * thresholds.largeRefundMultiplier) {
                pushFraudAlert({
                    type: 'large_refund', cashier: ctx.cashier, transactionId: ctx.transactionId,
                    severity: 'high',
                    summary: `Refund of ₱${ctx.refundAmount.toFixed(2)} on Transaction ${ctx.transactionId} is ${(ctx.refundAmount / avgTxTotal).toFixed(1)}x the store's average sale (₱${avgTxTotal.toFixed(2)}).`
                });
            }
        }
    } catch (err) {

        console.error('Fraud detection engine error:', err.message);
    }
}

app.get('/api/fraud-alerts', requirePermission('fraud_alerts_view'), (req, res) => {
    const alerts = readData(FILE_FRAUD_ALERTS, []);
    const unreviewedCount = alerts.filter(a => !a.reviewed).length;
    res.json({ success: true, alerts, unreviewedCount });
});

app.post('/api/fraud-alerts/:id/review', requirePermission('fraud_alerts_view'), rateLimit('fraud-alert-review', 60, 10 * 60 * 1000), (req, res) => {
    const { id } = req.params;
    const { note, reviewedBy } = req.body;

    let alerts = readData(FILE_FRAUD_ALERTS, []);
    const alert = alerts.find(a => a.id === id);
    if (!alert) return res.status(404).json({ success: false, message: 'Hindi nahanap ang Fraud Alert.' });

    alert.reviewed = true;
    alert.reviewedBy = reviewedBy || req.authUser.username;
    alert.reviewedAt = new Date().toISOString();
    alert.note = (note || '').trim();

    writeData(FILE_FRAUD_ALERTS, alerts);
    logAction(req.authUser.username, `Marked Fraud Alert ${id} (${alert.type}) as reviewed`);

    res.json({ success: true, message: 'Na-mark bilang reviewed ang Fraud Alert.', alert });
});

app.post('/api/verify-password', rateLimit('verify-password', 10, 5 * 60 * 1000), (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'Password is required.' });

    let users = readData(FILE_USERS);
    const me = users.find(u => u.username.toLowerCase() === req.authUser.username.toLowerCase());
    if (!me) return res.status(404).json({ success: false, message: 'Account not found.' });

    let isMatch = false;
    try { isMatch = bcrypt.compareSync(password, me.password); }
    catch (e) { isMatch = (password === me.password); }

    if (!isMatch) return res.status(403).json({ success: false, message: 'Incorrect password.' });
    res.json({ success: true });
});

const FILE_FEATURE_UNLOCKS ='featureUnlocks';

const FILE_CONNECTIVITY_MODE ='connectivityMode';
const DEFAULT_CONNECTIVITY_MODE = { mode: 'online', changedAt: null };

function getConnectivityMode() {
    const data = readData(FILE_CONNECTIVITY_MODE, DEFAULT_CONNECTIVITY_MODE);
    return (data && data.mode === 'offline') ? 'offline' : 'online';
}

function setConnectivityMode(mode) {
    const normalized = mode === 'offline' ? 'offline' : 'online';
    writeData(FILE_CONNECTIVITY_MODE, { mode: normalized, changedAt: Date.now() });
    return normalized;
}

const DEFAULT_FEATURE_UNLOCKS = {
    installationId: null,
    hardwareFingerprint: null,
    tokens: {},
    lockedAttempts: 0,

    deviceVerified: false,
    verifiedFingerprint: null,
    firstVerifiedAt: null,
    lastVerifiedAt: null
};

const RELAY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEARoRImC1WH3GgR6yO9ZeRYmiMsDvHfytsKQ2f/lwVzfU=
-----END PUBLIC KEY-----
`;
const RELAY_PUBLIC_KEY = crypto.createPublicKey(RELAY_PUBLIC_KEY_PEM);

const RELAY_URL = process.env.RELAY_URL ||'http://127.0.0.1:4477';

const RELAY_API_KEY = process.env.RELAY_API_KEY || null;
if (!RELAY_API_KEY) {
    console.warn('⚠️  Walang RELAY_API_KEY na naka-set sa .env — hindi magfa-function ang feature unlock requests hangga\'t hindi ito nalagyan.');
}

const IMAGE_SEARCH_PROVIDER = (process.env.IMAGE_SEARCH_PROVIDER || '').trim().toLowerCase();
const IMAGE_SEARCH_API_KEY = (process.env.IMAGE_SEARCH_API_KEY || '').trim();
const IMAGE_SEARCH_CX = (process.env.IMAGE_SEARCH_CX || '').trim();

function isImageSearchConfigured() {
    if (!IMAGE_SEARCH_PROVIDER || !IMAGE_SEARCH_API_KEY) return false;
    if (IMAGE_SEARCH_PROVIDER === 'google' && !IMAGE_SEARCH_CX) return false;
    return ['google', 'bing', 'serpapi'].includes(IMAGE_SEARCH_PROVIDER);
}

const IMAGE_SEARCH_BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isPrivateOrReservedIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
}

function isPrivateOrReservedIPv6(ip) {
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::') return true;
    if (norm.startsWith('fe80:')) return true;
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true;
    if (norm.startsWith('::ffff:')) {
        const v4 = norm.split(':').pop();
        if (net.isIP(v4) === 4) return isPrivateOrReservedIPv4(v4);
    }
    return false;
}

function isBlockedImageSearchIP(ip) {
    const version = net.isIP(ip);
    if (version === 4) return isPrivateOrReservedIPv4(ip);
    if (version === 6) return isPrivateOrReservedIPv6(ip);
    return true;
}

function ssrfSafeLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err);
        const safeAddrs = (addresses || []).filter(a => !isBlockedImageSearchIP(a.address));
        if (!safeAddrs.length) return callback(new Error('Hindi pinapayagan ang address na ito (internal/private IP o hindi ma-resolve).'));

        if (options && options.all) {
            return callback(null, safeAddrs);
        }
        callback(null, safeAddrs[0].address, safeAddrs[0].family);
    });
}

function assertPublicHttpUrlSync(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Invalid na image URL.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('http/https lang ang pinapayagang protocol.');
    }
    if (parsed.username || parsed.password) {
        throw new Error('Hindi pinapayagan ang mga URL na may embedded credentials.');
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (IMAGE_SEARCH_BLOCKED_HOSTNAMES.has(hostname)) {
        throw new Error('Hindi pinapayagan ang host na ito.');
    }
    if (net.isIP(hostname) && isBlockedImageSearchIP(hostname)) {
        throw new Error('Hindi pinapayagan ang IP address na ito.');
    }
    return parsed;
}

async function fetchImageBuffer(urlStr, { maxBytes = 6 * 1024 * 1024, maxRedirects = 3, timeoutMs = 12000 } = {}) {
    let currentUrl = urlStr;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const parsed = assertPublicHttpUrlSync(currentUrl);
        const lib = parsed.protocol === 'https:' ? https : http;

        // Maraming e-commerce/CDN host (hal. Shopee, Lazada) ang nag-b-block
        // ng direktang download kung walang "totoong browser" na headers —
        // dati, generic lang ang User-Agent at walang Referer, kaya madalas
        // ma-reject (401/403) ang unang search result (na kalimitan mula sa
        // mas protektadong host), habang minsan nakakalusot ang susunod na
        // resulta na galing sa ibang host. Ginawang mas parang tunay na
        // browser ang request para hindi ito palaging mag-fail.
        const refererOrigin = `${parsed.protocol}//${parsed.host}/`;

        const result = await new Promise((resolve, reject) => {
            const req = lib.get(currentUrl, {
                lookup: ssrfSafeLookup,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Referer': refererOrigin,
                    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
                },
                timeout: timeoutMs
            }, (resStream) => {
                if ([301, 302, 303, 307, 308].includes(resStream.statusCode) && resStream.headers.location) {
                    resStream.resume();
                    try {
                        return resolve({ redirect: new URL(resStream.headers.location, currentUrl).toString() });
                    } catch {
                        return reject(new Error('Invalid redirect mula sa image host.'));
                    }
                }
                if (resStream.statusCode !== 200) {
                    resStream.resume();
                    return reject(new Error(`Nagbalik ng HTTP ${resStream.statusCode} ang image host.`));
                }
                const contentType = (resStream.headers['content-type'] || '').toLowerCase();
                if (!contentType.startsWith('image/')) {
                    resStream.resume();
                    return reject(new Error('Hindi image ang na-fetch na file.'));
                }
                const chunks = [];
                let total = 0;
                resStream.on('data', (chunk) => {
                    total += chunk.length;
                    if (total > maxBytes) {
                        req.destroy();
                        reject(new Error('Sobra sa allowed size ang image (max 6MB).'));
                        return;
                    }
                    chunks.push(chunk);
                });
                resStream.on('end', () => resolve({ buffer: Buffer.concat(chunks), mimetype: contentType.split(';')[0].trim() }));
                resStream.on('error', reject);
            });
            req.on('timeout', () => req.destroy(new Error('Nag-timeout habang kinukuha ang image.')));
            req.on('error', reject);
        });

        if (result.redirect) { currentUrl = result.redirect; continue; }
        return result;
    }
    throw new Error('Sobra sa allowed na bilang ng redirects.');
}

async function imageSearchProviderFetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function searchProductImages(query) {
    const q = (query || '').toString().trim().slice(0, 150);
    if (!q) {
        const err = new Error('Maglagay muna ng search term.');
        err.statusCode = 400;
        throw err;
    }

    if (IMAGE_SEARCH_PROVIDER === 'google') {
        const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(IMAGE_SEARCH_API_KEY)}&cx=${encodeURIComponent(IMAGE_SEARCH_CX)}&searchType=image&safe=active&num=10&q=${encodeURIComponent(q)}`;
        const r = await imageSearchProviderFetchWithTimeout(url);
        if (!r.ok) throw new Error(`Google Image Search error (HTTP ${r.status}).`);
        const data = await r.json();
        return (data.items || []).map((it, i) => ({
            id: `g${i}`,
            title: (it.title || '').slice(0, 140),
            thumbnailUrl: (it.image && it.image.thumbnailLink) || it.link,
            imageUrl: it.link,
            width: (it.image && it.image.width) || null,
            height: (it.image && it.image.height) || null
        })).filter(r => r.imageUrl && r.thumbnailUrl);
    }

    if (IMAGE_SEARCH_PROVIDER === 'bing') {
        const url = `https://api.bing.microsoft.com/v7.0/images/search?safeSearch=Strict&count=10&q=${encodeURIComponent(q)}`;
        const r = await imageSearchProviderFetchWithTimeout(url, { headers: { 'Ocp-Apim-Subscription-Key': IMAGE_SEARCH_API_KEY } });
        if (!r.ok) throw new Error(`Bing Image Search error (HTTP ${r.status}).`);
        const data = await r.json();
        return (data.value || []).map((it, i) => ({
            id: `b${i}`,
            title: (it.name || '').slice(0, 140),
            thumbnailUrl: it.thumbnailUrl,
            imageUrl: it.contentUrl,
            width: it.width || null,
            height: it.height || null
        })).filter(r => r.imageUrl && r.thumbnailUrl);
    }

    if (IMAGE_SEARCH_PROVIDER === 'serpapi') {
        const url = `https://serpapi.com/search.json?engine=google_images&safe=active&num=10&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(IMAGE_SEARCH_API_KEY)}`;
        const r = await imageSearchProviderFetchWithTimeout(url);
        if (!r.ok) throw new Error(`SerpAPI Image Search error (HTTP ${r.status}).`);
        const data = await r.json();
        return (data.images_results || []).slice(0, 10).map((it, i) => ({
            id: `s${i}`,
            title: (it.title || '').slice(0, 140),
            thumbnailUrl: it.thumbnail,
            imageUrl: it.original,
            width: it.original_width || null,
            height: it.original_height || null
        })).filter(r => r.imageUrl && r.thumbnailUrl);
    }

    throw new Error('Unsupported o hindi pa naka-configure ang IMAGE_SEARCH_PROVIDER.');
}

// ============================================================================
// OMNI SEARCH IMAGES — free, no-API-key image search providers
// ----------------------------------------------------------------------------
// English version note: everything below (this section, its routes, and the
// matching frontend code) is new. It does NOT touch the SerpApi/Google/Bing
// (paid) provider above — that flow is left completely untouched.
//
// Each free provider below is tried in order for a given query. If a
// provider errors out, is blocked, or returns nothing usable, the cascade
// automatically falls through to the next free provider — that's the
// "self-healing" fallback the feature is built around, so one blocked site
// (e.g. Bing returning a CAPTCHA page) never breaks the whole search.
// ============================================================================

const OMNI_FREE_SEARCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function omniFetchText(url, headers = {}, timeoutMs = 10000) {
    const r = await imageSearchProviderFetchWithTimeout(url, {
        headers: { 'User-Agent': OMNI_FREE_SEARCH_USER_AGENT, 'Accept-Encoding': 'identity', ...headers }
    }, timeoutMs);
    const body = await r.text();
    return { statusCode: r.status, body };
}

async function searchDuckDuckGoImagesFree(query, timeoutMs = 10000) {
    const tokenUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
    const { statusCode, body: html } = await omniFetchText(tokenUrl, {}, timeoutMs);
    if (statusCode < 200 || statusCode >= 300) throw new Error(`DuckDuckGo token page returned HTTP ${statusCode}.`);
    const m = html.match(/vqd=['"]?([\d-]+)['"]?/);
    if (!m) throw new Error('DuckDuckGo vqd token not found (page layout may have changed).');

    const searchUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(m[1])}&f=,,,&p=1`;
    const { statusCode: sc2, body: jsonBody } = await omniFetchText(searchUrl, { Referer: 'https://duckduckgo.com/' }, timeoutMs);
    if (sc2 < 200 || sc2 >= 300) throw new Error(`DuckDuckGo image search returned HTTP ${sc2}.`);
    const data = JSON.parse(jsonBody);
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) throw new Error('DuckDuckGo returned no image results.');
    return results.slice(0, 10).map((it, i) => ({
        id: `ddg${i}`, provider: 'DuckDuckGo',
        title: (it.title || '').slice(0, 140),
        thumbnailUrl: it.thumbnail || it.image,
        imageUrl: it.image,
        width: it.width || null, height: it.height || null
    })).filter(r => r.imageUrl && r.thumbnailUrl);
}

async function searchBingImagesFree(query, timeoutMs = 10000) {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1&mkt=en-US`;
    const { statusCode, body: html } = await omniFetchText(url, { 'Accept-Language': 'en-US,en;q=0.9' }, timeoutMs);
    if (statusCode < 200 || statusCode >= 300) throw new Error(`Bing (free) returned HTTP ${statusCode} (may be temporarily blocking this network).`);

    const out = [];
    const attrRegex = /m="({.*?})"/g;
    let am;
    while ((am = attrRegex.exec(html)) && out.length < 10) {
        try {
            const obj = JSON.parse(am[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
            if (obj.murl) {
                out.push({
                    id: `bingfree${out.length}`, provider: 'Bing (free)',
                    title: (obj.t || '').slice(0, 140),
                    thumbnailUrl: obj.turl || obj.murl,
                    imageUrl: obj.murl,
                    width: obj.mw || null, height: obj.mh || null
                });
            }
        } catch {
            // One malformed entry shouldn't stop the whole scan — skip it and keep going.
        }
    }
    if (!out.length) throw new Error('Bing (free) returned no parsable image results (layout may have changed, or the request was blocked).');
    return out;
}

async function searchOpenverseImagesFree(query, timeoutMs = 10000) {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=10`;
    const { statusCode, body } = await omniFetchText(url, {}, timeoutMs);
    if (statusCode < 200 || statusCode >= 300) throw new Error(`Openverse returned HTTP ${statusCode}.`);
    const data = JSON.parse(body);
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) throw new Error('Openverse returned no image results.');
    return results.slice(0, 10).map((it, i) => ({
        id: `ov${i}`, provider: 'Openverse',
        title: (it.title || '').slice(0, 140),
        thumbnailUrl: it.thumbnail || it.url,
        imageUrl: it.url,
        width: it.width || null, height: it.height || null
    })).filter(r => r.imageUrl && r.thumbnailUrl);
}

async function searchWikimediaCommonsImagesFree(query, timeoutMs = 10000) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent('file:' + query)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=400&format=json&origin=*`;
    const { statusCode, body } = await omniFetchText(url, {}, timeoutMs);
    if (statusCode < 200 || statusCode >= 300) throw new Error(`Wikimedia Commons returned HTTP ${statusCode}.`);
    const data = JSON.parse(body);
    const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
    const out = [];
    for (const p of pages) {
        const info = p.imageinfo && p.imageinfo[0];
        if (info && info.url) {
            out.push({
                id: `wm${out.length}`, provider: 'Wikimedia Commons',
                title: (p.title || '').replace(/^File:/, '').slice(0, 140),
                thumbnailUrl: info.thumburl || info.url,
                imageUrl: info.url,
                width: info.width || null, height: info.height || null
            });
        }
    }
    if (!out.length) throw new Error('Wikimedia Commons returned no image results.');
    return out;
}

async function searchYandexImagesFree(query, timeoutMs = 10000) {
    const url = `https://yandex.com/images/search?text=${encodeURIComponent(query)}`;
    const { statusCode, body: html } = await omniFetchText(url, {}, timeoutMs);
    if (statusCode < 200 || statusCode >= 300) throw new Error(`Yandex returned HTTP ${statusCode}.`);
    const matches = [...html.matchAll(/"img_href":"(https?:[^"]+)"/g)];
    if (!matches.length) throw new Error('Yandex returned no parsable image results (likely blocked/CAPTCHA on this network).');
    return matches.slice(0, 10).map((m, i) => {
        const imageUrl = m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        return { id: `yx${i}`, provider: 'Yandex', title: '', thumbnailUrl: imageUrl, imageUrl, width: null, height: null };
    });
}

// Order matters: most reliable / most product-relevant free sources first,
// Yandex last since it's the most likely to serve a CAPTCHA instead of results.
const OMNI_FREE_IMAGE_PROVIDERS = [
    { name: 'DuckDuckGo', run: searchDuckDuckGoImagesFree },
    { name: 'Bing (free)', run: searchBingImagesFree },
    { name: 'Openverse', run: searchOpenverseImagesFree },
    { name: 'Wikimedia Commons', run: searchWikimediaCommonsImagesFree },
    { name: 'Yandex', run: searchYandexImagesFree }
];

async function omniFreeImageSearch(query, timeoutMs = 10000) {
    const q = (query || '').toString().trim().slice(0, 150);
    if (!q) {
        const err = new Error('Maglagay muna ng search term.');
        err.statusCode = 400;
        throw err;
    }
    const errors = [];
    for (const provider of OMNI_FREE_IMAGE_PROVIDERS) {
        try {
            const results = await provider.run(q, timeoutMs);
            if (results && results.length) return { provider: provider.name, results };
        } catch (err) {
            // Self-healing fallback: this free provider failed or got blocked —
            // move on to the next one in the cascade automatically.
            errors.push(`${provider.name}: ${err.message}`);
        }
    }
    const err = new Error(`All free image search providers failed or returned nothing for "${q}". (${errors.join(' | ')})`);
    err.statusCode = 502;
    throw err;
}

const IMAGE_SEARCH_SESSION_TTL_MS = 10 * 60 * 1000;
const imageSearchSessions = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [nonce, sess] of imageSearchSessions.entries()) {
        if (now - sess.createdAt > IMAGE_SEARCH_SESSION_TTL_MS) imageSearchSessions.delete(nonce);
    }
}, 5 * 60 * 1000).unref();

const BULK_IMAGE_SEARCH_SESSION_TTL_MS = 30 * 60 * 1000;
const bulkImageSearchSessions = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [nonce, sess] of bulkImageSearchSessions.entries()) {
        if (now - sess.createdAt > BULK_IMAGE_SEARCH_SESSION_TTL_MS) bulkImageSearchSessions.delete(nonce);
    }
}, 5 * 60 * 1000).unref();

// LIVE PROGRESS ng bulk image search (hiling: makita kung gaano na
// katagal/kailan pa matatapos habang tumatakbo ang search). Hiwalay ito
// sa bulkImageSearchSessions sa itaas (na para sa /fetch at /apply
// pagkatapos matapos ang buong search) — ito naman ay naka-imbak habang
// TUMATAKBO pa ang search mismo, sinusuri (polled) ng frontend bawat
// ilang segundo. Parehong TTL/cleanup pattern lang ng existing sessions
// sa itaas.
const BULK_IMAGE_SEARCH_PROGRESS_TTL_MS = 30 * 60 * 1000;
const bulkImageSearchProgress = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [nonce, p] of bulkImageSearchProgress.entries()) {
        if (now - p.startedAt > BULK_IMAGE_SEARCH_PROGRESS_TTL_MS) bulkImageSearchProgress.delete(nonce);
    }
}, 5 * 60 * 1000).unref();

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// OMNI SEARCH IMAGES — background job orchestration
// ----------------------------------------------------------------------------
// "Omni Search Images" runs the free-provider cascade above as a detached
// background OS process (a separate Node process from the running OmniPOS
// server, spawned via child_process.spawn — this is what makes it a real
// background job on Termux: nothing about it is printed to the terminal the
// user is using, and all output only ever reaches the app through the live
// progress endpoint below). If spawning a background process isn't possible
// for any reason (missing permissions, unusual Termux/Node setup, etc.), the
// server automatically falls back to running the exact same search logic
// in-process instead, so the feature keeps working either way.
//
// The worker process reports progress back to the main server through a
// small internal HTTP callback server bound ONLY to 127.0.0.1 (never
// reachable from outside the device), authenticated with a random
// per-job secret so nothing else on the device can inject fake progress.
// ============================================================================

const OMNI_SEARCH_WORKER_SCRIPT = path.join(__dirname, 'omnipos-search-image.js');
const OMNI_SEARCH_SESSION_TTL_MS = BULK_IMAGE_SEARCH_SESSION_TTL_MS;
const OMNI_SEARCH_PROGRESS_TTL_MS = BULK_IMAGE_SEARCH_PROGRESS_TTL_MS;

const omniImageSearchSessions = new Map();   // nonce -> { username, createdAt, items: Map(code -> proposal) }
const omniImageSearchProgress = new Map();   // nonce -> live progress object (polled by the frontend)
const omniImageSearchJobs = new Map();       // nonce -> { secret, username, clearFallback }

setInterval(() => {
    const now = Date.now();
    for (const [nonce, sess] of omniImageSearchSessions.entries()) {
        if (now - sess.createdAt > OMNI_SEARCH_SESSION_TTL_MS) omniImageSearchSessions.delete(nonce);
    }
    for (const [nonce, p] of omniImageSearchProgress.entries()) {
        if (now - p.startedAt > OMNI_SEARCH_PROGRESS_TTL_MS) { omniImageSearchProgress.delete(nonce); omniImageSearchJobs.delete(nonce); }
    }
}, 5 * 60 * 1000).unref();

let omniInternalCallbackServer = null;
let omniInternalCallbackPort = null;

// Self-troubleshooting: handles a progress update posted by the worker
// process. Validates that it truly came from this device (loopback only)
// and carries the correct per-job secret before trusting anything in it.
function handleOmniProgressUpdate(remoteAddress, payload) {
    const isLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
    if (!isLoopback) throw new Error('Forbidden: internal-only endpoint.');

    const nonce = payload && payload.nonce;
    const job = nonce ? omniImageSearchJobs.get(nonce) : null;
    if (!job || !payload || job.secret !== payload.secret) {
        throw new Error('Invalid or expired Omni Search job token.');
    }

    // The background process is alive and reporting — cancel the
    // "hasn't reported anything yet" self-healing fallback timer.
    if (typeof job.clearFallback === 'function') job.clearFallback();

    const progress = omniImageSearchProgress.get(nonce);
    if (!progress || progress.finished) return; // already finished elsewhere — no-op

    if (payload.type === 'item') {
        progress.proposals.push(payload.proposal);
        progress.done = payload.done;
        progress.updatedAt = Date.now();
    } else if (payload.type === 'finished') {
        const items = new Map();
        (payload.items || []).forEach(it => { if (it && it.code) items.set(it.code, it); });
        omniImageSearchSessions.set(nonce, { username: job.username, createdAt: Date.now(), items });
        progress.finished = true;
        progress.updatedAt = Date.now();
    } else if (payload.type === 'error') {
        progress.error = payload.message || 'Omni Search Images failed.';
        progress.finished = true;
        progress.updatedAt = Date.now();
    }
}

function ensureOmniInternalCallbackServer() {
    if (omniInternalCallbackServer) return Promise.resolve(omniInternalCallbackPort);
    return new Promise((resolve, reject) => {
        const srv = http.createServer((req, res) => {
            if (req.method !== 'POST' || req.url !== '/omni-progress') {
                res.writeHead(404); res.end(); return;
            }
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
                if (body.length > 2 * 1024 * 1024) req.destroy(); // guard against runaway payloads
            });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    handleOmniProgressUpdate(req.socket.remoteAddress, payload);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: err.message }));
                }
            });
            req.on('error', () => { try { res.destroy(); } catch {} });
        });
        srv.on('error', reject);
        // Bound to 127.0.0.1 only (loopback) — never reachable from the LAN/internet.
        srv.listen(0, '127.0.0.1', () => {
            omniInternalCallbackServer = srv;
            omniInternalCallbackPort = srv.address().port;
            resolve(omniInternalCallbackPort);
        });
    });
}

// Fallback path: runs the exact same free-provider cascade directly inside
// the main OmniPOS process (fully non-blocking async, same pattern as the
// existing SerpApi/Google/Bing bulk search job above). Used automatically
// whenever spawning the separate background worker process isn't possible.
async function runOmniImageSearchInProcess(nonce, targets, username) {
    const progress = omniImageSearchProgress.get(nonce);
    if (!progress || progress.finished) return;

    const items = new Map();
    try {
        for (let i = 0; i < targets.length; i++) {
            if (progress.finished) break; // the background process may have finished meanwhile
            const p = targets[i];
            try {
                const { provider, results } = await omniFreeImageSearch(`${p.name} product photo`);
                const best = results[0];
                if (best) {
                    items.set(p.code, { imageUrl: best.imageUrl, thumbnailUrl: best.thumbnailUrl, title: best.title, provider });
                    progress.proposals.push({ code: p.code, name: p.name, found: true, thumbnailUrl: best.thumbnailUrl, title: best.title, provider });
                } else {
                    progress.proposals.push({ code: p.code, name: p.name, found: false, message: 'No image found.' });
                }
            } catch (err) {
                console.error(`Omni Search Images error for ${p.code}:`, err);
                progress.proposals.push({ code: p.code, name: p.name, found: false, message: 'Search failed for this product.' });
            }
            progress.done = i + 1;
            progress.updatedAt = Date.now();
            if (i < targets.length - 1) await sleepMs(450);
        }
        if (!progress.finished) {
            omniImageSearchSessions.set(nonce, { username, createdAt: Date.now(), items });
            progress.finished = true;
            progress.updatedAt = Date.now();
        }
    } catch (err) {
        console.error('Omni Search Images in-process job failed:', err);
        if (!progress.finished) {
            progress.error = err.message || 'Omni Search Images failed.';
            progress.finished = true;
            progress.updatedAt = Date.now();
        }
    }
}

// Primary path: spawns omnipos-search-image.js as a real, detached
// background OS process. Falls back to the in-process runner above the
// moment anything about the spawn looks wrong (self-healing).
async function runOmniImageSearchJob(nonce, targets, username) {
    const progress = omniImageSearchProgress.get(nonce);
    if (!progress) return;

    let callbackPort;
    try {
        callbackPort = await ensureOmniInternalCallbackServer();
    } catch (err) {
        console.warn('⚠️  Omni Search Images: could not start the internal progress callback server — running the search in-process instead. Detalye:', err.message);
        return runOmniImageSearchInProcess(nonce, targets, username);
    }

    const secret = crypto.randomBytes(24).toString('hex');
    const jobFile = path.join(os.tmpdir(), `omnipos-omni-search-${nonce}.json`);

    try {
        fs.writeFileSync(jobFile, JSON.stringify({
            nonce, secret, host: '127.0.0.1', port: callbackPort,
            targets: targets.map(p => ({ code: p.code, name: p.name }))
        }));
    } catch (err) {
        console.warn('⚠️  Omni Search Images: could not write the background job file — running the search in-process instead. Detalye:', err.message);
        return runOmniImageSearchInProcess(nonce, targets, username);
    }

    let handedOff = false;
    let fallbackTimer = null;
    const triggerFallback = (reason) => {
        if (handedOff) return;
        handedOff = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        console.warn(`⚠️  Omni Search Images (job ${nonce}): ${reason} — automatically switching to the in-process fallback so the search still completes.`);
        runOmniImageSearchInProcess(nonce, targets, username).catch(e => console.error('Omni Search Images in-process fallback failed:', e));
    };

    omniImageSearchJobs.set(nonce, { secret, username, clearFallback: () => { handedOff = true; if (fallbackTimer) clearTimeout(fallbackTimer); } });

    let child;
    try {
        child = spawn(process.execPath, [OMNI_SEARCH_WORKER_SCRIPT, jobFile], {
            cwd: __dirname,
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
    } catch (err) {
        try { fs.unlinkSync(jobFile); } catch {}
        return triggerFallback(`could not spawn the background worker process (${err.message})`);
    }

    // Self-healing safety net: if 20s pass with zero progress reported by
    // the worker, assume the background process can't run properly in this
    // Termux/Node environment and fall back automatically instead of
    // leaving the UI stuck.
    fallbackTimer = setTimeout(() => {
        if (!progress.finished && progress.done === 0) {
            try { if (child && !child.killed) child.kill(); } catch {}
            triggerFallback('background worker reported no progress after 20s (it may not have been able to start)');
        }
    }, 20000);

    child.once('error', (err) => triggerFallback(`background worker process error (${err.message})`));
    child.once('exit', (code, signal) => {
        if (!handedOff && !progress.finished && code !== 0) {
            triggerFallback(`background worker exited early (code ${code}${signal ? ', signal ' + signal : ''})`);
        }
    });

    child.unref();
}

async function relayFetch(url, options = {}, timeoutMs = 20000) {
    if (!(await isInternetLikelyUp())) {
        const err = new Error('Walang internet connection na na-detect sa device na ito.');
        err.code = 'NO_INTERNET';
        throw err;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

let lastConnectivityProbe = { at: 0, up: true };
const CONNECTIVITY_PROBE_CACHE_MS = 10 * 1000;
const CONNECTIVITY_PROBE_TIMEOUT_MS = 1200;

function rawTcpProbe(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));

        socket.connect(port, host);
    });
}

async function isInternetLikelyUp() {
    const now = Date.now();
    if (now - lastConnectivityProbe.at < CONNECTIVITY_PROBE_CACHE_MS) {
        return lastConnectivityProbe.up;
    }

    let up;
    try {
        up = await Promise.race([
            Promise.any([
                rawTcpProbe('1.1.1.1', 443, CONNECTIVITY_PROBE_TIMEOUT_MS),
                rawTcpProbe('8.8.8.8', 443, CONNECTIVITY_PROBE_TIMEOUT_MS)
            ]).then(results => !!results),
            new Promise(resolve => setTimeout(() => resolve(false), CONNECTIVITY_PROBE_TIMEOUT_MS + 200))
        ]);
    } catch (err) {
        up = false;
    }
    lastConnectivityProbe = { at: now, up };
    return up;
}

const APP_VERSION = require('./package.json').version || '0.0.0';
const RENDER_DEPLOY_HOOK_URL = process.env.RENDER_DEPLOY_HOOK_URL || null;

// ============================================================
// SYSTEM UPDATE — ADVANCED LIVE DEPLOY PROGRESS
// ============================================================
// Dalawang magkaibang paraan ng pag-update, kaya dalawang magkaibang
// istratehiya ng progress-tracking:
//
// 1) Render deploy hook — pag na-trigger na ito, ang kasalukuyang
//    server PROCESS mismo ang papatayin ni Render kapag tapos na ang
//    bagong build (papalitan ng bagong instance). Kaya HINDI ligtas
//    ilagay ang "naghihintay" na state dito sa memory ng process na
//    ito — puwede itong basta mawala bago pa man matapos. Dahil dito,
//    ang totoong paghihintay/pag-verify para dito ay nasa CLIENT
//    (browser) — doon lang talaga tumatakbo nang tuloy-tuloy ang
//    pag-poll ng /system/update-check, kahit anong server instance pa
//    ang sumagot. Ang estimated duration/ETA lang (na-"learn" mula sa
//    nakaraang totoong deploy times) ang ibinibigay dito ng backend.
//
// 2) Self-update (Termux/non-Render) — buong buo itong nangyayari
//    (download → extract → apply) BAGO pa man i-restart ang parehong
//    process, kaya ligtas dito ang isang tunay na job sa memory
//    (deployJobs sa ibaba) na may TUNAY na progreso: bytes na
//    na-download (mula sa Content-Length ng response), files na
//    na-apply, atbp. — hindi basta pasimula/guesswork.
//
// Pareho silang may "learned" ETA — hindi hard-coded na guess lang,
// kundi isang exponential moving average ng mga tunay na naitalang
// nakaraang deploy duration (deployStats module sa database), kaya
// lalong tumatama ang tinatayang oras habang mas madalas ginagamit.

const FILE_DEPLOY_STATS = 'deployStats';
const DEFAULT_DEPLOY_STATS = { renderAvgMs: 90000, selfUpdateAvgMs: 20000, samples: { render: 0, self: 0 } };

function readDeployStats() {
    const raw = readData(FILE_DEPLOY_STATS, DEFAULT_DEPLOY_STATS) || {};
    return {
        renderAvgMs: Number(raw.renderAvgMs) > 0 ? Number(raw.renderAvgMs) : DEFAULT_DEPLOY_STATS.renderAvgMs,
        selfUpdateAvgMs: Number(raw.selfUpdateAvgMs) > 0 ? Number(raw.selfUpdateAvgMs) : DEFAULT_DEPLOY_STATS.selfUpdateAvgMs,
        samples: {
            render: (raw.samples && raw.samples.render) || 0,
            self: (raw.samples && raw.samples.self) || 0
        }
    };
}

function recordDeployDuration(kind, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const stats = readDeployStats();
    const statKey = kind === 'self' ? 'selfUpdateAvgMs' : 'renderAvgMs';
    const sampleKey = kind === 'self' ? 'self' : 'render';
    // Exponential moving average — mas mabigat ang mga kamakailan-lamang
    // na takbo kaysa sa matagal nang datos, para agad makaadjust kung
    // bumagal/bumilis ang totoong deploy time (hal. nagbago ang
    // koneksyon o laki ng build) sa halip na permanenteng bigat pare-
    // pareho ang bawat sample gaya ng plain average.
    const alpha = 0.35;
    const hasSamples = stats.samples[sampleKey] > 0;
    stats[statKey] = hasSamples ? Math.round(stats[statKey] * (1 - alpha) + durationMs * alpha) : Math.round(durationMs);
    stats.samples[sampleKey] = (stats.samples[sampleKey] || 0) + 1;
    writeData(FILE_DEPLOY_STATS, stats);
}

const DEPLOY_JOB_TTL_MS = 30 * 60 * 1000;
const deployJobs = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of deployJobs.entries()) {
        if (now - job.startedAt > DEPLOY_JOB_TTL_MS) deployJobs.delete(jobId);
    }
}, 5 * 60 * 1000).unref();

const SELF_UPDATE_STEPS = [
    { key: 'download', label: 'Download package' },
    { key: 'extract', label: 'Extract update' },
    { key: 'apply', label: 'Apply files' },
    { key: 'restart', label: 'Restart' }
];

function createSelfUpdateJob() {
    const jobId = crypto.randomUUID();
    deployJobs.set(jobId, {
        kind: 'self',
        steps: SELF_UPDATE_STEPS.map(s => ({ ...s, status: 'pending', at: null })),
        stepIndex: -1,
        percent: 0,
        message: 'Preparing the self-update...',
        status: 'running',
        error: null,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        downloadedBytes: 0,
        totalBytes: 0,
        logs: []
    });
    return jobId;
}

function jobAdvanceStep(jobId, stepKey, message, percent) {
    const job = deployJobs.get(jobId);
    if (!job) return;
    const idx = job.steps.findIndex(s => s.key === stepKey);
    if (idx === -1) return;
    for (let i = 0; i < idx; i++) if (job.steps[i].status !== 'done') job.steps[i].status = 'done';
    job.steps[idx].status = 'active';
    job.steps[idx].at = Date.now();
    job.stepIndex = idx;
    job.message = message || job.steps[idx].label;
    if (percent != null) job.percent = Math.max(job.percent, percent);
    job.logs.push({ at: Date.now(), text: job.message });
    if (job.logs.length > 30) job.logs.shift();
    job.updatedAt = Date.now();
}

function jobSetPercent(jobId, percent, message) {
    const job = deployJobs.get(jobId);
    if (!job) return;
    job.percent = Math.max(job.percent, Math.min(99, percent));
    if (message && message !== job.message) {
        job.message = message;
        job.logs.push({ at: Date.now(), text: message });
        if (job.logs.length > 30) job.logs.shift();
    }
    job.updatedAt = Date.now();
}

function jobFinish(jobId, message) {
    const job = deployJobs.get(jobId);
    if (!job) return;
    job.steps.forEach(s => { if (s.status !== 'error') s.status = 'done'; });
    job.status = 'done';
    job.percent = 100;
    job.message = message || 'Done!';
    job.logs.push({ at: Date.now(), text: job.message });
    job.updatedAt = Date.now();
    recordDeployDuration(job.kind, Date.now() - job.startedAt);
}

function jobFail(jobId, message) {
    const job = deployJobs.get(jobId);
    if (!job) return;
    if (job.stepIndex >= 0 && job.steps[job.stepIndex]) job.steps[job.stepIndex].status = 'error';
    job.status = 'error';
    job.error = message;
    job.message = message;
    job.logs.push({ at: Date.now(), text: `Error: ${message}` });
    job.updatedAt = Date.now();
}

function countFilesRecursive(dir, preserveNames) {
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (preserveNames.has(entry.name)) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) count += countFilesRecursive(p, new Set());
        else count += 1;
    }
    return count;
}

function copyRecursivePreservingWithProgress(srcDir, destDir, preserveNames, stats, jobId) {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (preserveNames.has(entry.name)) continue;
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            copyRecursivePreservingWithProgress(srcPath, destPath, new Set(), stats, jobId);
        } else {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.copyFileSync(srcPath, destPath);
            stats.copied++;
            if (jobId && stats.total > 0) {
                const pct = 60 + Math.round((stats.copied / stats.total) * 30);
                jobSetPercent(jobId, Math.min(90, pct), `Applying updated files... (${stats.copied}/${stats.total})`);
            }
        }
    }
}

const UNPUBLISHED_VERSION_SENTINEL = '0.0.0';
function parseVersionParts(v) {
    return String(v || '0.0.0').trim().split('.').map((n) => parseInt(n, 10) || 0);
}
function isVersionNewer(candidate, current) {
    const a = parseVersionParts(candidate);
    const b = parseVersionParts(current);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const ai = a[i] || 0;
        const bi = b[i] || 0;
        if (ai > bi) return true;
        if (ai < bi) return false;
    }
    return false;
}

const CLOUD_BACKUP_FEATURE_ID = 'cloud_backup';

const FEATURE_CATALOG = {

    ocean: { name:'Ocean Pro', price: 149, category:'theme', description:'A new color theme for the entire dashboard.' },
    emerald: { name:'Emerald Pro', price: 149, category:'theme', description:'A new color theme for the entire dashboard.' },
    sunset: { name:'Sunset Pro', price: 149, category:'theme', description:'A new color theme for the entire dashboard.' },
    rosegold: { name:'Rose Gold Pro', price: 149, category:'theme', description:'A new color theme for the entire dashboard.' },
    cyber: { name:'Cyber Neon Pro', price: 149, category:'theme', description:'A new color theme for the entire dashboard.' },
    noir: { name:'Coffee Noir Pro', price: 149, category:'theme', description:'A new color theme for the entire dashboard.' },
    mintfrost: { name:'Mint Frost Pro', price: 149, category:'theme', description:'A new color theme for the entire dashboard.' },
    liquidglass: { name:'Liquid Glass Pro', price: 149, category:'theme', description:'A translucent, layered "liquid glass" theme with frosted-glass panels and fluid animations for the entire dashboard.' },
    galaxyambient: { name:'Galaxy Ambient Pro', price: 149, category:'theme', description:'An ambient, frosted dark theme with wide rounded corners and a floating sidebar, inspired by Samsung One UI, for the entire dashboard.' },

    promo_codes: { name:'Promo Codes Module', price: 499, category:'module', description:'Create discount/promo codes that can be used at checkout.' },
    advanced_reports: { name:'Sales Analytics & Advanced Reports', price: 799, category:'module', description:'Profit margin, top/slow sellers, 7-day sales trend, and payment method breakdown.' },
    purchase_orders: { name:'Purchase Orders Module', price: 999, category:'module', description:'Create and track Purchase Orders to suppliers, including reorder suggestions.' },
    customer_crm: { name:'Customer Profiles, Loyalty & Debtors', price: 799, category:'module', description:'Customer profiles, loyalty points, purchase history, and the Debtors ledger (track utang, due dates, and payments) for every customer.' },
    shift_management: { name:'Multi-Cashier Shift Oversight & Z-Reading Reports', price: 699, category:'module', description:'Multi-cashier shift tracking and Z-Reading (cash count) reports.' },
    rbac_management: { name:'Roles & Permissions (RBAC) Management', price: 999, category:'module', description:'Create custom roles and configure which menus each role can access (Roles & Permissions matrix).' },
    multi_branch: { name:'Multi-Branch Dashboard', price: 999, category:'module', description:'Combine sales, transaction count, and low-stock snapshots from ALL branches of the business (different devices/locations) into one combined view on the Overview page — near real-time, updated every few minutes via Relay.' },

    [CLOUD_BACKUP_FEATURE_ID]: { name:'Cloud Backup (Postgres)', price: 1499, category:'cloud-service', description:'Sync the entire database — including user accounts (no passwords), unlocked features/Pro themes, and every other module — to secure cloud storage. Protects your data if the device breaks or is lost.' },
};

const DEMO_FEATURE_ID ='__demo__';

function sumFeaturePrices(featureIds) {
    return featureIds.reduce((sum, id) => sum + ((FEATURE_CATALOG[id] && FEATURE_CATALOG[id].price) || 0), 0);
}

function getTierPricing(tier, alreadyPurchased) {
    const fullAlaCarteValue = sumFeaturePrices(tier.featureIds);
    const remainingFeatureIds = tier.featureIds.filter(id => !alreadyPurchased.includes(id));
    const remainingAlaCarteValue = sumFeaturePrices(remainingFeatureIds);

    if (fullAlaCarteValue <= 0 || remainingAlaCarteValue <= 0) {
        return { discount: fullAlaCarteValue, effectivePrice: 0 };
    }

    const bundleRate = tier.bundlePrice / fullAlaCarteValue;

    const effectivePrice = Math.min(
        tier.bundlePrice,
        Math.max(1, Math.ceil(remainingAlaCarteValue * bundleRate))
    );
    const discount = Math.max(0, remainingAlaCarteValue - effectivePrice);
    return { discount, effectivePrice };
}

const UPGRADE_TIERS = [
    {
        id:'basic',
        name:'Basic Upgrade',
        description:'For those who want to get started with reporting and promos.',
        featureIds: ['advanced_reports','promo_codes'],
        bundlePrice: 999
    },
    {
        id:'standard',
        name:'Standard Upgrade',
        description:'Everything in Basic, plus customer loyalty and shift oversight.',
        featureIds: ['advanced_reports','promo_codes','customer_crm','shift_management'],
        bundlePrice: 1999
    },
    {
        id:'pro',
        name:'Pro Upgrade (Complete)',
        description:'Every module, every Pro Theme, AND Cloud Backup — nothing left locked. The complete, all-inclusive upgrade.',

        featureIds: Object.keys(FEATURE_CATALOG),

        bundlePrice: 6499
    }
];

function readFeatureUnlocks() {
    const raw = readData(FILE_FEATURE_UNLOCKS, DEFAULT_FEATURE_UNLOCKS);
    return {
        installationId: raw.installationId || null,
        hardwareFingerprint: raw.hardwareFingerprint || null,
        tokens: (raw.tokens && typeof raw.tokens ==='object') ? { ...raw.tokens } : {},
        lockedAttempts: typeof raw.lockedAttempts ==='number' ? raw.lockedAttempts : 0,
        deviceVerified: !!raw.deviceVerified,
        verifiedFingerprint: raw.verifiedFingerprint || null,
        firstVerifiedAt: typeof raw.firstVerifiedAt ==='number' ? raw.firstVerifiedAt : null,
        lastVerifiedAt: typeof raw.lastVerifiedAt ==='number' ? raw.lastVerifiedAt : null,

        deviceSeed: raw.deviceSeed || null,

        devicePermit: raw.devicePermit || null,

        relayAuthorized: raw.relayAuthorized === true
    };
}

function recordLockedAttempt() {
    const data = readFeatureUnlocks();
    data.lockedAttempts = (data.lockedAttempts || 0) + 1;
    writeData(FILE_FEATURE_UNLOCKS, data);
    return data.lockedAttempts;
}

function getAndroidProp(name) {
    try {
        const value = execSync(`getprop ${name}`, { encoding:'utf8', timeout: 2000, stdio: ['ignore','pipe','ignore'] }).trim();
        return value ||'';
    } catch (err) {
        return'';
    }
}

const IS_VOLATILE_CLOUD_HOST = process.env.RENDER === 'true' || !!process.env.RENDER_SERVICE_ID;

function getOrCreateDeviceSeed(data) {
    // FIX #2: sa volatile host (Render free plan, walang persistent disk),
    // HINDI na dapat mag-generate/mag-save ng random seed dahil ephemeral
    // din ang file kung saan ito naka-imbak — mawawala ito kada deploy,
    // kahit iisang OMNIPOS_FIXED_INSTALLATION_ID na naman ang gamit.
    // Resulta noon: parehong installationId pero IBANG "fingerprint" kada
    // deploy dahil random ang seed na bahagi nito — na-flag ito ng RELAY
    // bilang posibleng clone (403) kahit iisa lang talaga ang device.
    //
    // Ayos: sa volatile host, i-derive ang seed nang DETERMINISTIC mula
    // mismo sa fixed installation id (env var, hindi disk) — kaya pareho
    // palagi ang seed (at ang buong fingerprint) kada deploy. Kung walang
    // fixed id na naka-set, walang paraan para maging stable ang seed sa
    // volatile host — ibalik na lang ang null dito, para malinis na
    // mag-skip ng fingerprint enforcement ang caller (computeHardwareFingerprint)
    // sa halip na mag-compute ng random/hindi-stable na fingerprint.
    if (IS_VOLATILE_CLOUD_HOST) {
        const fixedId = process.env.OMNIPOS_FIXED_INSTALLATION_ID;
        if (!fixedId) return null;
        return crypto.createHash('sha256').update(`omnipos-fixed-seed:${fixedId}`).digest('hex');
    }

    if (data.deviceSeed) return data.deviceSeed;
    data.deviceSeed = crypto.randomBytes(32).toString('hex');
    writeData(FILE_FEATURE_UNLOCKS, data);
    return data.deviceSeed;
}

function getNonAndroidMachineParts() {

    if (IS_VOLATILE_CLOUD_HOST) {

        return [];
    }
    const parts = [];
    try { parts.push(os.hostname()); } catch (e) {}
    try { parts.push(os.platform()); } catch (e) {}
    try { parts.push(os.arch()); } catch (e) {}
    try {
        const cpus = os.cpus();
        if (cpus && cpus[0] && cpus[0].model) parts.push(cpus[0].model);
    } catch (e) {}
    try {

        const nets = os.networkInterfaces();
        const macs = Object.values(nets || {})
            .flat()
            .filter(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
            .map(n => n.mac)
            .sort();
        if (macs.length) parts.push(macs.join(','));
    } catch (e) {}
    try {

        if (fs.existsSync('/etc/machine-id')) {
            parts.push(fs.readFileSync('/etc/machine-id', 'utf8').trim());
        }
    } catch (e) {}
    return parts.filter(Boolean);
}

function computeHardwareFingerprint(data) {
    const androidParts = [
        getAndroidProp('ro.product.model'),
        getAndroidProp('ro.product.device'),
        getAndroidProp('ro.product.board'),
        getAndroidProp('ro.build.fingerprint'),
        getAndroidProp('ro.serialno'),
        getAndroidProp('ro.boot.serialno'),
    ].filter(Boolean);

    const seed = getOrCreateDeviceSeed(data);

    if (androidParts.length > 0) {
        // May stable hardware props na mula mismo sa Android device — kung
        // wala mang stable seed (volatile host + walang fixed id), sapat na
        // ang androidParts mag-isa dahil hardware-based na ito.
        const parts = seed ? [...androidParts, seed] : androidParts;
        return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
    }

    const machineParts = getNonAndroidMachineParts();
    const allParts = [...machineParts, seed].filter(Boolean);
    // FIX #2: kung walang natitirang bahagi (volatile host, walang fixed id
    // kaya null ang seed, at wala ring machine parts dahil volatile din),
    // ibalik ang null sa halip na mag-hash lang ng random-per-deploy na seed.
    // Sinusuportahan na ng caller (checkDeviceBeforeLogin) ang null fingerprint
    // bilang "hindi ma-enforce" — clean skip, hindi false clone-flag.
    if (allParts.length === 0) return null;
    return crypto.createHash('sha256').update(allParts.join('|')).digest('hex');
}

function getOrCreateInstallationId(data) {
    // FIX: sa Render Free plan, walang Persistent Disk, kaya ephemeral
    // ang buong filesystem (pati ang SQLite file kung saan naka-save
    // dating ang installationId) kada bagong deploy — bagong random
    // UUID kada git push kahit iisa lang talaga ang device.
    //
    // Ayos: kung naka-set ang OMNIPOS_FIXED_INSTALLATION_ID env var
    // (itakda ito ISANG BESES sa Render dashboard, hindi sa .env file
    // dahil hindi na-deploy yun), GAMITIN palagi ito bilang
    // installationId — hindi na ito mababago pa kada deploy dahil naka-
    // save na sa Render env vars mismo, hindi sa disk. Kung wala
    // itong env var (hal. lokal na Termux install na may sariling
    // disk), babalik sa dating behavior: generate once, i-save sa
    // local DB.
    const fixedId = process.env.OMNIPOS_FIXED_INSTALLATION_ID;
    if (fixedId) {
        if (data.installationId !== fixedId) {
            data.installationId = fixedId;
            writeData(FILE_FEATURE_UNLOCKS, data);
        }
        return data.installationId;
    }

    if (data.installationId) return data.installationId;
    data.installationId = crypto.randomUUID();
    writeData(FILE_FEATURE_UNLOCKS, data);
    return data.installationId;
}

function verifyUnlockToken(token, expectedInstallationId, expectedFeatureId) {
    if (!token || !token.payload || !token.signature) return false;
    const { installationId, featureId, issuedAt, expiresAt } = token.payload;
    if (installationId !== expectedInstallationId) return false;
    if (featureId !== expectedFeatureId) return false;
    if (typeof issuedAt !=='number') return false;

    if (typeof expiresAt ==='number' && Date.now() > expiresAt) return false;

    const payloadString = typeof expiresAt ==='number'
        ? JSON.stringify({ installationId, featureId, issuedAt, expiresAt })
        : JSON.stringify({ installationId, featureId, issuedAt });

    try {
        return crypto.verify(null, Buffer.from(payloadString), RELAY_PUBLIC_KEY, Buffer.from(token.signature,'base64'));
    } catch (err) {
        return false;
    }
}

function verifyAdminResetTicket(ticket, expectedInstallationId) {
    if (!ticket || !ticket.payload || !ticket.signature) return false;
    const { installationId, purpose, issuedAt, expiresAt } = ticket.payload;
    if (installationId !== expectedInstallationId) return false;
    if (purpose !== 'admin-password-reset') return false;
    if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number') return false;
    if (Date.now() > expiresAt) return false;

    const payloadString = JSON.stringify({ installationId, purpose, issuedAt, expiresAt });
    try {
        return crypto.verify(null, Buffer.from(payloadString), RELAY_PUBLIC_KEY, Buffer.from(ticket.signature, 'base64'));
    } catch (err) {
        return false;
    }
}

function verifyReceiptResetTicket(ticket, expectedInstallationId) {
    if (!ticket || !ticket.payload || !ticket.signature) return false;
    const { installationId, purpose, issuedAt, expiresAt } = ticket.payload;
    if (installationId !== expectedInstallationId) return false;
    if (purpose !== 'receipt-customization-reset') return false;
    if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number') return false;
    if (Date.now() > expiresAt) return false;

    const payloadString = JSON.stringify({ installationId, purpose, issuedAt, expiresAt });
    try {
        return crypto.verify(null, Buffer.from(payloadString), RELAY_PUBLIC_KEY, Buffer.from(ticket.signature, 'base64'));
    } catch (err) {
        return false;
    }
}

function verifyDevicePermit(permit, expectedInstallationId, expectedFingerprint) {
    if (!permit || !permit.payload || !permit.signature) return false;
    const { installationId, fingerprint, issuedAt } = permit.payload;
    if (installationId !== expectedInstallationId) return false;
    if (fingerprint !== expectedFingerprint) return false;
    if (typeof issuedAt !== 'number') return false;

    const payloadString = JSON.stringify({ installationId, fingerprint, issuedAt });
    try {
        return crypto.verify(null, Buffer.from(payloadString), RELAY_PUBLIC_KEY, Buffer.from(permit.signature, 'base64'));
    } catch (err) {
        return false;
    }
}

async function verifyDeviceWithRelay(installationId, hardwareFingerprint, { username, storeName } = {}) {
    if (!RELAY_API_KEY) {
        return { ok: false, reason: 'no_api_key', message: 'Walang RELAY_API_KEY na naka-configure sa server na ito.' };
    }

    if (!(await isInternetLikelyUp())) {
        return { ok: false, reason: 'unreachable', message: 'Walang internet connection na na-detect sa device na ito.' };
    }
    try {
        const relayRes = await relayFetch(`${RELAY_URL}/relay/verify-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId, hardwareFingerprint, username, storeName })
        });
        const relayData = await relayRes.json().catch(() => ({}));
        if (!relayRes.ok || !relayData.success) {
            return {
                ok: false,
                reason: relayData.cloneSuspected ? 'clone_suspected' : 'rejected',
                message: relayData.message || 'Tinanggihan ng RELAY ang device verification.'
            };
        }
        return {
            ok: true,
            allowed: !!relayData.allowed,

            reassignedInstallationId: relayData.reassignedInstallationId || null,

            permit: relayData.permit || null
        };
    } catch (err) {
        const message = err.name === 'AbortError'
            ? 'Hindi maabot ang RELAY (nag-timeout habang naghihintay ng response).'
            : `Hindi maabot ang RELAY (${err.message}).`;
        return { ok: false, reason: 'unreachable', message };
    }
}

async function checkDeviceBeforeLogin({ username } = {}) {
    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    const liveFingerprint = computeHardwareFingerprint(data);

    if (!liveFingerprint) {
        console.warn('⚠️ ANTI-CLONE: walang na-compute na hardware fingerprint — hindi ma-enforce ang device-binding check.');
        return { allowed: true };
    }

    const fingerprintUnchanged = data.deviceVerified && data.verifiedFingerprint === liveFingerprint;

    const permitOk = !data.devicePermit || verifyDevicePermit(data.devicePermit, installationId, liveFingerprint);

    if (fingerprintUnchanged && permitOk && data.relayAuthorized === true) {

        if (getConnectivityMode() === 'online') {
            verifyDeviceWithRelay(installationId, liveFingerprint, { username })
                .then(r => {
                    if (r.ok) {
                        const latest = readFeatureUnlocks();
                        if (r.permit) latest.devicePermit = r.permit;
                        latest.relayAuthorized = !!r.allowed;
                        writeData(FILE_FEATURE_UNLOCKS, latest);
                    }
                })
                .catch(() => {});
        }
        return { allowed: true };
    }

    const result = await verifyDeviceWithRelay(installationId, liveFingerprint, { username });

    if (!result.ok) {
        return {
            allowed: false,
            message: result.reason === 'clone_suspected'
                ? 'This device is not recognized. Please contact your administrator.'
                : 'Unable to verify this device right now. Please check your internet connection and try again.'
        };
    }

    const updated = readFeatureUnlocks();

    if (result.reassignedInstallationId && result.reassignedInstallationId !== installationId) {

        console.log(`ℹ️ ANTI-CLONE: hiwalay na installationId ang ibinigay ng RELAY (${result.reassignedInstallationId}) — ina-adopt lokal.`);
        updated.installationId = result.reassignedInstallationId;
        updated.tokens = {};
    } else {
        updated.installationId = installationId;
    }

    updated.deviceVerified = true;
    updated.verifiedFingerprint = liveFingerprint;
    updated.devicePermit = result.permit || null;
    updated.relayAuthorized = !!result.allowed;
    updated.firstVerifiedAt = updated.firstVerifiedAt || Date.now();
    updated.lastVerifiedAt = Date.now();
    writeData(FILE_FEATURE_UNLOCKS, updated);

    if (!result.allowed) {
        return {
            allowed: false,
            message: 'This device has been logged with the developer/store owner. Please wait for authorization (Allow) before it can log in. Contact the developer/store owner.'
        };
    }

    return { allowed: true };
}

const DEVICE_REVOCATION_RECHECK_MS = 3 * 60 * 1000;

let lastLiveRecheckAt = 0;

async function recheckDeviceAuthorizationLive() {
    try {

        if (SESSIONS.size === 0) return;
        if (getConnectivityMode() !== 'online') return;
        const data = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(data);
        const liveFingerprint = computeHardwareFingerprint(data);
        if (!liveFingerprint) return;

        const wasAuthorized = data.relayAuthorized === true;
        const result = await verifyDeviceWithRelay(installationId, liveFingerprint, {});

        if (!result.ok && result.reason === 'unreachable') return;

        const nowAuthorized = result.ok && !!result.allowed;

        const latest = readFeatureUnlocks();
        latest.relayAuthorized = nowAuthorized;
        if (result.ok && result.permit) latest.devicePermit = result.permit;
        writeData(FILE_FEATURE_UNLOCKS, latest);

        if (wasAuthorized && !nowAuthorized) {
            const revokedCount = SESSIONS.size;
            SESSIONS.clear();
            persistSessions();
            console.log(`🚫 DEVICE REVOKED: inalis ng developer/owner ang device na ito sa allowed list ng RELAY — na-force-logout ang ${revokedCount} aktibong session.`);
        }
    } catch (err) {
        console.error('⚠️ Hindi na-finish ang live device-authorization recheck:', err.message);
    }
}

const relayBackupStatus = {
    state: 'orange',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    path: null
};

async function runRelayBackupSync() {
    if (getConnectivityMode() === 'offline') {
        relayBackupStatus.state = 'orange';
        relayBackupStatus.lastError = 'Naka-OFFLINE mode — sinadya munang hindi tumatawag sa RELAY.';
        return;
    }

    if (!(await isInternetLikelyUp())) {
        relayBackupStatus.state = 'orange';
        relayBackupStatus.lastError = 'Walang internet connection na na-detect.';
        return;
    }
    relayBackupStatus.lastAttemptAt = Date.now();

    const mirrorResult = mirrorBackupToDownloads();
    if (!mirrorResult.success) {
        relayBackupStatus.state = 'orange';
        relayBackupStatus.lastError = mirrorResult.message;
        console.error('⚠️ RELAY_BACKUP: hindi na-mirror sa Download folder:', mirrorResult.message);
        return;
    }
    relayBackupStatus.path = mirrorResult.path;
    console.log(
        mirrorResult.existedBefore
            ? `🔁 RELAY_BACKUP: na-update ang existing na file sa ${mirrorResult.path} (${mirrorResult.sizeBytes} bytes)`
            : `🆕 RELAY_BACKUP: unang beses na nagawa ang file sa ${mirrorResult.path} (${mirrorResult.sizeBytes} bytes)`
    );

    if (!RELAY_API_KEY) {
        relayBackupStatus.state = 'orange';
        relayBackupStatus.lastError = 'Walang RELAY_API_KEY na naka-configure — hindi ma-checkin sa relay.';
        return;
    }

    try {
        const data = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(data);
        const receiptSettings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);

        const relayRes = await relayFetch(`${RELAY_URL}/relay/backup-checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({
                installationId,
                storeName: (receiptSettings && receiptSettings.storeName) || null,
                fileSizeBytes: mirrorResult.sizeBytes,
                backupAt: Date.now()
            })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success) {
            relayBackupStatus.state = 'orange';
            relayBackupStatus.lastError = relayData.message || 'Tinanggihan ng relay ang backup check-in.';
            return;
        }

        relayBackupStatus.state = 'green';
        relayBackupStatus.lastSuccessAt = Date.now();
        relayBackupStatus.lastError = null;
        console.log(`✅ RELAY_BACKUP: na-checkin sa relay (installationId: ${installationId}).`);
    } catch (err) {
        relayBackupStatus.state = 'orange';
        relayBackupStatus.lastError = err.message;
        console.error('⚠️ RELAY_BACKUP: hindi ma-abot ang relay para sa check-in:', err.message);
    }
}

if (!AUTO_BACKUP_DISABLED) {
    setTimeout(runRelayBackupSync, 40 * 1000);
    setInterval(runRelayBackupSync, 24 * 60 * 60 * 1000).unref();
}

app.get('/api/relay-backup/status', (req, res) => {
    res.json({ success: true, ...relayBackupStatus });
});

const INTEGRITY_SCAN_EXCLUDE_NAMES = new Set([
    // BUG FIX: dating hindi tugma ang exclude list na ito sa ginagamit
    // ng RELAY (buildFileManifest) at ng build-release.js (EXCLUDE set)
    // — kulang ng '.start.sh.lock' at '.self-update-backup' dito, kaya
    // kapag naka-start.sh ang OMNIPOS (may .start.sh.lock habang
    // tumatakbo) o may natirang self-update backup folder, PALAGING
    // "added" ang lumalabas sa integrity check kahit walang tunay na
    // binagong file — false positive kada check-in.
    '.env', '.env.key', 'database', 'node_modules', 'uploads_tmp',
    '.git', 'release', 'cf.log', 'server.log', '.start.sh.lock',
    '.self-update-backup', 'package-lock.json', 'certs'
]);
const INTEGRITY_SCAN_EXCLUDE_EXTENSIONS = new Set(['.log', '.patch']);

function computeInstallDirManifest() {
    const manifest = {};
    function walk(dir, relBase) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            return;
        }
        for (const entry of entries) {
            if (INTEGRITY_SCAN_EXCLUDE_NAMES.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(full, rel);
                continue;
            }
            if (INTEGRITY_SCAN_EXCLUDE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
            try {
                const hash = crypto.createHash('sha256');
                hash.update(fs.readFileSync(full));
                manifest[rel] = hash.digest('hex');
            } catch (err) {

            }
        }
    }
    walk(__dirname, '');
    return manifest;
}

const relayIntegrityStatus = {
    state: 'orange',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    flagged: false,
    modifiedCount: 0,
    deletedCount: 0,
    addedCount: 0
};

async function runRelayIntegrityCheckin() {
    if (getConnectivityMode() === 'offline') {
        relayIntegrityStatus.state = 'orange';
        relayIntegrityStatus.lastError = 'Naka-OFFLINE mode — sinadya munang hindi tumatawag sa RELAY.';
        return;
    }
    if (!(await isInternetLikelyUp())) {
        relayIntegrityStatus.state = 'orange';
        relayIntegrityStatus.lastError = 'Walang internet connection na na-detect.';
        return;
    }
    if (!RELAY_API_KEY) {
        relayIntegrityStatus.state = 'orange';
        relayIntegrityStatus.lastError = 'Walang RELAY_API_KEY na naka-configure — hindi ma-checkin sa relay.';
        return;
    }

    relayIntegrityStatus.lastAttemptAt = Date.now();

    try {
        const data = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(data);
        const files = computeInstallDirManifest();

        const relayRes = await relayFetch(`${RELAY_URL}/relay/integrity-checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({
                installationId,
                version: APP_VERSION,
                files,

                watcherActive: !INTEGRITY_MONITOR_DISABLED && integrityWatchers.size > 0
            })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success) {
            relayIntegrityStatus.state = 'orange';
            relayIntegrityStatus.lastError = relayData.message || 'Tinanggihan ng relay ang integrity check-in.';
            return;
        }

        relayIntegrityStatus.lastSuccessAt = Date.now();
        relayIntegrityStatus.lastError = null;
        relayIntegrityStatus.flagged = !!relayData.flagged;
        relayIntegrityStatus.modifiedCount = relayData.modifiedCount || 0;
        relayIntegrityStatus.deletedCount = relayData.deletedCount || 0;
        relayIntegrityStatus.addedCount = relayData.addedCount || 0;
        relayIntegrityStatus.state = relayData.flagged ? 'red' : 'green';

    } catch (err) {
        relayIntegrityStatus.state = 'orange';
        relayIntegrityStatus.lastError = err.message;

    }
}

if (!INTEGRITY_MONITOR_DISABLED) {
    setTimeout(runRelayIntegrityCheckin, 55 * 1000);
    setInterval(runRelayIntegrityCheckin, 24 * 60 * 60 * 1000).unref();
}

function hashBranchGroupKey(rawKey) {
    const trimmed = String(rawKey || '').trim();
    if (!trimmed) return null;
    return crypto.createHash('sha256').update(trimmed).digest('hex');
}

function computeBranchSummaryPayload() {
    const todayKey = new Date().toISOString().slice(0, 10);
    const transactions = readData(FILE_TRANSACTIONS);

    let grossSalesToday = 0;
    let transactionCountToday = 0;
    transactions.forEach((t) => {
        const dayKey = (t.isoDate ? t.isoDate.slice(0, 10) : (t.timestamp || '').slice(0, 10)) || null;
        if (dayKey !== todayKey) return;
        grossSalesToday += parseFloat(t.total) || 0;
        transactionCountToday += 1;
    });

    let lowStockCount = 0;
    try {
        lowStockCount = computeLowStockItems().length;
    } catch (err) {

        lowStockCount = 0;
    }

    let activeShiftCount = 0;
    try {
        const shiftMeta = readData(FILE_SHIFT_META, { cashiers: {} });
        const cashiers = (shiftMeta && shiftMeta.cashiers) || {};
        activeShiftCount = Object.values(cashiers).filter(
            (m) => m && m.beginningCash !== undefined && m.beginningCash !== null
        ).length;
    } catch (err) {
        activeShiftCount = 0;
    }

    return {
        grossSalesToday: Math.round(grossSalesToday * 100) / 100,
        netSalesToday: Math.round(grossSalesToday * 100) / 100,
        transactionCountToday,
        lowStockCount,
        activeShiftCount
    };
}

const relayBranchStatus = {
    state: 'orange',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null
};

async function runRelayBranchCheckin() {

    if (!getUnlockedFeatureIds().includes('multi_branch')) {
        relayBranchStatus.state = 'orange';
        relayBranchStatus.lastError = 'Naka-lock pa ang Multi-Branch Dashboard feature.';
        return;
    }

    const storeSettings = getStoreSettingsPublic(readData(FILE_STORE_SETTINGS, DEFAULT_STORE_SETTINGS));
    const groupKeyHash = hashBranchGroupKey(storeSettings.branchGroupKey);
    if (!groupKeyHash) return;

    if (getConnectivityMode() === 'offline') {
        relayBranchStatus.state = 'orange';
        relayBranchStatus.lastError = 'Naka-OFFLINE mode — sinadya munang hindi tumatawag sa RELAY.';
        return;
    }
    if (!(await isInternetLikelyUp())) {
        relayBranchStatus.state = 'orange';
        relayBranchStatus.lastError = 'Walang internet connection na na-detect.';
        return;
    }
    if (!RELAY_API_KEY) {
        relayBranchStatus.state = 'orange';
        relayBranchStatus.lastError = 'Walang RELAY_API_KEY na naka-configure — hindi ma-checkin sa relay.';
        return;
    }

    relayBranchStatus.lastAttemptAt = Date.now();

    try {
        const data = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(data);
        const summary = computeBranchSummaryPayload();

        const relayRes = await relayFetch(`${RELAY_URL}/relay/branch-checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({
                installationId,
                branchGroupKeyHash: groupKeyHash,
                branchName: storeSettings.branchName || null,
                summary
            })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success) {
            relayBranchStatus.state = 'orange';
            relayBranchStatus.lastError = relayData.message || 'Tinanggihan ng relay ang branch check-in.';
            return;
        }

        relayBranchStatus.state = 'green';
        relayBranchStatus.lastSuccessAt = Date.now();
        relayBranchStatus.lastError = null;
    } catch (err) {
        relayBranchStatus.state = 'orange';
        relayBranchStatus.lastError = err.message;
    }
}

setTimeout(runRelayBranchCheckin, 50 * 1000);
setInterval(runRelayBranchCheckin, 5 * 60 * 1000).unref();

app.get('/api/relay-branch/status', (req, res) => {
    res.json({ success: true, ...relayBranchStatus });
});

app.post('/api/relay-branch/checkin-now', requirePermission('store_settings_view'), requireFeature('multi_branch'), rateLimit('relay-branch-checkin-now', 10, 10 * 60 * 1000), async (req, res) => {
    const storeSettings = getStoreSettingsPublic(readData(FILE_STORE_SETTINGS, DEFAULT_STORE_SETTINGS));
    if (!hashBranchGroupKey(storeSettings.branchGroupKey)) {
        return res.status(400).json({
            success: false,
            message: 'Walang naka-set na Business Group Code. Ilagay muna ito sa itaas, i-Save, saka subukan ulit.'
        });
    }

    await runRelayBranchCheckin();

    if (relayBranchStatus.state === 'green') {
        return res.json({ success: true, message: 'Successful ang check-in! Makikita ka na ng ibang branch (o sila sayo) sa loob ng ilang segundo.', status: relayBranchStatus });
    }
    res.status(502).json({
        success: false,
        message: relayBranchStatus.lastError || 'Hindi na-checkin — hindi malinaw ang dahilan.',
        status: relayBranchStatus
    });
});

app.get('/api/branches/summary', requirePermission('branches_view'), requireFeature('multi_branch'), async (req, res) => {
    const storeSettings = getStoreSettingsPublic(readData(FILE_STORE_SETTINGS, DEFAULT_STORE_SETTINGS));
    const groupKeyHash = hashBranchGroupKey(storeSettings.branchGroupKey);

    if (!groupKeyHash) {
        return res.json({ success: true, configured: false, branchCount: 0, branches: [], combined: null });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, configured: true, message: 'Walang RELAY_API_KEY na naka-configure sa .env.' });
    }

    try {
        const data = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(data);
        const url = `${RELAY_URL}/relay/branch-summary?groupKeyHash=${encodeURIComponent(groupKeyHash)}&installationId=${encodeURIComponent(installationId)}`;

        const relayRes = await relayFetch(url, {
            method: 'GET',
            headers: { 'x-relay-key': RELAY_API_KEY }
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success) {
            return res.status(relayRes.status || 502).json({
                success: false,
                configured: true,
                message: relayData.message || 'Hindi makuha ang branch summary mula sa relay.'
            });
        }

        res.json({
            success: true,
            configured: true,
            branchCount: relayData.branchCount || 0,
            branches: (relayData.branches || []).map((b) => ({
                installationId: b.installationId,
                isSelf: b.installationId === installationId,
                branchName: b.branchName,
                summary: b.summary,
                updatedAt: b.updatedAt
            })),
            combined: relayData.combined || null
        });
    } catch (err) {
        res.status(502).json({ success: false, configured: true, message: `Hindi maabot ang relay: ${err.message}` });
    }
});

let integrityWatchDebounceTimer = null;
let integrityWatchLastRunAt = 0;
const INTEGRITY_WATCH_DEBOUNCE_MS = 800;
const INTEGRITY_WATCH_MIN_GAP_MS = 1500;
const integrityWatchers = new Map();

function scheduleIntegrityCheckinFromWatcher(changedPath) {
    if (integrityWatchDebounceTimer) clearTimeout(integrityWatchDebounceTimer);
    integrityWatchDebounceTimer = setTimeout(() => {
        integrityWatchDebounceTimer = null;
        const wait = Math.max(0, INTEGRITY_WATCH_MIN_GAP_MS - (Date.now() - integrityWatchLastRunAt));
        setTimeout(() => {
            integrityWatchLastRunAt = Date.now();
            runRelayIntegrityCheckin().catch(() => {});
        }, wait);
    }, INTEGRITY_WATCH_DEBOUNCE_MS);
}

function watchDirForIntegrity(dir) {
    if (integrityWatchers.has(dir)) return;
    try {
        const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
            scheduleIntegrityCheckinFromWatcher(filename ? path.join(dir, filename) : dir);
        });
        watcher.on('error', () => { integrityWatchers.delete(dir); });
        integrityWatchers.set(dir, watcher);
    } catch (err) {

    }
}

function refreshIntegrityWatchers() {

    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            return;
        }
        watchDirForIntegrity(dir);
        for (const entry of entries) {
            if (INTEGRITY_SCAN_EXCLUDE_NAMES.has(entry.name)) continue;
            if (entry.isDirectory()) walk(path.join(dir, entry.name));
        }
    }
    walk(__dirname);
}

if (!INTEGRITY_MONITOR_DISABLED) {
    setTimeout(refreshIntegrityWatchers, 10 * 1000);
    setInterval(refreshIntegrityWatchers, 5 * 60 * 1000).unref();
}

let integrityCheckNowInProgress = false;
const INTEGRITY_CHECK_NOW_POLL_MS = Number(process.env.RELAY_INTEGRITY_CHECK_NOW_POLL_MS) || 3 * 1000;

async function pollPendingIntegrityCheckNow() {
    if (!RELAY_API_KEY || getConnectivityMode() === 'offline') return;
    if (integrityCheckNowInProgress) return;
    if (!(await isInternetLikelyUp())) return;

    try {
        const data = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(data);

        const relayRes = await relayFetch(`${RELAY_URL}/relay/pending-integrity-check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId })
        }, 8000);
        const relayData = await parseRelayResponse(relayRes);

        if (relayData.success && relayData.pending) {
            integrityCheckNowInProgress = true;
            try {
                await runRelayIntegrityCheckin();
            } finally {
                integrityCheckNowInProgress = false;
            }
        }
    } catch (err) {

    }
}

if (!INTEGRITY_MONITOR_DISABLED && RELAY_API_KEY) {
    setTimeout(pollPendingIntegrityCheckNow, 15 * 1000);
    setInterval(() => { pollPendingIntegrityCheckNow().catch(() => {}); }, INTEGRITY_CHECK_NOW_POLL_MS).unref();
}

app.get('/api/relay-integrity/status', (req, res) => {
    res.json({ success: true, ...relayIntegrityStatus });
});

app.get('/api/connectivity-mode', (req, res) => {
    res.json({ success: true, mode: getConnectivityMode() });
});

app.post('/api/connectivity-mode', (req, res) => {
    const { mode } = req.body || {};
    if (mode !== 'online' && mode !== 'offline') {
        return res.status(400).json({ success: false, message: "Ang 'mode' ay dapat 'online' o 'offline'." });
    }
    const saved = setConnectivityMode(mode);
    res.json({ success: true, mode: saved });
});

const cloudBackupStatus = {
    state: 'idle',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastTotalRecords: null
};

app.get('/api/cloud-backup/status', (req, res) => {
    res.json({ success: true, ...cloudBackupStatus });
});

app.post('/api/cloud-backup/sync', requireFeature('cloud_backup'), async (req, res) => {

    const { username, password } = req.body || {};
    const currentUsersForSync = readData(FILE_USERS, []);
    const currentAdminForSync = currentUsersForSync.find(u => u.username && username && u.username.toLowerCase() === username.toLowerCase() && u.role && u.role.toLowerCase() === 'admin');
    if (!currentAdminForSync || !bcrypt.compareSync(password || '', currentAdminForSync.password)) {
        return res.status(403).json({ success: false, code: 'WRONG_ADMIN_PASSWORD', message: 'Maling Admin password. Hindi pinahintulutan ang cloud backup.' });
    }

    if (getConnectivityMode() === 'offline') {
        return res.status(400).json({ success: false, message: 'Naka-OFFLINE mode ka ngayon. I-tap muna ang Online toggle para makapag-backup sa cloud.' });
    }
    cloudBackupStatus.state = 'syncing';
    cloudBackupStatus.lastAttemptAt = Date.now();

    if (!RELAY_API_KEY) {
        cloudBackupStatus.state = 'error';
        cloudBackupStatus.lastError = 'Walang RELAY_API_KEY na naka-configure sa .env.';
        return res.status(500).json({ success: false, message: cloudBackupStatus.lastError });
    }

    try {
        const featureData = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(featureData);
        const receiptSettings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
        const backupPayload = getCloudBackupPayload();

        const relayRes = await relayFetch(`${RELAY_URL}/relay/cloud-backup/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({
                installationId,
                storeName: (receiptSettings && receiptSettings.storeName) || null,
                modules: backupPayload.modules,
                moduleNames: backupPayload.moduleNames,
                totalRecords: backupPayload.totalRecords,
                generatedAt: backupPayload.generatedAt
            })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayRes.status === 402 || relayData.featureLocked) {
            cloudBackupStatus.state = 'error';
            cloudBackupStatus.lastError = relayData.message || 'Naka-lock pa ang Cloud Backup feature.';
            return res.status(402).json(relayData);
        }

        // BUG FIX: kapag masyado nang malaki ang datos ng store (lumagpas sa
        // limit ng RELAY para sa cloud-backup upload), tinutugunan na ito ng
        // RELAY ng malinaw na JSON message (payloadTooLarge: true) sa halip
        // na basta i-reject nang tahimik. Ipinapasa ito rito bilang sarili
        // niyang 413 (hindi na lang generic 502), para makapag-display ang
        // frontend ng malinaw na prompt sa user (tingnan ang message sa RELAY)
        // sa halip na basta "cloud backup failed."
        if (relayRes.status === 413 || relayData.payloadTooLarge) {
            cloudBackupStatus.state = 'error';
            cloudBackupStatus.lastError = relayData.message || 'Masyado nang malaki ang datos para ma-backup sa cloud.';
            return res.status(413).json({ success: false, payloadTooLarge: true, message: cloudBackupStatus.lastError });
        }

        if (!relayData.success) {
            cloudBackupStatus.state = 'error';
            cloudBackupStatus.lastError = relayData.message || 'Tinanggihan ng RELAY ang cloud backup upload.';
            return res.status(502).json({ success: false, message: cloudBackupStatus.lastError });
        }

        cloudBackupStatus.state = 'success';
        cloudBackupStatus.lastSuccessAt = Date.now();
        cloudBackupStatus.lastError = null;
        cloudBackupStatus.lastTotalRecords = backupPayload.totalRecords;

        logAction((req.authUser && req.authUser.username) || 'Unknown', `Cloud Backup: synced ${backupPayload.moduleNames.length} modules (${backupPayload.totalRecords} records) to cloud.`);

        res.json({
            success: true,
            message: 'Matagumpay na na-sync ang database papunta sa cloud (Postgres).',
            totalRecords: backupPayload.totalRecords,
            moduleNames: backupPayload.moduleNames,
            excludedModules: backupPayload.excludedModules
        });
    } catch (err) {
        cloudBackupStatus.state = 'error';
        cloudBackupStatus.lastError = err.message;
        console.error('⚠️ CLOUD_BACKUP: hindi na-abot ang relay para sa upload:', err.message);
        res.status(502).json({ success: false, message: 'Hindi ma-abot ang RELAY para sa cloud backup upload.' });
    }
});

function mergeRestoredUsers(restoredUsers) {
    const currentUsers = readData(FILE_USERS, []);
    const currentByUsername = new Map(
        currentUsers.map(u => [String(u.username || '').toLowerCase(), u])
    );
    const accountsNeedingPasswordReset = [];

    const merged = restoredUsers.map(record => {
        const clone = { ...record };
        const key = String(clone.username || '').toLowerCase();
        const existing = currentByUsername.get(key);
        if (existing && existing.password) {
            clone.password = existing.password;
        } else {

            clone.password = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
            accountsNeedingPasswordReset.push(clone.username);
        }
        return clone;
    });

    return { merged, accountsNeedingPasswordReset };
}

app.post('/api/cloud-backup/restore', requireFeature('cloud_backup'), rateLimit('cloud-backup-restore', 5, 15 * 60 * 1000), async (req, res) => {
    const { username, password } = req.body;

    const currentUsers = readData(FILE_USERS, []);
    const currentAdmin = currentUsers.find(u => u.username && username && u.username.toLowerCase() === username.toLowerCase() && u.role && u.role.toLowerCase() === 'admin');
    if (!currentAdmin || !bcrypt.compareSync(password || '', currentAdmin.password)) {
        return res.status(403).json({ success: false, code: 'WRONG_ADMIN_PASSWORD', message: 'Maling Admin password. Hindi pinahintulutan ang pag-restore.' });
    }

    if (getConnectivityMode() === 'offline') {
        return res.status(400).json({ success: false, message: 'Naka-OFFLINE mode ka ngayon. I-tap muna ang Online toggle para makapag-restore mula sa cloud.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message: 'Walang RELAY_API_KEY na naka-configure sa .env.' });
    }

    try {
        const featureData = readFeatureUnlocks();
        const installationId = getOrCreateInstallationId(featureData);
        const hardwareFingerprint = computeHardwareFingerprint(featureData);

        const relayRes = await relayFetch(`${RELAY_URL}/relay/cloud-backup/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId, hardwareFingerprint })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayRes.status === 402 || relayData.featureLocked) {
            return res.status(402).json(relayData);
        }
        if (!relayData.success) {
            return res.status(relayRes.status || 502).json({ success: false, message: relayData.message || 'Tinanggihan ng RELAY ang cloud backup restore.' });
        }

        const modules = relayData.modules || {};
        let restoredCount = 0;
        const accountsNeedingPasswordReset = [];

        for (const [moduleName, data] of Object.entries(modules)) {
            if (moduleName === 'users' && Array.isArray(data)) {
                const { merged, accountsNeedingPasswordReset: needReset } = mergeRestoredUsers(data);
                writeData(moduleName, merged);
                accountsNeedingPasswordReset.push(...needReset);
                restoredCount++;
            } else if (Array.isArray(data) || (data && typeof data === 'object')) {
                writeData(moduleName, data);
                restoredCount++;
            }
        }

        logAction(username, `Cloud Backup: restored ${restoredCount}/${Object.keys(modules).length} modules.`);

        res.json({
            success: true,
            message: `Matagumpay na na-restore ang ${restoredCount} module(s) mula sa Cloud Backup.`,
            restoredCount,
            moduleNames: Object.keys(modules),
            accountsNeedingPasswordReset
        });
    } catch (err) {
        console.error('⚠️ CLOUD_BACKUP: hindi na-abot ang relay para sa restore:', err.message);
        res.status(502).json({ success: false, message: 'Hindi ma-abot ang RELAY para sa cloud backup restore.' });
    }
});

function isDemoActive() {
    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);
    const token = data.tokens[DEMO_FEATURE_ID];
    if (!token) return false;
    return verifyUnlockToken(token, installationId, DEMO_FEATURE_ID);
}

function getDemoExpiry() {
    const data = readFeatureUnlocks();
    const token = data.tokens[DEMO_FEATURE_ID];
    if (!token || !token.payload) return null;
    return typeof token.payload.expiresAt ==='number' ? token.payload.expiresAt : null;
}

function getPurchasedFeatureIds() {
    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);
    return Object.keys(data.tokens)
        .filter(featureId => featureId !== DEMO_FEATURE_ID)
        .filter(featureId => verifyUnlockToken(data.tokens[featureId], installationId, featureId));
}

function getUnlockedFeatureIds() {
    const purchased = getPurchasedFeatureIds();

    if (isDemoActive()) {
        return Array.from(new Set([...Object.keys(FEATURE_CATALOG), ...purchased]));
    }
    return purchased;
}

function isFullyProUnlocked() {
    const purchased = getPurchasedFeatureIds();
    const allIds = Object.keys(FEATURE_CATALOG).filter(id => id !== CLOUD_BACKUP_FEATURE_ID);
    return allIds.length > 0 && allIds.every(id => purchased.includes(id));
}

function requireFeature(featureId) {
    return (req, res, next) => {
        const unlockedIds = getUnlockedFeatureIds();
        if (unlockedIds.includes(featureId)) return next();
        const feature = FEATURE_CATALOG[featureId];
        const attemptCount = recordLockedAttempt();
        return res.status(402).json({
            success: false,
            featureLocked: true,
            featureId,
            featureName: feature ? feature.name : featureId,
            price: feature ? feature.price : null,
            description: feature ? feature.description : null,

            showUpgradeTiers: featureId === CLOUD_BACKUP_FEATURE_ID
                ? false
                : (attemptCount > 0 && attemptCount % 2 === 0),
            message: `"${feature ? feature.name : featureId}" is a premium feature and is currently locked. Please unlock it (additional purchase required) to continue.`
        });
    };
}

function checkShiftManagementUnlocked() {
    const unlockedIds = getUnlockedFeatureIds();
    if (unlockedIds.includes('shift_management')) return { unlocked: true };
    const feature = FEATURE_CATALOG['shift_management'];
    const attemptCount = recordLockedAttempt();
    return {
        unlocked: false,
        body: {
            success: false,
            featureLocked: true,
            featureId:'shift_management',
            featureName: feature ? feature.name :'shift_management',
            price: feature ? feature.price : null,
            showUpgradeTiers: attemptCount > 0 && attemptCount % 2 === 0,
            message: `"${feature ? feature.name :'shift_management'}" is a premium feature and is currently locked. Please unlock it (additional purchase required) to continue.`
        }
    };
}

async function attemptRelayRestore() {
    if (!RELAY_API_KEY) return { attempted: false, restoredCount: 0, restoredFeatureIds: [] };

    if (getConnectivityMode() === 'offline') {
        return { attempted: false, restoredCount: 0, restoredFeatureIds: [] };
    }

    if (!(await isInternetLikelyUp())) {
        return { attempted: false, restoredCount: 0, restoredFeatureIds: [] };
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    try {
        const relayRes = await relayFetch(`${RELAY_URL}/relay/restore-tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success || !relayData.tokens) {
            return { attempted: true, restoredCount: 0, restoredFeatureIds: [] };
        }

        let restoredCount = 0;
        const restoredFeatureIds = [];
        for (const [featureId, token] of Object.entries(relayData.tokens)) {

            if (data.tokens[featureId] && verifyUnlockToken(data.tokens[featureId], installationId, featureId)) {
                continue;
            }
            if (!verifyUnlockToken(token, installationId, featureId)) continue;
            data.tokens[featureId] = token;
            restoredCount++;
            restoredFeatureIds.push(featureId);
        }

        if (restoredCount > 0) {
            writeData(FILE_FEATURE_UNLOCKS, data);
            logAction('System', `Automatically restored ${restoredCount} feature(s) from Relay (post-reset check-in).`);
        }

        return { attempted: true, restoredCount, restoredFeatureIds };
    } catch (err) {
        console.warn('⚠️  Could not reach Relay for auto-restore check:', err.message);
        return { attempted: true, restoredCount: 0, restoredFeatureIds: [], error: err.message };
    }
}

setTimeout(() => {
    attemptRelayRestore().catch(() => {});
}, 3000);

async function attemptRelayFeatureSync() {
    const restoreResult = await attemptRelayRestore();
    const restoredFeatureIds = restoreResult.restoredFeatureIds || [];

    if (!RELAY_API_KEY || getConnectivityMode() === 'offline' || !(await isInternetLikelyUp())) {
        return { attempted: restoreResult.attempted, restoredCount: restoreResult.restoredCount || 0, restoredFeatureIds, removedFeatures: [] };
    }

    const latestData = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(latestData);
    const localFeatureIds = Object.keys(latestData.tokens);

    const removedFeatures = [];

    try {
        const relayRes = await relayFetch(`${RELAY_URL}/relay/check-feature-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },

            body: JSON.stringify({ installationId, featureIds: localFeatureIds })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayData.success && relayData.forceIntegrityCheck) {

            runRelayIntegrityCheckin().catch(() => {});
        }

        if (relayData.success && relayData.statuses && typeof relayData.statuses === 'object') {
            for (const [featureId, info] of Object.entries(relayData.statuses)) {
                if (!info || info.status === 'active') continue;
                if (!latestData.tokens[featureId]) continue;

                delete latestData.tokens[featureId];
                removedFeatures.push({
                    featureId,
                    featureName: info.featureName || (FEATURE_CATALOG[featureId] && FEATURE_CATALOG[featureId].name) || featureId,
                    category: info.category || (FEATURE_CATALOG[featureId] && FEATURE_CATALOG[featureId].category) || 'module',
                    reason: info.reason === 'expired' ? 'expired' : 'deactivated'
                });
            }

            if (removedFeatures.length > 0) {
                writeData(FILE_FEATURE_UNLOCKS, latestData);
                const summary = removedFeatures.map(r => `${r.featureName} (${r.reason})`).join(', ');
                logAction('System', `Automatically locked ${removedFeatures.length} feature(s) after detecting they are no longer active on Relay (manual sync): ${summary}.`);
            }
        }
    } catch (err) {
        console.warn('⚠️  Could not reach Relay for the feature status check:', err.message);
    }

    return { attempted: true, restoredCount: restoreResult.restoredCount || 0, restoredFeatureIds, removedFeatures };
}

const RELAY_FEATURE_SYNC_INTERVAL_MS = Number(process.env.RELAY_FEATURE_SYNC_INTERVAL_MS) || 30 * 1000;
if (RELAY_API_KEY) {

    setTimeout(() => { attemptRelayFeatureSync().catch(() => {}); }, 10 * 1000);
    setInterval(() => { attemptRelayFeatureSync().catch(() => {}); }, RELAY_FEATURE_SYNC_INTERVAL_MS).unref();
}

app.post('/api/features/restore-check', rateLimit('feature-restore-check', 10, 10 * 60 * 1000), async (req, res) => {
    const result = await attemptRelayFeatureSync();

    const restoredFeatureIds = result.restoredFeatureIds || [];
    const demoRestored = restoredFeatureIds.includes(DEMO_FEATURE_ID);
    const purchasedRestoredCount = restoredFeatureIds.filter(id => id !== DEMO_FEATURE_ID).length;

    const messageParts = [];
    if (purchasedRestoredCount > 0) {
        messageParts.push(`Restored ${purchasedRestoredCount} previously purchased feature(s).`);
    }
    if (demoRestored) {
        messageParts.push('Restored an active Demo Mode session for this device.');
    }
    if (result.removedFeatures.length > 0) {
        messageParts.push(`Locked ${result.removedFeatures.length} feature(s) that are no longer active on Relay (deactivated or expired).`);
    }
    if (messageParts.length === 0) {
        messageParts.push('Nothing newly restored — no configurations or previously unlocked features detected for this device.');
    }

    res.json({
        success: true,
        restoredCount: result.restoredCount,
        restoredFeatureIds,
        demoRestored,
        purchasedRestoredCount,
        removedFeatures: result.removedFeatures,
        message: messageParts.join(' '),
        unlockedFeatureIds: getUnlockedFeatureIds()
    });
});

app.get('/api/features/status', (req, res) => {
    res.json({
        success: true,
        unlockedFeatureIds: getUnlockedFeatureIds(),

        purchasedFeatureIds: getPurchasedFeatureIds(),
        fullyPurchased: isFullyProUnlocked()
    });
});

async function parseRelayResponse(relayRes) {
    const rawText = await relayRes.text();
    let parsed;
    try {
        parsed = rawText ? JSON.parse(rawText) : {};
    } catch (err) {
        throw new Error(
            `the relay returned an unexpected non-JSON response (HTTP ${relayRes.status}). ` +
            `This usually means the relay service isn't running, RELAY_URL is misconfigured, ` +
            `or the relay crashed and returned an error page instead of JSON.`
        );
    }
    if (!relayRes.ok && parsed.success === undefined) {
        throw new Error(parsed.message || `the relay responded with HTTP ${relayRes.status}.`);
    }
    return parsed;
}

function relayRejectionResponse(res, relayData, fallbackMessage) {
    if (relayData && relayData.deviceNotAllowed) {
        return res.status(403).json({
            success: false,
            pendingAuthorization: true,
            message: 'Naipadala na ang device na ito papuntang developer/store owner para sa authorization. Wala pang access ang device na ito — maghintay lang na ma-\"Allow\" ka sa Relay admin panel, at awtomatiko na itong susubukan ulit.'
        });
    }
    return res.status(502).json({ success: false, message: (relayData && relayData.message) || fallbackMessage });
}

app.post('/api/features/request-unlock', requirePermission('relay_unlock_request'), rateLimit('feature-unlock-request', 3, 10 * 60 * 1000), async (req, res) => {
    const { featureId, username, photo } = req.body;
    const feature = FEATURE_CATALOG[featureId];

    if (!feature) {
        return res.status(400).json({ success: false, message:'Unknown feature.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message:'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    if (data.tokens[featureId] && verifyUnlockToken(data.tokens[featureId], installationId, featureId)) {
        return res.json({ success: true, alreadyUnlocked: true, message: `Naka-unlock na ang ${feature.name}.` });
    }

    try {
        const receiptSettings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
        const relayRes = await relayFetch(`${RELAY_URL}/relay/request-unlock`, {
            method:'POST',
            headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({
                installationId,
                featureId,
                featureName: feature.name,
                price: feature.price,
                username: username ||'Unknown',
                storeName: (receiptSettings && receiptSettings.storeName) || null,
                photo: photo || null
            })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success) {
            return relayRejectionResponse(res, relayData, 'The unlock relay declined the request.');
        }

        logAction(username ||'Unknown', `Humiling ng OTP para i-unlock ang ${feature.name}`);
        res.json({ success: true, message:'The unlock request has been sent. Please wait for the confirmation code from the developer/owner.' });
    } catch (err) {
        console.error('Hindi ma-abot ang Unlock Relay:', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}. Please verify RELAY_URL and your internet connection.` });
    }
});

app.post('/api/features/confirm-unlock', rateLimit('feature-unlock-confirm', 120, 10 * 60 * 1000), async (req, res) => {
    const { featureId, otp, username } = req.body;
    const feature = FEATURE_CATALOG[featureId];

    if (!feature) {
        return res.status(400).json({ success: false, message:'Unknown feature.' });
    }
    if (!otp || !String(otp).trim()) {
        return res.status(400).json({ success: false, message:'The OTP code is required.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message:'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    try {
        const relayRes = await relayFetch(`${RELAY_URL}/relay/confirm-unlock`, {
            method:'POST',
            headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId, featureId, otp: String(otp).trim() })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayData.pending) {
            return res.status(202).json({ success: false, pending: true, message: relayData.message || 'Tama ang code — naghihintay ng approval ng may-ari.' });
        }

        if (!relayData.success) {
            return res.status(400).json({ success: false, message: relayData.message ||'Failed to verify the code.' });
        }

        if (!verifyUnlockToken(relayData.token, installationId, featureId)) {
            console.error('⚠️ Natanggap ang isang token mula sa relay pero HINDI valid ang signature nito. Posibleng may problema sa RELAY_PUBLIC_KEY_PEM o kompromisado ang koneksyon.');
            return res.status(500).json({ success: false, message:'Hindi valid ang signature ng token na natanggap. Kontakin ang developer.' });
        }

        data.tokens[featureId] = relayData.token;
        writeData(FILE_FEATURE_UNLOCKS, data);
        logAction(username ||'Unknown', `Na-unlock ang feature: ${feature.name}`);

        res.json({ success: true, message: `${feature.name} has been unlocked!`, unlockedFeatureIds: getUnlockedFeatureIds() });
    } catch (err) {
        console.error('Hindi ma-abot ang Unlock Relay:', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}. Please verify RELAY_URL and your internet connection.` });
    }
});

app.post('/api/admin/request-password-reset',
    rateLimit('admin-reset-request', 3, 15 * 60 * 1000),
    async (req, res) => {
        if (!RELAY_API_KEY) {
            return res.status(500).json({ success: false, message: 'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
        }
        try {
            const data = readFeatureUnlocks();
            const installationId = getOrCreateInstallationId(data);
            const receiptSettings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
            const storeName = (receiptSettings && receiptSettings.storeName) || null;

            const users = readData(FILE_USERS) || [];
            const adminUser = users.find(u => u.role === 'Admin');

            const relayRes = await relayFetch(`${RELAY_URL}/relay/request-admin-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
                body: JSON.stringify({
                    installationId,
                    storeName,
                    hintUsername: adminUser ? adminUser.username : null
                })
            });
            const relayData = await parseRelayResponse(relayRes);
            res.status(relayRes.status).json(relayData);
        } catch (err) {
            console.error('Hindi ma-abot ang Unlock Relay (admin-reset):', err);
            res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}.` });
        }
    }
);

app.post('/api/admin/confirm-password-reset',

    rateLimit('admin-reset-confirm', 120, 10 * 60 * 1000),
    async (req, res) => {
        const { otp } = req.body;

        const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword.trim() : req.body.newPassword;
        if (!otp || !newPassword) {
            return res.status(400).json({ success: false, message: 'Kulang ang otp o newPassword.' });
        }
        if (String(newPassword).length < 8) {
            return res.status(400).json({ success: false, message: 'Dapat hindi bababa sa 8 characters ang bagong password.' });
        }
        if (!RELAY_API_KEY) {
            return res.status(500).json({ success: false, message: 'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
        }

        try {
            const data = readFeatureUnlocks();
            const installationId = getOrCreateInstallationId(data);

            const relayRes = await relayFetch(`${RELAY_URL}/relay/confirm-admin-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-relay-key': RELAY_API_KEY },
                body: JSON.stringify({ installationId, otp: String(otp).trim() })
            });
            const relayData = await parseRelayResponse(relayRes);

            if (relayData.pending) {
                return res.status(202).json({ success: false, pending: true, message: relayData.message || 'Tama ang OTP! Naghihintay pa lang ng approval mula sa developer.' });
            }

            if (!relayData.success) {
                return res.status(relayRes.status === 200 ? 400 : relayRes.status).json(relayData);
            }

            if (!verifyAdminResetTicket(relayData.ticket, installationId)) {
                console.error('⚠️ Natanggap ang isang admin-reset ticket mula sa relay pero HINDI valid ang signature nito. Posibleng may problema sa RELAY_PUBLIC_KEY_PEM o kompromisado ang koneksyon.');
                return res.status(400).json({ success: false, message: 'Hindi valid ang reset ticket na natanggap. Subukan ulit.' });
            }

            let users = readData(FILE_USERS) || [];
            const adminIndex = users.findIndex(u => u.role === 'Admin');
            if (adminIndex === -1) {
                return res.status(404).json({ success: false, message: 'Walang nahanap na Admin account.' });
            }

            users[adminIndex].password = bcrypt.hashSync(newPassword, 10);
            const adminUsername = users[adminIndex].username;
            const writeOk = writeData(FILE_USERS, users);

            const verifyUsers = readData(FILE_USERS) || [];
            const verifyUser = verifyUsers.find(u => u.username === adminUsername);
            const verified = writeOk && verifyUser && (() => {
                try { return bcrypt.compareSync(newPassword, verifyUser.password); }
                catch (e) { return false; }
            })();

            if (!verified) {
                console.error(`⚠️ Nabigo ang pag-save ng bagong Admin password para sa "${adminUsername}" — hindi na-verify ang bagong hash pagkatapos mag-writeData(). Posibleng may problema sa lokal na database (SQLite lock/disk).`);
                return res.status(500).json({
                    success: false,
                    message: 'Nabigo ang pag-save ng bagong password sa lokal na database. Hindi nagbago ang password mo — subukan ulit, at kung paulit-ulit itong nangyayari, i-check ang storage/permissions ng device.'
                });
            }

            logAction('System (Relay Admin Reset)', 'Admin password na-reset gamit ang Relay-verified OTP flow.');

            res.json({ success: true, message: 'Na-update na ang Admin password. Puwede ka nang mag-login gamit ang bago.' });
        } catch (err) {
            console.error('Hindi ma-abot ang Unlock Relay (admin-reset):', err);
            res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}.` });
        }
    }
);

app.post('/api/features/request-demo', requirePermission('relay_unlock_request'), rateLimit('feature-demo-request', 3, 10 * 60 * 1000), async (req, res) => {
    const { username, photo } = req.body;

    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message:'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    if (isDemoActive()) {
        return res.json({ success: true, alreadyActive: true, message:'Aktibo na ang Demo Mode.', demoExpiresAt: getDemoExpiry() });
    }

    try {
        const receiptSettings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
        const relayRes = await relayFetch(`${RELAY_URL}/relay/request-demo`, {
            method:'POST',
            headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({
                installationId,
                username: username ||'Unknown',
                storeName: (receiptSettings && receiptSettings.storeName) || null,
                photo: photo || null
            })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success) {
            return relayRejectionResponse(res, relayData, 'The unlock relay declined the request.');
        }

        logAction(username ||'Unknown','Humiling ng OTP para sa Demo Mode');
        res.json({ success: true, message:'The demo request has been sent. Please wait for the confirmation code from the developer/owner.' });
    } catch (err) {
        console.error('Hindi ma-abot ang Unlock Relay (demo):', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}. Please verify RELAY_URL and your internet connection.` });
    }
});

app.post('/api/features/confirm-demo', rateLimit('feature-demo-confirm', 120, 10 * 60 * 1000), async (req, res) => {
    const { otp, username } = req.body;

    if (!otp || !String(otp).trim()) {
        return res.status(400).json({ success: false, message:'The OTP code is required.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message:'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    try {
        const relayRes = await relayFetch(`${RELAY_URL}/relay/confirm-demo`, {
            method:'POST',
            headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId, otp: String(otp).trim() })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayData.pending) {
            return res.status(202).json({ success: false, pending: true, message: relayData.message || 'Tama ang code — naghihintay ng approval ng may-ari.' });
        }

        if (!relayData.success) {
            return res.status(400).json({ success: false, message: relayData.message ||'Failed to verify the code.' });
        }

        if (!verifyUnlockToken(relayData.token, installationId, DEMO_FEATURE_ID)) {
            console.error('⚠️ Natanggap ang isang demo token mula sa relay pero HINDI valid ang signature/expiry nito.');
            return res.status(500).json({ success: false, message:'Hindi valid ang signature ng token na natanggap. Kontakin ang developer.' });
        }

        data.tokens[DEMO_FEATURE_ID] = relayData.token;
        writeData(FILE_FEATURE_UNLOCKS, data);
        logAction(username ||'Unknown','Na-activate ang Demo Mode');

        res.json({
            success: true,
            message:'Demo Mode has been activated!',
            demoExpiresAt: getDemoExpiry(),
            unlockedFeatureIds: getUnlockedFeatureIds()
        });
    } catch (err) {
        console.error('Hindi ma-abot ang Unlock Relay (demo confirm):', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}. Please verify RELAY_URL and your internet connection.` });
    }
});

app.get('/api/features/demo-status', (req, res) => {
    const active = isDemoActive();
    res.json({
        success: true,
        demoActive: active,
        demoExpiresAt: active ? getDemoExpiry() : null,
        fullyPurchased: isFullyProUnlocked()
    });
});

app.post('/api/features/end-demo', async (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Aksyon Tinanggihan: Admin privileges lamang ang pwedeng magtapos ng Demo Mode nang maaga.' });
    }
    const data = readFeatureUnlocks();
    if (!data.tokens[DEMO_FEATURE_ID]) {
        return res.json({ success: true, alreadyInactive: true, message:'Wala namang aktibong Demo Mode.' });
    }
    delete data.tokens[DEMO_FEATURE_ID];
    writeData(FILE_FEATURE_UNLOCKS, data);
    logAction(req.authUser.username,'Manual na tinapos ang Demo Mode bago pa man mag-expire.');

    if (RELAY_API_KEY) {
        try {
            const installationId = getOrCreateInstallationId(data);
            const relayRes = await relayFetch(`${RELAY_URL}/relay/end-demo`, {
                method:'POST',
                headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
                body: JSON.stringify({ installationId })
            });
            const relayData = await relayRes.json().catch(() => null);
            if (!relayRes.ok || !relayData || !relayData.success) {
                console.warn('⚠️ END_DEMO: hindi na-confirm ng RELAY ang pagtatapos ng demo (lokal na tapos na ito pero maaaring "bumalik" pa mula sa RELAY sa susunod na restore):', relayData && relayData.message);
            }
        } catch (e) {
            console.warn('⚠️ END_DEMO: hindi na-abot ang RELAY para tuluyang tapusin ang demo doon:', e.message);
        }
    }

    res.json({
        success: true,
        message:'Demo Mode has been closed.',
        unlockedFeatureIds: getUnlockedFeatureIds(),
        fullyPurchased: isFullyProUnlocked()
    });
});

app.get('/api/features/upgrade-catalog', (req, res) => {
    const alreadyPurchased = getPurchasedFeatureIds();

    const features = Object.keys(FEATURE_CATALOG)
        .map(id => ({ id, ...FEATURE_CATALOG[id] }));
    const tiers = UPGRADE_TIERS.map(tier => {
        const { discount, effectivePrice } = getTierPricing(tier, alreadyPurchased);
        const remainingFeatureIds = tier.featureIds.filter(id => !alreadyPurchased.includes(id));
        return {
            id: tier.id,
            name: tier.name,
            description: tier.description,
            featureIds: tier.featureIds,
            alaCartePrice: sumFeaturePrices(remainingFeatureIds),
            bundlePrice: tier.bundlePrice,
            bundleSavings: discount,
            effectiveBundlePrice: effectivePrice
        };
    });
    res.json({ success: true, features, tiers });
});

app.post('/api/features/request-unlock-bulk', requirePermission('relay_unlock_request'), rateLimit('feature-unlock-bulk-request', 3, 10 * 60 * 1000), async (req, res) => {
    const { featureIds, tierId, username, photo } = req.body;

    if (!Array.isArray(featureIds) || featureIds.length === 0) {
        return res.status(400).json({ success: false, message:'featureIds must be a non-empty array.' });
    }
    const unknown = featureIds.filter(id => !FEATURE_CATALOG[id]);
    if (unknown.length) {
        return res.status(400).json({ success: false, message: `Unknown feature(s): ${unknown.join(', ')}` });
    }

    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message:'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    const alreadyPurchased = getPurchasedFeatureIds();
    const stillLocked = featureIds.filter(id => !alreadyPurchased.includes(id));
    if (stillLocked.length === 0) {
        return res.json({ success: true, alreadyUnlocked: true, message:'All selected items are already unlocked.' });
    }

    let totalPrice = sumFeaturePrices(stillLocked);
    if (tierId) {
        const tier = UPGRADE_TIERS.find(t => t.id === tierId);
        if (tier) {
            const tierStillLocked = tier.featureIds.filter(id => !alreadyPurchased.includes(id));
            const sameSet = tierStillLocked.length === stillLocked.length &&
                tierStillLocked.every(id => stillLocked.includes(id));
            if (sameSet) {
                totalPrice = getTierPricing(tier, alreadyPurchased).effectivePrice;
            }
        }
    }

    try {
        const receiptSettings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
        const relayRes = await relayFetch(`${RELAY_URL}/relay/request-unlock-bulk`, {
            method:'POST',
            headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({
                installationId,
                featureIds: stillLocked,
                featureNames: stillLocked.map(id => FEATURE_CATALOG[id].name),
                totalPrice,
                username: username ||'Unknown',
                storeName: (receiptSettings && receiptSettings.storeName) || null,
                photo: photo || null
            })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success) {
            return relayRejectionResponse(res, relayData, 'The unlock relay declined the request.');
        }

        logAction(username ||'Unknown', `Requested OTP to unlock ${stillLocked.length} feature(s) (₱${totalPrice})`);
        res.json({ success: true, message:'The bundle unlock request has been sent. Please wait for the confirmation code.', totalPrice, featureIds: stillLocked });
    } catch (err) {
        console.error('Could not reach the Unlock Relay (bulk):', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}. Please verify RELAY_URL and your internet connection.` });
    }
});

app.post('/api/features/confirm-unlock-bulk', rateLimit('feature-unlock-bulk-confirm', 120, 10 * 60 * 1000), async (req, res) => {
    const { featureIds, otp, username } = req.body;

    if (!Array.isArray(featureIds) || featureIds.length === 0) {
        return res.status(400).json({ success: false, message:'featureIds must be a non-empty array.' });
    }
    if (!otp || !String(otp).trim()) {
        return res.status(400).json({ success: false, message:'The OTP code is required.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message:'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    try {
        const relayRes = await relayFetch(`${RELAY_URL}/relay/confirm-unlock-bulk`, {
            method:'POST',
            headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId, featureIds, otp: String(otp).trim() })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayData.pending) {
            return res.status(202).json({ success: false, pending: true, message: relayData.message || 'Code correct — waiting for owner approval.' });
        }

        if (!relayData.success) {
            return res.status(400).json({ success: false, message: relayData.message ||'Failed to verify the code.' });
        }

        const tokens = relayData.tokens || {};
        for (const featureId of featureIds) {
            const token = tokens[featureId];
            if (!token || !verifyUnlockToken(token, installationId, featureId)) {
                console.error(`⚠️ Invalid/missing token from relay for ${featureId} (bulk confirm).`);
                return res.status(500).json({ success: false, message: `Invalid token received for ${featureId}. Please contact the developer.` });
            }
        }
        featureIds.forEach(featureId => { data.tokens[featureId] = tokens[featureId]; });
        writeData(FILE_FEATURE_UNLOCKS, data);
        logAction(username ||'Unknown', `Unlocked ${featureIds.length} feature(s) via bundle`);

        res.json({ success: true, message:'Bundle unlocked!', unlockedFeatureIds: getUnlockedFeatureIds() });
    } catch (err) {
        console.error('Could not reach the Unlock Relay (bulk confirm):', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}. Please verify RELAY_URL and your internet connection.` });
    }
});

app.get('/api/themes/status', (req, res) => {
    const unlockedFeatureIds = getUnlockedFeatureIds();
    const unlockedThemeIds = unlockedFeatureIds.filter(id => FEATURE_CATALOG[id] && FEATURE_CATALOG[id].category ==='theme');
    res.json({ success: true, unlockedThemeIds });
});

app.post('/api/themes/request-unlock', requirePermission('relay_unlock_request'), rateLimit('theme-unlock-request', 3, 10 * 60 * 1000), async (req, res) => {
    const { themeId, username, photo } = req.body;
    const theme = FEATURE_CATALOG[themeId];

    if (!theme || theme.category !=='theme') {
        return res.status(400).json({ success: false, message:'Unknown Pro theme.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message:'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    if (data.tokens[themeId] && verifyUnlockToken(data.tokens[themeId], installationId, themeId)) {
        return res.json({ success: true, alreadyUnlocked: true, message: `Naka-unlock na ang ${theme.name}.` });
    }

    try {
        const receiptSettings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
        const relayRes = await relayFetch(`${RELAY_URL}/relay/request-unlock`, {
            method:'POST',
            headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({
                installationId,
                featureId: themeId,
                featureName: theme.name,
                price: theme.price,
                username: username ||'Unknown',
                storeName: (receiptSettings && receiptSettings.storeName) || null,
                photo: photo || null
            })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (!relayData.success) {
            return relayRejectionResponse(res, relayData, 'The unlock relay declined the request.');
        }

        logAction(username ||'Unknown', `Humiling ng OTP para i-unlock ang ${theme.name}`);
        res.json({ success: true, message:'The unlock request has been sent. Please wait for the confirmation code from the developer/owner.' });
    } catch (err) {
        console.error('Hindi ma-abot ang Unlock Relay:', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}. Please verify RELAY_URL and your internet connection.` });
    }
});

app.post('/api/themes/confirm-unlock', rateLimit('theme-unlock-confirm', 120, 10 * 60 * 1000), async (req, res) => {
    const { themeId, otp, username } = req.body;
    const theme = FEATURE_CATALOG[themeId];
    if (!theme || theme.category !=='theme') {
        return res.status(400).json({ success: false, message:'Unknown Pro theme.' });
    }
    if (!otp || !String(otp).trim()) {
        return res.status(400).json({ success: false, message:'The OTP code is required.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(500).json({ success: false, message:'RELAY_API_KEY is not configured on this server. Please contact the developer.' });
    }

    const data = readFeatureUnlocks();
    const installationId = getOrCreateInstallationId(data);

    try {
        const relayRes = await relayFetch(`${RELAY_URL}/relay/confirm-unlock`, {
            method:'POST',
            headers: {'Content-Type':'application/json','x-relay-key': RELAY_API_KEY },
            body: JSON.stringify({ installationId, featureId: themeId, otp: String(otp).trim() })
        });
        const relayData = await parseRelayResponse(relayRes);

        if (relayData.pending) {
            return res.status(202).json({ success: false, pending: true, message: relayData.message || 'Tama ang code — naghihintay ng approval ng may-ari.' });
        }

        if (!relayData.success) {
            return res.status(400).json({ success: false, message: relayData.message ||'Failed to verify the code.' });
        }
        if (!verifyUnlockToken(relayData.token, installationId, themeId)) {
            console.error('⚠️ Natanggap ang isang token mula sa relay pero HINDI valid ang signature nito.');
            return res.status(500).json({ success: false, message:'Hindi valid ang signature ng token na natanggap. Kontakin ang developer.' });
        }

        data.tokens[themeId] = relayData.token;
        writeData(FILE_FEATURE_UNLOCKS, data);
        logAction(username ||'Unknown', `Na-unlock ang Pro theme: ${theme.name}`);

        const unlockedThemeIds = getUnlockedFeatureIds().filter(id => FEATURE_CATALOG[id] && FEATURE_CATALOG[id].category ==='theme');
        res.json({ success: true, message: `${theme.name} has been unlocked!`, unlockedThemeIds });
    } catch (err) {
        console.error('Hindi ma-abot ang Unlock Relay:', err);
        res.status(502).json({ success: false, message: `Could not reach the unlock relay: ${err.message}. Please verify RELAY_URL and your internet connection.` });
    }
});

function getPHTime() {
    return new Date().toLocaleString("sv-SE", { timeZone:"Asia/Manila" });
}

const defaultUsers = [
    { username:'admin', password:'admin', role:'Admin', created:'2026-07-07 04:32:09' },
    { username:'cashier1', password:'cashier123', role:'Cashier', created:'2026-07-07 18:30:20' },
    { username:'staff', password:'staff123', role:'Staff', created:'2026-07-07 16:34:41' }
];

function daysFromNow(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

const defaultProducts = [
    { code:'PRDT20250001', name:'Bottled Water 500ml', category:'Beverages', price: 25.00, stock: 8, cost: 15.00, supplier:'Absolute Distribution', expiryDate: daysFromNow(180), lowStockThreshold: 5 },
    { code:'PRDT20250002', name:'Coca-Cola 1L', category:'Beverages', price: 55.00, stock: 9, cost: 42.00, supplier:'Coca-Cola Beverages Philippines, Inc.', expiryDate: daysFromNow(150), lowStockThreshold: 5 },
    { code:'PRDT20250003', name:'Fresh Milk 1L', category:'Dairy', price: 85.00, stock: 10, cost: 65.00, supplier:'Local Dairy Supplier', expiryDate: daysFromNow(5), lowStockThreshold: 4 },
    { code:'PRDT20250004', name:'Nova Multigrain', category:'Snacks', price: 30.00, stock: 10, cost: 22.00, supplier:'Universal Robina Corporation', expiryDate: daysFromNow(90), lowStockThreshold: 5 },
    { code:'PRDT20250005', name:'Piattos Cheese', category:'Snacks', price: 35.00, stock: 10, cost: 26.00, supplier:'Universal Robina Corporation', expiryDate: daysFromNow(90), lowStockThreshold: 5 }
];

if (readData(FILE_USERS).length === 0) {
    const secureDefaultUsers = defaultUsers.map(u => ({
        ...u,
        password: bcrypt.hashSync(u.password, 10)
    }));
    writeData(FILE_USERS, secureDefaultUsers);
}
if (readData(FILE_PRODUCTS).length === 0) writeData(FILE_PRODUCTS, defaultProducts);

function verifyAdmin(req, res, next) {

    const { username, adminPassword } = req.body;

    if (!username) {
        return res.status(400).json({ success: false, message:'May kulang na impormasyon (Username required).' });
    }

    const users = readData(FILE_USERS);
    const activeUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!activeUser || activeUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({
            success: false,
            message:'Akses Denied: Ang account na ito ay walang sapat na pribilehiyo bilang Admin!'
        });
    }

    if (!adminPassword) {
        return res.status(400).json({ success: false, message:'Kailangan ng Admin password para sa aksyong ito.' });
    }

    let isPasswordCorrect = false;
    try {
        isPasswordCorrect = bcrypt.compareSync(adminPassword, activeUser.password);
    } catch (e) {
        isPasswordCorrect = (adminPassword === activeUser.password);
    }

    if (!isPasswordCorrect) {

        return res.status(403).json({ success: false, code:'WRONG_ADMIN_PASSWORD', message:'Maling Admin Password. Hindi pinahintulutan ang aksyong ito.' });
    }

    next();
}

app.get('/api/roles', (req, res) => {
    res.json({ success: true, roles: getRoles(), menuRegistry: MENU_REGISTRY });
});

app.post('/api/roles', requireFeature('rbac_management'), verifyAdmin, (req, res) => {
    const { roleName, permissions } = req.body;
    if (!roleName || typeof roleName !=='string' || !roleName.trim()) {
        return res.status(400).json({ success: false, message:'Kailangan ng pangalan ng role.' });
    }
    const name = roleName.trim();
    if (name.toLowerCase() ==='admin') {
        return res.status(403).json({ success: false, message:'Nakareserba ang pangalang "Admin" bilang huling super-admin ng system.' });
    }
    if (!permissions || typeof permissions !=='object') {
        return res.status(400).json({ success: false, message:'Kulang ang permissions data.' });
    }

    let roles = getRoles();

    const normalizedPerms = {};
    MENU_REGISTRY.forEach(m => { normalizedPerms[m.key] = !!permissions[m.key]; });

    const existingIdx = roles.findIndex(r => r.name.toLowerCase() === name.toLowerCase());
    if (existingIdx !== -1) {
        if (roles[existingIdx].protected) {
            return res.status(403).json({ success: false, message: `Hindi maaaring baguhin ang "${roles[existingIdx].name}" role.` });
        }
        roles[existingIdx].permissions = normalizedPerms;
    } else {
        roles.push({ name, protected: false, permissions: normalizedPerms });
    }
    writeData(FILE_ROLES, roles);
    logAction(req.authUser.username, `Na-update ang permissions ng role: ${name}`);
    res.json({ success: true, roles });
});

app.post('/api/roles/reorder', requireFeature('rbac_management'), verifyAdmin, (req, res) => {
    const { orderedRoleNames } = req.body;
    if (!Array.isArray(orderedRoleNames) || !orderedRoleNames.length) {
        return res.status(400).json({ success: false, message:'Kailangan ng listahan ng roles sa bagong pagkakasunod-sunod.' });
    }

    let roles = getRoles();

    const currentNamesLower = roles.map(r => r.name.toLowerCase()).sort();
    const requestedNamesLower = orderedRoleNames.map(n => (n ||'').toLowerCase()).sort();
    const sameSet = currentNamesLower.length === requestedNamesLower.length &&
        currentNamesLower.every((n, i) => n === requestedNamesLower[i]);

    if (!sameSet) {
        return res.status(400).json({ success: false, message:'Hindi tugma ang listahan ng roles — baka may role na nadagdag/nabura habang nagre-reorder.' });
    }

    const roleByLowerName = new Map(roles.map(r => [r.name.toLowerCase(), r]));
    const reordered = orderedRoleNames.map(n => roleByLowerName.get(n.toLowerCase()));

    writeData(FILE_ROLES, reordered);
    logAction(req.body.username ||'Unknown', `Binago ang pagkakasunod-sunod ng Role columns sa Permission Matrix: ${orderedRoleNames.join(' → ')}`);
    res.json({ success: true, roles: reordered });
});

app.post('/api/roles/delete', requireFeature('rbac_management'), verifyAdmin, (req, res) => {
    const { roleName } = req.body;
    let roles = getRoles();
    const role = roles.find(r => r.name.toLowerCase() === (roleName ||'').toLowerCase());
    if (!role) return res.status(404).json({ success: false, message:'Role not found.' });
    if (role.protected) return res.status(403).json({ success: false, message:'Hindi maaaring burahin ang Admin role.' });

    const users = readData(FILE_USERS);
    const inUse = users.some(u => u.role.toLowerCase() === role.name.toLowerCase());
    if (inUse) {
        return res.status(409).json({ success: false, message: `May mga user pa na naka-assign sa role na "${role.name}". I-reassign muna sila bago ito burahin.` });
    }

    roles = roles.filter(r => r.name.toLowerCase() !== role.name.toLowerCase());
    writeData(FILE_ROLES, roles);
    logAction(req.authUser.username, `Binura ang role: ${role.name}`);
    res.json({ success: true, roles });
});

const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const LOGIN_OTP_TTL_MS = 10 * 60 * 1000;
const LOGIN_OTP_CHALLENGES = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of LOGIN_OTP_CHALLENGES.entries()) if (now > v.expiresAt) LOGIN_OTP_CHALLENGES.delete(k);
}, 60 * 1000).unref();

function generateLoginToken() {
    return 'LOGIN-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message:'Please enter your username and password.'
        });
    }

    if (!checkLoginRateLimit(req, res, 5, 30, LOGIN_RATE_LIMIT_WINDOW_MS)) {
        return;
    }

    const deviceCheck = await checkDeviceBeforeLogin({ username });
    if (!deviceCheck.allowed) {
        return res.status(403).json({
            success: false,
            deviceBlocked: true,
            message: deviceCheck.message
        });
    }

    recordLoginAttempt(req, LOGIN_RATE_LIMIT_WINDOW_MS);

    let users = readData(FILE_USERS);

    let userIndex = users.findIndex(u => u.username.trim().toLowerCase() === username.trim().toLowerCase());

    if (userIndex !== -1) {
        const user = users[userIndex];
        let isMatch = false;
        let needsUpgrade = false;

        try {

            isMatch = bcrypt.compareSync(password, user.password);
        } catch (error) {

            isMatch = (password === user.password);
            if (isMatch) needsUpgrade = true;
        }

        if (isMatch) {

            if (needsUpgrade) {
                user.password = bcrypt.hashSync(password, 10);
                writeData(FILE_USERS, users);
            }

            const advSettingsForLogin = getAdvancedSettingsPublic(readData(FILE_ADVANCED_SETTINGS, DEFAULT_ADVANCED_SETTINGS));
            const isAdminRole = (user.role || '').toLowerCase() === 'admin';

            if (advSettingsForLogin.twoFactorLoginEnabled && isAdminRole) {
                const otpMailCreds = getOtpMailCredentials();
                if (!otpMailCreds) {

                    console.warn('⚠️ Naka-enable ang 2FA Admin Login pero walang naka-configure na OTP sender email — nag-proceed nang walang OTP.');
                } else {
                    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
                    const loginToken = generateLoginToken();
                    LOGIN_OTP_CHALLENGES.set(loginToken, {
                        username: user.username,
                        role: user.role,
                        code: otpCode,
                        expiresAt: Date.now() + LOGIN_OTP_TTL_MS,
                        userAgent: req.headers['user-agent'],
                        ip: getClientIp(req)
                    });

                    try {
                        await sendMailSmart(otpMailCreds.user, otpMailCreds.pass, {
                            from: `"OmniPOS Security" <${otpMailCreds.user}>`,
                            to: advSettingsForLogin.twoFactorRecipientEmail,
                            subject: `🔐 OmniPOS: Admin Login OTP (${user.username})`,
                            text: `May sumusubok mag-login sa OmniPOS Admin account "${user.username}".\n\n` +
                                  `OTP Code: ${otpCode}\n` +
                                  `Mag-e-expire ito sa loob ng 10 minuto.\n\n` +
                                  `Kung hindi ninyo ito hiniling, huwag ibigay ang code na ito at i-check ang inyong password.`
                        });
                    } catch (mailErr) {
                        console.error('2FA login OTP send failure:', mailErr.message);
                        return res.status(500).json({ success: false, message: `Nabigo ang pagpapadala ng 2FA OTP: ${mailErr.message}` });
                    }

                    return res.json({
                        success: true,
                        requiresOtp: true,
                        loginToken,
                        message: `Naipadala ang 6-digit na OTP sa naka-configure na email. Ilagay ito para makumpleto ang login.`
                    });
                }
            }

            logAction(user.username, `Logged into the system`);

            const token = createSession(user.username, user.role, req.headers['user-agent'], getClientIp(req));

            const permissions = getPermissionsForRole(user.role);
            return res.json({ success: true, user: { username: user.username, displayName: user.displayName || null, role: user.role, avatar: user.avatar || null }, token, permissions, menuRegistry: MENU_REGISTRY });
        }
    }

    res.status(401).json({ success: false, message:'Incorrect username or password.' });
});

app.post('/api/auth/login/verify-otp', rateLimit('login-verify-otp', 8, 10 * 60 * 1000), (req, res) => {
    const { loginToken, otp } = req.body;

    if (!loginToken || !otp) {
        return res.status(400).json({ success: false, message: 'Kailangan ang loginToken at OTP code.' });
    }

    const pending = LOGIN_OTP_CHALLENGES.get(loginToken);
    if (!pending) {
        return res.status(400).json({ success: false, code: 'OTP_EXPIRED', message: 'Expired na o walang aktibong login OTP request. Mag-login ulit para makahingi ng bagong OTP.' });
    }
    if (Date.now() > pending.expiresAt) {
        LOGIN_OTP_CHALLENGES.delete(loginToken);
        return res.status(400).json({ success: false, code: 'OTP_EXPIRED', message: 'Expired na ang OTP code. Mag-login ulit para makahingi ng bago.' });
    }
    if (String(otp).trim() !== pending.code) {
        return res.status(403).json({ success: false, code: 'WRONG_OTP', message: 'Maling OTP code.' });
    }

    LOGIN_OTP_CHALLENGES.delete(loginToken);

    const users = readData(FILE_USERS);
    const user = users.find(u => u.username.toLowerCase() === pending.username.toLowerCase());
    if (!user) {
        return res.status(404).json({ success: false, message: 'Hindi na umiiral ang account na ito.' });
    }

    logAction(user.username, `Logged into the system (2FA-verified)`);

    const token = createSession(user.username, user.role, pending.userAgent, pending.ip);
    const permissions = getPermissionsForRole(user.role);

    res.json({ success: true, user: { username: user.username, displayName: user.displayName || null, role: user.role, avatar: user.avatar || null }, token, permissions, menuRegistry: MENU_REGISTRY });
});

const WEBAUTHN_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const WEBAUTHN_REGISTER_CHALLENGES = new Map();
const WEBAUTHN_LOGIN_CHALLENGES = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of WEBAUTHN_REGISTER_CHALLENGES.entries()) if (now > v.expiresAt) WEBAUTHN_REGISTER_CHALLENGES.delete(k);
    for (const [k, v] of WEBAUTHN_LOGIN_CHALLENGES.entries()) if (now > v.expiresAt) WEBAUTHN_LOGIN_CHALLENGES.delete(k);
}, 60 * 1000).unref();

function webauthnRpId(req) {
    return req.hostname;
}
function webauthnExpectedOrigin(req) {
    return `${req.protocol}://${req.get('host')}`;
}

app.post('/api/auth/webauthn/register-options', (req, res) => {
    const username = req.authUser.username;
    const users = readData(FILE_USERS);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ success: false, message:'Hindi mahanap ang account.' });
    const user = users[userIndex];

    const challenge = webauthn.randomChallenge();
    WEBAUTHN_REGISTER_CHALLENGES.set(username.toLowerCase(), { challenge, expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS });

    const existingCredentials = (user.webauthnCredentials || []).map(c => ({ id: c.id, type:'public-key' }));

    if (!user.webauthnUserHandle) {
        user.webauthnUserHandle = crypto.randomBytes(32).toString('base64url');
        writeData(FILE_USERS, users);
    }

    res.json({
        success: true,
        options: {
            challenge,
            rp: { name:'OmniPOS', id: webauthnRpId(req) },
            user: {
                id: user.webauthnUserHandle,
                name: user.username,
                displayName: user.username
            },
            pubKeyCredParams: [
                { alg: -7, type:'public-key' },
                { alg: -257, type:'public-key' }
            ],
            authenticatorSelection: {
                authenticatorAttachment:'platform',

                residentKey:'required',
                userVerification:'required'
            },
            attestation:'none',
            timeout: 60000,
            excludeCredentials: existingCredentials
        }
    });
});

app.post('/api/auth/webauthn/register-verify', (req, res) => {
    try {
        const username = req.authUser.username;
        const { credentialId, clientDataJSON, attestationObject, deviceLabel } = req.body || {};
        if (!credentialId || !clientDataJSON || !attestationObject) {
            return res.status(400).json({ success: false, message:'Missing data from the authenticator.' });
        }

        const stored = WEBAUTHN_REGISTER_CHALLENGES.get(username.toLowerCase());
        if (!stored || Date.now() > stored.expiresAt) {
            return res.status(400).json({ success: false, message:'Nag-expire na ang enrollment request. Subukan muli.' });
        }

        const clientData = JSON.parse(Buffer.from(clientDataJSON,'base64url').toString('utf8'));
        if (clientData.type !== 'webauthn.create') {
            return res.status(400).json({ success: false, message:'Invalid WebAuthn response type.' });
        }
        if (clientData.challenge !== stored.challenge) {
            return res.status(400).json({ success: false, message:'Hindi tugma ang challenge (posibleng expired o replayed na request).' });
        }
        if (clientData.origin !== webauthnExpectedOrigin(req)) {
            return res.status(400).json({ success: false, message:'The WebAuthn response origin does not match.' });
        }

        const attestationBuf = Buffer.from(attestationObject,'base64url');
        const { value: attObj } = webauthn.decodeCbor(attestationBuf, 0);
        const authDataBuf = Buffer.from(attObj.get('authData'));
        const parsed = webauthn.parseAuthenticatorData(authDataBuf);

        const expectedRpIdHash = webauthn.sha256(Buffer.from(webauthnRpId(req),'utf8'));
        if (Buffer.compare(parsed.rpIdHash, expectedRpIdHash) !== 0) {
            return res.status(400).json({ success: false, message:'The credential RP ID (site) does not match.' });
        }
        if (!parsed.flags.userPresent || !parsed.flags.userVerified) {
            return res.status(400).json({ success: false, message:'Hindi kumpirmadong biometric verification (kailangan tunay na fingerprint/Face ID, hindi lang pag-tap).' });
        }
        if (!parsed.credentialPublicKey) {
            return res.status(400).json({ success: false, message:'Walang natanggap na public key mula sa authenticator.' });
        }

        const { keyObject } = webauthn.coseKeyToPublicKeyObject(parsed.credentialPublicKey);
        const publicKeyJwk = keyObject.export({ format:'jwk' });
        const credIdB64 = Buffer.from(parsed.credentialId).toString('base64url');

        const users = readData(FILE_USERS);

        const alreadyUsed = users.some(u => (u.webauthnCredentials || []).some(c => c.id === credIdB64));
        if (alreadyUsed) {
            return res.status(409).json({ success: false, message:'Naka-rehistro na ang fingerprint na ito.' });
        }

        const userIndex = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
        if (userIndex === -1) return res.status(404).json({ success: false, message:'Hindi mahanap ang account.' });

        if (!Array.isArray(users[userIndex].webauthnCredentials)) users[userIndex].webauthnCredentials = [];
        users[userIndex].webauthnCredentials.push({
            id: credIdB64,
            publicKeyJwk,
            counter: parsed.counter,
            deviceLabel: (deviceLabel || parseDeviceInfo(req.headers['user-agent']).label || 'Mobile device').slice(0, 80),
            createdAt: new Date().toLocaleString('en-US', { timeZone:'Asia/Manila' })
        });
        writeData(FILE_USERS, users);
        WEBAUTHN_REGISTER_CHALLENGES.delete(username.toLowerCase());

        logAction(username,`Nag-enable ng Fingerprint/Biometric Login (${users[userIndex].webauthnCredentials.at(-1).deviceLabel})`);
        res.json({ success: true, message:'Na-enable ang Fingerprint Login sa device na ito.' });
    } catch (err) {
        console.error('webauthn register-verify error:', err);
        res.status(400).json({ success: false, message:'Hindi ma-verify ang fingerprint enrollment. Subukan muli.' });
    }
});

app.get('/api/auth/webauthn/credentials', (req, res) => {
    const users = readData(FILE_USERS);
    const user = users.find(u => u.username.toLowerCase() === req.authUser.username.toLowerCase());
    const creds = ((user && user.webauthnCredentials) || []).map(c => ({ id: c.id, deviceLabel: c.deviceLabel, createdAt: c.createdAt }));
    res.json({ success: true, credentials: creds });
});

app.delete('/api/auth/webauthn/credentials/:id', (req, res) => {
    const users = readData(FILE_USERS);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === req.authUser.username.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ success: false, message:'Hindi mahanap ang account.' });

    const before = (users[userIndex].webauthnCredentials || []).length;
    users[userIndex].webauthnCredentials = (users[userIndex].webauthnCredentials || []).filter(c => c.id !== req.params.id);
    if (users[userIndex].webauthnCredentials.length === before) {
        return res.status(404).json({ success: false, message:'Hindi mahanap ang fingerprint credential na iyon.' });
    }
    writeData(FILE_USERS, users);
    logAction(req.authUser.username,'Inalis ang isang Fingerprint/Biometric Login credential');
    res.json({ success: true, message:'Naalis na ang fingerprint credential.' });
});

app.post('/api/auth/webauthn/login-options', rateLimit('webauthn-login-options', 20, 10 * 60 * 1000), (req, res) => {
    const username = ((req.body && req.body.username) || '').toString().trim();
    const challenge = webauthn.randomChallenge();

    if (!username) {

        WEBAUTHN_LOGIN_CHALLENGES.set(challenge, { username: null, expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS });
        return res.json({
            success: true,
            challenge,
            rpId: webauthnRpId(req),
            userVerification:'required',
            timeout: 60000,
            allowCredentials: []
        });
    }

    const users = readData(FILE_USERS);
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    const credentials = (user && user.webauthnCredentials) || [];
    if (!user || credentials.length === 0) {
        return res.status(404).json({ success: false, message:'Fingerprint Login is not enabled for this account/device.' });
    }

    WEBAUTHN_LOGIN_CHALLENGES.set(challenge, { username: user.username, expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS });

    res.json({
        success: true,
        challenge,
        rpId: webauthnRpId(req),
        userVerification:'required',
        timeout: 60000,
        allowCredentials: credentials.map(c => ({ id: c.id, type:'public-key' }))
    });
});

app.post('/api/auth/webauthn/login-verify', async (req, res) => {
    const { credentialId, clientDataJSON, authenticatorData, signature, userHandle } = req.body || {};
    if (!credentialId || !clientDataJSON || !authenticatorData || !signature) {
        return res.status(400).json({ success: false, message:'Missing data from the authenticator.' });
    }

    let clientData;
    try {
        clientData = JSON.parse(Buffer.from(clientDataJSON,'base64url').toString('utf8'));
    } catch {
        return res.status(400).json({ success: false, message:'Corrupted WebAuthn response.' });
    }

    const stored = WEBAUTHN_LOGIN_CHALLENGES.get(clientData.challenge);
    if (!stored || Date.now() > stored.expiresAt) {
        return res.status(400).json({ success: false, message:'The login request has expired. Please try again.' });
    }

    const users = readData(FILE_USERS);
    let userIndex = -1;
    let credIndex = -1;

    if (stored.username) {
        userIndex = users.findIndex(u => u.username.toLowerCase() === stored.username.toLowerCase());
        if (userIndex !== -1) {
            credIndex = (users[userIndex].webauthnCredentials || []).findIndex(c => c.id === credentialId);
        }
    } else {
        for (let i = 0; i < users.length; i++) {
            const idx = (users[i].webauthnCredentials || []).findIndex(c => c.id === credentialId);
            if (idx !== -1) { userIndex = i; credIndex = idx; break; }
        }
    }

    if (userIndex === -1 || credIndex === -1) {
        return res.status(401).json({ success: false, message:'This fingerprint is no longer registered. Please re-enroll it in Profile settings.' });
    }

    const username = users[userIndex].username;

    if (userHandle) {
        const expectedHandle = users[userIndex].webauthnUserHandle;
        if (expectedHandle && userHandle !== expectedHandle) {
            return res.status(401).json({ success: false, message:'This fingerprint does not match the account.' });
        }
    }

    req.body.username = username;
    if (!checkLoginRateLimit(req, res, 5, 30, LOGIN_RATE_LIMIT_WINDOW_MS)) return;

    const deviceCheck = await checkDeviceBeforeLogin({ username });
    if (!deviceCheck.allowed) {
        return res.status(403).json({ success: false, deviceBlocked: true, message: deviceCheck.message });
    }
    recordLoginAttempt(req, LOGIN_RATE_LIMIT_WINDOW_MS);

    try {
        if (clientData.type !== 'webauthn.get') {
            return res.status(400).json({ success: false, message:'Invalid WebAuthn response type.' });
        }
        if (clientData.origin !== webauthnExpectedOrigin(req)) {
            return res.status(400).json({ success: false, message:'The WebAuthn response origin does not match.' });
        }

        const cred = users[userIndex].webauthnCredentials[credIndex];
        const authDataBuf = Buffer.from(authenticatorData,'base64url');
        const parsed = webauthn.parseAuthenticatorData(authDataBuf);

        const expectedRpIdHash = webauthn.sha256(Buffer.from(webauthnRpId(req),'utf8'));
        if (Buffer.compare(parsed.rpIdHash, expectedRpIdHash) !== 0) {
            return res.status(401).json({ success: false, message:'The credential RP ID (site) does not match.' });
        }
        if (!parsed.flags.userPresent || !parsed.flags.userVerified) {
            return res.status(401).json({ success: false, message:'Biometric verification was not confirmed.' });
        }

        const clientDataHash = webauthn.sha256(Buffer.from(clientDataJSON,'base64url'));
        const signedData = Buffer.concat([authDataBuf, clientDataHash]);
        const keyObject = crypto.createPublicKey({ key: cred.publicKeyJwk, format:'jwk' });
        const sigOk = webauthn.verifySignature(keyObject, signedData, Buffer.from(signature,'base64url'));
        if (!sigOk) {
            return res.status(401).json({ success: false, message:'Unable to verify the fingerprint signature.' });
        }

        if (!(parsed.counter === 0 && cred.counter === 0) && parsed.counter <= cred.counter) {
            return res.status(401).json({ success: false, message:'Suspicious repeated fingerprint signature (possible cloned authenticator). Please log in with your password.' });
        }
        cred.counter = parsed.counter;
        writeData(FILE_USERS, users);
        WEBAUTHN_LOGIN_CHALLENGES.delete(clientData.challenge);

        const user = users[userIndex];
        logAction(user.username,`Naka-login gamit ang Fingerprint/Biometric Login (${cred.deviceLabel || 'device'})`);

        const token = createSession(user.username, user.role, req.headers['user-agent'], getClientIp(req));
        const permissions = getPermissionsForRole(user.role);
        return res.json({ success: true, user: { username: user.username, displayName: user.displayName || null, role: user.role, avatar: user.avatar || null }, token, permissions, menuRegistry: MENU_REGISTRY });
    } catch (err) {
        console.error('webauthn login-verify error:', err);
        return res.status(400).json({ success: false, message:'Unable to verify Fingerprint Login. Please try again or use your password.' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    if (req.authToken) {
        destroySession(req.authToken);
    }
    res.json({ success: true, message:'Logged out.' });
});

app.get('/api/auth/active-sessions', (req, res) => {
    const now = Date.now();

    const allUsers = readData(FILE_USERS);

    const requesterRole = req.authUser && req.authUser.role;
    const canSeeSensitiveDetails = (requesterRole ||'').toLowerCase() ==='admin' || !!getPermissionsForRole(requesterRole).users;

    const latestSessionByUsername = new Map();
    Array.from(SESSIONS.values())
        .filter(s => now <= s.expiresAt)
        .forEach(s => {
            const existing = latestSessionByUsername.get(s.username);
            if (!existing || (s.loginAt || 0) > (existing.loginAt || 0)) {
                latestSessionByUsername.set(s.username, s);
            }
        });

    const sessions = Array.from(latestSessionByUsername.values())
        .map(s => {
            const userRecord = allUsers.find(u => u.username === s.username);
            return {
                username: s.username,
                displayName: (userRecord && userRecord.displayName) || null,
                role: s.role,
                avatar: (userRecord && userRecord.avatar) || null,
                loginAt: s.loginAt || null,
                minutesActive: s.loginAt ? Math.max(0, Math.floor((now - s.loginAt) / 60000)) : null,
                isCurrentSession: req.authToken ? SESSIONS.get(req.authToken) === s : false,

                device: canSeeSensitiveDetails ? (s.device || parseDeviceInfo('')) : null,
                ip: canSeeSensitiveDetails ? (s.ip ||'unknown') : null,
                sameWifi: canSeeSensitiveDetails ? isSameLanAsServer(s.ip) : false
            };
        })
        .sort((a, b) => (a.loginAt || 0) - (b.loginAt || 0));

    res.json({ success: true, activeUsers: sessions, count: sessions.length });
});

app.post('/api/products/checkout', requirePermission('terminal'), (req, res) => {
    try {
        logAction(req.authUser && req.authUser.username, `Blocked call to removed endpoint /api/products/checkout (security fix — direct stock manipulation na walang transaction record). Payload: ${JSON.stringify(req.body || {}).slice(0, 300)}`);
    } catch (e) {
        console.error('Failed to log blocked /api/products/checkout attempt:', e);
    }
    res.status(410).json({
        success: false,
        code:'ENDPOINT_REMOVED',
        message:'Tinanggal na ang endpoint na ito dahil sa security review — pwede itong dating gamitin para baguhin ang stock nang walang naitatalang benta at walang audit trail. Gamitin ang /api/transactions para sa checkout/sale.'
    });
});

app.get('/api/products', (req, res) => {

    res.set('X-Active-Terminals', String(SESSIONS.size));
    res.json(readData(FILE_PRODUCTS));
});

app.get('/api/products/export', requireFeature('advanced_reports'), (req, res) => {
    try {
        const products = readData(FILE_PRODUCTS);
        const escapeCsv = (val) => {
            const s = (val === undefined || val === null) ?'' : val.toString();
            return/[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
        };
        const headers = ['Code','Product Name','Category','Price','Stock','Supplier','Expiry Date','Low Stock Threshold','Cost Price'];
        const lines = [headers.join(',')];
        products.forEach(p => {
            lines.push([
                escapeCsv(p.code), escapeCsv(p.name), escapeCsv(p.category),
                escapeCsv(p.price), escapeCsv(p.stock), escapeCsv(p.supplier),
                escapeCsv(p.expiryDate), escapeCsv(p.lowStockThreshold), escapeCsv(p.cost)
            ].join(','));
        });
        const csvContent ='\uFEFF' + lines.join('\r\n');

        res.setHeader('Content-Type','text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="inventory_export_${Date.now()}.csv"`);
        res.send(csvContent);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ success: false, message:'Hindi ma-export ang inventory.' });
    }
});

app.get('/api/products/template', async (req, res) => {
    try {
        const categories = readData(FILE_CATEGORIES, DEFAULT_CATEGORIES);
        const workbook = new ExcelJS.Workbook();
        workbook.creator ='OmniPOS System';

        const catSheet = workbook.addWorksheet('CategoriesList');
        categories.forEach((cat, i) => {
            catSheet.getCell(`A${i + 1}`).value = cat;
        });
        catSheet.state ='veryHidden';

        const sheet = workbook.addWorksheet('New Products');
        sheet.columns = [
            { header:'Code', key:'code', width: 22 },
            { header:'Product Name', key:'name', width: 32 },
            { header:'Category', key:'category', width: 24 },
            { header:'Price', key:'price', width: 14 },
            { header:'Stock', key:'stock', width: 12 },
            { header:'Supplier', key:'supplier', width: 24 },
            { header:'Expiry Date', key:'expiry', width: 16 },
            { header:'Low Stock Threshold', key:'threshold', width: 18 },
            { header:'Cost Price', key:'cost', width: 14 }
        ];
        const headerRow = sheet.getRow(1);
        headerRow.eachCell(cell => {
            cell.font = { bold: true, color: { argb:'FFFFFFFF' } };
            cell.fill = { type:'pattern', pattern:'solid', fgColor: { argb:'FF2563EB' } };
            cell.alignment = { vertical:'middle', horizontal:'center' };
        });

        const catRange = `CategoriesList!$A$1:$A$${Math.max(categories.length, 1)}`;
        for (let row = 2; row <= 501; row++) {
            sheet.getCell(`C${row}`).dataValidation = {
                type:'list',
                allowBlank: true,
                formulae: [catRange],
                showErrorMessage: false,
                promptTitle:'Category',
                prompt:'Pumili sa dropdown, o mag-type ng bagong pangalan ng category para awtomatikong madagdag ito sa system.'
            };
            sheet.getCell(`D${row}`).numFmt ='#,##0.00';
            sheet.getCell(`E${row}`).numFmt ='#,##0';
        }

        const infoSheet = workbook.addWorksheet('Paano Gamitin');
        infoSheet.getColumn(1).width = 95;
        const instructions = [
'PAANO GAMITIN ANG TEMPLATE NA ITO:',
'',
'1. Pumunta sa sheet na "New Products".',
'2. Punan ang bawat hilera: Code, Product Name, Category, Price, Stock.',
'3. Sa column na "Category" (column C), pindutin ang dropdown arrow para pumili ng existing category.',
'4. Kung gusto mag-add ng BAGONG category, i-type lang ito diretso sa cell — awtomatiko itong madadagdag sa system pagka-import.',
'5. Huwag baguhin ang mga pangalan sa Row 1 (headers) at huwag magdagdag ng bagong column.',
'6. Isave ang file (.xlsx), pagkatapos i-upload gamit ang "Import Excel/CSV" button sa Product Inventory page.',
'7. Ang mga Product Code na dati nang ginagamit ay ise-skip habang nag-i-import — MALIBAN kung pinili mong "Update Existing" bago mag-upload.',
'8. Optional na columns: Supplier, Expiry Date (YYYY-MM-DD), Low Stock Threshold, at Cost Price — pwedeng iwanang blangko.',
'9. Sa "Update Existing" mode, ang mga blangkong cell ay HINDI nagbabago sa laman ng existing product — mananatili ang dati nitong value.'
        ];
        instructions.forEach((line, i) => { infoSheet.getCell(`A${i + 1}`).value = line; });
        infoSheet.getCell('A1').font = { bold: true, size: 13 };

        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename="product_import_template.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Template generation error:', err);
        res.status(500).json({ success: false, message:'Hindi magawa ang Excel template.' });
    }
});

function parseCsvLine(line) {
    const result = [];
    let cur ='';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch ==='"') {
                if (line[i + 1] ==='"') {
                    cur +='"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
        } else {
            if (ch ==='"') {
                inQuotes = true;
            } else if (ch ===',') {
                result.push(cur);
                cur ='';
            } else {
                cur += ch;
            }
        }
    }
    result.push(cur);
    return result;
}

function parseMoney(raw) {
    const s = (raw ||'').toString().trim();
    if (s ==='') return NaN;
    const cleaned = s.replace(/^(₱|PHP)\s*/i,'').replace(/,/g,'');
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return NaN;
    return parseFloat(cleaned);
}

function parseWholeNumber(raw) {
    const s = (raw ||'').toString().trim().replace(/,/g,'');
    if (!/^\d+$/.test(s)) return NaN;
    return parseInt(s, 10);
}

app.post('/api/products/import', rateLimit('product-import', 20, 10 * 60 * 1000), productImportUpload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message:'Walang na-attach na file.' });
    }

    const cleanupTmpFile = () => fs.unlink(req.file.path, () => {});

    const { username } = req.body;
    const users = readData(FILE_USERS);
    const activeUser = users.find(u => u.username.toLowerCase() === (username ||'').toLowerCase());
    if (!activeUser || activeUser.role.toLowerCase() !=='admin') {
        cleanupTmpFile();
        return res.status(403).json({ success: false, message:'Admin lang ang pwedeng mag-import ng products.' });
    }

    try {
        const ext = path.extname(req.file.originalname).toLowerCase();
        let rows = [];

        if (ext ==='.csv') {
            let content = fs.readFileSync(req.file.path,'utf8');
            content = content.replace(/^\uFEFF/,'');
            const lines = content.split(/\r?\n/).filter(l => l.trim() !=='');
            if (lines.length > 1) {
                const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
                for (let i = 1; i < lines.length; i++) {
                    const cols = parseCsvLine(lines[i]);
                    const obj = {};
                    headers.forEach((h, idx) => { obj[h] = (cols[idx] ||'').trim(); });
                    rows.push(obj);
                }
            }
        } else {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(req.file.path);
            const sheet = workbook.getWorksheet('New Products') || workbook.worksheets[0];
            const headerValues = (sheet.getRow(1).values || []).map(v => (v ||'').toString().trim().toLowerCase());

            sheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const rowValues = row.values;
                const obj = {};
                headerValues.forEach((h, idx) => {
                    if (!h) return;
                    const cellVal = rowValues[idx];
                    obj[h] = (cellVal !== undefined && cellVal !== null) ? cellVal.toString().trim() :'';
                });
                if (Object.values(obj).some(v => v !=='')) rows.push(obj);
            });
        }

        const mode = (req.body.mode ||'skip').toLowerCase() ==='update' ?'update' :'skip';

        let products = readData(FILE_PRODUCTS);
        let categories = readData(FILE_CATEGORIES, DEFAULT_CATEGORIES);
        const codeIndex = new Map(products.map((p, i) => [p.code.trim().toLowerCase(), i]));
        const newCategoriesFound = new Set();
        let added = 0, updated = 0, skipped = 0;
        const errors = [];

        rows.forEach((r, idx) => {
            const rowNum = idx + 2;
            const code = (r.code ||'').toString().trim();
            const name = (r['product name'] || r.name ||'').toString().trim();
            const categoryRaw = (r.category ||'').toString().trim();
            const supplier = (r.supplier ||'').toString().trim();
            const expiry = (r['expiry date'] || r.expiry || r.expirydate ||'').toString().trim();
            const thresholdRaw = (r['low stock threshold'] || r.threshold || r.lowstockthreshold ||'').toString().trim();
            const costRaw = (r['cost price'] || r.cost || r.costprice ||'').toString().trim();

            const priceRaw = (r.price ||'').toString().trim();
            const stockRaw = (r.stock ||'').toString().trim();
            const price = parseMoney(priceRaw);
            const stock = parseWholeNumber(stockRaw);
            const existingIdx = codeIndex.get(code.toLowerCase());

            if (!code || !name) {
                errors.push(`Row ${rowNum}: Kulang ang Code o Product Name — na-skip.`);
                skipped++;
                return;
            }

            if (existingIdx !== undefined) {
                if (mode !=='update') {
                    errors.push(`Row ${rowNum}: Ginagamit na ang Code "${code}" — na-skip.`);
                    skipped++;
                    return;
                }

                if (priceRaw !=='' && isNaN(price)) {
                    errors.push(`Row ${rowNum}: Hindi valid ang Price para sa Code "${code}" — hindi na-update ang price.`);
                } else if (priceRaw !=='') {
                    products[existingIdx].price = price;
                }
                if (stockRaw !=='' && isNaN(stock)) {
                    errors.push(`Row ${rowNum}: Hindi valid ang Stock para sa Code "${code}" — hindi na-update ang stock.`);
                } else if (stockRaw !=='') {
                    products[existingIdx].stock = stock;
                }
                if (name) products[existingIdx].name = name;
                if (categoryRaw) products[existingIdx].category = categoryRaw;
                if (supplier) products[existingIdx].supplier = supplier;
                if (expiry) products[existingIdx].expiryDate = expiry;
                if (thresholdRaw !=='') {
                    const th = parseWholeNumber(thresholdRaw);
                    if (!isNaN(th)) products[existingIdx].lowStockThreshold = th;
                }
                if (costRaw !=='') {
                    const costVal = parseMoney(costRaw);
                    if (!isNaN(costVal)) products[existingIdx].cost = costVal;
                }
                if (categoryRaw && !categories.includes(categoryRaw)) {
                    categories.push(categoryRaw);
                    newCategoriesFound.add(categoryRaw);
                }
                updated++;
                return;
            }

            const category = categoryRaw ||'Others';
            if (isNaN(price) || isNaN(stock)) {
                errors.push(`Row ${rowNum}: Hindi valid ang Price o Stock — na-skip.`);
                skipped++;
                return;
            }

            const newProduct = { code, name, category, price, stock };
            if (supplier) newProduct.supplier = supplier;
            if (expiry) newProduct.expiryDate = expiry;
            if (thresholdRaw !=='') {
                const th = parseWholeNumber(thresholdRaw);
                if (!isNaN(th)) newProduct.lowStockThreshold = th;
            }
            if (costRaw !=='') {
                const costVal = parseMoney(costRaw);
                if (!isNaN(costVal)) newProduct.cost = costVal;
            }

            products.push(newProduct);
            codeIndex.set(code.toLowerCase(), products.length - 1);

            if (!categories.includes(category)) {
                categories.push(category);
                newCategoriesFound.add(category);
            }
            added++;
        });

        writeData(FILE_PRODUCTS, products);
        writeData(FILE_CATEGORIES, categories);
        logAction(username, `Bulk-imported products via Excel/CSV: ${added} added, ${updated} updated, ${skipped} skipped.`);
        cleanupTmpFile();

        res.json({
            success: true,
            added,
            updated,
            skipped,
            errors,
            newCategories: [...newCategoriesFound],
            categories,
            products
        });
    } catch (err) {
        console.error('Import error:', err);
        cleanupTmpFile();
        res.status(500).json({ success: false, message:'Hindi mabasa ang file. Siguraduhing wastong .xlsx o .csv format ang ginamit (gamitin ang Download Template button).' });
    }
});

app.post('/api/products', (req, res) => {
    const { product } = req.body;
    const username = req.authUser.username;
    let products = readData(FILE_PRODUCTS);

    const codeExists = products.some(p => p.code.trim().toLowerCase() === product.code.trim().toLowerCase());
    if (codeExists) {
        return res.status(400).json({ success: false, message: `❌ Ang Product Code [${product.code}] ay ginagamit na!` });
    }

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).products_direct_apply;

    if (canApplyDirectly) {
        products.push(product);
        writeData(FILE_PRODUCTS, products);
        logAction(username, `Added new product: ${product.name}`);
        return res.json({ success: true, message:'Product added successfully' });
    } else {
            let requests = readData(FILE_REQUESTS);
    requests.push({
        id:'REQ-' + Date.now(),
        requester: username,
        type:'ADD',
        data: product,
        timestamp: new Date().toLocaleString()
    });
    writeData(FILE_REQUESTS, requests);
    return res.json({ success: true, message:'Request sent to Admin for approval.'
                    });
}

});

app.post('/api/products/deduct', (req, res) => {
    try {
        logAction(req.authUser && req.authUser.username, `Blocked call to removed endpoint /api/products/deduct (security fix — walang permission check dati, direct stock manipulation na walang transaction record). Payload: ${JSON.stringify(req.body || {}).slice(0, 300)}`);
    } catch (e) {
        console.error('Failed to log blocked /api/products/deduct attempt:', e);
    }
    res.status(410).json({
        success: false,
        code:'ENDPOINT_REMOVED',
        message:'Tinanggal na ang endpoint na ito dahil sa security review — pwede itong dating gamitin ng kahit sinong naka-login para baguhin ang stock nang walang permission check at walang audit trail. Gamitin ang /api/transactions para sa checkout/sale.'
    });
});

app.put('/api/products/:code', (req, res) => {
    const { code } = req.params;
    const { updatedData } = req.body;
    const username = req.authUser.username;
    let products = readData(FILE_PRODUCTS);

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).products_direct_apply;

    if (canApplyDirectly) {
        products = products.map(p => p.code.trim().toLowerCase() === code.trim().toLowerCase() ? { ...p, ...updatedData } : p);
        writeData(FILE_PRODUCTS, products);
        logAction(username, `Updated product code: ${code}`);
        return res.json({ success: true, message:'Product updated successfully' });
    } else {
        let requests = readData(FILE_REQUESTS);
        requests.push({ id: Date.now(), type:'UPDATE', targetCode: code, requester: username, data: updatedData, timestamp: new Date().toLocaleString() });
        writeData(FILE_REQUESTS, requests);
        logAction(username, `Submitted an UPDATE request for code: ${code}`);
        return res.json({ success: true, message:'Update request submitted for Admin approval' });
    }
});

app.delete('/api/products/:code', (req, res) => {
    const { code } = req.params;
    const username = req.authUser.username;
    let products = readData(FILE_PRODUCTS);

    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).products_direct_apply;

    if (canApplyDirectly) {
        products = products.filter(p => p.code.trim().toLowerCase() !== code.trim().toLowerCase());
        writeData(FILE_PRODUCTS, products);
        logAction(username, `Deleted product code: ${code}`);
        return res.json({ success: true, message:'Product deleted successfully' });
    } else {
        let requests = readData(FILE_REQUESTS);
        requests.push({ id: Date.now(), type:'DELETE', targetCode: code, requester: username, timestamp: new Date().toLocaleString() });
        writeData(FILE_REQUESTS, requests);
        logAction(username, `Submitted a DELETE request for code: ${code}`);
        return res.json({ success: true, message:'Delete request submitted for Admin approval' });
    }
});

function normalizeMatchKey(str) {
    return (str || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[_\-\s]+/g, ' ')
        .replace(/[^a-z0-9 ]/g, '')
        .trim();
}

app.post('/api/products/bulk-photos', rateLimit('product-bulk-photos', 10, 10 * 60 * 1000), requirePermission('products'), productBulkPhotoUpload.array('images', 300), (req, res) => {
    try {
        const files = req.files || [];
        if (!files.length) {
            return res.status(400).json({ success: false, message: 'No photos were attached.' });
        }

        const username = req.authUser.username;
        const isAdminRole = (req.authUser.role || '').toLowerCase() === 'admin';
        const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).products_direct_apply;

        if (!canApplyDirectly) {
            return res.status(403).json({
                success: false,
                message: 'Access Denied: You need "Direct Apply" permission to use Bulk Upload Photos. Please contact an Admin.'
            });
        }

        let products = readData(FILE_PRODUCTS);

        const codeIndex = new Map();
        const nameIndex = new Map();
        products.forEach((p, i) => {
            if (p && p.code) codeIndex.set(normalizeMatchKey(p.code), i);
            if (p && p.name) {
                const nk = normalizeMatchKey(p.name);
                if (!nameIndex.has(nk)) nameIndex.set(nk, i);
            }
        });

        const applied = [];
        const unmatched = [];
        const failed = [];

        for (const file of files) {
            try {
                const baseName = normalizeMatchKey(file.originalname);
                let idx = codeIndex.has(baseName) ? codeIndex.get(baseName) : undefined;
                let matchedBy = 'code';
                if (idx === undefined && nameIndex.has(baseName)) {
                    idx = nameIndex.get(baseName);
                    matchedBy = 'name';
                }

                if (idx === undefined) {
                    unmatched.push({ filename: file.originalname });
                    continue;
                }

                if (!file.mimetype || !file.mimetype.startsWith('image/')) {
                    failed.push({ filename: file.originalname, message: 'Not a valid image file.' });
                    continue;
                }

                const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
                products[idx].image = dataUrl;
                applied.push({
                    filename: file.originalname,
                    code: products[idx].code,
                    name: products[idx].name,
                    matchedBy
                });
            } catch (fileErr) {
                console.error('Bulk photo file error:', fileErr);
                failed.push({ filename: file.originalname, message: 'Could not process this file.' });
            }
        }

        if (applied.length) {
            writeData(FILE_PRODUCTS, products);
            logAction(username, `Bulk-uploaded product photos: ${applied.length} applied, ${unmatched.length} unmatched, ${failed.length} failed.`);
        }

        res.json({
            success: true,
            appliedCount: applied.length,
            unmatchedCount: unmatched.length,
            failedCount: failed.length,
            applied,
            unmatched,
            failed,
            products
        });
    } catch (err) {
        console.error('Bulk photo upload error:', err);
        res.status(500).json({ success: false, message: 'An error occurred while applying the photos.' });
    }
});

app.post('/api/products/image-search', rateLimit('product-image-search', 20, 10 * 60 * 1000), requirePermission('products'), async (req, res) => {
    if (!isImageSearchConfigured()) {
        return res.status(501).json({
            success: false,
            code: 'IMAGE_SEARCH_NOT_CONFIGURED',
            message: 'Hindi pa naka-set up ang Image Search. Ipa-add sa Admin ang IMAGE_SEARCH_PROVIDER at IMAGE_SEARCH_API_KEY (at IMAGE_SEARCH_CX kung Google Custom Search) sa .env file, tapos i-restart ang server.'
        });
    }
    try {
        const results = await searchProductImages(req.body && req.body.query);
        const nonce = crypto.randomBytes(16).toString('hex');
        const items = new Map();
        results.forEach(r => items.set(r.id, r.imageUrl));
        imageSearchSessions.set(nonce, { username: req.authUser.username, createdAt: Date.now(), items });

        res.json({
            success: true,
            nonce,
            results: results.map(({ imageUrl, ...rest }) => rest)
        });
    } catch (err) {
        console.error('Product image search error:', err);
        res.status(err.statusCode === 400 ? 400 : 502).json({ success: false, message: err.message || 'Nabigo ang image search.' });
    }
});

app.post('/api/products/image-search/select', rateLimit('product-image-search-select', 30, 10 * 60 * 1000), requirePermission('products'), async (req, res) => {
    const { nonce, id } = req.body || {};
    const sess = imageSearchSessions.get(nonce);
    if (!sess || sess.username !== req.authUser.username || (Date.now() - sess.createdAt > IMAGE_SEARCH_SESSION_TTL_MS)) {
        return res.status(400).json({ success: false, message: 'Expired na o invalid ang search session na ito. Mag-search ulit.' });
    }
    const imageUrl = sess.items.get(id);
    if (!imageUrl) {
        return res.status(400).json({ success: false, message: 'Invalid na selection — wala ito sa kanina mong search results.' });
    }
    try {
        const { buffer, mimetype } = await fetchImageBuffer(imageUrl, { maxBytes: 6 * 1024 * 1024 });
        if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimetype)) {
            return res.status(415).json({ success: false, message: 'Hindi suportadong image format ang galing sa source na ito.' });
        }
        res.json({ success: true, dataUrl: `data:${mimetype};base64,${buffer.toString('base64')}`, mimetype });
    } catch (err) {
        console.error('Product image select/fetch error:', err);
        res.status(502).json({ success: false, message: err.message || 'Hindi ma-download ang piniling larawan.' });
    }
});

// ============================================================================
// Single-product Omni Search (free) — same free/no-API-key provider cascade
// used by the bulk Omni Search Images flow above (searchDuckDuckGoImagesFree,
// searchBingImagesFree, searchOpenverseImagesFree,
// searchWikimediaCommonsImagesFree, searchYandexImagesFree via
// omniFreeImageSearch). This lets the single-product "Search Image" modal
// (used from the Add/Edit Product form) offer an "Omni Search" option that
// works even when IMAGE_SEARCH_PROVIDER / IMAGE_SEARCH_API_KEY are not
// configured, since it needs no API key at all. The existing paid
// /api/products/image-search flow above is left completely untouched.
// ============================================================================

const OMNI_SINGLE_SEARCH_SESSION_TTL_MS = 10 * 60 * 1000;
const omniSingleSearchSessions = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [nonce, sess] of omniSingleSearchSessions.entries()) {
        if (now - sess.createdAt > OMNI_SINGLE_SEARCH_SESSION_TTL_MS) omniSingleSearchSessions.delete(nonce);
    }
}, 5 * 60 * 1000).unref();

app.post('/api/products/image-search/omni', rateLimit('product-image-search-omni', 20, 10 * 60 * 1000), requirePermission('products'), async (req, res) => {
    try {
        const { provider, results } = await omniFreeImageSearch(req.body && req.body.query);
        const nonce = crypto.randomBytes(16).toString('hex');
        const items = new Map();
        results.forEach(r => items.set(r.id, { imageUrl: r.imageUrl, thumbnailUrl: r.thumbnailUrl }));
        omniSingleSearchSessions.set(nonce, { username: req.authUser.username, createdAt: Date.now(), items });

        res.json({
            success: true,
            nonce,
            provider,
            results: results.map(({ imageUrl, ...rest }) => rest)
        });
    } catch (err) {
        console.error('Omni product image search error:', err);
        res.status(err.statusCode === 400 ? 400 : 502).json({ success: false, message: err.message || 'Omni Search failed.' });
    }
});

app.post('/api/products/image-search/omni/select', rateLimit('product-image-search-omni-select', 30, 10 * 60 * 1000), requirePermission('products'), async (req, res) => {
    const { nonce, id } = req.body || {};
    const sess = omniSingleSearchSessions.get(nonce);
    if (!sess || sess.username !== req.authUser.username || (Date.now() - sess.createdAt > OMNI_SINGLE_SEARCH_SESSION_TTL_MS)) {
        return res.status(400).json({ success: false, message: 'This search session has expired or is invalid. Please search again.' });
    }
    const item = sess.items.get(id);
    if (!item) {
        return res.status(400).json({ success: false, message: 'Invalid selection — not part of your earlier search results.' });
    }

    // Same self-healing fallback as the bulk Omni Search flow: try the
    // full-size image URL first, then fall back to the thumbnail (usually
    // served from the search provider's own CDN, so it's less likely to be
    // hotlink-blocked) — so one blocked source doesn't fail the selection.
    const candidateUrls = [item.imageUrl, item.thumbnailUrl].filter((u, i, arr) => u && arr.indexOf(u) === i);

    let lastErr = null;
    for (const candidateUrl of candidateUrls) {
        try {
            const { buffer, mimetype } = await fetchImageBuffer(candidateUrl, { maxBytes: 6 * 1024 * 1024 });
            if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimetype)) {
                lastErr = new Error('Unsupported image format from this source.');
                continue;
            }
            return res.json({ success: true, dataUrl: `data:${mimetype};base64,${buffer.toString('base64')}`, mimetype });
        } catch (err) {
            console.error(`Omni product image select/fetch error (${candidateUrl}):`, err);
            lastErr = err;
        }
    }

    res.status(502).json({ success: false, message: (lastErr && lastErr.message) || 'Could not download the selected image.' });
});

app.post('/api/products/bulk-image-search', rateLimit('product-bulk-image-search', 5, 60 * 60 * 1000), requirePermission('products'), async (req, res) => {
    if (!isImageSearchConfigured()) {
        return res.status(501).json({
            success: false,
            code: 'IMAGE_SEARCH_NOT_CONFIGURED',
            message: 'Hindi pa naka-set up ang Image Search. Ipa-add sa Admin ang IMAGE_SEARCH_PROVIDER at IMAGE_SEARCH_API_KEY (at IMAGE_SEARCH_CX kung Google Custom Search) sa .env file, tapos i-restart ang server.'
        });
    }

    const onlyMissing = req.body?.onlyMissing !== false;
    let limit = parseInt(req.body?.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, 100);

    const allProducts = readData(FILE_PRODUCTS);
    let targets = onlyMissing ? allProducts.filter(p => p && !p.image) : allProducts.slice();
    const totalEligible = targets.length;
    const truncated = targets.length > limit;
    targets = targets.slice(0, limit);

    if (!targets.length) {
        return res.json({ success: true, nonce: null, totalTargeted: 0, totalEligible, truncated: false, proposals: [] });
    }

    const nonce = crypto.randomBytes(16).toString('hex');

    // LIVE PROGRESS (hiling): dati, hinihintay ng request na ito ang
    // BUONG loop (isa-isang search, ~400ms pahinga sa pagitan) bago
    // sumagot — kaya sa malaking batch (hal. 100 produkto), parang
    // "nag-hang" ang UI nang matagal na oras nang walang anumang
    // makikitang progreso. Ngayon, AGAD sumasagot ang endpoint na ito
    // (bago pa man magsimula ang aktwal na search), at ang totoong
    // paghahanap ay tumatakbo sa BACKGROUND (hindi na hinihintay/hindi
    // naka-await dito) — ang progreso nito (ilan na ang tapos, ETA,
    // proposals-so-far) ay naka-imbak sa bulkImageSearchProgress,
    // sinusuri lang paulit-ulit (polling) ng frontend gamit ang bagong
    // GET /api/products/bulk-image-search/progress?nonce=... endpoint
    // sa ibaba.
    bulkImageSearchProgress.set(nonce, {
        username: req.authUser.username,
        total: targets.length,
        done: 0,
        proposals: [],
        finished: false,
        error: null,
        totalEligible,
        truncated,
        startedAt: Date.now(),
        updatedAt: Date.now()
    });

    res.json({
        success: true,
        nonce,
        totalTargeted: targets.length,
        totalEligible,
        truncated
    });

    // Hindi na-await sa itaas nang sinasadya — background job na ito,
    // patuloy na tumatakbo pagkatapos maipadala ang response sa itaas.
    // Anumang error dito ay naka-catch at nakalagay sa progress.error
    // lang (hindi na ito maiisyu bilang HTTP error response dahil
    // naipadala na ang res sa itaas).
    (async () => {
        const items = new Map();
        const progress = bulkImageSearchProgress.get(nonce);
        try {
            for (let i = 0; i < targets.length; i++) {
                const p = targets[i];
                try {
                    const results = await searchProductImages(`${p.name} product photo`);
                    const best = results[0];
                    if (best) {
                        items.set(p.code, { imageUrl: best.imageUrl, thumbnailUrl: best.thumbnailUrl, title: best.title });
                        progress.proposals.push({ code: p.code, name: p.name, found: true, thumbnailUrl: best.thumbnailUrl, title: best.title });
                    } else {
                        progress.proposals.push({ code: p.code, name: p.name, found: false, message: 'No image found.' });
                    }
                } catch (err) {
                    console.error(`Bulk image search error for ${p.code}:`, err);
                    progress.proposals.push({ code: p.code, name: p.name, found: false, message: 'Search failed for this product.' });
                }

                progress.done = i + 1;
                progress.updatedAt = Date.now();

                if (i < targets.length - 1) await sleepMs(400);
            }

            bulkImageSearchSessions.set(nonce, { username: req.authUser.username, createdAt: Date.now(), items });
            progress.finished = true;
            progress.updatedAt = Date.now();
        } catch (err) {
            console.error('Bulk image search background job failed:', err);
            progress.error = err.message || 'Bulk image search failed.';
            progress.finished = true;
            progress.updatedAt = Date.now();
        }
    })();
});

// GET /api/products/bulk-image-search/progress
// Pina-poll ng frontend bawat ~1s habang tumatakbo ang bulk search sa
// itaas, para makita ang live progress (X/Y na-search, tinatayang ilang
// segundo pa) sa halip na basta maghintay nang walang tanda ng galaw.
app.get('/api/products/bulk-image-search/progress', rateLimit('product-bulk-image-search-progress', 1200, 60 * 60 * 1000), requirePermission('products'), (req, res) => {
    const nonce = req.query?.nonce;
    const progress = nonce ? bulkImageSearchProgress.get(nonce) : null;
    if (!progress || progress.username !== req.authUser.username) {
        return res.status(400).json({ success: false, message: 'Invalid o expired na bulk search session. Mag-search ulit.' });
    }

    const elapsedMs = Date.now() - progress.startedAt;
    const avgMsPerItem = progress.done > 0 ? elapsedMs / progress.done : null;
    const remainingItems = Math.max(0, progress.total - progress.done);
    const etaMs = (!progress.finished && avgMsPerItem != null) ? Math.round(avgMsPerItem * remainingItems) : 0;

    res.json({
        success: true,
        total: progress.total,
        done: progress.done,
        finished: progress.finished,
        error: progress.error,
        proposals: progress.proposals,
        totalEligible: progress.totalEligible,
        truncated: progress.truncated,
        etaMs
    });
});

app.post('/api/products/bulk-image-search/fetch', rateLimit('product-bulk-image-search-fetch', 300, 60 * 60 * 1000), requirePermission('products'), async (req, res) => {
    const { nonce, code } = req.body || {};
    const sess = bulkImageSearchSessions.get(nonce);
    if (!sess || sess.username !== req.authUser.username || (Date.now() - sess.createdAt > BULK_IMAGE_SEARCH_SESSION_TTL_MS)) {
        return res.status(400).json({ success: false, message: 'Expired na o invalid ang bulk search session na ito. Mag-search ulit.' });
    }
    const proposal = sess.items.get(code);
    if (!proposal) {
        return res.status(400).json({ success: false, message: 'Invalid na produkto — wala ito sa kanina mong bulk search results.' });
    }

    // Sinusubukan muna ang full-size na imageUrl; kung ma-block o mag-fail
    // ito (karaniwan dahil sa hotlink protection ng pinagmulang site), awtomatikong
    // sinusubukan ang thumbnailUrl bilang fallback (galing mismo sa CDN ng
    // search provider, mas maaasahan). Dati, isang beses lang sinusubukan
    // ang imageUrl — kaya kapag na-block ito, agad na "failed" ang produktong
    // iyon kahit may magandang fallback na sana sa thumbnail.
    const candidateUrls = [proposal.imageUrl, proposal.thumbnailUrl]
        .filter((u, i, arr) => u && arr.indexOf(u) === i);

    let lastErr = null;
    for (const candidateUrl of candidateUrls) {
        try {
            const { buffer, mimetype } = await fetchImageBuffer(candidateUrl, { maxBytes: 6 * 1024 * 1024 });
            if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimetype)) {
                lastErr = new Error('Hindi suportadong image format ang galing sa source na ito.');
                continue;
            }
            return res.json({ success: true, code, dataUrl: `data:${mimetype};base64,${buffer.toString('base64')}`, mimetype });
        } catch (err) {
            console.error(`Bulk image fetch error for ${code} (${candidateUrl}):`, err);
            lastErr = err;
        }
    }

    res.status(502).json({ success: false, message: (lastErr && lastErr.message) || 'Hindi ma-download ang larawan para sa produktong ito.' });
});

app.post('/api/products/bulk-image-search/apply', rateLimit('product-bulk-image-search-apply', 15, 60 * 60 * 1000), requirePermission('products'), (req, res) => {
    const isAdminRole = (req.authUser.role || '').toLowerCase() === 'admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).products_direct_apply;
    if (!canApplyDirectly) {
        return res.status(403).json({
            success: false,
            message: 'Access Denied: You need "Direct Apply" permission to use Bulk Search Images. Please contact an Admin.'
        });
    }

    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (!updates.length) {
        return res.status(400).json({ success: false, message: 'Walang piniling larawan na i-a-apply.' });
    }

    const username = req.authUser.username;
    let products = readData(FILE_PRODUCTS);
    const codeIndex = new Map();
    products.forEach((p, i) => { if (p && p.code) codeIndex.set(p.code, i); });

    const applied = [];
    const failed = [];

    for (const u of updates) {
        const code = u && u.code;
        const image = u && u.image;
        if (!code || !image || typeof image !== 'string' || !image.startsWith('data:image/')) {
            failed.push({ code: code || '(unknown)', message: 'Invalid image data.' });
            continue;
        }
        const idx = codeIndex.get(code);
        if (idx === undefined) {
            failed.push({ code, message: 'Product not found (may have been deleted).' });
            continue;
        }
        products[idx].image = image;
        applied.push({ code, name: products[idx].name });
    }

    if (applied.length) {
        writeData(FILE_PRODUCTS, products);
        logAction(username, `Bulk Search Images: naglapat ng ${applied.length} auto-search product photo(s) (${failed.length} nabigo).`);
    }

    res.json({ success: true, appliedCount: applied.length, failedCount: failed.length, applied, failed, products });
});

// ============================================================================
// OMNI SEARCH IMAGES — routes (free, no API key required)
// ----------------------------------------------------------------------------
// Mirrors the "Bulk Search Images" endpoints above, but uses the free
// multi-provider cascade (DuckDuckGo → Bing (free) → Openverse → Wikimedia
// Commons → Yandex) instead of the configured paid provider (SerpApi /
// Google / Bing API), so it works with zero setup. The existing SerpApi
// flow above is untouched.
//
// "Apply" is intentionally shared with the paid flow's
// POST /api/products/bulk-image-search/apply route above — it only ever
// takes a product code + already-downloaded image data, so it works
// identically no matter which search flow produced the image.
// ============================================================================

app.post('/api/products/omni-image-search', rateLimit('product-omni-image-search', 5, 60 * 60 * 1000), requirePermission('products'), async (req, res) => {
    const onlyMissing = req.body?.onlyMissing !== false;
    let limit = parseInt(req.body?.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, 100);

    const allProducts = readData(FILE_PRODUCTS);
    let targets = onlyMissing ? allProducts.filter(p => p && !p.image) : allProducts.slice();
    const totalEligible = targets.length;
    const truncated = targets.length > limit;
    targets = targets.slice(0, limit);

    if (!targets.length) {
        return res.json({ success: true, nonce: null, totalTargeted: 0, totalEligible, truncated: false, proposals: [] });
    }

    const nonce = crypto.randomBytes(16).toString('hex');

    omniImageSearchProgress.set(nonce, {
        username: req.authUser.username,
        total: targets.length,
        done: 0,
        proposals: [],
        finished: false,
        error: null,
        totalEligible,
        truncated,
        startedAt: Date.now(),
        updatedAt: Date.now()
    });

    // Respond immediately — the actual search runs as a background job
    // (real detached OS process when possible, transparently falling back
    // to an in-process background task otherwise). Live progress is
    // available via the /progress endpoint below.
    res.json({ success: true, nonce, totalTargeted: targets.length, totalEligible, truncated });

    runOmniImageSearchJob(nonce, targets, req.authUser.username).catch(err => {
        console.error('Omni Search Images job dispatch failed:', err);
        const p = omniImageSearchProgress.get(nonce);
        if (p && !p.finished) { p.error = err.message || 'Omni Search Images failed to start.'; p.finished = true; p.updatedAt = Date.now(); }
    });
});

// GET /api/products/omni-image-search/progress
// Polled by the frontend roughly every second while the Omni Search runs,
// to show live progress (X/Y searched, ETA) the same way the paid Bulk
// Search Images flow does above.
app.get('/api/products/omni-image-search/progress', rateLimit('product-omni-image-search-progress', 1200, 60 * 60 * 1000), requirePermission('products'), (req, res) => {
    const nonce = req.query?.nonce;
    const progress = nonce ? omniImageSearchProgress.get(nonce) : null;
    if (!progress || progress.username !== req.authUser.username) {
        return res.status(400).json({ success: false, message: 'Invalid o expired na Omni Search session. Mag-search ulit.' });
    }

    const elapsedMs = Date.now() - progress.startedAt;
    const avgMsPerItem = progress.done > 0 ? elapsedMs / progress.done : null;
    const remainingItems = Math.max(0, progress.total - progress.done);
    const etaMs = (!progress.finished && avgMsPerItem != null) ? Math.round(avgMsPerItem * remainingItems) : 0;

    res.json({
        success: true,
        total: progress.total,
        done: progress.done,
        finished: progress.finished,
        error: progress.error,
        proposals: progress.proposals,
        totalEligible: progress.totalEligible,
        truncated: progress.truncated,
        etaMs
    });
});

app.post('/api/products/omni-image-search/fetch', rateLimit('product-omni-image-search-fetch', 300, 60 * 60 * 1000), requirePermission('products'), async (req, res) => {
    const { nonce, code } = req.body || {};
    const sess = omniImageSearchSessions.get(nonce);
    if (!sess || sess.username !== req.authUser.username || (Date.now() - sess.createdAt > OMNI_SEARCH_SESSION_TTL_MS)) {
        return res.status(400).json({ success: false, message: 'Expired na o invalid ang Omni Search session na ito. Mag-search ulit.' });
    }
    const proposal = sess.items.get(code);
    if (!proposal) {
        return res.status(400).json({ success: false, message: 'Invalid na produkto — wala ito sa kanina mong Omni Search results.' });
    }

    // Same self-healing fallback as the paid flow: try the full-size image
    // URL first, then fall back to the thumbnail (usually served from the
    // search provider's own CDN, so it's less likely to be hotlink-blocked).
    const candidateUrls = [proposal.imageUrl, proposal.thumbnailUrl]
        .filter((u, i, arr) => u && arr.indexOf(u) === i);

    let lastErr = null;
    for (const candidateUrl of candidateUrls) {
        try {
            const { buffer, mimetype } = await fetchImageBuffer(candidateUrl, { maxBytes: 6 * 1024 * 1024 });
            if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimetype)) {
                lastErr = new Error('Hindi suportadong image format ang galing sa source na ito.');
                continue;
            }
            return res.json({ success: true, code, dataUrl: `data:${mimetype};base64,${buffer.toString('base64')}`, mimetype });
        } catch (err) {
            console.error(`Omni Search Images fetch error for ${code} (${candidateUrl}):`, err);
            lastErr = err;
        }
    }

    res.status(502).json({ success: false, message: (lastErr && lastErr.message) || 'Hindi ma-download ang larawan para sa produktong ito.' });
});

app.get('/api/requests', requirePermission('pending_requests'), (req, res) => {
    res.json(readData(FILE_REQUESTS));
});

app.post('/api/requests/:id/resolve', rateLimit('admin-resolve-request', 15, 10 * 60 * 1000), verifyAdmin, (req, res) => {
    const { id } = req.params;
    const { action, username } = req.body;

    let requests = readData(FILE_REQUESTS);
    const reqIndex = requests.findIndex(r => r.id.toString() === id.toString());

    if (reqIndex === -1) {
        return res.status(404).json({ success: false, message:'Request Reference ID Not Found.' });
    }

    const targetReq = requests[reqIndex];
    const normalizedAction = action ? action.toLowerCase() :'';

    if (normalizedAction ==='approve' || normalizedAction ==='approved') {
        if (targetReq.type ==='PROFILE_UPDATE') {

            const result = applyProfileChanges(targetReq.targetUser, targetReq.data || {});
            if (!result.ok) {
                return res.status(400).json({ success: false, message: `Hindi ma-apply ang Edit Profile request: ${result.error}` });
            }
            logAction(username, result.renamedFrom
                ? `APPROVED Edit Profile request para kay "${targetReq.targetUser}" — pinalitan ang username sa "${result.user.username}"`
                : `APPROVED Edit Profile request para kay "${targetReq.targetUser}"`);
        } else if (targetReq.type ==='RECEIPT_UPDATE') {
            const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
            const d = targetReq.data || {};
            settings.storeName = (d.storeName ||'').trim() || settings.storeName;
            settings.storeAddress = (d.storeAddress ||'').trim();
            settings.storeContact = (d.storeContact ||'').trim();
            settings.headerText = (d.headerText ||'').trim();
            settings.footerText = (d.footerText ||'').trim() || DEFAULT_RECEIPT_SETTINGS.footerText;
            const approvedHeaderType = VALID_HEADER_TYPES.includes(d.headerType) ? d.headerType :'text';
            const approvedHeaderImage = approvedHeaderType ==='image' ? sanitizeReceiptHeaderImageDataUrl(d.headerImage) : null;
            settings.headerType = approvedHeaderImage ?'image' :'text';
            settings.headerImage = approvedHeaderImage;
            settings.headerImageStyle = sanitizeHeaderImageStyle(d.headerImageStyle);
            settings.customizeCount = (settings.customizeCount || 0) + 1;
            if (!settings.firstCustomizedAt) settings.firstCustomizedAt = new Date().toISOString();
            writeData(FILE_RECEIPT_SETTINGS, settings);
            logAction(username, `APPROVED Receipt Customization request from "${targetReq.requester}"`);
        } else if (targetReq.type ==='RECEIPT_PAPER_SIZE') {
            const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
            const paperSize = targetReq.data && targetReq.data.paperSize;
            if (VALID_PAPER_SIZES.includes(paperSize)) {
                settings.paperSize = paperSize;
                writeData(FILE_RECEIPT_SETTINGS, settings);
                logAction(username, `APPROVED Receipt Paper Size request (${paperSize}) mula kay "${targetReq.requester}"`);
            }
        } else if (targetReq.type ==='RECEIPT_BARCODE') {
            const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
            settings.barcodeSettings = sanitizeBarcodeSettings(targetReq.data && targetReq.data.barcodeSettings);
            writeData(FILE_RECEIPT_SETTINGS, settings);
            logAction(username, `APPROVED Receipt Barcode Settings request mula kay "${targetReq.requester}"`);
        } else if (targetReq.type ==='RECEIPT_ADVANCED') {
            const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
            settings.advancedSettings = sanitizeAdvancedSettings(targetReq.data && targetReq.data.advancedSettings);
            writeData(FILE_RECEIPT_SETTINGS, settings);
            logAction(username, `APPROVED Advanced Receipt Style request mula kay "${targetReq.requester}"`);
        } else if (targetReq.type ==='RECEIPT_LOYALTY_QR') {

            const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
            settings.loyaltyQrSettings = sanitizeLoyaltyQrSettings(targetReq.data && targetReq.data.loyaltyQrSettings);
            writeData(FILE_RECEIPT_SETTINGS, settings);
            logAction(username, `APPROVED Receipt Loyalty QR Settings request mula kay "${targetReq.requester}"`);
        } else if (targetReq.type ==='RECEIPT_TAIWAN_TEMPLATE') {
            const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
            settings.taiwanTemplateSettings = sanitizeTaiwanTemplateSettings(targetReq.data && targetReq.data.taiwanTemplateSettings);
            writeData(FILE_RECEIPT_SETTINGS, settings);
            logAction(username, `APPROVED Taiwan Receipt Template request mula kay "${targetReq.requester}"`);
        } else if (targetReq.type ==='RECEIPT_TRANSACTION_ID') {
            const settings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
            settings.transactionIdSettings = sanitizeTransactionIdSettings(targetReq.data && targetReq.data.transactionIdSettings);
            writeData(FILE_RECEIPT_SETTINGS, settings);
            logAction(username, `APPROVED Transaction ID Format request (${settings.transactionIdSettings.format}) mula kay "${targetReq.requester}"`);
        } else {
            let products = readData(FILE_PRODUCTS);

            if (targetReq.type ==='ADD') {
                products.push(targetReq.data);
                logAction(username, `APPROVED ADD Request for product: ${targetReq.data?.name}`);
            }
            else if (targetReq.type ==='UPDATE') {
                products = products.map(p => p.code.trim().toLowerCase() === targetReq.targetCode.trim().toLowerCase() ? { ...p, ...targetReq.data } : p);
                logAction(username, `APPROVED UPDATE Request for code: ${targetReq.targetCode}`);
            }
            else if (targetReq.type ==='DELETE') {
                products = products.filter(p => p.code.trim().toLowerCase() !== targetReq.targetCode.trim().toLowerCase());
                logAction(username, `APPROVED DELETE Request for code: ${targetReq.targetCode}`);
            }
            else if (targetReq.type ==='RESTOCK') {
                const qtyToAdd = parseInt(targetReq.data?.qtyToAdd) || 0;
                products = products.map(p => {
                    if (p.code.trim().toLowerCase() === targetReq.targetCode.trim().toLowerCase()) {
                        return { ...p, stock: (parseInt(p.stock) || 0) + qtyToAdd };
                    }
                    return p;
                });
                logAction(username, `APPROVED RESTOCK Request for code: ${targetReq.targetCode} (+${qtyToAdd})`);
            }

            writeData(FILE_PRODUCTS, products);
        }
    } else {
        if (targetReq.type ==='PROFILE_UPDATE') {
            logAction(username, `REJECTED Edit Profile request para kay "${targetReq.targetUser}"`);
        } else {
            logAction(username, `REJECTED ${targetReq.type} request for item ID/Code: ${targetReq.targetCode || targetReq.data?.code}`);
        }
    }

    requests = requests.filter(r => r.id.toString() !== id.toString());
    writeData(FILE_REQUESTS, requests);

    res.json({ success: true, message: `Request processed and removed successfully.` });
});

app.post('/api/transactions', requirePermission('terminal'), async (req, res) => {
    await transactionsMutexRunExclusive(() => processTransaction(req, res));
});

async function processTransaction(req, res) {
    const { transaction, username, creditDebtInfo } = req.body;

    if (!transaction || typeof transaction !== 'object' || !Array.isArray(transaction.items) || transaction.items.length === 0) {
        return res.status(400).json({ success: false, message: 'Walang laman o hindi valid ang transaction items.' });
    }

    transaction.cashier = req.authUser.username;

    {
        const cashierRecord = readData(FILE_USERS).find(u => u.username.toLowerCase() === req.authUser.username.toLowerCase());
        transaction.cashierDisplayName = (cashierRecord && cashierRecord.displayName) || null;
    }

    let transactions = readData(FILE_TRANSACTIONS);
    let products = readData(FILE_PRODUCTS);
    let customers = readData(FILE_CUSTOMERS, []);

    const storeSettings = getStoreSettingsPublic(readData(FILE_STORE_SETTINGS, DEFAULT_STORE_SETTINGS));

    const enabledMethodKeys = Object.entries(storeSettings.paymentMethods)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key.toLowerCase());
    const methodAliasMap = { cash:'cash', gcash:'gcash', maya:'maya', paymaya:'maya', card:'card', banktransfer:'banktransfer', bank_transfer:'banktransfer' };
    // "C-Credit" (Customer Credit / utang) is not a real money-in method — it's an
    // accounting entry that routes the sale to the Debtors ledger instead of cash
    // drawer/e-wallet/card, so it's intentionally NOT gated by the Store & Sales
    // Settings payment-method toggles (same way Cash is always considered available).
    const creditMethodAliases = new Set(['ccredit', 'credit', 'customercredit']);
    function normalizeMethodKeyLoose(rawMethod) {
        return String(rawMethod || '').toLowerCase().replace(/[\s_-]/g, '');
    }
    function isCreditMethod(rawMethod) {
        return creditMethodAliases.has(normalizeMethodKeyLoose(rawMethod));
    }
    function isMethodEnabled(rawMethod) {
        const norm = String(rawMethod || 'cash').toLowerCase().replace(/[\s_-]/g, '');
        if (creditMethodAliases.has(norm)) return true;
        const key = methodAliasMap[norm] || norm;
        return enabledMethodKeys.includes(key);
    }
    const paymentMethodsUsed = Array.isArray(transaction.payments) && transaction.payments.length > 0
        ? transaction.payments.map(p => p.method)
        : [transaction.method || transaction.payment_method || 'cash'];
    const disabledMethodUsed = paymentMethodsUsed.find(m => !isMethodEnabled(m));
    if (disabledMethodUsed) {
        return res.status(400).json({
            success: false,
            message: `Ang payment method na "${disabledMethodUsed}" ay hindi naka-enable sa Store & Sales Settings. Puntahan ang Users > Store & Sales para i-enable.`
        });
    }

    const usesCreditPayment = paymentMethodsUsed.some(isCreditMethod);
    if (usesCreditPayment) {
        if (paymentMethodsUsed.length > 1) {
            return res.status(400).json({ success: false, message: 'Hindi pwedeng i-split ang Customer Credit (C-Credit) kasama ang ibang payment method.' });
        }
        const unlockedIds = getUnlockedFeatureIds();
        if (!unlockedIds.includes('customer_crm')) {
            const feature = FEATURE_CATALOG['customer_crm'];
            return res.status(402).json({
                success: false,
                featureLocked: true,
                featureId: 'customer_crm',
                featureName: feature ? feature.name : 'customer_crm',
                price: feature ? feature.price : null,
                message: `"${feature ? feature.name : 'Customer CRM'}" is a premium feature and is currently locked. Please unlock it (additional purchase required) to continue.`
            });
        }
        if (!creditDebtInfo || !String(creditDebtInfo.customerName || '').trim()) {
            return res.status(400).json({ success: false, message: 'Kailangan ng pangalan ng debtor (Add Debt form) bago maproseso ang bentang C-Credit.' });
        }
    }

    const eWalletMethods = new Set(['gcash', 'maya', 'paymaya']);
    function normalizeMethodKey(rawMethod) {
        return String(rawMethod || '').toLowerCase().replace(/[\s_-]/g, '');
    }
    if (Array.isArray(transaction.payments) && transaction.payments.length > 0) {
        const missingRef = transaction.payments.find(p =>
            eWalletMethods.has(normalizeMethodKey(p.method)) && !String(p.reference || '').trim());
        if (missingRef) {
            return res.status(400).json({
                success: false,
                message: `Kailangan ang reference/transaction number para sa ${missingRef.method} na bayad.`
            });
        }
    } else {
        const singleMethod = normalizeMethodKey(transaction.method || transaction.payment_method);
        if (eWalletMethods.has(singleMethod) && !String(transaction.paymentReference || '').trim()) {
            return res.status(400).json({
                success: false,
                message: `Kailangan ang reference/transaction number para sa ${transaction.method || transaction.payment_method} na bayad.`
            });
        }
    }

    const resolvedItems = [];
    const stockIssues = [];
    const rejectedItems = [];

    const requestedQtyByCode = {};

    for (const item of (transaction.items || [])) {
        let prod = products.find(p => p.code === item.code);
        if (!prod) prod = products.find(p => p.name === item.name);

        if (!prod) {
            rejectedItems.push(item && (item.code || item.name) || '(unknown item)');
            continue;
        }

        const qty = parseInt(item.quantity, 10);
        if (!Number.isInteger(qty) || qty <= 0 || String(item.quantity).trim() === '') {
            rejectedItems.push(`${prod.name} (invalid quantity: ${item.quantity})`);
            continue;
        }

        const catalogPrice = parseFloat(prod.price) || 0;
        const lineSubtotal = Math.round(catalogPrice * qty * 100) / 100;
        const itemDiscount = Math.min(Math.max(0, parseFloat(item.itemDiscount) || 0), lineSubtotal);

        requestedQtyByCode[prod.code] = (requestedQtyByCode[prod.code] || 0) + qty;

        resolvedItems.push({
            code: prod.code,
            name: prod.name,
            price: catalogPrice,
            quantity: qty,
            itemDiscount,
            cost: parseFloat(prod.cost) || 0
        });
    }

    if (rejectedItems.length === 0) {
        for (const code of Object.keys(requestedQtyByCode)) {
            const prod = products.find(p => p.code === code);
            if (!prod) continue;
            const availableStock = parseInt(prod.stock) || 0;
            const totalRequested = requestedQtyByCode[code];
            if (totalRequested > availableStock) {
                stockIssues.push(`${prod.name} (natitira: ${availableStock}, hiniling: ${totalRequested})`);
            }
        }
    }

    if (rejectedItems.length > 0) {
        return res.status(400).json({
            success: false,
            message: `Hindi ma-proseso ang benta — invalid o hindi nahanap ang item(s): ${rejectedItems.join(', ')}.`
        });
    }
    if (stockIssues.length > 0) {
        return res.status(409).json({
            success: false,
            outOfStock: true,
            message: `Hindi ma-proceed ang benta — naubos/kulang na ang stock: ${stockIssues.join(', ')}. Malamang na-benta na ito sa ibang terminal/device. I-refresh ang product list.`
        });
    }

    const grossSubtotal = Math.round(resolvedItems.reduce((sum, it) => sum + (it.price * it.quantity), 0) * 100) / 100;
    const itemDiscountTotal = Math.round(resolvedItems.reduce((sum, it) => sum + it.itemDiscount, 0) * 100) / 100;
    const netAfterItemDiscounts = Math.max(0, Math.round((grossSubtotal - itemDiscountTotal) * 100) / 100);

    let cartDiscount = 0;
    const discountType = transaction.discountType || 'NONE';

    if (discountType === 'SENIOR_PWD') {
        if (!transaction.seniorPwdId || !String(transaction.seniorPwdId).trim()) {
            return res.status(400).json({ success: false, message: 'Kailangan ng Senior/PWD ID Number para sa discount na ito.' });
        }
        if (!storeSettings.seniorPwdDiscountEnabled) {
            return res.status(400).json({ success: false, message: 'Naka-disable ang Senior/PWD Discount. Puntahan ang Users > Store & Sales para i-enable.' });
        }
        const seniorPwdRate = Math.min(Math.max(0, storeSettings.seniorPwdDiscountRate), 100) / 100;
        cartDiscount = Math.round(netAfterItemDiscounts * seniorPwdRate * 100) / 100;
    } else if (discountType === 'PROMO') {
        const promoCode = String(transaction.promoCode || '').toUpperCase();
        const promos = readData(FILE_PROMOCODES, []);
        const promo = promos.find(p => p.code === promoCode);
        if (!promo || !promo.active || (promo.expiresAt && new Date(promo.expiresAt).getTime() < Date.now())) {
            return res.status(400).json({ success: false, message: 'Hindi valid o na-expire na ang promo code na ito.' });
        }
        if (promo.minSpend && netAfterItemDiscounts < promo.minSpend) {
            return res.status(400).json({ success: false, message: `Kailangan ng minimum na ₱${promo.minSpend.toFixed(2)} para magamit ang promo na ito.` });
        }
        const promoDiscount = promo.type === 'percent' ? (netAfterItemDiscounts * promo.value / 100) : promo.value;
        cartDiscount = Math.round(Math.min(Math.max(promoDiscount, 0), netAfterItemDiscounts) * 100) / 100;
    } else if (discountType === 'MANUAL') {
        cartDiscount = Math.round(Math.min(Math.max(0, parseFloat(transaction.discount) || 0), netAfterItemDiscounts) * 100) / 100;
    } else if (discountType === 'LOYALTY') {

        if (usesCreditPayment) {
            return res.status(400).json({ success: false, message: 'Hindi puwedeng gumamit ng Loyalty Points redemption sa isang C-Credit (utang) na benta — hindi pa ito totoong bayad.' });
        }
        if (!storeSettings.loyaltyEnabled) {
            return res.status(400).json({ success: false, message: 'Naka-disable ang Loyalty Points redemption. Puntahan ang Users > Store & Sales para i-enable.' });
        }
        if (!transaction.customerId) {
            return res.status(400).json({ success: false, message: 'Pumili muna ng customer para makagamit ng loyalty points.' });
        }
        const redeemingCustomer = customers.find(c => c.id === transaction.customerId);
        if (!redeemingCustomer) {
            return res.status(400).json({ success: false, message: 'Customer not found.' });
        }
        const requestedPoints = Math.max(0, parseInt(transaction.loyaltyPointsRedeemed) || 0);
        const availablePoints = Math.max(0, redeemingCustomer.points || 0);
        const pointValue = Math.max(0, parseFloat(storeSettings.loyaltyPointValue) || 0);
        let pointsToRedeem = Math.min(requestedPoints, availablePoints);
        cartDiscount = Math.round(Math.min(pointsToRedeem * pointValue, netAfterItemDiscounts) * 100) / 100;

        pointsToRedeem = pointValue > 0 ? Math.floor(cartDiscount / pointValue) : 0;
        cartDiscount = Math.round(pointsToRedeem * pointValue * 100) / 100;
        if (pointsToRedeem <= 0) {
            return res.status(400).json({ success: false, message: 'Walang sapat na loyalty points para gamitin.' });
        }
        transaction.loyaltyPointsRedeemed = pointsToRedeem;

        const cardToken = transaction.loyaltyCardToken;
        if (cardToken) {
            const cardCheck = verifyLoyaltyCardToken(redeemingCustomer, cardToken);
            if (!cardCheck.valid) {
                return res.status(403).json({ success: false, code:'LOYALTY_CARD_INVALID', message: cardCheck.message });
            }
            transaction.loyaltyAuthorizedBy = 'Customer Loyalty Card/QR Scan';

        } else {
            const loyaltyAuthPassword = transaction.loyaltyAuthPassword;
            if (!loyaltyAuthPassword) {
                return res.status(400).json({
                    success: false,
                    code:'LOYALTY_AUTH_REQUIRED',
                    message:'I-scan ang Loyalty Card/QR ng customer, o maglagay ng Admin/Supervisor password para sa manual na pag-redeem.'
                });
            }
            const loyaltyAuthUsers = readData(FILE_USERS);
            const loyaltyAuthResult = await findLoyaltyRedeemAuthorizer(loyaltyAuthUsers, loyaltyAuthPassword);
            if (!loyaltyAuthResult) {
                return res.status(403).json({ success: false, code:'WRONG_ADMIN_PASSWORD', message:'Incorrect password. Loyalty points redemption was not authorized.' });
            }
            transaction.loyaltyAuthorizedBy = loyaltyAuthResult.isAdmin
                ? `${loyaltyAuthResult.user.username} (Admin, manual)`
                : `${loyaltyAuthResult.user.username} (RBAC, manual)`;
        }
    }

    const manualDiscountTotal = Math.round((itemDiscountTotal + (discountType ==='MANUAL' ? cartDiscount : 0)) * 100) / 100;
    let discountAuthorizedBy = null;

    if (manualDiscountTotal > 0) {
        const discountAuthPassword = transaction.discountAuthPassword;
        if (!discountAuthPassword) {
            return res.status(400).json({
                success: false,
                code:'DISCOUNT_AUTH_REQUIRED',
                message:'An Admin/Supervisor password is required to authorize this manual discount.'
            });
        }
        const authUsers = readData(FILE_USERS);
        const discountAuthResult = await findManualDiscountAuthorizer(authUsers, discountAuthPassword);
        if (!discountAuthResult) {
            return res.status(403).json({
                success: false,
                code:'WRONG_ADMIN_PASSWORD',
                message:'Incorrect password. Manual discount was not authorized.'
            });
        }
        discountAuthorizedBy = discountAuthResult.isAdmin
            ? `${discountAuthResult.user.username} (Admin)`
            : `${discountAuthResult.user.username} (RBAC)`;
    }

    products = readData(FILE_PRODUCTS);
    const freshStockIssues = [];
    for (const code of Object.keys(requestedQtyByCode)) {
        const prod = products.find(p => p.code === code);
        if (!prod) {
            freshStockIssues.push(`${code} (hindi na nahanap ang produkto)`);
            continue;
        }
        const availableStock = parseInt(prod.stock) || 0;
        const totalRequested = requestedQtyByCode[code];
        if (totalRequested > availableStock) {
            freshStockIssues.push(`${prod.name} (natitira: ${availableStock}, hiniling: ${totalRequested})`);
        }
    }
    if (freshStockIssues.length > 0) {
        return res.status(409).json({
            success: false,
            outOfStock: true,
            message: `Hindi ma-proceed ang benta — naubos/kulang na ang stock: ${freshStockIssues.join(', ')}. Malamang na-benta na ito sa ibang terminal/device. I-refresh ang product list.`
        });
    }

    const verifiedTotal = Math.max(0, Math.round((netAfterItemDiscounts - cartDiscount) * 100) / 100);

    let taxAmount = 0;
    const taxRatePct = Math.min(Math.max(0, storeSettings.taxRate), 100);
    if (storeSettings.taxEnabled && taxRatePct > 0) {
        if (storeSettings.pricesIncludeTax) {
            taxAmount = Math.round((verifiedTotal - (verifiedTotal / (1 + taxRatePct / 100))) * 100) / 100;
        } else {
            taxAmount = Math.round(verifiedTotal * (taxRatePct / 100) * 100) / 100;
        }
    }
    const grandTotal = (storeSettings.taxEnabled && !storeSettings.pricesIncludeTax)
        ? Math.round((verifiedTotal + taxAmount) * 100) / 100
        : verifiedTotal;

    const tendered = Array.isArray(transaction.payments) && transaction.payments.length > 0
        ? transaction.payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
        : (parseFloat(transaction.received ?? transaction.amount_paid) || 0);

    if (Math.round(tendered * 100) / 100 < grandTotal - 0.01) {
        return res.status(400).json({
            success: false,
            message: `Hindi tama ang binayad — kulang ito (₱${tendered.toFixed(2)}) kumpara sa tamang total (₱${grandTotal.toFixed(2)}).`
        });
    }

    transaction.items = resolvedItems;
    transaction.discount = cartDiscount;
    transaction.subtotalBeforeTax = verifiedTotal;
    transaction.taxRate = storeSettings.taxEnabled ? taxRatePct : 0;
    transaction.taxAmount = taxAmount;
    transaction.taxInclusive = !!storeSettings.pricesIncludeTax;
    transaction.total = grandTotal;
    transaction.change = Math.round((tendered - grandTotal) * 100) / 100;
    transaction.discountAuthorizedBy = discountAuthorizedBy;
    delete transaction.discountAuthPassword;

    delete transaction.loyaltyAuthPassword;
    delete transaction.loyaltyCardToken;

    transaction.items.forEach(item => {
        const prod = products.find(p => p.code === item.code);
        if (prod) {
            prod.stock = Math.max(0, prod.stock - item.quantity);
        }
    });

    let newLoyaltyCardToken = null;
    if (transaction.customerId) {
        const cust = customers.find(c => c.id === transaction.customerId);
        if (cust) {

            const redeem = discountType === 'LOYALTY' ? Math.max(0, parseInt(transaction.loyaltyPointsRedeemed) || 0) : 0;
            if (redeem > 0) {
                cust.points = Math.max(0, (cust.points || 0) - redeem);

                const custHasRotatingCard = cust.loyaltyCard && !cust.loyaltyCard.revoked && cust.loyaltyCard.mode ==='rotating';
                if (custHasRotatingCard) {
                    const rotated = issueLoyaltyCard(cust, 'rotating', transaction.loyaltyAuthorizedBy || 'system');
                    newLoyaltyCardToken = rotated.token;
                }
            } else {
                transaction.loyaltyPointsRedeemed = 0;
            }
            delete transaction._loyaltyCardRotate;

            // C-Credit (utang) sales don't earn loyalty points — no real payment
            // has come in yet, only when the debt gets settled would that apply.
            const earnRate = (storeSettings.loyaltyEnabled && !usesCreditPayment) ? (parseFloat(storeSettings.loyaltyEarnRate) || 100) : 0;
            const earned = earnRate > 0 ? Math.floor((parseFloat(transaction.total) || 0) / earnRate) : 0;
            cust.points = (cust.points || 0) + earned;
            cust.totalSpent = Math.round(((cust.totalSpent || 0) + (parseFloat(transaction.total) || 0)) * 100) / 100;
            cust.visits = (cust.visits || 0) + 1;
            cust.lastVisit = new Date().toISOString();

            transaction.customerName = cust.name;
            transaction.customerEmail = cust.email ||'';
            transaction.loyaltyPointsEarned = earned;
            transaction.loyaltyPointsBalance = cust.points;

            writeData(FILE_CUSTOMERS, customers);
        }
    }

    transactions.unshift(transaction);
    writeData(FILE_TRANSACTIONS, transactions);
    writeData(FILE_PRODUCTS, products);

    logAction(username, `Processed sale transaction: ${transaction.id}`
        + (discountAuthorizedBy ? ` (Manual discount ₱${manualDiscountTotal.toFixed(2)} authorized by: ${discountAuthorizedBy})` : '')
        + (transaction.loyaltyAuthorizedBy ? ` (Loyalty redemption authorized by: ${transaction.loyaltyAuthorizedBy})` : ''));

    // ---- C-Credit sale => auto-create a linked Debtor/Debt record ----
    // The sale above already went through the normal flow (inventory reduced,
    // transaction recorded like any other sale). When paid via C-Credit, we
    // additionally drop a debt record so the amount owed — and which
    // products it's for — shows up in the Debtors ledger.
    let createdDebt = null;
    if (usesCreditPayment) {
        const debts = readData(FILE_DEBTS, []);
        const debtorName = String(creditDebtInfo.customerName).trim();
        const debtItems = (transaction.items || []).map(it => ({
            code: it.code || '',
            name: it.name || '',
            quantity: parseInt(it.quantity, 10) || 0,
            price: parseFloat(it.price) || 0
        }));
        let dueAtIso = null;
        if (creditDebtInfo.dueAt) {
            const parsedDue = new Date(creditDebtInfo.dueAt);
            if (!isNaN(parsedDue.getTime())) dueAtIso = parsedDue.toISOString();
        }
        createdDebt = {
            id: 'DEBT-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
            customerName: debtorName,
            phone: String(creditDebtInfo.phone || ''),
            amount: transaction.total,
            amountPaid: 0,
            note: String(creditDebtInfo.note || ''),
            items: debtItems,
            transactionId: transaction.id,
            borrowedAt: new Date().toISOString(),
            dueAt: dueAtIso,
            status: 'unpaid',
            createdBy: req.authUser.username,
            createdAt: new Date().toISOString(),
            paidAt: null
        };
        debts.unshift(createdDebt);
        writeData(FILE_DEBTS, debts);
        logAction(username, `Auto-recorded a debt from C-Credit sale ${transaction.id}: ${debtorName} — ₱${(transaction.total || 0).toFixed(2)}`);
    }

    runFraudChecks('sale', { transaction });

    try {
        const advSettings = getAdvancedSettingsPublic(readData(FILE_ADVANCED_SETTINGS, DEFAULT_ADVANCED_SETTINGS));
        if (advSettings.saleWebhookEnabled && advSettings.saleWebhookUrl && typeof fetch === 'function') {
            fetch(advSettings.saleWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: 'sale.completed',
                    transactionId: transaction.id,
                    total: transaction.total,
                    cashier: transaction.cashier,
                    itemCount: (transaction.items || []).length,
                    timestamp: transaction.isoDate || new Date().toISOString()
                })
            }).catch(err => console.error('Sale webhook delivery failed:', err.message));
        }
    } catch (webhookErr) {
        console.error('Sale webhook error:', webhookErr.message);
    }

    res.json({ success: true, currentTransaction: transaction, newLoyaltyCardToken, debt: createdDebt });

}

app.get('/api/cart/:username', (req, res) => {
    const username = req.params.username;

    const isOwner = req.authUser.username.toLowerCase() === username.toLowerCase();
    const isAdmin = req.authUser.role.toLowerCase() ==='admin';
    if (!isOwner && !isAdmin) {
        return res.status(403).json({ success: false, message:'Akses Denied: Hindi mo pwedeng tingnan ang cart ng ibang user.' });
    }

    const cartsData = readData(FILE_CARTS, {});

    res.json({ success: true, cart: cartsData[username] || [] });
});

app.post('/api/cart', (req, res) => {
    const { username, cart } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message:'Missing username' });
    }

    const cartsData = readData(FILE_CARTS, {});

    cartsData[username] = cart;

    writeData(FILE_CARTS, cartsData);
    res.json({ success: true, message:'Cart saved to database successfully.' });
});

app.get('/api/transactions', (req, res) => {

    const requester = req.authUser.username;
    const allTransactions = readData(FILE_TRANSACTIONS);

    const users = readData(FILE_USERS);
    const activeUser = users.find(u => u.username.toLowerCase() === requester.toLowerCase());

    const activeRole = activeUser && activeUser.role;
    const isAdminRole = (activeRole ||'').toLowerCase() ==='admin';
    const canViewAll = isAdminRole || !!getPermissionsForRole(activeRole).transactions_view_all;
    if (canViewAll) {
        return res.json(allTransactions);
    }

    const ownTransactions = allTransactions.filter(
        tx => (tx.cashier ||'').toLowerCase() === requester.toLowerCase()
    );
    res.json(ownTransactions);
});

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Server-side CODE128 barcode (PNG) ng transaction ID — parehong uri ng
// barcode (at parehong laman: ang tx.id) na nakikita sa naka-print na
// resibo (tingnan ang JsBarcode(...) call sa public/app.js). Ginagamit
// ang bwip-js dahil pure-JS ito (walang native/canvas na kailangang
// i-compile) — ligtas ito sa Termux/Android build.
async function generateReceiptBarcodePng(text, barcodeSettings) {
    const bset = barcodeSettings || {};
    return bwipjs.toBuffer({
        bcid: 'code128',
        text: String(text || ''),
        scale: 3,
        height: Math.max(8, Math.round((bset.height || 40) / 3)),
        includetext: bset.displayValue !== false,
        textxalign: 'center',
        textsize: Math.max(8, Math.min(14, bset.fontSize || 11)),
        paddingwidth: 6,
        paddingheight: 6,
        backgroundcolor: 'FFFFFF'
    });
}

// Server-side QR code (PNG) — ginagamit para sa Loyalty Card QR (parehong
// token na naka-encode sa QR na nasa naka-print na resibo, tingnan ang
// applyLoyaltyQrSettingsToDom() sa public/app.js). Gaya ng barcode, ito
// ay ipina-pasa lang sa client (walang RECEIPT_IMAGE) kaya kailangan
// muling i-render dito bilang aktwal na imahe (hindi puwedeng umasa sa
// client-side QRCode.js library — hindi tumatakbo ang JS sa loob ng
// email client).
async function generateReceiptQrPng(text, sizePx, correctLevel) {
    return QRCode.toBuffer(String(text || ''), {
        width: Math.max(80, Math.min(400, sizePx || 160)),
        margin: 1,
        errorCorrectionLevel: correctLevel || 'M'
    });
}

// Bumubuo ng "pro/modern" HTML e-receipt — sinisikap na ipakita ang
// LAHAT ng makikita sa naka-print na resibo (item breakdown, discount,
// tax, payment breakdown, loyalty points, barcode, loyalty QR) sa loob
// ng isang maayos/de-kalidad na email layout. Table-based + inline
// styles lang (sinasadya — pinaka-compatible ito sa buong hanay ng mail
// client, kasama ang Outlook, na hindi sumusuporta sa modernong CSS
// gaya ng flexbox/grid).
function buildReceiptEmailHtml({ settings, tx, storeName, cashierLabel, paymentRows, itemsHtml, totalsRows, hasBarcode, loyaltyQr, changeAmount }) {
    const accent = (settings.advancedSettings && settings.advancedSettings.accentColor) || '#4f46e5';
    const storeAddress = settings.storeAddress || '';
    const storeContact = settings.storeContact || '';
    const footerText = settings.footerText || 'Thank you for shopping!';
    const dateLabel = tx.timestamp || (tx.isoDate ? new Date(tx.isoDate).toLocaleString() : '');

    const customerRow = tx.customerName
        ? `<tr><td style="padding:4px 0;color:#64748b;">Customer</td><td align="right" style="padding:4px 0;font-weight:600;color:#0f172a;">${escapeHtml(tx.customerName)}</td></tr>`
        : '';

    const loyaltyBlock = (tx.loyaltyPointsEarned || tx.loyaltyPointsRedeemed || Number.isFinite(tx.loyaltyPointsBalance))
        ? `<tr><td style="padding:14px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
                <tr><td style="padding:12px 16px;font-size:12px;color:#92400e;">
                    ${tx.loyaltyPointsEarned ? `<div>+${escapeHtml(tx.loyaltyPointsEarned)} loyalty points earned</div>` : ''}
                    ${tx.loyaltyPointsRedeemed ? `<div>${escapeHtml(tx.loyaltyPointsRedeemed)} points redeemed</div>` : ''}
                    ${Number.isFinite(tx.loyaltyPointsBalance) ? `<div>Points balance: ${escapeHtml(tx.loyaltyPointsBalance)}</div>` : ''}
                </td></tr>
            </table>
        </td></tr>`
        : '';

    const barcodeBlock = hasBarcode
        ? `<tr><td style="padding:26px 32px 0;text-align:center;">
            <img src="cid:receiptBarcode" alt="Barcode ${escapeHtml(tx.id)}" style="max-width:260px;width:100%;height:auto;">
        </td></tr>`
        : '';

    const loyaltyQrBlock = loyaltyQr
        ? `<tr><td style="padding:20px 32px 0;text-align:center;">
            <img src="cid:loyaltyQr" alt="Loyalty QR" width="${loyaltyQr.sizePx}" height="${loyaltyQr.sizePx}" style="border:1px solid #e2e8f0;border-radius:10px;padding:8px;background:#ffffff;">
            ${loyaltyQr.note ? `<div style="font-size:12px;color:#64748b;margin-top:8px;">${escapeHtml(loyaltyQr.note)}</div>` : ''}
        </td></tr>`
        : '';

    const changeRow = changeAmount > 0
        ? `<tr><td style="padding:8px 16px 0;font-size:13px;color:#64748b;">Change</td><td align="right" style="padding:8px 16px 0;font-size:13px;font-weight:700;color:#0f172a;">₱${changeAmount.toFixed(2)}</td></tr>`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Receipt ${escapeHtml(tx.id)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,0.08);">
    <tr><td style="background-color:${accent};padding:30px 32px;text-align:center;">
        <div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:0.3px;">${escapeHtml(storeName)}</div>
        ${storeAddress ? `<div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:6px;">${escapeHtml(storeAddress)}</div>` : ''}
        ${storeContact ? `<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-top:2px;">${escapeHtml(storeContact)}</div>` : ''}
    </td></tr>
    <tr><td style="padding:22px 32px 0;">
        <span style="display:inline-block;background-color:#ecfdf5;color:#059669;font-size:11px;font-weight:700;letter-spacing:0.4px;padding:6px 14px;border-radius:999px;">✓ PAYMENT RECEIVED</span>
    </td></tr>
    <tr><td style="padding:18px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#64748b;">
            <tr><td style="padding:4px 0;">Receipt #</td><td align="right" style="padding:4px 0;font-weight:700;color:#0f172a;">${escapeHtml(tx.id)}</td></tr>
            <tr><td style="padding:4px 0;">Date</td><td align="right" style="padding:4px 0;">${escapeHtml(dateLabel)}</td></tr>
            <tr><td style="padding:4px 0;">Cashier</td><td align="right" style="padding:4px 0;">${escapeHtml(cashierLabel)}</td></tr>
            ${customerRow}
        </table>
    </td></tr>
    <tr><td style="padding:20px 32px 0;"><div style="border-top:1px solid #e2e8f0;"></div></td></tr>
    <tr><td style="padding:16px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
            <tr>
                <td style="padding:0 0 8px;color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Item</td>
                <td align="center" style="padding:0 0 8px;color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Qty</td>
                <td align="right" style="padding:0 0 8px;color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Amount</td>
            </tr>
            ${itemsHtml}
        </table>
    </td></tr>
    <tr><td style="padding:16px 32px 0;">
        <div style="border-top:1px dashed #cbd5e1;padding-top:14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#475569;">
                ${totalsRows}
            </table>
        </div>
    </td></tr>
    <tr><td style="padding:16px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border-radius:10px;">
            <tr><td style="padding:12px 16px;font-size:13px;color:#64748b;">Payment</td><td align="right" style="padding:12px 16px;font-size:13px;font-weight:700;color:#0f172a;">${paymentRows}</td></tr>
            ${changeRow}
        </table>
    </td></tr>
    ${loyaltyBlock}
    ${barcodeBlock}
    ${loyaltyQrBlock}
    <tr><td style="padding:28px 32px 6px;text-align:center;">
        <div style="font-size:14px;font-style:italic;color:#334155;">${escapeHtml(footerText)}</div>
    </td></tr>
    <tr><td style="padding:6px 32px 28px;text-align:center;">
        <div style="font-size:11px;color:#94a3b8;">This is an electronic receipt. Please keep this for your records.</div>
    </td></tr>
</table>
<div style="font-size:11px;color:#94a3b8;margin-top:16px;">Sent via ${escapeHtml(storeName)} · Powered by OmniPOS</div>
</td></tr>
</table>
</body>
</html>`;
}

app.post('/api/transactions/:transactionId/email-receipt', rateLimit('email-receipt', 20, 15 * 60 * 1000), async (req, res) => {
    const { transactionId } = req.params;
    const { toEmail, transaction: clientTx, receiptImage, loyaltyQr: loyaltyQrInput } = req.body;

    const emailPattern =/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!toEmail || !emailPattern.test(toEmail)) {
        return res.status(400).json({ success: false, message:'Di-wastong email address.' });
    }

    const transactions = readData(FILE_TRANSACTIONS, []);
    const tx = transactions.find(t => t.id === transactionId) || clientTx;
    if (!tx) {
        return res.status(404).json({ success: false, message:'Hindi mahanap ang transaction record na ito.' });
    }

    const rawReceiptSettings = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    const settings = getReceiptSettingsPublic(rawReceiptSettings);
    // BUGFIX: dating ipinapasa dito ang "public" (masked) settings, na wala
    // nang otpSenderEmail/otpSenderAppPassword field (tinanggal na para hindi
    // ma-leak sa client) — kaya LAGING "hindi configured" ang nakikita rito
    // kahit naka-save at naka-verify na ang Sender Gmail sa totoo lang. Dapat
    // ang RAW settings (may kasamang aktwal na credentials) ang gamitin dito.
    const mailCreds = getOtpMailCredentials(rawReceiptSettings);
    if (!mailCreds) {
        return res.status(400).json({
            success: false,
            message:'No Sender Gmail configured yet. Set this up first under Users > Receipt Customization > OTP Sender Email.'
        });
    }

    try {
        const storeName = settings.storeName ||'OmniPOS';

        const cashierUsername = tx.cashier ||'';
        const cashierDisplayName = tx.cashierDisplayName ||'';
        const cashierLabel = (cashierDisplayName && cashierDisplayName.trim() && cashierDisplayName.trim().toLowerCase() !== cashierUsername.toLowerCase())
            ? `${cashierDisplayName.trim()} / @${cashierUsername}`
            : (cashierUsername ? `@${cashierUsername}` :'');

        const items = tx.items || [];
        const itemLines = items.map(i => {
            const itemDiscount = Math.max(0, parseFloat(i.itemDiscount) || 0);
            const lineTotal = ((parseFloat(i.price) || 0) * (parseInt(i.quantity) || 0)) - itemDiscount;
            return `  ${i.name} x${i.quantity} .......... ₱${lineTotal.toFixed(2)}`;
        }).join('\n');

        const isSplitPayment = tx.payments && Array.isArray(tx.payments) && tx.payments.length > 1;
        const paymentLine = isSplitPayment
            ? tx.payments.map(p => `${p.method} ₱${parseFloat(p.amount).toFixed(2)}`).join(' + ')
            : (tx.method || tx.payment_method ||'CASH');

        const discountAmount = Math.max(0, parseFloat(tx.discount) || 0);
        const taxAmount = Math.max(0, parseFloat(tx.taxAmount) || 0);
        const grandTotal = parseFloat(tx.total || 0) || 0;
        const changeAmount = Math.max(0, parseFloat(tx.change) || 0);

        const textBody = `${storeName}\n${settings.storeAddress ||''}\n\nReceipt: ${tx.id}\nDate: ${tx.timestamp ||''}\nCashier: ${cashierLabel}\n\n${itemLines}\n\n${discountAmount > 0 ? `Discount: -₱${discountAmount.toFixed(2)}\n` : ''}${taxAmount > 0 ? `Tax: ₱${taxAmount.toFixed(2)}\n` : ''}TOTAL: ₱${grandTotal.toFixed(2)}\nPayment (${paymentLine})\n\n${settings.footerText ||'Thank you for shopping!'}`;

        const grossSubtotal = items.reduce((sum, i) => sum + ((parseFloat(i.price) || 0) * (parseInt(i.quantity) || 0)), 0);
        const itemsHtml = items.map(i => {
            const itemDiscount = Math.max(0, parseFloat(i.itemDiscount) || 0);
            const lineTotal = ((parseFloat(i.price) || 0) * (parseInt(i.quantity) || 0)) - itemDiscount;
            return `<tr>
                <td style="padding:7px 0;border-top:1px solid #f1f5f9;color:#0f172a;">${escapeHtml(i.name)}${itemDiscount > 0 ? `<div style="font-size:11px;color:#059669;">-₱${itemDiscount.toFixed(2)} discount</div>` : ''}</td>
                <td align="center" style="padding:7px 0;border-top:1px solid #f1f5f9;color:#64748b;">${escapeHtml(i.quantity)}</td>
                <td align="right" style="padding:7px 0;border-top:1px solid #f1f5f9;color:#0f172a;font-weight:600;">₱${lineTotal.toFixed(2)}</td>
            </tr>`;
        }).join('');

        let totalsRows = `<tr><td style="padding:2px 0;">Subtotal</td><td align="right" style="padding:2px 0;">₱${grossSubtotal.toFixed(2)}</td></tr>`;
        if (discountAmount > 0) {
            totalsRows += `<tr><td style="padding:2px 0;color:#059669;">Discount${tx.discountAuthorizedBy ? ` (${escapeHtml(tx.discountAuthorizedBy)})` : ''}</td><td align="right" style="padding:2px 0;color:#059669;">-₱${discountAmount.toFixed(2)}</td></tr>`;
        }
        if (taxAmount > 0) {
            totalsRows += `<tr><td style="padding:2px 0;">Tax${tx.taxRate ? ` (${tx.taxRate}%)` : ''}</td><td align="right" style="padding:2px 0;">₱${taxAmount.toFixed(2)}</td></tr>`;
        }
        totalsRows += `<tr><td style="padding-top:10px;font-size:17px;font-weight:800;color:#0f172a;">TOTAL</td><td align="right" style="padding-top:10px;font-size:17px;font-weight:800;color:${(settings.advancedSettings && settings.advancedSettings.accentColor) || '#4f46e5'};">₱${grandTotal.toFixed(2)}</td></tr>`;

        const paymentRows = isSplitPayment
            ? tx.payments.map(p => `${escapeHtml(p.method)} ₱${parseFloat(p.amount).toFixed(2)}`).join(' + ')
            : escapeHtml(paymentLine);

        const attachments = [];

        const bset = settings.barcodeSettings || {};
        const hasBarcode = bset.show !== false && !!tx.id;
        if (hasBarcode) {
            try {
                const barcodeBuffer = await generateReceiptBarcodePng(tx.id, bset);
                attachments.push({
                    filename: 'barcode.png',
                    content: barcodeBuffer.toString('base64'),
                    encoding: 'base64',
                    contentType: 'image/png',
                    cid: 'receiptBarcode'
                });
            } catch (bcErr) {
                console.warn('Hindi na-generate ang barcode para sa e-receipt:', bcErr.message);
            }
        }

        // Loyalty QR: available lang KAAGAD pagkatapos ng bagong benta (ang
        // client ang nagpapasa ng token, tulad ng ginagawa nito para sa
        // naka-print na resibo — tingnan ang currentReceiptLoyaltyQr sa
        // public/app.js) dahil sinasadyang hindi na-pe-persist ang loyalty
        // card token sa transaction record pagkatapos ng benta (security —
        // rotating token). Kaya kapag muling ipinadala/reprint galing sa
        // history, wala nang QR na maipapakita dito — kagaya rin ng
        // pag-uugali ng naka-print na resibo sa parehong sitwasyon.
        const lqSettings = settings.loyaltyQrSettings || {};
        let loyaltyQr = null;
        if (lqSettings.enabled !== false && loyaltyQrInput && loyaltyQrInput.token) {
            try {
                const sizePx = Math.max(80, Math.min(300, lqSettings.sizePx || 160));
                const qrBuffer = await generateReceiptQrPng(loyaltyQrInput.token, sizePx, lqSettings.correctLevel);
                attachments.push({
                    filename: 'loyalty-qr.png',
                    content: qrBuffer.toString('base64'),
                    encoding: 'base64',
                    contentType: 'image/png',
                    cid: 'loyaltyQr'
                });
                loyaltyQr = {
                    sizePx,
                    note: (lqSettings.showNote !== false)
                        ? ((lqSettings.noteText && lqSettings.noteText.trim()) || loyaltyQrInput.note || 'Loyalty QR (for next visit)')
                        : ''
                };
            } catch (qrErr) {
                console.warn('Hindi na-generate ang loyalty QR para sa e-receipt:', qrErr.message);
            }
        }

        const htmlBody = buildReceiptEmailHtml({
            settings, tx, storeName, cashierLabel, paymentRows, itemsHtml, totalsRows,
            hasBarcode: hasBarcode && attachments.some(a => a.cid === 'receiptBarcode'),
            loyaltyQr, changeAmount
        });

        const mailOptions = {
            from: `"${storeName}" <${mailCreds.user}>`,
            to: toEmail,
            subject: `Receipt ${tx.id} - ${storeName}`,
            text: textBody,
            html: htmlBody
        };

        if (typeof receiptImage ==='string' && receiptImage.startsWith('data:image/')) {
            try {
                const match = receiptImage.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
                if (match) {
                    const ext = match[1] ==='jpg' ?'jpeg' : match[1];
                    const base64Data = match[2];

                    if (base64Data.length < 2_800_000) {
                        attachments.push({
                            filename: `receipt-${tx.id}.${ext ==='jpeg' ?'jpg' :'png'}`,
                            content: base64Data,
                            encoding:'base64'
                        });
                    }
                }
            } catch (imgErr) {
                console.warn('Hindi na-attach ang receipt image:', imgErr.message);
            }
        }

        if (attachments.length > 0) mailOptions.attachments = attachments;

        await sendMailSmart(mailCreds.user, mailCreds.pass, mailOptions);

        logAction(req.authUser ? req.authUser.username :'Unknown', `Naipadala ang resibo ${tx.id} sa email (${maskEmail(toEmail)})`);
        res.json({ success: true, message:'Naipadala ang resibo.' });
    } catch (err) {
        console.error('Email receipt failed:', err.message);
        res.status(500).json({ success: false, message: `Hindi naipadala ang resibo: ${err.message}` });
    }
});

app.get('/api/logs', requirePermission('logs'), (req, res) => {
    try {
        const logs = readData(FILE_USERLOGS, []);
        res.json({ success: true, data: logs });
    } catch (error) {
        console.error("Error reading logs:", error);
        res.status(500).json({ success: false, message:'Hindi makuha ang system logs.' });
    }
});

app.get('/api/users', requirePermission('users'), (req, res) => {
    const users = readData(FILE_USERS);

    const safeUsers = users.map(({ password, webauthnCredentials, ...rest }) => rest);
    res.json(safeUsers);
});

app.get('/api/users/self', (req, res) => {
    const users = readData(FILE_USERS);
    const me = users.find(u => u.username.toLowerCase() === req.authUser.username.toLowerCase());
    if (!me) return res.status(404).json({ success: false, message:'Account not found.' });
    res.json({ success: true, username: me.username, displayName: me.displayName || null, role: me.role, avatar: me.avatar || null, created: me.created || null });
});

function applyProfileChanges(currentUsername, { avatar, username: newUsernameRaw, displayName: displayNameRaw }) {
    let users = readData(FILE_USERS);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === currentUsername.toLowerCase());
    if (userIndex === -1) {
        return { ok: false, error:'Account not found.' };
    }

    const newUsername = typeof newUsernameRaw ==='string' ? newUsernameRaw.trim() :'';
    const isRenaming = newUsername && newUsername.toLowerCase() !== currentUsername.toLowerCase();

    if (isRenaming) {
        if (!/^[a-zA-Z0-9_.\-]{3,32}$/.test(newUsername)) {
            return { ok: false, error:'Invalid na username. 3-32 characters lang, walang space (pwede lang letra, numero, "_", "." at "-").' };
        }
        const taken = users.some((u, i) => i !== userIndex && u.username.toLowerCase() === newUsername.toLowerCase());
        if (taken) {
            return { ok: false, error:'Kinuha na ng ibang account ang username na iyan.' };
        }
    }

    let displayNameError = null;
    if (typeof displayNameRaw !=='undefined') {
        const trimmedDisplayName = typeof displayNameRaw ==='string' ? displayNameRaw.trim() :'';
        if (trimmedDisplayName && trimmedDisplayName.length > 60) {
            displayNameError ='Masyadong mahaba ang Display Name (60 characters max).';
        } else {
            users[userIndex].displayName = trimmedDisplayName || null;
        }
    }
    if (displayNameError) {
        return { ok: false, error: displayNameError };
    }

    if (typeof avatar !=='undefined') {
        users[userIndex].avatar = avatar || null;
    }
    const finalUsername = isRenaming ? newUsername : users[userIndex].username;
    if (isRenaming) {
        users[userIndex].username = finalUsername;
    }
    writeData(FILE_USERS, users);

    if (isRenaming) {
        renameUsernameEverywhere(currentUsername, finalUsername);
    }

    return { ok: true, user: users[userIndex], renamedFrom: isRenaming ? currentUsername : null };
}

app.put('/api/users/self/profile', rateLimit('self-edit-profile', 15, 10 * 60 * 1000), (req, res) => {
    const { avatar, username: newUsername, displayName } = req.body;
    const actingUsername = req.authUser.username;
    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).edit_user_profile;

    if (typeof displayName !=='undefined' && !avatar && !newUsername) {
        const result = applyProfileChanges(actingUsername, { displayName });
        if (!result.ok) {
            return res.status(400).json({ success: false, message: result.error });
        }
        logAction(actingUsername, `Updated own display name`);
        return res.json({
            success: true,
            pending: false,
            message:'Na-update na ang display name mo.',
            username: result.user.username,
            displayName: result.user.displayName || null,
            avatar: result.user.avatar || null,
            usernameChanged: false
        });
    }

    if (canApplyDirectly) {
        const result = applyProfileChanges(actingUsername, { avatar, username: newUsername, displayName });
        if (!result.ok) {
            return res.status(400).json({ success: false, message: result.error });
        }
        if (result.renamedFrom) {
            logAction(result.user.username, `Changed own username from "${result.renamedFrom}" to "${result.user.username}"`);
        } else {
            logAction(actingUsername, `Updated own profile (Edit Profile widget)`);
        }
        return res.json({
            success: true,
            pending: false,
            message:'Na-update na ang profile mo.',
            username: result.user.username,
            displayName: result.user.displayName || null,
            avatar: result.user.avatar || null,
            usernameChanged: !!result.renamedFrom
        });
    }

    if (typeof displayName !=='undefined') {
        const dnResult = applyProfileChanges(actingUsername, { displayName });
        if (!dnResult.ok) {
            return res.status(400).json({ success: false, message: dnResult.error });
        }
        logAction(actingUsername, `Updated own display name`);
    }

    const trimmedNewUsername = typeof newUsername ==='string' ? newUsername.trim() :'';
    if (trimmedNewUsername && trimmedNewUsername.toLowerCase() !== actingUsername.toLowerCase()) {
        if (!/^[a-zA-Z0-9_.\-]{3,32}$/.test(trimmedNewUsername)) {
            return res.status(400).json({ success: false, message:'Invalid na username. 3-32 characters lang, walang space (pwede lang letra, numero, "_", "." at "-").' });
        }
        const users = readData(FILE_USERS);
        const taken = users.some(u => u.username.toLowerCase() === trimmedNewUsername.toLowerCase());
        if (taken) {
            return res.status(400).json({ success: false, message:'Kinuha na ng ibang account ang username na iyan.' });
        }
    }

    let requests = readData(FILE_REQUESTS);
    requests.push({
        id: Date.now(),
        type:'PROFILE_UPDATE',
        targetUser: actingUsername,
        requester: actingUsername,
        data: { avatar: typeof avatar ==='undefined' ? undefined : (avatar || null), username: trimmedNewUsername || undefined },
        timestamp: new Date().toLocaleString()
    });
    writeData(FILE_REQUESTS, requests);
    logAction(actingUsername, `Submitted an Edit Profile request for Admin approval`);
    res.json({
        success: true,
        pending: true,
        message: typeof displayName !=='undefined'
            ?'Na-update na ang display name mo. Naisumite rin ang iyong Edit Profile (Username/Avatar) request para sa Admin approval.'
            :'Naisumite ang iyong Edit Profile request. Hihintayin ang pag-approve ng Admin.'
    });
});

app.put('/api/users/:targetUser/avatar', rateLimit('admin-set-avatar', 20, 10 * 60 * 1000), verifyAdmin, (req, res) => {
    const { targetUser } = req.params;
    const { avatar, username } = req.body;

    let users = readData(FILE_USERS);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === targetUser.toLowerCase());
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message:'User account not found.' });
    }

    users[userIndex].avatar = avatar || null;
    writeData(FILE_USERS, users);
    logAction(username, `Updated profile picture for account: ${targetUser}`);
    res.json({ success: true, message: `Profile picture for ${targetUser} has been updated.`, avatar: users[userIndex].avatar });
});

app.put('/api/users/:targetUser', rateLimit('admin-edit-user', 15, 10 * 60 * 1000), verifyAdmin, (req, res) => {
    const { targetUser } = req.params;
    const { username: actingUsername, newUsername: newUsernameRaw, displayName, role, avatar } = req.body;

    let users = readData(FILE_USERS);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === targetUser.toLowerCase());
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message:'User account not found.' });
    }

    const currentUsername = users[userIndex].username;
    const newUsername = typeof newUsernameRaw ==='string' ? newUsernameRaw.trim() :'';
    const isRenaming = newUsername && newUsername.toLowerCase() !== currentUsername.toLowerCase();

    if (isRenaming) {
        if (!/^[a-zA-Z0-9_.\-]{3,32}$/.test(newUsername)) {
            return res.status(400).json({ success: false, message:'Invalid na username. 3-32 characters lang, walang space (pwede lang letra, numero, "_", "." at "-").' });
        }
        const taken = users.some((u, i) => i !== userIndex && u.username.toLowerCase() === newUsername.toLowerCase());
        if (taken) {
            return res.status(400).json({ success: false, message:'Kinuha na ng ibang account ang username na iyan.' });
        }
    }

    if (typeof role !=='undefined' && role) {
        const roles = getRoles();
        const roleExists = roles.some(r => r.name === role);
        if (!roleExists) {
            return res.status(400).json({ success: false, message: `Ang role na "${role}" ay wala sa listahan ng Roles & Permissions. Gumawa muna nito doon (Users > Roles & Permissions) bago ito i-assign.` });
        }

        const currentRole = (users[userIndex].role ||'').toLowerCase();
        if (currentRole ==='admin' && role.toLowerCase() !=='admin') {
            const otherAdmins = users.filter((u, i) => i !== userIndex && (u.role ||'').toLowerCase() ==='admin').length;
            if (otherAdmins === 0) {
                return res.status(400).json({ success: false, message:'Hindi maaaring alisin ang huling Admin account sa sistema. Gumawa muna ng ibang Admin account bago ito baguhin.' });
            }
        }
        users[userIndex].role = role;
    }

    if (typeof displayName !=='undefined') {
        const trimmedDisplayName = typeof displayName ==='string' ? displayName.trim() :'';
        if (trimmedDisplayName && trimmedDisplayName.length > 60) {
            return res.status(400).json({ success: false, message:'Masyadong mahaba ang Display Name (60 characters max).' });
        }
        users[userIndex].displayName = trimmedDisplayName || null;
    }

    if (typeof avatar !=='undefined') {
        users[userIndex].avatar = avatar || null;
    }

    const finalUsername = isRenaming ? newUsername : currentUsername;
    if (isRenaming) {
        users[userIndex].username = finalUsername;
    }

    writeData(FILE_USERS, users);

    if (isRenaming) {
        renameUsernameEverywhere(currentUsername, finalUsername);
    }

    logAction(actingUsername, `Edited user account "${currentUsername}"` + (isRenaming ? ` — renamed to "${finalUsername}"` : '') + (role ? ` — role set to "${role}"` : ''));

    res.json({
        success: true,
        message:'Na-update na ang user account.',
        user: {
            username: users[userIndex].username,
            displayName: users[userIndex].displayName || null,
            role: users[userIndex].role,
            avatar: users[userIndex].avatar || null
        }
    });
});

app.post('/api/users/self/change-password', rateLimit('self-change-pw', 8, 10 * 60 * 1000), (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message:'Kailangan ang kasalukuyan at bagong password.' });
    }
    if (String(newPassword).length < 4) {
        return res.status(400).json({ success: false, message:'Masyadong maikli ang bagong password.' });
    }

    let users = readData(FILE_USERS);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === req.authUser.username.toLowerCase());
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message:'Account not found.' });
    }

    const me = users[userIndex];
    let isMatch = false;
    try {
        isMatch = bcrypt.compareSync(currentPassword, me.password);
    } catch (e) {
        isMatch = (currentPassword === me.password);
    }
    if (!isMatch) {
        return res.status(403).json({ success: false, code:'WRONG_CURRENT_PASSWORD', message:'Mali ang kasalukuyang password.' });
    }

    users[userIndex].password = bcrypt.hashSync(newPassword, 10);
    const meUsername = users[userIndex].username;
    const writeOk = writeData(FILE_USERS, users);

    const verifyUsers = readData(FILE_USERS) || [];
    const verifyUser = verifyUsers.find(u => u.username === meUsername);
    const verified = writeOk && verifyUser && (() => {
        try { return bcrypt.compareSync(newPassword, verifyUser.password); }
        catch (e) { return false; }
    })();
    if (!verified) {
        console.error(`⚠️ Nabigo ang pag-save ng bagong password para sa "${meUsername}" (self-service change-password).`);
        return res.status(500).json({ success: false, message: 'Nabigo ang pag-save ng bagong password sa lokal na database. Hindi nagbago ang password mo — subukan ulit.' });
    }

    logAction(meUsername, `Changed own account password`);
    res.json({ success: true, message:'Na-update na ang password mo.' });
});

app.post('/api/users', rateLimit('admin-add-user', 8, 10 * 60 * 1000), verifyAdmin, (req, res) => {
    const { user, username } = req.body;

    let users = readData(FILE_USERS);
    if (users.some(u => u.username.toLowerCase() === user.username.toLowerCase())) {
        return res.status(400).json({ success: false, message:'Username is already taken.' });
    }

    user.password = bcrypt.hashSync(user.password, 10);
    user.created = new Date().toISOString().replace('T',' ').substring(0, 19);
    users.push(user);
    writeData(FILE_USERS, users);
    logAction(username, `Created new POS account: ${user.username}`);
    res.json({ success: true, message:'User created successfully.' });
});

app.put('/api/users/:targetUser/reset-password', rateLimit('admin-reset-pw', 8, 10 * 60 * 1000), verifyAdmin, (req, res) => {
    const { targetUser } = req.params;
    const { newPassword, username } = req.body;

    let users = readData(FILE_USERS);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === targetUser.toLowerCase());

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message:'User account not found.' });
    }

    users[userIndex].password = bcrypt.hashSync(newPassword, 10);
    writeData(FILE_USERS, users);

    logAction(username, `Force reset password for account: ${targetUser}`);
    res.json({ success: true, message: `Password for ${targetUser} has been updated successfully.` });
});

app.post('/api/users/delete-account', rateLimit('admin-delete-user', 8, 10 * 60 * 1000), verifyAdmin, (req, res) => {
    const { targetUser, username } = req.body;

    if (!targetUser) {
        return res.status(400).json({ success: false, message:'Kulang ang target user na buburahin.' });
    }

    if (targetUser.toLowerCase() === username.toLowerCase()) {
        return res.status(400).json({ success: false, message:'Bawal mong burahin ang sarili mong account habang naka-login!' });
    }

    let users = readData(FILE_USERS);
    const filteredUsers = users.filter(u => u.username.toLowerCase() !== targetUser.toLowerCase());

    if (users.length === filteredUsers.length) {
        return res.status(404).json({ success: false, message:'Account to delete not found.' });
    }

    writeData(FILE_USERS, filteredUsers);

    for (const [token, session] of SESSIONS.entries()) {
        if (session.username.toLowerCase() === targetUser.toLowerCase()) {
            SESSIONS.delete(token);
        }
    }
    persistSessions();

    logAction(username, `Deleted user account: ${targetUser}`);
    res.json({ success: true, message: `Account ${targetUser} has been completely removed.` });
});

function logAction(username, action) {
    let logs = readData(FILE_USERLOGS);
    logs.unshift({
        id: Date.now(),
        username: username,
        action: action,
        timestamp: new Date().toLocaleString('en-US', { timeZone:'Asia/Manila' })
    });
    writeData(FILE_USERLOGS, logs);
}

function logVoidAction(username, transactionId, voidedAmount, authMethodLabel) {
    let logs = readData(FILE_USERLOGS);
    logs.unshift({
        id: Date.now(),
        username: username,
        action: `VOIDED Transaction ID: ${transactionId} (${authMethodLabel})`,
        timestamp: new Date().toLocaleString('en-US', { timeZone:'Asia/Manila' }),
        voidedAmount: Math.round((parseFloat(voidedAmount) || 0) * 100) / 100,
        voidedTransactionId: transactionId
    });
    writeData(FILE_USERLOGS, logs);
}

function logRefundAction(username, transactionId, refundAmount, itemsLabel, reason, authMethodLabel) {
    let logs = readData(FILE_USERLOGS);
    logs.unshift({
        id: Date.now(),
        username: username,
        action: `REFUNDED ₱${refundAmount.toFixed(2)} sa Transaction ID: ${transactionId} — Items: ${itemsLabel}. Dahilan: ${reason || '(walang isinulat)'} (${authMethodLabel})`,
        timestamp: new Date().toLocaleString('en-US', { timeZone:'Asia/Manila' }),
        refundedAmount: Math.round((parseFloat(refundAmount) || 0) * 100) / 100,
        refundedTransactionId: transactionId
    });
    writeData(FILE_USERLOGS, logs);
}

app.get('/api/system/backup-status', (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Admin privileges lamang ang makakakita ng backup status.' });
    }
    const status = getBackupStatus();
    res.json({ success: true, status });
});

app.get('/api/system/update-check', rateLimit('system-update-check', 10, 10 * 60 * 1000), async (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Admin privileges lamang ang makakagamit ng Check for Updates.' });
    }
    if (!RELAY_API_KEY) {
        return res.status(400).json({ success: false, message:'Walang RELAY_API_KEY na naka-configure sa server na ito.' });
    }
    if (getConnectivityMode() === 'offline') {
        return res.status(400).json({ success: false, message: 'Naka-OFFLINE mode ka ngayon. I-switch muna sa Online para makapag-check ng updates.' });
    }
    try {

        const installationId = getOrCreateInstallationId(readFeatureUnlocks());
        const relayRes = await relayFetch(`${RELAY_URL}/relay/latest-version?installationId=${encodeURIComponent(installationId)}`, {
            headers: {'x-relay-key': RELAY_API_KEY }
        });
        const relayData = await parseRelayResponse(relayRes);
        if (!relayData.success) {
            return res.status(502).json({ success: false, message: relayData.message ||'Tinanggihan ng RELAY ang version check.' });
        }
        const publishedVersion = String(relayData.latestVersion || UNPUBLISHED_VERSION_SENTINEL).trim();

        const updateAvailable = publishedVersion !== UNPUBLISHED_VERSION_SENTINEL
            && isVersionNewer(publishedVersion, APP_VERSION);
        res.json({
            success: true,
            currentVersion: APP_VERSION,
            latestVersion: publishedVersion,
            changelog: relayData.changelog ||'',
            updateAvailable
        });
    } catch (err) {
        res.status(502).json({ success: false, message: `Hindi ma-check ang RELAY para sa bagong version: ${err.message}` });
    }
});

// GET /api/system/deploy-update/stats
// Ibinibigay ang "natutunang" tinatayang tagal (ETA) ng deploy, batay sa
// exponential moving average ng mga nakaraang TUNAY na deploy duration
// (naka-imbak sa FILE_DEPLOY_STATS) — tinitingnan ito ng frontend bago
// magsimula para agad may makatuwirang paunang ETA sa halip na basta
// walang-batayang hula.
app.get('/api/system/deploy-update/stats', rateLimit('system-deploy-update-stats', 60, 10 * 60 * 1000), (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Admin privileges lamang.' });
    }
    const stats = readDeployStats();
    res.json({ success: true, renderAvgMs: stats.renderAvgMs, selfUpdateAvgMs: stats.selfUpdateAvgMs, samples: stats.samples, usingRenderHook: !!RENDER_DEPLOY_HOOK_URL });
});

// POST /api/system/deploy-update/record
// Tinatawag ng frontend PAGKATAPOS ma-verify (sa update-check) na LIVE
// na talaga ang bagong version — ipinapasa nito ang tunay na
// natapos-nang-tagal (durationMs) para ma-update ang "natutunang"
// average sa itaas. Ligtas itong tawagan kahit anong server instance
// pa ang sumagot (bagong-deploy man o hindi) — nagre-record lang ito
// ng isang stat, hindi umaasa sa anumang naunang in-memory state.
app.post('/api/system/deploy-update/record', rateLimit('system-deploy-update-record', 20, 10 * 60 * 1000), (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Admin privileges lamang.' });
    }
    const kind = req.body?.kind === 'self' ? 'self' : 'render';
    const durationMs = parseInt(req.body?.durationMs, 10);
    if (Number.isFinite(durationMs) && durationMs > 0 && durationMs < 60 * 60 * 1000) {
        recordDeployDuration(kind, durationMs);
    }
    res.json({ success: true });
});

// GET /api/system/deploy-update/progress/:jobId
// Live progress ng self-update job (download/extract/apply/restart) —
// pina-poll ng frontend bawat ~900ms. Wala nang laman ito (404) kapag
// naka-restart na ang process (normal ito — nangangahulugan lang na
// nakarating na sa "restart" step; dumadako na ang frontend sa
// version-verification phase sa ganitong pagkakataon).
app.get('/api/system/deploy-update/progress/:jobId', rateLimit('system-deploy-update-progress', 1800, 60 * 60 * 1000), (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Admin privileges lamang.' });
    }
    const job = deployJobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ success: false, message:'Deploy job not found or already expired.' });
    }
    res.json({
        success: true,
        status: job.status,
        percent: job.percent,
        message: job.message,
        steps: job.steps,
        elapsedMs: Date.now() - job.startedAt,
        downloadedBytes: job.downloadedBytes,
        totalBytes: job.totalBytes,
        logs: job.logs.slice(-15),
        error: job.error
    });
});

app.post('/api/system/deploy-update', rateLimit('system-deploy-update', 3, 30 * 60 * 1000), async (req, res) => {
    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Admin privileges lamang ang makakapag-trigger ng deploy.' });
    }

    if (RENDER_DEPLOY_HOOK_URL) {
        try {
            const hookRes = await fetch(RENDER_DEPLOY_HOOK_URL, { method:'POST' });
            if (!hookRes.ok) {
                return res.status(502).json({ success: false, message: `Tinanggihan ng Render ang deploy hook (HTTP ${hookRes.status}).` });
            }
            logAction(req.authUser.username ||'Unknown','Nag-trigger ng System Update Deploy sa Render.');
            const stats = readDeployStats();
            return res.json({
                success: true,
                mode: 'render',
                message:'Na-trigger na ang bagong deploy sa Render. Aabutin ito ng ilang minuto — mag-a-auto-refresh ang system pagkatapos.',
                estimatedMs: stats.renderAvgMs,
                samples: stats.samples.render
            });
        } catch (err) {
            return res.status(502).json({ success: false, message: `Hindi ma-abot ang Render deploy hook: ${err.message}` });
        }
    }

    return runSelfUpdateFromRelay(req, res);
});

const SELF_UPDATE_PRESERVE = new Set([
   '.env','.env.key','database','node_modules','uploads_tmp','.git','release',
   'cf.log','server.log','.start.sh.lock'
]);

// BUG FIX (root cause ng patuloy na "Verify live" stack-up kahit may
// npm-install fix na sa itaas): ang copyRecursivePreservingWithProgress
// sa ibaba ay direktang SUMUSULAT (in-place, walang backup) sa itaas ng
// kasalukuyang gumaganang installRoot bago pa man ma-verify na
// talagang gumagana ang bagong release. Kapag na-interrupt ang kahit
// anong hakbang PAGKATAPOS ma-apply ang mga bagong file — hal. nawalan
// ng internet ang Termux device (alam na natin unstable ito dito,
// tingnan ang mailer.js) habang tumatakbo ang `npm install`, o
// bigla na lang na-kill ng Android ang session (kahit may wake-lock)
// bago pa man ma-verify ang restart — MANANATILI na ang bagong
// (posibleng hindi kumpletong) files sa DISK kahit ang currently-
// running na process ay tumatakbo pa rin gamit ang LUMANG code sa
// memory. Sa susunod na pagkakataon na kailangang mag-restart ang
// process (crash, factory OOM-kill, atbp.) — kahit hindi na dahil sa
// self-update mismo — babangon ito gamit na ang mismatched na bagong
// files kasabay ng lumang/kulang na node_modules, kaya papasok agad sa
// walang-katapusang crash loop ng start.sh supervisor, at mananatiling
// "Verifying the new version is live..." magpakailanman ang "Verify
// live" step dahil hindi na talaga babangon ang server.
// Ayos: bago i-overwrite ang installRoot, gumawa muna ng BACKUP ng
// kasalukuyang (dati pang gumaganang) mga file papunta sa
// SELF_UPDATE_BACKUP_DIR. Kung mabigo ang npm install pagkatapos,
// AGAD itong ibinabalik (restoreInstallFiles) — hindi lang basta
// "hindi ipagpapatuloy ang restart" (ang lumang komento sa ibaba ay
// hindi totoo dati: ang mga file ay na-overwrite na noon pa man).
// Bilang dagdag na proteksyon kung ang bagong version mismo ang may
// bug (hindi nahuli ng npm install), makikita ang backup dir ding ito
// ng start.sh — awtomatiko nitong ibinabalik ang backup kapag na-detect
// ang crash loop, sa halip na paikot-ikot na crash forever.
const SELF_UPDATE_BACKUP_DIR = '.self-update-backup';

function copyRecursivePreserving(srcDir, destDir, preserveNames) {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (preserveNames.has(entry.name)) continue;
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            copyRecursivePreserving(srcPath, destPath, new Set());
        } else {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Kinukuhanan ng snapshot ang installRoot BAGO i-apply ang bagong
// release — parehong bagay lang ang kino-copy dito na kino-copy rin
// papunta sa installRoot pagkatapos (excluded ang SELF_UPDATE_PRESERVE
// — database/node_modules/.env/atbp. — dahil hindi naman ito
// nagbabago/na-o-overwrite ng update, kaya hindi na kailangang i-backup
// pa; excluded din ang backup dir mismo para hindi ito ma-recurse sa
// sarili nito).
function backupInstallFiles(installRoot) {
    const backupDir = path.join(installRoot, SELF_UPDATE_BACKUP_DIR);
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.mkdirSync(backupDir, { recursive: true });
    const excludeForBackup = new Set([...SELF_UPDATE_PRESERVE, SELF_UPDATE_BACKUP_DIR]);
    copyRecursivePreserving(installRoot, backupDir, excludeForBackup);
    return backupDir;
}

// Ibinabalik ang mga naka-backup na file pabalik sa installRoot —
// walang exclusions na kailangan dito dahil ang laman lang ng
// backupDir ay eksakto nang ang mga file na dapat ibalik (parehong
// listahan gamit ang backupInstallFiles sa itaas).
function restoreInstallFiles(installRoot) {
    const backupDir = path.join(installRoot, SELF_UPDATE_BACKUP_DIR);
    if (!fs.existsSync(backupDir)) {
        throw new Error(`Walang backup sa ${backupDir} na maibabalik.`);
    }
    copyRecursivePreserving(backupDir, installRoot, new Set());
}

function scheduleSelfRestart(installRoot) {

    setTimeout(() => process.exit(0), 500);
}

// Ang function na ito ay TUMUTUGON AGAD (may jobId) bago pa man
// magsimula ang aktwal na download/extract/apply — ang mga hakbang na
// iyon ay tumatakbo sa BACKGROUND at inuulat ang TUNAY (hindi
// pasimula) na progreso papunta sa deployJobs (nasa itaas), na siyang
// sinusuri (polled) ng frontend gamit ang
// GET /api/system/deploy-update/progress/:jobId sa itaas.
async function runSelfUpdateFromRelay(req, res) {
    if (!RELAY_API_KEY) {
        return res.status(400).json({ success: false, message:'Walang RELAY_API_KEY na naka-configure — kailangan ito para makakuha ng release package mula sa RELAY.' });
    }
    if (getConnectivityMode() === 'offline') {
        return res.status(400).json({ success: false, message:'Naka-OFFLINE mode ka ngayon. I-switch muna sa Online para makapag-self-update.' });
    }

    const jobId = createSelfUpdateJob();
    const stats = readDeployStats();
    res.json({ success: true, mode: 'self', jobId, estimatedMs: stats.selfUpdateAvgMs, samples: stats.samples.self });

    const installRoot = __dirname;
    const tmpRoot = path.join(os.tmpdir(), `omnipos-selfupdate-${Date.now()}`);
    const zipPath = path.join(tmpRoot,'omnipos-client.zip');
    const extractDir = path.join(tmpRoot,'extracted');

    try {
        fs.mkdirSync(tmpRoot, { recursive: true });

        jobAdvanceStep(jobId,'download','Connecting to Relay for the release package...', 2);
        const relayRes = await relayFetch(`${RELAY_URL}/relay/release-package`, {
            headers: {'x-relay-key': RELAY_API_KEY }
        });
        if (!relayRes.ok) {
            let detail ='';
            try { detail = (await relayRes.json()).message ||''; } catch (_e) {}
            throw new Error(`Tinanggihan ng RELAY ang release package (HTTP ${relayRes.status}). ${detail}`.trim());
        }

        // TUNAY na download progress — binabasa ang response body nang
        // paunti-unti (stream reader) sa halip na .arrayBuffer() lang
        // na "isang bagsakan" na walang paraang malaman ang progreso
        // hanggang matapos ito.
        const job = deployJobs.get(jobId);
        const totalBytes = parseInt(relayRes.headers.get('content-length') || '0', 10) || 0;
        if (job) job.totalBytes = totalBytes;

        const chunks = [];
        let downloadedBytes = 0;
        if (relayRes.body && typeof relayRes.body.getReader === 'function') {
            const reader = relayRes.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.length) {
                    chunks.push(value);
                    downloadedBytes += value.length;
                    if (job) job.downloadedBytes = downloadedBytes;
                    const pct = totalBytes > 0
                        ? 2 + Math.round((downloadedBytes / totalBytes) * 33)
                        : Math.min(35, 2 + Math.round(downloadedBytes / 5000));
                    const mbDone = (downloadedBytes / 1024 / 1024).toFixed(1);
                    const mbTotal = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(1) : null;
                    jobSetPercent(jobId, pct, mbTotal
                        ? `Downloading update... (${mbDone}/${mbTotal} MB)`
                        : `Downloading update... (${mbDone} MB so far)`);
                }
            }
        } else {
            // Fallback kung walang streaming body na available (mas
            // lumang runtime) — hindi na tunay na paunti-unting
            // progreso, pero gumagana pa rin.
            const buf = Buffer.from(await relayRes.arrayBuffer());
            chunks.push(buf);
            downloadedBytes = buf.length;
            if (job) job.downloadedBytes = downloadedBytes;
        }

        const fullBuffer = Buffer.concat(chunks.map(c => (Buffer.isBuffer(c) ? c : Buffer.from(c))));
        fs.writeFileSync(zipPath, fullBuffer);

        jobAdvanceStep(jobId,'extract','Extracting the update package...', 40);
        fs.mkdirSync(extractDir, { recursive: true });
        try {
            execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio:'pipe' });
        } catch (unzipErr) {
            throw new Error(`Hindi ma-extract ang release package. Siguraduhing naka-install ang "unzip" sa Termux ("pkg install unzip -y"). Detalye: ${unzipErr.message}`);
        }

        // BUG FIX: bago i-overwrite ang installRoot, i-backup muna ang
        // kasalukuyang (dati pang gumaganang) mga file — tingnan ang
        // malaking komento sa itaas ng SELF_UPDATE_BACKUP_DIR kung bakit
        // ito ang totoong root cause ng patuloy na pag-stack sa
        // "Verify live" kahit may npm-install fix na.
        jobAdvanceStep(jobId,'apply','Backing up the current version before applying update...', 55);
        try {
            backupInstallFiles(installRoot);
        } catch (backupErr) {
            throw new Error(`Hindi magawa ang backup ng kasalukuyang bersyon bago mag-apply ng update — kinansela ang update para sa kaligtasan (walang nabago sa disk). Detalye: ${backupErr.message}`);
        }

        jobAdvanceStep(jobId,'apply','Applying updated files...', 60);
        const copyStats = { copied: 0, total: countFilesRecursive(extractDir, SELF_UPDATE_PRESERVE) };
        copyRecursivePreservingWithProgress(extractDir, installRoot, SELF_UPDATE_PRESERVE, copyStats, jobId);

        // BUG FIX (self-update gets stuck forever on "Verify live" —
        // dating "root cause"): SELF_UPDATE_PRESERVE ay pinapanatili ang
        // lumang node_modules/ (hindi ito pinapalitan ng bagong
        // release), pero dati ay wala kahit isang `npm install` na
        // tumatakbo pagkatapos i-apply ang bagong files. Kapag may
        // bago/na-update na npm dependency ang release na ito (o
        // pinalitan ang package.json), agad na-crash ang bagong
        // server.js sa startup ("Cannot find module ..."), kaya papasok
        // sa crash-loop backoff ng start.sh supervisor sa halip na
        // bumangon ang bagong version.
        // Ayos: i-run muna dito ang `npm install --omit=dev` sa loob ng
        // installRoot (parehong direktoryo kung saan naka-preserve ang
        // node_modules) BAGO i-restart — kaya kasabay laging sync ang
        // node_modules sa bagong package.json/package-lock.json.
        jobAdvanceStep(jobId,'apply','Installing updated dependencies (npm install)...', 80);
        try {
            execSync('npm install --omit=dev', { cwd: installRoot, stdio: 'pipe' });
        } catch (npmErr) {
            // BUG FIX: hindi totoo ang lumang claim dito na "mananatili
            // sa lumang gumaganang bersyon" — sa oras na ito, na-
            // overwrite na sa DISK ang bagong (posibleng kulang sa
            // dependency) na files habang kasalukuyang tumatakbo pa rin
            // sa MEMORY ang lumang code. Kung sakaling ma-restart ang
            // process (crash, Android OOM-kill) BAGO pa maayos ang
            // isyu, babangon ito gamit ang mismatched na bagong files +
            // lumang node_modules — walang katapusang crash loop.
            // Kaya dito mismo, AGAD ibalik ang naka-backup na dating
            // bersyon sa DISK (hindi lang sa memory) bago pa mag-throw.
            try {
                restoreInstallFiles(installRoot);
            } catch (restoreErr) {
                throw new Error(`Nabigo ang "npm install" AT nabigo ring ibalik ang backup ng dating bersyon — manu-mano nang kailangang ayusin ang ${installRoot}. npm error: ${npmErr.message}. Restore error: ${restoreErr.message}`);
            }
            throw new Error(`Nabigo ang "npm install" pagkatapos ma-apply ang update — naibalik na sa dating gumaganang bersyon (sa DISK, hindi lang sa memory). Detalye: ${npmErr.message}`);
        }

        logAction(req.authUser.username ||'Unknown','Nag-self-update ng OMNIPOS mula sa RELAY release package (Termux/non-Render mode).');

        jobAdvanceStep(jobId,'restart','Restarting the system — this page will refresh automatically...', 95);
        jobFinish(jobId,'Update applied. Restarting now — this page will refresh automatically in a few seconds.');

        scheduleSelfRestart(installRoot);
    } catch (err) {
        console.error('❌ Self-update error:', err.message);
        jobFail(jobId, err.message || 'Hindi na-apply ang self-update.');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
}

const resetJobs = new Map();

function createResetJob() {
    const jobId = crypto.randomUUID();
    resetJobs.set(jobId, {
        status: 'preparing',
        percent: 1,
        message: 'Preparing the backup...'
    });

    setTimeout(() => resetJobs.delete(jobId), 15 * 60 * 1000).unref();
    return jobId;
}

function updateResetJob(jobId, patch) {
    const job = resetJobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch);
}

app.post('/api/system/reset/start', rateLimit('system-reset', 3, 30 * 60 * 1000, (s) => `Too many reset attempts. Please try again in ${s} seconds.`), async (req, res) => {

    if (!req.authUser || req.authUser.role.toLowerCase() !=='admin') {
        return res.status(403).json({ success: false, message:'Action Denied: Only Admin privileges can perform a factory reset.' });
    }

    const { password: adminPasswordForReset } = req.body;
    const usersForReset = readData(FILE_USERS, []);
    const currentAdminForReset = usersForReset.find(u => u.username && u.username.toLowerCase() === req.authUser.username.toLowerCase() && u.role && u.role.toLowerCase() === 'admin');
    if (!currentAdminForReset || !bcrypt.compareSync(adminPasswordForReset || '', currentAdminForReset.password)) {
        return res.status(403).json({ success: false, code: 'WRONG_ADMIN_PASSWORD', message: 'Incorrect Admin password. Hard Factory Reset not authorized.' });
    }

    const { additionalEmail } = req.body;
    const secondaryEmail = (additionalEmail ||'').trim();

    const includeImages = req.body.includeImages !== false;

    const receiptSettingsForReset = readData(FILE_RECEIPT_SETTINGS, DEFAULT_RECEIPT_SETTINGS);
    const otpMailCreds = getOtpMailCredentials(receiptSettingsForReset);

    if (!otpMailCreds) {
        return res.status(400).json({
            success: false,
            message:'No verified Google App yet. Set this up and verify it first under Users > Receipt Customization > Google App Verification before performing a System Hard Reset.'
        });
    }

    const emailPattern =/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!secondaryEmail || !emailPattern.test(secondaryEmail)) {
        return res.status(400).json({
            success: false,
            message:'A valid Secondary Backup Email is required — the backup file will be sent there.'
        });
    }

    const jobId = createResetJob();
    res.json({ success: true, jobId });

    (async () => {
        try {
            updateResetJob(jobId, { status: 'preparing', percent: 5, message: 'Capturing the full database snapshot...' });

            const fullSnapshot = getFullDatabaseSnapshot();

            let modulesForEmail = fullSnapshot.modules;
            let imagesExcludedCount = 0;
            if (!includeImages && Array.isArray(fullSnapshot.modules.products)) {
                modulesForEmail = { ...fullSnapshot.modules };
                modulesForEmail.products = fullSnapshot.modules.products.map((p) => {
                    if (p && p.image) {
                        imagesExcludedCount++;
                        const { image, ...rest } = p;
                        return rest;
                    }
                    return p;
                });
            }

            const backupPayload = {
                timestamp: new Date().toISOString(),
                ...modulesForEmail
            };

            let recipients = [secondaryEmail];

            const petsa_ng_ayon = new Date().toLocaleDateString('en-PH');
            const backupJsonString = JSON.stringify(backupPayload, null, 4);
            const backupSizeBytes = Buffer.byteLength(backupJsonString, 'utf8');
            const backupSizeMb = (backupSizeBytes / 1024 / 1024).toFixed(1);

            const imagesNoteForEmail = !includeImages && imagesExcludedCount > 0
                ? `\n\nNOTE: this attachment excludes ${imagesExcludedCount} product photo(s) (the operator chose to exclude them for a faster send). These images will still be permanently deleted from the local system database as part of this Hard Reset — they are only missing from this email attachment, not preserved anywhere else unless a separate Cloud Backup/local backup was taken beforehand.`
                : '';

            const mailOptions = {
                from: `"OmniPOS Core System" <${otpMailCreds.user}>`,
                to: recipients.join(', '),
                subject: `💻 OmniPOS: Full System Reset & Synchronized Backup - ${petsa_ng_ayon}`,
                text: `Good day,\n\nThe system database has undergone a Hard Factory Reset.\n\nThis email includes the attached 'omnipos_full_backup.json' (${backupSizeMb} MB) containing every synchronized data module (including customers, shift/Z-Reading records, refunds, debts, promo codes, purchase orders, low-stock tracking, loyalty security data, and Fraud & Anomaly Alerts) as they were right before the deletion.${imagesNoteForEmail}`,
                attachments: [
                    {
                        filename: `omnipos_full_backup_${Date.now()}.json`,
                        content: backupJsonString,
                        contentType:'application/json'
                    }
                ]
            };

            updateResetJob(jobId, {
                status: 'sending',
                percent: 10,
                message: `Sending the backup (${backupSizeMb} MB) via email...`
            });

            const ASSUMED_SLOW_THROUGHPUT_BYTES_PER_SEC = 60 * 1024;
            const estimatedSendMs = Math.max(2000, (backupSizeBytes / ASSUMED_SLOW_THROUGHPUT_BYTES_PER_SEC) * 1000);
            const sendStartedAt = Date.now();
            const progressTimer = setInterval(() => {
                const elapsed = Date.now() - sendStartedAt;
                const fraction = Math.min(0.95, elapsed / estimatedSendMs);
                const percent = Math.round(10 + fraction * 80);
                const secondsLeft = Math.max(0, Math.ceil((estimatedSendMs - elapsed) / 1000));
                updateResetJob(jobId, {
                    percent,
                    message: fraction < 0.95
                        ? `Sending the backup... (~${secondsLeft}s remaining, estimate)`
                        : 'Sending the backup... (finishing up)'
                });
            }, 700);

            const dynamicSocketTimeout = Math.max(SMTP_TIMEOUTS.socketTimeout, Math.round(estimatedSendMs * 1.5));
            const dynamicConnectionTimeout = Math.max(SMTP_TIMEOUTS.connectionTimeout, 5000);

            try {
                await sendMailSmart(otpMailCreds.user, otpMailCreds.pass, mailOptions, {
                    socketTimeout: dynamicSocketTimeout,
                    connectionTimeout: dynamicConnectionTimeout,
                    greetingTimeout: Math.max(SMTP_TIMEOUTS.greetingTimeout, 5000)
                });
            } finally {
                clearInterval(progressTimer);
            }

            updateResetJob(jobId, { status: 'resetting', percent: 92, message: 'Resetting the database...' });

            const secureDefaultUsers = defaultUsers.map(u => ({
                ...u,
                password: bcrypt.hashSync(u.password, 10),
                created: getPHTime()
            }));
            writeData(FILE_USERS, secureDefaultUsers);

            SESSIONS.clear();
            persistSessions();

            writeData(FILE_PRODUCTS, []);

            writeData(FILE_TRANSACTIONS, []);
            writeData(FILE_REQUESTS, []);
            writeData(FILE_CARTS, {});

            writeData(FILE_CUSTOMERS, []);
            writeData(FILE_SHIFTS, []);
            writeData(FILE_SHIFT_META, {});

            // BUG FIX: dati ay hindi kasama ang mga sumusunod sa Hard
            // Reset kaya nananatili ang datos nila kahit pagkatapos
            // mag-"factory reset" — kasama na rito ang Fraud & Anomaly
            // Alerts (ang partikular na na-ulat na hindi na-reset), pati
            // na rin ang ibang business/transactional data na naka-ugnay
            // sa mga products/customers/transactions na binubura na.
            writeData(FILE_FRAUD_ALERTS, []);
            fraudVelocityLog.clear();
            writeData(FILE_REFUNDS, []);
            writeData(FILE_DEBTS, []);
            writeData(FILE_PROMOCODES, []);
            writeData(FILE_PURCHASE_ORDERS, []);
            writeData(FILE_LOWSTOCK_TRACKING, {});
            writeData(FILE_LOYALTY_SECURITY, {});

            const initialCategories = ['Beverages','Dairy','Snacks','Bakery','Grains'];
            writeData(FILE_CATEGORIES, initialCategories);

            const preResetIdentity = readFeatureUnlocks();
            writeData(FILE_FEATURE_UNLOCKS, {
                ...DEFAULT_FEATURE_UNLOCKS,
                installationId: preResetIdentity.installationId,
                hardwareFingerprint: preResetIdentity.hardwareFingerprint,
                verifiedFingerprint: preResetIdentity.verifiedFingerprint,
                deviceVerified: preResetIdentity.deviceVerified,
                firstVerifiedAt: preResetIdentity.firstVerifiedAt,
                devicePermit: preResetIdentity.devicePermit,
                relayAuthorized: preResetIdentity.relayAuthorized,
                deviceSeed: preResetIdentity.deviceSeed
            });

            writeData(FILE_USERLOGS, []);

            updateResetJob(jobId, { percent: 96, message: 'Compacting the database file to reclaim disk space...' });
            const vacuumResult = vacuumDatabase();
            if (!vacuumResult.success) {
                console.warn('⚠️  Nabigo ang pag-vacuum matapos ang hard reset (hindi ito pumipigil sa reset — nabura pa rin ang data, malaki lang pa rin ang .db file sa disk):', vacuumResult.message);
            }

            updateResetJob(jobId, { percent: 97, message: 'Checking Relay for previously unlocked features (auto-restore)...' });

            let restoredCount = 0;
            try {
                const restoreResult = await attemptRelayRestore();
                restoredCount = restoreResult.restoredCount || 0;
            } catch (err) {
                console.warn('⚠️  Auto-restore matapos ang hard reset: hindi na-check ang Relay.', err.message);
            }

            updateResetJob(jobId, {
                status: 'done',
                percent: 100,
                message: 'Done!',
                result: {
                    success: true,
                    message: `Backup sent to ${recipients.length} email address(es). System has been reset.` +
                        (restoredCount > 0 ? ` ${restoredCount} previously unlocked feature(s) auto-restored.` : '') +
                        (!includeImages && imagesExcludedCount > 0 ? ` (${imagesExcludedCount} product photo(s) were excluded from the emailed backup for speed and have also been permanently deleted from the local database, same as the rest of the reset data.)` : ''),
                    restoredFeatureCount: restoredCount,
                    imagesExcludedCount: !includeImages ? imagesExcludedCount : 0
                }
            });

        } catch (err) {
            console.error("Mail Reset Failure Context:", err);
            updateResetJob(jobId, {
                status: 'error',
                percent: 0,
                message: err.message,
                result: {
                    success: false,
                    message: `Reset was not completed because email verification failed. Make sure your Gmail and 16-character App Password are CORRECT. Error: ${err.message}`
                }
            });
        }
    })();
});

app.get('/api/system/reset/status/:jobId', rateLimit('system-reset-status', 400, 10 * 60 * 1000, (s) => `Too many status checks. Please try again in ${s} seconds.`), (req, res) => {
    const job = resetJobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ success: false, message: 'Job not found or already expired.' });
    }
    res.json({ success: true, ...job });
});

app.post('/api/restore-backup', rateLimit('restore-backup', 5, 15 * 60 * 1000), (req, res) => {
    const { username, password, backupData } = req.body;

    const currentUsers = readData(FILE_USERS, []);
    if (currentUsers.length === 0) {
        return res.status(400).json({ success: false, message:"Walang mahanap na records ng mga user sa system." });
    }

    const currentAdmin = currentUsers.find(u => u.username.toLowerCase() === username.toLowerCase() && u.role.toLowerCase() ==='admin');

    if (!currentAdmin) {
        return res.status(403).json({ success: false, message:"Aksyon Tinanggihan: Walang pribilehiyong pang-administrator." });
    }

    if (!bcrypt.compareSync(password, currentAdmin.password)) {

        return res.status(403).json({ success: false, code:'WRONG_ADMIN_PASSWORD', message:"Maling Admin password. Hindi pinahintulutan ang pag-restore." });
    }

    if (!backupData || typeof backupData !=='object') {
        return res.status(400).json({ success: false, message:"May depekto o maling format ang ipinadalang backup file." });
    }

    try {

        let restoredCount = 0;
        const restoredModuleNames = [];
        const accountsNeedingPasswordReset = [];

        for (const [moduleName, data] of Object.entries(backupData)) {
            if (moduleName === 'timestamp') continue;
            if (data === undefined || data === null) continue;

            if (moduleName === 'users' && Array.isArray(data)) {
                const { merged, accountsNeedingPasswordReset: needReset } = mergeRestoredUsers(data);
                writeData(moduleName, merged);
                accountsNeedingPasswordReset.push(...needReset);
                restoredCount++;
                restoredModuleNames.push(moduleName);
            } else if (Array.isArray(data) || typeof data === 'object') {
                writeData(moduleName, data);
                restoredCount++;
                restoredModuleNames.push(moduleName);
            }
        }

        logAction(username, `Restored ${restoredCount} modules from backup file.`);
        res.json({
            success: true,
            message: `Successfully restored and fully synchronized ${restoredCount} data module(s) from your backup file!`,
            restoredCount,
            moduleNames: restoredModuleNames,
            accountsNeedingPasswordReset
        });
    } catch (e) {
        res.status(500).json({ success: false, message: `An error occurred while writing the extracted data: ${e.message}` });
    }
});

app.post('/api/transactions/:transactionId/void', rateLimit('void-transaction', 8, 10 * 60 * 1000), async (req, res) => {
    await transactionsMutexRunExclusive(() => processVoidTransaction(req, res));
});

async function processVoidTransaction(req, res) {
    const { transactionId } = req.params;
    const { requester, adminPassword } = req.body;

    if (!adminPassword) {
        return res.status(400).json({ success: false, message:'Kailangan ng password para mag-void.' });
    }

    const users = readData(FILE_USERS);
    const authResult = await findVoidAuthorizer(users, adminPassword);

    if (!authResult) {
        return res.status(403).json({
            success: false,
            code:'WRONG_ADMIN_PASSWORD',
            message:'Maling password. Hindi pinahintulutan ang void.'
        });
    }

    let transactions = readData(FILE_TRANSACTIONS);
    let products = readData(FILE_PRODUCTS);

    const txIndex = transactions.findIndex(t => t.id === transactionId);
    if (txIndex === -1) {
        return res.status(404).json({ success: false, message:'Hindi nahanap ang Transaksyon ID.' });
    }

    const targetTx = transactions[txIndex];
    const voidedAmount = parseFloat(targetTx.total) || 0;

    const alreadyRefundedForVoid = Math.round((parseFloat(targetTx.totalRefunded) || 0) * 100) / 100;
    if (alreadyRefundedForVoid > 0) {
        return res.status(400).json({
            success: false,
            code: 'ALREADY_REFUNDED',
            message: `Hindi na puwedeng i-void ang transaksyong ito dahil may naitalang refund na (₱${alreadyRefundedForVoid.toFixed(2)}). Gamitin na lang ang Refund para sa natitirang balanse.`
        });
    }

    // ---- Linked C-Credit debt: a void cancels the sale entirely, so any
    // Debtors-ledger record created from this transaction must be cancelled
    // too. If the debtor already paid something against it, block the void
    // instead of silently erasing that payment history. ----
    const debts = readData(FILE_DEBTS, []);
    const linkedDebtIndex = debts.findIndex(d => d.transactionId === transactionId);
    if (linkedDebtIndex !== -1) {
        const linkedDebt = debts[linkedDebtIndex];
        const linkedDebtPaid = parseFloat(linkedDebt.amountPaid) || 0;
        if (linkedDebtPaid > 0) {
            return res.status(400).json({
                success: false,
                code: 'DEBT_HAS_PAYMENT',
                message: `Hindi puwedeng i-void ang transaksyong ito dahil may naitalang bayad na (₱${linkedDebtPaid.toFixed(2)}) sa kaugnay na debt ni ${linkedDebt.customerName}. Ayusin muna ang debt record (Debtors) bago mag-void.`
            });
        }
    }

    targetTx.items.forEach(item => {
        let prod = products.find(p => p.code === item.code || p.name === item.name);
        if (prod) {
            prod.stock = (parseInt(prod.stock) || 0) + parseInt(item.quantity);
        }
    });

    if (linkedDebtIndex !== -1) {
        debts.splice(linkedDebtIndex, 1);
        writeData(FILE_DEBTS, debts);
        logAction(requester, `Naalis ang kaugnay na debt record dahil na-void ang Transaction ID: ${transactionId}`);
    }

    if (targetTx.customerId) {
        const customers = readData(FILE_CUSTOMERS, []);
        const cust = customers.find(c => c.id === targetTx.customerId);
        if (cust) {
            const earned = Math.max(0, parseInt(targetTx.loyaltyPointsEarned) || 0);
            const redeemed = Math.max(0, parseInt(targetTx.loyaltyPointsRedeemed) || 0);

            cust.points = Math.max(0, (cust.points || 0) - earned) + redeemed;
            cust.totalSpent = Math.round((((cust.totalSpent || 0) - voidedAmount)) * 100) / 100;
            if (cust.totalSpent < 0) cust.totalSpent = 0;
            cust.visits = Math.max(0, (cust.visits || 0) - 1);

            writeData(FILE_CUSTOMERS, customers);
        }
    }

    transactions = transactions.filter(t => t.id !== transactionId);

    writeData(FILE_TRANSACTIONS, transactions);
    writeData(FILE_PRODUCTS, products);

    logVoidAction(requester, transactionId, voidedAmount, authResult.isAdmin ?'Authorized by Admin' : `Authorized via Own Password (${authResult.user.username}, RBAC)`);

    runFraudChecks('void', { cashier: requester, transactionId, voidedAmount });

    res.json({ success: true, message: `Matagumpay na na-void ang transaksyon ${transactionId} at naibalik ang mga stock!` });
}

app.post('/api/transactions/:transactionId/refund', rateLimit('refund-transaction', 12, 10 * 60 * 1000), async (req, res) => {
    await transactionsMutexRunExclusive(() => processRefundTransaction(req, res));
});

async function processRefundTransaction(req, res) {
    const { transactionId } = req.params;
    const { requester, adminPassword, reason } = req.body;
    const requestedItems = Array.isArray(req.body.items) ? req.body.items : null;

    if (!adminPassword) {
        return res.status(400).json({ success: false, message: 'Kailangan ng password para mag-refund.' });
    }

    const users = readData(FILE_USERS);
    const authResult = await findRefundAuthorizer(users, adminPassword);

    if (!authResult) {
        return res.status(403).json({
            success: false,
            code: 'WRONG_ADMIN_PASSWORD',
            message: 'Maling password. Hindi pinahintulutan ang refund.'
        });
    }

    let transactions = readData(FILE_TRANSACTIONS);
    let products = readData(FILE_PRODUCTS);

    const txIndex = transactions.findIndex(t => t.id === transactionId);
    if (txIndex === -1) {
        return res.status(404).json({ success: false, message: 'Hindi nahanap ang Transaksyon ID.' });
    }

    const targetTx = transactions[txIndex];
    const grandTotal = parseFloat(targetTx.total) || 0;
    const alreadyRefunded = Math.min(grandTotal, parseFloat(targetTx.totalRefunded) || 0);
    const refundedQtyMap = targetTx.refundedQty && typeof targetTx.refundedQty === 'object' ? { ...targetTx.refundedQty } : {};

    if (alreadyRefunded >= grandTotal - 0.01) {
        return res.status(400).json({ success: false, message: 'Naka-full refund na ang transaksyong ito — wala nang matitirang matirang halaga na pwedeng i-refund.' });
    }

    const lineGross = (item) => {
        const qty = parseInt(item.quantity, 10) || 0;
        if (qty <= 0) return 0;
        return Math.max(0, (parseFloat(item.price) || 0) * qty - (parseFloat(item.itemDiscount) || 0));
    };

    const sumAllLinesGross = (targetTx.items || []).reduce((s, it) => s + lineGross(it), 0);

    const refundLines = [];
    const rejectedRefundItems = [];

    for (const item of (targetTx.items || [])) {
        const alreadyQty = parseInt(refundedQtyMap[item.code], 10) || 0;
        const maxRefundableQty = Math.max(0, (parseInt(item.quantity, 10) || 0) - alreadyQty);

        let qtyToRefund;
        if (requestedItems) {
            const requested = requestedItems.find(ri => ri.code === item.code);
            if (!requested) continue;
            qtyToRefund = parseInt(requested.quantity, 10) || 0;
            if (qtyToRefund <= 0) continue;
            if (qtyToRefund > maxRefundableQty) {
                rejectedRefundItems.push(`${item.name} (hiniling: ${qtyToRefund}, natitirang pwedeng i-refund: ${maxRefundableQty})`);
                continue;
            }
        } else {

            qtyToRefund = maxRefundableQty;
            if (qtyToRefund <= 0) continue;
        }

        refundLines.push({
            code: item.code,
            name: item.name,
            quantity: qtyToRefund,
            unitPrice: parseFloat(item.price) || 0
        });
    }

    if (rejectedRefundItems.length > 0) {
        return res.status(400).json({
            success: false,
            message: `Hindi maaaring i-refund ang mga sumusunod: ${rejectedRefundItems.join('; ')}`
        });
    }

    if (refundLines.length === 0) {
        return res.status(400).json({ success: false, message: 'Walang napiling item na may natitirang balanseng pwedeng i-refund.' });
    }

    let sumRefundGross = 0;
    for (const line of refundLines) {
        const originalItem = targetTx.items.find(it => it.code === line.code);
        const perUnitGross = originalItem.quantity > 0 ? lineGross(originalItem) / originalItem.quantity : 0;
        sumRefundGross += perUnitGross * line.quantity;
    }

    const refundRatio = sumAllLinesGross > 0 ? Math.min(1, sumRefundGross / sumAllLinesGross) : 0;
    let refundAmount = Math.round(grandTotal * refundRatio * 100) / 100;

    const remainingRefundable = Math.round((grandTotal - alreadyRefunded) * 100) / 100;
    if (refundAmount > remainingRefundable) refundAmount = remainingRefundable;
    if (refundAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Zero ang na-compute na refund amount — walang matitirang halagang pwedeng i-refund.' });
    }

    refundLines.forEach(line => {
        const prod = products.find(p => p.code === line.code);
        if (prod) {
            prod.stock = (parseInt(prod.stock) || 0) + line.quantity;
        }
        refundedQtyMap[line.code] = (parseInt(refundedQtyMap[line.code], 10) || 0) + line.quantity;
    });

    const newTotalRefunded = Math.round((alreadyRefunded + refundAmount) * 100) / 100;
    targetTx.refundedQty = refundedQtyMap;
    targetTx.totalRefunded = newTotalRefunded;
    targetTx.refundStatus = newTotalRefunded >= grandTotal - 0.01 ? 'full' : 'partial';

    if (targetTx.customerId) {
        const customers = readData(FILE_CUSTOMERS, []);
        const cust = customers.find(c => c.id === targetTx.customerId);
        if (cust) {
            const earnedOriginally = Math.max(0, parseInt(targetTx.loyaltyPointsEarned) || 0);
            const pointsToReverse = Math.floor(earnedOriginally * refundRatio);
            cust.points = Math.max(0, (cust.points || 0) - pointsToReverse);
            cust.totalSpent = Math.round(((cust.totalSpent || 0) - refundAmount) * 100) / 100;
            if (cust.totalSpent < 0) cust.totalSpent = 0;
            writeData(FILE_CUSTOMERS, customers);
        }
    }

    // ---- Linked C-Credit debt: a refund lowers what the debtor actually
    // still owes, using the same refundRatio applied to the transaction, so
    // the Debtors ledger stays in sync with the sale. Never drop the amount
    // below what's already been paid. ----
    const debts = readData(FILE_DEBTS, []);
    const linkedDebtIndex = debts.findIndex(d => d.transactionId === transactionId);
    if (linkedDebtIndex !== -1) {
        const linkedDebt = debts[linkedDebtIndex];
        const paidSoFar = parseFloat(linkedDebt.amountPaid) || 0;
        let newDebtAmount = Math.round(((parseFloat(linkedDebt.amount) || 0) - refundAmount) * 100) / 100;
        if (newDebtAmount < 0) newDebtAmount = 0;
        if (newDebtAmount < paidSoFar) newDebtAmount = paidSoFar;
        linkedDebt.amount = newDebtAmount;
        if (linkedDebt.amount <= 0 || paidSoFar >= linkedDebt.amount) {
            linkedDebt.status = 'paid';
            if (!linkedDebt.paidAt) linkedDebt.paidAt = new Date().toISOString();
            // Only a real earlier cash payment that now happens to cover the
            // (refund-reduced) balance counts as "settled" for points — a
            // balance that hit zero purely because it got refunded away is
            // not a payment and shouldn't earn anything.
            if (paidSoFar > 0 && paidSoFar >= linkedDebt.amount) {
                awardLoyaltyPointsForPaidDebt(linkedDebt, requester || 'system');
            }
        } else if (paidSoFar > 0) {
            linkedDebt.status = 'partial';
        } else {
            linkedDebt.status = 'unpaid';
        }
        writeData(FILE_DEBTS, debts);
        logAction(requester || 'Unknown', `Na-adjust ang kaugnay na debt ni ${linkedDebt.customerName} dahil sa refund — natitirang utang ngayon: ₱${linkedDebt.amount.toFixed(2)} (Transaction ${transactionId})`);
    }

    transactions[txIndex] = targetTx;
    writeData(FILE_TRANSACTIONS, transactions);
    writeData(FILE_PRODUCTS, products);

    const refundRecord = {
        id: 'RFD-' + Date.now(),
        transactionId,
        items: refundLines,
        reason: (reason || '').trim(),
        refundAmount,
        refundedBy: requester || 'Unknown',
        authorizedBy: authResult.isAdmin ? 'Admin' : `${authResult.user.username} (RBAC — refund_own_password)`,
        isFullRefund: targetTx.refundStatus === 'full',
        timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })
    };
    let refunds = readData(FILE_REFUNDS, []);
    refunds.unshift(refundRecord);
    writeData(FILE_REFUNDS, refunds);

    const itemsLabel = refundLines.map(l => `${l.name} x${l.quantity}`).join(', ');
    logRefundAction(
        requester || 'Unknown',
        transactionId,
        refundAmount,
        itemsLabel,
        reason,
        authResult.isAdmin ? 'Authorized by Admin' : `Authorized via Own Password (${authResult.user.username}, RBAC)`
    );

    runFraudChecks('refund', { cashier: requester || 'Unknown', transactionId, refundAmount });

    res.json({
        success: true,
        message: `Matagumpay na na-refund ang ₱${refundAmount.toFixed(2)} (${itemsLabel}) at naibalik ang mga stock!`,
        refund: refundRecord,
        transaction: targetTx
    });
}

app.get('/api/transactions/:transactionId/refunds', (req, res) => {
    const { transactionId } = req.params;
    const refunds = readData(FILE_REFUNDS, []).filter(r => r.transactionId === transactionId);
    res.json(refunds);
});

app.get('/api/refunds', (req, res) => {
    const { requester } = req.query;
    const allRefunds = readData(FILE_REFUNDS, []);

    if (!requester) return res.json(allRefunds);

    const users = readData(FILE_USERS);
    const activeUser = users.find(u => u.username.toLowerCase() === requester.toLowerCase());
    const activeRole = activeUser && activeUser.role;
    const isAdminRole = (activeRole || '').toLowerCase() === 'admin';
    const canViewAll = isAdminRole || !!getPermissionsForRole(activeRole).transactions_view_all;
    if (canViewAll) return res.json(allRefunds);

    res.json(allRefunds.filter(r => (r.refundedBy || '').toLowerCase() === requester.toLowerCase()));
});

app.post('/api/auth/verify-void', rateLimit('verify-void', 8, 10 * 60 * 1000), async (req, res) => {
    const { adminPassword, purpose } = req.body;

    if (!adminPassword) {
        return res.status(400).json({ success: false, message:'Kailangan ng password.' });
    }

    const users = readData(FILE_USERS);

    if (purpose ==='void') {
        const authResult = await findVoidAuthorizer(users, adminPassword);
        if (authResult) {
            return res.json({ success: true, message:'Authorized' });
        }
        return res.status(403).json({ success: false, code:'WRONG_ADMIN_PASSWORD', message:'Maling password!' });
    }

    if (purpose ==='manual_discount') {
        const authResult = await findManualDiscountAuthorizer(users, adminPassword);
        if (authResult) {
            return res.json({ success: true, message:'Authorized' });
        }
        return res.status(403).json({ success: false, code:'WRONG_ADMIN_PASSWORD', message:'Maling password!' });
    }

    if (purpose ==='refund') {
        const authResult = await findRefundAuthorizer(users, adminPassword);
        if (authResult) {
            return res.json({ success: true, message:'Authorized' });
        }
        return res.status(403).json({ success: false, code:'WRONG_ADMIN_PASSWORD', message:'Maling password!' });
    }

    if (purpose ==='loyalty_redeem') {
        const authResult = await findLoyaltyRedeemAuthorizer(users, adminPassword);
        if (authResult) {
            return res.json({ success: true, message:'Authorized' });
        }
        return res.status(403).json({ success: false, code:'WRONG_ADMIN_PASSWORD', message:'Maling password!' });
    }

    const adminUser = users.find(u => u.role.toLowerCase() ==='admin');
    if (!adminUser) {
        return res.status(404).json({ success: false, message:'Walang nahanap na Admin account sa system.' });
    }

    const isMatch = await bcrypt.compare(adminPassword, adminUser.password);

    if (isMatch) {
        return res.json({ success: true, message:'Authorized' });
    } else {

        return res.status(403).json({ success: false, code:'WRONG_ADMIN_PASSWORD', message:'Maling Admin Password!' });
    }
});

app.post('/api/logs', (req, res) => {
    const { user, action, authMethod, details } = req.body;
    let formattedAction = `[${action}]`;

    if (action ==="VOID_CART") {
        formattedAction += ` Voided cart: ${details.itemsCount} items, Total: ₱${details.totalAmount.toFixed(2)} (${authMethod}).`;
    }
    else if (action ==="MODIFY_MATRIX_QTY") {
        formattedAction += ` ${details.itemName}: Reduced by ${details.reducedQty}, Remaining: ${details.newQty} (${authMethod}).`;
    }
    else if (action ==="LOGOUT") {
        formattedAction += ` Logged out via ${authMethod}. Reason: ${details.message}`;
    }
    else {
        formattedAction += ` ${details.message ||'Executed non-standard action.'}`;
    }

    try {
        logAction(user, formattedAction);
        res.json({ success: true, message:'Log saved.' });
    } catch (error) {
        console.error("Logging error:", error);
        res.status(500).json({ success: false, message:'Server logging failed.' });
    }
});

function computeLowStockItems() {
    const products = readData(FILE_PRODUCTS);
    const purchaseOrders = readData(FILE_PURCHASE_ORDERS, []);
    let tracking = readData(FILE_LOWSTOCK_TRACKING, {});
    const nowIso = new Date().toISOString();

    const openPoQtyByCode = {};
    purchaseOrders.forEach(po => {
        if (po.status ==='ordered') {
            (po.items || []).forEach(it => {
                const key = (it.code ||'').trim().toLowerCase();
                openPoQtyByCode[key] = (openPoQtyByCode[key] || 0) + (parseInt(it.qty) || 0);
            });
        }
    });

    const uxSettingsForThreshold = readData(FILE_UX_SETTINGS, DEFAULT_UX_SETTINGS);
    const defaultLowStockThreshold = Number.isFinite(uxSettingsForThreshold.lowStockAlertThreshold)
        ? uxSettingsForThreshold.lowStockAlertThreshold : DEFAULT_UX_SETTINGS.lowStockAlertThreshold;

    const items = products
        .map(p => {
            const threshold = (p.lowStockThreshold !== undefined && p.lowStockThreshold !== null && p.lowStockThreshold !=='')
                ? parseInt(p.lowStockThreshold) : defaultLowStockThreshold;
            const stock = parseInt(p.stock || 0);
            const suggestedReorderQty = p.reorderQty ? parseInt(p.reorderQty) : Math.max((threshold * 2) - stock, threshold, 1);
            const key = (p.code ||'').trim().toLowerCase();
            return {
                code: p.code, name: p.name, category: p.category, supplier: p.supplier ||'',
                stock, threshold, suggestedReorderQty,
                status: stock <= 0 ?'OUT_OF_STOCK' :'LOW_STOCK',
                openOrderedQty: openPoQtyByCode[key] || 0,
                _key: key
            };
        })
        .filter(p => p.stock <= p.threshold);

    const stillLowKeys = new Set(items.map(i => i._key));
    let trackingChanged = false;
    items.forEach(i => {
        if (!tracking[i._key]) { tracking[i._key] = nowIso; trackingChanged = true; }
    });
    Object.keys(tracking).forEach(k => {
        if (!stillLowKeys.has(k)) { delete tracking[k]; trackingChanged = true; }
    });
    if (trackingChanged) writeData(FILE_LOWSTOCK_TRACKING, tracking);

    items.forEach(i => {
        const since = tracking[i._key] ? new Date(tracking[i._key]) : new Date();
        i.daysLow = Math.max(0, Math.floor((Date.now() - since.getTime()) / (1000 * 60 * 60 * 24)));
        i.lowSince = tracking[i._key] || nowIso;
        delete i._key;
    });

    items.sort((a, b) => a.stock - b.stock);
    return items;
}

app.get('/api/products/low-stock', (req, res) => {
    const items = computeLowStockItems();
    res.json({ success: true, count: items.length, items });
});

app.get('/api/reports/sales-analytics', requirePermission('reports'), requireFeature('advanced_reports'), (req, res) => {
    try {
        const rangeParam = (req.query.range || 'all').toString();
        const transactions = readData(FILE_TRANSACTIONS);

        const now = Date.now();
        const RANGE_MS = { today: 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };
        const cutoffMs = RANGE_MS[rangeParam] || null;

        const txs = cutoffMs
            ? transactions.filter(t => {
                const ts = t.isoDate ? Date.parse(t.isoDate) : NaN;
                return !isNaN(ts) && (now - ts) <= cutoffMs;
            })
            : transactions;

        let gross = 0;
        let totalRevenue = 0;
        let totalCost = 0;
        let anyCostRecorded = false;
        const rankingMap = {};
        const profitByProduct = {};
        const paymentBreakdown = {};
        const dailyTrendMap = {};

        txs.forEach(t => {
            const total = parseFloat(t.total) || 0;
            gross += total;

            const method = (t.method || t.payment_method || 'OTHER').toString().toUpperCase();
            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + total;

            const dayKey = (t.isoDate ? t.isoDate.slice(0, 10) : (t.timestamp || '').slice(0, 10)) || 'unknown';
            dailyTrendMap[dayKey] = (dailyTrendMap[dayKey] || 0) + total;

            (t.items || []).forEach(i => {
                const qty = parseInt(i.quantity) || 0;
                rankingMap[i.name] = (rankingMap[i.name] || 0) + qty;

                const itemDiscount = Math.max(0, parseFloat(i.itemDiscount) || 0);
                const revenue = ((parseFloat(i.price) || 0) * qty) - itemDiscount;
                const cost = (parseFloat(i.cost) || 0) * qty;
                if (parseFloat(i.cost) > 0) anyCostRecorded = true;

                totalRevenue += revenue;
                totalCost += cost;

                if (!profitByProduct[i.name]) profitByProduct[i.name] = { revenue: 0, cost: 0, qty: 0 };
                profitByProduct[i.name].revenue += revenue;
                profitByProduct[i.name].cost += cost;
                profitByProduct[i.name].qty += qty;
            });
        });

        const estimatedProfit = totalRevenue - totalCost;
        const marginPct = totalRevenue > 0 ? (estimatedProfit / totalRevenue) * 100 : 0;

        const sortedByQty = Object.keys(rankingMap).sort((a, b) => rankingMap[b] - rankingMap[a]);
        const topProducts = sortedByQty.slice(0, 5).map(name => ({ name, qty: rankingMap[name] }));
        const slowProducts = [...sortedByQty].reverse().slice(0, 5).map(name => ({ name, qty: rankingMap[name] }));

        const profitEntries = Object.entries(profitByProduct)
            .map(([name, d]) => ({ name, profit: Math.round((d.revenue - d.cost) * 100) / 100, qty: d.qty }))
            .sort((a, b) => b.profit - a.profit)
            .slice(0, 5);

        const dailyTrend = [];
        for (let d = 6; d >= 0; d--) {
            const dt = new Date(now - d * 24 * 60 * 60 * 1000);
            const key = dt.toISOString().slice(0, 10);
            dailyTrend.push({
                date: key,
                label: dt.toLocaleDateString('en-PH', { weekday: 'short' }),
                total: Math.round((dailyTrendMap[key] || 0) * 100) / 100
            });
        }

        res.json({
            success: true,
            range: rangeParam,
            gross: Math.round(gross * 100) / 100,
            transactionCount: txs.length,
            estimatedProfit: Math.round(estimatedProfit * 100) / 100,
            marginPct: Math.round(marginPct * 10) / 10,
            hasCostData: anyCostRecorded,
            topProducts,
            slowProducts,
            profitByProduct: profitEntries,
            paymentBreakdown,
            dailyTrend
        });
    } catch (err) {
        console.error('Sales analytics error:', err);
        res.status(500).json({ success: false, message: 'Hindi makuha ang sales analytics data.' });
    }
});

app.get('/api/products/low-stock/export', requirePermission('reorder'), requireFeature('advanced_reports'), (req, res) => {
    try {
        const items = computeLowStockItems();
        const escapeCsv = (val) => {
            const s = (val === undefined || val === null) ?'' : val.toString();
            return/[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
        };
        const headers = ['Code','Product Name','Category','Supplier','Current Stock','Threshold','Suggested Reorder Qty','Status','Days Low'];
        const lines = [headers.join(',')];
        items.forEach(p => {
            lines.push([
                escapeCsv(p.code), escapeCsv(p.name), escapeCsv(p.category), escapeCsv(p.supplier),
                escapeCsv(p.stock), escapeCsv(p.threshold), escapeCsv(p.suggestedReorderQty),
                escapeCsv(p.status), escapeCsv(p.daysLow)
            ].join(','));
        });
        const csvContent ='\uFEFF' + lines.join('\r\n');
        res.setHeader('Content-Type','text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="reorder_alerts_${Date.now()}.csv"`);
        res.send(csvContent);
    } catch (err) {
        console.error('Reorder export error:', err);
        res.status(500).json({ success: false, message:'Hindi ma-export ang reorder list.' });
    }
});

app.post('/api/products/:code/quick-restock', requirePermission('reorder'), rateLimit('quick-restock', 60, 10 * 60 * 1000), (req, res) => {
    const { code } = req.params;
    const qty = parseInt(req.body.qty);
    const username = req.authUser.username;
    const isAdminRole = (req.authUser.role ||'').toLowerCase() ==='admin';
    const canApplyDirectly = isAdminRole || !!getPermissionsForRole(req.authUser.role).restock_direct_apply;

    if (!qty || qty <= 0) {
        return res.status(400).json({ success: false, message:'Mangyaring maglagay ng valid na quantity.' });
    }

    let products = readData(FILE_PRODUCTS);
    const target = products.find(p => p.code.trim().toLowerCase() === code.trim().toLowerCase());
    if (!target) return res.status(404).json({ success: false, message:'Product not found.' });

    if (canApplyDirectly) {
        target.stock = (parseInt(target.stock) || 0) + qty;
        writeData(FILE_PRODUCTS, products);
        logAction(username, `Quick-restocked "${target.name}" (+${qty}, bagong stock: ${target.stock})`);
        return res.json({ success: true, message: `+${qty} na-restock sa "${target.name}".`, newStock: target.stock });
    } else {
        let requests = readData(FILE_REQUESTS);
        requests.push({ id: Date.now(), type:'RESTOCK', targetCode: code, requester: username, data: { qtyToAdd: qty, productName: target.name }, timestamp: new Date().toLocaleString() });
        writeData(FILE_REQUESTS, requests);
        logAction(username, `Submitted a RESTOCK request for "${target.name}" (+${qty})`);
        return res.json({ success: true, pending: true, message:'Restock request submitted for Admin approval.' });
    }
});

app.get('/api/purchase-orders', requirePermission('reorder'), requireFeature('purchase_orders'), (req, res) => {
    const orders = readData(FILE_PURCHASE_ORDERS, []).sort((a, b) => (b.createdAt ||'').localeCompare(a.createdAt ||''));
    res.json({ success: true, orders });
});

app.post('/api/purchase-orders', requirePermission('reorder'), requireFeature('purchase_orders'), (req, res) => {
    const { supplier, items, notes } = req.body;
    const username = req.authUser.username;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message:'Walang napiling item para sa Purchase Order.' });
    }

    const cleanItems = items
        .map(it => ({ code: (it.code ||'').toString(), name: (it.name ||'').toString(), qty: parseInt(it.qty) || 0 }))
        .filter(it => it.code && it.qty > 0);

    if (cleanItems.length === 0) {
        return res.status(400).json({ success: false, message:'Walang valid na item/quantity sa Purchase Order.' });
    }

    const orders = readData(FILE_PURCHASE_ORDERS, []);
    const newPO = {
        id: Date.now(),
        supplier: (supplier ||'Walang Tinukoy na Supplier').toString(),
        items: cleanItems,
        notes: (notes ||'').toString(),
        status:'ordered',
        createdBy: username,
        createdAt: new Date().toISOString(),
    };
    orders.push(newPO);
    writeData(FILE_PURCHASE_ORDERS, orders);
    logAction(username, `Gumawa ng Purchase Order #${newPO.id} para kay "${newPO.supplier}" (${cleanItems.length} item/s)`);
    res.json({ success: true, message:'Nagawa ang Purchase Order.', po: newPO });
});

app.post('/api/purchase-orders/:id/receive', requirePermission('reorder'), requireFeature('purchase_orders'), (req, res) => {
    const { id } = req.params;
    const username = req.authUser.username;
    let orders = readData(FILE_PURCHASE_ORDERS, []);
    const po = orders.find(o => o.id.toString() === id.toString());
    if (!po) return res.status(404).json({ success: false, message:'Purchase Order not found.' });
    if (po.status !=='ordered') return res.status(400).json({ success: false, message: `Hindi na-a-apply — status na ito ay "${po.status}".` });

    let products = readData(FILE_PRODUCTS);
    po.items.forEach(it => {
        const prod = products.find(p => p.code.trim().toLowerCase() === it.code.trim().toLowerCase());
        if (prod) prod.stock = (parseInt(prod.stock) || 0) + (parseInt(it.qty) || 0);
    });
    writeData(FILE_PRODUCTS, products);

    po.status ='received';
    po.receivedBy = username;
    po.receivedAt = new Date().toISOString();
    writeData(FILE_PURCHASE_ORDERS, orders);
    logAction(username, `Na-receive ang Purchase Order #${po.id} (${po.supplier}) — idinagdag sa stock ang ${po.items.length} item/s`);
    res.json({ success: true, message:'Na-receive ang Purchase Order at na-update ang stock.', po });
});

app.post('/api/purchase-orders/:id/cancel', requirePermission('reorder'), requireFeature('purchase_orders'), (req, res) => {
    const { id } = req.params;
    const username = req.authUser.username;
    let orders = readData(FILE_PURCHASE_ORDERS, []);
    const po = orders.find(o => o.id.toString() === id.toString());
    if (!po) return res.status(404).json({ success: false, message:'Purchase Order not found.' });
    if (po.status !=='ordered') return res.status(400).json({ success: false, message: `Hindi na-a-apply — status na ito ay "${po.status}".` });

    po.status ='cancelled';
    po.cancelledBy = username;
    po.cancelledAt = new Date().toISOString();
    writeData(FILE_PURCHASE_ORDERS, orders);
    logAction(username, `Kinansela ang Purchase Order #${po.id} (${po.supplier})`);
    res.json({ success: true, message:'Kinansela ang Purchase Order.', po });
});

app.get('/api/customers', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    res.json(readData(FILE_CUSTOMERS, []).map(sanitizeCustomerForClient));
});

app.get('/api/customers/for-terminal', requirePermission('terminal'), (req, res) => {
    const customers = readData(FILE_CUSTOMERS, []);
    const minimal = customers.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone ||'',
        email: c.email ||'',
        points: c.points || 0,
        hasLoyaltyCard: !!(c.loyaltyCard && !c.loyaltyCard.revoked)
    }));
    res.json(minimal);
});

app.get('/api/customers/search', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    const q = (req.query.q ||'').toLowerCase().trim();
    const customers = readData(FILE_CUSTOMERS, []);
    if (!q) return res.json(customers.slice(0, 25).map(sanitizeCustomerForClient));
    const results = customers.filter(c =>
        (c.name ||'').toLowerCase().includes(q) || (c.phone ||'').includes(q)
    ).slice(0, 25);
    res.json(results.map(sanitizeCustomerForClient));
});

app.post('/api/customers', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    const { name, phone, email, notes } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message:'Kailangan ng pangalan ng customer.' });
    }
    const customers = readData(FILE_CUSTOMERS, []);
    if (phone && customers.some(c => c.phone && c.phone === phone)) {
        return res.status(400).json({ success: false, message:'May existing customer na gumagamit na ng phone number na ito.' });
    }
    const customer = {
        id:'CUST-' + Date.now(),
        name: name.trim(),
        phone: phone ||'',
        email: email ||'',
        notes: notes ||'',
        points: 0,
        totalSpent: 0,
        visits: 0,
        createdAt: new Date().toISOString(),
        lastVisit: null,
        loyaltyCard: null
    };
    customers.unshift(customer);
    writeData(FILE_CUSTOMERS, customers);
    logAction(req.authUser.username, `Added new customer: ${customer.name}`);
    res.json({ success: true, customer: sanitizeCustomerForClient(customer) });
});

app.put('/api/customers/:id', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    const customers = readData(FILE_CUSTOMERS, []);
    const idx = customers.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message:'Customer not found.' });
    const { name, phone, email, notes } = req.body;
    if (name !== undefined && name.trim()) customers[idx].name = name.trim();
    if (phone !== undefined) customers[idx].phone = phone;
    if (email !== undefined) customers[idx].email = email;
    if (notes !== undefined) customers[idx].notes = notes;
    writeData(FILE_CUSTOMERS, customers);
    res.json({ success: true, customer: sanitizeCustomerForClient(customers[idx]) });
});

app.delete('/api/customers/:id', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    let customers = readData(FILE_CUSTOMERS, []);
    if (!customers.some(c => c.id === req.params.id)) {
        return res.status(404).json({ success: false, message:'Customer not found.' });
    }
    customers = customers.filter(c => c.id !== req.params.id);
    writeData(FILE_CUSTOMERS, customers);
    logAction(req.authUser.username, `Deleted customer ID: ${req.params.id}`);
    res.json({ success: true });
});

// Awards loyalty points once a C-Credit debt is fully settled. Points were
// intentionally withheld at time of sale (see usesCreditPayment in the sale
// handler) since no real payment had come in yet — this is where that
// deferred earn actually happens, mirroring a normal cash sale's earn logic.
// Only works if the original sale had a customer selected in the cart
// (transaction.customerId); a debt with just a free-text debtor name/phone
// (no linked customer account) has nowhere to credit points to.
// `debt` is mutated in place (pointsAwarded/loyaltyPointsEarned) — caller is
// responsible for writeData(FILE_DEBTS, ...) afterward.
function awardLoyaltyPointsForPaidDebt(debt, actorUsername) {
    if (!debt || debt.pointsAwarded || !debt.transactionId) return;

    const storeSettings = getStoreSettingsPublic(readData(FILE_STORE_SETTINGS, DEFAULT_STORE_SETTINGS));
    if (!storeSettings.loyaltyEnabled) return;

    const transactions = readData(FILE_TRANSACTIONS, []);
    const linkedTx = transactions.find(t => t.id === debt.transactionId);
    if (!linkedTx || !linkedTx.customerId) return;

    const customers = readData(FILE_CUSTOMERS, []);
    const cust = customers.find(c => c.id === linkedTx.customerId);
    if (!cust) return;

    const earnRate = parseFloat(storeSettings.loyaltyEarnRate) || 100;
    const earned = earnRate > 0 ? Math.floor((parseFloat(debt.amount) || 0) / earnRate) : 0;

    debt.pointsAwarded = true;
    if (earned <= 0) return;

    cust.points = (cust.points || 0) + earned;
    writeData(FILE_CUSTOMERS, customers);
    debt.loyaltyPointsEarned = earned;
    logAction(actorUsername || 'system', `Nag-earn ng ${earned} loyalty points si ${cust.name} matapos ma-fully paid ang C-Credit debt (₱${(parseFloat(debt.amount) || 0).toFixed(2)}, Debt ID: ${debt.id}).`);
}

// ================== DEBTS / DEBTORS TRACKING ==================
// Separate module from the regular Customers list — for tracking
// customers/people who "borrowed now, will pay later/on Friday, etc."
// Each record has a note and a dueAt (date/time payment is due) — the
// "time remaining before due" is NOT computed here (only an ISO string
// is stored); it's computed live on the client (app.js) using dueAt so
// it stays accurate no matter how many hours/days the app stays open.
// Uses the same requirePermission/requireFeature gate as the Customers
// module (customer_crm) since this is an extension of customer
// management.
app.get('/api/debts', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    res.json(readData(FILE_DEBTS, []));
});

app.post('/api/debts', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    const { customerName, phone, amount, note, dueAt, items, transactionId } = req.body;
    if (!customerName || !customerName.trim()) {
        return res.status(400).json({ success: false, message:'Debtor name is required.' });
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message:'A valid amount owed is required.' });
    }
    let dueAtIso = null;
    if (dueAt) {
        const parsedDue = new Date(dueAt);
        if (isNaN(parsedDue.getTime())) {
            return res.status(400).json({ success: false, message:'The due date/time is not valid.' });
        }
        dueAtIso = parsedDue.toISOString();
    }
    const debts = readData(FILE_DEBTS, []);
    const debt = {
        id:'DEBT-' + Date.now() +'-' + crypto.randomBytes(3).toString('hex'),
        customerName: customerName.trim(),
        phone: phone ||'',
        amount: parsedAmount,
        amountPaid: 0,
        note: note ||'',
        items: Array.isArray(items)
            ? items.map(it => ({
                code: (it && it.code) || '',
                name: (it && it.name) || '',
                quantity: parseInt(it && it.quantity, 10) || 0,
                price: parseFloat(it && it.price) || 0
            })).filter(it => it.name)
            : [],
        transactionId: transactionId ? String(transactionId) : null,
        borrowedAt: new Date().toISOString(),
        dueAt: dueAtIso,
        status:'unpaid',
        createdBy: req.authUser.username,
        createdAt: new Date().toISOString(),
        paidAt: null
    };
    debts.unshift(debt);
    writeData(FILE_DEBTS, debts);
    logAction(req.authUser.username, `Added a new debt record: ${debt.customerName} — ₱${debt.amount.toFixed(2)}`);
    res.json({ success: true, debt });
});

app.put('/api/debts/:id', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    const debts = readData(FILE_DEBTS, []);
    const idx = debts.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message:'Debt record not found.' });

    const { customerName, phone, amount, note, dueAt } = req.body;
    if (customerName !== undefined && customerName.trim()) debts[idx].customerName = customerName.trim();
    if (phone !== undefined) debts[idx].phone = phone;
    if (note !== undefined) debts[idx].note = note;
    if (dueAt !== undefined) {
        if (!dueAt) {
            debts[idx].dueAt = null;
        } else {
            const parsedDue = new Date(dueAt);
            if (isNaN(parsedDue.getTime())) {
                return res.status(400).json({ success: false, message:'The due date/time is not valid.' });
            }
            debts[idx].dueAt = parsedDue.toISOString();
        }
    }
    if (amount !== undefined) {
        const parsedAmount = parseFloat(amount);
        if (!parsedAmount || parsedAmount <= 0) {
            return res.status(400).json({ success: false, message:'A valid amount is required.' });
        }
        debts[idx].amount = parsedAmount;
        if (debts[idx].amountPaid >= debts[idx].amount) {
            debts[idx].status ='paid';
            if (!debts[idx].paidAt) debts[idx].paidAt = new Date().toISOString();
            awardLoyaltyPointsForPaidDebt(debts[idx], req.authUser.username);
        } else if (debts[idx].amountPaid > 0) {
            debts[idx].status ='partial';
        } else {
            debts[idx].status ='unpaid';
        }
    }
    writeData(FILE_DEBTS, debts);
    res.json({ success: true, debt: debts[idx] });
});

app.post('/api/debts/:id/payment', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    const debts = readData(FILE_DEBTS, []);
    const idx = debts.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message:'Debt record not found.' });

    const paymentAmount = parseFloat(req.body.amount);
    if (!paymentAmount || paymentAmount <= 0) {
        return res.status(400).json({ success: false, message:'A valid payment amount is required.' });
    }
    const debt = debts[idx];
    const remainingBefore = Math.max(0, debt.amount - (debt.amountPaid || 0));
    if (paymentAmount > remainingBefore + 0.01) {
        return res.status(400).json({ success: false, message:`The payment (₱${paymentAmount.toFixed(2)}) exceeds the remaining balance (₱${remainingBefore.toFixed(2)}).` });
    }
    debt.amountPaid = Math.min(debt.amount, (debt.amountPaid || 0) + paymentAmount);
    if (debt.amountPaid >= debt.amount) {
        debt.status ='paid';
        debt.paidAt = new Date().toISOString();
        awardLoyaltyPointsForPaidDebt(debt, req.authUser.username);
    } else {
        debt.status ='partial';
    }
    writeData(FILE_DEBTS, debts);
    logAction(req.authUser.username, `Recorded a payment for ${debt.customerName}'s debt: ₱${paymentAmount.toFixed(2)}`);
    res.json({ success: true, debt });
});

app.delete('/api/debts/:id', requirePermission('customers'), requireFeature('customer_crm'), (req, res) => {
    let debts = readData(FILE_DEBTS, []);
    if (!debts.some(d => d.id === req.params.id)) {
        return res.status(404).json({ success: false, message:'Debt record not found.' });
    }
    debts = debts.filter(d => d.id !== req.params.id);
    writeData(FILE_DEBTS, debts);
    logAction(req.authUser.username, `Deleted debt record ID: ${req.params.id}`);
    res.json({ success: true });
});

app.post('/api/customers/:id/loyalty-card', requirePermission('loyalty_card_issue'), requireFeature('customer_crm'), rateLimit('loyalty-card-issue', 20, 10 * 60 * 1000), (req, res) => {
    const customers = readData(FILE_CUSTOMERS, []);
    const customer = customers.find(c => c.id === req.params.id);
    if (!customer) return res.status(404).json({ success: false, message:'Customer not found.' });
    const mode = (req.body && req.body.mode ==='static') ? 'static' : 'rotating';
    const wasReissue = !!(customer.loyaltyCard && !customer.loyaltyCard.revoked);
    const { token, card } = issueLoyaltyCard(customer, mode, req.authUser.username);
    writeData(FILE_CUSTOMERS, customers);
    logAction(req.authUser.username, `${wasReissue ? 'Regenerated' : 'Issued'} loyalty ${mode ==='static' ? 'card' : 'QR'} for customer: ${customer.name} (${customer.id})`);
    res.json({
        success: true,
        message: wasReissue
            ? 'Na-regenerate ang loyalty card/QR. Awtomatiko nang na-invalidate ang dating QR — ito na lang ang gagana.'
            : 'Naka-issue na ang bagong loyalty card/QR.',
        token,
        card: { cardId: card.cardId, mode: card.mode, issuedAt: card.issuedAt }
    });
});

app.post('/api/customers/:id/loyalty-card/revoke', requirePermission('loyalty_card_issue'), requireFeature('customer_crm'), (req, res) => {
    const customers = readData(FILE_CUSTOMERS, []);
    const customer = customers.find(c => c.id === req.params.id);
    if (!customer) return res.status(404).json({ success: false, message:'Customer not found.' });
    if (!customer.loyaltyCard) return res.status(400).json({ success: false, message:'Walang naka-issue na card/QR ang customer na ito.' });
    customer.loyaltyCard.revoked = true;
    writeData(FILE_CUSTOMERS, customers);
    logAction(req.authUser.username, `Revoked loyalty card/QR of customer: ${customer.name} (${customer.id})`);
    res.json({ success: true, message:'Na-revoke na ang loyalty card/QR na ito.' });
});

app.post('/api/customers/lookup-by-card', requirePermission('terminal'), rateLimit('loyalty-card-scan', 60, 10 * 60 * 1000), (req, res) => {
    const rawToken = req.body && req.body.token;
    if (!rawToken || typeof rawToken !=='string') {
        return res.status(400).json({ success: false, message:'Missing QR/card token.' });
    }
    const parts = rawToken.split('.');
    if (parts.length !== 4 || parts[0] !=='LC1') {
        return res.status(400).json({ success: false, message:'Hindi ito valid na Loyalty Card/QR.' });
    }
    const customers = readData(FILE_CUSTOMERS, []);
    const customer = customers.find(c => c.id === parts[1]);
    if (!customer) return res.status(404).json({ success: false, message:'Walang customer na nahanap para sa card/QR na ito.' });
    const check = verifyLoyaltyCardToken(customer, rawToken);
    if (!check.valid) return res.status(403).json({ success: false, code:'LOYALTY_CARD_INVALID', message: check.message });
    res.json({
        success: true,
        customer: { id: customer.id, name: customer.name, phone: customer.phone ||'', email: customer.email ||'', points: customer.points || 0 },
        cardMode: check.mode
    });
});

app.get('/api/promocodes', requirePermission('products'), requireFeature('promo_codes'), (req, res) => {
    res.json(readData(FILE_PROMOCODES, []));
});

app.post('/api/promocodes', requirePermission('products'), requireFeature('promo_codes'), (req, res) => {
    let { code, type, value, description, expiresAt, minSpend } = req.body;
    code = (code ||'').trim().toUpperCase();
    if (!code) return res.status(400).json({ success: false, message:'Kailangan ng promo code.' });
    if (!['percent','fixed'].includes(type)) return res.status(400).json({ success: false, message:'Invalid discount type (percent o fixed lang).' });
    value = parseFloat(value);
    if (isNaN(value) || value <= 0) return res.status(400).json({ success: false, message:'Invalid discount value.' });
    if (type ==='percent' && value > 100) return res.status(400).json({ success: false, message:'Hindi pwedeng lumagpas sa 100% ang percent discount.' });

    const promos = readData(FILE_PROMOCODES, []);
    if (promos.some(p => p.code === code)) {
        return res.status(400).json({ success: false, message:'Existing na ang promo code na ito.' });
    }
    const promo = {
        code, type, value,
        description: description ||'',
        active: true,
        expiresAt: expiresAt || null,
        minSpend: parseFloat(minSpend) || 0,
        createdAt: new Date().toISOString()
    };
    promos.unshift(promo);
    writeData(FILE_PROMOCODES, promos);
    logAction(req.authUser.username, `Added promo code: ${code}`);
    res.json({ success: true, promo });
});

app.put('/api/promocodes/:code', requirePermission('products'), requireFeature('promo_codes'), (req, res) => {
    const codeParam = req.params.code.toUpperCase();
    const promos = readData(FILE_PROMOCODES, []);
    const idx = promos.findIndex(p => p.code === codeParam);
    if (idx === -1) return res.status(404).json({ success: false, message:'Promo code not found.' });
    const { type, value, description, active, expiresAt, minSpend } = req.body;
    if (type !== undefined) promos[idx].type = type;
    if (value !== undefined) promos[idx].value = parseFloat(value);
    if (description !== undefined) promos[idx].description = description;
    if (active !== undefined) promos[idx].active = !!active;
    if (expiresAt !== undefined) promos[idx].expiresAt = expiresAt;
    if (minSpend !== undefined) promos[idx].minSpend = parseFloat(minSpend) || 0;
    writeData(FILE_PROMOCODES, promos);
    res.json({ success: true, promo: promos[idx] });
});

app.delete('/api/promocodes/:code', requirePermission('products'), requireFeature('promo_codes'), (req, res) => {
    const codeParam = req.params.code.toUpperCase();
    let promos = readData(FILE_PROMOCODES, []);
    if (!promos.some(p => p.code === codeParam)) {
        return res.status(404).json({ success: false, message:'Promo code not found.' });
    }
    promos = promos.filter(p => p.code !== codeParam);
    writeData(FILE_PROMOCODES, promos);
    logAction(req.authUser.username, `Deleted promo code: ${codeParam}`);
    res.json({ success: true });
});

app.get('/api/promocodes/:code/validate', requireFeature('promo_codes'), (req, res) => {

    const codeParam = req.params.code.toUpperCase();
    const subtotal = parseFloat(req.query.subtotal) || 0;
    const promos = readData(FILE_PROMOCODES, []);
    const promo = promos.find(p => p.code === codeParam);
    if (!promo) return res.json({ success: false, message:'Hindi valid ang promo code na ito.' });
    if (!promo.active) return res.json({ success: false, message:'Naka-disable na ang promo code na ito.' });
    if (promo.expiresAt && new Date(promo.expiresAt).getTime() < Date.now()) {
        return res.json({ success: false, message:'Na-expire na ang promo code na ito.' });
    }
    if (promo.minSpend && subtotal < promo.minSpend) {
        return res.json({ success: false, message: `Kailangan ng minimum na ₱${promo.minSpend.toFixed(2)} para magamit ang promo na ito.` });
    }
    let discountAmount = promo.type ==='percent' ? (subtotal * promo.value / 100) : promo.value;
    discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);
    res.json({ success: true, promo, discountAmount: Math.round(discountAmount * 100) / 100 });
});

function computeShiftSummary(periodStartIso, periodEndIso, cashierFilter) {
    const allTx = readData(FILE_TRANSACTIONS);
    const start = new Date(periodStartIso).getTime();
    const end = new Date(periodEndIso).getTime();
    const cashierKey = cashierFilter ? String(cashierFilter).toLowerCase() : null;

    const txs = allTx.filter(t => {
        const ts = new Date(t.isoDate || t.timestamp || 0).getTime();
        if (isNaN(ts) || ts <= start || ts > end) return false;
        if (cashierKey && (t.cashier ||'').toLowerCase() !== cashierKey) return false;
        return true;
    });

    const paymentBreakdown = {};
    let grossSales = 0, totalDiscount = 0, netSales = 0;
    txs.forEach(t => {
        const disc = parseFloat(t.discount || 0) || 0;
        const net = parseFloat(t.total || 0) || 0;
        totalDiscount += disc;
        netSales += net;
        grossSales += net + disc;

        if (Array.isArray(t.payments) && t.payments.length > 0) {
            const totalTendered = t.payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) || 1;
            t.payments.forEach(p => {
                const method = (p.method ||'CASH').toUpperCase();
                const share = Math.round((net * ((parseFloat(p.amount) || 0) / totalTendered)) * 100) / 100;
                if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, total: 0 };
                paymentBreakdown[method].total = Math.round((paymentBreakdown[method].total + share) * 100) / 100;
            });

            const primaryMethod = (t.payments[0].method ||'CASH').toUpperCase();
            paymentBreakdown[primaryMethod].count += 1;
        } else {
            const method = (t.payment_method || t.method ||'CASH').toUpperCase();
            if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, total: 0 };
            paymentBreakdown[method].count += 1;
            paymentBreakdown[method].total = Math.round((paymentBreakdown[method].total + net) * 100) / 100;
        }
    });

    const logs = readData(FILE_USERLOGS);
    const voidLogs = logs.filter(l => l.action && l.action.indexOf('VOIDED Transaction') === 0 && l.id > start && l.id <= end
        && (!cashierKey || (l.username ||'').toLowerCase() === cashierKey));
    const voidCount = voidLogs.length;
    const voidedAmount = Math.round(voidLogs.reduce((sum, l) => sum + (parseFloat(l.voidedAmount) || 0), 0) * 100) / 100;

    return {
        periodStart: new Date(start).toISOString(),
        periodEnd: new Date(end).toISOString(),
        transactionCount: txs.length,
        grossSales: Math.round(grossSales * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        netSales: Math.round(netSales * 100) / 100,
        paymentBreakdown,
        voidCount,
        voidedAmount
    };
}

function readShiftMetaStore() {
    const raw = readData(FILE_SHIFT_META, {});
    if (raw && !raw.cashiers && (raw.beginningCash !== undefined || raw.lastCloseAt !== undefined)) {
        return { cashiers: {}, legacyLastCloseAt: raw.lastCloseAt || null };
    }
    if (!raw.cashiers) raw.cashiers = {};
    return raw;
}

function writeShiftMetaStore(store) {
    writeData(FILE_SHIFT_META, store);
}

function getCashierShiftMeta(store, username) {
    const existingKey = Object.keys(store.cashiers).find(k => k.toLowerCase() === (username ||'').toLowerCase());
    if (existingKey) return store.cashiers[existingKey];
    store.cashiers[username] = { lastCloseAt: store.legacyLastCloseAt || null };
    return store.cashiers[username];
}

app.get('/api/shift/current', (req, res) => {
    const role = req.authUser && req.authUser.role;
    const isAdminRole = (role ||'').toLowerCase() ==='admin';
    const canControlOthers = isAdminRole || !!getPermissionsForRole(role).shift_close_control;

    const requestedCashier = (req.query.cashier ||'').toString().trim();
    let targetCashier = req.authUser.username;
    if (requestedCashier && requestedCashier.toLowerCase() !== targetCashier.toLowerCase()) {
        if (!canControlOthers) {
            return res.status(403).json({ success: false, message:'Akses Denied: Wala kang pahintulot na tingnan/kontrolin ang shift ng ibang cashier.' });
        }
        targetCashier = requestedCashier;
    }

    const store = readShiftMetaStore();
    const targetHasOpenShift = (() => {
        const m = getCashierShiftMeta(store, targetCashier);
        return m.beginningCash !== undefined && m.beginningCash !== null;
    })();
    if (!targetHasOpenShift) {
        const gateResult = checkShiftManagementUnlocked();
        if (!gateResult.unlocked) return res.status(402).json(gateResult.body);
    }
    const meta = getCashierShiftMeta(store, targetCashier);
    const periodStart = meta.lastCloseAt || new Date(0).toISOString();
    const summary = computeShiftSummary(periodStart, new Date().toISOString(), targetCashier);

    const canViewAmounts = isAdminRole || !!getPermissionsForRole(role).shiftreport_view_amounts;
    if (!canViewAmounts) {
        delete summary.grossSales;
        delete summary.totalDiscount;
        delete summary.netSales;
        delete summary.voidedAmount;
        delete summary.paymentBreakdown;
    }

    res.json({
        success: true,
        summary,
        cashier: targetCashier,
        viewingOtherCashier: targetCashier.toLowerCase() !== req.authUser.username.toLowerCase(),
        canControlOtherShifts: canControlOthers,
        beginningCash: (meta.beginningCash !== undefined && meta.beginningCash !== null) ? meta.beginningCash : null,
        beginningCashLocked: meta.beginningCash !== undefined && meta.beginningCash !== null,
        beginningCashSetBy: meta.beginningCashSetBy || null
    });
});

app.get('/api/shift/open-list', (req, res) => {
    const role = req.authUser && req.authUser.role;
    const isAdminRole = (role ||'').toLowerCase() ==='admin';
    const canControlOthers = isAdminRole || !!getPermissionsForRole(role).shift_close_control;
    if (!canControlOthers) {
        return res.status(403).json({ success: false, message:'Akses Denied: Wala kang pahintulot na kontrolin ang shift close ng ibang cashier.' });
    }
    const store = readShiftMetaStore();
    const openShifts = Object.keys(store.cashiers)
        .map(username => ({ username, meta: store.cashiers[username] }))
        .filter(c => c.meta && c.meta.beginningCash !== undefined && c.meta.beginningCash !== null)
        .map(c => ({
            username: c.username,
            beginningCash: c.meta.beginningCash,
            beginningCashSetAt: c.meta.beginningCashSetAt || null
        }));
    res.json({ success: true, openShifts });
});

app.post('/api/shift/open-cash', requirePermission('terminal'), requireFeature('shift_management'), rateLimit('shift-open-cash', 20, 10 * 60 * 1000), (req, res) => {
    const store = readShiftMetaStore();
    const meta = getCashierShiftMeta(store, req.authUser.username);
    if (meta.beginningCash !== undefined && meta.beginningCash !== null) {
        return res.status(409).json({
            success: false,
            message:'The Beginning Cash for your current shift has already been set and locked.',
            beginningCash: meta.beginningCash
        });
    }
    const amount = parseFloat(req.body.beginningCash);
    if (isNaN(amount) || amount < 0) {
        return res.status(400).json({ success: false, message:'Invalid Beginning Cash amount.' });
    }
    meta.beginningCash = Math.round(amount * 100) / 100;
    meta.beginningCashSetBy = req.authUser.username;
    meta.beginningCashSetAt = new Date().toISOString();
    writeShiftMetaStore(store);
    logAction(req.authUser.username, `Set the Beginning Cash Float for a new shift: ₱${meta.beginningCash.toFixed(2)}`);
    res.json({ success: true, beginningCash: meta.beginningCash });
});

app.post('/api/shift/close', rateLimit('shift-close', 20, 10 * 60 * 1000), async (req, res) => {
    const role = req.authUser && req.authUser.role;
    const isAdminRole = (role ||'').toLowerCase() ==='admin';
    const canControlOthers = isAdminRole || !!getPermissionsForRole(role).shift_close_control;

    const { adminPassword } = req.body;
    if (!adminPassword) {
        return res.status(400).json({ success: false, message:'Kailangan ng Admin/Manager/Supervisor password para isara ang shift / Z-Reading.' });
    }
    const usersForShiftClose = readData(FILE_USERS);
    const shiftCloseAuth = await findShiftCloseAuthorizer(usersForShiftClose, adminPassword);
    if (!shiftCloseAuth) {
        return res.status(403).json({
            success: false,
            code:'WRONG_ADMIN_PASSWORD',
            message:'Maling password. Hindi pinahintulutan ang pag-close ng shift / Z-Reading.'
        });
    }

    const requestedTarget = (req.body.targetCashier ||'').toString().trim();
    let targetCashier = req.authUser.username;
    let closedOnBehalf = false;
    if (requestedTarget && requestedTarget.toLowerCase() !== targetCashier.toLowerCase()) {
        if (!canControlOthers) {
            return res.status(403).json({ success: false, message:'Akses Denied: Wala kang pahintulot na isara ang shift ng ibang cashier. Kailangan ng Admin/Supervisor control (shift_close_control) para dito.' });
        }
        targetCashier = requestedTarget;
        closedOnBehalf = true;
    }

    const store = readShiftMetaStore();
    const meta = getCashierShiftMeta(store, targetCashier);
    const targetHasOpenShift = meta.beginningCash !== undefined && meta.beginningCash !== null;
    if (!targetHasOpenShift) {

        const gateResult = checkShiftManagementUnlocked();
        if (!gateResult.unlocked) return res.status(402).json(gateResult.body);
    }

    const beginningCash = (meta.beginningCash !== undefined && meta.beginningCash !== null)
        ? meta.beginningCash
        : req.body.beginningCash;
    const { endingCashCounted, notes } = req.body;
    const periodStart = meta.lastCloseAt || new Date(0).toISOString();
    const periodEnd = new Date().toISOString();
    const summary = computeShiftSummary(periodStart, periodEnd, targetCashier);

    const isZeroActivityClose = summary.transactionCount === 0 && summary.voidCount === 0;

    if (isZeroActivityClose && !targetHasOpenShift) {
        return res.json({ success: false, message: `Walang bukas na shift at walang bagong transaksyon o void para kay ${closedOnBehalf ? targetCashier :'sa iyo'}. Wala pang kailangang i-close.` });
    }

    const shifts = readData(FILE_SHIFTS, []);

    const cashSales = (summary.paymentBreakdown['CASH'] && summary.paymentBreakdown['CASH'].total) || 0;
    const beginCashNum = parseFloat(beginningCash) || 0;
    const expectedCash = Math.round((beginCashNum + cashSales) * 100) / 100;
    const hasCount = endingCashCounted !== undefined && endingCashCounted !=='' && endingCashCounted !== null;
    const endCashNum = hasCount ? (parseFloat(endingCashCounted) || 0) : null;
    const cashVariance = hasCount ? Math.round((endCashNum - expectedCash) * 100) / 100 : null;

    const record = {
        id:'Z-' + Date.now(),
        closedBy: targetCashier,

        closedOnBehalfBy: closedOnBehalf ? req.authUser.username : null,
        beginningCash: beginCashNum,
        endingCashCounted: endCashNum,
        cashSales,
        expectedCash,
        cashVariance,
        notes: notes ||'',
        noSalesShift: isZeroActivityClose,
        ...summary
    };
    shifts.unshift(record);
    writeData(FILE_SHIFTS, shifts);

    store.cashiers[targetCashier] = { lastCloseAt: periodEnd };
    writeShiftMetaStore(store);

    const varianceLog = cashVariance === null
        ?''
        : (cashVariance < 0
            ? `, Cash SHORT ₱${Math.abs(cashVariance).toFixed(2)}`
            : (cashVariance > 0 ? `, Cash OVER ₱${cashVariance.toFixed(2)}` :', Cash Exact'));
    const noSalesLog = isZeroActivityClose ?' (Walang Transaksyon - Shift Handover Lang)' :'';
    const authorizedByLog = shiftCloseAuth.isAdmin
        ?'Authorized by Admin'
        : `Authorized via Own Password (${shiftCloseAuth.user.username}, RBAC)`;
    const actionLog = closedOnBehalf
        ? `Closed shift / Z-Reading ${record.id} ng cashier '${targetCashier}' (Admin/Supervisor Control): ${summary.transactionCount} tx, Net Sales ₱${summary.netSales}${varianceLog}${noSalesLog} — ${authorizedByLog}`
        : `Closed shift / Z-Reading ${record.id}: ${summary.transactionCount} tx, Net Sales ₱${summary.netSales}${varianceLog}${noSalesLog} — ${authorizedByLog}`;
    logAction(req.authUser.username, actionLog);
    res.json({ success: true, shift: record });
});

app.get('/api/shifts', requirePermission('shiftreport'), requireFeature('shift_management'), (req, res) => {
    const allShifts = readData(FILE_SHIFTS, []);

    const requester = req.authUser && req.authUser.username;
    const activeRole = req.authUser && req.authUser.role;
    const isAdminRole = (activeRole ||'').toLowerCase() ==='admin';

    const canViewAll = isAdminRole || !!getPermissionsForRole(activeRole).shiftreport_view_all;
    if (canViewAll) {
        return res.json(allShifts);
    }

    const ownShifts = allShifts.filter(
        s => (s.closedBy ||'').toLowerCase() === (requester ||'').toLowerCase()
    );
    res.json(ownShifts);
});

const isProduction = process.env.NODE_ENV ==='production';
const HOST = isProduction ?'0.0.0.0' :'localhost';
const PORT = process.env.PORT || 3000;

const HTTPS_CERT_FILE = process.env.HTTPS_CERT_FILE || '';
const HTTPS_KEY_FILE = process.env.HTTPS_KEY_FILE || '';

let httpsOptions = null;
if (HTTPS_CERT_FILE && HTTPS_KEY_FILE) {
    try {
        if (fs.existsSync(HTTPS_CERT_FILE) && fs.existsSync(HTTPS_KEY_FILE)) {
            httpsOptions = {
                cert: fs.readFileSync(HTTPS_CERT_FILE),
                key: fs.readFileSync(HTTPS_KEY_FILE)
            };
        } else {
            console.warn('⚠️  HTTPS_CERT_FILE/HTTPS_KEY_FILE naka-set pero hindi mahanap ang file(s) — babalik sa plain HTTP.');
        }
    } catch (err) {
        console.warn('⚠️  Hindi ma-load ang LAN HTTPS certificate — babalik sa plain HTTP. Detalye:', err.message);
        httpsOptions = null;
    }
}

app.get('/ca-cert.pem', (req, res) => {
    const caPath = process.env.HTTPS_CA_FILE || '';
    if (!caPath || !fs.existsSync(caPath)) {
        return res.status(404).send('Walang naka-configure na LAN CA certificate sa server na ito.');
    }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="omnipos-lan-ca.pem"');
    res.sendFile(path.resolve(caPath));
});

// BUG FIX: sa Render Free plan, ephemeral ang buong disk kada deploy —
// kaya bago tumanggap ng traffic, subukan munang i-restore ang
// pinakahuling snapshot mula sa Postgres (cloud-snapshot.js) kung
// mukhang bago/blangko ang lokal na SQLite. Kailangan itong async, kaya
// nakabalot na ngayon sa isang startup function ang buong listen logic.
const { restoreFromCloudIfNeeded, pushSnapshotToCloud } = require('./cloud-snapshot');

async function startOmniposServer() {
    await restoreFromCloudIfNeeded();

    if (httpsOptions) {
        const https = require('https');
        https.createServer(httpsOptions, app).listen(PORT, HOST, () => {
            console.log(`Server running at https://${HOST}:${PORT} (LAN HTTPS)`);
            if (isProduction) {
                console.log("MODE: Production (Public/Online Access Enabled, HTTPS)");
            } else {
                console.log("MODE: Development (Localhost Access Only, HTTPS)");
            }
        }).on('error', (err) => {
            console.error('⚠️  Nabigo ang HTTPS listen, babalik sa plain HTTP:', err.message);
            app.listen(PORT, HOST, () => {
                console.log(`Server running at http://${HOST}:${PORT} (HTTPS fallback)`);
            });
        });
    } else {
        // BUG FIX (root cause ng "hindi mag-run nang ayos" / crash-loop
        // sa start.sh): dati, walang .on('error', ...) sa plain-HTTP
        // app.listen() dito (may error handler na lang ang HTTPS branch
        // sa itaas). Kapag may lumang/orphaned server.js pa ring
        // nakabuhol sa PORT (halimbawa: nag-Stop o nag-Restart gamit
        // ang widget pero hindi pa talaga natapos i-kill ang dating
        // proseso bago mag-restart), ang listen() ay naglalabas ng
        // EADDRINUSE na error na WALANG naghihintay na listener dito —
        // nagiging isang unhandled 'error' event ito sa EventEmitter,
        // na agad nagpapa-crash (uncaught exception) ng buong process.
        // Ito ang eksaktong crash-loop na nakikita sa
        // logs/supervisor.log (paulit-ulit na crash bawat ~5s, walang
        // "Server running..." na sumusulpot sa pagitan) — dahil bawat
        // pagsubok ng supervisor loop ay bumabangga rin agad sa parehong
        // nakaharang na PORT.
        // Ayos: hulihin ang 'error' event, ilabas nang malinaw kung ano
        // talaga ang problema (lalo na EADDRINUSE), tapos mag-exit(1) sa
        // paraang malinaw — sa halip na basta mag-crash nang tahimik.
        app.listen(PORT, HOST, () => {
            console.log(`Server running at http://${HOST}:${PORT}`);
            if (isProduction) {
                console.log("MODE: Production (Public/Online Access Enabled)");
            } else {
                console.log("MODE: Development (Localhost Access Only)");
            }
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`❌ Hindi ma-start ang server — GINAGAMIT NA ang PORT ${PORT} (malamang may dati/orphaned na server.js process na hindi pa talaga namatay). Patayin muna ang lumang proseso ("pkill -9 -f 'node server.js'") bago subukan ulit.`);
            } else {
                console.error('❌ Nabigo ang pag-start ng HTTP server:', err.message);
            }
            process.exit(1);
        });
    }

    // BUG FIX: karagdagang proteksyon habang tumatakbo — regular na
    // nag-p-push din ng snapshot papunta sa Postgres bawat 5 minuto,
    // hindi lang umaasa sa SIGTERM sa oras ng deploy.
    setInterval(() => {
        pushSnapshotToCloud().catch((err) => {
            console.error('⚠️  [cloud-snapshot] Nabigo ang scheduled push:', err.message);
        });
    }, 5 * 60 * 1000);
}

// BUG FIX: nagpapadala ang Render ng SIGTERM sa lumang container BAGO
// ito patayin sa susunod na deploy — gamitin ito bilang huling
// pagkakataon para ma-save ang pinakabagong datos sa Postgres bago
// mawala ang lokal na disk.
async function handleShutdownSignal(signal) {
    console.log(`ℹ️  Natanggap ang ${signal} — nagse-save muna ng huling snapshot sa Postgres bago mag-exit...`);
    try {
        await pushSnapshotToCloud();
    } catch (err) {
        console.error('⚠️  [cloud-snapshot] Nabigo ang shutdown push:', err.message);
    } finally {
        process.exit(0);
    }
}
process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));
process.on('SIGINT', () => handleShutdownSignal('SIGINT'));

startOmniposServer();
