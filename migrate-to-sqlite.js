// ====================================================================
// migrate-to-sqlite.js — Isahang-beses na migration script
// ====================================================================
// Gamitin ito NANG ISANG BESES lang para ilipat ang laman ng iyong
// dating mga JSON files (sa loob ng /database folder) papunta sa
// bagong SQLite database (database/omnipos.db).
//
// Paano gamitin:
//   node migrate-to-sqlite.js
//
// Ligtas itong patakbuhin nang paulit-ulit — kung nakita nitong may
// laman na ang isang module sa SQLite, ise-skip na lang niya 'yon
// (hindi ito mag-o-overwrite ng existing SQLite data).
// ====================================================================

const fs = require('fs');
const path = require('path');
const { db, readData, writeData } = require('./db');

const DB_DIR = path.join(__dirname, 'database');

const MODULES = [
    { module: 'users', file: 'users.json', defaultData: [] },
    { module: 'products', file: 'products.json', defaultData: [] },
    { module: 'transactions', file: 'transactions.json', defaultData: [] },
    { module: 'userlogs', file: 'userlogs.json', defaultData: [] },
    { module: 'requests', file: 'requests.json', defaultData: [] },
    { module: 'categories', file: 'categories.json', defaultData: ['Beverages', 'Dairy', 'Snacks', 'Bakery', 'Grains'] },
    { module: 'carts', file: 'carts.json', defaultData: {} }
];

console.log('🔄 Sinisimulan ang migration mula sa JSON files papunta sa SQLite...\n');

const checkStmt = db.prepare('SELECT data FROM store WHERE module = ?');

let migrated = 0;
let skipped = 0;

for (const { module, file, defaultData } of MODULES) {
    const existingRow = checkStmt.get(module);

    if (existingRow) {
        console.log(`⏭️  "${module}" — mayroon nang data sa SQLite, ni-skip.`);
        skipped++;
        continue;
    }

    const jsonPath = path.join(DB_DIR, file);

    if (!fs.existsSync(jsonPath)) {
        console.log(`ℹ️  "${module}" — walang nahanap na ${file}, sinimulan gamit ang default data.`);
        writeData(module, defaultData);
        migrated++;
        continue;
    }

    try {
        const content = fs.readFileSync(jsonPath, 'utf8');
        const data = (content && content.trim() !== '') ? JSON.parse(content) : defaultData;
        writeData(module, data);

        const count = Array.isArray(data) ? data.length : Object.keys(data).length;
        console.log(`✅ "${module}" — na-migrate mula sa ${file} (${count} records).`);
        migrated++;
    } catch (err) {
        console.error(`❌ "${module}" — hindi mabasa ang ${file}, ginamit na lang ang default data.`, err.message);
        writeData(module, defaultData);
        migrated++;
    }
}

console.log(`\n🎉 Tapos na ang migration! ${migrated} module(s) na-migrate, ${skipped} na-skip.`);
console.log(`📦 Ang bagong database ay narito: ${path.join(DB_DIR, 'omnipos.db')}`);
console.log(`\n⚠️  Huwag pang burahin ang mga lumang .json files hangga't hindi mo pa na-verify na gumagana nang tama ang system gamit ang SQLite.`);
