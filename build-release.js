

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { Worker } = require("worker_threads");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, "release", "OMNIPOS");
// Persistent cache lives outside the customer release directory and is excluded from packages.
const OBFUSCATION_CACHE_DIR = path.join(ROOT, "release", ".obfuscation-cache");
const OBFUSCATION_CACHE_MANIFEST = path.join(OBFUSCATION_CACHE_DIR, "manifest.json");
const OBFUSCATION_CACHE_SCHEMA = 2;
const DEFAULT_OBFUSCATION_WORKER_TIMEOUT_MS = 15 * 60 * 1000;

const EXCLUDE = new Set([
  "node_modules",
  ".git",
  "release",
  "database",
  "uploads_tmp",
  "server.log",
  "cf.log",
  "package-lock.json",
  ".gitignore",
  // SYNC FIX: itinugma sa BUILD_EXCLUDE_NAMES ng RELAY (server.js) —
  // dati'y wala ito rito kahit idinagdag na sa RELAY's remote build
  // endpoint. Dahil dito rin (build-release.js) direkta tumatakbo sa
  // live/production na directory (hindi fresh git-clone gaya ng RELAY),
  // kung may naiwang .start.sh.lock (dahil tumatakbo ang server.js
  // habang isinasagawa ang build na ito), masasama ito sa resulting
  // omnipos-client.zip.
  ".start.sh.lock",
  // BUG FIX: idinagdag ang self-update backup dir (server.js's
  // SELF_UPDATE_BACKUP_DIR) — runtime artifact lang ito na ginagawa ng
  // server.js sa installRoot bago mag-apply ng self-update (para may
  // maibalik kung mabigo/ma-interrupt ang update), parehong dahilan
  // gaya ng ".start.sh.lock" sa itaas: kung direkta tumatakbo ang build
  // na ito sa live/production na directory, huwag itong isama sa
  // resulting omnipos-client.zip.
  ".self-update-backup",
  // BUG FIX: dev/build-only tooling na nasasama pala sa omnipos-client.zip
  // dahil wala silang exclude entry — hindi ito runtime files ng client:
  //   - build-release.js / obfuscate-worker.js: ito mismo ang build script
  //     at ang worker nito. Nangangailangan ng javascript-obfuscator
  //     (devDependency, hindi ini-install ng `npm install --omit=dev` sa
  //     client), kaya patay na code lang sa client — at naglalantad pa ng
  //     buong obfuscation config/EXCLUDE list (dapat confidential).
  //   - start.sh.bak: stray backup file lang, walang gamit sa client.
  //   - vacuum-now.js: developer-only diagnostic CLI — redundant na dahil
  //     may built-in auto-vacuum na ang server.js pagkatapos ng hard reset
  //     (vacuumDatabase() sa db.js).
  "build-release.js",
  "obfuscate-worker.js",
  "start.sh.bak",
  "vacuum-now.js",
  // SYNC FIX: itinugma sa INTEGRITY_SCAN_EXCLUDE_NAMES ng server.js —
  // runtime cache lang ito na ginagawa ng fetchCloudBackupPricing()
  // (huling nakuhang Cloud Backup pricing mula RELAY), hindi dapat
  // isama sa release package kahit ito lang nangyaring naiwan sa
  // working copy bago mag-build.
  "cloud-backup-pricing-cache.json",
]);

const EXCLUDE_EXTENSIONS = new Set([".patch", ".log"]);

const SERVER_TARGETS = new Set([
  "server.js",
  "db.js",
  "migrate-to-sqlite.js",
  "_fix_project.js",
  "mailer.js",
  "verify-gmail-connection.js",
  // SYNC FIX: idinagdag ang cloud-snapshot.js at webauthn.js — pareho
  // itong direktang require()-d ng server.js (Postgres backup/restore
  // logic at WebAuthn/passkey verification, kasama ang CBOR decode) pero
  // nakaligtaan dati, kaya na-e-excempt sa obfuscation at pumupunta
  // plain-text sa release/OMNIPOS.
  "cloud-snapshot.js",
  "webauthn.js",
  // New backend modules require()-d by server.js (BIR compliance + UOM/price-level math).
  "bir-compliance.js",
  "uom-pricing.js",
  // Marketplace Hub (Shopee/Lazada/TikTok) server module — require()-d by server.js.
  "marketplace-sync.js",
]);

