const isLocal = window.location.hostname ==='localhost' ||
                window.location.hostname ==='127.0.0.1' ||
                window.location.hostname.startsWith('192.168.') ||
                window.location.hostname.startsWith('10.') ||
/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname);

const API_URL = isLocal
    ? `${window.location.protocol}//${window.location.hostname}:3000/api`
    : `${window.location.protocol}//${window.location.hostname}/api`;

const AUTH_FETCH_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url, options = {}, timeoutMs = AUTH_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();

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

// ================================================================
// MODERN OTP ENTRY MODAL — shared UI for every "Send OTP -> Verify
// OTP" flow in OmniPOS (theme unlock, feature unlock, bundle unlock,
// demo mode, admin login 2FA, receipt customization limit, receipt
// counter reset, admin password reset). This ONLY changes how the
// code is entered on screen (6 separate boxes, auto-advance, paste
// support, live status line) — it does NOT change any request/verify
// network call, endpoint, or the OMNIPOS <-> RELAY unlock logic.
// Every caller below still sends its own request-otp/unlock call and
// still POSTs the returned code to its own existing endpoint exactly
// as before.
//
// Usage:
//   const r = await showModernOtpModal({ subtitle: '...' });
//   if (!r) return; // cancelled
//   const otp = r.otp;
// ================================================================
function injectOtpModalStyles() {
    if (document.getElementById('otp-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'otp-modal-styles';
    style.textContent = `
        .otp-modal-popup { background:#12141c !important; border-radius:18px !important; }
        .otp-modal-card { padding: 4px 2px 0; text-align:center; }
        .otp-modal-eyebrow { font-size:0.68rem; letter-spacing:2.5px; color:#8b93a7; font-weight:700; text-transform:uppercase; margin-bottom:10px; }
        .otp-modal-title { font-size:1.35rem; font-weight:700; color:#fff; margin: 0 0 8px; }
        .otp-modal-subtitle { font-size:0.85rem; color:#9aa2b5; margin: 0 0 22px; line-height:1.45; }
        .otp-box-row { display:flex; align-items:center; justify-content:center; gap:clamp(4px,1.8vw,8px); margin-bottom: 16px; flex-wrap:nowrap; width:100%; }
        .otp-box-dash { color:#5b6172; font-size:1.3rem; padding: 0 1px; flex:0 0 auto; }
        .otp-box { width:clamp(30px,9vw,42px); height:clamp(40px,11vw,50px); flex:0 0 auto; border-radius:10px; border:1.5px solid #333849; background:#1b1e29; color:#fff; font-size:clamp(1.05rem,4vw,1.35rem); font-weight:700; text-align:center; outline:none; transition: border-color .15s, box-shadow .15s, background .15s; }
        .otp-box:focus { border-color:#3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.25); }
        .otp-box:disabled { opacity:0.6; }
        .otp-box.otp-box-filled { border-color:#4b5166; }
        .otp-box.otp-box-success { border-color:#22c55e !important; background: rgba(34,197,94,0.14) !important; color:#4ade80 !important; }
        .otp-box.otp-box-error { border-color:#ef4444 !important; background: rgba(239,68,68,0.14) !important; color:#f87171 !important; animation: otp-shake .32s; }
        @keyframes otp-shake { 0%,100% { transform:translateX(0); } 25% { transform:translateX(-4px); } 75% { transform:translateX(4px); } }
        .otp-modal-status { font-size:0.8rem; color:#9aa2b5; display:flex; align-items:center; justify-content:center; gap:6px; min-height: 18px; margin-bottom: 6px; }
        .otp-modal-status .otp-status-dot { width:6px; height:6px; border-radius:50%; background:#8b93a7; display:inline-block; flex:none; }
        .otp-modal-status.status-ok { color:#4ade80; } .otp-modal-status.status-ok .otp-status-dot { background:#22c55e; }
        .otp-modal-status.status-error { color:#f87171; } .otp-modal-status.status-error .otp-status-dot { background:#ef4444; }
        .otp-modal-tip { font-size:0.72rem; color:#5b6172; margin-top: 8px; }
        .otp-modal-pw { width:100%; box-sizing:border-box; margin-top:16px; padding:12px 14px; border-radius:10px; border:1.5px solid #333849; background:#1b1e29; color:#fff; font-size:0.95rem; outline:none; }
        .otp-modal-pw::placeholder { color:#5b6172; }
        .otp-modal-pw:focus { border-color:#3b82f6; }
    `;
    document.head.appendChild(style);
}

function buildOtpBoxesHtml() {
    let boxes = '';
    for (let i = 0; i < 6; i++) {
        boxes += `<input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="1" class="otp-box" id="otp-box-${i}" data-idx="${i}">`;
        if (i === 2) boxes += '<span class="otp-box-dash">—</span>';
    }
    return boxes;
}

// showModernOtpModal — optionally takes a `verifyFn(otp)` callback. When
// provided, wrong-code attempts are handled INLINE (red boxes + status
// line, up to `maxAttempts` tries) instead of closing this modal and
// popping up a separate "Incorrect Code" dialog. This ONLY changes how
// the result is shown on screen — verifyFn is expected to just wrap the
// caller's existing request/verify network call unchanged, and a
// "pending" (relay approval) or "noRetry" (e.g. expired code) result
// still closes the modal immediately, exactly like before, so the
// OMNIPOS <-> RELAY unlock/approval logic is untouched.
async function showModernOtpModal({
    eyebrow = 'SECURITY CHECK',
    title = 'Enter your code',
    subtitle = 'We sent a 6-digit code to verify your request.',
    confirmButtonText = 'Verify Code',
    cancelButtonText = 'Cancel',
    confirmButtonColor = '#2563eb',
    withPasswordField = false,
    passwordPlaceholder = 'New Password (min 8 chars)',
    verifyFn = null,
    maxAttempts = 3
} = {}) {
    injectOtpModalStyles();

    let attemptsLeft = maxAttempts;

    const getBoxes = () => Array.from({ length: 6 }, (_, i) => document.getElementById(`otp-box-${i}`));

    const setStatus = (text, state) => {
        const statusEl = document.getElementById('otp-modal-status');
        const statusText = document.getElementById('otp-modal-status-text');
        if (!statusEl || !statusText) return;
        statusEl.classList.remove('status-ok', 'status-error');
        if (state === 'ok') statusEl.classList.add('status-ok');
        if (state === 'error') statusEl.classList.add('status-error');
        statusText.textContent = text;
    };

    const setBoxesState = (state) => {
        getBoxes().forEach(b => {
            b.classList.remove('otp-box-error', 'otp-box-success');
            if (state === 'ok') b.classList.add('otp-box-success');
            if (state === 'error') b.classList.add('otp-box-error');
        });
    };

    const setBoxesDisabled = (disabled) => getBoxes().forEach(b => { b.disabled = disabled; });

    const resetBoxesForRetry = () => {
        const boxes = getBoxes();
        boxes.forEach(b => {
            b.value = '';
            b.disabled = false;
            b.classList.remove('otp-box-filled', 'otp-box-error', 'otp-box-success');
        });
        if (boxes[0]) boxes[0].focus();
    };

    const result = await Swal.fire({
        html: `
            <div class="otp-modal-card">
                <div class="otp-modal-eyebrow">${eyebrow}</div>
                <div class="otp-modal-title">${title}</div>
                <div class="otp-modal-subtitle">${subtitle}</div>
                <div class="otp-box-row">${buildOtpBoxesHtml()}</div>
                <div class="otp-modal-status" id="otp-modal-status"><span class="otp-status-dot"></span><span id="otp-modal-status-text">Enter the 6-digit code</span></div>
                ${withPasswordField ? `<input type="password" id="otp-modal-password" class="otp-modal-pw" placeholder="${passwordPlaceholder}" autocomplete="new-password">` : ''}
                <div class="otp-modal-tip">Tip: paste to fill every box at once.</div>
            </div>
        `,
        width: 'min(94vw, 380px)',
        showCancelButton: true,
        showConfirmButton: true,
        confirmButtonText,
        cancelButtonText,
        confirmButtonColor,
        cancelButtonColor: '#3a3f52',
        background: '#12141c',
        customClass: { popup: 'otp-modal-popup' },
        focusConfirm: false,
        allowOutsideClick: false,
        showLoaderOnConfirm: !!verifyFn,
        didOpen: () => {
            const boxes = getBoxes();
            boxes[0].focus();

            const clearFeedbackState = () => {
                setBoxesState(null);
                setStatus('Enter the 6-digit code', null);
            };

            boxes.forEach((box, idx) => {
                box.addEventListener('input', () => {
                    box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
                    box.classList.toggle('otp-box-filled', !!box.value);
                    clearFeedbackState();
                    if (box.value && idx < 5) boxes[idx + 1].focus();
                });
                box.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' && !box.value && idx > 0) {
                        boxes[idx - 1].focus();
                    }
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        Swal.clickConfirm();
                    }
                });
                box.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '').slice(0, 6);
                    if (!text) return;
                    clearFeedbackState();
                    text.split('').forEach((ch, i) => {
                        if (boxes[i]) { boxes[i].value = ch; boxes[i].classList.add('otp-box-filled'); }
                    });
                    const next = boxes[Math.min(text.length, 5)];
                    if (next) next.focus();
                });
            });
        },
        preConfirm: async () => {
            const boxes = getBoxes();
            const code = boxes.map(b => b.value).join('');
            if (code.length !== 6) {
                Swal.showValidationMessage('Please enter the full 6-digit code.');
                return false;
            }
            const out = { otp: code };
            if (withPasswordField) {
                const pw = (document.getElementById('otp-modal-password').value || '').trim();
                if (!pw || pw.length < 8) {
                    Swal.showValidationMessage('New password must be at least 8 characters.');
                    return false;
                }
                out.newPassword = pw;
            }

            // Legacy behaviour: no verifyFn given, just hand the raw code back
            // to the caller (unchanged).
            if (!verifyFn) return out;

            setBoxesDisabled(true);
            setStatus('Verifying...', null);

            let verifyData;
            try {
                verifyData = await verifyFn(out);
            } catch (e) {
                verifyData = { success: false, message: 'Could not reach the server. Please try again.' };
            }

            // Success, a pending relay approval, a cancelled wait, or an
            // explicitly non-retryable result (e.g. expired code) all close
            // this modal and hand control back to the caller exactly like
            // before — none of the request/verify network calls change.
            if (verifyData && (verifyData.success || verifyData.pending || verifyData.cancelled || verifyData.noRetry)) {
                if (verifyData.success) {
                    setBoxesState('ok');
                    setStatus('Code verified', 'ok');
                    await new Promise(r => setTimeout(r, 500));
                }
                return { ...out, ...verifyData };
            }

            // Wrong code — give inline feedback and let the person retry, up
            // to maxAttempts total, instead of closing with a separate
            // "Incorrect Code" popup.
            attemptsLeft -= 1;
            setBoxesState('error');

            if (attemptsLeft <= 0) {
                setStatus((verifyData && verifyData.message) || 'Incorrect code.', 'error');
                await new Promise(r => setTimeout(r, 1100));
                return { ...out, ...(verifyData || { success: false }) };
            }

            setStatus(`Incorrect code, try again (${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left)`, 'error');
            await new Promise(r => setTimeout(r, 750));
            resetBoxesForRetry();
            setStatus('Enter the 6-digit code', null);
            return false;
        }
    });

    if (!result.isConfirmed || !result.value) return null;
    return result.value;
}

async function authFetch(url, options = {}) {
    const token = localStorage.getItem('omnipos_token');
    const opts = { ...options };
    opts.headers = {
        ...(options.headers || {}),
        ...(token ? {'Authorization': `Bearer ${token}` } : {})
    };

    const timeoutMs = options.timeoutMs || AUTH_FETCH_TIMEOUT_MS;

    let res;
    try {
        res = await fetchWithTimeout(url, opts, timeoutMs);
    } catch (err) {

        if (window.__triggerNetworkRecheck) window.__triggerNetworkRecheck();
        throw err;
    }

    if (res.status === 401 && !url.includes('/auth/login')) {

        if (!token) {
            return res;
        }

        if (!window.__sessionExpiredShown && !window.__logoutInProgress) {
            window.__sessionExpiredShown = true;
            localStorage.removeItem('omnipos_user');
            localStorage.removeItem('omnipos_token');
            if (typeof Swal !=='undefined') {
                Swal.fire('Session Expired','Your session has expired or become invalid. Please log in again.','warning')
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

function showUnlockRequestError(reqData, fallbackMessage) {
    if (reqData && reqData.pendingAuthorization) {
        Swal.fire({
            icon:'info',
            title:'Waiting for Authorization',
            html: '<p style="font-size:0.85rem;color:#64748b;margin:0;">' +
                (reqData.message ||'This device has been sent to the developer/store owner for authorization. Try again after they \"Allow\" it.') +
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

function b64urlToBuf(b64url) {
    let b64 = String(b64url).replace(/-/g,'+').replace(/_/g,'/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

function bufToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let bin ='';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function isBiometricLoginAvailable() {
    const isMobileDeviceUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobileDeviceUA) return false;
    if (!window.isSecureContext) return false;
    if (!window.PublicKeyCredential || !navigator.credentials) return false;
    try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
        return false;
    }
}

(async function initBiometricLoginButton() {
    const btn = document.getElementById('biometric-login-btn');
    if (!btn) return;
    const available = await isBiometricLoginAvailable();

    btn.style.display = available ?'flex' :'none';
})();

async function loginWithBiometric() {
    const errorBanner = document.getElementById('login-error');

    try {

        const optRes = await fetchWithTimeout(`${API_URL}/auth/webauthn/login-options`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({})
        });
        const optData = await optRes.json();
        if (!optData.success) {
            errorBanner.innerText = optData.message ||'Fingerprint Login is not enabled here.';
            errorBanner.style.display ='block';
            return;
        }

        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: b64urlToBuf(optData.challenge),
                rpId: optData.rpId,
                timeout: optData.timeout,
                userVerification: optData.userVerification

            }
        });

        const verifyRes = await fetchWithTimeout(`${API_URL}/auth/webauthn/login-verify`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({
                credentialId: bufToB64url(assertion.rawId),
                clientDataJSON: bufToB64url(assertion.response.clientDataJSON),
                authenticatorData: bufToB64url(assertion.response.authenticatorData),
                signature: bufToB64url(assertion.response.signature),
                userHandle: assertion.response.userHandle ? bufToB64url(assertion.response.userHandle) : null
            })
        });
        const data = await verifyRes.json();

        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('omnipos_user', JSON.stringify(currentUser));
            localStorage.setItem('omnipos_last_username', currentUser.username);
            currentPermissions = data.permissions || {};
            menuRegistry = data.menuRegistry || [];
            localStorage.setItem('omnipos_permissions', JSON.stringify(currentPermissions));
            localStorage.setItem('omnipos_menu_registry', JSON.stringify(menuRegistry));
            if (data.token) localStorage.setItem('omnipos_token', data.token);

            window.__logoutInProgress = false;
            window.__sessionExpiredShown = false;
            errorBanner.style.display ='none';

            showMainSystemInterface().catch(err => {
                console.error('Unexpected error during biometric login:', err);
            });
        } else {
            errorBanner.innerText = data.message ||'Fingerprint Login failed.';
            errorBanner.style.display ='block';
        }
    } catch (err) {

        if (err && (err.name ==='NotAllowedError' || err.name ==='AbortError')) return;
        console.error(err);
        errorBanner.innerText ='Fingerprint Login failed. Please try again or use your password.';
        errorBanner.style.display ='block';
    }
}

async function refreshBiometricSection() {
    const section = document.getElementById('biometric-section');
    if (!section) return;
    const available = await isBiometricLoginAvailable();
    section.style.display = available ?'block' :'none';
    if (available) loadBiometricDevicesList();
}

async function loadBiometricDevicesList() {
    const listEl = document.getElementById('biometric-devices-list');
    if (!listEl) return;
    listEl.innerHTML ='<p style="color:#64748b; font-size:0.8rem;">Loading...</p>';
    try {
        const res = await authFetch(`${API_URL}/auth/webauthn/credentials`);
        const data = await res.json();
        const creds = (data && data.credentials) || [];
        if (creds.length === 0) {
            listEl.innerHTML ='<p style="color:#64748b; font-size:0.85rem;">No fingerprint has been enabled on this device yet.</p>';
            return;
        }
        listEl.innerHTML = creds.map(c => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color);">
                <div>
                    <div><i class="fa-solid fa-mobile-screen-button"></i> ${escapeHtml(c.deviceLabel ||'Device')}</div>
                    <div style="font-size:0.75rem; color:#64748b;">Na-enable: ${escapeHtml(c.createdAt ||'')}</div>
                </div>
                <button type="button" class="btn-icon-action delete" title="Alisin" onclick="removeBiometricCredential('${encodeURIComponent(c.id)}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
        listEl.innerHTML ='<p style="color:#64748b; font-size:0.85rem;">Unable to load the list of fingerprint devices.</p>';
    }
}

async function registerBiometricCredential() {
    try {
        const optRes = await authFetch(`${API_URL}/auth/webauthn/register-options`, { method:'POST' });
        const optData = await optRes.json();
        if (!optData.success) {
            Swal.fire('Unable to Start', optData.message ||'Unable to start fingerprint enrollment.','error');
            return;
        }
        const o = optData.options;

        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: b64urlToBuf(o.challenge),
                rp: o.rp,
                user: { id: b64urlToBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
                pubKeyCredParams: o.pubKeyCredParams,
                authenticatorSelection: o.authenticatorSelection,
                attestation: o.attestation,
                timeout: o.timeout,
                excludeCredentials: (o.excludeCredentials || []).map(c => ({ id: b64urlToBuf(c.id), type: c.type }))
            }
        });

        const deviceLabel = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform ||'Mobile device';
        const verifyRes = await authFetch(`${API_URL}/auth/webauthn/register-verify`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({
                credentialId: bufToB64url(credential.rawId),
                clientDataJSON: bufToB64url(credential.response.clientDataJSON),
                attestationObject: bufToB64url(credential.response.attestationObject),
                deviceLabel
            })
        });
        const data = await verifyRes.json();
        if (data.success) {
            localStorage.setItem('omnipos_last_username', currentUser.username);
            Swal.fire('Enabled', SYSTEM_CONFIG.getSuccessMessage('Fingerprint Login has been enabled on this device.'),'success');
            loadBiometricDevicesList();
        } else {
            Swal.fire('Unable to Enable', data.message ||'Failed to enable Fingerprint Login.','error');
        }
    } catch (err) {
        if (err && (err.name ==='NotAllowedError' || err.name ==='AbortError')) return;
        console.error(err);
        Swal.fire('Error','Unable to enable Fingerprint Login on this device.','error');
    }
}

async function removeBiometricCredential(encodedId) {
    const confirmResult = await Swal.fire({
        title:'Remove Fingerprint?',
        text:'This will no longer be usable to log in on this device.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Remove',
        cancelButtonText:'Cancel'
    });
    if (!confirmResult.isConfirmed) return;

    try {
        const res = await authFetch(`${API_URL}/auth/webauthn/credentials/${encodedId}`, { method:'DELETE' });
        const data = await res.json();
        if (data.success) {
            loadBiometricDevicesList();
        } else {
            Swal.fire('Error', data.message ||'Unable to remove the fingerprint.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Error','Unable to remove the fingerprint.','error');
    }
}

function triggerHaptic(durationMs = 12) {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(durationMs);
        }
    } catch (e) {

    }
}

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

function attachLongPress(el, callback, durationMs) {
    if (!el || el.__longPressBound) return;
    el.__longPressBound = true;
    durationMs = durationMs || 1000;

    let pressTimer = null;
    let didFire = false;

    const clearPressTimer = function () {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    el.addEventListener('pointerdown', function (e) {
        didFire = false;
        clearPressTimer();
        pressTimer = setTimeout(function () {
            pressTimer = null;
            didFire = true;
            triggerHaptic(20);
            callback(e);
        }, durationMs);
    }, { passive: true });

    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (evtName) {
        el.addEventListener(evtName, clearPressTimer, { passive: true });
    });

    el.addEventListener('click', function (e) {
        if (didFire) {

            e.stopPropagation();
            didFire = false;
        }

    });

    el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });
}

function attachHoldPreview(el, onShow, onHide, durationMs) {
    if (!el || el.__holdPreviewBound) return;
    el.__holdPreviewBound = true;
    durationMs = durationMs || 380;

    let pressTimer = null;
    let isShowing = false;

    const clearPressTimer = function () {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    const doHide = function () {
        clearPressTimer();
        if (isShowing) {
            isShowing = false;
            onHide();
        }
    };

    el.addEventListener('pointerdown', function (e) {
        clearPressTimer();
        pressTimer = setTimeout(function () {
            pressTimer = null;
            isShowing = true;
            triggerHaptic(15);
            onShow(e);
        }, durationMs);
    }, { passive: true });

    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (evtName) {
        el.addEventListener(evtName, doHide, { passive: true });
    });

    el.addEventListener('click', function (e) {

        if (isShowing) {
            e.stopPropagation();
        }
    });

    el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });
}

// Isang shared na "coordinator" (hindi per-element) para sa hover preview ng
// buong product grid. Dati, magkakahiwalay na state ang h4/price/stock ng
// isang product card — kaya sa sobrang liit na galaw ng pointer papunta sa
// katabing text (h4 -> price -> stock) ng IISANG product, nag-fi-fire ang
// pointerleave ng luma bago pa man makapasok ang pointerenter ng bago, kaya
// nawawala-lumalabas (blink) ang peek nang paulit-ulit habang nakatigil lang
// naman talaga sa iisang product. Dito, iisang groupKey (product code) ang
// ginagamit para malaman kung "parehong product pa rin" ang hinover — kung
// oo, hindi na ito nagpapa-restart/hide. May 5-segundong auto-hide (blink
// off) din habang paulit-ulit na naka-hover sa iisang product, at kapag
// dumiretso ang pointer sa ibang product, agad na nawawala ang dati (kahit
// hindi pa naabot ang 5s nito) para makapalit kaagad ang bago.
const hoverPeekCoordinator = {
    groupKey: null,
    showTimer: null,
    leaveTimer: null,
    autoHideTimer: null,
    reshowTimer: null,
    isVisible: false
};

function attachHoverPreview(el, onShow, onHide, durationMs, groupKey) {
    if (!el || el.__hoverPreviewBound) return;
    el.__hoverPreviewBound = true;
    durationMs = durationMs || 1000;

    const AUTO_HIDE_MS = 5000;
    const SWITCH_DELAY_MS = 150;
    const LEAVE_GRACE_MS = 180;
    const RESHOW_GAP_MS = 400;

    const c = hoverPeekCoordinator;

    const clearAllTimers = function () {
        clearTimeout(c.showTimer); c.showTimer = null;
        clearTimeout(c.leaveTimer); c.leaveTimer = null;
        clearTimeout(c.autoHideTimer); c.autoHideTimer = null;
        clearTimeout(c.reshowTimer); c.reshowTimer = null;
    };

    const doHide = function () {
        clearAllTimers();
        if (c.isVisible) {
            c.isVisible = false;
            onHide();
        }
        c.groupKey = null;
    };

    const doShow = function (e) {
        clearTimeout(c.autoHideTimer); c.autoHideTimer = null;
        clearTimeout(c.reshowTimer); c.reshowTimer = null;
        c.isVisible = true;
        c.groupKey = groupKey;
        onShow(e);

        // Awtomatikong itago (blink off) pagkalipas ng 5s ng patuloy na
        // pagpapakita. Kung nananatili pa rin ang pointer sa parehong
        // product (hindi pa na-hide ng ibang mekanismo), muling ipapakita
        // pagkalipas ng maikling pahinga — ito ang paulit-ulit na "blink
        // every 5 seconds" habang nananatili sa isang product.
        c.autoHideTimer = setTimeout(function () {
            c.isVisible = false;
            onHide();
            c.reshowTimer = setTimeout(function () {
                if (c.groupKey === groupKey) doShow(e);
            }, RESHOW_GAP_MS);
        }, AUTO_HIDE_MS);
    };

    el.addEventListener('pointerenter', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;

        clearTimeout(c.leaveTimer);
        c.leaveTimer = null;

        if (c.groupKey === groupKey && (c.isVisible || c.showTimer || c.reshowTimer)) {

            return;
        }

        const switchingProduct = !!(c.groupKey && c.groupKey !== groupKey);
        clearTimeout(c.showTimer); c.showTimer = null;
        clearTimeout(c.autoHideTimer); c.autoHideTimer = null;
        clearTimeout(c.reshowTimer); c.reshowTimer = null;

        if (switchingProduct) {

            if (c.isVisible) { c.isVisible = false; onHide(); }
            c.groupKey = null;
            c.showTimer = setTimeout(function () {
                c.showTimer = null;
                doShow(e);
            }, SWITCH_DELAY_MS);
        } else {
            c.showTimer = setTimeout(function () {
                c.showTimer = null;
                doShow(e);
            }, durationMs);
        }
    });

    el.addEventListener('pointerleave', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;

        clearTimeout(c.leaveTimer);
        c.leaveTimer = setTimeout(function () {
            c.leaveTimer = null;
            if (c.groupKey === groupKey) doHide();
        }, LEAVE_GRACE_MS);
    });
}

let activeProductImagePeekEl = null;

function showProductImagePeek(anchorEl, product) {
    if (!anchorEl || !product || !product.image) return;
    hideProductImagePeek();

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    const peekSize = Math.max(180, Math.min(window.innerWidth, window.innerHeight) * 0.6);

    const peek = document.createElement('div');
    peek.className = 'product-image-peek';
    peek.style.left = `${centerX}px`;
    peek.style.top = `${centerY}px`;
    peek.style.width = `${peekSize}px`;
    peek.style.height = `${peekSize}px`;
    peek.innerHTML = `
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name || 'Product')}" draggable="false">
        <div class="product-image-peek-label">${escapeHtml(product.name || 'Product')} — full image</div>
    `;

    document.body.appendChild(peek);

    requestAnimationFrame(() => peek.classList.add('shown'));

    activeProductImagePeekEl = peek;
}

function hideProductImagePeek() {
    if (!activeProductImagePeekEl) return;
    const el = activeProductImagePeekEl;
    activeProductImagePeekEl = null;
    el.classList.remove('shown');
    setTimeout(() => el.remove(), 160);
}

const SYSTEM_CONFIG = {
    appName:"OmniPOS System",
    serverName:"Core API Gateway",
    getErrorMessage: (msg) => `[${SYSTEM_CONFIG.serverName}] Error: ${msg}`,
    getSuccessMessage: (msg) => `[${SYSTEM_CONFIG.appName}] Success: ${msg}`
};

let currentUser = null;
try {
    const storedUser = localStorage.getItem('omnipos_user');
    if (storedUser && storedUser !=='undefined') {
        currentUser = JSON.parse(storedUser);
    }
} catch (e) {
    console.warn("Corrupted local session found. Clearing data.");
    localStorage.removeItem('omnipos_user');
    localStorage.removeItem('omnipos_token');
}

let currentPermissions = {};
let menuRegistry = [];
try {
    const storedPerms = localStorage.getItem('omnipos_permissions');
    if (storedPerms && storedPerms !=='undefined') currentPermissions = JSON.parse(storedPerms);
    const storedRegistry = localStorage.getItem('omnipos_menu_registry');
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

        localStorage.setItem('omnipos_permissions', JSON.stringify(currentPermissions));
        localStorage.setItem('omnipos_menu_registry', JSON.stringify(menuRegistry));
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
// Draft info collected via the "Add Debt" form when C-Credit is chosen as the
// payment method at checkout. Holds { customerName, phone, note, dueAt } and is
// sent along with the sale so the server can create the linked debt record.
let pendingCreditDebtDraft = null;

let splitPaymentMode = false;
let splitPaymentLines = [];
let scannerTarget ='PRODUCT';

let cartDiscountType ='NONE';
let cartPromoCode ='';

let cartActivePromo = null;
let cartSeniorPwdId ='';
let cartLoyaltyPointsRedeemed = 0;

let cartLoyaltyCardToken ='';
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
    { id:'liquidglass', name:'Liquid Glass Pro', icon:'fa-droplet', pro: true, price:'₱250' },
    { id:'galaxyambient', name:'Galaxy Ambient Pro', icon:'fa-circle-half-stroke', pro: true, price:'₱149' },
];

function getUnlockedThemeIds() {
    try {
        return JSON.parse(localStorage.getItem('omnipos_unlocked_themes_cache') ||'[]');
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
            localStorage.setItem('omnipos_unlocked_themes_cache', JSON.stringify(data.unlockedThemeIds));
            renderThemeMenu();
            if (typeof renderTerminalThemeMenu ==='function') renderTerminalThemeMenu();
            // Ngayon lang — pagkatapos ng totoong sagot ng server — dapat isipin
            // kung i-downgrade ang naka-save na Terminal Pro theme. Bago nito
            // (bago pa dumating ang sagot na 'to), palaging kino-keep na muna
            // ang naka-save na pinili ng user sa applySavedTerminalExtraTheme().
            if (sessionStorage.getItem('currentView') ==='terminal' && typeof revalidateTerminalThemeAfterUnlockSync ==='function') {
                revalidateTerminalThemeAfterUnlockSync();
            }
        }
    } catch (e) {
        console.warn('Could not fetch theme unlock status from the server, using cache instead.', e);
    }
}

function updateMetaThemeColor() {
    const header = document.getElementById('app-top-header');
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!header || !metaThemeColor) return;

    const bg = getComputedStyle(header).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        metaThemeColor.setAttribute('content', bg);
    }
}

function initDynamicThemeColor() {
    updateMetaThemeColor();

    const observerOptions = { attributes: true, attributeFilter: ['class', 'data-theme', 'data-terminal-theme', 'data-ct-header', 'style'] };

    new MutationObserver(updateMetaThemeColor).observe(document.documentElement, observerOptions);
    new MutationObserver(updateMetaThemeColor).observe(document.body, observerOptions);

    const header = document.getElementById('app-top-header');
    if (header) {
        new MutationObserver(updateMetaThemeColor).observe(header, { attributes: true, attributeFilter: ['class', 'data-terminal-theme'] });
    }

    // Failsafe kung sakaling may async na theme change na di na-catch ng mga observer sa itaas.
    window.addEventListener('load', updateMetaThemeColor);
}

function initDarkMode() {

    let savedThemeId = localStorage.getItem('omnipos_theme');
    if (!savedThemeId) {
        savedThemeId = localStorage.getItem('omnipos_darkmode') ==='true' ?'dark' :'day';
    }
    const theme = THEME_CATALOG.find(t => t.id === savedThemeId) || THEME_CATALOG[0];

    const themeToApply = isThemeUnlocked(theme) ? theme : THEME_CATALOG[1];
    applyTheme(themeToApply.id, { persist: false });
    renderThemeMenu();
    if (typeof updateHeaderDayDarkModeUI ==='function') updateHeaderDayDarkModeUI();
}

function isStoreThemeDay() {
    var savedThemeId = localStorage.getItem('omnipos_theme');
    if (!savedThemeId) {
        savedThemeId = localStorage.getItem('omnipos_darkmode') ==='true' ?'dark' :'day';
    }
    return savedThemeId ==='day';
}

function syncColorSchemeDeclaration() {
    var isTerminalView = sessionStorage.getItem('currentView') ==='terminal';
    var isLight;
    if (isTerminalView) {

        isLight = localStorage.getItem('terminal_daymode') ==='true';
    } else {
        isLight = isStoreThemeDay();
    }
    var root = document.documentElement;
    root.style.colorScheme = isLight ?'light' :'dark';
    var metaColorScheme = document.getElementById('meta-color-scheme');
    if (metaColorScheme) metaColorScheme.setAttribute('content', isLight ?'light' :'dark');
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
    syncColorSchemeDeclaration();
    if (opts.persist !== false) {
        localStorage.setItem('omnipos_theme', theme.id);
        localStorage.setItem('omnipos_darkmode', String(!isDay));
    }
    updateThemeSelectionUI(theme.id);

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
    const currentThemeId = localStorage.getItem('omnipos_theme') ||'day';

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
'<i class="fa-solid ' + theme.icon +'"></i> ' +
'<span class="uw-theme-option-label">' + theme.name +'</span>' +
'<span class="uw-theme-badge-slot">' + badge +'</span>' +
'</button>'
        );
    }).join('');
}

// ============================================================================
// TERMINAL-ONLY THEMES
// ----------------------------------------------------------------------------
// A separate, self-contained theme picker that lives inside the sidebar's
// user-profile dropdown but only ever affects the POS Terminal screen
// (#view-terminal). It is intentionally decoupled from the store-wide
// `omnipos_theme` selection (setTheme/applyTheme above):
//   - It has its own storage key (TERMINAL_THEME_STORAGE_KEY) so switching it
//     never touches or is touched by the rest of OmniPOS's look.
//   - The dropdown entry itself is only ever visible while the cashier is
//     inside the Terminal view; it disappears everywhere else.
//   - Only themes already unlocked (same unlock pool as the store themes)
//     show up here, and selecting one actually re-skins the terminal (which
//     previously ignored the store's data-theme entirely).
//   - When switched back to "Default", the Terminal simply falls back to its
//     own independent Day/Night toggle (terminal_daymode), which itself
//     always defaults to dark mode.
// ============================================================================

const TERMINAL_THEME_STORAGE_KEY ='terminal_extra_theme';

function getUnlockedTerminalThemes() {
    const unlockedIds = getUnlockedThemeIds();
    return THEME_CATALOG.filter(t => t.pro && unlockedIds.includes(t.id));
}

function getActiveTerminalThemeId() {
    return localStorage.getItem(TERMINAL_THEME_STORAGE_KEY) ||'';
}

function updateTerminalThemesMenuVisibility() {
    const isTerminalView = sessionStorage.getItem('currentView') ==='terminal';

    const sidebarToggleRow = document.getElementById('uw-terminalthemes-toggle');
    if (sidebarToggleRow) {
        sidebarToggleRow.style.display = isTerminalView ?'' :'none';
        if (!isTerminalView) {
            document.getElementById('uw-terminalthemes-submenu')?.classList.remove('open');
            document.getElementById('uw-terminalthemes-caret')?.classList.remove('rotated');
        }
    }

    const headerToggleRow = document.getElementById('hu-terminalthemes-toggle');
    if (headerToggleRow) {
        headerToggleRow.style.display = isTerminalView ?'' :'none';
        if (!isTerminalView) closeHeaderTerminalThemesSubmenu();
    }
}

function buildTerminalThemeOptionsHtml(optionClass, labelClass, badgeSlotClass) {
    const unlockedThemes = getUnlockedTerminalThemes();
    const activeId = getActiveTerminalThemeId();

    let html =
'<button type="button" class="' + optionClass + (activeId ?'' :' active') +'" ' +
'data-theme-id="" onclick="setTerminalTheme(\'\')">' +
'<i class="fa-solid fa-moon"></i> ' +
'<span class="' + labelClass +'">Default (Terminal Dark)</span>' +
'<span class="' + badgeSlotClass +'"></span>' +
'</button>';

    if (unlockedThemes.length === 0) {
        html +='<div class="uw-au-empty">No unlocked Pro themes yet.</div>';
    } else {
        html += unlockedThemes.map((theme) => {
            const isActive = theme.id === activeId;
            return (
'<button type="button" class="' + optionClass + (isActive ?' active' :'') +'" ' +
'data-theme-id="' + theme.id +'" onclick="setTerminalTheme(\'' + theme.id +'\')">' +
'<i class="fa-solid ' + theme.icon +'"></i> ' +
'<span class="' + labelClass +'">' + theme.name +'</span>' +
'<span class="' + badgeSlotClass +'"><span class="uw-theme-pro-badge">PRO</span></span>' +
'</button>'
            );
        }).join('');
    }
    return html;
}

function renderTerminalThemeMenu() {
    const sidebarContainer = document.getElementById('uw-terminalthemes-submenu');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = buildTerminalThemeOptionsHtml('uw-theme-option','uw-theme-option-label','uw-theme-badge-slot');
    }
    const headerContainer = document.getElementById('hu-terminalthemes-submenu');
    if (headerContainer) {
        headerContainer.innerHTML = buildTerminalThemeOptionsHtml('hu-theme-option','hu-theme-option-label','hu-theme-badge-slot');
    }
}

function updateTerminalThemeSelectionUI(activeId) {
    document.querySelectorAll('#uw-terminalthemes-submenu .uw-theme-option, #hu-terminalthemes-submenu .hu-theme-option').forEach((btn) => {
        btn.classList.toggle('active', (btn.dataset.themeId ||'') === activeId);
    });
}

// Applies (or clears, when themeId is falsy) the terminal-only theme onto the
// live DOM. `persist:false` is used when merely re-applying an already-saved
// choice (e.g. on view switch) so we don't re-write localStorage needlessly.
function applyTerminalExtraTheme(themeId, opts) {
    opts = opts || {};
    const terminalSection = document.getElementById('view-terminal');
    const headerEl = document.getElementById('app-top-header');
    if (!terminalSection) return;

    if (themeId) {
        terminalSection.setAttribute('data-terminal-theme', themeId);
        document.body.setAttribute('data-terminal-theme', themeId);
        // Also tag the header itself (not just #view-terminal) so the
        // account dropdown — which lives in the header, outside
        // #view-terminal — can pick up the same palette via CSS while the
        // cashier is inside the Terminal. Everywhere else in OmniPOS the
        // dropdown stays on its own fixed look, untouched by this or by
        // the store-wide Pro theme (see .header-user-dropdown in style.css).
        if (headerEl) headerEl.setAttribute('data-terminal-theme', themeId);
        // A Pro terminal theme takes over completely while active; the
        // terminal's own Day/Night toggle is paused (not lost — just parked)
        // until this is switched back to Default.
        terminalSection.classList.remove('terminal-daymode');
        if (headerEl) headerEl.classList.remove('terminal-daymode');
        document.body.classList.remove('terminal-modal-daymode');
    } else {
        terminalSection.removeAttribute('data-terminal-theme');
        document.body.removeAttribute('data-terminal-theme');
        if (headerEl) headerEl.removeAttribute('data-terminal-theme');
        // Back to Default: hand control back to the terminal's own
        // Day/Night toggle, which defaults to dark mode.
        if (typeof applySavedTerminalDayMode ==='function') applySavedTerminalDayMode();
    }

    if (opts.persist !== false) {
        if (themeId) localStorage.setItem(TERMINAL_THEME_STORAGE_KEY, themeId);
        else localStorage.removeItem(TERMINAL_THEME_STORAGE_KEY);
    }

    updateTerminalThemeSelectionUI(themeId ||'');
    syncColorSchemeDeclaration();
}

function setTerminalTheme(themeId) {
    if (themeId) {
        const theme = THEME_CATALOG.find(t => t.id === themeId);
        if (!theme || !isThemeUnlocked(theme)) {
            // Safety net only — the submenu already filters to unlocked
            // themes, so this should not normally happen.
            return;
        }
    }
    applyTerminalExtraTheme(themeId);
}

// Re-applies whatever terminal-only theme (if any) was previously saved.
// Called whenever the Terminal view is (re)loaded.
//
// IMPORTANT: hindi ito dapat mag-check ng isThemeUnlocked() dito, dahil sa
// unang segundo ng pag-reload, ang lokal na "omnipos_unlocked_themes_cache" ay
// maaaring hindi pa updated (kasabay pa lang natatawag ang
// refreshUnlockedThemesFromServer() na async at hindi hinihintay). Kung
// gagate natin dito, may posibilidad na basta na lang ma-delete yung naka-
// save na napiling theme ng user kahit totoo namang naka-unlock ito — kaya
// nawawala ito tuwing nag-re-refresh. Sa halip, i-restore muna agad ang
// huling naka-save na pinili (dahil kumpirmado na 'to noong una itong napili),
// at ang totoong pag-verify/downgrade (kung talaga namang na-revoke na ang
// unlock) ay ginagawa na lang sa revalidateTerminalThemeAfterUnlockSync(),
// pagkatapos ma-kumpirma ng totoong sagot ng server.
function applySavedTerminalExtraTheme() {
    const savedId = getActiveTerminalThemeId();
    const theme = savedId ? THEME_CATALOG.find(t => t.id === savedId) : null;

    if (theme) {
        applyTerminalExtraTheme(savedId, { persist: false });
    } else if (savedId) {
        // Hindi na kilalang theme id (halimbawa: tinanggal na sa catalog) — safe i-clear.
        localStorage.removeItem(TERMINAL_THEME_STORAGE_KEY);
        applyTerminalExtraTheme('', { persist: false });
    } else {
        applyTerminalExtraTheme('', { persist: false });
    }
    renderTerminalThemeMenu();
}

// Tinatawag lang PAGKATAPOS ng totoong (awaited) sagot ng server tungkol sa
// unlocked themes. Dito lang dapat mangyari ang pag-downgrade/pag-clear ng
// naka-save na Terminal theme — at kapag kumpirmado na talagang hindi na ito
// unlocked, hindi dahil sa boot-time na race/stale cache.
function revalidateTerminalThemeAfterUnlockSync() {
    const savedId = getActiveTerminalThemeId();
    if (!savedId) return;
    const theme = THEME_CATALOG.find(t => t.id === savedId);
    if (!theme || !isThemeUnlocked(theme)) {
        localStorage.removeItem(TERMINAL_THEME_STORAGE_KEY);
        applyTerminalExtraTheme('', { persist: false });
        renderTerminalThemeMenu();
    }
}

function toggleTerminalThemesSubmenu(event) {
    if (event) event.stopPropagation();
    const submenu = document.getElementById('uw-terminalthemes-submenu');
    const caret = document.getElementById('uw-terminalthemes-caret');
    if (!submenu) return;
    const isOpen = submenu.classList.toggle('open');
    if (caret) caret.classList.toggle('rotated', isOpen);

    document.getElementById('uw-themes-submenu')?.classList.remove('open');
    document.getElementById('uw-themes-caret')?.classList.remove('rotated');
    closeActiveUsersSubmenu();

    if (isOpen) {
        refreshUnlockedThemesFromServer().then(() => renderTerminalThemeMenu());
        renderTerminalThemeMenu();
    }
}

const CT_DEFAULTS = {
    fontScale: 1, accent: null, accentHover: null, accentSoft: null,
    card:'elevated', radius:'rounded', border:'thin', header:'solid',
    density:'comfortable', motion:'normal', contrast:'normal',
    rowHeight:'auto', rowPadding: 14
};

const CT_ROW_PAD_BASE = 14;
const CT_ROW_PAD_PRESET = { compact: 8, comfortable: 14, spacious: 22 };
const CT_STORAGE_KEY ='omnipos_custom_theme';

function ctShade(hex, percent) {
    try {
        const num = parseInt(hex.replace('#',''), 16);
        let r = (num >> 16) + Math.round(255 * percent);
        let g = ((num >> 8) & 0x00FF) + Math.round(255 * percent);
        let b = (num & 0x0000FF) + Math.round(255 * percent);
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));
        return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
    } catch (e) { return hex; }
}
function ctRgba(hex, alpha) {
    try {
        const num = parseInt(hex.replace('#',''), 16);
        const r = (num >> 16) & 0xFF, g = (num >> 8) & 0xFF, b = num & 0xFF;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } catch (e) { return hex; }
}

function loadCustomThemeSettings() {
    try {
        const raw = localStorage.getItem(CT_STORAGE_KEY);
        if (!raw) return { ...CT_DEFAULTS };
        return { ...CT_DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { return { ...CT_DEFAULTS }; }
}

function applyCustomTheme(settings) {
    const s = { ...CT_DEFAULTS, ...settings };
    const root = document.documentElement;

    root.style.fontSize = s.fontScale !== 1 ? (16 * s.fontScale) +'px' :'';

    if (s.accent) {
        root.style.setProperty('--dm-accent', s.accent);
        root.style.setProperty('--dm-accent-hover', s.accentHover || ctShade(s.accent, -0.12));
        root.style.setProperty('--dm-accent-soft', s.accentSoft || ctRgba(s.accent, 0.16));
    } else {
        root.style.removeProperty('--dm-accent');
        root.style.removeProperty('--dm-accent-hover');
        root.style.removeProperty('--dm-accent-soft');
    }

    const setAttr = (name, val, defaultVal) => {
        if (val && val !== defaultVal) root.setAttribute(name, val);
        else root.removeAttribute(name);
    };
    setAttr('data-ct-card', s.card, CT_DEFAULTS.card);
    setAttr('data-ct-radius', s.radius, CT_DEFAULTS.radius);
    setAttr('data-ct-border', s.border, CT_DEFAULTS.border);
    setAttr('data-ct-header', s.header, CT_DEFAULTS.header);
    setAttr('data-ct-density', s.density, CT_DEFAULTS.density);
    setAttr('data-ct-motion', s.motion ==='reduced' ?'reduced' : null, null);
    setAttr('data-ct-contrast', s.contrast ==='high' ?'high' : null, null);

    let rowPadY;
    if (s.rowHeight ==='custom') {
        rowPadY = (typeof s.rowPadding ==='number' && !isNaN(s.rowPadding)) ? s.rowPadding : CT_ROW_PAD_BASE;
    } else if (CT_ROW_PAD_PRESET.hasOwnProperty(s.rowHeight)) {
        rowPadY = CT_ROW_PAD_PRESET[s.rowHeight];
    } else {
        rowPadY = Math.round(CT_ROW_PAD_BASE * s.fontScale);
    }
    root.style.setProperty('--ct-row-pad-y', rowPadY +'px');
    setAttr('data-ct-row-height', s.rowHeight, CT_DEFAULTS.rowHeight);
}

function saveCustomThemeSettings(settings) {
    try { localStorage.setItem(CT_STORAGE_KEY, JSON.stringify(settings)); } catch (e) {  }
}

function initCustomTheme() {
    const s = loadCustomThemeSettings();
    applyCustomTheme(s);

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    setVal('ct-font-scale', Math.round((s.fontScale || 1) * 100));
    const scaleLabel = document.getElementById('ct-font-scale-label');
    if (scaleLabel) scaleLabel.textContent = Math.round((s.fontScale || 1) * 100) +'%';
    setChecked('ct-accent-use-theme', !s.accent);
    setVal('ct-accent-color', s.accent || '#2563eb');
    setVal('ct-card-style', s.card);
    setVal('ct-radius', s.radius);
    setVal('ct-border', s.border);
    setVal('ct-header-style', s.header);
    setVal('ct-density', s.density);
    setVal('ct-row-height', s.rowHeight);
    setVal('ct-row-padding', s.rowPadding);
    const rowPadLabel = document.getElementById('ct-row-padding-label');
    if (rowPadLabel) rowPadLabel.textContent = (s.rowPadding || CT_ROW_PAD_BASE) +'px';
    const rowPadGroup = document.getElementById('ct-row-padding-group');
    if (rowPadGroup) rowPadGroup.style.display = (s.rowHeight ==='custom') ?'' :'none';
    setChecked('ct-reduced-motion', s.motion ==='reduced');
    setChecked('ct-high-contrast', s.contrast ==='high');
}

function onCustomThemeChange() {
    const fontScaleEl = document.getElementById('ct-font-scale');
    const fontScale = fontScaleEl ? (parseInt(fontScaleEl.value, 10) || 100) / 100 : 1;
    const scaleLabel = document.getElementById('ct-font-scale-label');
    if (scaleLabel) scaleLabel.textContent = Math.round(fontScale * 100) +'%';

    const useThemeAccent = document.getElementById('ct-accent-use-theme');
    const accentInput = document.getElementById('ct-accent-color');
    const accent = (useThemeAccent && useThemeAccent.checked) ? null : (accentInput ? accentInput.value : null);

    const getVal = (id, fallback) => { const el = document.getElementById(id); return el ? el.value : fallback; };
    const getChecked = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

    const settings = {
        fontScale,
        accent,
        accentHover: accent ? ctShade(accent, -0.12) : null,
        accentSoft: accent ? ctRgba(accent, 0.16) : null,
        card: getVal('ct-card-style', CT_DEFAULTS.card),
        radius: getVal('ct-radius', CT_DEFAULTS.radius),
        border: getVal('ct-border', CT_DEFAULTS.border),
        header: getVal('ct-header-style', CT_DEFAULTS.header),
        density: getVal('ct-density', CT_DEFAULTS.density),
        rowHeight: getVal('ct-row-height', CT_DEFAULTS.rowHeight),
        rowPadding: parseInt(getVal('ct-row-padding', CT_DEFAULTS.rowPadding), 10) || CT_DEFAULTS.rowPadding,
        motion: getChecked('ct-reduced-motion') ?'reduced' :'normal',
        contrast: getChecked('ct-high-contrast') ?'high' :'normal'
    };

    const rowPadLabel = document.getElementById('ct-row-padding-label');
    if (rowPadLabel) rowPadLabel.textContent = settings.rowPadding +'px';
    const rowPadGroup = document.getElementById('ct-row-padding-group');
    if (rowPadGroup) rowPadGroup.style.display = (settings.rowHeight ==='custom') ?'' :'none';

    applyCustomTheme(settings);
    saveCustomThemeSettings(settings);
}

function resetCustomTheme() {
    try { localStorage.removeItem(CT_STORAGE_KEY); } catch (e) {  }
    applyCustomTheme(CT_DEFAULTS);
    initCustomTheme();
    if (typeof Swal !=='undefined') {
        Swal.fire({ title:'Reset na', text:'Bumalik sa default appearance ang device na ito.', icon:'success', timer: 1800, showConfirmButton: false });
    }
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

    const confirmData = await showModernOtpModal({
        subtitle: `We sent a 6-digit code to verify <strong>${theme.name}</strong>.`,
        confirmButtonText: 'Verify Code',
        verifyFn: async ({ otp }) => {
            const confirmRes = await authFetch('/api/themes/confirm-unlock', {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ themeId: theme.id, otp, username: requestingUsername })
            });
            return confirmRes.json();
        }
    });
    if (!confirmData) return;

    try {
        if (!confirmData.success) {
            // Inline retry feedback already handled this — no extra popup.
            return;
        }

        if (Array.isArray(confirmData.unlockedThemeIds)) {
            localStorage.setItem('omnipos_unlocked_themes_cache', JSON.stringify(confirmData.unlockedThemeIds));
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
        console.warn('Could not fetch feature unlock status from the server.', e);
    }
    updateSidebarFeatureLocks();
    return unlockedFeatureIdsCache || [];
}

function isFeatureUnlockedCached(featureId) {
    return Array.isArray(unlockedFeatureIdsCache) && unlockedFeatureIdsCache.includes(featureId);
}

const SIDEBAR_FEATURE_LOCK_MAP = {
'menu-customers-lock':'customer_crm',
'menu-debts-lock':'customer_crm',
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
    updateCloudBackupLockState();
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

// Cloud Backup is no longer a simple one-time price — it's a
// subscription now (Basic/Standard/Pro, Monthly/Yearly). This mirrors
// OMNIPOS/server.js CLOUD_BACKUP_PLANS; the server still makes the
// final call on the ACTUAL price (ground truth), this is for display only.
const CLOUD_BACKUP_PLANS_UI = {
    basic: { name:'Basic', tagline:'Once-a-day backup, 30-day history.', price: { monthly: 129, yearly: 1290 } },
    standard: { name:'Standard', tagline:'Every 6 hours, 90-day history, priority restore.', price: { monthly: 249, yearly: 2490 } },
    pro: { name:'Pro', tagline:'Near real-time (hourly), 365-day history, Multi-Branch included, priority support.', price: { monthly: 399, yearly: 3990 } }
};

function guardPremiumFeature(featureId) {
    if (isFeatureUnlockedCached(featureId)) return false;
    const info = PREMIUM_FEATURE_INFO[featureId] || {};
    promptUnlockFeature(featureId, info.name, info.price, info.description);
    return true;
}

function getCloudBackupUpgrade() {
    if (isFeatureUnlockedCached('cloud_backup')) return false;
    return promptCloudBackupSubscription();
}

function updateCloudBackupLockState() {
    const unlocked = isFeatureUnlockedCached('cloud_backup');
    const getBtn = document.getElementById('cloud-backup-get-btn');
    const syncBtn = document.getElementById('cloud-backup-sync-btn');
    const restoreBtn = document.getElementById('cloud-backup-restore-btn');
    if (getBtn) getBtn.style.display = unlocked ? 'none' : 'flex';
    if (syncBtn) syncBtn.style.display = unlocked ? 'flex' : 'none';
    if (restoreBtn) restoreBtn.style.display = unlocked ? 'flex' : 'none';
    if (unlocked) refreshCloudBackupSubscriptionBadge();
}

// --------------------------------------------------------------
// refreshCloudBackupSubscriptionBadge — once Cloud Backup is unlocked,
// this shows in the status box WHICH plan (Basic/Standard/Pro) and
// billing cycle is active, and WHEN it will expire (or "Lifetime" for
// a legacy one-time buyer from before).
// --------------------------------------------------------------
async function refreshCloudBackupSubscriptionBadge() {
    const statusBox = document.getElementById('cloud-backup-status');
    if (!statusBox) return;
    try {
        const res = await authFetch(`${API_URL}/cloud-backup/status`);
        const data = await res.json();
        const sub = data && data.subscription;
        if (!sub || !sub.active) return;

        if (sub.isLegacyLifetime) {
            statusBox.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#16a34a;"></i> Cloud Backup: Lifetime (one-time purchase — no renewal needed).';
            return;
        }

        const planInfo = CLOUD_BACKUP_PLANS_UI[sub.tier] || CLOUD_BACKUP_PLANS_UI.basic;
        const cycleLabel = sub.billingCycle === 'yearly' ? 'Yearly' : 'Monthly';
        let expiryText = '';
        if (sub.expiresAt) {
            const daysLeft = Math.ceil((sub.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
            const expiryDate = new Date(sub.expiresAt).toLocaleDateString();
            expiryText = daysLeft <= 7
                ? ` — <span style="color:#dc2626;font-weight:600;">renews/expires in ${daysLeft} day(s) (${expiryDate})</span>`
                : ` — renews/expires on ${expiryDate}`;
        }
        statusBox.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#16a34a;"></i> Cloud Backup: <strong>${planInfo.name}</strong> (${cycleLabel})${expiryText}`;
    } catch (err) {
        // Silently ignore — this isn't critical, it's display only.
    }
}

async function captureQuickPhoto() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240, facingMode: { ideal: 'user' } },
            audio: false
        });
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        await new Promise(r => setTimeout(r, 350));
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        canvas.getContext('2d').drawImage(video, 0, 0, 320, 240);
        stream.getTracks().forEach(t => t.stop());
        return canvas.toDataURL('image/jpeg', 0.6);
    } catch (err) {
        return null;
    }
}

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
                        if (data.pending) continue;
                        stopped = true;
                        Swal.close();
                        resolve(data);
                        return;
                    } catch (e) {

                    }
                }
            },
        }).then((result) => {
            if (!stopped && result.dismiss === Swal.DismissReason.cancel) {
                stopped = true;
                resolve({ success: false, cancelled: true, message: 'Waiting cancelled.' });
            }
        });
    });
}

async function promptUnlockFeature(featureId, featureName, price, description) {
    if (blockIfOffline('Feature unlock requests')) return false;
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

    return runUnlockFlow(featureId, displayName, {});
}

// --------------------------------------------------------------
// runUnlockFlow — the ONE shared "photo -> request-unlock -> OTP ->
// confirm-unlock" flow, used by TWO callers: (1) promptUnlockFeature
// (regular one-time features, no extra body) and (2)
// promptCloudBackupSubscription (with extra { tier, billingCycle }
// included in the request/confirm body).
// --------------------------------------------------------------
async function runUnlockFlow(featureId, displayName, extraRequestBody) {
    const requestingUsername = (currentUser && (currentUser.username || currentUser.name)) ||'Unknown';
    const photo = await captureQuickPhoto();

    try {
        const reqRes = await authFetch(`${API_URL}/features/request-unlock`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ featureId, username: requestingUsername, photo, ...extraRequestBody })
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

    let confirmData = await showModernOtpModal({
        subtitle: `We sent a 6-digit code to verify <strong>${displayName}</strong>.`,
        confirmButtonText: 'Verify Code',
        verifyFn: async ({ otp }) => {
            const confirmRes = await authFetch(`${API_URL}/features/confirm-unlock`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ featureId, otp, username: requestingUsername, ...extraRequestBody })
            });
            return confirmRes.json();
        }
    });
    if (!confirmData) return false;

    try {
        if (confirmData.pending) {
            confirmData = await pollUntilApproved(`${API_URL}/features/confirm-unlock`, { featureId, otp: confirmData.otp, username: requestingUsername, ...extraRequestBody });
        }

        if (confirmData.cancelled) return false;

        if (!confirmData.success) {
            // Inline retry feedback already handled this — no extra popup.
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

// --------------------------------------------------------------
// promptCloudBackupSubscription — Basic/Standard/Pro x Monthly/Yearly
// plan picker for the Cloud Backup subscription (no longer a simple
// "one-time ₱1,499" button). It still follows the same OTP
// verification flow (runUnlockFlow) after a plan is chosen.
// --------------------------------------------------------------
async function promptCloudBackupSubscription() {
    if (blockIfOffline('Cloud Backup subscription')) return false;

    let selectedTier = 'standard';
    let selectedCycle = 'monthly';

    const tierKeys = Object.keys(CLOUD_BACKUP_PLANS_UI);

    const buildHtml = () => {
        const tierButtons = tierKeys.map(key => {
            const plan = CLOUD_BACKUP_PLANS_UI[key];
            const active = key === selectedTier;
            return `<button type="button" class="cb-tier-btn" data-tier="${key}" style="flex:1;text-align:left;border:2px solid ${active ? '#2563eb' : '#e2e8f0'};background:${active ? '#eff6ff' : '#fff'};border-radius:10px;padding:10px 12px;cursor:pointer;margin:0 4px;">` +
                `<div style="font-weight:700;font-size:0.9rem;color:#0f172a;">${plan.name}</div>` +
                `<div style="font-size:0.72rem;color:#64748b;margin-top:2px;">${plan.tagline}</div>` +
                `<div style="font-size:0.95rem;font-weight:700;color:#2563eb;margin-top:6px;">₱${plan.price[selectedCycle]}<span style="font-size:0.68rem;color:#94a3b8;font-weight:400;"> / ${selectedCycle === 'monthly' ? 'month' : 'year'}</span></div>` +
                `</button>`;
        }).join('');

        const cycleButtons = ['monthly','yearly'].map(cycle => {
            const active = cycle === selectedCycle;
            return `<button type="button" class="cb-cycle-btn" data-cycle="${cycle}" style="flex:1;border:2px solid ${active ? '#2563eb' : '#e2e8f0'};background:${active ? '#eff6ff' : '#fff'};border-radius:8px;padding:6px;cursor:pointer;margin:0 4px;font-size:0.82rem;font-weight:600;color:${active ? '#2563eb' : '#334155'};">${cycle === 'monthly' ? 'Monthly' : 'Yearly (2 months free)'}</button>`;
        }).join('');

        return `<div style="text-align:left;">
            <p style="font-size:0.8rem;color:#64748b;margin:0 0 10px;">Cloud Backup is now a subscription. Pick a plan and billing cycle:</p>
            <div style="display:flex;margin-bottom:10px;">${cycleButtons}</div>
            <div style="display:flex;">${tierButtons}</div>
        </div>`;
    };

    const result = await Swal.fire({
        title: 'Cloud Backup Plans',
        html: buildHtml(),
        showCancelButton: true,
        confirmButtonText: 'Send Request',
        cancelButtonText: 'Close',
        confirmButtonColor: '#2563eb',
        didOpen: (popup) => {
            const rerender = () => { popup.querySelector('.swal2-html-container').innerHTML = buildHtml(); attachHandlers(); };
            const attachHandlers = () => {
                popup.querySelectorAll('.cb-tier-btn').forEach(btn => {
                    btn.addEventListener('click', () => { selectedTier = btn.dataset.tier; rerender(); });
                });
                popup.querySelectorAll('.cb-cycle-btn').forEach(btn => {
                    btn.addEventListener('click', () => { selectedCycle = btn.dataset.cycle; rerender(); });
                });
            };
            attachHandlers();
        }
    });

    if (!result.isConfirmed) return false;

    const planName = `Cloud Backup — ${CLOUD_BACKUP_PLANS_UI[selectedTier].name} (${selectedCycle === 'monthly' ? 'Monthly' : 'Yearly'})`;
    return runUnlockFlow('cloud_backup', planName, { tier: selectedTier, billingCycle: selectedCycle });
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
        Swal.fire('Unlocked!','All available features are now unlocked on this installation.','success');
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
                ? `<div style="font-size:0.72rem;color:#94a3b8;margin-top:2px;">Price for the remaining locked features only (you already purchased some separately)</div>`
                :'') +
            (t.alaCartePrice > effectivePrice
                ? `<div style="font-size:0.72rem;color:#16a34a;margin-top:2px;">Save ₱${t.alaCartePrice - effectivePrice} vs à la carte</div>`
                :'') +
        `</button>`
        );
    }).join('');

    const ALA_CARTE_CATEGORY_LABELS = { module:'Modules', 'cloud-service':'Cloud Service', theme:'Pro Themes' };
    const ALA_CARTE_CATEGORY_ORDER = ['module','cloud-service','theme'];

    const featuresByCategory = {};
    features.forEach(f => {
        const cat = f.category ||'module';
        if (!featuresByCategory[cat]) featuresByCategory[cat] = [];
        featuresByCategory[cat].push(f);
    });

    const alaCarteHtml = ALA_CARTE_CATEGORY_ORDER
        .filter(cat => featuresByCategory[cat] && featuresByCategory[cat].length)
        .map(cat => {
            const items = featuresByCategory[cat];
            const rowsHtml = items.map(f => (
                `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:0.85rem;cursor:pointer;">` +
                    `<input type="checkbox" class="uw-feature-check" data-feature-id="${f.id}" style="width:16px;height:16px;flex-shrink:0;margin-top:2px;">` +
                    `<span style="flex:1;">` +
                        `<span style="display:block;">${escapeHtml(f.name)}</span>` +
                        (f.description ? `<span style="display:block;font-size:0.72rem;color:#94a3b8;margin-top:2px;line-height:1.4;">${escapeHtml(f.description)}</span>` :'') +
                    `</span>` +
                    `<span style="color:#64748b;flex-shrink:0;">₱${f.price}</span>` +
                `</label>`
            )).join('');
            return (
                `<details class="uw-category-group" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;overflow:hidden;background:#fff;">` +
                    `<summary style="cursor:pointer;padding:9px 12px;font-weight:600;font-size:0.82rem;color:#334155;background:#f8fafc;display:flex;justify-content:space-between;align-items:center;">` +
                        `<span>${escapeHtml(ALA_CARTE_CATEGORY_LABELS[cat] || cat)}</span>` +
                        `<span style="font-size:0.72rem;color:#94a3b8;font-weight:500;">${items.length} item${items.length > 1 ?'s' :''}</span>` +
                    `</summary>` +
                    `<div>${rowsHtml}</div>` +
                `</details>`
            );
        }).join('');

    const result = await Swal.fire({
        title:'✨ Upgrade Options',
        width: 480,
        html:
            `<div style="text-align:left;max-height:60vh;overflow-y:auto;">` +
                `<p style="font-size:0.8rem;color:#94a3b8;margin:0 0 10px;">Select a complete package below, or build a custom selection à la carte. Click "Upgrade Now" once you're ready — it applies automatically to whichever option you choose.</p>` +
                `<div style="font-weight:600;font-size:0.82rem;margin-bottom:6px;color:#334155;">Complete Packages</div>` +
                `<div id="uw-tier-list">${tierCardsHtml}</div>` +
                `<div style="font-weight:600;font-size:0.82rem;margin:14px 0 4px;color:#334155;">Or Select Individual Features</div>` +
                `<p style="font-size:0.72rem;color:#94a3b8;margin:0 0 8px;line-height:1.4;">Individual selections are billed at full à la carte price. Bundle discounts apply only to the complete packages above, since a custom, feature-by-feature selection is not a package purchase.</p>` +
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
                Swal.showValidationMessage('Please select a package or at least one feature first.');
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
            Swal.fire('Already Unlocked!','All selected items are now unlocked.','success');
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

    let confirmData = await showModernOtpModal({
        subtitle: `We sent a 6-digit code to verify <strong>${featureIds.length} feature(s)</strong>.`,
        confirmButtonText: 'Verify Code',
        verifyFn: async ({ otp }) => {
            const confirmRes = await authFetch(`${API_URL}/features/confirm-unlock-bulk`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ featureIds, otp, username: requestingUsername })
            });
            return confirmRes.json();
        }
    });
    if (!confirmData) return false;

    try {
        if (confirmData.pending) {
            confirmData = await pollUntilApproved(`${API_URL}/features/confirm-unlock-bulk`, { featureIds, otp: confirmData.otp, username: requestingUsername });
        }

        if (confirmData.cancelled) return false;

        if (!confirmData.success) {
            // Inline retry feedback already handled this — no extra popup.
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
            `<button id="demo-float-end-btn" type="button" class="demo-float-end-btn" title="End Demo Mode now">✕</button>`;
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

    const activeUser = JSON.parse(localStorage.getItem('omnipos_user') ||'null');
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

function handleDemoExpired() {
    const existing = document.getElementById('demo-mode-banner-container');
    if (existing) existing.style.display ='none';

    if (window.Swal && typeof Swal.fire ==='function') {
        Swal.fire({
            toast: true,
            position:'top-end',
            icon:'info',
            title:'Demo Mode Ended',
            text:'Refreshing the system...',
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
        console.warn('Could not fetch demo status.', e);
    }
}

async function endDemoModeManually() {
    const confirmResult = await Swal.fire({
        title:'End Demo Mode?',
        text:'This will immediately revert all premium features that were opened for the demo back to their locked state. This cannot be undone.',
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
            Swal.fire('Not Completed', data.message ||'There was a problem ending Demo Mode.','error');
            return;
        }
        if (Array.isArray(data.unlockedFeatureIds)) {
            unlockedFeatureIdsCache = data.unlockedFeatureIds;
        }
        updateSidebarFeatureLocks();
        await initDemoModeUI();
        Swal.fire('Demo Mode Ended','The locked state has been restored.','success');
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function promptDemoMode() {
    if (blockIfOffline('Demo Mode activation requests')) return false;
    const requestingUsername = (currentUser && (currentUser.username || currentUser.name)) ||'Unknown';

    const confirmResult = await Swal.fire({
        title:'✨ Try Full Demo Mode',
        html:
'<p style="margin:0 0 8px;">ALL premium features will be temporarily unlocked (nothing stays locked) — but only for a TIME LIMIT.</p>' +
'<p style="font-size:0.82rem;color:#94a3b8;margin:0;">An activation request will be sent to the developer/store owner. Once approved, you will be given a 6-digit code to activate it.</p>',
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
            Swal.fire('Active!','Demo Mode is now active.','success');
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

    let confirmData = await showModernOtpModal({
        subtitle: 'We sent a 6-digit code to verify <strong>Demo Mode</strong>.',
        confirmButtonText: 'Verify Code',
        verifyFn: async ({ otp }) => {
            const confirmRes = await authFetch(`${API_URL}/features/confirm-demo`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ otp, username: requestingUsername })
            });
            return confirmRes.json();
        }
    });
    if (!confirmData) return false;

    try {
        if (confirmData.pending) {
            confirmData = await pollUntilApproved(`${API_URL}/features/confirm-demo`, { otp: confirmData.otp, username: requestingUsername });
        }

        if (confirmData.cancelled) return false;

        if (!confirmData.success) {
            // Inline retry feedback already handled this — no extra popup.
            return false;
        }

        if (Array.isArray(confirmData.unlockedFeatureIds)) {
            unlockedFeatureIdsCache = confirmData.unlockedFeatureIds;
        }
        updateSidebarFeatureLocks();
        await initDemoModeUI();
        Swal.fire('Demo Mode Activated!','All features are now open — this is temporary only, with a time limit.','success');
        return true;
    } catch (e) {
        Swal.fire('Error','Could not reach the server to complete verification.','error');
        return false;
    }
}

document.addEventListener("DOMContentLoaded", () => {

    setupDropdownHandlers();
    initDarkMode();
    initDynamicThemeColor();
    initCustomTheme();
    refreshUnlockedThemesFromServer();
    refreshUnlockedFeaturesFromServer();
    renderTerminalThemeMenu();
    updateTerminalThemesMenuVisibility();
    if (sessionStorage.getItem('currentView') ==='terminal' && typeof applySavedTerminalExtraTheme ==='function') {
        applySavedTerminalExtraTheme();
    }
    if (sessionStorage.getItem('currentView') ==='terminal' && typeof relocateTerminalSearchForMobile ==='function') {
        relocateTerminalSearchForMobile();
    }
    window.addEventListener('resize', () => {
        if (sessionStorage.getItem('currentView') ==='terminal' && typeof relocateTerminalSearchForMobile ==='function') {
            relocateTerminalSearchForMobile();
        }
    });
    initDemoModeUI();
    initNetworkStatusIndicator();
    initInstallAppBanner();
    initAuthDeviceScaling();
    initFullscreenToggleButton();
    initHeaderDoubleTapFullscreen();

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
        showMainSystemInterface().catch(err => {
            console.error('Unexpected error while restoring session after reload (showMainSystemInterface):', err);
        });
    } else {
        showAuthenticationInterface();
    }

});

async function guardShiftReportAccess(isAdminOrSupervisor) {

    const token = localStorage.getItem('omnipos_token');
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

    document.documentElement.removeAttribute('data-preload-view');

    if (viewKey !=='users' && typeof closeGoogleAppVerificationFloatingBox ==='function') {
        closeGoogleAppVerificationFloatingBox();
    }

    if (typeof closeHeaderUserMenu ==='function') closeHeaderUserMenu();

    if (typeof closeUserWidgetMenu ==='function') closeUserWidgetMenu();
    if (typeof closeAllSidebarMenuDropdowns ==='function') closeAllSidebarMenuDropdowns();
    if (typeof closeAllResetRestoreCards ==='function') closeAllResetRestoreCards();

    const activeUser = JSON.parse(localStorage.getItem('omnipos_user') ||'null');
    const userRole = (activeUser && activeUser.role ||'').toLowerCase();
    const isAdmin = userRole ==='admin';
    if (!isAdmin && Object.prototype.hasOwnProperty.call(currentPermissions || {}, viewKey) && !currentPermissions[viewKey]) {
        console.warn(`[OmniPOS] Access denied to view "${viewKey}" for role "${userRole ||'unknown'}"`);
        // Dynamic fallback: don't blindly send the user to "overview" — that
        // view is itself permission-gated (see MENU_REGISTRY 'overview' key).
        // Prefer Terminal (the one screen every selling role needs), then
        // Overview, then just leave the requested view up to render an
        // empty/blocked state rather than looping back to something also
        // denied (e.g. a Cashier locked to Terminal only).
        if (currentPermissions && currentPermissions.terminal) {
            viewKey ='terminal';
        } else if (currentPermissions && currentPermissions.overview) {
            viewKey ='overview';
        }
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

    if (viewKey !=='terminal') {
        const terminalViewEl = document.getElementById('view-terminal');
        if (terminalViewEl) terminalViewEl.classList.remove('cart-drawer-expanded');
        document.body.classList.remove('cart-drawer-scroll-lock');
        const drawerBtn = document.getElementById('btn-cart-drawer-toggle');
        if (drawerBtn) drawerBtn.classList.remove('active');
    }

    const targetView = document.getElementById(`view-${viewKey}`);

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

    if (viewKey ==='users' && typeof centerActiveUserTab ==='function') { centerActiveUserTab(); }

    if (viewKey ==='terminal') {
        applySavedTerminalDayMode();
        if (typeof applySavedTerminalExtraTheme ==='function') applySavedTerminalExtraTheme();
        if (typeof relocateTerminalSearchForMobile ==='function') relocateTerminalSearchForMobile();
    } else {
        document.body.classList.remove('terminal-modal-daymode');
        document.body.removeAttribute('data-terminal-theme');
    }
    if (typeof updateHeaderDayDarkModeUI ==='function') updateHeaderDayDarkModeUI();
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
    if (viewKey ==='users') { loadUsersTable(); loadPendingRequestsTable(); loadRolesPermissionMatrix(); loadFraudAlertsTable(); updateUsersTabVisibility(); }
    if (viewKey ==='logs') loadSystemAuditLogs();
    if (viewKey ==='customers') loadCustomersView();
    if (viewKey ==='debts') { loadDebtsView(); startDebtsCountdownRefresh(); } else { stopDebtsCountdownRefresh(); }
    if (viewKey ==='shiftreport') loadShiftReportView();
    if (viewKey ==='reorder') loadReorderView();
    sessionStorage.setItem('currentView', viewKey);
    if (typeof updateTerminalThemesMenuVisibility ==='function') updateTerminalThemesMenuVisibility();

    if (typeof syncColorSchemeDeclaration ==='function') syncColorSchemeDeclaration();

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
    debts:        { text:'Debtors',             hideIds: ['page-title-debts'] },
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

let _rrOpenCardOrder = [];

function toggleResetRestoreCard(headerEl) {
    const card = headerEl.closest('.rr-card');
    if (!card) return;
    const cardId = card.getAttribute('data-rr-card');

    if (card.classList.contains('rr-open')) {

        card.classList.remove('rr-open');
        _rrOpenCardOrder = _rrOpenCardOrder.filter(id => id !== cardId);
        return;
    }

    card.classList.add('rr-open');
    _rrOpenCardOrder.push(cardId);

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
        console.warn('Could not fetch customers:', e);
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
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">No customers found.</td></tr>`;
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
                <div class="action-icon-btns-row">
                    <button class="btn-icon-action" onclick="openLoyaltyCardManageModal('${escapeHtml(c.id)}')" title="${c.loyaltyCard && !c.loyaltyCard.revoked ?'Manage Loyalty Card/QR' :'Issue Loyalty Card/QR'}" style="color:${c.loyaltyCard && !c.loyaltyCard.revoked ?'#22c55e':'#94a3b8'};"><i class="fa-solid fa-qrcode"></i></button>
                    <button class="btn-icon-action edit" onclick="openEditCustomerForm('${escapeHtml(c.id)}')" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="btn-icon-action delete" onclick="deleteCustomerConfirm('${escapeHtml(c.id)}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function openAddCustomerForm() {
    const { value: formValues } = await Swal.fire({
        title:'Add Customer',
        html: `
            <input type="text" id="swal-cust-name" class="swal2-input" placeholder="Full Name">
            <input type="text" id="swal-cust-phone" class="swal2-input" placeholder="Phone Number (optional)">
            <input type="email" id="swal-cust-email" class="swal2-input" placeholder="Email (optional)">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText:'Save Customer',
        preConfirm: () => {
            const name = document.getElementById('swal-cust-name').value.trim();
            if (!name) {
                Swal.showValidationMessage('Name is required.');
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
            Swal.fire({ icon:'success', title:'Customer Added!', timer: 1300, showConfirmButton: false });
            loadCustomersView();
        } else {
            Swal.fire('Error', data.message ||'Could not save the customer.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
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
            Swal.fire({ icon:'success', title:'Updated!', timer: 1200, showConfirmButton: false });
            loadCustomersView();
        } else {
            Swal.fire('Error', data.message ||'Could not update.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function deleteCustomerConfirm(id) {
    const cust = globalCustomers.find(c => c.id === id);
    const result = await Swal.fire({
        title: `Delete ${cust ? cust.name :'this customer'}?`,
        text:'This action cannot be undone.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Yes, delete'
    });
    if (!result.isConfirmed) return;

    try {
        const res = await authFetch(`${API_URL}/customers/${encodeURIComponent(id)}`, { method:'DELETE' });
        const data = await res.json();
        if (data.success) {
            loadCustomersView();
        } else {
            Swal.fire('Error', data.message ||'Could not delete.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

// ================== DEBTS / DEBTORS TRACKING ==================
let globalDebts = [];
let debtsCountdownTimer = null;

async function loadDebtsView() {
    try {
        const res = await authFetch(`${API_URL}/debts`);
        globalDebts = res.ok ? await res.json() : [];
    } catch (e) {
        console.warn('Could not fetch debts:', e);
        globalDebts = [];
    }
    renderDebtsTable();
}

// Live-computes the "time remaining" from dueAt (not stored on the
// server) — so it stays accurate no matter how long the app has been
// open. Called repeatedly by startDebtsCountdownRefresh while the
// Debts page is open.
function formatDebtDueCountdown(dueAtIso) {
    if (!dueAtIso) return { text:'No due date', overdue: false, hasDue: false };
    const dueMs = new Date(dueAtIso).getTime();
    const diffMs = dueMs - Date.now();
    const overdue = diffMs < 0;
    const absMs = Math.abs(diffMs);
    const days = Math.floor(absMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((absMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((absMs % (60 * 60 * 1000)) / (60 * 1000));

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    const durationText = parts.join(' ');

    return {
        text: overdue ? `Overdue by ${durationText}` : `${durationText} remaining`,
        overdue,
        hasDue: true
    };
}

function startDebtsCountdownRefresh() {
    stopDebtsCountdownRefresh();
    debtsCountdownTimer = setInterval(() => {
        const view = document.getElementById('view-debts');
        if (view && view.style.display !=='none') renderDebtsTable();
    }, 30000);
}

function stopDebtsCountdownRefresh() {
    if (debtsCountdownTimer) {
        clearInterval(debtsCountdownTimer);
        debtsCountdownTimer = null;
    }
}

function renderDebtsTable() {
    const tbody = document.getElementById('debts-table-body');
    if (!tbody) return;
    const searchEl = document.getElementById('debt-search-input');
    const q = (searchEl ? searchEl.value :'').trim().toLowerCase();
    const filterEl = document.getElementById('debt-status-filter');
    const statusFilter = filterEl ? filterEl.value :'all';

    let filtered = globalDebts.filter(d =>
        !q || (d.customerName ||'').toLowerCase().includes(q) || (d.phone ||'').includes(q)
    );
    filtered = filtered.filter(d => {
        if (statusFilter ==='all') return true;
        if (statusFilter ==='overdue') {
            return d.status !=='paid' && d.dueAt && new Date(d.dueAt).getTime() < Date.now();
        }
        return d.status === statusFilter;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#94a3b8;">No debt records found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(d => {
        const remaining = Math.max(0, (d.amount || 0) - (d.amountPaid || 0));
        const due = formatDebtDueCountdown(d.dueAt);
        const dueColor = d.status ==='paid' ?'#94a3b8' : (due.overdue ?'#ef4444' :'#f59e0b');
        const statusColors = { unpaid:'#ef4444', partial:'#f59e0b', paid:'#22c55e' };
        const statusLabels = { unpaid:'Unpaid', partial:'Partial', paid:'Paid' };
        return `
        <tr>
            <td>${escapeHtml(d.customerName)}${d.phone ? `<br><span style="font-size:0.8rem;color:#94a3b8;">${escapeHtml(d.phone)}</span>` :''}</td>
            <td class="num-cell">₱${(parseFloat(d.amount) || 0).toFixed(2)}</td>
            <td class="num-cell">₱${(parseFloat(d.amountPaid) || 0).toFixed(2)}</td>
            <td class="num-cell"><b>₱${remaining.toFixed(2)}</b></td>
            <td style="text-align:center;">
                <button class="btn-clear" onclick="openDebtDetailsModal('${escapeHtml(d.id)}')" style="color: var(--primary-blue); padding: 4px 8px; font-size: 0.9rem;">
                    <i class="fa-solid fa-eye"></i> View
                </button>
            </td>
            <td style="color:${dueColor};font-size:0.85rem;">
                ${d.dueAt ? new Date(d.dueAt).toLocaleString() + '<br>' :''}
                <b>${due.text}</b>
            </td>
            <td><span class="badge" style="background-color:${statusColors[d.status] ||'#94a3b8'};">${statusLabels[d.status] || d.status}</span></td>
            <td>
                <div class="action-icon-btns-row">
                    ${d.status !=='paid' ? `<button class="btn-icon-action" onclick="openRecordDebtPaymentForm('${escapeHtml(d.id)}')" title="Record a payment" style="color:#22c55e;"><i class="fa-solid fa-money-bill-wave"></i></button>` :''}
                    <button class="btn-icon-action edit" onclick="openEditDebtForm('${escapeHtml(d.id)}')" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="btn-icon-action delete" onclick="deleteDebtConfirm('${escapeHtml(d.id)}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// Compact "View" modal for a debt row — shows the Note and the linked
// products/items (from a C-Credit sale) without bloating the table row
// height. Mirrors the look of the Transactions "View Receipt" action, but
// includes a Note section since debts (unlike receipts) carry one.
function openDebtDetailsModal(id) {
    const debt = globalDebts.find(d => d.id === id);
    if (!debt) return;

    const remaining = Math.max(0, (debt.amount || 0) - (debt.amountPaid || 0));
    const statusLabels = { unpaid:'Unpaid', partial:'Partial', paid:'Paid' };
    const statusColors = { unpaid:'#ef4444', partial:'#f59e0b', paid:'#22c55e' };

    const itemsHtml = (Array.isArray(debt.items) && debt.items.length)
        ? `<div style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;">
           <table style="width:100%;min-width:360px;border-collapse:collapse;margin-top:6px;font-size:0.85rem;">
             <thead>
                 <tr style="border-bottom:1px solid #e2e8f0;">
                     <th style="text-align:left;padding:4px;white-space:nowrap;">Item</th>
                     <th style="text-align:center;padding:4px;white-space:nowrap;">Qty</th>
                     <th style="text-align:right;padding:4px;white-space:nowrap;">Price</th>
                     <th style="text-align:right;padding:4px;white-space:nowrap;">Subtotal</th>
                 </tr>
             </thead>
             <tbody>
                 ${debt.items.map(it => `
                     <tr style="border-bottom:1px solid #f1f5f9;">
                         <td style="text-align:left;padding:4px;">${escapeHtml(it.name)}</td>
                         <td style="text-align:center;padding:4px;white-space:nowrap;">${parseInt(it.quantity) || 0}</td>
                         <td style="text-align:right;padding:4px;white-space:nowrap;">₱${(parseFloat(it.price) || 0).toFixed(2)}</td>
                         <td style="text-align:right;padding:4px;white-space:nowrap;">₱${((parseFloat(it.price) || 0) * (parseInt(it.quantity) || 0)).toFixed(2)}</td>
                     </tr>
                 `).join('')}
             </tbody>
           </table>
           </div>`
        : `<p style="color:#94a3b8;font-size:0.85rem;margin-top:6px;">No linked products for this debt.</p>`;

    Swal.fire({
        title: `Debt Details — ${escapeHtml(debt.customerName)}`,
        html: `
            <div style="text-align:left;font-size:0.9rem;">
                <p style="margin:2px 0;"><b>Phone:</b> ${escapeHtml(debt.phone || 'None')}</p>
                <p style="margin:2px 0;"><b>Amount Owed:</b> ₱${(parseFloat(debt.amount) || 0).toFixed(2)}</p>
                <p style="margin:2px 0;"><b>Paid:</b> ₱${(parseFloat(debt.amountPaid) || 0).toFixed(2)}</p>
                <p style="margin:2px 0;"><b>Remaining:</b> ₱${remaining.toFixed(2)}</p>
                <p style="margin:2px 0;"><b>Status:</b> <span class="badge" style="background-color:${statusColors[debt.status] || '#94a3b8'};">${statusLabels[debt.status] || debt.status}</span></p>
                <p style="margin:2px 0;"><b>Due:</b> ${debt.dueAt ? new Date(debt.dueAt).toLocaleString() : 'No due date set'}</p>
                ${debt.transactionId ? `<p style="margin:2px 0;"><b>Linked Transaction:</b> ${escapeHtml(debt.transactionId)}</p>` :''}
                <p style="margin:12px 0 2px;"><b>Note:</b></p>
                <p style="margin:2px 0;color:#475569;white-space:pre-wrap;">${escapeHtml(debt.note || 'No note provided.')}</p>
                <p style="margin:12px 0 2px;"><b>Items Purchased:</b></p>
                ${itemsHtml}
            </div>
        `,
        width: 480,
        confirmButtonText:'Close'
    });
}

async function openAddDebtForm() {
    const { value: formValues } = await Swal.fire({
        title:'Add Debt',
        html: `
            <input type="text" id="swal-debt-name" class="swal2-input" placeholder="Debtor's Full Name">
            <input type="text" id="swal-debt-phone" class="swal2-input" placeholder="Phone Number (optional)">
            <input type="number" id="swal-debt-amount" class="swal2-input" placeholder="Amount Owed (₱)" min="0.01" step="0.01">
            <textarea id="swal-debt-note" class="swal2-textarea" placeholder="Note (e.g. reason, when borrowed, etc.)"></textarea>
            <label style="display:block;text-align:left;font-size:0.85rem;color:#94a3b8;margin-top:6px;">Due Date/Time (when payment is due):</label>
            <input type="datetime-local" id="swal-debt-due" class="swal2-input">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText:'Save',
        preConfirm: () => {
            const name = document.getElementById('swal-debt-name').value.trim();
            const amount = document.getElementById('swal-debt-amount').value;
            if (!name) {
                Swal.showValidationMessage('Name is required.');
                return false;
            }
            if (!amount || parseFloat(amount) <= 0) {
                Swal.showValidationMessage('A valid amount is required.');
                return false;
            }
            return {
                customerName: name,
                phone: document.getElementById('swal-debt-phone').value.trim(),
                amount: parseFloat(amount),
                note: document.getElementById('swal-debt-note').value.trim(),
                dueAt: document.getElementById('swal-debt-due').value || null
            };
        }
    });
    if (!formValues) return;

    try {
        const res = await authFetch(`${API_URL}/debts`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(formValues)
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'Debt added!', timer: 1300, showConfirmButton: false });
            loadDebtsView();
        } else {
            Swal.fire('Error', data.message ||'Could not save the debt.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function openEditDebtForm(id) {
    const debt = globalDebts.find(d => d.id === id);
    if (!debt) return;

    const dueLocalValue = debt.dueAt
        ? new Date(new Date(debt.dueAt).getTime() - new Date(debt.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        :'';

    const { value: formValues } = await Swal.fire({
        title:'Edit Debt',
        html: `
            <input type="text" id="swal-debt-name" class="swal2-input" placeholder="Full Name" value="${escapeHtml(debt.customerName)}">
            <input type="text" id="swal-debt-phone" class="swal2-input" placeholder="Phone Number" value="${escapeHtml(debt.phone ||'')}">
            <input type="number" id="swal-debt-amount" class="swal2-input" placeholder="Amount Owed (₱)" min="0.01" step="0.01" value="${debt.amount}">
            <textarea id="swal-debt-note" class="swal2-textarea" placeholder="Note">${escapeHtml(debt.note ||'')}</textarea>
            <label style="display:block;text-align:left;font-size:0.85rem;color:#94a3b8;margin-top:6px;">Due Date/Time:</label>
            <input type="datetime-local" id="swal-debt-due" class="swal2-input" value="${dueLocalValue}">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText:'Update',
        preConfirm: () => {
            const amount = document.getElementById('swal-debt-amount').value;
            if (!amount || parseFloat(amount) <= 0) {
                Swal.showValidationMessage('A valid amount is required.');
                return false;
            }
            return {
                customerName: document.getElementById('swal-debt-name').value.trim(),
                phone: document.getElementById('swal-debt-phone').value.trim(),
                amount: parseFloat(amount),
                note: document.getElementById('swal-debt-note').value.trim(),
                dueAt: document.getElementById('swal-debt-due').value || null
            };
        }
    });
    if (!formValues) return;

    try {
        const res = await authFetch(`${API_URL}/debts/${encodeURIComponent(id)}`, {
            method:'PUT',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify(formValues)
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'Updated!', timer: 1200, showConfirmButton: false });
            loadDebtsView();
        } else {
            Swal.fire('Error', data.message ||'Could not update.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function openRecordDebtPaymentForm(id) {
    const debt = globalDebts.find(d => d.id === id);
    if (!debt) return;
    const remaining = Math.max(0, (debt.amount || 0) - (debt.amountPaid || 0));

    const { value: paymentAmount } = await Swal.fire({
        title: `Payment — ${escapeHtml(debt.customerName)}`,
        html: `<p style="color:#94a3b8;margin-bottom:8px;">Remaining balance: <b>₱${remaining.toFixed(2)}</b></p>
               <input type="number" id="swal-debt-payment" class="swal2-input" placeholder="Amount Paid (₱)" min="0.01" step="0.01" max="${remaining}">`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText:'Record Payment',
        preConfirm: () => {
            const val = parseFloat(document.getElementById('swal-debt-payment').value);
            if (!val || val <= 0) {
                Swal.showValidationMessage('A valid amount is required.');
                return false;
            }
            return val;
        }
    });
    if (!paymentAmount) return;

    try {
        const res = await authFetch(`${API_URL}/debts/${encodeURIComponent(id)}/payment`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ amount: paymentAmount })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title: data.debt.status ==='paid' ?'Fully paid!' :'Payment recorded!', timer: 1300, showConfirmButton: false });
            loadDebtsView();
        } else {
            Swal.fire('Error', data.message ||'Could not record the payment.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function deleteDebtConfirm(id) {
    const debt = globalDebts.find(d => d.id === id);
    const result = await Swal.fire({
        title: `Delete the debt record for ${debt ? debt.customerName :'this customer'}?`,
        text:'This action cannot be undone.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Yes, delete'
    });
    if (!result.isConfirmed) return;

    try {
        const res = await authFetch(`${API_URL}/debts/${encodeURIComponent(id)}`, { method:'DELETE' });
        const data = await res.json();
        if (data.success) {
            loadDebtsView();
        } else {
            Swal.fire('Error', data.message ||'Could not delete.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

function openLoyaltyCardManageModal(customerId) {
    const cust = globalCustomers.find(c => c.id === customerId);
    if (!cust) return;
    const isAdmin = currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin';
    const canManage = isAdmin || !!(currentPermissions && currentPermissions.loyalty_card_issue);
    const card = cust.loyaltyCard;
    const statusHtml = card
        ? `<p style="margin:4px 0;">Card ID: <b>${escapeHtml(card.cardId)}</b><br>
             Mode: <b>${card.mode ==='static' ?'Static (Physical Card)' :'Rotating QR (Advanced/Auto-Refresh)'}</b><br>
             Status: <b style="color:${card.revoked ?'#ef4444':'#22c55e'};">${card.revoked ?'Revoked':'Active'}</b><br>
             Issued: ${new Date(card.issuedAt).toLocaleString()} by ${escapeHtml(card.issuedBy ||'—')}</p>`
        :`<p style="color:#94a3b8;">Wala pang naka-issue na Loyalty Card/QR ang customer na ito.</p>`;

    if (!canManage) {
        Swal.fire({
            title: `Loyalty Card — ${escapeHtml(cust.name)}`,
            html: statusHtml + `<p style="color:#f59e0b;font-size:0.85rem;">Kailangan ng "Issue/Regenerate Loyalty Card" permission para mag-issue, mag-regenerate, o mag-revoke.</p>`,
            icon:'info'
        });
        return;
    }

    Swal.fire({
        title: `Loyalty Card — ${escapeHtml(cust.name)}`,
        html: statusHtml + `
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;text-align:left;">
                <label style="font-size:0.85rem;color:#94a3b8;">New card mode (for Issue/Regenerate):</label>
                <select id="loyalty-card-mode-select" class="swal2-select" style="margin:0;">
                    <option value="rotating">Rotating QR — auto-refreshes after each redemption (recommended, most secure)</option>
                    <option value="static">Static Card — one persistent QR/card, points build up over time</option>
                </select>
            </div>
        `,
        showCancelButton: true,
        showDenyButton: !!(card && !card.revoked),
        confirmButtonText: card ?'Regenerate' :'Issue New Card/QR',
        denyButtonText:'Revoke',
        denyButtonColor:'#ef4444',
        cancelButtonText:'Close',
        preConfirm: () => document.getElementById('loyalty-card-mode-select').value
    }).then(async (result) => {
        if (result.isConfirmed) {
            await issueOrRegenerateLoyaltyCard(cust, result.value ||'rotating');
        } else if (result.isDenied) {
            await revokeLoyaltyCard(cust);
        }
    });
}

let loyaltyCardIssueInFlight = false;

async function issueOrRegenerateLoyaltyCard(cust, mode) {
    if (loyaltyCardIssueInFlight) return;
    loyaltyCardIssueInFlight = true;
    try {
        const res = await authFetch(`${API_URL}/customers/${encodeURIComponent(cust.id)}/loyalty-card`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ mode })
        });
        const data = await res.json();
        if (!data.success) {
            Swal.fire('Error', data.message || 'Could not issue the card/QR.', 'error');
            return;
        }
        loadCustomersView();
        showLoyaltyCardQrDisplay(data.token, cust.name, mode,'Print or show this to the customer right away — this is the only time this QR will be visible.');
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    } finally {
        loyaltyCardIssueInFlight = false;
    }
}

async function revokeLoyaltyCard(cust) {
    const confirmResult = await Swal.fire({
        title:'Revoke Loyalty Card/QR?',
        text: `Hindi na magagamit ang kasalukuyang card/QR ni ${cust.name} pagkatapos nito.`,
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Yes, revoke',
        confirmButtonColor:'#ef4444'
    });
    if (!confirmResult.isConfirmed) return;
    try {
        const res = await authFetch(`${API_URL}/customers/${encodeURIComponent(cust.id)}/loyalty-card/revoke`, { method:'POST' });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'Revoked', timer: 1300, showConfirmButton: false });
            loadCustomersView();
        } else {
            Swal.fire('Error', data.message ||'Could not revoke.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

function showLoyaltyCardQrDisplay(token, customerName, mode, note, hidePrintButton) {
    const containerId ='loyalty-qr-render-' + Date.now();
    Swal.fire({
        title: mode ==='static' ?'Loyalty Card QR' :'New Loyalty QR',
        html: `
            <p style="margin:2px 0 10px;font-weight:600;">${escapeHtml(customerName ||'')}</p>
            <div style="display:inline-block;background:#ffffff;padding:18px;border-radius:14px;box-shadow:0 0 0 1px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.25);">
                <div id="${containerId}" style="display:flex;justify-content:center;align-items:center;line-height:0;"></div>
            </div>
            <p style="font-size:0.8rem;color:#94a3b8;margin-top:10px;">${escapeHtml(note ||'')}</p>
        `,

        confirmButtonText: hidePrintButton ?'OK' :'Print',
        showCancelButton: !hidePrintButton,
        cancelButtonText:'Close',
        didOpen: () => {
            const el = document.getElementById(containerId);
            if (el && typeof QRCode !=='undefined') {
                new QRCode(el, {
                    text: token,
                    width: 220,
                    height: 220,
                    colorDark:'#000000',
                    colorLight:'#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
            }
        }
    }).then((result) => {
        if (result.isConfirmed && !hidePrintButton) {
            printLoyaltyCardQr(token, customerName);
        }
    });
}

function printLoyaltyCardQr(token, customerName) {
    const win = window.open('','_blank','width=420,height=520');
    if (!win) return;
    win.document.write(`
        <html><head><title>Loyalty Card — ${escapeHtml(customerName ||'')}</title></head>
        <body style="text-align:center;font-family:sans-serif;padding:20px;">
            <h3>${escapeHtml(customerName ||'')}</h3>
            <div id="print-qr"></div>
            <p style="font-size:12px;color:#666;">Loyalty Card / QR</p>
            <script src="qrcode.min.js"><\/script>
            <script>
                new QRCode(document.getElementById('print-qr'), { text: ${JSON.stringify(token)}, width: 240, height: 240 });
                window.onload = function() { setTimeout(function(){ window.print(); }, 300); };
            <\/script>
        </body></html>
    `);
    win.document.close();
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
        console.warn('Could not check beginning cash gate:', e);
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

        const activeUser = JSON.parse(localStorage.getItem('omnipos_user') ||'null');
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
        console.warn('Could not fetch list of open shifts:', e);
    }
}

function onShiftCloseTargetCashierChange() {
    const selectEl = document.getElementById('shift-close-target-cashier');
    shiftControlSelectedCashier = selectEl ? selectEl.value :'';
    loadShiftReportView();
}

async function loadShiftReportView() {

    const activeUser = JSON.parse(localStorage.getItem('omnipos_user') ||'null');
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
                    ? `<i class="fa-solid fa-user-shield"></i> You're viewing/closing the shift of <b>${escapeHtml(data.cashier)}</b> (Admin/Supervisor Control).`
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
                        :'<li style="color:#94a3b8;">No transactions yet on this open shift.</li>';
                }
            }
        }
    } catch (e) {
        console.warn('Could not fetch current shift summary:', e);
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
                            <td class="num-cell">${h.transactionCount}${h.noSalesShift ? '<br><span style="font-size:0.72rem; color:#94a3b8;">(No Sales - Handover)</span>' :''}</td>
                            <td class="num-cell">₱${(parseFloat(h.netSales) || 0).toFixed(2)}</td>
                            <td class="num-cell" title="Begin ₱${beginVal} + Cash Sales ₱${cashSalesVal} = Expected ₱${expectedVal} | Counted ₱${endVal}">${varianceCell}</td>
                        </tr>`;
                    }).join('')
                    : `<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8;">No closed shifts yet.</td></tr>`;
            }
        }
    } catch (e) {
        console.warn('Could not fetch shift history:', e);
    }
}

async function closeCurrentShift() {

    const endingCashCounted = document.getElementById('shift-ending-cash').value;
    const notes = document.getElementById('shift-close-notes').value;

    const targetCashier = shiftControlSelectedCashier ||'';

    const confirmResult = await Swal.fire({
        title:'Close Shift?',
        text: targetCashier
            ? `You are about to close "${targetCashier}"'s shift (Admin/Supervisor Control). Their new shift period will begin after this. This cannot be undone.`
            :'A new shift period will begin after this. This cannot be undone.',
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Yes, close shift'
    });
    if (!confirmResult.isConfirmed) return;

    const { value: adminPassword } = await Swal.fire({
        title:'🔒 Admin/Supervisor Password Required',
        html: targetCashier
            ? `To close "${escapeHtml(targetCashier)}"'s shift / Z-Reading, enter an Admin or authorized Supervisor/Manager password:`
            :'To close this shift / Z-Reading, enter an Admin or authorized Supervisor/Manager password:',
        input:'password',
        inputPlaceholder:'Admin/Supervisor password',
        showCancelButton: true,
        confirmButtonColor:'#2563eb',
        cancelButtonColor:'#ef4444'
    });

    if (!adminPassword || adminPassword.trim() ==="") {
        Swal.fire('Cancelled','Shift close was not authorized — no password entered.','info');
        return;
    }

    try {
        const res = await authFetch(`${API_URL}/shift/close`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ endingCashCounted, notes, targetCashier, adminPassword })
        });
        const data = await res.json();
        if (data.success) {
            let varianceMsg ='';
            if (data.shift.cashVariance !== null && data.shift.cashVariance !== undefined) {
                const v = data.shift.cashVariance;
                if (v < 0) varianceMsg = `<br><br><b style="color:#dc2626;">Cash Short: ₱${Math.abs(v).toFixed(2)}</b>`;
                else if (v > 0) varianceMsg = `<br><br><b style="color:#16a34a;">Cash Over: ₱${v.toFixed(2)}</b>`;
                else varianceMsg = `<br><br><b style="color:#16a34a;">Cash Exact — no shortage or overage.</b>`;
            }
            Swal.fire({ title:'Shift Closed!', html: `Z-Reading ID: ${data.shift.id}${varianceMsg}`, icon:'success' });
            document.getElementById('shift-beginning-cash').value ='';
            document.getElementById('shift-ending-cash').value ='';
            document.getElementById('shift-close-notes').value ='';
            loadShiftReportView();
        } else if (data.code ==='WRONG_ADMIN_PASSWORD') {
            Swal.fire('Authorization Rejected', data.message ||'Wrong Admin/Supervisor password.','error');
        } else {
            Swal.fire('Unable to Close', data.message ||'There was a problem closing the shift.','warning');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function openPromoCodesManager() {
    if (guardPremiumFeature('promo_codes')) return;
    let promos = [];
    try {
        const res = await authFetch(`${API_URL}/promocodes`);
        promos = res.ok ? await res.json() : [];
    } catch (e) {
        Swal.fire('Connection Error','Could not retrieve the promo codes.','error');
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
    `).join('') :'<p style="padding:14px;color:#94a3b8;">No promo codes yet.</p>';

    Swal.fire({
        title:'Discounts & Promo Codes',
        html: `
            <div style="max-height:280px;overflow-y:auto;margin-bottom:10px;">${rowsHtml}</div>
            <button type="button" class="swal2-confirm swal2-styled" onclick="openAddPromoCodeForm()">+ Add New Promo Code</button>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText:'Close',
        width: 460
    });
}

async function openAddPromoCodeForm() {
    const { value: formValues } = await Swal.fire({
        title:'Add Promo Code',
        html: `
            <input type="text" id="swal-promo-code" class="swal2-input" placeholder="CODE (e.g. SUMMER20)" style="text-transform:uppercase;">
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
                Swal.showValidationMessage('Code and value are required.');
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
            Swal.fire('Error', data.message ||'Could not save the promo code.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

async function deletePromoCodeConfirm(code) {
    const result = await Swal.fire({
        title: `Delete promo code "${code}"?`,
        icon:'warning',
        showCancelButton: true,
        confirmButtonText:'Yes, delete'
    });
    if (!result.isConfirmed) return;
    try {
        const res = await authFetch(`${API_URL}/promocodes/${encodeURIComponent(code)}`, { method:'DELETE' });
        const data = await res.json();
        if (data.success) {
            openPromoCodesManager();
        } else {
            Swal.fire('Error', data.message ||'Could not delete.','error');
        }
    } catch (e) {
        Swal.fire('Connection Error','Could not connect to the server.','error');
    }
}

function applySavedTerminalDayMode() {
    const terminalSection = document.getElementById('view-terminal');
    const headerEl = document.getElementById('app-top-header');
    if (!terminalSection) return;
    const isDayMode = localStorage.getItem('terminal_daymode') ==='true';
    terminalSection.classList.toggle('terminal-daymode', isDayMode);
    if (headerEl) headerEl.classList.toggle('terminal-daymode', isDayMode);
    // Modals like the Payment modal live outside #view-terminal in the DOM, so the
    // .terminal-theme.terminal-daymode scoping above never reaches them. Mirror the
    // terminal's own day/night setting onto <body> so those modals can follow it too,
    // independently of the system/store-wide Dark Mode.
    document.body.classList.toggle('terminal-modal-daymode', isDayMode);

    if (typeof updateHeaderDayDarkModeUI ==='function') updateHeaderDayDarkModeUI();
    syncColorSchemeDeclaration();
}

function toggleTerminalDayMode() {
    const terminalSection = document.getElementById('view-terminal');
    const headerEl = document.getElementById('app-top-header');
    if (!terminalSection) return;
    const isNowDayMode = !terminalSection.classList.contains('terminal-daymode');
    terminalSection.classList.toggle('terminal-daymode', isNowDayMode);
    if (headerEl) headerEl.classList.toggle('terminal-daymode', isNowDayMode);
    document.body.classList.toggle('terminal-modal-daymode', isNowDayMode);
    localStorage.setItem('terminal_daymode', isNowDayMode ?'true' :'false');
    if (typeof updateHeaderDayDarkModeUI ==='function') updateHeaderDayDarkModeUI();
    syncColorSchemeDeclaration();
}

function toggleHeaderUserMenu(event) {
    if (event) event.stopPropagation();
    const wrap = document.getElementById('header-user-menu-wrap');
    if (!wrap) return;
    const isOpen = wrap.classList.toggle('open');
    if (isOpen) {
        renderHeaderUserDropdownInfo();
        document.addEventListener('click', closeHeaderUserMenuOnOutsideClick);
    } else {
        closeHeaderSettingsSubmenu();
        document.removeEventListener('click', closeHeaderUserMenuOnOutsideClick);
    }
}

function closeHeaderUserMenuOnOutsideClick(evt) {
    const wrap = document.getElementById('header-user-menu-wrap');
    if (!wrap) return;
    if (wrap.contains(evt.target)) return;
    closeHeaderUserMenu();
}

function closeHeaderUserMenu() {
    const wrap = document.getElementById('header-user-menu-wrap');
    if (wrap) wrap.classList.remove('open');
    closeHeaderSettingsSubmenu();
    closeHeaderTerminalThemesSubmenu();
    document.removeEventListener('click', closeHeaderUserMenuOnOutsideClick);
}

function toggleHeaderSettingsSubmenu(event) {
    if (event) event.stopPropagation();
    const submenu = document.getElementById('hu-settings-submenu');
    const caret = document.getElementById('hu-settings-caret');
    if (!submenu) return;
    const isOpen = submenu.classList.toggle('open');
    if (caret) caret.classList.toggle('rotated', isOpen);
    if (isOpen) { updateHeaderDayDarkModeUI(); closeHeaderTerminalThemesSubmenu(); }
}

function closeHeaderSettingsSubmenu() {
    document.getElementById('hu-settings-submenu')?.classList.remove('open');
    document.getElementById('hu-settings-caret')?.classList.remove('rotated');
}

function toggleHeaderTerminalThemesSubmenu(event) {
    if (event) event.stopPropagation();
    const submenu = document.getElementById('hu-terminalthemes-submenu');
    const caret = document.getElementById('hu-terminalthemes-caret');
    if (!submenu) return;
    const isOpen = submenu.classList.toggle('open');
    if (caret) caret.classList.toggle('rotated', isOpen);
    if (isOpen) {
        closeHeaderSettingsSubmenu();
        refreshUnlockedThemesFromServer().then(() => renderTerminalThemeMenu());
        renderTerminalThemeMenu();
    }
}

function closeHeaderTerminalThemesSubmenu() {
    document.getElementById('hu-terminalthemes-submenu')?.classList.remove('open');
    document.getElementById('hu-terminalthemes-caret')?.classList.remove('rotated');
}

function headerToggleDayDarkMode() {
    const isTerminalView = sessionStorage.getItem('currentView') ==='terminal';
    if (isTerminalView) {
        toggleTerminalDayMode();
    } else {
        const isDay = isStoreThemeDay();
        setTheme(isDay ?'dark' :'day');
        updateHeaderDayDarkModeUI();
    }
}

function updateHeaderDayDarkModeUI() {
    const icon = document.getElementById('header-daydark-icon');
    const label = document.getElementById('header-daydark-label');
    const btn = document.getElementById('header-daydark-toggle');
    if (!icon || !label || !btn) return;
    const isTerminalView = sessionStorage.getItem('currentView') ==='terminal';

    const isDark = isTerminalView
        ? localStorage.getItem('terminal_daymode') !=='true'
        : !isStoreThemeDay();
    icon.className = isDark ?'fa-solid fa-sun' :'fa-solid fa-moon';
    label.textContent = isDark ?'Day Mode' :'Dark Mode';
    const title = isDark ?'Switch to Day Mode' :'Switch to Dark Mode';
    btn.title = title;
    btn.setAttribute('aria-label', title);
}

function toggleCustomerPane() {
    const cartPane = document.getElementById('terminal-cart-pane');
    const btn = document.getElementById('btn-customer-pane-toggle');
    if (!cartPane) return;
    const isNowExpanded = !cartPane.classList.contains('customer-pane-expanded');
    cartPane.classList.toggle('customer-pane-expanded', isNowExpanded);
    if (btn) btn.setAttribute('aria-expanded', isNowExpanded ?'true' :'false');
}

// Sa mobile view ng Terminal: kapag naka-show ang product grid/list (hindi
// naka-drawer-expand ang cart), inililipat ang search box papunta sa loob ng
// cart-checkout-sticky (sa itaas ng TOTAL row) — dahil dun palaging
// nakikita/naka-freeze ito. Kapag naka-expand ang cart drawer (Cart pane ang
// nakikita), o desktop naman ang lapad ng screen, ibinabalik ito sa orihinal
// nitong pwesto sa loob ng Product pane — walang binabago doon.
function relocateTerminalSearchForMobile() {
    const topControls = document.getElementById('terminal-top-controls');
    const slot = document.getElementById('mobile-terminal-search-slot');
    const productPane = document.getElementById('terminal-product-pane');
    const terminalSection = document.getElementById('view-terminal');
    if (!topControls || !slot || !productPane || !terminalSection) return;

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const isDrawerExpanded = terminalSection.classList.contains('cart-drawer-expanded');
    const shouldBeInSlot = isMobile && !isDrawerExpanded;

    if (shouldBeInSlot) {
        if (topControls.parentElement !== slot) slot.appendChild(topControls);
    } else if (topControls.parentElement !== productPane) {
        productPane.insertBefore(topControls, productPane.firstChild);
    }
}

function toggleCartDrawer() {
    const terminalSection = document.getElementById('view-terminal');
    const btn = document.getElementById('btn-cart-drawer-toggle');
    if (!terminalSection) return;
    const isNowExpanded = !terminalSection.classList.contains('cart-drawer-expanded');

    if (isNowExpanded) {

        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }

    terminalSection.classList.toggle('cart-drawer-expanded', isNowExpanded);
    document.body.classList.toggle('cart-drawer-scroll-lock', isNowExpanded);
    if (btn) {
        btn.classList.toggle('active', isNowExpanded);

        btn.innerHTML = isNowExpanded
            ?'<i class="fa-solid fa-bars"></i>'
            :'<i class="fa-solid fa-cart-shopping"></i>';
    }

    const isMobileDrawerView = window.matchMedia('(max-width: 768px)').matches;
    const searchInput = document.getElementById('terminal-search');
    if (searchInput) {
        searchInput.disabled = isNowExpanded && isMobileDrawerView;
        if (searchInput.disabled) searchInput.blur();
    }

    relocateTerminalSearchForMobile();
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
    document.getElementById('uw-terminalthemes-submenu')?.classList.remove('open');
    document.getElementById('uw-terminalthemes-caret')?.classList.remove('rotated');
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
        document.getElementById('uw-terminalthemes-submenu')?.classList.remove('open');
        document.getElementById('uw-terminalthemes-caret')?.classList.remove('rotated');
        closeActiveUsersSubmenu();
    }
}

let lastKnownServerNetworkAddress = null;

async function loadSidebarNetworkInfo() {
    const valueEl = document.getElementById('uw-networkinfo-value');
    if (!valueEl) return;
    try {
        const res = await authFetch(`${API_URL}/system/network-info`);
        const data = await res.json();
        if (data.success && Array.isArray(data.addresses) && data.addresses.length > 0) {
            lastKnownServerNetworkAddress = `${data.addresses[0]}:${data.port}`;
            valueEl.innerText = lastKnownServerNetworkAddress;
        } else {
            lastKnownServerNetworkAddress = null;
            valueEl.innerText ='Not available';
        }
    } catch (err) {
        lastKnownServerNetworkAddress = null;
        valueEl.innerText ='Not available';
    }
}

function copySidebarNetworkInfo(event) {
    if (event) event.stopPropagation();
    if (!lastKnownServerNetworkAddress) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastKnownServerNetworkAddress).then(() => {
            if (typeof Swal !=='undefined') {
                Swal.fire({ toast: true, position:'top-end', icon:'success', title:'Copied!', showConfirmButton: false, timer: 1200 });
            }
        }).catch(() => {});
    }
}

function showServerIpQrModal(event) {
    if (event) event.stopPropagation();
    if (!lastKnownServerNetworkAddress) {
        Swal.fire('Not Available','Wala pang na-detect na Server IP. Siguraduhing naka-LAN mode at konektado sa WiFi/LAN ang device na ito, pagkatapos subukan ulit.','warning');
        return;
    }
    const serverUrl = `http://${lastKnownServerNetworkAddress}`;
    const containerId ='server-ip-qr-render-' + Date.now();
    Swal.fire({
        title:'Server IP QR Code',
        html: `
            <p style="margin:2px 0 10px;font-weight:600;">${escapeHtml(lastKnownServerNetworkAddress)}</p>
            <div style="display:inline-block;background:#ffffff;padding:18px;border-radius:14px;box-shadow:0 0 0 1px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.25);">
                <div id="${containerId}" style="display:flex;justify-content:center;align-items:center;line-height:0;"></div>
            </div>
            <p style="font-size:0.8rem;color:#94a3b8;margin-top:10px;">I-scan gamit ang camera/QR scanner ng ibang device (PAREHONG WiFi/LAN) para direktang mabuksan ang OmniPOS.</p>
        `,
        confirmButtonText:'Close',
        showCancelButton: false,
        didOpen: () => {
            const el = document.getElementById(containerId);
            if (el && typeof QRCode !=='undefined') {
                new QRCode(el, {
                    text: serverUrl,
                    width: 220,
                    height: 220,
                    colorDark:'#000000',
                    colorLight:'#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
            }
        }
    });
}

function toggleThemesSubmenu(event) {
    if (event) event.stopPropagation();
    const submenu = document.getElementById('uw-themes-submenu');
    const caret = document.getElementById('uw-themes-caret');
    if (!submenu) return;
    const isOpen = submenu.classList.toggle('open');
    if (caret) caret.classList.toggle('rotated', isOpen);

    if (isOpen) {
        closeActiveUsersSubmenu();
        document.getElementById('uw-terminalthemes-submenu')?.classList.remove('open');
        document.getElementById('uw-terminalthemes-caret')?.classList.remove('rotated');
        refreshUnlockedThemesFromServer();
    }
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
    if (nameEl) nameEl.innerText = currentUser.displayName || currentUser.username;
    if (roleEl) roleEl.innerText = currentUser.role ||'';
    if (avatarEl) {
        avatarEl.innerHTML = (currentUser.avatar
            ? `<img src="${currentUser.avatar}" alt="">`
            : `<i class="fa-solid fa-user"></i>`)
            + `<span class="user-widget-caret"><i class="fa-solid fa-chevron-down"></i></span>`;
    }

    const headerAvatarEl = document.getElementById('header-user-avatar');
    if (headerAvatarEl) {
        headerAvatarEl.innerHTML = currentUser.avatar
            ? `<img src="${currentUser.avatar}" alt="">`
            : `<i class="fa-solid fa-user"></i>`;
    }
    renderHeaderUserDropdownInfo();
    updateActiveUsersBadge();
}

// Name/role block shown at the top of the header's account dropdown
// (#header-user-dropdown), mirroring the sidebar widget: shows the
// editable display name when the user has set one, falling back to the
// login username otherwise.
function renderHeaderUserDropdownInfo() {
    if (!currentUser) return;
    const nameEl = document.getElementById('hu-user-info-name');
    const roleEl = document.getElementById('hu-user-info-role');
    if (nameEl) nameEl.innerText = currentUser.displayName || currentUser.username;
    if (roleEl) roleEl.innerText = currentUser.role ||'';
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
        document.getElementById('uw-terminalthemes-submenu')?.classList.remove('open');
        document.getElementById('uw-terminalthemes-caret')?.classList.remove('rotated');
        loadActiveUsers();

        loadSidebarNetworkInfo();

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
            list.innerHTML ='<div class="uw-au-empty">No user logged in.</div>';
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
                        <span class="uw-au-name">${escapeHtml(u.displayName || u.username)}${youTag}</span>
                        <span class="uw-au-role">${escapeHtml(u.role ||'')}</span>
                    </div>
                    <div class="uw-au-meta">${escapeHtml(loginTime)} · ${escapeHtml(String(mins))}</div>
                    <div class="uw-au-device"><i class="fa-solid ${deviceIcon}"></i> ${escapeHtml(deviceLabel)}</div>
                    <div class="uw-au-ip"><i class="fa-solid fa-network-wired"></i> ${escapeHtml(ipLabel)} ${wifiBadge}</div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        list.innerHTML ='<div class="uw-au-empty" style="color:#ef4444;">Could not load active users.</div>';
    }
}

function openEditProfileModal() {
    if (!currentUser) return;
    document.getElementById('user-widget-dropdown')?.classList.remove('open');
    document.getElementById('sidebar-user-widget')?.classList.remove('open');
    document.getElementById('edit-profile-form').reset();
    document.getElementById('ep-username').value = currentUser.username;
    document.getElementById('ep-display-name').value = currentUser.displayName ||'';
    const isAdmin = (currentUser.role ||'').toLowerCase() ==='admin';
    document.getElementById('ep-avatar').value = currentUser.avatar ||'';
    updateAvatarPreview('ep-photo-preview', currentUser.avatar ||'');

    const note = document.getElementById('ep-approval-note');
    if (note) {
        const canApplyDirectly = isAdmin || !!currentPermissions.edit_user_profile;
        note.innerText = canApplyDirectly
            ?''
            :'Note: Changes to Profile Picture/Username will go to Staff Requests first for Admin approval.';
    }
    document.getElementById('edit-profile-modal').style.display ='flex';
    refreshBiometricSection();
}

async function handleEditProfileSubmit(e) {
    e.preventDefault();
    const newUsername = document.getElementById('ep-username').value.trim();
    const newDisplayName = document.getElementById('ep-display-name').value.trim();
    const avatar = document.getElementById('ep-avatar').value || null;
    const currentPassword = document.getElementById('ep-current-password').value.trim();
    const newPassword = document.getElementById('ep-new-password').value.trim();
    const confirmPassword = document.getElementById('ep-confirm-password').value.trim();

    const wantsPasswordChange = !!(currentPassword || newPassword || confirmPassword);
    if (wantsPasswordChange) {
        if (!currentPassword || !newPassword || !confirmPassword) {
            Swal.fire('Missing Values','Please complete all password fields (or leave them all blank if you are not changing the password).','warning');
            return;
        }
        if (newPassword !== confirmPassword) {
            Swal.fire('Mismatch','The new password and confirm password do not match.','warning');
            return;
        }
    }
    if (!newUsername) {
        Swal.fire('Missing Values','Username cannot be blank.','warning');
        return;
    }

    const avatarChanged = avatar !== (currentUser.avatar || null);
    const usernameChanged = newUsername.toLowerCase() !== currentUser.username.toLowerCase();
    const displayNameChanged = newDisplayName !== (currentUser.displayName ||'');
    let profileWentPending = false;

    try {

        if (avatarChanged || usernameChanged || displayNameChanged) {
            const res = await authFetch(`${API_URL}/users/self/profile`, {
                method:'PUT',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({
                    avatar,
                    username: usernameChanged ? newUsername : undefined,
                    displayName: displayNameChanged ? newDisplayName : undefined
                })
            });
            const data = await res.json();
            if (!(res.ok && data.success)) {
                Swal.fire('Execution Interrupted', SYSTEM_CONFIG.getErrorMessage(data.message ||'Process failed to complete requests.'),'error');
                return;
            }
            profileWentPending = !!data.pending;
            if (typeof data.displayName !=='undefined') {
                currentUser.displayName = data.displayName || null;
            }
            if (!data.pending) {
                currentUser.avatar = data.avatar || null;
                currentUser.username = data.username || currentUser.username;
            }
            localStorage.setItem('omnipos_user', JSON.stringify(currentUser));
            renderSidebarUserWidget();

            if (typeof renderOverviewGreeting === 'function') renderOverviewGreeting();
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
            Swal.fire('Submitted', SYSTEM_CONFIG.getSuccessMessage('Your Edit Profile request has been submitted. Waiting for Admin approval.'),'info');
        } else {
            Swal.fire('Saved', SYSTEM_CONFIG.getSuccessMessage('Your profile has been updated.'),'success');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Gateway Error', SYSTEM_CONFIG.getErrorMessage('Remote network transport paths disrupted.'),'error');
    }
}
document.getElementById('edit-profile-form')?.addEventListener('submit', handleEditProfileSubmit);

function checkAdminResetVisibility() {
    const currentUser = JSON.parse(localStorage.getItem('omnipos_user'));
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
            warningEl.innerHTML ='<i class="fa-solid fa-triangle-exclamation"></i> Caps Lock is ON and your keyboard layout may not be English';
            warningEl.style.display ='flex';
        } else if (capsLockOn) {
            warningEl.innerHTML ='<i class="fa-solid fa-triangle-exclamation"></i> Caps Lock is ON';
            warningEl.style.display ='flex';
        } else if (wrongLayout) {
            warningEl.innerHTML ='<i class="fa-solid fa-language"></i> Your keyboard layout doesn\'t appear to be English right now';
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

    const termsCheckbox = document.getElementById('login-terms-agree');
    if (termsCheckbox && !termsCheckbox.checked) {
        Swal.fire({
            icon: 'warning',
            title: 'Terms and Conditions Required',
            text: 'Please read and accept the Terms and Conditions before signing in.',
            confirmButtonText: 'Read Terms and Conditions'
        }).then(() => showTermsAndConditions());
        return;
    }

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errorBanner = document.getElementById('login-error');

    try {
        const response = await authFetch(`${API_URL}/auth/login`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();

        if (data.success && data.requiresOtp) {

            errorBanner.style.display = 'none';
            await promptLoginOtp(data.loginToken, errorBanner);
            return;
        }

        if (data.success) {
            await completeLoginSuccess(data);
        } else {
            errorBanner.innerText = data.message;
            errorBanner.style.display ='block';
        }
    } catch (err) {
        errorBanner.innerText = (err && err.name ==='AbortError')
            ?'Unable to reach the local server. Make sure the OmniPOS server (Termux) is running and try again.'
            :'Server communication breakdown error.';
        errorBanner.style.display ='block';
    }
});

async function promptLoginOtp(loginToken, errorBanner) {
    const verifyData = await showModernOtpModal({
        title: 'Enter your code',
        subtitle: 'We sent a 6-digit code to verify your Admin Login.',
        confirmButtonText: 'Verify',
        verifyFn: async ({ otp }) => {
            const verifyRes = await authFetch(`${API_URL}/auth/login/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ loginToken, otp })
            });
            const data = await verifyRes.json();
            // An expired code can't be fixed by retrying the same code, so
            // close the modal right away instead of burning an attempt.
            if (data.code === 'OTP_EXPIRED') data.noRetry = true;
            return data;
        }
    });

    if (!verifyData) return;

    try {
        if (verifyData.success) {
            await completeLoginSuccess(verifyData);
            return;
        }

        if (verifyData.code === 'OTP_EXPIRED') {
            Swal.fire('Code Expired', verifyData.message || 'Please log in again to request a new code.', 'error');
            return;
        }

        // Ran out of attempts — the "Enter your code" dialog has already
        // closed on its own with the inline error shown; nothing else to do.
    } catch (err) {
        Swal.fire('Connection Error', 'Unable to reach the server to verify the code. Please try again.', 'error');
    }
}

async function completeLoginSuccess(data) {
    currentUser = data.user;
    localStorage.setItem('omnipos_user', JSON.stringify(currentUser));
    localStorage.setItem('omnipos_last_username', currentUser.username);

    currentPermissions = data.permissions || {};
    menuRegistry = data.menuRegistry || [];
    localStorage.setItem('omnipos_permissions', JSON.stringify(currentPermissions));
    localStorage.setItem('omnipos_menu_registry', JSON.stringify(menuRegistry));

    if (data.token) {
        localStorage.setItem('omnipos_token', data.token);
    }

    window.__logoutInProgress = false;
    window.__sessionExpiredShown = false;

    const errorBanner = document.getElementById('login-error');
    if (errorBanner) errorBanner.style.display = 'none';

    showMainSystemInterface().catch(err => {
        console.error('Unexpected error during login (showMainSystemInterface):', err);
    });

    const loginCountKey = `omnipos_login_count_${(currentUser.username || currentUser.name ||'').toLowerCase()}`;
    const loginCount = (parseInt(localStorage.getItem(loginCountKey), 10) || 0) + 1;
    localStorage.setItem(loginCountKey, String(loginCount));

    const shouldShowUpgradeModal = loginCount === 1 || loginCount % 3 === 0;
    if (shouldShowUpgradeModal) {
        await refreshUnlockedFeaturesFromServer();
        if (!fullyPurchasedCache) {
            showUpgradeTiersModal();
        }
    }
}

function showAuthenticationInterface() {

    document.documentElement.classList.remove('has-session');
    document.documentElement.removeAttribute('data-preload-view');

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

        // Also hide the matching bottom-nav (mobile) shortcut, if any, so a
        // restricted role (e.g. Cashier locked to Terminal only) can't see
        // or tap into a screen the sidebar already hides.
        const bottomNavEl = document.getElementById(`bn-${m.key}`);
        if (bottomNavEl) bottomNavEl.style.display = (isAdmin || currentPermissions[m.key]) ?'' :'none';
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
    if (!badge) return;
    try {
        const res = await authFetch(`${API_URL}/products/low-stock`);
        const data = await res.json();
        const count = data && data.count ? data.count : 0;

        const badgeAllowed = isBadgeAllowedForFeature('purchase_orders');
        if (count > 0 && badgeAllowed) {
            badge.innerText = count > 99 ?'99+' : count;
            badge.style.display ='inline-block';
        } else {
            badge.style.display ='none';
        }
    } catch (e) {
        console.warn('Could not refresh low stock badge:', e);
    }
}

let reorderItemsCache = [];
let reorderPOCache = [];
const reorderSelectedCodes = new Set();

const reorderCollapsedGroups = new Set();
const reorderGroupsInitialized = new Set();

let reorderViewMode = 'list';

let reorderPOViewMode = 'list';

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
        console.warn('Could not load Reorder Alerts:', e);
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

        if (!reorderGroupsInitialized.has(supplier)) {
            reorderGroupsInitialized.add(supplier);
            reorderCollapsedGroups.add(supplier);
        }

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

    if (guardPremiumFeature('purchase_orders')) return;

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

        if (resTx.ok) {

            localStorage.setItem('cached_transactions', JSON.stringify(serverTxs));
        } else {

            serverTxs = JSON.parse(localStorage.getItem('cached_transactions') ||'[]');
        }

        if (resProd.ok) {

            localStorage.setItem('cached_products', JSON.stringify(productsList));
        } else {

            productsList = JSON.parse(localStorage.getItem('cached_products') ||'[]');
        }

        const rawOffline = JSON.parse(localStorage.getItem('offline_transactions') ||'[]');
        const offlineTxs = rawOffline.map(item => item.transaction || item);

        const allTxs = [...offlineTxs, ...serverTxs];

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
        initOverviewAdvancedChartToolbar();
        renderAdvancedOverviewChart(uniqueTxs);

        if (productsList.length > 0) globalProducts = productsList;
        refreshLowStockBadge();
        checkBackupHealthBanner();
        loadBranchesWidget();

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
        initOverviewAdvancedChartToolbar();
        renderAdvancedOverviewChart(cachedTxs);
    }
}

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
            :'no successful backup yet';

        Swal.fire({
            icon:'warning',
            title:'Auto-Backup Failing',
            html: `The scheduled database backup has failed <b>${status.consecutiveFailures}</b> times in a row.<br>
                   Last successful backup: <b>${lastOk}</b>.<br>
                   <small style="color:#64748b;">${escapeHtml(status.lastFailureMessage || '')}</small><br><br>
                   Possible reason: storage is full, or there is no write permission on the backup folder. Contact developer/IT support if this continues.`,
            confirmButtonText:'Understood'
        });
    } catch (e) {

    }
}

function formatCashierLabel(tx) {
    const username = (tx && tx.cashier) ||'';
    const displayName = (tx && tx.cashierDisplayName) ||'';
    if (displayName && displayName.trim() && displayName.trim().toLowerCase() !== username.toLowerCase()) {
        return `${displayName.trim()} / @${username}`;
    }
    return username ? `@${username}` : '';
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

    const activeUser = currentUser || JSON.parse(localStorage.getItem('omnipos_user') ||'null');
    const displayName = (activeUser && (activeUser.displayName || activeUser.username || activeUser.name)) ||'Admin';

    greetEl.innerText = `${timeGreeting}, ${displayName}!`;
    if (subEl) {
        subEl.innerText = now.toLocaleDateString('en-PH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    }
    if (roleEl) {
        roleEl.innerText = (activeUser && activeUser.role) ? activeUser.role :'Admin';
    }
}

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

function replayOverviewEntranceAnimation() {
    const overviewSection = document.getElementById('view-overview');
    if (!overviewSection) return;
    const animatedEls = overviewSection.querySelectorAll('.ov-anim');
    animatedEls.forEach(el => el.classList.remove('ov-anim'));

    void overviewSection.offsetWidth;
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

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            container.querySelectorAll('.trend-bar[data-target-height]').forEach(bar => {
                bar.style.height = `${bar.getAttribute('data-target-height')}%`;
            });
        });
    });
}

const overviewChartState = {
    granularity: 'day',
    rangePreset: '30d',
    fromDate: null,
    toDate: null,
    metric: 'total',
    compare: false,
    lastTxs: []
};

const OV_SHIFT_DEFS = [
    { key: 1, label: 'Shift 1 (6AM–2PM)', startHour: 6, endHour: 14 },
    { key: 2, label: 'Shift 2 (2PM–10PM)', startHour: 14, endHour: 22 },
    { key: 3, label: 'Shift 3 (10PM–6AM)', startHour: 22, endHour: 30 }
];

function ovGetTxDate(tx) {
    const raw = tx && (tx.isoDate || tx.timestamp || tx.date);
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
}

function ovGetShiftForHour(hour) {
    if (hour >= 6 && hour < 14) return OV_SHIFT_DEFS[0];
    if (hour >= 14 && hour < 22) return OV_SHIFT_DEFS[1];
    return OV_SHIFT_DEFS[2];
}

function ovISOWeekKey(d) {

    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function ovStartOfWeek(d) {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
}

function ovResolveDateRange() {
    const now = new Date();
    let to = overviewChartState.toDate ? new Date(overviewChartState.toDate) : new Date(now);
    to.setHours(23, 59, 59, 999);
    let from;

    if (overviewChartState.fromDate && overviewChartState.toDate) {
        from = new Date(overviewChartState.fromDate);
        from.setHours(0, 0, 0, 0);
        return { from, to };
    }

    switch (overviewChartState.rangePreset) {
        case 'today':
            from = new Date(now); from.setHours(0, 0, 0, 0); break;
        case '7d':
            from = new Date(now); from.setDate(from.getDate() - 6); from.setHours(0, 0, 0, 0); break;
        case '90d':
            from = new Date(now); from.setDate(from.getDate() - 89); from.setHours(0, 0, 0, 0); break;
        case 'year':
            from = new Date(now); from.setDate(from.getDate() - 364); from.setHours(0, 0, 0, 0); break;
        case 'all':
            from = new Date(2000, 0, 1); break;
        case '30d':
        default:
            from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0); break;
    }
    return { from, to };
}

function ovComputeBuckets(txs, granularity, from, to) {
    const inRange = (txs || []).filter(tx => {
        const d = ovGetTxDate(tx);
        return d && d >= from && d <= to;
    });

    const bucketMap = new Map();

    function touchBucket(key, label, sortKey) {
        if (!bucketMap.has(key)) {
            bucketMap.set(key, { key, label, sortKey, total: 0, high: -Infinity, low: Infinity, count: 0 });
        }
        return bucketMap.get(key);
    }

    inRange.forEach(tx => {
        const d = ovGetTxDate(tx);
        if (!d) return;
        const amt = parseFloat(tx.total) || 0;

        let key, label, sortKey;
        if (granularity === 'hour') {
            key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
            label = d.toLocaleTimeString('en-PH', { hour: 'numeric', hour12: true }) + ' ' + d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
            sortKey = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
        } else if (granularity === 'shift') {
            const shiftHour = d.getHours();
            const shiftDef = ovGetShiftForHour(shiftHour);

            const bucketDate = new Date(d);
            if (shiftDef.key === 3 && shiftHour < 6) bucketDate.setDate(bucketDate.getDate() - 1);
            key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}-S${shiftDef.key}`;
            label = `${bucketDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} • ${shiftDef.label}`;
            sortKey = new Date(bucketDate.getFullYear(), bucketDate.getMonth(), bucketDate.getDate()).getTime() + shiftDef.key;
        } else if (granularity === 'week') {
            const weekStart = ovStartOfWeek(d);
            key = ovISOWeekKey(d);
            label = 'Wk of ' + weekStart.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
            sortKey = weekStart.getTime();
        } else if (granularity === 'month') {
            key = `${d.getFullYear()}-${d.getMonth()}`;
            label = d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });
            sortKey = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
        } else if (granularity === 'year') {
            key = `${d.getFullYear()}`;
            label = `${d.getFullYear()}`;
            sortKey = new Date(d.getFullYear(), 0, 1).getTime();
        } else {
            key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            label = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
            sortKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        }

        const bucket = touchBucket(key, label, sortKey);
        bucket.total += amt;
        bucket.count += 1;
        if (amt > bucket.high) bucket.high = amt;
        if (amt < bucket.low) bucket.low = amt;
    });

    const buckets = Array.from(bucketMap.values()).sort((a, b) => a.sortKey - b.sortKey);
    buckets.forEach(b => {
        b.total = Math.round(b.total * 100) / 100;
        if (b.count === 0) { b.high = 0; b.low = 0; }
        else { b.high = Math.round(b.high * 100) / 100; b.low = Math.round(b.low * 100) / 100; }
    });
    return buckets;
}

function ovGetComparisonRange(from, to) {
    const durationMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - durationMs);
    return { from: prevFrom, to: prevTo };
}

function ovFormatPeso(val) {
    return '₱' + (Number(val) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ovGetThemeColors() {
    const isDark = document.body.classList.contains('dark-mode');
    const cs = getComputedStyle(document.body);
    const readVar = (name, fallback) => {
        const v = (cs.getPropertyValue(name) || '').trim();
        return v || fallback;
    };
    if (isDark) {
        return {
            grid: readVar('--dm-border', '#262733'),
            axisText: readVar('--dm-text-muted', '#6f7080'),
            axisLine: readVar('--dm-border', '#374151'),
            total: readVar('--dm-accent', '#7c5cff'),
            high: '#4ade80',
            low: '#f87171',
            compare: readVar('--dm-text-muted', '#6f7080'),
            pointStroke: readVar('--dm-surface', '#1c1c24'),
            tooltipBg: readVar('--dm-bg', '#121218'),
            tooltipText: readVar('--dm-text-primary', '#f5f5f7')
        };
    }
    return {
        grid: '#e2e8f0',
        axisText: '#94a3b8',
        axisLine: '#cbd5e1',
        total: '#2563eb',
        high: '#22c55e',
        low: '#ef4444',
        compare: '#94a3b8',
        pointStroke: '#ffffff',
        tooltipBg: '#0f172a',
        tooltipText: '#f8fafc'
    };
}

function renderAdvancedOverviewChart(txList) {
    const wrap = document.getElementById('ov-chart-svg-wrap');
    if (!wrap) return;

    if (Array.isArray(txList)) overviewChartState.lastTxs = txList;
    const txs = overviewChartState.lastTxs;

    const { from, to } = ovResolveDateRange();
    const buckets = ovComputeBuckets(txs, overviewChartState.granularity, from, to);

    let compareBuckets = null;
    if (overviewChartState.compare) {
        const prevRange = ovGetComparisonRange(from, to);
        compareBuckets = ovComputeBuckets(txs, overviewChartState.granularity, prevRange.from, prevRange.to);

    }

    const rangeLabelEl = document.getElementById('ov-chart-range-label');
    if (rangeLabelEl) {
        const fmt = (d) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
        rangeLabelEl.textContent = `(${fmt(from)} – ${fmt(to)})`;
    }

    const emptyEl = document.getElementById('ov-chart-empty');
    const hasData = buckets.some(b => b.count > 0);
    if (emptyEl) emptyEl.style.display = hasData ? 'none' : 'flex';

    ovDrawChart(wrap, buckets, compareBuckets);
    ovRenderLegend(buckets.length > 0, !!compareBuckets);
    ovRenderSummary(buckets, compareBuckets);
    ovRenderSummaryBar();
}

const OV_GRAN_LABELS = { hour: 'Hourly', shift: 'Shift', day: 'Day', week: 'Week', month: 'Month', year: 'Year' };
const OV_RANGE_LABELS = { today: 'Today', '7d': 'Last 7 Days', '30d': 'Last 30 Days', '90d': 'Last 90 Days', year: 'Last 1 Year', all: 'All Time', custom: 'Custom Range' };
const OV_METRIC_LABELS = { total: 'Total', high: 'High', low: 'Low', both: 'High & Low' };

function ovRenderSummaryBar() {
    const bar = document.getElementById('ov-chart-summary-bar');
    if (!bar) return;
    const pills = [
        OV_GRAN_LABELS[overviewChartState.granularity] || overviewChartState.granularity,
        OV_RANGE_LABELS[overviewChartState.rangePreset] || overviewChartState.rangePreset,
        OV_METRIC_LABELS[overviewChartState.metric] || overviewChartState.metric
    ];
    if (overviewChartState.compare) pills.push('Comparing');
    bar.innerHTML = pills.map(p => `<span class="sb-pill">${escapeHtml(p)}</span>`).join('');
}

function ovRenderLegend(hasData, hasCompare) {
    const legendEl = document.getElementById('ov-chart-legend');
    if (!legendEl) return;
    const metric = overviewChartState.metric;
    const colors = ovGetThemeColors();
    const items = [];
    if (metric === 'total') items.push({ color: colors.total, label: 'Total Sales' });
    if (metric === 'high' || metric === 'both') items.push({ color: colors.high, label: 'High' });
    if (metric === 'low' || metric === 'both') items.push({ color: colors.low, label: 'Low' });
    if (hasCompare) items.push({ color: colors.compare, label: 'Previous Period', dashed: true });

    legendEl.innerHTML = items.map(it => `
        <span class="legend-item" style="color:${it.color}">
            <span class="legend-swatch${it.dashed ? ' dashed' : ''}" style="background-color:${it.dashed ? 'transparent' : it.color}; color:${it.color};"></span>
            ${it.label}
        </span>`).join('');
}

function ovRenderSummary(buckets, compareBuckets) {
    const el = document.getElementById('ov-chart-summary');
    if (!el) return;

    const totalSum = buckets.reduce((s, b) => s + b.total, 0);
    const highest = buckets.reduce((max, b) => (b.total > max.total ? b : max), { total: -Infinity, label: '—' });
    const lowestActive = buckets.filter(b => b.count > 0);
    const lowest = lowestActive.reduce((min, b) => (b.total < min.total ? b : min), { total: Infinity, label: '—' });
    const avg = buckets.length ? totalSum / buckets.length : 0;

    let compareHtml = '';
    if (compareBuckets) {
        const compareSum = compareBuckets.reduce((s, b) => s + b.total, 0);
        const pctChange = compareSum > 0 ? ((totalSum - compareSum) / compareSum) * 100 : (totalSum > 0 ? 100 : 0);
        const isUp = pctChange >= 0;
        compareHtml = `
            <div class="adv-summary-stat">
                <p class="stat-label">vs Previous Period</p>
                <h4 class="stat-value ${isUp ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${isUp ? 'up' : 'down'}"></i> ${Math.abs(pctChange).toFixed(1)}%</h4>
            </div>`;
    }

    el.innerHTML = `
        <div class="adv-summary-stat">
            <p class="stat-label">Total Sales</p>
            <h4 class="stat-value">${ovFormatPeso(totalSum)}</h4>
        </div>
        <div class="adv-summary-stat">
            <p class="stat-label">Highest Point</p>
            <h4 class="stat-value up">${ovFormatPeso(highest.total === -Infinity ? 0 : highest.total)}</h4>
        </div>
        <div class="adv-summary-stat">
            <p class="stat-label">Lowest Point</p>
            <h4 class="stat-value down">${ovFormatPeso(lowest.total === Infinity ? 0 : lowest.total)}</h4>
        </div>
        <div class="adv-summary-stat">
            <p class="stat-label">Average / Bucket</p>
            <h4 class="stat-value">${ovFormatPeso(avg)}</h4>
        </div>
        ${compareHtml}
    `;
}

function ovDrawChart(wrapEl, buckets, compareBuckets) {
    const width = Math.max(wrapEl.clientWidth || 600, 300);
    const height = wrapEl.clientHeight || 260;
    const padL = 52, padR = 16, padT = 16, padB = 34;
    const plotW = Math.max(width - padL - padR, 10);
    const plotH = Math.max(height - padT - padB, 10);

    const colors = ovGetThemeColors();
    const metric = overviewChartState.metric;
    const seriesToPlot = [];
    if (metric === 'total') seriesToPlot.push({ key: 'total', color: colors.total, fill: true });
    if (metric === 'high' || metric === 'both') seriesToPlot.push({ key: 'high', color: colors.high, fill: metric === 'high' });
    if (metric === 'low' || metric === 'both') seriesToPlot.push({ key: 'low', color: colors.low, fill: metric === 'low' });

    const allVals = [0];
    buckets.forEach(b => seriesToPlot.forEach(s => allVals.push(b[s.key] || 0)));
    if (compareBuckets) compareBuckets.forEach(b => allVals.push(b.total || 0));
    const maxVal = Math.max(...allVals, 1);

    const n = Math.max(buckets.length, 1);
    const xStep = n > 1 ? plotW / (n - 1) : plotW;
    const xAt = (i) => padL + (n > 1 ? i * xStep : plotW / 2);
    const yAt = (v) => padT + plotH - (Math.max(v, 0) / maxVal) * plotH;

    const gridCount = 4;
    let gridSvg = '';
    for (let g = 0; g <= gridCount; g++) {
        const val = (maxVal / gridCount) * g;
        const y = padT + plotH - (val / maxVal) * plotH;
        gridSvg += `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${colors.grid}" stroke-width="1" stroke-dasharray="3,4"/>`;
        gridSvg += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="${colors.axisText}" text-anchor="end">${ovFormatShortPeso(val)}</text>`;
    }

    const maxLabels = Math.max(Math.floor(plotW / 60), 3);
    const labelEvery = Math.max(1, Math.ceil(n / maxLabels));
    let xLabelsSvg = '';
    buckets.forEach((b, i) => {
        if (i % labelEvery !== 0 && i !== n - 1) return;
        xLabelsSvg += `<text x="${xAt(i)}" y="${height - 10}" font-size="10" fill="${colors.axisText}" text-anchor="middle">${escapeHtml(b.label)}</text>`;
    });

    function buildLinePath(getVal, srcBuckets) {
        return srcBuckets.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(getVal(b)).toFixed(1)}`).join(' ');
    }
    function buildAreaPath(getVal, srcBuckets) {
        const line = srcBuckets.map((b, i) => `${xAt(i).toFixed(1)},${yAt(getVal(b)).toFixed(1)}`).join(' L ');
        return `M ${xAt(0).toFixed(1)},${(padT + plotH).toFixed(1)} L ${line} L ${xAt(srcBuckets.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
    }

    let seriesSvg = '';
    seriesToPlot.forEach((s, idx) => {
        const getVal = (b) => b[s.key] || 0;
        if (s.fill && buckets.length > 1) {
            seriesSvg += `<path d="${buildAreaPath(getVal, buckets)}" fill="url(#ovGrad${idx})" opacity="0.9"/>`;
        }
        if (buckets.length > 1) {
            seriesSvg += `<path d="${buildLinePath(getVal, buckets)}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
        }
        buckets.forEach((b, i) => {
            if (b.count === 0 && s.key !== 'total') return;
            seriesSvg += `<circle class="adv-chart-pt" data-idx="${i}" data-series="${s.key}" cx="${xAt(i).toFixed(1)}" cy="${yAt(getVal(b)).toFixed(1)}" r="3.5" fill="${s.color}" stroke="${colors.pointStroke}" stroke-width="1.5"/>`;
        });
    });

    let compareSvg = '';
    if (compareBuckets && compareBuckets.length > 1) {
        compareSvg = `<path d="${buildLinePath(b => b.total || 0, compareBuckets)}" fill="none" stroke="${colors.compare}" stroke-width="2" stroke-dasharray="5,5" stroke-linecap="round"/>`;
    }

    let hoverSvg = '';
    buckets.forEach((b, i) => {
        const colX = padL + (i * xStep) - xStep / 2;
        const colW = n > 1 ? xStep : plotW;
        hoverSvg += `<rect class="adv-chart-hover-col" data-idx="${i}" x="${Math.max(colX, padL).toFixed(1)}" y="${padT}" width="${colW.toFixed(1)}" height="${plotH}" fill="transparent"/>`;
    });

    const gradientsSvg = seriesToPlot.map((s, idx) => `
        <linearGradient id="ovGrad${idx}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${s.color}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${s.color}" stop-opacity="0.02"/>
        </linearGradient>`).join('');

    wrapEl.querySelectorAll('svg.adv-chart-svg').forEach(el => el.remove());
    const svgHtml = `
        <svg class="adv-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <defs>${gradientsSvg}</defs>
            ${gridSvg}
            <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${colors.axisLine}" stroke-width="1"/>
            ${compareSvg}
            ${seriesSvg}
            ${xLabelsSvg}
            ${hoverSvg}
        </svg>`;
    wrapEl.insertAdjacentHTML('afterbegin', svgHtml);

    const tooltip = document.getElementById('ov-chart-tooltip');
    const svgEl = wrapEl.querySelector('svg.adv-chart-svg');
    if (svgEl && tooltip) {
        svgEl.querySelectorAll('.adv-chart-hover-col').forEach(col => {
            col.addEventListener('mouseenter', (e) => {
                const idx = parseInt(col.getAttribute('data-idx'));
                const b = buckets[idx];
                if (!b) return;
                const cmp = compareBuckets && compareBuckets[idx];
                let rows = `<div class="tt-row"><span><span class="tt-dot" style="background:${colors.total};"></span>Total</span><span>${ovFormatPeso(b.total)}</span></div>`;
                if (metric === 'high' || metric === 'both') rows += `<div class="tt-row"><span><span class="tt-dot" style="background:${colors.high};"></span>High</span><span>${ovFormatPeso(b.high)}</span></div>`;
                if (metric === 'low' || metric === 'both') rows += `<div class="tt-row"><span><span class="tt-dot" style="background:${colors.low};"></span>Low</span><span>${ovFormatPeso(b.low)}</span></div>`;
                rows += `<div class="tt-row"><span>Transactions</span><span>${b.count}</span></div>`;
                if (cmp) rows += `<div class="tt-row"><span><span class="tt-dot" style="background:${colors.compare};"></span>Previous</span><span>${ovFormatPeso(cmp.total)}</span></div>`;
                tooltip.innerHTML = `<strong>${escapeHtml(b.label)}</strong>${rows}`;
                tooltip.style.display = 'block';
            });
            col.addEventListener('mousemove', (e) => {
                const rect = wrapEl.getBoundingClientRect();
                tooltip.style.left = `${e.clientX - rect.left}px`;
                tooltip.style.top = `${e.clientY - rect.top}px`;
            });
            col.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
        });
    }
}

function ovFormatShortPeso(val) {
    if (val >= 1000000) return '₱' + (val / 1000000).toFixed(1) + 'M';
    if (val >= 1000) return '₱' + (val / 1000).toFixed(1) + 'K';
    return '₱' + Math.round(val);
}

function initOverviewAdvancedChartToolbar() {
    const card = document.getElementById('ov-adv-chart-card');
    if (!card || card.getAttribute('data-ov-bound') === '1') return;
    card.setAttribute('data-ov-bound', '1');

    const filtersToggleBtn = document.getElementById('ov-chart-filters-toggle');
    const toolbarEl = document.getElementById('ov-chart-toolbar');
    if (filtersToggleBtn && toolbarEl) {
        filtersToggleBtn.addEventListener('click', () => {
            const isOpen = toolbarEl.style.display !== 'none';
            toolbarEl.style.display = isOpen ? 'none' : 'flex';
            toolbarEl.style.flexDirection = 'column';
            filtersToggleBtn.setAttribute('aria-expanded', String(!isOpen));
        });
    }

    const granSelect = document.getElementById('ov-chart-granularity-select');
    if (granSelect) {
        granSelect.value = overviewChartState.granularity;
        granSelect.addEventListener('change', () => {
            overviewChartState.granularity = granSelect.value;
            renderAdvancedOverviewChart();
        });
    }

    const customRangeRow = document.getElementById('ov-chart-custom-range-row');
    const rangeSelect = document.getElementById('ov-chart-range-select');
    if (rangeSelect) {
        rangeSelect.value = overviewChartState.rangePreset;
        rangeSelect.addEventListener('change', () => {
            if (rangeSelect.value === 'custom') {
                if (customRangeRow) customRangeRow.style.display = 'flex';
                return;
            }
            if (customRangeRow) customRangeRow.style.display = 'none';
            overviewChartState.rangePreset = rangeSelect.value;
            overviewChartState.fromDate = null;
            overviewChartState.toDate = null;
            const fromInput = document.getElementById('ov-chart-from');
            const toInput = document.getElementById('ov-chart-to');
            if (fromInput) fromInput.value = '';
            if (toInput) toInput.value = '';
            renderAdvancedOverviewChart();
        });
    }

    const applyBtn = document.getElementById('ov-chart-apply-range');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            const fromVal = document.getElementById('ov-chart-from')?.value;
            const toVal = document.getElementById('ov-chart-to')?.value;
            if (!fromVal || !toVal) {
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Please select both From and To dates.', timer: 1800, showConfirmButton: false });
                return;
            }
            overviewChartState.fromDate = new Date(fromVal);
            overviewChartState.toDate = new Date(toVal);
            overviewChartState.rangePreset = 'custom';
            renderAdvancedOverviewChart();
        });
    }

    card.querySelectorAll('#ov-chart-metric .adv-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            card.querySelectorAll('#ov-chart-metric .adv-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            overviewChartState.metric = btn.getAttribute('data-metric');
            renderAdvancedOverviewChart();
        });
    });

    const compareToggle = document.getElementById('ov-chart-compare-toggle');
    if (compareToggle) {
        compareToggle.addEventListener('change', () => {
            overviewChartState.compare = compareToggle.checked;
            renderAdvancedOverviewChart();
        });
    }

    const refreshBtn = document.getElementById('ov-chart-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (typeof loadDashboardMetrics === 'function') loadDashboardMetrics();
        });
    }

    let ovResizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(ovResizeTimer);
        ovResizeTimer = setTimeout(() => renderAdvancedOverviewChart(), 200);
    });

    const themeObserver = new MutationObserver(() => renderAdvancedOverviewChart());
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
}

async function loadBranchesWidget() {
    const card = document.getElementById('branches-widget-card');
    const body = document.getElementById('branches-widget-body');
    if (!card || !body) return;

    try {

        const token = localStorage.getItem('omnipos_token');
        const res = await fetch(`${API_URL}/branches/summary`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });

        if (res.status === 402) {
            const locked = await res.json();
            card.style.display = '';

            body.innerHTML = `
                <div style="text-align:center; padding:10px 4px;">
                    <p style="font-size:0.85rem;color:#64748b;margin:6px 0 10px;line-height:1.5;">
                        <i class="fa-solid fa-lock" style="color:#f59e0b;"></i>
                        See combined sales across all your branches in one view.
                    </p>
                    <button type="button" id="branches-widget-unlock-btn" class="btn-action-outline">
                        <i class="fa-solid fa-unlock"></i> Unlock Multi-Branch Dashboard — ₱${locked.price}
                    </button>
                </div>`;
            const unlockBtn = document.getElementById('branches-widget-unlock-btn');
            if (unlockBtn) {
                unlockBtn.addEventListener('click', async () => {
                    const ok = await promptUnlockFeature(locked.featureId, locked.featureName, locked.price, locked.description);
                    if (ok) loadBranchesWidget();
                });
            }
            return;
        }

        if (!res.ok) {

            card.style.display = 'none';
            return;
        }
        const data = await res.json();
        card.style.display = '';

        if (!data.configured) {
            body.innerHTML = `
                <p style="color:#94a3b8;font-size:0.85rem;margin:8px 0 0;line-height:1.5;">
                    Wala pang naka-configure na Business Group Code. Kung may 2+ branch ang negosyo mo, i-set ito sa
                    <a href="#" onclick="switchView('users'); setTimeout(()=>{ document.getElementById('store-settings-tab-btn')?.click(); }, 50); return false;" style="color:#3b82f6;">Store &amp; Sales Settings</a>
                    para makita ang combined sales ng lahat ng branch dito.
                </p>`;
            return;
        }
        if (!data.success) {
            body.innerHTML = `<p style="color:#ef4444;font-size:0.85rem;margin:8px 0 0;">${data.message || 'Hindi makuha ang branch summary.'}</p>`;
            return;
        }

        const branches = data.branches || [];
        const combined = data.combined || {};
        const currency = (typeof storeSettingsCache !== 'undefined' && storeSettingsCache && storeSettingsCache.currencySymbol) || '₱';

        if (branches.length === 0) {
            body.innerHTML = `<p style="color:#94a3b8;font-size:0.85rem;margin:8px 0 0;">Naka-configure na ang Business Group Code, pero wala pang ibang branch na nag-check-in gamit ang parehong code. Siguraduhing pareho ang code sa lahat ng branch device (kailangan din ng internet connection sa bawat isa).</p>`;
            return;
        }

        const rows = branches.map(b => {
            const ago = timeAgoLabel(b.updatedAt);
            const staleWarning = (Date.now() - (b.updatedAt || 0)) > (30 * 60 * 1000);
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color);">
                    <div>
                        <div style="font-weight:600;">${escapeHtml(b.branchName || 'Unnamed Branch')}${b.isSelf ? ' <span style="font-weight:normal;color:#3b82f6;font-size:0.75rem;">(this device)</span>' : ''}</div>
                        <div style="font-size:0.75rem;color:${staleWarning ? '#ef4444' : '#94a3b8'};">Updated ${ago}${staleWarning ? ' — may be offline' : ''}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:600;">${currency}${(b.summary?.grossSalesToday || 0).toFixed(2)}</div>
                        <div style="font-size:0.75rem;color:#94a3b8;">${b.summary?.transactionCountToday || 0} tx · ${b.summary?.lowStockCount || 0} low stock</div>
                    </div>
                </div>`;
        }).join('');

        body.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin:8px 0 6px;">
                <span style="font-size:0.8rem;color:#64748b;">${branches.length} branch(es) combined</span>
                <span style="font-weight:700;font-size:1.1rem;">${currency}${(combined.grossSalesToday || 0).toFixed(2)} <span style="font-weight:400;font-size:0.75rem;color:#94a3b8;">today</span></span>
            </div>
            ${rows}
        `;
    } catch (err) {
        console.warn('loadBranchesWidget failed:', err);

        card.style.display = 'none';
    }
}

function timeAgoLabel(ts) {
    if (!ts) return 'never';
    const diffMs = Date.now() - ts;
    if (diffMs < 0) return 'just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
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

        if (!response.ok) throw new Error(`Products fetch failed: HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Products fetch returned a non-array payload');

        globalProducts = data;

        try {
            localStorage.setItem('cached_products', JSON.stringify(globalProducts));
        } catch (cacheErr) {
            console.warn('Terminal Catalog: hindi na-cache sa localStorage (malamang quota, dahil sa laki ng product photos) — hindi ito problema, gagamitin pa rin ang fresh data mula server.', cacheErr);
        }
        updateCategoryChipsDynamic();
        updateDropdownCategoriesDynamic();
        renderTerminalProducts();
        broadcastIdleShowcase();
    } catch (e) {
        console.warn('Terminal Catalog: Local offline fallback active. Retaining local environmental storage matrix snapshots.', e);
        globalProducts = JSON.parse(localStorage.getItem('cached_products') ||'[]');
        updateCategoryChipsDynamic();
        updateDropdownCategoriesDynamic();
        renderTerminalProducts();
        broadcastIdleShowcase();
    }
}

function broadcastIdleShowcase() {
    if (!Array.isArray(globalProducts) || globalProducts.length === 0) return;
    const withImages = globalProducts.filter(p => p && p.image);
    const pool = (withImages.length ? withImages : globalProducts).slice(0, 10);
    const showcase = pool.map(p => ({ name: p.name, price: p.price, image: p.image || null }));
    broadcastCustomerDisplay('idle-content', { showcase });
}

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

    if (document.querySelector('.swal2-container')) return;

    try {
        const response = await authFetch(`${API_URL}/products`);
        if (!response.ok) return;
        updateActiveTerminalCountFromResponse(response);
        const freshProducts = await response.json();
        if (!Array.isArray(freshProducts)) return;
        globalProducts = freshProducts;

        try {
            localStorage.setItem('cached_products', JSON.stringify(globalProducts));
        } catch (cacheErr) {
            console.warn('Silent stock refresh: hindi na-cache sa localStorage (malamang quota) — hindi ito problema, ipi-proceed pa rin ang render gamit ang fresh data.', cacheErr);
        }
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

// ---- Terminal search: distinguish external barcode scanner input from manual typing ----
// Hardware scanners "type" each character extremely fast (usually <15ms apart) since
// they're a keyboard-wedge device blasting the full code in one burst, then Enter.
// A human typing on a keyboard is almost always slower than that between keystrokes.
// We use this timing gap to detect a scan in progress and skip live filtering entirely
// while it happens, so the product pane never flickers/filters mid-scan. Manual typing
// (slower, natural pauses) still filters normally and instantly.
let __termSearchLastKeyTime = 0;
let __termSearchIsScan = false;
let __termSearchResetId = null;
let __termSearchDebounceId = null;
const TERM_SEARCH_SCAN_GAP_MS = 45; // max ms between keystrokes to be considered "scanner speed"
const TERM_SEARCH_FILTER_DELAY_MS = 40; // tiny grace delay so a scan's 1st char never flickers the grid

function onTerminalSearchKeydown(e) {
    const now = Date.now();
    const delta = now - __termSearchLastKeyTime;
    __termSearchLastKeyTime = now;

    if (e.key === 'Enter') {
        // Enter is handled by the hardware-scanner listener (adds to cart / clears search).
        // Reset scan-tracking state right away so the next input starts clean.
        __termSearchIsScan = false;
        if (__termSearchDebounceId) { clearTimeout(__termSearchDebounceId); __termSearchDebounceId = null; }
        return;
    }

    if (e.key.length === 1) {
        if (delta <= TERM_SEARCH_SCAN_GAP_MS) {
            __termSearchIsScan = true;
            // A scan is confirmed in progress — cancel any pending manual-search filter render.
            if (__termSearchDebounceId) { clearTimeout(__termSearchDebounceId); __termSearchDebounceId = null; }
        } else {
            __termSearchIsScan = false;
        }
    }

    if (__termSearchResetId) clearTimeout(__termSearchResetId);
    __termSearchResetId = setTimeout(() => { __termSearchIsScan = false; }, 300);
}

function onTerminalSearchInput() {
    if (__termSearchIsScan) {
        // Likely mid-scan: don't touch the product grid at all until we know otherwise.
        return;
    }
    if (__termSearchDebounceId) clearTimeout(__termSearchDebounceId);
    __termSearchDebounceId = setTimeout(() => {
        // Re-check right before rendering in case the next keystroke just revealed a scan.
        if (!__termSearchIsScan) renderTerminalProducts();
    }, TERM_SEARCH_FILTER_DELAY_MS);
}

function renderTerminalProducts() {

    hideProductImagePeek();

    const searchBox = document.getElementById('terminal-search');
    const searchString = searchBox ? searchBox.value.toLowerCase() :'';
    const gridOutput = document.getElementById('terminal-grid-output');
    if (!gridOutput) return;

    if (!Array.isArray(globalProducts)) {
        console.warn('renderTerminalProducts: globalProducts is not an array, keeping last rendered list.', globalProducts);
        return;
    }

    try {

        const sanitizedProducts = globalProducts.filter(p => p && typeof p ==='object');

        const filtered = sanitizedProducts.filter(p => {
            const matchesCategory = (activeTerminalCategory ==='All' || p.category === activeTerminalCategory);
            const pName = (p.name ||'').toLowerCase();
            const pCode = (p.code ||'').toLowerCase();
            const matchesQuery = (pName.includes(searchString) || pCode.includes(searchString));
            return matchesCategory && matchesQuery;
        });

        const fragment = document.createDocumentFragment();

        filtered.forEach(p => {
            try {

                const cartItem = shoppingCart.find(item => item.code === p.code);
                const qtyInCart = cartItem ? cartItem.quantity : 0;

                const availableStock = Math.max(0, (parseFloat(p.stock) || 0) - qtyInCart);

                const card = document.createElement('div');

                card.className = `t-product-card ${availableStock <= 0 ?'out-of-stock' :''}`;

                let iconClass = getCategoryIconClass(p.category);

                const cartBadgeHtml = qtyInCart > 0
                    ? `<div class="t-prod-cart-badge"><i class="fa-solid fa-cart-shopping"></i> x${qtyInCart}</div>`
                    : '';

                card.innerHTML = `
                    ${cartBadgeHtml}
                    <div class="t-prod-icon" title="Tap to add • Long-press for details">${p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name ||'Product')}" draggable="false">` : `<i class="${iconClass}"></i>`}</div>
                    <h4${p.image ? ' title="Hold or hover to view full image"' : ''}>${escapeHtml(p.name ||'Unnamed Product')}</h4>
                    <div class="t-prod-price"${p.image ? ' title="Hold or hover to view full image"' : ''}>₱${(parseFloat(p.price) || 0).toFixed(2)}</div>
                    <div class="t-prod-stock"${p.image ? ' title="Hold or hover to view full image"' : ''}>Stock: ${availableStock}</div>
                `;
                card.onclick = () => addItemToCart(p);
                attachInstantTapFeedback(card, { hapticMs: 12 });
                const prodIconEl = card.querySelector('.t-prod-icon');
                attachLongPress(prodIconEl, () => showProductDetails(p.code), 800);

                if (p.image) {

                    const previewTargets = [
                        card.querySelector('h4'),
                        card.querySelector('.t-prod-price'),
                        card.querySelector('.t-prod-stock')
                    ];
                    previewTargets.forEach(prodInfoEl => {
                        if (!prodInfoEl) return;

                        attachHoldPreview(
                            prodInfoEl,
                            () => showProductImagePeek(prodIconEl, p),
                            () => hideProductImagePeek(),
                            1000
                        );

                        attachHoverPreview(
                            prodInfoEl,
                            () => showProductImagePeek(prodIconEl, p),
                            () => hideProductImagePeek(),
                            1000,
                            p.code
                        );
                    });
                }

                fragment.appendChild(card);
            } catch (cardError) {

                console.error("Skipped a product due to a card render error:", p, cardError);
            }
        });

        gridOutput.innerHTML ='';
        gridOutput.appendChild(fragment);

    } catch (renderError) {
        console.error("Failed to render Terminal product list:", renderError);
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

let pdGalleryImages = [];

function renderProductDetailsGallery(p) {
    const thumbsContainer = document.getElementById('pd-gallery-thumbs');
    const photoBox = document.getElementById('pd-photo-box');
    if (!photoBox) return;

    const iconClass = getCategoryIconClass(p.category);
    const mainImage = p.image ||'';
    const gallery = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
    pdGalleryImages = mainImage ? [mainImage, ...gallery] : gallery;

    photoBox.innerHTML = pdGalleryImages.length
        ? `<img src="${pdGalleryImages[0]}" alt="${(p.name ||'Product').replace(/"/g,'&quot;')}">`
        : `<i class="${iconClass}"></i>`;

    if (!thumbsContainer) return;
    if (pdGalleryImages.length > 1) {
        thumbsContainer.style.display ='flex';
        thumbsContainer.innerHTML = pdGalleryImages.map((src, idx) => `
            <img src="${src}" class="${idx === 0 ?'active-thumb' :''}" onclick="switchProductDetailsPhoto(${idx})">
        `).join('');
    } else {
        thumbsContainer.style.display ='none';
        thumbsContainer.innerHTML ='';
    }
}

function switchProductDetailsPhoto(idx) {
    const photoBox = document.getElementById('pd-photo-box');
    const src = pdGalleryImages[idx];
    if (photoBox && src) photoBox.innerHTML = `<img src="${src}">`;
    document.querySelectorAll('#pd-gallery-thumbs img').forEach((img, i) => img.classList.toggle('active-thumb', i === idx));
}

// Very small, safe formatter: preserves plain paragraphs, and turns lines
// that start with "-" or "•" into a bullet list. Not full markdown — just
// enough so specs/descriptions read cleanly without needing a library.
function formatProductDescriptionHtml(text) {
    const lines = (text ||'').split(/\r?\n/);
    let html ='';
    let inList = false;
    lines.forEach(line => {
        const trimmed = line.trim();
        if (/^[-•]\s+/.test(trimmed)) {
            if (!inList) { html +='<ul style="margin:4px 0;padding-left:18px;">'; inList = true; }
            html += `<li>${escapeHtml(trimmed.replace(/^[-•]\s+/,''))}</li>`;
        } else {
            if (inList) { html +='</ul>'; inList = false; }
            html += trimmed ? `<div>${escapeHtml(trimmed)}</div>` : '<div style="height:6px;"></div>';
        }
    });
    if (inList) html +='</ul>';
    return html;
}

function togglePdDescription() {
    const descEl = document.getElementById('pd-description');
    const btn = document.getElementById('pd-description-toggle');
    if (!descEl || !btn) return;
    const expanded = btn.dataset.expanded ==='true';
    if (expanded) {
        descEl.classList.add('pd-desc-clamped');
        btn.innerHTML ='Read more &#9662;';
        btn.dataset.expanded ='false';
    } else {
        descEl.classList.remove('pd-desc-clamped');
        btn.innerHTML ='Show less &#9652;';
        btn.dataset.expanded ='true';
    }
}

function showProductDetails(code, context ='pos') {
    const p = globalProducts.find(prod => prod.code === code) || cachedInventoryProducts.find(prod => prod.code === code);
    if (!p) return;

    productDetailsModalCode = code;

    const cartItem = shoppingCart.find(item => item.code === p.code);
    const qtyInCart = cartItem ? cartItem.quantity : 0;
    const availableStock = Math.max(0, (parseFloat(p.stock) || 0) - qtyInCart);

    renderProductDetailsGallery(p);

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

    const descriptionRow = document.getElementById('pd-description-row');
    const descToggleBtn = document.getElementById('pd-description-toggle');
    if (p.description && p.description.trim()) {
        const descEl = document.getElementById('pd-description');
        descEl.innerHTML = formatProductDescriptionHtml(p.description);
        descriptionRow.style.display ='flex';

        if (p.description.trim().length > 150) {
            descEl.classList.add('pd-desc-clamped');
            descToggleBtn.style.display ='inline-flex';
            descToggleBtn.innerHTML ='Read more &#9662;';
            descToggleBtn.dataset.expanded ='false';
        } else {
            descEl.classList.remove('pd-desc-clamped');
            descToggleBtn.style.display ='none';
        }
    } else {
        descriptionRow.style.display ='none';
        descToggleBtn.style.display ='none';
    }

    const specsRow = document.getElementById('pd-specs-row');
    const specsList = document.getElementById('pd-specs-list');
    const specsEntries = Array.isArray(p.specs) ? p.specs.filter(s => s && ((s.key && s.key.trim()) || (s.value && s.value.trim()))) : [];
    if (specsEntries.length) {
        specsList.innerHTML = specsEntries.map(s => `
            <div class="pd-spec-line">
                <span class="pd-spec-key">${escapeHtml(s.key ||'')}</span>
                <span class="pd-spec-val">${escapeHtml(s.value ||'')}</span>
            </div>
        `).join('');
        specsRow.style.display ='flex';
    } else {
        specsRow.style.display ='none';
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

    document.getElementById('product-details-modal').classList.toggle('terminal-origin', context ==='pos');
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
                html: `Quantity reduction to zero for <b>${escapeHtml(item.name)}</b> will remove this item. Admin or authorized Supervisor/Manager password is required:`,
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
            html: `Admin or authorized Supervisor/Manager password is required to void <b>${escapeHtml(targetItem.name)}</b> from the active checkout.`,
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
        html:'Admin or authorized Supervisor/Manager password is required for this:',
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
                    </div>
                    <div class="cart-item-meta-row">
                        <span class="cart-item-each-price">₱${parseFloat(item.price).toFixed(2)} each</span>
                        <span class="cart-item-discount-row">
                            <span class="cart-item-discount-label">Disc ₱</span>
                            <input type="number"
                                   class="cart-item-discount-input"
                                   min="0"
                                   step="0.01"
                                   inputmode="decimal"
                                   value="${lineDiscount ||''}"
                                   placeholder="0.00"
                                   onclick="this.select()"
                                   onchange="setCartItemDiscount('${escapeHtml(item.code)}', this.value)">
                        </span>
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
                    </div>
                `;
                container.appendChild(row);
            } catch (rowError) {

                console.error("Skipped a cart row due to an error:", item, rowError);
            }
        });

        if (shoppingCart.length === 0) {
            container.innerHTML = '<div class="cart-empty-state"><i class="fa-solid fa-cart-shopping"></i><span>Cart is Empty</span></div>';
        }

        const cartBadge = document.getElementById('cart-badge');
        if (cartBadge) cartBadge.innerText = totalItems;
        updateCartTotals();
    } catch (cartRenderError) {
        console.error("Failed to render cart rows:", cartRenderError);
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

function recalculateActiveDiscount() {
    const discountInput = document.getElementById('cart-discount-input');
    if (!discountInput) return;

    if (cartDiscountType === 'SENIOR_PWD') {
        const subtotal = getCartNetSubtotal();
        if (subtotal <= 0) {

            const checkbox = document.getElementById('cart-senior-pwd-toggle');
            if (checkbox) checkbox.checked = false;
            cartDiscountType = 'NONE';
            cartSeniorPwdId = '';
            discountInput.removeAttribute('readonly');
            discountInput.value = 0;
            return;
        }
        const seniorPwdRatePct = (storeSettingsCache && Number.isFinite(storeSettingsCache.seniorPwdDiscountRate))
            ? storeSettingsCache.seniorPwdDiscountRate : 20;
        discountInput.value = (subtotal * (seniorPwdRatePct / 100)).toFixed(2);

    } else if (cartDiscountType === 'PROMO' && cartActivePromo) {
        const subtotal = getCartNetSubtotal();
        if (cartActivePromo.minSpend && subtotal < cartActivePromo.minSpend) {

            const minSpendForMessage = cartActivePromo.minSpend;
            cartDiscountType = 'NONE';
            cartPromoCode = '';
            cartActivePromo = null;
            const promoInput = document.getElementById('cart-promo-input');
            if (promoInput) promoInput.value = '';
            discountInput.removeAttribute('readonly');
            discountInput.value = 0;
            Swal.fire({
                icon: 'warning',
                title: 'Promo Removed',
                text: `The cart no longer meets the ₱${minSpendForMessage.toFixed(2)} minimum spend for this promo code.`,
                timer: 2200,
                showConfirmButton: false
            });
            return;
        }
        let discountAmount = cartActivePromo.type === 'percent'
            ? (subtotal * cartActivePromo.value / 100)
            : cartActivePromo.value;
        discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);
        discountInput.value = discountAmount.toFixed(2);
    }

}

function updateCartTotals() {

    recalculateActiveDiscount();

    const discountInput = document.getElementById('cart-discount-input');
    const subtotalEl = document.getElementById('summary-subtotal');
    const totalEl = document.getElementById('summary-total');

    let subtotal = getCartNetSubtotal();
    let discount = parseFloat(discountInput ? discountInput.value : 0) || 0;
    let total = Math.max(0, subtotal - discount);

    if (subtotalEl) subtotalEl.innerText = `₱${subtotal.toFixed(2)}`;
    if (totalEl) totalEl.innerText = `₱${total.toFixed(2)}`;

    broadcastCustomerDisplay('cart', {
        items: shoppingCart.map(i => ({ code: i.code, name: i.name, quantity: i.quantity, price: i.price, itemDiscount: i.itemDiscount || 0 })),
        subtotal,
        discount,
        total
    });
}

let customerDisplayChannel = null;
function broadcastCustomerDisplay(type, payload) {
    if (!advancedSettingsCache || !advancedSettingsCache.customerDisplayEnabled) return;
    if (typeof BroadcastChannel === 'undefined') return;
    if (!customerDisplayChannel) {
        try { customerDisplayChannel = new BroadcastChannel('omnipos-customer-display'); }
        catch (e) { return; }
    }
    try {
        customerDisplayChannel.postMessage({
            type,
            ...payload,
            storeName: (storeSettingsCache && storeSettingsCache.storeName) || 'OmniPOS',
            compactThreshold: advancedSettingsCache.customerDisplayCompactThreshold || 8
        });
    } catch (e) {  }
}

async function openCustomerDisplay() {

    try {
        if (typeof window.getScreenDetails === 'function') {
            const details = await window.getScreenDetails();
            const current = details.currentScreen;
            const secondary = (details.screens || []).find(
                s => s.left !== current.left || s.top !== current.top
            );
            if (secondary) {
                const features = `left=${secondary.availLeft},top=${secondary.availTop},width=${secondary.availWidth},height=${secondary.availHeight}`;
                window.open('customer-display.html', 'omniposCustomerDisplay', features);
                return;
            }
        }
    } catch (e) {

    }
    window.open('customer-display.html', 'omniposCustomerDisplay');
}

function handleManualDiscountInput() {
    cartDiscountType ='MANUAL';
    cartPromoCode ='';
    cartActivePromo = null;
    cartSeniorPwdId ='';
    cartLoyaltyPointsRedeemed = 0; cartLoyaltyCardToken = '';
    const checkbox = document.getElementById('cart-senior-pwd-toggle');
    if (checkbox) checkbox.checked = false;
    const loyaltyInput = document.getElementById('cart-loyalty-input');
    if (loyaltyInput) loyaltyInput.value ='';
    updateCartTotals();
}

function toggleSeniorPwdDiscount() {
    const checkbox = document.getElementById('cart-senior-pwd-toggle');
    const discountInput = document.getElementById('cart-discount-input');
    if (!checkbox || !discountInput) return;

    const seniorPwdEnabled = !storeSettingsCache || storeSettingsCache.seniorPwdDiscountEnabled !== false;
    const seniorPwdRatePct = (storeSettingsCache && Number.isFinite(storeSettingsCache.seniorPwdDiscountRate))
        ? storeSettingsCache.seniorPwdDiscountRate : 20;

    if (checkbox.checked) {
        if (!seniorPwdEnabled) {
            Swal.fire('Disabled', 'Senior/PWD Discount is disabled in Store & Sales Settings.', 'warning');
            checkbox.checked = false;
            return;
        }
        let subtotal = getCartNetSubtotal();
        if (subtotal <= 0) {
            Swal.fire('Empty Cart','Add an item to the cart first.','warning');
            checkbox.checked = false;
            return;
        }
        Swal.fire({
            title:'Senior Citizen / PWD Discount',
            text: `Enter the ID Number for the receipt (RA 9994 / RA 10754 — ${seniorPwdRatePct}% discount):`,
            input:'text',
            inputPlaceholder:'Senior/PWD ID Number',
            showCancelButton: true,
            confirmButtonText: `Apply ${seniorPwdRatePct}%`
        }).then(result => {
            if (result.isConfirmed && result.value && result.value.trim()) {
                cartSeniorPwdId = result.value.trim();
                cartDiscountType ='SENIOR_PWD';
                cartPromoCode ='';
                cartActivePromo = null;
                cartLoyaltyPointsRedeemed = 0; cartLoyaltyCardToken = '';
                const promoInput = document.getElementById('cart-promo-input');
                if (promoInput) promoInput.value ='';
                const loyaltyInput = document.getElementById('cart-loyalty-input');
                if (loyaltyInput) loyaltyInput.value ='';
                discountInput.value = (subtotal * (seniorPwdRatePct / 100)).toFixed(2);
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
        Swal.fire('Empty Cart','Add an item to the cart first before applying a promo code.','warning');
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
            cartActivePromo = data.promo || null;
            cartSeniorPwdId ='';
            cartLoyaltyPointsRedeemed = 0; cartLoyaltyCardToken = '';
            const loyaltyInput = document.getElementById('cart-loyalty-input');
            if (loyaltyInput) loyaltyInput.value ='';
            discountInput.value = data.discountAmount.toFixed(2);
            discountInput.setAttribute('readonly', true);
            updateCartTotals();
            Swal.fire({ icon:'success', title:'Promo Applied!', text: `${code}: -₱${data.discountAmount.toFixed(2)}`, timer: 1600, showConfirmButton: false });
        } else {
            Swal.fire('Invalid Promo Code', data.message ||'This code cannot be used.','error');
        }
    } catch (e) {
        console.warn(e);
        Swal.fire('Connection Error','Could not connect to the server to validate the promo code.','error');
    }
}

async function openCustomerPickerForCart() {
    if (guardPremiumFeature('customer_crm')) return;
    let customers = [];
    try {
        const res = await authFetch(`${API_URL}/customers/for-terminal`);
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            Swal.fire('Unable to Load Customers', errBody.message ||'Unable to load the customer list.','error');
            return;
        }
        customers = await res.json();
        if (!Array.isArray(customers)) customers = [];
    } catch (e) {
        Swal.fire('Connection Error','Unable to load the customer list.','error');
        return;
    }
    window.__swalCustomers = customers;

    const buildRowsHtml = (list) => (list.map(c =>
        `<div class="cust-pick-row" data-id="${escapeHtml(c.id)}" style="padding:10px;border-bottom:1px solid #eee;cursor:pointer;text-align:left;">
            <strong>${escapeHtml(c.name)}</strong><br><small>${escapeHtml(c.phone ||'no phone')} · ${c.points || 0} pts</small>
        </div>`
    ).join('')) ||'<p style="padding:10px;color:#94a3b8;">No customers yet. Add one first on the Customers page.</p>';

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

    const pickerResult = await Swal.fire({
        title:'Select Customer',
        html: `
            <input type="text" id="swal-cust-search" class="swal2-input" placeholder="Search by name/phone..." oninput="window.__filterSwalCustomerList(this.value)">
            <div id="swal-cust-list" style="max-height:260px;overflow-y:auto;">${buildRowsHtml(customers)}</div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText:'Walk-in (No Customer)',
        didOpen: () => attachRowClicks(customers)
    });

    if (pickerResult.dismiss === Swal.DismissReason.cancel) {
        selectedCartCustomer = null;
        const btn = document.getElementById('cart-customer-btn');
        if (btn) btn.innerHTML ='Walk-in <i class="fa-solid fa-chevron-right" style="font-size:0.7em;"></i>';
    }

    if (cartDiscountType ==='LOYALTY') {
        cartDiscountType ='NONE';
        cartLoyaltyPointsRedeemed = 0; cartLoyaltyCardToken = '';
        const discountInput = document.getElementById('cart-discount-input');
        if (discountInput) { discountInput.value = 0; discountInput.removeAttribute('readonly'); }
        updateCartTotals();
    }
    updateLoyaltyRowForCustomer();

    if (!selectedCartCustomer) return;
}

function updateLoyaltyRowForCustomer() {
    const row = document.getElementById('cart-loyalty-row');
    const avail = document.getElementById('cart-loyalty-available');
    const input = document.getElementById('cart-loyalty-input');
    const badge = document.getElementById('cart-loyalty-card-badge');
    const loyaltyOn = !storeSettingsCache || storeSettingsCache.loyaltyEnabled !== false;
    if (!row) return;
    if (loyaltyOn && selectedCartCustomer && (selectedCartCustomer.points || 0) > 0) {
        row.style.display ='';
        if (avail) avail.innerText = selectedCartCustomer.points || 0;
    } else {
        row.style.display ='none';
    }
    if (input) input.value ='';
    if (badge) badge.style.display = cartLoyaltyCardToken ?'' :'none';
}

function openLoyaltyCardScanner() {
    if (guardPremiumFeature('customer_crm')) return;
    scannerTarget ='LOYALTY_CARD';
    document.getElementById('qr-scanner-modal').style.display ='flex';
    updateScannerUIControls();
    startLiveScanner();

    window.onQRScanSuccess = function (scannedCode) {
        closeQRScanner();
        window.onQRScanSuccess = null;
        handleLoyaltyCardScanResult(scannedCode.trim());
    };
}

async function handleLoyaltyCardScanResult(token) {
    if (!token || !token.startsWith('LC1.')) {
        Swal.fire('Not a Loyalty Card/QR', 'The scanned code is not a valid customer Loyalty Card/QR.', 'warning');
        return;
    }
    try {
        const res = await authFetch(`${API_URL}/customers/lookup-by-card`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!data.success) {
            Swal.fire('Invalid Card/QR', data.message || 'This card/QR could not be verified.', 'error');
            return;
        }
        if (typeof playScanBeep ==='function') playScanBeep();

        selectedCartCustomer = data.customer;
        cartLoyaltyCardToken = token;
        const btn = document.getElementById('cart-customer-btn');
        if (btn) btn.innerHTML = `${escapeHtml(data.customer.name)} <i class="fa-solid fa-chevron-right" style="font-size:0.7em;"></i>`;
        updateLoyaltyRowForCustomer();

        const subtotal = getCartNetSubtotal();
        const available = data.customer.points || 0;
        if (available > 0 && subtotal > 0) {
            const input = document.getElementById('cart-loyalty-input');
            if (input) input.value = available;
            applyLoyaltyPointsFromScan();
        } else {
            Swal.fire({ icon:'success', title:'Customer Verified', text: `${data.customer.name} — ${available} pts available.`, timer: 1600, showConfirmButton: false });
        }
    } catch (e) {
        Swal.fire('Connection Error','Unable to verify the Loyalty Card/QR right now.','error');
    }
}

function applyLoyaltyPointsFromScan() {
    const preservedToken = cartLoyaltyCardToken;
    applyLoyaltyPointsToCart();
    cartLoyaltyCardToken = preservedToken;
    const badge = document.getElementById('cart-loyalty-card-badge');
    if (badge) badge.style.display = cartLoyaltyCardToken ?'' :'none';
}

function applyLoyaltyPointsToCart() {
    if (guardPremiumFeature('customer_crm')) return;
    if (!selectedCartCustomer) {
        Swal.fire('No Customer Selected','Pumili muna ng customer para makagamit ng loyalty points.','warning');
        return;
    }
    const input = document.getElementById('cart-loyalty-input');
    const discountInput = document.getElementById('cart-discount-input');
    let pts = parseInt(input ? input.value : 0) || 0;
    const available = selectedCartCustomer.points || 0;

    if (pts <= 0) {
        Swal.fire('Invalid Amount','Maglagay ng bilang ng points na gagamitin.','warning');
        return;
    }
    if (pts > available) pts = available;

    const subtotal = getCartNetSubtotal();
    if (subtotal <= 0) {
        Swal.fire('Empty Cart','Add an item to the cart first.','warning');
        return;
    }

    const pointValue = (storeSettingsCache && Number.isFinite(storeSettingsCache.loyaltyPointValue))
        ? storeSettingsCache.loyaltyPointValue : 1;
    let discountAmount = Math.min(pts * pointValue, subtotal);

    pts = pointValue > 0 ? Math.floor(discountAmount / pointValue) : 0;
    discountAmount = Math.round(pts * pointValue * 100) / 100;

    if (pts <= 0) {
        Swal.fire('Invalid Amount', 'Not enough points to apply a discount.', 'warning');
        return;
    }

    const checkbox = document.getElementById('cart-senior-pwd-toggle');
    if (checkbox) checkbox.checked = false;
    const promoInput = document.getElementById('cart-promo-input');
    if (promoInput) promoInput.value ='';

    cartDiscountType ='LOYALTY';
    cartLoyaltyPointsRedeemed = pts;

    cartLoyaltyCardToken ='';
    cartPromoCode ='';
    cartActivePromo = null;
    cartSeniorPwdId ='';

    discountInput.value = discountAmount.toFixed(2);
    discountInput.setAttribute('readonly', true);
    if (input) input.value = pts;
    updateCartTotals();
    Swal.fire({ icon:'success', title:'Points Redeemed!', text: `${pts} pts: -₱${discountAmount.toFixed(2)}`, timer: 1600, showConfirmButton: false });
}

function resetCartDiscountAndCustomerState() {
    cartDiscountType ='NONE';
    cartPromoCode ='';
    cartActivePromo = null;
    cartSeniorPwdId ='';
    cartLoyaltyPointsRedeemed = 0;
    cartLoyaltyCardToken ='';
    selectedCartCustomer = null;

    const discountInput = document.getElementById('cart-discount-input');
    if (discountInput) { discountInput.value = 0; discountInput.removeAttribute('readonly'); }
    const promoInput = document.getElementById('cart-promo-input');
    if (promoInput) promoInput.value ='';
    const seniorCheckbox = document.getElementById('cart-senior-pwd-toggle');
    if (seniorCheckbox) seniorCheckbox.checked = false;
    const customerBtn = document.getElementById('cart-customer-btn');
    if (customerBtn) customerBtn.innerHTML ='Walk-in <i class="fa-solid fa-chevron-right" style="font-size:0.7em;"></i>';
    const loyaltyRow = document.getElementById('cart-loyalty-row');
    if (loyaltyRow) loyaltyRow.style.display ='none';
    const loyaltyInput = document.getElementById('cart-loyalty-input');
    if (loyaltyInput) loyaltyInput.value ='';
    const loyaltyBadge = document.getElementById('cart-loyalty-card-badge');
    if (loyaltyBadge) loyaltyBadge.style.display ='none';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display ='none';

    if (modalId ==='receipt-modal') document.body.classList.remove('print-target-receipt');
    if (modalId ==='barcode-preview-modal') document.body.classList.remove('print-target-barcode');
}

function cancelPaymentModal() {
    closeModal('payment-modal');
    pendingCreditDebtDraft = null;
    if (typeof updateCartTotals ==='function') updateCartTotals();
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    const allMethodBtns = { CASH:'pay-method-cash', GCASH:'pay-method-gcash', MAYA:'pay-method-maya', CARD:'pay-method-card', CCREDIT:'pay-method-ccredit' };
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

    updateEwalletQrBlockVisibility(method);

    if (method ==='CCREDIT') {
        promptCreditDebtDraft();
    } else {
        pendingCreditDebtDraft = null;
    }
}

// Called when the cashier selects "C-Credit" (Customer Credit / utang) as the
// payment method. Opens the same-style "Add Debt" form used on the Debtors
// page — pre-filled from the customer already selected in the Customer pane
// (if any), leaving only Note and Due Date for the cashier to fill in. If a
// walk-in (no customer selected), the Name/Phone fields are left blank/editable.
async function promptCreditDebtDraft() {
    if (guardPremiumFeature('customer_crm')) {
        selectPaymentMethod('CASH');
        return;
    }

    let dueAmount = parseFloat((document.getElementById('pay-modal-amount-due') || {}).innerText?.replace('₱','')) || 0;
    const cust = selectedCartCustomer;
    const nameVal = cust ? (cust.name ||'') :'';
    const phoneVal = cust ? (cust.phone ||'') :'';
    const nameLocked = !!(cust && cust.name);

    const { value: formValues } = await Swal.fire({
        title:'Add Debt (Customer Credit)',
        html: `
            <p style="text-align:left;color:#94a3b8;font-size:0.85rem;margin:0 0 8px;">Ang bentang ito ay ipapasok sa <b>Debtors</b> sa halip na cash/e-wallet/card.</p>
            <input type="text" id="swal-credit-name" class="swal2-input" placeholder="Debtor's Full Name" value="${escapeHtml(nameVal)}" ${nameLocked ? 'readonly style="background:#f1f5f9;"' : ''}>
            <input type="text" id="swal-credit-phone" class="swal2-input" placeholder="Phone Number (optional)" value="${escapeHtml(phoneVal)}">
            <input type="text" class="swal2-input" value="₱${dueAmount.toFixed(2)}" readonly style="background:#f1f5f9;" title="Amount owed = sale total">
            <textarea id="swal-credit-note" class="swal2-textarea" placeholder="Note (hal. dahilan, kailan babayaran, atbp.)"></textarea>
            <label style="display:block;text-align:left;font-size:0.85rem;color:#94a3b8;margin-top:6px;">Due Date/Time (kailan babayaran):</label>
            <input type="datetime-local" id="swal-credit-due" class="swal2-input">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText:'Save & Continue',
        cancelButtonText:'Cancel',
        allowOutsideClick: false,
        preConfirm: () => {
            const name = document.getElementById('swal-credit-name').value.trim();
            if (!name) {
                Swal.showValidationMessage("Kailangan ng pangalan ng debtor.");
                return false;
            }
            return {
                customerName: name,
                phone: document.getElementById('swal-credit-phone').value.trim(),
                note: document.getElementById('swal-credit-note').value.trim(),
                dueAt: document.getElementById('swal-credit-due').value || null
            };
        }
    });

    if (!formValues) {
        // Cashier backed out of providing debt info — fall back to Cash so the
        // payment modal isn't left in a half-configured C-Credit state.
        selectPaymentMethod('CASH');
        return;
    }

    pendingCreditDebtDraft = formValues;
}

function updateEwalletQrBlockVisibility(method) {
    const block = document.getElementById('pay-ewallet-qr-block');
    if (!block) return;

    const isEwallet = method ==='GCASH' || method ==='MAYA';
    block.style.display = isEwallet ?'block' :'none';
    if (!isEwallet) {

        if (typeof updateCartTotals ==='function') updateCartTotals();
        return;
    }

    const imgWrap = document.getElementById('pay-ewallet-qr-img-wrap');
    const missingEl = document.getElementById('pay-ewallet-qr-missing');
    const imgEl = document.getElementById('pay-ewallet-qr-img');
    const labelEl = document.getElementById('pay-ewallet-qr-label');

    const qrImage = method ==='GCASH'
        ? (storeSettingsCache && storeSettingsCache.gcashQrImage)
        : (storeSettingsCache && storeSettingsCache.mayaQrImage);

    if (labelEl) labelEl.innerText = method ==='GCASH' ?'GCash' :'Maya';

    if (qrImage) {
        if (imgEl) imgEl.src = qrImage;
        if (imgWrap) imgWrap.style.display ='block';
        if (missingEl) missingEl.style.display ='none';
    } else {
        if (imgWrap) imgWrap.style.display ='none';
        if (missingEl) missingEl.style.display ='block';
    }

    let dueAmount = parseFloat((document.getElementById('pay-modal-amount-due') || {}).innerText?.replace('₱','')) || 0;
    broadcastCustomerDisplay('ewallet', { method, qrImage: qrImage || null, amount: dueAmount });
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

    if (splitPaymentMode) {
        syncSplitPaymentEwalletDisplay();
    } else if (typeof updateEwalletQrBlockVisibility ==='function') {
        updateEwalletQrBlockVisibility(selectedPaymentMethod);
    }
}

function addSplitPaymentLine() {
    splitPaymentLines.push({ method:'CASH', amount: 0, reference:'' });
    renderSplitPaymentLines();
}

function removeSplitPaymentLine(idx) {
    splitPaymentLines.splice(idx, 1);
    renderSplitPaymentLines();
    syncSplitPaymentEwalletDisplay();
}

function setSplitPaymentLineMethod(idx, method) {
    if (!splitPaymentLines[idx]) return;
    splitPaymentLines[idx].method = method;
    renderSplitPaymentLines();
    syncSplitPaymentEwalletDisplay();
}

function setSplitPaymentLineReference(idx, rawValue) {
    if (!splitPaymentLines[idx]) return;
    splitPaymentLines[idx].reference = rawValue;
}

function setSplitPaymentLineAmount(idx, rawValue) {
    if (!splitPaymentLines[idx]) return;
    splitPaymentLines[idx].amount = Math.max(0, parseFloat(rawValue) || 0);
    recalcSplitPaymentTotals();
    syncSplitPaymentEwalletDisplay();
}

function syncSplitPaymentEwalletDisplay() {
    if (!splitPaymentMode) return;
    const ewalletLine = [...splitPaymentLines].reverse().find(l => l.method ==='GCASH' || l.method ==='MAYA');
    if (!ewalletLine) {
        if (typeof updateCartTotals ==='function') updateCartTotals();
        return;
    }
    const qrImage = ewalletLine.method ==='GCASH'
        ? (storeSettingsCache && storeSettingsCache.gcashQrImage)
        : (storeSettingsCache && storeSettingsCache.mayaQrImage);
    broadcastCustomerDisplay('ewallet', {
        method: ewalletLine.method,
        qrImage: qrImage || null,
        amount: parseFloat(ewalletLine.amount) || 0
    });
}

function renderSplitPaymentLines() {
    const listEl = document.getElementById('split-payment-lines-list');
    if (!listEl) return;
    listEl.innerHTML = splitPaymentLines.map((line, idx) => {
        const isEwallet = line.method ==='GCASH' || line.method ==='MAYA';

        const refRow = isEwallet ? `
            <input type="text" value="${escapeHtml(line.reference ||'')}" placeholder="Reference/transaction number"
                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;margin-top:6px;"
                   oninput="setSplitPaymentLineReference(${idx}, this.value)">
        ` :'';
        return `
        <div class="split-payment-line-row" style="margin-bottom:8px;">
            <div style="display:flex;gap:8px;align-items:center;">
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
            ${refRow}
        </div>
    `; }).join('');
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
    const ewalletRefInput = document.getElementById('pay-ewallet-reference-input');
    if (ewalletRefInput) ewalletRefInput.value ='';

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

    paymentSubmissionInProgress = false;
    const confirmBtnReset = document.getElementById('pay-modal-confirm-btn');
    if (confirmBtnReset) confirmBtnReset.disabled = false;
}

let paymentSubmissionInProgress = false;

async function submitFinalPaymentTransaction() {
    if (paymentSubmissionInProgress) return;
    paymentSubmissionInProgress = true;
    const confirmBtn = document.getElementById('pay-modal-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;
    try {
        await submitFinalPaymentTransactionInner();
    } finally {
        paymentSubmissionInProgress = false;
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

async function submitFinalPaymentTransactionInner() {
    let dueAmount = parseFloat(document.getElementById('pay-modal-amount-due').innerText.replace('₱',''));
    let received, change, paymentMethodLabel, payments = null;

    if (!splitPaymentMode && selectedPaymentMethod ==='CCREDIT' && !pendingCreditDebtDraft) {
        Swal.fire('Kailangan ng Debt Info','Punan muna ang detalye ng utang bago magpatuloy.','warning');
        return;
    }

    if (splitPaymentMode) {

        const activeLines = splitPaymentLines.filter(l => (parseFloat(l.amount) || 0) > 0);
        if (activeLines.length < 1) {
            Swal.fire('Validation Error','Enter an amount for at least one payment method.','error');
            return;
        }
        const allocated = Math.round(activeLines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0) * 100) / 100;
        if (allocated < dueAmount) {
            Swal.fire('Validation Error', `Payment validation exception: Still short by ₱${(dueAmount - allocated).toFixed(2)} in the split payment allocation.`,'error');
            return;
        }

        const lineMissingRef = activeLines.find(l => (l.method ==='GCASH' || l.method ==='MAYA') && !String(l.reference ||'').trim());
        if (lineMissingRef) {
            Swal.fire('Validation Error', `Enter the reference/transaction number for the ${lineMissingRef.method} payment.`, 'error');
            return;
        }

        payments = activeLines.map(l => ({
            method: l.method,
            amount: Math.round((parseFloat(l.amount) || 0) * 100) / 100,
            reference: (l.method ==='GCASH' || l.method ==='MAYA') ? String(l.reference ||'').trim() : undefined
        }));
        received = allocated;
        change = Math.round((allocated - dueAmount) * 100) / 100;
        paymentMethodLabel ='SPLIT';
    } else {
        received = parseFloat(document.getElementById('pay-modal-received-input').value) || 0;
        if (received < dueAmount) {
            Swal.fire('Validation Error','Payment validation exception: Tender value below transaction charge subtotal.','error');
            return;
        }

        let ewalletReference ='';
        if (selectedPaymentMethod ==='GCASH' || selectedPaymentMethod ==='MAYA') {
            const refInput = document.getElementById('pay-ewallet-reference-input');
            ewalletReference = refInput ? refInput.value.trim() :'';
            if (!ewalletReference) {
                Swal.fire('Validation Error', `Enter the reference/transaction number for the ${selectedPaymentMethod === 'GCASH' ? 'GCash' : 'Maya'} payment.`, 'error');
                return;
            }
        }

        change = received - dueAmount;
        paymentMethodLabel = selectedPaymentMethod;

        payments = [{ method: selectedPaymentMethod, amount: received, reference: ewalletReference || undefined }];
    }

    let discount = parseFloat(document.getElementById('cart-discount-input').value) || 0;

    const itemDiscountSum = shoppingCart.reduce((s, i) => s + Math.max(0, parseFloat(i.itemDiscount) || 0), 0);
    const manualDiscountTotal = Math.round((itemDiscountSum + (cartDiscountType ==='MANUAL' ? discount : 0)) * 100) / 100;
    let discountAuthPassword = null;

    if (manualDiscountTotal > 0) {
        const { value: pw } = await Swal.fire({
            title:'🔒 Manual Discount Authorization',
            html: `This sale has a manual discount of <b>₱${manualDiscountTotal.toFixed(2)}</b>. An Admin or Supervisor password is required to authorize it:`,
            input:'password',
            inputPlaceholder:'Password',
            showCancelButton: true,
            confirmButtonColor:'#2563eb',
            cancelButtonColor:'#ef4444'
        });

        if (!pw || pw.trim() ==='') {
            Swal.fire('Cancelled','Authorization is required to proceed with a sale that has a manual discount.','info');
            return;
        }

        try {
            const verifyRes = await authFetch(`${API_URL}/auth/verify-void`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ adminPassword: pw, purpose:'manual_discount' })
            });
            const verifyOut = await verifyRes.json();
            if (!verifyOut.success) {
                Swal.fire('Access Denied', verifyOut.message ||'Incorrect password.','error');
                return;
            }
        } catch (verifyErr) {
            console.warn(verifyErr);
            Swal.fire('Connection Error','Unable to verify the password right now. Please try again.','error');
            return;
        }

        discountAuthPassword = pw;
    }

    let loyaltyAuthPassword = null;
    if (cartDiscountType ==='LOYALTY' && cartLoyaltyPointsRedeemed > 0 && !cartLoyaltyCardToken) {
        const { value: lpw } = await Swal.fire({
            title:'🔒 Manual Loyalty Redemption Authorization',
            html: `Walang na-scan na Loyalty Card/QR. Kailangan ng Admin o Supervisor password para paunahan ang manual na pag-redeem ng <b>${cartLoyaltyPointsRedeemed} pts</b>:`,
            input:'password',
            inputPlaceholder:'Password',
            showCancelButton: true,
            confirmButtonColor:'#2563eb',
            cancelButtonColor:'#ef4444'
        });

        if (!lpw || lpw.trim() ==='') {
            Swal.fire('Cancelled', "Scan the customer's Loyalty Card/QR, or obtain an authorization password to continue.", 'info');
            return;
        }

        try {
            const lVerifyRes = await authFetch(`${API_URL}/auth/verify-void`, {
                method:'POST',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ adminPassword: lpw, purpose:'loyalty_redeem' })
            });
            const lVerifyOut = await lVerifyRes.json();
            if (!lVerifyOut.success) {
                Swal.fire('Access Denied', lVerifyOut.message ||'Incorrect password.','error');
                return;
            }
        } catch (lVerifyErr) {
            console.warn(lVerifyErr);
            Swal.fire('Connection Error','Unable to verify the password right now. Please try again.','error');
            return;
        }

        loyaltyAuthPassword = lpw;
    }

    const txId = generateTransactionId(
        (receiptSettingsCache && receiptSettingsCache.transactionIdSettings && receiptSettingsCache.transactionIdSettings.format)
            || DEFAULT_TRANSACTION_ID_SETTINGS.format
    );

    const transactionPayload = {
        id: txId,
        cashier: currentUser.username,
        cashierDisplayName: currentUser.displayName || null,
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
        discountAuthPassword: discountAuthPassword,
        discountType: cartDiscountType,
        promoCode: cartDiscountType ==='PROMO' ? cartPromoCode :'',
        seniorPwdId: cartDiscountType ==='SENIOR_PWD' ? cartSeniorPwdId :'',
        loyaltyPointsRedeemed: cartDiscountType ==='LOYALTY' ? cartLoyaltyPointsRedeemed : 0,
        loyaltyCardToken: cartDiscountType ==='LOYALTY' ? (cartLoyaltyCardToken || null) : null,
        loyaltyAuthPassword: loyaltyAuthPassword,
        payment_method: paymentMethodLabel,
        method: paymentMethodLabel,
        amount_paid: received,
        received: received,
        change: change,

        payments: payments,

        paymentReference: (payments && payments.length === 1 && payments[0].reference) ? payments[0].reference : '',
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
            body: JSON.stringify({
                transaction: transactionPayload,
                username: currentUser.username,
                creditDebtInfo: (paymentMethodLabel ==='CCREDIT' && pendingCreditDebtDraft) ? pendingCreditDebtDraft : null
            })
        });
        const output = await res.json();

        if(output.success) {
            Swal.fire('Transaction Saved!', `Reference Code: ${txId}`,'success');
            {

                const savedTx = output.currentTransaction || transactionPayload;
                broadcastCustomerDisplay('paid', {
                    total: transactionPayload.total,
                    reference: txId,
                    customerName: savedTx.customerName || '',
                    loyaltyPointsEarned: savedTx.loyaltyPointsEarned || 0,
                    loyaltyPointsBalance: Number.isFinite(savedTx.loyaltyPointsBalance) ? savedTx.loyaltyPointsBalance : null
                });
            }

            transactionPayload.items.forEach(item => {
                let localProd = globalProducts.find(p => p.code === item.code);
                if (localProd) {
                    localProd.stock = Math.max(0, parseInt(localProd.stock || 0) - item.quantity);
                }
            });

            shoppingCart = [];
            renderCartRows();
            closeModal('payment-modal');

            currentReceiptLoyaltyQr = output.newLoyaltyCardToken
                ? { token: output.newLoyaltyCardToken, note: `New Loyalty QR ni ${selectedCartCustomer ? selectedCartCustomer.name :'customer'} — ito na ang gagamitin sa susunod na redemption.` }
                :null;

            await renderInvoiceReceipt(output.currentTransaction || transactionPayload);
            triggerAutoPrintIfEnabled();
            triggerAutoOpenCashDrawerIfEnabled(paymentMethodLabel, payments);

            if (output.newLoyaltyCardToken && typeof showLoyaltyCardQrDisplay ==='function') {
                showLoyaltyCardQrDisplay(output.newLoyaltyCardToken, selectedCartCustomer ? selectedCartCustomer.name :'', 'rotating',
                    'Naka-print na rin ang QR na ito sa resibo — ibigay/ipakita na lang ang resibo sa customer para sa susunod na redemption.',
                    true );
            }
            cartLoyaltyCardToken ='';

            localTransactionsList.unshift(output.currentTransaction || transactionPayload);
            localStorage.setItem('cached_transactions', JSON.stringify(localTransactionsList));

            if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();
            if (typeof loadTransactionsHistory ==='function') loadTransactionsHistory();

            if (output.debt) {
                pendingCreditDebtDraft = null;
                const debtsView = document.getElementById('view-debts');
                if (debtsView && debtsView.style.display !=='none' && typeof loadDebtsView ==='function') {
                    loadDebtsView();
                }
            }
        } else if (output.outOfStock) {

            Swal.fire('Out of Stock', output.message,'warning');
            if (typeof loadTerminalCatalog ==='function') loadTerminalCatalog();
        } else if (output.code ==='LOYALTY_AUTH_REQUIRED' || output.code ==='LOYALTY_CARD_INVALID') {
            Swal.fire('Loyalty Redemption Not Authorized', output.message,'warning');
        } else if (output.featureLocked) {
            // authFetch() already shows the premium-unlock prompt for 402 responses.
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

        let offlineTx = JSON.parse(localStorage.getItem('offline_transactions') ||'[]');
        offlineTx.push({ transaction: transactionPayload, username: currentUser.username });
        localStorage.setItem('offline_transactions', JSON.stringify(offlineTx));

        localTransactionsList.unshift(transactionPayload);
        localStorage.setItem('cached_transactions', JSON.stringify(localTransactionsList));

        shoppingCart = [];
        renderCartRows();
        closeModal('payment-modal');
        await renderInvoiceReceipt(transactionPayload);
        triggerAutoPrintIfEnabled();
        triggerAutoOpenCashDrawerIfEnabled(paymentMethodLabel, payments);

        if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();

        Swal.fire('Offline Stored','⚠️ Gateway Conn. Timeout: Central processing hub unreachable. The active transaction record is temporarily committed to local hardware.','warning');
    }
}

let currentReceiptLoyaltyQr = null;

let receiptSettingsCache = null;

const DEFAULT_TRANSACTION_ID_SETTINGS = { format: 'xs' };
const TRANSACTION_ID_FORMAT_INFO = {
    xs:       { label: 'Pinakaikli (Shortest)', chars: 4,  sample: null },
    sm:       { label: 'Maikli (Short)',        chars: 6,  sample: null },
    md:       { label: 'Katamtaman (Medium)',   chars: 8,  sample: null },
    lg:       { label: 'Mahaba (Long)',         chars: 12, sample: null },
    original: { label: 'Orihinal (Longest — dating default)', chars: null, sample: null }
};

function generateShortAlphaNumId(len) {
    const timePart = Date.now().toString(36).toUpperCase();
    const randPart = Math.random().toString(36).slice(2).toUpperCase()
        + Math.random().toString(36).slice(2).toUpperCase();
    const combined = (timePart + randPart).replace(/[^A-Z0-9]/g, '');
    return combined.slice(-len).padStart(len, '0');
}

function generateTransactionId(format) {
    switch (format) {
        case 'sm': return generateShortAlphaNumId(6);
        case 'md': return 'TX' + generateShortAlphaNumId(6);
        case 'lg': return 'TX-' + generateShortAlphaNumId(9);

        case 'original': return 'TX-' + Date.now();
        case 'xs':
        default: return generateShortAlphaNumId(4);
    }
}

function saveAutoPrintPreference() {
    const toggle = document.getElementById('rc-auto-print-toggle');
    localStorage.setItem('omnipos_auto_print_receipt', toggle && toggle.checked ?'true' :'false');
    if (typeof Swal !=='undefined') {
        Swal.fire({ toast:true, position:'top-end', icon:'success', title: toggle && toggle.checked ?'Auto-print enabled' :'Auto-print disabled', showConfirmButton:false, timer:1500 });
    }
}

function saveAutoCutPreference() {
    const toggle = document.getElementById('rc-auto-cut-toggle');
    localStorage.setItem('omnipos_bt_autocut', toggle && toggle.checked ?'true' :'false');
    if (typeof Swal !=='undefined') {
        Swal.fire({ toast:true, position:'top-end', icon:'success', title: toggle && toggle.checked ?'Auto-cut enabled' :'Auto-cut disabled', showConfirmButton:false, timer:1500 });
    }
}

function saveAutoOpenDrawerPreference() {
    const toggle = document.getElementById('rc-auto-cash-drawer-toggle');
    localStorage.setItem('omnipos_auto_open_drawer', toggle && toggle.checked ?'true' :'false');
    if (typeof Swal !=='undefined') {
        Swal.fire({ toast:true, position:'top-end', icon:'success', title: toggle && toggle.checked ?'Auto-open cash drawer enabled' :'Auto-open cash drawer disabled', showConfirmButton:false, timer:1500 });
    }
}

function isAutoOpenDrawerEnabled() {
    return localStorage.getItem('omnipos_auto_open_drawer') !=='false';
}

// A cash drawer is almost never wired directly to the computer/tablet — it's cabled
// (RJ11/RJ12) into the back of the receipt printer instead. Opening it automatically
// means sending a tiny "kick" command (industry-standard ESC/POS: 1B 70 00 19 FA) to
// that connected printer, which then pulses power down the cable to trip the drawer's
// solenoid latch. Since OmniPOS's only direct hardware channel today is the paired
// Bluetooth thermal printer (see bt-printer.js), that's the path used here — the
// regular browser Print dialog (window.print) has no way to reach real printer
// hardware directly, so a drawer wired to a printer used only via that dialog can't
// be triggered from here. Only fires for Cash (or a Cash portion of a Split payment),
// mirroring how real POS terminals only pop the drawer when actual cash changes hands.
function triggerAutoOpenCashDrawerIfEnabled(paymentMethodLabel, payments) {
    if (!isAutoOpenDrawerEnabled()) return;

    const hasCashPortion = paymentMethodLabel ==='CASH' ||
        (Array.isArray(payments) && payments.some(p => p && p.method ==='CASH'));
    if (!hasCashPortion) return;

    setTimeout(() => {
        try {
            if (typeof openCashDrawerViaBluetooth ==='function') {
                openCashDrawerViaBluetooth();
            }
        } catch (e) { console.warn('Auto-open cash drawer failed:', e); }
    }, 150);
}

function triggerAutoPrintIfEnabled() {
    if (localStorage.getItem('omnipos_auto_print_receipt') !=='true') return;

    setTimeout(() => {
        try {
            if (typeof btPrinterCharacteristic !=='undefined' && btPrinterCharacteristic &&
                typeof printReceiptViaBluetooth ==='function') {
                printReceiptViaBluetooth('r');
            } else {
                window.print();
            }
        } catch (e) { console.error('Auto-print failed:', e); }
    }, 150);
}

function printCurrentReceipt() {
    setTimeout(() => window.print(), 120);
}

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

    const applyHeaderMode = (titleId, imageId) => {
        const titleEl = document.getElementById(titleId);
        const imgEl = document.getElementById(imageId);
        const useImage = s.headerType ==='image' && !!s.headerImage;

        if (useImage && imgEl) {
            applyReceiptHeaderImageStyle(imgEl, s.headerImage, s.headerImageStyle);
            if (titleEl) titleEl.style.display ='none';
        } else {
            if (imgEl) { imgEl.style.display ='none'; imgEl.removeAttribute('src'); }
            if (titleEl) titleEl.style.display ='';

            document.documentElement.style.setProperty('--receipt-paper-padding-top','10px');
        }
    };

    const storeNameDisplay = (s.advancedSettings && s.advancedSettings.uppercaseStoreName)
        ? (s.storeName ||'').toUpperCase()
        : s.storeName;

    setTextIfExists('r-store-title', storeNameDisplay);
    setTextIfExists('r-store-address', s.storeAddress);
    setTextIfExists('r-store-contact', s.storeContact);
    setOptionalLine('r-header-text', s.headerText);
    setTextIfExists('r-footer-msg', s.footerText);
    applyHeaderMode('r-store-title', 'r-header-image');

    setTextIfExists('rp-store-title', storeNameDisplay);
    setTextIfExists('rp-store-address', s.storeAddress);
    setTextIfExists('rp-store-contact', s.storeContact);
    setOptionalLine('rp-header-text', s.headerText);
    setTextIfExists('rp-footer-msg', s.footerText);
    applyHeaderMode('rp-store-title', 'rp-header-image');

    const barcodeContainer = document.querySelector('#printable-receipt-area .receipt-barcode-container');
    if (barcodeContainer) {
        const showBarcode = !s.barcodeSettings || s.barcodeSettings.show !== false;
        barcodeContainer.style.display = showBarcode ?'' :'none';
    }

    applyReceiptAdvancedStyleToElement(document.getElementById('printable-receipt-area'), s.advancedSettings);
    const previewPaper = document.querySelector('#receipt-preview-modal .receipt-paper-layout');
    if (previewPaper) applyReceiptAdvancedStyleToElement(previewPaper, s.advancedSettings);

    applyTaiwanTemplateWidthToElement(document.getElementById('printable-receipt-area'), s.taiwanTemplateSettings);
}

const DEFAULT_ADVANCED_RECEIPT_SETTINGS = {
    fontSize:'normal', divider:'dashed', accentColor:'#000000',
    boldTotal: true, uppercaseStoreName: false,

    itemDetailGapPx: 0,

    itemCounterGapTopPx: 6,
    itemCounterGapBottomPx: 6,
    metaRowGapPx: 4,
    itemsRowGapPx: 6,
    totalsRowGapPx: 4
};

function applyReceiptAdvancedStyleToElement(paperEl, settings) {
    if (!paperEl) return;
    const st = Object.assign({}, DEFAULT_ADVANCED_RECEIPT_SETTINGS, settings || {});

    paperEl.classList.remove('receipt-fontsize-small','receipt-fontsize-normal','receipt-fontsize-large');
    paperEl.classList.add(`receipt-fontsize-${['small','normal','large'].includes(st.fontSize) ? st.fontSize :'normal'}`);

    paperEl.classList.remove('receipt-divider-dashed','receipt-divider-solid','receipt-divider-dotted','receipt-divider-none');
    paperEl.classList.add(`receipt-divider-${['dashed','solid','dotted','none'].includes(st.divider) ? st.divider :'dashed'}`);

    paperEl.classList.toggle('receipt-total-emphasis', !!st.boldTotal);
    paperEl.style.setProperty('--receipt-accent-color', /^#[0-9a-fA-F]{6}$/.test(st.accentColor) ? st.accentColor :'#000000');

    paperEl.style.setProperty('--receipt-item-detail-gap', `${Math.max(0, Math.min(40, Number(st.itemDetailGapPx) || 0))}px`);

    paperEl.style.setProperty('--receipt-item-counter-gap-top', `${Math.max(0, Math.min(40, Number(st.itemCounterGapTopPx) ?? 6))}px`);
    paperEl.style.setProperty('--receipt-item-counter-gap-bottom', `${Math.max(0, Math.min(40, Number(st.itemCounterGapBottomPx) ?? 6))}px`);
    paperEl.style.setProperty('--receipt-meta-row-gap', `${Math.max(0, Math.min(20, Number(st.metaRowGapPx) ?? 4))}px`);
    paperEl.style.setProperty('--receipt-items-row-gap', `${Math.max(0, Math.min(20, Number(st.itemsRowGapPx) ?? 6))}px`);
    paperEl.style.setProperty('--receipt-totals-row-gap', `${Math.max(0, Math.min(20, Number(st.totalsRowGapPx) ?? 4))}px`);
}

const DEFAULT_HEADER_IMAGE_STYLE = {
    widthPct: 55, align:'center', maxHeightPx: 90, opacityPct: 100,
    grayscale: false, cornerRadiusPx: 0, marginTopPx: 10, marginBottomPx: 8,

    lineSpacingPx: 2
};

function applyReceiptHeaderImageStyle(imgEl, src, style) {
    if (!imgEl) return;
    const st = Object.assign({}, DEFAULT_HEADER_IMAGE_STYLE, style || {});

    const marginTopPx = Math.max(0, Number(st.marginTopPx) || 0);
    document.documentElement.style.setProperty('--receipt-paper-padding-top', `${marginTopPx}px`);

    document.documentElement.style.setProperty('--receipt-subline-gap', `${Math.max(0, Number(st.lineSpacingPx) || 0)}px`);

    imgEl.src = src ||'';
    imgEl.style.display = src ?'block' :'none';
    imgEl.style.width = `${st.widthPct}%`;
    imgEl.style.maxHeight = `${st.maxHeightPx}px`;
    imgEl.style.opacity = String(Math.max(0, Math.min(100, st.opacityPct)) / 100);
    imgEl.style.filter = st.grayscale ?'grayscale(100%)' :'none';
    imgEl.style.borderRadius = `${st.cornerRadiusPx}px`;
    imgEl.style.marginTop ='0';
    imgEl.style.marginBottom = `${st.marginBottomPx}px`;

    if (st.align ==='left') {
        imgEl.style.marginLeft ='0';
        imgEl.style.marginRight ='auto';
    } else if (st.align ==='right') {
        imgEl.style.marginLeft ='auto';
        imgEl.style.marginRight ='0';
    } else {
        imgEl.style.marginLeft ='auto';
        imgEl.style.marginRight ='auto';
    }
}

function applyActivePrintPageSize() {

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

    document.body.classList.toggle('print-target-receipt', !!isPrintingReceipt);
    document.body.classList.toggle('print-target-barcode', !!isPrintingBarcode);

    if (isPrintingReceipt) {

        styleTag.innerHTML = `@page { size: auto; margin: 0; }`;
    } else if (isPrintingBarcode) {

        styleTag.innerHTML = `@page { size: auto; margin: 8mm; }`;
    } else {

        styleTag.innerHTML ='';
    }
}

window.addEventListener('beforeprint', applyActivePrintPageSize);
window.addEventListener('afterprint', () => {
    const styleTag = document.getElementById('dynamic-print-style');
    if (styleTag) styleTag.innerHTML ='';

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

    const hiStyle = Object.assign({}, DEFAULT_HEADER_IMAGE_STYLE, s.headerImageStyle || {});
    const imgValueField = document.getElementById('rc-form-header-image-value');
    if (imgValueField) imgValueField.value = s.headerType ==='image' ? (s.headerImage ||'') :'';

    const setRange = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setRange('rc-hi-width', hiStyle.widthPct);
    setVal('rc-hi-align', hiStyle.align);
    setRange('rc-hi-maxheight', hiStyle.maxHeightPx);
    setRange('rc-hi-opacity', hiStyle.opacityPct);
    setRange('rc-hi-radius', hiStyle.cornerRadiusPx);
    setRange('rc-hi-margintop', Math.max(0, Number(hiStyle.marginTopPx) || 0));
    setRange('rc-hi-marginbottom', hiStyle.marginBottomPx);
    setRange('rc-hi-linespacing', hiStyle.lineSpacingPx);
    const grayscaleBox = document.getElementById('rc-hi-grayscale');
    if (grayscaleBox) grayscaleBox.checked = !!hiStyle.grayscale;

    switchReceiptHeaderType(s.headerType ==='image' ?'image' :'text',  true);

    const previewWrap = document.getElementById('rc-header-image-preview-wrap');
    const settingsBox = document.getElementById('rc-header-image-settings');
    if (s.headerType ==='image' && s.headerImage) {
        if (previewWrap) previewWrap.style.display ='block';
        if (settingsBox) settingsBox.style.display ='block';
        updateReceiptHeaderImagePreview();
    } else {
        if (previewWrap) previewWrap.style.display ='none';
        if (settingsBox) settingsBox.style.display ='none';
    }

    const bset = Object.assign({}, DEFAULT_RECEIPT_BARCODE_SETTINGS, s.barcodeSettings || {});
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    setChecked('bset-r-show', bset.show);
    setRange('bset-r-width', bset.width);
    setRange('bset-r-height', bset.height);
    setRange('bset-r-margin', bset.margin);
    setChecked('bset-r-displayvalue', bset.displayValue);
    setRange('bset-r-fontsize', bset.fontSize);
    updateReceiptBarcodeSettingsPreview();

    const aset = Object.assign({}, DEFAULT_ADVANCED_RECEIPT_SETTINGS, s.advancedSettings || {});
    setVal('aset-fontsize', aset.fontSize);
    setVal('aset-divider', aset.divider);
    setVal('aset-accent-color', aset.accentColor);
    setChecked('aset-bold-total', aset.boldTotal);
    setChecked('aset-uppercase-store', aset.uppercaseStoreName);
    setRange('aset-item-detail-gap', aset.itemDetailGapPx);

    setRange('aset-item-counter-gap-top', aset.itemCounterGapTopPx);
    setRange('aset-item-counter-gap-bottom', aset.itemCounterGapBottomPx);
    setRange('aset-meta-row-gap', aset.metaRowGapPx);
    setRange('aset-items-row-gap', aset.itemsRowGapPx);
    setRange('aset-totals-row-gap', aset.totalsRowGapPx);
    previewReceiptAdvancedSettings();

    const qset = Object.assign({}, DEFAULT_LOYALTY_QR_SETTINGS, s.loyaltyQrSettings || {});
    setChecked('qset-enabled', qset.enabled);
    setRange('qset-sizepx', qset.sizePx);
    setRange('qset-modulesize', qset.moduleSize);
    setChecked('qset-shownote', qset.showNote);
    setVal('qset-correctlevel', qset.correctLevel);
    setRange('qset-qrgap', qset.gapPx);
    setVal('qset-notetext', qset.noteText);
    setChecked('qset-showdivider', qset.showDivider);
    setChecked('qset-doublecopy', qset.doubleCopy);
    setRange('qset-copygap', qset.copyGapPx);
    setLoyaltyQrPosition(qset.position,  true);
    setLoyaltyQrPrinterTarget(qset.printOn,  true);
    updateLoyaltyQrSettingsPreview();

    const twset = Object.assign({}, DEFAULT_TAIWAN_TEMPLATE_SETTINGS, s.taiwanTemplateSettings || {});
    setChecked('twset-enabled', twset.enabled);
    setRange('twset-widthmm', twset.widthMm);
    updateTaiwanTemplateSettingsPreview();

    const tidset = Object.assign({}, DEFAULT_TRANSACTION_ID_SETTINGS, s.transactionIdSettings || {});
    setVal('rc-form-txnid-format', tidset.format);
    updateTransactionIdFormatPreview();

    const autoPrintToggle = document.getElementById('rc-auto-print-toggle');
    if (autoPrintToggle) autoPrintToggle.checked = localStorage.getItem('omnipos_auto_print_receipt') ==='true';
    const autoCutToggle = document.getElementById('rc-auto-cut-toggle');
    if (autoCutToggle) autoCutToggle.checked = localStorage.getItem('omnipos_bt_autocut') !=='false';
    const autoDrawerToggle = document.getElementById('rc-auto-cash-drawer-toggle');
    if (autoDrawerToggle) autoDrawerToggle.checked = localStorage.getItem('omnipos_auto_open_drawer') !=='false';

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

const DEFAULT_RECEIPT_BARCODE_SETTINGS = {
    show: true, width: 1.5, height: 40, margin: 0, displayValue: true, fontSize: 11
};

function collectReceiptBarcodeSettingsFromForm() {
    const getRange = (id, fallback) => {
        const el = document.getElementById(id);
        return el ? Number(el.value) : fallback;
    };
    const showEl = document.getElementById('bset-r-show');
    const dvEl = document.getElementById('bset-r-displayvalue');
    return {
        show: showEl ? !!showEl.checked : DEFAULT_RECEIPT_BARCODE_SETTINGS.show,
        width: getRange('bset-r-width', DEFAULT_RECEIPT_BARCODE_SETTINGS.width),
        height: getRange('bset-r-height', DEFAULT_RECEIPT_BARCODE_SETTINGS.height),
        margin: getRange('bset-r-margin', DEFAULT_RECEIPT_BARCODE_SETTINGS.margin),
        displayValue: dvEl ? !!dvEl.checked : DEFAULT_RECEIPT_BARCODE_SETTINGS.displayValue,
        fontSize: getRange('bset-r-fontsize', DEFAULT_RECEIPT_BARCODE_SETTINGS.fontSize)
    };
}

function updateReceiptBarcodeSettingsPreview() {
    const settings = collectReceiptBarcodeSettingsFromForm();

    const fieldsWrap = document.getElementById('bset-r-fields-wrap');
    if (fieldsWrap) fieldsWrap.style.opacity = settings.show ?'1' :'0.4';

    const fontSizeWrap = document.getElementById('bset-r-fontsize-wrap');
    if (fontSizeWrap) fontSizeWrap.style.display = settings.displayValue ?'block' :'none';

    const setLabel = (id, val, suffix) => {
        const el = document.getElementById(id);
        if (el) el.textContent = `(${val}${suffix})`;
    };
    setLabel('bset-r-width-val', settings.width,'px');
    setLabel('bset-r-height-val', settings.height,'px');
    setLabel('bset-r-margin-val', settings.margin,'px');
    setLabel('bset-r-fontsize-val', settings.fontSize,'px');

    if (typeof JsBarcode ==='function') {
        try {
            JsBarcode('#bset-r-preview-svg','RCP-20260426-2641', {
                format:'CODE128',
                width: settings.width,
                height: settings.height,
                margin: settings.margin,
                displayValue: settings.displayValue,
                fontSize: settings.fontSize
            });
        } catch (err) {  }
    }
}

async function saveReceiptBarcodeSettings() {
    const barcodeSettings = collectReceiptBarcodeSettingsFromForm();
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    try {
        const res = await authFetch(`${API_URL}/receipt-settings/barcode`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ barcodeSettings, username })
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message ||'The barcode settings request has been submitted for Admin approval.','info');
        } else if (data.success) {
            Swal.fire('Saved!','The barcode settings have been updated.','success');
            receiptSettingsCache = data.settings || receiptSettingsCache;
            applyReceiptBranding();
        } else {
            Swal.fire('Error', data.message ||'Failed to save the barcode settings.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

function collectReceiptAdvancedSettingsFromForm() {
    const val = (id, fallback) => { const el = document.getElementById(id); return el ? el.value : fallback; };
    const checked = (id, fallback) => { const el = document.getElementById(id); return el ? !!el.checked : fallback; };
    const numVal = (id, fallback) => { const el = document.getElementById(id); return el ? (Number(el.value) || 0) : fallback; };
    return {
        fontSize: val('aset-fontsize', DEFAULT_ADVANCED_RECEIPT_SETTINGS.fontSize),
        divider: val('aset-divider', DEFAULT_ADVANCED_RECEIPT_SETTINGS.divider),
        accentColor: val('aset-accent-color', DEFAULT_ADVANCED_RECEIPT_SETTINGS.accentColor),
        boldTotal: checked('aset-bold-total', DEFAULT_ADVANCED_RECEIPT_SETTINGS.boldTotal),
        uppercaseStoreName: checked('aset-uppercase-store', DEFAULT_ADVANCED_RECEIPT_SETTINGS.uppercaseStoreName),
        itemDetailGapPx: numVal('aset-item-detail-gap', DEFAULT_ADVANCED_RECEIPT_SETTINGS.itemDetailGapPx),

        itemCounterGapTopPx: numVal('aset-item-counter-gap-top', DEFAULT_ADVANCED_RECEIPT_SETTINGS.itemCounterGapTopPx),
        itemCounterGapBottomPx: numVal('aset-item-counter-gap-bottom', DEFAULT_ADVANCED_RECEIPT_SETTINGS.itemCounterGapBottomPx),
        metaRowGapPx: numVal('aset-meta-row-gap', DEFAULT_ADVANCED_RECEIPT_SETTINGS.metaRowGapPx),
        itemsRowGapPx: numVal('aset-items-row-gap', DEFAULT_ADVANCED_RECEIPT_SETTINGS.itemsRowGapPx),
        totalsRowGapPx: numVal('aset-totals-row-gap', DEFAULT_ADVANCED_RECEIPT_SETTINGS.totalsRowGapPx)
    };
}

function previewReceiptAdvancedSettings() {
    const settings = collectReceiptAdvancedSettingsFromForm();
    const previewPaper = document.querySelector('#receipt-preview-modal .receipt-paper-layout');
    if (previewPaper) applyReceiptAdvancedStyleToElement(previewPaper, settings);
    const mainPaper = document.getElementById('printable-receipt-area');
    if (mainPaper) applyReceiptAdvancedStyleToElement(mainPaper, settings);

    const setLabel = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = `(${value}px)`; };
    setLabel('aset-item-detail-gap-val', settings.itemDetailGapPx);

    setLabel('aset-item-counter-gap-top-val', settings.itemCounterGapTopPx);
    setLabel('aset-item-counter-gap-bottom-val', settings.itemCounterGapBottomPx);
    setLabel('aset-meta-row-gap-val', settings.metaRowGapPx);
    setLabel('aset-items-row-gap-val', settings.itemsRowGapPx);
    setLabel('aset-totals-row-gap-val', settings.totalsRowGapPx);
}

async function saveReceiptAdvancedSettings() {
    const advancedSettings = collectReceiptAdvancedSettingsFromForm();
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    try {
        const res = await authFetch(`${API_URL}/receipt-settings/advanced`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ advancedSettings, username })
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message ||'The advanced style request has been submitted for Admin approval.','info');
        } else if (data.success) {
            Swal.fire('Saved!','The advanced receipt style has been updated.','success');
            receiptSettingsCache = data.settings || receiptSettingsCache;
            applyReceiptBranding();
        } else {
            Swal.fire('Error', data.message ||'Failed to save the advanced style.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

const DEFAULT_LOYALTY_QR_SETTINGS = {
    enabled: true, sizePx: 160, moduleSize: 6, position:'below_barcode', showNote: true,

    printOn:'all',

    correctLevel:'M',

    gapPx: 15,

    noteText: '',

    showDivider: true,

    doubleCopy: false,

    copyGapPx: 15
};

function applyLoyaltyQrPreset(preset) {
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    const setRange = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setChecked('qset-enabled', preset.enabled);
    setRange('qset-sizepx', preset.sizePx);
    setRange('qset-modulesize', preset.moduleSize);
    setChecked('qset-shownote', preset.showNote);
    setChecked('qset-showdivider', preset.showDivider);
    setChecked('qset-doublecopy', preset.doubleCopy);
    setRange('qset-copygap', preset.copyGapPx);
    setVal('qset-correctlevel', preset.correctLevel);
    setLoyaltyQrPosition(preset.position,  true);
    setLoyaltyQrPrinterTarget(preset.printOn,  true);
    updateLoyaltyQrSettingsPreview();
    if (typeof Swal !=='undefined') {
        Swal.fire({ toast:true, position:'top-end', icon:'info', title:'Preset applied — you still need to Save for it to take effect.', showConfirmButton:false, timer:2200 });
    }
}

function resetLoyaltyQrSettingsToDefault() { applyLoyaltyQrPreset(DEFAULT_LOYALTY_QR_SETTINGS); }

function setLoyaltyQrPosition(value, skipPreview) {
    const hiddenInput = document.getElementById('qset-position');
    if (hiddenInput) hiddenInput.value = value;
    document.querySelectorAll('#qset-position-segmented .qr-position-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-value') === value);
    });
    if (!skipPreview) updateLoyaltyQrSettingsPreview();
}

function setLoyaltyQrPrinterTarget(value, skipPreview) {
    const hiddenInput = document.getElementById('qset-printeron');
    if (hiddenInput) hiddenInput.value = value;
    document.querySelectorAll('#qset-printeron-segmented .qr-position-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-value') === value);
    });
    if (!skipPreview) updateLoyaltyQrSettingsPreview();
}

function collectLoyaltyQrSettingsFromForm() {
    const getRange = (id, fallback) => { const el = document.getElementById(id); return el ? Number(el.value) : fallback; };
    const checked = (id, fallback) => { const el = document.getElementById(id); return el ? !!el.checked : fallback; };
    const posEl = document.getElementById('qset-position');
    const printOnEl = document.getElementById('qset-printeron');
    const correctLevelEl = document.getElementById('qset-correctlevel');
    const noteTextEl = document.getElementById('qset-notetext');
    return {
        enabled: checked('qset-enabled', DEFAULT_LOYALTY_QR_SETTINGS.enabled),
        sizePx: getRange('qset-sizepx', DEFAULT_LOYALTY_QR_SETTINGS.sizePx),
        moduleSize: getRange('qset-modulesize', DEFAULT_LOYALTY_QR_SETTINGS.moduleSize),
        position: posEl ? posEl.value : DEFAULT_LOYALTY_QR_SETTINGS.position,
        showNote: checked('qset-shownote', DEFAULT_LOYALTY_QR_SETTINGS.showNote),
        printOn: printOnEl ? printOnEl.value : DEFAULT_LOYALTY_QR_SETTINGS.printOn,
        correctLevel: correctLevelEl ? correctLevelEl.value : DEFAULT_LOYALTY_QR_SETTINGS.correctLevel,
        gapPx: getRange('qset-qrgap', DEFAULT_LOYALTY_QR_SETTINGS.gapPx),
        noteText: noteTextEl ? noteTextEl.value.trim().slice(0, 120) : DEFAULT_LOYALTY_QR_SETTINGS.noteText,
        showDivider: checked('qset-showdivider', DEFAULT_LOYALTY_QR_SETTINGS.showDivider),
        doubleCopy: checked('qset-doublecopy', DEFAULT_LOYALTY_QR_SETTINGS.doubleCopy),
        copyGapPx: getRange('qset-copygap', DEFAULT_LOYALTY_QR_SETTINGS.copyGapPx)
    };
}

function resolveQrCorrectLevel(letter) {
    if (typeof QRCode ==='undefined') return undefined;
    const map = { L: QRCode.CorrectLevel.L, M: QRCode.CorrectLevel.M, Q: QRCode.CorrectLevel.Q, H: QRCode.CorrectLevel.H };
    return map[letter] !== undefined ? map[letter] : QRCode.CorrectLevel.M;
}

function updateLoyaltyQrSettingsPreview() {
    const settings = collectLoyaltyQrSettingsFromForm();

    const fieldsWrap = document.getElementById('qset-fields-wrap');
    if (fieldsWrap) fieldsWrap.style.opacity = settings.enabled ?'1' :'0.4';

    const setLabel = (id, val, suffix) => {
        const el = document.getElementById(id);
        if (el) el.textContent = `(${val}${suffix})`;
    };
    setLabel('qset-sizepx-val', settings.sizePx,'px');
    setLabel('qset-modulesize-val', settings.moduleSize,'');
    setLabel('qset-qrgap-val', settings.gapPx,'px');
    setLabel('qset-copygap-val', settings.copyGapPx,'px');

    const copyGapWrap = document.getElementById('qset-copygap-wrap');
    if (copyGapWrap) copyGapWrap.style.opacity = settings.doubleCopy ?'1' :'0.4';

    const noteTextWrap = document.getElementById('qset-notetext-wrap');
    if (noteTextWrap) noteTextWrap.style.opacity = settings.showNote ?'1' :'0.4';

    const noteEl = document.getElementById('qset-preview-note');
    if (noteEl) {
        noteEl.style.display = settings.showNote ?'block' :'none';
        noteEl.textContent = (settings.noteText && settings.noteText.trim())
            ? settings.noteText.trim()
            :'New Loyalty QR ni Sample Customer — ito na ang gagamitin sa susunod na redemption.';
    }

    const previewEl = document.getElementById('qset-preview-qr');
    if (previewEl) {
        previewEl.innerHTML ='';
        previewEl.style.gap = settings.doubleCopy ? (settings.copyGapPx +'px') :'0px';
        if (typeof QRCode !=='undefined') {
            const copies = settings.doubleCopy ? 2 : 1;
            for (let i = 0; i < copies; i++) {
                const slot = document.createElement('div');
                previewEl.appendChild(slot);
                new QRCode(slot, { text:'SAMPLE-LOYALTY-QR-TOKEN', width: settings.sizePx, height: settings.sizePx, correctLevel: resolveQrCorrectLevel(settings.correctLevel) });
            }
        }
    }
}

let currentReceiptLoyaltyQrPrintData = null;

function applyLoyaltyQrSettingsToDom(pendingQr) {
    const container = document.getElementById('r-loyalty-qr-container');
    if (!container) return;

    const settings = Object.assign({}, DEFAULT_LOYALTY_QR_SETTINGS, (receiptSettingsCache && receiptSettingsCache.loyaltyQrSettings) || {});

    if (!settings.enabled || !pendingQr || !pendingQr.token) {
        container.style.display ='none';
        currentReceiptLoyaltyQrPrintData = null;
        return;
    }

    const showOnScreenAndRegularPrint = settings.printOn !=='bluetooth';
    container.style.display = showOnScreenAndRegularPrint ?'' :'none';
    if (!showOnScreenAndRegularPrint) {

        const noteElHidden = document.getElementById('r-loyalty-qr-note');
        if (noteElHidden) noteElHidden.style.display ='none';
        const renderElHidden = document.getElementById('r-loyalty-qr-render');
        if (renderElHidden) renderElHidden.innerHTML ='';
        const dividerElHidden = document.getElementById('r-loyalty-qr-divider');
        if (dividerElHidden) dividerElHidden.style.display ='none';
        currentReceiptLoyaltyQrPrintData = (settings.printOn !=='regular')
            ? { token: pendingQr.token, note: settings.showNote ? ((settings.noteText && settings.noteText.trim()) || pendingQr.note ||'Loyalty QR (for next visit)') :'', moduleSize: settings.moduleSize, correctLevel: settings.correctLevel, copies: settings.doubleCopy ? 2 : 1 }
            : null;
        return;
    }

    const barcodeOuter = document.getElementById('r-barcode-outer-container');
    if (barcodeOuter && barcodeOuter.parentNode) {
        if (settings.position ==='above_barcode') {
            barcodeOuter.parentNode.insertBefore(container, barcodeOuter);
        } else {
            barcodeOuter.parentNode.insertBefore(container, barcodeOuter.nextSibling);
        }
    }

    if (barcodeOuter) {
        if (settings.position ==='above_barcode') {
            container.style.marginTop ='15px';
            container.style.marginBottom = settings.gapPx +'px';
            barcodeOuter.style.marginTop ='0px';
            barcodeOuter.style.marginBottom ='15px';
        } else {
            barcodeOuter.style.marginTop ='15px';
            barcodeOuter.style.marginBottom ='0px';
            container.style.marginTop = settings.gapPx +'px';
            container.style.marginBottom ='15px';
        }
    }

    const dividerEl = document.getElementById('r-loyalty-qr-divider');
    if (dividerEl) dividerEl.style.display = settings.showDivider ?'' :'none';

    const noteEl = document.getElementById('r-loyalty-qr-note');
    if (noteEl) {
        noteEl.style.display = settings.showNote ?'block' :'none';
        noteEl.innerText = (settings.noteText && settings.noteText.trim()) || pendingQr.note ||'Loyalty QR (for next visit)';
    }

    const renderEl = document.getElementById('r-loyalty-qr-render');
    if (renderEl) {
        renderEl.innerHTML ='';
        renderEl.style.gap = settings.doubleCopy ? (settings.copyGapPx +'px') :'0px';
        const copies = settings.doubleCopy ? 2 : 1;
        const slots = [];
        for (let i = 0; i < copies; i++) {
            const slot = document.createElement('div');
            renderEl.appendChild(slot);
            slots.push(slot);
        }
        setTimeout(() => {
            if (typeof QRCode !=='undefined') {
                slots.forEach((slot) => {
                    new QRCode(slot, { text: pendingQr.token, width: settings.sizePx, height: settings.sizePx, correctLevel: resolveQrCorrectLevel(settings.correctLevel) });
                });
            }
        }, 50);
    }

    currentReceiptLoyaltyQrPrintData = (settings.printOn !=='regular')
        ? {
            token: pendingQr.token,
            note: settings.showNote ? ((settings.noteText && settings.noteText.trim()) || pendingQr.note ||'Loyalty QR (for next visit)') :'',
            moduleSize: settings.moduleSize,
            correctLevel: settings.correctLevel,
            copies: settings.doubleCopy ? 2 : 1
        }
        : null;
}

async function saveLoyaltyQrSettings() {
    const loyaltyQrSettings = collectLoyaltyQrSettingsFromForm();
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    try {
        const res = await authFetch(`${API_URL}/receipt-settings/loyalty-qr`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ loyaltyQrSettings, username })
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message ||'The loyalty QR settings request has been submitted for Admin approval.','info');
        } else if (data.success) {
            Swal.fire('Saved!','The loyalty QR settings have been updated.','success');
            receiptSettingsCache = data.settings || receiptSettingsCache;
            applyReceiptBranding();
        } else {
            Swal.fire('Error', data.message ||'Failed to save the loyalty QR settings.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

const DEFAULT_TAIWAN_TEMPLATE_SETTINGS = { enabled: false, widthMm: 57 };

function collectTaiwanTemplateSettingsFromForm() {
    const enabledEl = document.getElementById('twset-enabled');
    const widthEl = document.getElementById('twset-widthmm');
    return {
        enabled: enabledEl ? !!enabledEl.checked : DEFAULT_TAIWAN_TEMPLATE_SETTINGS.enabled,
        widthMm: widthEl ? Number(widthEl.value) : DEFAULT_TAIWAN_TEMPLATE_SETTINGS.widthMm
    };
}

function updateTaiwanTemplateSettingsPreview() {
    const settings = collectTaiwanTemplateSettingsFromForm();
    const fieldsWrap = document.getElementById('twset-fields-wrap');
    if (fieldsWrap) fieldsWrap.style.opacity = settings.enabled ?'1' :'0.4';
    const label = document.getElementById('twset-widthmm-val');
    if (label) label.textContent = `(${settings.widthMm}mm)`;
}

function applyTaiwanTemplateWidthToElement(paperEl, taiwanSettings, forceActive) {
    if (!paperEl) return false;
    const st = Object.assign({}, DEFAULT_TAIWAN_TEMPLATE_SETTINGS, taiwanSettings || {});
    const active = (forceActive === undefined || forceActive === null) ? !!st.enabled : !!forceActive;
    const widthMm = Number.isFinite(Number(st.widthMm)) ? Number(st.widthMm) : DEFAULT_TAIWAN_TEMPLATE_SETTINGS.widthMm;

    if (active) {
        paperEl.style.setProperty('max-width', `${widthMm}mm`,'important');
        paperEl.style.setProperty('margin','0 auto','important');
        paperEl.classList.add('taiwan-template-active-paper');
    } else {
        paperEl.style.removeProperty('max-width');
        paperEl.style.removeProperty('margin');
        paperEl.classList.remove('taiwan-template-active-paper');
    }
    return active;
}

async function saveTaiwanTemplateSettings() {
    const taiwanTemplateSettings = collectTaiwanTemplateSettingsFromForm();
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    try {
        const res = await authFetch(`${API_URL}/receipt-settings/taiwan-template`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ taiwanTemplateSettings, username })
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message ||'The Taiwan Receipt Template request has been submitted for Admin approval.','info');
        } else if (data.success) {
            Swal.fire('Saved!','The Taiwan Receipt Template settings have been updated.','success');
            receiptSettingsCache = data.settings || receiptSettingsCache;
            applyReceiptBranding();
        } else {
            Swal.fire('Error', data.message ||'Failed to save the Taiwan Receipt Template settings.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

function collectTransactionIdSettingsFromForm() {
    const formatEl = document.getElementById('rc-form-txnid-format');
    const format = formatEl && TRANSACTION_ID_FORMAT_INFO[formatEl.value]
        ? formatEl.value
        : DEFAULT_TRANSACTION_ID_SETTINGS.format;
    return { format };
}

function updateTransactionIdFormatPreview() {
    const settings = collectTransactionIdSettingsFromForm();
    const info = TRANSACTION_ID_FORMAT_INFO[settings.format] || TRANSACTION_ID_FORMAT_INFO.xs;
    const sample = generateTransactionId(settings.format);
    const previewEl = document.getElementById('rc-txnid-preview');
    if (previewEl) {
        previewEl.textContent = sample;
    }
    const lengthEl = document.getElementById('rc-txnid-length-note');
    if (lengthEl) {
        lengthEl.textContent = info.chars
            ? `${info.chars} characters`
            : `${sample.length} characters (varies by millisecond timestamp)`;
    }
}

async function saveReceiptTransactionIdFormat() {
    const transactionIdSettings = collectTransactionIdSettingsFromForm();
    const username = currentUser ? (currentUser.username || currentUser.name) :'Unknown';

    try {
        const res = await authFetch(`${API_URL}/receipt-settings/transaction-id`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ transactionIdSettings, username })
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message ||'The Transaction ID Format request has been submitted for Admin approval.','info');
        } else if (data.success) {
            const info = TRANSACTION_ID_FORMAT_INFO[transactionIdSettings.format] || TRANSACTION_ID_FORMAT_INFO.xs;
            Swal.fire('Saved!', `Transaction ID Format has been set to "${info.label}".`,'success');
            receiptSettingsCache = data.settings || receiptSettingsCache;
            updateTransactionIdFormatPreview();
        } else {
            Swal.fire('Error', data.message ||'Failed to save the Transaction ID Format.','error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

function buildLiveReceiptSettingsPreviewObject(baseSettings) {
    const val = (id, fallback) => { const el = document.getElementById(id); return el ? el.value : fallback; };
    const base = baseSettings || {};

    const headerType = document.getElementById('rc-header-image-section') &&
        document.getElementById('rc-header-image-section').style.display !=='none' ?'image' :'text';
    const headerImage = headerType ==='image'
        ? ((document.getElementById('rc-form-header-image-value') || {}).value ||'')
        :'';

    return Object.assign({}, base, {
        storeName: val('rc-form-storename', base.storeName),
        storeAddress: val('rc-form-address', base.storeAddress),
        storeContact: val('rc-form-contact', base.storeContact),
        headerText: val('rc-form-header', base.headerText),
        footerText: val('rc-form-footer', base.footerText),
        headerType: headerType,
        headerImage: headerImage || null,
        headerImageStyle: collectReceiptHeaderImageStyleFromForm(),
        barcodeSettings: collectReceiptBarcodeSettingsFromForm(),
        advancedSettings: collectReceiptAdvancedSettingsFromForm(),
        loyaltyQrSettings: collectLoyaltyQrSettingsFromForm(),
        taiwanTemplateSettings: collectTaiwanTemplateSettingsFromForm()
    });
}

async function previewCustomizationReceipt(useTaiwanTemplate) {
    if (!receiptSettingsCache && receiptSettingsPromise) {
        await receiptSettingsPromise;
    }
    if (!receiptSettingsCache) {
        await fetchReceiptSettings();
    }

    const originalReceiptSettingsCache = receiptSettingsCache;
    receiptSettingsCache = buildLiveReceiptSettingsPreviewObject(originalReceiptSettingsCache);

    try {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
        const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });

        const sampleTx = {
            id:'PREVIEW-' + String(Date.now()).slice(-6),
            timestamp: `${dateStr}, ${timeStr}`,
            items: [
                { name:'Sample Item A', quantity: 2, price: 45.00, itemDiscount: 0 },
                { name:'Sample Item B', quantity: 1, price: 120.00, itemDiscount: 10 },
                { name:'Sample Item C', quantity: 3, price: 15.50, itemDiscount: 0 }
            ],
            total: 216.50,
            method:'CASH',
            received: 250.00,
            change: 33.50,
            discount: 0,
            taxAmount: 0
        };

        await renderInvoiceReceipt(sampleTx, true);

        applyTaiwanTemplateWidthToElement(
            document.getElementById('printable-receipt-area'),
            (receiptSettingsCache && receiptSettingsCache.taiwanTemplateSettings) || DEFAULT_TAIWAN_TEMPLATE_SETTINGS,
            useTaiwanTemplate
        );

        const qset = Object.assign({}, DEFAULT_LOYALTY_QR_SETTINGS, (receiptSettingsCache && receiptSettingsCache.loyaltyQrSettings) || {});
        if (qset.enabled) {
            applyLoyaltyQrSettingsToDom({
                token:'SAMPLE-LOYALTY-QR-PREVIEW',
                note: (qset.noteText && qset.noteText.trim())
                    ? qset.noteText.trim()
                    :'New Loyalty QR ni Sample Customer — ito na ang gagamitin sa susunod na redemption.'
            });
        }

        const modalTitleEl = document.querySelector('#receipt-modal .modal-header h3');
        if (modalTitleEl) {
            modalTitleEl.innerText = useTaiwanTemplate ?'Receipt Preview — Taiwan Template' :'Receipt Preview — Default';
        }
    } finally {

        receiptSettingsCache = originalReceiptSettingsCache;
    }
}

const HEADER_IMAGE_MAX_DIM = 500;

function switchReceiptHeaderType(type, skipClearOnEmpty) {
    const textSection = document.getElementById('rc-header-text-section');
    const imageSection = document.getElementById('rc-header-image-section');
    const btnText = document.getElementById('rc-header-type-btn-text');
    const btnImage = document.getElementById('rc-header-type-btn-image');

    if (textSection) textSection.style.display = type ==='image' ?'none' :'block';
    if (imageSection) imageSection.style.display = type ==='image' ?'block' :'none';
    if (btnText) btnText.classList.toggle('active', type !=='image');
    if (btnImage) btnImage.classList.toggle('active', type ==='image');

    const hiddenType = document.getElementById('rc-form-header-image-value');

    if (!skipClearOnEmpty && type !=='image' && hiddenType) {

    }
}

function loadImageFileAsElement(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handleReceiptHeaderImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        Swal.fire('Wrong File Type','Only images (PNG, JPG, WEBP) can be uploaded as a header logo.','error');
        event.target.value ='';
        return;
    }

    try {
        const img = await loadImageFileAsElement(file);
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;

        const scale = Math.min(1, HEADER_IMAGE_MAX_DIM / Math.max(naturalWidth, naturalHeight));
        const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        let dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > 450 * 1024) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        }

        document.getElementById('rc-form-header-image-value').value = dataUrl;

        const previewWrap = document.getElementById('rc-header-image-preview-wrap');
        const settingsBox = document.getElementById('rc-header-image-settings');
        if (previewWrap) previewWrap.style.display ='block';
        if (settingsBox) settingsBox.style.display ='block';

        updateReceiptHeaderImagePreview();
    } catch (err) {
        console.error(err);
        Swal.fire('Upload Failed','Unable to process that image. Please try a different file.','error');
    } finally {
        event.target.value ='';
    }
}

function removeReceiptHeaderImage() {
    const hiddenType = document.getElementById('rc-form-header-image-value');
    if (hiddenType) hiddenType.value ='';

    const previewWrap = document.getElementById('rc-header-image-preview-wrap');
    const settingsBox = document.getElementById('rc-header-image-settings');
    if (previewWrap) previewWrap.style.display ='none';
    if (settingsBox) settingsBox.style.display ='none';

    const previewImg = document.getElementById('rc-header-image-preview');
    if (previewImg) previewImg.removeAttribute('src');
}

function collectReceiptHeaderImageStyleFromForm() {
    const getRange = (id, fallback) => {
        const el = document.getElementById(id);
        return el ? Number(el.value) : fallback;
    };
    const alignEl = document.getElementById('rc-hi-align');
    const grayscaleEl = document.getElementById('rc-hi-grayscale');

    return {
        widthPct: getRange('rc-hi-width', DEFAULT_HEADER_IMAGE_STYLE.widthPct),
        align: alignEl ? alignEl.value : DEFAULT_HEADER_IMAGE_STYLE.align,
        maxHeightPx: getRange('rc-hi-maxheight', DEFAULT_HEADER_IMAGE_STYLE.maxHeightPx),
        opacityPct: getRange('rc-hi-opacity', DEFAULT_HEADER_IMAGE_STYLE.opacityPct),
        grayscale: grayscaleEl ? !!grayscaleEl.checked : DEFAULT_HEADER_IMAGE_STYLE.grayscale,
        cornerRadiusPx: getRange('rc-hi-radius', DEFAULT_HEADER_IMAGE_STYLE.cornerRadiusPx),
        marginTopPx: Math.max(0, getRange('rc-hi-margintop', DEFAULT_HEADER_IMAGE_STYLE.marginTopPx)),
        marginBottomPx: getRange('rc-hi-marginbottom', DEFAULT_HEADER_IMAGE_STYLE.marginBottomPx),
        lineSpacingPx: getRange('rc-hi-linespacing', DEFAULT_HEADER_IMAGE_STYLE.lineSpacingPx)
    };
}

function updateReceiptHeaderImagePreview() {
    const dataUrl = (document.getElementById('rc-form-header-image-value') || {}).value ||'';
    const previewImg = document.getElementById('rc-header-image-preview');
    const style = collectReceiptHeaderImageStyleFromForm();

    if (previewImg && dataUrl) {
        applyReceiptHeaderImageStyle(previewImg, dataUrl, style);
    }

    const setLabel = (id, val, suffix) => {
        const el = document.getElementById(id);
        if (el) el.textContent = `(${val}${suffix})`;
    };
    setLabel('rc-hi-width-val', style.widthPct,'%');
    setLabel('rc-hi-maxheight-val', style.maxHeightPx,'px');
    setLabel('rc-hi-opacity-val', style.opacityPct,'%');
    setLabel('rc-hi-margintop-val', style.marginTopPx,'px');
    setLabel('rc-hi-marginbottom-val', style.marginBottomPx,'px');
    setLabel('rc-hi-linespacing-val', style.lineSpacingPx,'px');
}

async function saveReceiptCustomization() {
    const headerType = document.getElementById('rc-header-image-section') &&
        document.getElementById('rc-header-image-section').style.display !=='none' ?'image' :'text';
    const headerImage = headerType ==='image'
        ? ((document.getElementById('rc-form-header-image-value') || {}).value ||'')
        :'';

    const payload = {
        storeName: (document.getElementById('rc-form-storename').value ||'').trim(),
        storeAddress: (document.getElementById('rc-form-address').value ||'').trim(),
        storeContact: (document.getElementById('rc-form-contact').value ||'').trim(),
        headerText: (document.getElementById('rc-form-header').value ||'').trim(),
        footerText: (document.getElementById('rc-form-footer').value ||'').trim(),
        headerType: headerType,
        headerImage: headerImage || null,
        headerImageStyle: collectReceiptHeaderImageStyleFromForm(),
        username: currentUser ? (currentUser.username || currentUser.name) :'Unknown'
    };

    if (!payload.storeName) {
        Swal.fire('Missing Details','Store Name is required.','warning');
        return;
    }

    if (payload.headerType ==='image' && !payload.headerImage) {
        Swal.fire('Missing Logo','Please upload a header logo/image, or switch back to "Text Only".','warning');
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

            data = await showModernOtpModal({
                subtitle: 'You have reached the free limit for receipt customization (2/2). We sent a 6-digit code to the developer\'s registered email.',
                confirmButtonText: 'Verify Code',
                verifyFn: async ({ otp }) => {
                    payload.otp = otp;
                    const r = await authFetch(`${API_URL}/receipt-settings`, {
                        method:'POST',
                        headers: {'Content-Type':'application/json' },
                        body: JSON.stringify(payload)
                    });
                    return r.json();
                }
            });

            if (!data) return;

            if (data.pending) {
                data = await pollUntilApproved(`${API_URL}/receipt-settings`, payload);
            }
            if (data.cancelled) return;

            if (!data.success && !data.pending) {
                // Inline retry feedback already handled this — no extra popup.
                return;
            }
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

let storeSettingsCache = null;

async function fetchStoreSettings() {
    try {
        const res = await authFetch(`${API_URL}/store-settings`);
        storeSettingsCache = await res.json();
    } catch (err) {
        console.error(err);
        storeSettingsCache = null;
    }
    return storeSettingsCache;
}

async function loadStoreSettingsPanel() {
    const s = await fetchStoreSettings();
    if (!s) return;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setVal('ss-currency-code', s.currencyCode);
    setChecked('ss-tax-enabled', s.taxEnabled);
    setVal('ss-tax-label', s.taxLabel);
    setVal('ss-tax-rate', s.taxRate);
    setChecked('ss-prices-include-tax', s.pricesIncludeTax);
    setChecked('ss-pm-cash', s.paymentMethods.cash);
    setChecked('ss-pm-gcash', s.paymentMethods.gcash);
    setChecked('ss-pm-maya', s.paymentMethods.maya);
    setChecked('ss-pm-card', s.paymentMethods.card);
    setChecked('ss-pm-banktransfer', s.paymentMethods.bankTransfer);
    updatePaymentQrPreview('gcash', s.gcashQrImage || '');
    updatePaymentQrPreview('maya', s.mayaQrImage || '');
    setChecked('ss-senior-pwd-enabled', s.seniorPwdDiscountEnabled);
    setVal('ss-senior-pwd-rate', s.seniorPwdDiscountRate);
    setChecked('ss-loyalty-enabled', s.loyaltyEnabled);
    setVal('ss-loyalty-earn-rate', s.loyaltyEarnRate);
    setVal('ss-loyalty-point-value', s.loyaltyPointValue);
    setVal('ss-branch-name', s.branchName || '');
    setVal('ss-branch-group-key', s.branchGroupKey || '');

    const statusEl = document.getElementById('store-settings-status');
    if (statusEl) {
        statusEl.textContent = s.updatedAt ? `Last updated: ${new Date(s.updatedAt).toLocaleString()}` : '';
        statusEl.style.color = '#64748b';
    }
}

async function saveStoreSettings() {
    const payload = {
        currencyCode: document.getElementById('ss-currency-code').value,
        taxEnabled: document.getElementById('ss-tax-enabled').checked,
        taxLabel: (document.getElementById('ss-tax-label').value || '').trim() || 'VAT',
        taxRate: parseFloat(document.getElementById('ss-tax-rate').value) || 0,
        pricesIncludeTax: document.getElementById('ss-prices-include-tax').checked,
        paymentMethods: {
            cash: document.getElementById('ss-pm-cash').checked,
            gcash: document.getElementById('ss-pm-gcash').checked,
            maya: document.getElementById('ss-pm-maya').checked,
            card: document.getElementById('ss-pm-card').checked,
            bankTransfer: document.getElementById('ss-pm-banktransfer').checked
        },
        gcashQrImage: document.getElementById('ss-gcash-qr-value').value || null,
        mayaQrImage: document.getElementById('ss-maya-qr-value').value || null,
        seniorPwdDiscountEnabled: document.getElementById('ss-senior-pwd-enabled').checked,
        seniorPwdDiscountRate: parseFloat(document.getElementById('ss-senior-pwd-rate').value) || 0,
        loyaltyEnabled: document.getElementById('ss-loyalty-enabled').checked,
        loyaltyEarnRate: parseFloat(document.getElementById('ss-loyalty-earn-rate').value) || 100,
        loyaltyPointValue: parseFloat(document.getElementById('ss-loyalty-point-value').value) || 0,
        branchName: (document.getElementById('ss-branch-name').value || '').trim(),
        branchGroupKey: (document.getElementById('ss-branch-group-key').value || '').trim(),
        username: currentUser ? (currentUser.username || currentUser.name) : 'Unknown'
    };

    try {
        const res = await authFetch(`${API_URL}/store-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message || 'The Store & Sales Settings request has been submitted for Admin approval.', 'info');
        } else if (data.success) {
            Swal.fire('Saved!', 'Store & Sales Settings have been updated.', 'success');
            storeSettingsCache = data.settings || storeSettingsCache;
            loadStoreSettingsPanel();
            applyPaymentMethodVisibility();
        } else {
            Swal.fire('Error', data.message || 'Failed to save Store & Sales Settings.', 'error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error', 'Unable to reach the server. Please try again.', 'error');
    }
}

async function testBranchConnection() {
    const btn = document.getElementById('branch-test-connection-btn');
    const statusEl = document.getElementById('branch-test-connection-status');
    if (!btn || !statusEl) return;

    const currentInputVal = (document.getElementById('ss-branch-group-key').value || '').trim();
    const savedVal = (storeSettingsCache && storeSettingsCache.branchGroupKey) || '';
    if (currentInputVal !== savedVal) {
        statusEl.style.color = '#f59e0b';
        statusEl.textContent = 'Unsaved changes — click "Save Store & Sales Settings" first, then Test Connection.';
        return;
    }
    if (!currentInputVal) {
        statusEl.style.color = '#f59e0b';
        statusEl.textContent = 'Ilagay muna ang Business Group Code sa itaas.';
        return;
    }

    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing…';
    statusEl.style.color = '#64748b';
    statusEl.textContent = '';

    try {
        const res = await authFetch(`${API_URL}/relay-branch/checkin-now`, { method: 'POST' });
        const data = await res.json();
        statusEl.style.color = data.success ? '#16a34a' : '#ef4444';
        statusEl.textContent = data.message || (data.success ? 'OK' : 'Failed');
        if (data.success) loadBranchesWidget();
    } catch (err) {
        statusEl.style.color = '#ef4444';
        statusEl.textContent = 'Unable to reach the server.';
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

const QR_AUTOCROP_MARGIN_PX = 2;
const QR_AUTOCROP_MAX_DIM = 500;

function qrAutoCropLoadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

async function qrAutoCropDetectBox(img) {
    if (typeof BarcodeDetector === 'undefined') return null;
    try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(img);
        if (!barcodes || barcodes.length === 0) return null;

        let best = barcodes[0];
        let bestArea = best.boundingBox.width * best.boundingBox.height;
        for (let i = 1; i < barcodes.length; i++) {
            const area = barcodes[i].boundingBox.width * barcodes[i].boundingBox.height;
            if (area > bestArea) { best = barcodes[i]; bestArea = area; }
        }

        const bb = best.boundingBox;
        if (!bb || bb.width <= 0 || bb.height <= 0) return null;
        return { minX: bb.x, minY: bb.y, maxX: bb.x + bb.width, maxY: bb.y + bb.height };
    } catch (err) {
        return null;
    }
}

async function handlePaymentQrPhotoSelect(event, kind) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        Swal.fire('Wrong File Type','Only images (JPG, PNG, etc.) can be uploaded as a QR code.','error');
        event.target.value ='';
        return;
    }

    try {
        const img = await qrAutoCropLoadImage(file);
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;

        const box = await qrAutoCropDetectBox(img);

        let cropX, cropY, cropSize;
        if (box) {

            const boxW = Math.max(box.maxX - box.minX, 1);
            const boxH = Math.max(box.maxY - box.minY, 1);
            const padX = boxW * 0.15;
            const padY = boxH * 0.15;

            let x0 = box.minX - padX;
            let y0 = box.minY - padY;
            let x1 = box.maxX + padX;
            let y1 = box.maxY + padY;

            const size = Math.max(x1 - x0, y1 - y0);
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            x0 = cx - size / 2;
            y0 = cy - size / 2;

            x0 = Math.max(0, Math.min(x0, naturalWidth - 1));
            y0 = Math.max(0, Math.min(y0, naturalHeight - 1));
            const maxSize = Math.min(naturalWidth - x0, naturalHeight - y0);

            cropX = x0;
            cropY = y0;
            cropSize = Math.min(size, maxSize);
        } else {

            const size = Math.min(naturalWidth, naturalHeight);
            cropX = (naturalWidth - size) / 2;
            cropY = (naturalHeight - size) / 2;
            cropSize = size;
        }

        const drawSize = Math.min(QR_AUTOCROP_MAX_DIM, Math.round(cropSize));
        const finalSize = drawSize + QR_AUTOCROP_MARGIN_PX * 2;

        const canvas = document.createElement('canvas');
        canvas.width = finalSize;
        canvas.height = finalSize;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, finalSize, finalSize);
        ctx.drawImage(
            img,
            cropX, cropY, cropSize, cropSize,
            QR_AUTOCROP_MARGIN_PX, QR_AUTOCROP_MARGIN_PX, drawSize, drawSize
        );

        const compressedDataUrl = canvas.toDataURL('image/png');
        document.getElementById(`ss-${kind}-qr-value`).value = compressedDataUrl;
        updatePaymentQrPreview(kind, compressedDataUrl);
    } catch (err) {
        console.error('QR auto-crop error:', err);
        Swal.fire('Upload Error', 'The image could not be processed. Please try uploading again.', 'error');
    } finally {
        event.target.value = '';
    }
}

function updatePaymentQrPreview(kind, dataUrl) {
    const preview = document.getElementById(`ss-${kind}-qr-preview`);
    const removeBtn = document.getElementById(`ss-${kind}-qr-remove-btn`);
    const valueInput = document.getElementById(`ss-${kind}-qr-value`);
    if (!preview) return;
    if (valueInput) valueInput.value = dataUrl ||'';
    if (dataUrl) {
        preview.innerHTML = `<img src="${dataUrl}" alt="${kind} QR" style="width:100%;height:100%;object-fit:contain;">`;
        if (removeBtn) removeBtn.style.display ='inline-block';
    } else {
        preview.innerHTML = `<i class="fa-solid fa-qrcode" style="font-size:1.6rem;"></i>`;
        if (removeBtn) removeBtn.style.display ='none';
    }
}

function removePaymentQrPhoto(kind) {
    updatePaymentQrPreview(kind, '');
    const fileInput = document.getElementById(`ss-${kind}-qr-input`);
    if (fileInput) fileInput.value ='';
}

let uxSettingsCache = null;

async function fetchUxSettings() {
    try {
        const res = await authFetch(`${API_URL}/ux-settings`);
        uxSettingsCache = await res.json();
    } catch (err) {
        console.error(err);
        uxSettingsCache = null;
    }
    return uxSettingsCache;
}

async function loadUxSettingsPanel() {
    const s = await fetchUxSettings();
    if (!s) return;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setChecked('ux-dark-mode-default', s.darkModeDefault);
    setVal('ux-low-stock-threshold', s.lowStockAlertThreshold);
    setChecked('ux-scanner-sound', s.scannerSound);
    setChecked('ux-widget-salestoday', s.dashboardWidgets.salesToday);
    setChecked('ux-widget-lowstock', s.dashboardWidgets.lowStock);
    setChecked('ux-widget-topproducts', s.dashboardWidgets.topProducts);
    setChecked('ux-widget-recenttx', s.dashboardWidgets.recentTransactions);
    setChecked('ux-swap-terminal-layout', getTerminalLayoutSwapped());

    const statusEl = document.getElementById('ux-settings-status');
    if (statusEl) {
        statusEl.textContent = s.updatedAt ? `Last updated: ${new Date(s.updatedAt).toLocaleString()}` : '';
        statusEl.style.color = '#64748b';
    }
}

function previewDarkMode(isChecked) {
    if (typeof THEME_CATALOG === 'undefined' || typeof isThemeUnlocked !== 'function') return;
    const darkTheme = THEME_CATALOG.find(t => t.id === 'dark');
    if (isChecked && darkTheme && !isThemeUnlocked(darkTheme)) {

        return;
    }
    if (typeof applyTheme === 'function') {
        applyTheme(isChecked ? 'dark' : 'day', { persist: false });
    }
}

async function saveUxSettings() {
    const payload = {
        darkModeDefault: document.getElementById('ux-dark-mode-default').checked,
        lowStockAlertThreshold: parseInt(document.getElementById('ux-low-stock-threshold').value, 10) || 0,
        scannerSound: document.getElementById('ux-scanner-sound').checked,
        dashboardWidgets: {
            salesToday: document.getElementById('ux-widget-salestoday').checked,
            lowStock: document.getElementById('ux-widget-lowstock').checked,
            topProducts: document.getElementById('ux-widget-topproducts').checked,
            recentTransactions: document.getElementById('ux-widget-recenttx').checked
        },
        username: currentUser ? (currentUser.username || currentUser.name) : 'Unknown'
    };

    try {
        const res = await authFetch(`${API_URL}/ux-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message || 'The Appearance/UX Settings request has been submitted for Admin approval.', 'info');
        } else if (data.success) {
            Swal.fire('Saved!', 'Appearance/UX Settings have been updated.', 'success');
            uxSettingsCache = data.settings || uxSettingsCache;
            loadUxSettingsPanel();
        } else {
            Swal.fire('Error', data.message || 'Failed to save Appearance/UX Settings.', 'error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error', 'Unable to reach the server. Please try again.', 'error');
    }
}

const TERMINAL_LAYOUT_SWAP_KEY = 'omnipos_terminal_layout_swapped';

function isDesktopTerminalView() {
    return window.matchMedia('(min-width: 1025px)').matches;
}

function getTerminalLayoutSwapped() {
    return localStorage.getItem(TERMINAL_LAYOUT_SWAP_KEY) === 'true';
}

function applyTerminalLayoutSwap(swapped) {
    const container = document.querySelector('.terminal-container');
    if (container) container.classList.toggle('layout-swapped', !!swapped);
}

function setTerminalLayoutSwapped(swapped) {
    localStorage.setItem(TERMINAL_LAYOUT_SWAP_KEY, swapped ? 'true' : 'false');
    applyTerminalLayoutSwap(swapped);
    const cb = document.getElementById('ux-swap-terminal-layout');
    if (cb) cb.checked = !!swapped;
}

function toggleTerminalLayoutSwap() {
    setTerminalLayoutSwapped(!getTerminalLayoutSwapped());
}

function toggleTerminalLayoutSetting(isChecked) {
    setTerminalLayoutSwapped(isChecked);
}

function initTerminalLayoutSwap() {
    applyTerminalLayoutSwap(getTerminalLayoutSwapped());

    const header = document.getElementById('terminal-cart-header');
    const cartPane = document.getElementById('terminal-cart-pane');
    const productPane = document.getElementById('terminal-product-pane');
    if (!header || !cartPane || !productPane) return;

    function refreshDraggableState() {
        const enabled = isDesktopTerminalView();
        header.setAttribute('draggable', enabled ? 'true' : 'false');
        header.classList.toggle('pane-draggable', enabled);
    }
    refreshDraggableState();
    window.addEventListener('resize', refreshDraggableState);

    header.addEventListener('dragstart', (e) => {
        if (!isDesktopTerminalView()) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain', 'omnipos-terminal-pane');
        e.dataTransfer.effectAllowed = 'move';
        cartPane.classList.add('pane-dragging');
    });

    header.addEventListener('dragend', () => {
        cartPane.classList.remove('pane-dragging');
        productPane.classList.remove('pane-drop-target');
    });

    productPane.addEventListener('dragover', (e) => {
        if (!cartPane.classList.contains('pane-dragging')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        productPane.classList.add('pane-drop-target');
    });

    productPane.addEventListener('dragleave', () => {
        productPane.classList.remove('pane-drop-target');
    });

    productPane.addEventListener('drop', (e) => {
        if (!cartPane.classList.contains('pane-dragging')) return;
        e.preventDefault();
        productPane.classList.remove('pane-drop-target');
        toggleTerminalLayoutSwap();
    });
}

document.addEventListener('DOMContentLoaded', initTerminalLayoutSwap);

const CART_PANE_WIDTH_KEY = 'omnipos_terminal_cart_pane_width';
const CART_PANE_DEFAULT_WIDTH = 680; // widened further per request

const CART_PANE_MIN_WIDTH = CART_PANE_DEFAULT_WIDTH;
const CART_PANE_MAX_WIDTH = 1040;

// Reserved space for the product grid/list pane. Lowered so the cart pane can
// take priority when resized wider — the product grid/list now shrinks first
// instead of capping how far the cart pane (with the Customer + Charge/Total
// row) can grow.
const CART_PANE_PRODUCT_RESERVE_GRID = 300;
const CART_PANE_PRODUCT_RESERVE_LIST = 340;

function getSavedCartPaneWidth() {
    const raw = localStorage.getItem(CART_PANE_WIDTH_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

function getCartPaneProductPaneReserve() {
    const gridOutput = document.getElementById('terminal-grid-output');
    const isListView = !!(gridOutput && gridOutput.classList.contains('terminal-list-view'));
    return isListView ? CART_PANE_PRODUCT_RESERVE_LIST : CART_PANE_PRODUCT_RESERVE_GRID;
}

function clampCartPaneWidth(width) {

    const dynamicMax = Math.max(CART_PANE_MIN_WIDTH, Math.min(CART_PANE_MAX_WIDTH, window.innerWidth - getCartPaneProductPaneReserve()));
    return Math.min(Math.max(width, CART_PANE_MIN_WIDTH), dynamicMax);
}

function reclampCartPaneWidthToCurrentView() {
    const cartPane = document.getElementById('terminal-cart-pane');
    if (!cartPane || !isDesktopTerminalView()) return;
    const currentWidth = parseInt(cartPane.style.width, 10) || cartPane.getBoundingClientRect().width;
    if (!currentWidth) return;
    applyCartPaneWidth(cartPane, currentWidth);
}

function applyCartPaneWidth(cartPane, width) {
    if (!cartPane) return;
    if (isDesktopTerminalView() && width) {
        cartPane.style.width = `${clampCartPaneWidth(width)}px`;
    } else {

        cartPane.style.width = '';
    }
}

function initCartPaneResize() {
    const cartPane = document.getElementById('terminal-cart-pane');
    const handle = document.getElementById('cart-pane-resize-handle');
    const container = document.querySelector('.terminal-container');
    if (!cartPane || !handle || !container) return;

    applyCartPaneWidth(cartPane, getSavedCartPaneWidth() || CART_PANE_DEFAULT_WIDTH);
    window.addEventListener('resize', () => applyCartPaneWidth(cartPane, getSavedCartPaneWidth() || CART_PANE_DEFAULT_WIDTH));

    let dragStartX = 0;
    let dragStartWidth = CART_PANE_DEFAULT_WIDTH;
    let dragging = false;

    function onPointerMove(e) {
        if (!dragging) return;
        const swapped = container.classList.contains('layout-swapped');

        const deltaX = e.clientX - dragStartX;
        const newWidth = swapped ? (dragStartWidth - deltaX) : (dragStartWidth + deltaX);
        cartPane.style.width = `${clampCartPaneWidth(newWidth)}px`;
    }

    function onPointerUp() {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('resize-active');
        cartPane.classList.remove('pane-resizing');
        document.body.classList.remove('cart-pane-resizing-cursor');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);

        const finalWidth = parseInt(cartPane.style.width, 10);
        if (Number.isFinite(finalWidth)) {
            localStorage.setItem(CART_PANE_WIDTH_KEY, String(finalWidth));
        }
    }

    handle.addEventListener('pointerdown', (e) => {
        if (!isDesktopTerminalView()) return;
        e.preventDefault();
        dragging = true;
        dragStartX = e.clientX;
        dragStartWidth = cartPane.getBoundingClientRect().width;
        handle.classList.add('resize-active');
        cartPane.classList.add('pane-resizing');
        document.body.classList.add('cart-pane-resizing-cursor');
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    });

    handle.addEventListener('dblclick', () => {
        localStorage.removeItem(CART_PANE_WIDTH_KEY);
        applyCartPaneWidth(cartPane, CART_PANE_DEFAULT_WIDTH);
    });
}

document.addEventListener('DOMContentLoaded', initCartPaneResize);

let advancedSettingsCache = null;

async function fetchAdvancedSettings() {
    try {
        const res = await authFetch(`${API_URL}/advanced-settings`);
        advancedSettingsCache = await res.json();
    } catch (err) {
        console.error(err);
        advancedSettingsCache = null;
    }
    return advancedSettingsCache;
}

async function loadAdvancedSettingsPanel() {
    const s = await fetchAdvancedSettings();
    if (!s) return;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setChecked('adv-idle-lock-enabled', s.idleAutoLockEnabled);
    setVal('adv-idle-lock-minutes', s.idleAutoLockMinutes);
    setChecked('adv-customer-display-enabled', s.customerDisplayEnabled);
    setVal('adv-customer-display-compact-threshold', s.customerDisplayCompactThreshold || 8);
    setChecked('adv-sale-webhook-enabled', s.saleWebhookEnabled);
    setVal('adv-sale-webhook-url', s.saleWebhookUrl || '');
    setChecked('adv-2fa-enabled', s.twoFactorLoginEnabled);
    setVal('adv-2fa-recipient-email', s.twoFactorRecipientEmail || '');
    setChecked('adv-fraud-detection-enabled', s.fraudDetectionEnabled);
    setVal('adv-fraud-sensitivity', s.fraudDetectionSensitivity || 'medium');
    setChecked('adv-fraud-email-enabled', s.fraudAlertEmailEnabled);
    setVal('adv-fraud-recipient-email', s.fraudAlertRecipientEmail || '');
    if (typeof toggleFraudDetectionFields === 'function') toggleFraudDetectionFields();

    const statusEl = document.getElementById('advanced-settings-status');
    if (statusEl) {
        statusEl.textContent = s.updatedAt ? `Last updated: ${new Date(s.updatedAt).toLocaleString()}` : '';
        statusEl.style.color = '#64748b';
    }

    setupIdleAutoLock();
}

async function saveAdvancedSettings() {
    const payload = {
        idleAutoLockEnabled: document.getElementById('adv-idle-lock-enabled').checked,
        idleAutoLockMinutes: parseInt(document.getElementById('adv-idle-lock-minutes').value, 10) || 5,
        customerDisplayEnabled: document.getElementById('adv-customer-display-enabled').checked,
        customerDisplayCompactThreshold: parseInt(document.getElementById('adv-customer-display-compact-threshold').value, 10) || 8,
        saleWebhookEnabled: document.getElementById('adv-sale-webhook-enabled').checked,
        saleWebhookUrl: (document.getElementById('adv-sale-webhook-url').value || '').trim(),
        twoFactorLoginEnabled: document.getElementById('adv-2fa-enabled').checked,
        twoFactorRecipientEmail: (document.getElementById('adv-2fa-recipient-email').value || '').trim(),
        fraudDetectionEnabled: document.getElementById('adv-fraud-detection-enabled').checked,
        fraudDetectionSensitivity: document.getElementById('adv-fraud-sensitivity').value || 'medium',
        fraudAlertEmailEnabled: document.getElementById('adv-fraud-email-enabled').checked,
        fraudAlertRecipientEmail: (document.getElementById('adv-fraud-recipient-email').value || '').trim(),
        username: currentUser ? (currentUser.username || currentUser.name) : 'Unknown'
    };

    try {
        const res = await authFetch(`${API_URL}/advanced-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success && data.pending) {
            Swal.fire('Submitted for Approval', data.message || 'The Advanced Settings request has been submitted for Admin approval.', 'info');
        } else if (data.success) {
            Swal.fire('Saved!', 'Advanced Settings have been updated.', 'success');
            advancedSettingsCache = data.settings || advancedSettingsCache;
            loadAdvancedSettingsPanel();
        } else {
            Swal.fire('Error', data.message || 'Failed to save Advanced Settings.', 'error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error', 'Unable to reach the server. Please try again.', 'error');
    }
}

function toggleFraudDetectionFields() {
    const enabled = document.getElementById('adv-fraud-detection-enabled') ? document.getElementById('adv-fraud-detection-enabled').checked : false;
    ['adv-fraud-sensitivity', 'adv-fraud-email-enabled', 'adv-fraud-recipient-email'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !enabled;
    });
}

const FRAUD_ALERT_TYPE_LABELS = {
    discount_anomaly: 'Unusual Discount',
    void_velocity: 'Rapid Voids',
    refund_velocity: 'Rapid Refunds',
    large_refund: 'Oversized Refund',
    unusual_hour_sale: 'Off-Hours Sale'
};

const FRAUD_ALERT_SEVERITY_COLORS = {
    low: '#64748b',
    medium: '#d97706',
    high: '#dc2626'
};

async function loadFraudAlertsTable() {
    const counterTab = document.getElementById('fraud-alerts-counter-tab');
    const tbody = document.getElementById('fraud-alerts-table-body');
    const emptyState = document.getElementById('fraud-alerts-empty-state');
    if (!tbody) return;

    try {
        const res = await authFetch(`${API_URL}/fraud-alerts`);
        if (!res.ok) {

            tbody.innerHTML = '';
            if (emptyState) emptyState.style.display = 'none';
            return;
        }
        const data = await res.json();
        const alerts = data.alerts || [];

        if (counterTab) counterTab.innerText = `Fraud Alerts${data.unreviewedCount ? ` (${data.unreviewedCount})` : ''}`;

        if (alerts.length === 0) {
            tbody.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        tbody.innerHTML = alerts.map(a => {
            const typeLabel = FRAUD_ALERT_TYPE_LABELS[a.type] || a.type;
            const color = FRAUD_ALERT_SEVERITY_COLORS[a.severity] || '#64748b';
            const statusHtml = a.reviewed
                ? `<span style="color:#16a34a;font-weight:600;"><i class="fa-solid fa-check"></i> Reviewed${a.reviewedBy ? ` by ${escapeHtml(a.reviewedBy)}` : ''}</span>`
                : `<span style="color:#dc2626;font-weight:600;">Unreviewed</span>`;
            const actionHtml = a.reviewed
                ? '—'
                : `<button class="btn-action-outline" onclick="reviewFraudAlert('${a.id}')"><i class="fa-solid fa-check"></i> Mark Reviewed</button>`;

            return `<tr>
                <td>${escapeHtml(a.timestamp || '')}</td>
                <td>${escapeHtml(typeLabel)}</td>
                <td><span style="color:${color};font-weight:700;text-transform:uppercase;font-size:0.75rem;">${escapeHtml(a.severity || '')}</span></td>
                <td>${escapeHtml(a.cashier || 'N/A')}</td>
                <td style="max-width:320px;">${escapeHtml(a.summary || '')}</td>
                <td>${statusHtml}</td>
                <td>${actionHtml}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('Failed to load fraud alerts:', err);
    }
}

async function reviewFraudAlert(alertId) {
    const { value: note } = await Swal.fire({
        title: 'Mark Fraud Alert as Reviewed',
        input: 'text',
        inputPlaceholder: 'Optional note (e.g. "Confirmed legitimate senior discount")',
        showCancelButton: true,
        confirmButtonText: 'Mark Reviewed'
    });
    if (note === undefined) return;

    try {
        const res = await authFetch(`${API_URL}/fraud-alerts/${encodeURIComponent(alertId)}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note, reviewedBy: currentUser ? (currentUser.username || currentUser.name) : 'Unknown' })
        });
        const data = await res.json();
        if (data.success) {
            loadFraudAlertsTable();
        } else {
            Swal.fire('Error', data.message || 'Failed to update the Fraud Alert.', 'error');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error', 'Unable to reach the server. Please try again.', 'error');
    }
}

let idleAutoLockTimer = null;
let idleAutoLockListenersAttached = false;

function setupIdleAutoLock() {
    if (idleAutoLockTimer) { clearTimeout(idleAutoLockTimer); idleAutoLockTimer = null; }
    if (!advancedSettingsCache || !advancedSettingsCache.idleAutoLockEnabled) return;

    const resetTimer = () => {
        if (idleAutoLockTimer) clearTimeout(idleAutoLockTimer);
        const minutes = advancedSettingsCache.idleAutoLockMinutes || 5;
        idleAutoLockTimer = setTimeout(triggerIdleAutoLock, minutes * 60 * 1000);
    };

    if (!idleAutoLockListenersAttached) {
        ['click', 'keydown', 'touchstart', 'mousemove'].forEach(evt => {
            window.addEventListener(evt, () => { if (advancedSettingsCache && advancedSettingsCache.idleAutoLockEnabled) resetTimer(); }, { passive: true });
        });
        idleAutoLockListenersAttached = true;
    }
    resetTimer();
}

function triggerIdleAutoLock() {
    if (document.getElementById('idle-lock-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'idle-lock-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.92);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;width:90%;max-width:340px;text-align:center;">
            <i class="fa-solid fa-lock" style="font-size:2rem;color:#2563eb;margin-bottom:10px;"></i>
            <h3 style="margin:0 0 4px;">Session Locked</h3>
            <p style="color:#64748b;font-size:0.85rem;margin:0 0 16px;">Enter your password to continue.</p>
            <input type="password" id="idle-lock-password" placeholder="Password" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:10px;" onkeydown="if(event.key==='Enter') submitIdleUnlock();">
            <div id="idle-lock-error" style="color:#dc2626;font-size:0.8rem;min-height:16px;margin-bottom:8px;"></div>
            <button class="btn-action-global" style="width:100%;" onclick="submitIdleUnlock()"><i class="fa-solid fa-unlock"></i> Unlock</button>
        </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => { const el = document.getElementById('idle-lock-password'); if (el) el.focus(); }, 50);
}

async function submitIdleUnlock() {
    const pwInput = document.getElementById('idle-lock-password');
    const errEl = document.getElementById('idle-lock-error');
    const password = pwInput ? pwInput.value : '';
    if (!password) { if (errEl) errEl.textContent = 'Enter your password.'; return; }
    try {
        const res = await authFetch(`${API_URL}/verify-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser ? currentUser.username : '', password })
        });
        const data = await res.json();
        if (data.success) {
            const overlay = document.getElementById('idle-lock-overlay');
            if (overlay) overlay.remove();
            setupIdleAutoLock();
        } else if (errEl) {

            errEl.textContent = data.message || 'Incorrect password.';
        }
    } catch (err) {
        if (errEl) errEl.textContent = 'Connection error — please try again.';
    }
}

function applyPaymentMethodVisibility() {
    const pm = (storeSettingsCache && storeSettingsCache.paymentMethods) || { cash: true, gcash: false, maya: false, card: false, bankTransfer: false };
    const map = { cash: 'pay-method-cash', gcash: 'pay-method-gcash', maya: 'pay-method-maya', card: 'pay-method-card' };
    let selectedIsHidden = false;
    Object.entries(map).forEach(([key, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const enabled = pm[key] !== false || key === 'cash';
        btn.style.display = enabled ? '' : 'none';
        if (!enabled && btn.classList.contains('active')) selectedIsHidden = true;
    });
    if (selectedIsHidden && typeof selectPaymentMethod === 'function') {
        selectPaymentMethod('CASH');
    }

    const seniorPwdRateLabel = document.getElementById('cart-senior-pwd-rate-label');
    if (seniorPwdRateLabel && storeSettingsCache && Number.isFinite(storeSettingsCache.seniorPwdDiscountRate)) {
        seniorPwdRateLabel.textContent = storeSettingsCache.seniorPwdDiscountRate;
    }
    const seniorPwdToggleLabel = document.querySelector('.senior-pwd-toggle-label');
    if (seniorPwdToggleLabel) {
        const disabled = storeSettingsCache && storeSettingsCache.seniorPwdDiscountEnabled === false;
        seniorPwdToggleLabel.style.opacity = disabled ? '0.4' : '';
        seniorPwdToggleLabel.title = disabled ? 'Naka-disable sa Store & Sales Settings' : '';
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

        let resetData = await showModernOtpModal({
            subtitle: 'We sent a 6-digit code to the developer\'s registered email to verify this reset.',
            confirmButtonText: 'Verify Code',
            verifyFn: async ({ otp }) => {
                const r = await authFetch(`${API_URL}/receipt-settings/reset-counter`, {
                    method:'POST',
                    headers: {'Content-Type':'application/json' },
                    body: JSON.stringify({ otp, username })
                });
                return r.json();
            }
        });
        if (!resetData) return;

        if (resetData.pending) {
            resetData = await pollUntilApproved(`${API_URL}/receipt-settings/reset-counter`, { otp: resetData.otp, username });
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
        }
        // On failure (including running out of retry attempts), the inline
        // OTP feedback already communicated this — no extra popup needed.
    } catch (err) {
        console.error(err);
        Swal.fire('Connection Error','Unable to reach the server. Please try again.','error');
    }
}

function openReceiptPreview() {
    if (shoppingCart.length === 0) {
        Swal.fire('Empty Cart','Add an item first before previewing the receipt.','warning');
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

    let rpItemCounterQty = 0;

    shoppingCart.forEach(item => {
        const itemBlock = document.createElement('div');
        itemBlock.className ='r-item-block';

        const row = document.createElement('div');
        row.className ='r-item-line';

        const itemDiscount = Math.max(0, parseFloat(item.itemDiscount) || 0);
        const nameLabel = itemDiscount > 0
            ? `${escapeHtml(item.name)} <small style="color:#dc2626;">(-₱${itemDiscount.toFixed(2)})</small>`
            : escapeHtml(item.name);
        const lineTotal = (item.price * item.quantity) - itemDiscount;
        row.innerHTML = `
            <span>${nameLabel}</span>
            <span>₱${lineTotal.toFixed(2)}</span>
        `;
        itemBlock.appendChild(row);

        const detailRow = document.createElement('div');
        detailRow.className ='r-item-detail-line';
        detailRow.innerHTML = `
            <span>${Number(item.quantity).toFixed(1)}</span>
            <span>x</span>
            <span>₱${parseFloat(item.price).toFixed(2)}</span>
        `;
        itemBlock.appendChild(detailRow);

        itemsTable.appendChild(itemBlock);

        rpItemCounterQty += Number(item.quantity) || 0;
    });

    const rpItemCounterQtyEl = document.getElementById('rp-item-counter-qty');
    if (rpItemCounterQtyEl) rpItemCounterQtyEl.innerText = rpItemCounterQty.toFixed(1);

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

    const qrContainerEl = document.getElementById('r-loyalty-qr-container');
    const showLoyaltyQr = !!(qrContainerEl && qrContainerEl.style.display !=='none');
    const qrImgEls = showLoyaltyQr
        ? Array.from(document.querySelectorAll('#r-loyalty-qr-render canvas, #r-loyalty-qr-render img')).filter((el) => el.width > 0 && el.height > 0)
        : [];
    const qrNoteEl = document.getElementById('r-loyalty-qr-note');
    const qrNoteText = (showLoyaltyQr && qrNoteEl && qrNoteEl.style.display !=='none') ? (qrNoteEl.innerText || '').trim() : '';

    const items = tx.items || [];
    const width = 380;
    const lineHeight = 20;
    const headerHeight = 110;
    const footerHeight = 130;

    const qrBlockHeight = qrImgEls.length ? (24 + (qrNoteText ? 18 : 0) + 130) : 0;
    const height = headerHeight + (items.length * lineHeight) + footerHeight + qrBlockHeight;

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
    ctx.fillText(`Cashier: ${formatCashierLabel(tx)}`, 14, y); y += 8;

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

    if (qrImgEls.length) {
        ctx.strokeStyle ='#cccccc';
        ctx.beginPath();
        ctx.moveTo(14, y);
        ctx.lineTo(width - 14, y);
        ctx.stroke();
        y += 14;

        if (qrNoteText) {
            ctx.textAlign ='center';
            ctx.font ='11px monospace';
            ctx.fillText(qrNoteText.slice(0, 60), width / 2, y);
            y += 18;
        }

        const qrSize = 110;
        const qrGap = 10;
        const totalQrWidth = (qrSize * qrImgEls.length) + (qrGap * (qrImgEls.length - 1));
        let qrX = (width - totalQrWidth) / 2;
        qrImgEls.forEach((qrEl) => {
            try { ctx.drawImage(qrEl, qrX, y, qrSize, qrSize); } catch (e) {  }
            qrX += qrSize + qrGap;
        });
        y += qrSize + 16;
    }

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
        Swal.fire('Invalid Email','Enter a valid email address.','warning');
        return;
    }
    if (!currentReceiptTransaction || !currentReceiptTransaction.id) {
        Swal.fire('Error','No active receipt to send.','error');
        return;
    }

    const btn = document.getElementById('receipt-email-btn');
    const originalHtml = btn ? btn.innerHTML :'';
    if (btn) { btn.disabled = true; btn.innerHTML ='<i class="fa-solid fa-spinner fa-spin"></i> Sending...'; }

    let receiptImage = null;
    try {
        receiptImage = generateReceiptImageDataUrl(currentReceiptTransaction);
    } catch (imgErr) {
        console.warn('Could not generate receipt image:', imgErr);
    }

    try {
        const res = await authFetch(`${API_URL}/transactions/${encodeURIComponent(currentReceiptTransaction.id)}/email-receipt`, {
            method:'POST',
            headers: {'Content-Type':'application/json' },
            body: JSON.stringify({ toEmail, transaction: currentReceiptTransaction, receiptImage })
        });
        const output = await res.json();
        if (output.success) {
            Swal.fire('Sent!', `Receipt sent to ${toEmail}`,'success');
            if (emailInput) emailInput.value ='';
        } else {
            Swal.fire('Failed', output.message ||'Could not send the receipt.','error');
        }
    } catch (e) {
        console.warn(e);
        Swal.fire('Connection Error','Could not connect to the server to send the receipt.','error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
}

async function renderInvoiceReceipt(tx, isHistory = false) {

    if (!receiptSettingsCache && receiptSettingsPromise) {
        await receiptSettingsPromise;
    }
    applyReceiptBranding();
    currentReceiptTransaction = tx;

    const modalTitleElReset = document.querySelector('#receipt-modal .modal-header h3');
    if (modalTitleElReset) modalTitleElReset.innerText ='Receipt Invoice';

    document.getElementById('r-id').innerText = tx.id;
    document.getElementById('r-footer-id').innerText = tx.id;

    const parts = tx.timestamp.split(', ');
    document.getElementById('r-date').innerText = parts[0] || tx.timestamp;
    document.getElementById('r-time').innerText = parts[1] ||'';
    document.getElementById('r-cashier').innerText = formatCashierLabel(tx);

    const itemsTable = document.getElementById('receipt-items-table');
    itemsTable.innerHTML ='';

    let rItemCounterQty = 0;
    let rItemCounterSubtotal = 0;

    tx.items.forEach(i => {
        const itemBlock = document.createElement('div');
        itemBlock.className ='r-item-block';

        const itemRow = document.createElement('div');
        itemRow.className ='r-item-line';
        const itemDiscount = Math.max(0, parseFloat(i.itemDiscount) || 0);
        const nameLabel = itemDiscount > 0
            ? `${escapeHtml(i.name)} <small style="color:#dc2626;">(-₱${itemDiscount.toFixed(2)})</small>`
            : escapeHtml(i.name);
        const lineTotal = (i.price * i.quantity) - itemDiscount;
        itemRow.innerHTML = `
            <span>${nameLabel}</span>
            <span>₱${lineTotal.toFixed(2)}</span>
        `;
        itemBlock.appendChild(itemRow);

        rItemCounterSubtotal += lineTotal;

        const detailRow = document.createElement('div');
        detailRow.className ='r-item-detail-line';
        detailRow.innerHTML = `
            <span>${Number(i.quantity).toFixed(1)}</span>
            <span>x</span>
            <span>₱${parseFloat(i.price).toFixed(2)}</span>
        `;
        itemBlock.appendChild(detailRow);

        itemsTable.appendChild(itemBlock);

        rItemCounterQty += Number(i.quantity) || 0;
    });

    const rItemCounterQtyEl = document.getElementById('r-item-counter-qty');
    if (rItemCounterQtyEl) rItemCounterQtyEl.innerText = rItemCounterQty.toFixed(1);
    const rItemCounterSubtotalEl = document.getElementById('r-item-counter-subtotal');
    if (rItemCounterSubtotalEl) rItemCounterSubtotalEl.innerText = `₱${rItemCounterSubtotal.toFixed(2)}`;

    document.getElementById('r-total').innerText = `₱${parseFloat(tx.total).toFixed(2)}`;

    if (tx.payments && Array.isArray(tx.payments) && tx.payments.length > 1) {
        document.getElementById('r-method').innerText = tx.payments.map(p => `${p.method} ₱${parseFloat(p.amount).toFixed(2)}`).join(' + ');
    } else {
        document.getElementById('r-method').innerText = tx.method;
    }
    document.getElementById('r-paid').innerText = `₱${parseFloat(tx.received).toFixed(2)}`;

    const payRefRow = document.getElementById('r-payref-row');
    if (payRefRow) {
        let refText ='';
        if (Array.isArray(tx.payments) && tx.payments.length > 0) {
            refText = tx.payments.filter(p => p.reference).map(p => `${p.method}: ${p.reference}`).join(', ');
        } else if (tx.paymentReference) {
            refText = tx.paymentReference;
        }
        if (refText) {
            document.getElementById('r-payref').innerText = refText;
            payRefRow.style.display ='flex';
        } else {
            payRefRow.style.display ='none';
        }
    }
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

    const taxRow = document.getElementById('r-tax-row');
    const taxAmt = parseFloat(tx.taxAmount) || 0;
    if (taxRow && taxAmt > 0) {
        const taxRatePart = Number.isFinite(tx.taxRate) && tx.taxRate > 0 ? ` (${tx.taxRate}%)` : '';
        document.getElementById('r-tax-label').innerText = `${tx.taxInclusive ? 'VAT Incl.' : 'Tax'}${taxRatePart}`;
        document.getElementById('r-tax-amount').innerText = `₱${taxAmt.toFixed(2)}`;
        taxRow.style.display ='flex';
    } else {
        if (taxRow) taxRow.style.display ='none';
    }

    const customerRow = document.getElementById('r-customer-row');
    if (customerRow) {
        if (tx.customerName) {
            document.getElementById('r-customer-name').innerText = tx.customerName;

            const ptsBalanceEl = document.getElementById('r-customer-points-balance');
            if (ptsBalanceEl) {
                ptsBalanceEl.innerText = Number.isFinite(tx.loyaltyPointsBalance) ? tx.loyaltyPointsBalance : '—';
            }

            customerRow.style.display ='grid';
        } else {
            customerRow.style.display ='none';
        }
    }
    const loyaltyRedeemedRow = document.getElementById('r-loyalty-redeemed-row');
    if (loyaltyRedeemedRow) {
        if (tx.loyaltyPointsRedeemed) {
            document.getElementById('r-loyalty-redeemed').innerText = tx.loyaltyPointsRedeemed;
            loyaltyRedeemedRow.style.display ='flex';
        } else {
            loyaltyRedeemedRow.style.display ='none';
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
    const loyaltyBalanceRow = document.getElementById('r-loyalty-balance-row');
    if (loyaltyBalanceRow) {

        if ((tx.loyaltyPointsRedeemed || tx.loyaltyPointsEarned) && Number.isFinite(tx.loyaltyPointsBalance)) {
            document.getElementById('r-loyalty-balance').innerText = tx.loyaltyPointsBalance;
            loyaltyBalanceRow.style.display ='flex';
        } else {
            loyaltyBalanceRow.style.display ='none';
        }
    }

    const emailInputEl = document.getElementById('r-email-input');
    if (emailInputEl) {
        emailInputEl.value = tx.customerEmail ||'';
    }

    const bcSettings = Object.assign({}, DEFAULT_RECEIPT_BARCODE_SETTINGS, (receiptSettingsCache && receiptSettingsCache.barcodeSettings) || {});
    const barcodeContainerEl = document.querySelector('#printable-receipt-area .receipt-barcode-container');
    if (barcodeContainerEl) barcodeContainerEl.style.display = bcSettings.show !== false ?'' :'none';

    if (bcSettings.show !== false) {
        setTimeout(() => {
            JsBarcode("#receipt-barcode", tx.id, {
                format:"CODE128",
                width: bcSettings.width,
                height: bcSettings.height,
                displayValue: bcSettings.displayValue,
                fontSize: bcSettings.fontSize,
                margin: bcSettings.margin
            });
        }, 50);
    }

    applyLoyaltyQrSettingsToDom(!isHistory ? currentReceiptLoyaltyQr : null);

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

    document.getElementById('receipt-modal').classList.toggle('terminal-origin', !isHistory);
    document.getElementById('receipt-modal').style.display ='flex';

    document.body.classList.add('print-target-receipt');
    document.body.classList.remove('print-target-barcode');
}

function resetSaleTerminalCycle() {
    closeModal('receipt-modal');
    clearCart();
    loadTerminalCatalog();

    currentReceiptLoyaltyQr = null;
    currentReceiptLoyaltyQrPrintData = null;
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
        const totalRefunded = parseFloat(tx.totalRefunded) || 0;
        const isFullyRefunded = tx.refundStatus === 'full' || totalRefunded >= (parseFloat(tx.total) || 0) - 0.01;
        const refundBadge = totalRefunded > 0
            ? `<br><span class="badge" style="background:${isFullyRefunded ? '#ef4444' : '#f59e0b'}; margin-top:4px; display:inline-block;">${isFullyRefunded ? 'Fully Refunded' : 'Partially Refunded'} (₱${totalRefunded.toFixed(2)})</span>`
            : '';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${tx.id}</strong></td>
            <td>${tx.timestamp}</td>
            <td><span class="badge" style="background:#64748b;">${escapeHtml(tx.cashier)}</span></td>
            <td>${totalItemsQty} item(s)</td>
            <td class="text-danger">₱${parseFloat(tx.discount || 0).toFixed(2)}</td>
            <td class="font-bold">₱${parseFloat(tx.total).toFixed(2)}${refundBadge}</td>
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
                <button class="btn-clear" onclick="handleVoidTransaction('${tx.id}')" style="color: #ef4444; padding: 4px 8px; font-size: 0.9rem; margin-left: 5px;" ${totalRefunded > 0 ? 'disabled title="May naitalang refund na sa transaksyong ito — hindi na puwedeng i-void, gamitin na lang ang Refund para sa natitirang balanse"' : ''}>
        <i class="fa-solid fa-ban"></i> Void
 </button>
                <button class="btn-clear" onclick="handleRefundTransaction('${tx.id}')" style="color: #f59e0b; padding: 4px 8px; font-size: 0.9rem; margin-left: 5px;" ${isFullyRefunded ? 'disabled title="Naka-full refund na ang transaksyong ito"' : ''}>
        <i class="fa-solid fa-rotate-left"></i> Refund
 </button>
            </td>
            
        `;
        tbody.appendChild(row);
    });
}

let cachedInventoryProducts = [];

const columnFilters = { code: new Set(), name: new Set(), category: new Set(), supplier: new Set(), price: new Set(), stock: new Set(), expiryDate: new Set(), hasSpecs: new Set() };
let activeFilterField = null;

function productHasDetails(p) {
    const hasDescription = !!(p.description && p.description.trim());
    const hasSpecsList = Array.isArray(p.specs) && p.specs.some(s => s && ((s.key && s.key.trim()) || (s.value && s.value.trim())));
    const hasGallery = Array.isArray(p.images) && p.images.filter(Boolean).length > 0;
    return hasDescription || hasSpecsList || hasGallery;
}

function getColumnDisplayValue(field, p) {
    switch (field) {
        case'code': return p.code ||'';
        case'name': return p.name ||'';
        case'category': return p.category ||'';
        case'supplier': return p.supplier ||'(No Supplier)';
        case'price': return `₱${parseFloat(p.price || 0).toFixed(2)}`;
        case'stock': return String(p.stock ??'');
        case'expiryDate': return p.expiryDate ? p.expiryDate :'(No Expiry)';
        case'hasSpecs': return productHasDetails(p) ?'May Specs/Description' :'Walang Specs/Description';
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
        <div class="col-filter-search"><input type="text" placeholder="Search..." oninput="filterColumnFilterOptions(this.value)"></div>
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
        list.innerHTML = `<div class="col-filter-empty">Empty</div>`;
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
                const hasDetails = productHasDetails(p);
                row.innerHTML = `
                    <td>${p.image ? `<img class="inv-thumb" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name ||'Product')}" onclick="showProductDetails('${safeCodeAttr}', 'inventory')" title="View details">` : `<div class="inv-thumb-fallback" onclick="showProductDetails('${safeCodeAttr}', 'inventory')" title="View details"><i class="${getCategoryIconClass(p.category)}"></i></div>`}</td>
                    <td class="font-bold">${safeCode}</td>
                    <td>${escapeHtml(p.name)}</td>
                    <td><span class="badge-role cashier">${escapeHtml(p.category)}</span></td>
                    <td>${p.supplier ? escapeHtml(p.supplier) : '<span style="color:#94a3b8;">—</span>'}</td>
                    <td>₱${parseFloat(p.price).toFixed(2)}</td>
                    <td style="${isLowStock ?'color:#f59e0b;font-weight:600;' :''}">${p.stock}</td>
                    <td>${expiryDisplay}</td>
                    <td style="text-align:center;">
                        <button class="btn-clear" onclick="showProductDetails('${safeCodeAttr}', 'inventory')" style="color: var(--primary-blue); padding: 4px 8px; font-size: 0.9rem;">
                            <i class="fa-solid fa-eye"></i> View${hasDetails ? ' <span class="details-has-specs-dot" title="May naka-save na Specs/Description"></span>' :''}
                        </button>
                    </td>
                    <td>
                        <div class="action-icon-btns-row">
                            <button class="btn-icon-action edit" onclick="openProductModal('UPDATE', '${safeCodeAttr}')"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button class="btn-icon-action delete" onclick="deleteProductTrigger('${safeCodeAttr}')"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                `;
                tbody.appendChild(row);
            } catch (rowError) {

                console.error("Skipped a product in the Inventory table due to a row render error:", p, rowError);
            }
        });
    } catch (renderError) {
        console.error("Failed to render Inventory product table:", renderError);
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
        document.getElementById('p-form-details').value ='';
        document.getElementById('p-form-specs').value ='';
        setProductGalleryImages([]);
        updateProductSpecsButtonLabel();

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
        document.getElementById('p-form-details').value ='';
        document.getElementById('p-form-specs').value ='';
        setProductGalleryImages([]);
        updateProductSpecsButtonLabel();

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
                document.getElementById('p-form-details').value = match.description ||'';
                document.getElementById('p-form-specs').value = Array.isArray(match.specs) ? JSON.stringify(match.specs) :'';
                setProductGalleryImages(Array.isArray(match.images) ? match.images.filter(Boolean) : []);
                updateProductSpecsButtonLabel();
            } else {
                document.getElementById('product-modal').style.display = 'none';
                Swal.fire('Not Found', 'Could not find this product — it may have been deleted on another device/session.', 'error');
            }
        }).catch(err => {
            console.error('Failed to load product data for edit:', err);
            document.getElementById('product-modal').style.display = 'none';
            Swal.fire('Connection Error', 'Could not retrieve the product data from the server. Check your connection and try again.', 'error');
        });
    }
    document.getElementById('product-modal').style.display ='flex';
}

// ---- Additional Photos (gallery) ----

function getProductGalleryImages() {
    try {
        const raw = document.getElementById('p-form-images').value;
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function setProductGalleryImages(images) {
    document.getElementById('p-form-images').value = images.length ? JSON.stringify(images) :'';
    renderProductGalleryPreview(images);
}

function renderProductGalleryPreview(images) {
    const container = document.getElementById('p-form-gallery-preview');
    if (!container) return;
    container.innerHTML = images.map((src, idx) => `
        <div class="prod-gallery-thumb-wrap">
            <img src="${src}" alt="Photo ${idx + 1}">
            <button type="button" class="prod-gallery-remove-btn" onclick="removeProductGalleryImage(${idx})" title="Alisin">&times;</button>
        </div>
    `).join('');
}

function removeProductGalleryImage(idx) {
    const images = getProductGalleryImages();
    images.splice(idx, 1);
    setProductGalleryImages(images);
}

function handleProductGalleryPhotoSelect(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const existing = getProductGalleryImages();
    const MAX_GALLERY = 6;
    const remainingSlots = Math.max(0, MAX_GALLERY - existing.length);
    if (remainingSlots <= 0) {
        Swal.fire('Limit Reached', `Pinakamarami hanggang ${MAX_GALLERY} na additional photos lang bawat produkto.`,'warning');
        event.target.value ='';
        return;
    }

    const toProcess = files.slice(0, remainingSlots);
    Promise.all(toProcess.map(file => new Promise((resolve) => {
        if (!file.type.startsWith('image/')) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            resizeImageDataUrlForProduct(e.target.result).then(resolve).catch(() => resolve(null));
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    }))).then(results => {
        const valid = results.filter(Boolean);
        setProductGalleryImages(existing.concat(valid));
        event.target.value ='';
    });
}

// ---- Specs / Description modal ----
// Opens a dedicated modal so the Add/Edit Product form itself doesn't get
// cluttered — this is where any extra product detail (free-text description
// plus structured key/value specs like sukat, laman, warranty, atbp.) gets
// typed in full, then stored into the hidden #p-form-details /
// #p-form-specs fields when the user presses Save here.

function getProductSpecsDraftKey() {
    const code = (document.getElementById('p-form-code').value ||'').trim();
    return'omnipos_specs_draft_' + (code ||'NEW');
}

function autosaveProductSpecsDraft() {
    try {
        const draft = {
            description: document.getElementById('p-form-details-textarea').value ||'',
            specs: getProductSpecsRowsData()
        };
        localStorage.setItem(getProductSpecsDraftKey(), JSON.stringify(draft));
    } catch (e) {  }
}

function clearProductSpecsDraft() {
    try { localStorage.removeItem(getProductSpecsDraftKey()); } catch (e) {  }
}

function addProductSpecRow(key ='', value ='') {
    const container = document.getElementById('p-form-specs-rows');
    if (!container) return;
    const row = document.createElement('div');
    row.className ='p-spec-row';
    row.style.cssText ='display:flex;gap:8px;margin-bottom:8px;align-items:center;';
    row.innerHTML = `
        <input type="text" class="p-spec-key" placeholder="hal. Sukat" value="${key.replace(/"/g,'&quot;')}" style="flex:1;min-width:0;" oninput="autosaveProductSpecsDraft();">
        <input type="text" class="p-spec-value" placeholder="hal. 500ml" value="${value.replace(/"/g,'&quot;')}" style="flex:1;min-width:0;" oninput="autosaveProductSpecsDraft();">
        <button type="button" class="btn-icon-action delete" onclick="this.closest('.p-spec-row').remove(); autosaveProductSpecsDraft();" title="Alisin"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);
}

function renderProductSpecsRows(specsArray) {
    const container = document.getElementById('p-form-specs-rows');
    if (!container) return;
    container.innerHTML ='';
    (Array.isArray(specsArray) ? specsArray : []).forEach(s => {
        if (s && (s.key || s.value)) addProductSpecRow(s.key ||'', s.value ||'');
    });
}

function getProductSpecsRowsData() {
    const rows = document.querySelectorAll('#p-form-specs-rows .p-spec-row');
    const result = [];
    rows.forEach(row => {
        const key = (row.querySelector('.p-spec-key').value ||'').trim();
        const value = (row.querySelector('.p-spec-value').value ||'').trim();
        if (key || value) result.push({ key, value });
    });
    return result;
}

function updateProductSpecsCharCount() {
    const el = document.getElementById('p-form-details-charcount');
    const textarea = document.getElementById('p-form-details-textarea');
    if (!el || !textarea) return;
    const MAX_CHARS = 3000;
    const len = textarea.value.length;
    el.textContent = `${len} / ${MAX_CHARS}`;
    el.style.color = len > MAX_CHARS ?'#dc2626' :'#94a3b8';
}

function openProductSpecsModal() {
    const savedDescription = document.getElementById('p-form-details').value ||'';
    let savedSpecs = [];
    try {
        const raw = document.getElementById('p-form-specs').value;
        savedSpecs = raw ? JSON.parse(raw) : [];
    } catch (e) { savedSpecs = []; }

    let draft = null;
    try {
        const rawDraft = localStorage.getItem(getProductSpecsDraftKey());
        draft = rawDraft ? JSON.parse(rawDraft) : null;
    } catch (e) { draft = null; }

    const draftHasContent = draft && ((draft.description ||'').trim() || (Array.isArray(draft.specs) && draft.specs.length));
    const savedHasContent = (savedDescription ||'').trim() || savedSpecs.length;

    const applyState = (description, specs) => {
        document.getElementById('p-form-details-textarea').value = description ||'';
        updateProductSpecsCharCount();
        renderProductSpecsRows(specs || []);
    };

    if (draftHasContent && !savedHasContent) {

        applyState(draft.description, draft.specs);
        Swal.fire({
            toast: true, position:'top-end', icon:'info',
            title:'May na-restore na draft mula sa hindi na-save na sesyon.',
            showConfirmButton: false, timer: 2500, timerProgressBar: true
        });
    } else {
        applyState(savedDescription, savedSpecs);
    }

    document.getElementById('product-specs-modal').style.display ='flex';
}

function closeProductSpecsModal() {

    closeModal('product-specs-modal');
}

function saveProductSpecsModal() {
    const description = document.getElementById('p-form-details-textarea').value.trim();
    const specs = getProductSpecsRowsData();
    document.getElementById('p-form-details').value = description;
    document.getElementById('p-form-specs').value = specs.length ? JSON.stringify(specs) :'';
    updateProductSpecsButtonLabel();
    clearProductSpecsDraft();
    closeModal('product-specs-modal');
}

function updateProductSpecsButtonLabel() {
    const btn = document.getElementById('p-form-specs-btn');
    if (!btn) return;
    const hasDescription = (document.getElementById('p-form-details').value ||'').trim().length > 0;
    let hasSpecs = false;
    try {
        const raw = document.getElementById('p-form-specs').value;
        hasSpecs = raw ? (JSON.parse(raw).length > 0) : false;
    } catch (e) { hasSpecs = false; }
    btn.innerHTML = (hasDescription || hasSpecs)
        ? '<i class="fa-solid fa-circle-check"></i> Specs / Description Added (tap to edit)'
        : '<i class="fa-solid fa-list-ul"></i> Add Specs / Description';
}

function openCopySpecsFromProductModal() {
    const currentCode = (document.getElementById('p-form-code').value ||'').trim();
    const pool = (cachedInventoryProducts && cachedInventoryProducts.length) ? cachedInventoryProducts : (globalProducts || []);
    const candidates = pool.filter(p => p.code !== currentCode && ((p.description && p.description.trim()) || (Array.isArray(p.specs) && p.specs.length)));

    if (!candidates.length) {
        Swal.fire('Walang Available','Wala pang ibang produkto na may naka-save na Specs/Description.','info');
        return;
    }

    Swal.fire({
        title:'Copy Specs mula sa Ibang Produkto',
        html: `
            <input type="text" id="copy-specs-search" class="swal2-input" placeholder="Maghanap ng produkto (code o pangalan)..." autocomplete="off">
            <div id="copy-specs-list" style="max-height:260px;overflow-y:auto;text-align:left;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px;"></div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText:'Isara',
        didOpen: () => {
            const renderList = (query) => {
                const q = (query ||'').trim().toLowerCase();
                const filtered = candidates.filter(p =>
                    !q || (p.code ||'').toLowerCase().includes(q) || (p.name ||'').toLowerCase().includes(q)
                ).slice(0, 50);
                const listEl = document.getElementById('copy-specs-list');
                if (!listEl) return;
                listEl.innerHTML = filtered.length
                    ? filtered.map(p => `
                        <div class="copy-specs-item" data-code="${escapeHtml(p.code)}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;">
                            <b>${escapeHtml(p.code)}</b> — ${escapeHtml(p.name ||'')}
                        </div>`).join('')
                    : `<div style="padding:10px;color:#94a3b8;">Walang tugma.</div>`;
                listEl.querySelectorAll('.copy-specs-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const code = item.getAttribute('data-code');
                        const src = candidates.find(p => p.code === code);
                        if (src) {
                            document.getElementById('p-form-details-textarea').value = src.description ||'';
                            updateProductSpecsCharCount();
                            renderProductSpecsRows(Array.isArray(src.specs) ? src.specs : []);
                            autosaveProductSpecsDraft();
                        }
                        Swal.close();
                    });
                });
            };
            renderList('');
            const searchInput = document.getElementById('copy-specs-search');
            if (searchInput) searchInput.addEventListener('input', (e) => renderList(e.target.value));
        }
    });
}

function handleProductPhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        Swal.fire('Wrong File Type','Only images (JPG, PNG, etc.) can be uploaded as a product photo.','error');
        event.target.value ='';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        resizeImageDataUrlForProduct(e.target.result).then((compressedDataUrl) => {
            document.getElementById('p-form-image').value = compressedDataUrl;
            updateProductPhotoPreview(compressedDataUrl);
        }).catch(() => {
            Swal.fire('Invalid Image', 'This file could not be read as an image.', 'error');
            event.target.value = '';
        });
    };
    reader.readAsDataURL(file);
}

function resizeImageDataUrlForProduct(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const MAX_DIM = 600;
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
            resolve(canvas.toDataURL('image/jpeg', 0.90));
        };
        img.onerror = () => reject(new Error('Invalid image data.'));
        img.src = dataUrl;
    });
}

let productImageSearchState = { nonce: null, busy: false, source: null };

function openProductImageSearchModal() {
    const nameVal = (document.getElementById('p-form-name').value || '').trim();
    productImageSearchState = { nonce: null, busy: false, source: null };
    document.getElementById('p-image-search-query').value = nameVal;
    document.getElementById('p-image-search-results').innerHTML = '';
    document.getElementById('p-image-search-status').textContent = '';
    document.getElementById('product-image-search-modal').style.display = 'flex';
    if (nameVal) {
        performOmniProductImageSearch();
    } else {
        document.getElementById('p-image-search-query').focus();
    }
}

function closeProductImageSearchModal() {
    document.getElementById('product-image-search-modal').style.display = 'none';
}

async function performProductImageSearch() {
    const query = (document.getElementById('p-image-search-query').value || '').trim();
    const statusEl = document.getElementById('p-image-search-status');
    const resultsEl = document.getElementById('p-image-search-results');

    if (!query) {
        statusEl.textContent = 'Type a search term first.';
        return;
    }
    if (productImageSearchState.busy) return;

    productImageSearchState.busy = true;
    productImageSearchState.source = 'paid';
    statusEl.textContent = 'Searching...';
    resultsEl.innerHTML = '';

    try {
        const res = await authFetch(`${API_URL}/products/image-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Image search failed.';
            return;
        }

        productImageSearchState.nonce = data.nonce;

        if (!data.results || !data.results.length) {
            statusEl.textContent = 'No results found. Try a different search term.';
            return;
        }

        statusEl.textContent = `${data.results.length} result(s) — click one to use it, then review and Save.`;
        renderProductImageSearchResults(data.results);
    } catch (err) {
        console.error('Image search error:', err);
        statusEl.textContent = 'Connection error while searching. Please try again.';
    } finally {
        productImageSearchState.busy = false;
    }
}

// Free, no-API-key version of the search above — same self-healing provider
// cascade (DuckDuckGo → Bing (free) → Openverse → Wikimedia Commons →
// Yandex) used by the "Omni Search" option in the Bulk Search Images modal,
// just scoped to this one product instead of running over a whole batch.
async function performOmniProductImageSearch() {
    const query = (document.getElementById('p-image-search-query').value || '').trim();
    const statusEl = document.getElementById('p-image-search-status');
    const resultsEl = document.getElementById('p-image-search-results');

    if (!query) {
        statusEl.textContent = 'Type a search term first.';
        return;
    }
    if (productImageSearchState.busy) return;

    productImageSearchState.busy = true;
    productImageSearchState.source = 'omni';
    statusEl.textContent = 'Omni Search running (trying free sources)...';
    resultsEl.innerHTML = '';

    try {
        const res = await authFetch(`${API_URL}/products/image-search/omni`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Omni Search failed.';
            return;
        }

        productImageSearchState.nonce = data.nonce;

        if (!data.results || !data.results.length) {
            statusEl.textContent = 'No results found. Try a different search term.';
            return;
        }

        statusEl.textContent = `${data.results.length} result(s) via ${data.provider} — click one to use it, then review and Save.`;
        renderProductImageSearchResults(data.results);
    } catch (err) {
        console.error('Omni image search error:', err);
        statusEl.textContent = 'Connection error while searching. Please try again.';
    } finally {
        productImageSearchState.busy = false;
    }
}

function renderProductImageSearchResults(results) {
    const resultsEl = document.getElementById('p-image-search-results');
    resultsEl.innerHTML = results.map(r => {
        const safeTitle = (r.title || '').replace(/"/g, '&quot;');
        const safeThumb = (r.thumbnailUrl || '').replace(/"/g, '&quot;');
        return `<button type="button" class="p-image-search-thumb" onclick="selectSearchedProductImage('${r.id}')" title="${safeTitle}">
            <img src="${safeThumb}" alt="${safeTitle}" loading="lazy">
        </button>`;
    }).join('');
}

async function selectSearchedProductImage(id) {
    if (!productImageSearchState.nonce) return;
    const statusEl = document.getElementById('p-image-search-status');
    statusEl.textContent = 'Loading image...';

    const endpoint = productImageSearchState.source === 'omni'
        ? '/products/image-search/omni/select'
        : '/products/image-search/select';

    try {
        const res = await authFetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce: productImageSearchState.nonce, id })
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Could not load that image.';
            return;
        }

        const resized = await resizeImageDataUrlForProduct(data.dataUrl);
        document.getElementById('p-form-image').value = resized;
        updateProductPhotoPreview(resized);
        closeProductImageSearchModal();
    } catch (err) {
        console.error('Image select error:', err);
        statusEl.textContent = 'Connection error while loading the image. Please try again.';
    }
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
    const detailsVal = document.getElementById('p-form-details').value.trim();
    const specsRaw = document.getElementById('p-form-specs').value;
    const imagesRaw = document.getElementById('p-form-images').value;
    if (supplierVal) payload.supplier = supplierVal;
    if (expiryVal) payload.expiryDate = expiryVal;
    if (thresholdVal !=='') payload.lowStockThreshold = parseInt(thresholdVal);
    if (detailsVal) payload.description = detailsVal;
    if (specsRaw) {
        try { payload.specs = JSON.parse(specsRaw); } catch (e) {  }
    }
    if (imagesRaw) {
        try { payload.images = JSON.parse(imagesRaw); } catch (e) {  }
    }

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
            clearProductSpecsDraft();

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
            let msg ='Could not download the file.';
            try {
                const data = await res.json();
                msg = data.message || msg;
            } catch (e) {  }
            Swal.fire('Download Failed', msg,'error');
            return false;
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
        return true;
    } catch (err) {
        console.error('Download error:', err);
        Swal.fire('Download Failed','An error occurred while downloading the file.','error');
        return false;
    }
}

function downloadProductTemplate() {
    downloadAuthFetch(`${API_URL}/products/template`, `product_template_${Date.now()}.xlsx`);
}

// ---- Bulk Import Specs/Description (CSV: Code, Description) ----
// Lightweight, client-side counterpart to the full product Excel
// import/template — meant specifically for quickly filling in Description
// for many existing products at once via a simple 2-column CSV.

function openBulkSpecsImportModal() {
    Swal.fire({
        title:'Bulk Import Specs',
        html: `
            <p style="font-size:0.85rem;color:#64748b;text-align:left;">
                Mag-upload ng CSV file na may 2 column: <b>Code</b> at <b>Description</b>.<br>
                Ang unang row dapat ang header. Ang mga Product Code na wala sa system ay iski-skip.
            </p>
        `,
        confirmButtonText:'Piliin ang CSV File',
        showCancelButton: true,
        cancelButtonText:'Cancel'
    }).then(result => {
        if (result.isConfirmed) {
            const input = document.getElementById('bulk-specs-file-input');
            if (input) input.click();
        }
    });
}

function parseSimpleCsv(text) {
    const rows = [];
    const lines = text.split(/\r?\n/).filter(l => l.trim() !=='');
    for (const line of lines) {
        const cells = [];
        let cur ='';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch ==='"') {
                    if (line[i + 1] ==='"') { cur +='"'; i++; } else { inQuotes = false; }
                } else {
                    cur += ch;
                }
            } else {
                if (ch ==='"') inQuotes = true;
                else if (ch ===',') { cells.push(cur); cur =''; }
                else cur += ch;
            }
        }
        cells.push(cur);
        rows.push(cells);
    }
    return rows;
}

async function handleBulkSpecsImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value ='';

    let text ='';
    try {
        text = await file.text();
    } catch (e) {
        Swal.fire('Error','Hindi ma-basa ang file.','error');
        return;
    }

    const rows = parseSimpleCsv(text);
    if (rows.length < 2) {
        Swal.fire('Walang Laman','Walang mahanap na laman sa CSV file.','warning');
        return;
    }

    const header = rows[0].map(h => h.trim().toLowerCase());
    const codeIdx = header.indexOf('code');
    const descIdx = header.indexOf('description');
    if (codeIdx === -1 || descIdx === -1) {
        Swal.fire('Maling Format','Kailangan ng "Code" at "Description" column sa CSV file.','error');
        return;
    }

    const dataRows = rows.slice(1).filter(r => (r[codeIdx] ||'').trim());
    if (!dataRows.length) {
        Swal.fire('Walang Laman','Walang valid na Code na nahanap sa file.','warning');
        return;
    }

    const confirmResult = await Swal.fire({
        title: `I-import ang ${dataRows.length} specs/description?`,
        text:'Ipapalit nito ang Description ng mga tumutugmang Product Code.',
        icon:'question',
        showCancelButton: true,
        confirmButtonText:'Oo, i-import',
        cancelButtonText:'Cancel'
    });
    if (!confirmResult.isConfirmed) return;

    Swal.fire({
        title:'Iniimport...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => Swal.showLoading()
    });

    let updated = 0, skipped = 0, failed = 0;
    for (const row of dataRows) {
        const code = (row[codeIdx] ||'').trim();
        const description = (row[descIdx] ||'').trim();
        const exists = cachedInventoryProducts.some(p => p.code === code) || globalProducts.some(p => p.code === code);
        if (!exists) { skipped++; continue; }
        try {
            const res = await authFetch(`${API_URL}/products/${encodeURIComponent(code)}`, {
                method:'PUT',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({ updatedData: { description }, userRole: currentUser.role, username: currentUser.username })
            });
            const reply = await res.json();
            if (reply.success) updated++; else failed++;
        } catch (e) {
            failed++;
        }
    }

    if (typeof loadInventoryProductsTable ==='function') loadInventoryProductsTable();

    Swal.fire({
        title:'Import Complete',
        html: `<p>✅ Na-update: <b>${updated}</b></p><p>⏭️ Na-skip (walang tugmang code): <b>${skipped}</b></p>${failed ? `<p>❌ Nabigo: <b>${failed}</b></p>` :''}`,
        icon:'success'
    });
}

async function exportProductsCsv() {
    if (guardPremiumFeature('advanced_reports')) return;

    const confirmResult = await Swal.fire({
        title:'Export Products?',
        html:'This will download your <strong>current product inventory</strong> as a CSV file. Do you want to continue?',
        icon:'question',
        showCancelButton: true,
        confirmButtonText:'Yes, Export',
        cancelButtonText:'Cancel',
        confirmButtonColor:'#7c5cff',
    });
    if (!confirmResult.isConfirmed) return;

    Swal.fire({
        title:'Preparing your file…',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => Swal.showLoading(),
    });

    const success = await downloadAuthFetch(`${API_URL}/products/export`, `inventory_export_${Date.now()}.csv`);

    if (success) {
        Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Product export downloaded', showConfirmButton:false, timer:1800, timerProgressBar: true });
    }
}

let selectedImportMode ='skip';

function triggerProductImport() {
    Swal.fire({
        title:'How would you like to import the file?',
        html:'<p style="font-size:14px;color:#64748b;">If a Product Code is already on record...</p>',
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
        title:'Importing products...',
        text:'Please wait a moment.',
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
            Swal.fire('Import Failed', reply.message ||'Could not import the file.','error');
            return;
        }

        if (reply.products) globalProducts = reply.products;
        if (reply.categories) customCategories = reply.categories;
        updateDropdownCategoriesDynamic();
        updateCategoryChipsDynamic();
        if (typeof loadInventoryProductsTable ==='function') loadInventoryProductsTable();
        if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();

        let summaryHtml = `<p>✅ Successfully added: <b>${reply.added}</b> product(s)</p>`;
        if (reply.updated) {
            summaryHtml += `<p>🔄 Updated: <b>${reply.updated}</b> existing product(s)</p>`;
        }
        if (reply.newCategories && reply.newCategories.length) {
            summaryHtml += `<p>🏷️ New categories added: <b>${reply.newCategories.join(', ')}</b></p>`;
        }
        if (reply.skipped) {
            summaryHtml += `<p>⚠️ Skipped: <b>${reply.skipped}</b> row(s) (duplicate code or missing data)</p>`;
        }
        if (reply.errors && reply.errors.length) {
            summaryHtml += `<div style="text-align:left;max-height:150px;overflow:auto;margin-top:10px;padding:8px;background:#fef2f2;border-radius:6px;font-size:12.5px;color:#b91c1c;">${reply.errors.join('<br>')}</div>`;
            summaryHtml += `<div style="margin-top:10px;"><button type="button" id="download-import-errors-btn" class="btn-action-outline" style="font-size:12.5px;padding:6px 12px;">📥 Download Error Report (CSV)</button></div>`;
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
        Swal.fire('Connection Lost','❌ Could not connect to the server. Try again.','error');
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

let bulkPhotoSelection = [];
let bulkPhotoProductsList = [];

function normalizeMatchKeyClient(str) {
    return (str ||'')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i,'')
        .replace(/[_\-\s]+/g,' ')
        .replace(/[^a-z0-9 ]/g,'')
        .trim();
}

async function openBulkPhotoModal() {
    clearBulkPhotoSelection();
    bulkPhotoProductsList = Array.isArray(globalProducts) && globalProducts.length ? globalProducts :[];

    document.getElementById('bulk-photo-modal').style.display ='flex';

    try {
        const res = await authFetch(`${API_URL}/products`);
        if (res.ok) {
            const fresh = await res.json();
            if (Array.isArray(fresh)) {
                bulkPhotoProductsList = fresh;
                globalProducts = fresh;
            }
        }
    } catch (err) {
        console.warn('Bulk Upload Photos: hindi ma-refresh ang products list, gagamitin na lang ang cached list.', err);
    }
}

function closeBulkPhotoModal() {
    closeModal('bulk-photo-modal');
}

function findMatchingProductForFilename(filename) {
    const key = normalizeMatchKeyClient(filename);
    if (!key) return null;

    let match = bulkPhotoProductsList.find(p => p && p.code && normalizeMatchKeyClient(p.code) === key);
    if (match) return { product: match, matchedBy:'code' };

    match = bulkPhotoProductsList.find(p => p && p.name && normalizeMatchKeyClient(p.name) === key);
    if (match) return { product: match, matchedBy:'name' };

    return null;
}

function handleBulkPhotoFilesSelected(event) {
    const pickedFiles = Array.from(event.target.files ||[]).filter(f => f.type && f.type.startsWith('image/'));
    event.target.value ='';
    if (!pickedFiles.length) return;

    const existingKeys = new Set(bulkPhotoSelection.map(item => `${item.file.name}__${item.file.size}`));

    pickedFiles.forEach(file => {
        const dedupeKey = `${file.name}__${file.size}`;
        if (existingKeys.has(dedupeKey)) return;
        existingKeys.add(dedupeKey);

        const found = findMatchingProductForFilename(file.name);
        bulkPhotoSelection.push({
            file,
            previewUrl: URL.createObjectURL(file),
            matchedProduct: found ? found.product : null,
            matchedBy: found ? found.matchedBy : null
        });
    });

    renderBulkPhotoPreview();
}

function renderBulkPhotoPreview() {
    const listEl = document.getElementById('bulk-photo-preview-list');
    const summaryEl = document.getElementById('bulk-photo-summary');
    const applyBtn = document.getElementById('bulk-photo-apply-btn');
    const clearBtn = document.getElementById('bulk-photo-clear-btn');
    if (!listEl) return;

    if (!bulkPhotoSelection.length) {
        listEl.innerHTML ='';
        summaryEl.style.display ='none';
        applyBtn.style.display ='none';
        clearBtn.style.display ='none';
        return;
    }

    const matchedCount = bulkPhotoSelection.filter(i => i.matchedProduct).length;
    const unmatchedCount = bulkPhotoSelection.length - matchedCount;

    summaryEl.style.display ='block';
    summaryEl.innerHTML = `✅ <span style="color:#16a34a;">${matchedCount} matched</span>` +
        (unmatchedCount ? ` &nbsp;|&nbsp; ⚠️ <span style="color:#dc2626;">${unmatchedCount} unmatched</span>` :'');

    clearBtn.style.display ='inline-flex';
    applyBtn.style.display = matchedCount ?'inline-flex' :'none';

    listEl.innerHTML = bulkPhotoSelection.map((item, idx) => {
        const isMatched = !!item.matchedProduct;
        const matchLabel = isMatched
            ? `${escapeHtml(item.matchedProduct.code)} — ${escapeHtml(item.matchedProduct.name)}`
            :'No matching product found';
        return `
            <div class="bulk-photo-item ${isMatched ?'':'is-unmatched'}">
                <img src="${item.previewUrl}" alt="preview">
                <div class="bulk-photo-item-info">
                    <div class="bulk-photo-item-match">${matchLabel}</div>
                    <div class="bulk-photo-item-filename">${escapeHtml(item.file.name)}</div>
                </div>
                <button type="button" class="bulk-photo-item-remove" onclick="removeBulkPhotoItem(${idx})" title="Remove">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    }).join('');
}

function removeBulkPhotoItem(idx) {
    const item = bulkPhotoSelection[idx];
    if (item) URL.revokeObjectURL(item.previewUrl);
    bulkPhotoSelection.splice(idx, 1);
    renderBulkPhotoPreview();
}

function clearBulkPhotoSelection() {
    bulkPhotoSelection.forEach(item => URL.revokeObjectURL(item.previewUrl));
    bulkPhotoSelection = [];
    const filesInput = document.getElementById('bulk-photo-files-input');
    const folderInput = document.getElementById('bulk-photo-folder-input');
    if (filesInput) filesInput.value ='';
    if (folderInput) folderInput.value ='';
    renderBulkPhotoPreview();
}

function compressImageFileToBlob(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const MAX_DIM = 640;
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
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality ='high';
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(blob => {
                    if (blob) resolve(blob); else reject(new Error('Could not compress this photo.'));
                },'image/jpeg', 0.92);
            };
            img.onerror = () => reject(new Error('Could not open this photo.'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Could not read this file.'));
        reader.readAsDataURL(file);
    });
}

async function submitBulkPhotoUpload() {
    const matchedItems = bulkPhotoSelection.filter(i => i.matchedProduct);
    if (!matchedItems.length) return;

    Swal.fire({
        title: `Applying ${matchedItems.length} photo(s)...`,
        text:'Please wait a moment.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const formData = new FormData();
        for (const item of matchedItems) {
            const compressedBlob = await compressImageFileToBlob(item.file);
            formData.append('images', compressedBlob, item.file.name);
        }

        const res = await authFetch(`${API_URL}/products/bulk-photos`, {
            method:'POST',
            body: formData,
            timeoutMs: 120000
        });
        const reply = await res.json();

        if (!reply.success) {
            Swal.fire('Bulk Upload Failed', reply.message ||'Could not apply the photos.','error');
            return;
        }

        if (reply.products) globalProducts = reply.products;
        if (typeof loadInventoryProductsTable ==='function') loadInventoryProductsTable();
        if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();

        let summaryHtml = `<p>✅ Applied: <b>${reply.appliedCount}</b> photo(s)</p>`;
        if (reply.unmatchedCount) summaryHtml += `<p>⚠️ No match found: <b>${reply.unmatchedCount}</b> file(s)</p>`;
        if (reply.failedCount) summaryHtml += `<p>❌ Failed: <b>${reply.failedCount}</b> file(s)</p>`;

        Swal.fire({
            title:'Bulk Upload Complete',
            html: summaryHtml,
            icon: (reply.failedCount) ?'warning' :'success'
        });

        closeBulkPhotoModal();
    } catch (error) {
        console.error(error);
        Swal.fire('Connection Lost','❌ Could not connect to the server. Try again.','error');
    }
}

let bulkImageSearchState = { nonce: null, proposals: [], pollTimer: null };

function stopBulkImageSearchPolling() {
    if (bulkImageSearchState.pollTimer) {
        clearTimeout(bulkImageSearchState.pollTimer);
        bulkImageSearchState.pollTimer = null;
    }
}

function openBulkImageSearchModal() {
    stopBulkImageSearchPolling();
    bulkImageSearchState = { nonce: null, proposals: [], pollTimer: null };
    document.getElementById('bulk-imgsearch-status').textContent = '';
    document.getElementById('bulk-imgsearch-preview-list').innerHTML = '';
    document.getElementById('bulk-imgsearch-selectall-row').style.display = 'none';
    document.getElementById('bulk-imgsearch-apply-btn').style.display = 'none';
    document.getElementById('bulk-imgsearch-progress-wrap').style.display = 'none';
    if (typeof resetOmniImageSearchUI === 'function') resetOmniImageSearchUI();
    document.getElementById('bulk-image-search-modal').style.display = 'flex';
}

function closeBulkImageSearchModal() {
    stopBulkImageSearchPolling();
    if (typeof stopOmniImageSearchPolling === 'function') stopOmniImageSearchPolling();
    document.getElementById('bulk-image-search-modal').style.display = 'none';
}

// Ginagawang mas madaling basahin ang etaMs (galing sa backend) —
// hal. "~45s" o "~2m 10s" — sa halip na hilaw na milliseconds.
function formatBulkImageSearchEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const totalSec = Math.round(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min <= 0) return `~${sec}s left`;
    return `~${min}m ${sec}s left`;
}

function updateBulkImageSearchProgressUI(done, total, etaMs) {
    const wrap = document.getElementById('bulk-imgsearch-progress-wrap');
    const bar = document.getElementById('bulk-imgsearch-progress-bar');
    const text = document.getElementById('bulk-imgsearch-progress-text');
    wrap.style.display = 'block';
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    bar.style.width = `${pct}%`;
    const etaText = formatBulkImageSearchEta(etaMs);
    text.textContent = `${done}/${total} searched (${pct}%)${etaText ? ' — ' + etaText : ''}`;
}

async function startBulkImageSearch() {
    const onlyMissing = document.getElementById('bulk-imgsearch-only-missing').checked;
    let limit = parseInt(document.getElementById('bulk-imgsearch-limit').value, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, 100);

    const startBtn = document.getElementById('bulk-imgsearch-start-btn');
    const statusEl = document.getElementById('bulk-imgsearch-status');
    const listEl = document.getElementById('bulk-imgsearch-preview-list');
    const progressWrap = document.getElementById('bulk-imgsearch-progress-wrap');

    stopBulkImageSearchPolling();
    startBtn.disabled = true;
    document.getElementById('bulk-imgsearch-selectall-row').style.display = 'none';
    document.getElementById('bulk-imgsearch-apply-btn').style.display = 'none';
    listEl.innerHTML = '';
    progressWrap.style.display = 'none';
    statusEl.textContent = 'Starting search...';

    try {
        const res = await authFetch(`${API_URL}/products/bulk-image-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ onlyMissing, limit }),
            timeoutMs: 30000
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Bulk image search failed.';
            startBtn.disabled = false;
            return;
        }

        if (!data.nonce || !data.totalTargeted) {
            statusEl.textContent = onlyMissing
                ? 'All products already have a photo — nothing to search for.'
                : 'No products found to search for.';
            startBtn.disabled = false;
            return;
        }

        bulkImageSearchState.nonce = data.nonce;
        bulkImageSearchState.totalEligible = data.totalEligible;
        bulkImageSearchState.truncated = data.truncated;
        statusEl.textContent = `Searching ${data.totalTargeted} product(s) — this can take a bit for larger batches...`;
        updateBulkImageSearchProgressUI(0, data.totalTargeted, null);

        pollBulkImageSearchProgress(startBtn);
    } catch (err) {
        console.error('Bulk image search error:', err);
        statusEl.textContent = 'Connection error while searching. Please try again.';
        startBtn.disabled = false;
    }
}

// Live progress polling — tinatawagan bawat ~900ms habang tumatakbo pa
// ang bulk search sa background (server.js), hanggang matapos (finished)
// o magkaroon ng error. Gumagamit ng setTimeout chain (hindi setInterval)
// para hindi mag-overlap ang mga poll request kung sakaling medyo
// lumambot ang network sa isang tugon.
async function pollBulkImageSearchProgress(startBtn) {
    const statusEl = document.getElementById('bulk-imgsearch-status');
    const nonce = bulkImageSearchState.nonce;
    if (!nonce) return;

    try {
        const res = await authFetch(`${API_URL}/products/bulk-image-search/progress?nonce=${encodeURIComponent(nonce)}`, {
            timeoutMs: 15000
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Lost track of the search progress. Please try again.';
            document.getElementById('bulk-imgsearch-progress-wrap').style.display = 'none';
            startBtn.disabled = false;
            return;
        }

        updateBulkImageSearchProgressUI(data.done, data.total, data.etaMs);

        if (data.error) {
            statusEl.textContent = data.error;
            document.getElementById('bulk-imgsearch-progress-wrap').style.display = 'none';
            startBtn.disabled = false;
            return;
        }

        if (!data.finished) {
            bulkImageSearchState.pollTimer = setTimeout(() => pollBulkImageSearchProgress(startBtn), 900);
            return;
        }

        // Tapos na — ipakita ang buong resulta, kapareho ng dating
        // ginagawa noong synchronous pa ang endpoint.
        document.getElementById('bulk-imgsearch-progress-wrap').style.display = 'none';
        bulkImageSearchState.proposals = data.proposals || [];

        if (!bulkImageSearchState.proposals.length) {
            statusEl.textContent = 'No products found to search for.';
            startBtn.disabled = false;
            return;
        }

        const foundCount = bulkImageSearchState.proposals.filter(p => p.found).length;
        let statusText = `Found images for ${foundCount}/${bulkImageSearchState.proposals.length} product(s).`;
        if (bulkImageSearchState.truncated) {
            statusText += ` Only the first ${data.total} of ${bulkImageSearchState.totalEligible} eligible products were processed this run — lower "Products to process" or run again for the rest.`;
        }
        statusText += ' Review below, then Apply.';
        statusEl.textContent = statusText;

        renderBulkImageSearchPreview();
        document.getElementById('bulk-imgsearch-selectall-row').style.display = foundCount ? 'flex' : 'none';
        startBtn.disabled = false;
    } catch (err) {
        console.error('Bulk image search progress poll error:', err);
        // Transient network hiccup lang — subukan ulit sa susunod na
        // tick sa halip na agad sumuko, dahil normal lang na medyo
        // magkaproblema minsan ang polling sa mobile networks.
        bulkImageSearchState.pollTimer = setTimeout(() => pollBulkImageSearchProgress(startBtn), 1500);
    }
}

function renderBulkImageSearchPreview() {
    const listEl = document.getElementById('bulk-imgsearch-preview-list');
    listEl.innerHTML = bulkImageSearchState.proposals.map((p, idx) => {
        if (!p.found) {
            return `<div class="bulk-imgsearch-item is-notfound">
                <img src="" alt="" style="visibility:hidden;">
                <div class="bulk-imgsearch-item-info">
                    <div class="bulk-imgsearch-item-name">${(p.name || '').replace(/</g, '&lt;')}</div>
                    <div class="bulk-imgsearch-item-code">${(p.code || '').replace(/</g, '&lt;')}</div>
                </div>
                <div class="bulk-imgsearch-item-status">${p.message || 'No image found'}</div>
            </div>`;
        }
        const safeThumb = (p.thumbnailUrl || '').replace(/"/g, '&quot;');
        return `<div class="bulk-imgsearch-item">
            <input type="checkbox" checked data-bulk-imgsearch-idx="${idx}" onchange="updateBulkImageSearchApplyBtn()">
            <img src="${safeThumb}" alt="" loading="lazy">
            <div class="bulk-imgsearch-item-info">
                <div class="bulk-imgsearch-item-name">${(p.name || '').replace(/</g, '&lt;')}</div>
                <div class="bulk-imgsearch-item-code">${(p.code || '').replace(/</g, '&lt;')}</div>
            </div>
        </div>`;
    }).join('');
    updateBulkImageSearchApplyBtn();
}

function setAllBulkImageSearchSelections(checked) {
    document.querySelectorAll('[data-bulk-imgsearch-idx]').forEach(cb => { cb.checked = checked; });
    updateBulkImageSearchApplyBtn();
}

function updateBulkImageSearchApplyBtn() {
    const checked = document.querySelectorAll('[data-bulk-imgsearch-idx]:checked').length;
    const btn = document.getElementById('bulk-imgsearch-apply-btn');
    if (checked > 0) {
        btn.style.display = 'inline-block';
        btn.innerHTML = `<i class="fa-solid fa-upload"></i> Apply Selected Photos (${checked})`;
    } else {
        btn.style.display = 'none';
    }
}

async function applyBulkImageSearchSelections() {
    const checkedBoxes = Array.from(document.querySelectorAll('[data-bulk-imgsearch-idx]:checked'));
    if (!checkedBoxes.length || !bulkImageSearchState.nonce) return;

    const selectedCodes = checkedBoxes.map(cb => bulkImageSearchState.proposals[parseInt(cb.dataset.bulkImgsearchIdx, 10)].code);
    const statusEl = document.getElementById('bulk-imgsearch-status');
    const applyBtn = document.getElementById('bulk-imgsearch-apply-btn');
    applyBtn.disabled = true;

    const updates = [];
    const downloadFailed = [];

    for (let i = 0; i < selectedCodes.length; i++) {
        const code = selectedCodes[i];
        statusEl.textContent = `Downloading and preparing photo ${i + 1}/${selectedCodes.length} (${code})...`;
        try {
            const res = await authFetch(`${API_URL}/products/bulk-image-search/fetch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nonce: bulkImageSearchState.nonce, code }),
                timeoutMs: 30000
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                downloadFailed.push(code);
                continue;
            }
            const resized = await resizeImageDataUrlForProduct(data.dataUrl);
            updates.push({ code, image: resized });
        } catch (err) {
            console.error(`Bulk image download failed for ${code}:`, err);
            downloadFailed.push(code);
        }
    }

    if (!updates.length) {
        statusEl.textContent = 'None of the selected photos could be downloaded. Please try again.';
        applyBtn.disabled = false;
        return;
    }

    statusEl.textContent = `Applying ${updates.length} photo(s)...`;

    try {
        const res = await authFetch(`${API_URL}/products/bulk-image-search/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates }),
            timeoutMs: 60000
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Could not apply the photos.';
            applyBtn.disabled = false;
            return;
        }

        if (data.products) globalProducts = data.products;
        if (typeof loadInventoryProductsTable === 'function') loadInventoryProductsTable();
        if (typeof loadDashboardMetrics === 'function') loadDashboardMetrics();

        let summaryHtml = `<p>✅ Applied: <b>${data.appliedCount}</b> photo(s)</p>`;
        if (downloadFailed.length) summaryHtml += `<p>⚠️ Could not download: <b>${downloadFailed.length}</b> photo(s)</p>`;
        if (data.failedCount) summaryHtml += `<p>❌ Failed to apply: <b>${data.failedCount}</b> photo(s)</p>`;
        summaryHtml += `<p style="color:#64748b;font-size:0.85rem;">Tip: double-check a few of the applied photos in the Products list — image search results aren't always a perfect match.</p>`;

        Swal.fire({
            title: 'Bulk Search Images Complete',
            html: summaryHtml,
            icon: (downloadFailed.length || data.failedCount) ? 'warning' : 'success'
        });

        closeBulkImageSearchModal();
    } catch (err) {
        console.error('Bulk image apply error:', err);
        statusEl.textContent = 'Connection error while applying the photos. Please try again.';
        applyBtn.disabled = false;
    }
}

// ============================================================================
// OMNI SEARCH IMAGES — free, no-API-key image search (new)
// ----------------------------------------------------------------------------
// Mirrors the Bulk Search Images flow above, but talks to the free
// /api/products/omni-image-search endpoints instead. It runs quietly in the
// background on the server (a separate background process, invisible to
// the user) and reports live progress here, exactly like the paid flow
// above. Applying selected photos reuses the same
// POST /api/products/bulk-image-search/apply endpoint as the paid flow,
// since applying only ever needs a product code + already-downloaded image.
// ============================================================================

let omniImageSearchState = { nonce: null, proposals: [], pollTimer: null };

function stopOmniImageSearchPolling() {
    if (omniImageSearchState.pollTimer) {
        clearTimeout(omniImageSearchState.pollTimer);
        omniImageSearchState.pollTimer = null;
    }
}

function resetOmniImageSearchUI() {
    stopOmniImageSearchPolling();
    omniImageSearchState = { nonce: null, proposals: [], pollTimer: null };
    const statusEl = document.getElementById('omni-imgsearch-status');
    const listEl = document.getElementById('omni-imgsearch-preview-list');
    const selectAllRow = document.getElementById('omni-imgsearch-selectall-row');
    const applyBtn = document.getElementById('omni-imgsearch-apply-btn');
    const progressWrap = document.getElementById('omni-imgsearch-progress-wrap');
    if (statusEl) statusEl.textContent = '';
    if (listEl) listEl.innerHTML = '';
    if (selectAllRow) selectAllRow.style.display = 'none';
    if (applyBtn) applyBtn.style.display = 'none';
    if (progressWrap) progressWrap.style.display = 'none';
}

function updateOmniImageSearchProgressUI(done, total, etaMs) {
    const wrap = document.getElementById('omni-imgsearch-progress-wrap');
    const bar = document.getElementById('omni-imgsearch-progress-bar');
    const text = document.getElementById('omni-imgsearch-progress-text');
    wrap.style.display = 'block';
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    bar.style.width = `${pct}%`;
    const etaText = formatBulkImageSearchEta(etaMs);
    text.textContent = `${done}/${total} searched (${pct}%)${etaText ? ' — ' + etaText : ''}`;
}

async function startOmniImageSearch() {
    const onlyMissing = document.getElementById('bulk-imgsearch-only-missing').checked;
    let limit = parseInt(document.getElementById('bulk-imgsearch-limit').value, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, 100);

    const startBtn = document.getElementById('omni-imgsearch-start-btn');
    const statusEl = document.getElementById('omni-imgsearch-status');
    const listEl = document.getElementById('omni-imgsearch-preview-list');
    const progressWrap = document.getElementById('omni-imgsearch-progress-wrap');

    stopOmniImageSearchPolling();
    startBtn.disabled = true;
    document.getElementById('omni-imgsearch-selectall-row').style.display = 'none';
    document.getElementById('omni-imgsearch-apply-btn').style.display = 'none';
    listEl.innerHTML = '';
    progressWrap.style.display = 'none';
    statusEl.textContent = 'Starting Omni Search (free)...';

    try {
        const res = await authFetch(`${API_URL}/products/omni-image-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ onlyMissing, limit }),
            timeoutMs: 30000
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Omni Search Images failed to start.';
            startBtn.disabled = false;
            return;
        }

        if (!data.nonce || !data.totalTargeted) {
            statusEl.textContent = onlyMissing
                ? 'All products already have a photo — nothing to search for.'
                : 'No products found to search for.';
            startBtn.disabled = false;
            return;
        }

        omniImageSearchState.nonce = data.nonce;
        omniImageSearchState.totalEligible = data.totalEligible;
        omniImageSearchState.truncated = data.truncated;
        statusEl.textContent = `Searching ${data.totalTargeted} product(s) using free sources — running quietly in the background...`;
        updateOmniImageSearchProgressUI(0, data.totalTargeted, null);

        pollOmniImageSearchProgress(startBtn);
    } catch (err) {
        console.error('Omni Search Images error:', err);
        statusEl.textContent = 'Connection error while searching. Please try again.';
        startBtn.disabled = false;
    }
}

async function pollOmniImageSearchProgress(startBtn) {
    const statusEl = document.getElementById('omni-imgsearch-status');
    const nonce = omniImageSearchState.nonce;
    if (!nonce) return;

    try {
        const res = await authFetch(`${API_URL}/products/omni-image-search/progress?nonce=${encodeURIComponent(nonce)}`, {
            timeoutMs: 15000
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Lost track of the search progress. Please try again.';
            document.getElementById('omni-imgsearch-progress-wrap').style.display = 'none';
            startBtn.disabled = false;
            return;
        }

        updateOmniImageSearchProgressUI(data.done, data.total, data.etaMs);

        if (data.error) {
            statusEl.textContent = data.error;
            document.getElementById('omni-imgsearch-progress-wrap').style.display = 'none';
            startBtn.disabled = false;
            return;
        }

        if (!data.finished) {
            omniImageSearchState.pollTimer = setTimeout(() => pollOmniImageSearchProgress(startBtn), 900);
            return;
        }

        document.getElementById('omni-imgsearch-progress-wrap').style.display = 'none';
        omniImageSearchState.proposals = data.proposals || [];

        if (!omniImageSearchState.proposals.length) {
            statusEl.textContent = 'No products found to search for.';
            startBtn.disabled = false;
            return;
        }

        const foundCount = omniImageSearchState.proposals.filter(p => p.found).length;
        let statusText = `Found images for ${foundCount}/${omniImageSearchState.proposals.length} product(s).`;
        if (omniImageSearchState.truncated) {
            statusText += ` Only the first ${data.total} of ${omniImageSearchState.totalEligible} eligible products were processed this run — lower "Products to process" or run again for the rest.`;
        }
        statusText += ' Review below, then Apply.';
        statusEl.textContent = statusText;

        renderOmniImageSearchPreview();
        document.getElementById('omni-imgsearch-selectall-row').style.display = foundCount ? 'flex' : 'none';
        startBtn.disabled = false;
    } catch (err) {
        console.error('Omni Search Images progress poll error:', err);
        // Transient network hiccup — retry on the next tick instead of giving up.
        omniImageSearchState.pollTimer = setTimeout(() => pollOmniImageSearchProgress(startBtn), 1500);
    }
}

function renderOmniImageSearchPreview() {
    const listEl = document.getElementById('omni-imgsearch-preview-list');
    listEl.innerHTML = omniImageSearchState.proposals.map((p, idx) => {
        if (!p.found) {
            return `<div class="bulk-imgsearch-item is-notfound">
                <img src="" alt="" style="visibility:hidden;">
                <div class="bulk-imgsearch-item-info">
                    <div class="bulk-imgsearch-item-name">${(p.name || '').replace(/</g, '&lt;')}</div>
                    <div class="bulk-imgsearch-item-code">${(p.code || '').replace(/</g, '&lt;')}</div>
                </div>
                <div class="bulk-imgsearch-item-status">${p.message || 'No image found'}</div>
            </div>`;
        }
        const safeThumb = (p.thumbnailUrl || '').replace(/"/g, '&quot;');
        const providerBadge = p.provider ? `<div style="font-size:11px;color:#16a34a;">via ${(p.provider || '').replace(/</g, '&lt;')}</div>` : '';
        return `<div class="bulk-imgsearch-item">
            <input type="checkbox" checked data-omni-imgsearch-idx="${idx}" onchange="updateOmniImageSearchApplyBtn()">
            <img src="${safeThumb}" alt="" loading="lazy">
            <div class="bulk-imgsearch-item-info">
                <div class="bulk-imgsearch-item-name">${(p.name || '').replace(/</g, '&lt;')}</div>
                <div class="bulk-imgsearch-item-code">${(p.code || '').replace(/</g, '&lt;')}</div>
                ${providerBadge}
            </div>
        </div>`;
    }).join('');
    updateOmniImageSearchApplyBtn();
}

function setAllOmniImageSearchSelections(checked) {
    document.querySelectorAll('[data-omni-imgsearch-idx]').forEach(cb => { cb.checked = checked; });
    updateOmniImageSearchApplyBtn();
}

function updateOmniImageSearchApplyBtn() {
    const checked = document.querySelectorAll('[data-omni-imgsearch-idx]:checked').length;
    const btn = document.getElementById('omni-imgsearch-apply-btn');
    if (checked > 0) {
        btn.style.display = 'inline-block';
        btn.innerHTML = `<i class="fa-solid fa-upload"></i> Apply Selected Photos (${checked})`;
    } else {
        btn.style.display = 'none';
    }
}

async function applyOmniImageSearchSelections() {
    const checkedBoxes = Array.from(document.querySelectorAll('[data-omni-imgsearch-idx]:checked'));
    if (!checkedBoxes.length || !omniImageSearchState.nonce) return;

    const selectedCodes = checkedBoxes.map(cb => omniImageSearchState.proposals[parseInt(cb.dataset.omniImgsearchIdx, 10)].code);
    const statusEl = document.getElementById('omni-imgsearch-status');
    const applyBtn = document.getElementById('omni-imgsearch-apply-btn');
    applyBtn.disabled = true;

    const updates = [];
    const downloadFailed = [];

    for (let i = 0; i < selectedCodes.length; i++) {
        const code = selectedCodes[i];
        statusEl.textContent = `Downloading and preparing photo ${i + 1}/${selectedCodes.length} (${code})...`;
        try {
            const res = await authFetch(`${API_URL}/products/omni-image-search/fetch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nonce: omniImageSearchState.nonce, code }),
                timeoutMs: 30000
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                downloadFailed.push(code);
                continue;
            }
            const resized = await resizeImageDataUrlForProduct(data.dataUrl);
            updates.push({ code, image: resized });
        } catch (err) {
            console.error(`Omni image download failed for ${code}:`, err);
            downloadFailed.push(code);
        }
    }

    if (!updates.length) {
        statusEl.textContent = 'None of the selected photos could be downloaded. Please try again.';
        applyBtn.disabled = false;
        return;
    }

    statusEl.textContent = `Applying ${updates.length} photo(s)...`;

    try {
        // Shared with the paid flow — applying only needs a code + already
        // downloaded image, so the same endpoint works for both.
        const res = await authFetch(`${API_URL}/products/bulk-image-search/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates }),
            timeoutMs: 60000
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            statusEl.textContent = data.message || 'Could not apply the photos.';
            applyBtn.disabled = false;
            return;
        }

        if (data.products) globalProducts = data.products;
        if (typeof loadInventoryProductsTable === 'function') loadInventoryProductsTable();
        if (typeof loadDashboardMetrics === 'function') loadDashboardMetrics();

        let summaryHtml = `<p>✅ Applied: <b>${data.appliedCount}</b> photo(s)</p>`;
        if (downloadFailed.length) summaryHtml += `<p>⚠️ Could not download: <b>${downloadFailed.length}</b> photo(s)</p>`;
        if (data.failedCount) summaryHtml += `<p>❌ Failed to apply: <b>${data.failedCount}</b> photo(s)</p>`;
        summaryHtml += `<p style="color:#64748b;font-size:0.85rem;">Tip: double-check a few of the applied photos in the Products list — free image search results aren't always a perfect match.</p>`;

        Swal.fire({
            title: 'Omni Search Images Complete',
            html: summaryHtml,
            icon: (downloadFailed.length || data.failedCount) ? 'warning' : 'success'
        });

        closeBulkImageSearchModal();
    } catch (err) {
        console.error('Omni image apply error:', err);
        statusEl.textContent = 'Connection error while applying the photos. Please try again.';
        applyBtn.disabled = false;
    }
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
                <td><input type="checkbox" class="barcode-select-item" data-code="${escapeHtml(p.code)}" data-name="${escapeHtml(p.name)}" data-price="${escapeHtml(String(parseFloat(p.price) || 0))}"></td>
                <td class="font-bold">${escapeHtml(p.code)}</td>
                <td>${escapeHtml(p.category)}</td>
                <td>${escapeHtml(p.name)}</td>
                <td><input type="number" class="barcode-qty-input" value="1" min="1" style="width:60px; padding:4px; text-align:center;" id="bar-qty-${escapeHtml(p.code)}"></td>
                <td><canvas id="canvas-row-${idx}" style="max-height: 40px;"></canvas></td>
            `;
            tbody.appendChild(row);

            setTimeout(() => {
                JsBarcode(`#canvas-row-${idx}`, p.code, { format:"CODE128", displayValue: false, height: 30, margin: 10, background: "#ffffff" });
            }, 50);
        });
    } catch (e) { console.error(e); }
}

function toggleSelectAllBarcodes(master) {
    document.querySelectorAll('.barcode-select-item').forEach(cb => cb.checked = master.checked);
}

const DEFAULT_BARCODE_SETTINGS = {
    columns: 5,
    alignment:'center',
    cardMaxWidth: 32,
    cardHeight: 0,
    cardGap: 0,
    cardPaddingV: 12,
    cardPaddingH: 8,
    marginTop: 10,
    marginRight: 10,
    marginBottom: 10,
    marginLeft: 10,
    contentHAlign:'center',
    contentVAlign:'middle',
    barWidth: 1.5,
    barHeight: 45,
    codeFontSize: 12,
    barcodeMargin: 5,
    showCode: true,
    showPriceWithId: false,
    showName: true,
    nameFontSize: 9,
    barcodeColor:'#000000',
    borderStyle:'dashed',
    borderWidth: 1,
    borderColor:'#000000',
    cardBg:'#ffffff'
};
const BARCODE_SETTINGS_STORAGE_KEY ='omnipos_barcode_print_settings';

function getBarcodeSettings() {
    try {
        const saved = localStorage.getItem(BARCODE_SETTINGS_STORAGE_KEY);
        if (saved) return Object.assign({}, DEFAULT_BARCODE_SETTINGS, JSON.parse(saved));
    } catch (e) { console.error('Failed to load barcode print settings:', e); }
    return Object.assign({}, DEFAULT_BARCODE_SETTINGS);
}

function saveBarcodeSettingsToStorage(settings) {
    try {
        localStorage.setItem(BARCODE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) { console.error('Failed to save barcode print settings:', e); }
}

function applyBarcodeSettingsToDom(settings) {
    const root = document.documentElement.style;
    const hAlignMap = { left:'flex-start', center:'center', right:'flex-end' };
    const vAlignMap = { top:'flex-start', middle:'center', bottom:'flex-end' };

    root.setProperty('--barcode-columns', settings.columns);
    root.setProperty('--barcode-text-align', settings.alignment);
    root.setProperty('--barcode-card-max-width', settings.cardMaxWidth +'mm');
    root.setProperty('--barcode-card-height', settings.cardHeight && settings.cardHeight > 0 ? settings.cardHeight +'mm' :'auto');
    root.setProperty('--barcode-card-gap', settings.cardGap +'px');
    root.setProperty('--barcode-card-padding-v', settings.cardPaddingV +'px');
    root.setProperty('--barcode-card-padding-h', settings.cardPaddingH +'px');
    root.setProperty('--barcode-sheet-margin-top', settings.marginTop +'mm');
    root.setProperty('--barcode-sheet-margin-right', settings.marginRight +'mm');
    root.setProperty('--barcode-sheet-margin-bottom', settings.marginBottom +'mm');
    root.setProperty('--barcode-sheet-margin-left', settings.marginLeft +'mm');
    root.setProperty('--barcode-align-items', hAlignMap[settings.contentHAlign] ||'center');
    root.setProperty('--barcode-justify-content', vAlignMap[settings.contentVAlign] ||'center');
    root.setProperty('--barcode-name-font-size', settings.nameFontSize +'px');
    root.setProperty('--barcode-name-display', settings.showName ?'block' :'none');
    root.setProperty('--barcode-ink-color', settings.barcodeColor);
    root.setProperty('--barcode-border-style', settings.borderStyle);
    root.setProperty('--barcode-border-width', settings.borderWidth +'px');
    root.setProperty('--barcode-border-color', settings.borderColor);
    root.setProperty('--barcode-print-border-color', settings.borderColor);
    root.setProperty('--barcode-card-bg', settings.cardBg);

    const hint = document.getElementById('barcode-preview-col-hint');
    if (hint) hint.textContent = settings.columns;
}

function populateBarcodeSettingsForm(settings) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('bset-columns', settings.columns);
    set('bset-alignment', settings.alignment);
    set('bset-card-max-width', settings.cardMaxWidth);
    set('bset-card-height', settings.cardHeight);
    set('bset-card-gap', settings.cardGap);
    set('bset-card-padding-v', settings.cardPaddingV);
    set('bset-card-padding-h', settings.cardPaddingH);
    set('bset-margin-top', settings.marginTop);
    set('bset-margin-right', settings.marginRight);
    set('bset-margin-bottom', settings.marginBottom);
    set('bset-margin-left', settings.marginLeft);
    set('bset-content-halign', settings.contentHAlign);
    set('bset-content-valign', settings.contentVAlign);
    set('bset-bar-width', settings.barWidth);
    set('bset-bar-height', settings.barHeight);
    set('bset-code-font-size', settings.codeFontSize);
    set('bset-barcode-margin', settings.barcodeMargin);
    set('bset-show-code', settings.showCode ?'true' :'false');
    set('bset-show-price', settings.showPriceWithId ?'true' :'false');
    set('bset-barcode-color', settings.barcodeColor);
    set('bset-name-font-size', settings.nameFontSize);
    set('bset-show-name', settings.showName ?'true' :'false');
    set('bset-border-style', settings.borderStyle);
    set('bset-border-width', settings.borderWidth);
    set('bset-border-color', settings.borderColor);
    set('bset-card-bg', settings.cardBg);
}

function readBarcodeSettingsFromForm() {
    const num = (id, fallback) => {
        const el = document.getElementById(id);
        const v = el ? parseFloat(el.value) : NaN;
        return isNaN(v) ? fallback : v;
    };
    const str = (id, fallback) => {
        const el = document.getElementById(id);
        return el && el.value !=='' ? el.value : fallback;
    };
    return {
        columns: Math.min(10, Math.max(1, Math.round(num('bset-columns', DEFAULT_BARCODE_SETTINGS.columns)))),
        alignment: str('bset-alignment', DEFAULT_BARCODE_SETTINGS.alignment),
        cardMaxWidth: num('bset-card-max-width', DEFAULT_BARCODE_SETTINGS.cardMaxWidth),
        cardHeight: Math.max(0, num('bset-card-height', DEFAULT_BARCODE_SETTINGS.cardHeight)),
        cardGap: num('bset-card-gap', DEFAULT_BARCODE_SETTINGS.cardGap),
        cardPaddingV: num('bset-card-padding-v', DEFAULT_BARCODE_SETTINGS.cardPaddingV),
        cardPaddingH: num('bset-card-padding-h', DEFAULT_BARCODE_SETTINGS.cardPaddingH),
        marginTop: num('bset-margin-top', DEFAULT_BARCODE_SETTINGS.marginTop),
        marginRight: num('bset-margin-right', DEFAULT_BARCODE_SETTINGS.marginRight),
        marginBottom: num('bset-margin-bottom', DEFAULT_BARCODE_SETTINGS.marginBottom),
        marginLeft: num('bset-margin-left', DEFAULT_BARCODE_SETTINGS.marginLeft),
        contentHAlign: str('bset-content-halign', DEFAULT_BARCODE_SETTINGS.contentHAlign),
        contentVAlign: str('bset-content-valign', DEFAULT_BARCODE_SETTINGS.contentVAlign),
        barWidth: num('bset-bar-width', DEFAULT_BARCODE_SETTINGS.barWidth),
        barHeight: num('bset-bar-height', DEFAULT_BARCODE_SETTINGS.barHeight),
        codeFontSize: num('bset-code-font-size', DEFAULT_BARCODE_SETTINGS.codeFontSize),
        barcodeMargin: num('bset-barcode-margin', DEFAULT_BARCODE_SETTINGS.barcodeMargin),
        showCode: str('bset-show-code','true') ==='true',
        showPriceWithId: str('bset-show-price','false') ==='true',
        barcodeColor: str('bset-barcode-color', DEFAULT_BARCODE_SETTINGS.barcodeColor),
        nameFontSize: num('bset-name-font-size', DEFAULT_BARCODE_SETTINGS.nameFontSize),
        showName: str('bset-show-name','true') ==='true',
        borderStyle: str('bset-border-style', DEFAULT_BARCODE_SETTINGS.borderStyle),
        borderWidth: num('bset-border-width', DEFAULT_BARCODE_SETTINGS.borderWidth),
        borderColor: str('bset-border-color', DEFAULT_BARCODE_SETTINGS.borderColor),
        cardBg: str('bset-card-bg', DEFAULT_BARCODE_SETTINGS.cardBg)
    };
}

function openBarcodePrintSettingsModal() {
    populateBarcodeSettingsForm(getBarcodeSettings());
    document.getElementById('barcode-print-settings-modal').style.display ='flex';
}

function applyBarcodeSettingsFromForm() {
    const settings = readBarcodeSettingsFromForm();
    saveBarcodeSettingsToStorage(settings);
    applyBarcodeSettingsToDom(settings);
    closeModal('barcode-print-settings-modal');

    if (Array.isArray(window.__lastBarcodePrintBatch) && window.__lastBarcodePrintBatch.length > 0) {
        renderBarcodeSheetPreview(window.__lastBarcodePrintBatch);
    }

    if (typeof Swal !=='undefined') {
        Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Barcode print settings applied', showConfirmButton:false, timer:1500 });
    }
}

function resetBarcodeSettingsToDefault() {
    const defaults = Object.assign({}, DEFAULT_BARCODE_SETTINGS);
    saveBarcodeSettingsToStorage(defaults);
    applyBarcodeSettingsToDom(defaults);
    populateBarcodeSettingsForm(defaults);

    if (Array.isArray(window.__lastBarcodePrintBatch) && window.__lastBarcodePrintBatch.length > 0) {
        renderBarcodeSheetPreview(window.__lastBarcodePrintBatch);
    }

    if (typeof Swal !=='undefined') {
        Swal.fire({ toast:true, position:'top-end', icon:'info', title:'Reset to default settings', showConfirmButton:false, timer:1500 });
    }
}

function renderBarcodeSheetPreview(batch) {
    const settings = getBarcodeSettings();
    applyBarcodeSettingsToDom(settings);

    const sheetContainer = document.getElementById('barcode-sheet-print-container');
    sheetContainer.innerHTML ='';
    window.__lastBarcodePrintBatch = batch;

    batch.forEach(({ code, name, qty, price }) => {
        for (let loop = 0; loop < qty; loop++) {
            const cellUnit = document.createElement('div');
            cellUnit.className ='barcode-print-card-unit';

            const uniqueId = `svg-print-${code}-${loop}-${Math.random().toString(36).slice(2,7)}`;
            cellUnit.innerHTML = `
                <p>${escapeHtml(name)}</p>
                <svg id="${uniqueId}"></svg>
            `;
            sheetContainer.appendChild(cellUnit);

            const labelText = settings.showPriceWithId
                ? `${code} - ₱${(parseFloat(price) || 0).toFixed(2)}`
                : code;

            setTimeout(() => {
                JsBarcode(`#${uniqueId}`, code, {
                    format:"CODE128",
                    width: settings.barWidth,
                    height: settings.barHeight,
                    displayValue: settings.showCode,
                    text: settings.showCode ? labelText : undefined,
                    fontSize: settings.codeFontSize,
                    margin: settings.barcodeMargin,
                    lineColor: settings.barcodeColor
                });
            }, 20);
        }
    });

    document.getElementById('barcode-preview-modal').style.display ='flex';

    document.body.classList.add('print-target-barcode');
    document.body.classList.remove('print-target-receipt');
}

document.addEventListener('DOMContentLoaded', () => {
    try { applyBarcodeSettingsToDom(getBarcodeSettings()); } catch (e) { console.error(e); }
});

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
            html:'Admin password is required before printing a barcode.',
            input:'password',
            inputPlaceholder:'Admin password',
            showCancelButton: true,
            confirmButtonColor:'#2563eb',
            cancelButtonColor:'#ef4444'
        });

        if (!adminPassword || adminPassword.trim() ==="") {
            Swal.fire('Cancelled','Barcode printing was cancelled.','info');
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
            Swal.fire('Connection Error','Could not verify the Admin password right now.','error');
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
                details: { itemsCount: checkboxes.length, message: `Printed ${checkboxes.length} barcode label(s) (${authMethod}).` }
            })
        });
    } catch (logError) {
        console.error(logError);
    }

    if (typeof showBtPrintButtons === 'function' && typeof hideBtPrintButtons === 'function') {
        if (typeof btPrinterCharacteristic !== 'undefined' && btPrinterCharacteristic) {
            showBtPrintButtons();
        } else {
            hideBtPrintButtons();
        }
    }

    const batch = [];
    checkboxes.forEach((cb) => {
        const code = cb.getAttribute('data-code');
        const name = cb.getAttribute('data-name');
        const price = parseFloat(cb.getAttribute('data-price')) || 0;
        const printQty = parseInt(document.getElementById(`bar-qty-${code}`).value) || 1;
        batch.push({ code, name, qty: printQty, price });
    });

    renderBarcodeSheetPreview(batch);
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
        el.innerHTML = `<li class="rank-empty">${opts.emptyMessage || 'No data yet.'}</li>`;
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

            return;
        }
        const data = await res.json();
        if (!data.success) return;

        document.getElementById('report-gross').innerText = `₱${data.gross.toFixed(2)}`;
        document.getElementById('report-count').innerText = data.transactionCount;
        document.getElementById('report-profit').innerText = data.hasCostData ? `₱${data.estimatedProfit.toFixed(2)}` : '₱0.00 (no cost data)';
        document.getElementById('report-margin-pct').innerText = data.hasCostData ? `${data.marginPct.toFixed(1)}%` : '—';

        initSalesAnalyticsChartToolbar();
        loadSalesAnalyticsChartData();

        renderRankList('top-products-list', (data.topProducts || []).map(p => ({ name: p.name, value: `${p.qty} sold` })),
            { emptyMessage: 'No sales data yet.' });

        renderRankList('slow-products-list', (data.slowProducts || []).map(p => ({ name: p.name, value: `${p.qty} sold` })),
            { emptyMessage: 'No sales data yet.' });

        if (!data.hasCostData) {
            renderRankList('profit-by-product-list', [], { emptyMessage: 'No Cost Price set on any products yet. Add it in Inventory > Edit Product for profit to show here.' });
        } else {
            renderRankList('profit-by-product-list', (data.profitByProduct || []).map(p => ({ name: p.name, value: `₱${p.profit.toFixed(2)}`, negative: p.profit < 0 })),
                { emptyMessage: 'No sales data yet.' });
        }

        const paymentRows = Object.entries(data.paymentBreakdown || {})
            .sort((a, b) => b[1] - a[1])
            .map(([method, total]) => ({ name: method, value: `₱${total.toFixed(2)}` }));
        renderRankList('payment-breakdown-list', paymentRows, { emptyMessage: 'No sales data yet.' });

    } catch (e) { console.error(e); }
  checkAdminResetVisibility();
}

const salesAnalyticsChartState = {
    granularity: 'day',
    rangePreset: '30d',
    fromDate: null,
    toDate: null,
    chartStyle: 'area',
    metrics: new Set(['total']),
    compare: false,
    lastTxs: [],
    lastBuckets: []
};

const SA_METRIC_LABELS = { total: 'Total', high: 'High', low: 'Low', avg: 'Average' };
const SA_GRAN_LABELS = { hour: 'Hourly', shift: 'Shift', day: 'Day', week: 'Week', month: 'Month', year: 'Year' };
const SA_RANGE_LABELS = { today: 'Today', '7d': 'Last 7 Days', '30d': 'Last 30 Days', '90d': 'Last 90 Days', year: 'Last 1 Year', all: 'All Time', custom: 'Custom Range' };
const SA_STYLE_LABELS = { area: 'Area', line: 'Line', bar: 'Bar', combo: 'Combo' };

function saGetThemeColors() {
    const base = ovGetThemeColors();
    return { ...base, avg: document.body.classList.contains('dark-mode') ? '#c084fc' : '#a855f7' };
}

function saResolveDateRange() {
    const now = new Date();
    let to = salesAnalyticsChartState.toDate ? new Date(salesAnalyticsChartState.toDate) : new Date(now);
    to.setHours(23, 59, 59, 999);
    let from;

    if (salesAnalyticsChartState.fromDate && salesAnalyticsChartState.toDate) {
        from = new Date(salesAnalyticsChartState.fromDate);
        from.setHours(0, 0, 0, 0);
        return { from, to };
    }

    switch (salesAnalyticsChartState.rangePreset) {
        case 'today':
            from = new Date(now); from.setHours(0, 0, 0, 0); break;
        case '7d':
            from = new Date(now); from.setDate(from.getDate() - 6); from.setHours(0, 0, 0, 0); break;
        case '90d':
            from = new Date(now); from.setDate(from.getDate() - 89); from.setHours(0, 0, 0, 0); break;
        case 'year':
            from = new Date(now); from.setDate(from.getDate() - 364); from.setHours(0, 0, 0, 0); break;
        case 'all':
            from = new Date(2000, 0, 1); break;
        case '30d':
        default:
            from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0); break;
    }
    return { from, to };
}

async function loadSalesAnalyticsChartData() {
    try {
        const res = await authFetch(`${API_URL}/transactions`);
        const txs = res.ok ? await res.json() : [];
        salesAnalyticsChartState.lastTxs = Array.isArray(txs) ? txs : [];
    } catch (e) {
        console.warn('Sales Analytics chart: could not fetch transactions, falling back to cache.', e);
        salesAnalyticsChartState.lastTxs = JSON.parse(localStorage.getItem('cached_transactions') || '[]');
    }
    renderAdvancedSalesAnalyticsChart();
}

function renderAdvancedSalesAnalyticsChart() {
    const wrap = document.getElementById('sa-chart-svg-wrap');
    if (!wrap) return;

    const txs = salesAnalyticsChartState.lastTxs;
    const { from, to } = saResolveDateRange();
    const buckets = ovComputeBuckets(txs, salesAnalyticsChartState.granularity, from, to);
    buckets.forEach(b => { b.avg = b.count > 0 ? Math.round((b.total / b.count) * 100) / 100 : 0; });

    let compareBuckets = null;
    if (salesAnalyticsChartState.compare) {
        const prevRange = ovGetComparisonRange(from, to);
        compareBuckets = ovComputeBuckets(txs, salesAnalyticsChartState.granularity, prevRange.from, prevRange.to);
        compareBuckets.forEach(b => { b.avg = b.count > 0 ? Math.round((b.total / b.count) * 100) / 100 : 0; });
    }

    const rangeLabelEl = document.getElementById('sa-chart-range-label');
    if (rangeLabelEl) {
        const fmt = (d) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
        rangeLabelEl.textContent = `(${fmt(from)} – ${fmt(to)})`;
    }

    const emptyEl = document.getElementById('sa-chart-empty');
    const hasData = buckets.some(b => b.count > 0);
    if (emptyEl) emptyEl.style.display = hasData ? 'none' : 'flex';

    saDrawChart(wrap, buckets, compareBuckets);
    saRenderLegend(!!compareBuckets);
    saRenderSummary(buckets, compareBuckets);
    saRenderSummaryBar();
    salesAnalyticsChartState.lastBuckets = buckets;
}

function saRenderSummaryBar() {
    const bar = document.getElementById('sa-chart-summary-bar');
    if (!bar) return;
    const pills = [
        SA_GRAN_LABELS[salesAnalyticsChartState.granularity] || salesAnalyticsChartState.granularity,
        SA_RANGE_LABELS[salesAnalyticsChartState.rangePreset] || salesAnalyticsChartState.rangePreset,
        SA_STYLE_LABELS[salesAnalyticsChartState.chartStyle] || salesAnalyticsChartState.chartStyle,
        (Array.from(salesAnalyticsChartState.metrics).map(m => SA_METRIC_LABELS[m] || m).join(' + ') || 'Total')
    ];
    if (salesAnalyticsChartState.compare) pills.push('Comparing');
    bar.innerHTML = pills.map(p => `<span class="sb-pill">${escapeHtml(p)}</span>`).join('');
}

function saRenderLegend(hasCompare) {
    const legendEl = document.getElementById('sa-chart-legend');
    if (!legendEl) return;
    const colors = saGetThemeColors();
    const metrics = salesAnalyticsChartState.metrics.size ? Array.from(salesAnalyticsChartState.metrics) : ['total'];
    const items = metrics.map(m => ({ color: colors[m] || colors.total, label: SA_METRIC_LABELS[m] || m }));
    if (hasCompare) items.push({ color: colors.compare, label: 'Previous Period', dashed: true });

    legendEl.innerHTML = items.map(it => `
        <span class="legend-item" style="color:${it.color}">
            <span class="legend-swatch${it.dashed ? ' dashed' : ''}" style="background-color:${it.dashed ? 'transparent' : it.color}; color:${it.color};"></span>
            ${it.label}
        </span>`).join('');
}

function saRenderSummary(buckets, compareBuckets) {
    const el = document.getElementById('sa-chart-summary');
    if (!el) return;

    const totalSum = buckets.reduce((s, b) => s + b.total, 0);
    const highest = buckets.reduce((max, b) => (b.total > max.total ? b : max), { total: -Infinity, label: '—' });
    const lowestActive = buckets.filter(b => b.count > 0);
    const lowest = lowestActive.reduce((min, b) => (b.total < min.total ? b : min), { total: Infinity, label: '—' });
    const totalCount = buckets.reduce((s, b) => s + b.count, 0);
    const avgTicket = totalCount > 0 ? totalSum / totalCount : 0;

    let compareHtml = '';
    if (compareBuckets) {
        const compareSum = compareBuckets.reduce((s, b) => s + b.total, 0);
        const pctChange = compareSum > 0 ? ((totalSum - compareSum) / compareSum) * 100 : (totalSum > 0 ? 100 : 0);
        const isUp = pctChange >= 0;
        compareHtml = `
            <div class="adv-summary-stat">
                <p class="stat-label">vs Previous Period</p>
                <h4 class="stat-value ${isUp ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${isUp ? 'up' : 'down'}"></i> ${Math.abs(pctChange).toFixed(1)}%</h4>
            </div>`;
    }

    el.innerHTML = `
        <div class="adv-summary-stat">
            <p class="stat-label">Total Sales</p>
            <h4 class="stat-value">${ovFormatPeso(totalSum)}</h4>
        </div>
        <div class="adv-summary-stat">
            <p class="stat-label">Highest Point</p>
            <h4 class="stat-value up">${ovFormatPeso(highest.total === -Infinity ? 0 : highest.total)}</h4>
        </div>
        <div class="adv-summary-stat">
            <p class="stat-label">Lowest Point</p>
            <h4 class="stat-value down">${ovFormatPeso(lowest.total === Infinity ? 0 : lowest.total)}</h4>
        </div>
        <div class="adv-summary-stat">
            <p class="stat-label">Average Ticket</p>
            <h4 class="stat-value">${ovFormatPeso(avgTicket)}</h4>
        </div>
        ${compareHtml}
    `;
}

function saDrawChart(wrapEl, buckets, compareBuckets) {
    const width = Math.max(wrapEl.clientWidth || 600, 300);
    const height = wrapEl.clientHeight || 260;
    const padL = 52, padR = 16, padT = 16, padB = 34;
    const plotW = Math.max(width - padL - padR, 10);
    const plotH = Math.max(height - padT - padB, 10);

    const colors = saGetThemeColors();
    const style = salesAnalyticsChartState.chartStyle;
    const metrics = salesAnalyticsChartState.metrics.size ? Array.from(salesAnalyticsChartState.metrics) : ['total'];
    const seriesToPlot = metrics.map(m => ({ key: m, color: colors[m] || colors.total }));

    const allVals = [0];
    buckets.forEach(b => seriesToPlot.forEach(s => allVals.push(b[s.key] || 0)));
    if (compareBuckets) compareBuckets.forEach(b => allVals.push(b.total || 0));
    const maxVal = Math.max(...allVals, 1);

    const n = Math.max(buckets.length, 1);
    const xStep = n > 1 ? plotW / (n - 1) : plotW;
    const xAt = (i) => padL + (n > 1 ? i * xStep : plotW / 2);
    const yAt = (v) => padT + plotH - (Math.max(v, 0) / maxVal) * plotH;

    const gridCount = 4;
    let gridSvg = '';
    for (let g = 0; g <= gridCount; g++) {
        const val = (maxVal / gridCount) * g;
        const y = padT + plotH - (val / maxVal) * plotH;
        gridSvg += `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${colors.grid}" stroke-width="1" stroke-dasharray="3,4"/>`;
        gridSvg += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="${colors.axisText}" text-anchor="end">${ovFormatShortPeso(val)}</text>`;
    }

    const maxLabels = Math.max(Math.floor(plotW / 60), 3);
    const labelEvery = Math.max(1, Math.ceil(n / maxLabels));
    let xLabelsSvg = '';
    buckets.forEach((b, i) => {
        if (i % labelEvery !== 0 && i !== n - 1) return;
        xLabelsSvg += `<text x="${xAt(i)}" y="${height - 10}" font-size="10" fill="${colors.axisText}" text-anchor="middle">${escapeHtml(b.label)}</text>`;
    });

    function buildLinePath(getVal, srcBuckets) {
        return srcBuckets.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(getVal(b)).toFixed(1)}`).join(' ');
    }
    function buildAreaPath(getVal, srcBuckets) {
        const line = srcBuckets.map((b, i) => `${xAt(i).toFixed(1)},${yAt(getVal(b)).toFixed(1)}`).join(' L ');
        return `M ${xAt(0).toFixed(1)},${(padT + plotH).toFixed(1)} L ${line} L ${xAt(srcBuckets.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
    }

    let seriesSvg = '';
    let gradientsSvg = '';

    if (style === 'bar' || style === 'combo') {

        const barSeriesKeys = style === 'combo' ? ['total'] : metrics;
        const barSeries = barSeriesKeys.map(m => ({ key: m, color: colors[m] || colors.total }));
        const groupW = n > 1 ? xStep * 0.62 : plotW * 0.5;
        const barW = Math.max(2, groupW / barSeries.length - 3);
        buckets.forEach((b, i) => {
            const groupStart = xAt(i) - groupW / 2;
            barSeries.forEach((s, si) => {
                const val = b[s.key] || 0;
                const barX = groupStart + si * (barW + 3);
                const barY = yAt(val);
                const barH = Math.max(0, (padT + plotH) - barY);
                seriesSvg += `<rect class="adv-chart-pt" data-idx="${i}" data-series="${s.key}" x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${s.color}" opacity="0.88"/>`;
            });
        });

        if (style === 'combo') {
            const lineKeys = metrics.filter(m => m !== 'total');
            lineKeys.forEach((m) => {
                const c = colors[m] || colors.total;
                if (buckets.length > 1) {
                    seriesSvg += `<path d="${buildLinePath(b => b[m] || 0, buckets)}" fill="none" stroke="${c}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
                }
                buckets.forEach((b, i) => {
                    if (b.count === 0) return;
                    seriesSvg += `<circle class="adv-chart-pt" data-idx="${i}" data-series="${m}" cx="${xAt(i).toFixed(1)}" cy="${yAt(b[m] || 0).toFixed(1)}" r="3.5" fill="${c}" stroke="${colors.pointStroke}" stroke-width="1.5"/>`;
                });
            });
        }
    } else {

        gradientsSvg = seriesToPlot.map((s, idx) => `
            <linearGradient id="saGrad${idx}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${s.color}" stop-opacity="0.28"/>
                <stop offset="100%" stop-color="${s.color}" stop-opacity="0.02"/>
            </linearGradient>`).join('');

        seriesToPlot.forEach((s, idx) => {
            const getVal = (b) => b[s.key] || 0;
            if (style === 'area' && buckets.length > 1) {
                seriesSvg += `<path d="${buildAreaPath(getVal, buckets)}" fill="url(#saGrad${idx})" opacity="0.9"/>`;
            }
            if (buckets.length > 1) {
                seriesSvg += `<path d="${buildLinePath(getVal, buckets)}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
            }
            buckets.forEach((b, i) => {
                if (b.count === 0) return;
                seriesSvg += `<circle class="adv-chart-pt" data-idx="${i}" data-series="${s.key}" cx="${xAt(i).toFixed(1)}" cy="${yAt(getVal(b)).toFixed(1)}" r="3.5" fill="${s.color}" stroke="${colors.pointStroke}" stroke-width="1.5"/>`;
            });
        });
    }

    let compareSvg = '';
    if (compareBuckets && compareBuckets.length > 1) {
        compareSvg = `<path d="${buildLinePath(b => b.total || 0, compareBuckets)}" fill="none" stroke="${colors.compare}" stroke-width="2" stroke-dasharray="5,5" stroke-linecap="round"/>`;
    }

    let hoverSvg = '';
    buckets.forEach((b, i) => {
        const colX = padL + (i * xStep) - xStep / 2;
        const colW = n > 1 ? xStep : plotW;
        hoverSvg += `<rect class="adv-chart-hover-col" data-idx="${i}" x="${Math.max(colX, padL).toFixed(1)}" y="${padT}" width="${colW.toFixed(1)}" height="${plotH}" fill="transparent"/>`;
    });

    wrapEl.querySelectorAll('svg.adv-chart-svg').forEach(el => el.remove());
    const svgHtml = `
        <svg class="adv-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <defs>${gradientsSvg}</defs>
            ${gridSvg}
            <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${colors.axisLine}" stroke-width="1"/>
            ${compareSvg}
            ${seriesSvg}
            ${xLabelsSvg}
            ${hoverSvg}
        </svg>`;
    wrapEl.insertAdjacentHTML('afterbegin', svgHtml);

    const tooltip = document.getElementById('sa-chart-tooltip');
    const svgEl = wrapEl.querySelector('svg.adv-chart-svg');
    if (svgEl && tooltip) {
        svgEl.querySelectorAll('.adv-chart-hover-col').forEach(col => {
            col.addEventListener('mouseenter', () => {
                const idx = parseInt(col.getAttribute('data-idx'));
                const b = buckets[idx];
                if (!b) return;
                const cmp = compareBuckets && compareBuckets[idx];
                let rows = '';
                metrics.forEach(m => {
                    const c = colors[m] || colors.total;
                    rows += `<div class="tt-row"><span><span class="tt-dot" style="background:${c};"></span>${SA_METRIC_LABELS[m] || m}</span><span>${ovFormatPeso(b[m] || 0)}</span></div>`;
                });
                rows += `<div class="tt-row"><span>Transactions</span><span>${b.count}</span></div>`;
                if (cmp) rows += `<div class="tt-row"><span><span class="tt-dot" style="background:${colors.compare};"></span>Previous</span><span>${ovFormatPeso(cmp.total)}</span></div>`;
                tooltip.innerHTML = `<strong>${escapeHtml(b.label)}</strong>${rows}`;
                tooltip.style.display = 'block';
            });
            col.addEventListener('mousemove', (e) => {
                const rect = wrapEl.getBoundingClientRect();
                tooltip.style.left = `${e.clientX - rect.left}px`;
                tooltip.style.top = `${e.clientY - rect.top}px`;
            });
            col.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
        });
    }
}

function saExportChartCsv() {
    const buckets = salesAnalyticsChartState.lastBuckets || [];
    if (!buckets.length) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: 'No chart data to export yet.', timer: 1800, showConfirmButton: false });
        return;
    }
    const escapeCsv = (val) => {
        const s = (val === undefined || val === null) ? '' : val.toString();
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['Label', 'Total', 'High', 'Low', 'Average', 'Transactions'];
    const lines = [headers.join(',')];
    buckets.forEach(b => {
        lines.push([escapeCsv(b.label), b.total, b.high, b.low, b.avg, b.count].join(','));
    });
    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales_trend_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function initSalesAnalyticsChartToolbar() {
    const card = document.getElementById('sa-adv-chart-card');
    if (!card || card.getAttribute('data-sa-bound') === '1') return;
    card.setAttribute('data-sa-bound', '1');

    const filtersToggleBtn = document.getElementById('sa-chart-filters-toggle');
    const toolbarEl = document.getElementById('sa-chart-toolbar');
    if (filtersToggleBtn && toolbarEl) {
        filtersToggleBtn.addEventListener('click', () => {
            const isOpen = toolbarEl.style.display !== 'none';
            toolbarEl.style.display = isOpen ? 'none' : 'flex';
            toolbarEl.style.flexDirection = 'column';
            filtersToggleBtn.setAttribute('aria-expanded', String(!isOpen));
        });
    }

    const granSelect = document.getElementById('sa-chart-granularity-select');
    if (granSelect) {
        granSelect.value = salesAnalyticsChartState.granularity;
        granSelect.addEventListener('change', () => {
            salesAnalyticsChartState.granularity = granSelect.value;
            renderAdvancedSalesAnalyticsChart();
        });
    }

    const customRangeRow = document.getElementById('sa-chart-custom-range-row');
    const rangeSelect = document.getElementById('sa-chart-range-select');
    if (rangeSelect) {
        rangeSelect.value = salesAnalyticsChartState.rangePreset;
        rangeSelect.addEventListener('change', () => {
            if (rangeSelect.value === 'custom') {
                if (customRangeRow) customRangeRow.style.display = 'flex';
                return;
            }
            if (customRangeRow) customRangeRow.style.display = 'none';
            salesAnalyticsChartState.rangePreset = rangeSelect.value;
            salesAnalyticsChartState.fromDate = null;
            salesAnalyticsChartState.toDate = null;
            const fromInput = document.getElementById('sa-chart-from');
            const toInput = document.getElementById('sa-chart-to');
            if (fromInput) fromInput.value = '';
            if (toInput) toInput.value = '';
            renderAdvancedSalesAnalyticsChart();
        });
    }

    const applyBtn = document.getElementById('sa-chart-apply-range');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            const fromVal = document.getElementById('sa-chart-from')?.value;
            const toVal = document.getElementById('sa-chart-to')?.value;
            if (!fromVal || !toVal) {
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Please select both From and To dates.', timer: 1800, showConfirmButton: false });
                return;
            }
            salesAnalyticsChartState.fromDate = new Date(fromVal);
            salesAnalyticsChartState.toDate = new Date(toVal);
            salesAnalyticsChartState.rangePreset = 'custom';
            renderAdvancedSalesAnalyticsChart();
        });
    }

    const styleSelect = document.getElementById('sa-chart-style-select');
    if (styleSelect) {
        styleSelect.value = salesAnalyticsChartState.chartStyle;
        styleSelect.addEventListener('change', () => {
            salesAnalyticsChartState.chartStyle = styleSelect.value;
            renderAdvancedSalesAnalyticsChart();
        });
    }

    const metricChecksWrap = document.getElementById('sa-chart-metric-checks');
    if (metricChecksWrap) {
        metricChecksWrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = salesAnalyticsChartState.metrics.has(cb.value);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    salesAnalyticsChartState.metrics.add(cb.value);
                } else {
                    if (salesAnalyticsChartState.metrics.size <= 1) {
                        cb.checked = true;
                        return;
                    }
                    salesAnalyticsChartState.metrics.delete(cb.value);
                }
                renderAdvancedSalesAnalyticsChart();
            });
        });
    }

    const compareToggle = document.getElementById('sa-chart-compare-toggle');
    if (compareToggle) {
        compareToggle.addEventListener('change', () => {
            salesAnalyticsChartState.compare = compareToggle.checked;
            renderAdvancedSalesAnalyticsChart();
        });
    }

    const refreshBtn = document.getElementById('sa-chart-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadSalesAnalyticsChartData());
    }

    const exportBtn = document.getElementById('sa-chart-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => saExportChartCsv());
    }

    let saResizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(saResizeTimer);
        saResizeTimer = setTimeout(() => renderAdvancedSalesAnalyticsChart(), 200);
    });

    const themeObserver = new MutationObserver(() => renderAdvancedSalesAnalyticsChart());
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
}

const USER_TAB_PERMISSION_MAP = {
'manage-users-tab':'users_manage',
'pending-requests-tab':'pending_requests',
'roles-permissions-tab':'roles_permissions_view',
'receipt-custom-tab':'receipt_settings_view',
'advanced-settings-tab':'advanced_settings_view',
'fraud-alerts-tab':'fraud_alerts_view',
'reset-restore-panel':'reset_restore'
};

function isUserTabAllowed(tabId) {
    const activeUser = JSON.parse(localStorage.getItem('omnipos_user') ||'null');
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
'advanced-settings-tab':'advanced-settings-tab-btn',
'fraud-alerts-tab':'fraud-alerts-counter-tab',
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

function centerActiveUserTab(activeBtn) {
    if (!isMobileOrTabletScreen()) return;

    const container = document.querySelector('#view-users .tabs-container');
    if (!container) return;

    const btn = activeBtn || container.querySelector('.tab-btn.active');
    if (!btn) return;

    requestAnimationFrame(() => {
        if (container.scrollWidth <= container.clientWidth) return;

        const containerRect = container.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const btnCenterRelativeToContainer = (btnRect.left - containerRect.left) + (btnRect.width / 2);
        const targetScrollLeft = container.scrollLeft + btnCenterRelativeToContainer - (containerRect.width / 2);

        container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
    });
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
        centerActiveUserTab(element);
    }
}

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

        // Sliding along the tab bar itself should only scroll the tabs, never switch pages.
        if (target.closest('.tabs-container')) return true;

        // Dragging on adjustment controls (range sliders, dropdowns, text fields) should
        // never be interpreted as a swipe-to-change-tab gesture.
        if (target.closest('input, select, textarea')) return true;

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
                        <button class="btn-icon-action edit-user" title="Edit User">
                            <i class="fa-solid fa-user-pen"></i>
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

            if (u.displayName) {
                const nameWrap = document.createElement('span');
                nameWrap.style.display = 'inline-flex';
                nameWrap.style.flexDirection = 'column';
                nameWrap.style.verticalAlign = 'middle';
                const primaryLine = document.createElement('span');
                primaryLine.textContent = u.displayName;
                const subLine = document.createElement('span');
                subLine.textContent = `@${u.username}`;
                subLine.style.fontWeight = '400';
                subLine.style.fontSize = '0.78rem';
                subLine.style.color = '#64748b';
                nameWrap.appendChild(primaryLine);
                nameWrap.appendChild(subLine);
                nameCell.appendChild(nameWrap);
            } else {
                nameCell.appendChild(document.createTextNode(u.username));
            }

            row.querySelector('.avatar').addEventListener('click', () => openUserAvatarModal(u.username, u.avatar ||''));
            row.querySelector('.edit-user').addEventListener('click', () => openEditUserModal(u));
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
    userFormEditingUsername = null;
    document.getElementById('user-schema-form').reset();
    removeAvatarPhoto('u-form-avatar','u-form-photo-preview');
    document.getElementById('user-modal-title').innerText ='Add New User';
    document.getElementById('user-modal-submit-btn').innerText ='Create Account';
    document.getElementById('u-form-username').disabled = false;
    document.getElementById('u-form-password').required = true;
    document.getElementById('u-form-password-label').innerText ='Password';
    refreshUserFormRoleOptions();
    document.getElementById('user-modal').style.display ='flex';
}

async function refreshUserFormRoleOptions(preserveValue) {
    try {
        const res = await authFetch(`${API_URL}/roles`);
        const data = await res.json();
        if (data.success) {
            rolesMatrixCache = { roles: data.roles || [], menuRegistry: data.menuRegistry || [] };
            populateRoleSelectOptions(rolesMatrixCache.roles);
            if (preserveValue) {
                const roleSelect = document.getElementById('u-form-role');
                if (roleSelect) roleSelect.value = preserveValue;
            }
        }
    } catch (err) {
        console.error('Failed to refresh role options:', err);
    }
}

function openEditUserModal(u) {
    userFormEditingUsername = u.username;
    document.getElementById('user-schema-form').reset();
    document.getElementById('user-modal-title').innerText = `Edit User: ${u.username}`;
    document.getElementById('user-modal-submit-btn').innerText ='Save Changes';
    document.getElementById('u-form-username').disabled = false;
    document.getElementById('u-form-username').value = u.username;
    document.getElementById('u-form-display-name').value = u.displayName ||'';
    document.getElementById('u-form-password').required = false;
    document.getElementById('u-form-password-label').innerText ='New Password (optional — leave blank to keep current)';
    document.getElementById('u-form-avatar').value = u.avatar ||'';
    updateAvatarPreview('u-form-photo-preview', u.avatar ||'');
    refreshUserFormRoleOptions(u.role ||'');
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

    const menuRows = registry.map((m, idx) => {
        const prevGroup = idx > 0 ? registry[idx - 1].group : null;
        const groupHeaderRow = (m.group && m.group !== prevGroup)
            ? `<tr class="matrix-group-header-row">
                <td class="matrix-col-label matrix-group-header-cell">${escapeHtml(m.group)}</td>
                <td colspan="${roles.length}" class="matrix-group-header-fill"></td>
               </tr>`
            : '';
        return groupHeaderRow + `
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
    `;
    }).join('');

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

    const formUsername = document.getElementById('u-form-username').value.trim();
    const formPassword = document.getElementById('u-form-password').value.trim();
    const formDisplayName = document.getElementById('u-form-display-name').value.trim();
    const formRole = document.getElementById('u-form-role').value;
    const formAvatar = document.getElementById('u-form-avatar').value || null;

    if (userFormEditingUsername) {

        if (!formUsername) {
            Swal.fire('Missing Values', SYSTEM_CONFIG.getErrorMessage("Validation Constraint Violation: Identity fields cannot be blank."),'warning');
            return;
        }

        const adminPassword = await promptAdminPasswordConfirm(`Edit user account: ${userFormEditingUsername}`);
        if (!adminPassword) return;

        try {
            const res = await authFetch(`${API_URL}/users/${encodeURIComponent(userFormEditingUsername)}`, {
                method:'PUT',
                headers: {'Content-Type':'application/json' },
                body: JSON.stringify({
                    username: currentUser.username,
                    adminPassword,
                    newUsername: formUsername,
                    displayName: formDisplayName,
                    role: formRole,
                    avatar: formAvatar
                })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                if (formPassword) {
                    const pwRes = await authFetch(`${API_URL}/users/${encodeURIComponent(data.user.username)}/reset-password`, {
                        method:'PUT',
                        headers: {'Content-Type':'application/json' },
                        body: JSON.stringify({ newPassword: formPassword, username: currentUser.username, adminPassword })
                    });
                    const pwData = await pwRes.json();
                    if (!(pwRes.ok && pwData.success)) {
                        Swal.fire('Partially Saved', SYSTEM_CONFIG.getErrorMessage(pwData.message ||"Na-save ang ibang changes pero hindi na-reset ang password."),'warning');
                        closeModal('user-modal');
                        if (typeof loadUsersTable ==='function') loadUsersTable();
                        return;
                    }
                }

                if (data.user && currentUser && data.user.username &&
                    userFormEditingUsername.toLowerCase() === currentUser.username.toLowerCase()) {
                    currentUser.username = data.user.username;
                    currentUser.displayName = data.user.displayName || null;
                    currentUser.avatar = data.user.avatar || null;
                    currentUser.role = data.user.role || currentUser.role;
                    localStorage.setItem('omnipos_user', JSON.stringify(currentUser));
                    if (typeof renderSidebarUserWidget ==='function') renderSidebarUserWidget();
                    if (typeof renderOverviewGreeting ==='function') renderOverviewGreeting();
                }

                Swal.fire('Saved', SYSTEM_CONFIG.getSuccessMessage("Na-update na ang user account."),'success');
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
        return;
    }

    const userPayload = {
        username: formUsername,
        password: formPassword,
        displayName: formDisplayName || undefined,
        role: formRole,
        avatar: formAvatar
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
                localStorage.setItem('omnipos_user', JSON.stringify(currentUser));
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

const AUDIT_LOG_KEYWORD_MAP = {
    login: ['logged into the system', 'naka-login', 'na-login'],
    logout: ['[logout]', 'logged out'],
    transaction: ['sale transaction', '[modify_matrix_qty]'],
    void: ['[void_cart]', 'voided cart'],
    product: ['product', 'bulk-imported'],
    restock: ['restock'],
    'purchase order': ['purchase order'],
    customer: ['customer'],
    loyalty: ['loyalty'],
    promo: ['promo code'],
    account: ['account', 'profile', 'username', 'password'],
    role: ['role'],
    receipt: ['receipt', 'transaction id format', 'otp sender email', 'taiwan'],
    settings: ['store & sales settings', 'appearance/ux settings', 'advanced settings'],
    feature: ['unlock', 'feature', 'pro theme'],
    demo: ['demo mode'],
    backup: ['backup', 'restored'],
    update: ['update deploy', 'self-update'],
    reset: ['system reset', 'hard reset', 'admin password na-reset'],
    fraud: ['fraud'],
    shift: ['beginning cash float', 'shift'],
    email: ['naipadala ang resibo', 'email'],
    blocked: ['blocked call']
};

let allSystemAuditLogs = [];

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

        if (!payload.success && !Array.isArray(payload)) {
            console.warn("System logs fetch was not successful:", payload.message);
        }

        allSystemAuditLogs = logs;
        renderSystemAuditLogsTable();
    } catch (err) {
        console.error("System Log Fetch Exception: Failed to inherit administrative chronological system monitoring parameters logs.", err);
    }
}

function renderSystemAuditLogsTable() {
    const tbody = document.getElementById('system-logs-table-body');
    if (!tbody) return;

    const filterSelect = document.getElementById('logs-filter-keyword');
    const selectedKeyword = filterSelect ? filterSelect.value : 'ALL';

    let logs = allSystemAuditLogs;
    if (selectedKeyword && selectedKeyword !== 'ALL') {
        const needles = AUDIT_LOG_KEYWORD_MAP[selectedKeyword] || [selectedKeyword];
        logs = logs.filter(log => {
            const haystack = `${log.action || ''}`.toLowerCase();
            return needles.some(needle => haystack.includes(needle));
        });
    }

    tbody.innerHTML = '';

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;">Walang audit log na tumugma sa napiling filter.</td></tr>`;
        return;
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

    const imageChoice = await Swal.fire({
        title: 'Include Product Photos in the Email Backup?',
        html: `Product photos are usually the largest part of the backup file. On slow internet/mobile data, sending the email is slower and more likely to fail if photos are included.<br><br>
               <b>Include Photos</b> — more complete, but SLOWER.<br>
               <b>Exclude Photos</b> — FASTER and more reliable.<br><br>
               <span style="color:#ef4444;"><strong>Note:</strong> either way, all product images will still be permanently deleted from the local system database once the reset finishes — this choice only affects the emailed backup file.</span>`,
        icon: 'question',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonColor: '#64748b',
        denyButtonColor: '#16a34a',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'Include Photos (Slower)',
        denyButtonText: 'Exclude Photos (Faster)',
        cancelButtonText: 'Cancel'
    });

    if (imageChoice.isDismissed) return;
    const includeImages = imageChoice.isConfirmed;

    const passwordConfirm = await Swal.fire({
        title: 'Confirm Admin Password',
        html: 'This action is irreversible. Enter your Admin Password to proceed with the Hard Factory Reset:',
        input: 'password',
        inputPlaceholder: 'Admin Passphrase',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Verify and Reset'
    });

    const adminPassword = passwordConfirm.value;
    if (!adminPassword) return;

    window.__logoutInProgress = true;

    function renderResetProgress(percent, message) {
        const bar = document.getElementById('reset-progress-bar');
        const pct = document.getElementById('reset-progress-pct');
        const msg = document.getElementById('reset-progress-msg');
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        if (pct) pct.textContent = `${Math.round(percent)}%`;
        if (msg) msg.textContent = message || '';
    }

    Swal.fire({
        title: 'Processing System Reset...',
        html: `
            <div style="text-align:left; margin-top:8px;">
                <div style="background:#1e293b; border-radius:8px; height:22px; overflow:hidden; border:1px solid #334155;">
                    <div id="reset-progress-bar" style="background:linear-gradient(90deg,#3b82f6,#22c55e); height:100%; width:1%; transition:width 0.4s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:0.85rem; color:#94a3b8;">
                    <span id="reset-progress-msg">Preparing the backup...</span>
                    <span id="reset-progress-pct">1%</span>
                </div>
                <div style="margin-top:10px; font-size:0.8rem; color:#64748b;">Do not refresh or close this page.</div>
            </div>
        `,
        allowOutsideClick: false,
        showConfirmButton: false
    });

    try {

        const startResponse = await authFetch(`${API_URL}/system/reset/start`, {
            method:'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({
                additionalEmail: additionalEmail,
                password: adminPassword,
                includeImages: includeImages
            }),
            timeoutMs: 15000
        });

        const startResult = await startResponse.json();

        if (startResponse.status === 403 && startResult.code === 'WRONG_ADMIN_PASSWORD') {
            window.__logoutInProgress = false;
            Swal.fire('Access Denied', startResult.message || 'Incorrect Admin password.', 'error');
            return;
        }

        if (!startResult.success || !startResult.jobId) {
            window.__logoutInProgress = false;
            Swal.fire('Process Failed', startResult.message || 'Hindi na-start ang reset job.', 'error');
            return;
        }

        const jobId = startResult.jobId;

        const finalResult = await new Promise((resolve, reject) => {
            const poll = async () => {
                try {
                    const statusRes = await fetch(`${API_URL}/system/reset/status/${jobId}`);
                    const statusData = await statusRes.json();

                    if (!statusData.success) {
                        reject(new Error(statusData.message || 'Reset job not found.'));
                        return;
                    }

                    renderResetProgress(statusData.percent || 0, statusData.message);

                    if (statusData.status === 'done') {
                        resolve(statusData.result);
                    } else if (statusData.status === 'error') {
                        reject(new Error(statusData.result?.message || statusData.message || 'Reset failed.'));
                    } else {
                        setTimeout(poll, 700);
                    }
                } catch (pollErr) {

                    setTimeout(poll, 1200);
                }
            };
            poll();
        });

        if (finalResult && finalResult.success) {
            Swal.fire({
                title:'Reset Successful!',
                text: finalResult.message,
                icon:'success'
            }).then(() => {
                localStorage.removeItem('omnipos_user');
                localStorage.removeItem('omnipos_token');
                localStorage.removeItem('omnipos_unlocked_themes_cache');
                localStorage.removeItem('omnipos_darkmode');
                localStorage.setItem('omnipos_theme', 'dark');
                sessionStorage.clear();
                window.location.reload();
            });
        } else {
            window.__logoutInProgress = false;
            Swal.fire('Process Failed', (finalResult && finalResult.message) || 'Reset failed.', 'error');
        }
    } catch (error) {
        console.error("Hard Reset Error Connection:", error);

        const isRealTimeout = error && error.name === 'AbortError';
        const isNetworkFailure = error instanceof TypeError;
        const isParseFailure = error && error.name === 'SyntaxError';

        localStorage.removeItem('omnipos_user');
        localStorage.removeItem('omnipos_token');

        let title, text;
        if (isRealTimeout) {
            title = 'Request Timed Out';
            text = 'The server did not respond within the expected time, but the reset may have already completed in the background. Check your Secondary Backup Email for the backup file, then log in again — if login is blocked, this device needs to be Allowed again in Relay by the developer/store owner.';
        } else if (isNetworkFailure) {
            title = 'Cannot Reach the Server';
            text = `This failed immediately (not an actual timeout) — the browser could not connect to the server at all. Common causes: no network/internet connection, the server is offline, or (on LAN/self-signed HTTPS setups) this device no longer trusts the server's certificate. Fix the connection and try again. Technical detail: ${error.message || 'network error'}.`;
        } else if (isParseFailure) {
            title = 'Unexpected Server Response';
            text = 'This failed immediately (not an actual timeout) — the server responded, but not with the expected data format (it may have returned an error page instead of JSON). This can happen if a proxy, firewall, or the server itself hit an unrelated error. Check the server logs, then check your Secondary Backup Email before retrying.';
        } else {
            title = 'Reset Interrupted';
            text = `An unexpected error stopped the process before it could finish: ${error.message || 'unknown error'}. The reset may have already completed in the background — check your Secondary Backup Email for the backup file, then log in again.`;
        }

        Swal.fire({
            icon: 'warning',
            title,
            text,
            confirmButtonText: 'Go to Login'
        }).then(() => {
            window.__logoutInProgress = false;
            window.location.reload();
        });
    }
}

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

// ============================================================
// SYSTEM UPDATE — ADVANCED LIVE DEPLOY PROGRESS
// ============================================================
// Kagaya ng "Bulk Search Images" (progress bar + ETA na pina-poll), pero
// mas advance pa: may hakbang-hakbang na stepper (trigger/download →
// build/extract → deploy/apply → restart → verify), TUNAY na progreso
// (bytes na-download, files na na-apply) para sa self-update, at isang
// "natutunang" ETA para sa Render path — hango sa exponential moving
// average ng mga nakaraang TUNAY na deploy duration, kaya lalong
// tumatama ang tinatayang oras habang mas madalas ginagamit ito.

const DEPLOY_STEP_DEFS = {
    render: [
        { key: 'trigger', label: 'Trigger deploy' },
        { key: 'build', label: 'Build new version' },
        { key: 'deploy', label: 'Roll out & restart' },
        { key: 'verify', label: 'Verify live' }
    ],
    self: [
        { key: 'download', label: 'Download package' },
        { key: 'extract', label: 'Extract update' },
        { key: 'apply', label: 'Apply files' },
        { key: 'restart', label: 'Restart' },
        { key: 'verify', label: 'Verify live' }
    ]
};

let deployProgressState = null;
let deployLogLines = [];

function formatDeployEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const totalSec = Math.round(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return min > 0 ? `~${min}m ${sec}s left` : `~${sec}s left`;
}

function formatDeployElapsed(ms) {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

// Ginagawa ang stepper ng buo-buong inline HTML/CSS (walang panibagong
// class sa style.css) para maging self-contained ang buong feature na
// ito sa loob ng isang dynamic na Swal modal.
function renderDeployStepper(kind, activeKey, erroredKey) {
    const steps = DEPLOY_STEP_DEFS[kind] || DEPLOY_STEP_DEFS.render;
    const activeIdx = activeKey === 'done' ? steps.length : Math.max(0, steps.findIndex(s => s.key === activeKey));
    const items = steps.map((s, idx) => {
        let color = '#94a3b8', icon = '<i class="fa-regular fa-circle"></i>', weight = 'normal';
        if (erroredKey === s.key) {
            color = '#ef4444'; icon = '<i class="fa-solid fa-circle-exclamation"></i>'; weight = 'bold';
        } else if (idx < activeIdx) {
            color = '#16a34a'; icon = '<i class="fa-solid fa-circle-check"></i>';
        } else if (idx === activeIdx) {
            color = '#2563eb'; icon = '<i class="fa-solid fa-spinner fa-spin"></i>'; weight = 'bold';
        }
        return `<span style="font-size:0.78rem; color:${color}; font-weight:${weight}; display:flex; align-items:center; gap:5px; white-space:nowrap;">${icon} ${s.label}</span>`;
    }).join('');
    return `<div style="display:flex; flex-wrap:wrap; gap:6px 14px; justify-content:center;">${items}</div>`;
}

function openDeployProgressModal() {
    deployLogLines = [];
    Swal.fire({
        title: 'Deploying the Update...',
        html: `
            <div style="text-align:left; margin-top:4px;">
                <div id="deploy-progress-steps"></div>
                <div style="background:#1e293b; border-radius:8px; height:20px; overflow:hidden; border:1px solid #334155; margin-top:14px;">
                    <div id="deploy-progress-bar" style="background:linear-gradient(90deg,#3b82f6,#22c55e); height:100%; width:2%; transition:width 0.4s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:0.85rem; color:#94a3b8;">
                    <span id="deploy-progress-msg">Starting...</span>
                    <span id="deploy-progress-pct">0%</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:2px; font-size:0.78rem; color:#64748b;">
                    <span id="deploy-progress-elapsed">Elapsed: 0s</span>
                    <span id="deploy-progress-eta"></span>
                </div>
                <div id="deploy-progress-log" style="margin-top:10px; max-height:90px; overflow-y:auto; font-size:0.72rem; color:#64748b; font-family:monospace; border-top:1px dashed #334155; padding-top:6px;"></div>
                <div style="margin-top:10px; font-size:0.8rem; color:#64748b;">Do not refresh or close this page.</div>
            </div>
        `,
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => Swal.showLoading()
    });
}

function updateDeployProgressUI({ activeKey, erroredKey, message, percent, elapsedMs, etaMs }) {
    if (!deployProgressState) return;
    const kind = deployProgressState.kind;
    const stepsEl = document.getElementById('deploy-progress-steps');
    const bar = document.getElementById('deploy-progress-bar');
    const pctEl = document.getElementById('deploy-progress-pct');
    const msgEl = document.getElementById('deploy-progress-msg');
    const elapsedEl = document.getElementById('deploy-progress-elapsed');
    const etaEl = document.getElementById('deploy-progress-eta');
    const logEl = document.getElementById('deploy-progress-log');

    if (stepsEl) stepsEl.innerHTML = renderDeployStepper(kind, activeKey, erroredKey);
    if (typeof percent === 'number') {
        const clamped = Math.max(0, Math.min(100, percent));
        if (bar) bar.style.width = `${clamped}%`;
        if (pctEl) pctEl.textContent = `${Math.round(clamped)}%`;
    }
    if (msgEl && message) msgEl.textContent = message;
    if (elapsedEl) elapsedEl.textContent = `Elapsed: ${formatDeployElapsed(elapsedMs != null ? elapsedMs : (Date.now() - deployProgressState.startedAt))}`;
    if (etaEl) etaEl.textContent = (etaMs != null && etaMs > 0) ? formatDeployEta(etaMs) : '';

    if (message && logEl && deployLogLines[deployLogLines.length - 1] !== message) {
        deployLogLines.push(message);
        if (deployLogLines.length > 20) deployLogLines.shift();
        logEl.innerHTML = deployLogLines.map(l => `<div>&rsaquo; ${String(l).replace(/</g, '&lt;')}</div>`).join('');
        logEl.scrollTop = logEl.scrollHeight;
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
        html: `The system will be updated to <strong>v${lastCheckedUpdateInfo.latestVersion}</strong>. This will take a few minutes — your data (products, transactions, users, etc.) will not be affected, and the system will refresh automatically afterward.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, deploy now',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#16a34a'
    });
    if (!confirmResult.isConfirmed) return;

    const targetVersion = lastCheckedUpdateInfo.latestVersion;
    openDeployProgressModal();

    try {
        const response = await authFetch(`${API_URL}/system/deploy-update`, { method: 'POST' });
        const result = await response.json();
        if (!result.success) {
            Swal.fire('Not Triggered', result.message || 'Unable to trigger the deploy.', 'error');
            return;
        }

        const kind = result.mode === 'self' ? 'self' : 'render';
        deployProgressState = {
            kind,
            jobId: result.jobId || null,
            startedAt: Date.now(),
            estimatedMs: result.estimatedMs || (kind === 'self' ? 20000 : 90000),
            targetVersion,
            timer: null,
            verifyUiSet: false
        };

        updateDeployProgressUI({
            activeKey: kind === 'self' ? 'download' : 'trigger',
            message: result.message,
            percent: 2,
            elapsedMs: 0
        });

        if (kind === 'self' && deployProgressState.jobId) {
            pollSelfDeployJob();
        } else {
            simulateRenderDeployProgress();
        }
    } catch (error) {
        deployProgressState = null;
        Swal.fire('Network Error', 'Unable to connect to the server backend.', 'error');
    }
}

// SELF-UPDATE (Termux/non-Render) — sinusuri ang TUNAY na progreso ng
// job sa server (download bytes, extract, files applied) bawat ~900ms.
async function pollSelfDeployJob() {
    if (!deployProgressState || deployProgressState.kind !== 'self') return;
    const jobId = deployProgressState.jobId;

    try {
        const res = await authFetch(`${API_URL}/system/deploy-update/progress/${encodeURIComponent(jobId)}`, { timeoutMs: 15000 });
        const data = await res.json();

        if (!res.ok || !data.success) {
            // Kadalasang nangyayari ito kapag na-restart na ang process
            // pagkatapos ng "restart" step (normal — nawala na ang job sa
            // memory ng bagong process) — dumako na sa verification phase.
            beginVerifyPhase(false);
            return;
        }

        const activeStep = data.steps.find(s => s.status === 'active') || data.steps.slice().reverse().find(s => s.status === 'done') || data.steps[0];
        const erroredStep = data.steps.find(s => s.status === 'error');

        updateDeployProgressUI({
            activeKey: activeStep ? activeStep.key : 'download',
            erroredKey: erroredStep ? erroredStep.key : null,
            message: data.message,
            percent: data.percent,
            elapsedMs: data.elapsedMs
        });

        if (data.status === 'error') {
            handleDeployError(data.message);
            return;
        }

        if (data.status === 'done') {
            beginVerifyPhase(false);
            return;
        }

        deployProgressState.timer = setTimeout(pollSelfDeployJob, 900);
    } catch (err) {
        deployProgressState.timer = setTimeout(pollSelfDeployJob, 1500);
    }
}

// RENDER PATH — walang server-side job na ligtas (papatayin ang process
// na ito ni Render mismo pag-tapos ng build), kaya dito sa client
// simulated (batay sa natutunang average duration) ang trigger/build/
// deploy stages habang tumatakbo nang paralel ang TUNAY na
// verification poll sa ibaba.
function simulateRenderDeployProgress() {
    if (!deployProgressState || deployProgressState.kind !== 'render') return;

    const tick = () => {
        if (!deployProgressState || deployProgressState.kind !== 'render') return;
        const elapsed = Date.now() - deployProgressState.startedAt;
        const estimated = Math.max(5000, deployProgressState.estimatedMs);
        const buildCut = estimated * 0.5;
        let activeKey, message;
        if (elapsed < 3000) {
            activeKey = 'trigger'; message = 'Deploy triggered on Render...';
        } else if (elapsed < buildCut) {
            activeKey = 'build'; message = 'Render is building the new version... (estimate)';
        } else {
            activeKey = 'deploy'; message = 'Rolling out & restarting the service... (estimate)';
        }
        const simulatedPct = Math.min(92, Math.round((elapsed / estimated) * 92));

        updateDeployProgressUI({
            activeKey,
            message,
            percent: simulatedPct,
            elapsedMs: elapsed,
            etaMs: Math.max(0, estimated - elapsed)
        });

        deployProgressState.timer = setTimeout(tick, 1000);
    };
    tick();

    beginVerifyPhase(true);
}

const DEPLOY_VERIFY_INTERVAL_MS = 4000;
const DEPLOY_VERIFY_TIMEOUT_MS = 6 * 60 * 1000;

// Ang totoong "katapusan" na hudyat — parehas gamit ng render at
// self-update path — pinapatunayan lang kung ang /system/update-check
// ay talagang nagsasabi na na sa bagong version na, anuman ang server
// instance na sumagot.
function beginVerifyPhase(alsoSimulating) {
    if (!deployProgressState) return;
    if (!alsoSimulating) {
        updateDeployProgressUI({ activeKey: 'verify', message: 'Verifying the new version is live...', percent: Math.max(95, 95) });
        deployProgressState.verifyUiSet = true;
    }
    pollDeployVerification();
}

async function pollDeployVerification() {
    if (!deployProgressState) return;
    const state = deployProgressState;

    try {
        const response = await authFetch(`${API_URL}/system/update-check`);
        const result = await response.json();

        if (result.success && !result.updateAvailable && (!state.targetVersion || result.currentVersion === state.targetVersion)) {
            finishDeploySuccess(result);
            return;
        }
    } catch (_err) {
        // Transient lang ito — normal habang tumatakbo ang tunay na
        // redeploy sa likod (posibleng bumagsak muna ang koneksyon
        // habang lumilipat ng process/instance).
    }

    if (!state.verifyUiSet && state.kind === 'self') {
        updateDeployProgressUI({ activeKey: 'verify', message: 'Verifying the new version is live...', percent: 96 });
        state.verifyUiSet = true;
    }

    if (Date.now() - state.startedAt >= DEPLOY_VERIFY_TIMEOUT_MS) {
        handleDeployTimeout();
        return;
    }

    setTimeout(pollDeployVerification, DEPLOY_VERIFY_INTERVAL_MS);
}

async function finishDeploySuccess(result) {
    if (!deployProgressState) return;
    const durationMs = Date.now() - deployProgressState.startedAt;
    const kind = deployProgressState.kind;
    if (deployProgressState.timer) clearTimeout(deployProgressState.timer);

    updateDeployProgressUI({ activeKey: 'done', message: 'New version confirmed live.', percent: 100, elapsedMs: durationMs, etaMs: 0 });

    try {
        await authFetch(`${API_URL}/system/deploy-update/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, durationMs })
        });
    } catch (_e) {
        // Hindi kritikal — ang ETA/estimate lang ang apektado kung
        // hindi ito na-record.
    }

    lastCheckedUpdateInfo = result;
    deployProgressState = null;
    deployLogLines = [];

    const statusEl = document.getElementById('system-update-status');
    if (statusEl) {
        statusEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success-green,#16a34a);"></i> System is up to date (v${result.currentVersion}).`;
    }
    const deployBtn = document.getElementById('system-update-deploy-btn');
    if (deployBtn) deployBtn.style.display = 'none';

    Swal.fire({
        icon: 'success',
        title: 'Deployed!',
        html: `System is up to date (v${result.currentVersion}). Total time: ${formatDeployElapsed(durationMs)}.`
    });
}

function handleDeployError(message) {
    if (deployProgressState && deployProgressState.timer) clearTimeout(deployProgressState.timer);
    deployProgressState = null;
    Swal.fire('Deploy Failed', message || 'Something went wrong while deploying.', 'error');
}

function handleDeployTimeout() {
    if (deployProgressState && deployProgressState.timer) clearTimeout(deployProgressState.timer);
    deployProgressState = null;
    Swal.fire({
        icon: 'info',
        title: 'Taking a Bit Longer...',
        text: 'The deploy/restart may still be in progress. Click "Check for Updates" again later to confirm.'
    });
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

            await refreshUnlockedFeaturesFromServer();
            await refreshUnlockedThemesFromServer();

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

async function runCloudBackupSync() {
    if (blockIfOffline('Cloud Backup')) return;

    const confirmResult = await Swal.fire({
        title: 'Sync to Cloud?',
        html: 'This will upload the ENTIRE current database to the developer\'s cloud storage.<br><br>Enter the Admin Password to continue:',
        input: 'password',
        inputPlaceholder: 'Admin Passphrase',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Verify and Sync'
    });

    const adminPassword = confirmResult.value;
    if (!adminPassword) return;

    const loggedInUser = currentUser ? currentUser.username : 'admin';
    const statusBox = document.getElementById('cloud-backup-status');
    const btn = document.getElementById('cloud-backup-sync-btn');

    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'not-allowed'; }
    if (statusBox) {
        statusBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing the database to the cloud&hellip;';
    }

    try {
        const response = await authFetch(`${API_URL}/cloud-backup/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: loggedInUser, password: adminPassword })
        });
        const result = await response.json();

        if (response.status === 403 && result.code === 'WRONG_ADMIN_PASSWORD') {
            Swal.fire('Access Denied', result.message || 'Incorrect Admin password.', 'error');
            if (statusBox) statusBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i> Incorrect Admin password.';
            return;
        }

        if (response.status === 402) {

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

const RELAY_SYNC_VIEW_FEATURE_MAP = {
    customer_crm: 'customers',
    shift_management: 'shiftreport',
    advanced_reports: 'reports',
    purchase_orders: 'reorder'
};

function applyLockdownForRemovedFeatures(removedFeatures) {
    const currentThemeId = localStorage.getItem('omnipos_theme') || 'day';
    const currentView = sessionStorage.getItem('currentView') || 'overview';
    let themeWasReverted = false;

    const activeTerminalThemeId = (typeof getActiveTerminalThemeId ==='function') ? getActiveTerminalThemeId() : '';

    removedFeatures.forEach((removed) => {
        if (removed.category === 'theme') {
            if (currentThemeId === removed.featureId) {

                applyTheme('dark');
                themeWasReverted = true;
            }
            if (activeTerminalThemeId === removed.featureId && typeof applyTerminalExtraTheme ==='function') {
                applyTerminalExtraTheme('');
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
    if (typeof renderTerminalThemeMenu === 'function') renderTerminalThemeMenu();
    if (typeof updateSidebarFeatureLocks === 'function') updateSidebarFeatureLocks();
}

function buildRelaySyncResultHtml(result, removedFeatures) {
    let html = '';

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

    const adminPassword = await promptAdminPasswordConfirm(`Force reset password for: ${targetUsername}`);
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
        .catch(e => console.warn("Failed to background-refresh products:", e));

    const product = cachedInventoryProducts.find(p => p.code === code);

    if (!product) {
        Swal.fire('Not Found', `No product matches the code "${code}".`,'warning');
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
    const detailsVal = document.getElementById('p-form-details').value.trim();
    const specsRaw = document.getElementById('p-form-specs').value;
    const imagesRaw = document.getElementById('p-form-images').value;
    if (supplierVal) payload.supplier = supplierVal;
    if (expiryVal) payload.expiryDate = expiryVal;
    if (thresholdVal !=='') payload.lowStockThreshold = parseInt(thresholdVal);
    if (detailsVal) payload.description = detailsVal;
    if (specsRaw) {
        try { payload.specs = JSON.parse(specsRaw); } catch (e) {  }
    }
    if (imagesRaw) {
        try { payload.images = JSON.parse(imagesRaw); } catch (e) {  }
    }

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
        console.warn('Could not save queued stock addition:', reply.message);
    } catch (e) {
        console.warn('Connection error while saving queued stock addition:', e);
    }
    return false;
}

function openScanToAddStockPrompt() {
    Swal.fire({
        title:'Scan Barcode to Add Stock',
        html: `
            <input id="stock-scan-input" type="text" class="swal2-input"
                   placeholder="Scan or type the barcode here..." autocomplete="off">
            <div id="stock-scan-status" style="min-height:60px; font-size:0.9rem; color:#94a3b8; text-align:left; padding:6px 4px;">
                Waiting for scan...
            </div>
            <div style="display:flex; gap:8px; justify-content:center; margin-top:6px;">
                <button type="button" id="stock-scan-save-btn" class="swal2-styled swal2-confirm" style="background:#16a34a;" disabled>
                    <i class="fa-solid fa-floppy-disk"></i> Save
                </button>
                <button type="button" id="stock-scan-close-btn" class="swal2-styled swal2-cancel">
                    Close
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
                            statusEl.innerHTML += `<div style="color:#22c55e; margin-top:6px;"><i class="fa-solid fa-check"></i> Product saved.</div>`;
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
        .catch(e => console.warn("Failed to background-refresh products:", e));

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
            html: (savedPrevious ? `Added stock for the previously scanned product has been saved.<br><br>` :'') +
                  `No product matches the code <b>${escapeHtml(cleanCode)}</b>. Please fill in the other details to register it as a new product.`,
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
        .catch(e => console.warn("Failed to background-refresh products:", e));

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
            feedback.innerText = `✔ ${match.name} — scan again to add more, or scan a different item.`;
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
            html: (savedPrevious ? `Added stock for the previously scanned product has been saved.<br><br>` :'') +
                  `No product matches the code <b>${code}</b>. Please fill in the other details to register it as a new product.`,
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
        .catch(e => console.warn("Failed to background-refresh products:", e));

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
            html: (savedPrevious ? `Added stock for the previously scanned product has been saved.<br><br>` :'') +
                  `No product matches the code <b>${escapeHtml(cleanCode)}</b>. Please fill in the other details to register it as a new product.`,
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
            ?'Scan to Edit: the Edit Product form opens immediately after scanning.'
            :'Search mode: the product will be shown/highlighted in the table after scanning.';
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
        .catch(e => console.warn("Failed to background-refresh products:", e));

    const product = globalProducts.find(p => p.code === scannedCode.trim());
    if (product) {
        const cartItem = shoppingCart.find(item => item.code === product.code);
        const qtyInBasket = cartItem ? cartItem.quantity : 0;
        if (product.stock <= 0 || qtyInBasket >= product.stock) {
            document.getElementById('qr-scanner-feedback').innerText = `❌ Out of stock or insufficient stock for ${product.name}`;
            document.getElementById('qr-scanner-feedback').style.color ='#ef4444';
            return;
        }
        addItemToCart(product);
        document.getElementById('qr-scanner-feedback').innerText = `✔ Naidagdag: ${product.name}`;
        document.getElementById('qr-scanner-feedback').style.color ='#22c55e';
    } else {
        document.getElementById('qr-scanner-feedback').innerText = `❌ No product matches the scanned code [ ${scannedCode} ]`;
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

const txColumnFilters = { id: new Set(), timestamp: new Set(), cashier: new Set(), items: new Set(), discount: new Set(), total: new Set(), method: new Set() };
let activeTxFilterField = null;

function getTxColumnDisplayValue(field, tx) {
    switch (field) {
        case'id': return tx.id ||'';
        case'timestamp': return tx.timestamp ||'';
        case'cashier': return tx.cashier ||'';
        case'items': {
            const qty = (tx.items || []).reduce((sum, item) => sum + item.quantity, 0);
            return `${qty} item(s)`;
        }
        case'discount': return `₱${parseFloat(tx.discount || 0).toFixed(2)}`;
        case'total': return `₱${parseFloat(tx.total || 0).toFixed(2)}`;
        case'method': return tx.method ||'';
        default: return'';
    }
}

function toggleTxColumnFilter(field, evt) {
    evt.stopPropagation();
    const btn = evt.currentTarget;

    if (document.getElementById('col-filter-dropdown') && activeTxFilterField === field) {
        closeTxColumnFilterDropdown();
        return;
    }
    closeTxColumnFilterDropdown();
    activeTxFilterField = field;

    const query = (document.getElementById('tx-history-search')?.value ||'').trim().toLowerCase();
    const contextTx = localTransactionsList.filter(tx => {
        if (query && !((tx.id ||'').toLowerCase().includes(query) || (tx.cashier ||'').toLowerCase().includes(query))) return false;
        for (const f in txColumnFilters) {
            if (f === field) continue;
            if (txColumnFilters[f].size > 0 && !txColumnFilters[f].has(getTxColumnDisplayValue(f, tx))) return false;
        }
        return true;
    });

    const uniqueValues = [...new Set(contextTx.map(tx => getTxColumnDisplayValue(field, tx)))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const currentSelection = txColumnFilters[field];
    const selectedSet = currentSelection.size > 0 ? currentSelection : new Set(uniqueValues);

    const dropdown = document.createElement('div');
    dropdown.id ='col-filter-dropdown';
    dropdown.className ='col-filter-dropdown';
    dropdown.innerHTML = `
        <div class="col-filter-search"><input type="text" placeholder="Search..." oninput="filterTxColumnFilterOptions(this.value)"></div>
        <div class="col-filter-selectall"><input type="checkbox" id="col-filter-selectall-cb"><span>Select All</span></div>
        <div class="col-filter-list" id="col-filter-list"></div>
        <div class="col-filter-actions">
            <button type="button" class="col-filter-clear" onclick="clearTxColumnFilter('${field}')">Clear</button>
            <button type="button" class="col-filter-apply" onclick="applyTxColumnFilter('${field}')">Apply</button>
        </div>
    `;
    document.body.appendChild(dropdown);
    renderTxColumnFilterOptions(uniqueValues, selectedSet);

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
    setTimeout(() => document.addEventListener('click', closeTxColumnFilterDropdownOnOutsideClick), 0);
}

function renderTxColumnFilterOptions(values, selectedSet) {
    const list = document.getElementById('col-filter-list');
    if (!list) return;
    if (values.length === 0) {
        list.innerHTML = `<div class="col-filter-empty">No data</div>`;
        return;
    }
    list.innerHTML = values.map(v => {
        const safe = escapeHtml(v);
        const checked = selectedSet.has(v) ?'checked' :'';
        return `<label class="col-filter-option"><input type="checkbox" value="${safe}" ${checked}><span>${safe}</span></label>`;
    }).join('');
}

function filterTxColumnFilterOptions(query) {
    const list = document.getElementById('col-filter-list');
    if (!list) return;
    const q = query.trim().toLowerCase();
    list.querySelectorAll('.col-filter-option').forEach(opt => {
        const text = opt.textContent.trim().toLowerCase();
        opt.style.display = text.includes(q) ?'' :'none';
    });
}

function applyTxColumnFilter(field) {
    const list = document.getElementById('col-filter-list');
    if (!list) return;
    const allCbs = [...list.querySelectorAll('input[type="checkbox"]')];
    const checked = allCbs.filter(cb => cb.checked).map(cb => cb.value);

    txColumnFilters[field] = (checked.length === 0 || checked.length === allCbs.length) ? new Set() : new Set(checked);

    updateTxFilterIconStates();
    closeTxColumnFilterDropdown();
    filterTransactionsTable();
}

function clearTxColumnFilter(field) {
    txColumnFilters[field] = new Set();
    updateTxFilterIconStates();
    closeTxColumnFilterDropdown();
    filterTransactionsTable();
}

function updateTxFilterIconStates() {
    document.querySelectorAll('.tx-col-filter-btn').forEach(btn => {
        const field = btn.getAttribute('data-field');
        const hasFilter = txColumnFilters[field] && txColumnFilters[field].size > 0;
        btn.classList.toggle('active', hasFilter);
    });
}

function closeTxColumnFilterDropdown() {
    const existing = document.getElementById('col-filter-dropdown');
    if (existing) existing.remove();
    document.querySelectorAll('.tx-col-filter-btn.filter-btn-open').forEach(b => b.classList.remove('filter-btn-open'));
    activeTxFilterField = null;
    document.removeEventListener('click', closeTxColumnFilterDropdownOnOutsideClick);
}

function closeTxColumnFilterDropdownOnOutsideClick(evt) {
    const dropdown = document.getElementById('col-filter-dropdown');
    if (!dropdown) return;
    if (dropdown.contains(evt.target)) return;
    if (evt.target.closest && evt.target.closest('.tx-col-filter-btn')) return;
    closeTxColumnFilterDropdown();
}

function filterTransactionsTable() {
    const searchQuery = document.getElementById('tx-history-search').value.trim().toLowerCase();

    const filtered = localTransactionsList.filter(tx => {
        const matchesSearch = tx.id.toLowerCase().includes(searchQuery) || tx.cashier.toLowerCase().includes(searchQuery);
        if (!matchesSearch) return false;
        for (const field in txColumnFilters) {
            if (txColumnFilters[field].size > 0 && !txColumnFilters[field].has(getTxColumnDisplayValue(field, tx))) return false;
        }
        return true;
    });

    updateTxFilterIconStates();
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

    if (!currentUser) return;

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
            console.error(`Failed to sync offline transaction ID ${item.transaction.id}. Sync stopped.`, err);
            break;
        }
    }

    offlineTx = offlineTx.filter(item => !successfulSyncs.includes(item.transaction.id));
    localStorage.setItem('offline_transactions', JSON.stringify(offlineTx));

    if (successfulSyncs.length > 0) {
        console.log(`Synced ${successfulSyncs.length} offline transaction(s) to the server.`);

        if (typeof loadDashboardMetrics ==='function') loadDashboardMetrics();
        if (typeof loadTransactionsHistory ==='function') loadTransactionsHistory();
    }
}

window.addEventListener('online', () => {
    console.log("Internet connection restored — starting sync of offline transactions...");
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
                    text:'Your shift/Z-Reading has been closed (Admin/Supervisor Control). You have been returned to the Home view.',
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

window.checkRealInternetAccess = function checkRealInternetAccess(timeoutMs = 1500) {
    return Promise.resolve(!!navigator.onLine);
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

        if (window.setConnectivityLiveState) window.setConnectivityLiveState(state);
    }

    async function updateStatusIndicator() {

        if (!navigator.onLine) {
            applyState('offline','System Status: No WiFi connected or Data SIM is off');
            return;
        }

        if (realInternetCheckInFlight) return;
        realInternetCheckInFlight = true;

        applyState('connecting','System Status: Connected to network, waiting for internet connection...');

        const hasRealInternet = await window.checkRealInternetAccess();
        realInternetCheckInFlight = false;

        if (!navigator.onLine) {
            applyState('offline','System Status: No WiFi connected or Data SIM is off');
            return;
        }

        if (hasRealInternet) {
            applyState('online','System Status: Connected to Internet');
        } else {
            applyState('connecting','System Status: Connected to network, waiting for internet connection...');
        }
    }

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

    function forceRecheckNow() {
        if (pollTimer) clearTimeout(pollTimer);
        runPoll();
    }

    forceRecheckNow();

    window.addEventListener('online', forceRecheckNow);
    window.addEventListener('offline', forceRecheckNow);

    let lastForcedCheckAt = 0;
    window.__triggerNetworkRecheck = () => {
        const now = Date.now();
        if (now - lastForcedCheckAt < 1000) return;
        lastForcedCheckAt = now;
        forceRecheckNow();
    };

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

function isFullscreenApiSupported() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen);
}

function isCurrentlyFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}

function requestAppFullscreen(el) {
    const request = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (request) return request.call(el);
    return Promise.reject(new Error('Fullscreen API not supported'));
}

function exitAppFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (exit) return exit.call(document);
    return Promise.reject(new Error('Fullscreen API not supported'));
}

function updateFullscreenButtonUI() {
    const btn = document.getElementById('btn-fullscreen-toggle');
    const icon = document.getElementById('fullscreen-icon');
    if (!btn || !icon) return;
    const active = isCurrentlyFullscreen();
    icon.className = active ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    btn.classList.toggle('is-fullscreen-active', active);
    const label = active ? 'Exit Fullscreen' : 'Fullscreen';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    const labelEl = document.getElementById('fullscreen-toggle-label');
    if (labelEl) labelEl.textContent = label;
}

async function toggleAppFullscreen() {
    if (!isFullscreenApiSupported()) {

        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (typeof showInstallAppBanner === 'function') {
            showInstallAppBanner({ mode: isIOS ? 'ios' : 'android' });
        } else if (typeof Swal !== 'undefined') {
            Swal.fire('Fullscreen Not Available', 'Hindi sinusuportahan ng browser na ito ang Fullscreen mode. Subukang i-install ang OmniPOS sa Home Screen para sa full-screen na view.', 'info');
        }
        return;
    }
    try {
        if (isCurrentlyFullscreen()) {
            await exitAppFullscreen();
        } else {
            await requestAppFullscreen(document.documentElement);
        }
    } catch (e) {
        console.error('Fullscreen toggle failed:', e);
    }

    updateFullscreenButtonUI();
}

['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach((evt) => {
    document.addEventListener(evt, updateFullscreenButtonUI);
});

function initFullscreenToggleButton() {
    const btn = document.getElementById('btn-fullscreen-toggle');
    if (!btn) return;

    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandaloneAlready = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;

    if (isStandaloneAlready && isIOS && !isFullscreenApiSupported()) {
        btn.style.display = 'none';
        return;
    }

    updateFullscreenButtonUI();
}

function isHeaderInteractiveTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    // Anumang button, link, o element na may sariling onclick/role — huwag
    // patakbuhin ang fullscreen toggle dito (logo, hamburger, bell, user menu, atbp.)
    return !!target.closest('button, a, [role="button"], [onclick], input, select, textarea, .header-user-menu-wrap, #header-user-dropdown');
}

function initHeaderDoubleTapFullscreen() {
    const header = document.getElementById('app-top-header');
    if (!header) return;

    // Desktop: native double-click
    header.addEventListener('dblclick', (e) => {
        if (isHeaderInteractiveTarget(e.target)) return;
        toggleAppFullscreen();
    });

    // Mobile: manual double-tap detection — hindi laging maaasahang mag-fire
    // ang native "dblclick" mula sa dalawang magkasunod na tap sa touchscreen.
    const DOUBLE_TAP_MAX_DELAY = 350;
    const DOUBLE_TAP_MAX_MOVE = 20;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    header.addEventListener('touchend', (e) => {
        if (isHeaderInteractiveTarget(e.target)) {
            lastTapTime = 0;
            return;
        }
        if (!e.changedTouches || !e.changedTouches.length) return;

        const touch = e.changedTouches[0];
        const now = Date.now();
        const movedX = Math.abs(touch.clientX - lastTapX);
        const movedY = Math.abs(touch.clientY - lastTapY);

        if (lastTapTime && (now - lastTapTime) <= DOUBLE_TAP_MAX_DELAY && movedX <= DOUBLE_TAP_MAX_MOVE && movedY <= DOUBLE_TAP_MAX_MOVE) {
            lastTapTime = 0;
            e.preventDefault();
            toggleAppFullscreen();
        } else {
            lastTapTime = now;
            lastTapX = touch.clientX;
            lastTapY = touch.clientY;
        }
    });
}

let deferredInstallPromptEvent = null;

function initInstallAppBanner() {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobileDevice) return;

    const isStandaloneAlready = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (isStandaloneAlready) return;

    if (localStorage.getItem('installBannerDismissedAt')) {
        const dismissedAgoMs = Date.now() - parseInt(localStorage.getItem('installBannerDismissedAt'), 10);
        if (dismissedAgoMs < 7 * 24 * 60 * 60 * 1000) return;
    }

    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPromptEvent = e;
        showInstallAppBanner({ mode: 'android' });
    });

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
                ? 'Tap <i class="fa-solid fa-arrow-up-from-bracket"></i> Share, then "Add to Home Screen" — for full-screen, no browser bar.'
                : 'For a full-screen view, no browser address bar, and faster launch.'}</p>
        </div>
        <div class="install-app-banner-actions">
            ${mode === 'android' ? `<button type="button" class="install-app-banner-btn" id="install-app-banner-confirm">Install</button>` : ''}
            <button type="button" class="install-app-banner-dismiss" id="install-app-banner-dismiss" aria-label="Close">
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

    if (typeof reclampCartPaneWidthToCurrentView === 'function') {
        reclampCartPaneWidthToCurrentView();
    }
}

function updateCategoryChipsDynamic() {
    const container = document.getElementById('category-chips');
    if (!container) return;

    try {
        const validProducts = globalProducts.filter(p => p && typeof p ==='object');
        const uniqueCategories = ['All', ...new Set(validProducts.map(p => p.category ||'Others'))];

        container.innerHTML ='';

        uniqueCategories.forEach(cat => {
            const chip = document.createElement('span');

            chip.className = `chip ${activeTerminalCategory === cat ?'active' :''}`;
            chip.innerText = cat;

            chip.onclick = () => filterTerminalCategory(cat);
            attachInstantTapFeedback(chip, { hapticMs: 8 });

            container.appendChild(chip);
        });
    } catch (chipError) {
        console.error('Failed to render category chips:', chipError);
    }
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
        console.warn("Could not play scan audio:", error);
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
                .then(async (res) => {
                    let data = null;
                    try {
                        data = await res.json();
                    } catch (parseErr) {
                        // May sagot ang server (hindi ito network failure) pero hindi
                        // JSON yung laman — karaniwang dahilan: sobrang laki ng file.
                        throw new Error(res.ok
                            ?'Hindi mabasa ang sagot ng server.'
                            : `Tinanggihan ng server ang request (status ${res.status}). Maaaring sobrang laki ng backup file.`);
                    }
                    if (!res.ok) {
                        throw new Error((data && data.message) || `Tinanggihan ng server ang request (status ${res.status}).`);
                    }
                    return data;
                })
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
                    if (err instanceof TypeError) {
                        // Totoong hindi-maabot ang server (offline/hindi tumatakbo).
                        Swal.fire('Server Connection Error','There was a problem connecting to the server. Make sure server.js is running.','error');
                    } else {
                        Swal.fire('Restore Failed', err.message ||'May problema sa pag-restore. Subukan ulit.','error');
                    }
                });

            } catch (err) {
                Swal.fire('Invalid Format','Invalid JSON file format. Make sure this is the backup file from the email.','error');
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
const IDLE_TIMEOUT_LIMIT = 5 * 60 * 1000;
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

    try { closeUserWidgetMenu(); } catch (e) {}
    try { if (typeof Swal !=='undefined' && Swal.isVisible && Swal.isVisible()) Swal.close(); } catch (e) {}

    window.__logoutInProgress = true;

    try { destroyIdleTimer(); } catch (e) {}
    try { stopTerminalStockPolling(); } catch (e) {}
    try { stopInventoryStockPolling(); } catch (e) {}

    try { stopReorderPolling(); } catch (e) {}

    try {
        if (demoCountdownInterval) { clearInterval(demoCountdownInterval); demoCountdownInterval = null; }
        const demoWidget = document.getElementById('demo-mode-banner-container');
        if (demoWidget) demoWidget.style.display ='none';
    } catch (e) {}

    const username = currentUser ? (currentUser.username ||'Unknown') :'Unknown';
    const logMethod = type ==='auto' ?'AUTO_TIMEOUT' :'MANUAL';
    const detailMsg = type ==='auto' ?'Idle timeout' :'User sign-out';
    const oldUser = currentUser ? currentUser.username : null;

    const tokenAtLogout = localStorage.getItem('omnipos_token');

    console.log(type ==='manual'
        ?"Manual logout detected. Clearing cart from database (background)..."
        : `Auto-logout (${type}) detected. Cart is safely preserved in the database.`);
    shoppingCart = [];

    try {
        sessionStorage.removeItem('currentView');
        localStorage.removeItem('omnipos_user');
        localStorage.removeItem('omnipos_token');
        currentUser = null;

        unlockedFeatureIdsCache = null;
        purchasedFeatureIdsCache = null;
        fullyPurchasedCache = false;

        if (typeof renderSidebarProBadge ==='function') {
            renderSidebarProBadge(false, false);
        }

        const txtUser = document.getElementById('login-username');
        const txtPass = document.getElementById('login-password');

        if (txtUser) txtUser.value ='';
        if (txtPass) txtPass.value ='';
    } catch (err) {
        console.error('Error while cleaning up UI state on logout (non-blocking, navigation continues):', err);
    } finally {
        try {
            history.pushState({ view:'auth-view' },'','');
        } catch (e) {}
        showAuthenticationInterface();
    }

    (async () => {
        try {
            const authHeader = tokenAtLogout ? {'Authorization': `Bearer ${tokenAtLogout}` } :{};

            const preLogoutResults = await Promise.allSettled([
                (type ==='manual' && oldUser)
                    ? authFetch(`${API_URL}/cart`, {
                        method:'POST',
                        headers: {'Content-Type':'application/json', ...authHeader },
                        body: JSON.stringify({ username: oldUser, cart: [] })
                    })
                    : Promise.resolve(null),
                authFetch(`${API_URL}/logs`, {
                    method:'POST',
                    headers: {'Content-Type':'application/json', ...authHeader },
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
                headers: {'Content-Type':'application/json', ...authHeader }
            }).then(
                (res) => ({ status:'fulfilled', value: res }),
                (err) => ({ status:'rejected', reason: err })
            );

            const results = [...preLogoutResults, logoutResult];
            const labels = ['Cart clear','Log transmission','Session invalidation'];
            results.forEach((r, i) => {
                if (r.status ==='rejected') console.error(`${labels[i]} failed during logout (background):`, r.reason);
            });
        } catch (err) {
            console.error('Background logout cleanup failed:', err);
        }

        setTimeout(() => {
            window.__logoutInProgress = false;
            window.__sessionExpiredShown = false;
        }, 5000);
    })();
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
                localStorage.setItem('omnipos_user', JSON.stringify(currentUser));
                renderSidebarUserWidget();
            }
        } catch (err) {  }
    })();

    try {
        try { applyRoleBasedAccessControls(currentUser.role); } catch (e) { console.error('applyRoleBasedAccessControls failed (non-blocking):', e); }

        await refreshPermissions();
        try { checkAdminResetVisibility(); } catch (e) { console.error('checkAdminResetVisibility failed (non-blocking):', e); }

        await refreshUnlockedFeaturesFromServer();
        await refreshUnlockedThemesFromServer();

        await initDemoModeUI();

        (async () => {
            try {
                await authFetch(`${API_URL}/features/restore-check`, { method:'POST' });
                await refreshUnlockedFeaturesFromServer();
                await refreshUnlockedThemesFromServer();
                await initDemoModeUI();
            } catch (err) {
                console.warn('Automatic Relay sync did not complete after login:', err);
            }
        })();

        try {
            if (typeof window.syncConnectivityModeOnLogin ==='function') {
                window.syncConnectivityModeOnLogin();
            }
        } catch (e) { console.error('syncConnectivityModeOnLogin failed (non-blocking):', e); }

        initializeSystem();

        initIdleTimer();

        loadCartFromDatabase();

        receiptSettingsPromise = fetchReceiptSettings();

        try { await fetchStoreSettings(); } catch (e) { console.error('fetchStoreSettings failed (non-blocking):', e); }
        try { await fetchUxSettings(); } catch (e) { console.error('fetchUxSettings failed (non-blocking):', e); }
        try { await fetchAdvancedSettings(); setupIdleAutoLock(); } catch (e) { console.error('fetchAdvancedSettings failed (non-blocking):', e); }
        applyPaymentMethodVisibility();
    } catch (err) {
        console.error('Unexpected error while loading the main system interface after login (still proceeding to show the view):', err);
    } finally {

        try {
            const shortcutView = new URLSearchParams(window.location.search).get('view');
            const ALLOWED_SHORTCUT_VIEWS = ['terminal','products'];

            const savedView = sessionStorage.getItem('currentView');
            if (shortcutView && ALLOWED_SHORTCUT_VIEWS.includes(shortcutView)) {
                switchView(shortcutView);

                history.replaceState({ view: shortcutView }, '', window.location.pathname);
            } else if (savedView && savedView !=='auth-view') {
                switchView(savedView);
                history.replaceState({ view: savedView },'','');
            } else {
                switchView('overview');
                history.replaceState({ view:'overview' },'','');
            }
        } catch (finalErr) {
            console.error('Fallback view also failed to render — please try reloading the page:', finalErr);
        }
    }
}

function showTermsAndConditions() {
    Swal.fire({
        title: '<i class="fa-solid fa-file-contract"></i> Terms and Conditions',
        html: `
            <div style="text-align:left; font-size:0.88rem; line-height:1.6; max-height:60vh; overflow-y:auto; padding-right:6px;">

                <p style="color:#64748b; font-size:0.8rem;">Last updated: ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}</p>

                <p>These Terms and Conditions ("Terms") govern access to and use of the OmniPOS point-of-sale software ("Software", "System") by the business or individual using it ("Customer", "you"). By checking the acceptance box on the sign-in screen, or by otherwise accessing or using the Software, you confirm that you have read, understood, and agree to be bound by these Terms. If you do not agree, do not use the Software.</p>

                <p><strong>1. License Grant</strong><br>
                Subject to your compliance with these Terms, you are granted a limited, non-exclusive, non-transferable license to install and use the Software on the devices and installation(s) authorized to you. Ownership of the Software, including its source code, design, and underlying architecture, remains with its developer at all times. No title or ownership rights are transferred to you.</p>

                <p><strong>2. Permitted Use</strong><br>
                You may use the Software solely for your own lawful business operations, including point-of-sale transactions, inventory management, reporting, and related administrative functions. You are responsible for all activity that occurs under your account, including safeguarding your username, password, and any device used to sign in.</p>

                <p><strong>3. Restrictions</strong><br>
                You must not, and must not permit any third party to: (a) reverse-engineer, decompile, or disassemble the Software; (b) tamper with, bypass, or attempt to circumvent any licensing, activation, or premium-feature unlock mechanism; (c) copy, clone, redistribute, sublicense, rent, lease, or resell the Software or access to it without prior written authorization; or (d) use the Software for any unlawful purpose. Any installation found to be tampered with, cloned, or improperly duplicated may be automatically flagged, isolated, or have its features restricted to protect the integrity of the licensing system.</p>

                <p><strong>4. Premium / Pro Features and Activation</strong><br>
                Certain features are locked by default and are unlocked through a verification process (such as a one-time activation code) administered by the developer. Requests for activation are subject to review and approval at the developer's discretion. Misuse of the activation process, including attempts to generate, share, or reuse unauthorized activation codes, is strictly prohibited and may result in suspension of access.</p>

                <p><strong>5. Your Data and Your Customers' Data</strong><br>
                All sales, inventory, and customer/loyalty records you enter into the Software belong to you. You are solely responsible for the accuracy of this data and for complying with applicable data privacy laws with respect to your own customers' personal information (e.g., names, contact details, purchase history) that you choose to store in the System. Where optional cloud backup or sync features are enabled, data is transmitted and stored solely to provide that feature and is not accessed for any other purpose without your consent, except as required to maintain, secure, or troubleshoot the service.</p>

                <p><strong>6. Service Availability</strong><br>
                Core features (checkout, inventory, reporting) are designed to function on your local network without requiring continuous internet access. Certain features (e.g., email-based OTP verification, cloud backup, or activation requests) require an active internet connection and depend on third-party services (such as email providers) that are outside the developer's control.</p>

                <p><strong>7. Disclaimer of Warranties</strong><br>
                The Software is provided "as is" and "as available," without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, or non-infringement. The developer does not warrant that the Software will be uninterrupted, error-free, or completely secure.</p>

                <p><strong>8. Limitation of Liability</strong><br>
                To the fullest extent permitted by law, the developer shall not be liable for any indirect, incidental, special, or consequential damages, including loss of profits, revenue, data, or business opportunity, arising from or related to your use of, or inability to use, the Software.</p>

                <p><strong>9. Suspension and Termination</strong><br>
                Access to premium features or activation services may be suspended or terminated if these Terms are violated, including in cases of attempted cloning, tampering, or unauthorized redistribution. Core, locally-hosted functionality of the Software that does not depend on the developer's servers is not affected by such suspension.</p>

                <p><strong>10. Changes to These Terms</strong><br>
                These Terms may be updated from time to time. Continued use of the Software after an update constitutes acceptance of the revised Terms. The current version can always be reviewed from Settings &gt; Terms and Conditions within the Software.</p>

                <p><strong>11. Contact</strong><br>
                For questions about these Terms, please reach out through the support channel provided by your Software vendor/developer.</p>

            </div>
        `,
        confirmButtonText: 'Close',
        width: '640px'
    });
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
            ?'Admin password is required to void this transaction. This will return the stock to inventory.'
            :'Admin or authorized Supervisor/Manager password is required to void this transaction. This will return the stock to inventory.',
        input:'password',
        inputPlaceholder: isAdmin ?'Enter Admin password' :'Admin/Supervisor password',
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
            Swal.fire('Success', result.message ||'Transaction voided and stock restored!','success');
            location.reload();
        } else {
            Swal.fire('Error', result.message ||'Could not void the transaction.','error');
        }
    } catch (err) {
        console.error("Void Error:", err);
        Swal.fire('Error','May problema sa connection sa server.','error');
    }
}

async function handleRefundTransaction(transactionId) {
    const tx = (localTransactionsList || []).find(t => t.id === transactionId);
    if (!tx) {
        Swal.fire('Not Found', 'Hindi mahanap ang transaksyong ito sa kasalukuyang listahan. I-refresh muna ang Transactions tab.', 'error');
        return;
    }

    const refundedQtyMap = tx.refundedQty && typeof tx.refundedQty === 'object' ? tx.refundedQty : {};
    const refundableItems = (tx.items || []).map(item => {
        const alreadyRefunded = parseInt(refundedQtyMap[item.code], 10) || 0;
        const maxRefundable = Math.max(0, (parseInt(item.quantity, 10) || 0) - alreadyRefunded);
        return { ...item, alreadyRefunded, maxRefundable };
    });

    if (refundableItems.every(it => it.maxRefundable <= 0)) {
        Swal.fire('Wala nang Matitira', 'Naka-full refund na ang lahat ng items sa transaksyong ito.', 'info');
        return;
    }

    const itemRowsHtml = refundableItems.map((item, idx) => {
        const disabled = item.maxRefundable <= 0 ? 'disabled' : '';
        const alreadyNote = item.alreadyRefunded > 0 ? ` <span style="color:#f59e0b;">(${item.alreadyRefunded} na na-refund dati)</span>` : '';
        return `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #e2e8f0; text-align:left;">
                <input type="checkbox" class="refund-item-check" data-idx="${idx}" ${disabled} style="width:auto;">
                <div style="flex:1;">
                    <div style="font-size:0.85rem; font-weight:600;">${escapeHtml(item.name)}${alreadyNote}</div>
                    <div style="font-size:0.75rem; color:#64748b;">₱${parseFloat(item.price).toFixed(2)} each — natitirang pwedeng i-refund: ${item.maxRefundable}</div>
                </div>
                <input type="number" class="refund-item-qty" data-idx="${idx}" min="0" max="${item.maxRefundable}" value="${item.maxRefundable > 0 ? item.maxRefundable : 0}" ${disabled} style="width:60px; padding:4px;">
            </div>
        `;
    }).join('');

    const { value: refundSelection } = await Swal.fire({
        title: '↩️ Refund Items',
        html: `
            <div style="max-height:280px; overflow-y:auto; margin-bottom:10px;">${itemRowsHtml}</div>
            <textarea id="refund-reason-input" placeholder="Dahilan ng refund (e.g. sirang produkto, mali ang binili, atbp.)" style="width:100%; min-height:60px; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-family:inherit;"></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: 'Magpatuloy',
        confirmButtonColor: '#f59e0b',
        cancelButtonColor: '#64748b',
        width: 480,
        preConfirm: () => {
            const checks = document.querySelectorAll('.refund-item-check');
            const items = [];
            checks.forEach(chk => {
                if (!chk.checked) return;
                const idx = chk.getAttribute('data-idx');
                const qtyInput = document.querySelector(`.refund-item-qty[data-idx="${idx}"]`);
                const qty = parseInt(qtyInput.value, 10) || 0;
                const item = refundableItems[idx];
                if (qty <= 0) return;
                if (qty > item.maxRefundable) {
                    Swal.showValidationMessage(`Sobra ang quantity para sa ${item.name} (max: ${item.maxRefundable})`);
                    return;
                }
                items.push({ code: item.code, quantity: qty });
            });
            if (items.length === 0) {
                Swal.showValidationMessage('Pumili ng kahit isang item na i-re-refund (checkbox + quantity).');
                return;
            }
            const reason = (document.getElementById('refund-reason-input').value || '').trim();
            return { items, reason };
        }
    });

    if (!refundSelection) return;

    const isAdminForRefund = currentUser && currentUser.role && currentUser.role.toLowerCase() ==='admin';
    const { value: refundAdminPassword } = await Swal.fire({
        title: isAdminForRefund ? '🔒 Admin Authorization Required' : '🔒 Refund Authorization Required',
        html: isAdminForRefund
            ? 'Admin password is required to process this refund. This will restore the stock to inventory.'
            : 'Admin or authorized Supervisor/Manager password is required to process this refund. This will restore the stock to inventory.',
        input: 'password',
        inputPlaceholder: isAdminForRefund ? 'Enter Admin password' : 'Admin/Supervisor password',
        showCancelButton: true,
        confirmButtonColor: '#f59e0b',
        cancelButtonColor: '#64748b'
    });

    if (!refundAdminPassword || refundAdminPassword.trim() === '') return;

    try {
        const response = await authFetch(`${API_URL}/transactions/${transactionId}/refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requester: currentUser.username,
                adminPassword: refundAdminPassword,
                items: refundSelection.items,
                reason: refundSelection.reason
            })
        });

        const result = await response.json();
        if (result.success) {
            Swal.fire('Success', result.message || 'Na-process ang refund at naibalik ang stock!', 'success');
            location.reload();
        } else {
            Swal.fire('Error', result.message || 'Hindi ma-process ang refund.', 'error');
        }
    } catch (err) {
        console.error('Refund Error:', err);
        Swal.fire('Error', 'May problema sa connection sa server.', 'error');
    }
}

function searchInsideBackupFile() {
    const fileInput = document.getElementById('backup-query-file');
    const searchId = document.getElementById('backup-query-id').value.trim();

    if (!fileInput.files || fileInput.files.length === 0) {
        Swal.fire({
            title:'No File',
            text:'Please select a Full Backup file (.json) first.',
            icon:'warning',
            confirmButtonColor:'#2563eb'
        });
        return;
    }

    if (!searchId) {
        Swal.fire({
            title:'ID or Keyword Required',
            text:'Please enter the ID you are searching for.',
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
                    title: `Record Found in ${foundSection}!`,
                    html: `
                        <div style="text-align: left; margin-top: 10px; font-family: 'Segoe UI', system-ui, sans-serif;">
                            <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 12px;">
                                <i class="fa-solid fa-file-invoice"></i> From file: <strong>${file.name}</strong>
                            </p>
                            <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; max-height: 380px; overflow-y: auto; background: #ffffff; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
                                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                                    ${tableRowsHtml}
                                </table>
                            </div>
                        </div>
                    `,
                    icon:'success',
                    confirmButtonText:'Thanks',
                    confirmButtonColor:'#2563eb',
                    width:'600px'
                });
            } else {
                Swal.fire({
                    title:'Not Found',
                    text: `No matching record found for "${searchId}" in any category in the file ${file.name}.`,
                    icon:'info',
                    confirmButtonColor:'#2563eb'
                });
            }

        } catch (error) {
            console.error("Backup search error:", error);
            Swal.fire({
                title:'Read Error',
                text:'Could not read the file. Make sure this is a valid Full Backup JSON file from OmniPOS.',
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
                    console.error("Could not find the button with the text 'Search' in the HTML.");
                }
            }, 300);

        } else {
            console.error("Could not find the input text box for the backup ID.");
        }
    };
}

function isDesktopOrLaptopDevice() {
    const ua = navigator.userAgent || navigator.vendor || window.opera ||'';
    const mobileTabletRegex =/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk/i;
    return !mobileTabletRegex.test(ua);
}

// ---- Global external barcode scanner auto-detect & auto-focus ----
// Lets a cashier scan a barcode from anywhere on the page — no need to click/tap into
// a search box first. Works on desktop, mobile, and tablet: a USB-OTG or Bluetooth
// external barcode scanner registers with the OS as a keyboard (HID), so it produces
// the exact same fast keystroke-then-Enter pattern on a phone/tablet as it does on a PC.
// is open), a scanner-speed burst of keystrokes ending in Enter is treated as a scan and
// automatically routed to whichever search box belongs to the page currently on screen
// (Terminal, Product Inventory, or Transaction History), reusing the exact same
// scan-handling logic those boxes already use. If the user has actually clicked into
// any input/textarea (including one of these search boxes, or a form field inside a
// modal like the barcode field on the Add/Edit Product screen), this router steps aside
// so that field's own normal behavior/listener handles the keystrokes instead.
let __globalScanBuffer ='';
let __globalScanLastKeyTime = 0;
let __globalScanResetId = null;
const GLOBAL_SCAN_GAP_MS = 45;
const GLOBAL_SCAN_MIN_LENGTH = 4;

function isEditableElementFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag ==='INPUT' || tag ==='TEXTAREA' || tag ==='SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
}

function isAnyModalOpen() {
    const overlays = document.querySelectorAll('.modal-overlay, .swal2-container');
    for (let i = 0; i < overlays.length; i++) {
        if (window.getComputedStyle(overlays[i]).display !=='none') return true;
    }
    return false;
}

function isViewVisible(viewId) {
    const el = document.getElementById(viewId);
    return !!el && window.getComputedStyle(el).display !=='none';
}

function handleHardwareScanGenericSearch(inputId, filterFnName, scannedCode) {
    const cleanCode = (scannedCode ||'').trim();
    if (!cleanCode) return;

    const input = document.getElementById(inputId);
    if (input) {
        input.value = cleanCode;
        input.focus();
    }
    if (typeof window[filterFnName] ==='function') window[filterFnName]();
    if (typeof playScanBeep ==='function') playScanBeep();
}

function routeGlobalScannedCode(code) {
    const cleanCode = (code ||'').trim();
    if (!cleanCode) return;

    if (isViewVisible('view-terminal')) {
        const input = document.getElementById('terminal-search');
        if (input) input.focus();
        if (typeof handleHardwareScanTerminal ==='function') handleHardwareScanTerminal(cleanCode);
    } else if (isViewVisible('view-products')) {
        const input = document.getElementById('inventory-search');
        if (input) input.focus();
        if (typeof handleHardwareScanInventory ==='function') handleHardwareScanInventory(cleanCode);
    } else if (isViewVisible('view-transactions')) {
        const input = document.getElementById('tx-history-search');
        if (input) input.focus();
        if (typeof handleHardwareScanTransaction ==='function') handleHardwareScanTransaction(cleanCode);
    } else if (isViewVisible('view-customers')) {
        handleHardwareScanGenericSearch('customer-search-input','renderCustomersTable', cleanCode);
    } else if (isViewVisible('view-debts')) {
        handleHardwareScanGenericSearch('debt-search-input','renderDebtsTable', cleanCode);
    } else if (isViewVisible('view-reorder')) {
        handleHardwareScanGenericSearch('reorder-search-input','renderReorderTable', cleanCode);
    }
    // Any other page has no relevant search box, so there's nothing to auto-route to.
}

document.addEventListener('keydown', function (e) {
    // Works on desktop AND mobile/tablet: Bluetooth or USB-OTG external barcode
    // scanners identify themselves to the OS as a keyboard (HID), so they fire the
    // exact same fast keystroke bursts on phones/tablets as they do on a PC keyboard.
    // The on-screen virtual keyboard is unaffected since this only engages when
    // nothing editable is focused (see isEditableElementFocused below).
    if (isEditableElementFocused()) return;
    if (isAnyModalOpen()) return;

    const now = Date.now();
    const delta = now - __globalScanLastKeyTime;
    __globalScanLastKeyTime = now;

    if (e.key ==='Enter') {
        if (__globalScanBuffer.length >= GLOBAL_SCAN_MIN_LENGTH) {
            e.preventDefault();
            const scanned = __globalScanBuffer;
            __globalScanBuffer ='';
            routeGlobalScannedCode(scanned);
        }
        return;
    }

    if (e.key.length === 1) {
        __globalScanBuffer = (delta <= GLOBAL_SCAN_GAP_MS) ? (__globalScanBuffer + e.key) : e.key;
    }

    if (__globalScanResetId) clearTimeout(__globalScanResetId);
    __globalScanResetId = setTimeout(() => { __globalScanBuffer =''; }, 300);
});

function applyDeviceScanRestrictions() {
    const isDesktop = isDesktopOrLaptopDevice();

    if (isDesktop) {
        document.querySelectorAll('.btn-scan-qr:not(.btn-scan-hardware-only), .btn-scan-backup').forEach(btn => {
            btn.disabled = true;
            btn.classList.add('scan-btn-disabled');
            btn.title ='Camera scan is only available on mobile or tablet devices. Use an external barcode scanner in the search box.';
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
        .catch(e => console.warn("Failed to background-refresh products:", e));

    const product = globalProducts.find(p => p.code === cleanCode);

    if (product) {
        const cartItem = shoppingCart.find(item => item.code === product.code);
        const qtyInBasket = cartItem ? cartItem.quantity : 0;

        if (product.stock <= 0 || qtyInBasket >= product.stock) {
            Swal.fire({
                toast: true, position:'top-end', icon:'error',
                title: `Out of stock: ${product.name}`,
                showConfirmButton: false, timer: 1200, timerProgressBar: true,
                customClass: { popup:'scan-fast-toast' },
                showClass: { popup:'scan-fast-toast-in' }, hideClass: { popup:'scan-fast-toast-out' }
            });
            return;
        }

        // Add to cart immediately — the confirmation toast below is purely informational
        // and never blocks or delays the item from landing in the cart.
        addItemToCart(product);
        if (typeof playScanBeep ==='function') playScanBeep();

        Swal.fire({
            toast: true, position:'top-end', icon:'success',
            title: `Naidagdag sa cart: ${product.name}`,
            showConfirmButton: false, timer: 800, timerProgressBar: true,
            customClass: { popup:'scan-fast-toast' },
            showClass: { popup:'scan-fast-toast-in' }, hideClass: { popup:'scan-fast-toast-out' }
        });
    } else {
        Swal.fire({
            toast: true, position:'top-end', icon:'warning',
            title: `No product matches the code: ${cleanCode}`,
            showConfirmButton: false, timer: 1500, timerProgressBar: true,
            customClass: { popup:'scan-fast-toast' },
            showClass: { popup:'scan-fast-toast-in' }, hideClass: { popup:'scan-fast-toast-out' }
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
            title:'Not Found',
            text: `No transaction record matches the ID "${cleanCode}".`,
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
            title: `No product matches the code: ${cleanCode}`,
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

(function setupHiddenAdminResetGesture() {
    const TAP_TARGET_SELECTOR = '.brand-title';
    const TAPS_REQUIRED = 7;
    const TAP_WINDOW_MS = 3000;

    let tapCount = 0;
    let tapTimer = null;

    document.addEventListener('DOMContentLoaded', () => {
        const target = document.querySelector(TAP_TARGET_SELECTOR);
        if (!target) return;

        target.addEventListener('click', () => {
            tapCount++;
            clearTimeout(tapTimer);
            tapTimer = setTimeout(() => { tapCount = 0; }, TAP_WINDOW_MS);

            if (tapCount >= TAPS_REQUIRED) {
                tapCount = 0;
                clearTimeout(tapTimer);
                openAdminResetModal();
            }
        });
    });

    async function openAdminResetModal() {

        const confirm = await Swal.fire({
            title: 'Reset Admin Password',
            text: 'This will send a reset request to the developer. You will need an OTP from them to continue.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Send Request'
        });
        if (!confirm.isConfirmed) return;

        try {
            const reqRes = await fetch('/api/admin/request-password-reset', { method: 'POST' });
            const reqData = await reqRes.json();
            if (!reqData.success) {
                Swal.fire('Not Sent', reqData.message || 'The request failed.', 'error');
                return;
            }
        } catch (err) {
            Swal.fire('Error', `Could not reach the server: ${err.message}`, 'error');
            return;
        }

        let confirmData = await showModernOtpModal({
            subtitle: 'We sent a 6-digit code to verify this password reset. Enter it below along with your new password.',
            confirmButtonText: 'Reset Password',
            withPasswordField: true,
            passwordPlaceholder: 'New Password (min 8 chars)',
            verifyFn: async ({ otp, newPassword }) => {
                const r = await authFetch('/api/admin/confirm-password-reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ otp, newPassword })
                });
                return r.json();
            }
        });
        if (!confirmData) return;

        try {
            if (confirmData.pending) {
                confirmData = await pollUntilApproved('/api/admin/confirm-password-reset', { otp: confirmData.otp, newPassword: confirmData.newPassword });
            }

            if (confirmData.cancelled) return;

            if (!confirmData.success) {
                // Inline retry feedback already handled this — no extra popup.
                return;
            }

            Swal.fire('Tagumpay!', 'Na-update na ang Admin password. Puwede ka nang mag-login gamit ang bago.', 'success');
        } catch (err) {
            Swal.fire('Error', `Hindi ma-reach ang server: ${err.message}`, 'error');
        }
    }
})();

// ============================================================
// Quick Access floating dock — desktop "fish-eye" hover effect
// (mirrors a macOS-dock-style magnification). Fully self-contained:
// it only ever touches elements inside #quick-access-dock, only
// runs when #quick-access-dock exists in the DOM, and only applies
// its effect when the matchMedia check below matches (desktop width
// + a real mouse/trackpad). On any other screen, or if the dock
// markup isn't present, this function does nothing and exits early
// — so it cannot affect mobile/tablet layout, the terminal view, or
// any other part of the app.
function initQuickAccessFishEye() {
    const dock = document.getElementById('quick-access-dock');
    if (!dock) return;

    const fishEyeActive = window.matchMedia('(min-width: 1025px) and (hover: hover) and (pointer: fine)');
    const MAX_SCALE = 1.5;   // magnification at the exact pointer position
    const LIFT_PX = 16;      // how far the magnified icon rises
    const INFLUENCE_PX = 95; // how far (in px) neighboring icons still feel the effect

    let rafId = null;

    function resetCards() {
        dock.querySelectorAll('.qa-card').forEach((card) => {
            card.style.transform = '';
            card.style.zIndex = '';
        });
    }

    function applyFishEye(pointerX) {
        const cards = dock.querySelectorAll('.qa-card');
        cards.forEach((card) => {
            const rect = card.getBoundingClientRect();
            const cardCenterX = rect.left + rect.width / 2;
            const distance = Math.abs(pointerX - cardCenterX);

            if (distance >= INFLUENCE_PX) {
                card.style.transform = '';
                card.style.zIndex = '';
                return;
            }

            const proximity = 1 - (distance / INFLUENCE_PX); // 0..1, 1 = right under the pointer
            const scale = 1 + (MAX_SCALE - 1) * proximity;
            const lift = LIFT_PX * proximity;

            card.style.transform = `translateY(-${lift.toFixed(2)}px) scale(${scale.toFixed(3)})`;
            card.style.zIndex = proximity > 0.05 ? '2' : '';
        });
    }

    function onPointerMove(e) {
        if (!fishEyeActive.matches) return;
        const pointerX = e.clientX;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => applyFishEye(pointerX));
    }

    function onPointerLeave() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        resetCards();
    }

    dock.addEventListener('mousemove', onPointerMove, { passive: true });
    dock.addEventListener('mouseleave', onPointerLeave, { passive: true });

    // If the window is resized/rotated across the desktop breakpoint
    // (or a mouse gets disconnected on a touch device), immediately
    // drop any leftover magnification so nothing is left mid-scale.
    const handleMediaChange = (ev) => {
        if (!ev.matches) resetCards();
    };
    if (typeof fishEyeActive.addEventListener === 'function') {
        fishEyeActive.addEventListener('change', handleMediaChange);
    } else if (typeof fishEyeActive.addListener === 'function') {
        // Safari/older-browser fallback
        fishEyeActive.addListener(handleMediaChange);
    }
}
document.addEventListener('DOMContentLoaded', initQuickAccessFishEye);

// ============================================================
// Quick Access floating dock — width sync with Overview siblings
// Makes the floating dock's width match its Overview siblings —
// e.g. the Sales Trend card — exactly, instead of the old fixed
// ~680px guess, while keeping it centered at the bottom of the
// screen. Recomputes on load, on window resize, and via
// ResizeObserver whenever the reference card's rendered size
// changes (sidebar width change, zoom, font-load reflow, switching
// back into the Overview view, etc.). Only ever touches
// #quick-access-dock; a no-op if that element or its reference
// sibling isn't present, and it removes its own sync state below
// the desktop breakpoint so the CSS fallback (centered, capped
// width) takes over on tablet/mobile untouched.
// ============================================================
(function initQuickAccessDockWidthSync() {
    const dock = document.getElementById('quick-access-dock');
    if (!dock) return;

    const desktopQuery = window.matchMedia('(min-width: 1025px)');
    let rafId = null;

    function getReferenceCard() {
        return document.getElementById('ov-adv-chart-card') ||
            document.querySelector('#view-overview .overview-trend-card');
    }

    function syncDockWidth() {
        if (!desktopQuery.matches) {
            dock.classList.remove('qa-dock-synced');
            dock.style.removeProperty('--qa-dock-width');
            return;
        }
        const ref = getReferenceCard();
        if (!ref) return;
        const rect = ref.getBoundingClientRect();
        if (!rect.width) return; // Overview isn't the active view right now
        dock.style.setProperty('--qa-dock-width', rect.width + 'px');
        dock.classList.add('qa-dock-synced');
    }

    function requestSync() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(syncDockWidth);
    }

    window.addEventListener('resize', requestSync, { passive: true });
    window.addEventListener('load', requestSync);

    if (typeof desktopQuery.addEventListener === 'function') {
        desktopQuery.addEventListener('change', requestSync);
    } else if (typeof desktopQuery.addListener === 'function') {
        desktopQuery.addListener(requestSync); // Safari/older-browser fallback
    }

    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(requestSync);
        ro.observe(document.body);
        const ref = getReferenceCard();
        if (ref) ro.observe(ref);
    }

    // Re-sync whenever the app navigates back into Overview, since the
    // reference card reports zero width while its view is hidden.
    if (typeof window.switchView === 'function') {
        const originalSwitchView = window.switchView;
        window.switchView = function (viewKey, opts) {
            const result = originalSwitchView.apply(this, arguments);
            requestSync();
            return result;
        };
    }

    requestSync();
})();

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
