// Profile panel logic — profile info, password, wallet, account actions
// Depends on auth.js for token access (SpilloramaAuth.storedToken)
(function () {
  'use strict';

  const TOKEN_KEY = 'spillorama.accessToken';
  const USER_KEY = 'spillorama.user';

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function getUser() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  }

  function saveUser(user) {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  async function apiFetch(path, options) {
    var token = getToken();
    if (!token) throw new Error('Ikke innlogget');
    var opts = options || {};
    var headers = Object.assign({
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json'
    }, opts.headers || {});
    var res = await fetch(path, Object.assign({}, opts, { headers: headers }));
    var body = await res.json();
    if (!body.ok) throw new Error(body.error?.message || 'Noe gikk galt');
    return body.data;
  }

  var _walletId = null;

  function formatKr(value) {
    return new Intl.NumberFormat('nb-NO', {
      style: 'currency', currency: 'NOK',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function formatDate(value) {
    if (!value) return '--';
    var d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('nb-NO', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  // ── Profile info ──────────────────────────────────────────────────────

  function renderProfileInfo() {
    var user = getUser();
    var nameEl = document.getElementById('profile-display-name');
    var emailEl = document.getElementById('profile-display-email');
    var phoneEl = document.getElementById('profile-display-phone');
    if (nameEl) nameEl.textContent = (user?.displayName ? 'Kallenavn: ' + user.displayName : '--');
    if (emailEl) emailEl.textContent = user?.email || '--';
    if (phoneEl) phoneEl.textContent = user?.phone || '--';
  }

  function initProfileEdit() {
    var editBtn = document.getElementById('profile-edit-btn');
    var cancelBtn = document.getElementById('profile-cancel-btn');
    var display = document.getElementById('profile-info-display');
    var form = document.getElementById('profile-edit-form');

    if (editBtn) {
      editBtn.addEventListener('click', function () {
        var user = getUser();
        document.getElementById('profile-edit-name').value = user?.displayName || '';
        document.getElementById('profile-edit-email').value = user?.email || '';
        document.getElementById('profile-edit-phone').value = user?.phone || '';
        display.hidden = true;
        form.hidden = false;
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        display.hidden = false;
        form.hidden = true;
        var errEl = document.getElementById('profile-edit-error');
        if (errEl) errEl.hidden = true;
      });
    }

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var saveBtn = document.getElementById('profile-save-btn');
        var errEl = document.getElementById('profile-edit-error');
        if (errEl) errEl.hidden = true;
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Lagrer...'; }

        var newName = document.getElementById('profile-edit-name').value.trim();
        if (!newName || newName.length < 3) {
          if (errEl) { errEl.textContent = 'Kallenavn må være minst 3 tegn'; errEl.hidden = false; }
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Lagre'; }
          return;
        }

        try {
          var updated = await apiFetch('/api/auth/me', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: newName,
              email: document.getElementById('profile-edit-email').value.trim(),
              phone: document.getElementById('profile-edit-phone').value.trim()
            })
          });
          // Update stored user
          var user = getUser() || {};
          user.displayName = updated.displayName;
          user.email = updated.email;
          user.phone = updated.phone;
          saveUser(user);
          renderProfileInfo();
          // Update lobby user name
          var lobbyName = document.getElementById('lobby-user-name');
          if (lobbyName) lobbyName.textContent = updated.displayName || '';
          display.hidden = false;
          form.hidden = true;
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || 'Kunne ikke oppdatere profil';
            errEl.hidden = false;
          }
        } finally {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Lagre'; }
        }
      });
    }
  }

  // ── Change password ───────────────────────────────────────────────────

  function initPasswordChange() {
    var form = document.getElementById('profile-password-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var submitBtn = document.getElementById('profile-pw-submit');
      var errEl = document.getElementById('profile-pw-error');
      var successEl = document.getElementById('profile-pw-success');
      if (errEl) errEl.hidden = true;
      if (successEl) successEl.hidden = true;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Bytter...'; }

      var currentPw = document.getElementById('profile-current-pw').value;
      var newPw = document.getElementById('profile-new-pw').value;

      if (!currentPw || !newPw) {
        if (errEl) { errEl.textContent = 'Begge feltene er påkrevd'; errEl.hidden = false; }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Bytt passord'; }
        return;
      }

      try {
        await apiFetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
        });
        form.reset();
        if (successEl) { successEl.textContent = 'Passord endret!'; successEl.hidden = false; }
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Kunne ikke bytte passord';
          errEl.hidden = false;
        }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Bytt passord'; }
      }
    });
  }

  // ── Wallet ────────────────────────────────────────────────────────────

  async function loadWallet() {
    var balanceEl = document.getElementById('profile-wallet-balance');
    var txEl = document.getElementById('profile-transactions');

    try {
      var [wallet, transactions] = await Promise.all([
        apiFetch('/api/wallet/me'),
        apiFetch('/api/wallet/me/transactions?limit=10')
      ]);

      if (wallet?.account) {
        _walletId = wallet.account.id || null;
      }
      if (balanceEl && wallet?.account) {
        balanceEl.textContent = formatKr(wallet.account.balance);
      }
      // Also update lobby + game-bar header chips (saldo + gevinst).
      // Bruk available-felt så chip-en viser tilgjengelig saldo (etter
      // pre-round-reservasjoner) — `balance` viser fortsatt brutto i
      // selve "Lommebok"-detalj-elementet over.
      if (wallet?.account) {
        var depositAmt = (typeof wallet.account.availableDeposit === 'number')
          ? wallet.account.availableDeposit
          : (typeof wallet.account.depositBalance === 'number')
            ? wallet.account.depositBalance
            : wallet.account.balance;
        var winningsAmt = (typeof wallet.account.availableWinnings === 'number')
          ? wallet.account.availableWinnings
          : (typeof wallet.account.winningsBalance === 'number')
            ? wallet.account.winningsBalance
            : 0;
        var depositFormatted = formatKr(depositAmt);
        var winningsFormatted = formatKr(winningsAmt);
        var headerTargets = [
          ['#lobby-balance .lobby-chip-value', depositFormatted],
          ['#game-bar-balance .lobby-chip-value', depositFormatted],
          ['#lobby-winnings .lobby-chip-value', winningsFormatted],
          ['#game-bar-winnings .lobby-chip-value', winningsFormatted]
        ];
        for (var i = 0; i < headerTargets.length; i++) {
          var el = document.querySelector(headerTargets[i][0]);
          if (el) el.textContent = headerTargets[i][1];
        }
      }

      if (txEl) {
        if (!transactions || transactions.length === 0) {
          txEl.innerHTML = '<div class="profile-section-note">Ingen transaksjoner ennå.</div>';
        } else {
          var rows = transactions.map(function (tx) {
            var isCredit = tx.type === 'CREDIT' || tx.type === 'credit';
            var cls = isCredit ? 'profile-tx-positive' : 'profile-tx-negative';
            var sign = isCredit ? '+' : '-';
            return '<tr>' +
              '<td>' + formatDate(tx.createdAt || tx.created_at) + '</td>' +
              '<td>' + escapeHtml(tx.description || tx.type || '') + '</td>' +
              '<td class="' + cls + '">' + sign + formatKr(Math.abs(tx.amount || 0)) + '</td>' +
              '</tr>';
          }).join('');
          txEl.innerHTML = '<table class="profile-tx-table">' +
            '<thead><tr><th>Dato</th><th>Beskrivelse</th><th>Beløp</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
        }
      }
    } catch (err) {
      if (txEl) txEl.innerHTML = '<div class="profile-section-note">' + escapeHtml(err.message) + '</div>';
    }
  }

  function initWallet() {
    var depositBtn = document.getElementById('profile-deposit-btn');
    var depositWrap = document.getElementById('profile-deposit-form-wrap');
    var depositForm = document.getElementById('profile-deposit-form');

    if (depositBtn && depositWrap) {
      depositBtn.addEventListener('click', function () {
        depositWrap.hidden = !depositWrap.hidden;
      });
    }

    if (depositForm) {
      depositForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var errEl = document.getElementById('profile-deposit-error');
        if (errEl) errEl.hidden = true;
        var amount = Number(document.getElementById('profile-deposit-amount').value);
        if (!amount || amount < 10) {
          if (errEl) { errEl.textContent = 'Minimumsbeløp er 10 kr'; errEl.hidden = false; }
          return;
        }

        try {
          await apiFetch('/api/wallet/me/topup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amount, provider: 'manual' })
          });
          depositWrap.hidden = true;
          depositForm.reset();
          loadWallet();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message || 'Innskudd feilet'; errEl.hidden = false; }
        }
      });
    }
  }

  // ── Withdrawal ───────────────────────────────────────────────────────

  function initWithdrawal() {
    var withdrawBtn = document.getElementById('profile-withdraw-btn');
    var withdrawWrap = document.getElementById('profile-withdraw-form-wrap');
    var withdrawForm = document.getElementById('profile-withdraw-form');
    var successEl = document.getElementById('profile-withdraw-success');

    if (withdrawBtn && withdrawWrap) {
      withdrawBtn.addEventListener('click', function () {
        withdrawWrap.hidden = !withdrawWrap.hidden;
        if (successEl) successEl.hidden = true;
      });
    }

    if (withdrawForm) {
      withdrawForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var errEl = document.getElementById('profile-withdraw-error');
        if (errEl) errEl.hidden = true;
        if (successEl) successEl.hidden = true;

        if (!_walletId) {
          if (errEl) { errEl.textContent = 'Wallet ikke lastet — prøv igjen'; errEl.hidden = false; }
          return;
        }
        var amount = Number(document.getElementById('profile-withdraw-amount').value);
        if (!amount || amount < 10) {
          if (errEl) { errEl.textContent = 'Minimumsbeløp er 10 kr'; errEl.hidden = false; }
          return;
        }
        var submitBtn = withdrawForm.querySelector('[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Tar ut...'; }
        try {
          await apiFetch('/api/wallets/' + _walletId + '/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amount, reason: 'Uttak til bank' })
          });
          withdrawWrap.hidden = true;
          withdrawForm.reset();
          if (successEl) { successEl.textContent = formatKr(amount) + ' er tatt ut.'; successEl.hidden = false; }
          loadWallet();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message || 'Uttak feilet'; errEl.hidden = false; }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Ta ut'; }
        }
      });
    }
  }

  // ── KYC ──────────────────────────────────────────────────────────────

  function initKyc() {
    var statusEl = document.getElementById('profile-kyc-status');
    var formWrap = document.getElementById('profile-kyc-form-wrap');
    var kycForm = document.getElementById('profile-kyc-form');
    if (!statusEl) return;

    apiFetch('/api/kyc/me').then(function (kyc) {
      if (kyc && kyc.verified) {
        statusEl.textContent = 'Verifisert ✓';
        if (formWrap) formWrap.hidden = true;
      } else {
        statusEl.textContent = 'Ikke verifisert';
        if (formWrap) formWrap.hidden = false;
      }
    }).catch(function () {
      statusEl.textContent = 'Ukjent status';
      if (formWrap) formWrap.hidden = false;
    });

    if (kycForm) {
      kycForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var errEl = document.getElementById('profile-kyc-error');
        var successEl = document.getElementById('profile-kyc-success');
        if (errEl) errEl.hidden = true;
        if (successEl) successEl.hidden = true;
        var submitBtn = kycForm.querySelector('[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verifiserer...'; }
        var birthDate = document.getElementById('profile-kyc-dob').value;
        var nationalId = document.getElementById('profile-kyc-national-id').value.trim();
        try {
          await apiFetch('/api/kyc/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ birthDate: birthDate, nationalId: nationalId || undefined })
          });
          if (statusEl) statusEl.textContent = 'Verifisert ✓';
          if (formWrap) formWrap.hidden = true;
          if (successEl) { successEl.textContent = 'Identitet verifisert!'; successEl.hidden = false; }
        } catch (err) {
          if (errEl) { errEl.textContent = err.message || 'Verifisering feilet'; errEl.hidden = false; }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Verifiser'; }
        }
      });
    }
  }

  // ── Account actions ───────────────────────────────────────────────────

  function initAccountActions() {
    // Timed pause
    var pauseBtn = document.getElementById('profile-pause-btn');
    var pauseWrap = document.getElementById('profile-pause-form-wrap');
    var pauseForm = document.getElementById('profile-pause-form');
    var pauseCancel = document.getElementById('profile-pause-cancel');

    if (pauseBtn && pauseWrap) {
      pauseBtn.addEventListener('click', function () {
        pauseWrap.hidden = !pauseWrap.hidden;
      });
    }
    if (pauseCancel && pauseWrap) {
      pauseCancel.addEventListener('click', function () {
        pauseWrap.hidden = true;
      });
    }

    if (pauseForm) {
      pauseForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var errEl = document.getElementById('profile-pause-error');
        if (errEl) errEl.hidden = true;
        var duration = Number(document.getElementById('profile-pause-duration').value);

        try {
          await apiFetch('/api/wallet/me/timed-pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ durationMinutes: duration })
          });
          pauseWrap.hidden = true;
          pauseBtn.textContent = 'Pause aktivert';
          pauseBtn.disabled = true;
          // Refresh lobby compliance
          if (window.SpilloramaLobby) window.SpilloramaLobby.load();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message || 'Kunne ikke aktivere pause'; errEl.hidden = false; }
        }
      });
    }

    // Self-exclusion
    var selfExcludeBtn = document.getElementById('profile-self-exclude-btn');
    if (selfExcludeBtn) {
      selfExcludeBtn.addEventListener('click', async function () {
        if (!confirm('Er du sikker på at du vil stenge deg ute fra all spilling i minimum 12 måneder? Dette kan ikke angres umiddelbart.')) {
          return;
        }
        try {
          await apiFetch('/api/wallet/me/self-exclusion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          selfExcludeBtn.textContent = 'Selvutestengt';
          selfExcludeBtn.disabled = true;
          if (window.SpilloramaLobby) window.SpilloramaLobby.load();
        } catch (err) {
          alert(err.message || 'Kunne ikke aktivere selvutestengelse');
        }
      });
    }

    // Delete account
    var deleteBtn = document.getElementById('profile-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async function () {
        if (!confirm('Er du helt sikker? Kontoen din og alle data slettes permanent.')) {
          return;
        }
        try {
          await apiFetch('/api/auth/me', { method: 'DELETE' });
          sessionStorage.clear();
          window.location.reload();
        } catch (err) {
          alert(err.message || 'Kunne ikke slette konto');
        }
      });
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────

  function initProfile() {
    renderProfileInfo();
    initProfileEdit();
    initPasswordChange();
    initPin();
    initWallet();
    initWithdrawal();
    initKyc();
    initAccountActions();
    refreshPinStatus();
  }

  // ── REQ-130 (PDF 9 Frontend CR): PIN-management ────────────────────────

  async function refreshPinStatus() {
    var statusEl = document.getElementById('profile-pin-status');
    var setupForm = document.getElementById('profile-pin-setup-form');
    var disableForm = document.getElementById('profile-pin-disable-form');
    if (!statusEl) return;
    try {
      var status = await apiFetch('/api/auth/pin/status');
      if (!status || !status.configured) {
        statusEl.textContent = 'PIN-innlogging er ikke tilgjengelig på denne serveren.';
        if (setupForm) setupForm.hidden = true;
        if (disableForm) disableForm.hidden = true;
        return;
      }
      if (status.locked) {
        statusEl.textContent = 'PIN er låst — kontakt support for å låse opp.';
        if (setupForm) setupForm.hidden = true;
        if (disableForm) disableForm.hidden = true;
      } else if (status.enabled) {
        statusEl.textContent = 'PIN er aktivert.';
        if (setupForm) setupForm.hidden = true;
        if (disableForm) disableForm.hidden = false;
      } else {
        statusEl.textContent = 'PIN er ikke aktivert.';
        if (setupForm) setupForm.hidden = false;
        if (disableForm) disableForm.hidden = true;
      }
    } catch (err) {
      statusEl.textContent = 'Kunne ikke lese PIN-status.';
    }
  }

  function initPin() {
    var setupForm = document.getElementById('profile-pin-setup-form');
    var disableForm = document.getElementById('profile-pin-disable-form');

    if (setupForm) {
      setupForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var input = document.getElementById('profile-pin-input');
        var errEl = document.getElementById('profile-pin-error');
        var successEl = document.getElementById('profile-pin-success');
        var submitBtn = document.getElementById('profile-pin-setup-submit');
        if (errEl) errEl.hidden = true;
        if (successEl) successEl.hidden = true;
        var pin = (input && input.value || '').trim();
        if (!/^\d{4,6}$/.test(pin)) {
          if (errEl) { errEl.textContent = 'PIN må være 4-6 siffer.'; errEl.hidden = false; }
          return;
        }
        if (submitBtn) { submitBtn.disabled = true; }
        try {
          await apiFetch('/api/auth/pin/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pin })
          });
          if (input) input.value = '';
          if (successEl) { successEl.textContent = 'PIN aktivert.'; successEl.hidden = false; }
          await refreshPinStatus();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message || 'Kunne ikke aktivere PIN'; errEl.hidden = false; }
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    if (disableForm) {
      disableForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var pwInput = document.getElementById('profile-pin-disable-pw');
        var errEl = document.getElementById('profile-pin-error');
        var successEl = document.getElementById('profile-pin-success');
        var submitBtn = document.getElementById('profile-pin-disable-submit');
        if (errEl) errEl.hidden = true;
        if (successEl) successEl.hidden = true;
        var pw = (pwInput && pwInput.value) || '';
        if (!pw) {
          if (errEl) { errEl.textContent = 'Passord er påkrevd.'; errEl.hidden = false; }
          return;
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
          await apiFetch('/api/auth/pin/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
          });
          if (pwInput) pwInput.value = '';
          if (successEl) { successEl.textContent = 'PIN fjernet.'; successEl.hidden = false; }
          await refreshPinStatus();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message || 'Kunne ikke fjerne PIN'; errEl.hidden = false; }
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  // Load wallet data when profile panel opens
  var profileOverlay = document.getElementById('profile-overlay');
  if (profileOverlay) {
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'class' && profileOverlay.classList.contains('is-open')) {
          renderProfileInfo();
          loadWallet();
        }
      });
    });
    observer.observe(profileOverlay, { attributes: true });
  }

  window.SpilloramaProfile = {
    init: initProfile,
    refresh: function () {
      renderProfileInfo();
      loadWallet();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProfile);
  } else {
    initProfile();
  }
})();
