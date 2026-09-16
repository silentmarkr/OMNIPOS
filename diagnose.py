import os
import re

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def print_status(status, message):
    if status == "OK":
        print(f"  [{GREEN}✅ OK{RESET}] {message}")
    elif status == "FAIL":
        print(f"  [{RED}❌ FAIL{RESET}] {message}")
    elif status == "WARN":
        print(f"  [{YELLOW}⚠️ WARN{RESET}] {message}")
    elif status == "INFO":
        print(f"  [{CYAN}ℹ️ INFO{RESET}] {message}")

def run_diagnostics():
    print(f"\n{BOLD}{CYAN}🔍 OMNIPOS MODAL DIAGNOSTIC TOOL (TERMUX){RESET}\n" + "="*50)

    html_path = "public/index.html"
    js_path = "public/app.js"

    if not os.path.exists(html_path) or not os.path.exists(js_path):
        print_status("FAIL", "Siguraduhing nasa ~/OMNIPOS directory ka bago i-run ang script.")
        return

    with open(html_path, "r", encoding="utf-8", errors="ignore") as f:
        html_lines = f.readlines()
        html_content = "".join(html_lines)

    with open(js_path, "r", encoding="utf-8", errors="ignore") as f:
        js_lines = f.readlines()
        js_content = "".join(js_lines)

    targets = [
        {"name": "Add User Modal", "id": "user-modal", "fn": "openAddUserModal"},
        {"name": "Barcode Preview Modal", "id": "barcode-preview-modal", "fn": "generateSelectedBarcodePreview"}
    ]

    for item in targets:
        print(f"\n{BOLD}---> Testing: {item['name']}{RESET}")

        # 1. Check Function Declaration in app.js
        fn_matches = [idx + 1 for idx, line in enumerate(js_lines) if f"function {item['fn']}" in line]
        if fn_matches:
            print_status("OK", f"Function '{item['fn']}()' declared sa app.js (Line {fn_matches[0]})")
        else:
            print_status("FAIL", f"Walang 'function {item['fn']}()' na nahanap sa app.js!")

        # 2. Check if function interacts with the modal ID in app.js
        id_in_js = [idx + 1 for idx, line in enumerate(js_lines) if f"'{item['id']}'" in line or f'"{item["id"]}"' in line]
        if id_in_js:
            print_status("OK", f"Nahihipo ang modal ID '#{item['id']}' sa app.js (Line {', '.join(map(str, id_in_js))})")
        else:
            print_status("WARN", f"Ang ID na '#{item['id']}' ay HINDI tinatawag sa app.js! Baka walang JS code na nagpapabago sa display style nito.")

        # 3. Check Modal Element in index.html
        modal_matches = [idx + 1 for idx, line in enumerate(html_lines) if f'id="{item["id"]}"' in line or f"id='{item['id']}'" in line]
        if modal_matches:
            print_status("OK", f"Modal div '#{item['id']}' nahanap sa index.html (Line {modal_matches[0]})")
        else:
            print_status("FAIL", f"Walang HTML element na may id='{item['id']}' sa index.html!")

        # 4. Check Button Binding in index.html
        btn_matches = [idx + 1 for idx, line in enumerate(html_lines) if f"{item['fn']}()" in line and "onclick" in line]
        if btn_matches:
            print_status("OK", f"Button onclick='{item['fn']}()' nahanap sa index.html (Line {', '.join(map(str, btn_matches))})")
        else:
            print_status("FAIL", f"Walang button na may onclick='{item['fn']}()' sa index.html!")

if __name__ == "__main__":
    run_diagnostics()
