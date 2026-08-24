#!/data/data/com.termux/files/usr/bin/bash

set -e

RECREATE_WIDGETS_VERSION="3"

FILES="Start-OmniPOS.sh Stop-OmniPOS.sh Restart-OmniPOS.sh OmniPOS-LAN.sh"

FORCE=0
for arg in "$@"; do
    [ "$arg" = "--force" ] && FORCE=1
done

needs_recreate() {
    for f in $FILES; do
        path="$HOME/.shortcuts/$f"
        [ -f "$path" ] || return 0
        grep -q "RECREATE_WIDGETS_VERSION:${RECREATE_WIDGETS_VERSION}" "$path" 2>/dev/null || return 0
    done
    return 1
}

countdown_close() {
    echo ""
    for i in 5 4 3 2 1; do
        printf "\rClosing Termux in %ds...   " "$i"
        sleep 1
    done
    echo ""
    exit 0
}

if [ "$FORCE" -ne 1 ] && ! needs_recreate; then
    echo ""
    echo "✅ NOT NEEDED — all 4 widget shortcuts already exist and are up to date in ~/.shortcuts/."
    echo "   This is most likely why the home-screen widget disappeared:"
    echo "     • The Termux:Widget app was only uninstalled/reinstalled, or"
    echo "     • The widget itself was only removed from the home screen."
    echo "   The actual .sh files (the only thing this script recreates) are still safe."
    echo ""
    echo "   Just do this instead:"
    echo "     1. Long-press the empty home screen"
    echo "     2. Tap 'Widgets'"
    echo "     3. Find 'Termux:Widget' and drag it to the home screen 4 times"
    echo "     4. Choose: Start-OmniPOS, Stop-OmniPOS, Restart-OmniPOS, OmniPOS-LAN"
    echo ""
    echo "   (To force-recreate anyway: bash recreate-widgets.sh --force)"
    countdown_close
fi

mkdir -p "$HOME/.shortcuts"

echo "🧷 Recreating the 4 widget shortcuts in ~/.shortcuts/ ..."

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
# comment near "exec" below.
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

# Fix: the server used to die when leaving/reopening the app because
# this script backgrounded start.sh with `disown` and then exited —
# Termux:Widget (RunCommandService) only keeps its background-kill
# protection alive while the invoking task is still running. Using
# `exec` instead keeps this same PID running (like a server started
# manually in an interactive Termux session) for as long as the
# server runs, retaining that protection.
exec ./start.sh >> logs/widget-run.log 2>&1
EOF
chmod +x "$HOME/.shortcuts/Start-OmniPOS.sh"

cat > "$HOME/.shortcuts/Stop-OmniPOS.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# RECREATE_WIDGETS_VERSION:3
echo "🛑 Stopping the OmniPOS server..."
pkill -f start.sh 2>/dev/null
pkill -f "node server.js" 2>/dev/null

for i in $(seq 1 20); do
    if ! pgrep -f "start\.sh" > /dev/null 2>&1 && ! pgrep -f "node server\.js" > /dev/null 2>&1; then
        break
    fi
    sleep 0.5
done
if pgrep -f "node server\.js" > /dev/null 2>&1 || pgrep -f "start\.sh" > /dev/null 2>&1; then
    echo "⚠️  Still running after 10s — force killing..."
    pkill -9 -f "node server.js" 2>/dev/null
    pkill -9 -f "start.sh" 2>/dev/null
    sleep 1
fi
rm -f ~/OMNIPOS/.start.sh.lock

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

for i in $(seq 1 20); do
    if ! pgrep -f "start\.sh" > /dev/null 2>&1 && ! pgrep -f "node server\.js" > /dev/null 2>&1; then
        break
    fi
    sleep 0.5
done
if pgrep -f "node server\.js" > /dev/null 2>&1 || pgrep -f "start\.sh" > /dev/null 2>&1; then
    echo "⚠️  Still running after 10s — force killing..."
    pkill -9 -f "node server.js" 2>/dev/null
    pkill -9 -f "start.sh" 2>/dev/null
    sleep 1
fi
rm -f ~/OMNIPOS/.start.sh.lock
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

echo ""
echo "✅ Recreated the 4 widget shortcuts (~/OMNIPOS and the database were not touched)."
echo ""
echo "Next steps on the client's device:"
echo "  1. Long-press the empty home screen"
echo "  2. Tap 'Widgets'"
echo "  3. Find 'Termux:Widget' and drag it to the home screen — 4 TIMES (once per shortcut)"
echo "  4. Choose: 'Start-OmniPOS', 'Stop-OmniPOS', 'Restart-OmniPOS', 'OmniPOS-LAN'"