const ENV_LOADER_FILENAME = "env-loader.js";
const ENV_FILENAME = ".env";
const ENV_KEY_FILENAME = ".env.key";

const CLIENT_TARGETS = new Set([
  path.join("public", "app.js"),
  // SYNC FIX: itinugma sa RELEASE_CLIENT_TARGETS ng RELAY (server.js) —
  // nakaligtaan dati ang public/app1.js (Branch Intelligence & Safety
  // Extension) kahit proprietary code rin ito na kasabay ng app.js, kaya
  // plaintext ito sa omnipos-client.zip kapag lokal ang build.
  path.join("public", "app1.js"),
  path.join("public", "marketplace-ui.js"),
  path.join("public", "bt-printer.js"),
  // Printer Device Settings (Bluetooth brand presets + WiFi/LAN network
  // printing) — proprietary code, must ship/obfuscate alongside bt-printer.js.
  path.join("public", "printer-manager.js"),
  // USB printing (WebUSB / Web Serial / server bridge client) — proprietary code, must ship/obfuscate with the other printer files.
  path.join("public", "usb-printer.js"),
  path.join("public", "faq-engine.js"),
  path.join("public", "faq-knowledge.js"),
  path.join("public", "faq-knowledge.en.js"),
  path.join("public", "faq-lang.js"),
  // SYNC FIX: itinugma sa RELEASE_CLIENT_TARGETS ng RELAY (server.js) —
  // nakaligtaan dati ang public/service-worker.js kahit proprietary code
  // rin ito (cache-shell list, PWA logic), hindi third-party lib.
  path.join("public", "service-worker.js"),
  // BUG FIX: idinagdag ang public/offline-storage.js — wala ito sa dating
  // listahan kahit naka-load ito sa index.html, kaya plaintext ito sa
  // client. Walang katumbas na entry dati sa RELEASE_CLIENT_TARGETS ng
  // RELAY (server.js) kaya itinugma rin doon sa parehong fix na ito.
  path.join("public", "offline-storage.js"),
]);

// BUG FIX: dating walang HTML handling ang build script na ito kahit isa —
// lahat ng public/*.html (kabilang ang index.html, na may mahigit 300 linya
// ng inline <script>) ay napupunta sa plan.copy nang buo at plaintext sa
// omnipos-client.zip. Itinugma sa RELEASE_HTML_TARGETS ng RELAY (server.js):
// ang mga file sa listahang ito ay io-obfuscate ang kanilang inline
// <script> blocks (external/empty scripts tulad ng <script src="...">
// ay hindi ginagalaw).
const HTML_TARGETS = new Set([
  path.join("public", "index.html"),
  path.join("public", "customer-display.html"),
  // BUG FIX: naiwan din dati ang inventory-tools.html (110KB, may inline
  // script) sa parehong listahan ng RELAY bago ito maitama — kaya plaintext
  // ang business logic nito sa dalawang build path. Idinagdag dito at sa
  // RELAY's RELEASE_HTML_TARGETS (server.js) nang sabay.
  path.join("public", "inventory-tools.html"),
]);

const THIRD_PARTY_JS = new Set([
  path.join("public", "JsBarcode.all.min.js"),
  path.join("public", "html5-qrcode.min.js"),
  path.join("public", "sweetalert2.all.min.js"),
]);

const LARGE_FILE_BYTES = 100 * 1024; 

