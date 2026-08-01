'use strict';
/**
 * env-loader.js
 *
 * Binabasa ang .env at ilalagay ang mga value nito sa process.env.
 *
 * - Sa DEV (source code mo, kapag hindi pa dumaan sa build-release.js):
 *   naka-placeholder pa ang RELEASE_KEY_HEX sa ibaba, kaya babalik lang
 *   ito sa normal na process.loadEnvFile() — plain KEY=VALUE, gagana pa
 *   rin ang lokal na testing mo nang walang extra hakbang.
 *
 * - Sa RELEASE build (pagkatapos ng `npm run build:release`): pinapalitan
 *   ng build-release.js ang RELEASE_KEY_HEX ng tunay na random key BAGO
 *   i-obfuscate ang file na ito, at ang .env na kasama sa release ay
 *   naka-encrypt na (AES-256-GCM) — kaya kung buksan ng customer/client
 *   ang .env gamit ang text editor, makikita lang niya ay walang-kahulugang
 *   ciphertext, hindi ang totoong RELAY_API_KEY/RELAY_URL, atbp.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Papalitan ito ng build-release.js ng tunay na 64-hex-char (32-byte) key.
// Huwag baguhin nang manu-mano.
const RELEASE_KEY_HEX = '__ENV_KEY_HEX__';

function decryptEnvFile(envPath, keyHex) {
    const raw = fs.readFileSync(envPath, 'utf8');
    const payload = JSON.parse(raw);

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

    const isReleaseBuild = RELEASE_KEY_HEX !== '__ENV_KEY_HEX__';

    if (isReleaseBuild) {
        try {
            const decrypted = decryptEnvFile(envPath, RELEASE_KEY_HEX);
            applyEnvText(decrypted);
        } catch (err) {
            console.error('⚠️  Hindi mabasa/ma-decrypt ang .env ng release build:', err.message);
            process.exit(1);
        }
        return;
    }

    // Dev mode — plain .env pa, gamitin ang built-in Node loader.
    process.loadEnvFile();
};
