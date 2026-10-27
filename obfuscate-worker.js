const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { lowerForLegacy } = require("./legacy-lower.js");

try {
  const { srcPath, destPath, options, code } = workerData;
  // Browser (client) code is first lowered to Chrome 70-compatible syntax so old Android WebViews can run it.
  const isBrowser = !!(options && options.target === "browser");
  if (typeof code === "string") {
    const input = isBrowser ? lowerForLegacy(code, "inline-script") : code;
    const result = JavaScriptObfuscator.obfuscate(input, options);
    parentPort.postMessage({ ok: true, obfuscatedCode: result.getObfuscatedCode() });
  } else {
    const raw = fs.readFileSync(srcPath, "utf8");
    const source = isBrowser ? lowerForLegacy(raw, path.basename(srcPath)) : raw;
    const result = JavaScriptObfuscator.obfuscate(source, options);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, result.getObfuscatedCode(), "utf8");
    parentPort.postMessage({ ok: true });
  }
} catch (err) {
  parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
}
