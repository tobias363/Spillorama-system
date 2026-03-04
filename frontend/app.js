/* global io */

const socket = io();
const AUTH_STORAGE_KEY = "bingo.portal.auth";

const state = {
  accessToken: "",
  sessionExpiresAt: "",
  user: null,
  games: [],
  selectedGameSlug: "",
  adminGames: [],
  halls: [],
  selectedHallId: "",
  roomCode: "",
  playerId: "",
  snapshot: null,
  walletState: null,
  lastSwedbankIntentId: "",
  lastSwedbankCheckoutUrl: "",
  swedbankStatusPollTimer: null,
  swedbankStatusPollInFlight: false
};

const els = {
  appHeader: document.getElementById("appHeader"),
  activeGameLabel: document.getElementById("activeGameLabel"),
  gamesNav: document.getElementById("gamesNav"),
  walletMiniId: document.getElementById("walletMiniId"),
  walletMiniBalance: document.getElementById("walletMiniBalance"),
  walletTopupAmount: document.getElementById("walletTopupAmount"),
  walletTopupBtn: document.getElementById("walletTopupBtn"),
  walletSwedbankIntentBtn: document.getElementById("walletSwedbankIntentBtn"),
  walletRefreshBtn: document.getElementById("walletRefreshBtn"),
  userBadge: document.getElementById("userBadge"),
  logoutBtn: document.getElementById("logoutBtn"),
  swedbankCheckoutModal: document.getElementById("swedbankCheckoutModal"),
  swedbankCheckoutTitle: document.getElementById("swedbankCheckoutTitle"),
  swedbankCheckoutStatus: document.getElementById("swedbankCheckoutStatus"),
  swedbankCheckoutFrame: document.getElementById("swedbankCheckoutFrame"),
  swedbankConfirmBtn: document.getElementById("swedbankConfirmBtn"),
  swedbankOpenExternalBtn: document.getElementById("swedbankOpenExternalBtn"),
  swedbankCloseBtn: document.getElementById("swedbankCloseBtn"),

  authView: document.getElementById("authView"),
  appView: document.getElementById("appView"),

  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginBtn: document.getElementById("loginBtn"),
  loginStatus: document.getElementById("loginStatus"),

  registerDisplayName: document.getElementById("registerDisplayName"),
  registerEmail: document.getElementById("registerEmail"),
  registerPassword: document.getElementById("registerPassword"),
  registerBtn: document.getElementById("registerBtn"),
  registerStatus: document.getElementById("registerStatus"),

  kycCard: document.getElementById("kycCard"),
  kycBirthDate: document.getElementById("kycBirthDate"),
  kycVerifyBtn: document.getElementById("kycVerifyBtn"),
  kycStatus: document.getElementById("kycStatus"),

  walletStatus: document.getElementById("walletStatus"),

  candyView: document.getElementById("candyView"),
  candyStatus: document.getElementById("candyStatus"),

  bingoView: document.getElementById("bingoView"),
  bingoHallId: document.getElementById("bingoHallId"),
  bingoPlayerAlias: document.getElementById("bingoPlayerAlias"),
  bingoRoomCode: document.getElementById("bingoRoomCode"),
  bingoEntryFee: document.getElementById("bingoEntryFee"),
  bingoCreateRoomBtn: document.getElementById("bingoCreateRoomBtn"),
  bingoJoinRoomBtn: document.getElementById("bingoJoinRoomBtn"),
  bingoStartGameBtn: document.getElementById("bingoStartGameBtn"),
  bingoEndGameBtn: document.getElementById("bingoEndGameBtn"),
  bingoDrawNextBtn: document.getElementById("bingoDrawNextBtn"),
  bingoClaimLineBtn: document.getElementById("bingoClaimLineBtn"),
  bingoClaimBingoBtn: document.getElementById("bingoClaimBingoBtn"),
  bingoStatus: document.getElementById("bingoStatus"),
  bingoPlayers: document.getElementById("bingoPlayers"),
  bingoDrawnNumbers: document.getElementById("bingoDrawnNumbers"),
  bingoTickets: document.getElementById("bingoTickets"),

  adminGameCard: document.getElementById("adminGameCard"),
  adminGameTitle: document.getElementById("adminGameTitle"),
  adminGameDescription: document.getElementById("adminGameDescription"),
  adminGameRoute: document.getElementById("adminGameRoute"),
  adminGameSortOrder: document.getElementById("adminGameSortOrder"),
  adminGameEnabled: document.getElementById("adminGameEnabled"),
  adminGameSettingsJson: document.getElementById("adminGameSettingsJson"),
  adminSaveGameBtn: document.getElementById("adminSaveGameBtn"),
  adminGameStatus: document.getElementById("adminGameStatus")
};

function setStatusBox(element, text, tone = "neutral") {
  if (!element) {
    return;
  }
  element.textContent = text;
  element.classList.remove("error", "success");
  if (tone === "error") {
    element.classList.add("error");
  }
  if (tone === "success") {
    element.classList.add("success");
  }
}

