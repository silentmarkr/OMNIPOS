#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")" || exit 1

LOG_DIR="./logs"
LOG_FILE="$LOG_DIR/supervisor.log"
LOCK_FILE="./.start.sh.lock"
# BUG FIX (root cause ng walang-katapusang "Verify live" stack-up):
# ginagawa ngayon ng server.js ang backup na ito (SELF_UPDATE_BACKUP_DIR
# sa server.js) BAGO mag-apply ng self-update. Kapag may crash loop
# pagkatapos ng restart (bago o luma man ang dahilan — mismatched
# dependency, sirang bagong release, atbp.), ibinabalik agad dito ng
# supervisor loop ang dating gumaganang bersyon sa halip na paikot-ikot
# na mag-crash magpakailanman habang nakatigil ang "Verify live" sa UI.
SELF_UPDATE_BACKUP_DIR="./.self-update-backup"

NORMAL_DELAY=1
CRASH_DELAY=5
BACKOFF_DELAY=30
CRASH_WINDOW=60
CRASH_THRESHOLD=5

mkdir -p "$LOG_DIR"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

if [ -f "$LOCK_FILE" ]; then
    OLD_PID="$(cat "$LOCK_FILE" 2>/dev/null)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        log "❌ May tumatakbo na supervisor loop (PID $OLD_PID). Hindi na papatakbuhin ulit."
        exit 1
    else
        log "⚠️  May natirang lock file mula sa dating session (PID $OLD_PID, hindi na tumatakbo) — nililinis."
        rm -f "$LOCK_FILE"
    fi
fi
echo "$$" > "$LOCK_FILE"

HAS_TERMUX_API=0
if command -v termux-wake-lock >/dev/null 2>&1; then
    HAS_TERMUX_API=1
    timeout 3 termux-wake-lock
    log "🔒 Termux wake-lock enabled (pinipigilan ng Android na i-kill ang session)."
fi
if command -v termux-notification >/dev/null 2>&1; then
    timeout 3 termux-notification --id omnipos-supervisor \
        --title "OMNIPOS" \
        --content "Tumatakbo ang supervisor loop." \
        --ongoing
fi

cleanup() {
    log "🛑 Ihihinto ang supervisor loop (signal received)."
    [ "$HAS_TERMUX_API" -eq 1 ] && termux-wake-unlock 2>/dev/null
    command -v termux-notification-remove >/dev/null 2>&1 && termux-notification-remove omnipos-supervisor
    rm -f "$LOCK_FILE"
    exit 0
}
trap cleanup INT TERM

# BUG FIX: ibinabalik ang naka-backup na dating gumaganang bersyon
# (kung mayroon) pabalik sa app root, at binubura ang backup dir
# pagkatapos — para hindi na ito paulit-ulit na maibalik sa susunod na
# hindi-naman-related na crash loop. Tingnan ang komento sa itaas ng
# SELF_UPDATE_BACKUP_DIR at ang malaking komento sa server.js
# (SELF_UPDATE_BACKUP_DIR) para sa buong konteksto.
restore_self_update_backup() {
    if [ -d "$SELF_UPDATE_BACKUP_DIR" ]; then
        log "🔙 Crash loop pagkatapos ng self-update — nakita ang backup ng dating bersyon. Ibinabalik ito bago subukan ulit..."
        cp -a "$SELF_UPDATE_BACKUP_DIR/." ./ 2>>"$LOG_FILE"
        rm -rf "$SELF_UPDATE_BACKUP_DIR"
        log "✅ Naibalik na ang dating gumaganang bersyon. Susubukan ulit patakbuhin ang server.js."
        return 0
    fi
    return 1
}

log "🚀 OMNIPOS supervisor loop — sinisimulan ang server.js..."

crash_timestamps=()

while true; do

    if command -v setsid >/dev/null 2>&1; then
        setsid node server.js
    else
        node server.js
    fi
    EXIT_CODE=$?

    if [ "$EXIT_CODE" -eq 0 ]; then

        log "ℹ️  Lumabas nang normal ang server.js (exit code 0) — malamang self-update. Magre-restart sa loob ng ${NORMAL_DELAY}s..."
        sleep "$NORMAL_DELAY"
        continue
    fi

    now=$(date +%s)
    crash_timestamps+=("$now")

    cutoff=$((now - CRASH_WINDOW))
    filtered=()
    for t in "${crash_timestamps[@]}"; do
        [ "$t" -ge "$cutoff" ] && filtered+=("$t")
    done
    crash_timestamps=("${filtered[@]}")
    crash_count=${#crash_timestamps[@]}

    log "⚠️  Lumabas ang server.js sa error (exit code: ${EXIT_CODE}). ${crash_count} crash(es) sa loob ng huling ${CRASH_WINDOW}s."

    if [ "$crash_count" -ge "$CRASH_THRESHOLD" ]; then
        log "🔴 CRASH LOOP DETECTED — ${crash_count} crashes sa loob ng ${CRASH_WINDOW}s. I-check ang logs/supervisor.log at ang .env/database."

        # BUG FIX: bago basta mag-30s backoff at ulit-uliting mag-crash,
        # tingnan muna kung may naka-backup na dating gumaganang bersyon
        # mula sa isang self-update — kung meron, ibalik agad ito para
        # awtomatikong "gumaling" ang device sa halip na manatiling
        # walang-katapusang stuck ang "Verify live" sa UI habang
        # naghihintay ng manual na pag-aayos.
        if restore_self_update_backup; then
            crash_timestamps=()
            sleep "$CRASH_DELAY"
        else
            log "⏸️  Walang backup na maibabalik (hindi ito galing sa self-update) — titigil muna ng ${BACKOFF_DELAY}s bago subukan ulit."
            command -v termux-notification >/dev/null 2>&1 && termux-notification --id omnipos-crashloop \
                --title "⚠️ OMNIPOS crash loop" \
                --content "Paulit-ulit na crash — pakicheck ang server."
            sleep "$BACKOFF_DELAY"

            crash_timestamps=()
        fi
    else
        sleep "$CRASH_DELAY"
    fi
done
