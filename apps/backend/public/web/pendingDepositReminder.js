// REQ-137: Pending-deposit reminder
//
// Spiller starter et Swedbank Pay deposit (Vipps/kort) men fullfører ikke i
// checkout. Når de kommer tilbake til lobbyen pinger vi
// GET /api/payments/pending-deposit; finnes det åpne intents (yngre enn 24t)
// viser vi en popup: "Du har et påbegynt innskudd på X kr. Vil du
// fullføre i Swedbank?".
//
// Popup vises ved mount og hvert 5. minutt så lenge intent er åpen. Klient
// styrer intervallet — server-side `last_reminded_at` brukes kun til audit.
(function () {
  'use strict';

  var TOKEN_KEY = 'spillorama.accessToken';
  var REMINDER_INTERVAL_MS = 5 * 60 * 1000; // 5 min
  var DISMISS_KEY = 'spillorama.depositReminderDismissedAt';
  var DISMISS_TTL_MS = 5 * 60 * 1000; // bruker dismisser → 5 min stille

  var state = {
    timer: null,
    inFlight: false,
    activeIntentId: null,
    rendered: false
  };

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function formatKr(value) {
    return new Intl.NumberFormat('nb-NO', {
      style: 'currency',
      currency: 'NOK',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  async function apiFetch(path, opts) {
    var token = getToken();
    if (!token) return null;
    var init = opts || {};
    var headers = Object.assign(
      {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      },
      init.headers || {}
    );
    try {
      var res = await fetch(path, {
        method: init.method || 'GET',
        headers: headers,
        body: init.body
      });
      var body = await res.json().catch(function () { return null; });
      if (!body || body.ok !== true) return null;
      return body.data;
    } catch (err) {
      return null;
    }
  }

  function isDismissedRecently() {
    try {
      var raw = sessionStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      var ts = Number(raw);
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts < DISMISS_TTL_MS;
    } catch (err) {
      return false;
    }
  }

  function markDismissed() {
    try {
      sessionStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (err) {
      /* ignore quota errors */
    }
  }

  function clearDismissed() {
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function ensureModal() {
    var existing = document.getElementById('pending-deposit-modal');
    if (existing) return existing;

    var modal = document.createElement('div');
    modal.id = 'pending-deposit-modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pending-deposit-title');
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,0.55)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'z-index:9000',
      'padding:24px'
    ].join(';');

    modal.innerHTML = [
      '<div class="pending-deposit-card" style="background:#1f2937;color:#f9fafb;border-radius:14px;max-width:420px;width:100%;padding:28px 26px;box-shadow:0 18px 48px rgba(0,0,0,0.45);">',
      '  <div style="font-size:36px;text-align:center;margin-bottom:8px;">💳</div>',
      '  <h2 id="pending-deposit-title" style="margin:0 0 12px;font-size:20px;text-align:center;color:#fbbf24;">Påbegynt innskudd</h2>',
      '  <p id="pending-deposit-message" style="margin:0 0 22px;font-size:15px;line-height:1.5;text-align:center;color:#e5e7eb;">Du har et påbegynt innskudd. Vil du fullføre i Swedbank?</p>',
      '  <div style="display:flex;gap:10px;flex-direction:column;">',
      '    <button id="pending-deposit-resume-btn" type="button" style="background:#10b981;color:#04221b;border:none;padding:12px 18px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">Fullfør</button>',
      '    <button id="pending-deposit-cancel-btn" type="button" style="background:transparent;color:#cbd5e1;border:1px solid #475569;padding:11px 18px;border-radius:8px;font-size:15px;cursor:pointer;">Avbryt</button>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(modal);

    modal.querySelector('#pending-deposit-resume-btn').addEventListener('click', function () {
      handleResume();
    });
    modal.querySelector('#pending-deposit-cancel-btn').addEventListener('click', function () {
      handleDismiss();
    });

    return modal;
  }

  function showModal(intent) {
    var modal = ensureModal();
    var msg = modal.querySelector('#pending-deposit-message');
    if (msg) {
      msg.textContent =
        'Du har et påbegynt innskudd på ' +
        formatKr(intent.amountMajor) +
        ' kr. Vil du fullføre i Swedbank?';
    }
    modal.style.display = 'flex';
    state.rendered = true;
    state.activeIntentId = intent.id;
    // Server-side audit-stamp — fire-and-forget, blokkerer ikke render
    if (intent && intent.id) {
      apiFetch(
        '/api/payments/pending-deposit/' + encodeURIComponent(intent.id) + '/reminded',
        { method: 'POST' }
      );
    }
  }

  function hideModal() {
    var modal = document.getElementById('pending-deposit-modal');
    if (modal) modal.style.display = 'none';
    state.rendered = false;
  }

  function handleResume() {
    var modal = document.getElementById('pending-deposit-modal');
    var intentId = state.activeIntentId;
    hideModal();
    clearDismissed();
    if (!intentId) return;
    // Hent intent på nytt for å få fersk redirectUrl (kan ha endret seg)
    apiFetch('/api/payments/swedbank/intents/' + encodeURIComponent(intentId)).then(function (intent) {
      var url = intent && (intent.redirectUrl || intent.viewUrl);
      if (url) {
        window.location.href = url;
      }
    });
  }

  function handleDismiss() {
    markDismissed();
    hideModal();
  }

  async function checkPending() {
    if (state.inFlight) return;
    if (!getToken()) return;
    if (state.rendered) return; // allerede synlig, ikke spam
    if (isDismissedRecently()) return;

    state.inFlight = true;
    try {
      var data = await apiFetch('/api/payments/pending-deposit');
      var list = (data && Array.isArray(data.intents)) ? data.intents : [];
      if (!list.length) {
        return;
      }
      // Nyeste først (server returnerer DESC) — tar den med høyest beløp
      // hvis samme tid; ellers første rad. Holdes enkelt: bare første.
      showModal(list[0]);
    } finally {
      state.inFlight = false;
    }
  }

  function start() {
    // Kjør én gang ved oppstart, deretter hvert 5. minutt
    checkPending();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(checkPending, REMINDER_INTERVAL_MS);
  }

  function stop() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    hideModal();
  }

  // ── Public API ─────────────────────────────────────────────────────────
  window.SpilloramaPendingDepositReminder = {
    start: start,
    stop: stop,
    checkNow: checkPending
  };

  // Auto-start når DOM er klar OG bruker er innlogget. Auth.js trigger en
  // login-event vi kan henge oss på; ellers fallback til DOMContentLoaded.
  function maybeAutoStart() {
    if (getToken()) {
      start();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoStart);
  } else {
    maybeAutoStart();
  }

  // Hvis lobby-init kalles etter login (auth.js), pinger den
  // SpilloramaLobby.init() — vi henger oss på via window-event som
  // auth.js dispatcher (eller poller token-key som fallback).
  window.addEventListener('spillorama:logged-in', start);
  window.addEventListener('spillorama:logged-out', stop);
})();
