ZIP_NAME="omnipos-client.zip"

set -e

SCRIPT_PATH="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"

if [ -n "$TERMUX_VERSION" ] || [ -d "/data/data/com.termux" ] || command -v termux-setup-storage >/dev/null 2>&1; then
    PLATFORM="termux"
elif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    PLATFORM="macos"
else
    PLATFORM="linux"
fi

echo "🖥️  Detected platform: $PLATFORM"
echo ""

if [ "$PLATFORM" = "termux" ]; then
    # Fix: acquire the wake-lock BEFORE anything that switches focus
    # away from Termux (storage permission dialog, overlay permission
    # in the launcher script, etc.) — without it, Android can throttle
    # Termux in the background while the user is off granting a
    # permission, which is part of why the setup used to appear to
    # "hang" needing a Y/n answer by the time they came back.
    command -v termux-wake-lock >/dev/null 2>&1 && timeout 3 termux-wake-lock

    echo "🔧 [1/5] Requesting storage access..."
    termux-setup-storage
    sleep 2
else
    echo "🔧 [1/5] Skip — storage permission not needed on PC."
fi

echo "📦 [2/5] Checking/installing required tools (node, unzip, curl)..."

if [ "$PLATFORM" = "termux" ]; then
    export DEBIAN_FRONTEND=noninteractive

    # Fix: dpkg's --force-confold/--force-confdef only silence DPKG's
    # own config-file prompt. Some packages manage their config files
    # through a separate tool called `ucf`, which has its OWN prompt
    # that those dpkg flags do NOT cover — this was the remaining gap
    # that could still show an interactive "Y/n" during pkg
    # update/upgrade regardless of when the user comes back to Termux.
    export UCF_FORCE_CONFFOLD=1
    export UCF_FORCE_CONFFNEW=0
    export UCF_FORCE_CONFFMISS=1

    # Fix: prevents the setup from stalling on an interactive
    # "Do you want to continue? [Y/n]" prompt (e.g. a repo
    # origin/label change or a config-file conflict) that `yes |`
    # alone does not answer. Forces apt/dpkg to run fully
    # non-interactively.
    APT_NONINTERACTIVE_OPTS="-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -o Acquire::AllowReleaseInfoChange::Origin=true -o Acquire::AllowReleaseInfoChange::Label=true -o Acquire::AllowReleaseInfoChange::Suite=true -o Acquire::AllowReleaseInfoChange::Version=true -o Acquire::AllowReleaseInfoChange::Codename=true"
    yes | pkg update -y $APT_NONINTERACTIVE_OPTS
    yes | pkg upgrade -y $APT_NONINTERACTIVE_OPTS
    yes | pkg install nodejs unzip curl termux-api util-linux -y $APT_NONINTERACTIVE_OPTS

elif [ "$PLATFORM" = "macos" ]; then

    if ! command -v node >/dev/null 2>&1; then
        if command -v brew >/dev/null 2>&1; then
            echo "   Installing Node.js using Homebrew..."
            brew install node
        else
            echo "❌ No Node.js and no Homebrew on this Mac."
            echo "   First install Node.js: https://nodejs.org (LTS version)"
            echo "   or install Homebrew (https://brew.sh) then run this script again."
            exit 1
        fi
    fi
    for tool in unzip curl; do
        command -v "$tool" >/dev/null 2>&1 || { echo "❌ Missing '$tool' — install this first."; exit 1; }
    done

else

    if ! command -v node >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
        if command -v apt-get >/dev/null 2>&1; then
            echo "   Installing using apt (may ask for sudo password)..."
            sudo apt-get update -y
            sudo apt-get install -y nodejs npm unzip curl
        elif command -v dnf >/dev/null 2>&1; then
            sudo dnf install -y nodejs npm unzip curl
        elif command -v pacman >/dev/null 2>&1; then
            sudo pacman -Sy --noconfirm nodejs npm unzip curl
        else
            echo "❌ Could not detect your package manager (apt/dnf/pacman)."
            echo "   Manually install Node.js, unzip, and curl first, then run the script again."
            exit 1
        fi
    fi

    # Fix: e-receipt sending needs Node 18+ (global fetch(), used by
    # mailer.js's Gmail API fallback). Older Node passes the
    # "verified" check in Receipt Customization but fails later with
    # a fetch-related error when SMTP is blocked/times out — common
    # on Termux/mobile data. Enforce Node 18+ here, upgrading via
    # NodeSource (apt/dnf) or pacman if needed.
    NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
    if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
        echo "⚠️  Installed Node.js is too old ($(node -v 2>/dev/null || echo 'not found')) — Node 18+ is required for the e-receipt Gmail API fallback."
        if command -v apt-get >/dev/null 2>&1; then
            echo "   Upgrading Node.js via NodeSource (may prompt for sudo password)..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v dnf >/dev/null 2>&1; then
            echo "   Upgrading Node.js via NodeSource (may prompt for sudo password)..."
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
            sudo dnf install -y nodejs
        else
            echo "❌ Could not upgrade Node.js automatically here. Please install Node.js 18+ manually (https://nodejs.org), then run this script again."
            exit 1
        fi
        NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
        if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
            echo "❌ Node.js version is still not sufficient after upgrading. Please install Node.js 18+ manually, then run this script again."
            exit 1
        fi
    fi
