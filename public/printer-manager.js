

/* ==========================================================================
   Printer Device Settings — unified manager for Bluetooth, WiFi, and
   LAN (Ethernet cable) thermal receipt printers, with brand presets.

   Depends on globals already defined in bt-printer.js (loaded before this
   file): BT_PRINTER_DEFAULTS, BT_PRINTER_STORAGE_KEYS, btPrinterCharacteristic,
   getBtPrinterUuids(), buildEscPosReceiptBytes(), buildEscPosBarcodeSheetBytes(),
   buildEscPosCashDrawerKickBytes(), collectReceiptDataFromDom(), escposText().
   ========================================================================== */

// ---- Bluetooth brand presets -------------------------------------------------
// Web Bluetooth (the API Chrome exposes as navigator.bluetooth) can only reach
// Bluetooth LOW ENERGY (BLE) GATT services — it cannot reach classic
// Bluetooth/SPP (RFCOMM), which is what most official name-brand printers use
// for their Bluetooth option. Many inexpensive 58mm/80mm printers sold under
// different case brands share one of a small number of BLE-serial modules, so
// picking a "brand" below mostly narrows down which UUID pattern to try first,
// rather than a guaranteed unique code per brand.
const PRINTER_BT_BRAND_PRESETS = [
    {
        id: 'generic-18f0',
        label: 'Generic 58mm/80mm (Default)',
        serviceUuid: '000018f0-0000-1000-8000-00805f9b34fb',
        charUuid: '00002af1-0000-1000-8000-00805f9b34fb',
        note: 'Default ng OmniPOS. Gumagana ito sa halos lahat ng generic/no-name na BLE thermal printer, at sa maraming Xprinter/Rongta/Zjiang/GOOJPRT unit.'
    },
    {
        id: 'xprinter-rongta-goojprt',
        label: 'Xprinter / Rongta / GOOJPRT / HPRT / Gainscha (BLE variant)',
        serviceUuid: '0000ff00-0000-1000-8000-00805f9b34fb',
        charUuid: '0000ff02-0000-1000-8000-00805f9b34fb',
        note: 'Karaniwang ikalawang pattern na ginagamit ng ilang modelo ng mga brand na ito. Subukan ito kung "Not Found" ang error gamit ang Generic default.'
    },
    {
        id: 'ble-serial-ffe0',
        label: 'BLE-Serial / HM-10 Module (ilang Rongta / Zjiang / DIY printer board)',
        serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
        charUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
        note: 'Ginagamit ng ilang printer na may built-in generic BLE-UART/serial module.'
    },
    {
        id: 'epson-star-classic',
        label: 'Epson / Star Micronics / Bixolon / Citizen / SNBC (karamihan)',
        serviceUuid: '',
        charUuid: '',
        unsupported: true,
        note: 'Karamihan sa opisyal na Bluetooth printer ng mga brand na ito ay gumagamit ng CLASSIC Bluetooth (SPP), hindi BLE — kaya hindi ito ma-a-access ng Web Bluetooth (ang ginagamit ng Chrome). Gamitin sa halip ang "WiFi / LAN (Ethernet Cable)" section sa ibaba kung may WiFi o LAN port ang printer mo, o gamitin ang opisyal na printer app/driver ng brand.'
    },
    {
        id: 'custom',
        label: 'Custom / Manual Entry',
        serviceUuid: '',
        charUuid: '',
        note: 'Piliin ito kung alam mo na ang eksaktong Service/Characteristic UUID mula sa manual o specs ng iyong printer, at i-type nang manu-mano sa Advanced settings sa ibaba.'
    }
];
const PRINTER_BT_BRAND_STORAGE_KEY = 'omnipos_bt_printer_brand';

