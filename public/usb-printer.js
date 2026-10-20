/* ==========================================================================
   USB Thermal Printer — direct USB printing for OmniPOS.

   Loaded AFTER bt-printer.js and printer-manager.js. Depends on these globals:
   buildEscPosReceiptBytes(), buildEscPosBarcodeSheetBytes(),
   buildEscPosCashDrawerKickBytes(), collectReceiptDataFromDom(),
   updatePrinterActiveSummaryUI() (optional), authFetch() / API_URL (server mode),
   receiptSettingsCache, playScanBeep (optional), Swal (optional).

   Three USB transports (pick ONE in "Paraan ng USB"):

   1) webusb    — Direct USB from the browser (WebUSB). Best for an Android phone/
                  tablet with a USB-OTG cable (Chrome), and for desktop Chrome on
                  macOS / Linux / ChromeOS. On Windows the stock "USB Printing
                  Support" driver owns the printer, so it must be swapped to the
                  WinUSB driver (Zadig) first — otherwise use the server mode or
                  the normal browser Print button.
                  Needs a secure context: https://  or  http://localhost.
   2) webserial — For printers whose driver exposes a USB virtual COM port
                  (CH340 / CP210x / FTDI / CDC-ACM). Chrome Web Serial API.
   3) server    — The OmniPOS server (when it runs on macOS/Linux) writes the
                  raw ESC/POS bytes to a CUPS queue (`lp -o raw`) or straight to
                  /dev/usb/lpN. Works from any browser, including plain http://
                  LAN addresses.

   Every transport shares ONE job queue, so two prints can never interleave.
   ========================================================================== */

const USB_PRINTER_STORAGE_KEYS = {
    mode: 'omnipos_usb_printer_mode',
    name: 'omnipos_usb_printer_name',
    vendorId: 'omnipos_usb_printer_vid',
    productId: 'omnipos_usb_printer_pid',
    serial: 'omnipos_usb_printer_serial',
    serialPortSaved: 'omnipos_usb_printer_serialport_saved',
    baudRate: 'omnipos_usb_printer_baud',
    serverTarget: 'omnipos_usb_printer_server_target'
};
const USB_PRINTER_MODES = ['webusb', 'webserial', 'server'];
const USB_PRINTER_MODE_LABELS = {
    webusb: 'Direct USB (WebUSB)',
    webserial: 'USB Serial / Virtual COM',
    server: 'USB via OmniPOS Server'
};
const USB_PRINTER_DEFAULT_BAUD = 115200;
const USB_PRINTER_CHUNK_SIZE = 4096;
const USB_PRINTER_TRANSFER_TIMEOUT_MS = 20000;
const USB_PRINTER_STATUS_TIMEOUT_MS = 1500;
// USB classes Chrome refuses to expose (and that are never a printer).
const USB_PRINTER_PROTECTED_CLASSES = [0x01, 0x03, 0x08, 0x0b, 0x0e, 0x10, 0xe0];

let usbPrinterDevice = null;
let usbPrinterEndpoints = null;
let usbPrinterSerialPort = null;
let usbPrinterJobChain = Promise.resolve();
let usbPrinterConnectPromise = null;
let usbPrinterStatusUnsupported = false;
let usbPrinterEventsBound = false;

// ---- tiny helpers ---------------------------------------------------------------
function usbPrinterEscapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function usbPrinterAlert(icon, title, text) {
    if (typeof Swal !== 'undefined') {
        // Escaped first, then newlines -> <br>, so device names / error text can never inject markup.
        Swal.fire({ icon, title, html: usbPrinterEscapeHtml(text).replace(/\n/g, '<br>') });
    } else {
        console.warn('[USB Printer]', title, text);
    }
}

function usbPrinterToast(title) {
    if (typeof Swal !== 'undefined') {
        Swal.fire({ icon: 'success', title, timer: 1800, showConfirmButton: false });
    }
}

function usbHex4(n) {
    return (Number(n) || 0).toString(16).toUpperCase().padStart(4, '0');
}

function usbPrinterWithTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(label || 'Timeout');
            err.name = 'UsbPrinterTimeout';
            reject(err);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function usbPrinterSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function usbPrinterStorageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

function usbPrinterStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode / quota */ }
}

function usbPrinterStorageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

function getUsbPrinterMode() {
    const saved = usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.mode);
    return USB_PRINTER_MODES.indexOf(saved) !== -1 ? saved : 'webusb';
}

function getUsbPrinterBaudRate() {
    const n = parseInt(usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.baudRate), 10);
    return n > 0 ? n : USB_PRINTER_DEFAULT_BAUD;
}

function getUsbPrinterSavedIdentity() {
    return {
        vendorId: parseInt(usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.vendorId), 10),
        productId: parseInt(usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.productId), 10),
        serial: usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.serial) || ''
    };
}

function getUsbPrinterCharWidth() {
    const paperSize = (typeof receiptSettingsCache !== 'undefined' && receiptSettingsCache && receiptSettingsCache.paperSize) || '58mm';
    return paperSize === '80mm' ? 46 : 32;
}

function isWebUsbSupported() {
    return typeof navigator !== 'undefined' && !!navigator.usb &&
        (typeof window === 'undefined' || window.isSecureContext !== false);
}

function isWebSerialSupported() {
    return typeof navigator !== 'undefined' && !!navigator.serial &&
        (typeof window === 'undefined' || window.isSecureContext !== false);
}