fi

echo "   Node version: $(node -v 2>/dev/null || echo 'NOT FOUND — there was a problem installing nodejs')"
echo ""

if [ "$PLATFORM" = "termux" ]; then
    DOWNLOADS_DIR="$HOME/storage/downloads"
    INSTALL_DIR="$HOME/OMNIPOS"
else
    DOWNLOADS_DIR="$HOME/Downloads"
    INSTALL_DIR="$HOME/OMNIPOS"
fi

echo "📂 [3/5] Looking for \"$ZIP_NAME\" in $DOWNLOADS_DIR..."
ZIP_PATH="$DOWNLOADS_DIR/$ZIP_NAME"
if [ ! -f "$ZIP_PATH" ]; then
    echo "❌ Not found: $ZIP_PATH"
    echo ""
    echo "   Zip files found in Downloads:"
    ls "$DOWNLOADS_DIR" 2>/dev/null | grep -i "\.zip$" || echo "   (no .zip found, or the Downloads folder could not be located)"
    echo ""
    echo "   Copy the EXACT filename from the list above,"
    echo "   edit the ZIP_NAME= at the top of this script, then run it again."
    exit 1
fi

echo "🧪 Checking whether the zip file is corrupted before extracting..."
if ! unzip -tq "$ZIP_PATH" >/dev/null 2>&1; then
    echo "❌ The downloaded zip file ($ZIP_NAME) is corrupted/incomplete."
    echo "   Download it again and try once more."
    exit 1
fi

echo "📤 [4/5] Extracting OMNIPOS to $INSTALL_DIR..."

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
unzip -q "$ZIP_PATH" -d "$INSTALL_DIR"

# Safety net: remove any stray .start.sh.lock that may have shipped
# inside the zip, so start.sh doesn't mistake it for an already-running
# instance on first launch.
rm -f "$INSTALL_DIR/.start.sh.lock"

# Ensure omnipos-search-image.js (the "Omni Search Images" background
# worker) exists in the install folder. server.js spawns this file directly
# from $INSTALL_DIR at runtime whenever "Omni Search Images" is used, so it
# must be present on the client's device even if it wasn't bundled inside
# the client zip. Always (re)write it here so it's guaranteed to exist and
# stay in sync with this installer.
echo "🧩 Installing omnipos-search-image.js (Omni Search worker)..."
cat > "$INSTALL_DIR/omnipos-search-image.js" << 'OMNIPOS_SEARCH_WORKER_EOF'
'use strict';

