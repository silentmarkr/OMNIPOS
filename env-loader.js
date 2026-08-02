'use strict';
/**
 * env-loader.js (v3 — key sa hiwalay na .env.key file)
 *
 * Binabasa ang .env at ilalagay ang mga value nito sa process.env.
 *
 * BAKIT NAGBAGO MULA V2 (FIX #1 — "DEVICE REVOKED" / hindi ma-verify
 * ang device pagkatapos ng self-update):
 * Dati, ini-embed ang AES key DIRETSO sa obfuscated code ng loader na
 * ito (RELEASE_KEY_HEX), at BAWAT "I-build ang Release" ay gumagawa ng
 * BAGONG random key. Pero sa SELF-UPDATE, ang .env ay PRESERVED (hindi
 * napapalitan — tama iyon, para hindi mawala ang settings), samantalang
 * ang env-loader.js MISMO ay PINAPALITAN ng bagong build (may BAGONG
 * key). Resulta: hindi na magkatugma ang key ng lumang naka-encrypt na
 * .env sa bagong loader — laging "Unsupported state or unable to
 * authenticate data" (GCM auth failure) sa bawat self-update mula roon,
 * kaya nawawala ang RELAY_API_KEY/RELAY_URL sa process.env at nabibigo
 * ang device verification/login.
 *
 * FIX: ang key ay hindi na naka-bake sa code ng loader — nasa sarili
 * niyang file na ito ngayon, ".env.key" (hex string), KATABI ng .env.
 * Parehong PRESERVED ang .env AT .env.key sa self-update (tingnan ang
 * SELF_UPDATE_PRESERVE sa server.js), kaya magkatugma pa rin sila kahit
 * ilang beses pang mag-rebuild/mag-self-update ang loader code mismo.
 *
 * FIX #2 (nakatago dating bug sa fallback): dati, kapag NABIGO ang
 * decrypt (auth error — hal. mismatched key), hinuhuli lang ang error
 * tapos itinutuloy pa rin ang "plain fallback" gamit ang ORIHINAL na
 * raw text — pero kung naka-JSON/ciphertext SHAPE na ito ({iv,tag,data}),
 * hindi talaga ito valid na KEY=VALUE na format, kaya WALANG talagang
 * na-lo-load na tamang env var (walang crash, pero tahimik na sira).
 * Ngayon, kung ciphertext ang SHAPE pero nabigo ang decrypt (auth
 * error), hindi na ito basta ipinipilit na i-KEY=VALUE parse — malinaw
 * na inilalabas ang error sa halip.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_KEY_FILENAME = '.env.key';

function looksLikeCiphertextShape(raw) {
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch (_e) {
        return null; // Hindi JSON — plain .env format ito, hindi ciphertext.
    }
    if (!payload || typeof payload !== 'object' || !payload.iv || !payload.tag || !payload.data) {
        return null; // JSON siya, pero hindi tugma sa inaasahang {iv,tag,data} shape.
    }
    return payload;
}

function decryptPayload(payload, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const data = Buffer.from(payload.data, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function applyEnvText(text) {
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;

        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();

        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }

        if (!(key in process.env)) {
            process.env[key] = val;
        }
    }
}

module.exports = function loadEnv() {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;

    const raw = fs.readFileSync(envPath, 'utf8');
    const keyPath = path.join(process.cwd(), ENV_KEY_FILENAME);
    const hasKeyFile = fs.existsSync(keyPath);

    const ciphertextPayload = looksLikeCiphertextShape(raw);

    if (ciphertextPayload) {
        // Naka-encrypt na format ang .env (JSON {iv,tag,data}) — kailangan
        // talaga ng tamang .env.key para mabasa ito. Kung mawala/mali ito,
        // huwag na ituloy sa plain KEY=VALUE parsing (garbage lang ang
        // malalabas doon dahil JSON ito, hindi KEY=VALUE) — sa halip,
        // malinaw na sabihin kung ano ang mali.
        if (!hasKeyFile) {
            console.error(
                `⚠️  Naka-encrypt ang .env pero WALANG ${ENV_KEY_FILENAME} — hindi mababasa ang tunay na config (RELAY_URL/RELAY_API_KEY/atbp.). Ito ang dahilan kung bakit nabibigong ma-verify ang device sa login. Kailangan i-restore ang tamang ${ENV_KEY_FILENAME} (kasabay dapat ito ng .env mula sa parehong build), o i-reset ang .env sa plain KEY=VALUE format.`
            );
            return;
        }
        try {
            const keyHex = fs.readFileSync(keyPath, 'utf8').trim();
            const decrypted = decryptPayload(ciphertextPayload, keyHex);
            applyEnvText(decrypted);
            return;
        } catch (err) {
            console.error(
                `⚠️  May error sa pag-decrypt ng .env gamit ang ${ENV_KEY_FILENAME} (posibleng hindi magkatugma ang key at .env — hal. mula sa magkaibang build): ${err.message}. Hindi ituloy sa plain fallback dahil ciphertext ang laman ng .env — kailangan ng tamang key o bagong plain .env.`
            );
            return;
        }
    }

    // Plain KEY=VALUE .env — dev mode, o lumang preserved .env mula
    // sa self-update na hindi pa naka-encrypt.
    try {
        applyEnvText(raw);
    } catch (err) {
        console.error('⚠️  Hindi mabasa ang .env:', err.message);
    }
};