// ---- Network (WiFi / LAN cable) brand presets --------------------------------
// Network printers all speak the same raw ESC/POS-over-TCP protocol (the
// "port 9100 / JetDirect" convention) — this is a de-facto industry standard
// shared by virtually every brand that ships a WiFi or Ethernet module, so no
// special "brand code" is required, only the correct IP Address and Port.
const PRINTER_NET_BRAND_PRESETS = [
    {
        id: 'universal',
        label: 'Universal / Karamihan sa Brand (Epson, Star, Xprinter, Rongta, Zjiang, Bixolon, Citizen, SNBC, HPRT, Gainscha, POS-X, atbp.)',
        port: 9100,
        note: 'Halos lahat ng WiFi/LAN thermal printer ay gumagamit ng raw port 9100 bilang default nito diretso sa labas ng kahon.'
    },
    {
        id: 'epson-tcp',
        label: 'Epson TM-series (WiFi/Ethernet)',
        port: 9100,
        note: 'Karaniwang gumagamit ng port 9100. Puwedeng baguhin sa web config page ng printer kung na-configure mo ito papuntang ibang port.'
    },
    {
        id: 'star-tcp',
        label: 'Star Micronics (WiFi/Ethernet)',
        port: 9100,
        note: 'Karaniwan ding gumagamit ng port 9100 bilang default.'
    },
    {
        id: 'custom-port',
        label: 'Custom Port',
        port: 9100,
        note: 'Baguhin ang Port kung na-configure mo ang printer mo papunta sa ibang port bukod sa 9100.'
    }
];
const PRINTER_NET_DEFAULT_PORT = 9100;
const PRINTER_NET_STORAGE_KEYS = {
    host: 'omnipos_net_printer_host',
    port: 'omnipos_net_printer_port',
    connType: 'omnipos_net_printer_conn_type',
    brand: 'omnipos_net_printer_brand'
};