function setSwedbankModalVisible(visible) {
  if (!els.swedbankCheckoutModal) {
    return;
  }
  els.swedbankCheckoutModal.classList.toggle("hidden", !visible);
  document.body.classList.toggle("modal-open", visible);
}

function stopSwedbankStatusPolling() {
  if (state.swedbankStatusPollTimer) {
    window.clearInterval(state.swedbankStatusPollTimer);
    state.swedbankStatusPollTimer = null;
  }
  state.swedbankStatusPollInFlight = false;
}

function closeSwedbankCheckoutModal() {
  stopSwedbankStatusPolling();
  setSwedbankModalVisible(false);
  if (els.swedbankCheckoutFrame) {
    els.swedbankCheckoutFrame.removeAttribute("src");
  }
}

function openSwedbankCheckoutModal(intent) {
  if (!els.swedbankCheckoutModal || !els.swedbankCheckoutFrame) {
    return false;
  }

  const preferredUrl = (intent?.viewUrl || intent?.redirectUrl || "").trim();
  if (!preferredUrl) {
    return false;
  }

  state.lastSwedbankCheckoutUrl = preferredUrl;
  els.swedbankCheckoutFrame.src = preferredUrl;
  if (els.swedbankCheckoutTitle) {
    els.swedbankCheckoutTitle.textContent = `Swedbank betaling (${intent?.amountMajor ?? "-"} ${intent?.currency ?? "NOK"})`;
  }
  setSwedbankModalVisible(true);
  return true;
}

function formatSwedbankIntentLines(intent) {
  return [
    `Intent: ${intent.id}`,
    `Reference: ${intent.orderReference}`,
    `Beløp: ${intent.amountMajor} ${intent.currency}`,
    `Status: ${intent.status}`,
    intent.creditedAt ? `Kreditert: ${intent.creditedAt}` : "Kreditert: Nei ennå"
  ];
}

async function applySwedbankIntentStatus(intent, tone = "success") {
  state.lastSwedbankIntentId = intent.id;
  if (intent.viewUrl || intent.redirectUrl) {
    state.lastSwedbankCheckoutUrl = (intent.viewUrl || intent.redirectUrl || "").trim();
  }

  const lines = formatSwedbankIntentLines(intent);
  setStatusBox(els.walletStatus, lines.join("\n"), tone);
  setStatusBox(els.swedbankCheckoutStatus, lines.join("\n"), tone);

  if (intent.status === "CREDITED") {
    stopSwedbankStatusPolling();
    await loadWalletState();
    await refreshRoomStateIfConnected();
  }
}

async function refreshSwedbankIntentStatus(intentId, confirm = false) {
  if (!intentId) {
    throw new Error("Mangler intentId.");
  }
  if (confirm) {
    return api("/api/payments/swedbank/confirm", {
      method: "POST",
      body: { intentId }
    });
  }
  return api(`/api/payments/swedbank/intents/${encodeURIComponent(intentId)}?refresh=true`);
}

function startSwedbankStatusPolling(intentId) {
  stopSwedbankStatusPolling();
  if (!intentId) {
    return;
  }

  state.swedbankStatusPollTimer = window.setInterval(async () => {
    if (state.swedbankStatusPollInFlight) {
      return;
    }
    state.swedbankStatusPollInFlight = true;
    try {
      const intent = await refreshSwedbankIntentStatus(intentId, false);
      await applySwedbankIntentStatus(intent);
    } catch (error) {
      setStatusBox(
        els.swedbankCheckoutStatus,
        error.message || "Klarte ikke hente status fra Swedbank.",
        "error"
      );
    } finally {
      state.swedbankStatusPollInFlight = false;
    }
  }, 8000);
}

function saveAuthToStorage() {
  if (!state.accessToken) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      accessToken: state.accessToken,
      sessionExpiresAt: state.sessionExpiresAt
    })
  );
}

function loadAuthFromStorage() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed?.accessToken === "string") {
      state.accessToken = parsed.accessToken;
      state.sessionExpiresAt = typeof parsed?.sessionExpiresAt === "string" ? parsed.sessionExpiresAt : "";
    }
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

function resetAuthState() {
  closeSwedbankCheckoutModal();
  state.accessToken = "";
  state.sessionExpiresAt = "";
  state.user = null;
  state.games = [];
  state.selectedGameSlug = "";
  state.adminGames = [];
  state.halls = [];
  state.selectedHallId = "";
  state.roomCode = "";
  state.playerId = "";
  state.snapshot = null;
  state.walletState = null;
  state.lastSwedbankIntentId = "";
  state.lastSwedbankCheckoutUrl = "";
  saveAuthToStorage();
}

async function api(path, options = {}) {
  const { method = "GET", body, auth = true } = options;
  const headers = {};

  if (auth) {
    if (!state.accessToken) {
      throw new Error("Ikke innlogget.");
    }
    headers.Authorization = `Bearer ${state.accessToken}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Ugyldig svar fra server (${response.status}).`);
  }

  if (!json?.ok) {
    const errorCode = json?.error?.code;
    if (errorCode === "UNAUTHORIZED") {
      handleUnauthorized("Innlogging utløpt. Logg inn igjen.");
    }
    throw new Error(json?.error?.message || `API-feil (${response.status}).`);
  }

  return json.data;
}

