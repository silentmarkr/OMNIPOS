// ================== OMNIPOS: BLUETOOTH THERMAL PRINTER (BETA) ==================
// Opsyonal na module — nagbibigay-daan mag-print ng resibo direkta sa isang
// Bluetooth Low Energy (BLE) ESC/POS thermal printer (58mm/80mm) gamit ang
// Web Bluetooth API. Hindi ito requirement: kung walang ganitong printer,
// gagana pa rin nang normal ang existing "Print" (window.print) button.
//
// LIMITASYON: Kailangan ng HTTPS (o localhost) at Chrome for Android — hindi
// supported ang Web Bluetooth sa Safari/iOS. Iba-iba rin ang GATT Service/
// Characteristic UUID depende sa brand ng printer — naka-default dito ang
// pinaka-karaniwang UUID na ginagamit ng generic 58mm/80mm BLE printers,
// pero configurable ito sa Receipt Customization > Bluetooth Printer settings.

const BT_PRINTER_DEFAULTS = {
    serviceUuid: '000018f0-0000-1000-8000-00805f9b34fb',
    charUuid: '00002af1-0000-1000-8000-00805f9b34fb'
};

const BT_PRINTER_STORAGE_KEYS = {
    deviceName: 'omnipos_bt_printer_name',
    serviceUuid: 'omnipos_bt_printer_service_uuid',
    charUuid: 'omnipos_bt_printer_char_uuid'
};

// In-memory lang (hindi naka-persist sa localStorage) — ang aktwal na BluetoothDevice/
// GATT connection object ay kailangang muling kunin sa bawat bagong page load
// (limitasyon ng Web Bluetooth API, hindi ito totally "always-on" na koneksyon).
let btPrinterDevice = null;
let btPrinterCharacteristic = null;

function isWebBluetoothSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

function getBtPrinterUuids() {
    return {
        serviceUuid: localStorage.getItem(BT_PRINTER_STORAGE_KEYS.serviceUuid) || BT_PRINTER_DEFAULTS.serviceUuid,
        charUuid: localStorage.getItem(BT_PRINTER_STORAGE_KEYS.charUuid) || BT_PRINTER_DEFAULTS.charUuid
    };
}

function saveBluetoothPrinterUuids() {
    const serviceEl = document.getElementById('bt-printer-service-uuid');
    const charEl = document.getElementById('bt-printer-char-uuid');
    const serviceVal = (serviceEl && serviceEl.value.trim()) || BT_PRINTER_DEFAULTS.serviceUuid;
    const charVal = (charEl && charEl.value.trim()) || BT_PRINTER_DEFAULTS.charUuid;
    localStorage.setItem(BT_PRINTER_STORAGE_KEYS.serviceUuid, serviceVal);
    localStorage.setItem(BT_PRINTER_STORAGE_KEYS.charUuid, charVal);
    if (typeof Swal !== 'undefined') {
        Swal.fire({ icon: 'success', title: 'Saved', text: 'Bluetooth printer UUID settings have been updated.', timer: 1500, showConfirmButton: false });
    }
}

function updateBtPrinterStatusUI() {
    const dot = document.getElementById('bt-printer-status-dot');
    const text = document.getElementById('bt-printer-status-text');
    const unsupportedNote = document.getElementById('bt-printer-unsupported-note');
    const pairBtn = document.getElementById('bt-printer-pair-btn');
    const forgetBtn = document.getElementById('bt-printer-forget-btn');
    const testBtn = document.getElementById('bt-printer-test-btn');
    const savedName = localStorage.getItem(BT_PRINTER_STORAGE_KEYS.deviceName);

    if (!isWebBluetoothSupported()) {
        if (unsupportedNote) unsupportedNote.style.display = 'block';
        if (pairBtn) pairBtn.disabled = true;
        if (forgetBtn) forgetBtn.disabled = true;
        if (testBtn) testBtn.disabled = true;
        if (dot) dot.style.background = '#94a3b8';
        if (text) text.innerText = 'Hindi supported ng browser na ito';
        hideBtPrintButtons();
        return;
    }

    if (savedName && btPrinterCharacteristic) {
        if (dot) dot.style.background = '#22c55e';
        if (text) text.innerText = `Konektado: ${savedName}`;
        showBtPrintButtons();
    } else if (savedName) {
        if (dot) dot.style.background = '#eab308';
        if (text) text.innerText = `Naka-pair dati: ${savedName} (i-tap ang "I-pair ang Printer" para muling kumonekta)`;
        showBtPrintButtons();
    } else {
        if (dot) dot.style.background = '#94a3b8';
        if (text) text.innerText = 'Walang naka-pair na printer';
        hideBtPrintButtons();
    }
}

