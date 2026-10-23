#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")" || exit 1

LOG_DIR="./logs"
LOG_FILE="$LOG_DIR/supervisor.log"
LOCK_FILE="./.start.sh.lock"
# Bug fix (root cause of the endless "Verify live" hang): server.js
# now creates this backup (SELF_UPDATE_BACKUP_DIR in server.js) BEFORE
# applying a self-update. If a crash loop happens after a restart (for
# any reason — mismatched dependency, a broken new release, etc.), the
# supervisor loop below restores this last-known-good version instead
# of crash-looping forever while the UI stays stuck on "Verify live."
SELF_UPDATE_BACKUP_DIR="./.self-update-backup"

NORMAL_DELAY=1
CRASH_DELAY=5
BACKOFF_DELAY=30
CRASH_WINDOW=60
CRASH_THRESHOLD=5

mkdir -p "$LOG_DIR"

# SCALE: iwasang lumaki nang walang hangganan ang mga log. Kapag lampas 5 MB, itabi ang huling ~1 MB at burahin ang iba.
for _lf in "$LOG_DIR/supervisor.log" "$LOG_DIR/widget-run.log"; do
    if [ -f "$_lf" ] && [ "$(wc -c < "$_lf" 2>/dev/null || echo 0)" -gt 5242880 ]; then
        tail -c 1048576 "$_lf" > "$_lf.tmp" 2>/dev/null && cat "$_lf.tmp" > "$_lf" && rm -f "$_lf.tmp"
    fi
done

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

is_our_supervisor_pid() {
    local pid="$1" cmd cwd stat state
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" != "$$" ] || return 0
    kill -0 "$pid" 2>/dev/null || return 1
    # A zombie is not a running supervisor, even though kill -0 may succeed.
    stat="$(cat "/proc/$pid/stat" 2>/dev/null || true)"
    state="$(printf '%s' "$stat" | awk '{print $3}')"
    [ "$state" != "Z" ] || return 1
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$PWD" ] || return 1
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmd" in *start.sh*) return 0;; esac
    return 1
}

# Check the legacy PID file first so upgrades from an older start.sh still
# respect an already-running supervisor. Then use an atomic directory lock to
# prevent two new launcher requests from passing the check simultaneously.
# Keep the legacy PID file because the APK reads it.
LOCK_DIR="./.start.sh.lock.d"
OLD_PID="$(cat "$LOCK_FILE" 2>/dev/null)"
if is_our_supervisor_pid "$OLD_PID"; then
    log "❌ May tumatakbo na supervisor loop (PID $OLD_PID). Hindi na papatakbuhin ulit."
    exit 1
fi
if [ -f "$LOCK_FILE" ]; then
    log "⚠️  May stale/reused-PID lock file (PID ${OLD_PID:-unknown}) — nililinis."
    rm -f "$LOCK_FILE"
fi
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # A directory without a valid PID file is a stale lock from an interrupted
    # launch. Remove it only if empty, then make one atomic retry.
    rmdir "$LOCK_DIR" 2>/dev/null || {
        log "❌ May ibang launcher o hindi malinis na lock directory; hindi magsisimula ng duplicate supervisor."
        exit 1
    }
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        log "❌ May ibang launcher na nauna; hindi magsisimula ng duplicate supervisor."
        exit 1
    fi
fi
# Fail clearly rather than entering an endless retry loop if the runtime/package is missing.
if ! command -v node >/dev/null 2>&1; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
    log "❌ Hindi makita ang Node.js (node). Hindi maaaring simulan ang server."
    exit 127
fi
if [ ! -f ./server.js ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
    log "❌ Nawawala ang server.js sa $PWD. Hindi maaaring simulan ang server."
    exit 2
fi
printf '%s\n' "$$" > "$LOCK_FILE"

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

SERVER_PID=""
CLEANING_UP=0
cleanup() {
    [ "$CLEANING_UP" -eq 0 ] || return
    CLEANING_UP=1
    trap '' INT TERM
    log "🛑 Ihihinto ang supervisor loop (signal received)."
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill -TERM "$SERVER_PID" 2>/dev/null || true
        for _ in 1 2 3 4 5; do
            kill -0 "$SERVER_PID" 2>/dev/null || break
            sleep 1
        done
        kill -KILL "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    [ "$HAS_TERMUX_API" -eq 1 ] && termux-wake-unlock 2>/dev/null || true
    command -v termux-notification-remove >/dev/null 2>&1 && termux-notification-remove omnipos-supervisor || true
    # Remove locks only if they still identify this exact supervisor.
    if [ "$(cat "$LOCK_FILE" 2>/dev/null)" = "$$" ]; then
        rm -f "$LOCK_FILE"
        rmdir "$LOCK_DIR" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup INT TERM

# Bug fix: restores the backed-up last-known-good version (if any)
# back to the app root, then deletes the backup dir afterward — so it
# doesn't get restored again on a later, unrelated crash loop. See the
# SELF_UPDATE_BACKUP_DIR comment above and the larger comment in
# server.js (SELF_UPDATE_BACKUP_DIR) for the full context.
restore_self_update_backup() {
    if [ -d "$SELF_UPDATE_BACKUP_DIR" ] && [ -z "$(find "$SELF_UPDATE_BACKUP_DIR" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
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

    # Fix: run node PLAIN, no setsid. setsid puts node in a brand new
    # session, detached from start.sh's own session — which escapes
    # the exact protection the widget's `exec ./start.sh` trick gives.
    # start.sh (and its wake-lock notification) stays alive, but a
    # setsid'd node child does not — Android kills it as soon as you
    # leave and reopen the app. Plain `node server.js` (same session
    # as start.sh) does not have this problem.
    # Track the server PID explicitly. This lets the TERM handler stop the
    # server gracefully, wait briefly for its final database snapshot, then
    # force-stop only if it ignored TERM. Without this, shutdown can leave a
    # live child while the next launcher sees the old supervisor lock.
    node server.js &
    SERVER_PID=$!
    wait "$SERVER_PID"
    EXIT_CODE=$?
    SERVER_PID=""

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

        # Bug fix: before just backing off 30s and crash-looping
        # again, check first whether there's a backed-up last-known-
        # good version from a self-update — if so, restore it right
        # away so the device auto-recovers instead of staying stuck on
        # "Verify live" in the UI waiting for a manual fix.
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
