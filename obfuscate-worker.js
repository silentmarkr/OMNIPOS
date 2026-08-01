/**
 * obfuscate-worker.js
 *
 * Runs javascript-obfuscator on a single file inside its own worker
 * thread. Used by build-release.js so multiple independent files can be
 * obfuscated in parallel (one per CPU core) instead of serially on the
 * main thread, which was the main cause of slow release builds.
 */

const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");
const JavaScriptObfuscator = require("javascript-obfuscator");

try {
  const { srcPath, destPath, options } = workerData;
  const code = fs.readFileSync(srcPath, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, options);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, result.getObfuscatedCode(), "utf8");
  parentPort.postMessage({ ok: true });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
}
