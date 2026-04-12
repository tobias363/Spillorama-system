// BIN-264/265: Web Shell Lobby
// Replaces Unity lobby. Shows game tiles, hall selector, wallet balance.
// Unity only loads when a game tile is clicked.
(function () {
  'use strict';

  const TOKEN_KEY = 'spillorama.accessToken';
  const USER_KEY = 'spillorama.user';
  const HALL_KEY = 'lobby.activeHallId';

  const lobbyState = {
    user: null,
    games: [],
    halls: [],
    wallet: null,
    compliance: null,
    gameStatus: {}, // BIN-266: slug → { status, nextRoundAt }
    activeHallId: '',
    loading: true,
    error: '',
    unityLoaded: false,
    unityLoading: false
  };

  // ── Spillorama Unity games ────────────────────────────────────────────
  // These are the actual games inside the Spillorama Unity build (Game1-5 + Candy).
  // Display names and game numbers match the Unity LobbyGameSelection.
  var SPILLORAMA_GAMES = [
    { gameNumber: 1, slug: 'game_1', title: 'Bingo',         description: '75-kulsbingo med flere spillvarianter' },
    { gameNumber: 2, slug: 'game_2', title: 'Rocket',        description: 'Tallspill med 3x3 brett og Lucky Number' },
    { gameNumber: 3, slug: 'game_3', title: 'Mønsterbingo',  description: 'Bingo med mønstergevinster' },
    { gameNumber: 4, slug: 'game_4', title: 'Temabingo',     description: 'Bingo med temaer og multiplikator' },
    { gameNumber: 5, slug: 'game_5', title: 'Spillorama',    description: 'Spillorama-bingo med bonusspill' },
    { gameNumber: 6, slug: 'candy',  title: 'Candy Mania',   description: 'Candy-spillet' }
  ];

  // ── API helpers ──────────────────────────────────────────────────────────

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function getUser() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  }

  // BIN-279: Use auth.js authenticatedFetch for auto-refresh on 401
  async function apiFetch(path) {
    if (window.SpilloramaAuth && typeof window.SpilloramaAuth.authenticatedFetch === 'function') {
      return window.SpilloramaAuth.authenticatedFetch(path);
    }
    // Fallback if auth.js not loaded yet
    var token = getToken();
    if (!token) throw new Error('Ikke innlogget');
    var res = await fetch(path, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json'
      }
    });
    var body = await res.json();
    if (!body.ok) throw new Error(body.error?.message || 'Feil ved henting av data');
    return body.data;
  }

  // ── Format helpers ───────────────────────────────────────────────────────

  function formatKr(value) {
    return new Intl.NumberFormat('nb-NO', {
      style: 'currency', currency: 'NOK',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  async function loadLobbyData() {
    lobbyState.loading = true;
    lobbyState.error = '';
    renderLobby();

    try {
      var [halls, wallet, apiGames, gameStatus] = await Promise.all([
        apiFetch('/api/halls'),
        apiFetch('/api/wallet/me'),
        apiFetch('/api/games').catch(function () { return null; }),
        apiFetch('/api/games/status').catch(function () { return {}; }) // BIN-266
      ]);

      if (Array.isArray(apiGames) && apiGames.length > 0) {
        lobbyState.games = apiGames.map(function (g) {
          var settings = g.settings || {};
          return {
            gameNumber: settings.gameNumber || 0,
            slug: g.slug,
            title: g.title,
            description: g.description
          };
        });
      } else {
        lobbyState.games = SPILLORAMA_GAMES;
      }
      lobbyState.halls = Array.isArray(halls) ? halls : [];
      lobbyState.wallet = wallet;
      lobbyState.gameStatus = (gameStatus && typeof gameStatus === 'object') ? gameStatus : {};
      lobbyState.user = getUser();

      // Restore or pick first hall
      const savedHall = sessionStorage.getItem(HALL_KEY) || '';
      if (savedHall && lobbyState.halls.find(h => h.id === savedHall)) {
        lobbyState.activeHallId = savedHall;
      } else if (lobbyState.halls.length > 0) {
        lobbyState.activeHallId = lobbyState.halls[0].id;
      }

      if (lobbyState.activeHallId) {
        sessionStorage.setItem(HALL_KEY, lobbyState.activeHallId);
        await loadCompliance();
      }
    } catch (err) {
      lobbyState.error = err.message || 'Kunne ikke laste lobby';
    } finally {
      lobbyState.loading = false;
      renderLobby();
      scheduleStatusRefresh(); // BIN-266: poll status every 30s
    }
  }

  async function loadCompliance() {
    if (!lobbyState.activeHallId) return;
    try {
      lobbyState.compliance = await apiFetch(
        '/api/wallet/me/compliance?hallId=' + encodeURIComponent(lobbyState.activeHallId)
      );
    } catch {
      lobbyState.compliance = null;
    }
  }

  function canPlay() {
    if (!lobbyState.compliance) return false;
    const r = lobbyState.compliance.restrictions;
    return !(r && r.isBlocked);
  }

  // ── Hall switch ──────────────────────────────────────────────────────────

  async function switchHall(hallId) {
    lobbyState.activeHallId = hallId;
    sessionStorage.setItem(HALL_KEY, hallId);

    // Sync to spillvett.js
    const hall = lobbyState.halls.find(h => h.id === hallId);
    if (typeof window.SetActiveHall === 'function') {
      window.SetActiveHall(hallId, hall ? hall.name : hallId);
    }

    await loadCompliance();
    renderLobby();
  }

  // ── Game launch ──────────────────────────────────────────────────────────

  function launchGame(game) {
    if (!canPlay()) return;

    // BIN-272: Sync auth token and hall to spillvett.js before any game launch
    var token = getToken();
    if (token) {
      sessionStorage.setItem('spillvett.token', token);
      if (typeof window.SetShellToken === 'function') {
        window.SetShellToken(token);
      }
    }
    if (lobbyState.activeHallId) {
      var hall = lobbyState.halls.find(function (h) { return h.id === lobbyState.activeHallId; });
      if (typeof window.SetActiveHall === 'function') {
        window.SetActiveHall(lobbyState.activeHallId, hall ? hall.name : lobbyState.activeHallId);
      }
    }

    // Candy special case — iframe overlay instead of Unity
    if (game.slug === 'candy') {
      if (typeof window.launchCandyOverlay === 'function') {
        window.launchCandyOverlay();
      }
      return;
    }

    // For bingo games — load Unity and navigate to the game
    loadUnityAndStartGame(game);
  }

  function loadUnityAndStartGame(game) {
    const lobbyEl = document.getElementById('lobby-screen');
    const unityContainer = document.getElementById('unity-container');
    const backBar = document.getElementById('lobby-back-bar');

    // Token and hall already synced in launchGame()

    if (lobbyState.unityLoaded) {
      // Unity already loaded, just navigate
      if (lobbyEl) lobbyEl.style.display = 'none';
      if (unityContainer) unityContainer.style.display = '';
      if (backBar) backBar.classList.add('is-visible');
      navigateUnityToGame(game);
      return;
    }

    if (lobbyState.unityLoading) return;
    lobbyState.unityLoading = true;

    // Show Unity container with loading bar
    if (lobbyEl) lobbyEl.style.display = 'none';
    if (unityContainer) unityContainer.style.display = '';
    if (backBar) backBar.classList.add('is-visible');

    // Load Unity loader script
    window._pendingGame = game;
    window._initUnity();

    // Mark as loaded once Unity instance is created (set by index.html)
    var checkLoaded = setInterval(function () {
      if (window._spilloramaUnityLoaded) {
        lobbyState.unityLoaded = true;
        lobbyState.unityLoading = false;
        clearInterval(checkLoaded);
      }
    }, 500);
  }

  function navigateUnityToGame(game) {
    if (typeof window.NavigateSpilloramaGame === 'function') {
      window.NavigateSpilloramaGame(game.gameNumber);
    }
  }

  // Called from Unity/host when returning to lobby
  window.returnToShellLobby = function returnToShellLobby() {
    const lobbyEl = document.getElementById('lobby-screen');
    const unityContainer = document.getElementById('unity-container');
    const backBar = document.getElementById('lobby-back-bar');
    if (lobbyEl) lobbyEl.style.display = '';
    if (unityContainer) unityContainer.style.display = 'none';
    if (backBar) backBar.classList.remove('is-visible');
    // Refresh data
    loadLobbyData();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  function renderLobby() {
    const lobbyEl = document.getElementById('lobby-screen');
    if (!lobbyEl) return;

    // Top bar
    const balanceEl = document.getElementById('lobby-balance');
    const userNameEl = document.getElementById('lobby-user-name');
    const hallSelectEl = document.getElementById('lobby-hall-select');

    if (balanceEl && lobbyState.wallet?.account) {
      balanceEl.textContent = formatKr(lobbyState.wallet.account.balance);
    }

    if (userNameEl && lobbyState.user) {
      userNameEl.textContent = lobbyState.user.displayName || lobbyState.user.email || '';
    }

    // Hall selector
    if (hallSelectEl) {
      const currentVal = hallSelectEl.value;
      if (currentVal !== lobbyState.activeHallId || hallSelectEl.options.length <= 1) {
        hallSelectEl.innerHTML = '';
        if (lobbyState.halls.length === 0) {
          const opt = document.createElement('option');
          opt.textContent = 'Ingen haller tilgjengelig';
          opt.value = '';
          hallSelectEl.appendChild(opt);
          hallSelectEl.disabled = true;
        } else {
          lobbyState.halls.forEach(function (hall) {
            const opt = document.createElement('option');
            opt.value = hall.id;
            opt.textContent = hall.name;
            opt.selected = hall.id === lobbyState.activeHallId;
            hallSelectEl.appendChild(opt);
          });
          hallSelectEl.disabled = false;
          hallSelectEl.value = lobbyState.activeHallId;
        }
      }
    }

    // Game grid
    const gridEl = document.getElementById('lobby-game-grid');
    if (!gridEl) return;

    if (lobbyState.loading) {
      gridEl.innerHTML = '<div class="lobby-loading">Laster spill...</div>';
      return;
    }

    if (lobbyState.error) {
      gridEl.innerHTML = '<div class="lobby-error">' + escapeHtml(lobbyState.error) + '</div>';
      return;
    }

    if (lobbyState.games.length === 0) {
      gridEl.innerHTML = '<div class="lobby-empty">Ingen spill tilgjengelig</div>';
      return;
    }

    const allowed = canPlay();
    gridEl.innerHTML = '';

    lobbyState.games.forEach(function (game) {
      const tile = document.createElement('button');
      tile.className = 'lobby-tile';
      tile.disabled = !allowed;
      tile.setAttribute('data-slug', game.slug);

      const icon = getGameIcon(game.slug);
      const desc = game.description || '';
      const badge = buildStatusBadge(game.slug);

      tile.innerHTML =
        '<div class="lobby-tile-icon">' + icon + '</div>' +
        '<div class="lobby-tile-info">' +
          '<div class="lobby-tile-title-row">' +
            '<span class="lobby-tile-title">' + escapeHtml(game.title) + '</span>' +
            badge +
          '</div>' +
          (desc ? '<span class="lobby-tile-desc">' + escapeHtml(desc) + '</span>' : '') +
        '</div>' +
        '<div class="lobby-tile-arrow">&#8250;</div>';

      tile.addEventListener('click', function () {
        launchGame(game);
      });
      gridEl.appendChild(tile);
    });

    // Compliance warning
    const warningEl = document.getElementById('lobby-compliance-warning');
    if (warningEl) {
      if (!allowed && lobbyState.compliance) {
        const r = lobbyState.compliance.restrictions;
        if (r && r.selfExclusion && r.selfExclusion.isActive) {
          warningEl.textContent = 'Du er selvutestengt. Spilling er ikke tillatt.';
        } else if (r && r.blockedBy === 'MANDATORY_PAUSE') {
          warningEl.textContent = 'Obligatorisk pause er aktiv (§ 66). Vent til pausen er over.';
        } else if (r && r.timedPause && r.timedPause.isActive) {
          warningEl.textContent = 'Frivillig pause er aktiv. Spilling er midlertidig stoppet.';
        } else {
          warningEl.textContent = 'Spilling er blokkert.';
        }
        warningEl.hidden = false;
      } else {
        warningEl.hidden = true;
      }
    }
  }

  // BIN-265: Status badge — reflects live state from GET /api/games/status
  function buildStatusBadge(slug) {
    var s = lobbyState.gameStatus[slug];
    if (!s) return '<span class="lobby-tile-status lobby-tile-status--closed">Stengt</span>';
    if (s.status === 'OPEN') {
      return '<span class="lobby-tile-status lobby-tile-status--open">&#9679; Åpen</span>';
    }
    if (s.status === 'STARTING') {
      var label = 'Starter snart';
      if (s.nextRoundAt) {
        try {
          var d = new Date(s.nextRoundAt);
          label = 'Starter ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
        } catch { /* ignore */ }
      }
      return '<span class="lobby-tile-status lobby-tile-status--starting">&#9679; ' + escapeHtml(label) + '</span>';
    }
    return '<span class="lobby-tile-status lobby-tile-status--closed">Stengt</span>';
  }

  // Refresh game status every 30 seconds without reloading everything
  var _statusRefreshTimer = null;
  function scheduleStatusRefresh() {
    if (_statusRefreshTimer) clearInterval(_statusRefreshTimer);
    _statusRefreshTimer = setInterval(async function () {
      try {
        var s = await apiFetch('/api/games/status');
        if (s && typeof s === 'object') {
          lobbyState.gameStatus = s;
          renderLobby();
        }
      } catch { /* ignore */ }
    }, 30000);
  }

  function getGameIcon(slug) {
    // Bingo ball style icons matching the Spillorama brand
    var icons = {
      'game_1': '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="#c62828"/><circle cx="24" cy="24" r="16" fill="#e53935"/><circle cx="24" cy="22" r="13" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><text x="24" y="29" text-anchor="middle" fill="#fff" font-size="18" font-weight="900">1</text></svg>',
      'game_2': '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="#1565c0"/><circle cx="24" cy="24" r="16" fill="#1e88e5"/><circle cx="24" cy="22" r="13" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><text x="24" y="29" text-anchor="middle" fill="#fff" font-size="18" font-weight="900">2</text></svg>',
      'game_3': '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="#2e7d32"/><circle cx="24" cy="24" r="16" fill="#43a047"/><circle cx="24" cy="22" r="13" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><text x="24" y="29" text-anchor="middle" fill="#fff" font-size="18" font-weight="900">3</text></svg>',
      'game_4': '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="#6a1b9a"/><circle cx="24" cy="24" r="16" fill="#8e24aa"/><circle cx="24" cy="22" r="13" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><text x="24" y="29" text-anchor="middle" fill="#fff" font-size="18" font-weight="900">4</text></svg>',
      'game_5': '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="#e65100"/><circle cx="24" cy="24" r="16" fill="#f57c00"/><circle cx="24" cy="22" r="13" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><text x="24" y="29" text-anchor="middle" fill="#fff" font-size="18" font-weight="900">5</text></svg>',
      'candy':  '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="#ad1457"/><circle cx="24" cy="24" r="16" fill="#d81b60"/><circle cx="24" cy="22" r="13" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><text x="24" y="29" text-anchor="middle" fill="#fff" font-size="16" font-weight="900">C</text></svg>'
    };
    return icons[slug] || '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="#424242"/><circle cx="24" cy="24" r="16" fill="#616161"/><text x="24" y="29" text-anchor="middle" fill="#fff" font-size="18" font-weight="900">' + (slug ? slug.charAt(0).toUpperCase() : '?') + '</text></svg>';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function initLobby() {
    const hallSelectEl = document.getElementById('lobby-hall-select');
    if (hallSelectEl) {
      hallSelectEl.addEventListener('change', function () {
        switchHall(this.value);
      });
    }

    const profileBtn = document.getElementById('lobby-profile-btn');
    if (profileBtn) {
      profileBtn.addEventListener('click', function () {
        if (typeof window.ShowSpillvettPanel === 'function') {
          window.ShowSpillvettPanel();
        }
      });
    }

    const depositBtn = document.getElementById('lobby-deposit-btn');
    if (depositBtn) {
      depositBtn.addEventListener('click', function () {
        // Open profile panel to wallet section
        if (typeof window.ShowSpillvettPanel === 'function') {
          window.ShowSpillvettPanel();
        }
      });
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  window.SpilloramaLobby = {
    load: loadLobbyData,
    init: initLobby,
    returnToLobby: window.returnToShellLobby
  };
})();
