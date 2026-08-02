#!/data/data/com.termux/files/usr/bin/bash
#
# start.sh — OMNIPOS supervisor loop para sa Termux.
#
# Bakit kailangan ito: kapag pinatakbo mo lang ng direkta ang
# "node server.js", isang beses lang tatakbo iyon — kapag lumabas
# ang process (halimbawa: pagkatapos mag-self-update ang system sa
# Settings > Check for Updates, o kung sakaling mag-crash), kailangan
# mo pa ring i-run ulit manually.
#
# Ang script na ito ay isang tuloy-tuloy na loop: kapag lumabas ang
# "node server.js" sa kahit anong dahilan, awtomatiko itong
# papatakbuhin ulit — kaya kapag nag-deploy ng bagong update ang
# customer, hindi na niya kailangang buksan pa ulit ang Termux at
# i-type ulit ang "node server.js".
#
# PAANO GAMITIN (isang beses lang ito i-setup):
#   1. cd sa install folder ng OMNIPOS (kung nasaan ang server.js)
#   2. chmod +x start.sh
#   3. ./start.sh
#
# Iwanan mo na lang bukas ang Termux session na ito (o gamitin ang
# Termux widget/notification para hindi ito ma-close ng Android).

cd "$(dirname "$0")" || exit 1

echo "🚀 OMNIPOS supervisor loop — sinisimulan ang server.js..."

while true; do
    node server.js
    EXIT_CODE=$?
    # SPEED FIX: mula 2s -> 1s ang delay bago mag-restart. Sapat pa rin
    # ito para makasingit ang OS na tuluyang mapalaya ang PORT/socket ng
    # nakaraang process bago subukan ulit i-bind ng bagong "node
    # server.js" (kaya iniwan pa rin ang maikling delay na ito sa halip
    # na 0), pero mas mabilis nang maka-recover kaysa dating 2s — mas
    # maiksi ang downtime na nararamdaman ng customer sa bawat self-
    # update o hindi-inaasahang exit.
    echo "⚠️  Lumabas ang OMNIPOS server.js (exit code: ${EXIT_CODE}). Magre-restart sa loob ng 1 segundo..."
    sleep 1
done