function showBtPrintButtons() {
    const b1 = document.getElementById('receipt-bt-print-btn');
    const b2 = document.getElementById('receipt-preview-bt-print-btn');
    // BAGO: BT Print button ng Barcode Generator sheet — dating wala
    // nito, kaya nagmumukhang "hindi gumagana" ang pag-print ng barcode
    // sa mga device/Termux/WebView na walang suportadong window.print()
    // (walang naka-install na print service), samantalang gumagana
    // pa rin ang resibo dahil MERON itong parehong BT fallback na ito.
    const b3 = document.getElementById('barcode-bt-print-btn');
    const b4 = document.getElementById('barcode-header-bt-print-btn');
    if (b1) b1.style.display = 'inline-block';
    if (b2) b2.style.display = 'inline-block';
    if (b3) b3.style.display = 'inline-block';
    if (b4) b4.style.display = 'flex';
}

function hideBtPrintButtons() {
    const b1 = document.getElementById('receipt-bt-print-btn');
    const b2 = document.getElementById('receipt-preview-bt-print-btn');
    const b3 = document.getElementById('barcode-bt-print-btn');
    const b4 = document.getElementById('barcode-header-bt-print-btn');
    if (b1) b1.style.display = 'none';
    if (b2) b2.style.display = 'none';
    if (b3) b3.style.display = 'none';
    if (b4) b4.style.display = 'none';
}

async function pairBluetoothPrinter() {
    if (!isWebBluetoothSupported()) {
        Swal.fire('Not Supported', 'This browser/device does not support Web Bluetooth. Use Chrome for Android.', 'error');
        return;
    }
    const { serviceUuid, charUuid } = getBtPrinterUuids();
    try {
        btPrinterDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [serviceUuid]
        });

        btPrinterDevice.addEventListener('gattserverdisconnected', () => {
            btPrinterCharacteristic = null;
            updateBtPrinterStatusUI();
        });

        const server = await btPrinterDevice.gatt.connect();
        const service = await server.getPrimaryService(serviceUuid);
        btPrinterCharacteristic = await service.getCharacteristic(charUuid);

        localStorage.setItem(BT_PRINTER_STORAGE_KEYS.deviceName, btPrinterDevice.name || 'Bluetooth Printer');
        updateBtPrinterStatusUI();
        Swal.fire({ icon: 'success', title: 'Paired!', text: `Connected to "${btPrinterDevice.name || 'printer'}".`, timer: 1800, showConfirmButton: false });
    } catch (err) {
        console.warn('[BT Printer] Pairing failed/cancelled:', err);
        if (err && err.name !== 'NotFoundError') {
            Swal.fire('Connection Failed', `Could not pair with printer: ${err.message || err}. Try checking the Service/Characteristic UUID in Advanced settings.`, 'error');
        }
    }
}

function forgetBluetoothPrinter() {
    try {
        if (btPrinterDevice && btPrinterDevice.gatt && btPrinterDevice.gatt.connected) {
            btPrinterDevice.gatt.disconnect();
        }
    } catch (e) { /* ok lang, best-effort disconnect */ }
    btPrinterDevice = null;
    btPrinterCharacteristic = null;
    localStorage.removeItem(BT_PRINTER_STORAGE_KEYS.deviceName);
    updateBtPrinterStatusUI();
}

// ---- ESC/POS byte builder ----
// Sadyang ASCII-safe ang output (₱ -> "P") dahil karamihan sa mga generic
// thermal printer codepage ay hindi naka-support ng Unicode peso sign.
function escposText(str) {
    return (str || '').replace(/₱/g, 'P ');
}

// BAGO: nababasa na ang "Auto-cut paper" na setting (Receipt Customization
// > Printing Preferences) — TRUE pa rin ang default (walang ibang value
// naka-save), kaya eksaktong kapareho ng dating laging-naka-ON na behavior
// kung hindi ito babaguhin ng user.
function isAutoCutEnabled() {
    return localStorage.getItem('omnipos_bt_autocut') !=='false';
}

