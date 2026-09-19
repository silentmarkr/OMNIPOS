const dns = require('dns');
const crypto = require('crypto');

dns.setDefaultResultOrder('ipv4first');

const IS_RENDER = process.env.RENDER === 'true';

const SMTP_TIMEOUTS = IS_RENDER
    ? { connectionTimeout: 1800, greetingTimeout: 1500, socketTimeout: 4000 }
    : { connectionTimeout: 3500, greetingTimeout: 3000, socketTimeout: 8000 };

const _mailTransporterCache = new Map();
function getMailTransporter(user, pass, timeoutOverrides) {

    const effectiveTimeouts = { ...SMTP_TIMEOUTS, ...(timeoutOverrides || {}) };
    const key = `${user}::${pass}::${effectiveTimeouts.connectionTimeout}-${effectiveTimeouts.greetingTimeout}-${effectiveTimeouts.socketTimeout}`;
    if (_mailTransporterCache.has(key)) {
        return _mailTransporterCache.get(key);
    }
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,
        maxConnections: 3,
        auth: { user, pass },

        connectionTimeout: effectiveTimeouts.connectionTimeout,
        greetingTimeout: effectiveTimeouts.greetingTimeout,
        socketTimeout: effectiveTimeouts.socketTimeout,

        family: 4
    });
    _mailTransporterCache.set(key, transporter);
    return transporter;
}

function isNetworkLevelMailError(err) {
    if (!err) return false;

    if (err.responseCode) return false;
    const netCodes = ['ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'];
    if (err.code && netCodes.includes(err.code)) return true;
    return /connection timeout|greeting never received|timed?\s?out/i.test(err.message || '');
}

function getGmailApiFallbackConfig() {
    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;
    return { clientId, clientSecret, refreshToken };
}

async function getGmailApiAccessToken(cfg) {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            refresh_token: cfg.refreshToken,
            grant_type: 'refresh_token'
        })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.access_token) {
        throw new Error(`Could not obtain a Gmail API access token: ${data.error_description || data.error || resp.statusText}`);
    }
    return data.access_token;
}