function isUsbModeSupported(mode) {
    if (mode === 'webusb') return isWebUsbSupported();
    if (mode === 'webserial') return isWebSerialSupported();
    return true; // server mode works in any browser
}

function getUsbModeUnsupportedMessage(mode) {
    const insecure = typeof window !== 'undefined' && window.isSecureContext === false;
    if (insecure) {
        return 'Hindi gumagana ang direktang USB sa http://<IP address>. Buksan ang OmniPOS sa mismong device na may printer gamit ang http://localhost:3000 (o gumamit ng HTTPS).';
    }
    if (mode === 'webserial') {
        return 'Hindi suportado ng browser na ito ang Web Serial. Gamitin ang Chrome/Edge.';
    }
    return 'Hindi suportado ng browser na ito ang WebUSB. Gamitin ang Chrome (Android o Desktop).';
}

// ---- error translation -----------------------------------------------------------
function describeUsbPrinterError(err) {
    const name = (err && err.name) || '';
    const msg = String((err && err.message) || err || '');
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (err && err.usbPrinterFriendly) return msg;
    if (name === 'UsbPrinterTimeout') {
        return 'Hindi tumutugon ang printer (timeout). I-check kung may papel, nakasara ang takip, at naka-on ang printer, tapos subukan muli.';
    }
    if (name === 'NotFoundError') {
        return 'Walang napiling USB device, o nadiskonekta ang printer.';
    }
    if (name === 'SecurityError') {
        return 'Hindi pinayagan ng browser ang USB access. Siguraduhing http://localhost o HTTPS ang gamit mo, at i-tap ang "Allow" kapag nagtanong ang browser.';
    }
    if (name === 'InvalidStateError' || name === 'InvalidAccessError') {
        return `Hindi pa handa ang USB connection (${msg}). I-pair muli ang printer.`;
    }
    if (name === 'NetworkError' || /claim|access denied|busy|in use|unable to/i.test(msg)) {
        if (/Windows/i.test(ua)) {
            return 'Hindi ma-claim ng browser ang printer dahil hawak ito ng Windows printer driver. Palitan ang driver ng printer sa "WinUSB" gamit ang Zadig, o gamitin ang normal na Print button (browser print) / "USB via OmniPOS Server".';
        }
        if (/Linux|CrOS/i.test(ua) && !/Android/i.test(ua)) {
            return 'Hindi ma-claim ang printer. Maaaring hawak ito ng "usblp" kernel module o kulang ang udev permission. Isaksak ulit ang printer, o gamitin ang "USB via OmniPOS Server".';
        }
        return 'Hindi ma-access ang USB printer (may ibang app na gumagamit nito, o nadiskonekta). Isaksak ulit ang cable, isara ang ibang printer app, at subukan muli.';
    }
    return msg || 'Hindi inaasahang USB printer error.';
}

function makeUsbPrinterError(message, name) {
    const err = new Error(message);
    err.name = name || 'UsbPrinterError';
    err.usbPrinterFriendly = true;
    return err;
}

// ---- configured / ready state ------------------------------------------------------
function isUsbPrinterConfigured() {
    const mode = getUsbPrinterMode();
    if (mode === 'webusb') {
        const id = getUsbPrinterSavedIdentity();
        return Number.isFinite(id.vendorId) && Number.isFinite(id.productId);
    }
    if (mode === 'webserial') {
        return usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.serialPortSaved) === '1';
    }
    return !!usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.serverTarget);
}

function isUsbPrinterReady() {
    if (!isUsbPrinterConfigured()) return false;
    const mode = getUsbPrinterMode();
    if (mode === 'webusb') {
        return !!(usbPrinterDevice && usbPrinterEndpoints && usbPrinterDevice.opened);
    }
    if (mode === 'webserial') {
        return !!(usbPrinterSerialPort && usbPrinterSerialPort.writable);
    }
    return true;
}

function getUsbPrinterDisplayName() {
    return usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.name) || 'USB Printer';
}

// ---- WebUSB: endpoint discovery & open --------------------------------------------
function usbFindPrinterEndpoints(device) {
    const candidates = [];
    const cfg = device && device.configuration;
    if (!cfg) return null;
    (cfg.interfaces || []).forEach((iface) => {
        (iface.alternates || []).forEach((alt) => {
            if (USB_PRINTER_PROTECTED_CLASSES.indexOf(alt.interfaceClass) !== -1) return;
            const eps = alt.endpoints || [];
            const outEp = eps.find((e) => e.direction === 'out' && e.type === 'bulk');
            if (!outEp) return;
            const inEp = eps.find((e) => e.direction === 'in' && e.type === 'bulk') || null;
            let rank = 2;
            if (alt.interfaceClass === 0x07) rank = 0;       // Printer class
            else if (alt.interfaceClass === 0xff) rank = 1;  // Vendor specific (very common on cheap printers)
            candidates.push({
                rank,
                interfaceNumber: iface.interfaceNumber,
                alternateSetting: alt.alternateSetting,
                outEndpoint: outEp.endpointNumber,
                inEndpoint: inEp ? inEp.endpointNumber : null
            });
        });
    });
    candidates.sort((a, b) => (a.rank - b.rank) || (a.interfaceNumber - b.interfaceNumber) || (a.alternateSetting - b.alternateSetting));
    return candidates[0] || null;
}

