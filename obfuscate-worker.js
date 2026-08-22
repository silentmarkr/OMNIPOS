

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
