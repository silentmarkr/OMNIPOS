/**
 * mailer.js
 *
 * AYOS (refactor): Dating nakatago ito bilang unang ~330 linya ng
 * server.js, kaya walang paraan para i-verify/subukan ang Gmail
 * connection nang hiwalay sa buong POS server (kailangan pang buuin ang
 * buong app, mag-login, atbp. bago pa lang malaman kung gumagana ang
 * SMTP/App Password/OAuth fallback). Dito, hiwalay na module ito na:
 *   1. Ginagamit ng server.js (require('./mailer')) — walang pagbabago
 *      sa gamit/behavior mula sa dating server.js.
 *   2. Ginagamit din ng verify-gmail-connection.js — isang standalone
 *      CLI tool na kasama sa release package (omnipos-client.zip) para
 *      ma-verify ng customer/admin ang Gmail connection nang hiwalay,
 *      bago pa man patakbuhin ang buong server (o kahit anong oras
 *      pagkatapos, para mag-diagnose).
 *
 * Tatlong kondisyon na sinusunod ng module na ito:
 *   (1) Gumagana pa rin ang Gmail sa Termux/local network o kahit anong
 *       local storage/setup ng customer — hindi ito apektado dahil ang
 *       SMTP ay palaging susubukan muna (walang special-case na
 *       nag-sa-skip nito sa local), at gumagana na ito doon dati pa man
 *       (walang port block sa local network).
 *   (2) Nakahiwalay na module ito (hindi bahagi ng server.js), at
 *       kasama sa release build/package (see build-release.js).
 *   (3) Ang Gmail API/OAuth (ang "pangalawang paraan") ay susubukan LANG
 *       kapag talagang nabigo/na-block ang SMTP attempt (network-level
 *       na error) — hindi na ito basta-basta nilalaktawan kahit pa sa
 *       Render, para tunay na "fallback" ito, hindi "primary path".
 *       Para pumasa pa rin ito sa 6-segundong client-side timeout
 *       budget (AUTH_FETCH_TIMEOUT_MS sa public/app.js) kahit
 *       maka-block ang SMTP, pinaikli ang connect/greeting timeout
 *       lalo na kapag naka-deploy sa Render (see RENDER_SMTP_TIMEOUTS
 *       sa ibaba) — mabilis lang mag-fail ang naka-blockna SMTP attempt
 *       bago pumunta sa HTTPS fallback, sa halip na buong 8s+.
 */

const dns = require('dns');
const crypto = require('crypto');

// 🔌 AYOS: "connect ENETUNREACH <ipv6-address>:465" kapag nagpapadala ng
// email (Gmail OTP, resibo, factory reset backup, atbp.) sa Render/ibang
// cloud host. Root cause: gumagamit ang Node ng "verbatim" DNS result
// order by default (mula Node 18+), kaya kapag nag-resolve ng
// "smtp.gmail.com" pwedeng IPv6 address ang unang ibalik. TAMA at
// gumagana ang credentials/App Password — network-level lang ito: WALANG
// gumaganang IPv6 outbound route ang maraming cloud host (kasama si
// Render, lalo na sa free tier), kaya bumabagsak agad ang koneksyon sa
// IPv6 address bago pa man ma-verify ang Gmail login. Sa lokal na
// network/Termux, gumagana ang IPv6 kaya doon OK lang — kaya
// "gumagana sa local pero hindi pag naka-deploy" ang sintomas.
// AYOS: pilitin ang IPv4 muna sa LAHAT ng DNS lookup ng buong process
// (kasama ang ginagamit ni nodemailer/Node's TLS socket sa ibaba).
dns.setDefaultResultOrder('ipv4first');

// Awtomatikong naka-set ito ng Render mismo sa lahat ng service doon
// (env var na "RENDER=true"). Ginagamit lang ito ngayon para pumili ng
// mas MAIKLING SMTP timeout (para hindi maubos ang 6s client-side
// budget bago pa man makarating sa HTTPS fallback) — HINDI na ito
// ginagamit para basta-basta LAKTAWAN ang SMTP attempt (dati ganito, pero
// kondisyon #3: dapat SMTP muna palagi ang subukan, saka lang bumaba sa
// fallback kung talagang hindi gumana).
const IS_RENDER = process.env.RENDER === 'true';

