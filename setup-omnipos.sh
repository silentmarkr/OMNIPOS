ZIP_NAME="omnipos-client.zip"

set -e

# Fix: with `set -e` the script used to stop with NO message when any
# step failed (pkg update/upgrade, npm install, ...). Now it explains.
# Fix (v2): the old trap only said "check your internet" — even when the real problem was a
# half-finished extraction that had already deleted the old install, and it never told the user
# that a data backup existed. Now the install is STAGED (the live install is never touched until
# everything succeeded), the trap cleans the staging folder and always points at the backup.
STAGE_DIR=""
PRESERVE_DIR=""
SETUP_SWAPPED=0
on_setup_error() {
    echo ""
    echo "❌ Setup stopped unexpectedly (script line $1). Check your internet connection and free storage, then run the setup again."
    if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
        rm -rf "$STAGE_DIR" 2>/dev/null || true
    fi
    if [ "$SETUP_SWAPPED" = "1" ]; then
        echo "   The new version is already in place — only the finishing steps failed. Running the setup again is safe."
    else
        echo "   Your existing OmniPOS install was NOT modified. The zip in Downloads is kept."
    fi
    if [ -n "$PRESERVE_DIR" ] && [ -d "$PRESERVE_DIR" ]; then
        echo "   💾 Safety backup of your data: $PRESERVE_DIR"
    fi
}
trap 'on_setup_error $LINENO' ERR

# NOTE: this script is no longer necessarily run as a real file with a
# meaningful $0 — omnipos-installer.sh extracts it from inside the zip
# into a temp dir, reads it into memory, and runs it via
# `bash -c "$SCRIPT_CONTENT"`. In that mode $0 is just the literal
# string "bash", not a real path, so a former "SCRIPT_PATH=...$0..."
# self-cleanup here would silently target a nonexistent file. The
# actual leftover file worth cleaning up after a successful install is
# the omnipos-installer.sh the user downloaded to their Downloads
# folder (see INSTALLER_SCRIPT_PATH cleanup near the end of this file).

if [ -n "$TERMUX_VERSION" ] || [ -d "/data/data/com.termux" ] || command -v termux-setup-storage >/dev/null 2>&1; then
    PLATFORM="termux"
elif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    PLATFORM="macos"
else
    PLATFORM="linux"
fi

# OmniPOS stores its data in Node's built-in SQLite (node:sqlite), which exists unflagged only on
# Node 22.13+. This (not "Node >= 18") is the real requirement, so every upgrade path below is
# judged by it. (Old logic upgraded to Node 20 — which can never pass this — so Linux installs
# always failed at the end.)
node_has_sqlite() { command -v node >/dev/null 2>&1 && node -e "require('node:sqlite')" >/dev/null 2>&1; }

echo "🖥️  Detected platform: $PLATFORM"
echo ""

if [ "$PLATFORM" = "termux" ]; then
    # Fix: acquire the wake-lock BEFORE anything that switches focus
    # away from Termux (storage permission dialog, overlay permission
    # in the launcher script, etc.) — without it, Android can throttle
    # Termux in the background while the user is off granting a
    # permission, which is part of why the setup used to appear to
    # "hang" needing a Y/n answer by the time they came back.
    command -v termux-wake-lock >/dev/null 2>&1 && { timeout 3 termux-wake-lock || true; }

    echo "🔧 [1/6] Requesting storage access..."
    termux-setup-storage
    sleep 2
    # Fix: give the user time to tap "Allow" on the storage permission
    # dialog (the Downloads shortcut only appears after that).
    for _i in $(seq 1 "${STORAGE_WAIT:-30}"); do
        [ -d "$HOME/storage/downloads" ] && break
        [ "$_i" = 1 ] && echo "   ⏳ Waiting for storage permission — tap 'Allow' on the popup..."
        sleep 1
    done
else
    echo "🔧 [1/6] Skip — storage permission not needed on PC."
fi

