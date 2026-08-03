

const isLocal = window.location.hostname ==='localhost' ||
                window.location.hostname ==='127.0.0.1' ||
                window.location.hostname.startsWith('192.168.') ||
                window.location.hostname.startsWith('10.') ||
/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname);

const API_URL = isLocal
    ? `${window.location.protocol}//${window.location.hostname}:3000/api`
    : `${window.location.protocol}//${window.location.hostname}/api`;

// CRITICAL FIX: bago walang timeout ang mga network call (login, logout,
// atbp.) — kapag biglaang nawala ang internet habang naka-request, pwede
// itong mag-hang ng mahabang panahon (30s+, depende sa browser/OS) bago
// mag-fail, kaya parang "nag-freeze" ang login/logout. Dito, kahit anong
// authFetch call ay AUTOMATIC nang mag-i-fail sa loob lang ng
// AUTH_FETCH_TIMEOUT_MS kung walang sagot — sasabihan agad ang user sa
// halip na maghintay nang walang katiyakan.
const AUTH_FETCH_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url, options = {}, timeoutMs = AUTH_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    // Kung may sarili nang signal ang caller, i-respeto rin ito (hal. kapag
    // gusto ng ibang function na sila mismo ang mag-cancel).
    const externalSignal = options.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
        return await window.fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function authFetch(url, options = {}) {
    const token = localStorage.getItem('posa_token');
    const opts = { ...options };
    opts.headers = {
        ...(options.headers || {}),
        ...(token ? {'Authorization': `Bearer ${token}` } : {})
    };

    let res;
    try {
        res = await fetchWithTimeout(url, opts);
    } catch (err) {
        // Agad na i-trigger ang real-time na re-check ng connection status
        // (hindi na maghihintay ng buong 6s poll interval) para instantly
        // ma-update ang green/blue/red dot at ang offline-mode toggle sakaling
        // dito unang na-detect ang pagkawala ng koneksyon.
        if (window.__triggerNetworkRecheck) window.__triggerNetworkRecheck();
        throw err;
    }

    if (res.status === 401 && !url.includes('/auth/login')) {

        if (!token) {
            return res;
        }

        if (!window.__sessionExpiredShown && !window.__logoutInProgress) {
            window.__sessionExpiredShown = true;
            localStorage.removeItem('posa_user');
            localStorage.removeItem('posa_token');
            if (typeof Swal !=='undefined') {
                Swal.fire('Session Expired','Nag-expire o naging invalid ang iyong session. Mangyaring mag-login muli.','warning')
                    .then(() => window.location.reload());
            } else {
                window.location.reload();
            }
        }
    }

    if (res.status === 402) {
        try {
            const data = await res.clone().json();
            if (data && data.featureLocked && !window.__featurePromptOpen) {
                window.__featurePromptOpen = true;
                const opener = data.showUpgradeTiers
                    ? () => showUpgradeTiersModal()
                    : () => promptUnlockFeature(data.featureId, data.featureName, data.price, data.description);
                opener().finally(() => { window.__featurePromptOpen = false; });
            }
        } catch (e) {

        }
    }

    return res;
}

// --------------------------------------------------------------
// OFFLINE MODE GUARD — iisang source of truth (ang connectivity-mode-btn's
// dataset.mode, tingnan ang toggle logic sa index.html) para malaman kung
// dapat i-block ang isang internet-dependent na aksyon (unlock requests,
// cloud backup, update check/deploy, atbp.). Ginagamit ito ng lahat ng
// function na tumatawag sa RELAY sa pamamagitan ng backend.
// --------------------------------------------------------------
function isOfflineModeActive() {
    const btn = document.getElementById('connectivity-mode-btn');
    return !!(btn && btn.dataset.mode === 'offline');
}

function blockIfOffline(featureLabel) {
    if (!isOfflineModeActive()) return false;
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'info',
            title: 'Offline Mode Active',
            html: `<strong>${featureLabel}</strong> requires an internet connection and is unavailable while Offline Mode is enabled.<br><br>Please switch to Online mode to continue.`,
            confirmButtonText: 'OK',
            confirmButtonColor: '#2563eb'
        });
    }
    return true;
}

// Kapag tinanggihan ang isang unlock/demo/bundle request dahil HINDI PA
// naka-Allow ang device na ito sa Relay (unang beses palang gumawa ng
// request), hindi ito dapat ituring na error — inaasahang pangyayari ito
// habang naghihintay ng authorization mula sa developer/store owner.
// Ginagamit ito ng lahat ng 4 na request flow (theme, feature, demo,
// bundle) para consistent ang UX sa halip na basta ipakita bilang error.
function showUnlockRequestError(reqData, fallbackMessage) {
    if (reqData && reqData.pendingAuthorization) {
        Swal.fire({
            icon:'info',
            title:'Naghihintay ng Authorization',
            html: '<p style="font-size:0.85rem;color:#64748b;margin:0;">' +
                (reqData.message ||'Naipadala na ang device na ito para sa authorization ng developer/store owner. Subukan ulit pagkatapos ka nilang i-\"Allow\".') +
                '</p>',
            confirmButtonText:'OK',
            confirmButtonColor:'#2563eb',
        });
        return;
    }
    Swal.fire('Request Not Sent', (reqData && reqData.message) || fallbackMessage,'error');
}

function escapeHtml(value) {
    if (value === null || value === undefined) return'';
    return String(value)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
}

/* --------------------------------------------------------------
   HAPTIC FEEDBACK (vibration sa cellphone kada tap sa POS Terminal)
   -----------------------------------------------------------------
   Gumagamit ito ng built-in na navigator.vibrate() API ng browser.
   Kung naka-OFF ang haptics/vibration sa settings ng cellphone, o kung
   hindi supported ng device/browser (hal. karamihan sa desktop/PC,
   o iPhone Safari na walang support dito), tahimik lang itong walang
   gagawin — walang error, walang epekto. Kaya safe itong tawagin
   kahit saan, PC man o mobile.
   -------------------------------------------------------------- */
function triggerHaptic(durationMs = 12) {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(durationMs);
        }
    } catch (e) {
        /* walang vibration hardware/permission — okay lang, laktawan na lang */
    }
}

/* Nagdaragdag ng instant na "naka-pindot" na highlight (sa pamamagitan ng
   pointerdown/up kaysa sa pag-asa sa native :active, na kung minsan mabagal
   o hindi consistent lalo na sa ilang mobile browsers) kasabay ng haptic
   vibration. Ginagamit ito ng product cards at category chips sa Terminal. */
function attachInstantTapFeedback(el, options) {
    options = options || {};
    var activeClass = options.activeClass || 'tap-active';
    var hapticMs = options.hapticMs || 12;

    if (!el || el.__instantTapBound) return;
    el.__instantTapBound = true;

    var clearActive = function () { el.classList.remove(activeClass); };

    el.addEventListener('pointerdown', function () {
        el.classList.add(activeClass);
        triggerHaptic(hapticMs);
    }, { passive: true });

    el.addEventListener('pointerup', clearActive, { passive: true });
    el.addEventListener('pointerleave', clearActive, { passive: true });
    el.addEventListener('pointercancel', clearActive, { passive: true });
}

const SYSTEM_CONFIG = {
    appName:"OmniPOS System",
    serverName:"Core API Gateway",
    getErrorMessage: (msg) => `[${SYSTEM_CONFIG.serverName}] Error: ${msg}`,
    getSuccessMessage: (msg) => `[${SYSTEM_CONFIG.appName}] Success: ${msg}`
};

let currentUser = null;
let supportAccessRevertTimer = null;
try {
    const storedUser = localStorage.getItem('posa_user');
    if (storedUser && storedUser !=='undefined') {
        currentUser = JSON.parse(storedUser);
    }
} catch (e) {
    console.warn("Corrupted local session found. Clearing data.");
    localStorage.removeItem('posa_user');
    localStorage.removeItem('posa_token');
}

if (currentUser && currentUser._supportAccessExpiresAt) {
    const msRemaining = currentUser._supportAccessExpiresAt - Date.now();
    if (msRemaining > 0) {
        supportAccessRevertTimer = setTimeout(() => revertTemporarySupportAccess(), msRemaining);
    } else {
        currentUser.role = currentUser._supportAccessOriginalRole || currentUser.role;
        delete currentUser._supportAccessOriginalRole;
        delete currentUser._supportAccessExpiresAt;
        localStorage.setItem('posa_user', JSON.stringify(currentUser));
    }
}

let currentPermissions = {};
let menuRegistry = [];
try {
    const storedPerms = localStorage.getItem('posa_permissions');
    if (storedPerms && storedPerms !=='undefined') currentPermissions = JSON.parse(storedPerms);
    const storedRegistry = localStorage.getItem('posa_menu_registry');
    if (storedRegistry && storedRegistry !=='undefined') menuRegistry = JSON.parse(storedRegistry);
} catch (e) {
    currentPermissions = {};
    menuRegistry = [];
}

async function refreshPermissions() {
    if (!currentUser) return;
    try {
        const res = await authFetch(`${API_URL}/roles`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;

        menuRegistry = data.menuRegistry || [];
        const myRole = (data.roles || []).find(r => r.name.toLowerCase() === (currentUser.role ||'').toLowerCase());
        if (myRole) {
            currentPermissions = myRole.permissions || {};
        } else if ((currentUser.role ||'').toLowerCase() ==='admin') {

            currentPermissions = menuRegistry.reduce((acc, m) => { acc[m.key] = true; return acc; }, {});
        } else {
            currentPermissions = {};
        }

        localStorage.setItem('posa_permissions', JSON.stringify(currentPermissions));
        localStorage.setItem('posa_menu_registry', JSON.stringify(menuRegistry));
        applyRoleBasedAccessControls(currentUser.role);
        if (typeof updateUsersTabVisibility ==='function') updateUsersTabVisibility();
    } catch (err) {
        console.warn('[OmniPOS] Unable to refresh permission matrix:', err);
    }
}

let localTransactionsList = [];
let globalProducts = [];
let customCategories = [];
let shoppingCart = [];
let activeTerminalCategory ='All';
let selectedPaymentMethod ='CASH';

let splitPaymentMode = false;
let splitPaymentLines = [];
let scannerTarget ='PRODUCT';

let cartDiscountType ='NONE';
let cartPromoCode ='';
let cartSeniorPwdId ='';
let selectedCartCustomer = null;

let addProductScanSession = { active: false, lastScannedFormCode: null };
let productFormScanLastCode ='';
let productFormScanLastTime = 0;

const THEME_CATALOG = [
    { id:'day',      name:'Day Mode',      icon:'fa-sun',      pro: false },
    { id:'dark',     name:'Dark Mode',     icon:'fa-moon',     pro: false },
    { id:'ocean',    name:'Ocean Pro',     icon:'fa-water',    pro: true, price:'₱149' },
    { id:'emerald',  name:'Emerald Pro',   icon:'fa-gem',      pro: true, price:'₱149' },
    { id:'sunset',   name:'Sunset Pro',    icon:'fa-fire',     pro: true, price:'₱149' },
    { id:'rosegold', name:'Rose Gold Pro', icon:'fa-crown',    pro: true, price:'₱149' },
    { id:'cyber',    name:'Cyber Neon Pro',   icon:'fa-bolt',      pro: true, price:'₱149' },
    { id:'noir',     name:'Coffee Noir Pro',  icon:'fa-mug-saucer', pro: true, price:'₱149' },
    { id:'mintfrost',name:'Mint Frost Pro',   icon:'fa-snowflake', pro: true, price:'₱149' },
];

function getUnlockedThemeIds() {
    try {
        return JSON.parse(localStorage.getItem('posa_unlocked_themes_cache') ||'[]');
    } catch (e) {
        return [];
    }
}

function isThemeUnlocked(theme) {
    return !theme.pro || getUnlockedThemeIds().includes(theme.id);
}

async function refreshUnlockedThemesFromServer() {
    try {
        const res = await authFetch('/api/themes/status');
        const data = await res.json();
        if (data && data.success && Array.isArray(data.unlockedThemeIds)) {
            localStorage.setItem('posa_unlocked_themes_cache', JSON.stringify(data.unlockedThemeIds));
            renderThemeMenu();
        }
    } catch (e) {
        console.warn('Hindi makuha ang theme unlock status mula sa server, gagamitin muna ang cache.', e);
    }
}

function initDarkMode() {

    let savedThemeId = localStorage.getItem('posa_theme');
    if (!savedThemeId) {
        savedThemeId = localStorage.getItem('posa_darkmode') ==='true' ?'dark' :'day';
    }
    const theme = THEME_CATALOG.find(t => t.id === savedThemeId) || THEME_CATALOG[0];

    const themeToApply = isThemeUnlocked(theme) ? theme : THEME_CATALOG[1];
    applyTheme(themeToApply.id, { persist: false });
    renderThemeMenu();
}

function applyTheme(themeId, opts) {
    opts = opts || {};
    const theme = THEME_CATALOG.find(t => t.id === themeId) || THEME_CATALOG[0];
    const isDay = theme.id ==='day';
    document.body.classList.toggle('dark-mode', !isDay);
    if (isDay) {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', theme.id);
    }

    const root = document.documentElement;
    root.classList.remove('theme-preload');
    root.removeAttribute('data-theme-preload');
    root.style.removeProperty('--dm-bg');
    root.style.colorScheme ='';
    if (opts.persist !== false) {
        localStorage.setItem('posa_theme', theme.id);
        localStorage.setItem('posa_darkmode', String(!isDay));
    }
    updateThemeSelectionUI(theme.id);

    // FIX: dati, kapag nagpapalit ng color theme (Dark Mode, Ocean Pro,
    // Cyber Neon, atbp.) habang nasa Overview page na ang user, hindi na
    // muling tumatakbo ang staggered entrance animation (".ov-anim") —
    // isang beses lang kasi ito tumatakbo bilang CSS keyframe animation,
    // nung una itong ipinakita (karaniwan ay sa Day mode, ang default).
    // Kaya kapag lumipat ng theme dito mismo (hindi sa pamamagitan ng
    // switchView), parang "walang animation" ang pakiramdam — bigla na
    // lang nagpapalit ng kulay nang walang motion. Dito na ito muling
    // pina-play, pero sa susunod na animation frame (para siguradong
    // na-apply na muna ang bagong theme classes/kulay sa itaas bago mag-
    // restart ang animation), at tanging kapag currently open/visible ang
    // Overview view lang — hindi dapat tumakbo ito habang naka-login
    // screen pa o ibang view ang bukas.
    const overviewSection = document.getElementById('view-overview');
    if (overviewSection && overviewSection.offsetParent !== null && typeof replayOverviewEntranceAnimation ==='function') {
        requestAnimationFrame(() => {
            replayOverviewEntranceAnimation();
        });
    }
}

function setTheme(themeId) {
    const theme = THEME_CATALOG.find(t => t.id === themeId);
    if (!theme) return;
    if (!isThemeUnlocked(theme)) {
        promptUnlockTheme(theme);
        return;
    }
    applyTheme(theme.id);
    renderThemeMenu();
}

function updateThemeSelectionUI(activeId) {
    document.querySelectorAll('.uw-theme-option').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themeId === activeId);
    });
}

function renderThemeMenu() {
    const container = document.getElementById('uw-themes-submenu');
    if (!container) return;
    const unlockedIds = getUnlockedThemeIds();
    const currentThemeId = localStorage.getItem('posa_theme') ||'day';

    container.innerHTML = THEME_CATALOG.map((theme) => {
        const locked = theme.pro && !unlockedIds.includes(theme.id);
        const isActive = theme.id === currentThemeId;
        let badge ='';
        if (locked) {
            badge ='<i class="fa-solid fa-lock uw-theme-lock" title="Premium feature — locked"></i>';
        } else if (theme.pro) {
            badge ='<span class="uw-theme-pro-badge">PRO</span>';
        }
        return (
'<button type="button" class="uw-theme-option' + (isActive ?' active' :'') + (locked ?' is-locked' :'') +'" ' +
'data-theme-id="' + theme.id +'" onclick="setTheme(\'' + theme.id +'\')">' +
'<i class="fa-solid ' + theme.icon +'"></i> ' + theme.name +
'<span class="uw-theme-badge-slot">' + badge +'</span>' +
'</button>'
        );
    }).join('');
}

async function promptUnlockTheme(theme) {
    if (blockIfOffline('Theme unlock requests')) return;
    const requestingUsername = (currentUser && (currentUser.username || currentUser.name)) ||'Unknown';

    const confirmResult = await Swal.fire({
        title:'Unlock ' + theme.name,
        html:
'<p style="margin:0 0 8px;">This is a premium theme' + (theme.price ?' — <strong>' + theme.price +'</strong>' :'') +'.</p>' +
'<p style="font-size:0.82rem;color:#94a3b8;margin:0;">An unlock request will be sent to the developer/store owner. ' +
'Once payment has been verified, you will receive a 6-digit code to enter in the next step.</p>',
        icon:'info',
        showCancelButton: true,
        confirmButtonText:'Send Request',
        cancelButtonText:'Close',
        confirmButtonColor:'#2563eb',
    });
    if (!confirmResult.isConfirmed) return;

    try {
        const reqRes = await authFetch('/api/themes/request-unlock', {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ themeId: theme.id, username: requestingUsername })
        });
        const reqData = await reqRes.json();

        if (!reqData.success) {
            showUnlockRequestError(reqData,'The unlock request failed.');
            return;
        }
        if (reqData.alreadyUnlocked) {
            await refreshUnlockedThemesFromServer();
            applyTheme(theme.id);
            renderThemeMenu();
            initDemoModeUI();
            return;
        }
    } catch (e) {
        Swal.fire('Error','Could not reach the server to send the unlock request.','error');
        return;
    }

    const otpResult = await Swal.fire({
        title:'🔒 Verification Required',
        html:'<p style="font-size:0.85rem;color:#64748b;margin:0 0 4px;">' +
'Enter the 6-digit verification code sent to the developer/store owner to activate <strong>' + theme.name +'</strong>.</p>',
        input:'text',
        inputPlaceholder:'••••••',
        inputAttributes: { maxlength: 6, inputmode:'numeric', autocapitalize:'off', autocorrect:'off', style:'text-align:center; letter-spacing:4px; font-size:1.1rem;' },
        showCancelButton: true,
        confirmButtonText:'Verify Code',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#2563eb',
    });
    if (!otpResult.isConfirmed || !otpResult.value) return;

    try {
        const confirmRes = await authFetch('/api/themes/confirm-unlock', {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ themeId: theme.id, otp: otpResult.value.trim(), username: requestingUsername })
        });
        const confirmData = await confirmRes.json();

        if (!confirmData.success) {
            Swal.fire('Incorrect Code', confirmData.message ||'Failed to verify the code.','error');
            return;
        }

        if (Array.isArray(confirmData.unlockedThemeIds)) {
            localStorage.setItem('posa_unlocked_themes_cache', JSON.stringify(confirmData.unlockedThemeIds));
        }
        applyTheme(theme.id);
        renderThemeMenu();
        initDemoModeUI();
        Swal.fire('Unlocked!', theme.name +' is now ready to use.','success');
    } catch (e) {
        Swal.fire('Error','Could not reach the server to complete verification.','error');
    }
}

let unlockedFeatureIdsCache = null;

let purchasedFeatureIdsCache = null;

let fullyPurchasedCache = false;

async function refreshUnlockedFeaturesFromServer() {
    try {
        const res = await authFetch(`${API_URL}/features/status`);
        const data = await res.json();
        if (data && data.success && Array.isArray(data.unlockedFeatureIds)) {
            unlockedFeatureIdsCache = data.unlockedFeatureIds;
        }
        if (data && data.success && Array.isArray(data.purchasedFeatureIds)) {
            purchasedFeatureIdsCache = data.purchasedFeatureIds;
        }
        if (data && data.success) {
            fullyPurchasedCache = !!data.fullyPurchased;
        }
    } catch (e) {
        console.warn('Hindi makuha ang feature unlock status mula sa server.', e);
    }
    updateSidebarFeatureLocks();
    return unlockedFeatureIdsCache || [];
}

function isFeatureUnlockedCached(featureId) {
    return Array.isArray(unlockedFeatureIdsCache) && unlockedFeatureIdsCache.includes(featureId);
}

const SIDEBAR_FEATURE_LOCK_MAP = {
'menu-customers-lock':'customer_crm',
'menu-shiftreport-lock':'shift_management',
'menu-reports-lock':'advanced_reports',
'export-csv-lock':'advanced_reports',
'promo-codes-lock':'promo_codes',
'create-po-lock':'purchase_orders',
'reorder-export-csv-lock':'purchase_orders',

'menu-reorder-lock':'purchase_orders'
};

function updateRolesPermissionsLockState() {
    const wrap = document.getElementById('roles-permissions-matrix-wrap');
    const overlay = document.getElementById('roles-permissions-lock-overlay');
    if (!wrap || !overlay) return;
    const locked = !isFeatureUnlockedCached('rbac_management');
    wrap.classList.toggle('is-locked', locked);
    overlay.style.display = locked ?'flex' :'none';
}

function updateSidebarFeatureLocks() {
    Object.keys(SIDEBAR_FEATURE_LOCK_MAP).forEach((elementId) => {
        const el = document.getElementById(elementId);
        if (!el) return;
        const featureId = SIDEBAR_FEATURE_LOCK_MAP[elementId];
        const unlocked = isFeatureUnlockedCached(featureId);

        el.style.display = unlocked ?'none' :'inline-flex';
        const proBadge = document.getElementById(elementId.replace(/-lock$/,'-pro'));
        if (proBadge) {
            proBadge.style.display = unlocked ?'inline-flex' :'none';
        }
    });
    updateRolesPermissionsLockState();
}

function isBadgeAllowedForFeature(featureId) {
    return isFeatureUnlockedCached(featureId);
}

const PREMIUM_FEATURE_INFO = {
    purchase_orders: { name:'Purchase Orders Module', price: 999, description:'Create and track Purchase Orders to suppliers, including reorder suggestions.' },
    customer_crm: { name:'Customer Profiles & Loyalty', price: 799, description:'Customer profiles, loyalty points, and purchase history for each customer.' },
    promo_codes: { name:'Promo Codes Module', price: 499, description:'Create discount/promo codes that can be used at checkout.' },
    advanced_reports: { name:'Sales Analytics & Advanced Reports', price: 799, description:'Profit margin, top/slow sellers, 7-day sales trend, and payment method breakdown.' },
    shift_management: { name:'Multi-Cashier Shift Oversight & Z-Reading Reports', price: 699, description:'Multi-cashier shift tracking and Z-Reading (cash count) reports.' },
    rbac_management: { name:'Roles & Permissions (RBAC) Management', price: 999, description:'Create custom roles and configure which menus each role can access (Roles & Permissions matrix).' },
};

function guardPremiumFeature(featureId) {
    if (isFeatureUnlockedCached(featureId)) return false;
    const info = PREMIUM_FEATURE_INFO[featureId] || {};
    promptUnlockFeature(featureId, info.name, info.price, info.description);
    return true;
}

// --------------------------------------------------------------
// Kumukuha ng isang mabilisang snapshot gamit ang camera ng device
// (kung meron/pinayagan). Ginagamit ito bago magpadala ng unlock/demo
// request, para may makita kang larawan sa admin panel ng RELAY kung
// sino talaga ang humihiling. Kung walang camera o tinanggihan ang
// permission, `null` lang ang ibabalik nito — hindi ito humaharang sa
// pagpapatuloy ng request (optional lang, hindi required ang photo).
// --------------------------------------------------------------
async function captureQuickPhoto() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
        // FIX: wala pang "facingMode" dati, kaya ang default camera na ginagamit
        // ng ilang device/browser ay yung LIKOD (environment) na camera — hindi
        // makikita ang MUKHA ng humihiling. "user" (selfie/front camera) ang
        // gusto natin dito dahil layunin ng feature na makilala kung sino ang
        // humihiling. "ideal" (hindi "exact") para hindi mabigo kung walang
        // front camera ang device — babalik na lang sa kung anong meron.
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240, facingMode: { ideal: 'user' } },
            audio: false
        });
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        await new Promise(r => setTimeout(r, 350)); // konting delay para makapag-focus ang camera
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        canvas.getContext('2d').drawImage(video, 0, 0, 320, 240);
        stream.getTracks().forEach(t => t.stop());
        return canvas.toDataURL('image/jpeg', 0.6);
    } catch (err) {
        return null; // walang camera/permission — okay lang, magpapatuloy nang walang photo
    }
}

// --------------------------------------------------------------
// Pagkatapos maipasa ang TAMANG OTP, hindi pa agad na-a-unlock ang
// feature — kailangan munang i-Allow/Run ng may-ari sa RELAY admin
// panel. Ang function na ito ay awtomatikong nag-po-poll (tumatawag
// ulit paminsan-minsan) hangga't "pending" pa rin ang sagot, at
// tumitigil lang kapag na-approve na (success) o kinansela ng user.
// --------------------------------------------------------------
async function pollUntilApproved(url, body) {
    return new Promise((resolve) => {
        let stopped = false;
        Swal.fire({
            title: 'Waiting for Approval',
            html: '<p style="font-size:0.85rem;color:#64748b;margin:0;">Your code is correct! Just waiting for the owner/developer to approve on their end. This will continue automatically — please do not close this window.</p>',
            allowOutsideClick: false,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Cancel',
            didOpen: async () => {
                Swal.showLoading();
                while (!stopped) {
                    await new Promise(r => setTimeout(r, 6000));
                    if (stopped) break;
                    try {
                        const res = await authFetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                        const data = await res.json();
                        if (data.pending) continue; // ituloy pa ang paghihintay
                        stopped = true;
                        Swal.close();
                        resolve(data);
                        return;
                    } catch (e) {
                        // pansamantalang network hiccup lang, ituloy ang pag-poll
                    }
                }
            },
        }).then((result) => {
            if (!stopped && result.dismiss === Swal.DismissReason.cancel) {
                stopped = true;
                resolve({ success: false, cancelled: true, message: 'Kinansela ang paghihintay.' });
            }
        });
    });
}

async function promptUnlockFeature(featureId, featureName, price, description) {
    if (blockIfOffline('Feature unlock requests')) return false;
    const requestingUsername = (currentUser && (currentUser.username || currentUser.name)) ||'Unknown';
    const displayName = featureName || featureId;
    const priceText = price ? `₱${price}` : null;

    const confirmResult = await Swal.fire({
        title:'Locked: ' + displayName,
        html:
'<p style="margin:0 0 8px;">This is a premium feature' + (priceText ?' — <strong>' + priceText +'</strong>' :'') +'.</p>' +
(description ? '<p style="font-size:0.82rem;color:#334155;margin:0 0 8px;">' + description + '</p>' :'') +
'<p style="font-size:0.82rem;color:#94a3b8;margin:0;">An unlock request will be sent to the developer/store owner. ' +
'Once payment has been verified, you will receive a 6-digit code to enter in the next step.</p>',
        icon:'info',
        showCancelButton: true,
        confirmButtonText:'Send Request',
        cancelButtonText:'Close',
        confirmButtonColor:'#2563eb',
    });
    if (!confirmResult.isConfirmed) return false;

    const photo = await captureQuickPhoto();

    try {
        const reqRes = await authFetch(`${API_URL}/features/request-unlock`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ featureId, username: requestingUsername, photo })
        });
        const reqData = await reqRes.json();

        if (!reqData.success) {
            showUnlockRequestError(reqData,'The unlock request failed.');
            return false;
        }
        if (reqData.alreadyUnlocked) {
            await refreshUnlockedFeaturesFromServer();
            updateSidebarFeatureLocks();
            initDemoModeUI();
            Swal.fire('Already Unlocked!', displayName +' is ready to use. Please try the action again.','success');
            return true;
        }
    } catch (e) {
        Swal.fire('Error','Could not reach the server to send the unlock request.','error');
        return false;
    }

    const otpResult = await Swal.fire({
        title:'🔒 Verification Required',
        html:'<p style="font-size:0.85rem;color:#64748b;margin:0 0 4px;">' +
'Enter the 6-digit verification code sent to the developer/store owner to activate <strong>' + displayName +'</strong>.</p>',
        input:'text',
        inputPlaceholder:'••••••',
        inputAttributes: { maxlength: 6, inputmode:'numeric', autocapitalize:'off', autocorrect:'off', style:'text-align:center; letter-spacing:4px; font-size:1.1rem;' },
        showCancelButton: true,
        confirmButtonText:'Verify Code',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#2563eb',
    });
    if (!otpResult.isConfirmed || !otpResult.value) return false;

    try {
        const confirmBody = { featureId, otp: otpResult.value.trim(), username: requestingUsername };
        let confirmRes = await authFetch(`${API_URL}/features/confirm-unlock`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(confirmBody)
        });
        let confirmData = await confirmRes.json();

        if (confirmData.pending) {
            confirmData = await pollUntilApproved(`${API_URL}/features/confirm-unlock`, confirmBody);
        }

        if (confirmData.cancelled) return false;

        if (!confirmData.success) {
            Swal.fire('Incorrect Code', confirmData.message ||'Failed to verify the code.','error');
            return false;
        }

        if (Array.isArray(confirmData.unlockedFeatureIds)) {
            unlockedFeatureIdsCache = confirmData.unlockedFeatureIds;
        }
        updateSidebarFeatureLocks();
        initDemoModeUI();
        Swal.fire('Unlocked!', displayName +' is ready to use. Please try the action again.','success');
        return true;
    } catch (e) {
        Swal.fire('Error','Could not reach the server to complete verification.','error');
        return false;
    }
}

async function showUpgradeTiersModal() {
    let catalog;
    try {
        const res = await authFetch(`${API_URL}/features/upgrade-catalog`);
        catalog = await res.json();
    } catch (e) {
        Swal.fire('Error','Could not reach the server to load the upgrade options.','error');
        return false;
    }
    if (!catalog || !catalog.success) {
        Swal.fire('Error','Could not load the upgrade options.','error');
        return false;
    }

    await refreshUnlockedFeaturesFromServer();

    const purchased = Array.isArray(purchasedFeatureIdsCache) ? purchasedFeatureIdsCache : [];
    const features = catalog.features.filter(f => !purchased.includes(f.id));
    const tiers = catalog.tiers
        .map(t => ({ ...t, featureIds: t.featureIds.filter(id => !purchased.includes(id)) }))
        .filter(t => t.featureIds.length > 0);

    if (features.length === 0) {
        Swal.fire('Naka-unlock na!','Lahat ng available na feature ay naka-unlock na sa installation na ito.','success');
        return true;
    }

    let selectedTierId = null;
    let selectedFeatureIds = new Set();

    const tierCardsHtml = tiers.map(t => {
        const effectivePrice = (typeof t.effectiveBundlePrice ==='number') ? t.effectiveBundlePrice : t.bundlePrice;
        const showOriginalStrike = effectivePrice < t.bundlePrice;
        return (
        `<button type="button" class="uw-tier-card" data-tier-id="${t.id}" data-effective-price="${effectivePrice}" style="display:block;width:100%;text-align:left;border:2px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:8px;background:#fff;cursor:pointer;">` +
            `<div style="display:flex;justify-content:space-between;align-items:baseline;">` +
                `<strong style="font-size:0.95rem;">${escapeHtml(t.name)}</strong>` +
                `<span>` +
                    (showOriginalStrike ? `<span style="font-size:0.78rem;color:#94a3b8;text-decoration:line-through;margin-right:4px;">₱${t.bundlePrice}</span>` :'') +
                    `<span style="font-size:0.95rem;font-weight:700;color:#2563eb;">₱${effectivePrice}</span>` +
                `</span>` +
            `</div>` +
            `<div style="font-size:0.78rem;color:#94a3b8;margin-top:2px;">${escapeHtml(t.description ||'')}</div>` +
            (showOriginalStrike
                ? `<div style="font-size:0.72rem;color:#94a3b8;margin-top:2px;">Presyo na lang para sa mga natitirang naka-lock na feature (may naunang nabili ka na nang hiwalay)</div>`
                :'') +
            (t.alaCartePrice > effectivePrice
                ? `<div style="font-size:0.72rem;color:#16a34a;margin-top:2px;">Save ₱${t.alaCartePrice - effectivePrice} vs à la carte</div>`
                :'') +
        `</button>`
        );
    }).join('');

    const alaCarteHtml = features.map(f => (
        `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:0.85rem;cursor:pointer;">` +
            `<input type="checkbox" class="uw-feature-check" data-feature-id="${f.id}" style="width:16px;height:16px;flex-shrink:0;margin-top:2px;">` +
            `<span style="flex:1;">` +
                `<span style="display:block;">${escapeHtml(f.name)}</span>` +
                (f.description ? `<span style="display:block;font-size:0.72rem;color:#94a3b8;margin-top:2px;line-height:1.4;">${escapeHtml(f.description)}</span>` :'') +
            `</span>` +
            `<span style="color:#64748b;flex-shrink:0;">₱${f.price}</span>` +
        `</label>`
    )).join('');

    const result = await Swal.fire({
        title:'✨ Upgrade Options',
        width: 480,
        html:
            `<div style="text-align:left;max-height:60vh;overflow-y:auto;">` +
                `<p style="font-size:0.8rem;color:#94a3b8;margin:0 0 10px;">Pumili ng isang package, o mag-à la carte sa ibaba — ang mag-de-decide lang na "Upgrade Now" button ay gumagana kahit alin ang piliin mo.</p>` +
                `<div style="font-weight:600;font-size:0.82rem;margin-bottom:6px;color:#334155;">Packages</div>` +
                `<div id="uw-tier-list">${tierCardsHtml}</div>` +
                `<div style="font-weight:600;font-size:0.82rem;margin:14px 0 6px;color:#334155;">Or pick individual features</div>` +
                `<div id="uw-feature-list">${alaCarteHtml}</div>` +
            `</div>` +
            `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:10px;border-top:1px solid #e2e8f0;">` +
                `<span style="font-size:0.85rem;color:#334155;">Total:</span>` +
                `<span id="uw-total-price" style="font-size:1.1rem;font-weight:700;color:#2563eb;">₱0</span>` +
            `</div>`,
        showCancelButton: true,
        confirmButtonText:'Upgrade Now',
        cancelButtonText:'Not Now',
        confirmButtonColor:'#2563eb',
        didOpen: () => {
            const totalEl = document.getElementById('uw-total-price');
            const tierButtons = Array.from(document.querySelectorAll('.uw-tier-card'));
            const featureChecks = Array.from(document.querySelectorAll('.uw-feature-check'));

            function renderTotal() {
                if (selectedTierId) {
                    const t = tiers.find(x => x.id === selectedTierId);
                    const effectivePrice = t ? ((typeof t.effectiveBundlePrice ==='number') ? t.effectiveBundlePrice : t.bundlePrice) : 0;
                    totalEl.textContent ='₱' + effectivePrice;
                } else {
                    const total = features
                        .filter(f => selectedFeatureIds.has(f.id))
                        .reduce((sum, f) => sum + f.price, 0);
                    totalEl.textContent ='₱' + total;
                }
            }

            tierButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-tier-id');
                    selectedTierId = (selectedTierId === id) ? null : id;
                    selectedFeatureIds = new Set();

                    const activeTier = tiers.find(t => t.id === selectedTierId);
                    featureChecks.forEach(c => {
                        const featureId = c.getAttribute('data-feature-id');
                        if (activeTier) {

                            c.checked = activeTier.featureIds.includes(featureId);
                            c.disabled = true;
                        } else {

                            c.checked = false;
                            c.disabled = false;
                        }
                    });

                    tierButtons.forEach(b => {
                        b.style.borderColor = (b.getAttribute('data-tier-id') === selectedTierId) ?'#2563eb' :'#e2e8f0';
                        b.style.background = (b.getAttribute('data-tier-id') === selectedTierId) ?'#eff6ff' :'#fff';
                    });
                    renderTotal();
                });
            });

            featureChecks.forEach(chk => {
                chk.addEventListener('change', () => {
                    if (chk.disabled) return;
                    const id = chk.getAttribute('data-feature-id');
                    if (chk.checked) {
                        selectedFeatureIds.add(id);
                    } else {
                        selectedFeatureIds.delete(id);
                    }

                    selectedTierId = null;
                    tierButtons.forEach(b => { b.style.borderColor ='#e2e8f0'; b.style.background ='#fff'; });
                    renderTotal();
                });
            });

            renderTotal();
        },
        preConfirm: () => {
            const featureIds = selectedTierId
                ? tiers.find(t => t.id === selectedTierId).featureIds
                : Array.from(selectedFeatureIds);
            if (featureIds.length === 0) {
                Swal.showValidationMessage('Pumili muna ng isang package o kahit isang feature.');
                return false;
            }
            return { featureIds, tierId: selectedTierId };
        }
    });

    if (!result.isConfirmed || !result.value || !result.value.featureIds || result.value.featureIds.length === 0) return false;

    let demoWasActive = false;
    try {
        const demoStatusRes = await authFetch(`${API_URL}/features/demo-status`);
        const demoStatusData = await demoStatusRes.json();
        demoWasActive = !!(demoStatusData && demoStatusData.demoActive);
    } catch (e) {

        demoWasActive = false;
    }

    if (demoWasActive) {
        const endDemoConfirm = await Swal.fire({
            title:'End Demo & Purchase?',
            text:'This will end demo and make purchase?',
            icon:'warning',
            showCancelButton: true,
            confirmButtonText:'Yes',
            cancelButtonText:'No',
            confirmButtonColor:'#2563eb',
        });

        if (!endDemoConfirm.isConfirmed) return false;

        try {
            const endRes = await authFetch(`${API_URL}/features/end-demo`, { method:'POST' });
            const endData = await endRes.json();
            if (endData && endData.success && Array.isArray(endData.unlockedFeatureIds)) {
                unlockedFeatureIdsCache = endData.unlockedFeatureIds;
            }
            updateSidebarFeatureLocks();
            await initDemoModeUI();
        } catch (e) {

        }
    }

    return requestBulkUnlock(result.value.featureIds, result.value.tierId);
}

async function requestBulkUnlock(featureIds, tierId) {
    if (blockIfOffline('Bundle unlock requests')) return;
    const requestingUsername = (currentUser && (currentUser.username || currentUser.name)) ||'Unknown';

    try {
        const reqRes = await authFetch(`${API_URL}/features/request-unlock-bulk`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ featureIds, tierId: tierId || null, username: requestingUsername })
        });
        const reqData = await reqRes.json();

        if (!reqData.success) {
            showUnlockRequestError(reqData,'The bundle unlock request failed.');
            return false;
        }
        if (reqData.alreadyUnlocked) {
            await refreshUnlockedFeaturesFromServer();
            initDemoModeUI();
            Swal.fire('Already Unlocked!','Naka-unlock na ang lahat ng napili.','success');
            return true;
        }
        Swal.fire({
            icon:'info',
            title:'Request Sent',
            html: `An unlock request${reqData.totalPrice ? ` (₱${reqData.totalPrice} total)` :''} has been sent to the developer/store owner. Enter the code below once you receive it.`,
            timer: 2200,
            showConfirmButton: false
        });
    } catch (e) {
        Swal.fire('Error','Could not reach the server to send the unlock request.','error');
        return false;
    }

    const otpResult = await Swal.fire({
        title:'🔒 Verification Required',
        html: `<p style="font-size:0.85rem;color:#64748b;margin:0 0 4px;">Enter the 6-digit verification code sent to the developer/store owner to activate <strong>${featureIds.length} feature(s)</strong>.</p>`,
        input:'text',
        inputPlaceholder:'••••••',
        inputAttributes: { maxlength: 6, inputmode:'numeric', autocapitalize:'off', autocorrect:'off', style:'text-align:center; letter-spacing:4px; font-size:1.1rem;' },
        showCancelButton: true,
        confirmButtonText:'Verify Code',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#2563eb',
    });
    if (!otpResult.isConfirmed || !otpResult.value) return false;

    try {
        const confirmBody = { featureIds, otp: otpResult.value.trim(), username: requestingUsername };
        let confirmRes = await authFetch(`${API_URL}/features/confirm-unlock-bulk`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(confirmBody)
        });
        let confirmData = await confirmRes.json();

        if (confirmData.pending) {
            confirmData = await pollUntilApproved(`${API_URL}/features/confirm-unlock-bulk`, confirmBody);
        }

        if (confirmData.cancelled) return false;

        if (!confirmData.success) {
            Swal.fire('Incorrect Code', confirmData.message ||'Failed to verify the code.','error');
            return false;
        }

        if (Array.isArray(confirmData.unlockedFeatureIds)) {
            unlockedFeatureIdsCache = confirmData.unlockedFeatureIds;
        }
        updateSidebarFeatureLocks();
        initDemoModeUI();
        Swal.fire('Unlocked!', `${featureIds.length} feature(s) are now ready to use.`,'success');
        return true;
    } catch (e) {
        Swal.fire('Error','Could not reach the server to complete verification.','error');
        return false;
    }
}

let demoCountdownInterval = null;
const DEMO_FLOAT_POSITION_KEY ='omnipos_demo_float_pos';

function injectDemoFloatStyles() {
    if (document.getElementById('demo-float-styles')) return;
    const style = document.createElement('style');
    style.id ='demo-float-styles';
    style.textContent = `
        .demo-float {
            position: fixed;
            z-index: 99998;
            display: inline-flex;
            align-items: center;
            background: #2563eb;
            color: #fff;
            border-radius: 999px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            cursor: grab;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            padding: 9px;
            transition: box-shadow .15s ease, background-color .15s ease;
        }
        .demo-float.demo-float-active { background: #1e293b; }
        .demo-float.demo-float-dragging { cursor: grabbing; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
        .demo-float-icon { font-size: 1rem; line-height: 1; width: 18px; text-align: center; flex-shrink: 0; }
        .demo-float-label, .demo-float-end-btn {
            max-width: 0;
            opacity: 0;
            overflow: hidden;
            white-space: nowrap;
            font-size: 0.76rem;
            transition: max-width .2s ease, opacity .2s ease, margin-left .2s ease;
            margin-left: 0;
        }
        .demo-float:hover .demo-float-label,
        .demo-float:focus-within .demo-float-label {
            max-width: 220px;
            opacity: 1;
            margin-left: 8px;
        }
        .demo-float:hover .demo-float-end-btn.demo-float-end-enabled,
        .demo-float:focus-within .demo-float-end-btn.demo-float-end-enabled {
            max-width: 20px;
            opacity: 1;
            margin-left: 8px;
        }
        .demo-float-end-btn {
            background: rgba(255,255,255,0.18);
            border: none;
            color: #fff;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            padding: 0;
            cursor: pointer;
            flex-shrink: 0;
        }
        .demo-float-end-btn:not(.demo-float-end-enabled) { display: none; }
    `;
    document.head.appendChild(style);
}

function saveDemoFloatPosition(el) {
    try {
        const rect = el.getBoundingClientRect();
        localStorage.setItem(DEMO_FLOAT_POSITION_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
    } catch (e) {  }
}

function restoreDemoFloatPosition(el) {
    try {
        const raw = localStorage.getItem(DEMO_FLOAT_POSITION_KEY);
        if (!raw) return;
        const pos = JSON.parse(raw);
        if (typeof pos.x ==='number' && typeof pos.y ==='number') {
            const maxX = Math.max(0, window.innerWidth - 46);
            const maxY = Math.max(0, window.innerHeight - 46);
            el.style.left = Math.max(0, Math.min(maxX, pos.x)) +'px';
            el.style.top = Math.max(0, Math.min(maxY, pos.y)) +'px';
            el.style.right ='auto';
            el.style.bottom ='auto';
        }
    } catch (e) {  }
}

function makeDemoFloatDraggable(el) {
    if (el.dataset.dragBound) return;
    el.dataset.dragBound ='1';

    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;

    el.addEventListener('pointerdown', (e) => {
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = el.getBoundingClientRect();
        origX = rect.left;
        origY = rect.top;
        try { el.setPointerCapture(e.pointerId); } catch (err) {  }
        el.classList.add('demo-float-dragging');
    });

    el.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
        if (!moved) return;
        const maxX = Math.max(0, window.innerWidth - el.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - el.offsetHeight);
        const newX = Math.max(0, Math.min(maxX, origX + dx));
        const newY = Math.max(0, Math.min(maxY, origY + dy));
        el.style.left = newX +'px';
        el.style.top = newY +'px';
        el.style.right ='auto';
        el.style.bottom ='auto';
    });

    const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('demo-float-dragging');
        if (moved) {
            saveDemoFloatPosition(el);

            el.dataset.suppressClick ='1';
            setTimeout(() => { delete el.dataset.suppressClick; }, 50);
        }
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
}

function ensureDemoModeContainer() {
    injectDemoFloatStyles();
    let el = document.getElementById('demo-mode-banner-container');
    if (!el) {
        el = document.createElement('div');
        el.id ='demo-mode-banner-container';
        el.className ='demo-float demo-float-active';
        el.style.cssText +='top:8px;right:8px;';
        el.innerHTML =
            `<span id="demo-float-icon" class="demo-float-icon">🕒</span>` +
            `<span id="demo-float-label" class="demo-float-label"></span>` +
            `<button id="demo-float-end-btn" type="button" class="demo-float-end-btn" title="Tapusin ang Demo Mode ngayon">✕</button>`;
        document.body.appendChild(el);
        restoreDemoFloatPosition(el);
        makeDemoFloatDraggable(el);

        const endBtn = document.getElementById('demo-float-end-btn');
        if (endBtn) {

            endBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
            endBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                endDemoModeManually();
            });
        }
    }
    return el;
}

function formatDemoRemaining(ms) {
    if (ms <= 0) return'0h 0m 0s';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function ensureSidebarProBadge() {
    let el = document.getElementById('sidebar-pro-badge');
    if (!el) {
        const brand = document.querySelector('.sidebar-brand');
        if (!brand) return null;
        el = document.createElement('button');
        el.type ='button';
        el.id ='sidebar-pro-badge';
        el.className ='sidebar-pro-badge';
        el.innerHTML =
            `<span class="sidebar-pro-badge-text">PRO</span>` +
            `<i class="fa-solid fa-lock sidebar-pro-badge-icon"></i>`;
        brand.appendChild(el);
    }
    return el;
}

function renderSidebarProBadge(fullyPurchased, demoActive) {
    const el = ensureSidebarProBadge();
    if (!el) return;
    const showCrown = fullyPurchased || demoActive;
    const iconEl = el.querySelector('.sidebar-pro-badge-icon');
    el.classList.toggle('is-crown', showCrown);
    if (iconEl) {
        iconEl.className ='fa-solid sidebar-pro-badge-icon ' + (showCrown ?'fa-crown' :'fa-lock');
    }
    if (showCrown) {
        el.disabled = true;
        el.title = fullyPurchased ?'PRO — Fully Unlocked' :'PRO — Demo Mode Active';
        el.onclick = null;
    } else {
        el.disabled = false;
        el.title ='Try Full Demo';
        el.onclick = () => promptDemoMode();
    }
}

function renderDemoFloatWidget(status, fullyPurchased, demoActive) {
    if (demoCountdownInterval) { clearInterval(demoCountdownInterval); demoCountdownInterval = null; }

    if (fullyPurchased || !demoActive) {
        const existing = document.getElementById('demo-mode-banner-container');
        if (existing) existing.style.display ='none';
        return;
    }

    const container = ensureDemoModeContainer();
    container.style.display ='inline-flex';
    const labelEl = document.getElementById('demo-float-label');
    const endBtn = document.getElementById('demo-float-end-btn');

    const activeUser = JSON.parse(localStorage.getItem('posa_user') ||'null');
    const isAdminRole = ((activeUser && activeUser.role) ||'').toLowerCase() ==='admin';

    if (endBtn) endBtn.classList.toggle('demo-float-end-enabled', isAdminRole);

    const renderCountdown = () => {
        const remaining = status.demoExpiresAt - Date.now();
        if (remaining <= 0) {
            clearInterval(demoCountdownInterval);
            demoCountdownInterval = null;
            handleDemoExpired();
            return;
        }
        if (labelEl) labelEl.textContent = `Demo Mode — ${formatDemoRemaining(remaining)} left`;
    };
    renderCountdown();
    demoCountdownInterval = setInterval(renderCountdown, 1000);
}

// Tumatakbo kapag natapos na ang oras ng Demo Mode (live countdown na
// umabot sa 0). Agad na tinatanggal/sinasara ang demo widget, ibinabalik
// sa naka-lock/default state ang lahat ng features na hindi pa binili,
// at ino-auto-refresh ang buong system (full reload) para sigurado 100%
// na walang natitirang premium UI na naka-display mula sa expired demo.
function handleDemoExpired() {
    const existing = document.getElementById('demo-mode-banner-container');
    if (existing) existing.style.display ='none';

    if (window.Swal && typeof Swal.fire ==='function') {
        Swal.fire({
            toast: true,
            position:'top-end',
            icon:'info',
            title:'Natapos na ang Demo Mode',
            text:'Ire-refresh ang system...',
            showConfirmButton: false,
            timer: 1500,
            timerProgressBar: true,
        });
    }

    setTimeout(() => {
        window.location.reload();
    }, 1500);
}

function renderDemoModeUI(status) {
    const fullyPurchased = !!(status && status.fullyPurchased);
    const demoActive = !!(status && status.demoActive && status.demoExpiresAt);
    renderSidebarProBadge(fullyPurchased, demoActive);
    renderDemoFloatWidget(status, fullyPurchased, demoActive);
}

async function initDemoModeUI() {
    try {
        const res = await authFetch(`${API_URL}/features/demo-status`);
        const data = await res.json();
        renderDemoModeUI(data);
    } catch (e) {
        console.warn('Hindi makuha ang demo status.', e);
    }
}

async function endDemoModeManually() {
    const confirmResult = await Swal.fire({
        title:'Tapusin ang Demo Mode?',
        text:'Ibabalik agad sa naka-lock na state ang lahat ng premium features na dating bukas dahil sa demo. Hindi ito maaaring bawiin.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'End Demo',
        cancelButtonText:'Upgrade',
        confirmButtonColor:'#dc2626',
    });

    if (confirmResult.dismiss === Swal.DismissReason.cancel) {
        await showUpgradeTiersModal();
        return;
    }
    if (!confirmResult.isConfirmed) return;

    try {
        const res = await authFetch(`${API_URL}/features/end-demo`, { method:'POST' });
        const data = await res.json();
        if (!data.success) {
            Swal.fire('Hindi Natapos', data.message ||'May problema sa pagtapos ng Demo Mode.','error');
            return;
        }
        if (Array.isArray(data.unlockedFeatureIds)) {
            unlockedFeatureIdsCache = data.unlockedFeatureIds;
        }
        updateSidebarFeatureLocks();
        await initDemoModeUI();
        Swal.fire('Tapos na ang Demo Mode','Ibinalik na ang naka-lock na state.','success');
    } catch (e) {
        Swal.fire('Connection Error','Hindi makonekta sa server.','error');
    }
}

async function promptDemoMode() {
    if (blockIfOffline('Demo Mode activation requests')) return false;
    const requestingUsername = (currentUser && (currentUser.username || currentUser.name)) ||'Unknown';

    const confirmResult = await Swal.fire({
        title:'✨ Try Full Demo Mode',
        html:
'<p style="margin:0 0 8px;">Ma-a-unlock nang pansamantala ANG LAHAT ng premium features (walang nakalock) — may TIME LIMIT lang ito.</p>' +
'<p style="font-size:0.82rem;color:#94a3b8;margin:0;">Isang activation request ang ipapadala sa developer/store owner. Kapag na-approve, bibigyan ka ng 6-digit code para i-activate.</p>',
        icon:'info',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText:'Send Request',
        denyButtonText:'✨ See Upgrade Options',
        cancelButtonText:'Close',
        confirmButtonColor:'#2563eb',
        denyButtonColor:'#f59e0b',
    });
    if (confirmResult.isDenied) {
        await showUpgradeTiersModal();
        return false;
    }
    if (!confirmResult.isConfirmed) return false;

    try {
        const reqRes = await authFetch(`${API_URL}/features/request-demo`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ username: requestingUsername })
        });
        const reqData = await reqRes.json();

        if (!reqData.success) {
            showUnlockRequestError(reqData,'The demo request failed.');
            return false;
        }
        if (reqData.alreadyActive) {
            await refreshUnlockedFeaturesFromServer();
            await initDemoModeUI();
            Swal.fire('Aktibo na!','Aktibo na ang Demo Mode.','success');
            return true;
        }
        await Swal.fire({
            icon:'info',
            title:'Request Sent',
            html:'A demo activation request has been sent to the developer/store owner. Enter the code below once you receive it.',
            timer: 2200,
            showConfirmButton: false
        });
    } catch (e) {
        Swal.fire('Error','Could not reach the server to send the demo request.','error');
        return false;
    }

    const otpResult = await Swal.fire({
        title:'🔒 Verification Required',
        html:'<p style="font-size:0.85rem;color:#64748b;margin:0 0 4px;">Enter the 6-digit verification code sent to the developer/store owner to activate <strong>Demo Mode</strong>.</p>',
        input:'text',
        inputPlaceholder:'••••••',
        inputAttributes: { maxlength: 6, inputmode:'numeric', autocapitalize:'off', autocorrect:'off', style:'text-align:center; letter-spacing:4px; font-size:1.1rem;' },
        showCancelButton: true,
        confirmButtonText:'Verify Code',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#2563eb',
    });
    if (!otpResult.isConfirmed || !otpResult.value) return false;

    try {
        const confirmBody = { otp: otpResult.value.trim(), username: requestingUsername };
        let confirmRes = await authFetch(`${API_URL}/features/confirm-demo`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(confirmBody)
        });
        let confirmData = await confirmRes.json();

        if (confirmData.pending) {
            confirmData = await pollUntilApproved(`${API_URL}/features/confirm-demo`, confirmBody);
        }

        if (confirmData.cancelled) return false;

        if (!confirmData.success) {
            Swal.fire('Incorrect Code', confirmData.message ||'Failed to verify the code.','error');
            return false;
        }

        if (Array.isArray(confirmData.unlockedFeatureIds)) {
            unlockedFeatureIdsCache = confirmData.unlockedFeatureIds;
        }
        updateSidebarFeatureLocks();
        await initDemoModeUI();
        Swal.fire('Demo Mode Activated!','Lahat ng features ay bukas na — pansamantala lang ito, may time limit.','success');
        return true;
    } catch (e) {
        Swal.fire('Error','Could not reach the server to complete verification.','error');
        return false;
    }
}

async function requestDeveloperSupportAccess() {
    const confirmResult = await Swal.fire({
        title:'🛟 Emergency Developer Support Access',
        html:
'<p style="margin:0 0 8px;font-size:0.9rem;">This will send a one-time verification code to the developer\'s registered email.</p>' +
'<p style="font-size:0.82rem;color:#94a3b8;margin:0 0 8px;">Once verified, <strong>this account</strong> will be temporarily granted ' +
'<strong>administrator-level access</strong> for troubleshooting — automatically for up to 30 minutes, or until you log out, whichever ' +
'comes first. This request and grant are recorded in the system log.</p>' +
'<p style="font-size:0.82rem;color:#94a3b8;margin:0;">Use this only for genuine emergencies (e.g. the Admin account/password is not available).</p>',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Send Verification Code',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#2563eb',
    });
    if (!confirmResult.isConfirmed) return;

    try {
        const reqRes = await authFetch(`${API_URL}/support-access/request`, { method:'POST' });
        const reqData = await reqRes.json();
        if (!reqData.success) {
            Swal.fire('Request Not Sent', reqData.message ||'The support-access request failed.','error');
            return;
        }
    } catch (e) {
        Swal.fire('Error','Could not reach the server to send the support-access request.','error');
        return;
    }

    const otpResult = await Swal.fire({
        title:'🔒 Verification Required',
        html:'<p style="font-size:0.85rem;color:#64748b;margin:0 0 4px;">' +
'Enter the 6-digit verification code the developer received by email to activate <strong>Emergency Developer Support Access</strong>.</p>',
        input:'text',
        inputPlaceholder:'••••••',
        inputAttributes: { maxlength: 6, inputmode:'numeric', autocapitalize:'off', autocorrect:'off', style:'text-align:center; letter-spacing:4px; font-size:1.1rem;' },
        showCancelButton: true,
        confirmButtonText:'Verify Code',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#2563eb',
    });
    if (!otpResult.isConfirmed || !otpResult.value) return;

    try {
        const confirmRes = await authFetch(`${API_URL}/support-access/confirm`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ otp: otpResult.value.trim() })
        });
        const confirmData = await confirmRes.json();

        if (!confirmData.success) {
            Swal.fire('Incorrect Code', confirmData.message ||'Failed to verify the code.','error');
            return;
        }

        applyTemporarySupportAccess(confirmData.permissions, confirmData.expiresAt);
        Swal.fire('Access Granted','Temporary administrator-level access is now active for troubleshooting. It will automatically expire in 30 minutes or when you log out.','success');
    } catch (e) {
        Swal.fire('Error','Could not reach the server to complete verification.','error');
    }
}

function applyTemporarySupportAccess(permissions, expiresAt) {
    if (!currentUser) return;

    if (!currentUser._supportAccessOriginalRole) {
        currentUser._supportAccessOriginalRole = currentUser.role;
    }
    currentUser.role ='admin';
    currentUser._supportAccessExpiresAt = expiresAt;
    localStorage.setItem('posa_user', JSON.stringify(currentUser));

    currentPermissions = permissions || {};
    localStorage.setItem('posa_permissions', JSON.stringify(currentPermissions));
    if (typeof applyRoleBasedAccessControls ==='function') {
        applyRoleBasedAccessControls(currentUser.role);
    }

    const roleLabelEl = document.getElementById('session-user-role');
    if (roleLabelEl) roleLabelEl.textContent ='Developer Support (temporary)';

    if (supportAccessRevertTimer) clearTimeout(supportAccessRevertTimer);
    const msRemaining = Math.max(0, expiresAt - Date.now());
    supportAccessRevertTimer = setTimeout(revertTemporarySupportAccess, msRemaining);
}

async function revertTemporarySupportAccess() {
    if (!currentUser || !currentUser._supportAccessOriginalRole) return;

    currentUser.role = currentUser._supportAccessOriginalRole;
    delete currentUser._supportAccessOriginalRole;
    delete currentUser._supportAccessExpiresAt;
    localStorage.setItem('posa_user', JSON.stringify(currentUser));

    const roleLabelEl = document.getElementById('session-user-role');
    if (roleLabelEl) roleLabelEl.textContent = currentUser.role;

    if (typeof refreshPermissions ==='function') {
        await refreshPermissions();
    }

    Swal.fire({ title:'Support Access Expired', text:'Temporary Developer Support Access has ended. Your permissions have reverted to normal.', icon:'info', timer: 4000, showConfirmButton: false });
}

document.addEventListener("DOMContentLoaded", () => {

    setupDropdownHandlers();
    initDarkMode();
    refreshUnlockedThemesFromServer();
    refreshUnlockedFeaturesFromServer();
    initDemoModeUI();
    initNetworkStatusIndicator();
    initInstallAppBanner();
    initAuthDeviceScaling();

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.addEventListener('click', (event) => {

            const isClickableItem = event.target.closest('a') || event.target.closest('button');

            if (isClickableItem) {
                closeSidebarMenu();
            }
        });
    }

    const prodForm = document.getElementById('product-schema-form');
    if(prodForm) prodForm.addEventListener('submit', handleProductFormSubmit);

const categorySelect = document.getElementById('p-form-category');
if (categorySelect) {
    categorySelect.addEventListener('change', async function() {
        if (this.value ==='ADD_NEW_CATEGORY') {
            const { value: newCategory } = await Swal.fire({
                title:'Enter New Category Name',
                input:'text',
                inputPlaceholder:'Category name...',
                showCancelButton: true,
                confirmButtonColor:'#2563eb',
                cancelButtonColor:'#64748b'
            });

            if (newCategory && newCategory.trim() !=="") {
                const cleanCategory = newCategory.trim();

                try {
                    const response = await authFetch(`${API_URL}/categories`, {
                        method:'POST',
                        headers: {'Content-Type':'application/json' },
                        body: JSON.stringify({ category: cleanCategory })
                    });
                    const data = await response.json();

                    if (data.success) {
                        customCategories = data.categories;
                        updateDropdownCategoriesDynamic();
                        this.value = cleanCategory;
                    } else {
                        Swal.fire('Error',"Classification entry write failure: " + data.message,'error');
                    }
                } catch (err) {
                    console.error("Error saving category:", err);
                    Swal.fire('System Pipeline Fault','Unable to write data changes to server database registers.','error');
                }
            } else {
                this.selectedIndex = 0;
            }
        }
    });
}

    const userForm = document.getElementById('user-schema-form');
    if(userForm) userForm.addEventListener('submit', handleUserFormSubmit);

    if (currentUser) {
        showMainSystemInterface();
    } else {
        showAuthenticationInterface();
    }

});

async function guardShiftReportAccess(isAdminOrSupervisor) {

    const token = localStorage.getItem('posa_token');
    try {
        const res = await window.fetch(`${API_URL}/shift/current`, {
            headers: token ? {'Authorization': `Bearer ${token}` } : {}
        });
        const data = await res.json();
        if (data && data.success) {

            switchView('shiftreport', { skipFeatureGate: true });
            return;
        }
    } catch (e) {  }

    if (isAdminOrSupervisor) {

        switchView('shiftreport', { skipFeatureGate: true });
        return;
    }

    guardPremiumFeature('shift_management');
}

function switchView(viewKey, opts) {
    opts = opts || {};

    // FIX: tanggalin ang "data-preload-view" attribute (idinagdag ng maagang
    // pre-paint script sa index.html para maiwasan ang overview-flash bago
    // pa mag-restore ng tamang view sa refresh — tingnan ang comment doon).
    // Gumagamit ang CSS na iyon ng !important para mangibabaw sa paunang
    // inline display:none ng bawat .app-view section, kaya kailangang
    // alisin ito dito, sa MISMONG unang totoong pagtawag ng switchView(),
    // para hindi na permanenteng naka-force-visible (o naka-force-hidden)
    // ang alinmang section sa mga susunod na navigation ng user. No-op ito
    // kung wala namang na-set na attribute (hal. bagong login, walang
    // saved view), kaya ligtas itong laging tawagin dito.
    document.documentElement.removeAttribute('data-preload-view');

    if (viewKey !=='users' && typeof closeGoogleAppVerificationFloatingBox ==='function') {
        closeGoogleAppVerificationFloatingBox();
    }

    if (typeof closeUserWidgetMenu ==='function') closeUserWidgetMenu();
    if (typeof closeAllSidebarMenuDropdowns ==='function') closeAllSidebarMenuDropdowns();
    if (typeof closeAllResetRestoreCards ==='function') closeAllResetRestoreCards();

    const activeUser = JSON.parse(localStorage.getItem('posa_user') ||'null');
    const userRole = (activeUser && activeUser.role ||'').toLowerCase();
    const isAdmin = userRole ==='admin';
    if (!isAdmin && Object.prototype.hasOwnProperty.call(currentPermissions || {}, viewKey) && !currentPermissions[viewKey]) {
        console.warn(`[OmniPOS] Access denied to view "${viewKey}" for role "${userRole ||'unknown'}"`);
        viewKey ='overview';
    }

    const VIEW_FEATURE_MAP = { customers:'customer_crm', shiftreport:'shift_management', reports:'advanced_reports', reorder:'purchase_orders' };
    if (!opts.skipFeatureGate && VIEW_FEATURE_MAP[viewKey] && !isFeatureUnlockedCached(VIEW_FEATURE_MAP[viewKey])) {
        if (viewKey ==='shiftreport') {
            guardShiftReportAccess(isAdmin);
            return;
        }
        guardPremiumFeature(VIEW_FEATURE_MAP[viewKey]);
        return;
    }

    document.querySelectorAll('.app-view').forEach(view => view.style.display ='none');
    document.querySelectorAll('.menu-item, .sub-menu-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(item => item.classList.remove('active'));

    const targetView = document.getElementById(`view-${viewKey}`);
    // NOTE: sadyang hindi na "style.display = 'block'" ang ginagamit dito.
    // Inaalis lang ang inline override (kung meron man, hal. ang
    // "display:none" na kasusalin lang sa itaas) para ang CSS mismo ang
    // magpasya ng tamang display value ng view na ito — "flex" para sa
    // #view-logs/#view-barcode (tingnan ang ID-scoped rule sa style.css,
    // display na wala nang !important doon), o "block" bilang default sa
    // ibang .app-view. Kasabay nito, tinanggal na rin ang !important sa
    // "display" ng CSS rule na iyon, para hindi na palaging manalo ang
    // CSS kahit "display:none" na ang inilagay dito ng JS pagtatago —
    // dating hindi natatago kahit kailan ang #view-logs/#view-barcode
    // dahil dito.
    if (targetView) targetView.style.removeProperty('display');

    const targetMenu = document.getElementById(`menu-${viewKey}`);
    if (targetMenu) targetMenu.classList.add('active');

    const bottomNavMap = { dashboard:'products', barcode:'products', reorder:'products' };
    const bottomNavKey = bottomNavMap[viewKey] || viewKey;
    const targetBottomNav = document.getElementById(`bn-${bottomNavKey}`);
    if (targetBottomNav) targetBottomNav.classList.add('active');

    if (window.innerWidth <= 1024) {
        document.getElementById('app-sidebar').classList.remove('open');
    }

    const topHeaderEl = document.getElementById('app-top-header');
    if (topHeaderEl) {
        topHeaderEl.classList.toggle('terminal-header-mode', viewKey ==='terminal');
    }

    const bottomNavEl = document.getElementById('app-bottom-nav');
    if (bottomNavEl) {
        bottomNavEl.classList.toggle('bottom-nav-hidden', viewKey ==='terminal');
    }

    if (viewKey ==='overview') {
        console.log("Dashboard menu clicked! Forcing data refresh from server/database...");
        renderOverviewGreeting();
        if (typeof replayOverviewEntranceAnimation ==='function') {
            replayOverviewEntranceAnimation();
        }
        if (typeof loadDashboardMetrics ==='function') {
            loadDashboardMetrics();
        }
    }  if (viewKey ==='terminal') { loadTerminalCatalog(); checkShiftOpeningCashGate(); startTerminalStockPolling(); } else { stopTerminalStockPolling(); }

    if (viewKey ==='products') { startInventoryStockPolling(); } else { stopInventoryStockPolling(); }

    if (viewKey ==='reorder') { startReorderPolling(); } else { stopReorderPolling(); }

    const daymodeBtn = document.getElementById('terminal-daymode-btn');
    if (daymodeBtn) {
        if (viewKey ==='terminal') {
            daymodeBtn.style.display ='inline-flex';
            applySavedTerminalDayMode();
        } else {
            daymodeBtn.style.display ='none';
        }
    }
    if (viewKey ==='products') loadInventoryProductsTable();
    if (viewKey ==='barcode') loadBarcodeGeneratorModule();
    if (viewKey ==='reports') {
        loadSalesAnalyticsReport();
        checkAdminResetVisibility();
    }

    if (viewKey ==='transactions') {
        loadTransactionsHistory();
        applyResponsiveRecoveryCardState();
    }
    if (viewKey ==='users') { loadUsersTable(); loadPendingRequestsTable(); loadRolesPermissionMatrix(); updateUsersTabVisibility(); }
    if (viewKey ==='logs') loadSystemAuditLogs();
    if (viewKey ==='customers') loadCustomersView();
    if (viewKey ==='shiftreport') loadShiftReportView();
    if (viewKey ==='reorder') loadReorderView();
    sessionStorage.setItem('currentView', viewKey);

    if (!history.state || history.state.view !== viewKey) {
        history.pushState({ view: viewKey },'','');
    }

    updateResponsivePageTitle();
}

const MOBILE_HEADER_TITLE_MAP = {
    dashboard:    { text:'Dashboard',           hideIds: ['dashboard-title-row'] },
    products:     { text:'Products',            hideIds: ['page-title-products'] },
    barcode:      { text:'Barcode Generator',   hideIds: ['page-title-barcode'] },
    reorder:      { text:'Reorder Alerts',      hideIds: ['page-title-reorder'] },
    reports:      { text:'Sales Analytics',     hideIds: ['page-title-reports'] },
    transactions: { text:'Transaction',         hideIds: ['page-title-transactions'] },
    customers:    { text:'Customers',           hideIds: ['page-title-customers'] },
    shiftreport:  { text:'Shift / Z-Reading',   hideIds: ['page-title-shiftreport'] },
    logs:         { text:'System Audit Logs',   hideIds: ['page-title-logs'] },
    faq:          { text:'FAQ',                 hideIds: ['page-title-faq'] }
};

function isMobileOrTabletScreen() {
    return window.innerWidth <= 1024;
}

function updateResponsivePageTitle() {
    const headerTitleEl = document.getElementById('header-page-title');
    if (!headerTitleEl) return;

    const viewKey = sessionStorage.getItem('currentView') ||'overview';
    const config = MOBILE_HEADER_TITLE_MAP[viewKey];
    const shouldUseHeaderTitle = isMobileOrTabletScreen() && !!config;

    Object.values(MOBILE_HEADER_TITLE_MAP).forEach(cfg => {
        cfg.hideIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display ='';
        });
    });

    if (shouldUseHeaderTitle) {
        headerTitleEl.textContent = config.text;
        headerTitleEl.classList.add('active-title');
        config.hideIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display ='none';
        });

        const w = window.innerWidth;
        let fontSize;
        if (w <= 380) fontSize ='1.45rem';
        else if (w <= 480) fontSize ='1.32rem';
        else if (w <= 768) fontSize ='1.38rem';
        else fontSize ='1.57rem';
        headerTitleEl.style.fontSize = fontSize;
    } else {
        headerTitleEl.textContent ='';
        headerTitleEl.classList.remove('active-title');
        headerTitleEl.style.fontSize ='';
    }
}

let _responsiveTitleResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(_responsiveTitleResizeTimer);
    _responsiveTitleResizeTimer = setTimeout(updateResponsivePageTitle, 120);
});

// ===== Reset/Restore Panel — Shrinkable (collapsible) cards =====
// Lahat ng card sa loob ng #reset-restore-panel (maliban sa RESTRICTED
// ACCESS warning banner, na hindi collapsible) ay puwedeng i-tap para
// mag-expand/collapse. Dalawa (2) lang ang puwedeng nakabukas nang
// sabay-sabay — kapag binuksan ang ikatlo, awtomatikong sasara ang
// pinaka-unang binuksan (FIFO) para hindi mag-crowd ang panel.
let _rrOpenCardOrder = [];

function toggleResetRestoreCard(headerEl) {
    const card = headerEl.closest('.rr-card');
    if (!card) return;
    const cardId = card.getAttribute('data-rr-card');

    if (card.classList.contains('rr-open')) {
        // Isara ang na-tap na card
        card.classList.remove('rr-open');
        _rrOpenCardOrder = _rrOpenCardOrder.filter(id => id !== cardId);
        return;
    }

    // Buksan ang na-tap na card
    card.classList.add('rr-open');
    _rrOpenCardOrder.push(cardId);

    // Max 2 lang ang puwedeng bukas — isara ang pinaka-unang binuksan
    // kapag lumampas na sa dalawa.
    if (_rrOpenCardOrder.length > 2) {
        const oldestId = _rrOpenCardOrder.shift();
        const oldestCard = document.querySelector(`.rr-card[data-rr-card="${oldestId}"]`);
        if (oldestCard) oldestCard.classList.remove('rr-open');
    }
}

function closeAllResetRestoreCards() {
    document.querySelectorAll('#reset-restore-panel .rr-card.rr-open').forEach(card => {
        card.classList.remove('rr-open');
    });
    _rrOpenCardOrder = [];
}

function toggleRecoveryCard() {
    const card = document.querySelector('.recovery-inner-card');
    if (!card) return;
    card.classList.toggle('rc-expanded');
}

function applyResponsiveRecoveryCardState() {
    const card = document.querySelector('.recovery-inner-card');
    if (!card) return;
    if (isMobileOrTabletScreen()) {
        card.classList.remove('rc-expanded');
    } else {
        card.classList.add('rc-expanded');
    }
}

window.addEventListener('resize', () => {
    clearTimeout(_responsiveRecoveryCardResizeTimer);
    _responsiveRecoveryCardResizeTimer = setTimeout(applyResponsiveRecoveryCardState, 120);
});
let _responsiveRecoveryCardResizeTimer = null;

let globalCustomers = [];

async function loadCustomersView() {
    try {
        const res = await authFetch(`${API_URL}/customers`);
        globalCustomers = res.ok ? await res.json() : [];
    } catch (e) {
        console.warn('Hindi makuha ang customers:', e);
        globalCustomers = [];
    }
    renderCustomersTable();
}

function renderCustomersTable() {
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;
    const searchEl = document.getElementById('customer-search-input');
    const q = (searchEl ? searchEl.value :'').trim().toLowerCase();

    const filtered = globalCustomers.filter(c =>
        !q || (c.name ||'').toLowerCase().includes(q) || (c.phone ||'').includes(q) || (c.email ||'').toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">Walang customer na natagpuan.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(c => `
        <tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.phone ||'—')}</td>
            <td>${escapeHtml(c.email ||'—')}</td>
            <td class="num-cell">${c.points || 0} pts</td>
            <td class="num-cell">₱${(parseFloat(c.totalSpent) || 0).toFixed(2)}</td>
            <td class="num-cell">${c.visits || 0}</td>
            <td>
                <button class="btn-icon-action edit" onclick="openEditCustomerForm('${escapeHtml(c.id)}')" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn-icon-action delete" onclick="deleteCustomerConfirm('${escapeHtml(c.id)}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function openAddCustomerForm() {
    const { value: formValues } = await Swal.fire({
        title:'Add Customer',
        html: `
            <input type="text" id="swal-cust-name" class="swal2-input" placeholder="Buong Pangalan">
            <input type="text" id="swal-cust-phone" class="swal2-input" placeholder="Phone Number (optional)">
            <input type="email" id="swal-cust-email" class="swal2-input" placeholder="Email (optional)">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText:'Save Customer',
        preConfirm: () => {
            const name = document.getElementById('swal-cust-name').value.trim();
            if (!name) {
                Swal.showValidationMessage('Kailangan ng pangalan.');
                return false;
            }
            return {
                name,
                phone: document.getElementById('swal-cust-phone').value.trim(),
                email: document.getElementById('swal-cust-email').value.trim()
            };
        }
    });
    if (!formValues) return;

    try {
        const res = await authFetch(`${API_URL}/customers`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(formValues)
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'Naidagdag ang Customer!', timer: 1300, showConfirmButton: false });
            loadCustomersView();
        } else {
            Swal.fire('Error', data.message ||'Hindi na-save ang customer.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Hindi makonekta sa server.','error');
    }
}

async function openEditCustomerForm(id) {
    const cust = globalCustomers.find(c => c.id === id);
    if (!cust) return;

    const { value: formValues } = await Swal.fire({
        title:'Edit Customer',
        html: `
            <input type="text" id="swal-cust-name" class="swal2-input" placeholder="Buong Pangalan" value="${escapeHtml(cust.name)}">
            <input type="text" id="swal-cust-phone" class="swal2-input" placeholder="Phone Number" value="${escapeHtml(cust.phone ||'')}">
            <input type="email" id="swal-cust-email" class="swal2-input" placeholder="Email" value="${escapeHtml(cust.email ||'')}">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText:'Update',
        preConfirm: () => ({
            name: document.getElementById('swal-cust-name').value.trim(),
            phone: document.getElementById('swal-cust-phone').value.trim(),
            email: document.getElementById('swal-cust-email').value.trim()
        })
    });
    if (!formValues) return;

    try {
        const res = await authFetch(`${API_URL}/customers/${encodeURIComponent(id)}`, {
            method:'PUT',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(formValues)
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'Na-update!', timer: 1200, showConfirmButton: false });
            loadCustomersView();
        } else {
            Swal.fire('Error', data.message ||'Hindi na-update.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Hindi makonekta sa server.','error');
    }
}

async function deleteCustomerConfirm(id) {
    const cust = globalCustomers.find(c => c.id === id);
    const result = await Swal.fire({
        title: `Burahin si ${cust ? cust.name :'customer na ito'}?`,
        text:'Hindi na maibabalik ang aksyon na ito.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Oo, burahin'
    });
    if (!result.isConfirmed) return;

    try {
        const res = await authFetch(`${API_URL}/customers/${encodeURIComponent(id)}`, { method:'DELETE' });
        const data = await res.json();
        if (data.success) {
            loadCustomersView();
        } else {
            Swal.fire('Error', data.message ||'Hindi na-delete.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Hindi makonekta sa server.','error');
    }
}

let myShiftLockedState = null;

async function checkShiftOpeningCashGate() {

    if (!isFeatureUnlockedCached('shift_management')) return;
    try {
        const res = await authFetch(`${API_URL}/shift/current`);
        const data = await res.json();
        if (!data.success) return;
        if (data.beginningCashLocked) {
            myShiftLockedState = true;
            return;
        }

        const { value: amount, isConfirmed } = await Swal.fire({
            title:'Beginning Cash Float',
            html:'Enter the amount of cash in the drawer before starting the shift. This will be locked once submitted.',
            input:'number',
            inputAttributes: { min: 0, step:'0.01', placeholder:'0.00' },
            allowOutsideClick: false,
            allowEscapeKey: false,
            showCancelButton: true,
            cancelButtonText:'Close',
            confirmButtonText:'Lock Beginning Cash',
            inputValidator: (value) => {
                if (value ==='' || value === null || isNaN(value) || parseFloat(value) < 0) {
                    return'A valid amount is required (0 or greater).';
                }
            }
        });

        if (!isConfirmed) {
            switchView('overview');
            return;
        }

        if (amount === undefined) return;

        const res2 = await authFetch(`${API_URL}/shift/open-cash`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ beginningCash: amount })
        });
        const data2 = await res2.json();
        if (!data2.success) {

            Swal.fire('Unable to Set', data2.message ||'There was a problem setting the Beginning Cash.','warning');
        }
        myShiftLockedState = true;
        loadShiftReportView();
    } catch (e) {
        console.warn('Hindi ma-check ang beginning cash gate:', e);
    }
}

let shiftControlSelectedCashier ='';

async function loadShiftOpenListPicker() {
    const selectEl = document.getElementById('shift-close-target-cashier');
    if (!selectEl) return;
    try {
        const res = await authFetch(`${API_URL}/shift/open-list`);
        const data = await res.json();
        if (!data.success) return;

        const activeUser = JSON.parse(localStorage.getItem('posa_user') ||'null');
        const myUsername = (activeUser && activeUser.username) ||'';
        const previousSelection = shiftControlSelectedCashier;

        const options = ['<option value="">— Sariling Shift Ko —</option>'].concat(
            (data.openShifts || [])
                .filter(o => o.username.toLowerCase() !== myUsername.toLowerCase())
                .map(o => `<option value="${escapeHtml(o.username)}">${escapeHtml(o.username)} (Beginning Cash: ₱${(parseFloat(o.beginningCash) || 0).toFixed(2)})</option>`)
        );
        selectEl.innerHTML = options.join('');

        const stillExists = Array.from(selectEl.options).some(o => o.value === previousSelection);
        selectEl.value = stillExists ? previousSelection :'';
        shiftControlSelectedCashier = selectEl.value;
    } catch (e) {
        console.warn('Hindi makuha ang listahan ng mga bukas na shift:', e);
    }
}

function onShiftCloseTargetCashierChange() {
    const selectEl = document.getElementById('shift-close-target-cashier');
    shiftControlSelectedCashier = selectEl ? selectEl.value :'';
    loadShiftReportView();
}

async function loadShiftReportView() {

    const activeUser = JSON.parse(localStorage.getItem('posa_user') ||'null');
    const isAdmin = ((activeUser && activeUser.role) ||'').toLowerCase() ==='admin';
    const canViewAmounts = isAdmin || !!(currentPermissions && currentPermissions.shiftreport_view_amounts);
    const canControlOtherShifts = isAdmin || !!(currentPermissions && currentPermissions.shift_close_control);
    ['shift-gross-card','shift-discount-card','shift-net-card'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = canViewAmounts ?'' :'none';
    });
    const breakdownContainer = document.getElementById('shift-payment-breakdown-container');
    if (breakdownContainer) breakdownContainer.style.display = canViewAmounts ?'' :'none';

    const controlPanel = document.getElementById('shift-close-control-panel');
    if (controlPanel) controlPanel.style.display = canControlOtherShifts ?'' :'none';
    if (canControlOtherShifts) {
        await loadShiftOpenListPicker();
    } else {
        shiftControlSelectedCashier ='';
    }

    const targetQuery = shiftControlSelectedCashier ? `?cashier=${encodeURIComponent(shiftControlSelectedCashier)}` :'';
    const closeNoticeEl = document.getElementById('shift-close-target-notice');

    try {
        const res = await authFetch(`${API_URL}/shift/current${targetQuery}`);
        const data = await res.json();
        if (data.success) {
            const s = data.summary;
            document.getElementById('shift-tx-count').innerText = s.transactionCount;
            if (canViewAmounts && s.grossSales !== undefined) {
                document.getElementById('shift-gross').innerText = `₱${s.grossSales.toFixed(2)}`;
                document.getElementById('shift-discount').innerText = `₱${s.totalDiscount.toFixed(2)}`;
                document.getElementById('shift-net').innerText = `₱${s.netSales.toFixed(2)}`;
            }

            if (closeNoticeEl) {
                closeNoticeEl.innerHTML = data.viewingOtherCashier
                    ? `<i class="fa-solid fa-user-shield"></i> Tinitingnan/isasara mo ang shift ni <b>${escapeHtml(data.cashier)}</b> (Admin/Supervisor Control).`
                    :'';
            }

            const beginInput = document.getElementById('shift-beginning-cash');
            if (beginInput) {
                beginInput.value = (data.beginningCash !== null && data.beginningCash !== undefined)
                    ? data.beginningCash.toFixed(2)
                    :'';
                beginInput.readOnly = true;
            }

            const listEl = document.getElementById('shift-payment-breakdown-list');
            if (listEl) {
                if (!canViewAmounts) {
                    listEl.innerHTML ='';
                } else {
                    const methods = Object.keys(s.paymentBreakdown || {});
                    listEl.innerHTML = methods.length
                        ? methods.map(m => `<li>${escapeHtml(m)}: ${s.paymentBreakdown[m].count} tx — ₱${s.paymentBreakdown[m].total.toFixed(2)}</li>`).join('')
                        :'<li style="color:#94a3b8;">Wala pang transaksyon sa open shift na ito.</li>';
                }
            }
        }
    } catch (e) {
        console.warn('Hindi makuha ang current shift summary:', e);
    }

    try {
        const resHist = await authFetch(`${API_URL}/shifts`);
        if (resHist.ok) {
            const history = await resHist.json();

            const tbody = document.getElementById('shift-history-table-body');
            if (tbody) {
                tbody.innerHTML = history.length
                    ? history.map(h => {
                        let varianceCell ='<span style="color:#94a3b8;">—</span>';
                        if (h.cashVariance !== null && h.cashVariance !== undefined) {
                            const v = parseFloat(h.cashVariance) || 0;
                            if (v < 0) varianceCell = `<span style="color:#dc2626; font-weight:600;">Short ₱${Math.abs(v).toFixed(2)}</span>`;
                            else if (v > 0) varianceCell = `<span style="color:#16a34a; font-weight:600;">Over ₱${v.toFixed(2)}</span>`;
                            else varianceCell = `<span style="color:#16a34a;">Exact</span>`;
                        }
                        const cashSalesVal = (parseFloat(h.cashSales) || 0).toFixed(2);
                        const expectedVal = (parseFloat(h.expectedCash) || 0).toFixed(2);
                        const beginVal = (parseFloat(h.beginningCash) || 0).toFixed(2);
                        const endVal = h.endingCashCounted !== null && h.endingCashCounted !== undefined ? parseFloat(h.endingCashCounted).toFixed(2) :'—';
                        return `
                        <tr>
                            <td>${escapeHtml(h.id)}</td>
                            <td>${escapeHtml(h.closedBy)}</td>
                            <td>${new Date(h.periodStart).toLocaleString()} - ${new Date(h.periodEnd).toLocaleString()}</td>
                            <td class="num-cell">${h.transactionCount}${h.noSalesShift ? '<br><span style="font-size:0.72rem; color:#94a3b8;">(Walang Benta - Handover)</span>' :''}</td>
                            <td class="num-cell">₱${(parseFloat(h.netSales) || 0).toFixed(2)}</td>
                            <td class="num-cell" title="Begin ₱${beginVal} + Cash Sales ₱${cashSalesVal} = Expected ₱${expectedVal} | Counted ₱${endVal}">${varianceCell}</td>
                        </tr>`;
                    }).join('')
                    : `<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8;">Wala pang naisarang shift.</td></tr>`;
            }
        }
    } catch (e) {
        console.warn('Hindi makuha ang shift history:', e);
    }
}

async function closeCurrentShift() {

    const endingCashCounted = document.getElementById('shift-ending-cash').value;
    const notes = document.getElementById('shift-close-notes').value;

    const targetCashier = shiftControlSelectedCashier ||'';

    const confirmResult = await Swal.fire({
        title:'Isara ang Shift?',
        text: targetCashier
            ? `Isasara mo ang shift ni "${targetCashier}" (Admin/Supervisor Control). Magsisimula ang bagong shift period niya pagkatapos nito. Hindi na ito maaaring bawiin.`
            :'Magsisimula ang bagong shift period pagkatapos nito. Hindi na ito maaaring bawiin.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Oo, isara ang shift'
    });
    if (!confirmResult.isConfirmed) return;

    try {
        const res = await authFetch(`${API_URL}/shift/close`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ endingCashCounted, notes, targetCashier })
        });
        const data = await res.json();
        if (data.success) {
            let varianceMsg ='';
            if (data.shift.cashVariance !== null && data.shift.cashVariance !== undefined) {
                const v = data.shift.cashVariance;
                if (v < 0) varianceMsg = `<br><br><b style="color:#dc2626;">Cash Short: ₱${Math.abs(v).toFixed(2)}</b>`;
                else if (v > 0) varianceMsg = `<br><br><b style="color:#16a34a;">Cash Over: ₱${v.toFixed(2)}</b>`;
                else varianceMsg = `<br><br><b style="color:#16a34a;">Cash Exact — walang kulang o sobra.</b>`;
            }
            Swal.fire({ title:'Naisara ang Shift!', html: `Z-Reading ID: ${data.shift.id}${varianceMsg}`, icon:'success' });
            document.getElementById('shift-beginning-cash').value ='';
            document.getElementById('shift-ending-cash').value ='';
            document.getElementById('shift-close-notes').value ='';
            loadShiftReportView();
        } else {
            Swal.fire('Hindi Ma-close', data.message ||'May problema sa pagsara ng shift.','warning');
        }
    } catch (e) {
        Swal.fire('Connection Error','Hindi makonekta sa server.','error');
    }
}

async function openPromoCodesManager() {
    if (guardPremiumFeature('promo_codes')) return;
    let promos = [];
    try {
        const res = await authFetch(`${API_URL}/promocodes`);
        promos = res.ok ? await res.json() : [];
    } catch (e) {
        Swal.fire('Connection Error','Hindi makuha ang promo codes.','error');
        return;
    }
    renderPromoCodesModal(promos);
}

function renderPromoCodesModal(promos) {
    const rowsHtml = promos.length ? promos.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid #eee;text-align:left;">
            <div>
                <strong>${escapeHtml(p.code)}</strong> ${p.active ?'' :'<span style="color:#ef4444;font-size:0.75rem;">(INACTIVE)</span>'}<br>
                <small>${p.type ==='percent' ? p.value +'% off' :'₱' + p.value +' off'}${p.minSpend ?' · min ₱' + p.minSpend :''}${p.expiresAt ?' · exp ' + new Date(p.expiresAt).toLocaleDateString() :''}</small>
            </div>
            <div>
                <button class="btn-icon-action delete" onclick="deletePromoCodeConfirm('${escapeHtml(p.code)}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `).join('') :'<p style="padding:14px;color:#94a3b8;">Wala pang promo code.</p>';

    Swal.fire({
        title:'Discounts & Promo Codes',
        html: `
            <div style="max-height:280px;overflow-y:auto;margin-bottom:10px;">${rowsHtml}</div>
            <button type="button" class="swal2-confirm swal2-styled" onclick="openAddPromoCodeForm()">+ Add New Promo Code</button>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText:'Isara',
        width: 460
    });
}

async function openAddPromoCodeForm() {
    const { value: formValues } = await Swal.fire({
        title:'Add Promo Code',
        html: `
            <input type="text" id="swal-promo-code" class="swal2-input" placeholder="CODE (hal. SUMMER20)" style="text-transform:uppercase;">
            <select id="swal-promo-type" class="swal2-select">
                <option value="percent">Percent (%)</option>
                <option value="fixed">Fixed Amount (₱)</option>
            </select>
            <input type="number" id="swal-promo-value" class="swal2-input" placeholder="Value">
            <input type="number" id="swal-promo-minspend" class="swal2-input" placeholder="Minimum Spend (optional)">
            <input type="date" id="swal-promo-expiry" class="swal2-input" placeholder="Expiry (optional)">
            <input type="text" id="swal-promo-desc" class="swal2-input" placeholder="Description (optional)">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText:'Save',
        preConfirm: () => {
            const code = document.getElementById('swal-promo-code').value.trim();
            const value = document.getElementById('swal-promo-value').value;
            if (!code || !value) {
                Swal.showValidationMessage('Kailangan ng code at value.');
                return false;
            }
            return {
                code,
                type: document.getElementById('swal-promo-type').value,
                value,
                minSpend: document.getElementById('swal-promo-minspend').value,
                expiresAt: document.getElementById('swal-promo-expiry').value || null,
                description: document.getElementById('swal-promo-desc').value.trim()
            };
        }
    });
    if (!formValues) return;

    try {
        const res = await authFetch(`${API_URL}/promocodes`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(formValues)
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'Promo Code Added!', timer: 1300, showConfirmButton: false })
                .then(() => openPromoCodesManager());
        } else {
            Swal.fire('Error', data.message ||'Hindi na-save ang promo code.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Hindi makonekta sa server.','error');
    }
}

async function deletePromoCodeConfirm(code) {
    const result = await Swal.fire({
        title: `Burahin ang promo code "${code}"?`,
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Oo, burahin'
    });
    if (!result.isConfirmed) return;
    try {
        const res = await authFetch(`${API_URL}/promocodes/${encodeURIComponent(code)}`, { method:'DELETE' });
        const data = await res.json();
        if (data.success) {
            openPromoCodesManager();
        } else {
            Swal.fire('Error', data.message ||'Hindi na-delete.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Hindi makonekta sa server.','error');
    }
}

function applySavedTerminalDayMode() {
    const terminalSection = document.getElementById('view-terminal');
    const headerEl = document.getElementById('app-top-header');
    const btn = document.getElementById('terminal-daymode-btn');
    if (!terminalSection || !btn) return;
    const isDayMode = localStorage.getItem('terminal_daymode') ==='true';
    terminalSection.classList.toggle('terminal-daymode', isDayMode);
    if (headerEl) headerEl.classList.toggle('terminal-daymode', isDayMode);
    btn.classList.toggle('active', isDayMode);
    btn.innerHTML = isDayMode ?'<i class="fa-solid fa-moon"></i>' :'<i class="fa-solid fa-sun"></i>';
}

function toggleTerminalDayMode() {
    const terminalSection = document.getElementById('view-terminal');
    const headerEl = document.getElementById('app-top-header');
    const btn = document.getElementById('terminal-daymode-btn');
    if (!terminalSection || !btn) return;
    const isNowDayMode = !terminalSection.classList.contains('terminal-daymode');
    terminalSection.classList.toggle('terminal-daymode', isNowDayMode);
    if (headerEl) headerEl.classList.toggle('terminal-daymode', isNowDayMode);
    btn.classList.toggle('active', isNowDayMode);
    btn.innerHTML = isNowDayMode ?'<i class="fa-solid fa-moon"></i>' :'<i class="fa-solid fa-sun"></i>';
    localStorage.setItem('terminal_daymode', isNowDayMode ?'true' :'false');
}

function setupDropdownHandlers() {
    const dropdownHeaders = document.querySelectorAll('.menu-item-header');
    dropdownHeaders.forEach(header => {
        header.addEventListener('click', function() {
            const container = this.nextElementSibling;
            const icon = this.querySelector('.drop-icon');
            if (container.style.display ==='none' || container.style.display ==='') {

                closeAllSidebarMenuDropdowns();
                closeUserWidgetMenu();
                container.style.display ='flex';
                icon.style.transform ='rotate(180deg)';
            } else {
                container.style.display ='none';
                icon.style.transform ='rotate(0deg)';
            }
        });
    });
}

function closeAllSidebarMenuDropdowns() {
    document.querySelectorAll('.menu-dropdown .dropdown-container').forEach(container => {
        container.style.display ='none';
        const header = container.previousElementSibling;
        const icon = header ? header.querySelector('.drop-icon') : null;
        if (icon) icon.style.transform ='rotate(0deg)';
    });
}

function closeUserWidgetMenu() {
    document.getElementById('sidebar-user-widget')?.classList.remove('open');
    document.getElementById('user-widget-dropdown')?.classList.remove('open');
    document.getElementById('uw-themes-submenu')?.classList.remove('open');
    document.getElementById('uw-themes-caret')?.classList.remove('rotated');
    closeActiveUsersSubmenu();
}

function toggleUserWidgetMenu(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('user-widget-dropdown');
    const widget = document.getElementById('sidebar-user-widget');
    if (!dropdown || !widget) return;
    const isOpen = dropdown.classList.toggle('open');
    widget.classList.toggle('open', isOpen);
    if (isOpen) {

        closeAllSidebarMenuDropdowns();

        updateActiveUsersBadge();
    } else {

        document.getElementById('uw-themes-submenu')?.classList.remove('open');
        document.getElementById('uw-themes-caret')?.classList.remove('rotated');
        closeActiveUsersSubmenu();
    }
}

function toggleThemesSubmenu(event) {
    if (event) event.stopPropagation();
    const submenu = document.getElementById('uw-themes-submenu');
    const caret = document.getElementById('uw-themes-caret');
    if (!submenu) return;
    const isOpen = submenu.classList.toggle('open');
    if (caret) caret.classList.toggle('rotated', isOpen);

    if (isOpen) closeActiveUsersSubmenu();
    if (isOpen) refreshUnlockedThemesFromServer();
}

document.addEventListener('click', (e) => {
    const widget = document.getElementById('sidebar-user-widget');
    if (widget && widget.classList.contains('open') && !widget.contains(e.target)) {
        closeUserWidgetMenu();
    }
});

(function setupUserWidgetScrollAutoClose() {
    const scrollTargets = ['.sidebar-menu','.content-body'];
    scrollTargets.forEach(selector => {
        const el = document.querySelector(selector);
        if (!el) return;
        el.addEventListener('scroll', () => {
            const widget = document.getElementById('sidebar-user-widget');
            if (widget && widget.classList.contains('open')) {
                closeUserWidgetMenu();
            }
        }, { passive: true });
    });

    window.addEventListener('scroll', () => {
        const widget = document.getElementById('sidebar-user-widget');
        if (widget && widget.classList.contains('open')) {
            closeUserWidgetMenu();
        }
    }, { passive: true });
})();

function renderSidebarUserWidget() {
    if (!currentUser) return;
    const nameEl = document.getElementById('session-username');
    const roleEl = document.getElementById('session-user-role');
    const avatarEl = document.getElementById('user-widget-avatar');
    if (nameEl) nameEl.innerText = currentUser.username;
    if (roleEl) roleEl.innerText = currentUser.role ||'';
    if (avatarEl) {
        avatarEl.innerHTML = (currentUser.avatar
            ? `<img src="${currentUser.avatar}" alt="">`
            : `<i class="fa-solid fa-user"></i>`)
            + `<span class="user-widget-caret"><i class="fa-solid fa-chevron-down"></i></span>`;
    }
    updateActiveUsersBadge();
}

let activeUsersRefreshTimer = null;

function toggleActiveUsersSubmenu(event) {
    if (event) event.stopPropagation();
    const submenu = document.getElementById('uw-activeusers-submenu');
    const caret = document.getElementById('uw-activeusers-caret');
    if (!submenu) return;
    const isOpen = submenu.classList.toggle('open');
    if (caret) caret.classList.toggle('rotated', isOpen);
    if (isOpen) {

        document.getElementById('uw-themes-submenu')?.classList.remove('open');
        document.getElementById('uw-themes-caret')?.classList.remove('rotated');
        loadActiveUsers();

        if (activeUsersRefreshTimer) clearInterval(activeUsersRefreshTimer);
        activeUsersRefreshTimer = setInterval(loadActiveUsers, 30000);
    } else {
        if (activeUsersRefreshTimer) {
            clearInterval(activeUsersRefreshTimer);
            activeUsersRefreshTimer = null;
        }
    }
}

function closeActiveUsersSubmenu() {
    document.getElementById('uw-activeusers-submenu')?.classList.remove('open');
    document.getElementById('uw-activeusers-caret')?.classList.remove('rotated');
    if (activeUsersRefreshTimer) {
        clearInterval(activeUsersRefreshTimer);
        activeUsersRefreshTimer = null;
    }
}

function setActiveUsersBadgeCount(count) {
    const badge = document.getElementById('active-users-count-badge');
    if (badge) badge.textContent = `( ${count} )`;
}

async function updateActiveUsersBadge() {
    try {
        const res = await authFetch('/api/auth/active-sessions');
        const data = await res.json();
        const count = (data.success && Array.isArray(data.activeUsers)) ? data.activeUsers.length : 0;
        setActiveUsersBadgeCount(count);
    } catch (err) {

    }
}

async function loadActiveUsers() {
    const list = document.getElementById('active-users-list');
    if (!list) return;
    try {
        const res = await authFetch('/api/auth/active-sessions');
        const data = await res.json();
        if (!data.success || !Array.isArray(data.activeUsers) || data.activeUsers.length === 0) {
            list.innerHTML ='<div class="uw-au-empty">Walang naka-login na user.</div>';
            setActiveUsersBadgeCount(0);
            return;
        }
        setActiveUsersBadgeCount(data.activeUsers.length);
        list.innerHTML = data.activeUsers.map(u => {
            const loginTime = u.loginAt ? new Date(u.loginAt).toLocaleString() :'—';
            const mins = (u.minutesActive === null || u.minutesActive === undefined) ?'—' : (u.minutesActive < 1 ?'kababa lang' : `${u.minutesActive} min`);
            const youTag = u.isCurrentSession ?' <span class="uw-au-you">(you)</span>' :'';

            const deviceType = (u.device && u.device.deviceType) ||'Desktop';
            const deviceIcon = deviceType ==='Mobile' ?'fa-mobile-screen-button' : (deviceType ==='Tablet' ?'fa-tablet-screen-button' :'fa-desktop');
            const deviceLabel = (u.device && u.device.label) ? u.device.label :'Desktop · Unknown OS · Unknown Browser';
            const rawIp = u.ip ||'unknown';
            const ipLabel = (rawIp ==='127.0.0.1' || rawIp ==='::1')
                ? `${rawIp}   `
                : rawIp;
            const wifiBadge = u.sameWifi
                ? '<span class="uw-au-wifi-badge uw-au-wifi-same"><i class="fa-solid fa-wifi"></i></span>'
                : (rawIp ==='unknown' ?'' :'<span class="uw-au-wifi-badge uw-au-wifi-diff"><i class="fa-solid fa-globe"></i></span>');

            const avatarInner = u.avatar
                ? `<img src="${escapeHtml(u.avatar)}" alt="">`
                : `<i class="fa-solid fa-user"></i>`;

            return `<div class="uw-au-row">
                <span class="uw-au-avatar">${avatarInner}</span>
                <div class="uw-au-body">
                    <div class="uw-au-row-top">
                        <span class="uw-au-name">${escapeHtml(u.username)}${youTag}</span>
                        <span class="uw-au-role">${escapeHtml(u.role ||'')}</span>
                    </div>
                    <div class="uw-au-meta">${escapeHtml(loginTime)} · ${escapeHtml(String(mins))}</div>
                    <div class="uw-au-device"><i class="fa-solid ${deviceIcon}"></i> ${escapeHtml(deviceLabel)}</div>
                    <div class="uw-au-ip"><i class="fa-solid fa-network-wired"></i> ${escapeHtml(ipLabel)} ${wifiBadge}</div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        list.innerHTML ='<div class="uw-au-empty" style="color:#ef4444;">Hindi ma-load ang active users.</div>';
    }
}

function openEditProfileModal() {
    if (!currentUser) return;
    document.getElementById('user-widget-dropdown')?.classList.remove('open');
    document.getElementById('sidebar-user-widget')?.classList.remove('open');
    document.getElementById('edit-profile-form').reset();
    document.getElementById('ep-username').value = currentUser.username;
    const isAdmin = (currentUser.role ||'').toLowerCase() ==='admin';
    document.getElementById('ep-avatar').value = currentUser.avatar ||'';
    updateAvatarPreview('ep-photo-preview', currentUser.avatar ||'');

    const note = document.getElementById('ep-approval-note');
    if (note) {
        const canApplyDirectly = isAdmin || !!currentPermissions.edit_user_profile;
        note.innerText = canApplyDirectly
            ?''
            :'Note: Ang mga pagbabago sa Profile Picture/Username ay mapupunta muna sa Staff Requests para sa pag-approve ng Admin.';
    }
    document.getElementById('edit-profile-modal').style.display ='flex';
}

async function handleEditProfileSubmit(e) {
    e.preventDefault();
    const newUsername = document.getElementById('ep-username').value.trim();
    const avatar = document.getElementById('ep-avatar').value || null;
    const currentPassword = document.getElementById('ep-current-password').value.trim();
    const newPassword = document.getElementById('ep-new-password').value.trim();
    const confirmPassword = document.getElementById('ep-confirm-password').value.trim();

    const wantsPasswordChange = !!(currentPassword || newPassword || confirmPassword);
    if (wantsPasswordChange) {
        if (!currentPassword || !newPassword || !confirmPassword) {
            Swal.fire('Missing Values','Kumpletuhin ang lahat ng password fields (o iwanan silang lahat na blangko kung hindi mo babaguhin ang password).','warning');
            return;
        }
        if (newPassword !== confirmPassword) {
            Swal.fire('Hindi Tugma','Hindi magkatugma ang bagong password at confirm password.','warning');
            return;
        }
    }
    if (!newUsername) {
        Swal.fire('Missing Values','Hindi pwedeng blangko ang username.','warning');
        return;
    }

    const avatarChanged = avatar !== (currentUser.avatar || null);
    const usernameChanged = newUsername.toLowerCase() !== currentUser.username.toLowerCase();
    let profileWentPending = false;

    try {

        if (avatarChanged || usernameChanged) {
            const res = await authFetch(`${API_URL}/users/self/profile`, {
                method:'PUT',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ avatar, username: usernameChanged ? newUsername : undefined })
            });
            const data = await res.json();
            if (!(res.ok && data.success)) {
                Swal.fire('Execution Interrupted', SYSTEM_CONFIG.getErrorMessage(data.message ||'Process failed to complete requests.'),'error');
                return;
            }
            profileWentPending = !!data.pending;
            if (!data.pending) {
                currentUser.avatar = data.avatar || null;
                currentUser.username = data.username || currentUser.username;
                localStorage.setItem('posa_user', JSON.stringify(currentUser));
                renderSidebarUserWidget();
            }
        }

        if (wantsPasswordChange) {
            const pwRes = await authFetch(`${API_URL}/users/self/change-password`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const pwData = await pwRes.json();
            if (!(pwRes.ok && pwData.success)) {
                Swal.fire('Execution Interrupted', SYSTEM_CONFIG.getErrorMessage(pwData.message ||'Process failed to complete requests.'),'error');
                return;
            }
        }

        closeModal('edit-profile-modal');
        e.target.reset();
        if (profileWentPending) {
            Swal.fire('Naisumite', SYSTEM_CONFIG.getSuccessMessage('Naisumite ang Edit Profile request mo. Hihintayin ang pag-approve ng Admin.'),'info');
        } else {
            Swal.fire('Saved', SYSTEM_CONFIG.getSuccessMessage('Na-update na ang profile mo.'),'success');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Gateway Error', SYSTEM_CONFIG.getErrorMessage('Remote network transport paths disrupted.'),'error');
    }
}
document.getElementById('edit-profile-form')?.addEventListener('submit', handleEditProfileSubmit);

function checkAdminResetVisibility() {
    const currentUser = JSON.parse(localStorage.getItem('posa_user'));
    const resetSection = document.getElementById('admin-reset-section');

    if (resetSection) {
        if (currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin') {
            resetSection.style.setProperty('display','block','important');

            const heading = resetSection.querySelector('h2');
            if (heading) {

                heading.style.display ='flex';
                heading.style.alignItems ='center';
                heading.style.justifyContent ='space-between';
                heading.style.width ='100%';

                if (!document.getElementById('reset-faq-btn')) {
                    heading.innerHTML += `
                        <button type="button" id="reset-faq-btn" onclick="showGoogleAppVerificationFAQ()" 
                            style="background: none; border: none; color: #3b82f6; cursor: pointer; margin-left: auto; font-size: 1.2rem; padding: 4px; display: inline-flex; align-items: center;" 
                            title="FAQ / Gabay">
                            <i class="fa-solid fa-circle-question"></i>
                        </button>`;
                }
            }
        } else {
            resetSection.style.setProperty('display','none','important');
        }
    }
}

const US_QWERTY_LAYOUT_MAP = {
    KeyQ:'q', KeyW:'w', KeyE:'e', KeyR:'r', KeyT:'t', KeyY:'y', KeyU:'u', KeyI:'i', KeyO:'o', KeyP:'p',
    KeyA:'a', KeyS:'s', KeyD:'d', KeyF:'f', KeyG:'g', KeyH:'h', KeyJ:'j', KeyK:'k', KeyL:'l',
    KeyZ:'z', KeyX:'x', KeyC:'c', KeyV:'v', KeyB:'b', KeyN:'n', KeyM:'m'
};

function attachKeyboardStateWarning(inputId, warningId) {
    const input = document.getElementById(inputId);
    const warningEl = document.getElementById(warningId);
    if (!input || !warningEl) return;

    const updateWarning = (e) => {
        let capsLockOn = false;
        if (typeof e.getModifierState ==='function') {
            capsLockOn = e.getModifierState('CapsLock');
        }

        let wrongLayout = false;
        const expectedChar = US_QWERTY_LAYOUT_MAP[e.code];
        if (expectedChar && e.key && e.key.length === 1 && e.key.toLowerCase() !== expectedChar) {
            wrongLayout = true;
        }

        if (capsLockOn && wrongLayout) {
            warningEl.innerHTML ='<i class="fa-solid fa-triangle-exclamation"></i> Naka-ON ang Caps Lock at posibleng hindi English ang keyboard layout mo';
            warningEl.style.display ='flex';
        } else if (capsLockOn) {
            warningEl.innerHTML ='<i class="fa-solid fa-triangle-exclamation"></i> Naka-ON ang Caps Lock';
            warningEl.style.display ='flex';
        } else if (wrongLayout) {
            warningEl.innerHTML ='<i class="fa-solid fa-language"></i> Mukhang hindi English ang keyboard layout mo ngayon';
            warningEl.style.display ='flex';
        } else {
            warningEl.style.display ='none';
        }
    };

    input.addEventListener('keydown', updateWarning);
    input.addEventListener('keyup', updateWarning);
    input.addEventListener('blur', () => { warningEl.style.display ='none'; });
}

attachKeyboardStateWarning('login-username','username-keyboard-warning');
attachKeyboardStateWarning('login-password','password-keyboard-warning');

(function setupAuthMobileKeyboardHandling() {
    const authContainer = document.getElementById('auth-view');
    const authInputs = document.querySelectorAll('#login-username, #login-password');
    if (!authContainer || !authInputs.length) return;

    let hideCardTimeout;
    let isTyping = false;

    function updateKeyboardOffset() {
        if (!isTyping || !window.visualViewport) return;
        const vv = window.visualViewport;

        const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        authContainer.style.setProperty('--kb-offset', `${overlap}px`);
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateKeyboardOffset);
        window.visualViewport.addEventListener('scroll', updateKeyboardOffset);
    }

    authInputs.forEach((input) => {
        input.addEventListener('focus', () => {
            clearTimeout(hideCardTimeout);
            isTyping = true;
            if (window.innerWidth <= 768) {
                authContainer.classList.add('kb-open');
            }

            setTimeout(updateKeyboardOffset, 250);
            setTimeout(updateKeyboardOffset, 500);
        });

        input.addEventListener('blur', () => {

            hideCardTimeout = setTimeout(() => {
                isTyping = false;
                authContainer.classList.remove('kb-open');
                authContainer.style.removeProperty('--kb-offset');
            }, 200);
        });
    });
})();

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errorBanner = document.getElementById('login-error');

    // NOTE: SINADYANG walang internet pre-check dito. Ang /auth/login ay
    // tumatakbo sa SARILING LOCAL server ng client (Termux, isLocal/local-IP
    // — tingnan ang API_URL sa itaas), may sarili itong database, kaya
    // gumagana ito kahit walang internet ang device. Ang fetchWithTimeout
    // (sa loob ng authFetch) na lang ang bahalang mag-alarma kung talagang
    // hindi ma-reach ang local server sa loob ng ilang segundo.
    try {
        const response = await authFetch(`${API_URL}/auth/login`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();

        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('posa_user', JSON.stringify(currentUser));

            currentPermissions = data.permissions || {};
            menuRegistry = data.menuRegistry || [];
            localStorage.setItem('posa_permissions', JSON.stringify(currentPermissions));
            localStorage.setItem('posa_menu_registry', JSON.stringify(menuRegistry));

            if (data.token) {
                localStorage.setItem('posa_token', data.token);
            }

            // FIX: kung nag-login agad ulit habang naka-buffer pa 'yung
            // 5-segundong suppression window mula sa handleLogout(), i-clear
            // na agad dito para hindi ito makasagabal sa BAGONG session.
            window.__logoutInProgress = false;
            window.__sessionExpiredShown = false;

            errorBanner.style.display ='none';
            showMainSystemInterface();

            // Upgrade Options modal: dapat lumabas sa UNANG login (1st), at
            // muli tuwing every 3rd successful login pagkatapos nun (ika-3,
            // ika-6, ika-9, ...) — HINDI dapat lumabas sa 2nd, 4th, 5th, atbp.
            // Bilang ng successful login ang basehan (hindi "seen once"
            // flag), at ipinagpapatuloy lang ito kung may nakalock pa
            // talagang features (hindi na-fully-purchase).
            const loginCountKey = `posa_login_count_${(currentUser.username || currentUser.name ||'').toLowerCase()}`;
            const loginCount = (parseInt(localStorage.getItem(loginCountKey), 10) || 0) + 1;
            localStorage.setItem(loginCountKey, String(loginCount));

            const shouldShowUpgradeModal = loginCount === 1 || loginCount % 3 === 0;
            if (shouldShowUpgradeModal) {
                await refreshUnlockedFeaturesFromServer();
                if (!fullyPurchasedCache) {
                    showUpgradeTiersModal();
                }
            }
        } else {
            errorBanner.innerText = data.message;
            errorBanner.style.display ='block';
        }
    } catch (err) {
        errorBanner.innerText = (err && err.name ==='AbortError')
            ?'Hindi ma-reach ang lokal na server. Tiyaking tumatakbo ang OmniPOS server (Termux) at subukan ulit.'
            :'Server communication breakdown error.';
        errorBanner.style.display ='block';
    }
});

function showAuthenticationInterface() {
    document.getElementById('auth-view').style.display ='flex';
    document.getElementById('main-view').style.display ='none';
}

const MENU_ID_OVERRIDES = { dashboard:'menu-inventory-dashboard' };

function applyRoleBasedAccessControls(role) {
    const normalizedRole = (role ||'').toLowerCase();
    const isAdmin = normalizedRole ==='admin';

    const resetElements = document.querySelectorAll('.system-reset-container, .recovery-section, #reset-faq-btn');
    resetElements.forEach(el => {
        el.style.setProperty('display', isAdmin ?'' :'none','important');
    });

    (menuRegistry || []).forEach(m => {
        const elId = MENU_ID_OVERRIDES[m.key] || `menu-${m.key}`;
        const el = document.getElementById(elId);
        if (el) el.style.display = (isAdmin || currentPermissions[m.key]) ?'' :'none';
    });

    const inventoryGroup = document.getElementById('menu-inventory-group');
    if (inventoryGroup) {
        const anyInventoryVisible = isAdmin || currentPermissions.dashboard || currentPermissions.products || currentPermissions.barcode;
        inventoryGroup.style.display = anyInventoryVisible ?'' :'none';
    }

    console.log(`[OmniPOS] Applied dynamic Permission Matrix for role: ${role ||'unknown'}`);
}

async function refreshLowStockBadge() {
    const badge = document.getElementById('lowstock-bell-badge');
    const menuBadge = document.getElementById('reorder-menu-badge');
    if (!badge && !menuBadge) return;
    try {
        const res = await authFetch(`${API_URL}/products/low-stock`);
        const data = await res.json();
        const count = data && data.count ? data.count : 0;

        const badgeAllowed = isBadgeAllowedForFeature('purchase_orders');
        [
            { el: badge, allowed: badgeAllowed },
            { el: menuBadge, allowed: badgeAllowed }
        ].forEach(({ el, allowed }) => {
            if (!el) return;
            if (count > 0 && allowed) {
                el.innerText = count > 99 ?'99+' : count;
                el.style.display ='inline-block';
            } else {
                el.style.display ='none';
            }
        });
    } catch (e) {
        console.warn('Hindi ma-refresh ang low stock badge:', e);
    }
}

let reorderItemsCache = [];
let reorderPOCache = [];
const reorderSelectedCodes = new Set();
// Collapsible supplier groups (mobile "Pro upgrade" so the page isn't a
// giant scroll of every item at once). reorderCollapsedGroups holds the
// supplier names currently collapsed; reorderGroupsInitialized remembers
// which suppliers we've already applied the smart default to, so we only
// auto-decide once per supplier and never fight the user's own taps.
const reorderCollapsedGroups = new Set();
const reorderGroupsInitialized = new Set();
// 'list' (table) or 'grid' (cards) — which layout renderReorderTable() draws.
let reorderViewMode = 'list';
// Same idea, pero para sa Purchase Order History tab — hiwalay na state
// dahil independiyenteng view toggle ito sa Create PO tab.
let reorderPOViewMode = 'list';

// Pinipili sa pagitan ng dalawang tabs sa Reorder Alerts page: "Create PO"
// (tab 1, ang alerts + create PO na dati nasa itaas) at "Purchase Order
// History" (tab 2, ang PO list na dati nasa ibaba). Gumagamit ng sariling
// class names (.reorder-tab-btn / .reorder-tab-panel) sa halip na ang
// generic .tab-btn / .tab-content-panel para hindi ito mag-conflict sa
// switchUserTab() ng Users Management page.
function switchReorderTab(tabId, element) {
    document.querySelectorAll('.reorder-tab-panel').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.reorder-tab-btn').forEach(b => b.classList.remove('active'));

    const panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'flex';
    if (element) element.classList.add('active');
}

function setReorderViewMode(mode) {
    if (mode !== 'list' && mode !== 'grid') return;
    reorderViewMode = mode;
    const listBtn = document.getElementById('reorder-view-list-btn');
    const gridBtn = document.getElementById('reorder-view-grid-btn');
    const tableContainer = document.getElementById('reorder-table-container');
    const gridContainer = document.getElementById('reorder-grid-container');
    if (listBtn) listBtn.classList.toggle('active', mode === 'list');
    if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
    if (tableContainer) tableContainer.style.display = mode === 'list' ? '' : 'none';
    if (gridContainer) gridContainer.style.display = mode === 'grid' ? 'grid' : 'none';
    renderReorderTable();
}

function setReorderPOViewMode(mode) {
    if (mode !== 'list' && mode !== 'grid') return;
    reorderPOViewMode = mode;
    const listBtn = document.getElementById('reorder-po-view-list-btn');
    const gridBtn = document.getElementById('reorder-po-view-grid-btn');
    const tableContainer = document.getElementById('reorder-po-table-container');
    const gridContainer = document.getElementById('reorder-po-grid-container');
    if (listBtn) listBtn.classList.toggle('active', mode === 'list');
    if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
    if (tableContainer) tableContainer.style.display = mode === 'list' ? '' : 'none';
    if (gridContainer) gridContainer.style.display = mode === 'grid' ? 'grid' : 'none';
    renderPurchaseOrdersTable();
}

async function loadReorderView() {
    const tbody = document.getElementById('reorder-table-body');
    if (tbody) tbody.innerHTML = `<tr class="reorder-empty-row"><td colspan="9" style="text-align:center;padding:20px;color:#94a3b8;">Loading...</td></tr>`;
    // Isang beses lang ito i-attach (guarded ng dataset flag) — event
    // delegation para sa pag-collapse/expand ng supplier groups. Mas
    // matibay ito kaysa sa dating inline onclick="...('${supplier}')" na
    // pwedeng masira kapag may apostrophe, backslash, o ibang special
    // character ang totoong pangalan ng supplier.
    if (tbody && !tbody.dataset.reorderToggleBound) {
        tbody.dataset.reorderToggleBound ='1';
        tbody.addEventListener('click', (e) => {
            const target = e.target.closest('[data-toggle-group]');
            if (!target) return;
            toggleReorderGroup(target.getAttribute('data-toggle-group'));
        });
    }
    const gridContainer = document.getElementById('reorder-grid-container');
    if (gridContainer && !gridContainer.dataset.reorderToggleBound) {
        gridContainer.dataset.reorderToggleBound ='1';
        gridContainer.addEventListener('click', (e) => {
            const target = e.target.closest('[data-toggle-group]');
            if (!target) return;
            toggleReorderGroup(target.getAttribute('data-toggle-group'));
        });
    }
    reorderSelectedCodes.clear();
    updateReorderSelectedCount();
    try {
        const [lowStockRes, poRes] = await Promise.all([
            authFetch(`${API_URL}/products/low-stock`),
            authFetch(`${API_URL}/purchase-orders`)
        ]);
        const lowStockData = await lowStockRes.json();
        const poData = await poRes.json();
        reorderItemsCache = (lowStockData && lowStockData.items) || [];
        reorderPOCache = (poData && poData.orders) || [];
        renderReorderStats();
        renderReorderTable();
        renderPurchaseOrdersTable();
    } catch (e) {
        console.warn('Hindi ma-load ang Reorder Alerts:', e);
        if (tbody) tbody.innerHTML = `<tr class="reorder-empty-row"><td colspan="9" style="text-align:center;padding:20px;color:#ef4444;">Connection error — could not load reorder data.</td></tr>`;
    }
}

function renderReorderStats() {
    const bar = document.getElementById('reorder-stats-bar');
    if (!bar) return;
    const items = reorderItemsCache || [];
    const outOfStock = items.filter(p => p.status === 'OUT_OF_STOCK').length;
    const lowStock = items.length - outOfStock;
    const suppliers = new Set(items.map(p => p.supplier || 'Unspecified Supplier')).size;
    const suggestedTotal = items.reduce((sum, p) => sum + (Number(p.suggestedReorderQty) || 0), 0);

    if (items.length === 0) {
        bar.innerHTML = '';
        return;
    }

    const cards = [
        { label: 'Needs Reorder', value: items.length, icon: 'fa-triangle-exclamation', cls: 'total' },
        { label: 'Out of Stock', value: outOfStock, icon: 'fa-circle-xmark', cls: 'danger' },
        { label: 'Low Stock', value: lowStock, icon: 'fa-arrow-trend-down', cls: 'warning' },
        { label: 'Suppliers Affected', value: suppliers, icon: 'fa-truck-fast', cls: 'neutral' },
        { label: 'Suggested Units', value: suggestedTotal, icon: 'fa-boxes-stacked', cls: 'accent' }
    ];

    bar.innerHTML = cards.map(c => `
        <div class="reorder-stat-card reorder-stat-${c.cls}">
            <div class="reorder-stat-icon"><i class="fa-solid ${c.icon}"></i></div>
            <div class="reorder-stat-body">
                <div class="reorder-stat-value">${c.value}</div>
                <div class="reorder-stat-label">${c.label}</div>
            </div>
        </div>`).join('');
}

function reorderStatusBadge(p) {
    const isOut = p.status ==='OUT_OF_STOCK';
    const bg = isOut ?'#fee2e2' :'#fef3c7';
    const fg = isOut ?'#b91c1c' :'#a16207';
    return `<span style="background:${bg};color:${fg};font-weight:700;font-size:0.72rem;padding:3px 8px;border-radius:999px;white-space:nowrap;">${isOut ?'OUT OF STOCK' :'LOW STOCK'}</span>`;
}

function getFilteredSortedReorderItems() {
    const search = (document.getElementById('reorder-search-input')?.value ||'').toLowerCase().trim();
    const statusFilter = document.getElementById('reorder-filter-status')?.value ||'ALL';
    const sortBy = document.getElementById('reorder-sort-by')?.value ||'stock_asc';

    let list = reorderItemsCache.filter(p => {
        if (statusFilter !=='ALL' && p.status !== statusFilter) return false;
        if (search && !(`${p.name} ${p.supplier} ${p.code}`.toLowerCase().includes(search))) return false;
        return true;
    });

    list = [...list].sort((a, b) => {
        if (sortBy ==='days_desc') return (b.daysLow || 0) - (a.daysLow || 0);
        if (sortBy ==='name_asc') return (a.name ||'').localeCompare(b.name ||'');
        if (sortBy ==='supplier_asc') return (a.supplier ||'zzz').localeCompare(b.supplier ||'zzz');
        return (a.stock || 0) - (b.stock || 0);
    });
    return list;
}

function reorderRowHtml(p) {
    const checked = reorderSelectedCodes.has(p.code) ?'checked' :'';
    const orderedNote = p.openOrderedQty > 0
        ? `<br><small style="color:#2563eb;"><i class="fa-solid fa-truck"></i> ${p.openOrderedQty} already ordered</small>` :'';
    return `
        <tr class="reorder-row">
            <td data-label="Select" class="reorder-select-cell"><span class="reorder-mobile-code">${escapeHtml(p.code)}</span><input type="checkbox" onchange="toggleReorderSelect('${escapeHtml(p.code)}', this.checked)" ${checked}></td>
            <td data-label="Product"><strong>${escapeHtml(p.name)}</strong><br><small class="reorder-code-desktop" style="color:#94a3b8;">${escapeHtml(p.code)}</small></td>
            <td data-label="Supplier">${escapeHtml(p.supplier) ||'<span style="color:#94a3b8;">—</span>'}</td>
            <td data-label="Stock" style="font-weight:700;color:${p.status ==='OUT_OF_STOCK' ?'#ef4444' :'#d97706'};">${p.stock}</td>
            <td data-label="Threshold">${p.threshold}</td>
            <td data-label="Days Low">${p.daysLow} days${orderedNote}</td>
            <td data-label="Suggested Reorder">${p.suggestedReorderQty}</td>
            <td data-label="Status">${reorderStatusBadge(p)}</td>
            <td data-label="Actions" style="white-space:nowrap;">
                <button class="btn-icon-action edit" title="Quick Restock" onclick="quickRestock('${escapeHtml(p.code)}', '${escapeHtml(p.name).replace(/'/g,"\\'")}')"><i class="fa-solid fa-box-open"></i></button>
                <button class="btn-icon-action edit" title="Create PO for this item only" onclick="openCreatePOModal(['${escapeHtml(p.code)}'])"><i class="fa-solid fa-cart-plus"></i></button>
            </td>
        </tr>`;
}

function reorderCardHtml(p) {
    const checked = reorderSelectedCodes.has(p.code) ?'checked' :'';
    const orderedNote = p.openOrderedQty > 0
        ? `<div class="reorder-card-row" style="color:#2563eb;"><span><i class="fa-solid fa-truck"></i> On order</span><strong>${p.openOrderedQty}</strong></div>` :'';
    return `
        <div class="reorder-card">
            <div class="reorder-card-top">
                <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;min-width:0;">
                    <input type="checkbox" onchange="toggleReorderSelect('${escapeHtml(p.code)}', this.checked)" ${checked} style="margin-top:3px;flex-shrink:0;">
                    <span style="min-width:0;">
                        <span class="reorder-card-name">${escapeHtml(p.name)}</span>
                        <span class="reorder-card-code">${escapeHtml(p.code)}</span>
                    </span>
                </label>
                ${reorderStatusBadge(p)}
            </div>
            <div class="reorder-card-row"><span>Supplier</span><strong>${escapeHtml(p.supplier) ||'—'}</strong></div>
            <div class="reorder-card-row"><span>Stock / Threshold</span><strong style="color:${p.status ==='OUT_OF_STOCK' ?'#ef4444' :'#d97706'};">${p.stock} / ${p.threshold}</strong></div>
            <div class="reorder-card-row"><span>Days Low</span><strong>${p.daysLow} days</strong></div>
            <div class="reorder-card-row"><span>Suggested Reorder</span><strong>${p.suggestedReorderQty}</strong></div>
            ${orderedNote}
            <div class="reorder-card-actions">
                <button class="btn-icon-action edit" title="Quick Restock" onclick="quickRestock('${escapeHtml(p.code)}', '${escapeHtml(p.name).replace(/'/g,"\\'")}')"><i class="fa-solid fa-box-open"></i></button>
                <button class="btn-icon-action edit" title="Create PO for this item only" onclick="openCreatePOModal(['${escapeHtml(p.code)}'])"><i class="fa-solid fa-cart-plus"></i></button>
            </div>
        </div>`;
}

function renderReorderEmptyState() {
    const tbody = document.getElementById('reorder-table-body');
    const gridContainer = document.getElementById('reorder-grid-container');
    if (tbody) tbody.innerHTML = `<tr class="reorder-empty-row"><td colspan="9" style="text-align:center;padding:24px;color:#94a3b8;">🎉 No matching low stock items.</td></tr>`;
    if (gridContainer) gridContainer.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:#94a3b8;">🎉 No matching low stock items.</div>`;
}

function renderReorderTable() {
    const list = getFilteredSortedReorderItems();

    if (list.length === 0) {
        renderReorderEmptyState();
        updateReorderSelectedCount();
        return;
    }

    if (reorderViewMode ==='grid') {
        renderReorderGridView(list);
    } else {
        renderReorderListView(list);
    }
    updateReorderSelectedCount();
}

// Suppliers na may pinaka-maraming OUT_OF_STOCK item ang unang lalabas
// (susunod ay pinaka-maraming item, tapos alphabetical) — mas mahalaga
// ito kaysa sa plain A-Z dahil doon dapat mauna ang atensyon ng user.
// Ginagamit ito ng parehong list (table) at grid (card) view.
function sortedReorderSupplierGroups(list) {
    const groups = {};
    list.forEach(p => {
        const key = p.supplier ||'Unspecified Supplier';
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });
    const supplierKeys = Object.keys(groups).sort((a, b) => {
        const aOut = groups[a].filter(p => p.status ==='OUT_OF_STOCK').length;
        const bOut = groups[b].filter(p => p.status ==='OUT_OF_STOCK').length;
        if (aOut !== bOut) return bOut - aOut;
        if (groups[b].length !== groups[a].length) return groups[b].length - groups[a].length;
        return a.localeCompare(b);
    });
    return { groups, supplierKeys };
}

function renderReorderListView(list) {
    const tbody = document.getElementById('reorder-table-body');
    if (!tbody) return;
    const groupBySupplier = document.getElementById('reorder-group-by-supplier')?.checked;
    const searchActive = !!(document.getElementById('reorder-search-input')?.value ||'').trim();

    if (!groupBySupplier) {
        tbody.innerHTML = list.map(reorderRowHtml).join('');
        return;
    }

    const { groups, supplierKeys } = sortedReorderSupplierGroups(list);
    let html ='';
    supplierKeys.forEach(supplier => {
        const items = groups[supplier];
        const outCount = items.filter(p => p.status ==='OUT_OF_STOCK').length;
        const totalQty = items.reduce((sum, p) => sum + (p.suggestedReorderQty || 0), 0);
        const urgencyBadge = outCount > 0
            ? `<span class="reorder-group-urgency out"><i class="fa-solid fa-triangle-exclamation"></i> ${outCount} out of stock</span>`
            :`<span class="reorder-group-urgency low">low stock</span>`;
        // Smart default: LAHAT ng grupo naka-collapse paglo-load (mas
        // maiksi talaga ang page kesa dati na "kung walang OUT_OF_STOCK
        // lang" — kadalasan halos lahat may 1+ OUT_OF_STOCK kaya wala
        // talagang mag-co-collapse). Isang beses lang ito gagawin per
        // supplier, hindi na babaguhin kung na-toggle na ng user.
        if (!reorderGroupsInitialized.has(supplier)) {
            reorderGroupsInitialized.add(supplier);
            reorderCollapsedGroups.add(supplier);
        }
        // Habang naka-search, laging ipakita ang mga item (kahit
        // naka-collapse ang grupo sa "totoo") para hindi matago ang
        // mismong hinahanap ng user. Hindi nito binabago ang saved
        // state — babalik lang sa dating collapsed/expanded pagka-clear
        // ng search.
        const isCollapsed = searchActive ? false : reorderCollapsedGroups.has(supplier);
        html += `<tr class="reorder-group-header"><td colspan="9">
                    <div class="reorder-group-header-inner">
                        <div class="reorder-group-header-info" data-toggle-group="${escapeHtml(supplier)}" role="button" tabindex="0">
                            <i class="fa-solid ${isCollapsed ?'fa-chevron-right' :'fa-chevron-down'} reorder-group-chevron"></i>
                            <span class="reorder-group-header-title"><i class="fa-solid fa-truck-fast"></i> ${escapeHtml(supplier)} (${items.length} item/s)</span>
                            ${urgencyBadge}
                            <span class="reorder-group-header-qty">Suggested total: ${totalQty}</span>
                            <button class="btn-icon-action edit reorder-group-po-btn" title="Quick restock — Create PO for this entire supplier" onclick="event.stopPropagation(); openCreatePOModal(${JSON.stringify(items.map(p => p.code))})"><i class="fa-solid fa-cart-plus"></i></button>
                        </div>
                    </div>
                 </td></tr>`;
        if (!isCollapsed) html += items.map(reorderRowHtml).join('');
    });
    tbody.innerHTML = html;
}

function renderReorderGridView(list) {
    const container = document.getElementById('reorder-grid-container');
    if (!container) return;
    const groupBySupplier = document.getElementById('reorder-group-by-supplier')?.checked;
    const searchActive = !!(document.getElementById('reorder-search-input')?.value ||'').trim();

    if (!groupBySupplier) {
        container.innerHTML = list.map(reorderCardHtml).join('');
        return;
    }

    const { groups, supplierKeys } = sortedReorderSupplierGroups(list);
    let html ='';
    supplierKeys.forEach(supplier => {
        const items = groups[supplier];
        const outCount = items.filter(p => p.status ==='OUT_OF_STOCK').length;
        const totalQty = items.reduce((sum, p) => sum + (p.suggestedReorderQty || 0), 0);
        const urgencyBadge = outCount > 0
            ? `<span class="reorder-group-urgency out"><i class="fa-solid fa-triangle-exclamation"></i> ${outCount} out of stock</span>`
            :`<span class="reorder-group-urgency low">low stock</span>`;
        if (!reorderGroupsInitialized.has(supplier)) {
            reorderGroupsInitialized.add(supplier);
            reorderCollapsedGroups.add(supplier);
        }
        const isCollapsed = searchActive ? false : reorderCollapsedGroups.has(supplier);
        html += `<div class="reorder-grid-group-header">
                    <div class="reorder-group-header-info" data-toggle-group="${escapeHtml(supplier)}" role="button" tabindex="0">
                        <i class="fa-solid ${isCollapsed ?'fa-chevron-right' :'fa-chevron-down'} reorder-group-chevron"></i>
                        <span class="reorder-group-header-title"><i class="fa-solid fa-truck-fast"></i> ${escapeHtml(supplier)} (${items.length} item/s)</span>
                        ${urgencyBadge}
                        <span class="reorder-group-header-qty">Suggested total: ${totalQty}</span>
                        <button class="btn-icon-action edit reorder-group-po-btn" title="Quick restock — Create PO for this entire supplier" onclick="event.stopPropagation(); openCreatePOModal(${JSON.stringify(items.map(p => p.code))})"><i class="fa-solid fa-cart-plus"></i></button>
                    </div>
                 </div>`;
        if (!isCollapsed) html += items.map(reorderCardHtml).join('');
    });
    container.innerHTML = html;
}

function toggleReorderGroup(supplier) {
    if (reorderCollapsedGroups.has(supplier)) reorderCollapsedGroups.delete(supplier);
    else reorderCollapsedGroups.add(supplier);
    renderReorderTable();
}

function setAllReorderGroupsCollapsed(collapsed) {
    // DATING BUG: kung naka-OFF ang "I-group ayon sa Supplier" checkbox,
    // nagsi-silent no-op lang ang dalawang button na ito (walang collapse
    // na konsepto kung hindi naka-group ang view) — kaya parang "sira" sa
    // paningin ng user kahit tama naman ang code. Ang pag-click sa
    // Collapsahin/Buksan Lahat ay malinaw na senyales na gusto niya ng
    // grouped view, kaya i-on na lang natin ito mismo sa halip na huminto.
    const groupByCheckbox = document.getElementById('reorder-group-by-supplier');
    if (groupByCheckbox && !groupByCheckbox.checked) groupByCheckbox.checked = true;

    const list = getFilteredSortedReorderItems();
    const suppliers = new Set(list.map(p => p.supplier ||'Unspecified Supplier'));
    suppliers.forEach(s => {
        reorderGroupsInitialized.add(s);
        if (collapsed) reorderCollapsedGroups.add(s); else reorderCollapsedGroups.delete(s);
    });
    renderReorderTable();
}

function toggleReorderSelect(code, checked) {
    if (checked) reorderSelectedCodes.add(code); else reorderSelectedCodes.delete(code);
    updateReorderSelectedCount();
}

function toggleSelectAllReorder(checkbox) {
    const list = getFilteredSortedReorderItems();
    if (checkbox.checked) list.forEach(p => reorderSelectedCodes.add(p.code));
    else list.forEach(p => reorderSelectedCodes.delete(p.code));
    renderReorderTable();
}

function updateReorderSelectedCount() {
    const countEl = document.getElementById('reorder-selected-count');
    const btn = document.getElementById('reorder-create-po-btn');
    if (countEl) countEl.innerText = reorderSelectedCodes.size;
    if (btn) btn.disabled = reorderSelectedCodes.size === 0;
}

async function quickRestock(code, name) {
    const { value: qty } = await Swal.fire({
        title: `Quick Restock: ${name}`,
        input:'number',
        inputLabel:'How many pieces to add to stock?',
        inputAttributes: { min: 1, step: 1 },
        showCancelButton: true,
        confirmButtonText:'Restock',
        cancelButtonText:'Cancel',
        inputValidator: (value) => {
            if (!value || parseInt(value) <= 0) return'Enter a valid quantity.';
        }
    });
    if (!qty) return;
    try {
        const res = await authFetch(`${API_URL}/products/${encodeURIComponent(code)}/quick-restock`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ qty: parseInt(qty) })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title: data.pending ?'Submitted for Approval' :'Restocked!', text: data.message, timer: 2200, showConfirmButton: false });
            loadReorderView();
            refreshLowStockBadge();
        } else {
            Swal.fire('Error', data.message ||'There was a problem restocking.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

function openCreatePOModal(codesOverride) {
    if (guardPremiumFeature('purchase_orders')) return;
    const codes = codesOverride && codesOverride.length ? codesOverride : Array.from(reorderSelectedCodes);
    if (!codes.length) return;
    const items = reorderItemsCache.filter(p => codes.includes(p.code));
    if (!items.length) return;

    const UNASSIGNED ='__unassigned__';
    const groups = {};
    items.forEach(p => {
        const key = (p.supplier ||'').trim() || UNASSIGNED;
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });
    const groupKeys = Object.keys(groups);

    const groupSectionHtml = groupKeys.map((key, gIdx) => {
        const groupItems = groups[key];
        const isUnassigned = key === UNASSIGNED;
        const rowsHtml = groupItems.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid #eee;text-align:left;">
                <div style="flex:1;"><strong>${escapeHtml(p.name)}</strong><br><small style="color:#94a3b8;">${escapeHtml(p.code)} · stock: ${p.stock}</small></div>
                <input type="number" min="1" value="${p.suggestedReorderQty}" data-po-code="${escapeHtml(p.code)}" data-po-name="${escapeHtml(p.name)}" data-po-group="${gIdx}" class="po-qty-input" style="width:80px;padding:6px;border-radius:6px;border:1px solid var(--border-color);text-align:center;">
            </div>`).join('');
        const supplierLabelHtml = isUnassigned
            ? `<input id="po-supplier-input-${gIdx}" type="text" value="" placeholder="Supplier Name" data-group-supplier-input="${gIdx}" style="width:100%;padding:8px;margin:4px 0 8px;border-radius:6px;border:1px solid var(--border-color);">`
            : `<div id="po-supplier-input-${gIdx}" data-group-supplier-fixed="${gIdx}" style="font-weight:700;padding:6px 0 8px;color:#1e293b;"><i class="fa-solid fa-truck-fast" style="color:#64748b;margin-right:6px;"></i>${escapeHtml(key)}</div>`;
        return `
            <div style="margin-bottom:14px;padding:10px;border:1px solid var(--border-color);border-radius:8px;">
                <label style="font-size:0.78rem;color:#64748b;">Supplier for this group</label>
                ${supplierLabelHtml}
                <div style="max-height:200px;overflow-y:auto;">${rowsHtml}</div>
            </div>`;
    }).join('');

    const multiSupplierNote = groupKeys.length > 1
        ? `<p style="font-size:0.78rem;color:#64748b;margin:0 0 10px;"><i class="fa-solid fa-circle-info"></i> The selected items have different suppliers — this will automatically be split into <strong>${groupKeys.length} separate Purchase Orders</strong>, one per supplier.</p>`
        :'';

    Swal.fire({
        title: `<i class="fa-solid fa-cart-plus"></i> Create Purchase Order`,
        width: 520,
        html: `
            <div style="text-align:left;">
                ${multiSupplierNote}
                <div style="max-height:360px;overflow-y:auto;">${groupSectionHtml}</div>
                <label style="font-size:0.82rem;color:#64748b;">Notes (optional)</label>
                <textarea id="po-notes-input" rows="2" style="width:100%;padding:8px;margin-top:4px;border-radius:6px;border:1px solid var(--border-color);"></textarea>
            </div>`,
        showCancelButton: true,
        confirmButtonText: groupKeys.length > 1 ? `Submit ${groupKeys.length} POs` :'Submit PO',
        cancelButtonText:'Cancel',
        preConfirm: () => {
            const notes = document.getElementById('po-notes-input').value.trim();
            const payloads = [];
            for (let gIdx = 0; gIdx < groupKeys.length; gIdx++) {
                const key = groupKeys[gIdx];
                const isUnassigned = key === UNASSIGNED;
                const supplier = isUnassigned
                    ? document.getElementById(`po-supplier-input-${gIdx}`).value.trim()
                    : key;
                if (!supplier) {
                    Swal.showValidationMessage('A supplier name is required for items without an assigned supplier.');
                    return false;
                }
                const qtyInputs = document.querySelectorAll(`.po-qty-input[data-po-group="${gIdx}"]`);
                const poItems = Array.from(qtyInputs).map(inp => ({
                    code: inp.getAttribute('data-po-code'),
                    name: inp.getAttribute('data-po-name'),
                    qty: parseInt(inp.value) || 0
                })).filter(it => it.qty > 0);
                if (!poItems.length) {
                    Swal.showValidationMessage(`At least one item with a valid quantity is required for supplier "${supplier}".`);
                    return false;
                }
                payloads.push({ supplier, notes, items: poItems });
            }
            if (!payloads.length) { Swal.showValidationMessage('No valid Purchase Order could be created.'); return false; }
            return payloads;
        }
    }).then(async (result) => {
        if (!result.isConfirmed) return;
        const payloads = result.value;
        let successCount = 0;
        let lastErrorMessage ='';
        for (const payload of payloads) {
            try {
                const res = await authFetch(`${API_URL}/purchase-orders`, {
                    method:'POST',
                    headers: {'Content-Type':'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    successCount++;
                } else {
                    lastErrorMessage = data.message ||'There was a problem creating the PO.';
                }
            } catch (e) {
                lastErrorMessage ='Could not connect to the server.';
            }
        }
        if (successCount === payloads.length) {
            Swal.fire({
                icon:'success',
                title: payloads.length > 1 ? `${successCount} Purchase Orders created!` :'Purchase Order created!',
                timer: 2000,
                showConfirmButton: false
            });
        } else if (successCount > 0) {
            Swal.fire('Partially Completed', `${successCount} of ${payloads.length} Purchase Orders were created. ${lastErrorMessage}`,'warning');
        } else {
            Swal.fire('Error', lastErrorMessage ||'There was a problem creating the PO.','error');
        }
        reorderSelectedCodes.clear();
        loadReorderView();
    });
}

function poStatusBadge(status) {
    const map = {
        ordered: ['#dbeafe','#1d4ed8','ORDERED'],
        received: ['#dcfce7','#15803d','RECIEVED'],
        cancelled: ['#f1f5f9','#64748b','CANCELED']
    };
    const [bg, fg, label] = map[status] || map.ordered;
    return `<span style="background:${bg};color:${fg};font-weight:700;font-size:0.72rem;padding:3px 8px;border-radius:999px;">${label}</span>`;
}

function getFilteredSortedPOList() {
    const search = (document.getElementById('reorder-po-search-input')?.value ||'').toLowerCase().trim();
    const statusFilter = document.getElementById('reorder-po-filter-status')?.value ||'ALL';
    const sortBy = document.getElementById('reorder-po-sort-by')?.value ||'newest';

    let list = reorderPOCache.filter(po => {
        if (statusFilter !=='ALL' && po.status !== statusFilter) return false;
        if (search) {
            const itemNames = (po.items || []).map(it => it.name).join(' ');
            const haystack = `${po.id} ${po.supplier} ${itemNames}`.toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    list = [...list].sort((a, b) => {
        if (sortBy ==='supplier_asc') return (a.supplier ||'').localeCompare(b.supplier ||'');
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return sortBy ==='oldest' ? aTime - bTime : bTime - aTime;
    });
    return list;
}

// Common bits shared by both the list row and the grid card for a PO —
// kept in one place para hindi mag-drift ang dalawang views sa isa't isa.
function poDisplayFields(po) {
    const itemsSummary = po.items.map(it => `${escapeHtml(it.name)} (×${it.qty})`).join(', ');
    const when = po.status ==='received' ? po.receivedAt : (po.status ==='cancelled' ? po.cancelledAt : po.createdAt);
    const whenText = when ? new Date(when).toLocaleString() :'';
    const actions = po.status ==='ordered'
        ? `<button class="btn-icon-action edit" title="Mark as Received (adds to stock)" onclick="receivePO(${po.id})"><i class="fa-solid fa-check"></i></button>
           <button class="btn-icon-action delete" title="Cancel" onclick="cancelPO(${po.id})"><i class="fa-solid fa-xmark"></i></button>`
        :'<span style="color:#94a3b8;">—</span>';
    return { itemsSummary, whenText, actions };
}

function poRowHtml(po) {
    const { itemsSummary, whenText, actions } = poDisplayFields(po);
    const whoWhen = `${escapeHtml(po.createdBy)}<br><small style="color:#94a3b8;">${whenText}</small>`;
    return `<tr class="reorder-row">
        <td data-label="PO #">#${po.id}</td>
        <td data-label="Supplier">${escapeHtml(po.supplier)}</td>
        <td data-label="Items" style="max-width:280px;">${itemsSummary}</td>
        <td data-label="Status">${poStatusBadge(po.status)}</td>
        <td data-label="Created By / When">${whoWhen}</td>
        <td data-label="Actions" style="white-space:nowrap;">${actions}</td>
    </tr>`;
}

// Grid/card version of a Purchase Order — ginawang tugma sa disenyo ng
// .reorder-card (ginagamit ng Create PO grid view) para consistent ang
// dalawang tab kapag pinalitan ng "Grid" ang view.
function poCardHtml(po) {
    const { itemsSummary, whenText, actions } = poDisplayFields(po);
    return `
        <div class="reorder-card">
            <div class="reorder-card-top">
                <span style="min-width:0;">
                    <span class="reorder-card-name">#${po.id}</span>
                    <span class="reorder-card-code">${escapeHtml(po.supplier)}</span>
                </span>
                ${poStatusBadge(po.status)}
            </div>
            <div class="reorder-card-row" style="align-items:flex-start;">
                <span>Items</span>
                <strong style="text-align:right;max-width:65%;font-weight:600;">${itemsSummary}</strong>
            </div>
            <div class="reorder-card-row"><span>Created By</span><strong>${escapeHtml(po.createdBy)}</strong></div>
            <div class="reorder-card-row"><span>When</span><strong>${whenText ||'—'}</strong></div>
            <div class="reorder-card-actions">${actions}</div>
        </div>`;
}

function renderPOEmptyState(message) {
    const tbody = document.getElementById('reorder-po-table-body');
    const gridContainer = document.getElementById('reorder-po-grid-container');
    if (tbody) tbody.innerHTML = `<tr class="reorder-empty-row"><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8;">${message}</td></tr>`;
    if (gridContainer) gridContainer.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#94a3b8;">${message}</div>`;
}

function renderPurchaseOrdersTable() {
    const tbody = document.getElementById('reorder-po-table-body');
    if (!tbody) return;
    if (!reorderPOCache.length) {
        renderPOEmptyState('No Purchase Orders created yet.');
        return;
    }
    const list = getFilteredSortedPOList();
    if (!list.length) {
        renderPOEmptyState('No Purchase Orders match your filters.');
        return;
    }
    if (reorderPOViewMode ==='grid') {
        const gridContainer = document.getElementById('reorder-po-grid-container');
        if (gridContainer) gridContainer.innerHTML = list.map(poCardHtml).join('');
    } else {
        tbody.innerHTML = list.map(poRowHtml).join('');
    }
}

async function receivePO(id) {
    const confirm = await Swal.fire({
        title:'Mark as Received?',
        text:'All items in this Purchase Order will automatically be added to stock.',
        icon:'question', showCancelButton: true,
        confirmButtonText:'Yes, Received', cancelButtonText:'Cancel'
    });
    if (!confirm.isConfirmed) return;
    try {
        const res = await authFetch(`${API_URL}/purchase-orders/${id}/receive`, { method:'POST' });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'Received!', text:'Stock has been updated.', timer: 2000, showConfirmButton: false });
            loadReorderView();

            refreshLowStockBadge();
        } else {
            Swal.fire('Error', data.message,'error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function cancelPO(id) {
    const confirm = await Swal.fire({
        title:'Cancel this Purchase Order?',
        icon:'warning', showCancelButton: true,
        confirmButtonText:'Yes, Cancel', cancelButtonText:'Not Now'
    });
    if (!confirm.isConfirmed) return;
    try {
        const res = await authFetch(`${API_URL}/purchase-orders/${id}/cancel`, { method:'POST' });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'Cancelled.', timer: 1600, showConfirmButton: false });
            loadReorderView();
        } else {
            Swal.fire('Error', data.message,'error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function exportReorderCSV() {
    // Parehong 'purchase_orders' feature ang ginagamit ng Create PO sa
    // page na ito — sinusunod lang natin ang parehong gate dito para sa
    // Export CSV. Kung naka-demo mode o nabili na, kasama na ang
    // 'purchase_orders' sa unlockedFeatureIdsCache, kaya hindi ito
    // ihaharang ni guardPremiumFeature(); kung hindi pa unlocked,
    // guardPremiumFeature() mismo ang bahalang magpakita ng unlock/demo
    // prompt at pipigilan ang pag-download.
    if (guardPremiumFeature('purchase_orders')) return;

    // Kahit unlocked na (nabili o naka-demo mode), palaging magtatanong
    // muna ito bago i-download — sinasadya, hindi automatic, para
    // makumpirma talaga ng user ang PRO export na ito.
    const confirmResult = await Swal.fire({
        title:'Download Export?',
        html:'This will download the <strong>Reorder Alerts CSV</strong>. Do you want to continue?',
        icon:'question',
        showCancelButton: true,
        confirmButtonText:'Yes, Download',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#7c5cff',
    });
    if (!confirmResult.isConfirmed) return;

    downloadAuthFetch(`${API_URL}/products/low-stock/export`, `reorder_alerts_${Date.now()}.csv`);
}

function printReorderList() {
    const list = getFilteredSortedReorderItems();
    const rows = list.map(p => `
        <tr>
            <td>${escapeHtml(p.code)}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.supplier) ||'—'}</td>
            <td>${p.stock}</td>
            <td>${p.threshold}</td>
            <td>${p.suggestedReorderQty}</td>
            <td>${p.status ==='OUT_OF_STOCK' ?'OUT OF STOCK' :'LOW STOCK'}</td>
        </tr>`).join('');
    const win = window.open('','_blank');
    win.document.write(`
        <html><head><title>Reorder Alerts — ${new Date().toLocaleDateString()}</title>
        <style>
            body{font-family:Arial,sans-serif;padding:20px;color:#111;}
            h1{font-size:18px;margin-bottom:4px;}
            table{width:100%;border-collapse:collapse;margin-top:12px;}
            th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left;}
            th{background:#f1f5f9;}
        </style></head>
        <body>
            <h1>Reorder Alerts / Purchase List</h1>
            <div style="color:#555;font-size:12px;">Generated: ${new Date().toLocaleString()}</div>
            <table><thead><tr><th>Code</th><th>Product</th><th>Supplier</th><th>Stock</th><th>Threshold</th><th>Suggested Reorder</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody></table>
        </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
}

async function loadDashboardMetrics() {
    try {

        const resTx = await authFetch(`${API_URL}/transactions`);
        const resProd = await authFetch(`${API_URL}/products`);

        const currentUsername = currentUser?.username ||'admin';
        const resUsers = await authFetch(`${API_URL}/users?requester=${currentUsername}`);

        let serverTxs = resTx.ok ? await resTx.json() : [];
        let productsList = resProd.ok ? await resProd.json() : [];
        const usersList = resUsers.ok ? await resUsers.json() : [];

        if (serverTxs && serverTxs.length > 0) {
            localStorage.setItem('cached_transactions', JSON.stringify(serverTxs));
        } else {

            serverTxs = JSON.parse(localStorage.getItem('cached_transactions') ||'[]');
        }

        if (productsList && productsList.length > 0) {
            localStorage.setItem('cached_products', JSON.stringify(productsList));
        } else {

            productsList = JSON.parse(localStorage.getItem('cached_products') ||'[]');
        }

        const rawOffline = JSON.parse(localStorage.getItem('offline_transactions') ||'[]');
        const offlineTxs = rawOffline.map(item => item.transaction || item);
        const allTxs = [...serverTxs, ...offlineTxs];

        const uniqueMap = new Map();
        allTxs.forEach(tx => { if (tx && tx.id) uniqueMap.set(tx.id, tx); });
        const uniqueTxs = Array.from(uniqueMap.values());

        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        const currentDate = today.getDate();

        const todaysTxs = uniqueTxs.filter(tx => {
            const timestamp = tx.timestamp || tx.date;
            if (!timestamp) return false;

            let txDate = tx.isoDate ? new Date(tx.isoDate) : new Date(timestamp);

            if (isNaN(txDate.getTime())) {
                const numbers = timestamp.match(/\d+/g);
                if (numbers && numbers.length >= 3) {
                    const year = parseInt(numbers[2]);
                    const val1 = parseInt(numbers[0]);
                    const val2 = parseInt(numbers[1]);

                    if (year === currentYear) {
                        if ((val1 === currentMonth + 1 && val2 === currentDate) ||
                            (val2 === currentMonth + 1 && val1 === currentDate)) {
                            return true;
                        }
                    }
                }
                return false;
            }

            return txDate.getFullYear() === currentYear &&
                   txDate.getMonth() === currentMonth &&
                   txDate.getDate() === currentDate;
        });

        const revenue = todaysTxs.reduce((acc, current) => acc + (parseFloat(current.total) || 0), 0);
        const totalProductsCount = productsList.length;

        const lowStockItemsCount = productsList.filter(p => {
            const stock = parseInt(p.stock) || 0;
            const threshold = (p.lowStockThreshold !== undefined && p.lowStockThreshold !== null && p.lowStockThreshold !=='') ? parseInt(p.lowStockThreshold) : 5;
            return stock > 0 && stock <= threshold;
        }).length;

        const noStockItemsCount = productsList.filter(p => (parseInt(p.stock) || 0) <= 0).length;

        const expiringSoonCount = productsList.filter(p => {
            if (!p.expiryDate) return false;
            const expiryDate = new Date(p.expiryDate);
            if (isNaN(expiryDate.getTime())) return false;
            const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            return daysLeft >= 0 && daysLeft <= 7;
        }).length;

        const expiredCount = productsList.filter(p => {
            if (!p.expiryDate) return false;
            const expiryDate = new Date(p.expiryDate);
            if (isNaN(expiryDate.getTime())) return false;
            const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            return daysLeft < 0;
        }).length;

        const totalUsersCount = usersList.length;

        const todayProductRanking = {};
        todaysTxs.forEach(tx => {
            (tx.items || []).forEach(i => {
                const qty = parseInt(i.quantity) || 0;
                if (!i.name || qty <= 0) return;
                todayProductRanking[i.name] = (todayProductRanking[i.name] || 0) + qty;
            });
        });
        const topProductsToday = Object.entries(todayProductRanking)
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

        renderDashboardDOM(revenue, todaysTxs.length, totalProductsCount, lowStockItemsCount, noStockItemsCount, totalUsersCount, expiringSoonCount, expiredCount, topProductsToday);
        renderWeeklyTrend(uniqueTxs);

        if (productsList.length > 0) globalProducts = productsList;
        refreshLowStockBadge();
        checkBackupHealthBanner();

    } catch (e) {
        console.warn('Dashboard Analytics Pipeline Fallback Invoked:', e);

        const cachedTxs = JSON.parse(localStorage.getItem('cached_transactions') ||'[]');
        const cachedProds = JSON.parse(localStorage.getItem('cached_products') ||'[]');

        const today = new Date();
        const cy = today.getFullYear(), cm = today.getMonth(), cd = today.getDate();
        const cachedTodayTxs = cachedTxs.filter(tx => {
            let d = new Date(tx.isoDate || tx.timestamp || tx.date);
            return !isNaN(d.getTime()) && d.getFullYear() === cy && d.getMonth() === cm && d.getDate() === cd;
        });

        const cachedRevenue = cachedTodayTxs.reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);
        const lowStockCount = cachedProds.filter(p => {
            const s = parseInt(p.stock) || 0;
            const th = (p.lowStockThreshold !== undefined && p.lowStockThreshold !== null && p.lowStockThreshold !=='') ? parseInt(p.lowStockThreshold) : 5;
            return s > 0 && s <= th;
        }).length;
        const noStockCount = cachedProds.filter(p => (parseInt(p.stock) || 0) <= 0).length;
        const cachedExpiringSoonCount = cachedProds.filter(p => {
            if (!p.expiryDate) return false;
            const expiryDate = new Date(p.expiryDate);
            if (isNaN(expiryDate.getTime())) return false;
            const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            return daysLeft >= 0 && daysLeft <= 7;
        }).length;
        const cachedExpiredCount = cachedProds.filter(p => {
            if (!p.expiryDate) return false;
            const expiryDate = new Date(p.expiryDate);
            if (isNaN(expiryDate.getTime())) return false;
            const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            return daysLeft < 0;
        }).length;

        renderDashboardDOM(cachedRevenue, cachedTodayTxs.length, cachedProds.length, lowStockCount, noStockCount, 0, cachedExpiringSoonCount, cachedExpiredCount);
        renderWeeklyTrend(cachedTxs);
    }
}

// --------------------------------------------------------------
// BACKUP HEALTH WARNING (Admin-only)
// --------------------------------------------------------------
// FIX: dating tahimik lang na nabibigo sa likod ang scheduled local
// database backup (console.error na lang sa server) — walang paraan ang
// Admin na malaman ito maliban kung titingnan nila mismo ang server
// logs. Dito, kinukuha ang persisted backup status (tingnan ang
// recordBackupStatus/getBackupStatus sa db.js) at ipinapakita bilang
// isang hindi mapapansing warning banner kapag paulit-ulit nang
// nabibigo ang backup (2+ sunod-sunod na pagkakataon).
let backupHealthWarningShown = false;

async function checkBackupHealthBanner() {
    const isAdmin = currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin';
    if (!isAdmin || backupHealthWarningShown) return;

    try {
        const res = await authFetch(`${API_URL}/system/backup-status`);
        if (!res.ok) return;
        const data = await res.json();
        const status = data && data.status;
        if (!status || (status.consecutiveFailures || 0) < 2) return;

        backupHealthWarningShown = true;
        const lastOk = status.lastSuccessAt
            ? new Date(status.lastSuccessAt).toLocaleString('en-PH')
            :'wala pang matagumpay na backup';

        Swal.fire({
            icon:'warning',
            title:'Nabibigo ang Auto-Backup',
            html: `Nabigo na ang scheduled database backup nang <b>${status.consecutiveFailures}</b> sunod-sunod na beses.<br>
                   Huling matagumpay na backup: <b>${lastOk}</b>.<br>
                   <small style="color:#64748b;">${escapeHtml(status.lastFailureMessage || '')}</small><br><br>
                   Puwedeng dahilan: puno na ang storage, o walang write permission sa backup folder. Kontakin ang developer/IT support kung magpapatuloy ito.`,
            confirmButtonText:'Naintindihan'
        });
    } catch (e) {
        // Tahimik na huwag pansinin — hindi ito dapat makasira sa
        // normal na dashboard load kung sakaling hindi ma-reach ang
        // bagong endpoint (hal. lumang server na hindi pa naka-update).
    }
}

function renderOverviewGreeting() {
    const greetEl = document.getElementById('overview-greeting');
    const subEl = document.getElementById('overview-subdate');
    const roleEl = document.getElementById('overview-role-badge');
    if (!greetEl) return;

    const now = new Date();
    const hour = now.getHours();
    let timeGreeting ='Magandang araw';
    if (hour < 12) timeGreeting ='Magandang umaga';
    else if (hour < 18) timeGreeting ='Magandang hapon';
    else timeGreeting ='Magandang gabi';

    const activeUser = currentUser || JSON.parse(localStorage.getItem('posa_user') ||'null');
    const displayName = (activeUser && (activeUser.username || activeUser.name)) ||'Admin';

    greetEl.innerText = `${timeGreeting}, ${displayName}!`;
    if (subEl) {
        subEl.innerText = now.toLocaleDateString('en-PH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    }
    if (roleEl) {
        roleEl.innerText = (activeUser && activeUser.role) ? activeUser.role :'Admin';
    }
}

// Advanced viewing touch: animated "count up" para sa mga numeric metric
// sa Overview (sa halip na biglang lumitaw ang bagong bilang), mula sa
// dating naka-display na value patungo sa bagong value. Ligtas ito kahit
// paulit-ulit na tawagin (hal. tuwing mag-refresh ang dashboard) — hindi
// ito magiging sanhi ng tumatambak na animation frames dahil isang
// requestAnimationFrame loop lamang ang ginagamit kada tawag.
function animateOverviewCountUp(el, targetValue, duration = 650) {
    if (!el) return;
    const target = Number(targetValue) || 0;
    const startValue = Number(el.getAttribute('data-count')) || 0;

    if (startValue === target) {
        el.innerText = target;
        el.setAttribute('data-count', target);
        return;
    }

    const startTime = performance.now();
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        const currentValue = Math.round(startValue + (target - startValue) * eased);
        el.innerText = currentValue;
        if (progress < 1) {
            requestAnimationFrame(tick);
        } else {
            el.innerText = target;
            el.setAttribute('data-count', target);
        }
    }
    requestAnimationFrame(tick);
}

// Advanced viewing touch: pina-pa-play ulit ang staggered entrance
// animation (".ov-anim", tingnan ang style.css) tuwing binubuksan/
// binabalikan ang Overview view — hindi lang sa unang page load. Sa CSS
// keyframe animation, isang beses lamang tumatakbo ang animation sa
// unang paglabas ng element sa DOM, kaya kailangan itong "i-restart" sa
// pamamagitan ng pag-alis at muling pagdagdag ng class (na may forced
// reflow sa pagitan) para maulit ang buong entrance sequence.
function replayOverviewEntranceAnimation() {
    const overviewSection = document.getElementById('view-overview');
    if (!overviewSection) return;
    const animatedEls = overviewSection.querySelectorAll('.ov-anim');
    animatedEls.forEach(el => el.classList.remove('ov-anim'));
    // eslint-disable-next-line no-unused-expressions
    void overviewSection.offsetWidth; // force reflow para "mareset" ang animation state
    animatedEls.forEach(el => el.classList.add('ov-anim'));
}

function renderWeeklyTrend(txList) {
    const container = document.getElementById('overview-trend-bars');
    if (!container) return;

    const list = Array.isArray(txList) ? txList : [];
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d);
    }

    const totals = days.map(day => {
        return list.reduce((sum, tx) => {
            const timestamp = tx && (tx.isoDate || tx.timestamp || tx.date);
            if (!timestamp) return sum;
            const txDate = new Date(timestamp);
            if (isNaN(txDate.getTime())) return sum;
            const sameDay = txDate.getFullYear() === day.getFullYear() &&
                            txDate.getMonth() === day.getMonth() &&
                            txDate.getDate() === day.getDate();
            return sameDay ? sum + (parseFloat(tx.total) || 0) : sum;
        }, 0);
    });

    const maxVal = Math.max(...totals, 1);
    const dayLabels = days.map(d => d.toLocaleDateString('en-PH', { weekday:'short' }));
    const isToday = (idx) => idx === totals.length - 1;

    container.innerHTML = totals.map((val, idx) => {
        const heightPct = val > 0 ? Math.max((val / maxVal) * 100, 6) : 2;
        return `
            <div class="trend-bar-col" title="₱${val.toFixed(2)}">
                <div class="trend-bar${isToday(idx) ?' is-today' :''}" data-target-height="${heightPct}" style="height:0%"></div>
                <span class="trend-bar-label">${dayLabels[idx]}</span>
            </div>`;
    }).join('');

    // Advanced viewing touch: patubuin ang mga bar paakyat mula sa 0
    // patungo sa totoong height nila (sa halip na biglang lumitaw na
    // naka-full height agad), gamit ang CSS transition na naka-set na sa
    // .trend-bar (tingnan ang style.css). Dalawang animation frame ang
    // hinihintay bago i-set ang target height para tiyaking na-paint na
    // muna ang browser ng 0% na estado bago ang transition.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            container.querySelectorAll('.trend-bar[data-target-height]').forEach(bar => {
                bar.style.height = `${bar.getAttribute('data-target-height')}%`;
            });
        });
    });
}

function renderDashboardDOM(revenue, orders, products, lowStock, noStock, users, expiringSoon = 0, expired = 0, topProductsToday = []) {
    const revenueElem = document.getElementById('metric-revenue');
    const ordersElem = document.getElementById('metric-orders');
    const productsElem = document.getElementById('metric-products-count');
    const lowStockElem = document.getElementById('metric-low-stock');
    const noStockElem = document.getElementById('metric-no-stock');
    const usersElem = document.getElementById('metric-users-count');
    const expiringSoonElem = document.getElementById('metric-expiring-soon');
    const expiredElem = document.getElementById('metric-expired');

    if (revenueElem) revenueElem.innerText = `₱${revenue.toFixed(2)}`;
    if (ordersElem) ordersElem.innerText = orders;
    if (productsElem) productsElem.innerText = products;
    if (lowStockElem) lowStockElem.innerText = lowStock;
    if (noStockElem) noStockElem.innerText = noStock;
    if (usersElem) usersElem.innerText = users;
    if (expiringSoonElem) expiringSoonElem.innerText = expiringSoon;
    if (expiredElem) expiredElem.innerText = expired;

    const ovTopSellerElem = document.getElementById('metric-ov-top-seller');
    const ovOrdersElem = document.getElementById('metric-ov-orders');
    const ovLowStockElem = document.getElementById('metric-ov-lowstock');
    if (ovTopSellerElem) {
        ovTopSellerElem.innerText = (topProductsToday && topProductsToday.length > 0)
            ? `${topProductsToday[0].name} (${topProductsToday[0].qty})`
            :'No sale';
    }
    if (ovOrdersElem) animateOverviewCountUp(ovOrdersElem, orders);
    if (ovLowStockElem) animateOverviewCountUp(ovLowStockElem, lowStock);

    const ovTopProductsListEl = document.getElementById('overview-top-products-list');
    if (ovTopProductsListEl) {
        if (!topProductsToday || topProductsToday.length === 0) {
            ovTopProductsListEl.innerHTML ='<li style="color:#94a3b8; list-style:none; padding-left:0;">No sale/transaction done today.</li>';
        } else {
            ovTopProductsListEl.innerHTML = topProductsToday.map((p, idx) =>
                `<li><strong>#${idx + 1} ${escapeHtml(p.name)}</strong> — ${p.qty} units sold today</li>`
            ).join('');
        }
    }
}

async function loadTerminalCatalog() {
    try {
        const response = await authFetch(`${API_URL}/products`);
        globalProducts = await response.json();
        localStorage.setItem('cached_products', JSON.stringify(globalProducts));
        updateCategoryChipsDynamic();
        updateDropdownCategoriesDynamic();
        renderTerminalProducts();
    } catch (e) {
        console.warn('Terminal Catalog: Local offline fallback active. Retaining local environmental storage matrix snapshots.');
        globalProducts = JSON.parse(localStorage.getItem('cached_products') ||'[]');
        updateCategoryChipsDynamic();
        updateDropdownCategoriesDynamic();
        renderTerminalProducts();
    }
}

// ADAPTIVE STOCK-POLL CADENCE
// --------------------------------------------------------------
// DATING GAWI: fixed na 1-second setInterval, kahit isa lang ang bukas
// na terminal at wala namang ibang session na maaaring makipag-agawan sa
// stock — sayang na load/battery kapag ganito, at ito rin ang pinakamalaki
// pala na sanhi ng "pabagal" na feel habang nagbi-benta (kada segundo,
// buong products list + full re-render).
//
// NGAYON: self-adjusting ang cadence, walang dagdag na network call
// (ginagamit lang ang X-Active-Terminals header na piggyback na sa
// parehong /api/products response na tinatawag na dati):
//   - MABILIS (1s): kapag MARAMI ang aktibong terminal/session (>1) AT
//     10 items pababa lang ang laman ng cart (mababang cost i-render pa
//     rin kahit mabilis) — dito talaga kailangan ng near-real-time para
//     hindi mag-overselling sa pagitan ng ibang terminal.
//   - MABAGAL (5s): kapag iisa lang ang bukas na terminal (walang
//     kakumpitensyang session), o malaki na ang cart (mas mahal nang
//     i-render kada segundo).
let lastKnownActiveTerminalCount = 1;

function getAdaptiveStockPollDelayMs() {
    const manyTerminalsActive = lastKnownActiveTerminalCount > 1;
    const cartIsSmall = shoppingCart.length <= 10;
    return (manyTerminalsActive && cartIsSmall) ? 1000 : 5000;
}

function updateActiveTerminalCountFromResponse(response) {
    const header = response && response.headers && response.headers.get('X-Active-Terminals');
    const parsed = parseInt(header, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
        lastKnownActiveTerminalCount = parsed;
    }
}

let terminalStockPollTimer = null;
let terminalStockPollActive = false;

function startTerminalStockPolling() {
    stopTerminalStockPolling();
    terminalStockPollActive = true;
    scheduleTerminalStockPoll();
}

function scheduleTerminalStockPoll() {
    if (!terminalStockPollActive) return;
    terminalStockPollTimer = setTimeout(async () => {
        await silentRefreshTerminalStock();
        scheduleTerminalStockPoll();
    }, getAdaptiveStockPollDelayMs());
}

function stopTerminalStockPolling() {
    terminalStockPollActive = false;
    if (terminalStockPollTimer) {
        clearTimeout(terminalStockPollTimer);
        terminalStockPollTimer = null;
    }
}

async function silentRefreshTerminalStock() {

    const paymentModalEl = document.getElementById('payment-modal');
    if (paymentModalEl && paymentModalEl.style.display ==='flex') return;

    try {
        const response = await authFetch(`${API_URL}/products`);
        if (!response.ok) return;
        updateActiveTerminalCountFromResponse(response);
        const freshProducts = await response.json();
        if (!Array.isArray(freshProducts)) return;
        globalProducts = freshProducts;
        localStorage.setItem('cached_products', JSON.stringify(globalProducts));
        renderTerminalProducts();
    } catch (e) {

    }
}

let inventoryStockPollTimer = null;
let inventoryStockPollActive = false;

function startInventoryStockPolling() {
    stopInventoryStockPolling();
    inventoryStockPollActive = true;
    scheduleInventoryStockPoll();
}

function scheduleInventoryStockPoll() {
    if (!inventoryStockPollActive) return;
    inventoryStockPollTimer = setTimeout(async () => {
        await silentRefreshInventoryStock();
        scheduleInventoryStockPoll();
    }, getAdaptiveStockPollDelayMs());
}

function stopInventoryStockPolling() {
    inventoryStockPollActive = false;
    if (inventoryStockPollTimer) {
        clearTimeout(inventoryStockPollTimer);
        inventoryStockPollTimer = null;
    }
}

async function silentRefreshInventoryStock() {

    const productModalEl = document.getElementById('product-modal');
    if (productModalEl && productModalEl.style.display ==='flex') return;

    try {
        const res = await authFetch(`${API_URL}/products`);
        if (!res.ok) return;
        updateActiveTerminalCountFromResponse(res);
        const freshProducts = await res.json();
        if (!Array.isArray(freshProducts)) return;
        cachedInventoryProducts = freshProducts;
        renderInventoryProductsTable();
    } catch (e) {

    }
}

// --------------------------------------------------------------
// REORDER ALERTS — LIVE POLLING
// --------------------------------------------------------------
// FIX: dating isang beses lang tinatawag ang loadReorderView() — sa
// mismong sandali ng pagpasok sa 'reorder' view (tingnan ang switchView()).
// Kaya kapag may bagong benta/restock na nangyari sa IBANG terminal/device
// habang bukas pa rin ang Reorder Alerts page mo, hindi ito nagpapakita ng
// bagong low-stock item hangga't hindi ka aalis sa view (o mag re-refresh
// ng buong page). Dinagdagan ito ng parehong adaptive polling na ginagamit
// na ng Terminal/Products views, para awtomatikong lumabas ang bagong
// low-stock/out-of-stock item habang nakabukas lang ang page.
let reorderPollTimer = null;
let reorderPollActive = false;

function startReorderPolling() {
    stopReorderPolling();
    reorderPollActive = true;
    scheduleReorderPoll();
}

function scheduleReorderPoll() {
    if (!reorderPollActive) return;
    reorderPollTimer = setTimeout(async () => {
        await silentRefreshReorderView();
        scheduleReorderPoll();
    }, getAdaptiveStockPollDelayMs());
}

function stopReorderPolling() {
    reorderPollActive = false;
    if (reorderPollTimer) {
        clearTimeout(reorderPollTimer);
        reorderPollTimer = null;
    }
}

async function silentRefreshReorderView() {
    // Huwag munang mag-refresh habang may bukas na Create PO modal (SweetAlert)
    // sa ibabaw ng reorder page — baka mabura/mareset ang kanilang in-progress
    // na pag-eedit ng quantity/supplier bago pa nila ma-submit ang PO.
    if (typeof Swal !=='undefined' && Swal.isVisible && Swal.isVisible()) return;

    try {
        const [lowStockRes, poRes] = await Promise.all([
            authFetch(`${API_URL}/products/low-stock`),
            authFetch(`${API_URL}/purchase-orders`)
        ]);
        if (!lowStockRes.ok || !poRes.ok) return;
        const lowStockData = await lowStockRes.json();
        const poData = await poRes.json();
        reorderItemsCache = (lowStockData && lowStockData.items) || [];
        reorderPOCache = (poData && poData.orders) || [];
        renderReorderStats();
        renderReorderTable();
        renderPurchaseOrdersTable();
    } catch (e) {

    }
}

function getCategoryIconClass(category) {
    const iconDictionary = {
'Beverages':'fa-solid fa-wine-glass',
'Dairy':'fa-solid fa-glass-water',
'Snacks':'fa-solid fa-cookie',
'Bakery':'fa-solid fa-bread-slice',
'Grains':'fa-solid fa-wheat-awn'
    };
    return iconDictionary[category] ||'fa-solid fa-box';
}

function renderTerminalProducts() {
    const searchBox = document.getElementById('terminal-search');
    const searchString = searchBox ? searchBox.value.toLowerCase() :'';
    const gridOutput = document.getElementById('terminal-grid-output');
    if (!gridOutput) return;

    try {
        gridOutput.innerHTML ='';

        const filtered = globalProducts.filter(p => {
            const matchesCategory = (activeTerminalCategory ==='All' || p.category === activeTerminalCategory);
            const pName = (p.name ||'').toLowerCase();
            const pCode = (p.code ||'').toLowerCase();
            const matchesQuery = (pName.includes(searchString) || pCode.includes(searchString));
            return matchesCategory && matchesQuery;
        });

        filtered.forEach(p => {
            try {

                const cartItem = shoppingCart.find(item => item.code === p.code);
                const qtyInCart = cartItem ? cartItem.quantity : 0;

                const availableStock = Math.max(0, (parseFloat(p.stock) || 0) - qtyInCart);

                const card = document.createElement('div');

                card.className = `t-product-card ${availableStock <= 0 ?'out-of-stock' :''}`;

                let iconClass = getCategoryIconClass(p.category);

                card.innerHTML = `
                    <div class="t-prod-icon" onclick="event.stopPropagation(); showProductDetails('${escapeHtml(p.code)}')" title="Tingnan ang detalye">${p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name ||'Product')}">` : `<i class="${iconClass}"></i>`}</div>
                    <h4>${escapeHtml(p.name ||'Unnamed Product')}</h4>
                    <div class="t-prod-price">₱${(parseFloat(p.price) || 0).toFixed(2)}</div>
                    <div class="t-prod-stock">Stock: ${availableStock}</div>
                `;
                card.onclick = () => addItemToCart(p);
                attachInstantTapFeedback(card, { hapticMs: 12 });
                gridOutput.appendChild(card);
            } catch (cardError) {

                console.error("Nilaktawan ang isang produkto dahil sa error sa card render:", p, cardError);
            }
        });
    } catch (renderError) {
        console.error("Nabigo ang pag-render ng Terminal product list:", renderError);
    }
}

function filterTerminalCategory(cat) {
    activeTerminalCategory = cat;
    document.querySelectorAll('#category-chips .chip').forEach(c => {
        if(c.innerText === cat) c.classList.add('active');
        else c.classList.remove('active');
    });
    renderTerminalProducts();
}

let productDetailsModalCode = null;

function showProductDetails(code, context ='pos') {
    const p = globalProducts.find(prod => prod.code === code) || cachedInventoryProducts.find(prod => prod.code === code);
    if (!p) return;

    productDetailsModalCode = code;

    const cartItem = shoppingCart.find(item => item.code === p.code);
    const qtyInCart = cartItem ? cartItem.quantity : 0;
    const availableStock = Math.max(0, (parseFloat(p.stock) || 0) - qtyInCart);

    const photoBox = document.getElementById('pd-photo-box');
    if (photoBox) {
        const iconClass = getCategoryIconClass(p.category);
        photoBox.innerHTML = p.image
            ? `<img src="${p.image}" alt="${(p.name ||'Product').replace(/"/g,'&quot;')}">`
            : `<i class="${iconClass}"></i>`;
    }

    document.getElementById('pd-modal-title').innerText = p.name ||'Unnamed Product';
    document.getElementById('pd-code').innerText = p.code;
    document.getElementById('pd-category').innerText = p.category ||'—';
    document.getElementById('pd-price').innerText = `₱${(parseFloat(p.price) || 0).toFixed(2)}`;
    document.getElementById('pd-stock-label').innerText = (context ==='inventory') ?'Current Stock' :'Available Stock';
    document.getElementById('pd-stock').innerText = (context ==='inventory') ? (parseFloat(p.stock) || 0) : availableStock;

    const supplierRow = document.getElementById('pd-supplier-row');
    if (p.supplier) {
        document.getElementById('pd-supplier').innerText = p.supplier;
        supplierRow.style.display ='flex';
    } else {
        supplierRow.style.display ='none';
    }

    const expiryRow = document.getElementById('pd-expiry-row');
    if (p.expiryDate) {
        document.getElementById('pd-expiry').innerText = p.expiryDate;
        expiryRow.style.display ='flex';
    } else {
        expiryRow.style.display ='none';
    }

    const addBtn = document.getElementById('pd-add-to-cart-btn');
    if (addBtn) {
        if (context ==='inventory') {
            addBtn.disabled = false;
            addBtn.innerText ='Edit Product';
            addBtn.onclick = editProductFromDetailsModal;
        } else if (availableStock <= 0) {
            addBtn.disabled = true;
            addBtn.innerText ='Out of Stock';
            addBtn.onclick = addProductFromDetailsModal;
        } else {
            addBtn.disabled = false;
            addBtn.innerText ='Add to Cart';
            addBtn.onclick = addProductFromDetailsModal;
        }
    }

    document.getElementById('product-details-modal').style.display ='flex';
}

function addProductFromDetailsModal() {
    if (!productDetailsModalCode) return;
    const p = globalProducts.find(prod => prod.code === productDetailsModalCode);
    if (!p) return;
    if (addItemToCart(p)) {
        closeModal('product-details-modal');
    }
}

function editProductFromDetailsModal() {
    if (!productDetailsModalCode) return;
    const code = productDetailsModalCode;
    closeModal('product-details-modal');
    openProductModal('UPDATE', code);
}

function addItemToCart(product) {
    if(product.stock <= 0) return false;

    const existing = shoppingCart.find(item => item.code === product.code);
    if(existing) {
        if(existing.quantity < product.stock) {
            existing.quantity++;
        } else {
            Swal.fire('Stock Limit','Cannot exceed available stock bounds.','warning');
            return false;
        }
    } else {
        shoppingCart.push({ ...product, quantity: 1 });
    }
    renderCartRows();
    return true;
}

async function adjustCartQty(code, adjustment) {
    const item = shoppingCart.find(i => i.code === code);
    if (!item) return;

    const newQuantity = item.quantity + adjustment;

    if (newQuantity <= 0) {
        const isAdmin = currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin';
        let authMethod ="";

        if (!isAdmin) {
            const { value: adminPassword } = await Swal.fire({
                title:'🔒 Supervisor Override Requested',
                html: `Quantity reduction to zero for <b>${escapeHtml(item.name)}</b> will remove this item. Kailangan ng Admin o awtorisadong Supervisor/Manager password:`,
                input:'password',
                inputPlaceholder:'Admin/Supervisor password',
                showCancelButton: true,
                confirmButtonColor:'#2563eb',
                cancelButtonColor:'#ef4444'
            });

            if (!adminPassword || adminPassword.trim() ==="") {
                Swal.fire('Cancelled','Operation Cancelled: Item quantity reduction aborted.','info');
                return;
            }

            try {
                const response = await authFetch(`${API_URL}/auth/verify-void`, {
                    method:'POST',
                    headers: {'Content-Type':'application/json' },
                    body: JSON.stringify({ adminPassword: adminPassword, purpose:'void' })
                });

                const data = await response.json();

                if (!data.success) {
                    Swal.fire('Authorization Rejected', data.message,'error');
                    return;
                }

                authMethod ="PASSWORD_VERIFIED";
            } catch (error) {
                console.error(error);
                Swal.fire('Pipeline Connection Error','Failed to complete secure supervisor authorization procedures.','error');
                return;
            }

        } else {
            const result = await Swal.fire({
                title:'⚠️ Administrative Deletion',
                text: `Are you certain you want to reduce quantity to zero and remove product asset "${item.name}" from the active cart?`,
                icon:'warning',
                showCancelButton: true,
                confirmButtonColor:'#ef4444',
                cancelButtonColor:'#64748b',
                confirmButtonText:'Yes, remove it'
            });
            if (!result.isConfirmed) return;
            authMethod ="ADMIN_BYPASS";
        }

        try {
            await authFetch(`${API_URL}/logs`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({
                    action: `VOID_ITEM`,
                    username: currentUser ? currentUser.username :"Unknown Cashier",
                    user: currentUser ? currentUser.username :"Unknown Cashier",
                    authMethod: authMethod,
                    details: {
                        itemCode: code,
                        itemName: item.name,
                        quantity: item.quantity,
                        priceEach: item.price,
                        totalAmount: (item.price * item.quantity),
                        message: `Item reduced to 0 quantity via minus button (${authMethod}).`
                    }
                })
            });
        } catch (logError) {
            console.error(logError);
        }

        shoppingCart = shoppingCart.filter(i => i.code !== code);
        renderCartRows();
        Swal.fire('Success', `Item asset [ ${item.name} ] extracted from memory array lines successfully.`,'success');
        return;
    }

    const origin = globalProducts.find(p => p.code === code);
    if (origin && newQuantity > origin.stock) {
        Swal.fire('Stock Limit','Cannot exceed available stock bounds.','warning');
        item.quantity = origin.stock;
    } else {
        item.quantity = newQuantity;
    }

    renderCartRows();
}

async function setCartQty(code, rawValue) {
    const item = shoppingCart.find(i => i.code === code);
    if (!item) return;

    const newQuantity = parseInt(rawValue, 10);

    if (isNaN(newQuantity) || newQuantity < 0) {
        renderCartRows();
        return;
    }

    const adjustment = newQuantity - item.quantity;
    if (adjustment === 0) {
        renderCartRows();
        return;
    }

    await adjustCartQty(code, adjustment);
}

async function removeCartItem(code) {
    const targetItem = shoppingCart.find(i => i.code === code);
    if (!targetItem) return;

    const isAdmin = currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin';
    let authMethod ="";

    if (!isAdmin) {
        const { value: adminPassword } = await Swal.fire({
            title:'🔒 Supervisor Override Requested',
            html: `Kailangan ng Admin o awtorisadong Supervisor/Manager password para i-void ang <b>${escapeHtml(targetItem.name)}</b> mula sa active checkout.`,
            input:'password',
            inputPlaceholder:'Admin/Supervisor password',
            showCancelButton: true,
            confirmButtonColor:'#2563eb',
            cancelButtonColor:'#ef4444'
        });

        if (!adminPassword || adminPassword.trim() ==="") {
            Swal.fire('Cancelled','Operation Cancelled: Line item void procedures aborted.','info');
            return;
        }

        try {
            const response = await authFetch(`${API_URL}/auth/verify-void`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ adminPassword: adminPassword, purpose:'void' })
            });

            const data = await response.json();

            if (!data.success) {
                Swal.fire('Authorization Rejected', data.message,'error');
                return;
            }

            authMethod ="PASSWORD_VERIFIED";
        } catch (error) {
            console.error(error);
            Swal.fire('Pipeline Error','Failed to complete secure supervisor authorization tracking procedures.','error');
            return;
        }

    } else {
        const result = await Swal.fire({
            title:'⚠️ Administrative Deletion',
            text: `Are you certain you want to purge and void line item allocation parameters maps for product entries asset "${targetItem.name}" from the active cart?`,
            icon:'warning',
            showCancelButton: true,
            confirmButtonColor:'#ef4444',
            cancelButtonColor:'#64748b',
            confirmButtonText:'Yes, purge it'
        });
        if (!result.isConfirmed) return;
        authMethod ="ADMIN_BYPASS";
    }

    try {
        await authFetch(`${API_URL}/logs`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({
                action: `VOID_ITEM`,
                username: currentUser ? currentUser.username :"Unknown Cashier",
                user: currentUser ? currentUser.username :"Unknown Cashier",
                authMethod: authMethod,
                details: {
                    itemCode: code,
                    itemName: targetItem.name,
                    quantity: targetItem.quantity,
                    priceEach: targetItem.price,
                    totalAmount: (targetItem.price * targetItem.quantity),
                    message: `Line item voided and purged directly via X button (${authMethod}).`
                }
            })
        });
    } catch (logError) {
        console.error(logError);
    }

    shoppingCart = shoppingCart.filter(i => i.code !== code);
    renderCartRows();
    Swal.fire('Voided', `Item asset identifier profile [ ${targetItem.name} ] voided and extracted successfully.`,'success');
}

async function handleClearCart() {
    if (shoppingCart.length === 0) {
        Swal.fire('Empty Cart','Operation Aborted: The shopping cart is completely empty.','warning');
        return;
    }

    const itemsCount = shoppingCart.length;
    const totalAmount = shoppingCart.reduce((total, item) => total + ((item.price || 0) * (item.quantity || 1)), 0);
    const username = currentUser ? (currentUser.username || currentUser.name) :"Unknown User";

    const sendVoidLog = async (authMethod) => {
        try {
            await authFetch(`${API_URL}/logs`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({
                    action:"VOID_CART",
                    user: username,
                    authMethod: authMethod,
                    details: { itemsCount: itemsCount, totalAmount: totalAmount }
                })
            });
        } catch (logError) {
            console.error(logError);
        }
    };

    if (currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin') {
        await sendVoidLog("ADMIN_BYPASS");
        shoppingCart = [];
        renderCartRows();
        Swal.fire('Cleared','Administrative Clearance: Transaction basket architecture cleared and recorded successfully.','success');
        return;
    }

    const { value: adminPassword } = await Swal.fire({
        title:'⚠️ Transaction Void Command Request',
        html:'Kailangan ng Admin o awtorisadong Supervisor/Manager password para dito:',
        input:'password',
        inputPlaceholder:'Admin/Supervisor password',
        showCancelButton: true,
        confirmButtonColor:'#2563eb',
        cancelButtonColor:'#ef4444'
    });

    if (!adminPassword || adminPassword.trim() ==="") {
        Swal.fire('Aborted','Request Aborted: Master basket void process canceled. Missing credentials.','info');
        return;
    }

    try {
        const response = await authFetch(`${API_URL}/auth/verify-void`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ adminPassword: adminPassword, purpose:'void' })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            await sendVoidLog("PASSWORD_VERIFIED");
            shoppingCart = [];
            renderCartRows();
            Swal.fire('Cleared','Administrative Clearance Granted: Transaction cart schema cleared and record elements voided successfully.','success');
        } else {
            Swal.fire('Access Violation', data.message ||"Invalid credential token authorization parameters. Command rejected.",'error');
        }
    } catch (error) {
        console.error(error);
        Swal.fire('Pipeline Error','Unable to contact remote host engine. Administrative token validation cannot proceed.','error');
    }
}

function clearCart() {
    shoppingCart = [];
    renderCartRows();
}

function renderCartRows() {

    try {
        const container = document.getElementById('cart-items-container');
        if (!container) return;
        if (shoppingCart.length === 0) resetCartDiscountAndCustomerState();
        container.innerHTML ='';

        saveCartToDatabase();

        let totalItems = 0;
        shoppingCart.forEach(item => {
            try {
                totalItems += item.quantity;
                const row = document.createElement('div');
                row.className ='cart-item-row';
                const lineDiscount = Math.max(0, parseFloat(item.itemDiscount) || 0);
                const lineTotal = Math.max(0, (item.price * item.quantity) - lineDiscount);
                row.innerHTML = `
                    <div class="cart-item-details">
                        <h4>${escapeHtml(item.name)}</h4>
                        <p>₱${parseFloat(item.price).toFixed(2)} each</p>
                        <p class="cart-item-discount-row" style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                            <span style="font-size:0.8em;color:#94a3b8;">Discount ₱</span>
                            <input type="number"
                                   class="cart-item-discount-input"
                                   min="0"
                                   step="0.01"
                                   inputmode="decimal"
                                   value="${lineDiscount ||''}"
                                   placeholder="0.00"
                                   style="width:70px;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:0.85em;"
                                   onclick="this.select()"
                                   onchange="setCartItemDiscount('${escapeHtml(item.code)}', this.value)">
                        </p>
                    </div>
                    <div class="quantity-control-buttons-block">
                        <button onclick="adjustCartQty('${escapeHtml(item.code)}', -1)">-</button>
                        <input type="number"
                               class="cart-qty-input"
                               min="0"
                               step="1"
                               inputmode="numeric"
                               value="${item.quantity}"
                               onclick="this.select()"
                               onchange="setCartQty('${escapeHtml(item.code)}', this.value)"
                               onkeydown="if(event.key==='Enter'){ this.blur(); }">
                        <button onclick="adjustCartQty('${escapeHtml(item.code)}', 1)">+</button>
                    </div>
                    <div class="cart-item-total-price-pane">
                        <span>₱${lineTotal.toFixed(2)}</span>
                        <i class="fa-solid fa-xmark" onclick="removeCartItem('${escapeHtml(item.code)}')"></i>
                    </div>
                `;
                container.appendChild(row);
            } catch (rowError) {

                console.error("Nilaktawan ang isang cart row dahil sa error:", item, rowError);
            }
        });

        const cartBadge = document.getElementById('cart-badge');
        if (cartBadge) cartBadge.innerText = totalItems;
        updateCartTotals();
    } catch (cartRenderError) {
        console.error("Nabigo ang pag-render ng cart rows:", cartRenderError);
    } finally {

        if (typeof renderTerminalProducts ==='function') {
            renderTerminalProducts();
        }
    }
}

function setCartItemDiscount(code, rawValue) {
    const item = shoppingCart.find(i => i.code === code);
    if (!item) return;
    let val = parseFloat(rawValue) || 0;
    if (val < 0) val = 0;
    const maxDiscount = item.price * item.quantity;
    if (val > maxDiscount) val = maxDiscount;
    item.itemDiscount = val;
    updateCartTotals();
}

function getCartNetSubtotal() {
    return shoppingCart.reduce((sum, item) => {
        const lineDiscount = Math.max(0, parseFloat(item.itemDiscount) || 0);
        return sum + Math.max(0, (item.price * item.quantity) - lineDiscount);
    }, 0);
}

function updateCartTotals() {

    const discountInput = document.getElementById('cart-discount-input');
    const subtotalEl = document.getElementById('summary-subtotal');
    const totalEl = document.getElementById('summary-total');

    let subtotal = getCartNetSubtotal();
    let discount = parseFloat(discountInput ? discountInput.value : 0) || 0;
    let total = Math.max(0, subtotal - discount);

    if (subtotalEl) subtotalEl.innerText = `₱${subtotal.toFixed(2)}`;
    if (totalEl) totalEl.innerText = `₱${total.toFixed(2)}`;
}

function handleManualDiscountInput() {
    cartDiscountType ='MANUAL';
    cartPromoCode ='';
    cartSeniorPwdId ='';
    const checkbox = document.getElementById('cart-senior-pwd-toggle');
    if (checkbox) checkbox.checked = false;
    updateCartTotals();
}

function toggleSeniorPwdDiscount() {
    const checkbox = document.getElementById('cart-senior-pwd-toggle');
    const discountInput = document.getElementById('cart-discount-input');
    if (!checkbox || !discountInput) return;

    if (checkbox.checked) {
        let subtotal = getCartNetSubtotal();
        if (subtotal <= 0) {
            Swal.fire('Empty Cart','Magdagdag muna ng item sa cart.','warning');
            checkbox.checked = false;
            return;
        }
        Swal.fire({
            title:'Senior Citizen / PWD Discount',
            text:'Ilagay ang ID Number para sa resibo (RA 9994 / RA 10754 — 20% discount):',
            input:'text',
            inputPlaceholder:'Senior/PWD ID Number',
            showCancelButton: true,
            confirmButtonText:'I-apply ang 20%'
        }).then(result => {
            if (result.isConfirmed && result.value && result.value.trim()) {
                cartSeniorPwdId = result.value.trim();
                cartDiscountType ='SENIOR_PWD';
                cartPromoCode ='';
                const promoInput = document.getElementById('cart-promo-input');
                if (promoInput) promoInput.value ='';
                discountInput.value = (subtotal * 0.20).toFixed(2);
                discountInput.setAttribute('readonly', true);
                updateCartTotals();
            } else {
                checkbox.checked = false;
            }
        });
    } else {
        cartDiscountType ='NONE';
        cartSeniorPwdId ='';
        discountInput.removeAttribute('readonly');
        discountInput.value = 0;
        updateCartTotals();
    }
}

async function applyPromoCodeToCart() {
    if (guardPremiumFeature('promo_codes')) return;
    const codeInput = document.getElementById('cart-promo-input');
    const discountInput = document.getElementById('cart-discount-input');
    const code = (codeInput ? codeInput.value :'').trim().toUpperCase();
    if (!code) return;

    let subtotal = getCartNetSubtotal();
    if (subtotal <= 0) {
        Swal.fire('Empty Cart','Magdagdag muna ng item sa cart bago mag-apply ng promo code.','warning');
        return;
    }
    try {
        const res = await authFetch(`${API_URL}/promocodes/${encodeURIComponent(code)}/validate?subtotal=${subtotal}`);
        const data = await res.json();
        if (data.success) {
            const checkbox = document.getElementById('cart-senior-pwd-toggle');
            if (checkbox) checkbox.checked = false;
            cartDiscountType ='PROMO';
            cartPromoCode = code;
            cartSeniorPwdId ='';
            discountInput.value = data.discountAmount.toFixed(2);
            discountInput.setAttribute('readonly', true);
            updateCartTotals();
            Swal.fire({ icon:'success', title:'Na-apply ang Promo!', text: `${code}: -₱${data.discountAmount.toFixed(2)}`, timer: 1600, showConfirmButton: false });
        } else {
            Swal.fire('Invalid Promo Code', data.message ||'This code cannot be used.','error');
        }
    } catch (e) {
        console.warn(e);
        Swal.fire('Connection Error','Hindi makonekta sa server para i-validate ang promo code.','error');
    }
}

async function openCustomerPickerForCart() {
    if (guardPremiumFeature('customer_crm')) return;
    let customers = [];
    try {
        const res = await authFetch(`${API_URL}/customers/for-terminal`);
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            Swal.fire('Hindi Makuha ang Customers', errBody.message ||'Hindi makuha ang listahan ng customers.','error');
            return;
        }
        customers = await res.json();
        if (!Array.isArray(customers)) customers = [];
    } catch (e) {
        Swal.fire('Connection Error','Hindi makuha ang listahan ng customers.','error');
        return;
    }
    window.__swalCustomers = customers;

    const buildRowsHtml = (list) => (list.map(c =>
        `<div class="cust-pick-row" data-id="${escapeHtml(c.id)}" style="padding:10px;border-bottom:1px solid #eee;cursor:pointer;text-align:left;">
            <strong>${escapeHtml(c.name)}</strong><br><small>${escapeHtml(c.phone ||'walang phone')} · ${c.points || 0} pts</small>
        </div>`
    ).join('')) ||'<p style="padding:10px;color:#94a3b8;">Wala pang customer. Mag-add muna sa Customers page.</p>';

    const attachRowClicks = (list) => {
        document.querySelectorAll('.cust-pick-row').forEach(row => {
            row.addEventListener('click', () => {
                const cust = list.find(c => c.id === row.dataset.id);
                if (cust) {
                    selectedCartCustomer = cust;
                    const btn = document.getElementById('cart-customer-btn');
                    if (btn) btn.innerHTML = `${escapeHtml(cust.name)} <i class="fa-solid fa-chevron-right" style="font-size:0.7em;"></i>`;
                }
                Swal.close();
            });
        });
    };

    window.__filterSwalCustomerList = (q) => {
        q = (q ||'').toLowerCase();
        const list = (window.__swalCustomers || []).filter(c => (c.name ||'').toLowerCase().includes(q) || (c.phone ||'').includes(q));
        const container = document.getElementById('swal-cust-list');
        if (container) container.innerHTML = buildRowsHtml(list);
        attachRowClicks(list);
    };

    await Swal.fire({
        title:'Pumili ng Customer',
        html: `
            <input type="text" id="swal-cust-search" class="swal2-input" placeholder="Maghanap ng pangalan/phone..." oninput="window.__filterSwalCustomerList(this.value)">
            <div id="swal-cust-list" style="max-height:260px;overflow-y:auto;">${buildRowsHtml(customers)}</div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText:'Walk-in (Walang Customer)',
        didOpen: () => attachRowClicks(customers)
    });

    if (!selectedCartCustomer) return;
}

function resetCartDiscountAndCustomerState() {
    cartDiscountType ='NONE';
    cartPromoCode ='';
    cartSeniorPwdId ='';
    selectedCartCustomer = null;

    const discountInput = document.getElementById('cart-discount-input');
    if (discountInput) { discountInput.value = 0; discountInput.removeAttribute('readonly'); }
    const promoInput = document.getElementById('cart-promo-input');
    if (promoInput) promoInput.value ='';
    const seniorCheckbox = document.getElementById('cart-senior-pwd-toggle');
    if (seniorCheckbox) seniorCheckbox.checked = false;
    const customerBtn = document.getElementById('cart-customer-btn');
    if (customerBtn) customerBtn.innerHTML ='Walk-in <i class="fa-solid fa-chevron-right" style="font-size:0.7em;"></i>';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display ='none';
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    const allMethodBtns = { CASH:'pay-method-cash', GCASH:'pay-method-gcash', MAYA:'pay-method-maya', CARD:'pay-method-card' };
    const cashInput = document.getElementById('pay-modal-received-input');

    Object.entries(allMethodBtns).forEach(([key, elId]) => {
        const btn = document.getElementById(elId);
        if (!btn) return;
        btn.classList.toggle('active', key === method);
    });

    if (method ==='CASH') {
        cashInput.removeAttribute('disabled');
        cashInput.value ='';
        document.getElementById('pay-modal-change-output').innerText ='₱0.00';
    } else {

        let dueAmount = parseFloat(document.getElementById('pay-modal-amount-due').innerText.replace('₱',''));
        cashInput.value = dueAmount;
        cashInput.setAttribute('disabled', true);
        calculatePaymentChange();
    }
}

function calculatePaymentChange() {
    let dueAmount = parseFloat(document.getElementById('pay-modal-amount-due').innerText.replace('₱',''));
    let received = parseFloat(document.getElementById('pay-modal-received-input').value) || 0;
    let change = Math.max(0, received - dueAmount);

    document.getElementById('pay-modal-change-output').innerText = `₱${change.toFixed(2)}`;
}

function appendQuickCashDenomination(val) {
    if(selectedPaymentMethod !=='CASH') return;
    let inputField = document.getElementById('pay-modal-received-input');
    let current = parseFloat(inputField.value) || 0;
    inputField.value = current + val;
    calculatePaymentChange();
}

function toggleSplitPaymentMode() {
    const checkbox = document.getElementById('pay-split-toggle');
    splitPaymentMode = !!(checkbox && checkbox.checked);

    const singleBlock = document.getElementById('single-payment-mode-block');
    const splitBlock = document.getElementById('split-payment-lines-container');
    if (singleBlock) singleBlock.style.display = splitPaymentMode ?'none' :'';
    if (splitBlock) splitBlock.style.display = splitPaymentMode ?'' :'none';

    if (splitPaymentMode && splitPaymentLines.length === 0) {
        addSplitPaymentLine();
    }
    renderSplitPaymentLines();
}

function addSplitPaymentLine() {
    splitPaymentLines.push({ method:'CASH', amount: 0 });
    renderSplitPaymentLines();
}

function removeSplitPaymentLine(idx) {
    splitPaymentLines.splice(idx, 1);
    renderSplitPaymentLines();
}

function setSplitPaymentLineMethod(idx, method) {
    if (!splitPaymentLines[idx]) return;
    splitPaymentLines[idx].method = method;
}

function setSplitPaymentLineAmount(idx, rawValue) {
    if (!splitPaymentLines[idx]) return;
    splitPaymentLines[idx].amount = Math.max(0, parseFloat(rawValue) || 0);
    recalcSplitPaymentTotals();
}

function renderSplitPaymentLines() {
    const listEl = document.getElementById('split-payment-lines-list');
    if (!listEl) return;
    listEl.innerHTML = splitPaymentLines.map((line, idx) => `
        <div class="split-payment-line-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <select onchange="setSplitPaymentLineMethod(${idx}, this.value)" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;">
                <option value="CASH" ${line.method ==='CASH' ?'selected' :''}>Cash</option>
                <option value="GCASH" ${line.method ==='GCASH' ?'selected' :''}>GCash</option>
                <option value="MAYA" ${line.method ==='MAYA' ?'selected' :''}>Maya</option>
                <option value="CARD" ${line.method ==='CARD' ?'selected' :''}>Card</option>
            </select>
            <input type="number" min="0" step="0.01" value="${line.amount ||''}" placeholder="0.00"
                   style="width:110px;padding:8px;border:1px solid #ddd;border-radius:6px;"
                   onclick="this.select()"
                   oninput="setSplitPaymentLineAmount(${idx}, this.value)">
            <i class="fa-solid fa-xmark" style="cursor:pointer;color:#dc2626;" onclick="removeSplitPaymentLine(${idx})"></i>
        </div>
    `).join('');
    recalcSplitPaymentTotals();
}

function recalcSplitPaymentTotals() {
    let dueAmount = parseFloat(document.getElementById('pay-modal-amount-due').innerText.replace('₱','')) || 0;
    let allocated = splitPaymentLines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
    allocated = Math.round(allocated * 100) / 100;
    let remaining = Math.round((dueAmount - allocated) * 100) / 100;

    const allocatedEl = document.getElementById('split-payment-allocated');
    const remainingEl = document.getElementById('split-payment-remaining');
    const remainingLabel = document.getElementById('split-payment-remaining-label');
    if (allocatedEl) allocatedEl.innerText = `₱${allocated.toFixed(2)}`;
    if (remainingEl) {
        remainingEl.innerText = `₱${Math.abs(remaining).toFixed(2)}`;
        remainingEl.style.color = remaining > 0 ?'#dc2626' : (remaining < 0 ?'#16a34a' :'#0f172a');
    }
    if (remainingLabel) remainingLabel.innerText = remaining < 0 ?'Change' :'Remaining';
}

function openPaymentModal() {
    if(shoppingCart.length === 0) {
        Swal.fire('Checkout Error','Cart checkout is completely empty.','warning');
        return;
    }
    let totalString = document.getElementById('summary-total').innerText;
    document.getElementById('pay-modal-amount-due').innerText = totalString;
    document.getElementById('pay-modal-received-input').value ='';
    document.getElementById('pay-modal-change-output').innerText ='₱0.00';

    selectPaymentMethod('CASH');

    splitPaymentMode = false;
    splitPaymentLines = [];
    const splitToggle = document.getElementById('pay-split-toggle');
    if (splitToggle) splitToggle.checked = false;
    const singleBlock = document.getElementById('single-payment-mode-block');
    const splitBlock = document.getElementById('split-payment-lines-container');
    if (singleBlock) singleBlock.style.display ='';
    if (splitBlock) splitBlock.style.display ='none';

    document.getElementById('payment-modal').style.display ='flex';
}

async function submitFinalPaymentTransaction() {
    let dueAmount = parseFloat(document.getElementById('pay-modal-amount-due').innerText.replace('₱',''));
    let received, change, paymentMethodLabel, payments = null;

    if (splitPaymentMode) {

        const activeLines = splitPaymentLines.filter(l => (parseFloat(l.amount) || 0) > 0);
        if (activeLines.length < 1) {
            Swal.fire('Validation Error','Maglagay ng halaga sa kahit isang payment method.','error');
            return;
        }
        const allocated = Math.round(activeLines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0) * 100) / 100;
        if (allocated < dueAmount) {
            Swal.fire('Validation Error', `Payment validation exception: Kulang pa ng ₱${(dueAmount - allocated).toFixed(2)} ang split payment allocation.`,'error');
            return;
        }
        payments = activeLines.map(l => ({ method: l.method, amount: Math.round((parseFloat(l.amount) || 0) * 100) / 100 }));
        received = allocated;
        change = Math.round((allocated - dueAmount) * 100) / 100;
        paymentMethodLabel ='SPLIT';
    } else {
        received = parseFloat(document.getElementById('pay-modal-received-input').value) || 0;
        if (received < dueAmount) {
            Swal.fire('Validation Error','Payment validation exception: Tender value below transaction charge subtotal.','error');
            return;
        }
        change = received - dueAmount;
        paymentMethodLabel = selectedPaymentMethod;
        payments = [{ method: selectedPaymentMethod, amount: dueAmount }];
    }

    let discount = parseFloat(document.getElementById('cart-discount-input').value) || 0;
    const txId ='TX-' + Date.now();

    const transactionPayload = {
        id: txId,
        cashier: currentUser.username,
        items: shoppingCart.map(i => ({
            code: i.code,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            itemDiscount: Math.max(0, parseFloat(i.itemDiscount) || 0),

            cost: parseFloat(i.cost) || 0
        })),
        total: dueAmount,
        discount: discount,
        discountType: cartDiscountType,
        promoCode: cartDiscountType ==='PROMO' ? cartPromoCode :'',
        seniorPwdId: cartDiscountType ==='SENIOR_PWD' ? cartSeniorPwdId :'',
        payment_method: paymentMethodLabel,
        method: paymentMethodLabel,
        amount_paid: received,
        received: received,
        change: change,

        payments: payments,
        customerId: selectedCartCustomer ? selectedCartCustomer.id : null,
        customerName: selectedCartCustomer ? selectedCartCustomer.name :'',
        customerEmail: selectedCartCustomer ? (selectedCartCustomer.email ||'') :'',
        timestamp: new Date().toLocaleString(),
        isoDate: new Date().toISOString()
    };

    try {
        const res = await authFetch(`${API_URL}/transactions`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ transaction: transactionPayload, username: currentUser.username })
        });
        const output = await res.json();

        if(output.success) {
            Swal.fire('Transaction Saved!', `Reference Code: ${txId}`,'success');

            transactionPayload.items.forEach(item => {
                let localProd = globalProducts.find(p => p.code === item.code);
                if (localProd) {
                    localProd.stock = Math.max(0, parseInt(localProd.stock || 0) - item.quantity);
                }
            });
            if (typeof renderTerminalProducts ==='function') renderTerminalProducts();

            shoppingCart = [];
            renderCartRows();
            closeModal('payment-modal');
            await renderInvoiceReceipt(output.currentTransaction || transactionPayload);

            localTransactionsList.unshift(output.currentTransaction || transactionPayload);
            localStorage.setItem('cached_transactions', JSON.stringify(localTransactionsList));

            if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();
            if (typeof loadTransactionsHistory ==='function') loadTransactionsHistory();
        } else if (output.outOfStock) {

            Swal.fire('Ubos na ang Stock', output.message,'warning');
            if (typeof loadTerminalCatalog ==='function') loadTerminalCatalog();
        } else {
            Swal.fire('Server Error', `API Server Exception Error: ${output.message}`,'error');
        }
    } catch (e) {
        console.warn(e);
        transactionPayload.items.forEach(item => {
            let localProd = globalProducts.find(p => p.code === item.code);
            if (localProd) {
                localProd.stock = Math.max(0, parseInt(localProd.stock || 0) - item.quantity);
            }
        });

        localStorage.setItem('cached_products', JSON.stringify(globalProducts));
        if (typeof renderTerminalProducts ==='function') renderTerminalProducts();

        let offlineTx = JSON.parse(localStorage.getItem('offline_transactions') ||'[]');
        offlineTx.push({ transaction: transactionPayload, username: currentUser.username });
        localStorage.setItem('offline_transactions', JSON.stringify(offlineTx));

        localTransactionsList.unshift(transactionPayload);
        localStorage.setItem('cached_transactions', JSON.stringify(localTransactionsList));

        shoppingCart = [];
        renderCartRows();
        closeModal('payment-modal');
        await renderInvoiceReceipt(transactionPayload);

        if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();

        Swal.fire('Offline Stored','⚠️ Gateway Conn. Timeout: Central processing hub unreachable. The active transaction record is temporarily committed to local hardware.','warning');
    }
}

let receiptSettingsCache = null;
// FIX: hawak dito ang promise ng background fetch ng receipt settings
// (tingnan showMainSystemInterface at renderInvoiceReceipt) para may
// paraan ang unang resibo ng session na "hintayin" ito kung sakaling
// hindi pa ito tapos mag-load bago pa man matapos ang unang benta.
let receiptSettingsPromise = null;

async function fetchReceiptSettings() {
    try {
        const res = await authFetch(`${API_URL}/receipt-settings`);
        if (!res.ok) throw new Error('Failed to load receipt settings');
        receiptSettingsCache = await res.json();
    } catch (err) {
        console.warn('Unable to load receipt customization settings.', err);
    }
    applyReceiptBranding();
}

function applyReceiptBranding() {
    const s = receiptSettingsCache;
    if (!s) return;

    const setTextIfExists = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };
    const setOptionalLine = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (val && val.trim() !=='') {
            el.innerText = val;
            el.style.display ='block';
        } else {
            el.innerText ='';
            el.style.display ='none';
        }
    };

    setTextIfExists('r-store-title', s.storeName);
    setTextIfExists('r-store-address', s.storeAddress);
    setTextIfExists('r-store-contact', s.storeContact);
    setOptionalLine('r-header-text', s.headerText);
    setTextIfExists('r-footer-msg', s.footerText);

    setTextIfExists('rp-store-title', s.storeName);
    setTextIfExists('rp-store-address', s.storeAddress);
    setTextIfExists('rp-store-contact', s.storeContact);
    setOptionalLine('rp-header-text', s.headerText);
    setTextIfExists('rp-footer-msg', s.footerText);
}

function applyActivePrintPageSize() {
    // 🖨️ AYOS (FINAL): dating may DALAWANG static `@page` rule sa
    // style.css na nagbabanggaan (resibo: margin:0, barcode sheet:
    // margin:8mm) — dahil GLOBAL ang `@page`, ang huling nakasulat sa
    // CSS lang ang laging sumusunod, kaya lagi lang 8mm ang aktwal na
    // nagagamit kahit resibo pa ang pini-print, at umaasa lang dati sa
    // ganitong function para ma-patch ito sa huling minuto. Tinanggal
    // na ang duplicate na static rule sa style.css — ISA na lang ngayon
    // ang static/global default doon (`size:auto; margin:0;`). Dito
    // naman, dynamic na rin ang pag-a-apply ng 8mm margin ng Barcode
    // Generator (kaparehong paraan ng resibo), kaya walang static rule
    // na maaaring mag-shadow sa isa't isa.
    let styleTag = document.getElementById('dynamic-print-style');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id ='dynamic-print-style';
        document.head.appendChild(styleTag);
    }

    const receiptModal = document.getElementById('receipt-modal');
    const isPrintingReceipt = receiptModal && receiptModal.style.display !=='none';

    const barcodeModal = document.getElementById('barcode-preview-modal');
    const isPrintingBarcode = barcodeModal && barcodeModal.style.display !=='none';

    // 🖨️ AYOS (bagong bug — "magkapatong-patong" na literal na overlap sa
    // print output): dating UNCONDITIONAL sa style.css ang pag-force ng
    // visibility/display ng PAREHONG #receipt-modal AT #barcode-preview-
    // modal sa loob ng iisang @media print block — walang check kung alin
    // sa dalawa ang talagang bukas. Ibig sabihin, tuwing may window.print()
    // na tatawagin (resibo man o barcode sheet), PAREHONG lumalabas ang
    // dalawa (kasama ang laman ng "isang" natitira/luma sa DOM), kaya
    // nagkakapatong sila sa parehong pisikal na papel/PDF.
    //
    // AYOS: dito na lang natin itinatakda ang eksaktong target ng print
    // bilang class sa <body> (print-target-receipt / print-target-barcode)
    // batay sa parehong pagsusuri sa itaas — ang @media print sa style.css
    // ay naka-scope na ngayon sa mga class na ito, kaya isa lang talaga sa
    // dalawa ang lalabas kahit ano pa ang laman ng isa.
    document.body.classList.toggle('print-target-receipt', !!isPrintingReceipt);
    document.body.classList.toggle('print-target-barcode', !!isPrintingBarcode);

    if (isPrintingReceipt) {
        // `size: auto` para ang AKTWAL na papel na naka-load/napili sa
        // printer (thermal 58mm/80mm roll, A4, Letter, atbp.) mismo ang
        // susundin, sa halip na ipilit ang isang hard-coded na mm
        // width. Walang margin dahil ang #printable-receipt-area mismo
        // na (sa @media print sa style.css) ang naglalagay ng sarili
        // nitong 10mm padding.
        styleTag.innerHTML = `@page { size: auto; margin: 0; }`;
    } else if (isPrintingBarcode) {
        // Ang Barcode Generator sheet ang kailangan ng aktwal na
        // physical margin (8mm) sa paligid ng buong grid ng barcode
        // cards, kaya dito na lang ito dynamic ring inilalapat, sa
        // halip na sa isang static/permanenteng `@page` rule.
        styleTag.innerHTML = `@page { size: auto; margin: 8mm; }`;
    } else {
        // Wala sa dalawa ang kasalukuyang bukas (hal. print mula sa
        // ibang bahagi ng app) — i-clear ang override at bumalik na
        // lang sa iisang static default sa style.css (`size:auto;
        // margin:0;`).
        styleTag.innerHTML ='';
    }
}

window.addEventListener('beforeprint', applyActivePrintPageSize);
window.addEventListener('afterprint', () => {
    const styleTag = document.getElementById('dynamic-print-style');
    if (styleTag) styleTag.innerHTML ='';
    // I-clear din ang parehong print-target class pagkatapos ng bawat
    // print job, para hindi ito "makadikit"/manatiling naka-scope sa
    // susunod na hindi-related na window.print() na tawag.
    document.body.classList.remove('print-target-receipt','print-target-barcode');
});


async function loadReceiptCustomizationPanel() {
    await fetchReceiptSettings();
    const s = receiptSettingsCache;
    if (!s) return;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ||''; };
    setVal('rc-form-storename', s.storeName);
    setVal('rc-form-address', s.storeAddress);
    setVal('rc-form-contact', s.storeContact);
    setVal('rc-form-header', s.headerText);
    setVal('rc-form-footer', s.footerText);
    setVal('rc-form-papersize', s.paperSize);

    const statusEl = document.getElementById('receipt-custom-status');
    const resetBtn = document.getElementById('rc-reset-counter-btn');
    const otpSenderBox = document.getElementById('rc-otp-sender-config');
    const otpSenderCurrent = document.getElementById('rc-otp-sender-current');
    const otpSenderClearBtn = document.getElementById('rc-otp-sender-clear-btn');

    if (otpSenderClearBtn) otpSenderClearBtn.style.display = s.otpSenderConfigured ?'inline-flex' :'none';

    const otpSenderHeadingText = document.getElementById('rc-otp-sender-heading-text');
    const otpSenderHeadingIcon = document.getElementById('rc-otp-sender-heading-icon');
    const otpSenderChevron = document.getElementById('rc-otp-sender-toggle-chevron');
    const otpSenderBody = document.getElementById('rc-otp-sender-body');
    const otpSenderFormFields = document.getElementById('rc-otp-sender-form-fields');

    if (otpSenderBox) otpSenderBox.style.display ='block';

    if (s.otpSenderConfigured) {

        if (otpSenderHeadingText) otpSenderHeadingText.textContent ='Google App Verified';
        if (otpSenderHeadingIcon) { otpSenderHeadingIcon.style.color ='#16a34a'; }
        if (otpSenderChevron) otpSenderChevron.style.display ='inline-block';
        if (otpSenderBody) otpSenderBody.style.display ='none';
        if (otpSenderFormFields) otpSenderFormFields.style.display ='none';
        if (otpSenderCurrent) {
            otpSenderCurrent.style.display ='block';
            otpSenderCurrent.innerHTML = `<span style="color:#16a34a;"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(s.otpSenderEmailMasked ||'')}</span>`;
        }
    } else {

        if (otpSenderHeadingText) otpSenderHeadingText.textContent ='Google App Verification';
        if (otpSenderHeadingIcon) { otpSenderHeadingIcon.style.color ='#eab308'; }
        if (otpSenderChevron) otpSenderChevron.style.display ='none';
        if (otpSenderBody) otpSenderBody.style.display ='block';
        if (otpSenderFormFields) otpSenderFormFields.style.display ='block';
        if (otpSenderCurrent) {
            otpSenderCurrent.style.display ='block';
            otpSenderCurrent.innerHTML = `<span class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> Need to verified first the Google App</span>`;
        }
    }

    if (s.otpRequired) {
        if (statusEl) statusEl.innerHTML ='';
        if (resetBtn) {
            resetBtn.disabled = false;
            resetBtn.style.opacity ='1';
            resetBtn.style.cursor ='pointer';
            resetBtn.title ='';
        }
    } else {
        if (statusEl) statusEl.innerHTML = `<span class="text-success"><i class="fa-solid fa-circle-check"></i> Remaining Custom Credits: ${s.freeAttemptsRemaining} / 2</span>`;
        if (resetBtn) {
            resetBtn.disabled = true;
            resetBtn.style.opacity ='0.4';
            resetBtn.style.cursor ='not-allowed';
            resetBtn.title = `You still have ${s.freeAttemptsRemaining} free customization(s) left — no need to reset yet.`;
        }
    }
}

function closeGoogleAppVerificationFloatingBox() {
    const otpSenderBox = document.getElementById('rc-otp-sender-config');
    if (!otpSenderBox || otpSenderBox.style.display ==='none') return;
    otpSenderBox.style.display ='none';

    const chevron = document.getElementById('rc-otp-sender-toggle-chevron');
    if (chevron) {
        chevron.classList.remove('fa-chevron-up');
        chevron.classList.add('fa-chevron-down');
    }
}

async function loadSystemResetPanel() {
    await fetchReceiptSettings();
    const s = receiptSettingsCache;
    const statusBox = document.getElementById('reset-google-app-status');
    const executeBtn = document.getElementById('reset-execute-btn');
    if (!statusBox) return;

    if (s && s.otpSenderConfigured) {
        statusBox.style.borderColor ='#16a34a';
        statusBox.style.background ='rgba(22, 163, 74, 0.06)';
        statusBox.innerHTML = `<span style="color:#16a34a;"><i class="fa-solid fa-circle-check"></i> Verified Google App: ${escapeHtml(s.otpSenderEmailMasked ||'')}</span> <span style="color:var(--text-muted);">— this will be used as the sender for the backup email.</span>`;
        if (executeBtn) {
            executeBtn.disabled = false;
            executeBtn.style.opacity ='1';
            executeBtn.style.cursor ='pointer';
        }
    } else {
        statusBox.style.borderColor ='#ef4444';
        statusBox.style.background ='rgba(239, 68, 68, 0.06)';
        statusBox.innerHTML = `<span class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> No verified Google App yet.</span> Set this up first under <strong>Receipt Customization &gt; Google App Verification</strong> before using Hard Reset.`;
        if (executeBtn) {
            executeBtn.disabled = true;
            executeBtn.style.opacity ='0.5';
            executeBtn.style.cursor ='not-allowed';
        }
    }
}

function toggleOtpSenderBox() {
    const body = document.getElementById('rc-otp-sender-body');
    const chevron = document.getElementById('rc-otp-sender-toggle-chevron');
    if (!body) return;
    const isHidden = body.style.display ==='none' || !body.style.display;
    body.style.display = isHidden ?'block' :'none';
    if (chevron) {
        chevron.classList.toggle('fa-chevron-down', !isHidden);
        chevron.classList.toggle('fa-chevron-up', isHidden);
    }
}

async function performClearOtpSenderConfig() {
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    try {
        const res = await authFetch(`${API_URL}/receipt-settings/otp-sender/clear`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await res.json();

        if (data.success) {
            receiptSettingsCache = data.settings || receiptSettingsCache;
            const emailField = document.getElementById('rc-otp-sender-email');
            const passField = document.getElementById('rc-otp-sender-password');
            if (emailField) emailField.value ='';
            if (passField) passField.value ='';
            loadReceiptCustomizationPanel();
        }
        return data;
    } catch (err) {
        console.error(err);
        return { success: false, message:'Unable to reach the server. Please try again.' };
    }
}

async function clearOtpSenderConfig() {
    const confirmResult = await Swal.fire({
        title:'Clear Sender Gmail?',
        text:'This will remove the saved Gmail address and App Password. OTPs cannot be sent until this is set up again.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Yes, clear it',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#dc2626'
    });
    if (!confirmResult.isConfirmed) return;

    const data = await performClearOtpSenderConfig();
    if (data.success) {
        Swal.fire('Cleared!', data.message,'success');
    } else {
        Swal.fire('Not Cleared', data.message ||'Failed to clear the Sender Gmail configuration.','error');
    }
}

async function saveOtpSenderConfig() {
    const otpSenderEmail = (document.getElementById('rc-otp-sender-email').value ||'').trim();
    const otpSenderAppPassword = (document.getElementById('rc-otp-sender-password').value ||'').trim();
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    if (!otpSenderEmail || !otpSenderAppPassword) {
        Swal.fire('Missing Details','Both Gmail address and App Password are required.','warning');
        return;
    }

    Swal.fire({ title:'Verifying...', text:'Connecting to Gmail to check the credentials.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const res = await authFetch(`${API_URL}/receipt-settings/otp-sender`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ otpSenderEmail, otpSenderAppPassword, username })
        });
        const data = await res.json();

        if (data.success) {
            receiptSettingsCache = data.settings || receiptSettingsCache;
            document.getElementById('rc-otp-sender-password').value ='';
            Swal.fire('Verified!', data.message,'success');
            loadReceiptCustomizationPanel();
        } else {
            Swal.fire('Not Verified', data.message ||'Failed to verify the Gmail credentials.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

async function saveReceiptPaperSize() {
    const paperSize = document.getElementById('rc-form-papersize').value;
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    try {
        const res = await authFetch(`${API_URL}/receipt-settings/paper-size`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ paperSize, username })
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message ||'The paper size request has been submitted for Admin approval.','info');
        } else if (data.success) {
            Swal.fire('Saved!', `Print/PDF page size has been set to ${paperSize}.`,'success');
            receiptSettingsCache = data.settings || receiptSettingsCache;
            applyReceiptBranding();
        } else {
            Swal.fire('Error', data.message ||'Failed to save the paper size.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

async function saveReceiptCustomization() {
    const payload = {
        storeName: (document.getElementById('rc-form-storename').value ||'').trim(),
        storeAddress: (document.getElementById('rc-form-address').value ||'').trim(),
        storeContact: (document.getElementById('rc-form-contact').value ||'').trim(),
        headerText: (document.getElementById('rc-form-header').value ||'').trim(),
        footerText: (document.getElementById('rc-form-footer').value ||'').trim(),
        username: currentUser ? (currentUser.username || currentUser.name) :'Unknown'
    };

    if (!payload.storeName) {
        Swal.fire('Missing Details','Store Name is required.','warning');
        return;
    }

    try {
        let res = await authFetch(`${API_URL}/receipt-settings`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(payload)
        });
        let data = await res.json();

        if (data.requiresOtp) {
            const otpReqRes = await authFetch(`${API_URL}/receipt-settings/request-otp`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ username: payload.username })
            });
            const otpReqData = await otpReqRes.json();

            if (!otpReqData.success) {
                Swal.fire('OTP Not Sent', otpReqData.message ||'Failed to send the OTP.','error');
                return;
            }

            const { value: otpCode } = await Swal.fire({
                title:'🔒 OTP Required',
                html:'You have reached the free limit for receipt customization (2/2). An OTP code has been sent to the developer\'s registered email. Enter the 6-digit code you received:',
                input:'text',
                inputPlaceholder:'000000',
                showCancelButton: true,
                confirmButtonColor:'#2563eb',
                cancelButtonColor:'#64748b'
            });

            if (!otpCode || !otpCode.trim()) return;

            payload.otp = otpCode.trim();

            res = await authFetch(`${API_URL}/receipt-settings`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify(payload)
            });
            data = await res.json();

            if (data.pending) {
                data = await pollUntilApproved(`${API_URL}/receipt-settings`, payload);
            }
            if (data.cancelled) return;
        }

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message ||'The Receipt Customization request has been submitted for Admin approval.','info');
        } else if (data.success) {
            Swal.fire('Saved!','The receipt details have been updated successfully.','success');
            receiptSettingsCache = data.settings || receiptSettingsCache;
            applyReceiptBranding();
            loadReceiptCustomizationPanel();
        } else {
            Swal.fire('Error', data.message ||'Failed to save the receipt details.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

async function requestReceiptCounterReset() {
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    if (!receiptSettingsCache || !receiptSettingsCache.otpRequired) {
        Swal.fire('Not Needed Yet','You still have free customizations remaining — no need to reset the counter yet.','info');
        return;
    }

    const confirm = await Swal.fire({
        title:'Confirm Reset',
        html:'This will send an OTP to the developer\'s registered email. You will need to enter that OTP here to continue. Proceed?',
        icon:'question',
        showCancelButton: true,
        confirmButtonText:'Yes, send OTP',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#ef4444',
        cancelButtonColor:'#64748b'
    });
    if (!confirm.isConfirmed) return;

    try {
        const otpReqRes = await authFetch(`${API_URL}/receipt-settings/request-reset-otp`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ username })
        });
        const otpReqData = await otpReqRes.json();

        if (!otpReqData.success) {
            Swal.fire('OTP Not Sent', otpReqData.message ||'Failed to send the OTP.','error');
            return;
        }

        const { value: otpCode } = await Swal.fire({
            title:'🔓 Enter Reset OTP',
            html:'An OTP code has been sent to the developer\'s registered email. Enter the 6-digit code you received:',
            input:'text',
            inputPlaceholder:'000000',
            showCancelButton: true,
            confirmButtonColor:'#2563eb',
            cancelButtonColor:'#64748b'
        });
        if (!otpCode || !otpCode.trim()) return;

        const resetBody = { otp: otpCode.trim(), username };
        const resetRes = await authFetch(`${API_URL}/receipt-settings/reset-counter`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(resetBody)
        });
        let resetData = await resetRes.json();

        if (resetData.pending) {
            resetData = await pollUntilApproved(`${API_URL}/receipt-settings/reset-counter`, resetBody);
        }
        if (resetData.cancelled) return;

        if (resetData.success) {
            Swal.fire('Reset!','You now have 2 free customizations again.','success');
            receiptSettingsCache = resetData.settings || receiptSettingsCache;
            applyReceiptBranding();
            loadReceiptCustomizationPanel();

            if (receiptSettingsCache && receiptSettingsCache.otpSenderConfigured) {
                const clearPrompt = await Swal.fire({
                    title:'Remove Registered Email?',
                    html:'Your OTP verification was successful. Would you like to remove the registered sender email and app password now? This is recommended if you no longer intend to use this email, so it is not left stored on the system.',
                    icon:'question',
                    showCancelButton: true,
                    confirmButtonText:'Yes, remove it',
                    cancelButtonText:'No, keep it',
                    confirmButtonColor:'#dc2626',
                    cancelButtonColor:'#64748b'
                });

                if (clearPrompt.isConfirmed) {
                    const clearData = await performClearOtpSenderConfig();
                    if (clearData.success) {
                        Swal.fire('Removed','The registered sender email and app password have been cleared.','success');
                    } else {
                        Swal.fire('Error', clearData.message ||'Failed to remove the registered email.','error');
                    }
                }
            }
        } else {
            Swal.fire('Error', resetData.message ||'Failed to reset the counter.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

function openReceiptPreview() {
    if (shoppingCart.length === 0) {
        Swal.fire('Walang laman ang cart','Magdagdag muna ng item bago mag-preview ng resibo.','warning');
        return;
    }

    applyReceiptBranding();

    document.getElementById('rp-id').innerText ='PREVIEW';
    const now = new Date();
    document.getElementById('rp-date').innerText = now.toLocaleDateString();
    document.getElementById('rp-time').innerText = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    document.getElementById('rp-cashier').innerText = currentUser ? (currentUser.username || currentUser.name) :'-';

    const itemsTable = document.getElementById('rp-items-table');
    itemsTable.innerHTML ='';
    shoppingCart.forEach(item => {
        const row = document.createElement('div');
        row.className ='r-item-line';

        const itemDiscount = Math.max(0, parseFloat(item.itemDiscount) || 0);
        const nameLabel = itemDiscount > 0
            ? `${escapeHtml(item.name)} x${item.quantity} <small style="color:#dc2626;">(-₱${itemDiscount.toFixed(2)})</small>`
            : `${escapeHtml(item.name)} x${item.quantity}`;
        row.innerHTML = `
            <span>${nameLabel}</span>
            <span>₱${((item.price * item.quantity) - itemDiscount).toFixed(2)}</span>
        `;
        itemsTable.appendChild(row);
    });

    document.getElementById('rp-total').innerText = document.getElementById('summary-total').innerText;
    document.getElementById('rp-method').innerText ='—';
    document.getElementById('rp-paid').innerText ='₱0.00';
    document.getElementById('rp-change').innerText ='₱0.00';

    document.getElementById('receipt-preview-modal').style.display ='flex';
}

function chargeFromReceiptPreview() {
    closeModal('receipt-preview-modal');
    openPaymentModal();
}

let currentReceiptTransaction = null;

function generateReceiptImageDataUrl(tx) {
    const s = receiptSettingsCache || {};
    const storeName = s.storeName ||'OmniPOS';
    const storeAddress = s.storeAddress ||'';
    const footerText = s.footerText ||'Thank you for shopping!';

    const items = tx.items || [];
    const width = 380;
    const lineHeight = 20;
    const headerHeight = 110;
    const footerHeight = 130;
    const height = headerHeight + (items.length * lineHeight) + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle ='#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle ='#111111';
    ctx.textBaseline ='top';

    let y = 16;
    ctx.font ='bold 16px monospace';
    ctx.textAlign ='center';
    ctx.fillText(storeName, width / 2, y);
    y += 22;

    if (storeAddress) {
        ctx.font ='11px monospace';
        ctx.fillText(storeAddress, width / 2, y);
        y += 18;
    }

    ctx.textAlign ='left';
    ctx.font ='11px monospace';
    ctx.fillText(`Receipt: ${tx.id ||''}`, 14, y); y += 14;
    ctx.fillText(`Date: ${tx.timestamp ||''}`, 14, y); y += 14;
    ctx.fillText(`Cashier: ${tx.cashier ||''}`, 14, y); y += 8;

    ctx.strokeStyle ='#cccccc';
    ctx.beginPath();
    ctx.moveTo(14, y + 8);
    ctx.lineTo(width - 14, y + 8);
    ctx.stroke();
    y += 18;

    ctx.font ='12px monospace';
    items.forEach(i => {
        const itemDiscount = Math.max(0, parseFloat(i.itemDiscount) || 0);
        const lineTotal = ((parseFloat(i.price) || 0) * (parseInt(i.quantity) || 0)) - itemDiscount;
        const label = `${i.name} x${i.quantity}`.slice(0, 28);
        const priceStr = `P${lineTotal.toFixed(2)}`;
        ctx.fillText(label, 14, y);
        ctx.textAlign ='right';
        ctx.fillText(priceStr, width - 14, y);
        ctx.textAlign ='left';
        y += lineHeight;
    });

    ctx.beginPath();
    ctx.moveTo(14, y + 4);
    ctx.lineTo(width - 14, y + 4);
    ctx.stroke();
    y += 16;

    ctx.font ='bold 13px monospace';
    ctx.fillText('TOTAL', 14, y);
    ctx.textAlign ='right';
    ctx.fillText(`P${(parseFloat(tx.total) || 0).toFixed(2)}`, width - 14, y);
    ctx.textAlign ='left';
    y += 20;

    const paymentLine = (tx.payments && Array.isArray(tx.payments) && tx.payments.length > 1)
        ? tx.payments.map(p => `${p.method} P${parseFloat(p.amount).toFixed(2)}`).join(' + ')
        : (tx.method || tx.payment_method ||'CASH');
    ctx.font ='11px monospace';
    ctx.fillText(`Payment: ${paymentLine}`, 14, y);
    y += 24;

    ctx.textAlign ='center';
    ctx.font ='italic 11px monospace';
    ctx.fillText(footerText, width / 2, y);

    return canvas.toDataURL('image/png');
}

async function emailCurrentReceipt() {
    const emailInput = document.getElementById('r-email-input');
    const toEmail = emailInput ? emailInput.value.trim() :'';
    const emailPattern =/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!toEmail || !emailPattern.test(toEmail)) {
        Swal.fire('Invalid Email','Maglagay ng wastong email address.','warning');
        return;
    }
    if (!currentReceiptTransaction || !currentReceiptTransaction.id) {
        Swal.fire('Error','Walang aktibong resibo na maipapadala.','error');
        return;
    }

    const btn = document.getElementById('receipt-email-btn');
    const originalHtml = btn ? btn.innerHTML :'';
    if (btn) { btn.disabled = true; btn.innerHTML ='<i class="fa-solid fa-spinner fa-spin"></i> Sending...'; }

    let receiptImage = null;
    try {
        receiptImage = generateReceiptImageDataUrl(currentReceiptTransaction);
    } catch (imgErr) {
        console.warn('Hindi na-generate ang receipt image:', imgErr);
    }

    try {
        const res = await authFetch(`${API_URL}/transactions/${encodeURIComponent(currentReceiptTransaction.id)}/email-receipt`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ toEmail, transaction: currentReceiptTransaction, receiptImage })
        });
        const output = await res.json();
        if (output.success) {
            Swal.fire('Sent!', `Naipadala ang resibo sa ${toEmail}`,'success');
            if (emailInput) emailInput.value ='';
        } else {
            Swal.fire('Failed', output.message ||'Hindi naipadala ang resibo.','error');
        }
    } catch (e) {
        console.warn(e);
        Swal.fire('Connection Error','Hindi makonekta sa server para ipadala ang resibo.','error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
}

async function renderInvoiceReceipt(tx, isHistory = false) {
    // FIX: kapag ang unang benta ng session ay natapos BAGO pa makabalik
    // ang background fetchReceiptSettings() (tingnan showMainSystemInterface),
    // blangko/walang laman ang store title/address/contact/header/footer
    // at hindi rin naaapply ang tamang paper size, dahil `applyReceiptBranding()`
    // ay agad lumalabas (`if (!s) return;`) kapag null pa ang cache. Kaya
    // dito, hintayin muna ang nakabinbing fetch (kung meron) bago mag-render.
    if (!receiptSettingsCache && receiptSettingsPromise) {
        await receiptSettingsPromise;
    }
    applyReceiptBranding();
    currentReceiptTransaction = tx;

    document.getElementById('r-id').innerText = tx.id;
    document.getElementById('r-footer-id').innerText = tx.id;

    const parts = tx.timestamp.split(', ');
    document.getElementById('r-date').innerText = parts[0] || tx.timestamp;
    document.getElementById('r-time').innerText = parts[1] ||'';
    document.getElementById('r-cashier').innerText = tx.cashier;

    const itemsTable = document.getElementById('receipt-items-table');
    itemsTable.innerHTML ='';

    tx.items.forEach(i => {
        const itemRow = document.createElement('div');
        itemRow.className ='r-item-line';
        const itemDiscount = Math.max(0, parseFloat(i.itemDiscount) || 0);
        const nameLabel = itemDiscount > 0
            ? `${escapeHtml(i.name)} x${i.quantity} <small style="color:#dc2626;">(-₱${itemDiscount.toFixed(2)})</small>`
            : `${escapeHtml(i.name)} x${i.quantity}`;
        itemRow.innerHTML = `
            <span>${nameLabel}</span>
            <span>₱${((i.price * i.quantity) - itemDiscount).toFixed(2)}</span>
        `;
        itemsTable.appendChild(itemRow);
    });

    document.getElementById('r-total').innerText = `₱${parseFloat(tx.total).toFixed(2)}`;

    if (tx.payments && Array.isArray(tx.payments) && tx.payments.length > 1) {
        document.getElementById('r-method').innerText = tx.payments.map(p => `${p.method} ₱${parseFloat(p.amount).toFixed(2)}`).join(' + ');
    } else {
        document.getElementById('r-method').innerText = tx.method;
    }
    document.getElementById('r-paid').innerText = `₱${parseFloat(tx.received).toFixed(2)}`;
    document.getElementById('r-change').innerText = `₱${parseFloat(tx.change).toFixed(2)}`;

    const discountRow = document.getElementById('r-discount-row');
    const discountAmt = parseFloat(tx.discount) || 0;
    if (discountRow) {
        if (discountAmt > 0) {
            let label ='Manual';
            if (tx.discountType ==='SENIOR_PWD') label = `Senior/PWD${tx.seniorPwdId ?' #' + tx.seniorPwdId :''}`;
            else if (tx.discountType ==='PROMO') label = `Promo: ${tx.promoCode ||''}`;
            document.getElementById('r-discount-type').innerText = label;
            document.getElementById('r-discount-amount').innerText = `-₱${discountAmt.toFixed(2)}`;
            discountRow.style.display ='flex';
        } else {
            discountRow.style.display ='none';
        }
    }

    const customerRow = document.getElementById('r-customer-row');
    if (customerRow) {
        if (tx.customerName) {
            document.getElementById('r-customer-name').innerText = tx.customerName;
            customerRow.style.display ='flex';
        } else {
            customerRow.style.display ='none';
        }
    }
    const loyaltyRow = document.getElementById('r-loyalty-row');
    if (loyaltyRow) {
        if (tx.loyaltyPointsEarned) {
            document.getElementById('r-loyalty-earned').innerText = tx.loyaltyPointsEarned;
            loyaltyRow.style.display ='flex';
        } else {
            loyaltyRow.style.display ='none';
        }
    }

    const emailInputEl = document.getElementById('r-email-input');
    if (emailInputEl) {
        emailInputEl.value = tx.customerEmail ||'';
    }

    setTimeout(() => {
        JsBarcode("#receipt-barcode", tx.id, {
            format:"CODE128",
            width: 1.5,
            height: 40,
            displayValue: true,
            fontSize: 11,
            margin: 0
        });
    }, 50);

    const nextSaleBtn = document.getElementById('receipt-next-sale-btn');
    const closeReceiptBtn = document.getElementById('receipt-close-btn');
    const printReceiptBtn = document.getElementById('receipt-print-btn');
    const receiptFooter = document.getElementById('receipt-actions-footer');

    if (isHistory) {

        if (nextSaleBtn) nextSaleBtn.style.display ='none';
        if (closeReceiptBtn) closeReceiptBtn.style.display ='none';

        if (printReceiptBtn) {
            printReceiptBtn.style.display ='block';
            printReceiptBtn.style.margin ='0 0 0 auto';
        }
    } else {

        if (nextSaleBtn) nextSaleBtn.style.display ='inline-block';
        if (closeReceiptBtn) closeReceiptBtn.style.display ='inline-block';

        if (printReceiptBtn) {
            printReceiptBtn.style.display ='inline-block';
            printReceiptBtn.style.margin ='0';
        }
    }

    document.getElementById('receipt-modal').style.display ='flex';
}

function resetSaleTerminalCycle() {
    closeModal('receipt-modal');
    clearCart();
    loadTerminalCatalog();
}

async function loadTransactionsHistory() {
    try {
        const requesterUsername = currentUser ? currentUser.username :'';
        const response = await authFetch(`${API_URL}/transactions?requester=${encodeURIComponent(requesterUsername)}`);
        if (!response.ok) throw new Error("Failed to fetch data");
        localTransactionsList = await response.json();
        localStorage.setItem('cached_transactions', JSON.stringify(localTransactionsList));
        const badge = document.getElementById('tx-total-count-badge');
        if(badge) badge.innerText = `${localTransactionsList.length} Records`;
        renderTransactionsRows(localTransactionsList);
    } catch (err) {
        console.warn("Transaction History: Offline mode active.", err);
        localTransactionsList = JSON.parse(localStorage.getItem('cached_transactions') ||'[]');
        const badge = document.getElementById('tx-total-count-badge');
        if(badge) badge.innerText = `${localTransactionsList.length} Records`;
        renderTransactionsRows(localTransactionsList);
    }

}

function renderTransactionsRows(transactions) {
    const tbody = document.getElementById('transactions-table-body');
    if (!tbody) return;

    tbody.innerHTML ='';

    if (transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">No transaction logs located within active archive parameters.</td></tr>`;
        return;
    }

    transactions.forEach(tx => {
        const totalItemsQty = tx.items.reduce((sum, item) => sum + item.quantity, 0);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${tx.id}</strong></td>
            <td>${tx.timestamp}</td>
            <td><span class="badge" style="background:#64748b;">${escapeHtml(tx.cashier)}</span></td>
            <td>${totalItemsQty} item(s)</td>
            <td class="text-danger">₱${parseFloat(tx.discount || 0).toFixed(2)}</td>
            <td class="font-bold">₱${parseFloat(tx.total).toFixed(2)}</td>
            <td>
                <span class="badge" style="background: ${tx.method ==='CASH' ?'#10b981' :'#3b82f6'};">
                    ${tx.method}
                </span>
            </td>
            <td style="text-align: center;">
                <button class="btn-clear" onclick="reopenReceiptFromHistory('${tx.id}')"
 style="color: var(--primary-blue); padding: 4px 8px; font-size: 0.9rem;">
                    <i class="fa-solid fa-eye"></i> View
                </button>
                <button class="btn-clear" onclick="handleVoidTransaction('${tx.id}')" style="color: #ef4444; padding: 4px 8px; font-size: 0.9rem; margin-left: 5px;">
        <i class="fa-solid fa-ban"></i> Void
 </button>
            </td>
            
        `;
        tbody.appendChild(row);
    });
}

let cachedInventoryProducts = [];

const columnFilters = { code: new Set(), name: new Set(), category: new Set(), price: new Set(), stock: new Set(), expiryDate: new Set() };
let activeFilterField = null;

function getColumnDisplayValue(field, p) {
    switch (field) {
        case'code': return p.code ||'';
        case'name': return p.name ||'';
        case'category': return p.category ||'';
        case'price': return `₱${parseFloat(p.price || 0).toFixed(2)}`;
        case'stock': return String(p.stock ??'');
        case'expiryDate': return p.expiryDate ? p.expiryDate :'(No Expiry)';
        default: return'';
    }
}

function toggleColumnFilter(field, evt) {
    evt.stopPropagation();
    const btn = evt.currentTarget;

    if (document.getElementById('col-filter-dropdown') && activeFilterField === field) {
        closeColumnFilterDropdown();
        return;
    }
    closeColumnFilterDropdown();
    activeFilterField = field;

    const query = (document.getElementById('inventory-search')?.value ||'').trim().toLowerCase();
    const contextProducts = cachedInventoryProducts.filter(p => {
        if (query && !((p.name ||'').toLowerCase().includes(query) || (p.code ||'').toLowerCase().includes(query))) return false;
        for (const f in columnFilters) {
            if (f === field) continue;
            if (columnFilters[f].size > 0 && !columnFilters[f].has(getColumnDisplayValue(f, p))) return false;
        }
        return true;
    });

    const uniqueValues = [...new Set(contextProducts.map(p => getColumnDisplayValue(field, p)))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const currentSelection = columnFilters[field];
    const selectedSet = currentSelection.size > 0 ? currentSelection : new Set(uniqueValues);

    const dropdown = document.createElement('div');
    dropdown.id ='col-filter-dropdown';
    dropdown.className ='col-filter-dropdown';
    dropdown.innerHTML = `
        <div class="col-filter-search"><input type="text" placeholder="Maghanap..." oninput="filterColumnFilterOptions(this.value)"></div>
        <div class="col-filter-selectall"><input type="checkbox" id="col-filter-selectall-cb"><span>Piliin Lahat</span></div>
        <div class="col-filter-list" id="col-filter-list"></div>
        <div class="col-filter-actions">
            <button type="button" class="col-filter-clear" onclick="clearColumnFilter('${field}')">I-clear</button>
            <button type="button" class="col-filter-apply" onclick="applyColumnFilter('${field}')">I-apply</button>
        </div>
    `;
    document.body.appendChild(dropdown);
    renderColumnFilterOptions(uniqueValues, selectedSet);

    const selectAllCb = document.getElementById('col-filter-selectall-cb');
    selectAllCb.checked = uniqueValues.length > 0 && selectedSet.size === uniqueValues.length;
    selectAllCb.onchange = () => {
        document.querySelectorAll('#col-filter-list .col-filter-option:not([style*="display: none"]) input[type="checkbox"]')
            .forEach(cb => cb.checked = selectAllCb.checked);
    };

    const rect = btn.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    const maxLeft = window.innerWidth - 246;
    dropdown.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;

    btn.classList.add('filter-btn-open');
    setTimeout(() => document.addEventListener('click', closeColumnFilterDropdownOnOutsideClick), 0);
}

function renderColumnFilterOptions(values, selectedSet) {
    const list = document.getElementById('col-filter-list');
    if (!list) return;
    if (values.length === 0) {
        list.innerHTML = `<div class="col-filter-empty">Walang laman</div>`;
        return;
    }
    list.innerHTML = values.map(v => {
        const safe = escapeHtml(v);
        const checked = selectedSet.has(v) ?'checked' :'';
        return `<label class="col-filter-option"><input type="checkbox" value="${safe}" ${checked}><span>${safe}</span></label>`;
    }).join('');
}

function filterColumnFilterOptions(query) {
    const list = document.getElementById('col-filter-list');
    if (!list) return;
    const q = query.trim().toLowerCase();
    list.querySelectorAll('.col-filter-option').forEach(opt => {
        const text = opt.textContent.trim().toLowerCase();
        opt.style.display = text.includes(q) ?'' :'none';
    });
}

function applyColumnFilter(field) {
    const list = document.getElementById('col-filter-list');
    if (!list) return;
    const allCbs = [...list.querySelectorAll('input[type="checkbox"]')];
    const checked = allCbs.filter(cb => cb.checked).map(cb => cb.value);

    columnFilters[field] = (checked.length === 0 || checked.length === allCbs.length) ? new Set() : new Set(checked);

    updateFilterIconStates();
    closeColumnFilterDropdown();
    renderInventoryProductsTable();
}

function clearColumnFilter(field) {
    columnFilters[field] = new Set();
    updateFilterIconStates();
    closeColumnFilterDropdown();
    renderInventoryProductsTable();
}

function updateFilterIconStates() {
    document.querySelectorAll('.col-filter-btn').forEach(btn => {
        const field = btn.getAttribute('data-field');
        const hasFilter = columnFilters[field] && columnFilters[field].size > 0;
        btn.classList.toggle('active', hasFilter);
    });
}

function closeColumnFilterDropdown() {
    const existing = document.getElementById('col-filter-dropdown');
    if (existing) existing.remove();
    document.querySelectorAll('.col-filter-btn.filter-btn-open').forEach(b => b.classList.remove('filter-btn-open'));
    activeFilterField = null;
    document.removeEventListener('click', closeColumnFilterDropdownOnOutsideClick);
}

function closeColumnFilterDropdownOnOutsideClick(evt) {
    const dropdown = document.getElementById('col-filter-dropdown');
    if (!dropdown) return;
    if (dropdown.contains(evt.target)) return;
    if (evt.target.closest && evt.target.closest('.col-filter-btn')) return;
    closeColumnFilterDropdown();
}

async function loadInventoryProductsTable() {
    try {
        const res = await authFetch(`${API_URL}/products`);
        cachedInventoryProducts = await res.json();
    } catch (e) {
        console.error(e);
        cachedInventoryProducts = [];
    }
    renderInventoryProductsTable();
}

function filterInventoryTable() {
    renderInventoryProductsTable();
}

function renderInventoryProductsTable() {
    const tbody = document.getElementById('products-table-body');
    if (!tbody) return;
    tbody.innerHTML ='';

    const searchBox = document.getElementById('inventory-search');
    const query = searchBox ? searchBox.value.trim().toLowerCase() :'';

    try {
        const products = cachedInventoryProducts.filter(p => {
            if (query && !((p.name ||'').toLowerCase().includes(query) || (p.code ||'').toLowerCase().includes(query))) return false;
            for (const field in columnFilters) {
                if (columnFilters[field].size > 0 && !columnFilters[field].has(getColumnDisplayValue(field, p))) return false;
            }
            return true;
        });

        updateFilterIconStates();

        products.forEach(p => {
            try {
                const row = document.createElement('tr');
                row.setAttribute('data-code', p.code);
                const threshold = (p.lowStockThreshold !== undefined && p.lowStockThreshold !== null && p.lowStockThreshold !=='') ? parseInt(p.lowStockThreshold) : 5;
                const stockNum = parseInt(p.stock) || 0;
                const isLowStock = stockNum > 0 && stockNum <= threshold;

                let expiryDisplay ='<span style="color:#94a3b8;">—</span>';
                if (p.expiryDate) {
                    const expiryDate = new Date(p.expiryDate);
                    if (!isNaN(expiryDate.getTime())) {
                        const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
                        const isExpiringSoon = daysLeft <= 7;
                        const isExpired = daysLeft < 0;
                        const color = isExpired ?'#dc2626' : (isExpiringSoon ?'#f59e0b' :'#334155');
                        expiryDisplay = `<span style="color:${color};font-weight:${(isExpired || isExpiringSoon) ?'600' :'400'};">${p.expiryDate}</span>`;
                    }
                }

                const safeCode = escapeHtml(p.code);
                const safeCodeAttr = safeCode.replace(/'/g,'&#39;');
                row.innerHTML = `
                    <td>${p.image ? `<img class="inv-thumb" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name ||'Product')}" onclick="showProductDetails('${safeCodeAttr}', 'inventory')" title="Tingnan ang detalye">` : `<div class="inv-thumb-fallback" onclick="showProductDetails('${safeCodeAttr}', 'inventory')" title="Tingnan ang detalye"><i class="${getCategoryIconClass(p.category)}"></i></div>`}</td>
                    <td class="font-bold">${safeCode}</td>
                    <td>${escapeHtml(p.name)}</td>
                    <td><span class="badge-role cashier">${escapeHtml(p.category)}</span></td>
                    <td>₱${parseFloat(p.price).toFixed(2)}</td>
                    <td style="${isLowStock ?'color:#f59e0b;font-weight:600;' :''}">${p.stock}</td>
                    <td>${expiryDisplay}</td>
                    <td>
                        <div class="action-icon-btns-row">
                            <button class="btn-icon-action edit" onclick="openProductModal('UPDATE', '${safeCodeAttr}')"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button class="btn-icon-action delete" onclick="deleteProductTrigger('${safeCodeAttr}')"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                `;
                tbody.appendChild(row);
            } catch (rowError) {

                console.error("Nilaktawan ang isang produkto sa Inventory table dahil sa error sa row render:", p, rowError);
            }
        });
    } catch (renderError) {
        console.error("Nabigo ang pag-render ng Inventory product table:", renderError);
    }
}

function highlightInventoryRow(code) {
    const tbody = document.getElementById('products-table-body');
    if (!tbody) return;
    const row = tbody.querySelector(`tr[data-code="${CSS && CSS.escape ? CSS.escape(code) : code}"]`);
    if (!row) return;

    row.scrollIntoView({ behavior:'smooth', block:'center' });
    row.classList.add('row-scan-highlight');
    setTimeout(() => row.classList.remove('row-scan-highlight'), 2000);
}

function openProductModal(mode, code ='') {
    document.getElementById('p-form-mode').value = mode;
    const codeInput = document.getElementById('p-form-code');
    const scanBtn = document.getElementById('p-form-scan-btn');
    const scanPromptBtn = document.getElementById('p-form-scan-prompt-btn');

    addProductScanSession = { active: false, lastScannedFormCode: null };

    if (mode ==='ADD') {
        document.getElementById('product-modal-title').innerText ="Add Product";
        document.getElementById('product-schema-form').reset();
        codeInput.removeAttribute('disabled');
        document.getElementById('p-form-image').value ='';
        updateProductPhotoPreview('');

        if (scanBtn) scanBtn.style.display ='flex';
        if (scanPromptBtn) scanPromptBtn.style.display ='flex';
        codeInput.focus();
    } else {
        document.getElementById('product-modal-title').innerText ="Edit Product";
        codeInput.setAttribute('disabled', true);
        if (scanBtn) scanBtn.style.display ='none';
        if (scanPromptBtn) scanPromptBtn.style.display ='none';

        document.getElementById('product-schema-form').reset();
        codeInput.value = code;
        updateProductPhotoPreview('');

        authFetch(`${API_URL}/products`).then(r => r.json()).then(prods => {
            let match = prods.find(p => p.code === code);
            if(match) {
                codeInput.value = match.code;
                document.getElementById('p-form-name').value = match.name;
                document.getElementById('p-form-category').value = match.category;
                document.getElementById('p-form-price').value = match.price;
                document.getElementById('p-form-cost').value = (match.cost !== undefined && match.cost !== null) ? match.cost :'';
                document.getElementById('p-form-stock').value = match.stock;
                document.getElementById('p-form-supplier').value = match.supplier ||'';
                document.getElementById('p-form-expiry').value = match.expiryDate ||'';
                document.getElementById('p-form-threshold').value = (match.lowStockThreshold !== undefined && match.lowStockThreshold !== null) ? match.lowStockThreshold :'';
                document.getElementById('p-form-image').value = match.image ||'';
                updateProductPhotoPreview(match.image ||'');
            } else {
                document.getElementById('product-modal').style.display = 'none';
                Swal.fire('Hindi Nahanap', 'Hindi mahanap ang product na ito — maaaring na-delete na ito sa ibang device/session.', 'error');
            }
        }).catch(err => {
            console.error('Failed to load product data for edit:', err);
            document.getElementById('product-modal').style.display = 'none';
            Swal.fire('Connection Error', 'Hindi nakuha ang product data mula sa server. Suriin ang koneksyon at subukan ulit.', 'error');
        });
    }
    document.getElementById('product-modal').style.display ='flex';
}

function handleProductPhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        Swal.fire('Maling File Type','Larawan lang (JPG, PNG, atbp.) ang pwedeng i-upload bilang product photo.','error');
        event.target.value ='';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const MAX_DIM = 300;
            let { width, height } = img;
            if (width > height && width > MAX_DIM) {
                height = Math.round(height * (MAX_DIM / width));
                width = MAX_DIM;
            } else if (height > MAX_DIM) {
                width = Math.round(width * (MAX_DIM / height));
                height = MAX_DIM;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);

            document.getElementById('p-form-image').value = compressedDataUrl;
            updateProductPhotoPreview(compressedDataUrl);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function updateProductPhotoPreview(dataUrl) {
    const preview = document.getElementById('p-form-photo-preview');
    const removeBtn = document.getElementById('p-form-photo-remove-btn');
    if (!preview) return;
    if (dataUrl) {
        preview.innerHTML = `<img src="${dataUrl}" alt="Product photo preview">`;
        if (removeBtn) removeBtn.style.display ='inline-block';
    } else {
        preview.innerHTML = `<i class="fa-solid fa-image"></i>`;
        if (removeBtn) removeBtn.style.display ='none';
    }
}

function removeProductPhoto() {
    document.getElementById('p-form-image').value ='';
    document.getElementById('p-form-photo-input').value ='';
    const cameraInput = document.getElementById('p-form-photo-camera-input');
    if (cameraInput) cameraInput.value ='';
    updateProductPhotoPreview('');
}

async function handleProductFormSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('p-form-mode').value;
    const code = document.getElementById('p-form-code').value;

    const payload = {
        code: code,
        name: document.getElementById('p-form-name').value,
        category: document.getElementById('p-form-category').value,
        price: parseFloat(document.getElementById('p-form-price').value),
        stock: parseInt(document.getElementById('p-form-stock').value),
        image: document.getElementById('p-form-image').value ||''
    };

    const costVal = document.getElementById('p-form-cost').value;
    if (costVal !=='') payload.cost = parseFloat(costVal);
    const supplierVal = document.getElementById('p-form-supplier').value.trim();
    const expiryVal = document.getElementById('p-form-expiry').value;
    const thresholdVal = document.getElementById('p-form-threshold').value;
    if (supplierVal) payload.supplier = supplierVal;
    if (expiryVal) payload.expiryDate = expiryVal;
    if (thresholdVal !=='') payload.lowStockThreshold = parseInt(thresholdVal);

    const isScanRestock = (mode ==='ADD' && addProductScanSession.lastScannedFormCode === code.trim());

    if (mode ==='ADD' && !isScanRestock) {
        const barcodeExists = globalProducts.some(p => p.code === code.trim());
        if (barcodeExists) {
            Swal.fire('Collision Detected','❌ System Database Collision: This tracking code identifier is already allocated!','error');
            return;
        }
    }

    let url = `${API_URL}/products`;
    let reqMethod ='POST';
    let bodyData = { product: payload, userRole: currentUser.role, username: currentUser.username };

    if (mode ==='UPDATE' || isScanRestock) {
        url = `${API_URL}/products/${code}`;
        reqMethod ='PUT';
        bodyData = { updatedData: payload, userRole: currentUser.role, username: currentUser.username };
    }

    try {
        const res = await authFetch(url, {
            method: reqMethod,
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(bodyData)
        });

        const reply = await res.json();

        if (reply.success) {
            loadInventoryProductsTable();
            loadDashboardMetrics();

            if (mode ==='ADD' && addProductScanSession.active) {

                globalProducts = globalProducts.filter(p => p.code !== code);
                globalProducts.push(payload);
                addProductScanSession.lastScannedFormCode = null;

                Swal.fire({
                    title:'Success',
                    text: reply.message ||'Product schema records modified cleanly.',
                    icon:'success',
                    timer: 1200,
                    showConfirmButton: false
                });

                document.getElementById('product-schema-form').reset();
                document.getElementById('p-form-mode').value ='ADD';
                document.getElementById('p-form-image').value ='';
                updateProductPhotoPreview('');
                const codeInput = document.getElementById('p-form-code');
                codeInput.removeAttribute('disabled');
                codeInput.focus();
            } else {
                Swal.fire('Success', reply.message ||'Product schema records modified cleanly.','success');
                closeModal('product-modal');
            }
        } else {
            Swal.fire('Validation Error', reply.message ||'System Database Fault: Validation process rejected input variables.','error');
        }
    } catch (error) {
        console.error(error);
        Swal.fire('Connection Lost','❌ Connection Lost: Unable to contact system data nodes.','error');
    }
}

async function downloadAuthFetch(url, fallbackFilename) {
    try {
        const res = await authFetch(url);
        if (!res.ok) {
            let msg ='Hindi ma-download ang file.';
            try {
                const data = await res.json();
                msg = data.message || msg;
            } catch (e) {  }
            Swal.fire('Download Failed', msg,'error');
            return;
        }
        const blob = await res.blob();

        const disposition = res.headers.get('Content-Disposition') ||'';
        const match = disposition.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : fallbackFilename;

        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
    } catch (err) {
        console.error('Download error:', err);
        Swal.fire('Download Failed','Nagka-error habang dina-download ang file.','error');
    }
}

function downloadProductTemplate() {
    downloadAuthFetch(`${API_URL}/products/template`, `product_template_${Date.now()}.xlsx`);
}

function exportProductsCsv() {
    if (guardPremiumFeature('advanced_reports')) return;
    downloadAuthFetch(`${API_URL}/products/export`, `inventory_export_${Date.now()}.csv`);
}

let selectedImportMode ='skip';

function triggerProductImport() {
    Swal.fire({
        title:'Paano i-import ang file?',
        html:'<p style="font-size:14px;color:#64748b;">Kung may Product Code na dati nang naka-record...</p>',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText:'Update Existing',
        denyButtonText:'Skip Duplicates',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#2563eb',
        denyButtonColor:'#64748b'
    }).then(result => {
        if (result.isConfirmed) {
            selectedImportMode ='update';
        } else if (result.isDenied) {
            selectedImportMode ='skip';
        } else {
            return;
        }
        const fileInput = document.getElementById('import-file-input');
        if (fileInput) fileInput.click();
    });
}

async function handleProductImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('username', currentUser.username);
    formData.append('mode', selectedImportMode ||'skip');

    Swal.fire({
        title:'Ini-import ang mga produkto...',
        text:'Sandali lang po.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await authFetch(`${API_URL}/products/import`, {
            method:'POST',
            body: formData
        });
        const reply = await res.json();

        event.target.value ='';

        if (!reply.success) {
            Swal.fire('Import Failed', reply.message ||'Hindi ma-import ang file.','error');
            return;
        }

        if (reply.products) globalProducts = reply.products;
        if (reply.categories) customCategories = reply.categories;
        updateDropdownCategoriesDynamic();
        updateCategoryChipsDynamic();
        if (typeof loadInventoryProductsTable ==='function') loadInventoryProductsTable();
        if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();

        let summaryHtml = `<p>✅ Matagumpay na naidagdag: <b>${reply.added}</b> produkto</p>`;
        if (reply.updated) {
            summaryHtml += `<p>🔄 Na-update: <b>${reply.updated}</b> existing na produkto</p>`;
        }
        if (reply.newCategories && reply.newCategories.length) {
            summaryHtml += `<p>🏷️ Bagong category na naidagdag: <b>${reply.newCategories.join(', ')}</b></p>`;
        }
        if (reply.skipped) {
            summaryHtml += `<p>⚠️ Na-skip: <b>${reply.skipped}</b> hilera (duplicate code o kulang na data)</p>`;
        }
        if (reply.errors && reply.errors.length) {
            summaryHtml += `<div style="text-align:left;max-height:150px;overflow:auto;margin-top:10px;padding:8px;background:#fef2f2;border-radius:6px;font-size:12.5px;color:#b91c1c;">${reply.errors.join('<br>')}</div>`;
            summaryHtml += `<div style="margin-top:10px;"><button type="button" id="download-import-errors-btn" class="btn-action-outline" style="font-size:12.5px;padding:6px 12px;">📥 I-download ang Error Report (CSV)</button></div>`;
        }

        Swal.fire({
            title:'Import Complete',
            html: summaryHtml,
            icon: (reply.errors && reply.errors.length) ?'warning' :'success',
            didOpen: () => {
                const btn = document.getElementById('download-import-errors-btn');
                if (btn) {
                    btn.addEventListener('click', () => downloadImportErrorsCsv(reply.errors));
                }
            }
        });
    } catch (error) {
        console.error(error);
        event.target.value ='';
        Swal.fire('Connection Lost','❌ Hindi makonekta sa server. Subukan ulit.','error');
    }
}

function downloadImportErrorsCsv(errorsArray) {
    if (!errorsArray || !errorsArray.length) return;
    const escapeCsv = (val) => {
        const s = (val === undefined || val === null) ?'' : val.toString();
        return/[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const lines = ['Error Message'];
    errorsArray.forEach(e => lines.push(escapeCsv(e)));
    const csvContent ='\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import_errors_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function deleteProductTrigger(code) {
    const confirmation = await Swal.fire({
        title:'Are you sure?',
        text: `Are you sure you want to delete product code ${code}?`,
        icon:'warning',
        showCancelButton: true,
        confirmButtonColor:'#ef4444',
        cancelButtonColor:'#64748b',
        confirmButtonText:'Yes, delete it'
    });

    if(!confirmation.isConfirmed) return;

    try {
        const res = await authFetch(`${API_URL}/products/${code}`, {
            method:'DELETE',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ userRole: currentUser.role, username: currentUser.username })
        });
        const reply = await res.json();
        Swal.fire('Deleted!', reply.message ||'Deletion processing sequence updated.','success');
        loadInventoryProductsTable();
      loadDashboardMetrics();
    } catch(e) {
        Swal.fire('Error','Failed to delete the selected product asset.','error');
    }
}

async function loadBarcodeGeneratorModule() {
    try {
        const res = await authFetch(`${API_URL}/products`);
        const products = await res.json();
        const tbody = document.getElementById('barcode-table-body');
        tbody.innerHTML ='';

        document.getElementById('select-all-barcodes').checked = false;

        products.forEach((p, idx) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input type="checkbox" class="barcode-select-item" data-code="${escapeHtml(p.code)}" data-name="${escapeHtml(p.name)}"></td>
                <td class="font-bold">${escapeHtml(p.code)}</td>
                <td>${escapeHtml(p.category)}</td>
                <td>${escapeHtml(p.name)}</td>
                <td><input type="number" class="barcode-qty-input" value="1" min="1" style="width:60px; padding:4px; text-align:center;" id="bar-qty-${escapeHtml(p.code)}"></td>
                <td><canvas id="canvas-row-${idx}" style="max-height: 40px;"></canvas></td>
            `;
            tbody.appendChild(row);

            setTimeout(() => {
                JsBarcode(`#canvas-row-${idx}`, p.code, { format:"CODE128", displayValue: false, height: 30, margin: 0 });
            }, 50);
        });
    } catch (e) { console.error(e); }
}

function toggleSelectAllBarcodes(master) {
    document.querySelectorAll('.barcode-select-item').forEach(cb => cb.checked = master.checked);
}

async function generateSelectedBarcodePreview() {
    const checkboxes = document.querySelectorAll('.barcode-select-item:checked');
    if(checkboxes.length === 0) {
        Swal.fire('Selection Required','Please select at least one item from the product table lists.','info');
        return;
    }

    const isAdmin = currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin';
    let authMethod ='';

    if (!isAdmin) {
        const { value: adminPassword } = await Swal.fire({
            title:'🔒 Admin Authorization Required',
            html:'Kailangan ng Admin password bago maka-print ng barcode.',
            input:'password',
            inputPlaceholder:'Admin password',
            showCancelButton: true,
            confirmButtonColor:'#2563eb',
            cancelButtonColor:'#ef4444'
        });

        if (!adminPassword || adminPassword.trim() ==="") {
            Swal.fire('Cancelled','Kinansela ang pag-print ng barcode.','info');
            return;
        }

        try {
            const response = await authFetch(`${API_URL}/auth/verify-void`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ adminPassword: adminPassword })
            });
            const data = await response.json();

            if (!data.success) {
                Swal.fire('Access Denied', data.message ||'Maling Admin password.','error');
                return;
            }
            authMethod ="PASSWORD_VERIFIED";
        } catch (error) {
            console.error(error);
            Swal.fire('Connection Error','Hindi ma-verify ang Admin password sa ngayon.','error');
            return;
        }
    } else {
        authMethod ="ADMIN_BYPASS";
    }

    try {
        await authFetch(`${API_URL}/logs`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({
                action:"BARCODE_PRINT",
                username: currentUser ? currentUser.username :"Unknown Cashier",
                user: currentUser ? currentUser.username :"Unknown Cashier",
                authMethod: authMethod,
                details: { itemsCount: checkboxes.length, message: `Nag-print ng ${checkboxes.length} barcode label(s) (${authMethod}).` }
            })
        });
    } catch (logError) {
        console.error(logError);
    }

    const sheetContainer = document.getElementById('barcode-sheet-print-container');
    sheetContainer.innerHTML ='';

    // BAGO: itago ang huling na-generate na batch ({code, name, qty} bawat
    // piniling produkto) para magamit ng Bluetooth thermal printer path
    // (printBarcodeSheetViaBluetooth sa bt-printer.js) — kailangan ito dahil
    // ang window.print() lang (system print dialog) ang dating tanging paraan
    // para mag-print ng barcode sheet, at hindi ito gumagana sa mga device/
    // WebView na walang naka-install na print service (hal. ilang Termux/
    // Android WebView setup) — kaya "hindi gumagana" ang print button doon
    // kahit tama na ang laman ng preview. May BT fallback naman na ang resibo
    // dati (printReceiptViaBluetooth), pero wala pang katulad nito ang barcode.
    window.__lastBarcodePrintBatch = [];
    if (typeof showBtPrintButtons === 'function' && typeof hideBtPrintButtons === 'function') {
        if (typeof btPrinterCharacteristic !== 'undefined' && btPrinterCharacteristic) {
            showBtPrintButtons();
        } else {
            hideBtPrintButtons();
        }
    }

    checkboxes.forEach((cb) => {
        const code = cb.getAttribute('data-code');
        const name = cb.getAttribute('data-name');
        const printQty = parseInt(document.getElementById(`bar-qty-${code}`).value) || 1;
        window.__lastBarcodePrintBatch.push({ code, name, qty: printQty });

        for(let loop = 0; loop < printQty; loop++) {
            const cellUnit = document.createElement('div');
            cellUnit.className ='barcode-print-card-unit';

            const uniqueId = `svg-print-${code}-${loop}`;
            cellUnit.innerHTML = `
                <p>${escapeHtml(name)}</p>
                <svg id="${uniqueId}"></svg>
            `;
            sheetContainer.appendChild(cellUnit);

            setTimeout(() => {
                JsBarcode(`#${uniqueId}`, code, {
                    format:"CODE128",
                    width: 1.5,
                    height: 45,
                    displayValue: true,
                    fontSize: 10,
                    margin: 5
                });
            }, 20);
        }
    });

    document.getElementById('barcode-preview-modal').style.display ='flex';
}

let currentAnalyticsRange = 'all';

function setAnalyticsRange(range) {
    currentAnalyticsRange = range;
    document.querySelectorAll('.chip-range').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === range);
    });
    loadSalesAnalyticsReport();
}

function renderRankList(elementId, rows, opts) {
    opts = opts || {};
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';
    if (!rows || rows.length === 0) {
        el.innerHTML = `<li class="rank-empty">${opts.emptyMessage || 'Wala pang data.'}</li>`;
        return;
    }
    rows.forEach((row, idx) => {
        const li = document.createElement('li');
        li.className = 'rank-row';
        const valueClass = row.negative ? 'rank-value danger' : 'rank-value';
        li.innerHTML = `
            <span class="rank-index">${String(idx + 1).padStart(2, '0')}</span>
            <span class="rank-name">${escapeHtml(row.name)}</span>
            <span class="${valueClass}">${escapeHtml(row.value)}</span>
        `;
        el.appendChild(li);
    });
}

async function loadSalesAnalyticsReport() {
    try {
        const res = await authFetch(`${API_URL}/reports/sales-analytics?range=${currentAnalyticsRange}`);
        if (res.status === 402) {
            // Naka-lock ang feature — dapat naharang na ito ng switchView guard
            // bago pa man makarating dito, pero kung sakali, huwag na lang
            // mag-render ng anuman.
            return;
        }
        const data = await res.json();
        if (!data.success) return;

        document.getElementById('report-gross').innerText = `₱${data.gross.toFixed(2)}`;
        document.getElementById('report-count').innerText = data.transactionCount;
        document.getElementById('report-profit').innerText = data.hasCostData ? `₱${data.estimatedProfit.toFixed(2)}` : '₱0.00 (no cost data)';
        document.getElementById('report-margin-pct').innerText = data.hasCostData ? `${data.marginPct.toFixed(1)}%` : '—';

        // 7-day trend bars (muling ginagamit ang parehong .trend-bar-col/.trend-bar
        // na CSS ng Overview dashboard, para consistent ang visual language).
        const trendContainer = document.getElementById('analytics-trend-bars');
        if (trendContainer && Array.isArray(data.dailyTrend)) {
            const maxVal = Math.max(1, ...data.dailyTrend.map(d => d.total));
            const todayKey = new Date().toISOString().slice(0, 10);
            trendContainer.innerHTML = data.dailyTrend.map(d => {
                const heightPct = Math.max(4, Math.round((d.total / maxVal) * 100));
                const isToday = d.date === todayKey;
                return `
                    <div class="trend-bar-col" title="₱${d.total.toFixed(2)}">
                        <div class="trend-bar${isToday ? ' is-today' : ''}" style="height:${heightPct}%;"></div>
                        <span style="font-size:0.7rem;color:#94a3b8;">${escapeHtml(d.label)}</span>
                    </div>`;
            }).join('');
        }

        renderRankList('top-products-list', (data.topProducts || []).map(p => ({ name: p.name, value: `${p.qty} sold` })),
            { emptyMessage: 'Wala pang sales data.' });

        renderRankList('slow-products-list', (data.slowProducts || []).map(p => ({ name: p.name, value: `${p.qty} sold` })),
            { emptyMessage: 'Wala pang sales data.' });

        if (!data.hasCostData) {
            renderRankList('profit-by-product-list', [], { emptyMessage: 'Wala pang Cost Price na naka-set sa mga produkto. Idagdag ito sa Inventory > Edit Product para lumabas ang profit dito.' });
        } else {
            renderRankList('profit-by-product-list', (data.profitByProduct || []).map(p => ({ name: p.name, value: `₱${p.profit.toFixed(2)}`, negative: p.profit < 0 })),
                { emptyMessage: 'Wala pang sales data.' });
        }

        const paymentRows = Object.entries(data.paymentBreakdown || {})
            .sort((a, b) => b[1] - a[1])
            .map(([method, total]) => ({ name: method, value: `₱${total.toFixed(2)}` }));
        renderRankList('payment-breakdown-list', paymentRows, { emptyMessage: 'Wala pang sales data.' });

    } catch (e) { console.error(e); }
  checkAdminResetVisibility();
}

const USER_TAB_PERMISSION_MAP = {
'manage-users-tab':'users_manage',
'pending-requests-tab':'pending_requests',
'roles-permissions-tab':'roles_permissions_view',
'receipt-custom-tab':'receipt_settings_view',
'reset-restore-panel':'reset_restore'
};

function isUserTabAllowed(tabId) {
    const activeUser = JSON.parse(localStorage.getItem('posa_user') ||'null');
    if ((activeUser && (activeUser.role ||'').toLowerCase()) ==='admin') return true;
    const permKey = USER_TAB_PERMISSION_MAP[tabId];
    if (!permKey) return true;
    return !!(currentPermissions && currentPermissions[permKey]);
}

function updateUsersTabVisibility() {
    const btnMap = {
'manage-users-tab':'manage-users-tab-btn',
'pending-requests-tab':'pending-requests-counter-tab',
'roles-permissions-tab':'roles-permissions-tab-btn',
'receipt-custom-tab':'receipt-custom-tab-btn',
'reset-restore-panel':'reset-restore-btn'
    };
    let activeTabStillVisible = false;
    let firstVisibleTabId = null;

    Object.keys(USER_TAB_PERMISSION_MAP).forEach((tabId) => {
        const btn = document.getElementById(btnMap[tabId]);
        if (!btn) return;
        const allowed = isUserTabAllowed(tabId);
        btn.style.display = allowed ?'' :'none';
        if (allowed && !firstVisibleTabId) firstVisibleTabId = tabId;
        if (allowed && btn.classList.contains('active')) activeTabStillVisible = true;
    });

    if (!activeTabStillVisible && firstVisibleTabId) {
        const fallbackBtn = document.getElementById(btnMap[firstVisibleTabId]);
        switchUserTab(firstVisibleTabId, fallbackBtn);
    }
}

function switchUserTab(tabId, element) {

    if (Object.prototype.hasOwnProperty.call(USER_TAB_PERMISSION_MAP, tabId) && !isUserTabAllowed(tabId)) {
        console.warn(`[OmniPOS] Access denied to Users tab "${tabId}" for the current role`);
        return;
    }

    if (tabId ==='roles-permissions-tab') {
        updateRolesPermissionsLockState();
    }

    if (tabId !=='receipt-custom-tab' && typeof closeGoogleAppVerificationFloatingBox ==='function') {
        closeGoogleAppVerificationFloatingBox();
    }

    if (tabId !=='reset-restore-panel' && typeof closeAllResetRestoreCards ==='function') {
        closeAllResetRestoreCards();
    }

    document.querySelectorAll('.tab-content-panel').forEach(p => p.style.display ='none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    document.getElementById(tabId).style.display ='flex';
    if (element) {
        element.classList.add('active');
    }
}

// ===== Users Page: Swipe Left/Right to Switch Tabs (mobile view only) =====
// Self-contained addition — does not modify switchUserTab / updateUsersTabVisibility.
// Swiping left moves to the next visible tab, swiping right moves to the
// previous one. Swipes that start inside a horizontally-scrollable table
// (e.g. the Roles & Permissions matrix, or a wide data table) are ignored so
// this never fights with the table's own left/right scrolling.
function initUsersViewSwipeTabs() {
    const usersView = document.getElementById('view-users');
    if (!usersView) return;

    const SWIPE_MIN_DISTANCE = 60;
    const SWIPE_MAX_OFF_AXIS = 60;
    const SWIPE_MAX_TIME = 700;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let touchActive = false;
    let skipSwipe = false;

    function isInsideHorizontalScroller(target) {
        if (!target || typeof target.closest !== 'function') return false;
        const scroller = target.closest('.table-container, .permission-matrix-scroll');
        if (!scroller) return false;
        return scroller.scrollWidth > scroller.clientWidth + 1;
    }

    function getVisibleTabButtons() {
        return Array.from(usersView.querySelectorAll('.tabs-container .tab-btn'))
            .filter(btn => btn.style.display !== 'none');
    }

    function goToAdjacentTab(direction) {
        const btns = getVisibleTabButtons();
        if (btns.length < 2) return;
        const activeIndex = btns.findIndex(b => b.classList.contains('active'));
        if (activeIndex === -1) return;
        const nextIndex = (activeIndex + direction + btns.length) % btns.length;
        btns[nextIndex].click();
    }

    usersView.addEventListener('touchstart', (e) => {
        if (typeof isMobileOrTabletScreen === 'function' && !isMobileOrTabletScreen()) return;
        if (!e.touches || e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        touchActive = true;
        skipSwipe = isInsideHorizontalScroller(e.target);
    }, { passive: true });

    usersView.addEventListener('touchend', (e) => {
        if (!touchActive) return;
        touchActive = false;
        if (skipSwipe) { skipSwipe = false; return; }
        if (typeof isMobileOrTabletScreen === 'function' && !isMobileOrTabletScreen()) return;
        if (!e.changedTouches || !e.changedTouches.length) return;

        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const elapsed = Date.now() - touchStartTime;

        if (elapsed > SWIPE_MAX_TIME) return;
        if (Math.abs(deltaY) > SWIPE_MAX_OFF_AXIS) return;
        if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE) return;

        goToAdjacentTab(deltaX < 0 ? 1 : -1);
    }, { passive: true });

    usersView.addEventListener('touchcancel', () => {
        touchActive = false;
        skipSwipe = false;
    }, { passive: true });
}

document.addEventListener('DOMContentLoaded', initUsersViewSwipeTabs);

async function loadUsersTable() {
    try {

const res = await authFetch(`${API_URL}/users?requester=${currentUser.username}`);
        if (!res.ok) throw new Error('Network response was not ok');

        const users = await res.json();
        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML ='';

        const roleClasses = {
'Staff':'staff',
'Cashier':'cashier',
'Admin':'admin'
        };

        users.forEach(u => {
            const badgeClass = roleClasses[u.role] ||'custom';
            const row = document.createElement('tr');

            row.innerHTML = `
                <td class="font-bold user-name-cell"></td>
                <td><span class="badge-role ${badgeClass}">${u.role}</span></td>
                <td>${u.created ||'N/A'}</td>
                <td>
                    <div class="action-icon-btns-row">
                        <button class="btn-icon-action avatar" title="Edit Photo">
                            <i class="fa-solid fa-camera"></i>
                        </button>
                        <button class="btn-icon-action edit" title="Reset Password">
                            <i class="fa-solid fa-key"></i>
                        </button>
                        <button class="btn-icon-action delete">
                            <i class="fa-solid fa-user-minus"></i>
                        </button>
                    </div>
                </td>
            `;

            const nameCell = row.querySelector('.user-name-cell');
            nameCell.innerHTML = u.avatar
                ? `<img src="${u.avatar}" class="user-avatar-thumb" alt="">`
                : `<i class="fa-solid fa-user-tag" style="margin-right:8px; color:#64748b;"></i>`;
            nameCell.appendChild(document.createTextNode(u.username));

            row.querySelector('.avatar').addEventListener('click', () => openUserAvatarModal(u.username, u.avatar ||''));
            row.querySelector('.edit').addEventListener('click', () => resetPasswordTrigger(u.username));

            const deleteBtn = row.querySelector('.delete');
if (u.username && u.username.toLowerCase() ==='admin') {
    deleteBtn.disabled = true;
    deleteBtn.style.opacity ='0.3';
    deleteBtn.style.cursor ='not-allowed';
} else {
    deleteBtn.addEventListener('click', () => deleteUserAccount(u.username));
}

            tbody.appendChild(row);
        });
    } catch (e) {
        console.error("Failed to load users:", e);
    }
}

function openAddUserModal() {
    document.getElementById('user-schema-form').reset();
    removeAvatarPhoto('u-form-avatar','u-form-photo-preview');
    document.getElementById('user-modal').style.display ='flex';
}

function handleAvatarFileSelect(event, hiddenInputId, previewBoxId) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        Swal.fire('Invalid File Type','Only images (JPG, PNG, etc.) can be uploaded as a profile picture.','error');
        event.target.value ='';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const SIZE = 200;
            const canvas = document.createElement('canvas');
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext('2d');

            const side = Math.min(img.width, img.height);
            const sx = (img.width - side) / 2;
            const sy = (img.height - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);

            document.getElementById(hiddenInputId).value = compressedDataUrl;
            updateAvatarPreview(previewBoxId, compressedDataUrl);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function updateAvatarPreview(previewBoxId, dataUrl) {
    const preview = document.getElementById(previewBoxId);
    if (!preview) return;
    const removeBtnId = previewBoxId ==='u-form-photo-preview' ?'u-form-photo-remove-btn'
        : previewBoxId ==='ua-photo-preview' ?'ua-photo-remove-btn'
        : previewBoxId ==='ep-photo-preview' ?'ep-photo-remove-btn' : null;
    const removeBtn = removeBtnId ? document.getElementById(removeBtnId) : null;
    if (dataUrl) {
        preview.innerHTML = `<img src="${dataUrl}" alt="Profile picture preview">`;
        if (removeBtn) removeBtn.style.display ='inline-block';
    } else {
        preview.innerHTML = `<i class="fa-solid fa-user"></i>`;
        if (removeBtn) removeBtn.style.display ='none';
    }
}

function removeAvatarPhoto(hiddenInputId, previewBoxId) {
    const hidden = document.getElementById(hiddenInputId);
    if (hidden) hidden.value ='';
    updateAvatarPreview(previewBoxId,'');
}

let rolesMatrixCache = { roles: [], menuRegistry: [] };
let pendingMatrixEdits = {};
let columnOrderDirty = false;

async function loadRolesPermissionMatrix() {
    try {
        const res = await authFetch(`${API_URL}/roles`);
        const data = await res.json();
        if (!data.success) return;
        rolesMatrixCache = { roles: data.roles || [], menuRegistry: data.menuRegistry || [] };
        pendingMatrixEdits = {};
        columnOrderDirty = false;
        renderPermissionMatrix();
        populateRoleSelectOptions(rolesMatrixCache.roles);
    } catch (err) {
        console.error('Failed to load roles/permissions matrix:', err);
    }
}

function getEffectivePermission(role, menuKey) {
    if (pendingMatrixEdits[role.name] && (menuKey in pendingMatrixEdits[role.name])) {
        return pendingMatrixEdits[role.name][menuKey];
    }
    return !!(role.permissions && role.permissions[menuKey]);
}

function renderPermissionMatrix() {
    const { roles, menuRegistry: registry } = rolesMatrixCache;
    const headRow = document.getElementById('permission-matrix-head-row');
    const body = document.getElementById('permission-matrix-body');
    if (!headRow || !body) return;

    // BUG FIX: with table-layout:auto (the default), width/max-width on
    // <td> elements are not truly "hard enforced" — content length still
    // takes priority, so long labels still exceed 260px and simply get
    // cut off without wrapping (line-clamp effectively has no effect
    // since the box width isn't really constrained). The
    // <colgroup>/<col> combined with table-layout:fixed (CSS) is what
    // TRULY pins the column widths deterministically, no matter how
    // long the content is.
    const colgroup = document.getElementById('permission-matrix-colgroup');
    if (colgroup) {
        colgroup.innerHTML = '<col class="matrix-col-label">' + roles.map(() => '<col class="matrix-col-role">').join('');
    }

    headRow.innerHTML ='<th class="matrix-col-label">Menu</th>' + roles.map((r, idx) => `
        <th class="matrix-col-role" style="text-align:center; white-space:nowrap;">
            <div style="display:flex; align-items:center; justify-content:center; gap:4px;">
                <button type="button" class="matrix-col-reorder-btn" title="Move left"
                    ${idx === 0 ?'disabled' :''} onclick="moveRoleColumn(${idx}, -1)"><i class="fa-solid fa-chevron-left"></i></button>
                <span>${escapeHtml(r.name)}</span>
                <button type="button" class="matrix-col-reorder-btn" title="Move right"
                    ${idx === roles.length - 1 ?'disabled' :''} onclick="moveRoleColumn(${idx}, 1)"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
        </th>
    `).join('');

    const menuRows = registry.map(m => `
        <tr>
            <td class="matrix-col-label" title="${escapeHtml(m.label)}"><span class="matrix-label-text">${escapeHtml(m.label)}</span></td>
            ${roles.map(r => `
                <td class="matrix-col-role" style="text-align:center;">
                    <input type="checkbox" style="width:18px; height:18px;"
                        ${getEffectivePermission(r, m.key) ?'checked' :''}
                        ${r.protected ?'disabled title="Admin always has full access"' :''}
                        onchange="handlePermissionToggle('${escapeHtml(r.name)}', '${m.key}', this.checked)">
                </td>
            `).join('')}
        </tr>
    `).join('');

    const saveRow = `
        <tr>
            <td class="matrix-col-label" style="color:#94a3b8; font-style:italic;">Save Changes</td>
            ${roles.map(r => r.protected
                ?'<td class="matrix-col-role"></td>'
                : `<td class="matrix-col-role" style="text-align:center;">
                    <div style="display:inline-flex; gap:6px; align-items:center;">
                        <button type="button" class="btn-icon-action edit" title="Save permissions" onclick="saveRolePermissions('${escapeHtml(r.name)}')"><i class="fa-solid fa-floppy-disk"></i></button>
                        <button type="button" class="btn-icon-action delete" title="Delete role" onclick="deleteRole('${escapeHtml(r.name)}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                   </td>`
            ).join('')}
        </tr>
    `;

    body.innerHTML = menuRows + saveRow;
}

function moveRoleColumn(index, direction) {
    const roles = rolesMatrixCache.roles;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= roles.length) return;

    const temp = roles[index];
    roles[index] = roles[targetIndex];
    roles[targetIndex] = temp;

    columnOrderDirty = true;
    const saveBtn = document.getElementById('save-column-order-btn');
    if (saveBtn) saveBtn.style.display ='inline-flex';

    renderPermissionMatrix();
}

async function saveRoleColumnOrder() {
    if (guardPremiumFeature('rbac_management')) return;
    const orderedRoleNames = rolesMatrixCache.roles.map(r => r.name);

    const adminPassword = await promptAdminPasswordConfirm('Save the new Role column order in the Permission Matrix');
    if (!adminPassword) return;

    try {
        const res = await authFetch(`${API_URL}/roles/reorder`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ orderedRoleNames, username: currentUser.username, adminPassword })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ toast: true, position:'top-end', icon:'success', title:'The new column order has been saved', showConfirmButton: false, timer: 2000, timerProgressBar: true });
            rolesMatrixCache.roles = data.roles;
            columnOrderDirty = false;
            const saveBtn = document.getElementById('save-column-order-btn');
            if (saveBtn) saveBtn.style.display ='none';
            renderPermissionMatrix();
            populateRoleSelectOptions(rolesMatrixCache.roles);
        } else {
            Swal.fire('Not Saved', data.message ||'An error occurred while saving the column order.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to save the column order right now.','error');
    }
}

function handlePermissionToggle(roleName, menuKey, checked) {
    if (!pendingMatrixEdits[roleName]) pendingMatrixEdits[roleName] = {};
    pendingMatrixEdits[roleName][menuKey] = checked;
}

async function saveRolePermissions(roleName) {
    if (guardPremiumFeature('rbac_management')) return;
    const role = rolesMatrixCache.roles.find(r => r.name === roleName);
    if (!role) return;
    const finalPermissions = { ...role.permissions, ...(pendingMatrixEdits[roleName] || {}) };

    const adminPassword = await promptAdminPasswordConfirm(`Save the updated access for the "${roleName}" role`);
    if (!adminPassword) return;

    try {
        const res = await authFetch(`${API_URL}/roles`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ roleName, permissions: finalPermissions, username: currentUser.username, adminPassword })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ toast: true, position:'top-end', icon:'success', title: `Permissions for "${roleName}" have been saved`, showConfirmButton: false, timer: 2000, timerProgressBar: true });
            rolesMatrixCache.roles = data.roles;
            delete pendingMatrixEdits[roleName];
            renderPermissionMatrix();

            if (currentUser && (currentUser.role ||'').toLowerCase() === roleName.toLowerCase()) {
                refreshPermissions();
            }
        } else {
            Swal.fire('Not Saved', data.message ||'An error occurred while saving the permissions.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to save permission changes right now.','error');
    }
}

async function deleteRole(roleName) {
    if (guardPremiumFeature('rbac_management')) return;
    const confirmResult = await Swal.fire({
        title: `Delete the "${roleName}" role?`,
        text:'This cannot be undone. If users are still assigned to this role, deletion will not be allowed — they must be reassigned first.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonColor:'#ef4444',
        cancelButtonColor:'#64748b',
        confirmButtonText:'Yes, delete it'
    });
    if (!confirmResult.isConfirmed) return;

    const adminPassword = await promptAdminPasswordConfirm(`Delete role: ${roleName}`);
    if (!adminPassword) return;

    try {
        const res = await authFetch(`${API_URL}/roles/delete`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ roleName, username: currentUser.username, adminPassword })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire('Deleted', `The "${roleName}" role has been deleted.`,'success');
            rolesMatrixCache.roles = data.roles;
            delete pendingMatrixEdits[roleName];
            renderPermissionMatrix();
            populateRoleSelectOptions(rolesMatrixCache.roles);
        } else {
            Swal.fire('Not Deleted', data.message ||'An error occurred while deleting the role.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to delete the role right now.','error');
    }
}

function openAddRoleModal() {
    if (guardPremiumFeature('rbac_management')) return;
    const form = document.getElementById('role-schema-form');
    if (form) form.reset();
    document.getElementById('role-modal').style.display ='flex';
}

function populateRoleSelectOptions(roles) {
    const select = document.getElementById('u-form-role');
    if (!select || !roles || !roles.length) return;
    const previousValue = select.value;
    select.innerHTML = roles.map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
    if (roles.some(r => r.name === previousValue)) select.value = previousValue;
}

document.addEventListener('DOMContentLoaded', () => {
    const roleForm = document.getElementById('role-schema-form');
    if (roleForm) {
        roleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const roleName = document.getElementById('r-form-name').value.trim();
            if (!roleName) return;

            const blankPermissions = {};
            (rolesMatrixCache.menuRegistry || []).forEach(m => { blankPermissions[m.key] = false; });

            const adminPassword = await promptAdminPasswordConfirm(`Create new role: ${roleName}`);
            if (!adminPassword) return;

            try {
                const res = await authFetch(`${API_URL}/roles`, {
                    method:'POST',
                    headers: {'Content-Type':'application/json' },
                    body: JSON.stringify({ roleName, permissions: blankPermissions, username: currentUser.username, adminPassword })
                });
                const data = await res.json();
                if (data.success) {
                    closeModal('role-modal');
                    rolesMatrixCache.roles = data.roles;
                    renderPermissionMatrix();
                    populateRoleSelectOptions(data.roles);
                    Swal.fire('Created', `The "${roleName}" role has been created. Toggle the menus to allow for it.`,'success');
                } else {
                    Swal.fire('Not Created', data.message ||'An error occurred while creating the role.','error');
                }
            } catch (err) {
                console.error(err);
                Swal.fire('Connection Error','Unable to create the role right now.','error');
            }
        });
    }
});

async function promptAdminPasswordConfirm(actionLabel) {
    const { value: adminPassword } = await Swal.fire({
        title:'🔒 Confirm Admin Password',
        html: `To continue with: <b>${actionLabel}</b>, re-enter the Admin password:`,
        input:'password',
        inputPlaceholder:'Admin password',
        showCancelButton: true,
        confirmButtonColor:'#2563eb',
        cancelButtonColor:'#ef4444'
    });
    if (!adminPassword || adminPassword.trim() ==='') {
        return null;
    }
    return adminPassword;
}

async function handleUserFormSubmit(e) {
    e.preventDefault();

    if (!currentUser || !currentUser.username) {
        Swal.fire('Session Expired', SYSTEM_CONFIG.getErrorMessage("Operational Context Exception: Active user session null."),'error');
        return;
    }

    const userPayload = {
        username: document.getElementById('u-form-username').value.trim(),
        password: document.getElementById('u-form-password').value.trim(),
        role: document.getElementById('u-form-role').value,
        avatar: document.getElementById('u-form-avatar').value || null
    };

    if (!userPayload.username || !userPayload.password) {
        Swal.fire('Missing Values', SYSTEM_CONFIG.getErrorMessage("Validation Constraint Violation: Identity fields cannot be blank."),'warning');
        return;
    }

    const adminPassword = await promptAdminPasswordConfirm(`New user account: ${userPayload.username}`);
    if (!adminPassword) return;

    try {
        const res = await authFetch(`${API_URL}/users`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ user: userPayload, username: currentUser.username, adminPassword })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            Swal.fire('Created', SYSTEM_CONFIG.getSuccessMessage("System Credentials Provisioned successfully."),'success');
            closeModal('user-modal');
            if (typeof loadUsersTable ==='function') loadUsersTable();
            if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();
            e.target.reset();
        } else {
            Swal.fire('Execution Interrupted', SYSTEM_CONFIG.getErrorMessage(data.message ||"Process failed to complete requests."),'error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Gateway Error', SYSTEM_CONFIG.getErrorMessage("Remote network transport paths disrupted."),'error');
    }
}

let pendingAvatarTargetUser = null;

function openUserAvatarModal(username, currentAvatar) {
    pendingAvatarTargetUser = username;
    document.getElementById('ua-target-username').innerText = username;
    document.getElementById('ua-avatar').value = currentAvatar ||'';
    updateAvatarPreview('ua-photo-preview', currentAvatar ||'');
    document.getElementById('ua-photo-input').value ='';
    document.getElementById('user-avatar-modal').style.display ='flex';
}

async function saveUserAvatar() {
    if (!pendingAvatarTargetUser) return;
    const avatar = document.getElementById('ua-avatar').value || null;

    const adminPassword = await promptAdminPasswordConfirm(`Update profile picture for: ${pendingAvatarTargetUser}`);
    if (!adminPassword) return;

    try {
        const res = await authFetch(`${API_URL}/users/${encodeURIComponent(pendingAvatarTargetUser)}/avatar`, {
            method:'PUT',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ avatar, username: currentUser.username, adminPassword })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            Swal.fire('Saved', SYSTEM_CONFIG.getSuccessMessage('The profile picture has been updated.'),'success');
            closeModal('user-avatar-modal');
            if (typeof loadUsersTable ==='function') loadUsersTable();

            if (currentUser && currentUser.username.toLowerCase() === pendingAvatarTargetUser.toLowerCase()) {
                currentUser.avatar = avatar;
                localStorage.setItem('posa_user', JSON.stringify(currentUser));
                renderSidebarUserWidget();
            }
        } else {
            Swal.fire('Execution Interrupted', SYSTEM_CONFIG.getErrorMessage(data.message ||'Process failed to complete requests.'),'error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Gateway Error', SYSTEM_CONFIG.getErrorMessage('Remote network transport paths disrupted.'),'error');
    }
}

async function deleteUserAccount(targetUsername) {
    if (!currentUser || currentUser.role.toLowerCase() !=='admin') {
        Swal.fire('Restricted Access',"Access Control Exception: Action restricted to administrative operators.",'error');
        return;
    }

    const confirmation = await Swal.fire({
        title:'Critical Structural Warning',
        text: `Are you absolute certain you want to permanently delete system profile entries for [ ${targetUsername} ]?`,
        icon:'warning',
        showCancelButton: true,
        confirmButtonColor:'#ef4444',
        cancelButtonColor:'#64748b',
        confirmButtonText:'Yes, permanently delete'
    });

    if (!confirmation.isConfirmed) return;

    const adminPassword = await promptAdminPasswordConfirm(`Delete account: ${targetUsername}`);
    if (!adminPassword) return;

    try {
        const res = await authFetch(`${API_URL}/users/delete-account`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ targetUser: targetUsername, username: currentUser.username, adminPassword })
        });

        const output = await res.json();
        if (output.success) {
            Swal.fire('Deleted', output.message,'success');
            if (typeof loadUsersTable ==='function') loadUsersTable();
            if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();
        } else {
            Swal.fire('Error Trace', output.message,'error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Infrastructure Failure',"Transport Infrastructure Failure: Endpoint routing mechanisms dropped.",'error');
    }
}

async function loadPendingRequestsTable() {
    try {
        const res = await authFetch(`${API_URL}/requests`);
        const requests = await res.json();

        const counterTab = document.getElementById('pending-requests-counter-tab');
        counterTab.innerText = `Pending Requests (${requests.length})`;

        const tbody = document.getElementById('requests-table-body');
        tbody.innerHTML ='';

        if(requests.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; font-style:italic; padding:30px;">No pending operation alteration authorization requests detected in data queues.</td></tr>`;
            return;
        }

        const isAdmin = currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin';

                requests.forEach(r => {
            let summaryDetails ='N/A';
            if (r.type ==='PROFILE_UPDATE') {
                const bits = [];
                if (r.data?.username) bits.push(`New username: ${r.data.username}`);
                if (typeof r.data?.avatar !=='undefined') bits.push(r.data.avatar ?'New profile picture' :'Remove profile picture');
                summaryDetails = bits.length ? bits.join(' | ') :'Edit Profile (widget) request';
            } else if(r.type ==='ADD' || r.type ==='UPDATE') {
                summaryDetails = `Name: ${r.data?.name ||'N/A'} | Price: ₱${r.data?.price || 0} | Stock: ${r.data?.stock || 0}`;
            } else {
                summaryDetails = `Remove targeted item code allocation from system array database record tracking rows completely.`;
            }

            const row = document.createElement('tr');
            const safeReqId = escapeHtml(r.id).replace(/'/g,'&#39;');
            row.innerHTML = `
                <td><strong>${escapeHtml(r.requester)}</strong></td>
                <td><span class="badge-role staff" style="background:#fef2f2; color:#ef4444;">${escapeHtml(r.type)}</span></td>
                <td class="font-bold">${escapeHtml(r.type ==='PROFILE_UPDATE' ? (r.targetUser ||'N/A') : (r.targetCode || r.data?.code ||'N/A'))}</td>
                <td style="font-size:0.85rem; max-width:300px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(summaryDetails)}">${escapeHtml(summaryDetails)}</td>
                <td>${escapeHtml(r.timestamp)}</td>
                <td>
                    <div class="action-icon-btns-row" ${!isAdmin ?'style="display:none;"' :''}>
                        <!-- REFACTORED WORKFLOW CONTROLS: Extraneous character literals sanitized from the index tracking logic rows below -->
                        <button class="btn-icon-action edit" style="background-color:#22c55e;" onclick="resolveStaffOperationRequest('${safeReqId}', 'APPROVE')" title="Approve Changes"><i class="fa-solid fa-square-check"></i></button>
                        <button class="btn-icon-action delete" onclick="resolveStaffOperationRequest('${safeReqId}', 'REJECT')" title="Reject Changes"><i class="fa-solid fa-rectangle-xmark"></i></button>
                    </div>
                    ${!isAdmin ?'<span style="font-size:0.8rem; color:#64748b; font-style:italic;">Admin Check Required</span>' :''}
                </td>
            `;
            tbody.appendChild(row);
        });

    } catch (e) {
        console.error("Error loading pending requests:", e);
    }
}

async function resolveStaffOperationRequest(id, decisionAction) {
    const confirmation = await Swal.fire({
        title:'Confirm Request Resolution',
        text: `Execute action: ${decisionAction.toLowerCase()} on request payload ID reference ${id}?`,
        icon:'question',
        showCancelButton: true,
        confirmButtonColor: decisionAction ==='APPROVE' ?'#22c55e' :'#ef4444',
        cancelButtonColor:'#64748b',
        confirmButtonText: `Yes, ${decisionAction.toLowerCase()}`
    });

    if(!confirmation.isConfirmed) return;

    const adminPassword = await promptAdminPasswordConfirm(`${decisionAction} request ${id}`);
    if (!adminPassword) return;

    try {
        const res = await authFetch(`${API_URL}/requests/${id}/resolve`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ action: decisionAction, username: currentUser.username, role: currentUser.role, adminPassword })
        });

        const msg = await res.json();

        if (res.ok && msg.success !== false) {
            Swal.fire('Resolved', msg.message || `Request ${decisionAction.toLowerCase()} processed successfully.`,'success');
            loadPendingRequestsTable();
            if (decisionAction ==='APPROVE') {
                if (typeof loadInventoryProductsTable ==='function') loadInventoryProductsTable();
                if (typeof loadTerminalCatalog ==='function') loadTerminalCatalog();
                if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();
            }
        } else {
            Swal.fire('Operation Rejection', `❌ Operation Rejection: ${msg.message ||'The central ledger engine encountered difficulties.'}`,'error');
        }
    } catch (e) {
        console.error(e);
        Swal.fire('Host Interface Break','Unable to stabilize connection vectors heading toward system data microservices.','error');
    }
}

async function loadSystemAuditLogs() {
    if (!currentUser || !currentPermissions || !currentPermissions.logs) return;

    try {

        const res = await authFetch(`${API_URL}/logs?requester=${encodeURIComponent(currentUser.username)}`);
        if (res.status === 403) {
            console.warn("Security Alert: Insufficient access clearance profiles level. Request to fetch system operational trace records denied.");
            return;
        }
        const payload = await res.json();

        const logs = Array.isArray(payload) ? payload : (payload.data || []);
        const tbody = document.getElementById('system-logs-table-body');
        if (!tbody) return;
        tbody.innerHTML ='';

        if (!payload.success && !Array.isArray(payload)) {
            console.warn("System logs fetch was not successful:", payload.message);
        }

        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${log.id}</td>
                <td><span class="badge user-badge">${escapeHtml(log.username)}</span></td>
                <td><span class="text-muted">${log.timestamp}</span></td>
                <td><strong>${escapeHtml(log.action)}</strong></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("System Log Fetch Exception: Failed to inherit administrative chronological system monitoring parameters logs.", err);
    }
}

async function saveCartToDatabase() {
    if (!currentUser || !currentUser.username) return;

    try {
        await authFetch(`${API_URL}/cart`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({
                username: currentUser.username,
                cart: shoppingCart
            })
        });
    } catch (error) {
        console.error("Error saving cart to database:", error);
    }
}

async function loadCartFromDatabase() {
    if (!currentUser || !currentUser.username) return;

    try {
        const response = await authFetch(`${API_URL}/cart/${currentUser.username}`);
        const data = await response.json();
        if (data.success) {
            shoppingCart = data.cart || [];
            renderCartRows();
        }
    } catch (error) {
        console.error("Error loading cart from database:", error);
    }
}

async function executeSystemHardReset() {
    const elConfirm = document.getElementById('reset-confirm-word');
    const elAdditionalEmail = document.getElementById('reset-additional-email');

    if (!elConfirm || !elAdditionalEmail) {
        Swal.fire('UI Error','Some input elements are missing from your layout view.','error');
        return;
    }

    const confirmWord = elConfirm.value.trim();
    const additionalEmail = elAdditionalEmail.value.trim();

    if (confirmWord !=='RESET') {
        Swal.fire('Confirmation Required','Type the word "RESET" in the box provided to continue.','warning');
        return;
    }

    if (!receiptSettingsCache || !receiptSettingsCache.otpSenderConfigured) {
        Swal.fire('Google App Not Yet Verified','Set up and verify the Google App in the Receipt Customization panel before using Hard Reset.','warning');
        return;
    }

    if (!additionalEmail) {
        Swal.fire('Missing Data','Secondary Backup Email is required — the backup file will be sent there.','warning');
        return;
    }

    const doubleCheck = await Swal.fire({
        title:'Are you absolutely sure?',
        text:"The system will take a 100% synchronized backup, send it to the Secondary Backup Email using the verified Google App, and permanently delete your current databases!",
        icon:'warning',
        showCancelButton: true,
        confirmButtonColor:'#ef4444',
        cancelButtonColor:'#64748b',
        confirmButtonText:'Yes, Start Backup and Reset',
        cancelButtonText:'Cancel'
    });

    if (!doubleCheck.isConfirmed) return;

    Swal.fire({
        title:'Processing System Reset...',
        text:'Taking a synchronized 7/7 snapshot and sending it to the mail servers. Do not refresh or close this page.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        const response = await authFetch(`${API_URL}/system/reset`, {
            method:'POST',
            headers: {
'Content-Type':'application/json'
            },
            body: JSON.stringify({
                additionalEmail: additionalEmail
            })
        });

        const result = await response.json();

        if (result.success) {
            Swal.fire({
                title:'Reset Successful!',
                text: result.message,
                icon:'success'
            }).then(() => {
                localStorage.removeItem('posa_user');
                localStorage.removeItem('posa_token');
                localStorage.removeItem('posa_unlocked_themes_cache');
                localStorage.removeItem('posa_darkmode');
                localStorage.setItem('posa_theme', 'dark');
                sessionStorage.clear();
                window.location.reload();
            });
        } else {
            Swal.fire('Process Failed', result.message,'error');
        }
    } catch (error) {
        console.error("Hard Reset Error Connection:", error);
        Swal.fire('Network Error','Unable to connect to your local server API backend.','error');
    }
}

// Manual "Sync with Relay Now" — for cases where an immediate restore
// is needed without waiting for a server restart (the automatic check
// already runs inside the System Hard Reset endpoint itself, but this
// is the backup/manual path, e.g. after reinstalling the app on the
// same device).
let lastCheckedUpdateInfo = null;

async function checkForSystemUpdate() {
    if (blockIfOffline('Checking for updates')) return;
    const statusEl = document.getElementById('system-update-status');
    const deployBtn = document.getElementById('system-update-deploy-btn');
    if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Retrieving status from RELAY&hellip;';
    if (deployBtn) deployBtn.style.display = 'none';

    try {
        const response = await authFetch(`${API_URL}/system/update-check`);
        const result = await response.json();

        if (!result.success) {
            if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger-red);"></i> ${result.message || 'Unable to check the update status.'}`;
            return;
        }

        lastCheckedUpdateInfo = result;

        if (result.updateAvailable) {
            if (statusEl) {
                statusEl.innerHTML =
                    `<i class="fa-solid fa-circle-up" style="color:var(--pos-accent,#2563eb);"></i> ` +
                    `<strong>New update available!</strong> Current: v${result.currentVersion} &rarr; New: v${result.latestVersion}` +
                    (result.changelog ? `<br><span style="color:var(--text-muted);">${result.changelog}</span>` : '');
            }
            if (deployBtn) deployBtn.style.display = 'flex';
        } else {
            if (statusEl) {
                statusEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success-green,#16a34a);"></i> System is up to date (v${result.currentVersion}).`;
            }
        }
    } catch (error) {
        if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger-red);"></i> Unable to connect to the server.';
    }
}

async function deploySystemUpdate() {
    if (blockIfOffline('Deploying updates')) return;
    if (!lastCheckedUpdateInfo || !lastCheckedUpdateInfo.updateAvailable) {
        Swal.fire('Not Checked Yet', 'Click "Check for Updates" first before deploying.', 'info');
        return;
    }

    const confirmResult = await Swal.fire({
        title: 'Deploy the Update?',
        html: `The system will be redeployed to <strong>v${lastCheckedUpdateInfo.latestVersion}</strong> on Render. This will take a few minutes — your data (products, transactions, users, etc.) will not be affected, and the system will refresh automatically afterward.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, deploy now',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#16a34a'
    });
    if (!confirmResult.isConfirmed) return;

    const targetVersion = lastCheckedUpdateInfo.latestVersion;

    Swal.fire({
        title: 'Deploying the Update...',
        text: 'Starting the new deploy on Render.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const response = await authFetch(`${API_URL}/system/deploy-update`, { method: 'POST' });
        const result = await response.json();
        if (!result.success) {
            Swal.fire('Not Triggered', result.message || 'Unable to trigger the deploy.', 'error');
            return;
        }

        // BUG FIX: previously, the function ended here right after the
        // "Deploy Triggered" toast — so even after the server successfully
        // deployed/restarted on the NEW version, there was no automatic
        // "System is up to date" confirmation shown afterward. Now, we poll
        // the update-check endpoint (repeatedly, allowing for temporary
        // connection errors while the server restarts/redeploys) until the
        // new version is confirmed LIVE — only then is the real "up to
        // date" confirmation shown.
        pollForDeployCompletion(targetVersion, result.message);
    } catch (error) {
        Swal.fire('Network Error', 'Unable to connect to the server backend.', 'error');
    }
}

const DEPLOY_POLL_INTERVAL_MS = 5000;
// Sakop parehong Termux self-update (mabilis lang, ilang segundo) at
// Render redeploy (which can take several minutes) before timing out.
const DEPLOY_POLL_TIMEOUT_MS = 6 * 60 * 1000;

async function pollForDeployCompletion(targetVersion, triggerMessage) {
    const statusEl = document.getElementById('system-update-status');
    const startedAt = Date.now();

    Swal.fire({
        title: 'Waiting for the New Version...',
        html: (triggerMessage || 'The deploy has been triggered.') + '<br><br>Confirmation will appear here automatically once the update is complete — please do not close this tab.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const poll = async () => {
        try {
            const response = await authFetch(`${API_URL}/system/update-check`);
            const result = await response.json();
            // The deploy is done when: the check succeeds, updateAvailable
            // is NO LONGER true, and (if we have a target version from the
            // last "Check for Updates") it matches as well — this avoids a
            // false positive in case an old cached response comes back
            // while the server is only just starting to restart.
            if (result.success && !result.updateAvailable && (!targetVersion || result.currentVersion === targetVersion)) {
                lastCheckedUpdateInfo = result;
                if (statusEl) {
                    statusEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success-green,#16a34a);"></i> System is up to date (v${result.currentVersion}).`;
                }
                const deployBtn = document.getElementById('system-update-deploy-btn');
                if (deployBtn) deployBtn.style.display = 'none';
                Swal.fire({
                    icon: 'success',
                    title: 'Deployed!',
                    text: `System is up to date (v${result.currentVersion}).`
                });
                return;
            }
        } catch (err) {
            // This is expected while the server is restarting (self-update)
            // or still redeploying (Render) — just try again.
        }

        if (Date.now() - startedAt >= DEPLOY_POLL_TIMEOUT_MS) {
            Swal.fire({
                icon: 'info',
                title: 'Taking a Bit Longer...',
                text: 'The deploy/restart may still be in progress. Click "Check for Updates" again later to confirm.'
            });
            return;
        }
        setTimeout(poll, DEPLOY_POLL_INTERVAL_MS);
    };

    setTimeout(poll, DEPLOY_POLL_INTERVAL_MS);
}

async function syncFeaturesFromRelay() {
    if (blockIfOffline('Syncing features from Relay')) return;
    Swal.fire({
        title: 'Checking Relay...',
        text: 'Looking for previously unlocked features for this device, and any that may have been deactivated or expired.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    try {
        const response = await authFetch(`${API_URL}/features/restore-check`, { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            // Refresh both caches (features and themes) FIRST, before
            // applying any UI lockdown, so isFeatureUnlockedCached()/
            // isThemeUnlocked() below read the correct values right away.
            await refreshUnlockedFeaturesFromServer();
            await refreshUnlockedThemesFromServer();
            // Refresh the Demo Mode UI too, so the floating clock icon
            // (and PRO crown badge) appears immediately if this sync
            // just restored an active demo session — instead of waiting
            // for the next periodic/page-load check.
            await initDemoModeUI();

            const removedFeatures = Array.isArray(result.removedFeatures) ? result.removedFeatures : [];
            if (removedFeatures.length > 0) {
                applyLockdownForRemovedFeatures(removedFeatures);
            }

            const icon = removedFeatures.length > 0 ? 'warning' : (result.restoredCount > 0 ? 'success' : 'info');
            const title = removedFeatures.length > 0
                ? (result.restoredCount > 0 ? 'Restored & Locked' : 'Feature(s) Locked')
                : (result.restoredCount > 0 ? 'Restored!' : 'Nothing New');

            Swal.fire({
                icon,
                title,
                html: buildRelaySyncResultHtml(result, removedFeatures)
            });
        } else {
            Swal.fire('Failed', result.message || 'Could not check Relay.', 'error');
        }
    } catch (error) {
        Swal.fire('Network Error', 'Could not connect to the server backend.', 'error');
    }
}

// Called by the "Cloud Backup Now" button in the Reset & Restore panel.
// A 402/featureLocked response (if the 'cloud_backup' feature is not yet
// unlocked) is already handled automatically by authFetch() above (it
// will show the unlock/upgrade prompt), so here we only need to focus
// on the normal success/error UI.
async function runCloudBackupSync() {
    if (blockIfOffline('Cloud Backup')) return;
    const statusBox = document.getElementById('cloud-backup-status');
    const btn = document.getElementById('cloud-backup-sync-btn');

    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'not-allowed'; }
    if (statusBox) {
        statusBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing the database to the cloud&hellip;';
    }

    try {
        const response = await authFetch(`${API_URL}/cloud-backup/sync`, { method: 'POST' });
        const result = await response.json();

        if (response.status === 402) {
            // The upgrade/unlock prompt has already been handled by
            // authFetch() — here, just return the status box to its
            // neutral state.
            if (statusBox) {
                statusBox.innerHTML = '<i class="fa-solid fa-lock"></i> The Cloud Backup feature is still locked.';
            }
            return;
        }

        if (result.success) {
            if (statusBox) {
                statusBox.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#16a34a;"></i> Successfully synced (${result.totalRecords ?? '—'} records, ${(result.moduleNames || []).length} modules) — ${new Date().toLocaleString()}`;
            }
            Swal.fire('Cloud Backup', result.message || 'The database was successfully synced to the cloud.', 'success');
        } else {
            if (statusBox) {
                statusBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i> ${result.message || 'Cloud backup failed.'}`;
            }
            Swal.fire('Failed', result.message || 'Cloud backup failed.', 'error');
        }
    } catch (error) {
        if (statusBox) {
            statusBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i> Unable to reach the server.';
        }
        Swal.fire('Network Error', 'Could not connect to the server backend.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    }
}

// Called by the "Restore from Cloud" button in the Reset & Restore panel.
// SELF-SERVICE version of cloud backup restore — this installation
// pulls its own latest synced cloud backup (no need to contact the
// developer/admin panel). An Admin password is still required here
// since this OVERWRITES the current data.
async function runCloudBackupRestore() {
    if (blockIfOffline('Cloud Backup Restore')) return;

    const confirmResult = await Swal.fire({
        title: 'Restore from Cloud?',
        html: 'This will replace the CURRENT data of every module with what is stored in your latest Cloud Backup.<br><br><strong>This cannot be undone</strong> once confirmed. Enter the Admin Password to continue:',
        input: 'password',
        inputPlaceholder: 'Admin Passphrase',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Verify and Restore'
    });

    const adminPassword = confirmResult.value;
    if (!adminPassword) return;

    const loggedInUser = currentUser ? currentUser.username : 'admin';
    const statusBox = document.getElementById('cloud-backup-status');
    const btn = document.getElementById('cloud-backup-restore-btn');

    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'not-allowed'; }
    if (statusBox) {
        statusBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Retrieving the cloud backup and restoring&hellip;';
    }

    try {
        const response = await authFetch(`${API_URL}/cloud-backup/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: loggedInUser, password: adminPassword })
        });
        const result = await response.json();

        if (response.status === 402) {
            if (statusBox) statusBox.innerHTML = '<i class="fa-solid fa-lock"></i> The Cloud Backup feature is still locked.';
            return;
        }
        if (response.status === 403 && result.code === 'WRONG_ADMIN_PASSWORD') {
            Swal.fire('Access Denied', result.message || 'Incorrect Admin password.', 'error');
            if (statusBox) statusBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i> Incorrect Admin password.';
            return;
        }

        if (result.success) {
            if (statusBox) {
                statusBox.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#16a34a;"></i> Restored (${result.restoredCount ?? '—'} modules) — ${new Date().toLocaleString()}`;
            }
            let extraNote = '';
            if (result.accountsNeedingPasswordReset && result.accountsNeedingPasswordReset.length > 0) {
                extraNote = `<br><br><strong>Note:</strong> the following accounts were just restored (no password was included in the backup) — the Admin must reset their passwords in User Management before they can log in: <br>${result.accountsNeedingPasswordReset.join(', ')}`;
            }
            Swal.fire({
                title: 'Restored!',
                html: (result.message || 'Successfully restored from Cloud Backup.') + extraNote,
                icon: 'success'
            }).then(() => {
                location.reload();
            });
        } else {
            if (statusBox) {
                statusBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i> ${result.message || 'Cloud restore failed.'}`;
            }
            Swal.fire('Failed', result.message || 'Cloud restore failed.', 'error');
        }
    } catch (error) {
        if (statusBox) {
            statusBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i> Unable to reach the server.';
        }
        Swal.fire('Network Error', 'Could not connect to the server backend.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    }
}

// When Relay confirms (via /api/features/restore-check above) that one or
// more previously LOCALLY-unlocked features/themes are no longer active —
// because they were deactivated by the developer/store owner, or their
// time-based license has expired — they are locked here immediately in
// the current session/UI, without requiring the user to relogin or
// refresh:
//   1. If a THEME is detected as no longer active, and it is still the
//      currently applied theme, it is immediately reverted to the
//      DEFAULT theme.
//   2. If another module (Purchase Orders, Customer CRM, Advanced
//      Reports, Shift Management, etc.) is detected, and it is still the
//      currently open view, it immediately returns to Overview/Home.
// The actual hiding of locked badges/menu items in the sidebar is already
// handled by refreshUnlockedFeaturesFromServer()/refreshUnlockedThemesFromServer()
// above (which call updateSidebarFeatureLocks() and renderThemeMenu()),
// so here we only need to focus on the "currently viewed/in use" state
// that needs to be immediately returned to a default/safe location.
const RELAY_SYNC_VIEW_FEATURE_MAP = {
    customer_crm: 'customers',
    shift_management: 'shiftreport',
    advanced_reports: 'reports',
    purchase_orders: 'reorder'
};

function applyLockdownForRemovedFeatures(removedFeatures) {
    const currentThemeId = localStorage.getItem('posa_theme') || 'day';
    const currentView = sessionStorage.getItem('currentView') || 'overview';
    let themeWasReverted = false;

    removedFeatures.forEach((removed) => {
        if (removed.category === 'theme') {
            if (currentThemeId === removed.featureId) {
                // Ibalik sa default theme (kaparehong fallback na ginagamit
                // ng initDarkMode() kapag na-detect na naka-lock na pala
                // ang kasalukuyang napiling tema).
                applyTheme('dark');
                themeWasReverted = true;
            }
        } else {
            const affectedView = RELAY_SYNC_VIEW_FEATURE_MAP[removed.featureId];
            if (affectedView && currentView === affectedView) {
                switchView('overview');
            }
        }
    });

    if (themeWasReverted) {
        renderThemeMenu();
    }
    if (typeof updateSidebarFeatureLocks === 'function') updateSidebarFeatureLocks();
}

// Builds the detailed result HTML for "Sync with Relay Now" — makes
// clear what was actually restored (a purchased feature vs. a Demo Mode
// session), and what got locked, including the reason (expired, or
// deactivated by the developer/store owner).
function buildRelaySyncResultHtml(result, removedFeatures) {
    let html = '';

    // Split the restore count between an actual purchased-feature
    // restore and a demo-session restore, so the prompt never implies a
    // demo grant is a paid unlock (or vice versa).
    const demoRestored = !!result.demoRestored;
    const purchasedRestoredCount = typeof result.purchasedRestoredCount === 'number'
        ? result.purchasedRestoredCount
        : (result.restoredCount || 0);

    if (purchasedRestoredCount > 0) {
        html += '<p style="margin:0 0 8px;font-size:0.85rem;">' +
            `Restored <strong>${purchasedRestoredCount}</strong> previously purchased feature(s).</p>`;
    }
    if (demoRestored) {
        html += '<p style="margin:0 0 8px;font-size:0.85rem;">' +
            'Restored an active <strong>Demo Mode</strong> session for this device.</p>';
    }
    if (removedFeatures.length > 0) {
        html += '<p style="margin:0 0 6px;font-size:0.85rem;color:#b91c1c;">' +
            'The following were detected as no longer active, so they were automatically locked:</p>';
        html += '<ul style="text-align:left;font-size:0.82rem;margin:0 0 6px;padding-left:18px;">';
        removedFeatures.forEach((r) => {
            const reasonText = r.reason === 'expired'
                ? 'its license has expired'
                : 'deactivated by the developer/store owner';
            html += `<li><strong>${escapeHtml(r.featureName)}</strong> — ${reasonText}</li>`;
        });
        html += '</ul>';
        html += '<p style="margin:0;font-size:0.78rem;color:#94a3b8;">If this looks wrong, or you\'d like to use it again, contact the developer/store owner for a new unlock.</p>';
    }
    if (purchasedRestoredCount === 0 && !demoRestored && removedFeatures.length === 0) {
        html += `<p style="margin:0;font-size:0.85rem;">${escapeHtml(result.message || 'No new changes.')}</p>`;
    }
    return html;
}

async function resetPasswordTrigger(targetUsername) {
    const { value: newPassword } = await Swal.fire({
        title: `Reset Password       
        [ ${targetUsername} ]`,
        input:'text',
        inputLabel:'Enter new secure password:',
        inputPlaceholder:'New Password...',
        showCancelButton: true,
        confirmButtonColor:'#2563eb',
        cancelButtonColor:'#64748b'
    });

    if (newPassword === undefined) return;
    if (newPassword.trim() ==='') {
        Swal.fire('Input Required','Password cannot be empty.','warning');
        return;
    }

    const adminPassword = await promptAdminPasswordConfirm(`Force reset password ng: ${targetUsername}`);
    if (!adminPassword) return;

    try {
        const res = await authFetch(`${API_URL}/users/${targetUsername}/reset-password`, {
            method:'PUT',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ newPassword: newPassword.trim(), username: currentUser.username, adminPassword })
        });

        const reply = await res.json();
        if (reply.success) {
            Swal.fire('Updated', reply.message,'success');
        } else {
            Swal.fire('Failed', reply.message ||'Failed to update user password.','error');
        }
    } catch (e) {
        console.error(e);
        Swal.fire('Server Error','Server connection error while resetting password.','error');
    }
}

let html5QrcodeScanner = null;
let lastScannedCode ="";
let lastScannedTime = 0;

let currentScanMode ='AUTO';
let currentScanType ='QR';
let isManualTriggered = false;
let manualTimeoutId = null;

let scanResultMode ='SEARCH';

function openQRScanner() {
  scannerTarget ='PRODUCT';
    document.getElementById('qr-scanner-modal').style.display ='flex';
    updateScannerUIControls();
    startLiveScanner();
}
function openTxQRScanner() {
    scannerTarget ='TRANSACTION';
    document.getElementById('qr-scanner-modal').style.display ='flex';
    updateScannerUIControls();
    startLiveScanner();
}

function openInventoryScanner() {
    scannerTarget ='INVENTORY';
    document.getElementById('qr-scanner-modal').style.display ='flex';
    updateScannerUIControls();
    startLiveScanner();

    window.onQRScanSuccess = function (scannedCode) {
        const cleanCode = scannedCode.trim();

        closeQRScanner();
        window.onQRScanSuccess = null;

        handleInventoryScanResult(cleanCode);
    };
}

async function handleInventoryScanResult(code) {

    authFetch(`${API_URL}/products`)
        .then(res => res.json())
        .then(data => { cachedInventoryProducts = data; globalProducts = data; })
        .catch(e => console.warn("Hindi na-refresh sa background ang products:", e));

    const product = cachedInventoryProducts.find(p => p.code === code);

    if (!product) {
        Swal.fire('Hindi Nahanap', `Walang produktong tumutugma sa code na "${code}".`,'warning');
        return;
    }

    if (typeof playScanBeep ==='function') playScanBeep();

    if (scanResultMode ==='EDIT') {

        openProductModal('UPDATE', product.code);
    } else {

        const searchInput = document.getElementById('inventory-search');
        if (searchInput) searchInput.value ='';
        filterInventoryTable();
        highlightInventoryRow(product.code);
    }
}

function openProductFormScanner() {
    scannerTarget ='PRODUCT_FORM';
    productFormScanLastCode ='';
    productFormScanLastTime = 0;
    const counterPanel = document.getElementById('product-scan-stock-counter');
    if (counterPanel) counterPanel.style.display ='none';

    document.getElementById('qr-scanner-modal').style.display ='flex';
    updateScannerUIControls();
    startLiveScanner();

    window.onQRScanSuccess = function (scannedCode) {

        if (currentScanMode ==='MANUAL') {
            if (!isManualTriggered) return;
            isManualTriggered = false;
            if (manualTimeoutId) clearTimeout(manualTimeoutId);
            updateScannerUIControls();
        }

        const cleanCode = scannedCode.trim();

        const now = Date.now();
        if (cleanCode === productFormScanLastCode && (now - productFormScanLastTime < 1000)) {
            return;
        }
        productFormScanLastCode = cleanCode;
        productFormScanLastTime = now;

        handleProductFormScanResult(cleanCode);
    };
}

async function saveAccumulatedStockIfPending() {
    const code = addProductScanSession.lastScannedFormCode;
    if (!code) return false;

    const payload = {
        code: code,
        name: document.getElementById('p-form-name').value,
        category: document.getElementById('p-form-category').value,
        price: parseFloat(document.getElementById('p-form-price').value),
        stock: parseInt(document.getElementById('p-form-stock').value),
        image: document.getElementById('p-form-image').value ||''
    };
    const costVal = document.getElementById('p-form-cost').value;
    if (costVal !=='') payload.cost = parseFloat(costVal);
    const supplierVal = document.getElementById('p-form-supplier').value.trim();
    const expiryVal = document.getElementById('p-form-expiry').value;
    const thresholdVal = document.getElementById('p-form-threshold').value;
    if (supplierVal) payload.supplier = supplierVal;
    if (expiryVal) payload.expiryDate = expiryVal;
    if (thresholdVal !=='') payload.lowStockThreshold = parseInt(thresholdVal);

    try {
        const res = await authFetch(`${API_URL}/products/${code}`, {
            method:'PUT',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ updatedData: payload, userRole: currentUser.role, username: currentUser.username })
        });
        const reply = await res.json();
        if (reply.success) {
            globalProducts = globalProducts.filter(p => p.code !== code);
            globalProducts.push(payload);
            loadInventoryProductsTable();
            loadDashboardMetrics();
            return true;
        }
        console.warn('Hindi na-save ang naipong stock dagdag:', reply.message);
    } catch (e) {
        console.warn('Connection error habang sine-save ang naipong stock dagdag:', e);
    }
    return false;
}

function openScanToAddStockPrompt() {
    Swal.fire({
        title:'Scan Barcode to Add Stock',
        html: `
            <input id="stock-scan-input" type="text" class="swal2-input"
                   placeholder="I-scan o i-type ang barcode dito..." autocomplete="off">
            <div id="stock-scan-status" style="min-height:60px; font-size:0.9rem; color:#94a3b8; text-align:left; padding:6px 4px;">
                Naghihintay ng scan...
            </div>
            <div style="display:flex; gap:8px; justify-content:center; margin-top:6px;">
                <button type="button" id="stock-scan-save-btn" class="swal2-styled swal2-confirm" style="background:#16a34a;" disabled>
                    <i class="fa-solid fa-floppy-disk"></i> I-save
                </button>
                <button type="button" id="stock-scan-close-btn" class="swal2-styled swal2-cancel">
                    Isara
                </button>
            </div>
        `,
        showConfirmButton: false,
        showCancelButton: false,
        allowOutsideClick: false,
        focusConfirm: false,
        didOpen: () => {
            const input = document.getElementById('stock-scan-input');
            const saveBtn = document.getElementById('stock-scan-save-btn');
            const closeBtn = document.getElementById('stock-scan-close-btn');

            if (input) {
                input.focus();
                input.addEventListener('keydown', (e) => {
                    if (e.key ==='Enter') {
                        e.preventDefault();
                        handleScanStockPromptInput(input.value);
                    }
                });
            }

            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    saveBtn.disabled = true;
                    const saved = await saveAccumulatedStockIfPending();
                    if (saved) {
                        saveBtn.setAttribute('disabled', true);
                        const statusEl = document.getElementById('stock-scan-status');
                        if (statusEl) {
                            statusEl.innerHTML += `<div style="color:#22c55e; margin-top:6px;"><i class="fa-solid fa-check"></i> Na-save ang produkto.</div>`;
                        }
                    } else {
                        saveBtn.removeAttribute('disabled');
                    }
                    if (input) input.focus();
                });
            }

            if (closeBtn) closeBtn.addEventListener('click', () => Swal.close());
        }
    });
}

async function handleScanStockPromptInput(rawCode) {
    const cleanCode = (rawCode ||'').trim();
    if (!cleanCode) return;

    const input = document.getElementById('stock-scan-input');
    const statusEl = document.getElementById('stock-scan-status');
    const saveBtn = document.getElementById('stock-scan-save-btn');

    authFetch(`${API_URL}/products`)
        .then(res => res.json())
        .then(data => { globalProducts = data; })
        .catch(e => console.warn("Hindi na-refresh sa background ang products:", e));

    addProductScanSession.active = true;

    const match = globalProducts.find(p => p.code === cleanCode);
    const codeInput = document.getElementById('p-form-code');
    const stockInput = document.getElementById('p-form-stock');

    if (match) {
        if (typeof playScanBeep ==='function') playScanBeep();

        let baseStock;
        if (addProductScanSession.lastScannedFormCode === cleanCode) {

            baseStock = parseInt(stockInput.dataset.baseStock || match.stock) || 0;
            const currentQty = parseInt(stockInput.value) || 0;
            stockInput.value = currentQty + 1;
        } else {

            await saveAccumulatedStockIfPending();

            baseStock = parseInt(match.stock) || 0;
            codeInput.value = match.code;
            document.getElementById('p-form-name').value = match.name;
            document.getElementById('p-form-category').value = match.category;
            document.getElementById('p-form-price').value = match.price;
            document.getElementById('p-form-cost').value = (match.cost !== undefined && match.cost !== null) ? match.cost :'';
            stockInput.value = baseStock + 1;
            stockInput.dataset.baseStock = baseStock;
            document.getElementById('p-form-supplier').value = match.supplier ||'';
            document.getElementById('p-form-expiry').value = match.expiryDate ||'';
            document.getElementById('p-form-threshold').value = (match.lowStockThreshold !== undefined && match.lowStockThreshold !== null) ? match.lowStockThreshold :'';
            document.getElementById('p-form-image').value = match.image ||'';
            updateProductPhotoPreview(match.image ||'');
            addProductScanSession.lastScannedFormCode = match.code;
        }

        if (statusEl) {
            statusEl.innerHTML = `
                <div style="font-weight:bold; color:#e2e8f0;">${escapeHtml(match.name)} <span style="color:#64748b; font-weight:normal;">(${escapeHtml(match.code)})</span></div>
                <div style="font-size:1.4rem; font-weight:bold; color:#38bdf8; margin-top:4px;">
                    ${baseStock} <span style="color:#64748b; font-weight:normal;">&rarr;</span> ${stockInput.value}
                </div>
                <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">I-scan ulit para dagdagan pa, o mag-scan ng ibang item.</div>
            `;
        }
        if (saveBtn) saveBtn.removeAttribute('disabled');
    } else {

        const savedPrevious = await saveAccumulatedStockIfPending();

        Swal.close();

        document.getElementById('product-schema-form').reset();
        document.getElementById('p-form-mode').value ='ADD';
        document.getElementById('p-form-image').value ='';
        updateProductPhotoPreview('');
        addProductScanSession.lastScannedFormCode = null;

        codeInput.removeAttribute('disabled');
        codeInput.value = cleanCode;

        Swal.fire({
            title:'Not Exist',
            html: (savedPrevious ? `Na-save na ang idinagdag na stock ng naunang na-scan na produkto.<br><br>` :'') +
                  `Walang tumutugmang produkto sa code na <b>${escapeHtml(cleanCode)}</b>. Punuan na lang ang ibang detalye para irehistro bilang bagong produkto.`,
            icon:'warning',
            confirmButtonText:'OK'
        }).then(() => {
            document.getElementById('p-form-name').focus();
        });
        return;
    }

    if (input) {
        input.value ='';
        input.focus();
    }
}

async function handleProductFormScanResult(code) {
    if (!code) return;

    authFetch(`${API_URL}/products`)
        .then(res => res.json())
        .then(data => { globalProducts = data; })
        .catch(e => console.warn("Hindi na-refresh sa background ang products:", e));

    addProductScanSession.active = true;

    const match = globalProducts.find(p => p.code === code);
    const codeInput = document.getElementById('p-form-code');
    const stockInput = document.getElementById('p-form-stock');
    const counterPanel = document.getElementById('product-scan-stock-counter');
    const nameLabel = document.getElementById('psc-product-name');
    const oldStockEl = document.getElementById('psc-old-stock');
    const newStockEl = document.getElementById('psc-new-stock');
    const feedback = document.getElementById('qr-scanner-feedback');

    if (match) {
        let baseStock;
        if (addProductScanSession.lastScannedFormCode === code) {

            baseStock = parseInt(oldStockEl.dataset.base || match.stock) || 0;
            const currentQty = parseInt(stockInput.value) || 0;
            stockInput.value = currentQty + 1;
        } else {

            await saveAccumulatedStockIfPending();

            baseStock = parseInt(match.stock) || 0;
            codeInput.value = match.code;
            document.getElementById('p-form-name').value = match.name;
            document.getElementById('p-form-category').value = match.category;
            document.getElementById('p-form-price').value = match.price;
            document.getElementById('p-form-cost').value = (match.cost !== undefined && match.cost !== null) ? match.cost :'';
            stockInput.value = baseStock + 1;
            document.getElementById('p-form-supplier').value = match.supplier ||'';
            document.getElementById('p-form-expiry').value = match.expiryDate ||'';
            document.getElementById('p-form-threshold').value = (match.lowStockThreshold !== undefined && match.lowStockThreshold !== null) ? match.lowStockThreshold :'';
            document.getElementById('p-form-image').value = match.image ||'';
            updateProductPhotoPreview(match.image ||'');
            addProductScanSession.lastScannedFormCode = code;
        }

        if (counterPanel) {
            counterPanel.style.display ='block';
            nameLabel.textContent = match.name;
            oldStockEl.textContent = baseStock;
            oldStockEl.dataset.base = baseStock;
            newStockEl.textContent = stockInput.value;
        }
        if (feedback) {
            feedback.innerText = `✔ ${match.name} — i-scan ulit para dagdagan pa, o mag-scan ng ibang item.`;
            feedback.style.color ='#22c55e';
        }
    } else {

        const savedPrevious = await saveAccumulatedStockIfPending();

        closeQRScanner();
        window.onQRScanSuccess = null;
        if (counterPanel) counterPanel.style.display ='none';

        document.getElementById('product-schema-form').reset();
        document.getElementById('p-form-mode').value ='ADD';
        codeInput.value = code;
        document.getElementById('p-form-image').value ='';
        updateProductPhotoPreview('');
        addProductScanSession.lastScannedFormCode = null;

        Swal.fire({
            title:'Not Exist',
            html: (savedPrevious ? `Na-save na ang idinagdag na stock ng naunang na-scan na produkto.<br><br>` :'') +
                  `Walang tumutugmang produkto sa code na <b>${code}</b>. Punuan na lang ang ibang detalye para irehistro bilang bagong produkto.`,
            icon:'warning',
            confirmButtonText:'OK'
        }).then(() => {
            document.getElementById('p-form-name').focus();
        });
    }
}

async function handleHardwareScanProductForm(scannedCode) {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    const modeInput = document.getElementById('p-form-mode');
    if (!modeInput || modeInput.value !=='ADD') return;

    authFetch(`${API_URL}/products`)
        .then(res => res.json())
        .then(data => { globalProducts = data; })
        .catch(e => console.warn("Hindi na-refresh sa background ang products:", e));

    addProductScanSession.active = true;

    const match = globalProducts.find(p => p.code === cleanCode);
    const codeInput = document.getElementById('p-form-code');
    const stockInput = document.getElementById('p-form-stock');

    if (match) {
        let baseStock;
        if (addProductScanSession.lastScannedFormCode === cleanCode) {

            baseStock = parseInt(stockInput.dataset.baseStock || match.stock) || 0;
            const currentQty = parseInt(stockInput.value) || 0;
            stockInput.value = currentQty + 1;
        } else {

            await saveAccumulatedStockIfPending();

            baseStock = parseInt(match.stock) || 0;
            codeInput.value = match.code;
            document.getElementById('p-form-name').value = match.name;
            document.getElementById('p-form-category').value = match.category;
            document.getElementById('p-form-price').value = match.price;
            document.getElementById('p-form-cost').value = (match.cost !== undefined && match.cost !== null) ? match.cost :'';
            stockInput.value = baseStock + 1;
            stockInput.dataset.baseStock = baseStock;
            document.getElementById('p-form-supplier').value = match.supplier ||'';
            document.getElementById('p-form-expiry').value = match.expiryDate ||'';
            document.getElementById('p-form-threshold').value = (match.lowStockThreshold !== undefined && match.lowStockThreshold !== null) ? match.lowStockThreshold :'';
            document.getElementById('p-form-image').value = match.image ||'';
            updateProductPhotoPreview(match.image ||'');
            addProductScanSession.lastScannedFormCode = cleanCode;
        }

        if (typeof playScanBeep ==='function') playScanBeep();

        Swal.fire({
            toast: true, position:'top-end', icon:'success',
            title: `${escapeHtml(match.name)} — Stock: ${baseStock}/${stockInput.value}`,
            showConfirmButton: false, timer: 1500, timerProgressBar: true
        });
    } else {

        const savedPrevious = await saveAccumulatedStockIfPending();

        document.getElementById('product-schema-form').reset();
        document.getElementById('p-form-mode').value ='ADD';
        document.getElementById('p-form-image').value ='';
        updateProductPhotoPreview('');
        addProductScanSession.lastScannedFormCode = null;

        codeInput.value = cleanCode;

        Swal.fire({
            title:'Not Exist',
            html: (savedPrevious ? `Na-save na ang idinagdag na stock ng naunang na-scan na produkto.<br><br>` :'') +
                  `Walang tumutugmang produkto sa code na <b>${escapeHtml(cleanCode)}</b>. Punuan na lang ang ibang detalye para irehistro bilang bagong produkto.`,
            icon:'warning',
            confirmButtonText:'OK'
        }).then(() => {
            document.getElementById('p-form-name').focus();
        });
    }
}

function updateScannerUIControls() {
    const btnAuto = document.getElementById('btn-mode-auto');
    const btnManual = document.getElementById('btn-mode-manual');
    const btnTrigger = document.getElementById('btn-manual-trigger');
    const btnQR = document.getElementById('btn-type-qr');
    const btnBarcode = document.getElementById('btn-type-barcode');

    if (currentScanMode ==='AUTO') {
        btnAuto.style.background ='#2563eb'; btnAuto.style.color ='#ffffff';
        btnManual.style.background ='transparent'; btnManual.style.color ='#94a3b8';

        btnTrigger.disabled = true;
        btnTrigger.style.background ='#374151';
        btnTrigger.style.color ='#6b7280';
        btnTrigger.style.cursor ='not-allowed';
        btnTrigger.innerHTML = `<i class="fa-solid fa-bolt-slash"></i> Active in Manual Mode Only`;
    } else {
        btnAuto.style.background ='transparent'; btnAuto.style.color ='#94a3b8';
        btnManual.style.background ='#2563eb'; btnManual.style.color ='#ffffff';

        btnTrigger.disabled = false;
        btnTrigger.style.background ='#22c55e';
        btnTrigger.style.color ='#ffffff';
        btnTrigger.style.cursor ='pointer';
        btnTrigger.innerHTML = `<i class="fa-solid fa-expand"></i> PINDUTIN PARA MAG-SCAN`;
    }

    if (currentScanType ==='QR') {
        btnQR.style.background ='#2563eb'; btnQR.style.color ='#ffffff';
        btnBarcode.style.background ='transparent'; btnBarcode.style.color ='#94a3b8';
    } else {
        btnQR.style.background ='transparent'; btnQR.style.color ='#94a3b8';
        btnBarcode.style.background ='#2563eb'; btnBarcode.style.color ='#ffffff';
    }

    const modeGroup = document.getElementById('inventory-scan-mode-group');
    const btnResultSearch = document.getElementById('btn-result-search');
    const btnResultEdit = document.getElementById('btn-result-edit');
    if (modeGroup && btnResultSearch && btnResultEdit) {
        if (scannerTarget ==='INVENTORY') {
            modeGroup.style.display ='flex';
            if (scanResultMode ==='SEARCH') {
                btnResultSearch.style.background ='#2563eb'; btnResultSearch.style.color ='#ffffff';
                btnResultEdit.style.background ='transparent'; btnResultEdit.style.color ='#94a3b8';
            } else {
                btnResultSearch.style.background ='transparent'; btnResultSearch.style.color ='#94a3b8';
                btnResultEdit.style.background ='#2563eb'; btnResultEdit.style.color ='#ffffff';
            }
        } else {
            modeGroup.style.display ='none';
        }
    }
}

function setScanResultMode(mode) {
    if (scanResultMode === mode) return;
    scanResultMode = mode;
    updateScannerUIControls();

    const feedback = document.getElementById('qr-scanner-feedback');
    if (feedback) {
        feedback.innerText = (mode ==='EDIT')
            ?'Scan to Edit: agad bubukas ang Edit Product form pagkatapos ma-scan.'
            :'Search mode: ipapakita/i-hihighlight ang produkto sa table pagkatapos ma-scan.';
        feedback.style.color ='#38bdf8';
    }
}

function setScanMode(mode) {
    if (currentScanMode === mode) return;
    currentScanMode = mode;
    isManualTriggered = false;
    if (manualTimeoutId) clearTimeout(manualTimeoutId);

    updateScannerUIControls();

    const feedback = document.getElementById('qr-scanner-feedback');
    if (mode ==='AUTO') {
        feedback.innerText ='Auto scan active. Align code inside frame.';
        feedback.style.color ='#22c55e';
    } else {
        feedback.innerText ='Manual mode active. Select the control action button to initiate capture sequence.';
        feedback.style.color ='#eab308';
    }
}

function setScanType(type) {
    if (currentScanType === type) return;
    currentScanType = type;
    updateScannerUIControls();

    document.getElementById('qr-scanner-feedback').innerText ='Calibrating scanner framework scaling configurations proportions...';
    document.getElementById('qr-scanner-feedback').style.color ='#eab308';

    if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
        html5QrcodeScanner.stop().then(() => {
            startLiveScanner();
        }).catch(err => {
            console.error("Layout reset stop loop error fallback:", err);
            startLiveScanner();
        });
    } else {
        startLiveScanner();
    }
}

function startLiveScanner() {
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("qr-reader");
    }

    const qrCodeSuccessCallback = (decodedText, decodedResult) => {
        playScanBeep();

        if (typeof window.onQRScanSuccess ==='function') {
            window.onQRScanSuccess(decodedText);
            return;
        }

        if (currentScanMode ==='AUTO') {
            if (scannerTarget ==='TRANSACTION') {
                handleScannedTransaction(decodedText);
            } else {
                handleScannedBarcode(decodedText);
            }
        } else {
            if (isManualTriggered) {
                isManualTriggered = false;
                if (manualTimeoutId) clearTimeout(manualTimeoutId);

                updateScannerUIControls();
                if (scannerTarget ==='TRANSACTION') {
                    handleScannedTransaction(decodedText);
                } else {
                    handleScannedBarcode(decodedText);
                }
            }
        }
    };

    let qrboxConfig;
    if (currentScanType ==='QR') {
        qrboxConfig = function(width, height) {
            const size = Math.floor(Math.min(width, height) * 0.65);
            return { width: size, height: size };
        };
    } else {
        qrboxConfig = function(width, height) {
            const w = Math.floor(width * 0.95);
            const h = Math.floor(height * 0.27);
            return { width: w, height: h };
        };
    }

    const config = {
        fps: 30,
        qrbox: qrboxConfig,
        aspectRatio: 1.0,
        disableFlip: false
    };

    html5QrcodeScanner.start(
        { facingMode:"environment" },
        config,
        qrCodeSuccessCallback
    )
    .then(() => {
        const feedback = document.getElementById('qr-scanner-feedback');
        if (currentScanMode ==='AUTO') {
            feedback.innerText ='Optical engine online (Auto capture active). Position target elements.';
            feedback.style.color ='#22c55e';
        } else {
            feedback.innerText ='Optical engine online (Manual capture standby). Trigger scan interface controls.';
            feedback.style.color ='#eab308';
        }
    })
    .catch(err => {
        console.error("Camera acquisition failed:", err);
        document.getElementById('qr-scanner-feedback').innerText ='Hardware Exception: Failed to instantiate camera viewport stream layer. Check environmental tracking permissions config values.';
        document.getElementById('qr-scanner-feedback').style.color ='#ef4444';
    });
}

function triggerManualScan() {
    if (currentScanMode !=='MANUAL') return;

    isManualTriggered = true;
    if (manualTimeoutId) clearTimeout(manualTimeoutId);
    manualTimeoutId = null;

    const feedback = document.getElementById('qr-scanner-feedback');
    feedback.innerText ='⚡ Scanning... Align barcode or QR code within the frame.';
    feedback.style.color ='#38bdf8';

    const btnTrigger = document.getElementById('btn-manual-trigger');
    btnTrigger.style.background ='#eab308';
    btnTrigger.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> SCANNING... ALIGN BARCODE WITHIN FRAME`;
}

async function handleScannedBarcode(scannedCode) {
    const now = Date.now();
    if (scannedCode === lastScannedCode && (now - lastScannedTime < 1000)) {
        return;
    }
    lastScannedCode = scannedCode;
    lastScannedTime = now;

    if (!globalProducts || globalProducts.length === 0) {
        globalProducts = JSON.parse(localStorage.getItem('cached_products') ||'[]');
    }
    authFetch(`${API_URL}/products`)
        .then(res => res.json())
        .then(data => {
            globalProducts = data;
            localStorage.setItem('cached_products', JSON.stringify(globalProducts));
        })
        .catch(e => console.warn("Hindi na-refresh sa background ang products:", e));

    const product = globalProducts.find(p => p.code === scannedCode.trim());
    if (product) {
        const cartItem = shoppingCart.find(item => item.code === product.code);
        const qtyInBasket = cartItem ? cartItem.quantity : 0;
        if (product.stock <= 0 || qtyInBasket >= product.stock) {
            document.getElementById('qr-scanner-feedback').innerText = `❌ Ubos na o kulang na ang stock para sa ${product.name}`;
            document.getElementById('qr-scanner-feedback').style.color ='#ef4444';
            return;
        }
        addItemToCart(product);
        document.getElementById('qr-scanner-feedback').innerText = `✔ Naidagdag: ${product.name}`;
        document.getElementById('qr-scanner-feedback').style.color ='#22c55e';
    } else {
        document.getElementById('qr-scanner-feedback').innerText = `❌ Walang product na tumugma sa code na na-scan [ ${scannedCode} ]`;
        document.getElementById('qr-scanner-feedback').style.color ='#ef4444';
    }
}

function closeQRScanner() {
    document.getElementById('qr-scanner-modal').style.display ='none';
    isManualTriggered = false;
    if (manualTimeoutId) clearTimeout(manualTimeoutId);

    if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
        html5QrcodeScanner.stop().catch(err => console.error("Scanner tracking disconnect shutdown exception:", err));
    }

    window.onQRScanSuccess = null;

    const stockCounterPanel = document.getElementById('product-scan-stock-counter');
    if (stockCounterPanel) stockCounterPanel.style.display ='none';
}

function handleScannedTransaction(scannedCode) {
    const cleanCode = scannedCode.trim();
    const searchInput = document.getElementById('tx-history-search');

    if (searchInput) {
        searchInput.value = cleanCode;
        filterTransactionsTable();
    }

    const match = localTransactionsList.find(tx => tx.id.toLowerCase() === cleanCode.toLowerCase());

    if (match) {
        document.getElementById('qr-scanner-feedback').innerText = `✔ Entity Resolved: Reference key ${cleanCode} mapped successfully (Initializing transactional statement layout views rendering loops...)`;
        document.getElementById('qr-scanner-feedback').style.color ='#22c55e';

        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            osc.type ='sine';
            osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
            osc.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.1);
        } catch (e) {}

        setTimeout(() => {
            closeQRScanner();
            reopenReceiptFromHistory(match.id);
        }, 1000);
    } else {
        document.getElementById('qr-scanner-feedback').innerText = `❌ Search Exception Error: No corporate transaction logs record references correspond to target ID identifier parameters [ ${cleanCode} ]`;
        document.getElementById('qr-scanner-feedback').style.color ='#ef4444';
    }
}

function filterTransactionsTable() {
    const searchQuery = document.getElementById('tx-history-search').value.trim().toLowerCase();
    const methodFilter = document.getElementById('tx-method-filter').value;

    const filtered = localTransactionsList.filter(tx => {
        const matchesSearch = tx.id.toLowerCase().includes(searchQuery) || tx.cashier.toLowerCase().includes(searchQuery);
        const matchesMethod = (methodFilter ==='All') || (tx.method === methodFilter);
        return matchesSearch && matchesMethod;
    });

    renderTransactionsRows(filtered);
}

function reopenReceiptFromHistory(id) {

    const foundTx = localTransactionsList.find(tx => tx.id === id);

    if (!foundTx) {
        console.error("Transaction not found for ID:", id);
        alert("Transaction record not found.");
        return;
    }

    if (typeof renderInvoiceReceipt ==='function') {
        renderInvoiceReceipt(foundTx, true);
    } else {
        alert("Transaction ID: " + foundTx.id);
    }
}

async function syncOfflineTransactions() {
    let offlineTx = JSON.parse(localStorage.getItem('offline_transactions') ||'[]');
    if (offlineTx.length === 0) return;

    console.log(`Synchronization Pipeline Engaged: Detected ${offlineTx.length} pending local transaction logs. Initializing background data transport routines...`);
    let successfulSyncs = [];

    for (let i = 0; i < offlineTx.length; i++) {
        const item = offlineTx[i];
        try {
            const res = await authFetch(`${API_URL}/transactions`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify(item)
            });
            const output = await res.json();
            if (output.success) {
                successfulSyncs.push(item.transaction.id);
            }
        } catch (err) {
            console.error(`Bigo ang pag-sync ng offline transaction ID ${item.transaction.id}. Ihihinto muna ang sync.`, err);
            break;
        }
    }

    offlineTx = offlineTx.filter(item => !successfulSyncs.includes(item.transaction.id));
    localStorage.setItem('offline_transactions', JSON.stringify(offlineTx));

    if (successfulSyncs.length > 0) {
        console.log(`Na-sync na ang ${successfulSyncs.length} offline transaction(s) papunta sa server.`);

        if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();
        if (typeof loadTransactionsHistory ==='function') loadTransactionsHistory();
    }
}

window.addEventListener('online', () => {
    console.log("Bumalik ang internet connection — sinisimulan ang pag-sync ng offline transactions...");
    syncOfflineTransactions();
});

setInterval(syncOfflineTransactions, 30000);

async function pollMyShiftClosedRemotely() {
    if (!currentUser) return;

    if (!isFeatureUnlockedCached('shift_management')) return;

    if (document.getElementById('payment-modal') && document.getElementById('payment-modal').style.display ==='flex') return;

    try {
        const res = await authFetch(`${API_URL}/shift/current`);
        const data = await res.json();
        if (!data.success) return;

        const nowLocked = !!data.beginningCashLocked;
        if (myShiftLockedState === true && nowLocked === false) {
            myShiftLockedState = false;
            const wasInTerminal = sessionStorage.getItem('currentView') ==='terminal';
            if (wasInTerminal) {
                switchView('overview');
                Swal.fire({
                    icon:'info',
                    title:'Shift Closed',
                    text:'Isinara na ang iyong shift/Z-Reading (Admin/Supervisor Control). Ibinalik ka sa Home view.',
                    timer: 3000,
                    showConfirmButton: false
                });
            }
            return;
        }
        myShiftLockedState = nowLocked;
    } catch (e) {

    }
}
setInterval(pollMyShiftClosedRemotely, 15000);

function openSidebarMenu() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        document.body.classList.add('sidebar-mobile-active');
        sidebar.classList.add('mobile-open');
    }
}

function closeSidebarMenu() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        document.body.classList.remove('sidebar-mobile-active');
        sidebar.classList.remove('mobile-open');
    }
}

function initAutoCloseSidebarOnPrompt() {
    const maybeCloseSidebar = () => {
        if (document.body.classList.contains('sidebar-mobile-active')) {
            closeSidebarMenu();
        }
    };

    const bodyObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1 && node.classList && node.classList.contains('swal2-container')) {
                    maybeCloseSidebar();
                    return;
                }
            }
        }
    });
    bodyObserver.observe(document.body, { childList: true });

    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        const overlayObserver = new MutationObserver(() => {
            const display = overlay.style.display;
            if (display && display !=='none') maybeCloseSidebar();
        });
        overlayObserver.observe(overlay, { attributes: true, attributeFilter: ['style'] });
    });
}

// --------------------------------------------------------------
// SHARED FAST INTERNET-REACHABILITY PROBE — iisa na lang itong global
// na function (window.checkRealInternetAccess) na ginagamit ng
// initNetworkStatusIndicator() DITO SA IBABA (OmniPOS logo dot + regular
// background poll) AT ng connectivity-mode-btn na IIFE sa index.html
// (manual toggle + pag-sync pagkatapos mag-login). Dati, dalawang HIWALAY
// na kopya ng halos parehong logic ang umiiral (isa dito, isa sa
// index.html) na may magkaibang timeout pa — posibleng magkaiba ang
// resulta/behavior ng dalawa. Ngayon, iisang source of truth na.
//
// SPEED FIX: sa halip na isang endpoint lang (dating gstatic.com lang),
// dalawang independent na endpoint na ngayon ang sinusubukan NANG
// SABAY-SABAY (Promise.any) — kung alin man ang unang sumagot, doon na
// agad tayo aasa. Kapareho ito ng diskarte ng server-side
// isInternetLikelyUp() (dalawang IP nang sabay sa server.js) — mas
// mabilis (whichever wins first) at mas matatag (kung sakaling
// naka-block/mabagal ang isa sa dalawang endpoint sa partikular na
// network/carrier, may pangalawang tsansa pa rin ang isa).
function probeInternetEndpoint(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
            reject(new Error('timeout'));
        }, timeoutMs);

        fetch(url, {
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal
        })
            .then(() => {
                clearTimeout(timer);
                resolve(true);
            })
            .catch((err) => {
                clearTimeout(timer);
                reject(err);
            });
    });
}

window.checkRealInternetAccess = function checkRealInternetAccess(timeoutMs = 1500) {
    if (!navigator.onLine) return Promise.resolve(false);
    const bust = Date.now();
    return Promise.any([
        probeInternetEndpoint(`https://www.gstatic.com/generate_204?cachebust=${bust}`, timeoutMs),
        probeInternetEndpoint(`https://www.google.com/generate_204?cachebust=${bust}`, timeoutMs)
    ])
        .then(() => true)
        .catch(() => false);
};

function initNetworkStatusIndicator() {

    const indicators = [
        document.getElementById('connection-indicator'),
        document.getElementById('terminal-connection-indicator'),
        document.getElementById('login-connection-indicator')
    ].filter(Boolean);
    if (!indicators.length) return;

    let realInternetCheckInFlight = false;
    let lastAppliedState = 'connecting';

    function applyState(state, title) {
        lastAppliedState = state;
        indicators.forEach(indicator => {
            indicator.classList.remove('online','offline','connecting');
            indicator.classList.add(state);
            indicator.setAttribute('title', title);
        });
        // Isa lang na network check na ito ang siyang nagpapatakbo sa
        // parehong OmniPOS logo dot AT sa wifi toggle pill — kaya laging
        // sync ang dalawa, walang delay, walang kailangang i-refresh.
        if (window.setConnectivityLiveState) window.setConnectivityLiveState(state);
    }

    async function updateStatusIndicator() {

        if (!navigator.onLine) {
            applyState('offline','System Status: Walang naka-connect na WiFi o naka-off ang Data SIM');
            return;
        }

        if (realInternetCheckInFlight) return;
        realInternetCheckInFlight = true;

        applyState('connecting','System Status: Naka-connect sa network, hinihintay ang internet connection...');

        const hasRealInternet = await window.checkRealInternetAccess();
        realInternetCheckInFlight = false;

        if (!navigator.onLine) {
            applyState('offline','System Status: Walang naka-connect na WiFi o naka-off ang Data SIM');
            return;
        }

        if (hasRealInternet) {
            applyState('online','System Status: Connected to Internet');
        } else {
            applyState('connecting','System Status: Naka-connect sa network, hinihintay ang internet connection...');
        }
    }

    // ADAPTIVE POLLING (bago): sa halip na FIXED 6s ang poll interval
    // kahit anong state, ngayon nag-iiba ito depende sa PALING HULING
    // ALAM na state —
    //   - OFFLINE/CONNECTING: mas madalas na 2s ang re-check, para agad
    //     ma-detect ang muling pagbalik ng internet (hal. na-restart na
    //     ang router/nabalik na ang Data SIM) sa halip na maghintay pa
    //     ng hanggang 6 segundo bago ito mapansin ng customer.
    //   - ONLINE: bumabalik sa mas mahinahong 6s na poll — tipid sa
    //     datos/baterya ng device (importante dahil karamihan sa
    //     Termux/Android deployment na ito ay gumagamit ng mobile data),
    //     dahil hindi naman kailangang paulit-ulit na i-verify kapag
    //     matagal nang matatag ang koneksyon.
    let pollTimer = null;
    function scheduleNextPoll() {
        if (pollTimer) clearTimeout(pollTimer);
        const delay = (lastAppliedState === 'online') ? 6000 : 2000;
        pollTimer = setTimeout(runPoll, delay);
    }
    async function runPoll() {
        await updateStatusIndicator();
        scheduleNextPoll();
    }

    // FORCE RECHECK NOW: ginagamit ng native online/offline events, ng
    // tab visibility/focus recovery, at ng window.__triggerNetworkRecheck
    // (tinatawag ng ibang parte ng app, hal. authFetch kapag nag-timeout)
    // — kinakansela muna ang naka-iskedyul na susunod na poll bago
    // agad magsuri, para hindi ito ma-duplicate/patungin ang dalawang
    // magkasunod na check.
    function forceRecheckNow() {
        if (pollTimer) clearTimeout(pollTimer);
        runPoll();
    }

    forceRecheckNow();

    window.addEventListener('online', forceRecheckNow);
    window.addEventListener('offline', forceRecheckNow);

    // May simpleng throttle (1s) para hindi paulit-ulit tumama nang
    // sabay-sabay kapag maraming request ang nag-fail nang magkakasunod.
    let lastForcedCheckAt = 0;
    window.__triggerNetworkRecheck = () => {
        const now = Date.now();
        if (now - lastForcedCheckAt < 1000) return;
        lastForcedCheckAt = now;
        forceRecheckNow();
    };

    // Kapag bumalik ang user sa tab/window (hal. matagal na naka-minimize
    // ang POS at nabago na ang koneksyon habang wala siyang tinitignan),
    // agad mag-recheck sa halip na maghintay ng hanggang 6s.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') forceRecheckNow();
    });
    window.addEventListener('focus', forceRecheckNow);
}

function initAuthDeviceScaling() {
    const authView = document.getElementById('auth-view');
    if (!authView) return;

    function applyAuthScale() {
        const isMobileDevice =/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isWideViewport = window.innerWidth > 900;
        authView.classList.toggle('pc-auth-mode', !isMobileDevice && isWideViewport);
    }

    applyAuthScale();
    window.addEventListener('resize', applyAuthScale);
}

// ====================================================================
// INSTALL APP BANNER
// ====================================================================
// PINALITAN nito ang dating initTouchFullscreen() — na sinusubukang
// pilitin ang Fullscreen API sa unang tap/click ng user (hindi supported
// sa iOS Safari, at madalas basta na lang mag-e-exit sa Android kapag
// nag-open ng keyboard/modal). Ang manifest.json ng app na ito ay
// "display": "standalone" na — ibig sabihin kapag na-install/na-Add to
// Home Screen ang OmniPOS, AWTOMATIKONG nawawala ang address bar/browser
// chrome nang walang JS hack, at ito ang officially-supported na paraan
// sa parehong Android at iOS. Ang banner na ito ay simpleng nag-aanyaya
// sa user na i-install ang app, sa halip na sapilitang i-fullscreen ang
// browser tab.
let deferredInstallPromptEvent = null;

function initInstallAppBanner() {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobileDevice) return;

    // Kung naka-open na ang app bilang naka-install na PWA (standalone
    // display mode), wala nang dapat i-banner — naka-fullscreen na nga.
    const isStandaloneAlready = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (isStandaloneAlready) return;

    if (localStorage.getItem('installBannerDismissedAt')) {
        const dismissedAgoMs = Date.now() - parseInt(localStorage.getItem('installBannerDismissedAt'), 10);
        if (dismissedAgoMs < 7 * 24 * 60 * 60 * 1000) return; // huwag na muna ipakita sa loob ng 7 araw
    }

    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPromptEvent = e;
        showInstallAppBanner({ mode: 'android' });
    });

    // Walang beforeinstallprompt sa iOS Safari — manual na instructions
    // na lang ang ipapakita, pero parehong banner treatment.
    if (isIOS) {
        showInstallAppBanner({ mode: 'ios' });
    }
}

function showInstallAppBanner({ mode }) {
    if (document.getElementById('install-app-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'install-app-banner';
    banner.className = 'install-app-banner';
    banner.innerHTML = `
        <div class="install-app-banner-icon"><i class="fa-solid fa-arrow-up-right-from-square"></i></div>
        <div class="install-app-banner-copy">
            <p class="install-app-banner-title">I-install ang OmniPOS</p>
            <p class="install-app-banner-desc">${mode === 'ios'
                ? 'Tap <i class="fa-solid fa-arrow-up-from-bracket"></i> Share, tapos "Add to Home Screen" — para full-screen, walang browser bar.'
                : 'Para full-screen ang view, walang browser address bar, at mas mabilis mag-launch.'}</p>
        </div>
        <div class="install-app-banner-actions">
            ${mode === 'android' ? `<button type="button" class="install-app-banner-btn" id="install-app-banner-confirm">Install</button>` : ''}
            <button type="button" class="install-app-banner-dismiss" id="install-app-banner-dismiss" aria-label="Isara">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('install-app-banner-visible'));

    const dismiss = () => {
        banner.classList.remove('install-app-banner-visible');
        localStorage.setItem('installBannerDismissedAt', String(Date.now()));
        setTimeout(() => banner.remove(), 250);
    };

    document.getElementById('install-app-banner-dismiss').addEventListener('click', dismiss);

    const confirmBtn = document.getElementById('install-app-banner-confirm');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            if (!deferredInstallPromptEvent) { dismiss(); return; }
            deferredInstallPromptEvent.prompt();
            const { outcome } = await deferredInstallPromptEvent.userChoice;
            console.log('[PWA] Install prompt outcome:', outcome);
            deferredInstallPromptEvent = null;
            dismiss();
        });
    }
}

let currentTerminalView ='grid';

function toggleTerminalView() {
    const gridOutput = document.getElementById('terminal-grid-output');
    const toggleBtn = document.getElementById('btn-view-toggle');

    if (!gridOutput || !toggleBtn) return;

    if (currentTerminalView ==='grid') {
        currentTerminalView ='list';
        gridOutput.classList.add('terminal-list-view');
        toggleBtn.innerHTML ='<i class="fa-solid fa-table-cells"></i>';
    } else {
        currentTerminalView ='grid';
        gridOutput.classList.remove('terminal-list-view');
        toggleBtn.innerHTML ='<i class="fa-solid fa-list"></i>';
    }
}

function updateCategoryChipsDynamic() {
    const container = document.getElementById('category-chips');
    if (!container) return;

    const uniqueCategories = ['All', ...new Set(globalProducts.map(p => p.category ||'Others'))];

    container.innerHTML ='';

    uniqueCategories.forEach(cat => {
        const chip = document.createElement('span');

        chip.className = `chip ${activeTerminalCategory === cat ?'active' :''}`;
        chip.innerText = cat;

        chip.onclick = () => filterTerminalCategory(cat);
        attachInstantTapFeedback(chip, { hapticMs: 8 });

        container.appendChild(chip);
    });
}

function updateDropdownCategoriesDynamic() {
    const categorySelect = document.getElementById('p-form-category');
    if (!categorySelect) return;

    const dbCategories = globalProducts.map(p => p.category ||'Others');

    const uniqueCategories = [...new Set([...dbCategories, ...customCategories])];

    const previousSelectedValue = categorySelect.value;

    categorySelect.innerHTML ='';

    uniqueCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.text = cat;
        categorySelect.appendChild(option);
    });

    const addNewOption = document.createElement('option');
    addNewOption.value ='ADD_NEW_CATEGORY';
    addNewOption.text ='+ Add New Category...';
    categorySelect.appendChild(addNewOption);

    if (previousSelectedValue && uniqueCategories.includes(previousSelectedValue)) {
        categorySelect.value = previousSelectedValue;
    }
}

async function initializeSystem() {
    if (!currentUser) return;
    try {

        const [productsRes, categoriesRes] = await Promise.all([
            authFetch(`${API_URL}/products`),
            authFetch(`${API_URL}/categories`)
        ]);

        globalProducts = await productsRes.json();
        customCategories = await categoriesRes.json();

        updateDropdownCategoriesDynamic();
        if (typeof loadDashboardMetrics ==='function') {
            await loadDashboardMetrics();
        }
    } catch (err) {
        console.error("System Initialization Failed:", err);
    }
}

window.addEventListener('DOMContentLoaded', initializeSystem);

window.addEventListener('popstate', function(event) {

    if (event.state && event.state.view) {

        if (currentUser) {
            switchView(event.state.view);
        }
    } else {

        const savedView = sessionStorage.getItem('currentView');
        if (savedView && currentUser && savedView !=='auth-view') {
            switchView(savedView);
        }
    }
});

function playScanBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type ='sine';
        oscillator.frequency.setValueAtTime(1400, audioCtx.currentTime);

        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();

        oscillator.stop(audioCtx.currentTime + 0.08);
    } catch (error) {
        console.warn("Hindi mapatugtog ang scan audio:", error);
    }
}

function triggerSystemRestore() {
    const fileInput = document.getElementById('recoveryFileInput');
    const file = fileInput.files[0];

    if (!file) {
        Swal.fire('File Missing',"Please select the 'full_system_backup.json' file downloaded from the email first.",'warning');
        return;
    }

    Swal.fire({
        title:'System Restore Authorization',
        text:'Enter the Admin Password to confirm the data restore:',
        input:'password',
        inputPlaceholder:'Admin Passphrase',
        showCancelButton: true,
        confirmButtonColor:'#2563eb',
        cancelButtonColor:'#64748b',
        confirmButtonText:'Verify and Restore'
    }).then((authResult) => {
        const adminPassword = authResult.value;
        if (!adminPassword) return;

        const loggedInUser = currentUser ? currentUser.username :'admin';

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const parsedBackupData = JSON.parse(e.target.result);

                authFetch(`${API_URL}/restore-backup`, {
                    method:'POST',
                    headers: {'Content-Type':'application/json' },
                    body: JSON.stringify({
                        username: loggedInUser,
                        password: adminPassword,
                        backupData: parsedBackupData
                    })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        Swal.fire({
                            title:'Restored!',
                            text: data.message,
                            icon:'success'
                        }).then(() => {
                            location.reload();
                        });
                    } else {
                        Swal.fire('Error', data.message,'error');
                    }
                })
                .catch(err => {
                    console.error(err);
                    Swal.fire('Server Connection Error','Nagkaproblema sa pagkonekta sa server. Siguraduhing tumatakbo ang server.js.','error');
                });

            } catch (err) {
                Swal.fire('Invalid Format','Maling format ng JSON file. Siguraduhing ito ang backup file mula sa email.','error');
            }
        };
        reader.readAsText(file);
    });
}

function validateResetField(inputElement) {

    if (inputElement.value !=='RESET') {
        inputElement.classList.add('maling-kumpirma');
    } else {

        inputElement.classList.remove('maling-kumpirma');
    }
}

document.addEventListener("DOMContentLoaded", function() {
    const resetInput = document.getElementById('confirm-reset-input');
    if (resetInput) {
        validateResetField(resetInput);
    }
});

function initDeskClock() {
    const clockEl = document.getElementById('live-clock-display');
    const dateEl = document.getElementById('current-date-display');

    if (!clockEl || !dateEl) return;

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour:'2-digit',
        minute:'2-digit',
        second:'2-digit',
        hour12: true
    });

    const dateFormatter = new Intl.DateTimeFormat('en-US', {
        month:'2-digit',
        day:'2-digit',
        year:'numeric'
    });

    function updateClock() {
        const ngayon = new Date();
        clockEl.textContent = timeFormatter.format(ngayon);
        dateEl.textContent = dateFormatter.format(ngayon).replace(/\//g,'-');
    }

    updateClock();
    setInterval(updateClock, 1000);
}

document.addEventListener('DOMContentLoaded', initDeskClock);

let idleTimer = null;
let countdownInterval = null;
const IDLE_TIMEOUT_LIMIT = 100000;
const COUNTDOWN_DURATION = 15;

function initIdleTimer() {
    destroyIdleTimer();

    if (!currentUser) return;

    const resetTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            console.warn("System idle limit reached. Showing countdown warning prompt.");
            triggerIdleWarning();
        }, IDLE_TIMEOUT_LIMIT);
    };

    const userInteractionEvents = ['mousemove','keydown','mousedown','touchstart','scroll','click'];
    userInteractionEvents.forEach(event => window.addEventListener(event, resetTimer));

    resetTimer();
    window._idleEventsHandler = resetTimer;
}

function destroyIdleTimer() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    if (window._idleEventsHandler) {
        const userInteractionEvents = ['mousemove','keydown','mousedown','touchstart','scroll','click'];
        userInteractionEvents.forEach(event => window.removeEventListener(event, window._idleEventsHandler));
        window._idleEventsHandler = null;
    }
}

function triggerIdleWarning() {

    if (window._idleEventsHandler) {
        const userInteractionEvents = ['mousemove','keydown','mousedown','touchstart','scroll','click'];
        userInteractionEvents.forEach(event => window.removeEventListener(event, window._idleEventsHandler));
    }

    let timeLeft = COUNTDOWN_DURATION;

    const isDarkMode = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark-mode');

    Swal.fire({
        title:'Inactivity Warning',
        html: `You have been inactive for too long. The system will automatically log you out in <strong id="idle-countdown-box" style="color: #ef4444; font-size: 1.2rem;">${timeLeft}</strong> seconds.`,
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Stay Logged In',
        cancelButtonText:'Log Out Now',
        confirmButtonColor:'#2563eb',
        cancelButtonColor:'#ef4444',
        allowOutsideClick: false,
        allowEscapeKey: false,

        background: isDarkMode ?'#1f2937' :'#ffffff',
        color: isDarkMode ?'#f3f4f6' :'#1f2937',

        didOpen: () => {

            countdownInterval = setInterval(() => {
                timeLeft--;
                const countdownDisplay = document.getElementById('idle-countdown-box');
                if (countdownDisplay) {
                    countdownDisplay.innerText = timeLeft;
                }

                if (timeLeft <= 0) {
                    clearInterval(countdownInterval);
                    Swal.close();
                    handleLogout('auto');
                }
            }, 1000);
        }
    }).then((result) => {

        clearInterval(countdownInterval);

        if (result.isConfirmed) {

            console.log("Session extended by operator action.");
            initIdleTimer();
        } else if (result.isDismissed && result.dismiss === Swal.DismissReason.cancel) {

            handleLogout('manual');
        }
    });
}

async function handleLogout(type ='manual') {

    // FIX: itong flag ang humihinto sa "Session Expired" popup mula sa
    // mismong authFetch() 401-interceptor habang tayo mismo ang
    // sinasadyang mag-i-invalidate ng session (manual o auto logout).
    // Dati, itong mga 1-segundong background poll (stock refresh sa
    // terminal/inventory) ay tumatakbo pa rin habang papasok ang mga
    // logout request — kaya kapag na-invalidate na ang session sa
    // server (destroySession) pero may isang poll pa na naka-schedule
    // gamit ang LUMANG token, tumatama ito ng 401 at nagpapalabas ng
    // "Session Expired" kahit normal at sinadyang logout lang.
    window.__logoutInProgress = true;

    destroyIdleTimer();
    stopTerminalStockPolling();
    stopInventoryStockPolling();

    const username = currentUser ? (currentUser.username ||'Unknown') :'Unknown';
    const logMethod = type ==='auto' ?'AUTO_TIMEOUT' :'MANUAL';
    const detailMsg = type ==='auto' ?'Idle timeout' :'User sign-out';
    const oldUser = currentUser ? currentUser.username : null;

    // NOTE: hindi na natin ino-skip ang mga server call na ito base sa
    // navigator.onLine/isOfflineModeActive. Ang /cart, /logs, at
    // /auth/logout ay tumatakbo sa SARILING LOCAL server ng client
    // (Termux) na may sariling database — gumagana ito kahit walang
    // internet ang device. Ang pagpapatakbo lang sa PARALLEL (sa halip na
    // sunud-sunod) kasama ang fetch timeout (sa authFetch) ang nagpapabilis
    // dito, hindi ang pag-skip.

    if (type ==='manual') {
        console.log("Manual logout detected. Clearing cart from database...");
        shoppingCart = [];
    } else {
        console.log(`Auto-logout (${type}) detected. Cart is safely preserved in the database.`);
        shoppingCart = [];
    }

    {
        // BUG FIX: dati, sabay-sabay (parehong Promise.allSettled batch) na
        // tinatawag ang /cart (clear cart) AT ang /auth/logout (invalidate
        // session) — pero ang /cart ay dumadaan din sa parehong auth
        // middleware na nangangailangan ng VALID na session token. Dahil
        // magkatabi silang pinaputok, posibleng mauna pang maproseso ng
        // server ang /auth/logout (na sumisira agad sa session) BAGO pa
        // dumating ang /cart request — kaya natatanggihan ito ng 401
        // "invalid/expired session" at TAHIMIK lang itong nabibigo (console
        // .error lang, walang makikita ang customer). Epekto: sinasabi ng
        // log na "Clearing cart from database..." pero hindi talaga
        // na-clear ang cart sa server paminsan-minsan — bumabalik ang
        // lumang laman ng cart sa susunod na login.
        //
        // AYOS: unahin munang tapusin (parallel pa rin sa isa't-isa, dahil
        // hindi naman sila nagbabanggaan — pareho lang silang umaasa sa
        // parehong VALID session) ang cart-clear at ang log-write, saka
        // lang i-invalidate ang session (/auth/logout) — sigurado nang
        // naiproseso muna ang cart-clear bago pa masira ang session nito.
        const preLogoutResults = await Promise.allSettled([
            (type ==='manual' && oldUser)
                ? authFetch(`${API_URL}/cart`, {
                    method:'POST',
                    headers: {'Content-Type':'application/json' },
                    body: JSON.stringify({ username: oldUser, cart: [] })
                })
                : Promise.resolve(null),
            authFetch(`${API_URL}/logs`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({
                    action:'LOGOUT',
                    user: username,
                    authMethod: logMethod,
                    details: { message: detailMsg }
                })
            })
        ]);

        const logoutResult = await authFetch(`${API_URL}/auth/logout`, {
            method:'POST',
            headers: {
'Content-Type':'application/json',
                ...(localStorage.getItem('posa_token') ? {'Authorization': `Bearer ${localStorage.getItem('posa_token')}` } : {})
            }
        }).then(
            (res) => ({ status:'fulfilled', value: res }),
            (err) => ({ status:'rejected', reason: err })
        );

        const results = [...preLogoutResults, logoutResult];
        const labels = ['Cart clear','Log transmission','Session invalidation'];
        results.forEach((r, i) => {
            if (r.status ==='rejected') console.error(`${labels[i]} failed during logout:`, r.reason);
        });
    }


    sessionStorage.removeItem('currentView');
    localStorage.removeItem('posa_user');
    localStorage.removeItem('posa_token');
    currentUser = null;

    // FIX: i-reset ang in-memory feature unlock cache sa logout — kung
    // hindi, kapag nag-login ulit (parehong page, walang full reload),
    // makikita pa rin ng UI ang LUMANG unlocked features ng dating
    // session/store hangga't hindi manual na na-reload ang buong page.
    unlockedFeatureIdsCache = null;
    purchasedFeatureIdsCache = null;
    fullyPurchasedCache = false;

    // FIX: i-reset din agad ang PRO badge sa UI papuntang naka-lock state
    // — kung hindi, kapag nag-login ng IBANG account/store na hindi pa
    // fully-purchased, maiiwan munang naka-crown ang badge (galing sa
    // dating session) habang hinihintay pa ang bagong fetch mula sa
    // initDemoModeUI() sa susunod na login.
    if (typeof renderSidebarProBadge ==='function') {
        renderSidebarProBadge(false, false);
    }

    const txtUser = document.getElementById('login-username');
    const txtPass = document.getElementById('login-password');

    if (txtUser) txtUser.value ='';
    if (txtPass) txtPass.value ='';

    history.pushState({ view:'auth-view' },'','');
    showAuthenticationInterface();

    // FIX v1.0.9->v1.0.10: dati agad naman na-re-reset ang flag dito, pero
    // ang stopTerminalStockPolling()/stopInventoryStockPolling() sa taas ay
    // pumipigil lang sa MGA SUSUNOD pang pag-tawag (clearInterval) — kung
    // may isang poll na NAKA-IN-FLIGHT NA (nag-request na bago pa ma-stop
    // ang timer, pero hindi pa sumasagot ang server), tatapos pa rin ito
    // pagkatapos ng buong logout sequence at maaari pa ring dumating ang
    // 401 nito PAGKATAPOS ma-reset ang flag — kaya lumalabas pa rin ang
    // "Session Expired" kahit normal na manual logout. Fix: bigyan ng ilang
    // segundong buffer bago i-off ang suppression, para masakop pa rin ang
    // mga huling stray response na ganito.
    setTimeout(() => {
        window.__logoutInProgress = false;
        window.__sessionExpiredShown = false;
    }, 5000);
}

async function showMainSystemInterface() {
    document.getElementById('auth-view').style.display ='none';
    document.getElementById('main-view').style.display ='flex';
    renderSidebarUserWidget();

    (async () => {
        try {
            const res = await authFetch(`${API_URL}/users/self`);
            const data = await res.json();
            if (data && data.success) {
                currentUser.avatar = data.avatar || null;
                currentUser.role = data.role || currentUser.role;
                localStorage.setItem('posa_user', JSON.stringify(currentUser));
                renderSidebarUserWidget();
            }
        } catch (err) {  }
    })();

    applyRoleBasedAccessControls(currentUser.role);

    await refreshPermissions();
    checkAdminResetVisibility();

    // FIX: i-refresh ang feature/theme unlock status PAGKATAPOS ng bawat
    // successful login — dating hindi ito tinatawag dito, kaya kung
    // nag-logout ka tapos nag-login ulit (parehong page, walang full
    // reload), yung LUMANG cache (o wala pang laman kung bago pa lang
    // ang page) ang nananatiling ginagamit ng UI hangga't hindi na-reload
    // manually ang buong page.
    await refreshUnlockedFeaturesFromServer();
    await refreshUnlockedThemesFromServer();

    // FIX: ang PRO crown/lock badge sa tabi ng logo ay HIWALAY na cache/
    // fetch (demo-status), hindi kasama sa refreshUnlockedFeaturesFromServer()
    // sa itaas — kaya kahit na-unlock na ang mga menu sa sidebar, naiiwan
    // pa ring naka-lock icon ang badge hangga't hindi ulit tinatawag ito.
    await initDemoModeUI();

    // FIX: i-detect ang TOTOONG internet connectivity sa bawat bagong
    // login at i-sync agad ang Online/Offline pill (dati, tinatawag lang
    // ito sa DOMContentLoaded — bago pa magkaroon ng session — kaya laging
    // nabibigo/naka-freeze sa dating naka-save na mode).
    if (typeof window.syncConnectivityModeOnLogin === 'function') {
        window.syncConnectivityModeOnLogin();
    }

    initializeSystem();

    initIdleTimer();

    loadCartFromDatabase();

    // FIX: hindi na basta fire-and-forget — i-store ang promise para
    // ma-await ito ng renderInvoiceReceipt() kung sakaling mauna ang
    // unang benta bago pa matapos ang background fetch na ito.
    receiptSettingsPromise = fetchReceiptSettings();

    // PWA SHORTCUT SUPPORT: kapag binuksan ang app mula sa "POS Terminal" o
    // "Products" na shortcut (tingnan manifest.json > "shortcuts"), dumarating
    // ito bilang "/?view=terminal" o "/?view=products". Bigyan ito ng priyoridad
    // kaysa sa naka-save na sessionStorage view, dahil sinasadya ng user na
    // pumunta doon nang direkta mula sa shortcut.
    const shortcutView = new URLSearchParams(window.location.search).get('view');
    const ALLOWED_SHORTCUT_VIEWS = ['terminal','products'];

    const savedView = sessionStorage.getItem('currentView');
    if (shortcutView && ALLOWED_SHORTCUT_VIEWS.includes(shortcutView)) {
        switchView(shortcutView);
        // Linisin ang "?view=..." mula sa address bar para hindi na ito
        // ulit-ulitin kapag nag-navigate na ang user papunta sa ibang view.
        history.replaceState({ view: shortcutView }, '', window.location.pathname);
    } else if (savedView && savedView !=='auth-view') {
        switchView(savedView);
        history.replaceState({ view: savedView },'','');
    } else {
        switchView('overview');
        history.replaceState({ view:'overview' },'','');
    }
}

function showGoogleAppVerificationFAQ() {
    const isDarkMode = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark-mode');

    Swal.fire({
        title:'ℹ️ Guide to Google App Verification',
        html: `
            <div style="text-align: left; font-size: 0.95rem; line-height: 1.6;">
                <p><strong>Keep this in mind for it to work:</strong></p>
                <p>When creating a new Gmail address, make sure that:</p>
                <ul style="padding-left: 20px; margin-top: 5px;">
                    <li style="margin-bottom: 8px;"><strong>2-Step Verification</strong> is enabled in that account's Google Account settings.</li>
                    <li>You generate an <strong>App Password</strong> (a 16-character code provided by Google) specifically for this app, and enter that in the <em>Sender App Password field</em> (not your regular Gmail password).</li>
                </ul>
                <p style="margin-top:10px; color:#64748b; font-size:0.85rem;">This same Gmail account is shared by Receipt Customization OTPs, the System Hard Reset backup email, and receipt emails sent to customers — so only one Gmail needs to be verified.</p>
            </div>
        `,
        icon:'info',
        confirmButtonText:'Got it',
        confirmButtonColor:'#2563eb',
        background: isDarkMode ?'#1f2937' :'#ffffff',
        color: isDarkMode ?'#f3f4f6' :'#1f2937'
    });
}

async function handleVoidTransaction(transactionId) {
    const isAdmin = currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin';

    const { value: adminPassword } = await Swal.fire({
        title: isAdmin ?'🔒 Admin Authorization Required' :'🔒 Void Authorization Required',
        html: isAdmin
            ?'Kailangan ng Admin password para i-void ang transaction na ito. Ibabalik nito ang stock sa inventory.'
            :'Kailangan ng Admin o awtorisadong Supervisor/Manager password para i-void ang transaction na ito. Ibabalik nito ang stock sa inventory.',
        input:'password',
        inputPlaceholder: isAdmin ?'Ilagay ang Admin password' :'Admin/Supervisor password',
        showCancelButton: true,
        confirmButtonColor:'#2563eb',
        cancelButtonColor:'#ef4444'
    });

    if (!adminPassword || adminPassword.trim() ==="") return;

    try {
        const response = await authFetch(`${API_URL}/transactions/${transactionId}/void`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({
                requester: currentUser.username,
                adminPassword: adminPassword
            })
        });

        const result = await response.json();
        if (result.success) {
            Swal.fire('Success', result.message ||'Na-void ang transaction at na-restore ang stock!','success');
            location.reload();
        } else {
            Swal.fire('Error', result.message ||'Hindi ma-void ang transaction.','error');
        }
    } catch (err) {
        console.error("Void Error:", err);
        Swal.fire('Error','May problema sa connection sa server.','error');
    }
}

function searchInsideBackupFile() {
    const fileInput = document.getElementById('backup-query-file');
    const searchId = document.getElementById('backup-query-id').value.trim();

    if (!fileInput.files || fileInput.files.length === 0) {
        Swal.fire({
            title:'Walang File',
            text:'Mangyaring pumili muna ng Full Backup file (.json).',
            icon:'warning',
            confirmButtonColor:'#2563eb'
        });
        return;
    }

    if (!searchId) {
        Swal.fire({
            title:'Kailangan ng ID o Keyword',
            text:'Mangyaring ilagay ang ID na iyong hinahanap.',
            icon:'warning',
            confirmButtonColor:'#2563eb'
        });
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const backupData = JSON.parse(e.target.result);

            let hit = null;
            let foundSection ='';

            if (backupData.transactions && Array.isArray(backupData.transactions)) {
                hit = backupData.transactions.find(t =>
                    (t.id && String(t.id) === searchId) ||
                    (t.transactionId && String(t.transactionId) === searchId)
                );
                if (hit) foundSection ='Transactions (Benta)';
            }

            if (!hit && backupData.userlogs && Array.isArray(backupData.userlogs)) {
                hit = backupData.userlogs.find(log =>
                    (log.id && String(log.id) === searchId) ||
                    (log.action && log.action.includes(searchId))
                );
                if (hit) foundSection ='User Logs (Kasaysayan)';
            }

            if (!hit && backupData.products && Array.isArray(backupData.products)) {
                hit = backupData.products.find(p =>
                    (p.code && String(p.code) === searchId) ||
                    (p.name && p.name.toLowerCase().includes(searchId.toLowerCase()))
                );
                if (hit) foundSection ='Products (Imbentaryo)';
            }

            if (hit) {
                let tableRowsHtml ='';

                for (const [key, value] of Object.entries(hit)) {

                    let humanizedKey = key.replace(/([A-Z])/g,' $1').replace(/[_-]/g,' ').trim();
                    humanizedKey = humanizedKey.charAt(0).toUpperCase() + humanizedKey.slice(1);

                    let displayValue ='';

                    if (Array.isArray(value)) {

                        displayValue = `<ul style="margin: 0; padding-left: 18px; list-style-type: square; line-height: 1.5; color: #1e293b;">`;
                        value.forEach(item => {
                            if (typeof item ==='object' && item !== null) {
                                let details = [];
                                if (item.name || item.itemName) details.push(`<strong>${item.name || item.itemName}</strong>`);
                                if (item.qty || item.quantity) details.push(`Qty: ${item.qty || item.quantity}`);
                                if (item.price) details.push(`₱${Number(item.price).toFixed(2)}`);
                                if (item.total || item.subtotal) details.push(`Subtotal: ₱${Number(item.total || item.subtotal).toFixed(2)}`);
                                displayValue += `<li style="margin-bottom: 5px; font-size: 0.85rem;">${details.join(' | ')}</li>`;
                            } else {
                                displayValue += `<li style="margin-bottom: 5px; font-size: 0.85rem;">${item}</li>`;
                            }
                        });
                        displayValue += `</ul>`;
                    } else if (typeof value ==='object' && value !== null) {

                        displayValue = `<div style="padding-left: 8px; border-left: 3px solid #cbd5e1; font-size: 0.85rem; color: #475569;">`;
                        for (const [subKey, subVal] of Object.entries(value)) {
                            displayValue += `<div><strong>${subKey}:</strong> ${subVal}</div>`;
                        }
                        displayValue += `</div>`;
                    } else {

                        const keyLower = key.toLowerCase();
                        if (typeof value ==='number' && (keyLower.includes('price') || keyLower.includes('amount') || keyLower.includes('total') || keyLower.includes('payment') || keyLower.includes('change'))) {
                            displayValue = `<span style="font-weight: bold; color: #16a34a;">₱${Number(value).toFixed(2)}</span>`;
                        } else if (keyLower.includes('date') || keyLower.includes('timestamp')) {
                            try {
                                const parsedDate = new Date(value);
                                displayValue = isNaN(parsedDate.getTime()) ? value : parsedDate.toLocaleString('en-PH');
                            } catch (e) {
                                displayValue = value;
                            }
                        } else {
                            displayValue = value;
                        }
                    }

                    tableRowsHtml += `
                        <tr style="border-bottom: 1px solid #e2e8f0;">
                            <td style="padding: 10px 12px; font-weight: 600; color: #334155; width: 35%; background-color: #f8fafc; vertical-align: top; font-size: 0.85rem;">${humanizedKey}</td>
                            <td style="padding: 10px 12px; color: #334155; width: 65%; vertical-align: top; font-size: 0.85rem; word-break: break-word;">${displayValue}</td>
                        </tr>
                    `;
                }

                Swal.fire({
                    title: `Rekord Nahanap sa ${foundSection}!`,
                    html: `
                        <div style="text-align: left; margin-top: 10px; font-family: 'Segoe UI', system-ui, sans-serif;">
                            <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 12px;">
                                <i class="fa-solid fa-file-invoice"></i> Mula sa file: <strong>${file.name}</strong>
                            </p>
                            <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; max-height: 380px; overflow-y: auto; background: #ffffff; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
                                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                                    ${tableRowsHtml}
                                </table>
                            </div>
                        </div>
                    `,
                    icon:'success',
                    confirmButtonText:'Salamat',
                    confirmButtonColor:'#2563eb',
                    width:'600px'
                });
            } else {
                Swal.fire({
                    title:'Hindi Nahanap',
                    text: `Walang tumutugmang rekord para sa "${searchId}" sa loob ng anumang kategorya sa file na ${file.name}.`,
                    icon:'info',
                    confirmButtonColor:'#2563eb'
                });
            }

        } catch (error) {
            console.error("Backup search error:", error);
            Swal.fire({
                title:'Error sa Pagbasa',
                text:'Hindi mabasa ang file. Siguraduhing ito ay tamang Full Backup JSON file ng OmniPOS.',
                icon:'error',
                confirmButtonColor:'#ef4444'
            });
        }
    };

    reader.readAsText(file);
}

function buksanScannerParaSaBackup() {

    openQRScanner();

    window.onQRScanSuccess = function(scannedCode) {

        const cleanCode = scannedCode.trim();

        const backupInput = document.getElementById('backup-query-id') ||
                            document.getElementById('backup-search-id') ||
                            document.querySelector('input[placeholder*="ID" i]') ||
                            document.querySelector('input[placeholder*="Transaction" i]');

        if (backupInput) {

            backupInput.value = cleanCode;

            closeQRScanner();

            window.onQRScanSuccess = null;

            setTimeout(() => {

                const SearchBtn = Array.from(document.querySelectorAll('button'))
                                        .find(btn => btn.textContent.trim().includes('Search') || btn.innerText.includes('Search'));

                if (SearchBtn) {
                    SearchBtn.click();
                } else {
                    console.error("Hindi mahanap ang button na may tekstong 'Hanapin' sa HTML.");
                }
            }, 300);

        } else {
            console.error("Hindi mahanap ang input text box para sa backup ID.");
        }
    };
}

function isDesktopOrLaptopDevice() {
    const ua = navigator.userAgent || navigator.vendor || window.opera ||'';
    const mobileTabletRegex =/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk/i;
    return !mobileTabletRegex.test(ua);
}

function applyDeviceScanRestrictions() {
    const isDesktop = isDesktopOrLaptopDevice();

    if (isDesktop) {
        document.querySelectorAll('.btn-scan-qr:not(.btn-scan-hardware-only), .btn-scan-backup').forEach(btn => {
            btn.disabled = true;
            btn.classList.add('scan-btn-disabled');
            btn.title ='Available lamang ang camera scan sa mobile o tablet device. Gumamit ng external barcode scanner sa search box.';
        });
    }

    document.querySelectorAll('.btn-scan-hardware-only').forEach(btn => {
        if (isDesktop) {
            btn.disabled = false;
            btn.classList.remove('scan-btn-disabled');
        } else {
            btn.disabled = true;
            btn.classList.add('scan-btn-disabled');
            btn.title ='Available lamang ito sa PC o Desktop na may konektadong external barcode scanner.';
        }
    });
}

function attachHardwareScannerListener(inputEl, onScanComplete, options = {}) {
    if (!inputEl) return;

    const maxInterval = options.maxInterval || 50;
    const minLength = options.minLength || 4;

    let buffer ='';
    let lastKeyTime = 0;
    let resetTimeoutId = null;

    inputEl.addEventListener('keydown', function (e) {
        const now = Date.now();
        const delta = now - lastKeyTime;
        lastKeyTime = now;

        if (e.key ==='Enter') {
            if (buffer.length >= minLength) {
                e.preventDefault();
                const scannedValue = buffer;
                buffer ='';
                onScanComplete(scannedValue);
            }
            return;
        }

        if (e.key.length === 1) {
            if (delta > maxInterval) {

                buffer = e.key;
            } else {
                buffer += e.key;
            }
        }

        if (resetTimeoutId) clearTimeout(resetTimeoutId);
        resetTimeoutId = setTimeout(() => { buffer =''; }, 300);
    });
}

async function handleHardwareScanTerminal(scannedCode) {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    const terminalSearchInput = document.getElementById('terminal-search');
    if (terminalSearchInput) {
        terminalSearchInput.value ='';
        if (typeof renderTerminalProducts ==='function') renderTerminalProducts();
    }

    const now = Date.now();
    if (cleanCode === lastScannedCode && (now - lastScannedTime < 1000)) {
        return;
    }
    lastScannedCode = cleanCode;
    lastScannedTime = now;

    if (!globalProducts || globalProducts.length === 0) {
        globalProducts = JSON.parse(localStorage.getItem('cached_products') ||'[]');
    }
    authFetch(`${API_URL}/products`)
        .then(res => res.json())
        .then(data => {
            globalProducts = data;
            localStorage.setItem('cached_products', JSON.stringify(globalProducts));
        })
        .catch(e => console.warn("Hindi na-refresh sa background ang products:", e));

    const product = globalProducts.find(p => p.code === cleanCode);

    if (product) {
        const cartItem = shoppingCart.find(item => item.code === product.code);
        const qtyInBasket = cartItem ? cartItem.quantity : 0;

        if (product.stock <= 0 || qtyInBasket >= product.stock) {
            Swal.fire({
                toast: true, position:'top-end', icon:'error',
                title: `Ubos na ang stock: ${product.name}`,
                showConfirmButton: false, timer: 2000, timerProgressBar: true
            });
            return;
        }

        addItemToCart(product);
        if (typeof playScanBeep ==='function') playScanBeep();

        Swal.fire({
            toast: true, position:'top-end', icon:'success',
            title: `Naidagdag sa cart: ${product.name}`,
            showConfirmButton: false, timer: 1500, timerProgressBar: true
        });
    } else {
        Swal.fire({
            toast: true, position:'top-end', icon:'warning',
            title: `Walang produktong tumutugma sa code: ${cleanCode}`,
            showConfirmButton: false, timer: 2000, timerProgressBar: true
        });
    }
}

function handleHardwareScanTransaction(scannedCode) {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    const searchInput = document.getElementById('tx-history-search');
    if (searchInput) {
        searchInput.value = cleanCode;
        filterTransactionsTable();
    }

    const match = localTransactionsList.find(tx => tx.id.toLowerCase() === cleanCode.toLowerCase());

    if (match) {
        if (typeof playScanBeep ==='function') playScanBeep();
        reopenReceiptFromHistory(match.id);
    } else {
        Swal.fire({
            title:'Hindi Nahanap',
            text: `Walang transaction record na tumutugma sa ID na "${cleanCode}".`,
            icon:'info',
            confirmButtonColor:'#2563eb'
        });
    }
}

function handleHardwareScanInventory(scannedCode) {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    const searchInput = document.getElementById('inventory-search');
    if (searchInput) {
        searchInput.value ='';
        filterInventoryTable();
    }

    const product = cachedInventoryProducts.find(p => p.code === cleanCode);

    if (product) {
        if (typeof playScanBeep ==='function') playScanBeep();
        highlightInventoryRow(product.code);
        Swal.fire({
            toast: true, position:'top-end', icon:'success',
            title: `Nakita: ${product.name}`,
            showConfirmButton: false, timer: 1500, timerProgressBar: true
        });
    } else {
        Swal.fire({
            toast: true, position:'top-end', icon:'warning',
            title: `Walang produktong tumutugma sa code: ${cleanCode}`,
            showConfirmButton: false, timer: 2000, timerProgressBar: true
        });
    }
}

function handleHardwareScanBackup(scannedCode) {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    const backupInput = document.getElementById('backup-query-id');
    if (backupInput) {
        backupInput.value = cleanCode;
    }

    if (typeof playScanBeep ==='function') playScanBeep();
    searchInsideBackupFile();
}

document.addEventListener('DOMContentLoaded', function () {
    applyDeviceScanRestrictions();

    initAutoCloseSidebarOnPrompt();

    attachHardwareScannerListener(
        document.getElementById('terminal-search'),
        handleHardwareScanTerminal
    );

    attachHardwareScannerListener(
        document.getElementById('tx-history-search'),
        handleHardwareScanTransaction
    );

    attachHardwareScannerListener(
        document.getElementById('inventory-search'),
        handleHardwareScanInventory
    );

    attachHardwareScannerListener(
        document.getElementById('backup-query-id'),
        handleHardwareScanBackup
    );

    attachHardwareScannerListener(
        document.getElementById('p-form-code'),
        handleHardwareScanProductForm
    );
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then((reg) => {
                console.log('[PWA] Service worker registered:', reg.scope);

                setInterval(() => reg.update(), 60 * 1000);
            })
            .catch((err) => console.warn('[PWA] Service worker registration failed:', err));

        let swAlreadyReloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (swAlreadyReloaded) return;
            swAlreadyReloaded = true;
            window.location.reload();
        });
    });
}
