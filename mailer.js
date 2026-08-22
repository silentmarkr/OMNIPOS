

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
        throw new Error(`Hindi makakuha ng Gmail API access token: ${data.error_description || data.error || resp.statusText}`);
    }
    return data.access_token;
}

function base64UrlEncode(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMimeMessage(mailOptions) {
    const boundary = `omnipos_${crypto.randomBytes(12).toString('hex')}`;
    const allAttachments = mailOptions.attachments || [];
    // BUG FIX (Gmail API HTTPS fallback silently dropping the modern HTML
    // e-receipt — barcode/QR/layout — down to plain text): dati, ang
    // function na ito ay TEXT-ONLY pa rin gaano man "richer" ang
    // mailOptions na ipinasa (walang alam tungkol sa mailOptions.html o sa
    // `cid`/`inline` na attachments). Kaya kapag na-block ang SMTP (karaniwan
    // sa Render free tier o sa mga naka-block na mobile network sa Termux —
    // ito mismo ang dahilan kung bakit umiiral itong fallback path) at
    // bumagsak papunta dito ang pagpapadala, nakukuha pa rin ng customer ang
    // resibo, pero PLAIN TEXT LANG — walang layout, walang barcode, walang
    // QR — kahit successful naman ang buong build ng modernized e-receipt sa
    // caller side. Ngayon, kinikilala na rito ang mailOptions.html (ilalagay
    // sa loob ng multipart/alternative kasabay ng text/plain) at ang mga
    // attachment na may `cid`/`inline: true` (ilalagay bilang
    // Content-Disposition: inline sa loob ng multipart/related, kasing-tugma
    // ng ginagawa ng nodemailer sa normal na SMTP path) — kaya magkatugma na
    // ang dalawang paraan ng pagpapadala (SMTP kontra Gmail API fallback).
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

    // Backward-compatible simple path: plain text lang, walang html, walang
    // inline images — parehong output pa rin ito ng dating code (walang
    // pagbabago sa behavior ng ibang existing na tumatawag dito, hal. OTP
    // emails).
    if (!hasHtml && inlineAttachments.length === 0 && regularAttachments.length === 0) {
        headers.push('Content-Type: text/plain; charset="UTF-8"');
        headers.push('Content-Transfer-Encoding: base64');
        const body = Buffer.from(mailOptions.text || '', 'utf8').toString('base64');
        return headers.join('\r\n') + '\r\n\r\n' + body;
    }

    // Body core: text/plain lang, o text/plain + text/html sa loob ng
    // multipart/alternative (para may fallback pa rin ang mga mail client na
    // hindi nagre-render ng HTML).
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

    // Kung may inline images (barcode/QR na ire-reference ng HTML via
    // cid:...), ibalot ang body core + inline images sa multipart/related.
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

    // Kung walang regular (non-inline) attachments, ito na lang ang buong
    // katawan ng mensahe.
    if (regularAttachments.length === 0) {
        return headers.join('\r\n') + '\r\n\r\n' + relatedPart;
    }

    // May regular attachments pa (hal. ang optional na receipt screenshot)
    // — ibalot lahat sa panlabas na multipart/mixed.
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
        throw new Error(`Gmail API send failed: ${data.error?.message || resp.statusText}`);
    }
    return data;
}

function buildSmtpBlockedMessage(err) {
    const detail = err && (err.code || err.message)
        ? ` (Detalye: ${err.code || err.message})`
        : '';

    if (IS_RENDER) {
        return `Hindi maka-konekta sa Gmail SMTP mula sa server na ito${detail}. KARANIWAN itong dulot ng Render (at ibang free-tier cloud host) na nag-block ng outbound SMTP ports 25/465/587 sa mga FREE web services (opisyal na patakaran ito ng Render mula Set. 26, 2025) — HINDI ito problema sa iyong Gmail address o App Password. Solusyon: (1) i-upgrade ang Render service sa paid instance type, o (2) i-configure ang GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN env vars sa Render para awtomatikong gumamit ng Gmail API (HTTPS) bilang fallback sa halip na SMTP.`;
    }

    return `Hindi maka-konekta sa Gmail SMTP mula sa server na ito${detail}. Dahil hindi ito Render (lokal na network/Termux ito), HINDI malamang na server hosting policy ang dahilan — malamang ito ay: (1) pansamantalang walang/unstable na internet connection ang device sa oras ng pagsubok, (2) bina-block ng mobile carrier/ISP mo ang outbound SMTP ports (25/465/587) sa network na ginagamit mo, o (3) pansamantalang hindi na-resolve ang smtp.gmail.com (DNS). HINDI ito problema sa iyong Gmail address o App Password (kung magkaiba ang error na ito sa isang "Invalid login"/535 error). Solusyon: (1) tiyaking may stable na WiFi/mobile data connection, (2) subukang lumipat ng network (WiFi ↔ mobile data) at ulitin, o (3) i-configure ang GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN env vars bilang HTTPS fallback na hindi apektado ng SMTP port issues.`;
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
        console.warn(`✉️ [MAIL FALLBACK] Na-block/nag-timeout ang SMTP (${smtpErr.code || smtpErr.message}) — matagumpay na naipadala gamit ang Gmail REST API (HTTPS) fallback.`);
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
    buildSmtpBlockedMessage
};