function padLine(left, right, width) {
    left = escposText(left);
    right = escposText(right);
    const space = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(space) + right;
}

function buildEscPosReceiptBytes(data, charWidth) {
    const ESC = 0x1b, GS = 0x1d;
    const bytes = [];
    const pushText = (str) => {
        const encoded = new TextEncoder().encode(escposText(str));
        for (const b of encoded) bytes.push(b);
    };
    const nl = () => bytes.push(0x0a);

    bytes.push(ESC, 0x40); // init
    bytes.push(ESC, 0x61, 0x01); // center align
    bytes.push(ESC, 0x21, 0x10); // double height (store name)
    pushText(data.storeName || 'OmniPOS'); nl();
    bytes.push(ESC, 0x21, 0x00); // reset text size

    if (data.address) { pushText(data.address); nl(); }
    if (data.contact) { pushText(data.contact); nl(); }
    if (data.headerText) { pushText(data.headerText); nl(); }

    bytes.push(ESC, 0x61, 0x00); // left align
    pushText('-'.repeat(charWidth)); nl();
    pushText(`Receipt: ${data.receiptId || ''}`); nl();
    pushText(`${data.date || ''} ${data.time || ''}`); nl();
    pushText(`Cashier: ${data.cashier || ''}`); nl();
    pushText('-'.repeat(charWidth)); nl();

    (data.items || []).forEach((item) => {
        pushText(padLine(item.text, item.total, charWidth)); nl();
    });

    pushText('-'.repeat(charWidth)); nl();
    if (data.subtotal) { pushText(padLine('Subtotal', data.subtotal, charWidth)); nl(); }
    if (data.tax) { pushText(padLine(data.taxLabel || 'Tax', data.tax, charWidth)); nl(); }
    bytes.push(ESC, 0x45, 0x01); // bold on
    pushText(padLine('TOTAL', data.total, charWidth)); nl();
    bytes.push(ESC, 0x45, 0x00); // bold off
    pushText(padLine(`Payment (${data.method || ''})`, data.paid, charWidth)); nl();
    pushText(padLine('Change', data.change, charWidth)); nl();
    pushText('-'.repeat(charWidth)); nl();

    bytes.push(ESC, 0x61, 0x01); // center align
    nl();
    if (data.footerText) { pushText(data.footerText); nl(); }
    nl(); nl(); nl();

    // BAGO: adjustable na ang cut command base sa "Auto-cut paper" setting
    // (default: ON, kapareho ng dating laging naka-send na command).
    if (isAutoCutEnabled()) {
        bytes.push(GS, 0x56, 0x00); // full cut (walang epekto sa printers na walang cutter)
    }

    return new Uint8Array(bytes);
}

// ---- ESC/POS BARCODE LABEL SHEET (Barcode Generator > Print Selected) ----
// Ginagamit ang standard na "GS k" barcode command (function B, m=73/0x49
// para sa CODE128) na sinusuportahan ng halos lahat ng generic 58mm/80mm
// BLE thermal printer — kaparehong printer/koneksyon na ginagamit na ng
// resibo sa itaas. Bawat produktong pinili ay naka-print bilang: pangalan
// (naka-bold, naka-center) + barcode (na may HRI/human-readable text sa
// ilalim nito) + maliit na puwang, paulit-ulit ayon sa hiniling na
// quantity bawat produkto.
function buildEscPosBarcodeSheetBytes(items, charWidth) {
    const ESC = 0x1b, GS = 0x1d;
    const bytes = [];
    const pushText = (str) => {
        const encoded = new TextEncoder().encode(escposText(str));
        for (const b of encoded) bytes.push(b);
    };
    const nl = () => bytes.push(0x0a);

    bytes.push(ESC, 0x40); // init
    bytes.push(GS, 0x48, 0x02); // GS H 2 -> ipakita ang HRI text SA IBABA ng barcode
    bytes.push(GS, 0x66, 0x00); // GS f 0 -> default HRI font
    bytes.push(GS, 0x68, 0x50); // GS h 80 -> taas ng barcode (80 dots)
    bytes.push(GS, 0x77, 0x02); // GS w 2 -> lapad ng bawat "module" ng barcode

    (items || []).forEach((item) => {
        const qty = Math.max(1, parseInt(item.qty, 10) || 1);
        const code = String(item.code || '');
        // CODE128 subset B: prefixed ng "{B" gaya ng inaasahan ng function-B
        // barcode command para sa mga karakter na wala sa numeric-only subset C.
        const payload = '{B' + code;

        for (let i = 0; i < qty; i++) {
            bytes.push(ESC, 0x61, 0x01); // center align
            bytes.push(ESC, 0x45, 0x01); // bold on
            pushText((item.name || code).slice(0, charWidth)); nl();
            bytes.push(ESC, 0x45, 0x00); // bold off

            bytes.push(GS, 0x6b, 0x49, payload.length); // GS k 73 n
            pushText(payload);
            nl(); nl();
        }
    });

    if (isAutoCutEnabled()) {
        bytes.push(GS, 0x56, 0x00); // full cut (walang epekto sa printers na walang cutter)
    }
    return new Uint8Array(bytes);
}