echo "📦 [2/6] Checking/installing required tools (node, unzip, curl)..."

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

    # Only refresh/install Termux packages when a required command or Node's built-in SQLite
    # support is missing. A routine OmniPOS app update should not upgrade the entire phone.
    # The server requires node:sqlite (Node 22.13+); merely having a `node` command is not enough.
    TERMUX_TOOLS_OK=1
    for _tool in node unzip curl termux-notification termux-wake-lock timeout; do
        command -v "$_tool" >/dev/null 2>&1 || TERMUX_TOOLS_OK=0
    done
    if [ "$TERMUX_TOOLS_OK" = "1" ] && node_has_sqlite; then
        echo "   ✅ Required Termux tools and Node SQLite are ready — skipping package updates."
    else
        echo "   Installing or repairing only the required Termux tools (no full system upgrade)..."
        APT_NONINTERACTIVE_OPTS="-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -o Acquire::AllowReleaseInfoChange::Origin=true -o Acquire::AllowReleaseInfoChange::Label=true -o Acquire::AllowReleaseInfoChange::Suite=true -o Acquire::AllowReleaseInfoChange::Version=true -o Acquire::AllowReleaseInfoChange::Codename=true"
        yes | pkg update -y $APT_NONINTERACTIVE_OPTS
        yes | pkg install nodejs unzip curl termux-api util-linux -y $APT_NONINTERACTIVE_OPTS
        if ! node_has_sqlite; then
            echo "❌ The installed Node.js does not provide node:sqlite (Node 22.13+ is required). Update the Termux Node.js package, then run setup again."
            exit 1
        fi
    fi

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
    if ! node_has_sqlite && command -v brew >/dev/null 2>&1; then
        echo "   Node.js is too old for OmniPOS (needs 22.13+) — upgrading with Homebrew..."
        brew upgrade node || brew install node || true
    fi

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

    # Fix: OmniPOS needs Node 22.13+ (built-in node:sqlite; this also covers the Node 18+ that
    # e-receipt sending needs). Upgrade via NodeSource 22.x (apt/dnf) or pacman when too old.
    if ! node_has_sqlite; then
        echo "⚠️  Installed Node.js ($(node -v 2>/dev/null || echo 'not found')) is too old — OmniPOS needs Node 22.13 or newer (built-in SQLite)."
        if command -v apt-get >/dev/null 2>&1; then
            echo "   Upgrading Node.js via NodeSource 22.x (may prompt for sudo password)..."
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v dnf >/dev/null 2>&1; then
            echo "   Upgrading Node.js via NodeSource 22.x (may prompt for sudo password)..."
            curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
            sudo dnf install -y nodejs
        elif command -v pacman >/dev/null 2>&1; then
            sudo pacman -Sy --noconfirm nodejs npm
        else
            echo "❌ Could not upgrade Node.js automatically here. Install Node.js 22.13+ (https://nodejs.org), then run this script again."
            exit 1
        fi
        if ! node_has_sqlite; then
            echo "❌ Node.js is still too old after upgrading ($(node -v 2>/dev/null || echo 'none')). Install Node.js 22.13+ manually (https://nodejs.org), then run this script again."
            exit 1
        fi
    fi
fi

echo "   Node version: $(node -v 2>/dev/null || echo 'NOT FOUND — there was a problem installing nodejs')"
echo ""
# OmniPOS keeps its data in Node's built-in SQLite (node:sqlite, Node 22.13+). Without it the server crashes on every
# start (crash loop), so stop here with a clear message instead of finishing a broken install.
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
    echo "❌ The installed Node.js ($(node -v 2>/dev/null || echo 'none')) has no built-in SQLite. OmniPOS needs Node 22.13 or newer."
    echo "   Termux: run  pkg upgrade nodejs  — PC: install the latest Node.js LTS from https://nodejs.org — then run this setup again."
    exit 1
fi

# Auto-install "cloudflared" (Cloudflare Tunnel binary) — this is what
# creates the public link (https://xxxx.trycloudflare.com) for the
# "Remote Access Link" (globe icon) in the OMNIPOS profile menu.
#
# Fix: the old version downloaded the binary from GitHub with
# `curl -fsSL ... 2>/dev/null` — no timeout, no progress bar, and errors
# hidden — so on a slow/blocked GitHub connection the setup looked
# "stuck" forever on "Downloading cloudflared...". Now:
#   - Termux: installed with `pkg install cloudflared` (same Termux repo
#     that installs nodejs — fast, and it is the build that works on
#     Android).
#   - Linux PC: GitHub download, but with a progress bar, timeouts and
#     retries. macOS: brew.
#   - It is optional — if it fails, setup continues (only the globe icon
#     "Remote Access Link" is affected).
echo "🌐 Checking/installing cloudflared (for the Remote Access Link / globe icon)..."
if command -v cloudflared >/dev/null 2>&1 || [ -x "$HOME/.local/bin/cloudflared" ]; then
    echo "   ✅ cloudflared already found — skipping install."

elif [ "$PLATFORM" = "termux" ]; then
    echo "   Installing cloudflared (pkg install cloudflared)..."
    yes | timeout 300 pkg install cloudflared -y $APT_NONINTERACTIVE_OPTS || true
    if command -v cloudflared >/dev/null 2>&1; then
        echo "   ✅ cloudflared installed."
    else
        echo "   ⚠️  Could not install cloudflared right now. OmniPOS will still work — only the 'Remote Access Link' (globe icon) won't work until it is installed. Later, run:  pkg install cloudflared"
    fi

elif [ "$PLATFORM" = "macos" ]; then
    if command -v brew >/dev/null 2>&1; then
        brew install cloudflared || echo "   ⚠️  Could not install cloudflared — run later:  brew install cloudflared"
    else
        echo "   ⚠️  Homebrew not found — install cloudflared later with:  brew install cloudflared"
    fi

