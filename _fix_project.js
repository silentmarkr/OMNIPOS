const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== OmniPOS: Public folder + Security Patch ===\n');

if (fs.existsSync('server.js')) {
  fs.copyFileSync('server.js', 'server.js.bak');
  console.log('Backup ginawa: server.js.bak');
}

if (!fs.existsSync('public')) {
  fs.mkdirSync('public');
  console.log('Ginawa: public/ folder');
}

const toMove = [
  'index.html', 'app.js', 'style.css',
  'css', 'webfonts', 'fontawesome.min.css',
  'JsBarcode.all.min.js', 'html5-qrcode.min.js', 'sweetalert2.all.min.js'
];
toMove.forEach(name => {
  const dest = path.join('public', name);
  if (fs.existsSync(name) && !fs.existsSync(dest)) {
    fs.renameSync(name, dest);
    console.log('Nailipat:', name, '-> public/');
  } else if (fs.existsSync(dest)) {
    console.log('Nasa public/ na:', name);
  } else {
    console.log('Wala/hindi nahanap, skipped:', name);
  }
});

let s = fs.readFileSync('server.js', 'utf8');
let changes = 0;
function patch(oldStr, newStr, label) {
  if (s.includes(oldStr)) {
    s = s.split(oldStr).join(newStr);
    changes++;
    console.log('Na-patch:', label);
  } else {
    console.log('Skip (baka na-patch na dati):', label);
  }
}

patch(
  "app.use(express.static(__dirname, {",
  "app.use(express.static(path.join(__dirname, 'public'), {",
  'Static file serving (public/ folder na lang, hindi buong project)'
);

patch(
  "return res.status(401).json({ success: false, message: 'Maling Admin Password. Hindi pinahintulutan ang aksyong ito.' });",
  "return res.status(403).json({ success: false, code: 'WRONG_ADMIN_PASSWORD', message: 'Maling Admin Password. Hindi pinahintulutan ang aksyong ito.' });",
  'verifyAdmin - wrong password (401->403)'
);

patch(
  'return res.status(401).json({ success: false, message: "Maling Admin password. Hindi pinahintulutan ang pag-restore." });',
  'return res.status(403).json({ success: false, code: \'WRONG_ADMIN_PASSWORD\', message: "Maling Admin password. Hindi pinahintulutan ang pag-restore." });',
  'restore-backup - wrong password (401->403)'
);

patch(
  "return res.status(401).json({ success: false, message: 'Maling Admin Password. Hindi pinahintulutan ang void.' });",
  "return res.status(403).json({ success: false, code: 'WRONG_ADMIN_PASSWORD', message: 'Maling Admin Password. Hindi pinahintulutan ang void.' });",
  'void endpoint - wrong password (401->403)'
);

patch(
  "return res.status(401).json({ success: false, message: 'Maling Admin Password!' });",
  "return res.status(403).json({ success: false, code: 'WRONG_ADMIN_PASSWORD', message: 'Maling Admin Password!' });",
  'verify-void endpoint - wrong password (401->403)'
);

fs.writeFileSync('server.js', s);
console.log('\n' + changes + '/5 patches applied sa server.js.');

try {
  execSync('node --check server.js', { stdio: 'inherit' });
  console.log('\nVALID ang server.js — okay na i-restart ang server (node server.js).');
} catch (e) {
  console.log('\nMAY SYNTAX ERROR — i-restore mula sa server.js.bak.');
}