function base64UrlEncode(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMimeMessage(mailOptions) {
    const boundary = `omnipos_${crypto.randomBytes(12).toString('hex')}`;
    const allAttachments = mailOptions.attachments || [];
    // FIX: the Gmail API HTTPS fallback used to send PLAIN TEXT only, silently
    // dropping the modern HTML e-receipt (layout, barcode, QR) whenever SMTP was
    // blocked (common on Render's free tier and on some mobile networks in
    // Termux, which is exactly why this fallback exists). It now honours
    // mailOptions.html (wrapped in multipart/alternative next to the text/plain
    // part) and attachments with `cid` / `inline: true` (sent as
    // Content-Disposition: inline inside multipart/related, matching what
    // nodemailer does on the normal SMTP path), so both delivery paths now
    // produce the same email.
    const inlineAttachments = allAttachments.filter(a => a && (a.cid || a.inline));
    const regularAttachments = allAttachments.filter(a => !(a && (a.cid || a.inline)));
    const hasHtml = typeof mailOptions.html === 'string' && mailOptions.html.length > 0;

    const encodedSubject = `=?UTF-8?B?${Buffer.from(mailOptions.subject || '', 'utf8').toString('base64')}?=`;
    const headers = [
        `From: ${mailOptions.from}`,
        `To: ${mailOptions.to}`,
        `Subject: ${encodedSubject}`,
        'MIME-Version: 1.0'
    ];

    function encodeAttachmentPart(att, disposition) {
        const contentType = att.contentType || 'application/octet-stream';
        const contentBuffer = att.encoding === 'base64'
            ? Buffer.from(att.content, 'base64')
            : Buffer.from(att.content, 'utf8');
        let part = `Content-Type: ${contentType}; name="${att.filename || 'file'}"\r\n`;
        if (att.cid) part += `Content-ID: <${att.cid}>\r\n`;
        part += `Content-Disposition: ${disposition}${att.filename ? `; filename="${att.filename}"` : ''}\r\n`;
        part += 'Content-Transfer-Encoding: base64\r\n\r\n';
        part += contentBuffer.toString('base64').replace(/(.{76})/g, '$1\r\n') + '\r\n';
        return part;
    }

    // Backward-compatible simple path: plain text only, no HTML, no inline
    // images. Output is identical to the previous behaviour, so existing
    // callers (e.g. OTP emails) are unaffected.
    if (!hasHtml && inlineAttachments.length === 0 && regularAttachments.length === 0) {
        headers.push('Content-Type: text/plain; charset="UTF-8"');
        headers.push('Content-Transfer-Encoding: base64');
        const body = Buffer.from(mailOptions.text || '', 'utf8').toString('base64');
        return headers.join('\r\n') + '\r\n\r\n' + body;
    }

    // Body core: text/plain only, or text/plain + text/html inside
    // multipart/alternative (so mail clients that can't render HTML still
    // have a fallback).
    let bodyCore;
    if (hasHtml) {
        const altBoundary = `omnipos_alt_${crypto.randomBytes(12).toString('hex')}`;
        bodyCore = `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`;
        bodyCore += `--${altBoundary}\r\n`;
        bodyCore += 'Content-Type: text/plain; charset="UTF-8"\r\n';
        bodyCore += 'Content-Transfer-Encoding: base64\r\n\r\n';
        bodyCore += Buffer.from(mailOptions.text || '', 'utf8').toString('base64') + '\r\n\r\n';
        bodyCore += `--${altBoundary}\r\n`;
        bodyCore += 'Content-Type: text/html; charset="UTF-8"\r\n';
        bodyCore += 'Content-Transfer-Encoding: base64\r\n\r\n';
        bodyCore += Buffer.from(mailOptions.html, 'utf8').toString('base64') + '\r\n\r\n';
        bodyCore += `--${altBoundary}--\r\n`;
    } else {
        bodyCore = 'Content-Type: text/plain; charset="UTF-8"\r\n';
        bodyCore += 'Content-Transfer-Encoding: base64\r\n\r\n';
        bodyCore += Buffer.from(mailOptions.text || '', 'utf8').toString('base64') + '\r\n';
    }

    // If there are inline images (barcode/QR referenced by the HTML via
    // cid:...), wrap the body core + inline images in multipart/related.
    let relatedPart;
    if (inlineAttachments.length > 0) {
        const relBoundary = `omnipos_rel_${crypto.randomBytes(12).toString('hex')}`;
        relatedPart = `Content-Type: multipart/related; boundary="${relBoundary}"\r\n\r\n`;
        relatedPart += `--${relBoundary}\r\n${bodyCore}\r\n`;
        for (const att of inlineAttachments) {
            relatedPart += `--${relBoundary}\r\n${encodeAttachmentPart(att, 'inline')}\r\n`;
        }
        relatedPart += `--${relBoundary}--\r\n`;
    } else {
        relatedPart = bodyCore;
    }

    // With no regular (non-inline) attachments, this is the whole message body.
    if (regularAttachments.length === 0) {
        return headers.join('\r\n') + '\r\n\r\n' + relatedPart;
    }

    // There are regular attachments too (e.g. the optional receipt
    // screenshot): wrap everything in an outer multipart/mixed.
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    let msg = headers.join('\r\n') + '\r\n\r\n';
    msg += `--${boundary}\r\n${relatedPart}\r\n`;
    for (const att of regularAttachments) {
        msg += `--${boundary}\r\n${encodeAttachmentPart(att, 'attachment')}\r\n`;
    }
    msg += `--${boundary}--`;
    return msg;
}

async function sendViaGmailApi(mailOptions) {
    const cfg = getGmailApiFallbackConfig();
    if (!cfg) {
        const err = new Error('GMAIL_API_FALLBACK_NOT_CONFIGURED');
        err.code = 'GMAIL_API_FALLBACK_NOT_CONFIGURED';
        throw err;
    }
    const accessToken = await getGmailApiAccessToken(cfg);
    const raw = base64UrlEncode(Buffer.from(buildMimeMessage(mailOptions), 'utf8'));
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const apiErr = new Error(`Gmail API send failed: ${data.error?.message || resp.statusText}`);
        apiErr.status = resp.status;
        apiErr.gmailReason = (data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason) || (data.error && data.error.status) || '';
        throw apiErr;
    }
    return data;
}