else
    CF_BIN_DIR="$HOME/.local/bin"
    mkdir -p "$CF_BIN_DIR" 2>/dev/null
    CF_ARCH="$(uname -m 2>/dev/null)"
    case "$CF_ARCH" in
        aarch64|arm64) CF_ASSET="cloudflared-linux-arm64" ;;
        armv7l|armv6l|arm) CF_ASSET="cloudflared-linux-arm" ;;
        x86_64|amd64) CF_ASSET="cloudflared-linux-amd64" ;;
        i686|i386) CF_ASSET="cloudflared-linux-386" ;;
        *) CF_ASSET="" ;;
    esac
    if [ -n "$CF_ASSET" ]; then
        CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/${CF_ASSET}"
        CF_TMP="$CF_BIN_DIR/.cloudflared.download"
        echo "   Downloading cloudflared ($CF_ASSET) from GitHub (max ~3 minutes)..."
        rm -f "$CF_TMP" 2>/dev/null
        if curl -fL --progress-bar --connect-timeout 15 --max-time 180 --retry 2 --retry-delay 2 "$CF_URL" -o "$CF_TMP" && [ -s "$CF_TMP" ]; then
            chmod +x "$CF_TMP"
            if "$CF_TMP" --version >/dev/null 2>&1; then
                mv -f "$CF_TMP" "$CF_BIN_DIR/cloudflared"
                echo "   ✅ cloudflared installed at $CF_BIN_DIR/cloudflared"
            else
                rm -f "$CF_TMP" 2>/dev/null
                echo "   ⚠️  The downloaded cloudflared file cannot run on this device — skipped."
            fi
        else
            rm -f "$CF_TMP" 2>/dev/null
            echo "   ⚠️  Could not download cloudflared (slow/no internet, or GitHub is blocked). OmniPOS will still work — only the 'Remote Access Link' (globe icon) won't work. Later, try:  curl -fL $CF_URL -o $CF_BIN_DIR/cloudflared && chmod +x $CF_BIN_DIR/cloudflared"
        fi
    else
        echo "   ⚠️  Could not detect the CPU architecture ($CF_ARCH) for auto-installing cloudflared. Install it manually if you want to use the 'Remote Access Link' (globe icon)."
    fi
fi
echo ""

if [ "$PLATFORM" = "termux" ]; then
    DOWNLOADS_DIR="$HOME/storage/downloads"
    INSTALL_DIR="$HOME/OMNIPOS"
else
    DOWNLOADS_DIR="$HOME/Downloads"
    INSTALL_DIR="$HOME/OMNIPOS"
fi

echo "📂 [3/6] Looking for \"$ZIP_NAME\" in $DOWNLOADS_DIR..."
ZIP_PATH="$DOWNLOADS_DIR/$ZIP_NAME"
if [ ! -f "$ZIP_PATH" ]; then
    if [ "$PLATFORM" = "termux" ] && [ ! -d "$DOWNLOADS_DIR" ]; then
        echo "❌ No access to the Downloads folder — the storage permission was not granted."
        echo "   Fix: Android Settings > Apps > Termux > Permissions > Files/Storage > Allow,"
        echo "   then run:  termux-setup-storage   and run this setup again."
        exit 1
    fi
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

# ---------------------------------------------------------------------------
# SAFE, STAGED INSTALL
# Old flow: backup -> rm -rf $INSTALL_DIR -> unzip. If the unzip (or anything after it) failed —
# e.g. phone storage full — the live install was already gone, the database lived only in the
# backup folder, and re-running setup (as the error told the user to) found no database to back up
# and produced a BLANK install (new installationId, license re-approval needed, sales data stranded).
# New flow: preflight -> backup -> extract into a STAGING folder -> restore data into staging ->
# npm install in staging -> atomic swap. The live install is untouched until everything worked.
# ---------------------------------------------------------------------------
MIN_FREE_MB="${MIN_FREE_MB:-600}"
FREE_KB="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt $((MIN_FREE_MB * 1024)) ] 2>/dev/null; then
    echo "❌ Not enough free storage: $((FREE_KB / 1024)) MB free, at least ${MIN_FREE_MB} MB needed."
    echo "   Free some space on the device, then run the setup again. Nothing was changed."
    exit 1
fi

find_running_omnipos() {
    local pid cwd
    for pid in $(pgrep -f "node server.js" 2>/dev/null); do
        cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
        if [ "$cwd" = "$INSTALL_DIR" ]; then echo "$pid"; return 0; fi
    done
    return 1
}
# Newest finished backup that contains a database. Optional arg = max age in days (used by the automatic
# recovery so a months-old backup is never silently restored into a different/new install).
latest_backup_with_db() {
    local d max_days="${1:-}"
    for d in $(ls -1dt "$HOME"/omnipos-data-backup-* 2>/dev/null); do
        case "$d" in *.partial) continue ;; esac
        [ -e "$d/database" ] || continue
        if [ -n "$max_days" ] && [ -z "$(find "$d" -maxdepth 0 -mtime "-$max_days" 2>/dev/null)" ]; then continue; fi
        echo "$d"; return 0
    done
    return 1
}

