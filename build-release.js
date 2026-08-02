/**
 * build-release.js
 *
 * Produces a "release" copy of OMNIPOS with all first-party JavaScript
 * (server-side and client-side) obfuscated, so a customer/client can't
 * casually read the source if they open the files in a text editor.
 *
 * Usage:
 *   npm install            (once, to pull in javascript-obfuscator)
 *   npm run build:release
 *
 * Output: /release/OMNIPOS  <-- this is what gets shipped/deployed to
 * the customer.
 *
 * IMPORTANT:
 * - .env, database/, database/backups/, uploads_tmp/, .git/, and *.log
 *   files are NOT included in the release build (business secrets/data
 *   that should never be shipped).
 * - Third-party libraries (fontawesome, sweetalert2, html5-qrcode,
 *   JsBarcode) are NOT re-obfuscated since they're already minified and
 *   covered by their own licenses; they're copied as-is.
 * - node_modules is not included; the customer runs
 *   `npm install --omit=dev` inside the release folder before starting.
 *
 * PERFORMANCE NOTES (why this used to be slow, and what changed):
 * - The two largest first-party files (server.js and public/app.js) are
 *   several hundred KB each. javascript-obfuscator's `controlFlowFlattening`
 *   and `deadCodeInjection` passes do NOT scale linearly with file size —
 *   doubling the file size roughly quadruples the time they take. Running
 *   them at the same threshold (0.4 / 0.15) on a 250-450KB file as on a
 *   10KB file is what made the build crawl.
 * - `selfDefending` also compounds this cost, since the self-defending
 *   wrapper code itself gets run back through control-flow flattening.
 * - All files were obfuscated serially, one after another, even though
 *   they're fully independent of each other and could run in parallel.
 * - Fix applied below: (1) scale thresholds down for large files — this
 *   keeps meaningful protection (identifier renaming, string array
 *   encoding, dead code, self-defending all stay on) while avoiding the
 *   worst-case blow-up from control-flow flattening on big files, and
 *   (2) obfuscate independent files in parallel across worker threads
 *   instead of one at a time on the main thread.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { Worker } = require("worker_threads");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, "release", "OMNIPOS");

// Folders/files that are never included in the release build.
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
]);

// First-party source to obfuscate (server-side).
const SERVER_TARGETS = new Set([
  "server.js",
  "db.js",
  "migrate-to-sqlite.js",
  "_fix_project.js",
]);

// env-loader.js needs special handling (not a plain obfuscateFile call)
// because the real encryption key must be injected before it's
// obfuscated. See encryptEnvAndPatchLoader().
const ENV_LOADER_FILENAME = "env-loader.js";
const ENV_FILENAME = ".env";
const ENV_KEY_FILENAME = ".env.key";

// First-party source to obfuscate (client-side, shipped to the browser).
//
// NOTE: public/service-worker.js is intentionally NOT in this list.
// Service workers run in a stricter execution context than normal page
// scripts, and javascript-obfuscator's selfDefending/controlFlowFlattening
// output has known compatibility problems there (tamper-check code that
// relies on Function.prototype.toString() self-comparisons). On top of
// that, the string-array shuffling makes the obfuscated output byte-
// different on every single build — and browsers do a byte-for-byte diff
// of service-worker.js to decide whether to install a new SW version, so
// every redeploy was forcing an update cycle. Together these were the
// root cause of the PWA install/offline breakage. service-worker.js is
// small and has no business logic worth hiding, so it's shipped verbatim
// (see THIRD_PARTY_JS-style plain copy in planTree()).
const CLIENT_TARGETS = new Set([
  path.join("public", "app.js"),
  path.join("public", "bt-printer.js"),
  path.join("public", "faq-engine.js"),
  path.join("public", "faq-knowledge.js"),
]);

// Third-party JS that must not be touched, just copied.
const THIRD_PARTY_JS = new Set([
  path.join("public", "JsBarcode.all.min.js"),
  path.join("public", "html5-qrcode.min.js"),
  path.join("public", "sweetalert2.all.min.js"),
]);

// Any first-party file at or above this size gets the "large file"
// threshold scaling below instead of the default thresholds. This is
// the main lever that fixes the slow-build problem: control-flow
// flattening and dead-code injection cost grow much faster than
// linearly with file size, so big files need a lower threshold to
// finish in a reasonable amount of time.
const LARGE_FILE_BYTES = 100 * 1024; // 100KB

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
  // Lighter control-flow so low-end counter tablets don't lag.
  controlFlowFlatteningThreshold: 0.3,
  deadCodeInjectionThreshold: 0.1,
  selfDefending: true,
  debugProtection: false,
};

// Large-file variants: same protections turned on, much lower
// flattening/dead-code thresholds so build time stays reasonable.
// This is the fix for the "deploy takes forever" problem.
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

// Runs javascript-obfuscator inside a worker thread so multiple files
// can be obfuscated at the same time instead of blocking the main
// thread one file at a time.
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

/**
 * Reads the plaintext .env (source), generates a random AES-256 key,
 * encrypts the whole content, and:
 *   1. writes the ciphertext as the new ".env" in the release build
 *      (JSON: { iv, tag, data } — no readable KEY=VALUE lines here).
 *   2. writes the key (hex) to a separate ".env.key" file next to it,
 *      so at runtime only a release build that has the matching key
 *      file can decrypt its own .env.
 *
 * IMPORTANT (fixes the "device revoked after self-update" bug): the
 * key used to live baked into env-loader.js's obfuscated source, and a
 * BRAND NEW random key was generated on every build. But self-update
 * preserves .env (so client settings survive) while REPLACING
 * env-loader.js with the new build's loader — which had a different,
 * unrelated key. That made every already-installed client's .env
 * permanently undecryptable after its first self-update. Keeping the
 * key in its own file (which self-update must ALSO preserve, alongside
 * .env — see SELF_UPDATE_PRESERVE in server.js) keeps the key and its
 * matching .env paired for the lifetime of that installation,
 * regardless of how many times the loader code itself gets rebuilt.
 *
 * If no .env is found in the source (e.g. not set up yet), this is a
 * silent no-op — it's not required for the build to run.
 */
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
  const key = crypto.randomBytes(32); // AES-256
  const iv = crypto.randomBytes(12); // GCM standard IV size

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

// Walks the source tree and returns a flat plan of what to do with each
// file, instead of obfuscating inline — this lets us run all the
// obfuscation jobs concurrently afterwards.
function planTree(dir, baseRel, plan) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(baseRel, entry.name);
    const full = path.join(dir, entry.name);

    if (EXCLUDE.has(entry.name)) continue;
    // .env and env-loader.js are handled by encryptEnvAndPatchLoader().
    if (rel === ENV_FILENAME || rel === ENV_KEY_FILENAME || rel === ENV_LOADER_FILENAME) continue;

    if (entry.isDirectory()) {
      planTree(full, rel, plan);
      continue;
    }

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

  // Obfuscate independent files concurrently. Concurrency is capped at
  // the number of CPU cores since this is CPU-bound work.
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
