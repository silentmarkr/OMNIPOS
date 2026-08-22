

const BT_PRINTER_DEFAULTS = {
    serviceUuid: '000018f0-0000-1000-8000-00805f9b34fb',
    charUuid: '00002af1-0000-1000-8000-00805f9b34fb'
};

const BT_PRINTER_STORAGE_KEYS = {
    deviceName: 'omnipos_bt_printer_name',
    serviceUuid: 'omnipos_bt_printer_service_uuid',
    charUuid: 'omnipos_bt_printer_char_uuid'
};

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
    } catch (e) {  }
    btPrinterDevice = null;
    btPrinterCharacteristic = null;
    localStorage.removeItem(BT_PRINTER_STORAGE_KEYS.deviceName);
    updateBtPrinterStatusUI();
}

function escposText(str) {
    return (str || '').replace(/₱/g, 'P ');
}

function isAutoCutEnabled() {
    return localStorage.getItem('omnipos_bt_autocut') !=='false';
}

function padLine(left, right, width) {
    left = escposText(left);
    right = escposText(right);
    const space = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(space) + right;
}

const ESC_POS_QR_CORRECT_LEVEL_BYTE = { L: 0x30, M: 0x31, Q: 0x32, H: 0x33 };

function buildEscPosQrBytes(text, moduleSize, correctLevel) {
    const GS = 0x1d;
    const bytes = [];
    const dataBytes = Array.from(new TextEncoder().encode(text || ''));
    const storeLen = dataBytes.length + 3; 
    const pL = storeLen & 0xff;
    const pH = (storeLen >> 8) & 0xff;

    

    const size = Math.min(16, Math.max(3, parseInt(moduleSize, 10) || 6));
    const ecByte = ESC_POS_QR_CORRECT_LEVEL_BYTE[correctLevel] || ESC_POS_QR_CORRECT_LEVEL_BYTE.M;

    bytes.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    
    bytes.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
    
    bytes.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ecByte);
    
    bytes.push(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...dataBytes);
    
    bytes.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);

    return bytes;
}

function buildEscPosReceiptBytes(data, charWidth) {
    const ESC = 0x1b, GS = 0x1d;
    const bytes = [];
    const pushText = (str) => {
        const encoded = new TextEncoder().encode(escposText(str));
        for (const b of encoded) bytes.push(b);
    };
    const nl = () => bytes.push(0x0a);

    bytes.push(ESC, 0x40); 
    bytes.push(ESC, 0x61, 0x01); 
    bytes.push(ESC, 0x21, 0x10); 
    pushText(data.storeName || 'OmniPOS'); nl();
    bytes.push(ESC, 0x21, 0x00); 

    if (data.address) { pushText(data.address); nl(); }
    if (data.contact) { pushText(data.contact); nl(); }
    if (data.headerText) { pushText(data.headerText); nl(); }

    bytes.push(ESC, 0x61, 0x00); 
    pushText('-'.repeat(charWidth)); nl();
    pushText(`Receipt: ${data.receiptId || ''}`); nl();
    pushText(`${data.date || ''} ${data.time || ''}`); nl();
    pushText(`Cashier: ${data.cashier || ''}`); nl();
    pushText('-'.repeat(charWidth)); nl();

    (data.items || []).forEach((item) => {
        pushText(padLine(item.text, item.total, charWidth)); nl();
    });

    pushText('-'.repeat(charWidth)); nl();

    

    if (data.itemCounterQty) {
        const counterText = escposText(`${data.itemCounterQty} Item(s)`);
        const padTotal = Math.max(0, charWidth - counterText.length);
        const padLeft = Math.floor(padTotal / 2);
        pushText(' '.repeat(padLeft) + counterText); nl();
        pushText('-'.repeat(charWidth)); nl();
    }
    if (data.subtotal) { pushText(padLine('Subtotal', data.subtotal, charWidth)); nl(); }
    if (data.tax) { pushText(padLine(data.taxLabel || 'Tax', data.tax, charWidth)); nl(); }
    bytes.push(ESC, 0x45, 0x01); 
    pushText(padLine('TOTAL', data.total, charWidth)); nl();
    bytes.push(ESC, 0x45, 0x00); 
    pushText(padLine(`Payment (${data.method || ''})`, data.paid, charWidth)); nl();
    pushText(padLine('Change', data.change, charWidth)); nl();
    pushText('-'.repeat(charWidth)); nl();

    

    
    if (data.loyaltyQr && data.loyaltyQr.token) {
        pushText('-'.repeat(charWidth)); nl();
        bytes.push(ESC, 0x61, 0x01); 
        if (data.loyaltyQr.note) { pushText(data.loyaltyQr.note); nl(); }
        nl();

        

        

        
        const qrCopies = Math.max(1, parseInt(data.loyaltyQr.copies, 10) || 1);
        for (let i = 0; i < qrCopies; i++) {
            buildEscPosQrBytes(data.loyaltyQr.token, data.loyaltyQr.moduleSize, data.loyaltyQr.correctLevel).forEach((b) => bytes.push(b));
            nl();
            if (i < qrCopies - 1) nl();
        }
        nl();
    }

    bytes.push(ESC, 0x61, 0x01); 
    nl();
    if (data.footerText) { pushText(data.footerText); nl(); }
    nl(); nl(); nl();

    
    if (isAutoCutEnabled()) {
        bytes.push(GS, 0x56, 0x00); 
    }

    return new Uint8Array(bytes);
}