const baseServerObfOptions = {
  compact: true,
  target: "node",
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.15,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 12,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

const baseClientObfOptions = {
  ...baseServerObfOptions,
  target: "browser",
  
  controlFlowFlatteningThreshold: 0.3,
  deadCodeInjectionThreshold: 0.1,
  selfDefending: true,
  debugProtection: false,
};

const largeServerObfOptions = {
  ...baseServerObfOptions,
  controlFlowFlatteningThreshold: 0.1,
  deadCodeInjectionThreshold: 0.04,
};
const largeClientObfOptions = {
  ...baseClientObfOptions,
  controlFlowFlatteningThreshold: 0.08,
  deadCodeInjectionThreshold: 0.03,
};

function pickObfOptions(srcPath, isClient) {
  const isLarge = fs.statSync(srcPath).size >= LARGE_FILE_BYTES;
  if (isClient) return isLarge ? largeClientObfOptions : baseClientObfOptions;
  return isLarge ? largeServerObfOptions : baseServerObfOptions;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(srcPath, destPath) {
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(srcPath, destPath);
}

function getObfuscationWorkerTimeoutMs() {
  const configured = Number(process.env.OMNIPOS_OBFUSCATION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 60000
    ? Math.floor(configured)
    : DEFAULT_OBFUSCATION_WORKER_TIMEOUT_MS;
}

function looksAlreadyObfuscated(code) {
  // javascript-obfuscator commonly emits repeated hexadecimal identifiers.
  // This is deliberately conservative: only skip when there are several
  // matching markers, reducing the chance of skipping ordinary source code.
  const markers = String(code).match(/\b_0x[0-9a-f]{4,}\b/gi);
  return Boolean(markers && markers.length >= 5);
}

function looksAlreadyObfuscatedFile(srcPath) {
  try {
    return looksAlreadyObfuscated(fs.readFileSync(srcPath, "utf8"));
  } catch (_) {
    return false;
  }
}

function obfuscateInWorker(srcPath, destPath, options) {
  if (looksAlreadyObfuscatedFile(srcPath)) {
    ensureDir(path.dirname(destPath));
    if (path.resolve(srcPath) !== path.resolve(destPath)) fs.copyFileSync(srcPath, destPath);
    console.log(`  [already obfuscated; preserved] ${path.relative(ROOT, srcPath)}`);
    return Promise.resolve(false);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "obfuscate-worker.js"), {
      workerData: { srcPath, destPath, options },
    });
    let settled = false;
    const timeoutMs = getObfuscationWorkerTimeoutMs();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      reject(new Error(`Obfuscation timed out after ${Math.round(timeoutMs / 60000)} minutes: ${path.relative(ROOT, srcPath)}. Try a lighter large-file profile or inspect available RAM.`));
    }, timeoutMs);
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    worker.on("message", (msg) => {
      if (msg && msg.ok) {
        console.log(`  [obfuscated] ${path.relative(ROOT, srcPath)}`);
        finish();
      } else {
        finish(new Error((msg && msg.error) || `Obfuscation worker failed: ${path.relative(ROOT, srcPath)}`));
      }
    });
    worker.on("error", finish);
    worker.on("exit", (code) => {
      if (code !== 0) finish(new Error(`Worker for ${path.relative(ROOT, srcPath)} exited with code ${code}`));
      else if (!settled) finish(new Error(`Worker for ${path.relative(ROOT, srcPath)} exited without returning a result`));
    });
  });
}