function collectReceiptDataFromDom(prefix) {
    const getText = (id) => {
        const el = document.getElementById(id);
        return el ? el.innerText.trim() : '';
    };
    const itemsTableId = prefix === 'rp' ? 'rp-items-table' : 'receipt-items-table';
    const itemsTable = document.getElementById(itemsTableId);
    const items = [];
    if (itemsTable) {
        itemsTable.querySelectorAll('.r-item-line').forEach((row) => {
            const spans = row.querySelectorAll('span');
            if (spans.length >= 2) {
                items.push({ text: spans[0].innerText.trim(), total: spans[1].innerText.trim() });
            }
        });
    }
    return {
        storeName: getText(`${prefix}-store-title`),
        address: getText(`${prefix}-store-address`),
        contact: getText(`${prefix}-store-contact`),
        headerText: getText(`${prefix}-header-text`),
        receiptId: getText(`${prefix}-id`),
        date: getText(`${prefix}-date`),
        time: getText(`${prefix}-time`),
        cashier: getText(`${prefix}-cashier`),
        items,
        subtotal: (() => {
            const row = document.getElementById(`${prefix}-subtotal-row`);
            return row && row.style.display !== 'none' ? getText(`${prefix}-subtotal-amount`) : '';
        })(),
        taxLabel: (() => {
            const row = document.getElementById(`${prefix}-tax-row`);
            return row && row.style.display !== 'none' ? getText(`${prefix}-tax-label`) : '';
        })(),
        tax: (() => {
            const row = document.getElementById(`${prefix}-tax-row`);
            return row && row.style.display !== 'none' ? getText(`${prefix}-tax-amount`) : '';
        })(),
        total: getText(`${prefix}-total`),
        method: getText(`${prefix}-method`),
        paid: getText(`${prefix}-paid`),
        change: getText(`${prefix}-change`),
        footerText: getText(`${prefix}-footer-msg`)
    };
}