RECOVERY_DIR=""
if [ -d "$INSTALL_DIR" ]; then
    OLD_LOCK="$INSTALL_DIR/.start.sh.lock"
    if [ -f "$OLD_LOCK" ]; then
        OLD_PID="$(cat "$OLD_LOCK" 2>/dev/null)"
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            echo "❌ OmniPOS is still running (PID $OLD_PID). Stop it first (widget: Stop-OmniPOS), then run this setup again."
            exit 1
        fi
    fi
    RUNNING_PID="$(find_running_omnipos || true)"
    if [ -n "$RUNNING_PID" ]; then
        echo "❌ OmniPOS server is still running (PID $RUNNING_PID). Stop it first (widget: Stop-OmniPOS), then run this setup again."
        exit 1
    fi
    if [ -e "$INSTALL_DIR/database" ] || [ -e "$INSTALL_DIR/.omnipos-device-seed" ]; then
        PRESERVE_DIR="$HOME/omnipos-data-backup-$(date +%Y%m%d-%H%M%S)"
        echo "💾 Existing OmniPOS install found — backing up your data to $PRESERVE_DIR ..."
        mkdir -p "$PRESERVE_DIR.partial"
        for _item in database .omnipos-device-seed .env .env.key; do
            if [ -e "$INSTALL_DIR/$_item" ]; then
                cp -a "$INSTALL_DIR/$_item" "$PRESERVE_DIR.partial/" || { rm -rf "$PRESERVE_DIR.partial"; PRESERVE_DIR=""; echo "❌ Could not back up $_item — nothing was changed. Stopping."; exit 1; }
            fi
        done
        sync 2>/dev/null || true
        mv "$PRESERVE_DIR.partial" "$PRESERVE_DIR"
    else
        # RECOVERY: an install folder with NO database is the signature of an earlier interrupted
        # setup. The real data is in the newest omnipos-data-backup-* folder — bring it back.
        RECOVERY_DIR="$(latest_backup_with_db 7 || true)"
        if [ -n "$RECOVERY_DIR" ]; then
            echo "🩹 The existing install has no database, but a data backup was found: $RECOVERY_DIR"
            echo "   It will be restored into the new install."
        fi
    fi
else
    _lost="$(latest_backup_with_db || true)"
    if [ -n "$_lost" ]; then
        echo "ℹ️  Note: an older data backup exists at $_lost (it is NOT restored automatically on a clean install)."
    fi
fi
DATA_SRC="${PRESERVE_DIR:-$RECOVERY_DIR}"

echo "📤 [4/6] Extracting OMNIPOS into a staging folder (your current install stays untouched)..."
STAGE_DIR="$INSTALL_DIR.new"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
unzip -q "$ZIP_PATH" -d "$STAGE_DIR"

