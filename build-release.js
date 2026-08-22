

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { Worker } = require("worker_threads");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, "release", "OMNIPOS");

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
]);

const EXCLUDE_EXTENSIONS = new Set([".patch", ".log"]);

const SERVER_TARGETS = new Set([
  "server.js",
  "db.js",
  "migrate-to-sqlite.js",
  "_fix_project.js",
  "mailer.js",
  "verify-gmail-connection.js",
]);

const ENV_LOADER_FILENAME = "env-loader.js";
const ENV_FILENAME = ".env";
const ENV_KEY_FILENAME = ".env.key";

const CLIENT_TARGETS = new Set([
  path.join("public", "app.js"),
  path.join("public", "bt-printer.js"),
  path.join("public", "faq-engine.js"),
  path.join("public", "faq-knowledge.js"),
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

function obfuscateInWorker(srcPath, destPath, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "obfuscate-worker.js"), {
      workerData: { srcPath, destPath, options },
    });
    worker.on("message", (msg) => {
      if (msg.ok) {
        console.log(`  [obfuscated] ${path.relative(ROOT, srcPath)}`);
        resolve();
      } else {
        reject(new Error(msg.error));
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker for ${srcPath} exited with code ${code}`));
    });
  });
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

  const plaintext = fs.readFileSync(envSrcPath, "utf8");
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
  return obfuscateInWorker(destLoaderPath, destLoaderPath, baseServerObfOptions).then(() => {
    console.log(`  [obfuscated] ${ENV_LOADER_FILENAME}`);
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
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  ensureDir(OUT_DIR);

  console.log("Building obfuscated release build...");
  const started = Date.now();

  await encryptEnvAndPatchLoader();

  const plan = planTree(ROOT, "", { obfuscate: [], copy: [] });

  for (const { srcPath, destPath } of plan.copy) copyFile(srcPath, destPath);

  
  const concurrency = Math.max(1, Math.min(os.cpus().length, plan.obfuscate.length));
  await runPool(
    plan.obfuscate,
    ({ srcPath, destPath, isClient }) =>
      obfuscateInWorker(srcPath, destPath, pickObfOptions(srcPath, isClient)),
    concurrency
  );

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsedSec}s. Release build is in /release/OMNIPOS.`);
  console.log(
    "Next step: go to release/OMNIPOS, run `npm install --omit=dev`, " +
      "then deploy/zip it for the customer."
  );
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