async function usbPrinterOpenDevice(device) {
    if (!device.opened) await device.open();
    try {
        if (device.configuration === null || device.configuration === undefined) {
            const first = (device.configurations && device.configurations[0]) || null;
            await device.selectConfiguration(first ? first.configurationValue : 1);
        }
        let found = usbFindPrinterEndpoints(device);
        if (!found && device.configurations && device.configurations.length > 1) {
            for (const cfg of device.configurations) {
                if (device.configuration && cfg.configurationValue === device.configuration.configurationValue) continue;
                await device.selectConfiguration(cfg.configurationValue);
                found = usbFindPrinterEndpoints(device);
                if (found) break;
            }
        }
        if (!found) {
            throw makeUsbPrinterError('Walang nakitang printer endpoint sa USB device na ito. Baka hindi ito printer — piliin ang tamang device.', 'NotAPrinterError');
        }
        const iface = device.configuration.interfaces.find((i) => i.interfaceNumber === found.interfaceNumber);
        if (!iface || !iface.claimed) {
            await device.claimInterface(found.interfaceNumber);
        }
        const currentAlt = iface && iface.alternate ? iface.alternate.alternateSetting : null;
        if (currentAlt !== found.alternateSetting) {
            await device.selectAlternateInterface(found.interfaceNumber, found.alternateSetting);
        }
        usbPrinterDevice = device;
        usbPrinterEndpoints = found;
        usbPrinterStatusUnsupported = false;
        return found;
    } catch (err) {
        try { if (device.opened) await device.close(); } catch (e) { /* ignore */ }
        usbPrinterDevice = null;
        usbPrinterEndpoints = null;
        throw err;
    }
}

function usbDeviceSameIdentity(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return a.vendorId === b.vendorId && a.productId === b.productId &&
        (a.serialNumber || '') === (b.serialNumber || '');
}

function usbDeviceMatchesSaved(device) {
    const id = getUsbPrinterSavedIdentity();
    if (!device || device.vendorId !== id.vendorId || device.productId !== id.productId) return false;
    if (id.serial && device.serialNumber && device.serialNumber !== id.serial) return false;
    return true;
}

function usbPrinterSaveDeviceIdentity(device) {
    usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.mode, 'webusb');
    usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.vendorId, String(device.vendorId));
    usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.productId, String(device.productId));
    usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.serial, device.serialNumber || '');
    const label = [device.manufacturerName, device.productName].filter(Boolean).join(' ') ||
        `USB Printer ${usbHex4(device.vendorId)}:${usbHex4(device.productId)}`;
    usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.name, label);
}

// ---- Web Serial: open ----------------------------------------------------------------
async function usbPrinterOpenSerialPort(port) {
    if (!port.writable) {
        await port.open({ baudRate: getUsbPrinterBaudRate(), dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    }
    if (!port.writable) {
        throw makeUsbPrinterError('Hindi mabuksan ang serial port ng printer.', 'SerialOpenError');
    }
    usbPrinterSerialPort = port;
    return port;
}

async function usbPrinterSerialCloseQuiet() {
    const port = usbPrinterSerialPort;
    usbPrinterSerialPort = null;
    if (port) {
        try { await port.close(); } catch (e) { /* locked / already closed */ }
    }
}

async function usbPrinterCloseQuiet() {
    const dev = usbPrinterDevice;
    usbPrinterDevice = null;
    usbPrinterEndpoints = null;
    if (dev) {
        try { if (dev.opened) await dev.close(); } catch (e) { /* ignore */ }
    }
    await usbPrinterSerialCloseQuiet();
}

// ---- connect (silent reconnect of an already-granted device) --------------------------
async function ensureUsbPrinterConnected() {
    if (!isUsbPrinterConfigured()) return false;
    if (isUsbPrinterReady()) return true;
    const mode = getUsbPrinterMode();
    if (mode === 'server') return true;
    if (usbPrinterConnectPromise) return usbPrinterConnectPromise;

    const attempt = (async () => {
        try {
            if (mode === 'webusb') {
                if (!isWebUsbSupported()) return false;
                const devices = await navigator.usb.getDevices();
                const id = getUsbPrinterSavedIdentity();
                const matches = devices.filter(usbDeviceMatchesSaved);
                const device = matches.find((d) => id.serial && d.serialNumber === id.serial) || matches[0];
                if (!device) return false;
                await usbPrinterOpenDevice(device);
                return true;
            }
            if (mode === 'webserial') {
                if (!isWebSerialSupported()) return false;
                const ports = await navigator.serial.getPorts();
                const vid = parseInt(usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.vendorId), 10);
                const pid = parseInt(usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.productId), 10);
                let port = null;
                if (Number.isFinite(vid) && Number.isFinite(pid)) {
                    port = ports.find((p) => {
                        const info = (p.getInfo && p.getInfo()) || {};
                        return info.usbVendorId === vid && info.usbProductId === pid;
                    }) || null;
                }
                if (!port && ports.length === 1) port = ports[0];
                if (!port) return false;
                await usbPrinterOpenSerialPort(port);
                return true;
            }
            return false;
        } catch (err) {
            console.warn('[USB Printer] Silent reconnect failed:', err);
            return false;
        }
    })();
    usbPrinterConnectPromise = attempt;
    let ok = false;
    try {
        ok = await attempt;
    } finally {
        // Cleared only AFTER the promise is stored, so a synchronous early return can never leave a stale promise behind.
        if (usbPrinterConnectPromise === attempt) usbPrinterConnectPromise = null;
    }
    updateUsbPrinterStatusUI();
    return ok;
}