function emitWithAck(eventName, payload) {
  const payloadWithToken =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...payload, accessToken: state.accessToken || undefined }
      : payload;
  return new Promise((resolve) => {
    socket.emit(eventName, payloadWithToken, (response) => resolve(response));
  });
}

function currentGame() {
  return state.games.find((game) => game.slug === state.selectedGameSlug) || null;
}

function currentAdminGame() {
  if (!state.adminGames.length) {
    return null;
  }
  return state.adminGames.find((game) => game.slug === state.selectedGameSlug) || state.adminGames[0] || null;
}

function isAdmin() {
  return state.user?.role === "ADMIN";
}

function getMyRoomPlayer() {
  if (!state.snapshot?.players?.length || !state.user) {
    return null;
  }
  if (state.playerId) {
    const byId = state.snapshot.players.find((player) => player.id === state.playerId);
    if (byId) {
      return byId;
    }
  }
  return state.snapshot.players.find((player) => player.walletId === state.user.walletId) || null;
}

function syncWalletBalanceFromRoomSnapshot() {
  if (!state.user) {
    return;
  }
  const myPlayer = getMyRoomPlayer();
  if (!myPlayer || !Number.isFinite(myPlayer.balance)) {
    return;
  }

  if (!state.walletState) {
    state.walletState = {
      account: {
        id: state.user.walletId,
        balance: myPlayer.balance,
        createdAt: state.user.createdAt,
        updatedAt: new Date().toISOString()
      },
      transactions: []
    };
  } else {
    state.walletState.account.balance = myPlayer.balance;
  }

  state.user.balance = myPlayer.balance;
}

function renderLayoutForAuth() {
  const loggedIn = Boolean(state.user && state.accessToken);
  els.authView.classList.toggle("hidden", loggedIn);
  els.appView.classList.toggle("hidden", !loggedIn);
  els.appHeader.classList.toggle("hidden", !loggedIn);
}

function renderUserBadge() {
  if (!state.user) {
    els.userBadge.textContent = "Ikke innlogget";
    return;
  }
  els.userBadge.textContent = `${state.user.displayName} (${state.user.role})`;
}

function renderGamesNav() {
  els.gamesNav.innerHTML = "";
  if (!state.games.length) {
    els.activeGameLabel.textContent = "Ingen spill tilgjengelig";
    return;
  }

  for (const game of state.games) {
    const button = document.createElement("button");
    button.textContent = game.title;
    button.classList.toggle("active", game.slug === state.selectedGameSlug);
    button.addEventListener("click", () => {
      state.selectedGameSlug = game.slug;
      renderSelectedGame();
    });
    els.gamesNav.appendChild(button);
  }

  const selected = currentGame();
  els.activeGameLabel.textContent = selected
    ? `${selected.title} (${selected.route})`
    : "Ingen spill valgt";
}

function renderCandyCard() {
  const game = state.games.find((entry) => entry.slug === "candy") || currentGame();
  if (!game) {
    setStatusBox(els.candyStatus, "Candy er ikke aktivert i game-katalogen.", "error");
    return;
  }

  const lines = [
    `Slug: ${game.slug}`,
    `Route: ${game.route}`,
    `Aktivt: ${game.isEnabled ? "Ja" : "Nei"}`,
    "",
    game.description || "Ingen beskrivelse.",
    "",
    `Settings: ${JSON.stringify(game.settings || {}, null, 2)}`
  ];
  setStatusBox(els.candyStatus, lines.join("\n"));
}

function renderWalletMini() {
  if (!state.user) {
    els.walletMiniId.textContent = "Wallet: -";
    els.walletMiniBalance.textContent = "Saldo: 0";
    return;
  }

  const balance =
    state.walletState?.account?.balance ??
    (Number.isFinite(state.user.balance) ? state.user.balance : 0);
  els.walletMiniId.textContent = `Wallet: ${state.user.walletId}`;
  els.walletMiniBalance.textContent = `Saldo: ${balance}`;
}

function renderKycCard() {
  if (!els.kycStatus) {
    return;
  }
  if (!state.user) {
    setStatusBox(els.kycStatus, "Ikke innlogget.");
    if (els.kycVerifyBtn) {
      els.kycVerifyBtn.disabled = true;
    }
    return;
  }

  const status = state.user.kycStatus || "UNVERIFIED";
  const lines = [
    `Status: ${status}`,
    `Fødselsdato: ${state.user.birthDate || "-"}`,
    `Verifisert: ${state.user.kycVerifiedAt || "-"}`
  ];
  const tone = status === "VERIFIED" ? "success" : status === "REJECTED" ? "error" : "neutral";
  setStatusBox(els.kycStatus, lines.join("\n"), tone);

  if (els.kycBirthDate && state.user.birthDate) {
    els.kycBirthDate.value = state.user.birthDate;
  }
  if (els.kycVerifyBtn) {
    els.kycVerifyBtn.disabled = status === "VERIFIED";
  }
}

