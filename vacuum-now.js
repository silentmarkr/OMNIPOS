const { vacuumDatabase, DB_PATH } = require('./db');
const fs = require('fs');

const before = fs.statSync(DB_PATH).size;
console.log(`📦 Database file: ${DB_PATH}`);
console.log(`📏 Size bago mag-vacuum: ${(before / 1024 / 1024).toFixed(2)} MB (${before} bytes)`);
console.log('⏳ Nagko-compact ngayon (VACUUM)... maaaring tumagal depende sa laki...');

const result = vacuumDatabase();

if (!result.success) {
    console.error('❌ Nabigo ang vacuum:', result.message);
    process.exit(1);
}

const after = fs.statSync(DB_PATH).size;
console.log(`✅ Vacuum complete.`);
console.log(`📏 Size pagkatapos mag-vacuum: ${(after / 1024 / 1024).toFixed(2)} MB (${after} bytes)`);
console.log(`💾 Napaliit ng: ${((before - after) / 1024 / 1024).toFixed(2)} MB`);
process.exit(0);