// Ipinapadala ang bytes nang paisa-isang chunk (~180 bytes) dahil may limitasyon
// ang BLE sa laki ng bawat GATT write (MTU) — kung ipadala lahat nang sabay,
// madalas na-tatanggihan o na-tu-truncate ito ng printer.
async function writeBytesInChunks(characteristic, bytes) {
    const CHUNK_SIZE = 180;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.slice(i, i + CHUNK_SIZE);
        await characteristic.writeValue(chunk);
        // Maikling pahinga sa pagitan ng chunks para hindi ma-overwhelm ang printer buffer
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

async function ensureBtPrinterConnected() {
    if (btPrinterCharacteristic && btPrinterDevice && btPrinterDevice.gatt.connected) {
        return true;
    }
    // Subukang muling kumonekta gamit ang parehong device object (kung meron pa
    // sa memory mula sa kasalukuyang session) nang walang bagong device chooser.
    if (btPrinterDevice) {
        try {
            const { serviceUuid, charUuid } = getBtPrinterUuids();
            const server = await btPrinterDevice.gatt.connect();
            const service = await server.getPrimaryService(serviceUuid);
            btPrinterCharacteristic = await service.getCharacteristic(charUuid);
            return true;
        } catch (e) {
            console.warn('[BT Printer] Reconnect failed:', e);
        }
    }
    return false;
}

async function printReceiptViaBluetooth(prefix) {
    prefix = prefix || 'r';
    if (!isWebBluetoothSupported()) {
        Swal.fire('Not Supported', 'This browser/device does not support Web Bluetooth.', 'error');
        return;
    }

    const connected = await ensureBtPrinterConnected();
    if (!connected) {
        const result = await Swal.fire({
            icon: 'info',
            title: 'Pairing Required',
            text: 'There is no active connection to the Bluetooth printer. Pair it now?',
            showCancelButton: true,
            confirmButtonText: 'Pair Now',
            cancelButtonText: 'Cancel'
        });
        if (result.isConfirmed) {
            await pairBluetoothPrinter();
            if (!btPrinterCharacteristic) return;
        } else {
            return;
        }
    }

    const paperSize = (typeof receiptSettingsCache !== 'undefined' && receiptSettingsCache && receiptSettingsCache.paperSize) || '58mm';
    const charWidth = paperSize === '80mm' ? 46 : 32;

    const data = collectReceiptDataFromDom(prefix);
    const bytes = buildEscPosReceiptBytes(data, charWidth);

    try {
        await writeBytesInChunks(btPrinterCharacteristic, bytes);
        if (typeof playScanBeep === 'function') playScanBeep();
    } catch (err) {
        console.error('[BT Printer] Print failed:', err);
        Swal.fire('Print Error', `Could not print: ${err.message || err}`, 'error');
    }
}

// Tinatawag mula sa Barcode Generator "Print Selected" preview modal.
// Umaasa ito sa `window.__lastBarcodePrintBatch` (in-memory lang, itinatakda
// ng generateSelectedBarcodePreview() sa app.js kasabay ng bawat pag-generate
// ng preview) — ito ang listahan ng { code, name, qty } ng mga huling
// napiling item, kaya walang kailangang i-scrape ulit sa DOM/SVG.
async function printBarcodeSheetViaBluetooth() {
    if (!isWebBluetoothSupported()) {
        Swal.fire('Not Supported', 'This browser/device does not support Web Bluetooth.', 'error');
        return;
    }

    const items = (typeof window !== 'undefined' && window.__lastBarcodePrintBatch) || [];
    if (!items.length) {
        Swal.fire('Nothing Selected', 'Select an item and generate the Print Preview first before BT printing.', 'info');
        return;
    }

    const connected = await ensureBtPrinterConnected();
    if (!connected) {
        const result = await Swal.fire({
            icon: 'info',
            title: 'Pairing Required',
            text: 'There is no active connection to the Bluetooth printer. Pair it now?',
            showCancelButton: true,
            confirmButtonText: 'Pair Now',
            cancelButtonText: 'Cancel'
        });
        if (result.isConfirmed) {
            await pairBluetoothPrinter();
            if (!btPrinterCharacteristic) return;
        } else {
            return;
        }
    }

    const paperSize = (typeof receiptSettingsCache !== 'undefined' && receiptSettingsCache && receiptSettingsCache.paperSize) || '58mm';
    const charWidth = paperSize === '80mm' ? 46 : 32;

    const bytes = buildEscPosBarcodeSheetBytes(items, charWidth);

    try {
        await writeBytesInChunks(btPrinterCharacteristic, bytes);
        if (typeof playScanBeep === 'function') playScanBeep();
    } catch (err) {
        console.error('[BT Printer] Barcode print failed:', err);
        Swal.fire('Print Error', `Could not print: ${err.message || err}`, 'error');
    }
}

async function testPrintBluetoothPrinter() {
    const connected = await ensureBtPrinterConnected();
    if (!connected) {
        Swal.fire('Not Paired Yet', 'Pair the printer first before test printing.', 'warning');
        return;
    }
    const paperSize = (typeof receiptSettingsCache !== 'undefined' && receiptSettingsCache && receiptSettingsCache.paperSize) || '58mm';
    const charWidth = paperSize === '80mm' ? 46 : 32;
    const testData = {
        storeName: 'OmniPOS',
        address: 'Bluetooth Printer Test',
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
        await writeBytesInChunks(btPrinterCharacteristic, buildEscPosReceiptBytes(testData, charWidth));
    } catch (err) {
        Swal.fire('Test Print Error', `${err.message || err}`, 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // I-populate ang Advanced UUID fields ng kasalukuyang naka-save (o default) na value
    const { serviceUuid, charUuid } = getBtPrinterUuids();
    const serviceEl = document.getElementById('bt-printer-service-uuid');
    const charEl = document.getElementById('bt-printer-char-uuid');
    if (serviceEl) serviceEl.value = serviceUuid;
    if (charEl) charEl.value = charUuid;
    updateBtPrinterStatusUI();
});