// BUG FIX: bagong function — tumatawag sa obfuscate-worker.js sa "code mode"
// (walang srcPath/destPath, string lang ang ipinapasok at ibinabalik), para
// ma-obfuscate ang inline <script> content ng HTML targets sa sarili nitong
// thread (hindi hinaharang ang main thread), kaparehong paraan ng RELAY's
// server.js. Itinugma rin sa obfuscate-worker.js (idinagdag doon ang "code
// mode" na ito) nang sabay sa pagdaragdag ng function na ito.
function obfuscateCodeInWorker(code, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "obfuscate-worker.js"), {
      workerData: { code, options },
    });
    let settled = false;
    const timeoutMs = getObfuscationWorkerTimeoutMs();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      reject(new Error(`Inline-script obfuscation timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
    }, timeoutMs);
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    worker.on("message", (msg) => {
      if (msg && msg.ok && typeof msg.obfuscatedCode === "string") finish(null, msg.obfuscatedCode);
      else if (msg && msg.ok) finish(new Error("Inline-script worker returned no obfuscated code."));
      else finish(new Error((msg && msg.error) || "Inline-script obfuscation worker failed."));
    });
    worker.on("error", finish);
    worker.on("exit", (code2) => {
      if (code2 !== 0) finish(new Error(`Worker for inline script exited with code ${code2}`));
      else if (!settled) finish(new Error("Inline-script worker exited without returning a result."));
    });
  });
}

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function shouldSkipInlineScript(attrStr, content) {
  if (/\bsrc\s*=/i.test(attrStr) || !content.trim()) return true;

  // Only transform executable JavaScript. JSON-LD, import maps, and other
  // data/template script blocks must remain byte-for-byte intact.
  const typeMatch = attrStr.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const scriptType = typeMatch ? String(typeMatch[1] || typeMatch[2] || typeMatch[3] || "").trim().toLowerCase() : "";
  const executableTypes = new Set([
    "", "module", "text/javascript", "application/javascript", "text/ecmascript",
    "application/ecmascript", "text/x-javascript", "application/x-javascript"
  ]);
  if (!executableTypes.has(scriptType)) return true;

  // Some working copies may already contain obfuscated inline blocks. Re-running
  // javascript-obfuscator over its self-defending output can break execution.
  // Conservatively keep blocks with repeated hexadecimal identifier signatures.
  if (looksAlreadyObfuscated(content)) return true;
  return false;
}

async function obfuscateHtmlInlineScripts(html, options) {
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  const matches = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrStr = m[1] || "";
    const content = m[2];
    matches.push({ index: m.index, fullMatch: m[0], attrStr, content, skip: shouldSkipInlineScript(attrStr, content) });
  }
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += html.slice(cursor, match.index);
    if (match.skip) {
      result += match.fullMatch;
    } else {
      const obfuscated = await obfuscateCodeInWorker(match.content, options);
      result += `<script${match.attrStr}>${obfuscated}</script>`;
    }
    cursor = match.index + match.fullMatch.length;
  }
  result += html.slice(cursor);
  return result;
}

async function processHtmlTarget(srcPath, destPath) {
  let html = fs.readFileSync(srcPath, "utf8");
  html = stripHtmlComments(html);
  html = await obfuscateHtmlInlineScripts(html, pickObfOptions(srcPath, true));
  ensureDir(path.dirname(destPath));
  fs.writeFileSync(destPath, html, "utf8");
  console.log(`  [obfuscated] ${path.relative(ROOT, srcPath)} (inline scripts)`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getObfuscatorVersion() {
  try {
    let cursor = path.dirname(require.resolve("javascript-obfuscator"));
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.join(cursor, "package.json");
      if (fs.existsSync(candidate)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
          if (pkg.name === "javascript-obfuscator" && pkg.version) return pkg.version;
        } catch (_) {}
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  } catch (_) {}
  return "unknown";
}

function loadObfuscationCacheManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OBFUSCATION_CACHE_MANIFEST, "utf8"));
    if (parsed && parsed.schemaVersion === OBFUSCATION_CACHE_SCHEMA && parsed.entries && typeof parsed.entries === "object") {
      return parsed;
    }
  } catch (_) {}
  return { schemaVersion: OBFUSCATION_CACHE_SCHEMA, entries: {} };
}

function atomicWriteFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tempPath, data);
    fs.renameSync(tempPath, filePath);
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
  }
}

function getObfuscationCacheIdentity(srcPath, options, kind = "js") {
  const relativePath = path.relative(ROOT, srcPath).split(path.sep).join("/");
  const sourceHash = sha256(fs.readFileSync(srcPath));
  const optionsHash = sha256(Buffer.from(JSON.stringify({
    options,
    obfuscatorVersion: getObfuscatorVersion(),
    nodeMajor: process.versions.node.split(".")[0],
    cacheSchema: OBFUSCATION_CACHE_SCHEMA,
    kind,
  })));
  const entryKey = `${relativePath}::${kind}`;
  const cacheKey = sha256(Buffer.from(`${entryKey}\0${sourceHash}\0${optionsHash}`));
  return { relativePath, entryKey, kind, sourceHash, optionsHash, cacheKey };
}

async function obfuscateWithCache(job, options, oldEntries, newEntries) {
  const { srcPath, destPath } = job;
  const identity = getObfuscationCacheIdentity(srcPath, options, "js");
  const cachePath = path.join(OBFUSCATION_CACHE_DIR, `${identity.cacheKey}.js`);
  const oldEntry = oldEntries[identity.entryKey];

  if (oldEntry && oldEntry.sourceHash === identity.sourceHash && oldEntry.optionsHash === identity.optionsHash && oldEntry.cacheKey === identity.cacheKey && oldEntry.outputHash && fs.existsSync(cachePath)) {
    try {
      const cachedOutput = fs.readFileSync(cachePath);
      if (sha256(cachedOutput) === oldEntry.outputHash) {
        ensureDir(path.dirname(destPath));
        fs.writeFileSync(destPath, cachedOutput);
        newEntries[identity.entryKey] = { ...identity, outputHash: oldEntry.outputHash };
        console.log(`  [cache hit] ${identity.relativePath}`);
        return "cached";
      }
    } catch (_) {}
  }

  const didObfuscate = await obfuscateInWorker(srcPath, destPath, options);
  const output = fs.readFileSync(destPath);
  const outputHash = sha256(output);
  atomicWriteFile(cachePath, output);
  newEntries[identity.entryKey] = { ...identity, outputHash };
  return didObfuscate === false ? "preserved" : "obfuscated";
}

async function obfuscateHtmlWithCache(job, options, oldEntries, newEntries) {
  const { srcPath, destPath } = job;
  const identity = getObfuscationCacheIdentity(srcPath, options, "html-inline");
  const cachePath = path.join(OBFUSCATION_CACHE_DIR, `${identity.cacheKey}.html`);
  const oldEntry = oldEntries[identity.entryKey];

  if (oldEntry && oldEntry.sourceHash === identity.sourceHash && oldEntry.optionsHash === identity.optionsHash && oldEntry.cacheKey === identity.cacheKey && oldEntry.outputHash && fs.existsSync(cachePath)) {
    try {
      const cachedOutput = fs.readFileSync(cachePath);
      if (sha256(cachedOutput) === oldEntry.outputHash) {
        ensureDir(path.dirname(destPath));
        fs.writeFileSync(destPath, cachedOutput);
        newEntries[identity.entryKey] = { ...identity, outputHash: oldEntry.outputHash };
        console.log(`  [cache hit] ${identity.relativePath} (inline HTML scripts)`);
        return "cached";
      }
    } catch (_) {}
  }

  await processHtmlTarget(srcPath, destPath);
  const output = fs.readFileSync(destPath);
  const outputHash = sha256(output);
  atomicWriteFile(cachePath, output);
  newEntries[identity.entryKey] = { ...identity, outputHash };
  return "obfuscated";
}

function pruneObfuscationCache(entries) {
  const keep = new Set(Object.values(entries).map((entry) => `${entry.cacheKey}.${entry.kind === "html-inline" ? "html" : "js"}`));
  try {
    for (const name of fs.readdirSync(OBFUSCATION_CACHE_DIR)) {
      if (name === path.basename(OBFUSCATION_CACHE_MANIFEST)) continue;
      if ((name.endsWith(".js") || name.endsWith(".html")) && !keep.has(name)) {
        try { fs.unlinkSync(path.join(OBFUSCATION_CACHE_DIR, name)); } catch (_) {}
      }
    }
  } catch (_) {}
}


function encryptEnvAndPatchLoader() {
  const envSrcPath = path.join(ROOT, ENV_FILENAME);
  const loaderSrcPath = path.join(ROOT, ENV_LOADER_FILENAME);

  if (!fs.existsSync(envSrcPath) || !fs.existsSync(loaderSrcPath)) {
    console.warn(
      `  [skip] No ${ENV_FILENAME} and/or ${ENV_LOADER_FILENAME} at root — env config will not be encrypted.`
    );
    return Promise.resolve();
  }

  // Never ship the RELAY master credential inside the customer package. The customer
  // activates once and receives a revocable, installation-bound client credential.
  const sourceEnv = fs.readFileSync(envSrcPath, "utf8");
  const plaintext = sourceEnv.split(/\r?\n/).filter((line) => !/^\s*(?:export\s+)?RELAY_API_KEY\s*=/.test(line)).join("\n");
  const key = crypto.randomBytes(32); 
  const iv = crypto.randomBytes(12); 

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("base64"),
  };

  const destEnvPath = path.join(OUT_DIR, ENV_FILENAME);
  ensureDir(path.dirname(destEnvPath));
  fs.writeFileSync(destEnvPath, JSON.stringify(payload), "utf8");
  console.log(`  [encrypted] ${ENV_FILENAME}  ->  release/OMNIPOS/${ENV_FILENAME}`);

  const destKeyPath = path.join(OUT_DIR, ENV_KEY_FILENAME);
  fs.writeFileSync(destKeyPath, key.toString("hex"), "utf8");
  console.log(`  [key] wrote ${ENV_KEY_FILENAME}  ->  release/OMNIPOS/${ENV_KEY_FILENAME}`);

  const destLoaderPath = path.join(OUT_DIR, ENV_LOADER_FILENAME);
  ensureDir(path.dirname(destLoaderPath));
  fs.copyFileSync(loaderSrcPath, destLoaderPath);
  return obfuscateInWorker(destLoaderPath, destLoaderPath, baseServerObfOptions).then((didObfuscate) => {
    if (didObfuscate === false) console.log(`  [already obfuscated; preserved] ${ENV_LOADER_FILENAME}`);
    else console.log(`  [obfuscated] ${ENV_LOADER_FILENAME}`);
  });
}

function planTree(dir, baseRel, plan) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(baseRel, entry.name);
    const full = path.join(dir, entry.name);

    if (EXCLUDE.has(entry.name)) continue;
    
    if (rel === ENV_FILENAME || rel === ENV_KEY_FILENAME || rel === ENV_LOADER_FILENAME) continue;

    if (entry.isDirectory()) {
      planTree(full, rel, plan);
      continue;
    }

    
    if (EXCLUDE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    const destPath = path.join(OUT_DIR, rel);
    if (SERVER_TARGETS.has(rel)) {
      plan.obfuscate.push({ srcPath: full, destPath, isClient: false });
    } else if (CLIENT_TARGETS.has(rel)) {
      plan.obfuscate.push({ srcPath: full, destPath, isClient: true });
    } else if (HTML_TARGETS.has(rel)) {
      plan.html.push({ srcPath: full, destPath });
    } else {
      plan.copy.push({ srcPath: full, destPath });
    }
  }
  return plan;
}

async function runPool(jobs, worker, concurrency) {
  const queue = jobs.slice();
  const runners = new Array(concurrency).fill(null).map(async () => {
    while (queue.length) {
      const job = queue.shift();
      await worker(job);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDir(OUT_DIR);
  console.log("Building obfuscated release build...");
  const started = Date.now();

  await encryptEnvAndPatchLoader();
  const plan = planTree(ROOT, "", { obfuscate: [], copy: [], html: [] });
  for (const { srcPath, destPath } of plan.copy) copyFile(srcPath, destPath);

  // Bound worker count to reduce memory pressure on Android/Termux and small servers.
  const configuredConcurrency = Number.parseInt(process.env.OMNIPOS_BUILD_CONCURRENCY || "2", 10);
  const safeConcurrency = Number.isInteger(configuredConcurrency)
    ? Math.max(1, Math.min(4, configuredConcurrency))
    : 2;
  const concurrency = Math.max(1, Math.min(os.cpus().length || 1, plan.obfuscate.length || 1, safeConcurrency));
  const oldManifest = loadObfuscationCacheManifest();
  const newEntries = {};
  let cacheHits = 0;
  let newlyObfuscated = 0;
  let preservedExisting = 0;
  console.log(`Obfuscation workers: ${concurrency}; cache entries available: ${Object.keys(oldManifest.entries).length}`);

  await runPool(plan.obfuscate, async (job) => {
    const options = pickObfOptions(job.srcPath, job.isClient);
    const result = await obfuscateWithCache(job, options, oldManifest.entries, newEntries);
    if (result === "cached") cacheHits += 1;
    else if (result === "preserved") preservedExisting += 1;
    else newlyObfuscated += 1;
  }, concurrency);

  const htmlConcurrency = Math.max(1, Math.min(os.cpus().length || 1, plan.html.length || 1, safeConcurrency));
  await runPool(plan.html, async (job) => {
    const options = pickObfOptions(job.srcPath, true);
    const result = await obfuscateHtmlWithCache(job, options, oldManifest.entries, newEntries);
    if (result === "cached") cacheHits += 1;
    else newlyObfuscated += 1;
  }, htmlConcurrency);

  // Commit only after all JS and HTML jobs succeeded; failed builds retain the old manifest.
  ensureDir(OBFUSCATION_CACHE_DIR);
  atomicWriteFile(OBFUSCATION_CACHE_MANIFEST, JSON.stringify({
    schemaVersion: OBFUSCATION_CACHE_SCHEMA,
    generatedAt: new Date().toISOString(),
    entries: newEntries,
  }, null, 2));
  pruneObfuscationCache(newEntries);
  console.log(`Obfuscation summary: ${cacheHits} cached, ${newlyObfuscated} newly obfuscated, ${preservedExisting} already-obfuscated files preserved.`);

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsedSec}s. Release build is in /release/OMNIPOS.`);
  console.log("Next step: go to release/OMNIPOS, run `npm install --omit=dev`, then deploy/zip it for the customer.");
}
main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