// ---- pairing (must be called directly from a click) -------------------------------------
async function pairUsbPrinter(showAllDevices) {
    const mode = getUsbPrinterMode();
    if (mode === 'server') {
        usbPrinterAlert('info', 'Server Mode', 'Sa "USB via OmniPOS Server", piliin ang printer sa listahan sa ibaba — hindi kailangan ng pairing.');
        return;
    }
    if (!isUsbModeSupported(mode)) {
        usbPrinterAlert('error', 'Hindi Suportado', getUsbModeUnsupportedMessage(mode));
        return;
    }
    try {
        if (mode === 'webusb') {
            const filters = showAllDevices === true ? [] : [{ classCode: 0x07 }, { classCode: 0xff }];
            const device = await navigator.usb.requestDevice({ filters });
            await usbPrinterCloseQuiet();
            await usbPrinterOpenDevice(device);
            usbPrinterSaveDeviceIdentity(device);
        } else {
            const port = await navigator.serial.requestPort({});
            await usbPrinterCloseQuiet();
            await usbPrinterOpenSerialPort(port);
            const info = (port.getInfo && port.getInfo()) || {};
            usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.mode, 'webserial');
            usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.serialPortSaved, '1');
            if (Number.isFinite(info.usbVendorId) && Number.isFinite(info.usbProductId)) {
                usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.vendorId, String(info.usbVendorId));
                usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.productId, String(info.usbProductId));
                usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.name, `USB Serial ${usbHex4(info.usbVendorId)}:${usbHex4(info.usbProductId)}`);
            } else {
                usbPrinterStorageRemove(USB_PRINTER_STORAGE_KEYS.vendorId);
                usbPrinterStorageRemove(USB_PRINTER_STORAGE_KEYS.productId);
                usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.name, 'USB Serial Printer');
            }
        }
        usbPrinterBindEvents();
        updateUsbPrinterStatusUI();
        usbPrinterToast(`Nakakonekta: ${getUsbPrinterDisplayName()}`);
    } catch (err) {
        console.warn('[USB Printer] Pairing failed/cancelled:', err);
        updateUsbPrinterStatusUI();
        if (err && err.name === 'NotFoundError') {
            // Either the user closed the chooser, or no device matched the filter.
            if (mode === 'webusb' && showAllDevices !== true) {
                usbPrinterAlert('info', 'Walang Napili', 'Kung walang lumabas na printer sa listahan, i-tap ang "Pair (Lahat ng USB Device)" at piliin ang printer doon. Siguraduhing nakasaksak at naka-on ang printer.');
            }
            return;
        }
        usbPrinterAlert('error', 'Hindi Makonekta', describeUsbPrinterError(err));
    }
}

async function forgetUsbPrinter() {
    const dev = usbPrinterDevice;
    await usbPrinterCloseQuiet();
    // Also revoke the browser-level permission when the API is available.
    try {
        if (dev && typeof dev.forget === 'function') await dev.forget();
    } catch (e) { /* older Chrome */ }
    if (isWebUsbSupported() && typeof navigator.usb.getDevices === 'function') {
        try {
            const devices = await navigator.usb.getDevices();
            for (const d of devices) {
                if (usbDeviceMatchesSaved(d) && typeof d.forget === 'function') await d.forget();
            }
        } catch (e) { /* ignore */ }
    }
    if (isWebSerialSupported() && typeof navigator.serial.getPorts === 'function') {
        try {
            if (getUsbPrinterMode() === 'webserial') {
                const ports = await navigator.serial.getPorts();
                for (const p of ports) { if (typeof p.forget === 'function') await p.forget(); }
            }
        } catch (e) { /* ignore */ }
    }
    Object.keys(USB_PRINTER_STORAGE_KEYS).forEach((k) => {
        // Keep the chosen mode and baud rate; they are user preferences, not pairing data.
        if (k === 'mode' || k === 'baudRate') return;
        usbPrinterStorageRemove(USB_PRINTER_STORAGE_KEYS[k]);
    });
    updateUsbPrinterStatusUI();
    if (getUsbPrinterMode() === 'server') renderUsbPrinterServerTargets();
}

// ---- job queue -------------------------------------------------------------------------
function usbPrinterEnqueue(job) {
    const run = usbPrinterJobChain.then(() => job());
    usbPrinterJobChain = run.catch(() => { /* keep the chain alive after a failed job */ });
    return run;
}