function buildSmtpBlockedMessage(err) {
    const detail = err && (err.code || err.message)
        ? ` (Details: ${err.code || err.message})`
        : '';

    if (IS_RENDER) {
        return `Could not connect to Gmail SMTP from this server${detail}. This is usually caused by Render (and other free-tier cloud hosts) blocking outbound SMTP ports 25/465/587 on FREE web services (Render's official policy since Sept 26, 2025). It is NOT a problem with your Gmail address or App Password. Fix: (1) upgrade the Render service to a paid instance type, or (2) set the GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN env vars on Render so the Gmail API (HTTPS) is used automatically as a fallback instead of SMTP.`;
    }

    return `Could not connect to Gmail SMTP from this server${detail}. Since this is not Render (local network / Termux), a hosting policy is unlikely to be the cause. More likely: (1) the device has no internet or an unstable connection right now, (2) your mobile carrier / ISP blocks outbound SMTP ports (25/465/587) on the network you are using, or (3) smtp.gmail.com could not be resolved (DNS). This is NOT a problem with your Gmail address or App Password (that would show up as an "Invalid login" / 535 error instead). Fix: (1) make sure you have a stable WiFi / mobile data connection, (2) try switching networks (WiFi <-> mobile data) and retry, or (3) set the GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN env vars as an HTTPS fallback that is not affected by SMTP port blocking.`;
}

// ---------------------------------------------------------------------------
// Friendly, user-facing explanations for mail failures.
//
// Gmail enforces a daily sending cap (roughly 500 emails/day for a free Gmail
// account, ~2,000/day for Google Workspace). When it is reached, Gmail answers
// with something like "550 5.4.5 Daily user sending limit exceeded" — which
// used to be shown to the cashier as raw SMTP text. describeMailError() turns
// that (and the other common failures) into a short message that says what
// happened and what to do next, plus a suggested HTTP status.
//
// NOTE: never return 401/402 from a route because of a mail failure — the
// frontend's authFetch() treats those as "session expired" / "feature locked".
// ---------------------------------------------------------------------------
const DAILY_LIMIT_RE = /daily (user )?sending (quota|limit)|daily limit exceeded|sending limit exceeded|\b5\d\d[ -]5\.4\.5\b/i;
const RATE_LIMIT_RE = /too many (login attempts|messages|recipients)|try again later|rate limit|temporarily (blocked|deferred|unavailable)|\b4\d\d[ -]4\.7\.0\b/i;
const AUTH_RE = /invalid login|username and password not accepted|application-specific password|\b5\d\d[ -]5\.7\.[89]\b/i;
const TOO_LARGE_RE = /message (size|too large)|exceeds .*size|too large/i;
const BAD_RECIPIENT_RE = /\b5\d\d[ -]5\.1\.\d\b|no such user|user unknown|does not exist|invalid (address|recipient)|mailbox unavailable|recipient address rejected/i;

