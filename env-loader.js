'use strict';
/**
 * env-loader.js (v2 — robust auto-detect)
 *
 * Binabasa ang .env at ilalagay ang mga value nito sa process.env.
 *
 * MAHALAGANG AYOS (kumpara sa v1): hindi na basta AASSUME na ciphertext
 * ang laman ng .env base lang sa "may naka-embed na key ba ako". Sa
 * SELF-UPDATE, ang .env ay PRESERVED (hindi napapalitan) para hindi
 * mawala ang custom settings ng client — kaya posibleng LUMANG PLAIN
 * .env pa rin ito kahit bagong obfuscated loader (may totoong key) na
 * ang tumatakbo. Kung basta ipipilit na i-JSON.parse ang plain text,
 * mag-crash ang buong server (nangyari na ito — "Unexpected token 'R'").
 *
 * Sa bersyon na ito: sinusubukan munang i-decrypt bilang ciphertext;
 * kung hindi ito valid na encrypted shape (hindi JSON, o walang
 * iv/tag/data), GRACEFULLY babalik ito sa plain KEY=VALUE parsing sa
 * halip na mag-crash. Kaya gumagana ito kahit anong kombinasyon ng
 * luma/bagong .env at luma/bagong loader.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Papalitan ito ng build-release.js/RELAY ng tunay na 64-hex-char
// (32-byte) key sa release build. Huwag baguhin nang manu-mano.
const RELEASE_KEY_HEX = '__ENV_KEY_HEX__';

function tryDecrypt(raw, keyHex) {
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch (_e) {
        return null; // Hindi JSON — plain .env format ito, hindi ciphertext.
    }
    if (!payload || typeof payload !== 'object' || !payload.iv || !payload.tag || !payload.data) {
        return null; // JSON siya, pero hindi tugma sa inaasahang {iv,tag,data} shape.
    }

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
    const hasEmbeddedKey = RELEASE_KEY_HEX !== '__ENV_KEY_HEX__';

    if (hasEmbeddedKey) {
        try {
            const decrypted = tryDecrypt(raw, RELEASE_KEY_HEX);
            if (decrypted !== null) {
                applyEnvText(decrypted);
                return;
            }
            // Hindi ito valid na encrypted format (hal. lumang preserved
            // plaintext .env mula sa self-update) — ituloy sa plain
            // fallback sa ibaba, HUWAG mag-crash.
        } catch (err) {
            console.error('⚠️  May error sa pag-decrypt ng .env, babalik sa plain fallback:', err.message);
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