# Accept a zip that wraps everything in a single OMNIPOS/ folder as well as a flat zip.
if [ ! -f "$STAGE_DIR/server.js" ] && [ -f "$STAGE_DIR/OMNIPOS/server.js" ]; then
    ( shopt -s dotglob 2>/dev/null; mv "$STAGE_DIR"/OMNIPOS/* "$STAGE_DIR"/ ) && rmdir "$STAGE_DIR/OMNIPOS"
fi
if [ ! -f "$STAGE_DIR/server.js" ] || [ ! -f "$STAGE_DIR/package.json" ]; then
    echo "❌ $ZIP_NAME does not look like an OmniPOS package (server.js / package.json missing). Nothing was changed."
    rm -rf "$STAGE_DIR"
    exit 1
fi

if [ -n "$DATA_SRC" ] && [ -d "$DATA_SRC/database" ]; then
    rm -rf "$STAGE_DIR/database"
    cp -a "$DATA_SRC/database" "$STAGE_DIR/database"
    if [ -e "$DATA_SRC/.omnipos-device-seed" ]; then cp -a "$DATA_SRC/.omnipos-device-seed" "$STAGE_DIR/.omnipos-device-seed"; fi
    if [ -f "$DATA_SRC/database/relay-client-credential.json" ] && {
        [ ! -f "$STAGE_DIR/database/relay-client-credential.json" ] ||
        ! cmp -s "$DATA_SRC/database/relay-client-credential.json" "$STAGE_DIR/database/relay-client-credential.json";
    }; then
        echo "❌ Relay activation credential did not survive the staged update. The existing installation was not changed."
        exit 1
    fi
fi
if [ -n "$DATA_SRC" ]; then
    for _config_file in .env .env.key; do
        if [ -f "$DATA_SRC/$_config_file" ] && [ ! -e "$STAGE_DIR/$_config_file" ]; then
            cp -a "$DATA_SRC/$_config_file" "$STAGE_DIR/$_config_file" || {
                echo "❌ Could not preserve existing configuration file $_config_file. The existing installation was not changed."
                exit 1
            }
        fi
    done
    if [ -d "$DATA_SRC/database" ]; then
        echo "♻️  Your database and existing runtime configuration were kept. A safety copy is in $DATA_SRC."
    fi
fi

# Safety net: remove any stray .start.sh.lock that may have shipped inside the zip.
rm -f "$STAGE_DIR/.start.sh.lock"

# "Omni Search Images" is built into server.js now — drop leftovers of the old standalone worker.
rm -f "$STAGE_DIR/omnipos-search-image.js" "$STAGE_DIR/logs/omni-search-worker.log"

echo "📥 [5/6] Installing dependencies (npm install)..."
cd "$STAGE_DIR"
rm -rf node_modules package-lock.json
if ! npm install; then
    echo ""
    echo "❌ npm install failed (usually a slow/dropped internet connection)."
    echo "   Your existing OmniPOS install was NOT modified. The zip is still in Downloads — just run the setup again."
    cd "$HOME" && rm -rf "$STAGE_DIR"
    exit 1
fi
chmod +x start.sh 2>/dev/null || true


# Safety net: the AI Assistant's document-reading feature (PDF/DOCX
# attachments) needs "pdf-parse" and "mammoth". These SHOULD already be
# listed in package.json and get installed by the plain `npm install`
# above — but if this client.zip happens to have been built from an
# older package.json (before these were added), or the install above
# was interrupted/partial, make sure they're present anyway so the
# feature actually works instead of silently telling users it's "not
# enabled on this server yet".
for pkg in pdf-parse mammoth; do
    if [ ! -d "node_modules/$pkg" ]; then
        echo "📥 Installing additional dependency: $pkg (needed for AI Assistant PDF/DOCX reading)..."
        npm install "$pkg" --save || echo "⚠️  Could not install $pkg — PDF/DOCX reading in the AI Assistant will stay disabled until this is installed manually."
    fi
done

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

# ---- ATOMIC SWAP: only now (zip extracted, data restored, dependencies installed) does the live
# install get replaced. If the second mv fails the previous install is put back.
cd "$HOME"
SWAP_OLD=""
if [ -d "$INSTALL_DIR" ]; then
    SWAP_OLD="$INSTALL_DIR.old-$(date +%Y%m%d-%H%M%S)"
    mv "$INSTALL_DIR" "$SWAP_OLD"
fi
if ! mv "$STAGE_DIR" "$INSTALL_DIR"; then
    if [ -n "$SWAP_OLD" ]; then mv "$SWAP_OLD" "$INSTALL_DIR"; fi
    echo "❌ Could not put the new version in place — your previous install was restored."
    exit 1
fi
SETUP_SWAPPED=1
STAGE_DIR=""
cd "$INSTALL_DIR"

# The zip is removed only AFTER the new install is really in place (a failed run never forces a re-download).
echo "🗑️  Removing the zip file from Downloads..."
rm -f "$ZIP_PATH"

APP_BACKUP_DIR=""
if [ -n "$SWAP_OLD" ]; then
    if [ ! -e "$SWAP_OLD/database" ]; then
        # The old folder had no database (an interrupted earlier setup) — nothing worth rolling back to.
        rm -rf "$SWAP_OLD"
    elif [ -e "$INSTALL_DIR/database" ]; then
        # APP BACKUP: keep the previous version's code (a complete copy of the old install, moved — not
        # copied, so it costs no extra time) next to the data backup. If the new version turns out to
        # be broken, run  bash ~/rollback-omnipos.sh  to put it back. A failure here must never fail
        # the setup — the new version is already in place.
        APP_BACKUP_DIR="$HOME/omnipos-app-backup-$(date +%Y%m%d-%H%M%S)"
        if mv "$SWAP_OLD" "$APP_BACKUP_DIR" 2>/dev/null; then
            rm -f "$APP_BACKUP_DIR/.start.sh.lock" 2>/dev/null || true
        else
            echo "⚠️  Could not keep the previous version as an app backup — it stays at $SWAP_OLD."
            APP_BACKUP_DIR=""
        fi
    else
        echo "⚠️  The previous install was kept at $SWAP_OLD (its database was not carried over)."
    fi
fi
# Keep only the 3 newest data backups.
ls -1dt "$HOME"/omnipos-data-backup-* 2>/dev/null | tail -n +4 | while IFS= read -r _old_backup; do rm -rf "$_old_backup"; done
# Keep only the 2 newest app backups (each one is a whole old install, so they are bigger). "Newest"
# is judged by the timestamp in the folder name, not the folder mtime (which changes on every start).
ls -1d "$HOME"/omnipos-app-backup-* 2>/dev/null | LC_ALL=C sort -r | tail -n +3 | while IFS= read -r _old_app; do rm -rf "$_old_app"; done
if [ -n "$APP_BACKUP_DIR" ] && [ -d "$APP_BACKUP_DIR" ]; then
    echo "🛟 Previous version kept as an app backup: $APP_BACKUP_DIR"
    echo "   If the new version does not work, run:  bash ~/rollback-omnipos.sh"
fi

# ---- ROLLBACK SCRIPT (lives in $HOME, outside the install folder, so it survives every swap) ----
cat > "$HOME/rollback-omnipos.sh" << 'ROLLBACK_EOF' || true
#!/usr/bin/env bash
# OmniPOS rollback — puts the PREVIOUS version's code back (the app backup the setup keeps in $HOME).
#   bash ~/rollback-omnipos.sh               -> newest app backup, KEEPS your current data (sales, settings)
#   bash ~/rollback-omnipos.sh --old-data    -> also uses the data that was in the old version
#   bash ~/rollback-omnipos.sh <backup-dir>  -> a specific app backup folder
# Running it a second time switches back to the version you just left.
INSTALL_DIR="$HOME/OMNIPOS"
OLD_DATA=0
CHOSEN=""
for _a in "$@"; do
    case "$_a" in
        --old-data) OLD_DATA=1 ;;
        *) CHOSEN="$_a" ;;
    esac
done

if [ -n "$CHOSEN" ]; then
    APP_BACKUP="${CHOSEN%/}"
else
    APP_BACKUP=""
    for _d in $(ls -1d "$HOME"/omnipos-app-backup-* 2>/dev/null | LC_ALL=C sort -r); do
        [ -f "$_d/server.js" ] && [ -f "$_d/package.json" ] && { APP_BACKUP="$_d"; break; }
    done
fi
if [ -z "$APP_BACKUP" ] || [ ! -f "$APP_BACKUP/server.js" ] || [ ! -f "$APP_BACKUP/package.json" ]; then
    echo "❌ No usable app backup found in $HOME (omnipos-app-backup-*). Nothing was changed."
    exit 1
fi
if [ ! -d "$APP_BACKUP/node_modules" ]; then
    echo "❌ $APP_BACKUP has no node_modules, so it cannot run as-is. Nothing was changed."
    exit 1
fi
if [ ! -d "$INSTALL_DIR" ]; then
    echo "❌ $INSTALL_DIR not found. Nothing was changed."
    exit 1
fi

# Refuse while the server runs (same checks as the setup).
if [ -f "$INSTALL_DIR/.start.sh.lock" ]; then
    _pid="$(cat "$INSTALL_DIR/.start.sh.lock" 2>/dev/null)"
    if [ -n "$_pid" ] && kill -0 "$_pid" 2>/dev/null; then
        echo "❌ OmniPOS is still running (PID $_pid). Stop it first (widget: Stop-OmniPOS), then run this again."
        exit 1
    fi
fi
for _pid in $(pgrep -f "node server.js" 2>/dev/null); do
    if [ "$(readlink "/proc/$_pid/cwd" 2>/dev/null || true)" = "$INSTALL_DIR" ]; then
        echo "❌ OmniPOS server is still running (PID $_pid). Stop it first (widget: Stop-OmniPOS), then run this again."
        exit 1
    fi
done

TS="$(date +%Y%m%d-%H%M%S)"
ASIDE="$HOME/omnipos-app-backup-$TS"
if [ "$ASIDE" = "$APP_BACKUP" ] || [ -e "$ASIDE" ]; then ASIDE="$ASIDE-b"; fi

echo "↩️  Rolling back to: $APP_BACKUP"
if [ "$OLD_DATA" = "1" ]; then
    echo "   Data: the OLD version's data will be used (sales made since the update will NOT be visible)."
else
    echo "   Data: your CURRENT data is kept."
fi

# 1) Safety copy of the current data first (always, even with --old-data).
DATA_SAFE="$HOME/omnipos-data-backup-$TS"
if [ -e "$DATA_SAFE" ] || [ -e "$DATA_SAFE.partial" ]; then DATA_SAFE="$DATA_SAFE-b"; fi
rm -rf "$DATA_SAFE.partial"
mkdir -p "$DATA_SAFE.partial" || { echo "❌ Could not create the safety backup. Nothing was changed."; exit 1; }
for _item in database .omnipos-device-seed .env .env.key; do
    if [ -e "$INSTALL_DIR/$_item" ]; then
        cp -a "$INSTALL_DIR/$_item" "$DATA_SAFE.partial/" || { rm -rf "$DATA_SAFE.partial"; echo "❌ Could not back up $_item. Nothing was changed."; exit 1; }
    fi
done
sync 2>/dev/null || true
mv "$DATA_SAFE.partial" "$DATA_SAFE" || { echo "❌ Could not finish the safety backup. Nothing was changed."; exit 1; }
echo "💾 Safety copy of the current data: $DATA_SAFE"

# 2) Swap the folders (renames only — fast, and each step is undone if the next one fails).
mv "$INSTALL_DIR" "$ASIDE" || { echo "❌ Could not move the current install aside. Nothing was changed."; exit 1; }
if ! mv "$APP_BACKUP" "$INSTALL_DIR"; then
    mv "$ASIDE" "$INSTALL_DIR"
    echo "❌ Could not put the old version in place — the current version was restored."
    exit 1
fi

# 3) Carry the current data into the restored version (unless --old-data). The old version's own
#    data is only renamed aside until everything has succeeded, so a failure can be undone exactly.
if [ "$OLD_DATA" != "1" ] && [ -e "$ASIDE/database" ]; then
    _ok=1
    if [ -e "$INSTALL_DIR/database" ]; then mv "$INSTALL_DIR/database" "$INSTALL_DIR/database.rollback-tmp" || _ok=0; fi
    if [ "$_ok" = "1" ] && [ -e "$INSTALL_DIR/.omnipos-device-seed" ]; then
        mv "$INSTALL_DIR/.omnipos-device-seed" "$INSTALL_DIR/.omnipos-device-seed.rollback-tmp" || _ok=0
    fi
    if [ "$_ok" = "1" ]; then cp -a "$ASIDE/database" "$INSTALL_DIR/database" || _ok=0; fi
    if [ "$_ok" = "1" ] && [ -e "$ASIDE/.omnipos-device-seed" ]; then
        cp -a "$ASIDE/.omnipos-device-seed" "$INSTALL_DIR/.omnipos-device-seed" || _ok=0
    fi
    if [ "$_ok" != "1" ]; then
        # Undo everything: both versions go back exactly as they were.
        if [ -e "$INSTALL_DIR/database.rollback-tmp" ]; then
            rm -rf "$INSTALL_DIR/database"
            mv "$INSTALL_DIR/database.rollback-tmp" "$INSTALL_DIR/database"
        fi
        if [ -e "$INSTALL_DIR/.omnipos-device-seed.rollback-tmp" ]; then
            rm -rf "$INSTALL_DIR/.omnipos-device-seed"
            mv "$INSTALL_DIR/.omnipos-device-seed.rollback-tmp" "$INSTALL_DIR/.omnipos-device-seed"
        fi
        mv "$INSTALL_DIR" "$APP_BACKUP"
        mv "$ASIDE" "$INSTALL_DIR"
        echo "❌ Could not carry your data over — the current version was restored. Nothing was lost."
        exit 1
    fi
    rm -rf "$INSTALL_DIR/database.rollback-tmp" "$INSTALL_DIR/.omnipos-device-seed.rollback-tmp"
fi
rm -f "$INSTALL_DIR/.start.sh.lock" 2>/dev/null || true
chmod +x "$INSTALL_DIR/start.sh" 2>/dev/null || true

echo ""
echo "✅ Rolled back. The version you just left is kept at: $ASIDE"
echo "   (run this script again to switch back to it)"
echo "   Now start OmniPOS again (widget: Start-OmniPOS, or ./start-omnipos.sh on a PC)."
ROLLBACK_EOF
chmod +x "$HOME/rollback-omnipos.sh" 2>/dev/null || true
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
# RECREATE_WIDGETS_VERSION:4
# AYOS: LAN Access ay built-in na ngayon sa loob mismo ng OmniPOS (Settings >
# LAN Access Link — naka-toggle On/Off, naka-save sa database, at gumagana
# na kahit anong widget/shortcut ang ginamit para mag-start). Kaya TINANGGAL
# na ang dating "NODE_ENV=production" forcing dito — kung ipipilit pa rin
# ito, mananatiling naka-LAN ang session na ito kahit i-off ito ng user sa
# loob ng Settings (sasabihin pa nga ng app na "hindi ito puwedeng i-off dito
# dahil naka-force via environment settings"), kaya nagkokonflik ito sa
# bagong built-in toggle. Ito na lamang ngayon ay isang normal na starter na
# nagpapakita lang ng LAN IP address — ang aktwal na pag-enable/disable ng
# LAN Access ay ginagawa na sa loob ng app (Settings > LAN Access Link).
command -v termux-wake-lock >/dev/null 2>&1 && timeout 3 termux-wake-lock
cd ~/OMNIPOS || { echo "❌ Could not find the ~/OMNIPOS folder."; exit 1; }
mkdir -p logs

echo ""
echo "⏳ Starting the OmniPOS server, please wait..."
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

if [ -n "$LAN_IP" ]; then
    echo "🌐 Kapag naka-ON na ang LAN Access Link (Settings > LAN Access Link"
    echo "   sa loob ng OmniPOS), puwede nang buksan sa ibang device (same WiFi):"
    echo "   http://$LAN_IP:3000"
fi
echo ""

# Fix: `exec` instead of disown+exit — see Start-OmniPOS.sh. Wala nang
# NODE_ENV=production dito — ang HOST binding (localhost vs 0.0.0.0) ay
# awtomatiko nang base sa naka-save na LAN Access toggle sa loob ng app.
exec ./start.sh >> logs/widget-run.log 2>&1
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
# AYOS: LAN Access ay built-in na ngayon sa loob mismo ng OmniPOS (Settings >
# LAN Access Link — naka-toggle On/Off, naka-save sa database, gumagana na
# rin kahit anong launcher script ang ginamit). Tinanggal na ang dating
# "NODE_ENV=production" forcing dito dahil nagkokonflik ito sa bagong
# built-in toggle — kung ipipilit pa rin ang env var, sasabihin ng app na
# hindi ito puwedeng i-off sa loob ng Settings dahil naka-force via
# environment settings. Ito na lamang ngayon ay normal na starter na
# nagpapakita lang ng LAN IP address bilang paalala.
cd "\$(dirname "\$0")" || exit 1
mkdir -p logs

echo ""
echo "⏳ Starting the OmniPOS server, please wait..."
echo ""
echo "🔎 Getting the LAN IP..."

if command -v ip >/dev/null 2>&1; then
    LAN_IP=\$(timeout 5 ip -4 -o addr show scope global 2>/dev/null | awk '{print \$4}' | cut -d/ -f1 | head -n 1)
elif command -v ifconfig >/dev/null 2>&1; then
    LAN_IP=\$(ifconfig 2>/dev/null | awk '/inet /{print \$2}' | sed 's/addr://' | grep -v '^127\.' | head -n 1)
fi

if [ -z "\$LAN_IP" ]; then
    echo "⚠️  No LAN IP found. Are you connected via WiFi/Ethernet?"
fi

if command -v setsid >/dev/null 2>&1; then
    setsid nohup ./start.sh > logs/widget-run.log 2>&1 &
else
    nohup ./start.sh > logs/widget-run.log 2>&1 &
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
echo "🌐 On this PC: http://localhost:3000"
if [ -n "\$LAN_IP" ]; then
    echo "🌐 Kapag naka-ON na ang LAN Access Link (Settings > LAN Access Link"
    echo "   sa loob ng OmniPOS), puwede nang buksan sa ibang device (same"
    echo "   WiFi/network): http://\$LAN_IP:3000"
fi
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
    echo "  - 'Start-OmniPOS'   = normal start (localhost; Android app chooser stays open)"
    echo "  - 'OmniPOS-LAN'     = same start, but also prints the LAN IP as a reminder"
    echo "  - 'Stop-OmniPOS'    = to stop the server if needed"
    echo "  - 'Restart-OmniPOS' = one tap to restart (stops first, then starts again)"
    echo ""
    echo "NOTE: LAN Access (so other devices on the same WiFi can open OmniPOS)"
    echo "is now a built-in toggle inside the app itself — Settings > LAN Access"
    echo "Link. Turn it ON there once; it stays ON across restarts no matter"
    echo "which shortcut above you use to start the server."
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
    echo "  ./omnipos-lan.sh        — same start, but also prints the LAN IP as a reminder"
    echo "  ./stop-omnipos.sh       — to stop the server"
    echo "  ./restart-omnipos.sh    — to restart (stops first, then starts again)"
    if [ "$PLATFORM" = "linux" ] && [ -f "$HOME/Desktop/Start-OmniPOS.desktop" ]; then
        echo ""
        echo "A shortcut was also added to the Desktop: 'Start OmniPOS'."
    fi
    echo ""
    echo "NOTE: LAN Access (so other devices on the same network can open"
    echo "OmniPOS) is now a built-in toggle inside the app itself — Settings >"
    echo "LAN Access Link. Turn it ON there once; it stays ON across restarts"
    echo "no matter which script above you use to start the server."
    echo ""
    echo "IMPORTANT: always use \"localhost:3000\" when opening OmniPOS"
    echo "on this same PC — Fingerprint/WebAuthn Login behaves differently"
    echo "when \"127.0.0.1\" is used."
fi

echo ""
echo "The .env is ready with the RELAY URL only; the RELAY master API key is not included."
echo "On first launch, activate this installation with its customer activation key."
echo ""

echo "🧹 Cleaning up the installer file (omnipos-installer.sh) from Downloads..."
rm -f "$DOWNLOADS_DIR/omnipos-installer.sh" 2>/dev/null || true

if [ "$PLATFORM" = "termux" ]; then
    echo ""
    echo "🚀 Starting OmniPOS automatically..."
    cd "$INSTALL_DIR" || exit 1
    mkdir -p logs

    command -v termux-wake-lock >/dev/null 2>&1 && { timeout 3 termux-wake-lock || true; }

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