/*
 * OmniPOS — "Omni Search Images" background worker
 * ------------------------------------------------------------------------
 * What this is: a standalone Node.js script, spawned by server.js as a
 * separate, detached background OS process every time someone clicks the
 * "Omni Search Images" button (inside Bulk Search Images) in the app.
 *
 * Why it's a separate process: so the actual searching truly runs in the
 * background on the device (e.g. inside Termux) without ever printing
 * anything to the terminal the user is using, and without blocking the
 * main OmniPOS server while it works through a batch of products. All
 * live progress is reported back to the running server over a small
 * loopback-only HTTP callback, and the app displays that progress visually
 * — the user never needs to look at Termux at all.
 *
 * Dependencies: NONE beyond Node.js core modules (https/http/fs/path).
 * No extra npm packages and no extra Termux packages need to be installed
 * for this to work — that's intentional, so there's nothing extra that
 * can go missing on a fresh Termux setup.
 *
 * Self-healing: every provider call is wrapped in try/catch. If a
 * provider errors, gets blocked, or its page layout changed, this worker
 * logs it and automatically moves on to the next free provider — it never
 * lets one bad provider stop the whole batch. If something fatal happens
 * (e.g. the job file is unreadable), this worker simply exits quietly;
 * server.js has its own 20-second safety timer that notices when no
 * progress is coming in and automatically finishes the search in-process
 * instead, so the feature still works either way.
 * ------------------------------------------------------------------------
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'omni-search-worker.log');

// ---------------------------------------------------------------------------
// Logging (for self-troubleshooting). Never shown to the end user directly —
// this is purely so an admin can check logs/omni-search-worker.log if a
// search run behaves oddly. A logging failure must never crash the worker.
// ---------------------------------------------------------------------------
function log(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
        fs.appendFileSync(LOG_FILE, line);
    } catch {
        try {
            fs.mkdirSync(LOG_DIR, { recursive: true });
            fs.appendFileSync(LOG_FILE, line);
        } catch {
            // Logging is best-effort only — never let it take down the job.
        }
    }
}

// ---------------------------------------------------------------------------
// Tiny core-module-only HTTP client (no fetch/axios dependency, so this
// keeps working even on older Node builds that may ship with some Termux
// setups). Follows redirects, forces uncompressed responses to keep parsing
// simple, and always applies a timeout so one slow site can't hang the job.
// ---------------------------------------------------------------------------
function requestText(url, { headers = {}, timeoutMs = 12000, redirectsLeft = 3 } = {}) {
    return new Promise((resolve, reject) => {
        let parsed;
        try { parsed = new URL(url); } catch { return reject(new Error(`Invalid URL: ${url}`)); }
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.get(url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity', ...headers },
            timeout: timeoutMs
        }, (resStream) => {
            if ([301, 302, 303, 307, 308].includes(resStream.statusCode) && resStream.headers.location && redirectsLeft > 0) {
                resStream.resume();
                let nextUrl;
                try { nextUrl = new URL(resStream.headers.location, url).toString(); }
                catch { return reject(new Error('Invalid redirect location.')); }
                return requestText(nextUrl, { headers, timeoutMs, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
            }
            const chunks = [];
            resStream.on('data', (c) => chunks.push(c));
            resStream.on('end', () => resolve({ statusCode: resStream.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
            resStream.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error(`Timed out fetching ${url}`)));
        req.on('error', reject);
    });
}

async function requestJson(url, options) {
    const { statusCode, body } = await requestText(url, options);
    if (statusCode < 200 || statusCode >= 300) throw new Error(`HTTP ${statusCode} from ${url}`);
    try { return JSON.parse(body); }
    catch (err) { throw new Error(`Could not parse JSON response from ${url}: ${err.message}`); }
}

// ---------------------------------------------------------------------------
// Free image search providers — no API key required for any of these.
// Kept intentionally self-contained (duplicated from server.js) so this
// worker never needs to require() the (very large) main server module.
// ---------------------------------------------------------------------------

async function searchDuckDuckGo(query, timeoutMs) {
    const tokenUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
    const { statusCode, body: html } = await requestText(tokenUrl, { timeoutMs });
    if (statusCode < 200 || statusCode >= 300) throw new Error(`DuckDuckGo token page returned HTTP ${statusCode}.`);
    const m = html.match(/vqd=['"]?([\d-]+)['"]?/);
    if (!m) throw new Error('DuckDuckGo vqd token not found (page layout may have changed).');

    const searchUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(m[1])}&f=,,,&p=1`;
    const data = await requestJson(searchUrl, { timeoutMs, headers: { Referer: 'https://duckduckgo.com/' } });
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) throw new Error('DuckDuckGo returned no image results.');
    return results.slice(0, 10)
        .map((it, i) => ({
            id: `ddg${i}`, provider: 'DuckDuckGo',
            title: (it.title || '').slice(0, 140),
            thumbnailUrl: it.thumbnail || it.image,
            imageUrl: it.image,
            width: it.width || null, height: it.height || null
        }))
        .filter(r => r.imageUrl && r.thumbnailUrl);
}

async function searchBingFree(query, timeoutMs) {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1&mkt=en-US`;
    const { statusCode, body: html } = await requestText(url, { timeoutMs, headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
    if (statusCode < 200 || statusCode >= 300) throw new Error(`Bing (free) returned HTTP ${statusCode} (may be temporarily blocking this network).`);

    const out = [];
    const attrRegex = /m="({.*?})"/g;
    let am;
    while ((am = attrRegex.exec(html)) && out.length < 10) {
        try {
            const obj = JSON.parse(am[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
            if (obj.murl) {
                out.push({
                    id: `bingfree${out.length}`, provider: 'Bing (free)',
                    title: (obj.t || '').slice(0, 140),
                    thumbnailUrl: obj.turl || obj.murl,
                    imageUrl: obj.murl,
                    width: obj.mw || null, height: obj.mh || null
                });
            }
        } catch {
            // One malformed entry shouldn't stop the whole scan — skip it.
        }
    }
    if (!out.length) throw new Error('Bing (free) returned no parsable image results (layout may have changed, or the request was blocked).');
    return out;
}

async function searchOpenverse(query, timeoutMs) {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=10`;
    const data = await requestJson(url, { timeoutMs });
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) throw new Error('Openverse returned no image results.');
    return results.slice(0, 10)
        .map((it, i) => ({
            id: `ov${i}`, provider: 'Openverse',
            title: (it.title || '').slice(0, 140),
            thumbnailUrl: it.thumbnail || it.url,
            imageUrl: it.url,
            width: it.width || null, height: it.height || null
        }))
        .filter(r => r.imageUrl && r.thumbnailUrl);
}

async function searchWikimediaCommons(query, timeoutMs) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent('file:' + query)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=400&format=json&origin=*`;
    const data = await requestJson(url, { timeoutMs });
    const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
    const out = [];
    for (const p of pages) {
        const info = p.imageinfo && p.imageinfo[0];
        if (info && info.url) {
            out.push({
                id: `wm${out.length}`, provider: 'Wikimedia Commons',
                title: (p.title || '').replace(/^File:/, '').slice(0, 140),
                thumbnailUrl: info.thumburl || info.url,
                imageUrl: info.url,
                width: info.width || null, height: info.height || null
            });
        }
    }
    if (!out.length) throw new Error('Wikimedia Commons returned no image results.');
    return out;
}

async function searchYandexFree(query, timeoutMs) {
    const url = `https://yandex.com/images/search?text=${encodeURIComponent(query)}`;
    const { statusCode, body: html } = await requestText(url, { timeoutMs });
    if (statusCode < 200 || statusCode >= 300) throw new Error(`Yandex returned HTTP ${statusCode}.`);
    const matches = [...html.matchAll(/"img_href":"(https?:[^"]+)"/g)];
    if (!matches.length) throw new Error('Yandex returned no parsable image results (likely blocked/CAPTCHA on this network).');
    return matches.slice(0, 10).map((m, i) => {
        const imageUrl = m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        return { id: `yx${i}`, provider: 'Yandex', title: '', thumbnailUrl: imageUrl, imageUrl, width: null, height: null };
    });
}

// Order matters: most reliable / most product-relevant free sources first,
// Yandex last since it's the most likely to serve a CAPTCHA instead of results.
const FREE_PROVIDERS = [
    { name: 'DuckDuckGo', run: searchDuckDuckGo },
    { name: 'Bing (free)', run: searchBingFree },
    { name: 'Openverse', run: searchOpenverse },
    { name: 'Wikimedia Commons', run: searchWikimediaCommons },
    { name: 'Yandex', run: searchYandexFree }
];

// Self-healing cascade: tries each free provider in turn. If one throws
// (blocked, errored, layout changed, no results, etc.) it's logged and the
// next provider is tried automatically — the caller only ever sees a
// failure if EVERY provider failed.
async function cascadeSearch(query, timeoutMs) {
    const errors = [];
    for (const provider of FREE_PROVIDERS) {
        try {
            const results = await provider.run(query, timeoutMs);
            if (results && results.length) return { provider: provider.name, results };
        } catch (err) {
            errors.push(`${provider.name}: ${err.message}`);
            log(`Provider "${provider.name}" failed for "${query}" — falling back to the next free provider. Reason: ${err.message}`);
        }
    }
    throw new Error(`All free providers failed for "${query}". (${errors.join(' | ')})`);
}

// ---------------------------------------------------------------------------
// Progress callback to the main OmniPOS server (loopback-only, secret-
// authenticated). Never throws — a failed callback just gets logged, since
// losing one progress update isn't fatal (server.js's own safety timer will
// notice and take over if callbacks stop entirely).
// ---------------------------------------------------------------------------
function postCallback(host, port, payload) {
    return new Promise((resolve) => {
        let data;
        try { data = JSON.stringify(payload); } catch (err) { log(`Could not serialize progress payload: ${err.message}`); return resolve(); }
        const req = http.request({
            host, port, path: '/omni-progress', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: 10000
        }, (res) => { res.resume(); res.on('end', resolve); res.on('error', () => resolve()); });
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.on('error', (err) => { log(`Could not reach OmniPOS server for a progress callback: ${err.message}`); resolve(); });
        req.write(data);
        req.end();
    });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const jobFile = process.argv[2];
    if (!jobFile) { log('No job file path was passed to the worker — nothing to do, exiting.'); return; }

    let job;
    try {
        job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    } catch (err) {
        log(`Could not read/parse job file "${jobFile}": ${err.message}`);
        return;
    }
    try { fs.unlinkSync(jobFile); } catch { /* not fatal — a leftover temp file isn't harmful */ }

    const { nonce, secret, host, port, targets } = job || {};
    if (!nonce || !secret || !host || !port || !Array.isArray(targets) || !targets.length) {
        log('Job file is missing required fields — nothing to do, exiting.');
        return;
    }

    log(`Starting Omni Search Images job ${nonce} — ${targets.length} product(s) to process.`);

    const items = [];
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i] || {};
        let proposal;
        try {
            const { provider, results } = await cascadeSearch(`${t.name} product photo`, 10000);
            const best = results[0];
            if (best) {
                items.push({ code: t.code, imageUrl: best.imageUrl, thumbnailUrl: best.thumbnailUrl, title: best.title, provider });
                proposal = { code: t.code, name: t.name, found: true, thumbnailUrl: best.thumbnailUrl, title: best.title, provider };
            } else {
                proposal = { code: t.code, name: t.name, found: false, message: 'No image found.' };
            }
        } catch (err) {
            log(`No usable result for "${t.name}" (${t.code}): ${err.message}`);
            proposal = { code: t.code, name: t.name, found: false, message: 'Search failed for this product.' };
        }

        await postCallback(host, port, { type: 'item', nonce, secret, done: i + 1, proposal });

        if (i < targets.length - 1) await sleep(500); // be polite to free public services
    }

    await postCallback(host, port, { type: 'finished', nonce, secret, items });
    log(`Finished Omni Search Images job ${nonce} — ${items.length}/${targets.length} image(s) found.`);
}