function renderWalletCard() {
  if (!state.user) {
    setStatusBox(els.walletStatus, "Ikke innlogget.");
    return;
  }

  if (!state.walletState) {
    setStatusBox(els.walletStatus, "Laster wallet...");
    return;
  }

  const lines = [
    `Wallet: ${state.walletState.account.id}`,
    `Saldo: ${state.walletState.account.balance}`,
    "",
    "Siste transaksjoner:"
  ];

  const transactions = Array.isArray(state.walletState.transactions)
    ? state.walletState.transactions
    : [];

  if (!transactions.length) {
    lines.push("- Ingen transaksjoner enda.");
  } else {
    for (const tx of transactions.slice(0, 12)) {
      const related = tx.relatedAccountId ? ` -> ${tx.relatedAccountId}` : "";
      lines.push(`- ${tx.type} ${tx.amount}${related} (${tx.reason})`);
    }
  }

  setStatusBox(els.walletStatus, lines.join("\n"));
}

function renderBingoStatus(text, tone = "neutral") {
  setStatusBox(els.bingoStatus, text, tone);
}

function renderBingoHallSelect() {
  if (!els.bingoHallId) {
    return;
  }

  els.bingoHallId.innerHTML = "";
  const halls = Array.isArray(state.halls) ? state.halls : [];
  if (!halls.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Ingen aktive haller";
    els.bingoHallId.appendChild(option);
    els.bingoHallId.disabled = true;
    return;
  }

  for (const hall of halls) {
    const option = document.createElement("option");
    option.value = hall.id;
    option.textContent = `${hall.name} (${hall.slug})`;
    els.bingoHallId.appendChild(option);
  }

  ensureDefaultSelectedHall();
  els.bingoHallId.value = state.selectedHallId || halls[0].id;
  state.selectedHallId = els.bingoHallId.value;
  els.bingoHallId.disabled = false;
}