function classifyMailError(err) {
    const e = err || {};
    const text = `${e.response || ''} ${e.message || ''}`;
    const rc = Number(e.responseCode) || 0;
    const status = Number(e.status) || 0;
    const reason = String(e.gmailReason || '');

    // Connectivity problems are checked FIRST and by error code, not by text:
    // buildSmtpBlockedMessage() deliberately mentions words like "Invalid login"
    // (to say that is NOT the problem), which would otherwise trip the regexes below.
    if (e.code === 'SMTP_BLOCKED_NO_FALLBACK' || isNetworkLevelMailError(e)) {
        return {
            code: 'MAIL_NETWORK_ERROR',
            httpStatus: 503,
            retryable: true,
            message: 'Could not reach Gmail from this device/server. Check the internet connection (or try another network) and try again.'
        };
    }
    if (DAILY_LIMIT_RE.test(text) || /dailyLimitExceeded/i.test(reason)) {
        return {
            code: 'GMAIL_DAILY_LIMIT',
            httpStatus: 429,
            retryable: true,
            message: 'Daily Gmail sending limit reached for this sender account. It should work again within 24 hours, or an Admin can switch to a different Sender Gmail (Users > Receipt Customization).'
        };
    }
    if (status === 429 || /rateLimitExceeded|userRateLimitExceeded/i.test(reason) || [421, 450, 451, 452, 454].includes(rc) || RATE_LIMIT_RE.test(text)) {
        return {
            code: 'GMAIL_RATE_LIMITED',
            httpStatus: 429,
            retryable: true,
            message: 'Gmail is temporarily limiting this sender account (it may be close to its daily limit). Please wait a few minutes and try again, or switch to another Sender Gmail.'
        };
    }
    if (e.code === 'EAUTH' || rc === 534 || rc === 535 || AUTH_RE.test(text)) {
        return {
            code: 'GMAIL_AUTH_FAILED',
            httpStatus: 502,
            retryable: false,
            message: 'Gmail rejected the sender login. An Admin needs to re-enter the Sender Gmail and a new 16-character App Password (Users > Receipt Customization).'
        };
    }
    if (rc === 552 || TOO_LARGE_RE.test(text)) {
        return {
            code: 'MAIL_TOO_LARGE',
            httpStatus: 413,
            retryable: false,
            message: 'The email is too large for Gmail to accept.'
        };
    }
    if (e.code === 'EENVELOPE' || rc === 501 || rc === 553 || ((rc === 550 || rc === 0) && BAD_RECIPIENT_RE.test(text))) {
        return {
            code: 'MAIL_BAD_RECIPIENT',
            httpStatus: 422,
            retryable: false,
            message: 'The email could not be delivered to that address. Please double-check the customer\'s email address.'
        };
    }
    return {
        code: 'MAIL_SEND_FAILED',
        httpStatus: 500,
        retryable: false,
        message: `Could not send the email: ${e.message || 'unknown error'}`
    };
}

// Convenience wrapper: { code, message, httpStatus, retryable }
function describeMailError(err) {
    return classifyMailError(err);
}

async function sendMailSmart(user, pass, mailOptions, timeoutOverrides) {
    let smtpErr;
    try {
        const transporter = getMailTransporter(user, pass, timeoutOverrides);
        return await transporter.sendMail(mailOptions);
    } catch (err) {
        if (!isNetworkLevelMailError(err)) throw err;

        smtpErr = err;
    }

    try {
        const result = await sendViaGmailApi(mailOptions);
        console.warn(`✉️ [MAIL FALLBACK] SMTP was blocked / timed out (${smtpErr.code || smtpErr.message}) — email was sent successfully via the Gmail REST API (HTTPS) fallback.`);
        return result;
    } catch (fallbackErr) {
        if (fallbackErr.code === 'GMAIL_API_FALLBACK_NOT_CONFIGURED') {
            const err2 = new Error(buildSmtpBlockedMessage(smtpErr));
            err2.code = 'SMTP_BLOCKED_NO_FALLBACK';
            throw err2;
        }
        throw fallbackErr;
    }
}

async function verifyMailCredentialsSmart(user, pass, timeoutOverrides) {
    let smtpErr;
    try {
        const transporter = getMailTransporter(user, pass, timeoutOverrides);
        await transporter.verify();
        return { verified: true, viaFallback: false };
    } catch (err) {
        if (!isNetworkLevelMailError(err)) throw err;
        
        smtpErr = err;
    }

    const fallbackCfg = getGmailApiFallbackConfig();
    if (fallbackCfg) {
        await getGmailApiAccessToken(fallbackCfg);
        return { verified: true, viaFallback: true };
    }

    return {
        verified: false,
        viaFallback: false,
        skippedReason: IS_RENDER ? 'RENDER_SMTP_BLOCKED' : 'SMTP_BLOCKED',
        errorCode: smtpErr && smtpErr.code,
        errorMessage: smtpErr && smtpErr.message
    };
}

module.exports = {
    IS_RENDER,
    SMTP_TIMEOUTS,
    getMailTransporter,
    isNetworkLevelMailError,
    getGmailApiFallbackConfig,
    getGmailApiAccessToken,
    sendViaGmailApi,
    sendMailSmart,
    verifyMailCredentialsSmart,
    buildSmtpBlockedMessage,
    classifyMailError,
    describeMailError
};