// ---- low-level writers -----------------------------------------------------------------
async function usbPrinterWriteWebUsb(bytes) {
    let offset = 0;
    let stallRetries = 0;
    let reconnects = 0;
    let zeroProgress = 0;
    while (offset < bytes.length) {
        if (!usbPrinterDevice || !usbPrinterEndpoints || !usbPrinterDevice.opened) {
            const ok = await ensureUsbPrinterConnected();
            if (!ok) throw makeUsbPrinterError('Hindi nakakonekta ang USB printer. Isaksak at i-on ang printer, tapos i-tap ang "Pair Printer" sa Printer Device Settings (kailangan itong ulitin sa ilang printer na walang serial number pagkatapos i-unplug).', 'NotConnectedError');
        }
        const device = usbPrinterDevice;
        const ep = usbPrinterEndpoints;
        const end = Math.min(bytes.length, offset + USB_PRINTER_CHUNK_SIZE);
        const chunk = bytes.subarray(offset, end);
        let result;
        try {
            result = await usbPrinterWithTimeout(
                device.transferOut(ep.outEndpoint, chunk),
                USB_PRINTER_TRANSFER_TIMEOUT_MS,
                'USB transfer timeout'
            );
        } catch (err) {
            if (err && err.name === 'UsbPrinterTimeout') {
                // Closing aborts the hung transfer so the next job starts clean.
                await usbPrinterCloseQuiet();
                updateUsbPrinterStatusUI();
                throw err;
            }
            if (reconnects < 1) {
                reconnects++;
                await usbPrinterCloseQuiet();
                const ok = await ensureUsbPrinterConnected();
                if (ok) continue;
            }
            await usbPrinterCloseQuiet();
            updateUsbPrinterStatusUI();
            throw err;
        }
        if (result.status === 'ok') {
            const written = result.bytesWritten > 0 ? result.bytesWritten : chunk.length;
            if (result.bytesWritten === 0 && chunk.length > 0) {
                if (++zeroProgress >= 3) throw makeUsbPrinterError('Walang nasusulat sa printer (0 bytes). I-check ang koneksyon.', 'ZeroWriteError');
                await usbPrinterSleep(50);
                continue;
            }
            zeroProgress = 0;
            offset += written;
        } else if (result.status === 'stall') {
            if (++stallRetries > 3) throw makeUsbPrinterError('Nag-stall ang printer. Patayin at buksan ulit ang printer, tapos subukan muli.', 'StallError');
            offset += result.bytesWritten || 0;
            try { await device.clearHalt('out', ep.outEndpoint); } catch (e) { /* ignore */ }
            await usbPrinterSleep(100);
        } else {
            throw makeUsbPrinterError(`USB transfer error (${result.status}). Isaksak ulit ang printer.`, 'TransferError');
        }
    }
}

async function usbPrinterWriteSerial(bytes) {
    let offset = 0;
    let retried = false;
    while (offset < bytes.length) {
        if (!usbPrinterSerialPort || !usbPrinterSerialPort.writable) {
            const ok = await ensureUsbPrinterConnected();
            if (!ok) throw makeUsbPrinterError('Hindi nakakonekta ang USB serial printer. I-tap ang "Pair Printer".', 'NotConnectedError');
        }
        const port = usbPrinterSerialPort;
        let writer = null;
        try {
            writer = port.writable.getWriter();
            while (offset < bytes.length) {
                const end = Math.min(bytes.length, offset + USB_PRINTER_CHUNK_SIZE);
                await usbPrinterWithTimeout(
                    writer.write(bytes.subarray(offset, end)),
                    USB_PRINTER_TRANSFER_TIMEOUT_MS,
                    'Serial write timeout'
                );
                offset = end; // advance only after the chunk was accepted, so a retry never re-sends printed data
            }
            writer.releaseLock();
            writer = null;
        } catch (err) {
            if (writer) { try { writer.releaseLock(); } catch (e) { /* ignore */ } }
            await usbPrinterSerialCloseQuiet();
            if (!retried && err && err.name !== 'UsbPrinterTimeout') {
                retried = true;
                continue;
            }
            updateUsbPrinterStatusUI();
            throw err;
        }
    }
}