main().catch((err) => {
    log(`Fatal error in Omni Search Images worker: ${(err && err.stack) || err}`);
    process.exitCode = 1;
});

// Self-healing: never let an unexpected error crash silently without a
// trace — log it, then let the process exit naturally. server.js's
// 20-second no-progress safety timer takes over automatically if this
// worker dies before reporting anything.
process.on('uncaughtException', (err) => log(`Uncaught exception: ${(err && err.stack) || err}`));
process.on('unhandledRejection', (err) => log(`Unhandled rejection: ${(err && err.stack) || err}`));
OMNIPOS_SEARCH_WORKER_EOF

echo "🗑️  Removing the zip file from Downloads..."
rm -f "$ZIP_PATH"

echo "📥 [5/5] Installing dependencies (npm install)..."
cd "$INSTALL_DIR"
rm -rf node_modules package-lock.json
npm install
chmod +x start.sh 2>/dev/null || true

echo "🔨 Patching start.sh..."

if grep -q "^\s*termux-notification --id omnipos-supervisor" start.sh 2>/dev/null; then
    sed -i.bak 's/^\(\s*\)termux-notification --id omnipos-supervisor/\1timeout 3 termux-notification --id omnipos-supervisor/' start.sh && rm -f start.sh.bak
fi

# Fix: `setsid node server.js` detaches the server into a BRAND NEW
# session, separate from start.sh's own session. That escapes the
# exact protection the `exec ./start.sh` trick (see the widget
# shortcuts below) is meant to give — start.sh itself stays alive
# (wake-lock notification stays visible), but the detached node
# process is no longer inside the protected session/process group, so
# Android kills it as soon as you leave and reopen the app. Plain
# `node server.js` (same session as start.sh) does not have this
# problem. So: always run it plain, and undo the setsid wrap if an
# older version of this script already applied it to an existing
# start.sh.
if grep -q "setsid node server.js" start.sh 2>/dev/null; then
    sed -i.bak 's/if command -v setsid >\/dev\/null 2>&1; then setsid node server\.js; else node server\.js; fi/node server.js/' start.sh && rm -f start.sh.bak
