// build-release.js
//
// Ginagamit ito ng DEVELOPER (hindi ng kliyente) para gumawa ng malinis
// na zip na ipapadala sa RELAY para ma-download ng bagong kliyente.
//
// TINATANGGAL dito ang lahat ng bagay na HINDI dapat isama sa isang
// bagong install: .git history, .env (may secrets), database/ (data ng
// ibang kliyente), node_modules (ipapa-npm-install nila sa sariling
// device), backups, at logs.
//
// Usage:
//   node build-release.js
//   -> lalabas: ./release/omnipos-client.zip
//
// Pagkatapos, ilipat/kopyahin ang zip papunta sa RELAY project:
//   cp release/omnipos-client.zip ../RELAY/release/omnipos-client.zip
//
// (kailangan mo munang gumawa ng "release/" folder sa RELAY kung wala
// pa: mkdir -p ../RELAY/release)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUT_DIR = path.join(__dirname, 'release');
const OUT_FILE = path.join(OUT_DIR, 'omnipos-client.zip');

const EXCLUDES = [
    '.git',
    '.git/*',
    'node_modules',
    'node_modules/*',
    'database',
    'database/*',
    '.env',
    '*.log',
    'release',
    'release/*',
    '*.patch'
];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);

// Gumagamit ng zip CLI na (karaniwang available sa Linux/Termux/macOS).
// Kung Windows ang ginagamit mong build machine, palitan ito ng
// "archiver" npm package sa halip.
const excludeArgs = EXCLUDES.map(p => `-x "${p}"`).join(' ');
const cmd = `cd "${__dirname}" && zip -r "${OUT_FILE}" . ${excludeArgs}`;

console.log('Gumagawa ng release zip...');
execSync(cmd, { stdio: 'inherit' });
console.log(`✅ Nagawa: ${OUT_FILE}`);
console.log('Huwag kalimutang i-set ang bagong .env (RELAY_URL, RELAY_API_KEY, atbp.) sa panig ng kliyente pagkatapos i-extract nila ito.');
