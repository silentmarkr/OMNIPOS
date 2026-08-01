/**
 * build-release.js
 *
 * Gumagawa ng "release" copy ng OMNIPOS na naka-obfuscate ang lahat ng
 * sariling JavaScript files (server-side at client-side), para hindi
 * basta-basta mabasa ng customer/client ang loob ng code kung buksan nila
 * ang files gamit ang text editor.
 *
 * Paggamit:
 *   npm install            (isang beses lang, para makuha ang javascript-obfuscator)
 *   npm run build:release
 *
 * Output: /release/OMNIPOS  <-- ito na ang ipapadala/i-deploy sa customer.
 *
 * MAHALAGA:
 * - Ang .env, database/, database/backups/, uploads_tmp/, .git/, at mga
 *   *.log ay HINDI kasama sa release build (secrets/data ng negosyo, hindi
 *   dapat ipamahagi).
 * - Ang mga third-party libraries (fontawesome, sweetalert2, html5-qrcode,
 *   JsBarcode) ay HINDI na kailangang i-obfuscate ulit dahil minified na
 *   at hawak ng kani-kanilang lisensya; kokopyahin lang sila as-is.
 * - Ang node_modules ay hindi kasama; magpapatakbo ang customer ng
 *   `npm install --omit=dev` sa loob ng release folder bago i-start.
 */

const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, "release", "OMNIPOS");

// Mga folder/file na hindi isasama sa release build.
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

// Sariling source code na i-obfuscate (server-side).
const SERVER_TARGETS = new Set([
  "server.js",
  "db.js",
  "migrate-to-sqlite.js",
  "_fix_project.js",
]);

// Ang env-loader.js ay kailangan ng special handling (hindi basta-basta
// obfuscateFile lang) dahil kailangan munang ipasok ang tunay na
// encryption key bago ito i-obfuscate. Tignan ang encryptEnvAndLoader().
const ENV_LOADER_FILENAME = "env-loader.js";
const ENV_FILENAME = ".env";

// Sariling source code na i-obfuscate (client-side, papunta sa browser).
const CLIENT_TARGETS = new Set([
  path.join("public", "app.js"),
  path.join("public", "bt-printer.js"),
  path.join("public", "faq-engine.js"),
  path.join("public", "faq-knowledge.js"),
  path.join("public", "service-worker.js"),
]);

// Mga third-party na hindi na dapat galawin, kokopyahin lang.
const THIRD_PARTY_JS = new Set([
  path.join("public", "JsBarcode.all.min.js"),
  path.join("public", "html5-qrcode.min.js"),
  path.join("public", "sweetalert2.all.min.js"),
]);

const serverObfOptions = {
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

const clientObfOptions = {
  ...serverObfOptions,
  target: "browser",
  // Mas magaan sa control-flow para hindi mabagal ang UI sa mga
  // mahihinang device/tablet na ginagamit sa counter.
  controlFlowFlatteningThreshold: 0.3,
  deadCodeInjectionThreshold: 0.1,
  selfDefending: true,
  debugProtection: false,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function obfuscateFile(srcPath, destPath, options) {
  const code = fs.readFileSync(srcPath, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, options);
  ensureDir(path.dirname(destPath));
  fs.writeFileSync(destPath, result.getObfuscatedCode(), "utf8");
  console.log(`  [obfuscated] ${path.relative(ROOT, srcPath)}`);
}

function copyFile(srcPath, destPath) {
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(srcPath, destPath);
}

/**
 * Kinukuha ang plaintext .env (source), gumagawa ng random AES-256 key,
 * ini-encrypt ang buong content, at:
 *   1. isusulat ang ciphertext bilang bagong ".env" sa release build
 *      (JSON: { iv, tag, data } — walang readable KEY=VALUE dito).
 *   2. ipapasok ang key (hex) sa env-loader.js bago ito i-obfuscate,
 *      para sa runtime, ang release build lang ang may kakayahang
 *      i-decrypt ang .env nito.
 *
 * Kung walang nakitang .env sa source (halimbawa hindi pa naisetup ng
 * user), silently skip lang — hindi ito required para tumakbo ang build.
 */
function encryptEnvAndPatchLoader() {
  const envSrcPath = path.join(ROOT, ENV_FILENAME);
  const loaderSrcPath = path.join(ROOT, ENV_LOADER_FILENAME);

  if (!fs.existsSync(envSrcPath) || !fs.existsSync(loaderSrcPath)) {
    console.warn(
      `  [skip] Walang ${ENV_FILENAME} at/o ${ENV_LOADER_FILENAME} sa root — hindi ien-encrypt ang env config.`
    );
    return;
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

  const loaderCode = fs
    .readFileSync(loaderSrcPath, "utf8")
    .replace("__ENV_KEY_HEX__", key.toString("hex"));

  const destLoaderPath = path.join(OUT_DIR, ENV_LOADER_FILENAME);
  const obfuscated = JavaScriptObfuscator.obfuscate(loaderCode, serverObfOptions);
  ensureDir(path.dirname(destLoaderPath));
  fs.writeFileSync(destLoaderPath, obfuscated.getObfuscatedCode(), "utf8");
  console.log(`  [obfuscated] ${ENV_LOADER_FILENAME}  (may naka-embed na encryption key)`);
}

function walk(dir, baseRel = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(baseRel, entry.name);
    const full = path.join(dir, entry.name);

    if (EXCLUDE.has(entry.name)) continue;

    // Ang .env at env-loader.js ay hawak na ng encryptEnvAndPatchLoader().
    if (rel === ENV_FILENAME || rel === ENV_LOADER_FILENAME) continue;

    if (entry.isDirectory()) {
      walk(full, rel);
      continue;
    }

    // Patches (.patch) at ibang non-runtime files: kopyahin na lang,
    // hindi naman ito tumatakbo sa production.
    const destPath = path.join(OUT_DIR, rel);

    if (SERVER_TARGETS.has(rel)) {
      obfuscateFile(full, destPath, serverObfOptions);
    } else if (CLIENT_TARGETS.has(rel)) {
      obfuscateFile(full, destPath, clientObfOptions);
    } else {
      copyFile(full, destPath);
    }
  }
}

function main() {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  ensureDir(OUT_DIR);

  console.log("Building obfuscated release build...");
  encryptEnvAndPatchLoader();
  walk(ROOT);

  console.log("\nTapos na. Nasa /release/OMNIPOS na ang release build.");
  console.log(
    "Sunod na hakbang: pumunta sa release/OMNIPOS, patakbuhin ang " +
      "`npm install --omit=dev`, at i-deploy/i-zip ito papunta sa customer."
  );
}

main();
