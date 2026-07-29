#!/data/data/com.termux/files/usr/bin/bash
#
# tunnel-autorestart.sh
# Auto-restart ng cloudflared Quick Tunnel + QR code display.
# Kapag namatay ang tunnel (Error 1033 / process crash), automatic
# itong mag-restart at gagawa ng bagong link + QR code.
#
# GAMIT:
#   1. Palitan ang PORT kung iba (default 3000, tugma sa OMNIPOS server.js)
#   2. chmod +x tunnel-autorestart.sh
#   3. termux-wake-lock          <-- IMPORTANTE, para hindi patayin ni Android ang session
#   4. ./tunnel-autorestart.sh
#
# I-STOP: CTRL+C

PORT=3000
LOG_FILE="cf.log"
MAX_WAIT=30   # segundo na hihintayin bago mag-timeout habang naghahanap ng URL

echo "=============================================="
echo "  Auto-Restart Tunnel Monitor - Port $PORT"
echo "=============================================="
echo ""

# Siguraduhing may qrencode
if ! command -v qrencode >/dev/null 2>&1; then
    echo "[!] Wala pang qrencode. I-install muna:"
    echo "    pkg install qrencode -y"
    exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
    echo "[!] Wala pang cloudflared. I-install muna:"
    echo "    pkg install cloudflared -y"
    exit 1
fi

# ---------------------------------------------------------
# Auto-gawa ng bagong Termux tab/session para sa RELAY server
# (cd ~/RELAY && node server.js) gamit ang Termux RUN_COMMAND.
#
# Kung mabigo ang RUN_COMMAND (hal. "service communication error"),
# awtomatikong susubukan itong ayusin (allow-external-apps), at kung
# di pa rin gumana, ipapatakbo na lang ang RELAY sa background bilang
# fallback para hindi bumagsak ang buong monitor.
# ---------------------------------------------------------
RELAY_DIR="$HOME/RELAY"
TERMUX_PROPS="$HOME/.termux/termux.properties"

ensure_allow_external_apps() {
    mkdir -p "$HOME/.termux"
    touch "$TERMUX_PROPS"

    if grep -qE '^\s*allow-external-apps\s*=\s*true' "$TERMUX_PROPS" 2>/dev/null; then
        return 0
    fi

    echo "[*] Wala pang 'allow-external-apps=true' sa termux.properties, idinadagdag..."
    # Alisin muna ang lumang commented-out o mali/false na linya (kung meron), tapos
    # magdagdag ng malinis na linya.
    sed -i '/allow-external-apps/d' "$TERMUX_PROPS"
    echo "allow-external-apps = true" >> "$TERMUX_PROPS"

    if command -v termux-reload-settings >/dev/null 2>&1; then
        termux-reload-settings
        echo "[✓] Na-reload ang settings. Kung una mo pa lang ito nagawa,"
        echo "    i-restart muna ang Termux app para siguradong bumisa ito."
    else
        echo "[!] Hindi mahanap ang termux-reload-settings. I-restart na lang"
        echo "    manually ang Termux app para bumisa ang setting."
    fi
    return 1   # bagong-dagdag lang, baka kailangan pa ng restart bago gumana
}

start_relay_background_fallback() {
    echo "[*] Fallback: direktang pinapaandar ang RELAY sa background dito sa session na ito..."
    ( cd "$RELAY_DIR" && nohup node server.js >> "$HOME/RELAY/relay-fallback.log" 2>&1 & disown )
    sleep 1
    if pgrep -f "node .*RELAY.*server.js" >/dev/null 2>&1; then
        echo "[✓] Tumakbo ang RELAY server sa background (walang hiwalay na tab)."
        echo "    Log: $RELAY_DIR/relay-fallback.log"
    else
        echo "[!] Hindi pa rin natakbo ang RELAY server. I-check ang node/dependencies,"
        echo "    o subukan manual: cd $RELAY_DIR && node server.js"
    fi
}

