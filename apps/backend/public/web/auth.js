// BIN-262: Web Shell Auth — login, session restore, logout
// Token from POST /api/auth/login is stored in sessionStorage and fed to spillvett.js.
(function () {
  const TOKEN_KEY = 'spillorama.accessToken';
  const USER_KEY = 'spillorama.user';
  const EXPIRES_KEY = 'spillorama.expiresAt';

  // BIN-279: Proactive refresh — renew token 5 minutes before expiry
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  let refreshTimer = null;

  // ── Helpers ─────────────────────────────────────────────────────────────

  function storedToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function storedUser() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  }

  function saveSession(token, user, expiresAt) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    if (expiresAt) sessionStorage.setItem(EXPIRES_KEY, expiresAt);
    scheduleProactiveRefresh();
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
    // BIN-270: socketUser/socketPass removed — AIS socket no longer used
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  }

  function scheduleProactiveRefresh() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    const expiresAt = sessionStorage.getItem(EXPIRES_KEY);
    if (!expiresAt) return;
    const expiresMs = new Date(expiresAt).getTime();
    const refreshAt = expiresMs - REFRESH_MARGIN_MS;
    const delay = refreshAt - Date.now();
    if (delay <= 0) return; // Already past refresh window
    refreshTimer = setTimeout(async function () {
      refreshTimer = null;
      const newToken = await tryRefreshToken();
      if (!newToken) {
        showLogin('Sesjonen har utløpt. Logg inn på nytt.');
      }
    }, Math.min(delay, 2147483647)); // Cap at max setTimeout value
  }

  // ── Image compression ───────────────────────────────────────────────────

  function compressImageToBase64(file, maxPx, quality, callback) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function setupPhotoInput(inputId, previewId, stateKey, store) {
    var input = document.getElementById(inputId);
    var preview = document.getElementById(previewId);
    if (!input || !preview) return;
    input.addEventListener('change', function () {
      var file = input.files[0];
      if (!file) return;
      compressImageToBase64(file, 1024, 0.7, function (b64) {
        store[stateKey] = b64;
        preview.classList.add('has-image');
        preview.innerHTML = '<img src="' + b64 + '" alt="ID foto">';
      });
    });
  }

  // ── API ─────────────────────────────────────────────────────────────────

  async function apiFetch(path, options) {
    const res = await fetch(path, options);
    const body = await res.json();
    if (!body.ok) {
      throw new Error(body.error?.message || 'Noe gikk galt');
    }
    return body.data;
  }

  // BIN-279: Token refresh — attempt to get a new token when current one expires
  let refreshInFlight = null;

  async function tryRefreshToken() {
    const token = storedToken();
    if (!token) return null;
    try {
      const data = await apiFetch('/api/auth/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      saveSession(data.accessToken, data.user, data.expiresAt);
      sessionStorage.setItem('spillvett.token', data.accessToken);
      notifySpillvett(data.accessToken);
      return data.accessToken;
    } catch {
      clearSession();
      return null;
    }
  }

  /**
   * Authenticated fetch with auto-refresh on 401.
   * Use this for all authenticated API calls outside of auth flows.
   */
  async function authenticatedFetch(path, options) {
    const token = storedToken();
    if (!token) throw new Error('Ikke innlogget');

    const headers = Object.assign({}, options?.headers || {}, {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    });
    const res = await fetch(path, Object.assign({}, options, { headers: headers }));

    if (res.status === 401) {
      // Deduplicate concurrent refresh attempts
      if (!refreshInFlight) {
        refreshInFlight = tryRefreshToken().finally(function () { refreshInFlight = null; });
      }
      const newToken = await refreshInFlight;
      if (!newToken) {
        showLogin('Sesjonen har utløpt. Logg inn på nytt.');
        throw new Error('Sesjonen har utløpt');
      }
      // Retry with new token
      const retryHeaders = Object.assign({}, options?.headers || {}, {
        Authorization: 'Bearer ' + newToken,
        Accept: 'application/json'
      });
      const retryRes = await fetch(path, Object.assign({}, options, { headers: retryHeaders }));
      const retryBody = await retryRes.json();
      if (!retryBody.ok) throw new Error(retryBody.error?.message || 'Feil ved henting av data');
      return retryBody.data;
    }

    const body = await res.json();
    if (!body.ok) throw new Error(body.error?.message || 'Feil ved henting av data');
    return body.data;
  }

  async function restoreSession() {
    const token = storedToken();
    if (!token) return null;
    try {
      const user = await apiFetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      scheduleProactiveRefresh(); // BIN-279: restart refresh timer on page reload
      return { token, user };
    } catch {
      clearSession();
      return null;
    }
  }

  async function loginRequest(email, password) {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    // REQ-129: hvis 2FA er aktivert returnerer backend en challenge i stedet
    // for full session. Kalleren håndterer challenge-flyten via twoFALogin().
    if (data && data.requires2FA === true) {
      return { requires2FA: true, challengeId: data.challengeId, challengeExpiresAt: data.challengeExpiresAt };
    }
    saveSession(data.accessToken, data.user, data.expiresAt);
    return data;
  }

  async function twoFALoginRequest(challengeId, code) {
    const data = await apiFetch('/api/auth/2fa/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challengeId, code: code })
    });
    saveSession(data.accessToken, data.user, data.expiresAt);
    return data;
  }

  // REQ-130 (PDF 9 Frontend CR): Phone+PIN-login.
  async function loginPhoneRequest(phone, pin) {
    const data = await apiFetch('/api/auth/login-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, pin })
    });
    saveSession(data.accessToken, data.user, data.expiresAt);
    return data;
  }

  async function registerRequest(displayName, surname, email, password, phone, birthDate, complianceData) {
    const payload = { displayName, surname, email, password, birthDate };
    if (phone) payload.phone = phone;
    if (complianceData) payload.complianceData = complianceData;
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    saveSession(data.accessToken, data.user, data.expiresAt);
    return data;
  }

  function logoutRequest(token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
  }

  // ── DOM ─────────────────────────────────────────────────────────────────

  function showLogin(errorMsg) {
    const overlay = document.getElementById('login-overlay');
    const error = document.getElementById('login-error');
    if (overlay) overlay.classList.add('is-visible');
    if (error) {
      error.textContent = errorMsg || '';
      error.hidden = !errorMsg;
    }
    // Hide lobby and any active game surface
    const lobbyScreen = document.getElementById('lobby-screen');
    if (lobbyScreen) lobbyScreen.classList.remove('is-visible');
    const fab = document.getElementById('spillvett-fab');
    if (fab) fab.hidden = true;
    // REQ-137: stopp deposit-reminder ved logout/utgått sesjon
    try {
      window.dispatchEvent(new Event('spillorama:logged-out'));
    } catch (err) { /* ignore */ }
  }

  function showLobby(user) {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('is-visible');
    // Show lobby screen — games are loaded on demand when tile is clicked.
    const lobbyScreen = document.getElementById('lobby-screen');
    if (lobbyScreen) lobbyScreen.classList.add('is-visible');
    const fab = document.getElementById('spillvett-fab');
    if (fab) fab.hidden = false;
    // Init and load lobby data
    if (window.SpilloramaLobby) {
      window.SpilloramaLobby.init();
      window.SpilloramaLobby.load();
    }
    // REQ-137: la pending-deposit-reminder vite at vi nettopp logget inn,
    // så den kan starte sitt 5-min-intervall.
    try {
      window.dispatchEvent(new Event('spillorama:logged-in'));
    } catch (err) { /* ignore */ }
  }

  function setSubmitting(isSubmitting) {
    const btn = document.getElementById('login-submit');
    const emailField = document.getElementById('login-email');
    const passField = document.getElementById('login-password');
    if (btn) {
      btn.disabled = isSubmitting;
      btn.textContent = isSubmitting ? 'Logger inn…' : 'Logg inn';
    }
    if (emailField) emailField.disabled = isSubmitting;
    if (passField) passField.disabled = isSubmitting;
  }

  // ── Notify spillvett.js ──────────────────────────────────────────────────
  // spillvett.js reads spillvett.token from sessionStorage on init.
  // After web login, we also call window.SetShellToken so a running spillvett
  // instance picks up the new token without a full page reload.

  function notifySpillvett(token) {
    if (typeof window.SetShellToken === 'function') {
      window.SetShellToken(token);
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────

  async function init() {
    const form = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const logoutBtn = document.getElementById('shell-logout-btn');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    // ── Tab switching ─────────────────────────────────────────────────
    if (tabLogin && tabRegister && form && registerForm) {
      tabLogin.addEventListener('click', function () {
        tabLogin.classList.add('is-active');
        tabRegister.classList.remove('is-active');
        form.hidden = false;
        registerForm.hidden = true;
      });
      tabRegister.addEventListener('click', function () {
        tabRegister.classList.add('is-active');
        tabLogin.classList.remove('is-active');
        registerForm.hidden = false;
        form.hidden = true;
      });
    }

    // ── 2FA-form (REQ-129) ────────────────────────────────────────────
    var pendingChallengeId = null;
    var twoFAForm = document.getElementById('login-2fa-form');
    var twoFACodeInput = document.getElementById('login-2fa-code');
    var twoFAErrorEl = document.getElementById('login-2fa-error');
    var twoFABackLink = document.getElementById('login-2fa-back');

    function show2FAStep(challengeId) {
      pendingChallengeId = challengeId;
      if (form) form.hidden = true;
      if (twoFAForm) twoFAForm.hidden = false;
      if (twoFAErrorEl) twoFAErrorEl.hidden = true;
      if (twoFACodeInput) {
        twoFACodeInput.value = '';
        setTimeout(function () { twoFACodeInput.focus(); }, 0);
      }
    }

    function showCredentialsStep() {
      pendingChallengeId = null;
      if (form) form.hidden = false;
      if (twoFAForm) twoFAForm.hidden = true;
      if (twoFAErrorEl) twoFAErrorEl.hidden = true;
    }

    if (twoFABackLink) {
      twoFABackLink.addEventListener('click', function (e) {
        e.preventDefault();
        showCredentialsStep();
      });
    }
    if (twoFAForm) {
      twoFAForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!pendingChallengeId) { showCredentialsStep(); return; }
        var code = (twoFACodeInput?.value || '').trim();
        if (!code) {
          if (twoFAErrorEl) { twoFAErrorEl.textContent = 'Skriv inn koden'; twoFAErrorEl.hidden = false; }
          return;
        }
        var submitBtn = document.getElementById('login-2fa-submit');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Bekrefter…'; }
        try {
          var data = await twoFALoginRequest(pendingChallengeId, code);
          sessionStorage.setItem('spillvett.token', data.accessToken);
          notifySpillvett(data.accessToken);
          pendingChallengeId = null;
          showLobby(data.user);
          // Reset login overlay til credentials-step neste gang
          showCredentialsStep();
        } catch (err) {
          if (twoFAErrorEl) {
            twoFAErrorEl.textContent = err.message || 'Ugyldig kode';
            twoFAErrorEl.hidden = false;
          }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Bekreft'; }
        }
      });
    }

    // ── Login form ────────────────────────────────────────────────────
    // REQ-130 (PDF 9 Frontend CR): metode-velger E-post / Mobil. Toggle
    // synlighet av relaterte felter slik at HTML-validering kun gjelder
    // den aktive metoden.
    const methodSelect = document.getElementById('login-method');
    function applyLoginMethod() {
      const method = methodSelect?.value || 'email';
      document.querySelectorAll('[data-login-method]').forEach(function (el) {
        const elMethod = el.getAttribute('data-login-method');
        const visible = elMethod === method;
        el.hidden = !visible;
        // Toggle required attr på input-er.
        el.querySelectorAll('input').forEach(function (input) {
          if (visible) {
            input.setAttribute('required', 'required');
          } else {
            input.removeAttribute('required');
          }
        });
      });
    }
    if (methodSelect) {
      methodSelect.addEventListener('change', applyLoginMethod);
      applyLoginMethod();
    }

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const method = methodSelect?.value || 'email';
        setSubmitting(true);
        try {
          let data;
          if (method === 'phone') {
            const phone = document.getElementById('login-phone')?.value?.trim() || '';
            const pin = document.getElementById('login-pin')?.value?.trim() || '';
            if (!/^\d{4,6}$/.test(pin)) {
              throw new Error('PIN må være 4-6 siffer.');
            }
            data = await loginPhoneRequest(phone, pin);
          } else {
            const email = document.getElementById('login-email')?.value?.trim() || '';
            const password = document.getElementById('login-password')?.value || '';
            data = await loginRequest(email, password);
            // REQ-129: hvis 2FA kreves, vis 2FA-trinn i stedet for å logge inn.
            if (data && data.requires2FA === true) {
              show2FAStep(data.challengeId);
              return;
            }
          }
          sessionStorage.setItem('spillvett.token', data.accessToken);
          notifySpillvett(data.accessToken);
          showLobby(data.user);
        } catch (err) {
          showLogin(err.message || 'Innlogging feilet');
        } finally {
          setSubmitting(false);
        }
      });
    }

    // ── Register multi-step form ─────────────────────────────────────
    if (registerForm) {
      var photoStore = { front: null, back: null };
      setupPhotoInput('register-photo-front', 'photo-front-preview', 'front', photoStore);
      setupPhotoInput('register-photo-back', 'photo-back-preview', 'back', photoStore);
      const step1 = document.getElementById('register-step-1');
      const step2 = document.getElementById('register-step-2');
      const step3 = document.getElementById('register-step-3');
      const step4 = document.getElementById('register-step-4');
      const next1 = document.getElementById('register-next-1');
      const next2 = document.getElementById('register-next-2');
      const next3 = document.getElementById('register-next-3');
      const back2 = document.getElementById('register-back-2');
      const back3 = document.getElementById('register-back-3');
      const back4 = document.getElementById('register-back-4');
      const bankIdBtn = document.getElementById('register-bankid-btn');
      const pepRadios = document.querySelectorAll('input[name="register-pep"]');
      const norwayRadios = document.querySelectorAll('input[name="register-norway"]');

      function showStep(n) {
        if (step1) step1.hidden = n !== 1;
        if (step2) step2.hidden = n !== 2;
        if (step3) step3.hidden = n !== 3;
        if (step4) step4.hidden = n !== 4;
      }

      // Step navigation
      if (next1) next1.addEventListener('click', function () {
        const fn = document.getElementById('register-firstname')?.value?.trim();
        const ln = document.getElementById('register-lastname')?.value?.trim();
        const dob = document.getElementById('register-dob')?.value;
        const em = document.getElementById('register-email')?.value?.trim();
        const pw = document.getElementById('register-password')?.value;
        const errorEl = document.getElementById('register-error');
        function showErr(msg) {
          if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
          else alert(msg);
        }
        const confirmPw = document.getElementById('register-password-confirm')?.value || '';
        if (errorEl) errorEl.hidden = true;
        if (!fn) { showErr('Fornavn er påkrevd'); return; }
        if (!ln) { showErr('Etternavn er påkrevd'); return; }
        if (!dob) { showErr('Fødselsdato er påkrevd'); return; }
        const today = new Date();
        const birth = new Date(dob);
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        if (age < 18) { showErr('Du må være minst 18 år for å registrere deg.'); return; }
        if (!em) { showErr('E-post er påkrevd'); return; }
        if (!pw || pw.length < 8) { showErr('Passord må være minst 8 tegn'); return; }
        if (pw !== confirmPw) { showErr('Passordene er ikke like.'); return; }
        const kn = document.getElementById('register-nickname')?.value?.trim();
        if (!kn || kn.length < 3) { showErr('Kallenavn er påkrevd og må være minst 3 tegn.'); return; }
        showStep(2);
      });
      if (next2) next2.addEventListener('click', function () {
        var errorEl = document.getElementById('register-error');
        if (errorEl) errorEl.hidden = true;
        if (!photoStore.front || !photoStore.back) {
          if (errorEl) { errorEl.textContent = 'Last opp både forside og bakside av ID.'; errorEl.hidden = false; }
          return;
        }
        showStep(3);
      });
      if (next3) next3.addEventListener('click', function () {
        const errorEl = document.getElementById('register-error');
        function showErr(msg) {
          if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
        }
        if (errorEl) errorEl.hidden = true;
        const addr = document.getElementById('register-address')?.value?.trim();
        const zip = document.getElementById('register-zip')?.value?.trim();
        const city = document.getElementById('register-city')?.value?.trim();
        const inNorway = document.querySelector('input[name="register-norway"]:checked')?.value === 'yes';
        if (inNorway && (!addr || !zip || !city)) {
          showErr('Fyll ut gateadresse, postnummer og poststed.');
          return;
        }
        const anyIncome = ['income-salary','income-sale','income-stocks','income-social','income-gifts','income-other']
          .some(function(id) { return document.getElementById(id)?.checked; });
        if (!anyIncome) { showErr('Velg minst én inntektskilde.'); return; }
        showStep(4);
        loadHallsForRegister();
      });
      if (back2) back2.addEventListener('click', function () { showStep(1); });
      if (back3) back3.addEventListener('click', function () { showStep(2); });
      if (back4) back4.addEventListener('click', function () { showStep(3); });

      // BankID button
      if (bankIdBtn) {
        bankIdBtn.addEventListener('click', async function () {
          bankIdBtn.disabled = true;
          bankIdBtn.textContent = 'Åpner BankID...';
          const statusEl = document.getElementById('register-bankid-status');
          try {
            const result = await apiFetch('/api/auth/bankid/init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                firstName: document.getElementById('register-firstname')?.value?.trim(),
                lastName: document.getElementById('register-lastname')?.value?.trim(),
                dob: document.getElementById('register-dob')?.value
              })
            });
            if (result.authUrl) {
              window.open(result.authUrl, '_blank', 'width=600,height=700');
            }
            if (statusEl) {
              statusEl.className = 'register-verify-status is-pending';
              statusEl.textContent = 'BankID-vindu åpnet. Fullfør verifiseringen der og kom tilbake hit.';
              statusEl.hidden = false;
            }
          } catch (err) {
            if (statusEl) {
              statusEl.className = 'register-verify-status';
              statusEl.style.cssText = 'background:rgba(220,60,60,0.15);border:1px solid rgba(220,60,60,0.3);color:#ff9191';
              statusEl.textContent = err.message || 'BankID-verifisering feilet';
              statusEl.hidden = false;
            }
          } finally {
            bankIdBtn.disabled = false;
            bankIdBtn.textContent = 'Verifiser med BankID';
          }
        });
      }

      // PEP toggle
      pepRadios.forEach(function (radio) {
        radio.addEventListener('change', function () {
          const pepDetails = document.getElementById('register-pep-details');
          if (pepDetails) pepDetails.hidden = this.value !== 'yes';
        });
      });

      // Norway toggle — show/hide address fields
      norwayRadios.forEach(function (radio) {
        radio.addEventListener('change', function () {
          const fields = document.getElementById('register-address-fields');
          if (fields) fields.hidden = this.value !== 'yes';
        });
      });

      // Load halls for registration
      async function loadHallsForRegister() {
        const hallSelect = document.getElementById('register-hall');
        if (!hallSelect) return;
        try {
          const res = await fetch('/api/halls', { headers: { 'Accept': 'application/json' } });
          const body = await res.json();
          if (body.ok && Array.isArray(body.data)) {
            hallSelect.innerHTML = '';
            body.data.forEach(function (hall) {
              var opt = document.createElement('option');
              opt.value = hall.id;
              opt.textContent = hall.name;
              hallSelect.appendChild(opt);
            });
          }
        } catch { /* ignore */ }
      }

      // Submit registration
      registerForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const firstName = document.getElementById('register-firstname')?.value?.trim() || '';
        const lastName = document.getElementById('register-lastname')?.value?.trim() || '';
        const nickname = document.getElementById('register-nickname')?.value?.trim() || '';
        const birthDate = document.getElementById('register-dob')?.value || '';
        const email = document.getElementById('register-email')?.value?.trim() || '';
        const phone = document.getElementById('register-phone')?.value?.trim() || '';
        const password = document.getElementById('register-password')?.value || '';
        const termsChecked = document.getElementById('register-terms')?.checked;
        const submitBtn = document.getElementById('register-submit');
        const errorEl = document.getElementById('register-error');

        // Collect compliance data
        const isPep = document.querySelector('input[name="register-pep"]:checked')?.value === 'yes';
        const inNorway = document.querySelector('input[name="register-norway"]:checked')?.value === 'yes';
        const complianceData = {
          pep: {
            isPep,
            name: isPep ? (document.getElementById('register-pep-name')?.value?.trim() || '') : '',
            relation: isPep ? (document.getElementById('register-pep-relation')?.value?.trim() || '') : '',
            dob: isPep ? (document.getElementById('register-pep-dob')?.value || '') : ''
          },
          address: {
            inNorway,
            street: document.getElementById('register-address')?.value?.trim() || '',
            zip: document.getElementById('register-zip')?.value?.trim() || '',
            city: document.getElementById('register-city')?.value?.trim() || ''
          },
          photoFront: photoStore.front || '',
          photoBack: photoStore.back || '',
          incomeSources: {
            salary: !!(document.getElementById('income-salary')?.checked),
            sale: !!(document.getElementById('income-sale')?.checked),
            stocks: !!(document.getElementById('income-stocks')?.checked),
            social: !!(document.getElementById('income-social')?.checked),
            gifts: !!(document.getElementById('income-gifts')?.checked),
            other: !!(document.getElementById('income-other')?.checked)
          },
          hall: document.getElementById('register-hall')?.value || ''
        };

        if (!firstName) {
          if (errorEl) { errorEl.textContent = 'Fornavn er påkrevd'; errorEl.hidden = false; }
          return;
        }
        if (!termsChecked) {
          if (errorEl) { errorEl.textContent = 'Du må godta vilkårene'; errorEl.hidden = false; }
          return;
        }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Oppretter konto...'; }

        try {
          // Kallenavn brukes som spillernavn (displayName) — faller tilbake til fornavn
          const displayName = nickname || firstName;
          const data = await registerRequest(displayName, lastName, email, password, phone, birthDate, complianceData);
          sessionStorage.setItem('spillvett.token', data.accessToken);
          notifySpillvett(data.accessToken);
          showStep(1); // Reset form
          showLobby(data.user);
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || 'Registrering feilet';
            errorEl.hidden = false;
          }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Opprett konto'; }
        }
      });
    }

    // ── Logout ────────────────────────────────────────────────────────
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        const token = storedToken();
        clearSession();
        sessionStorage.removeItem('spillvett.token');
        logoutRequest(token);
        window.location.reload();
      });
    }

    // Try to restore existing session
    const session = await restoreSession();
    if (session) {
      sessionStorage.setItem('spillvett.token', session.token);
      notifySpillvett(session.token);
      showLobby(session.user);
    } else {
      showLogin();
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────
  window.SpilloramaAuth = { storedToken, storedUser, clearSession, authenticatedFetch };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
