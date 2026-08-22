#!/usr/bin/env node
'use strict';

try {
    require('./env-loader')();
} catch (_err) {

}

const mailer = require('./mailer');

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--user') out.user = argv[++i];
        else if (argv[i] === '--pass') out.pass = argv[++i];
    }
    return out;
}

function getCredentialsFromDb() {
    try {
        const { readData } = require('./db');
        const settings = readData('receiptSettings', {});
        if (settings && settings.otpSenderEmail && settings.otpSenderAppPassword) {
            return { user: settings.otpSenderEmail, pass: settings.otpSenderAppPassword, source: 'database/omnipos.db (Receipt Customization > OTP Sender Email)' };
        }
    } catch (_err) {

    }
    return null;
}

function resolveCredentials(argv) {
    const cli = parseArgs(argv);
    if (cli.user && cli.pass) {
        return { user: cli.user, pass: cli.pass, source: '--user / --pass argument' };
    }
    if (process.env.OTP_MAIL_USER && process.env.OTP_MAIL_PASS) {
        return { user: process.env.OTP_MAIL_USER, pass: process.env.OTP_MAIL_PASS, source: 'OTP_MAIL_USER / OTP_MAIL_PASS env vars' };
    }
    const fromDb = getCredentialsFromDb();
    if (fromDb) return fromDb;
    return null;
}

function maskEmail(email) {
    if (!email || !email.includes('@')) return email || '(wala)';
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0] || ''}***@${domain}`;
    return `${local.slice(0, 2)}***@${domain}`;
}

async function main() {
    console.log('=======================================================');
    console.log(' OMNIPOS — Gmail Connection Verification (standalone)');
    console.log('=======================================================\n');

    console.log(`Environment: ${mailer.IS_RENDER ? 'Render (o katulad na cloud host na may RENDER=true)' : 'Local / Termux / sariling server'}`);
    console.log(`SMTP timeouts na gagamitin: connect=${mailer.SMTP_TIMEOUTS.connectionTimeout}ms, greeting=${mailer.SMTP_TIMEOUTS.greetingTimeout}ms, socket=${mailer.SMTP_TIMEOUTS.socketTimeout}ms\n`);

    const oauthCfg = mailer.getGmailApiFallbackConfig();
    console.log(`Gmail API/OAuth fallback env vars (GMAIL_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN): ${oauthCfg ? 'NAKA-CONFIGURE ✅' : 'HINDI naka-configure ⚠️'}\n`);

    const creds = resolveCredentials(process.argv.slice(2));
    if (!creds) {
        console.error('❌ Walang nahanap na Sender Gmail credentials para subukan.');
        console.error('   Ilagay ang isa sa mga sumusunod:');
        console.error('     - node verify-gmail-connection.js --user you@gmail.com --pass "16 char app password"');
        console.error('     - i-set ang OTP_MAIL_USER / OTP_MAIL_PASS na env vars');
        console.error('     - i-configure muna ang Sender Gmail sa Receipt Customization panel ng app');
        process.exitCode = 1;
        return;
    }

    console.log(`Susubukang i-verify: ${maskEmail(creds.user)}  (pinagmulan: ${creds.source})\n`);
    console.log('Sinusubukan (1) SMTP/App Password muna, saka lang (2) Gmail API/OAuth fallback kung talagang nabigo ang SMTP...\n');

    try {
        const result = await mailer.verifyMailCredentialsSmart(creds.user, creds.pass);

        if (result.verified && !result.viaFallback) {
            console.log('✅ SUCCESS — Gumana ang direktang SMTP/App Password connection papunta sa Gmail.');
            console.log('   Walang kailangang gawin pa — gagana ang pagpapadala ng OTP/resibo dito.');
        } else if (result.verified && result.viaFallback) {
            console.log('✅ SUCCESS (via Gmail API/OAuth fallback) — Na-block ang SMTP dito (karaniwan sa Render');
            console.log('   free tier), pero gumana ang Gmail API/HTTPS fallback. Gagana ang pagpapadala ng');
            console.log('   OTP/resibo dito gamit ang fallback na ito.');
        } else {
            console.log('⚠️  HINDI ma-verify: naka-block ang SMTP dito (karaniwan sa Render free tier) at');
            console.log('   WALANG naka-configure na Gmail API/OAuth fallback. Ang App Password mismo ay');
            console.log('   HINDI pa nasusuri — tanggapin na lang muna ito bilang "unverified", pero hindi');
            console.log('   gagana ang aktwal na pagpapadala ng email hangga\'t hindi na-a-ayos ito.');
            console.log('\n   Solusyon: (1) i-upgrade ang Render service sa paid instance type, o');
            console.log('             (2) i-configure ang GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET /');
            console.log('                 GMAIL_OAUTH_REFRESH_TOKEN env vars para awtomatikong gumamit ng');
            console.log('                 Gmail API (HTTPS) bilang fallback sa halip na SMTP.');
            process.exitCode = 1;
        }
    } catch (err) {
        console.error(`❌ FAILED — ${err.message}`);
        if (err.code === 'SMTP_BLOCKED_NO_FALLBACK') {

        } else {
            console.error('\n   Ito ay maaaring credential-level na error (hal. maling email/App Password),');
            console.error('   HINDI network-level — siguraduhing 16-character Gmail App Password ang');
            console.error('   ginamit (hindi ang normal na account password), at tama ang email.');
        }
        process.exitCode = 1;
    }
}

main();