start_relay_tab() {
    if [ ! -d "$RELAY_DIR" ]; then
        echo "[!] Hindi makita ang $RELAY_DIR, nilaktawan ang RELAY tab."
        return
    fi

    ensure_allow_external_apps

    echo "[*] Ginagawa ang bagong tab para sa RELAY server..."
    am_err=$(am startservice --user 0 -n com.termux/com.termux.app.RunCommandService \
        -a com.termux.RUN_COMMAND \
        --es com.termux.RUN_COMMAND_PATH "/data/data/com.termux/files/usr/bin/bash" \
        --es com.termux.RUN_COMMAND_ARGUMENTS "-c,cd $RELAY_DIR && node server.js" \
        --es com.termux.RUN_COMMAND_WORKDIR "$RELAY_DIR" \
        --ez com.termux.RUN_COMMAND_BACKGROUND false \
        --es com.termux.RUN_COMMAND_SESSION_ACTION 0 \
        2>&1)
    am_status=$?

    if [ $am_status -eq 0 ] && ! echo "$am_err" | grep -qiE 'error|not allowed|not found'; then
        echo "[✓] Nagawa na ang RELAY tab (cd $RELAY_DIR && node server.js)."
    else
        echo "[!] Nabigo gawin ang RELAY tab sa RUN_COMMAND. Detalye ng error:"
        echo "    ${am_err:-'(walang output, exit code '"$am_status"')'}"
        echo "[!] Posibleng dahilan: allow-external-apps kailangan pa ng Termux"
        echo "    restart, naka-on ang battery optimization, o na-block ng Android"
        echo "    ang background service start."
        start_relay_background_fallback
    fi
}

start_relay_tab

RUN_COUNT=0
FAIL_STREAK=0
PROTOCOL="quic"

while true; do
    RUN_COUNT=$((RUN_COUNT + 1))
    echo ""
    echo "---------- [Run #$RUN_COUNT] Nag-start ng bagong tunnel (protocol: $PROTOCOL) ----------"
    : > "$LOG_FILE"   # i-clear ang log bago mag-restart

    # Kung 2 beses na nag-fail ang quic (karaniwang dahilan: naka-block ang
    # UDP/TCP papuntang port 7844 ng network/ISP/firewall), lumipat sa http2.
    if [ "$FAIL_STREAK" -ge 2 ] && [ "$PROTOCOL" = "quic" ]; then
        echo "[!] Paulit-ulit na fail ang quic protocol (posibleng naka-block ang"
        echo "    port 7844 sa network mo). Lumilipat sa --protocol http2..."
        PROTOCOL="http2"
        FAIL_STREAK=0
    fi

    # Patakbuhin ang cloudflared sa background, i-log sa cf.log
    cloudflared tunnel --protocol "$PROTOCOL" --url "http://localhost:$PORT" > "$LOG_FILE" 2>&1 &
    CF_PID=$!

    # Hintayin lumabas ang URL sa log (max 30 seconds)
    url=""
    for i in $(seq 1 "$MAX_WAIT"); do
        url=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOG_FILE" | head -n1)
        if [ -n "$url" ]; then
            break
        fi
        # kung namatay na agad ang process bago pa lumabas ang URL
        if ! kill -0 "$CF_PID" 2>/dev/null; then
            break
        fi
        sleep 1
    done

    if [ -n "$url" ]; then
        FAIL_STREAK=0
        echo ""
        echo "=============================================="
        echo "  LINK: $url"
        echo "=============================================="
        qrencode -t ANSIUTF8 "$url"
        echo ""
        echo "Naka-monitor ngayon ang tunnel na ito (PID $CF_PID)."
        echo "Kung mamatay ito, automatic magiging bago ang link at QR."
    else
        echo "[!] Walang nakuhang URL sa loob ng ${MAX_WAIT}s. Content ng $LOG_FILE:"
        cat "$LOG_FILE"
        FAIL_STREAK=$((FAIL_STREAK + 1))
        echo "[!] Susubukan ulit mag-restart sa 5 segundo... (fail streak: $FAIL_STREAK)"
        kill "$CF_PID" 2>/dev/null
        sleep 5
        continue
    fi

    # Bantayan ang process habang buhay; kapag namatay, mag-loop ulit
    wait "$CF_PID"
    echo ""
    echo "[!] Namatay ang tunnel process. Mag-restart sa 3 segundo..."
    sleep 3
done
