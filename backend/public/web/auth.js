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
    saveSession(data.accessToken, data.user, data.expiresAt);
    return data;
  }

  async function registerRequest(displayName, email, password, phone) {
    const payload = { displayName, email, password };
    if (phone) payload.phone = phone;
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
    // Hide lobby and Unity
    const lobbyScreen = document.getElementById('lobby-screen');
    if (lobbyScreen) lobbyScreen.classList.remove('is-visible');
    const unityContainer = document.getElementById('unity-container');
    if (unityContainer) unityContainer.style.display = 'none';
    const fab = document.getElementById('spillvett-fab');
    if (fab) fab.hidden = true;
  }

  function showLobby(user) {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('is-visible');
    // Show lobby screen (not Unity — Unity loads on game click)
    const lobbyScreen = document.getElementById('lobby-screen');
    if (lobbyScreen) lobbyScreen.classList.add('is-visible');
    const fab = document.getElementById('spillvett-fab');
    if (fab) fab.hidden = false;
    // Init and load lobby data
    if (window.SpilloramaLobby) {
      window.SpilloramaLobby.init();
      window.SpilloramaLobby.load();
    }
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
    // Phase 1: push new JWT to Unity if it is already running (e.g. after token refresh)
    if (typeof window.ProvideShellToken === 'function') {
      window.ProvideShellToken();
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

    // ── Login form ────────────────────────────────────────────────────
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const email = document.getElementById('login-email')?.value?.trim() || '';
        const password = document.getElementById('login-password')?.value || '';
        setSubmitting(true);
        try {
          const data = await loginRequest(email, password);
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
      const step1 = document.getElementById('register-step-1');
      const step2 = document.getElementById('register-step-2');
      const step3 = document.getElementById('register-step-3');
      const next1 = document.getElementById('register-next-1');
      const next2 = document.getElementById('register-next-2');
      const back2 = document.getElementById('register-back-2');
      const back3 = document.getElementById('register-back-3');
      const bankIdBtn = document.getElementById('register-bankid-btn');
      const pepRadios = document.querySelectorAll('input[name="register-pep"]');

      function showStep(n) {
        if (step1) step1.hidden = n !== 1;
        if (step2) step2.hidden = n !== 2;
        if (step3) step3.hidden = n !== 3;
      }

      // Step navigation
      if (next1) next1.addEventListener('click', function () {
        const fn = document.getElementById('register-firstname')?.value?.trim();
        const em = document.getElementById('register-email')?.value?.trim();
        const pw = document.getElementById('register-password')?.value;
        if (!fn) { alert('Fornavn er påkrevd'); return; }
        if (!em) { alert('E-post er påkrevd'); return; }
        if (!pw || pw.length < 6) { alert('Passord må være minst 6 tegn'); return; }
        showStep(2);
      });
      if (next2) next2.addEventListener('click', function () { showStep(3); loadHallsForRegister(); });
      if (back2) back2.addEventListener('click', function () { showStep(1); });
      if (back3) back3.addEventListener('click', function () { showStep(2); });

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
        const displayName = [firstName, lastName].filter(Boolean).join(' ');
        const email = document.getElementById('register-email')?.value?.trim() || '';
        const phone = document.getElementById('register-phone')?.value?.trim() || '';
        const password = document.getElementById('register-password')?.value || '';
        const termsChecked = document.getElementById('register-terms')?.checked;
        const submitBtn = document.getElementById('register-submit');
        const errorEl = document.getElementById('register-error');

        if (!displayName) {
          if (errorEl) { errorEl.textContent = 'Fornavn er påkrevd'; errorEl.hidden = false; }
          return;
        }
        if (!termsChecked) {
          if (errorEl) { errorEl.textContent = 'Du må godta vilkårene'; errorEl.hidden = false; }
          return;
        }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Oppretter konto...'; }

        try {
          const data = await registerRequest(displayName, email, password, phone);
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