fi

if grep -q "^\s*termux-wake-lock\s*$" start.sh 2>/dev/null; then
    sed -i.bak 's/^\(\s*\)termux-wake-lock\s*$/\1timeout 3 termux-wake-lock/' start.sh && rm -f start.sh.bak
fi
echo ""

if [ "$PLATFORM" = "termux" ]; then
    echo "🧷 [6/6] Creating home-screen widget shortcuts..."
    mkdir -p "$HOME/.shortcuts"

    cat > "$HOME/.shortcuts/Start-OmniPOS.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# RECREATE_WIDGETS_VERSION:3
command -v termux-wake-lock >/dev/null 2>&1 && timeout 3 termux-wake-lock
cd ~/OMNIPOS || { echo "❌ Could not find the ~/OMNIPOS folder."; exit 1; }
mkdir -p logs

echo ""
echo "⏳ Starting the OmniPOS server, please wait..."
echo ""

# Background helper: waits for the server to respond, opens OmniPOS
# (as the installed PWA if available, browser otherwise), then hides
# Termux. Kept separate from the server process itself — see the
# comment above "exec" below.
(
    for i in $(seq 1 60); do
        if curl -s -o /dev/null http://localhost:3000/; then
            # "localhost" (not "127.0.0.1") is required for WebAuthn/
            # Fingerprint Login to work as a valid RP ID.
            URL="http://localhost:3000/"
            # IMPORTANT: Do NOT force a WebAPK/PWA and do NOT send HOME.
            # Android may show "Choose OmniPOS or Chrome". Leave that
            # chooser open so the user can actually select an app.
            command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$URL"
            break
        fi
        sleep 0.5
    done
) &
disown

# Fix: the server used to die when leaving/reopening the app because
# this script backgrounded start.sh with `disown` and then exited —
# Termux:Widget (RunCommandService) only keeps its background-kill
# protection alive while the invoking task is still running, so once
# this script exited, the disowned start.sh/node processes lost that
# protection (the wake-lock notification stays visible but is purely
# cosmetic — it does not prevent the kill). This is also why a server
# started manually inside an interactive Termux session doesn't die:
# that session never exits. Using `exec` instead of `disown`+exit
# keeps this same PID running for as long as the server runs, so the
# RunCommandService protection is retained.
exec ./start.sh >> logs/widget-run.log 2>&1
EOF
    chmod +x "$HOME/.shortcuts/Start-OmniPOS.sh"

    cat > "$HOME/.shortcuts/Stop-OmniPOS.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# RECREATE_WIDGETS_VERSION:3