// Kapag naka-deploy sa Render (o kahit anong cloud host na nagtatakda ng
// RENDER=true), alam na nating malamang naka-block ang outbound SMTP
// ports — kaya pinaiikli dito ang connect/greeting timeout ng UNANG
// SMTP attempt para mabilis lang itong mag-fail (kung talagang
// naka-block) at may sapat pa ring oras para sa HTTPS fallback bago
// mag-abort ang 6-segundong client-side timeout. Sa local/Termux
// (walang port block), gumagamit pa rin ng mas mahaba/normal na timeout
// dahil malamang magtagumpay naman talaga ang SMTP doon.
const SMTP_TIMEOUTS = IS_RENDER
    ? { connectionTimeout: 1800, greetingTimeout: 1500, socketTimeout: 4000 }
    : { connectionTimeout: 3500, greetingTimeout: 3000, socketTimeout: 8000 };

// ====================================================================
// SHARED, CACHED NODEMAILER TRANSPORTER
// ====================================================================
// Dati, bawat email-sending endpoint (OTP, receipt, factory reset backup,
// atbp.) ay gumagawa ng BAGONG nodemailer transporter/connection sa
// bawat request — hindi ito efficient (bagong TCP/TLS handshake papunta
// sa Gmail sa bawat email). Dito, iisang transporter na lang ang ginawa
// PER (user, pass) na pares at ginagamit ulit-ulit (connection pooling
// via "pool: true"), kaya mas mabilis at mas magaan sa resources ang
// pagpapadala ng maramihang email nang magkakasunod.
const _mailTransporterCache = new Map();
function getMailTransporter(user, pass) {
    const key = `${user}::${pass}`;
    if (_mailTransporterCache.has(key)) {
        return _mailTransporterCache.get(key);
    }
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,
        maxConnections: 3,
        auth: { user, pass },
        // AYOS: dati nakapirmi ang 8000/8000/15000 — masyadong mabagal ito
        // kumpara sa AUTH_FETCH_TIMEOUT_MS (6000ms) sa frontend
        // (public/app.js). Ngayon, iba-iba depende kung Render ba o hindi
        // (see SMTP_TIMEOUTS sa itaas) — sa Render, mas maiksi para
        // mabilis mag-fail ang naka-blockna SMTP attempt at agad na
        // makapag-fallback (o mag-report ng malinaw na error) habang nasa
        // loob pa ng client-side na 6s na budget. Sa local/Termux, mas
        // mahaba dahil gumagana naman talaga ang SMTP doon at hindi na
        // kailangang magmadali.
        connectionTimeout: SMTP_TIMEOUTS.connectionTimeout,
        greetingTimeout: SMTP_TIMEOUTS.greetingTimeout,
        socketTimeout: SMTP_TIMEOUTS.socketTimeout,
        // 🔌 Dagdag na proteksyon (bukod sa dns.setDefaultResultOrder sa
        // itaas ng file): pinipilit dito mismo sa socket-level na IPv4
        // (family: 4) ang gagamitin papuntang Gmail SMTP, para hindi na
        // umasa sa default DNS resolution behavior kahit pa magbago ito
        // sa susunod na Node.js version.
        family: 4
    });
    _mailTransporterCache.set(key, transporter);
    return transporter;
}