// ---- Shared helpers -----------------------------------------------------------
function uint8ArrayToBase64(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function getNetworkPrinterSettings() {
    return {
        host: localStorage.getItem(PRINTER_NET_STORAGE_KEYS.host) || '',
        port: parseInt(localStorage.getItem(PRINTER_NET_STORAGE_KEYS.port), 10) || PRINTER_NET_DEFAULT_PORT,
        connType: localStorage.getItem(PRINTER_NET_STORAGE_KEYS.connType) || 'wifi',
        brand: localStorage.getItem(PRINTER_NET_STORAGE_KEYS.brand) || 'universal'
    };
}

function isNetworkPrinterConfigured() {
    return !!getNetworkPrinterSettings().host;
}

// ---- UI: dropdown population & status ------------------------------------------
function populatePrinterBrandDropdowns() {
    const btSelect = document.getElementById('bt-printer-brand-select');
    if (btSelect && !btSelect.dataset.populated) {
        PRINTER_BT_BRAND_PRESETS.forEach((preset) => {
            const opt = document.createElement('option');
            opt.value = preset.id;
            opt.textContent = preset.label;
            btSelect.appendChild(opt);
        });
        btSelect.dataset.populated = 'true';
        let savedBrand = localStorage.getItem(PRINTER_BT_BRAND_STORAGE_KEY) || PRINTER_BT_BRAND_PRESETS[0].id;
        btSelect.value = savedBrand;
        if (btSelect.value !== savedBrand) {
            // Stored brand id no longer matches any option (e.g. presets were
            // renamed/removed in an update) — setting .value to an unknown
            // option leaves the <select> showing blank instead of falling
            // back, even though the note text below already defaults fine.
            savedBrand = PRINTER_BT_BRAND_PRESETS[0].id;
            btSelect.value = savedBrand;
            localStorage.setItem(PRINTER_BT_BRAND_STORAGE_KEY, savedBrand);
        }
        renderBtPrinterBrandNote(savedBrand);
    }

    const netSelect = document.getElementById('net-printer-brand-select');
    if (netSelect && !netSelect.dataset.populated) {
        PRINTER_NET_BRAND_PRESETS.forEach((preset) => {
            const opt = document.createElement('option');
            opt.value = preset.id;
            opt.textContent = preset.label;
            netSelect.appendChild(opt);
        });
        netSelect.dataset.populated = 'true';
        let savedNetBrand = getNetworkPrinterSettings().brand;
        netSelect.value = savedNetBrand;
        if (netSelect.value !== savedNetBrand) {
            // Same fallback gap as the BT dropdown above.
            savedNetBrand = PRINTER_NET_BRAND_PRESETS[0].id;
            netSelect.value = savedNetBrand;
            localStorage.setItem(PRINTER_NET_STORAGE_KEYS.brand, savedNetBrand);
        }
        renderNetPrinterBrandNote(savedNetBrand);
    }
}

function renderBtPrinterBrandNote(brandId) {
    const preset = PRINTER_BT_BRAND_PRESETS.find((p) => p.id === brandId) || PRINTER_BT_BRAND_PRESETS[0];
    const noteEl = document.getElementById('bt-printer-brand-note');
    if (noteEl) {
        noteEl.textContent = preset.note || '';
        // Red/warning styling means "this option won't work with Web Bluetooth",
        // not just "no UUID to prefill" — "Custom / Manual Entry" also has no
        // serviceUuid but is a perfectly valid, non-error choice.
        noteEl.style.color = preset.unsupported ? '#ef4444' : 'var(--text-muted)';
    }
}

function renderNetPrinterBrandNote(brandId) {
    const preset = PRINTER_NET_BRAND_PRESETS.find((p) => p.id === brandId) || PRINTER_NET_BRAND_PRESETS[0];
    const noteEl = document.getElementById('net-printer-brand-note');
    if (noteEl) noteEl.textContent = preset.note || '';
}

// Fills the Service/Characteristic UUID fields from the selected brand preset.
// This only fills the fields — the user still needs to press "Save UUID
// Settings" (existing bt-printer.js button) to actually apply it, same as
// manually typing the values in before.
function applyBtPrinterBrandPreset() {
    const select = document.getElementById('bt-printer-brand-select');
    if (!select) return;
    const brandId = select.value;
    localStorage.setItem(PRINTER_BT_BRAND_STORAGE_KEY, brandId);
    renderBtPrinterBrandNote(brandId);

    const preset = PRINTER_BT_BRAND_PRESETS.find((p) => p.id === brandId);
    if (!preset || brandId === 'custom') return;

    const serviceEl = document.getElementById('bt-printer-service-uuid');
    const charEl = document.getElementById('bt-printer-char-uuid');
    if (preset.serviceUuid && serviceEl) serviceEl.value = preset.serviceUuid;
    if (preset.charUuid && charEl) charEl.value = preset.charUuid;
}

function applyNetPrinterBrandPreset() {
    const select = document.getElementById('net-printer-brand-select');
    if (!select) return;
    const brandId = select.value;
    renderNetPrinterBrandNote(brandId);

    const preset = PRINTER_NET_BRAND_PRESETS.find((p) => p.id === brandId);
    const portEl = document.getElementById('net-printer-port');
    if (preset && portEl && !portEl.value) portEl.value = preset.port;
    if (preset && portEl && portEl.dataset.autoFilled === 'true') portEl.value = preset.port;
}

function showNetPrintButtons() {
    const ids = ['receipt-net-print-btn', 'receipt-preview-net-print-btn', 'barcode-net-print-btn'];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'inline-block';
    });
    const headerBtn = document.getElementById('barcode-header-net-print-btn');
    if (headerBtn) headerBtn.style.display = 'flex';
}