echo "🛑 Stopping the OmniPOS server..."
pkill -f start.sh 2>/dev/null
pkill -f "node server.js" 2>/dev/null
rm -f ~/OMNIPOS/.start.sh.lock
sleep 1
if pgrep -f "node server.js" > /dev/null; then
    pkill -9 -f "node server.js" 2>/dev/null
fi
command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
echo "✅ Done — the OmniPOS server is stopped."
sleep 1
am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1
exit
EOF
    chmod +x "$HOME/.shortcuts/Stop-OmniPOS.sh"

    cat > "$HOME/.shortcuts/Restart-OmniPOS.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# RECREATE_WIDGETS_VERSION:3
echo ""
echo "🔁 Restarting the OmniPOS server..."
echo ""

echo "🛑 Stopping the OmniPOS server first (if running)..."
pkill -f start.sh 2>/dev/null
pkill -f "node server.js" 2>/dev/null
rm -f ~/OMNIPOS/.start.sh.lock
sleep 1
if pgrep -f "node server.js" > /dev/null; then
    pkill -9 -f "node server.js" 2>/dev/null
fi
echo "✅ Stopped."
echo ""

command -v termux-wake-lock >/dev/null 2>&1 && timeout 3 termux-wake-lock
cd ~/OMNIPOS || { echo "❌ Could not find the ~/OMNIPOS folder."; exit 1; }
mkdir -p logs

echo "⏳ Starting the OmniPOS server again, please wait..."
echo ""

# Background helper — see the explanation in Start-OmniPOS.sh.
(
    for i in $(seq 1 60); do
        if curl -s -o /dev/null http://localhost:3000/; then
            URL="http://localhost:3000/"
            # Do not force the installed PWA and do not close the Android
            # app chooser. The user can choose OmniPOS or Chrome normally.
            command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$URL"
            break
        fi
        sleep 0.5
    done
) &
disown

# Fix: `exec` instead of disown+exit — see Start-OmniPOS.sh.
exec ./start.sh >> logs/widget-run.log 2>&1
EOF
    chmod +x "$HOME/.shortcuts/Restart-OmniPOS.sh"

    cat > "$HOME/.shortcuts/OmniPOS-LAN.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# RECREATE_WIDGETS_VERSION:3
command -v termux-wake-lock >/dev/null 2>&1 && timeout 3 termux-wake-lock
cd ~/OMNIPOS || { echo "❌ Could not find the ~/OMNIPOS folder."; exit 1; }
mkdir -p logs

echo ""
echo "⏳ Starting the OmniPOS server (LAN mode), please wait..."
echo ""
echo "🔎 Getting the LAN IP..."

if command -v timeout >/dev/null 2>&1; then
    LAN_IP=$(timeout 5 ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n 1)
else
    LAN_IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n 1)
fi
if [ -z "$LAN_IP" ] && command -v ifconfig >/dev/null 2>&1; then
    LAN_IP=$(timeout 5 ifconfig 2>/dev/null | awk '/inet /{print $2}' | sed 's/addr://' | grep -v '^127\.' | head -n 1)
fi
if [ -z "$LAN_IP" ]; then
    command -v termux-toast >/dev/null 2>&1 && termux-toast "⚠️ No LAN IP found — make sure the phone is on WiFi."
    echo "⚠️  No LAN IP found. Is the phone in Airplane Mode?"
    exit 1
fi
echo ""

# Background helper — see the explanation in Start-OmniPOS.sh.
(
    SERVER_UP=0
    for i in $(seq 1 180); do
        if curl -s -o /dev/null "http://localhost:3000/"; then
            SERVER_UP=1
            break
        fi
        sleep 0.5
    done

    if [ "$SERVER_UP" -ne 1 ]; then
        command -v termux-toast >/dev/null 2>&1 && termux-toast "⚠️ Hasn't started yet — check the logs."
        exit 0
    fi

    LOCAL_URL="http://localhost:3000/"
    # Do not force WebAPK/PWA and do not close the chooser.
    command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$LOCAL_URL"
    command -v termux-toast >/dev/null 2>&1 && termux-toast "✅ Server ready: $LOCAL_URL"
) &
disown

echo "🌐 Open on another device (same WiFi): http://$LAN_IP:3000"
echo ""

# Fix: `exec` instead of disown+exit — see Start-OmniPOS.sh.
exec env NODE_ENV=production ./start.sh >> logs/widget-run.log 2>&1
EOF
    chmod +x "$HOME/.shortcuts/OmniPOS-LAN.sh"