// ====================================================================
// GMAIL FALLBACK (Gmail REST API sa HTTPS) PARA SA "GUMAGANA SA
// LOCAL/TERMUX PERO FAILED/TIMEOUT LAGI SA RENDER" NA ISYU
// ====================================================================
// ROOT CAUSE (hindi ito credential/App-Password problem): kinukumpirma
// mismo ng opisyal na Render changelog na ang mga FREE web services sa
// Render ay hindi na pinapayagang gumawa ng outbound connection papunta
// sa SMTP ports 25, 465, at 587 mula pa noong Sept 26, 2025 — ito ang
// dahilan kung bakit ang eksaktong parehong Gmail App Password ay
// gumagana nang walang error sa lokal na network / Termux (walang
// firewall/port block doon), pero laging nag-ti-timeout/nagfa-fail sa
// Render (na-block na sa network level ang koneksyon papuntang
// smtp.gmail.com bago pa man makapag-authenticate). Walang paraan sa
// SIDE ng code (DNS order, IPv4-first, ibang port, mas mahabang
// timeout) para malampasan ito — kailangan alinman sa: (1) i-upgrade
// ang Render service sa paid instance type (bukas ulit ang mga port na
// iyon doon), o (2) lumipat sa isang paraan ng pagpapadala ng email na
// dumadaan sa HTTPS/443 sa halip na raw SMTP — hindi ito bino-block ng
// Render dahil kailangan din ito para tumakbo ang web server mismo.
//
// Dito, gumagawa tayo ng OPTIONAL na Gmail REST API (HTTPS) fallback:
// kapag na-detect na SMTP-level (hindi credential-level) na error ang
// nangyari — gaya ng ETIMEDOUT/ECONNREFUSED/ESOCKET, na siyang lagi at
// laging sintomas ng naka-block na port sa Render — awtomatikong
// susubukan nitong ipadala ang email sa pamamagitan ng Gmail REST API
// sa halip, GAMIT PA RIN ang parehong Gmail account. Kailangan lang
// i-configure minsan ang mga sumusunod na env vars sa Render Dashboard
// (Google Cloud OAuth2 client + isang beses na na-generate na refresh
// token — hindi ito ang App Password):
//   GMAIL_OAUTH_CLIENT_ID
//   GMAIL_OAUTH_CLIENT_SECRET
//   GMAIL_OAUTH_REFRESH_TOKEN
// Kung hindi ito naka-configure, hindi na basta-basta bumabagsak ang
// server sa isang malabong "invalid credentials" na error — sa halip,
// malinaw na sasabihin sa admin na Render network restriction ito, at
// hindi maling Gmail/App Password.