function hideNetPrintButtons() {
    const ids = ['receipt-net-print-btn', 'receipt-preview-net-print-btn', 'barcode-net-print-btn', 'barcode-header-net-print-btn'];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function updateNetworkPrinterStatusUI() {
    const dot = document.getElementById('net-printer-status-dot');
    const text = document.getElementById('net-printer-status-text');
    const settings = getNetworkPrinterSettings();

    if (settings.host) {
        if (dot) dot.style.background = '#22c55e';
        if (text) text.innerText = `Naka-set up: ${settings.host}:${settings.port} (${settings.connType === 'lan' ? 'LAN Cable' : 'WiFi'})`;
        showNetPrintButtons();
    } else {
        if (dot) dot.style.background = '#94a3b8';
        if (text) text.innerText = 'Walang na-set up na Network Printer';
        hideNetPrintButtons();
    }
    updatePrinterActiveSummaryUI();
}

function updatePrinterActiveSummaryUI() {
    const dot = document.getElementById('printer-active-summary-dot');
    const text = document.getElementById('printer-active-summary-text');
    if (!dot || !text) return;

    const btName = localStorage.getItem(BT_PRINTER_STORAGE_KEYS.deviceName);
    const netSettings = getNetworkPrinterSettings();

    if (btName && typeof btPrinterCharacteristic !== 'undefined' && btPrinterCharacteristic) {
        dot.style.background = '#22c55e';
        text.innerText = `Aktibong printer: Bluetooth — ${btName}`;
    } else if (btName) {
        dot.style.background = '#eab308';
        text.innerText = `Naka-pair dating Bluetooth printer: ${btName} (kailangang i-reconnect)`;
    } else if (netSettings.host) {
        dot.style.background = '#22c55e';
        text.innerText = `Aktibong printer: ${netSettings.connType === 'lan' ? 'LAN Cable' : 'WiFi'} — ${netSettings.host}:${netSettings.port}`;
    } else {
        dot.style.background = '#94a3b8';
        text.innerText = 'Walang naka-set up na printer';
    }
}

// ---- Network printer settings: save / forget -----------------------------------
function saveNetworkPrinterConnType() {
    const select = document.getElementById('net-printer-conn-type');
    const connType = (select && select.value === 'lan') ? 'lan' : 'wifi';
    localStorage.setItem(PRINTER_NET_STORAGE_KEYS.connType, connType);
    updateNetworkPrinterStatusUI();
}

function saveNetworkPrinterSettings() {
    const hostEl = document.getElementById('net-printer-host');
    const portEl = document.getElementById('net-printer-port');
    const connTypeEl = document.getElementById('net-printer-conn-type');
    const brandEl = document.getElementById('net-printer-brand-select');

    const host = (hostEl && hostEl.value.trim()) || '';
    const port = parseInt(portEl && portEl.value, 10) || PRINTER_NET_DEFAULT_PORT;
    const connType = (connTypeEl && connTypeEl.value === 'lan') ? 'lan' : 'wifi';
    const brand = (brandEl && brandEl.value) || 'universal';

    if (!host) {
        if (typeof Swal !== 'undefined') Swal.fire('Kulang na Impormasyon', 'Ilagay muna ang IP Address ng printer.', 'warning');
        return;
    }
    if (!(port > 0 && port < 65536)) {
        if (typeof Swal !== 'undefined') Swal.fire('Invalid na Port', 'Ang Port ay dapat na numero sa pagitan ng 1 at 65535.', 'warning');
        return;
    }

    localStorage.setItem(PRINTER_NET_STORAGE_KEYS.host, host);
    localStorage.setItem(PRINTER_NET_STORAGE_KEYS.port, String(port));
    localStorage.setItem(PRINTER_NET_STORAGE_KEYS.connType, connType);
    localStorage.setItem(PRINTER_NET_STORAGE_KEYS.brand, brand);

    // A host is now configured, so this mirrors the DOMContentLoaded rule
    // (autoFilled = false once settings.host is set) — the just-saved port is
    // a deliberate value now, not a placeholder safe to overwrite.
    if (portEl) portEl.dataset.autoFilled = 'false';

    updateNetworkPrinterStatusUI();
    if (typeof Swal !== 'undefined') {
        Swal.fire({ icon: 'success', title: 'Na-save!', text: `Network Printer Settings: ${host}:${port}`, timer: 1800, showConfirmButton: false });
    }
}

function forgetNetworkPrinter() {
    Object.values(PRINTER_NET_STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    const hostEl = document.getElementById('net-printer-host');
    const portEl = document.getElementById('net-printer-port');
    const connTypeEl = document.getElementById('net-printer-conn-type');
    const brandEl = document.getElementById('net-printer-brand-select');
    if (hostEl) hostEl.value = '';
    if (portEl) {
        portEl.value = '';
        // Back to a clean-slate state (no host saved) — restore the "safe to
        // auto-fill from a brand preset" flag so picking a brand fills the
        // port again, same as a fresh install. Without this, a single
        // auto-fill right after forgetting would silently stop future ones.
        portEl.dataset.autoFilled = 'true';
    }
    const defaultConnType = 'wifi';
    const defaultBrand = PRINTER_NET_BRAND_PRESETS[0].id;
    if (connTypeEl) connTypeEl.value = defaultConnType;
    if (brandEl) brandEl.value = defaultBrand;
    renderNetPrinterBrandNote(defaultBrand);
    updateNetworkPrinterStatusUI();
}

// ---- Network printer: connectivity test / actual printing ----------------------
async function testNetworkPrinterConnection() {
    const settings = getNetworkPrinterSettings();
    if (!settings.host) {
        if (typeof Swal !== 'undefined') Swal.fire('Wala pang Naka-set Up', 'I-save muna ang IP Address at Port ng printer.', 'warning');
        return;
    }
    const btn = document.getElementById('net-printer-test-conn-btn');
    if (btn) btn.disabled = true;
    try {
        const res = await authFetch(`${API_URL}/printer/network-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: settings.host, port: settings.port })
        });
        const data = await res.json();
        if (data && data.reachable) {
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Nakonekta!', text: `Naaabot ang printer sa ${settings.host}:${settings.port}.`, timer: 1800, showConfirmButton: false });
        } else {
            if (typeof Swal !== 'undefined') Swal.fire('Hindi Naaabot', `Hindi maabot ang ${settings.host}:${settings.port}. I-check ang IP Address/Port at siguraduhing naka-on at nakakonekta sa parehong network ang printer.`, 'error');
        }
    } catch (err) {
        console.error('[Network Printer] Test connection failed:', err);
        if (typeof Swal !== 'undefined') Swal.fire('Error', 'Hindi ma-test ang koneksyon. Subukan muli.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function sendBytesToNetworkPrinter(bytes) {
    const settings = getNetworkPrinterSettings();
    if (!settings.host) {
        throw new Error('Walang na-set up na Network Printer.');
    }
    const res = await authFetch(`${API_URL}/printer/network-print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: settings.host, port: settings.port, dataBase64: uint8ArrayToBase64(bytes) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || 'Nabigo ang pag-print sa Network Printer.');
    }
    return data;
}

async function printReceiptViaNetworkPrinter(prefix) {
    prefix = prefix || 'r';
    if (!isNetworkPrinterConfigured()) {
        if (typeof Swal !== 'undefined') Swal.fire('Wala pang Naka-set Up', 'I-set up muna ang WiFi/LAN Network Printer sa Printer Device Settings.', 'info');
        return;
    }
    const paperSize = (typeof receiptSettingsCache !== 'undefined' && receiptSettingsCache && receiptSettingsCache.paperSize) || '58mm';
    const charWidth = paperSize === '80mm' ? 46 : 32;
    const data = collectReceiptDataFromDom(prefix);
    const bytes = buildEscPosReceiptBytes(data, charWidth);
    try {
        await sendBytesToNetworkPrinter(bytes);
        if (typeof playScanBeep === 'function') playScanBeep();
    } catch (err) {
        console.error('[Network Printer] Print failed:', err);
        if (typeof Swal !== 'undefined') Swal.fire('Print Error', err.message || String(err), 'error');
    }
}

async function printBarcodeSheetViaNetworkPrinter() {
    if (!isNetworkPrinterConfigured()) {
        if (typeof Swal !== 'undefined') Swal.fire('Wala pang Naka-set Up', 'I-set up muna ang WiFi/LAN Network Printer sa Printer Device Settings.', 'info');
        return;
    }
    const items = (typeof window !== 'undefined' && window.__lastBarcodePrintBatch) || [];
    if (!items.length) {
        if (typeof Swal !== 'undefined') Swal.fire('Nothing Selected', 'Select an item and generate the Print Preview first before Network printing.', 'info');
        return;
    }
    const paperSize = (typeof receiptSettingsCache !== 'undefined' && receiptSettingsCache && receiptSettingsCache.paperSize) || '58mm';
    const charWidth = paperSize === '80mm' ? 46 : 32;
    const bytes = buildEscPosBarcodeSheetBytes(items, charWidth);
    try {
        await sendBytesToNetworkPrinter(bytes);
        if (typeof playScanBeep === 'function') playScanBeep();
    } catch (err) {
        console.error('[Network Printer] Barcode print failed:', err);
        if (typeof Swal !== 'undefined') Swal.fire('Print Error', err.message || String(err), 'error');
    }
}

async function testPrintNetworkPrinter() {
    if (!isNetworkPrinterConfigured()) {
        if (typeof Swal !== 'undefined') Swal.fire('Wala pang Naka-set Up', 'I-save muna ang IP Address at Port ng printer.', 'warning');
        return;
    }
    const btn = document.getElementById('net-printer-test-print-btn');
    if (btn) btn.disabled = true;
    const paperSize = (typeof receiptSettingsCache !== 'undefined' && receiptSettingsCache && receiptSettingsCache.paperSize) || '58mm';
    const charWidth = paperSize === '80mm' ? 46 : 32;
    const testData = {
        storeName: 'OmniPOS',
        address: 'Network Printer Test',
        receiptId: 'TEST-PRINT',
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        cashier: 'system',
        items: [{ text: 'Sample Item x1', total: 'P 1.00' }],
        total: 'P 1.00',
        method: 'TEST',
        paid: 'P 1.00',
        change: 'P 0.00',
        footerText: 'Test print OK!'
    };
    try {
        await sendBytesToNetworkPrinter(buildEscPosReceiptBytes(testData, charWidth));
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Naipadala!', text: 'Naipadala ang test print sa Network Printer.', timer: 1800, showConfirmButton: false });
    } catch (err) {
        if (typeof Swal !== 'undefined') Swal.fire('Test Print Error', err.message || String(err), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Silent by design, mirroring openCashDrawerViaBluetooth() — used as an automatic
// fallback after a cash sale, so a shop without a configured network printer/
// cash drawer should never see an error popup for it.
async function openCashDrawerViaNetworkPrinter() {
    if (!isNetworkPrinterConfigured()) return;
    try {
        await sendBytesToNetworkPrinter(new Uint8Array(buildEscPosCashDrawerKickBytes(0)));
    } catch (err) {
        console.warn('[Cash Drawer] Network kick command failed:', err);
    }
}

// ---- Init -----------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    populatePrinterBrandDropdowns();

    const settings = getNetworkPrinterSettings();
    const hostEl = document.getElementById('net-printer-host');
    const portEl = document.getElementById('net-printer-port');
    const connTypeEl = document.getElementById('net-printer-conn-type');
    if (hostEl) hostEl.value = settings.host;
    if (portEl) {
        portEl.value = settings.port;
        portEl.dataset.autoFilled = settings.host ? 'false' : 'true';
        // The moment the user actually types a port themselves, it's no longer
        // "safe to overwrite" from a brand preset — without this, autoFilled
        // stays 'true' forever on a fresh install (no host saved yet) and a
        // manually-typed port keeps getting clobbered every time the Brand
        // dropdown is touched.
        portEl.addEventListener('input', () => {
            portEl.dataset.autoFilled = 'false';
        });
    }
    if (connTypeEl) connTypeEl.value = settings.connType;

    updateNetworkPrinterStatusUI();
    updatePrinterActiveSummaryUI();
});