else

    echo "🧷 [6/6] Creating launcher scripts in $INSTALL_DIR..."

    if [ "$PLATFORM" = "macos" ]; then
        OPEN_CMD="open"
    else
        OPEN_CMD="xdg-open"
    fi

    cat > "$INSTALL_DIR/start-omnipos.sh" << EOF
#!/usr/bin/env bash
cd "\$(dirname "\$0")" || exit 1
mkdir -p logs

echo ""
echo "⏳ Starting the OmniPOS server, please wait..."
echo ""

if command -v setsid >/dev/null 2>&1; then
    setsid nohup ./start.sh > logs/widget-run.log 2>&1 &
else
    nohup ./start.sh > logs/widget-run.log 2>&1 &
fi
disown 2>/dev/null || true

for i in \$(seq 1 60); do
  if curl -s -o /dev/null http://localhost:3000/; then
    echo "✅ Server ready."
    sleep 1
    break
  fi
  sleep 0.5
done

echo "🌐 http://localhost:3000"
if command -v $OPEN_CMD >/dev/null 2>&1; then
    $OPEN_CMD http://localhost:3000/ >/dev/null 2>&1
else
    echo "   (open this manually in your browser)"
fi
EOF
    chmod +x "$INSTALL_DIR/start-omnipos.sh"

    cat > "$INSTALL_DIR/stop-omnipos.sh" << 'EOF'
#!/usr/bin/env bash
echo "🛑 Stopping the OmniPOS server..."
pkill -f start.sh 2>/dev/null
pkill -f "node server.js" 2>/dev/null
rm -f "$(dirname "$0")/.start.sh.lock"
sleep 1
if pgrep -f "node server.js" > /dev/null; then
    pkill -9 -f "node server.js" 2>/dev/null
fi
echo "✅ Done — the OmniPOS server is stopped."
EOF
    chmod +x "$INSTALL_DIR/stop-omnipos.sh"

    cat > "$INSTALL_DIR/restart-omnipos.sh" << EOF
#!/usr/bin/env bash
cd "\$(dirname "\$0")" || exit 1

echo ""
echo "🔁 Restarting the OmniPOS server..."
echo ""

echo "🛑 Stopping the OmniPOS server first (if running)..."
pkill -f start.sh 2>/dev/null
pkill -f "node server.js" 2>/dev/null
rm -f "\$(dirname "\$0")/.start.sh.lock"
sleep 1
if pgrep -f "node server.js" > /dev/null; then
    pkill -9 -f "node server.js" 2>/dev/null
fi
echo "✅ Stopped."
echo ""

mkdir -p logs
echo "⏳ Starting the OmniPOS server again, please wait..."
echo ""

if command -v setsid >/dev/null 2>&1; then
    setsid nohup ./start.sh > logs/widget-run.log 2>&1 &
else
    nohup ./start.sh > logs/widget-run.log 2>&1 &
fi
disown 2>/dev/null || true

for i in \$(seq 1 60); do
  if curl -s -o /dev/null http://localhost:3000/; then
    echo "✅ Server ready."
    sleep 1
    break
  fi
  sleep 0.5
done

echo "🌐 http://localhost:3000"
if command -v $OPEN_CMD >/dev/null 2>&1; then
    $OPEN_CMD http://localhost:3000/ >/dev/null 2>&1
else
    echo "   (open this manually in your browser)"
fi
EOF
    chmod +x "$INSTALL_DIR/restart-omnipos.sh"

    cat > "$INSTALL_DIR/omnipos-lan.sh" << EOF
#!/usr/bin/env bash
cd "\$(dirname "\$0")" || exit 1
mkdir -p logs

echo ""
echo "⏳ Starting the OmniPOS server (LAN mode), please wait..."
echo ""
echo "🔎 Getting the LAN IP..."

if command -v ip >/dev/null 2>&1; then
    LAN_IP=\$(timeout 5 ip -4 -o addr show scope global 2>/dev/null | awk '{print \$4}' | cut -d/ -f1 | head -n 1)
elif command -v ifconfig >/dev/null 2>&1; then
    LAN_IP=\$(ifconfig 2>/dev/null | awk '/inet /{print \$2}' | sed 's/addr://' | grep -v '^127\.' | head -n 1)
fi

if [ -z "\$LAN_IP" ]; then
    echo "⚠️  No LAN IP found. Are you connected via WiFi/Ethernet?"
    exit 1
fi

if command -v setsid >/dev/null 2>&1; then
    NODE_ENV=production setsid nohup ./start.sh > logs/widget-run.log 2>&1 &
else
    NODE_ENV=production nohup ./start.sh > logs/widget-run.log 2>&1 &
fi
disown 2>/dev/null || true

for i in \$(seq 1 60); do
  if curl -s -o /dev/null http://localhost:3000/; then
    echo "✅ Server ready."
    break
  fi
  sleep 0.5
done

echo ""
echo "🌐 Open on another device (same WiFi/network): http://\$LAN_IP:3000"
echo "🌐 On this PC: http://localhost:3000"
echo ""