function usbPrinterBytesToBase64(bytes) {
    if (typeof uint8ArrayToBase64 === 'function') return uint8ArrayToBase64(bytes);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

async function usbPrinterWriteViaServer(bytes) {
    const target = usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.serverTarget);
    if (!target) throw makeUsbPrinterError('Wala pang napiling printer sa OmniPOS Server.', 'NotConfiguredError');
    const res = await authFetch(`${API_URL}/printer/usb-queue-print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, dataBase64: usbPrinterBytesToBase64(bytes) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
        throw makeUsbPrinterError((data && data.message) || 'Nabigo ang pag-print sa USB printer ng server.', 'ServerPrintError');
    }
}

async function sendBytesToUsbPrinter(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (!bytes.length) throw makeUsbPrinterError('Walang laman ang ipi-print.', 'EmptyJobError');
    if (!isUsbPrinterConfigured()) throw makeUsbPrinterError('Wala pang naka-set up na USB printer.', 'NotConfiguredError');
    const mode = getUsbPrinterMode();
    if (!isUsbModeSupported(mode)) throw makeUsbPrinterError(getUsbModeUnsupportedMessage(mode), 'UnsupportedError');
    return usbPrinterEnqueue(async () => {
        if (mode === 'server') return usbPrinterWriteViaServer(bytes);
        if (mode === 'webserial') return usbPrinterWriteSerial(bytes);
        return usbPrinterWriteWebUsb(bytes);
    });
}

// Called by the user-facing print actions. If a Direct USB / Serial printer is saved but not connected
// (unplugged, app restarted on a printer without a serial number, ...), try a silent reconnect first,
// then offer "Pair Now" — the Swal confirm click is a fresh user gesture, which the browser needs for
// requestDevice()/requestPort(). Server mode never needs pairing.
async function ensureUsbPrinterForPrint() {
    if (getUsbPrinterMode() === 'server') return true;
    if (isUsbPrinterReady()) return true;
    if (await ensureUsbPrinterConnected()) return true;
    if (typeof Swal === 'undefined' || !isUsbModeSupported(getUsbPrinterMode())) return true; // let send() raise the precise error
    const answer = await Swal.fire({
        icon: 'info',
        title: 'Hindi Nakakonekta ang USB Printer',
        text: 'Isaksak at i-on ang printer, tapos i-pair ito ngayon?',
        showCancelButton: true,
        confirmButtonText: 'Pair Now',
        cancelButtonText: 'Cancel'
    });
    if (!answer || !answer.isConfirmed) return false;
    await pairUsbPrinter();
    return isUsbPrinterReady();
}

// ---- public print actions ----------------------------------------------------------------
async function printReceiptViaUsb(prefix) {
    prefix = prefix || 'r';
    if (!isUsbPrinterConfigured()) {
        usbPrinterAlert('info', 'Wala pang Naka-set Up', 'I-set up muna ang USB Printer sa Printer Device Settings.');
        return false;
    }
    try {
        if (!(await ensureUsbPrinterForPrint())) return false;
        const bytes = buildEscPosReceiptBytes(collectReceiptDataFromDom(prefix), getUsbPrinterCharWidth());
        await sendBytesToUsbPrinter(bytes);
        if (typeof playScanBeep === 'function') playScanBeep();
        return true;
    } catch (err) {
        console.error('[USB Printer] Print failed:', err);
        usbPrinterAlert('error', 'Print Error', describeUsbPrinterError(err));
        return false;
    }
}

async function printBarcodeSheetViaUsb() {
    if (!isUsbPrinterConfigured()) {
        usbPrinterAlert('info', 'Wala pang Naka-set Up', 'I-set up muna ang USB Printer sa Printer Device Settings.');
        return false;
    }
    const items = (typeof window !== 'undefined' && window.__lastBarcodePrintBatch) || [];
    if (!items.length) {
        usbPrinterAlert('info', 'Nothing Selected', 'Select an item and generate the Print Preview first before USB printing.');
        return false;
    }
    try {
        if (!(await ensureUsbPrinterForPrint())) return false;
        await sendBytesToUsbPrinter(buildEscPosBarcodeSheetBytes(items, getUsbPrinterCharWidth()));
        if (typeof playScanBeep === 'function') playScanBeep();
        return true;
    } catch (err) {
        console.error('[USB Printer] Barcode print failed:', err);
        usbPrinterAlert('error', 'Print Error', describeUsbPrinterError(err));
        return false;
    }
}

async function testPrintUsbPrinter() {
    if (!isUsbPrinterConfigured()) {
        usbPrinterAlert('warning', 'Wala pang Naka-set Up', 'I-pair o piliin muna ang USB printer.');
        return false;
    }
    const btn = document.getElementById('usb-printer-test-btn');
    if (btn) btn.disabled = true;
    const testData = {
        storeName: 'OmniPOS',
        address: `USB Printer Test (${USB_PRINTER_MODE_LABELS[getUsbPrinterMode()]})`,
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
        if (!(await ensureUsbPrinterForPrint())) return false;
        await sendBytesToUsbPrinter(buildEscPosReceiptBytes(testData, getUsbPrinterCharWidth()));
        usbPrinterToast('Naipadala ang test print!');
        return true;
    } catch (err) {
        usbPrinterAlert('error', 'Test Print Error', describeUsbPrinterError(err));
        return false;
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Silent by design (runs automatically after a cash sale).
async function openCashDrawerViaUsb() {
    if (!isUsbPrinterConfigured()) return;
    try {
        await sendBytesToUsbPrinter(new Uint8Array(buildEscPosCashDrawerKickBytes(0)));
    } catch (err) {
        console.warn('[Cash Drawer] USB kick command failed:', err);
    }
}

// ---- optional: real-time status (DLE EOT) — WebUSB bidirectional printers only -------------
async function usbPrinterReadStatusByte(n) {
    const device = usbPrinterDevice;
    const ep = usbPrinterEndpoints;
    if (!device || !ep || ep.inEndpoint === null) throw makeUsbPrinterError('Walang input endpoint ang printer na ito.', 'NoInEndpoint');
    await device.transferOut(ep.outEndpoint, new Uint8Array([0x10, 0x04, n]));
    const res = await usbPrinterWithTimeout(device.transferIn(ep.inEndpoint, 8), USB_PRINTER_STATUS_TIMEOUT_MS, 'status timeout');
    if (res.status !== 'ok' || !res.data || res.data.byteLength < 1) {
        throw makeUsbPrinterError('Walang sagot ang printer.', 'NoStatus');
    }
    return res.data.getUint8(res.data.byteLength - 1);
}

function parseUsbPrinterStatus(online, offline, paper) {
    const lines = [];
    lines.push(online & 0x08 ? '⚠️ Offline ang printer' : '✅ Online ang printer');
    if (offline & 0x04) lines.push('⚠️ Bukas ang takip ng printer');
    if (offline & 0x20) lines.push('⚠️ Naubusan ng papel (huminto ang pag-print)');
    if (offline & 0x40) lines.push('⚠️ May error ang printer');
    if (paper & 0x60) lines.push('⚠️ Walang papel');
    else if (paper & 0x0c) lines.push('⚠️ Malapit nang maubos ang papel');
    else lines.push('✅ May papel');
    return lines;
}

async function checkUsbPrinterStatus() {
    if (!isUsbPrinterConfigured()) {
        usbPrinterAlert('warning', 'Wala pang Naka-set Up', 'I-pair muna ang USB printer.');
        return;
    }
    if (getUsbPrinterMode() !== 'webusb') {
        usbPrinterAlert('info', 'Hindi Available', 'Ang status check ay para lang sa Direct USB (WebUSB) mode.');
        return;
    }
    if (usbPrinterStatusUnsupported) {
        usbPrinterAlert('info', 'Hindi Suportado', 'Hindi sumasagot sa status query ang printer na ito (normal ito sa maraming murang model). Gumagana pa rin ang pag-print.');
        return;
    }
    try {
        const lines = await usbPrinterEnqueue(async () => {
            const ok = await ensureUsbPrinterConnected();
            if (!ok) throw makeUsbPrinterError('Hindi nakakonekta ang USB printer.', 'NotConnectedError');
            try {
                const online = await usbPrinterReadStatusByte(1);
                const offline = await usbPrinterReadStatusByte(2);
                const paper = await usbPrinterReadStatusByte(4);
                return parseUsbPrinterStatus(online, offline, paper);
            } catch (err) {
                if (err && (err.name === 'UsbPrinterTimeout' || err.name === 'NoStatus' || err.name === 'NoInEndpoint')) {
                    usbPrinterStatusUnsupported = true;
                    // Drop the possibly-hung IN transfer by reopening the device.
                    await usbPrinterCloseQuiet();
                    await ensureUsbPrinterConnected();
                    throw makeUsbPrinterError('Hindi sumasagot sa status query ang printer na ito (normal ito sa maraming murang model). Gumagana pa rin ang pag-print.', 'StatusUnsupported');
                }
                throw err;
            }
        });
        usbPrinterAlert('info', 'Status ng Printer', lines.join('\n'));
    } catch (err) {
        usbPrinterAlert('info', 'Status ng Printer', describeUsbPrinterError(err));
    }
}

// ---- server mode: list targets ---------------------------------------------------------------
async function fetchUsbPrinterServerTargets() {
    const res = await authFetch(`${API_URL}/printer/usb-targets`, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
        throw makeUsbPrinterError((data && data.message) || 'Hindi makuha ang listahan ng printer mula sa server.', 'ServerListError');
    }
    return data;
}

let usbPrinterServerRenderToken = 0;

async function renderUsbPrinterServerTargets(showErrors) {
    const select = document.getElementById('usb-printer-server-target');
    const note = document.getElementById('usb-printer-server-note');
    if (!select) return;
    // Overlapping refreshes (init + mode switch + Refresh button) must not append twice:
    // only the newest call is allowed to touch the DOM, and it rebuilds the list in one go.
    const token = ++usbPrinterServerRenderToken;
    let data = null;
    let errorMessage = '';
    try {
        data = await fetchUsbPrinterServerTargets();
    } catch (err) {
        errorMessage = describeUsbPrinterError(err);
    }
    if (token !== usbPrinterServerRenderToken) return;

    const saved = usbPrinterStorageGet(USB_PRINTER_STORAGE_KEYS.serverTarget) || '';
    const options = [{ value: '', label: '— Pumili ng printer —' }];
    const known = new Set();
    if (data) {
        (data.queues || []).forEach((q) => {
            const value = `queue:${q.name}`;
            options.push({ value, label: `${q.name}${q.isUsb ? ' (USB)' : ''}` });
            known.add(value);
        });
        (data.devices || []).forEach((d) => {
            const value = `device:${d}`;
            options.push({ value, label: `${d} (direktang USB device)` });
            known.add(value);
        });
    }
    if (saved && !known.has(saved)) {
        options.push({ value: saved, label: `${saved.replace(/^(queue|device):/, '')} (naka-save)` });
    }
    select.innerHTML = '';
    options.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
    });
    select.value = saved;
    if (note) {
        if (errorMessage) {
            note.textContent = errorMessage;
        } else if (known.size === 0) {
            note.textContent = 'Walang nakitang USB printer sa server. Isaksak ang printer sa device na nagpapatakbo ng OmniPOS server at i-add ito sa CUPS (o siguraduhing may /dev/usb/lp0), tapos i-tap ang Refresh.';
        } else {
            note.textContent = `Nakita ang ${known.size} printer/device sa server.`;
        }
    }
    if (errorMessage && showErrors) usbPrinterAlert('error', 'Server Error', errorMessage);
}

function saveUsbPrinterServerTarget() {
    const select = document.getElementById('usb-printer-server-target');
    const value = select ? select.value : '';
    if (value) {
        usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.serverTarget, value);
        usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.name, value.replace(/^(queue|device):/, ''));
    } else {
        usbPrinterStorageRemove(USB_PRINTER_STORAGE_KEYS.serverTarget);
    }
    updateUsbPrinterStatusUI();
}

// ---- UI --------------------------------------------------------------------------------------
function showUsbPrintButtons() {
    ['receipt-usb-print-btn', 'receipt-preview-usb-print-btn', 'barcode-usb-print-btn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'inline-block';
    });
    const headerBtn = document.getElementById('barcode-header-usb-print-btn');
    if (headerBtn) headerBtn.style.display = 'flex';
}

function hideUsbPrintButtons() {
    ['receipt-usb-print-btn', 'receipt-preview-usb-print-btn', 'barcode-usb-print-btn', 'barcode-header-usb-print-btn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function applyUsbPrinterModePanels() {
    const mode = getUsbPrinterMode();
    USB_PRINTER_MODES.forEach((m) => {
        const panel = document.getElementById(`usb-panel-${m}`);
        if (panel) panel.style.display = (m === mode) ? 'block' : 'none';
    });
    const select = document.getElementById('usb-printer-mode-select');
    if (select && select.value !== mode) select.value = mode;
}

function onUsbPrinterModeChange() {
    const select = document.getElementById('usb-printer-mode-select');
    const mode = select ? select.value : 'webusb';
    if (USB_PRINTER_MODES.indexOf(mode) === -1) return;
    usbPrinterCloseQuiet().then(() => {
        usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.mode, mode);
        applyUsbPrinterModePanels();
        if (mode === 'server') renderUsbPrinterServerTargets();
        updateUsbPrinterStatusUI();
        ensureUsbPrinterConnected();
    });
}

function saveUsbPrinterBaudRate() {
    const select = document.getElementById('usb-printer-baud-select');
    const baud = parseInt(select && select.value, 10);
    if (!(baud > 0)) return;
    usbPrinterStorageSet(USB_PRINTER_STORAGE_KEYS.baudRate, String(baud));
    // Reopen on the next print with the new rate.
    usbPrinterSerialCloseQuiet().then(updateUsbPrinterStatusUI);
}

function updateUsbPrinterStatusUI() {
    const dot = document.getElementById('usb-printer-status-dot');
    const text = document.getElementById('usb-printer-status-text');
    const unsupported = document.getElementById('usb-printer-unsupported-note');
    const mode = getUsbPrinterMode();
    const supported = isUsbModeSupported(mode);

    ['usb-printer-pair-btn', 'usb-printer-pair-all-btn', 'usb-printer-pair-serial-btn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !supported || mode === 'server';
    });
    if (unsupported) {
        unsupported.style.display = supported ? 'none' : 'block';
        unsupported.textContent = supported ? '' : getUsbModeUnsupportedMessage(mode);
    }

    const configured = isUsbPrinterConfigured();
    const modeLabel = USB_PRINTER_MODE_LABELS[mode];
    if (!supported) {
        if (dot) dot.style.background = '#94a3b8';
        if (text) text.innerText = 'Hindi suportado ng browser/koneksyon na ito';
        hideUsbPrintButtons();
    } else if (configured && isUsbPrinterReady()) {
        if (dot) dot.style.background = '#22c55e';
        if (text) text.innerText = `Konektado: ${getUsbPrinterDisplayName()} (${modeLabel})`;
        showUsbPrintButtons();
    } else if (configured) {
        if (dot) dot.style.background = '#eab308';
        if (text) text.innerText = `Naka-save: ${getUsbPrinterDisplayName()} — isaksak ang printer o i-tap ang "Pair Printer" para muling kumonekta`;
        showUsbPrintButtons();
    } else {
        if (dot) dot.style.background = '#94a3b8';
        if (text) text.innerText = 'Walang naka-set up na USB printer';
        hideUsbPrintButtons();
    }
    if (typeof updatePrinterActiveSummaryUI === 'function') updatePrinterActiveSummaryUI();
}

// ---- hot-plug events & lifecycle ---------------------------------------------------------------
function usbPrinterBindEvents() {
    if (usbPrinterEventsBound) return;
    usbPrinterEventsBound = true;
    if (typeof navigator !== 'undefined' && navigator.usb && typeof navigator.usb.addEventListener === 'function') {
        navigator.usb.addEventListener('disconnect', (ev) => {
            if (usbPrinterDevice && usbDeviceSameIdentity(ev.device, usbPrinterDevice)) {
                usbPrinterDevice = null;
                usbPrinterEndpoints = null;
                updateUsbPrinterStatusUI();
            }
        });
        navigator.usb.addEventListener('connect', (ev) => {
            if (getUsbPrinterMode() === 'webusb' && usbDeviceMatchesSaved(ev.device)) {
                setTimeout(() => { ensureUsbPrinterConnected().then(updateUsbPrinterStatusUI); }, 400);
            }
        });
    }
    if (typeof navigator !== 'undefined' && navigator.serial && typeof navigator.serial.addEventListener === 'function') {
        navigator.serial.addEventListener('disconnect', (ev) => {
            if (usbPrinterSerialPort && ev.target === usbPrinterSerialPort) {
                usbPrinterSerialPort = null;
                updateUsbPrinterStatusUI();
            }
        });
        navigator.serial.addEventListener('connect', () => {
            if (getUsbPrinterMode() === 'webserial') {
                setTimeout(() => { ensureUsbPrinterConnected().then(updateUsbPrinterStatusUI); }, 400);
            }
        });
    }
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && isUsbPrinterConfigured() && !isUsbPrinterReady()) {
                ensureUsbPrinterConnected().then(updateUsbPrinterStatusUI);
            }
        });
    }
}

function initUsbPrinterUI() {
    const modeSelect = document.getElementById('usb-printer-mode-select');
    if (modeSelect) modeSelect.value = getUsbPrinterMode();
    const baudSelect = document.getElementById('usb-printer-baud-select');
    if (baudSelect) {
        const baud = String(getUsbPrinterBaudRate());
        baudSelect.value = baud;
        if (baudSelect.value !== baud) baudSelect.value = String(USB_PRINTER_DEFAULT_BAUD);
    }
    applyUsbPrinterModePanels();
    if (getUsbPrinterMode() === 'server') renderUsbPrinterServerTargets();
    usbPrinterBindEvents();
    updateUsbPrinterStatusUI();
    if (isUsbPrinterConfigured() && getUsbPrinterMode() !== 'server') {
        ensureUsbPrinterConnected().then(updateUsbPrinterStatusUI);
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUsbPrinterUI);
    } else {
        initUsbPrinterUI();
    }
}
