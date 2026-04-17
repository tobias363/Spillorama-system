// panels.js — Game schedule, notifications, leaderboard, settings, withdraw, loss limits, forgot password
(function () {
  'use strict';

  var TOKEN_KEY = 'spillorama.accessToken';
  var USER_KEY = 'spillorama.user';

  function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function getUser() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); }
    catch (e) { return null; }
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
    if (!body.ok) throw new Error(body.error && body.error.message ? body.error.message : 'Noe gikk galt');
    return body.data;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  function formatKr(value) {
    return new Intl.NumberFormat('nb-NO', {
      style: 'currency', currency: 'NOK',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function formatDateTime(value) {
    if (!value) return '--';
    var d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('nb-NO', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. GAME SCHEDULE (Spillplan)
  // ═══════════════════════════════════════════════════════════════════

  async function loadGameSchedule() {
    var contentEl = document.getElementById('schedule-content');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="panel-loading">Laster spillplan...</div>';

    try {
      var rooms = await apiFetch('/api/rooms');
      if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
        contentEl.innerHTML = '<div class="panel-empty">Ingen kommende spill akkurat na.</div>';
        return;
      }

      var html = '<div class="schedule-list">';
      rooms.forEach(function (room) {
        var statusClass = room.status === 'PLAYING' ? 'is-live' :
                          room.status === 'OPEN' ? 'is-open' : 'is-ended';
        var statusText = room.status === 'PLAYING' ? 'Pagar' :
                         room.status === 'OPEN' ? 'Apent' :
                         room.status === 'ENDED' ? 'Avsluttet' : room.status;

        html += '<div class="schedule-item">' +
          '<div class="schedule-item-left">' +
            '<span class="schedule-status ' + statusClass + '">' + escapeHtml(statusText) + '</span>' +
            '<strong class="schedule-game-name">' + escapeHtml(room.gameName || room.gameSlug || 'Spill') + '</strong>' +
          '</div>' +
          '<div class="schedule-item-right">' +
            '<span class="schedule-room">' + escapeHtml(room.roomCode || '') + '</span>' +
            '<span class="schedule-players">' + (room.playerCount || 0) + ' spillere</span>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
      contentEl.innerHTML = html;
    } catch (err) {
      contentEl.innerHTML = '<div class="panel-error">' + escapeHtml(err.message) + '</div>';
    }
  }

  function openSchedulePanel() {
    document.getElementById('schedule-overlay').classList.add('is-visible');
    loadGameSchedule();
  }

  function closeSchedulePanel() {
    document.getElementById('schedule-overlay').classList.remove('is-visible');
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. NOTIFICATIONS (Varsler)
  // ═══════════════════════════════════════════════════════════════════

  var notifications = [];

  function openNotificationsPanel() {
    document.getElementById('notifications-overlay').classList.add('is-visible');
    renderNotifications();
  }

  function closeNotificationsPanel() {
    document.getElementById('notifications-overlay').classList.remove('is-visible');
  }

  function renderNotifications() {
    var contentEl = document.getElementById('notifications-content');
    if (!contentEl) return;

    // Update badge
    var badge = document.getElementById('notification-badge');
    if (badge) {
      var unread = notifications.filter(function (n) { return !n.read; }).length;
      badge.textContent = unread > 0 ? String(unread) : '';
      badge.hidden = unread === 0;
    }

    if (notifications.length === 0) {
      contentEl.innerHTML = '<div class="panel-empty">Ingen varsler.</div>';
      return;
    }

    var html = '<div class="notification-list">';
    notifications.forEach(function (n, i) {
      html += '<div class="notification-item' + (n.read ? '' : ' is-unread') + '" data-index="' + i + '">' +
        '<div class="notification-title">' + escapeHtml(n.title || 'Varsel') + '</div>' +
        '<div class="notification-message">' + escapeHtml(n.message || '') + '</div>' +
        '<div class="notification-time">' + formatDateTime(n.time) + '</div>' +
      '</div>';
    });
    html += '</div>';
    contentEl.innerHTML = html;
  }

  // Add notification from game events (called from Unity bridge or socket)
  window.AddShellNotification = function (title, message) {
    notifications.unshift({
      title: title,
      message: message,
      time: new Date().toISOString(),
      read: false
    });
    renderNotifications();
  };

  // ═══════════════════════════════════════════════════════════════════
  // 3. LEADERBOARD (Toppliste)
  // ═══════════════════════════════════════════════════════════════════

  async function loadLeaderboard() {
    var contentEl = document.getElementById('leaderboard-content');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="panel-loading">Laster toppliste...</div>';

    try {
      // Try to fetch leaderboard from API
      var data = await apiFetch('/api/leaderboard');
      if (!data || !Array.isArray(data) || data.length === 0) {
        contentEl.innerHTML = '<div class="panel-empty">Ingen toppliste tilgjengelig.</div>';
        return;
      }

      var html = '<table class="leaderboard-table">' +
        '<thead><tr><th>#</th><th>Spiller</th><th>Poeng</th></tr></thead><tbody>';
      data.forEach(function (entry, i) {
        html += '<tr' + (i < 3 ? ' class="is-top"' : '') + '>' +
          '<td class="leaderboard-rank">' + (i + 1) + '</td>' +
          '<td>' + escapeHtml(entry.nickname || entry.displayName || 'Spiller') + '</td>' +
          '<td class="leaderboard-points">' + (entry.points || 0) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      contentEl.innerHTML = html;
    } catch (err) {
      contentEl.innerHTML = '<div class="panel-empty">Toppliste er ikke tilgjengelig enna.</div>';
    }
  }

  function openLeaderboardPanel() {
    document.getElementById('leaderboard-overlay').classList.add('is-visible');
    loadLeaderboard();
  }

  function closeLeaderboardPanel() {
    document.getElementById('leaderboard-overlay').classList.remove('is-visible');
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. SETTINGS (Innstillinger)
  // ═══════════════════════════════════════════════════════════════════

  var SETTINGS_KEY = 'spillorama.settings';

  function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function initSettings() {
    var settings = getSettings();

    var soundToggle = document.getElementById('settings-sound');
    var voiceToggle = document.getElementById('settings-voice');
    var langSelect = document.getElementById('settings-language');

    if (soundToggle) {
      soundToggle.checked = settings.sound !== false;
      soundToggle.addEventListener('change', function () {
        var s = getSettings();
        s.sound = this.checked;
        saveSettings(s);
      });
    }

    if (voiceToggle) {
      voiceToggle.checked = settings.voice !== false;
      voiceToggle.addEventListener('change', function () {
        var s = getSettings();
        s.voice = this.checked;
        saveSettings(s);
      });
    }

    if (langSelect) {
      langSelect.value = settings.language || 'nor';
      langSelect.addEventListener('change', function () {
        var s = getSettings();
        s.language = this.value;
        saveSettings(s);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. WITHDRAW (Uttak)
  // ═══════════════════════════════════════════════════════════════════

  function initWithdraw() {
    var withdrawBtn = document.getElementById('profile-withdraw-btn');
    var withdrawWrap = document.getElementById('profile-withdraw-form-wrap');
    var withdrawForm = document.getElementById('profile-withdraw-form');

    if (withdrawBtn && withdrawWrap) {
      withdrawBtn.addEventListener('click', function () {
        withdrawWrap.hidden = !withdrawWrap.hidden;
      });
    }

    if (withdrawForm) {
      withdrawForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var errEl = document.getElementById('profile-withdraw-error');
        var successEl = document.getElementById('profile-withdraw-success');
        if (errEl) errEl.hidden = true;
        if (successEl) successEl.hidden = true;

        var amount = Number(document.getElementById('profile-withdraw-amount').value);
        if (!amount || amount < 10) {
          if (errEl) { errEl.textContent = 'Minimumsbelop er 10 kr'; errEl.hidden = false; }
          return;
        }

        var user = getUser();
        if (!user || !user.walletId) {
          if (errEl) { errEl.textContent = 'Lommebok ikke funnet'; errEl.hidden = false; }
          return;
        }

        try {
          await apiFetch('/api/wallets/' + encodeURIComponent(user.walletId) + '/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amount })
          });
          withdrawWrap.hidden = true;
          withdrawForm.reset();
          if (successEl) { successEl.textContent = 'Uttak pa ' + formatKr(amount) + ' behandlet!'; successEl.hidden = false; }
          // Refresh wallet
          if (window.SpilloramaProfile) window.SpilloramaProfile.refresh();
          if (window.SpilloramaLobby) window.SpilloramaLobby.load();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message || 'Uttak feilet'; errEl.hidden = false; }
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. LOSS LIMITS (Tapsgrenser)
  // ═══════════════════════════════════════════════════════════════════

  function initLossLimits() {
    var form = document.getElementById('loss-limits-form');
    if (!form) return;

    // Load current limits
    loadCurrentLimits();

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var errEl = document.getElementById('loss-limits-error');
      var successEl = document.getElementById('loss-limits-success');
      if (errEl) errEl.hidden = true;
      if (successEl) successEl.hidden = true;

      var daily = document.getElementById('loss-limit-daily').value;
      var monthly = document.getElementById('loss-limit-monthly').value;

      var payload = {};
      if (daily !== '') payload.dailyLossLimit = Number(daily);
      if (monthly !== '') payload.monthlyLossLimit = Number(monthly);

      try {
        await apiFetch('/api/wallet/me/loss-limits', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (successEl) { successEl.textContent = 'Grenser oppdatert!'; successEl.hidden = false; }
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Kunne ikke oppdatere grenser'; errEl.hidden = false; }
      }
    });
  }

  async function loadCurrentLimits() {
    try {
      var hallId = sessionStorage.getItem('lobby.activeHallId') || '';
      if (!hallId) return;
      var compliance = await apiFetch('/api/wallet/me/compliance?hallId=' + encodeURIComponent(hallId));
      if (compliance && compliance.limits) {
        var dailyEl = document.getElementById('loss-limit-daily');
        var monthlyEl = document.getElementById('loss-limit-monthly');
        if (dailyEl && compliance.limits.dailyLossLimit) dailyEl.value = compliance.limits.dailyLossLimit;
        if (monthlyEl && compliance.limits.monthlyLossLimit) monthlyEl.value = compliance.limits.monthlyLossLimit;
      }
    } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 7. FORGOT PASSWORD (Glemt passord)
  // ═══════════════════════════════════════════════════════════════════

  function initForgotPassword() {
    var link = document.getElementById('forgot-password-link');
    var form = document.getElementById('forgot-password-form');
    var backLink = document.getElementById('forgot-password-back');
    var loginForm = document.getElementById('login-form');

    if (link && form && loginForm) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        loginForm.hidden = true;
        form.hidden = false;
      });
    }

    if (backLink && form && loginForm) {
      backLink.addEventListener('click', function (e) {
        e.preventDefault();
        form.hidden = true;
        loginForm.hidden = false;
      });
    }

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var email = document.getElementById('forgot-email').value.trim();
        var errEl = document.getElementById('forgot-error');
        var successEl = document.getElementById('forgot-success');
        var submitBtn = document.getElementById('forgot-submit');
        if (errEl) errEl.hidden = true;
        if (successEl) successEl.hidden = true;

        if (!email) {
          if (errEl) { errEl.textContent = 'E-post er pakrevd'; errEl.hidden = false; }
          return;
        }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sender...'; }

        try {
          await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
          });
          // Always show success (don't reveal if email exists)
          if (successEl) {
            successEl.textContent = 'Hvis e-posten finnes i systemet, har vi sendt en lenke for a tilbakestille passordet.';
            successEl.hidden = false;
          }
        } catch (err) {
          if (successEl) {
            successEl.textContent = 'Hvis e-posten finnes i systemet, har vi sendt en lenke for a tilbakestille passordet.';
            successEl.hidden = false;
          }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send tilbakestillingslenke'; }
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════

  function initPanels() {
    initSettings();
    initWithdraw();
    initLossLimits();
    initForgotPassword();

    // Schedule panel open/close
    var scheduleClose = document.getElementById('schedule-panel-close');
    if (scheduleClose) scheduleClose.addEventListener('click', closeSchedulePanel);
    var scheduleOverlay = document.getElementById('schedule-overlay');
    if (scheduleOverlay) scheduleOverlay.addEventListener('click', function (e) {
      if (e.target === this) closeSchedulePanel();
    });

    // Notifications panel open/close
    var notifClose = document.getElementById('notifications-panel-close');
    if (notifClose) notifClose.addEventListener('click', closeNotificationsPanel);
    var notifOverlay = document.getElementById('notifications-overlay');
    if (notifOverlay) notifOverlay.addEventListener('click', function (e) {
      if (e.target === this) closeNotificationsPanel();
    });

    // Leaderboard panel open/close
    var lbClose = document.getElementById('leaderboard-panel-close');
    if (lbClose) lbClose.addEventListener('click', closeLeaderboardPanel);
    var lbOverlay = document.getElementById('leaderboard-overlay');
    if (lbOverlay) lbOverlay.addEventListener('click', function (e) {
      if (e.target === this) closeLeaderboardPanel();
    });

    // Notification bell
    var notifBtn = document.getElementById('lobby-notification-btn');
    if (notifBtn) notifBtn.addEventListener('click', openNotificationsPanel);
  }

  // Public API
  window.SpilloramaPanels = {
    openSchedule: openSchedulePanel,
    closeSchedule: closeSchedulePanel,
    openNotifications: openNotificationsPanel,
    closeNotifications: closeNotificationsPanel,
    openLeaderboard: openLeaderboardPanel,
    closeLeaderboard: closeLeaderboardPanel,
    addNotification: window.AddShellNotification
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanels);
  } else {
    initPanels();
  }
})();