function isNetworkLevelMailError(err) {
    if (!err) return false;
    // May "responseCode" (hal. 535) kapag NAKAPAG-KONEKTA na ang socket
    // at TUMUGON ang Gmail SMTP server mismo (ibig sabihin totoong
    // credential/authentication error ito, hindi network block) — kaya
    // hindi ito dapat ituring na network-level error.
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

// Gumagawa ng raw RFC 2822 MIME message (plain text, may optional
// attachment/s) — ito ang format na kailangan ng Gmail REST API's
// "messages.send" endpoint (base64url-encoded sa loob ng "raw" field).
function buildMimeMessage(mailOptions) {
    const boundary = `omnipos_${crypto.randomBytes(12).toString('hex')}`;
    const attachments = mailOptions.attachments || [];
    const encodedSubject = `=?UTF-8?B?${Buffer.from(mailOptions.subject || '', 'utf8').toString('base64')}?=`;
    const headers = [
        `From: ${mailOptions.from}`,
        `To: ${mailOptions.to}`,
        `Subject: ${encodedSubject}`,
        'MIME-Version: 1.0'
    ];

    if (!attachments.length) {
        headers.push('Content-Type: text/plain; charset="UTF-8"');
        headers.push('Content-Transfer-Encoding: base64');
        const body = Buffer.from(mailOptions.text || '', 'utf8').toString('base64');
        return headers.join('\r\n') + '\r\n\r\n' + body;
    }

    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    let msg = headers.join('\r\n') + '\r\n\r\n';
    msg += `--${boundary}\r\n`;
    msg += 'Content-Type: text/plain; charset="UTF-8"\r\n';
    msg += 'Content-Transfer-Encoding: base64\r\n\r\n';
    msg += Buffer.from(mailOptions.text || '', 'utf8').toString('base64') + '\r\n\r\n';

    for (const att of attachments) {
        const contentType = att.contentType || 'application/octet-stream';
        const contentBuffer = att.encoding === 'base64'
            ? Buffer.from(att.content, 'base64')
            : Buffer.from(att.content, 'utf8');
        msg += `--${boundary}\r\n`;
        msg += `Content-Type: ${contentType}; name="${att.filename}"\r\n`;
        msg += `Content-Disposition: attachment; filename="${att.filename}"\r\n`;
        msg += 'Content-Transfer-Encoding: base64\r\n\r\n';
        msg += contentBuffer.toString('base64').replace(/(.{76})/g, '$1\r\n') + '\r\n\r\n';
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

const SMTP_BLOCKED_MESSAGE = 'Hindi maka-konekta sa Gmail SMTP mula sa server na ito. KARANIWAN itong dulot ng Render (at ibang free-tier cloud host) na nag-block ng outbound SMTP ports 25/465/587 sa mga FREE web services (opisyal na patakaran ito ng Render mula Set. 26, 2025) — HINDI ito problema sa iyong Gmail address o App Password. Solusyon: (1) i-upgrade ang Render service sa paid instance type, o (2) i-configure ang GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN env vars sa Render para awtomatikong gumamit ng Gmail API (HTTPS) bilang fallback sa halip na SMTP.';

// Pinag-isang paraan ng pagpapadala ng email na ginagamit ng LAHAT ng
// endpoint (OTP, resibo, factory-reset backup, atbp.), gaya na rin ng
// standalone na verify-gmail-connection.js:
//
//   KONDISYON #3 — ALWAYS SMTP MUNA, saka lang FALLBACK: susubukan
//   PALAGING muna ang pagpapadala via SMTP/App Password (gaya dati,
//   mabilis at gumagana sa local/Termux — hindi ito nilalaktawan kahit
//   naka-deploy sa Render). Kapag NABIGO ito dahil sa network-level na
//   error lang (gaya ng laging nangyayari sa Render free tier dahil sa
//   naka-block na SMTP ports — ETIMEDOUT/ECONNREFUSED/atbp., HINDI
//   maling password), saka lang awtomatikong susubukan ang Gmail REST
//   API (HTTPS) bilang fallback kung naka-configure — kung hindi,
//   malinaw na sasabihing Render/cloud-host SMTP port block ito.
async function sendMailSmart(user, pass, mailOptions) {
    try {
        const transporter = getMailTransporter(user, pass);
        return await transporter.sendMail(mailOptions);
    } catch (err) {
        if (!isNetworkLevelMailError(err)) throw err;
        // bumaba papunta sa fallback sa ibaba — SMTP lang mismo ang
        // nabigo sa network level, hindi credential/authentication error
    }

    try {
        const result = await sendViaGmailApi(mailOptions);
        console.warn('✉️ [MAIL FALLBACK] Na-block/nag-timeout ang SMTP (karaniwan sa Render free tier) — matagumpay na naipadala gamit ang Gmail REST API (HTTPS) fallback.');
        return result;
    } catch (fallbackErr) {
        if (fallbackErr.code === 'GMAIL_API_FALLBACK_NOT_CONFIGURED') {
            const err2 = new Error(SMTP_BLOCKED_MESSAGE);
            err2.code = 'SMTP_BLOCKED_NO_FALLBACK';
            throw err2;
        }
        throw fallbackErr;
    }
}

// Gaya ng sendMailSmart, pero para sa transporter.verify() (ginagamit
// kapag unang sino-save ang Sender Gmail + App Password sa settings
// panel, at ng verify-gmail-connection.js). Sinusunod din nito ang
// KONDISYON #3: SMTP verify muna palagi, fallback sa Gmail API access
// token check LANG kung talagang nabigo ang SMTP sa network level.
// MAHALAGA ito: kung hindi ito aayusin, kahit TAMA ang credentials,
// hinding-hindi ito mave-verify/mase-save sa Render dahil sa parehong
// SMTP port block — permanenteng naka-block ang admin sa pag-configure
// ng OTP sender email kahit tama lahat ng inilagay niya.
async function verifyMailCredentialsSmart(user, pass) {
    try {
        const transporter = getMailTransporter(user, pass);
        await transporter.verify();
        return { verified: true, viaFallback: false };
    } catch (err) {
        if (!isNetworkLevelMailError(err)) throw err;
        // bumaba papunta sa fallback sa ibaba
    }

    const fallbackCfg = getGmailApiFallbackConfig();
    if (fallbackCfg) {
        await getGmailApiAccessToken(fallbackCfg);
        return { verified: true, viaFallback: true };
    }

    // Walang paraan na ma-verify ang SMTP dito (Render port block) —
    // huwag itong ituring na maling password; tanggapin na lang bilang
    // "unverified" at gamitin pa rin — gagana ito sa totoong
    // pagpapadala via sendMailSmart() kung may fallback na naka-configure,
    // o malinaw na mag-eerror (Render network restriction) kung wala.
    return { verified: false, viaFallback: false, skippedReason: IS_RENDER ? 'RENDER_SMTP_BLOCKED' : 'SMTP_BLOCKED' };
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
    SMTP_BLOCKED_MESSAGE
};
