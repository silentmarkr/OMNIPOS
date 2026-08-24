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
            # Launch the installed PWA (WebAPK) directly if present, to
            # skip the "choose OmniPOS or Chrome" chooser; otherwise
            # fall back to the browser.
            WEBAPK_PKG="$(pm list packages 2>/dev/null | sed -n 's/^package:\(org\.chromium\.webapk\..*\)$/\1/p' | head -n 1)"
            if [ -z "$WEBAPK_PKG" ] || ! am start -n "$WEBAPK_PKG/org.chromium.webapk.shell_apk.MainActivity" -d "$URL" >/dev/null 2>&1; then
                command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$URL"
            fi
            sleep 1
            am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1
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
            WEBAPK_PKG="$(pm list packages 2>/dev/null | sed -n 's/^package:\(org\.chromium\.webapk\..*\)$/\1/p' | head -n 1)"
            if [ -z "$WEBAPK_PKG" ] || ! am start -n "$WEBAPK_PKG/org.chromium.webapk.shell_apk.MainActivity" -d "$URL" >/dev/null 2>&1; then
                command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$URL"
            fi
            sleep 1
            am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1
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
    WEBAPK_PKG="$(pm list packages 2>/dev/null | sed -n 's/^package:\(org\.chromium\.webapk\..*\)$/\1/p' | head -n 1)"
    if [ -z "$WEBAPK_PKG" ] || ! am start -n "$WEBAPK_PKG/org.chromium.webapk.shell_apk.MainActivity" -d "$LOCAL_URL" >/dev/null 2>&1; then
        command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$LOCAL_URL"
    fi
    command -v termux-toast >/dev/null 2>&1 && termux-toast "✅ Server ready: $LOCAL_URL"

    sleep 20
    am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1
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
    echo "  - 'Start-OmniPOS'   = normal, same device only (localhost)"
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

    # Note: the OmniPOS PWA cannot be silently installed by a script —
    # Android requires one manual tap on "Install app"/"Add to Home
    # screen" in the browser, as a security restriction with no
    # workaround. Once installed, it is auto-detected and used instead
    # of the browser on every subsequent launch (Start/Restart/
    # OmniPOS-LAN widgets, and here) — no chooser dialog.
    if ! pm list packages 2>/dev/null | grep -q 'org\.chromium\.webapk\.'; then
        echo "💡 Tip: on first launch, tap \"Install app\"/\"Add to Home screen\""
        echo "   in the browser to make OmniPOS a standalone app (no address"
        echo "   bar, opens directly next time, no more \"choose OmniPOS or"
        echo "   Chrome\" prompt)."
        echo ""
    fi

    # Background helper: waits for the server, opens OmniPOS (as the
    # installed PWA if available), then hides Termux — see the comment
    # near "exec" below for why this runs separately from the server.
    (
        for i in $(seq 1 60); do
            if curl -s -o /dev/null http://localhost:3000/; then
                # "localhost" (not "127.0.0.1") is required by
                # WebAuthn/Fingerprint Login as a valid RP ID.
                URL="http://localhost:3000/"
                WEBAPK_PKG="$(pm list packages 2>/dev/null | sed -n 's/^package:\(org\.chromium\.webapk\..*\)$/\1/p' | head -n 1)"
                if [ -z "$WEBAPK_PKG" ] || ! am start -n "$WEBAPK_PKG/org.chromium.webapk.shell_apk.MainActivity" -d "$URL" >/dev/null 2>&1; then
                    command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$URL"

                    # Fix: if the PWA isn't installed yet, this is the
                    # ONE moment Android requires a manual tap (no way
                    # to script around that OS-level restriction). So
                    # actively wait for it here instead of leaving it
                    # to chance — once the tap happens, immediately
                    # relaunch as the installed PWA so the chooser
                    # never shows again from here on.
                    if [ -z "$WEBAPK_PKG" ]; then
                        command -v termux-toast >/dev/null 2>&1 && termux-toast "👉 Tap \"Install app\" / \"Add to Home screen\" to finish setup"
                        for j in $(seq 1 150); do
                            sleep 2
                            WEBAPK_PKG="$(pm list packages 2>/dev/null | sed -n 's/^package:\(org\.chromium\.webapk\..*\)$/\1/p' | head -n 1)"
                            if [ -n "$WEBAPK_PKG" ]; then
                                am start -n "$WEBAPK_PKG/org.chromium.webapk.shell_apk.MainActivity" -d "$URL" >/dev/null 2>&1
                                command -v termux-toast >/dev/null 2>&1 && termux-toast "✅ Installed — OmniPOS will open directly from now on."
                                break
                            fi
                        done
                    fi
                fi
                sleep 2
                am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1
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
