#!/data/data/com.termux/files/usr/bin/bash

set -e

RECREATE_WIDGETS_VERSION="2"

FILES="Start-OmniPOS.sh Stop-OmniPOS.sh Restart-OmniPOS.sh OmniPOS-LAN.sh"

FORCE=0
for arg in "$@"; do
    [ "$arg" = "--force" ] && FORCE=1
done

needs_recreate() {
    for f in $FILES; do
        path="$HOME/.shortcuts/$f"
        [ -f "$path" ] || return 0   # missing file -> kailangan
        grep -q "RECREATE_WIDGETS_VERSION:${RECREATE_WIDGETS_VERSION}" "$path" 2>/dev/null || return 0  # outdated -> kailangan
    done
    return 1  # lahat present at updated -> hindi kailangan
}

countdown_close() {
    echo ""
    for i in 5 4 3 2 1; do
        printf "\r⏳ Isasara ang Termux sa loob ng %ds... / Closing Termux in %ds...   " "$i" "$i"
        sleep 1
    done
    echo ""
    exit 0
}

if [ "$FORCE" -ne 1 ] && ! needs_recreate; then
    echo ""
    echo "✅ HINDI KAILANGAN — kumpleto at updated na ang 4 widget shortcuts sa ~/.shortcuts/."
    echo "   Malamang ito ang dahilan kung bakit nawala ang widget sa home screen:"
    echo "     • Na-uninstall/na-reinstall lang ang Termux:Widget app, o"
    echo "     • Aksidenteng natanggal lang ang widget mismo sa home screen."
    echo "   Ang mismong .sh files (na kailangan lang ng script na ito) ay LIGTAS pa rin dito."
    echo ""
    echo "   Gawin na lang ito:"
    echo "     1. I-long-press ang blangkong home screen"
    echo "     2. Piliin ang 'Widgets'"
    echo "     3. Hanapin ang 'Termux:Widget', i-drag ito 4 beses papunta sa home screen"
    echo "     4. Piliin: Start-OmniPOS, Stop-OmniPOS, Restart-OmniPOS, OmniPOS-LAN"
    echo ""
    echo "------------------------------------------------------------------"
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
    echo "   (Kung gusto mo pa ring pilit i-recreate / to force-recreate anyway: bash recreate-widgets.sh --force)"
    countdown_close
fi

mkdir -p "$HOME/.shortcuts"

echo "🧷 Ginagawa ulit ang 4 widget shortcuts sa ~/.shortcuts/ ..."

cat > "$HOME/.shortcuts/Start-OmniPOS.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# RECREATE_WIDGETS_VERSION:2
command -v termux-wake-lock >/dev/null 2>&1 && timeout 3 termux-wake-lock
cd ~/OMNIPOS || { echo "❌ Could not find the ~/OMNIPOS folder."; exit 1; }
mkdir -p logs

echo ""
echo "⏳ Starting the OmniPOS server, please wait..."
echo ""

if command -v setsid >/dev/null 2>&1; then
    setsid nohup ./start.sh > logs/widget-run.log 2>&1 &
else
    nohup ./start.sh > logs/widget-run.log 2>&1 &
fi
disown

for i in $(seq 1 60); do
  if curl -s -o /dev/null http://localhost:3000/; then
    echo "✅ Server ready — opening OmniPOS..."
    sleep 1
    break
  fi
  sleep 0.5
done

command -v termux-open-url >/dev/null 2>&1 && termux-open-url http://localhost:3000/
exit
EOF
chmod +x "$HOME/.shortcuts/Start-OmniPOS.sh"

cat > "$HOME/.shortcuts/Stop-OmniPOS.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# RECREATE_WIDGETS_VERSION:2
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
# RECREATE_WIDGETS_VERSION:2
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

if command -v setsid >/dev/null 2>&1; then
    setsid nohup ./start.sh > logs/widget-run.log 2>&1 &
else
    nohup ./start.sh > logs/widget-run.log 2>&1 &
fi
disown

for i in $(seq 1 60); do
  if curl -s -o /dev/null http://localhost:3000/; then
    echo "✅ Server ready — opening OmniPOS..."
    sleep 1
    break
  fi
  sleep 0.5
done

command -v termux-open-url >/dev/null 2>&1 && termux-open-url http://localhost:3000/
exit
EOF
chmod +x "$HOME/.shortcuts/Restart-OmniPOS.sh"

cat > "$HOME/.shortcuts/OmniPOS-LAN.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# RECREATE_WIDGETS_VERSION:2
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

if command -v setsid >/dev/null 2>&1; then
    NODE_ENV=production setsid nohup ./start.sh > logs/widget-run.log 2>&1 &
else
    NODE_ENV=production nohup ./start.sh > logs/widget-run.log 2>&1 &
fi
disown

SERVER_UP=0
for i in $(seq 1 180); do
  if curl -s -o /dev/null "http://localhost:3000/"; then
    SERVER_UP=1
    echo ""
    break
  fi
  if [ $((i % 4)) -eq 0 ]; then printf "."; fi
  sleep 0.5
done

if [ "$SERVER_UP" -ne 1 ]; then
  echo "⚠️  Server is not responding yet. Check: tail -n 40 logs/supervisor.log"
  command -v termux-toast >/dev/null 2>&1 && termux-toast "⚠️ Hasn't started yet — check the logs."
  sleep 8
  exit 1
fi

LAN_URL="http://$LAN_IP:3000"
LOCAL_URL="http://localhost:3000"
echo "🌐 Open on another device (same WiFi): $LAN_URL"
echo ""

command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$LOCAL_URL"
command -v termux-toast >/dev/null 2>&1 && termux-toast "✅ Server ready: $LOCAL_URL"

sleep 20
am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1
exit 0
EOF
chmod +x "$HOME/.shortcuts/OmniPOS-LAN.sh"

echo ""
echo "✅ Nagawa ulit ang 4 widget shortcuts (hindi nagalaw ang ~/OMNIPOS o ang database)."
echo ""
echo "Susunod na hakbang sa device ng client:"
echo "  1. Long-press sa blangkong home screen"
echo "  2. Piliin ang 'Widgets'"
echo "  3. Hanapin at i-drag ang 'Termux:Widget' — 4 BESES (isa per shortcut)"
echo "  4. Piliin: 'Start-OmniPOS', 'Stop-OmniPOS', 'Restart-OmniPOS', 'OmniPOS-LAN'"
