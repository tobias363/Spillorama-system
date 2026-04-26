// BIN-264/265: Web Shell Lobby
// Web-native lobby: shows game tiles, hall selector, wallet balance. All
// bingo games (1-5) run in the Pixi/HTML game-client; Candy runs in its
// own iframe overlay. Unity-loader code was removed 2026-04-21 — the Unity
// build was never present in dev and its `web.loader.js` 404 spammed the
// console with SyntaxError/createUnityInstance-not-defined on every load.
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
    error: ''
  };

  // ── Spillorama games ──────────────────────────────────────────────────
  // Display names and game numbers are stable identifiers used in routing.
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
            description: g.description,
            settings: settings
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

    // Notify web game client of hall change
    window.dispatchEvent(new CustomEvent('spillorama:hallChanged', {
      detail: { hallId: hallId, hallName: hall ? hall.name : hallId }
    }));

    // Immediately refresh balance for the new hall context
    refreshBalanceNow();

    await loadCompliance();
    renderLobby();
  }

  // Populates any hall <select> element with current lobbyState.halls
  function renderHallSelect(el) {
    if (!el) return;
    // Always sync the value; only skip full rebuild if options are already populated
    if (el.options.length > 1 && el.querySelector('option[value="' + lobbyState.activeHallId + '"]')) {
      el.value = lobbyState.activeHallId;
      return;
    }
    el.innerHTML = '';
    if (lobbyState.halls.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'Ingen haller tilgjengelig';
      opt.value = '';
      el.appendChild(opt);
      el.disabled = true;
    } else {
      lobbyState.halls.forEach(function (hall) {
        const opt = document.createElement('option');
        opt.value = hall.id;
        opt.textContent = hall.name;
        opt.selected = hall.id === lobbyState.activeHallId;
        el.appendChild(opt);
      });
      el.disabled = false;
      el.value = lobbyState.activeHallId;
    }
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

    // Candy special case — iframe overlay (independent of Unity)
    if (game.slug === 'candy') {
      if (typeof window.launchCandyOverlay === 'function') {
        window.launchCandyOverlay();
      }
      return;
    }

    // All bingo games (game_1..game_5) run in the Pixi/HTML web client.
    loadWebGame(game);
  }

  // ── Web game client (PixiJS/HTML) ───────────────────────────────────────

  var webGameLoading = false;

  async function loadWebGame(game) {
    if (webGameLoading) return;
    webGameLoading = true;

    var lobbyEl = document.getElementById('lobby-screen');
    var webContainer = document.getElementById('web-game-container');
    var backBar = document.getElementById('lobby-back-bar');

    // Hide lobby, show web container
    if (lobbyEl) lobbyEl.style.display = 'none';
    if (webContainer) webContainer.style.display = 'block';
    if (backBar) backBar.classList.add('is-visible');
    if (typeof window.syncGameBar === 'function') window.syncGameBar();
    startGameBarBalancePoll();
    startGameBarSocketSync();

    try {
      // Dynamic import of the web game client (stable path, no hash)
      var module = await import('/web/games/main.js');
      if (module.mountGame) {
        module.mountGame(webContainer, {
          gameSlug: game.slug,
          accessToken: getToken(),
          hallId: lobbyState.activeHallId,
          serverUrl: window.location.origin,
        });
      } else {
        throw new Error('web game client loaded but mountGame export missing');
      }
    } catch (err) {
      console.error('[lobby] Failed to load web game client:', err);
      // Web client is the only engine now — show a user-visible error and
      // return to lobby so the player isn't stranded on a blank screen.
      if (webContainer) webContainer.style.display = 'none';
      if (lobbyEl) lobbyEl.style.display = '';
      if (backBar) backBar.classList.remove('is-visible');
      if (typeof window.showLobbyToast === 'function') {
        window.showLobbyToast('Kunne ikke starte spillet. Prøv igjen.', 'error');
      }
    }

    webGameLoading = false;
  }

  // ── Game-bar saldo polling ────────────────────────────────────────────────
  // While a game is active the lobby's 30s status refresh keeps #lobby-balance
  // updated (and renderLobby copies it to #game-bar-balance). We also run a
  // dedicated wallet poll every 30 s so balance reflects recent round results.
  var _gameBarWalletInterval = null;

  // Wallet-split: vis deposit-saldo og winnings-gevinst som separate chips.
  // Backend /api/wallet/me returnerer:
  //   { balance, depositBalance, winningsBalance,            ← brutto (inkl. reservasjoner)
  //     reservedDeposit, reservedWinnings,                    ← låst i pre-round-bonger
  //     availableDeposit, availableWinnings, availableBalance } ← brutto - reservert
  //
  // Header-chip-en SKAL vise tilgjengelig (etter reservasjoner). Forhåndskjøp
  // på ventende runde reserverer beløpet via wallet_reservations — chip-en
  // må reflektere dette umiddelbart, ellers ser saldoen ut som den ikke
  // oppdateres når brukeren kjøper bonger til neste runde mens aktiv runde
  // kjører (BIN-693 + PR #495 round-state-isolation regression-fix 2026-04-25).
  //
  // "Lommebok"-detalj-siden bruker fortsatt brutto-saldo (`balance`) — det
  // er riktig regnskaps-info; det er kun chip-en som skal vise tilgjengelig.
  function applyWalletToHeader(account) {
    if (!account) return;
    // Foretrekk available-felt; fall tilbake til brutto for legacy-payloads
    // (game-client socket-events sender ikke nødvendigvis available-feltene).
    var depositAmt = (typeof account.availableDeposit === 'number')
      ? account.availableDeposit
      : (typeof account.depositBalance === 'number')
        ? account.depositBalance
        : account.balance;
    var winningsAmt = (typeof account.availableWinnings === 'number')
      ? account.availableWinnings
      : (typeof account.winningsBalance === 'number')
        ? account.winningsBalance
        : 0;
    var depositFormatted = formatKr(depositAmt);
    var winningsFormatted = formatKr(winningsAmt);

    var lobbyBalVal = document.querySelector('#lobby-balance .lobby-chip-value');
    var gameBalVal  = document.querySelector('#game-bar-balance .lobby-chip-value');
    var lobbyWinVal = document.querySelector('#lobby-winnings .lobby-chip-value');
    var gameWinVal  = document.querySelector('#game-bar-winnings .lobby-chip-value');
    if (lobbyBalVal) lobbyBalVal.textContent = depositFormatted;
    if (gameBalVal)  gameBalVal.textContent  = depositFormatted;
    if (lobbyWinVal) lobbyWinVal.textContent = winningsFormatted;
    if (gameWinVal)  gameWinVal.textContent  = winningsFormatted;
  }

  // Immediately fetch and update balance (used on hall switch + post-game-end)
  // Tobias 2026-04-26: cache-buster query-string fordi browser-HTTP-cache
  // returnerte stale wallet-data på etterfølgende game-ends (gevinst-konto
  // oppdaterte 1. gang men ikke 2. gang). `?_=Date.now()` tvinger fersk
  // round-trip uten cache-hit. Backend returnerer ikke Cache-Control: no-store
  // så vi må håndtere det client-side.
  async function refreshBalanceNow() {
    try {
      var wallet = await apiFetch('/api/wallet/me?_=' + Date.now());
      if (wallet?.account) {
        lobbyState.wallet = wallet;
        applyWalletToHeader(wallet.account);
      }
    } catch { /* network hiccup — ignore */ }
  }

  function startGameBarBalancePoll() {
    if (_gameBarWalletInterval) return; // already running
    _gameBarWalletInterval = setInterval(async function () {
      try {
        // Cache-buster (samme som refreshBalanceNow) — Tobias 2026-04-26.
        var wallet = await apiFetch('/api/wallet/me?_=' + Date.now());
        if (wallet?.account) {
          lobbyState.wallet = wallet;
          applyWalletToHeader(wallet.account);
        }
      } catch { /* network hiccup — ignore */ }
    }, 30000);
  }

  function stopGameBarBalancePoll() {
    if (_gameBarWalletInterval) {
      clearInterval(_gameBarWalletInterval);
      _gameBarWalletInterval = null;
    }
  }

  // Real-time balance sync from web game client socket events.
  // The game client dispatches 'spillorama:balanceChanged' on every room:update.
  //
  // Saldo-flash deep-dive 2026-04-26 (Tobias):
  // ─────────────────────────────────────────────
  // Tidligere forsøkte vi optimistisk client-side split-approximering basert på
  // ratioen winnings/total fra forrige snapshot. Det kollapset av to grunner:
  //
  //   1. Game-client emitterer `me.balance` fra `room:update`-payloaden, og
  //      backend setter `player.balance` til AVAILABLE-saldo (etter
  //      reservasjoner) i `refreshPlayerBalancesForWallet`, men til GROSS i
  //      `refreshPlayerObjectsFromWallet` (game-start). De to er ulike størrelser,
  //      men chip-en viser AVAILABLE. Ratio-approximeringen krysset disse domener.
  //
  //   2. `hasSplit=true`-grenen bygde et account-objekt UTEN
  //      `availableDeposit`/`availableWinnings`, så `applyWalletToHeader` falt
  //      tilbake til `depositBalance` (gross) → chip viste 400 i stedet for 256.
  //      Når debounced-refetch landet 250ms senere oppdaterte den seg til 256.
  //      Det var oscilleringen Tobias rapporterte (256 ↔ 400 på hver ball).
  //
  // Ny strategi: ALDRI gjør optimistisk split-rekonstruksjon. Når en
  // `spillorama:balanceChanged` kommer, og vi ikke har autoritative
  // available-felt i payloaden, scheduler vi bare en refetch fra
  // `/api/wallet/me` (debounced 250ms) og lar serveren være sannhetskilden.
  // Det gir én korrekt render i stedet for to (en feil + en korrigerende).
  //
  // Event-payload format vi forstår:
  //   { balance }                                                   — legacy (kun total)
  //   { balance, depositBalance, winningsBalance }                  — wallet-split (gross)
  //   { availableDeposit, availableWinnings, availableBalance, ... } — full available
  //
  // Kun den siste varianten kan rendres direkte uten refetch — alle andre
  // går via refetch.
  var _balanceSyncHandler = null;
  var _balanceRefetchTimer = null;
  var _balanceRefreshReqHandler = null;
  var _lastBalanceSeen = null; // dedup på event-nivå (gross-saldo fra socket)

  function _scheduleBalanceRefetch() {
    if (_balanceRefetchTimer) return;
    _balanceRefetchTimer = setTimeout(function () {
      _balanceRefetchTimer = null;
      refreshBalanceNow();
    }, 250); // debounce — rapid room:update bursts collapse to one fetch
  }

  function startGameBarSocketSync() {
    if (_balanceSyncHandler) return;
    _balanceSyncHandler = function (e) {
      var d = (e && e.detail) || {};
      var balance = (typeof d.balance === 'number') ? d.balance : null;
      var hasAvailable =
        typeof d.availableDeposit === 'number' &&
        typeof d.availableWinnings === 'number';

      // Path 1: Full available-payload — autoritativ, kan rendres direkte.
      if (hasAvailable) {
        var availAccount = {
          balance: (balance !== null)
            ? balance
            : (typeof d.availableBalance === 'number'
                ? d.availableBalance
                : d.availableDeposit + d.availableWinnings),
          depositBalance: (typeof d.depositBalance === 'number') ? d.depositBalance : d.availableDeposit,
          winningsBalance: (typeof d.winningsBalance === 'number') ? d.winningsBalance : d.availableWinnings,
          availableDeposit: d.availableDeposit,
          availableWinnings: d.availableWinnings,
          availableBalance: (typeof d.availableBalance === 'number') ? d.availableBalance : (d.availableDeposit + d.availableWinnings)
        };
        applyWalletToHeader(availAccount);
        if (lobbyState.wallet && lobbyState.wallet.account) {
          lobbyState.wallet.account.balance = availAccount.balance;
          lobbyState.wallet.account.depositBalance = availAccount.depositBalance;
          lobbyState.wallet.account.winningsBalance = availAccount.winningsBalance;
          lobbyState.wallet.account.availableDeposit = availAccount.availableDeposit;
          lobbyState.wallet.account.availableWinnings = availAccount.availableWinnings;
          lobbyState.wallet.account.availableBalance = availAccount.availableBalance;
        }
        _lastBalanceSeen = balance;
        return;
      }

      // Path 2: Kun total-balance (eller gross split uten available) — kan
      // IKKE rendres direkte, fordi vi ikke vet hvor mye som er reservert
      // (header-chip skal vise available, ikke gross). Dedup mot forrige
      // sett verdi for å unngå overflødige refetch'er, og scheduler én
      // autoritativ refetch.
      if (balance === null) return;
      if (_lastBalanceSeen !== null && balance === _lastBalanceSeen) {
        // Redundant event — bridge har allerede dedup, dette er en defensiv
        // sikkerhet for andre potensielle emitters (f.eks. hall-switch,
        // candy:balanceChanged), eller for tilfeller hvor bridgens cache er
        // invalidert (mount/unmount-cyclus mens lobby kjører).
        return;
      }
      _lastBalanceSeen = balance;
      _scheduleBalanceRefetch();
    };
    _balanceRefreshReqHandler = function () {
      _scheduleBalanceRefetch();
    };
    window.addEventListener('spillorama:balanceChanged', _balanceSyncHandler);
    window.addEventListener('spillorama:balanceRefreshRequested', _balanceRefreshReqHandler);
  }

  function stopGameBarSocketSync() {
    if (_balanceSyncHandler) {
      window.removeEventListener('spillorama:balanceChanged', _balanceSyncHandler);
      _balanceSyncHandler = null;
    }
    if (_balanceRefreshReqHandler) {
      window.removeEventListener('spillorama:balanceRefreshRequested', _balanceRefreshReqHandler);
      _balanceRefreshReqHandler = null;
    }
    if (_balanceRefetchTimer) {
      clearTimeout(_balanceRefetchTimer);
      _balanceRefetchTimer = null;
    }
    _lastBalanceSeen = null; // Reset event-dedup cache så ny start re-render'er korrekt.
  }

  // Called by the in-game back-button or shell when returning to lobby.
  window.returnToShellLobby = function returnToShellLobby() {
    const lobbyEl = document.getElementById('lobby-screen');
    const webContainer = document.getElementById('web-game-container');
    const backBar = document.getElementById('lobby-back-bar');
    if (lobbyEl) lobbyEl.style.display = '';
    if (backBar) backBar.classList.remove('is-visible');

    // Unmount web game client if active
    if (webContainer) {
      webContainer.style.display = 'none';
      if (window.__spilloramaGameClient && typeof window.__spilloramaGameClient.unmountGame === 'function') {
        window.__spilloramaGameClient.unmountGame();
      }
    }
    // Clear game name in bar
    var gameBarName = document.getElementById('game-bar-name');
    if (gameBarName) gameBarName.textContent = '';
    // Stop game-bar wallet poll + socket sync, refresh lobby data
    stopGameBarBalancePoll();
    stopGameBarSocketSync();
    loadLobbyData();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  function renderLobby() {
    const lobbyEl = document.getElementById('lobby-screen');
    if (!lobbyEl) return;

    // Top bar
    const userNameEl = document.getElementById('lobby-user-name');
    const hallSelectEl = document.getElementById('lobby-hall-select');

    // Saldo (deposit) + Gevinst (winnings) — begge i lobby + game-bar
    if (lobbyState.wallet?.account) {
      applyWalletToHeader(lobbyState.wallet.account);
    }

    if (userNameEl && lobbyState.user) {
      userNameEl.textContent = lobbyState.user.displayName || lobbyState.user.email || '';
    }

    // Hall selectors — lobby + game bar
    renderHallSelect(hallSelectEl);
    renderHallSelect(document.getElementById('game-bar-hall-select'));

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
            badge +
            '<span class="lobby-tile-title">' + escapeHtml(game.title) + '</span>' +
          '</div>' +
          (desc ? '<span class="lobby-tile-desc">' + escapeHtml(desc) + '</span>' : '') +
        '</div>' +
        (allowed ? '<div class="lobby-tile-play-btn">Spill n&#229;</div>' : '');

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
    if (!s) return '<span class="lobby-tile-status lobby-tile-status--open">&#9679; Åpen</span>';
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
    var thumbs = {
      'bingo':        'game_thumb_1.jpg',
      'rocket':       'game_thumb_2.jpg',
      'monsterbingo': 'game_thumb_3.jpg',
      'temabingo':    'game_thumb_4.jpg',
      'spillorama':   'game_thumb_5.jpg',
      'candy':        'game_thumb_candy.png',
      // fallback for old game_N slugs
      'game_1': 'game_thumb_1.jpg',
      'game_2': 'game_thumb_2.jpg',
      'game_3': 'game_thumb_3.jpg',
      'game_4': 'game_thumb_4.jpg',
      'game_5': 'game_thumb_5.jpg',
    };
    var src = thumbs[slug];
    if (src) {
      return '<img class="lobby-tile-thumb" src="' + src + '" alt="">';
    }
    // Fallback: bingo ball SVG
    return '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="#424242"/><circle cx="24" cy="24" r="16" fill="#616161"/><text x="24" y="29" text-anchor="middle" fill="#fff" font-size="18" font-weight="900">' + (slug ? slug.charAt(0).toUpperCase() : '?') + '</text></svg>';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function initLobby() {
    // Hall selectors — lobby topbar + game bar
    ['lobby-hall-select', 'game-bar-hall-select'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', function () { switchHall(this.value); });
    });

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
        // Open profile panel to wallet/deposit section
        if (typeof window.ShowSpillvettPanel === 'function') {
          window.ShowSpillvettPanel();
          // Scroll to deposit section after panel opens
          setTimeout(() => {
            const depositSection = document.getElementById('profile-deposit-btn');
            if (depositSection) depositSection.click();
          }, 150);
        }
      });
    }

    // Lommebok button — open profile/wallet panel
    const walletBtn = document.getElementById('lobby-wallet-btn');
    if (walletBtn) {
      walletBtn.addEventListener('click', function () {
        if (typeof window.ShowSpillvettPanel === 'function') {
          window.ShowSpillvettPanel();
        }
      });
    }

    // Alle Spill button — scroll lobby to top / return to lobby if in game
    const allGamesBtn = document.getElementById('lobby-all-games-btn');
    if (allGamesBtn) {
      allGamesBtn.addEventListener('click', function () {
        if (typeof window.returnToShellLobby === 'function') {
          window.returnToShellLobby();
        } else {
          const grid = document.getElementById('lobby-game-grid');
          if (grid) grid.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // Settings button — open profile panel (same as profile for now)
    const settingsBtn = document.getElementById('lobby-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
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
