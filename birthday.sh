#!/data/data/com.termux/files/usr/bin/bash

clear

# 🎨 COLORS
RED='\033[1;31m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
MAGENTA='\033[1;35m'
CYAN='\033[1;36m'
WHITE='\033[1;37m'
RESET='\033[0m'

tput civis 2>/dev/null

cleanup() {
    tput cnorm 2>/dev/null
    clear
    exit
}

trap cleanup INT TERM

# ✨ INTRO
printf "\n\n"
printf "${MAGENTA}        ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨${RESET}\n\n"
printf "${CYAN}              G E T   R E A D Y . . .${RESET}\n\n"

sleep 0.7
printf "${YELLOW}                    3${RESET}"
sleep 0.8
printf "\r                    2"
sleep 0.8
printf "\r                    1"
sleep 0.8

clear

# 🎉 NAME REVEAL
printf "\n\n"
printf "${MAGENTA}          ╔══════════════════════════════════════╗${RESET}\n"
printf "${MAGENTA}          ║                                      ║${RESET}\n"
printf "${MAGENTA}          ║${RESET}       ${YELLOW}🎀  S U R P R I S E  🎀${RESET}       ${MAGENTA}║${RESET}\n"
printf "${MAGENTA}          ║                                      ║${RESET}\n"
printf "${MAGENTA}          ╚══════════════════════════════════════╝${RESET}\n\n"

sleep 1

printf "${CYAN}                 💖 J O S E P H I N E 💖${RESET}\n\n"

sleep 1

# 🎆 MAIN ANIMATION
for i in {1..6}; do
    clear

    printf "\n\n"

    if (( i % 2 == 0 )); then
        printf "${RED}              🎉   ✨   🎊   ✨   🎉${RESET}\n"
        printf "${YELLOW}            ✨                         ✨${RESET}\n"
    else
        printf "${YELLOW}            ✨                         ✨${RESET}\n"
        printf "${RED}              🎊   ✨   🎉   ✨   🎊${RESET}\n"
    fi

    printf "\n"

    printf "${MAGENTA}        ██████╗  ██████╗ ███████╗███████╗██████╗${RESET}\n"
    printf "${MAGENTA}        ██╔══██╗██╔═══██╗██╔════╝██╔════╝██╔══██╗${RESET}\n"
    printf "${CYAN}        ██████╔╝██║   ██║███████╗█████╗  ██████╔╝${RESET}\n"
    printf "${CYAN}        ██╔══██╗██║   ██║╚════██║██╔══╝  ██╔═══╝${RESET}\n"
    printf "${GREEN}        ██║  ██║╚██████╔╝███████║███████╗██║${RESET}\n"
    printf "${GREEN}        ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝╚═╝${RESET}\n"

    printf "\n"

    printf "${YELLOW}              🎂  J O S E P H I N E  🎂${RESET}\n\n"

    printf "${RED}                 🎈    🎈    🎈${RESET}\n"
    printf "${BLUE}              🎁    🎊    🎁    🎊${RESET}\n"

    sleep 0.45
done

# 🌟 FINAL GREETING
clear

printf "\n"

printf "${YELLOW}          ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨${RESET}\n\n"

printf "${MAGENTA}              🎉 H A P P Y 🎉${RESET}\n"
printf "${CYAN}             B I R T H D A Y !${RESET}\n\n"

printf "${RED}                  💖 JOSEPHINE 💖${RESET}\n\n"

printf "${GREEN}              🎂   🎂   🎂   🎂${RESET}\n"
printf "${YELLOW}           🎈     🎁     🎊     🎈${RESET}\n\n"

printf "${WHITE}       Wishing you a beautiful and wonderful${RESET}\n"
printf "${WHITE}              birthday, Josephine! 💐${RESET}\n\n"

printf "${CYAN}       May your day be filled with happiness,${RESET}\n"
printf "${MAGENTA}       love, laughter and unforgettable moments. 💕${RESET}\n\n"

printf "${YELLOW}              ✨ KEEP SMILING! ✨${RESET}\n"
printf "${GREEN}              ✨ KEEP SHINING! ✨${RESET}\n\n"

printf "${RED}           🎉 HAPPY BIRTHDAY JOSEPHINE! 🎉${RESET}\n\n"

printf "${MAGENTA}        ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★${RESET}\n\n"

# 🎆 SPARKLE
for i in {1..10}; do
    printf "\r${RED}       🎉     ✨     🎊     ✨     🎉${RESET}"
    sleep 0.20
    printf "\r${YELLOW}       ✨     🎉     ✨     🎊     ✨${RESET}"
    sleep 0.20
done

printf "\n\n"
printf "${CYAN}              💖 HAPPY BIRTHDAY! 💖${RESET}\n\n"

tput cnorm 2>/dev/null