if command -v $OPEN_CMD >/dev/null 2>&1; then
    $OPEN_CMD http://localhost:3000/ >/dev/null 2>&1
fi
EOF
    chmod +x "$INSTALL_DIR/omnipos-lan.sh"

    if [ "$PLATFORM" = "linux" ] && [ -d "$HOME/Desktop" ]; then
        cat > "$HOME/Desktop/Start-OmniPOS.desktop" << EOF 2>/dev/null || true
[Desktop Entry]
Type=Application
Name=Start OmniPOS
Exec=x-terminal-emulator -e "$INSTALL_DIR/start-omnipos.sh"
Terminal=false
EOF
        chmod +x "$HOME/Desktop/Start-OmniPOS.desktop" 2>/dev/null || true
    fi
fi

echo ""
echo "✅ SETUP COMPLETE!"
echo ""

if [ "$PLATFORM" = "termux" ]; then
    echo "Next steps (one time only, on the customer's/client's device itself):"
    echo "  1. Long-press on an empty home screen"
    echo "  2. Select 'Widgets'"
    echo "  3. Find and drag 'Termux:Widget' — 4 TIMES (once per shortcut)"
    echo "  4. Choose 'Start-OmniPOS', 'Stop-OmniPOS', 'Restart-OmniPOS', and 'OmniPOS-LAN'"
    echo ""
    echo "  - 'Start-OmniPOS'   = normal, same device only (localhost; Android app chooser stays open)"
    echo "  - 'OmniPOS-LAN'     = can be accessed by ANOTHER device (same WiFi)"
    echo "  - 'Stop-OmniPOS'    = to stop the server if needed"
    echo "  - 'Restart-OmniPOS' = one tap to restart (stops first, then starts again)"
    echo ""
    echo "REMINDER: open the Termux:API app once and grant the Notification"
    echo "permission (Settings > Apps > Termux:API > Notifications > Allow)"
    echo "BEFORE using the widget shortcuts — so it doesn't get stuck on"
    echo "first use while waiting for the permission dialog."
    echo ""
    echo "IMPORTANT: always use the widget (localhost:3000), do NOT"
    echo "switch to 127.0.0.1 — Fingerprint Login (WebAuthn) behaves"
    echo "differently there."
    echo ""
    echo "ALSO REMEMBER to set the Termux app's Battery settings to"
    echo "'Unrestricted' (Settings > Apps > Termux > Battery)."
else
    echo "Next steps on this PC:"
    echo "  cd \"$INSTALL_DIR\""
    echo "  ./start-omnipos.sh      — starts the server, automatically opens in the browser"
    echo "  ./omnipos-lan.sh        — so another device on the same network can also access it"
    echo "  ./stop-omnipos.sh       — to stop the server"
    echo "  ./restart-omnipos.sh    — to restart (stops first, then starts again)"
    if [ "$PLATFORM" = "linux" ] && [ -f "$HOME/Desktop/Start-OmniPOS.desktop" ]; then
        echo ""
        echo "A shortcut was also added to the Desktop: 'Start OmniPOS'."
    fi
    echo ""
    echo "IMPORTANT: always use \"localhost:3000\" when opening OmniPOS"
    echo "on this same PC — Fingerprint/WebAuthn Login behaves differently"
    echo "when \"127.0.0.1\" is used."
fi

echo ""
echo "The .env is ready (RELAY_URL/RELAY_API_KEY are already baked in"
echo "from the RELAY build) — no need to set this up manually anymore."
echo ""

echo "🧹 Cleaning up the installer file (setup-omnipos.sh) from Downloads..."
rm -f "$SCRIPT_PATH" 2>/dev/null || true

if [ "$PLATFORM" = "termux" ]; then
    echo ""
    echo "🚀 Starting OmniPOS automatically..."
    cd "$INSTALL_DIR" || exit 1
    mkdir -p logs

    command -v termux-wake-lock >/dev/null 2>&1 && timeout 3 termux-wake-lock

    # PWA AUTO-DEFAULT REMOVED.
    # The installer only opens the normal Android URL chooser. It does not
    # force OmniPOS/WebAPK, does not wait for installation, and does not
    # send Android HOME. This prevents the "Choose Chrome or OmniPOS" dialog
    # from being closed before the user can select an app.
    (
        for i in $(seq 1 60); do
            if curl -s -o /dev/null http://localhost:3000/; then
                URL="http://localhost:3000/"
                command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$URL"
                break
            fi
            sleep 0.5
        done
    ) &
    disown

    # Fix: see the detailed explanation in Start-OmniPOS.sh above —
    # `exec` into start.sh instead of disown+exit, so this task keeps
    # running (and keeps Termux's background-kill protection) for as
    # long as the server runs.
    echo "🙈 Hiding Termux — OmniPOS is now running in the background..."
    exec ./start.sh >> logs/widget-run.log 2>&1
fi
