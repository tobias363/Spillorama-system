/* ════════════════════════════════════════════════════════════════════════
 * Min Konto — player-portal account page (vanilla JS, no build step)
 * Created 2026-05-02 from Claude-Design mockup (min-konto.jsx 2567 lines).
 *
 * Public API:
 *   window.ShowMinKontoPanel()  — open Min Konto overlay
 *   window.HideMinKontoPanel()  — close it
 *
 * Backend wiring:
 *   GET  /api/auth/me                  — profile
 *   GET  /api/wallet/me                — balance + last 20 tx
 *   GET  /api/wallet/me/transactions   — full tx list
 *   GET  /api/wallet/me/compliance     — limits, pause, exclusion
 *   PUT  /api/wallet/me/loss-limits    — update limits
 *   POST /api/wallet/me/timed-pause    — pause
 *   POST /api/wallet/me/self-exclusion — 1-year exclusion
 *   GET  /api/spillevett/report        — game accounting
 *   PUT  /api/auth/me                  — update profile fields
 *
 * Modals NOT yet backend-wired (stub: "Kommer snart"):
 *   • Overfor (Swedbank Pay)
 *   • Varslinger (no notifications API in this codebase yet)
 *   • Nyhetsbrev (consent management)
 * ════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── State (module-private) ────────────────────────────────────────────
  var state = {
    profile: null,        // { id, displayName, email, phone, ... }
    wallet: null,         // { account: { balance }, transactions: [] }
    compliance: null,     // { dailyLossLimit, monthlyLossLimit, ... }
    report: null,         // { period, totals, sessions }
    transactions: null,   // [{ id, type, amount, createdAt, reason }]
    halls: [],            // [{ id, name }]
    activeHallId: null,
    activeHallName: '',
    loading: false,
    error: null,
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatKr(num) {
    if (num == null || isNaN(num)) return '0';
    var n = Math.round(Number(num));
    return n.toLocaleString('nb-NO');
  }

  function formatKrLong(num) {
    return formatKr(num) + ' kr';
  }

  function formatDateNorsk(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var months = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
      return d.getDate() + '. ' + months[d.getMonth()] + ' ' + d.getFullYear();
    } catch (e) { return iso; }
  }

  function formatDateTimeShort(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      if (sameDay) return 'I dag · ' + hh + ':' + mm;
      var yest = new Date(now); yest.setDate(now.getDate() - 1);
      if (d.toDateString() === yest.toDateString()) return 'I går · ' + hh + ':' + mm;
      var months = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
      return d.getDate() + '. ' + months[d.getMonth()] + '. · ' + hh + ':' + mm;
    } catch (e) { return iso; }
  }

  function getToken() {
    try {
      return sessionStorage.getItem('shellAccessToken')
          || sessionStorage.getItem('accessToken')
          || localStorage.getItem('accessToken')
          || (window.SpilloramaAuth && window.SpilloramaAuth.getAccessToken && window.SpilloramaAuth.getAccessToken())
          || null;
    } catch (e) { return null; }
  }

  function api(path, opts) {
    opts = opts || {};
    var token = getToken();
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || (json && json.ok === false)) {
          var err = new Error((json && json.error && json.error.message) || ('HTTP ' + res.status));
          err.code = json && json.error && json.error.code;
          throw err;
        }
        return json && json.data !== undefined ? json.data : json;
      });
    });
  }

  function showToast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'mk-toast';
    t.textContent = msg;
    if (kind === 'error') t.style.background = 'rgba(180, 28, 28, 0.92)';
    document.body.appendChild(t);
    setTimeout(function () {
      try { t.remove(); } catch (e) {}
    }, 2800);
  }

  // ── Icons (raw SVG strings) ───────────────────────────────────────────
  var ICONS = {
    chevR: '<svg class="mk-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>',
    caret: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    warning: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="6" y1="18" x2="18" y2="6"/></svg>',
    pause: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/></svg>',
    transfer: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    bell: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    trophy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 1 1-10 0V4z"/><path d="M17 5h2a2 2 0 0 1 0 4h-2"/><path d="M7 5H5a2 2 0 0 0 0 4h2"/></svg>',
  };

  // ── DOM template (full overlay) ───────────────────────────────────────
  function buildOverlay() {
    var el = document.getElementById('mk-overlay');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'mk-overlay';
    el.className = 'mk-overlay';
    el.innerHTML = ''
      + '<div class="mk-screen" id="mk-screen-main">'
      + '  <div class="mk-gold-strip"></div>'
      + '  <div class="mk-account-header">'
      + '    <div>'
      + '      <div class="mk-account-name" id="mk-name">--</div>'
      + '      <div class="mk-account-kallenavn">Kallenavn: <strong id="mk-kallenavn">--</strong></div>'
      + '      <div class="mk-saldo-label">Saldo</div>'
      + '      <div class="mk-saldo-value"><span id="mk-saldo">0</span><span class="mk-saldo-suffix">kr</span></div>'
      + '    </div>'
      + '    <button class="mk-icon-btn" id="mk-close" aria-label="Lukk">' + ICONS.close + '</button>'
      + '  </div>'
      + '  <div class="mk-pills">'
      + '    <button class="mk-pill" data-mk-action="overfor">Overfør penger</button>'
      + '    <button class="mk-pill" data-mk-action="transaksjoner">Transaksjoner</button>'
      + '  </div>'
      + '  <div class="mk-hall-card">'
      + '    <div class="mk-hall-row"><div class="mk-hall-label">Aktiv hall</div><div class="mk-hall-value" id="mk-hall-name">--</div></div>'
      + '    <div class="mk-hall-divider"></div>'
      + '    <div class="mk-hall-row"><div class="mk-hall-label">Brukt dagsgrense</div><div class="mk-hall-value" id="mk-daily-used">0 kr</div></div>'
      + '    <div class="mk-hall-divider"></div>'
      + '    <div class="mk-hall-row"><div class="mk-hall-label">Brukt månedsgrense</div><div class="mk-hall-value" id="mk-monthly-used">0 kr</div></div>'
      + '    <div class="mk-hall-divider"></div>'
      + '    <div class="mk-hall-select-wrap">'
      + '      <select class="mk-hall-select" id="mk-hall-select"><option value="" disabled selected>Bytt hall</option></select>'
      + '      <span class="mk-hall-select-caret">' + ICONS.caret + '</span>'
      + '    </div>'
      + '  </div>'
      + '  <div class="mk-menu-group" id="mk-menu-main"></div>'
      + '  <div class="mk-vip" id="mk-vip-callout" hidden>'
      + '    <div class="mk-vip-pinwheel">'
      + '      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">'
      + '        <path d="M16 16 L16 4 A12 12 0 0 1 26.4 10 Z" fill="#c8203a"/>'
      + '        <path d="M16 16 L26.4 10 A12 12 0 0 1 26.4 22 Z" fill="#f7eedd"/>'
      + '        <path d="M16 16 L26.4 22 A12 12 0 0 1 16 28 Z" fill="#c8203a"/>'
      + '        <path d="M16 16 L16 28 A12 12 0 0 1 5.6 22 Z" fill="#f7eedd"/>'
      + '        <path d="M16 16 L5.6 22 A12 12 0 0 1 5.6 10 Z" fill="#c8203a"/>'
      + '        <path d="M16 16 L5.6 10 A12 12 0 0 1 16 4 Z" fill="#f7eedd"/>'
      + '        <circle cx="16" cy="16" r="2" fill="#3a1410"/>'
      + '      </svg>'
      + '    </div>'
      + '    <div class="mk-vip-text">'
      + '      <div class="mk-vip-title">VIP-medlem</div>'
      + '      <div class="mk-vip-sub" id="mk-vip-sub">Du får 5% bonus på alle innskudd ut november</div>'
      + '    </div>'
      + '  </div>'
      + '  <button class="mk-logout" id="mk-logout">' + ICONS.logout + ' Logg ut</button>'
      + '</div>'
      + '<div class="mk-subscreen" id="mk-sub-personlig"></div>'
      + '<div class="mk-subscreen" id="mk-sub-spillregnskap"></div>'
      + '<div class="mk-subscreen" id="mk-sub-spillegrenser"></div>'
      + '<div class="mk-subscreen" id="mk-sub-varslinger"></div>'
      + '<div class="mk-subscreen" id="mk-sub-pause"></div>'
      + '<div class="mk-subscreen" id="mk-sub-utestenging"></div>'
      + '<div class="mk-subscreen" id="mk-sub-overfor"></div>'
      + '<div class="mk-subscreen" id="mk-sub-transaksjoner"></div>';

    document.body.appendChild(el);
    bindEvents(el);
    return el;
  }

  // ── Sub-screen open/close ─────────────────────────────────────────────
  function openSub(id, render) {
    var sub = document.getElementById(id);
    if (!sub) return;
    if (typeof render === 'function') render(sub);
    sub.classList.add('is-open');
  }

  function closeSub(id) {
    var sub = document.getElementById(id);
    if (sub) sub.classList.remove('is-open');
  }

  function subHeader(title, onBackId) {
    return ''
      + '<div class="mk-gold-strip"></div>'
      + '<div class="mk-sub-header">'
      + '  <button class="mk-sub-back" data-mk-back="' + onBackId + '" aria-label="Tilbake">' + ICONS.back + '</button>'
      + '  <div class="mk-sub-title">' + escapeHtml(title) + '</div>'
      + '</div>';
  }

  // ── 1. Personlig informasjon ─────────────────────────────────────────
  function renderPersonlig(sub) {
    var p = state.profile || {};

    function infoRow(label, value, sub2, editable) {
      return '<div class="mk-info-row">'
        + '<div class="mk-info-row-content">'
        + '<div class="mk-info-label">' + escapeHtml(label) + '</div>'
        + '<div class="mk-info-value">' + escapeHtml(value || '—') + '</div>'
        + (sub2 ? '<div class="mk-info-sub">' + escapeHtml(sub2) + '</div>' : '')
        + '</div>'
        + (editable ? '<button class="mk-info-edit-btn" data-mk-edit="' + editable + '" aria-label="Rediger">' + ICONS.edit + '</button>' : '')
        + '</div>';
    }

    // Compose "Fullt navn" without ever producing the literal "null" or "undefined"
    var fullName = '';
    if (p.displayName) fullName = String(p.displayName);
    if (p.surname) fullName = (fullName ? fullName + ' ' : '') + String(p.surname);

    sub.innerHTML = subHeader('Personlig informasjon', 'mk-sub-personlig')
      + '<div class="mk-sub-body">'
      + '  <div class="mk-info-card">'
      +     infoRow('Fullt navn', fullName)
      +     infoRow('Spillernummer', p.id ? String(p.id).slice(0, 8).toUpperCase() : '—')
      +     infoRow('E-post', p.email, null, 'email')
      +     infoRow('Telefon', p.phone, null, 'phone')
      +     infoRow('Fødselsdato', p.birthDate ? formatDateNorsk(p.birthDate) : '—')
      + '  </div>'
      + '  <button class="mk-action-btn" id="mk-personlig-edit-btn" style="max-width:100%">Rediger profil</button>'
      + '</div>';

    var editBtn = sub.querySelector('#mk-personlig-edit-btn');
    if (editBtn) editBtn.addEventListener('click', openPersonligEdit);
  }

  function openPersonligEdit() {
    var p = state.profile || {};
    var sub = document.getElementById('mk-sub-personlig');
    sub.innerHTML = subHeader('Rediger profil', 'mk-sub-personlig')
      + '<div class="mk-sub-body" style="padding:0 4px">'
      + '  <form id="mk-personlig-form" style="display:flex;flex-direction:column;gap:14px">'
      + '    <label style="display:block">'
      + '      <div class="mk-info-label" style="margin-bottom:6px">Kallenavn</div>'
      + '      <input class="mk-input" name="displayName" value="' + escapeHtml(p.displayName || '') + '" maxlength="40" style="margin-bottom:0;text-align:left;max-width:100%" />'
      + '    </label>'
      + '    <label style="display:block">'
      + '      <div class="mk-info-label" style="margin-bottom:6px">E-post</div>'
      + '      <input class="mk-input" type="email" name="email" value="' + escapeHtml(p.email || '') + '" style="margin-bottom:0;text-align:left;max-width:100%" />'
      + '    </label>'
      + '    <label style="display:block">'
      + '      <div class="mk-info-label" style="margin-bottom:6px">Telefon</div>'
      + '      <input class="mk-input" type="tel" name="phone" value="' + escapeHtml(p.phone || '') + '" style="margin-bottom:0;text-align:left;max-width:100%" />'
      + '    </label>'
      + '    <div id="mk-personlig-error"></div>'
      + '    <button type="submit" class="mk-action-btn" style="max-width:100%">Lagre endringer</button>'
      + '    <button type="button" class="mk-link-btn" id="mk-personlig-cancel">Avbryt</button>'
      + '  </form>'
      + '</div>';

    var form = sub.querySelector('#mk-personlig-form');
    sub.querySelector('#mk-personlig-cancel').addEventListener('click', function () {
      renderPersonlig(sub);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {
        displayName: form.elements.displayName.value.trim(),
        email: form.elements.email.value.trim(),
        phone: form.elements.phone.value.trim(),
      };
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Lagrer...';
      api('/api/auth/me', { method: 'PUT', body: data }).then(function (updated) {
        state.profile = Object.assign({}, state.profile, updated);
        renderHeaderFields();
        showToast('Profil oppdatert');
        renderPersonlig(sub);
      }).catch(function (err) {
        var errEl = sub.querySelector('#mk-personlig-error');
        if (errEl) errEl.innerHTML = '<div class="mk-error">' + escapeHtml(err.message || 'Kunne ikke lagre.') + '</div>';
        btn.disabled = false; btn.textContent = 'Lagre endringer';
      });
    });
  }

  // ── 2. Spillregnskap ─────────────────────────────────────────────────
  function renderSpillregnskap(sub) {
    sub.innerHTML = subHeader('Spillregnskap', 'mk-sub-spillregnskap')
      + '<div class="mk-sub-body">'
      + '  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">'
      + '    <button class="mk-pill mk-period-btn" data-period="last7" style="flex:0 1 auto">Siste 7 dager</button>'
      + '    <button class="mk-pill mk-period-btn" data-period="last30" style="flex:0 1 auto">Siste 30 dager</button>'
      + '    <button class="mk-pill mk-period-btn" data-period="last365" style="flex:0 1 auto">Siste 365 dager</button>'
      + '  </div>'
      + '  <div id="mk-regnskap-content"><div class="mk-empty">Laster...</div></div>'
      + '</div>';

    sub.querySelectorAll('.mk-period-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sub.querySelectorAll('.mk-period-btn').forEach(function (b) {
          b.style.background = 'transparent';
        });
        btn.style.background = 'rgba(247,238,221,0.10)';
        loadRegnskap(btn.dataset.period);
      });
    });

    // initial load
    sub.querySelector('.mk-period-btn').style.background = 'rgba(247,238,221,0.10)';
    loadRegnskap('last7');
  }

  function loadRegnskap(period) {
    var content = document.querySelector('#mk-regnskap-content');
    if (!content) return;
    content.innerHTML = '<div class="mk-empty">Laster...</div>';

    var hallParam = state.activeHallId ? '&hallId=' + encodeURIComponent(state.activeHallId) : '';
    api('/api/spillevett/report?period=' + period + hallParam).then(function (data) {
      var totals = (data && data.totals) || {};
      var sessions = (data && data.sessions) || [];
      var insats = totals.totalStake || totals.stake || 0;
      var gevinst = totals.totalPrize || totals.prize || 0;
      var netto = totals.netLoss != null ? totals.netLoss : (insats - gevinst);

      var html = ''
        + '<div class="mk-stat-grid">'
        + '  <div class="mk-stat-card">'
        + '    <div class="mk-stat-label">Innsats</div>'
        + '    <div class="mk-stat-value">' + formatKr(insats) + '<span style="font-size:14px;font-weight:600;margin-left:4px;color:rgba(247,238,221,0.7)">kr</span></div>'
        + '  </div>'
        + '  <div class="mk-stat-card">'
        + '    <div class="mk-stat-label">Gevinst</div>'
        + '    <div class="mk-stat-value">' + formatKr(gevinst) + '<span style="font-size:14px;font-weight:600;margin-left:4px;color:rgba(247,238,221,0.7)">kr</span></div>'
        + '  </div>'
        + '</div>'
        + '<div class="mk-stat-card" style="margin-bottom:14px">'
        + '  <div class="mk-stat-label">Netto-tap (innsats minus gevinst)</div>'
        + '  <div class="mk-stat-value" style="color:' + (netto > 0 ? '#ef6b6b' : '#6cd86c') + '">'
        +     (netto >= 0 ? '−' : '+') + formatKr(Math.abs(netto)) + '<span style="font-size:14px;font-weight:600;margin-left:4px">kr</span>'
        + '  </div>'
        + '</div>';

      if (sessions && sessions.length) {
        html += '<div class="mk-section-label" style="margin-top:18px">Spillesesjoner</div><div class="mk-list">';
        sessions.slice(0, 30).forEach(function (s) {
          html += '<div class="mk-list-row">'
            + '<div class="mk-list-icon">' + ICONS.trophy + '</div>'
            + '<div class="mk-list-content">'
            +   '<div class="mk-list-title">' + escapeHtml(s.gameName || s.game || 'Bingo') + '</div>'
            +   '<div class="mk-list-meta">' + escapeHtml(formatDateTimeShort(s.startedAt || s.createdAt)) + '</div>'
            + '</div>'
            + '<div class="mk-list-amount ' + ((s.netLoss || 0) > 0 ? 'mk-list-amount--negative' : 'mk-list-amount--positive') + '">'
            +   ((s.netLoss || 0) > 0 ? '−' : '+') + formatKr(Math.abs(s.netLoss || 0)) + ' kr'
            + '</div>'
            + '</div>';
        });
        html += '</div>';
      } else {
        html += '<div class="mk-empty">Ingen spillesesjoner i perioden.</div>';
      }
      content.innerHTML = html;
    }).catch(function (err) {
      content.innerHTML = '<div class="mk-error">' + escapeHtml(err.message || 'Kunne ikke laste spillregnskap.') + '</div>';
    });
  }

  // ── 3. Spillegrenser ─────────────────────────────────────────────────
  function renderSpillegrenser(sub) {
    var c = state.compliance || {};
    var dailyLimit = c.dailyLossLimit != null ? c.dailyLossLimit : 1000;
    var monthlyLimit = c.monthlyLossLimit != null ? c.monthlyLossLimit : 4400;
    var dailyUsed = c.dailyLossUsed != null ? c.dailyLossUsed : 0;
    var monthlyUsed = c.monthlyLossUsed != null ? c.monthlyLossUsed : 0;

    function progressRow(label, used, max) {
      var pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
      return '<div class="mk-grense-row">'
        + '<div class="mk-grense-row-head">'
        +   '<div class="mk-grense-row-label">' + escapeHtml(label) + '</div>'
        +   '<div class="mk-grense-row-value">' + formatKr(used) + ' / ' + formatKr(max) + ' kr</div>'
        + '</div>'
        + '<div class="mk-progress-bar"><div class="mk-progress-fill" style="width:' + pct + '%"></div></div>'
        + '</div>';
    }

    sub.innerHTML = subHeader('Spillegrenser', 'mk-sub-spillegrenser')
      + '<div class="mk-sub-body">'
      + '  <div style="margin-left:4px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid rgba(247,238,221,0.12)">'
      + '    <div class="mk-info-label" style="text-transform:uppercase;letter-spacing:0.04em;font-weight:600">Aktiv hall</div>'
      + '    <div style="font-size:16px;font-weight:700;color:#f7eedd;letter-spacing:-0.01em;margin-top:3px">' + escapeHtml(state.activeHallName || '—') + '</div>'
      + '  </div>'
      + '  <div class="mk-grense-card">'
      + '    <div class="mk-grense-title">Totalgrense</div>'
      + '    <div class="mk-grense-sub">Gjelder alle spill</div>'
      +     progressRow('Dag', dailyUsed, dailyLimit)
      +     progressRow('Måned', monthlyUsed, monthlyLimit)
      + '  </div>'
      + '  <button class="mk-action-btn" id="mk-grenser-edit-btn" style="max-width:100%">Endre spillegrense</button>'
      + '</div>';

    sub.querySelector('#mk-grenser-edit-btn').addEventListener('click', function () {
      openGrenserEdit(sub, dailyLimit, monthlyLimit);
    });
  }

  function openGrenserEdit(sub, currentDaily, currentMonthly) {
    sub.innerHTML = subHeader('Endre spillegrense', 'mk-sub-spillegrenser')
      + '<div class="mk-sub-body" style="padding:0 4px">'
      + '  <div class="mk-error" style="background:rgba(212,166,74,0.14);border-color:rgba(212,166,74,0.4);color:#f4d99a;display:flex;gap:10px;align-items:flex-start">'
      + '    <span aria-hidden="true">ⓘ</span>'
      + '    <div>Når du øker grensen vil endringen først tre i kraft etter en karenstid på 24 timer. Reduksjon trer i kraft umiddelbart.</div>'
      + '  </div>'
      + '  <form id="mk-grenser-form">'
      + '    <label style="display:block;margin-bottom:14px">'
      + '      <div class="mk-info-label" style="margin-bottom:6px">Dagsgrense (kr)</div>'
      + '      <input class="mk-input" type="number" name="daily" min="0" max="50000" step="50" value="' + currentDaily + '" style="margin-bottom:0;text-align:left;max-width:100%" />'
      + '    </label>'
      + '    <label style="display:block;margin-bottom:14px">'
      + '      <div class="mk-info-label" style="margin-bottom:6px">Månedsgrense (kr)</div>'
      + '      <input class="mk-input" type="number" name="monthly" min="0" max="200000" step="100" value="' + currentMonthly + '" style="margin-bottom:0;text-align:left;max-width:100%" />'
      + '    </label>'
      + '    <div id="mk-grenser-error"></div>'
      + '    <button type="submit" class="mk-action-btn" style="max-width:100%">Lagre grenser</button>'
      + '    <button type="button" class="mk-link-btn" id="mk-grenser-cancel">Avbryt</button>'
      + '  </form>'
      + '</div>';

    sub.querySelector('#mk-grenser-cancel').addEventListener('click', function () {
      renderSpillegrenser(sub);
    });
    sub.querySelector('#mk-grenser-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var hallId = state.activeHallId;
      if (!hallId) {
        showToast('Velg en hall først', 'error'); return;
      }
      var body = {
        hallId: hallId,
        dailyLossLimit: Number(e.target.elements.daily.value),
        monthlyLossLimit: Number(e.target.elements.monthly.value),
      };
      var btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Lagrer...';
      api('/api/wallet/me/loss-limits', { method: 'PUT', body: body }).then(function (updated) {
        state.compliance = Object.assign({}, state.compliance, updated);
        showToast('Grenser oppdatert');
        renderSpillegrenser(sub);
        renderHallCard();
      }).catch(function (err) {
        sub.querySelector('#mk-grenser-error').innerHTML = '<div class="mk-error">' + escapeHtml(err.message || 'Kunne ikke lagre.') + '</div>';
        btn.disabled = false; btn.textContent = 'Lagre grenser';
      });
    });
  }

  // ── 4. Varslinger (stub list — uses transactions as feed proxy) ──────
  function renderVarslinger(sub) {
    var notifications = [];

    // Build feed from recent transactions + pause/exclusion events
    if (state.transactions && state.transactions.length) {
      state.transactions.slice(0, 12).forEach(function (tx) {
        var kind = 'system';
        var title = tx.reason || tx.type;
        if (tx.type === 'PRIZE') {
          kind = 'gevinst';
          title = 'Du vant ' + formatKrLong(tx.amount);
        } else if (tx.type === 'TOPUP' || tx.type === 'TRANSFER_IN') {
          kind = 'overforing';
          title = 'Innskudd ' + formatKrLong(tx.amount);
        } else if (tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER_OUT') {
          kind = 'overforing';
          title = 'Uttak ' + formatKrLong(Math.abs(tx.amount));
        } else if (tx.type === 'STAKE') {
          return; // skip stakes
        }
        notifications.push({ kind: kind, title: title, time: formatDateTimeShort(tx.createdAt) });
      });
    }

    var listHtml = '';
    if (notifications.length === 0) {
      listHtml = '<div class="mk-empty">Ingen nye varslinger.</div>';
    } else {
      listHtml = '<div class="mk-list">';
      notifications.forEach(function (n) {
        var icon = n.kind === 'gevinst' ? ICONS.trophy
                 : n.kind === 'overforing' ? ICONS.transfer
                 : ICONS.bell;
        listHtml += '<div class="mk-list-row">'
          + '<div class="mk-list-icon">' + icon + '</div>'
          + '<div class="mk-list-content">'
          +   '<div class="mk-list-title">' + escapeHtml(n.title) + '</div>'
          +   '<div class="mk-list-meta">' + escapeHtml(n.time || '') + '</div>'
          + '</div>'
          + '</div>';
      });
      listHtml += '</div>';
    }

    sub.innerHTML = subHeader('Varslinger', 'mk-sub-varslinger')
      + '<div class="mk-sub-body">' + listHtml + '</div>';
  }

  // ── 5. Spillepause ───────────────────────────────────────────────────
  function renderSpillepause(sub) {
    var c = state.compliance || {};
    var pauseUntil = c.timedPauseUntil;
    var hasPause = pauseUntil && new Date(pauseUntil) > new Date();

    sub.innerHTML = subHeader('Spillepause', 'mk-sub-pause')
      + '<div class="mk-sub-body">'
      + '  <div class="mk-confirm-center">'
      + '    <div class="mk-warning-icon">' + ICONS.pause + '</div>'
      +     (hasPause
            ? ('<div class="mk-confirm-title">Aktiv spillepause</div>'
              + '<div class="mk-confirm-text">Pausen varer til <strong>' + escapeHtml(formatDateTimeShort(pauseUntil)) + '</strong>. I løpet av denne tiden kan du ikke spille.</div>'
              + '<button class="mk-action-btn" id="mk-pause-cancel">Avbryt pause</button>')
            : ('<div class="mk-confirm-title">Ta en pause fra spilling</div>'
              + '<div class="mk-confirm-text">Velg hvor lenge du vil pause. Du kan ikke spille før pausen utløper.</div>'
              + '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:18px">'
              +   '<button class="mk-pill mk-pause-opt" data-min="60">1 time</button>'
              +   '<button class="mk-pill mk-pause-opt" data-min="1440">24 timer</button>'
              +   '<button class="mk-pill mk-pause-opt" data-min="10080">7 dager</button>'
              +   '<button class="mk-pill mk-pause-opt" data-min="43200">30 dager</button>'
              + '</div>'))
      + '  </div>'
      + '</div>';

    if (hasPause) {
      sub.querySelector('#mk-pause-cancel').addEventListener('click', function () {
        if (!confirm('Avbryte aktiv spillepause?')) return;
        api('/api/wallet/me/timed-pause', { method: 'DELETE' }).then(function (updated) {
          state.compliance = Object.assign({}, state.compliance, updated);
          showToast('Pause avbrutt');
          renderSpillepause(sub);
        }).catch(function (err) {
          showToast(err.message || 'Kunne ikke avbryte', 'error');
        });
      });
    } else {
      sub.querySelectorAll('.mk-pause-opt').forEach(function (b) {
        b.addEventListener('click', function () {
          var minutes = Number(b.dataset.min);
          var label = b.textContent;
          if (!confirm('Sett en pause på ' + label + '?')) return;
          api('/api/wallet/me/timed-pause', { method: 'POST', body: { durationMinutes: minutes } }).then(function (updated) {
            state.compliance = Object.assign({}, state.compliance, updated);
            showToast('Pause aktivert');
            renderSpillepause(sub);
          }).catch(function (err) {
            showToast(err.message || 'Kunne ikke aktivere', 'error');
          });
        });
      });
    }
  }

  // ── 6. Utestenging ───────────────────────────────────────────────────
  function renderUtestenging(sub) {
    var c = state.compliance || {};
    if (c.selfExcluded) {
      sub.innerHTML = subHeader('Utestenging', 'mk-sub-utestenging')
        + '<div class="mk-sub-body"><div class="mk-confirm-center">'
        + '  <div class="mk-warning-icon">' + ICONS.warning + '</div>'
        + '  <div class="mk-confirm-title">Du er permanent utestengt</div>'
        + '  <div class="mk-confirm-text">Utestengelsen kan ikke heves før det har gått minimum <strong>365 dager</strong>. Kontakt kundeservice ved spørsmål.</div>'
        + '</div></div>';
      return;
    }

    sub.innerHTML = subHeader('Utestenging', 'mk-sub-utestenging')
      + '<div class="mk-sub-body"><div class="mk-confirm-center" id="mk-uteseng-step1">'
      + '  <div class="mk-warning-icon">' + ICONS.warning + '</div>'
      + '  <div class="mk-confirm-title">Bekreft utestenging fra alle spill hos Spillorama</div>'
      + '  <div class="mk-confirm-text">Utestengelsen er <strong>permanent</strong> og kan ikke bli vurdert gjenåpnet før det har gått minimum <strong>365 dager</strong>.</div>'
      + '  <button class="mk-action-btn" id="mk-uteseng-next">Bekreft med fødselsdato</button>'
      + '  <button class="mk-link-btn" data-mk-back="mk-sub-utestenging">Avbryt</button>'
      + '</div></div>';

    sub.querySelector('#mk-uteseng-next').addEventListener('click', function () {
      var step = sub.querySelector('#mk-uteseng-step1');
      step.innerHTML = ''
        + '<div class="mk-warning-icon">' + ICONS.warning + '</div>'
        + '<div class="mk-confirm-title" style="font-size:20px">Bekreft med fødselsdato</div>'
        + '<div class="mk-confirm-text">Skriv inn din fødselsdato for å bekrefte permanent utestenging.</div>'
        + '<input type="date" class="mk-input" id="mk-uteseng-date" style="max-width:280px" />'
        + '<button class="mk-action-btn mk-action-btn--danger" id="mk-uteseng-confirm" disabled>Bekreft permanent utestenging</button>'
        + '<button class="mk-link-btn" id="mk-uteseng-back">Tilbake</button>';

      var dateInput = step.querySelector('#mk-uteseng-date');
      var confirmBtn = step.querySelector('#mk-uteseng-confirm');
      var expectedBirth = (state.profile && state.profile.birthDate) || null;

      dateInput.addEventListener('change', function () {
        confirmBtn.disabled = !dateInput.value;
      });
      step.querySelector('#mk-uteseng-back').addEventListener('click', function () {
        renderUtestenging(sub);
      });
      confirmBtn.addEventListener('click', function () {
        if (expectedBirth && dateInput.value !== expectedBirth.slice(0, 10)) {
          showToast('Fødselsdato stemmer ikke med profilen din', 'error');
          return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Sender...';
        api('/api/wallet/me/self-exclusion', { method: 'POST' }).then(function (updated) {
          state.compliance = Object.assign({}, state.compliance, updated);
          showToast('Du er nå utestengt. Du blir logget ut.');
          setTimeout(function () {
            try {
              api('/api/auth/logout', { method: 'POST' }).finally(function () {
                window.location.reload();
              });
            } catch (e) { window.location.reload(); }
          }, 1500);
        }).catch(function (err) {
          showToast(err.message || 'Kunne ikke utestenge', 'error');
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Bekreft permanent utestenging';
        });
      });
    });
  }

  // ── 7. Overfør penger (stub — Swedbank kommer senere) ────────────────
  function renderOverfor(sub) {
    var balance = state.wallet && state.wallet.account ? state.wallet.account.balance : 0;
    sub.innerHTML = subHeader('Overfør penger', 'mk-sub-overfor')
      + '<div class="mk-sub-body">'
      + '  <div class="mk-stat-card" style="margin-bottom:16px">'
      + '    <div class="mk-stat-label">Saldo</div>'
      + '    <div class="mk-stat-value">' + formatKr(balance) + '<span style="font-size:14px;font-weight:600;margin-left:4px;color:rgba(247,238,221,0.7)">kr</span></div>'
      + '  </div>'
      + '  <div class="mk-section-label" style="margin-top:0">Sett inn</div>'
      + '  <div class="mk-list">'
      + '    <button class="mk-list-row" style="cursor:pointer;font-family:inherit;text-align:left" data-mk-deposit="vipps">'
      + '      <div class="mk-list-icon" style="font-size:20px">📱</div>'
      + '      <div class="mk-list-content"><div class="mk-list-title">Vipps</div><div class="mk-list-meta">Hurtigbetaling med mobiltelefon</div></div>'
      + '      ' + ICONS.chevR
      + '    </button>'
      + '    <button class="mk-list-row" style="cursor:pointer;font-family:inherit;text-align:left" data-mk-deposit="card">'
      + '      <div class="mk-list-icon" style="font-size:20px">💳</div>'
      + '      <div class="mk-list-content"><div class="mk-list-title">Bankkort</div><div class="mk-list-meta">Visa, Mastercard</div></div>'
      + '      ' + ICONS.chevR
      + '    </button>'
      + '  </div>'
      + '  <div class="mk-section-label">Ta ut</div>'
      + '  <div class="mk-list">'
      + '    <button class="mk-list-row" style="cursor:pointer;font-family:inherit;text-align:left" data-mk-withdraw="bank">'
      + '      <div class="mk-list-icon">' + ICONS.transfer + '</div>'
      + '      <div class="mk-list-content"><div class="mk-list-title">Til bankkonto</div><div class="mk-list-meta">1–2 virkedager</div></div>'
      + '      ' + ICONS.chevR
      + '    </button>'
      + '  </div>'
      + '</div>';

    sub.querySelectorAll('[data-mk-deposit], [data-mk-withdraw]').forEach(function (b) {
      b.addEventListener('click', function () {
        showToast('Kommer snart — Swedbank Pay-integrasjon under utvikling');
      });
    });
  }

  // ── 8. Transaksjoner ─────────────────────────────────────────────────
  function renderTransaksjoner(sub) {
    sub.innerHTML = subHeader('Transaksjoner', 'mk-sub-transaksjoner')
      + '<div class="mk-sub-body" id="mk-tx-body"><div class="mk-empty">Laster...</div></div>';

    api('/api/wallet/me/transactions?limit=100').then(function (data) {
      var list = Array.isArray(data) ? data : (data && data.transactions) || [];
      state.transactions = list;
      var body = sub.querySelector('#mk-tx-body');
      if (!list.length) {
        body.innerHTML = '<div class="mk-empty">Ingen transaksjoner ennå.</div>';
        return;
      }
      var html = '<div class="mk-list">';
      list.forEach(function (tx) {
        var amount = Number(tx.amount) || 0;
        var sign = amount >= 0 ? '+' : '−';
        var amountClass = amount >= 0 ? 'mk-list-amount--positive' : 'mk-list-amount--negative';
        var iconHtml = tx.type === 'PRIZE' ? ICONS.trophy
                     : tx.type === 'STAKE' ? ICONS.bell
                     : ICONS.transfer;
        html += '<div class="mk-list-row">'
          + '<div class="mk-list-icon">' + iconHtml + '</div>'
          + '<div class="mk-list-content">'
          +   '<div class="mk-list-title">' + escapeHtml(prettyTxType(tx.type) + (tx.reason ? ' — ' + tx.reason : '')) + '</div>'
          +   '<div class="mk-list-meta">' + escapeHtml(formatDateTimeShort(tx.createdAt)) + '</div>'
          + '</div>'
          + '<div class="mk-list-amount ' + amountClass + '">' + sign + formatKr(Math.abs(amount)) + ' kr</div>'
          + '</div>';
      });
      html += '</div>';
      body.innerHTML = html;
    }).catch(function (err) {
      var body = sub.querySelector('#mk-tx-body');
      if (body) body.innerHTML = '<div class="mk-error">' + escapeHtml(err.message || 'Kunne ikke laste.') + '</div>';
    });
  }

  function prettyTxType(t) {
    return ({
      TOPUP: 'Innskudd',
      WITHDRAWAL: 'Uttak',
      STAKE: 'Innsats',
      PRIZE: 'Gevinst',
      REFUND: 'Refusjon',
      TRANSFER_IN: 'Overføring inn',
      TRANSFER_OUT: 'Overføring ut',
    })[t] || t || 'Transaksjon';
  }

  // ── Main view rendering helpers ──────────────────────────────────────
  function renderHeaderFields() {
    var p = state.profile || {};
    var w = (state.wallet && state.wallet.account) || {};
    // Header shows full name (firstName + surname). Kallenavn is the
    // displayName the player picked (often a nickname). If surname is
    // empty we fall back to displayName for the headline.
    var n = document.getElementById('mk-name');
    if (n) {
      var displayName = (p.displayName || '').trim();
      var surname = (p.surname || '').trim();
      var headline = '';
      if (displayName && surname) headline = displayName + ' ' + surname;
      else headline = displayName || surname || 'Spiller';
      n.textContent = headline;
    }
    var k = document.getElementById('mk-kallenavn');
    if (k) k.textContent = p.displayName || '—';
    var s = document.getElementById('mk-saldo');
    if (s) s.textContent = formatKr(w.balance || 0);
  }

  function renderHallCard() {
    var c = state.compliance || {};
    var hn = document.getElementById('mk-hall-name'); if (hn) hn.textContent = state.activeHallName || '—';
    var du = document.getElementById('mk-daily-used');
    var mu = document.getElementById('mk-monthly-used');
    if (du) du.textContent = formatKrLong(c.dailyLossUsed != null ? c.dailyLossUsed : 0);
    if (mu) mu.textContent = formatKrLong(c.monthlyLossUsed != null ? c.monthlyLossUsed : 0);

    var sel = document.getElementById('mk-hall-select');
    if (sel && state.halls && state.halls.length) {
      var current = sel.value;
      sel.innerHTML = '<option value="" disabled' + (state.activeHallId ? '' : ' selected') + '>Bytt hall</option>'
        + state.halls.map(function (h) {
            var sel2 = h.id === state.activeHallId ? ' selected' : '';
            return '<option value="' + escapeHtml(h.id) + '"' + sel2 + '>' + escapeHtml(h.name) + '</option>';
          }).join('');
    }
  }

  function renderMenu() {
    var main = document.getElementById('mk-menu-main');
    if (!main) return;

    // Master design (min-konto.jsx line 2526):
    // ONE combined MenuGroup with kontoItems + spillevettItems concatenated,
    // no SectionLabel separator. The visual treatment is uniform.
    var kontoItems = [
      { label: 'Personlig informasjon', sub: 'mk-sub-personlig', renderer: renderPersonlig },
      { label: 'Spillregnskap', sub: 'mk-sub-spillregnskap', renderer: renderSpillregnskap },
      { label: 'Spillegrenser', sub: 'mk-sub-spillegrenser', renderer: renderSpillegrenser },
      { label: 'Varslinger', sub: 'mk-sub-varslinger', renderer: renderVarslinger },
      { label: 'Nyhetsbrev og informasjon', sub: null, stub: true },
    ];
    var spillevettItems = [
      { label: 'Spillepause', sub: 'mk-sub-pause', renderer: renderSpillepause },
      { label: 'Utestenging', sub: 'mk-sub-utestenging', renderer: renderUtestenging },
    ];
    var allItems = kontoItems.concat(spillevettItems);

    function row(item) {
      return '<button class="mk-menu-row" data-mk-sub="' + (item.sub || '') + '"' + (item.stub ? ' data-mk-stub="1"' : '') + '>'
        + '<div class="mk-menu-label">' + escapeHtml(item.label) + '</div>'
        + ICONS.chevR
        + '</button>';
    }

    main.innerHTML = allItems.map(row).join('');

    main.querySelectorAll('.mk-menu-row').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.mkStub) {
          showToast('Kommer snart');
          return;
        }
        var subId = btn.dataset.mkSub;
        if (!subId) return;
        var item = allItems.find(function (it) { return it.sub === subId; });
        openSub(subId, item && item.renderer);
      });
    });
  }

  // ── Hall selector + active hall ──────────────────────────────────────
  function loadHalls() {
    return api('/api/halls').then(function (data) {
      state.halls = Array.isArray(data) ? data : (data && data.halls) || [];
      // active hall: try existing host bridge first, fallback to first hall
      try {
        var stored = sessionStorage.getItem('shellActiveHallId');
        if (stored) {
          state.activeHallId = stored;
          var hh = state.halls.find(function (h) { return h.id === stored; });
          if (hh) state.activeHallName = hh.name;
        } else if (state.halls.length) {
          state.activeHallId = state.halls[0].id;
          state.activeHallName = state.halls[0].name;
        }
      } catch (e) {}
      return state.halls;
    }).catch(function () {
      state.halls = []; return [];
    });
  }

  function bindHallSelect() {
    var sel = document.getElementById('mk-hall-select');
    if (!sel) return;
    sel.addEventListener('change', function () {
      var newId = sel.value;
      if (!newId || newId === state.activeHallId) return;
      var newHall = state.halls.find(function (h) { return h.id === newId; });
      if (!newHall) return;
      state.activeHallId = newId;
      state.activeHallName = newHall.name;
      try { sessionStorage.setItem('shellActiveHallId', newId); } catch (e) {}
      // Notify host bridge if available (Unity / shell handover)
      try {
        if (typeof window.SwitchActiveHallFromHost === 'function') {
          window.SwitchActiveHallFromHost(newId);
        }
      } catch (e) {}
      // refresh compliance for new hall
      loadCompliance().then(function () {
        renderHallCard();
        showToast('Aktiv hall: ' + newHall.name);
      });
    });
  }

  // ── Initial data load ────────────────────────────────────────────────
  function loadCompliance() {
    var path = '/api/wallet/me/compliance' + (state.activeHallId ? '?hallId=' + encodeURIComponent(state.activeHallId) : '');
    return api(path).then(function (c) {
      state.compliance = c || {};
    }).catch(function () { state.compliance = {}; });
  }

  function loadProfile() {
    return api('/api/auth/me').then(function (p) {
      state.profile = p || {};
    }).catch(function () { state.profile = {}; });
  }

  function loadWallet() {
    return api('/api/wallet/me').then(function (w) {
      state.wallet = w || {};
      if (w && w.transactions) state.transactions = w.transactions;
    }).catch(function () { state.wallet = { account: { balance: 0 } }; });
  }

  function loadAll() {
    state.loading = true;
    return Promise.all([
      loadProfile(),
      loadWallet(),
      loadHalls(),
    ]).then(function () {
      return loadCompliance();
    }).then(function () {
      state.loading = false;
      renderHeaderFields();
      renderHallCard();
      renderMenu();
    });
  }

  // ── Top-level event binding ──────────────────────────────────────────
  function bindEvents(root) {
    root.addEventListener('click', function (e) {
      var t = e.target;
      // Backdrop click on desktop (when screen is centered) — close overlay.
      // Only fires when click target IS the root overlay (not bubbled).
      if (t === root) {
        hide();
        return;
      }
      var back = t.closest && t.closest('[data-mk-back]');
      if (back) {
        var subId = back.getAttribute('data-mk-back');
        closeSub(subId);
        return;
      }
      var actionEl = t.closest && t.closest('[data-mk-action]');
      if (actionEl) {
        var action = actionEl.getAttribute('data-mk-action');
        if (action === 'overfor') openSub('mk-sub-overfor', renderOverfor);
        if (action === 'transaksjoner') openSub('mk-sub-transaksjoner', renderTransaksjoner);
      }
      var editEl = t.closest && t.closest('[data-mk-edit]');
      if (editEl) {
        openSub('mk-sub-personlig', renderPersonlig);
        // Defer edit-mode swap so the sub-screen is mounted first.
        setTimeout(openPersonligEdit, 0);
      }
    });

    var closeBtn = root.querySelector('#mk-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { hide(); });

    var logout = root.querySelector('#mk-logout');
    if (logout) logout.addEventListener('click', function () {
      if (!confirm('Logge ut?')) return;
      api('/api/auth/logout', { method: 'POST' }).finally(function () {
        try { sessionStorage.clear(); } catch (e) {}
        try { localStorage.removeItem('accessToken'); } catch (e) {}
        window.location.reload();
      });
    });

    // ESC to close
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('is-open')) {
        // close most recent open sub first
        var openSubs = root.querySelectorAll('.mk-subscreen.is-open');
        if (openSubs.length) {
          openSubs[openSubs.length - 1].classList.remove('is-open');
        } else {
          hide();
        }
      }
    });

    bindHallSelect();
  }

  // ── Public API ───────────────────────────────────────────────────────
  function show() {
    var el = buildOverlay();
    el.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    loadAll().catch(function (err) {
      showToast('Kunne ikke laste konto: ' + (err.message || 'feil'), 'error');
    });
  }

  function hide() {
    var el = document.getElementById('mk-overlay');
    if (el) el.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  window.ShowMinKontoPanel = show;
  window.HideMinKontoPanel = hide;

  // Auto-build on DOMContentLoaded so first click is fast
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildOverlay);
  } else {
    buildOverlay();
  }
})();
