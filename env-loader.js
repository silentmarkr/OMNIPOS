'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_KEY_FILENAME = '.env.key';

function looksLikeCiphertextShape(raw) {
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch (_e) {
        return null; 
    }
    if (!payload || typeof payload !== 'object' || !payload.iv || !payload.tag || !payload.data) {
        return null; 
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

    
    try {
        applyEnvText(raw);
    } catch (err) {
        console.error('⚠️  Hindi mabasa ang .env:', err.message);
    }
};