function buildEscPosBarcodeSheetBytes(items, charWidth) {
    const ESC = 0x1b, GS = 0x1d;
    const bytes = [];
    const pushText = (str) => {
        const encoded = new TextEncoder().encode(escposText(str));
        for (const b of encoded) bytes.push(b);
    };
    const nl = () => bytes.push(0x0a);

    bytes.push(ESC, 0x40); 
    bytes.push(GS, 0x48, 0x02); 
    bytes.push(GS, 0x66, 0x00); 
    bytes.push(GS, 0x68, 0x50); 
    bytes.push(GS, 0x77, 0x02); 

    (items || []).forEach((item) => {
        const qty = Math.max(1, parseInt(item.qty, 10) || 1);
        const code = String(item.code || '');

        const payload = '{B' + code;

        for (let i = 0; i < qty; i++) {
            bytes.push(ESC, 0x61, 0x01); 
            bytes.push(ESC, 0x45, 0x01); 
            pushText((item.name || code).slice(0, charWidth)); nl();
            bytes.push(ESC, 0x45, 0x00); 

            bytes.push(GS, 0x6b, 0x49, payload.length); 
            pushText(payload);
            nl(); nl();
        }
    });

    if (isAutoCutEnabled()) {
        bytes.push(GS, 0x56, 0x00); 
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

        

        

        const blocks = itemsTable.querySelectorAll('.r-item-block');
        const rows = blocks.length ? blocks : itemsTable.querySelectorAll('.r-item-line');
        rows.forEach((row) => {
            const lineEl = row.classList.contains('r-item-line') ? row : row.querySelector('.r-item-line');
            const detailEl = row.querySelector ? row.querySelector('.r-item-detail-line') : null;
            if (lineEl) {
                const spans = lineEl.querySelectorAll('span');
                if (spans.length >= 2) {
                    items.push({ text: spans[0].innerText.trim(), total: spans[1].innerText.trim() });
                }
            }
            if (detailEl) {
                const detailSpans = detailEl.querySelectorAll('span');
                const detailText = Array.from(detailSpans).map((sp) => sp.innerText.trim()).filter(Boolean).join(' ');
                if (detailText) items.push({ text: `  ${detailText}`, total: '' });
            }
        });
    }

    

    

    

    

    

    

    
    const settingsStoreName = (typeof receiptSettingsCache !== 'undefined' && receiptSettingsCache && receiptSettingsCache.storeName)
        ? ((receiptSettingsCache.advancedSettings && receiptSettingsCache.advancedSettings.uppercaseStoreName)
            ? receiptSettingsCache.storeName.toUpperCase()
            : receiptSettingsCache.storeName)
        : '';

    return {
        storeName: settingsStoreName || getText(`${prefix}-store-title`),
        address: getText(`${prefix}-store-address`),
        contact: getText(`${prefix}-store-contact`),
        headerText: getText(`${prefix}-header-text`),
        receiptId: getText(`${prefix}-id`),
        date: getText(`${prefix}-date`),
        time: getText(`${prefix}-time`),
        cashier: getText(`${prefix}-cashier`),
        items,

        

        itemCounterQty: getText(`${prefix}-item-counter-qty`),
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
        footerText: getText(`${prefix}-footer-msg`),

        

        

        
        loyaltyQr: (prefix ==='r' && typeof currentReceiptLoyaltyQrPrintData !=='undefined' && currentReceiptLoyaltyQrPrintData && currentReceiptLoyaltyQrPrintData.token)
            ? currentReceiptLoyaltyQrPrintData
            : null
    };
}

async function writeBytesInChunks(characteristic, bytes) {
    const CHUNK_SIZE = 180;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.slice(i, i + CHUNK_SIZE);
        await characteristic.writeValue(chunk);
        
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

async function ensureBtPrinterConnected() {
    if (btPrinterCharacteristic && btPrinterDevice && btPrinterDevice.gatt.connected) {
        return true;
    }

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
    
    const { serviceUuid, charUuid } = getBtPrinterUuids();
    const serviceEl = document.getElementById('bt-printer-service-uuid');
    const charEl = document.getElementById('bt-printer-char-uuid');
    if (serviceEl) serviceEl.value = serviceUuid;
    if (charEl) charEl.value = charUuid;
    updateBtPrinterStatusUI();
});