function renderBingoPlayers() {
  const players = state.snapshot?.players || [];
  if (!players.length) {
    els.bingoPlayers.innerHTML = "<p>Ingen spillere.</p>";
    return;
  }

  const rows = players
    .map((player) => {
      const host = player.id === state.snapshot.hostPlayerId ? " (host)" : "";
      const me = player.id === state.playerId ? " (deg)" : "";
      return `<tr><td>${player.name}${host}${me}</td><td>${player.balance}</td><td>${player.walletId}</td></tr>`;
    })
    .join("");

  els.bingoPlayers.innerHTML = `
    <table class="players">
      <thead>
        <tr><th>Spiller</th><th>Saldo</th><th>Wallet</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderBingoDrawnNumbers() {
  const game = state.snapshot?.currentGame;
  if (!game) {
    els.bingoDrawnNumbers.innerHTML = "";
    return;
  }

  els.bingoDrawnNumbers.innerHTML = game.drawnNumbers
    .map((number) => `<span class="chip">${number}</span>`)
    .join("");
}

async function markTicketNumber(number) {
  const response = await emitWithAck("ticket:mark", {
    roomCode: state.roomCode,
    playerId: state.playerId,
    number
  });

  if (!response?.ok) {
    renderBingoStatus(response?.error?.message || "Klarte ikke markere tall.", "error");
    return;
  }

  state.snapshot = response.data.snapshot;
  renderBingoState();
}

function renderBingoTickets() {
  const game = state.snapshot?.currentGame;
  if (!game) {
    els.bingoTickets.innerHTML = "<p>Start et spill for å se brett.</p>";
    return;
  }

  const players = state.snapshot.players || [];
  const cards = players.map((player) => {
    const rawTickets = game.tickets[player.id];
    const playerTickets = Array.isArray(rawTickets) ? rawTickets : rawTickets ? [rawTickets] : [];
    if (!playerTickets.length) {
      return "";
    }

    const marks = new Set(game.marks[player.id] || []);
    const isMe = player.id === state.playerId;

    const ticketsHtml = playerTickets
      .map((ticket, ticketIndex) => {
        const rowsHtml = ticket.grid
          .map((row) => {
            const cells = row
              .map((value) => {
                const isFree = value === 0;
                const isMarked = isFree || marks.has(value);
                const canClick =
                  isMe && !isFree && game.status === "RUNNING" && game.drawnNumbers.includes(value) && !isMarked;

                return `
                  <td class="${isFree ? "free" : ""} ${isMarked ? "marked" : ""} ${
                    canClick ? "clickable" : ""
                  }" data-number="${value}">
                    ${isFree ? "FREE" : value}
                  </td>`;
              })
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");

        return `
          <article class="ticket" data-player-id="${player.id}" data-ticket-index="${ticketIndex}">
            <h3>${player.name}${isMe ? " (deg)" : ""} - Bong ${ticketIndex + 1}</h3>
            <table class="ticket-grid"><tbody>${rowsHtml}</tbody></table>
          </article>`;
      })
      .join("");

    return `<article class="ticket" data-player-id="${player.id}">${ticketsHtml}</article>`;
  });

  els.bingoTickets.innerHTML = `<div class="ticket-list">${cards.join("")}</div>`;

  els.bingoTickets.querySelectorAll(".ticket-grid td.clickable").forEach((cell) => {
    cell.addEventListener("click", async (event) => {
      const target = event.currentTarget;
      const number = Number(target.dataset.number);
      if (!Number.isFinite(number)) {
        return;
      }
      await markTicketNumber(number);
    });
  });
}

function renderBingoState() {
  if (!state.snapshot) {
    renderBingoStatus("Ikke tilkoblet rom.");
    els.bingoPlayers.innerHTML = "";
    els.bingoDrawnNumbers.innerHTML = "";
    els.bingoTickets.innerHTML = "<p>Ingen aktive data.</p>";
    return;
  }

  const game = state.snapshot.currentGame;
  const lines = [
    `Rom: ${state.snapshot.code}`,
    `Hall: ${state.snapshot.hallId || state.selectedHallId || "-"}`,
    `Spiller-ID: ${state.playerId || "-"}`,
    game
      ? `Spill: ${game.status} | Trukket: ${game.drawnNumbers.length} | Gjenstår: ${game.remainingNumbers}${
          game.endedReason ? ` | Årsak: ${game.endedReason}` : ""
        }`
      : "Spill: Ikke startet",
    `Historikk (fullførte runder): ${state.snapshot.gameHistory?.length || 0}`
  ];

  renderBingoStatus(lines.join("\n"));
  renderBingoPlayers();
  renderBingoDrawnNumbers();
  renderBingoTickets();

  syncWalletBalanceFromRoomSnapshot();
  renderWalletMini();
  renderWalletCard();
}

function renderAdminEditor() {
  if (!isAdmin()) {
    els.adminGameCard.classList.add("hidden");
    return;
  }

  els.adminGameCard.classList.remove("hidden");
  const game = currentAdminGame();
  if (!game) {
    setStatusBox(els.adminGameStatus, "Ingen spill å redigere.", "error");
    return;
  }

  els.adminGameTitle.value = game.title || "";
  els.adminGameDescription.value = game.description || "";
  els.adminGameRoute.value = game.route || "";
  els.adminGameSortOrder.value = String(game.sortOrder ?? 100);
  els.adminGameEnabled.checked = Boolean(game.isEnabled);
  els.adminGameSettingsJson.value = JSON.stringify(game.settings || {}, null, 2);

  setStatusBox(
    els.adminGameStatus,
    `Redigerer: ${game.slug}\nVelg spill i header for å bytte hvilket spill du redigerer.`
  );
}

function renderSelectedGame() {
  renderGamesNav();

  const game = currentGame();
  const slug = game?.slug || "";

  els.candyView.classList.toggle("hidden", slug !== "candy");
  els.bingoView.classList.toggle("hidden", slug !== "bingo");

  renderCandyCard();
  if (slug === "bingo") {
    renderBingoHallSelect();
    renderBingoState();
  }
  renderAdminEditor();
}

function renderAfterLogin() {
  renderLayoutForAuth();
  renderUserBadge();
  renderWalletMini();
  renderKycCard();
  renderWalletCard();
  renderSelectedGame();
}

function handleUnauthorized(message) {
  resetAuthState();
  renderLayoutForAuth();
  setStatusBox(els.loginStatus, message, "error");
  setStatusBox(els.registerStatus, "Session avsluttet.");
}

async function loadWalletState() {
  const walletData = await api("/api/wallet/me");
  state.walletState = walletData;
  if (state.user && walletData?.account && Number.isFinite(walletData.account.balance)) {
    state.user.balance = walletData.account.balance;
  }
  renderWalletMini();
  renderWalletCard();
}

function ensureDefaultSelectedGame() {
  if (!state.games.length) {
    state.selectedGameSlug = "";
    return;
  }

  const stillExists = state.games.some((game) => game.slug === state.selectedGameSlug);
  if (stillExists) {
    return;
  }

  state.selectedGameSlug = state.games[0].slug;
}

function ensureDefaultSelectedHall() {
  if (state.snapshot?.hallId) {
    state.selectedHallId = state.snapshot.hallId;
    if (els.bingoHallId) {
      els.bingoHallId.value = state.selectedHallId;
    }
    return;
  }

  if (!state.halls.length) {
    state.selectedHallId = "";
    return;
  }

  const stillExists = state.halls.some((hall) => hall.id === state.selectedHallId);
  if (stillExists) {
    return;
  }

  state.selectedHallId = state.halls[0].id;
}

async function loadAuthenticatedData() {
  const [me, games, halls] = await Promise.all([
    api("/api/auth/me"),
    api("/api/games"),
    api("/api/halls")
  ]);

  state.user = me;
  state.games = Array.isArray(games) ? games : [];
  state.halls = Array.isArray(halls) ? halls : [];
  ensureDefaultSelectedGame();
  ensureDefaultSelectedHall();

  if (isAdmin()) {
    const adminGames = await api("/api/admin/games");
    state.adminGames = Array.isArray(adminGames) ? adminGames : [];
  } else {
    state.adminGames = [];
  }

  await loadWalletState();
}

async function bootFromToken() {
  if (!state.accessToken) {
    renderLayoutForAuth();
    return;
  }

  try {
    await loadAuthenticatedData();
    renderAfterLogin();
    setStatusBox(els.loginStatus, "Innlogget.", "success");
    setStatusBox(els.registerStatus, "Klar.");
  } catch (error) {
    handleUnauthorized(error.message || "Kunne ikke laste profil.");
  }
}

async function onRegister() {
  const displayName = (els.registerDisplayName.value || "").trim();
  const email = (els.registerEmail.value || "").trim();
  const password = els.registerPassword.value || "";

  if (!displayName || !email || !password) {
    setStatusBox(els.registerStatus, "Fyll ut navn, e-post og passord.", "error");
    return;
  }

  try {
    const session = await api("/api/auth/register", {
      method: "POST",
      auth: false,
      body: { displayName, email, password }
    });

    state.accessToken = session.accessToken;
    state.sessionExpiresAt = session.expiresAt;
    saveAuthToStorage();

    await bootFromToken();
    setStatusBox(els.registerStatus, "Bruker opprettet og logget inn.", "success");
  } catch (error) {
    setStatusBox(els.registerStatus, error.message || "Kunne ikke opprette bruker.", "error");
  }
}

async function onLogin() {
  const email = (els.loginEmail.value || "").trim();
  const password = els.loginPassword.value || "";

  if (!email || !password) {
    setStatusBox(els.loginStatus, "Fyll inn e-post og passord.", "error");
    return;
  }

  try {
    const session = await api("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password }
    });

    state.accessToken = session.accessToken;
    state.sessionExpiresAt = session.expiresAt;
    saveAuthToStorage();

    await bootFromToken();
    setStatusBox(els.loginStatus, "Innlogging OK.", "success");
  } catch (error) {
    setStatusBox(els.loginStatus, error.message || "Innlogging feilet.", "error");
  }
}

async function onLogout() {
  try {
    if (state.accessToken) {
      await api("/api/auth/logout", { method: "POST" });
    }
  } catch {
    // Ignore logout API failure and clear local state anyway.
  }

  resetAuthState();
  renderLayoutForAuth();
  renderUserBadge();
  renderWalletMini();
  renderKycCard();
  renderWalletCard();
  renderBingoState();
  setStatusBox(els.loginStatus, "Du er logget ut.", "success");
}

async function onWalletRefresh() {
  try {
    await loadWalletState();
    setStatusBox(els.walletStatus, els.walletStatus.textContent, "success");
  } catch (error) {
    setStatusBox(els.walletStatus, error.message || "Klarte ikke hente wallet.", "error");
  }
}

async function onKycVerify() {
  try {
    if (!state.user) {
      throw new Error("Du må være innlogget.");
    }
    const birthDate = (els.kycBirthDate?.value || "").trim();
    if (!birthDate) {
      throw new Error("Velg fødselsdato.");
    }

    const data = await api("/api/kyc/verify", {
      method: "POST",
      body: { birthDate }
    });
    if (data?.user) {
      state.user = data.user;
    }
    renderKycCard();
  } catch (error) {
    setStatusBox(els.kycStatus, error.message || "KYC-verifisering feilet.", "error");
  }
}

function parseTopupAmount() {
  const amount = Number(els.walletTopupAmount.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Beløp må være større enn 0.");
  }
  return amount;
}

async function refreshRoomStateIfConnected() {
  if (!state.roomCode) {
    return;
  }
  const response = await emitWithAck("room:state", { roomCode: state.roomCode });
  if (response?.ok) {
    state.snapshot = response.data.snapshot;
    renderBingoState();
  }
}

async function onWalletTopup() {
  try {
    const amount = parseTopupAmount();
    const intent = await api("/api/payments/swedbank/topup-intent", {
      method: "POST",
      body: { amount }
    });
    await applySwedbankIntentStatus(intent);
    const opened = openSwedbankCheckoutModal(intent);
    if (!opened) {
      setStatusBox(
        els.walletStatus,
        "Mottok ingen iframe-url fra Swedbank. Bruk 'Åpne i ny fane' hvis URL finnes.",
        "error"
      );
      return;
    }
    startSwedbankStatusPolling(intent.id);
  } catch (error) {
    setStatusBox(els.walletStatus, error.message || "Top-up feilet.", "error");
  }
}

async function onSwedbankIntent() {
  try {
    const intentId = (state.lastSwedbankIntentId || "").trim();
    if (!intentId) {
      throw new Error("Ingen aktiv Swedbank intent. Trykk 'Fyll på' først.");
    }

    const intent = await refreshSwedbankIntentStatus(intentId, true);
    await applySwedbankIntentStatus(intent);
  } catch (error) {
    setStatusBox(els.walletStatus, error.message || "Klarte ikke avstemme Swedbank intent.", "error");
  }
}

function onSwedbankClose() {
  closeSwedbankCheckoutModal();
}

function onSwedbankOpenExternal() {
  const url = (state.lastSwedbankCheckoutUrl || "").trim();
  if (!url) {
    setStatusBox(els.walletStatus, "Ingen checkout-url tilgjengelig.", "error");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function buildRoomIdentityPayload() {
  const alias = (els.bingoPlayerAlias.value || "").trim();
  const hallId = (state.selectedHallId || els.bingoHallId?.value || "").trim();
  return {
    accessToken: state.accessToken,
    playerName: alias || undefined,
    hallId: hallId || undefined
  };
}

function requireBingoIdentity() {
  if (!state.accessToken || !state.user) {
    throw new Error("Du må være innlogget.");
  }
}

function requireSelectedHall() {
  const hallId = (state.selectedHallId || els.bingoHallId?.value || "").trim();
  if (!hallId) {
    throw new Error("Velg hall før du oppretter eller joiner rom.");
  }
  state.selectedHallId = hallId;
}

function requireJoinedRoom() {
  if (!state.roomCode || !state.playerId) {
    throw new Error("Du må opprette eller joine et rom først.");
  }
}

async function onBingoCreateRoom() {
  try {
    requireBingoIdentity();
    requireSelectedHall();
    const response = await emitWithAck("room:create", buildRoomIdentityPayload());
    if (!response?.ok) {
      throw new Error(response?.error?.message || "Klarte ikke opprette rom.");
    }

    state.roomCode = response.data.roomCode;
    state.playerId = response.data.playerId;
    state.snapshot = response.data.snapshot;
    state.selectedHallId = response.data.snapshot?.hallId || state.selectedHallId;
    els.bingoRoomCode.value = state.roomCode;
    renderBingoState();
  } catch (error) {
    renderBingoStatus(error.message || "Klarte ikke opprette rom.", "error");
  }
}

async function onBingoJoinRoom() {
  try {
    requireBingoIdentity();
    requireSelectedHall();
    const roomCode = (els.bingoRoomCode.value || "").trim().toUpperCase();
    if (!roomCode) {
      throw new Error("Skriv inn romkode.");
    }

    const response = await emitWithAck("room:join", {
      roomCode,
      ...buildRoomIdentityPayload()
    });

    if (!response?.ok) {
      throw new Error(response?.error?.message || "Klarte ikke joine rom.");
    }

    state.roomCode = response.data.roomCode;
    state.playerId = response.data.playerId;
    state.snapshot = response.data.snapshot;
    state.selectedHallId = response.data.snapshot?.hallId || state.selectedHallId;
    els.bingoRoomCode.value = state.roomCode;
    renderBingoState();
  } catch (error) {
    renderBingoStatus(error.message || "Klarte ikke joine rom.", "error");
  }
}

async function onBingoStartGame() {
  try {
    requireJoinedRoom();
    const entryFee = Number(els.bingoEntryFee.value || 0);

    const response = await emitWithAck("game:start", {
      roomCode: state.roomCode,
      playerId: state.playerId,
      entryFee
    });

    if (!response?.ok) {
      throw new Error(response?.error?.message || "Klarte ikke starte spill.");
    }

    state.snapshot = response.data.snapshot;
    await loadWalletState();
    renderBingoState();
  } catch (error) {
    renderBingoStatus(error.message || "Klarte ikke starte spill.", "error");
  }
}

async function onBingoEndGame() {
  try {
    requireJoinedRoom();

    const response = await emitWithAck("game:end", {
      roomCode: state.roomCode,
      playerId: state.playerId,
      reason: "Manual end from client"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.message || "Klarte ikke avslutte spill.");
    }

    state.snapshot = response.data.snapshot;
    renderBingoState();
  } catch (error) {
    renderBingoStatus(error.message || "Klarte ikke avslutte spill.", "error");
  }
}

async function onBingoDrawNext() {
  try {
    requireJoinedRoom();

    const response = await emitWithAck("draw:next", {
      roomCode: state.roomCode,
      playerId: state.playerId
    });

    if (!response?.ok) {
      throw new Error(response?.error?.message || "Klarte ikke trekke neste tall.");
    }

    state.snapshot = response.data.snapshot;
    renderBingoState();
  } catch (error) {
    renderBingoStatus(error.message || "Klarte ikke trekke neste tall.", "error");
  }
}

async function onBingoClaim(type) {
  try {
    requireJoinedRoom();

    const response = await emitWithAck("claim:submit", {
      roomCode: state.roomCode,
      playerId: state.playerId,
      type
    });

    if (!response?.ok) {
      throw new Error(response?.error?.message || "Claim feilet.");
    }

    state.snapshot = response.data.snapshot;
    await loadWalletState();
    renderBingoState();
  } catch (error) {
    renderBingoStatus(error.message || "Claim feilet.", "error");
  }
}

async function onAdminSaveGame() {
  const game = currentAdminGame();
  if (!game) {
    setStatusBox(els.adminGameStatus, "Fant ikke spill å lagre.", "error");
    return;
  }

  let settings;
  try {
    settings = JSON.parse(els.adminGameSettingsJson.value || "{}");
  } catch {
    setStatusBox(els.adminGameStatus, "Settings JSON er ugyldig.", "error");
    return;
  }

  try {
    await api(`/api/admin/games/${encodeURIComponent(game.slug)}`, {
      method: "PUT",
      body: {
        title: (els.adminGameTitle.value || "").trim(),
        description: (els.adminGameDescription.value || "").trim(),
        route: (els.adminGameRoute.value || "").trim(),
        sortOrder: Number(els.adminGameSortOrder.value || 0),
        isEnabled: els.adminGameEnabled.checked,
        settings
      }
    });

    const [games, adminGames] = await Promise.all([api("/api/games"), api("/api/admin/games")]);
    state.games = Array.isArray(games) ? games : [];
    state.adminGames = Array.isArray(adminGames) ? adminGames : [];
    ensureDefaultSelectedGame();

    renderSelectedGame();
    setStatusBox(els.adminGameStatus, `Lagret ${game.slug}.`, "success");
  } catch (error) {
    setStatusBox(els.adminGameStatus, error.message || "Lagring feilet.", "error");
  }
}

socket.on("room:update", (snapshot) => {
  if (!state.user || !state.accessToken) {
    return;
  }

  if (state.roomCode && snapshot?.code === state.roomCode) {
    state.snapshot = snapshot;
    if (snapshot?.hallId) {
      state.selectedHallId = snapshot.hallId;
    }
    renderBingoState();
  }
});

socket.on("connect", () => {
  if (state.selectedGameSlug === "bingo") {
    renderBingoStatus("Tilkoblet server. Opprett eller join et rom.");
  }
});

socket.on("disconnect", () => {
  if (state.selectedGameSlug === "bingo") {
    renderBingoStatus("Frakoblet server.", "error");
  }
});

els.loginBtn.addEventListener("click", onLogin);
els.registerBtn.addEventListener("click", onRegister);
els.logoutBtn.addEventListener("click", onLogout);

els.walletRefreshBtn.addEventListener("click", onWalletRefresh);
els.walletTopupBtn.addEventListener("click", onWalletTopup);
els.walletSwedbankIntentBtn.addEventListener("click", onSwedbankIntent);
if (els.swedbankCloseBtn) {
  els.swedbankCloseBtn.addEventListener("click", onSwedbankClose);
}
if (els.swedbankConfirmBtn) {
  els.swedbankConfirmBtn.addEventListener("click", onSwedbankIntent);
}
if (els.swedbankOpenExternalBtn) {
  els.swedbankOpenExternalBtn.addEventListener("click", onSwedbankOpenExternal);
}
if (els.swedbankCheckoutModal) {
  els.swedbankCheckoutModal.addEventListener("click", (event) => {
    if (event.target === els.swedbankCheckoutModal) {
      onSwedbankClose();
    }
  });
}
if (els.kycVerifyBtn) {
  els.kycVerifyBtn.addEventListener("click", onKycVerify);
}

if (els.bingoHallId) {
  els.bingoHallId.addEventListener("change", () => {
    state.selectedHallId = (els.bingoHallId.value || "").trim();
  });
}

els.bingoCreateRoomBtn.addEventListener("click", onBingoCreateRoom);
els.bingoJoinRoomBtn.addEventListener("click", onBingoJoinRoom);
els.bingoStartGameBtn.addEventListener("click", onBingoStartGame);
els.bingoEndGameBtn.addEventListener("click", onBingoEndGame);
els.bingoDrawNextBtn.addEventListener("click", onBingoDrawNext);
els.bingoClaimLineBtn.addEventListener("click", () => onBingoClaim("LINE"));
els.bingoClaimBingoBtn.addEventListener("click", () => onBingoClaim("BINGO"));

els.adminSaveGameBtn.addEventListener("click", onAdminSaveGame);

function initialRender() {
  closeSwedbankCheckoutModal();
  renderLayoutForAuth();
  renderUserBadge();
  renderWalletMini();
  renderKycCard();
  renderWalletCard();
  renderBingoState();
  setStatusBox(els.loginStatus, "Ikke logget inn.");
  setStatusBox(els.registerStatus, "Ikke opprettet bruker ennå.");
}

async function bootstrap() {
  initialRender();
  try {
    const url = new URL(window.location.href);
    const intentFromUrl = (url.searchParams.get("swedbank_intent") || "").trim();
    if (intentFromUrl) {
      state.lastSwedbankIntentId = intentFromUrl;
      setStatusBox(
        els.walletStatus,
        `Fant swedbank_intent i URL: ${intentFromUrl}\nTrykk \"Bekreft betaling\" for å oppdatere status.`,
        "success"
      );
    }
  } catch {
    // Ignore URL parse errors.
  }
  loadAuthFromStorage();
  await bootFromToken();
}

bootstrap();
