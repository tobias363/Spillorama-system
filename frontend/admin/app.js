const ADMIN_TOKEN_KEY = "bingo_admin_access_token";

const elements = {
  loginCard: document.getElementById("loginCard"),
  adminCard: document.getElementById("adminCard"),
  loginStatus: document.getElementById("loginStatus"),
  adminStatus: document.getElementById("adminStatus"),
  adminIdentity: document.getElementById("adminIdentity"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  loginBtn: document.getElementById("loginBtn"),
  gameSelect: document.getElementById("gameSelect"),
  title: document.getElementById("title"),
  route: document.getElementById("route"),
  description: document.getElementById("description"),
  sortOrder: document.getElementById("sortOrder"),
  enabled: document.getElementById("enabled"),
  payoutPercentField: document.getElementById("payoutPercentField"),
  payoutPercent: document.getElementById("payoutPercent"),
  settingsJson: document.getElementById("settingsJson"),
  saveBtn: document.getElementById("saveBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  hallSelect: document.getElementById("hallSelect"),
  roomSelect: document.getElementById("roomSelect"),
  hostName: document.getElementById("hostName"),
  hostWalletId: document.getElementById("hostWalletId"),
  entryFee: document.getElementById("entryFee"),
  ticketsPerPlayer: document.getElementById("ticketsPerPlayer"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  refreshRoomsBtn: document.getElementById("refreshRoomsBtn"),
  startRoomBtn: document.getElementById("startRoomBtn"),
  drawNextBtn: document.getElementById("drawNextBtn"),
  endRoomBtn: document.getElementById("endRoomBtn"),
  roomStatus: document.getElementById("roomStatus")
};

const state = {
  token: "",
  user: null,
  games: [],
  halls: [],
  rooms: []
};

function setStatus(element, message, type) {
  element.textContent = message;
  element.classList.remove("error", "success");
  if (type === "error" || type === "success") {
    element.classList.add(type);
  }
}

function setLoading(button, isLoading, loadingLabel, defaultLabel) {
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingLabel : defaultLabel;
}

function getStoredToken() {
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) || "";
}

function setStoredToken(token) {
  if (!token) {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

async function apiRequest(path, options) {
  const requestOptions = options || {};
  const headers = {
    "Content-Type": "application/json",
    ...(requestOptions.headers || {})
  };

  if (requestOptions.auth && state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    method: requestOptions.method || "GET",
    headers,
    body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    const error = new Error(message);
    error.code = payload?.error?.code || "REQUEST_FAILED";
    throw error;
  }

  return payload.data;
}

function showLogin() {
  elements.loginCard.classList.remove("hidden");
  elements.adminCard.classList.add("hidden");
}

function showAdmin() {
  elements.loginCard.classList.add("hidden");
  elements.adminCard.classList.remove("hidden");
}

function getSelectedGame() {
  const slug = elements.gameSelect.value;
  return state.games.find((game) => game.slug === slug) || null;
}

function getSettingsObject(game) {
  const settings = game?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  return settings;
}

function parseCandyPayoutPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Candy utbetaling (%) må være et tall mellom 0 og 100.");
  }
  return Math.round(parsed * 100) / 100;
}

function renderCandyPayoutField(game) {
  const isCandy = game?.slug === "candy";
  if (!elements.payoutPercentField || !elements.payoutPercent) {
    return;
  }

  elements.payoutPercentField.classList.toggle("hidden", !isCandy);
  if (!isCandy) {
    elements.payoutPercent.value = "";
    return;
  }

  const settings = getSettingsObject(game);
  const payout = Number(settings.payoutPercent);
  elements.payoutPercent.value = Number.isFinite(payout) ? String(payout) : "0";
}

function renderSelectedGame() {
  const selected = getSelectedGame();
  if (!selected) {
    elements.title.value = "";
    elements.route.value = "";
    elements.description.value = "";
    elements.sortOrder.value = "0";
    elements.enabled.value = "false";
    renderCandyPayoutField(null);
    elements.settingsJson.value = "{}";
    return;
  }

  const settings = getSettingsObject(selected);
  elements.title.value = selected.title || "";
  elements.route.value = selected.route || "";
  elements.description.value = selected.description || "";
  elements.sortOrder.value = String(selected.sortOrder ?? 0);
  elements.enabled.value = selected.isEnabled ? "true" : "false";
  renderCandyPayoutField(selected);
  elements.settingsJson.value = JSON.stringify(settings, null, 2);
}

function renderGameOptions() {
  const previous = elements.gameSelect.value;
  elements.gameSelect.innerHTML = "";

  for (const game of state.games) {
    const option = document.createElement("option");
    option.value = game.slug;
    option.textContent = `${game.title} (${game.slug})`;
    elements.gameSelect.appendChild(option);
  }

  const canRestorePrevious = state.games.some((game) => game.slug === previous);
  elements.gameSelect.value = canRestorePrevious ? previous : state.games[0]?.slug || "";
  renderSelectedGame();
}

async function loadGames() {
  const games = await apiRequest("/api/admin/games", { auth: true });
  state.games = Array.isArray(games) ? games : [];
  renderGameOptions();
  setStatus(elements.adminStatus, `Lastet ${state.games.length} spill.`, "success");
}

function renderHallOptions() {
  const previous = elements.hallSelect.value;
  elements.hallSelect.innerHTML = "";

  for (const hall of state.halls) {
    const option = document.createElement("option");
    option.value = hall.id;
    option.textContent = `${hall.name} (${hall.slug})`;
    elements.hallSelect.appendChild(option);
  }

  const stillExists = state.halls.some((hall) => hall.id === previous);
  elements.hallSelect.value = stillExists ? previous : state.halls[0]?.id || "";
}

function formatRoomSummary(room) {
  return `${room.code} | hall=${room.hallId} | players=${room.playerCount} | status=${room.gameStatus}`;
}

function renderRoomOptions() {
  const previous = elements.roomSelect.value;
  elements.roomSelect.innerHTML = "";

  for (const room of state.rooms) {
    const option = document.createElement("option");
    option.value = room.code;
    option.textContent = formatRoomSummary(room);
    elements.roomSelect.appendChild(option);
  }

  const stillExists = state.rooms.some((room) => room.code === previous);
  elements.roomSelect.value = stillExists ? previous : state.rooms[0]?.code || "";
}

async function loadHalls() {
  const halls = await apiRequest("/api/admin/halls?includeInactive=false", { auth: true });
  state.halls = Array.isArray(halls) ? halls : [];
  renderHallOptions();
}

async function loadRooms() {
  const rooms = await apiRequest("/api/admin/rooms", { auth: true });
  state.rooms = Array.isArray(rooms) ? rooms : [];
  renderRoomOptions();
  if (elements.roomSelect.value) {
    await showSelectedRoomSnapshot();
  } else {
    setStatus(elements.roomStatus, "Ingen rom valgt.", undefined);
  }
}

async function showSelectedRoomSnapshot() {
  const roomCode = (elements.roomSelect.value || "").trim().toUpperCase();
  if (!roomCode) {
    setStatus(elements.roomStatus, "Ingen rom valgt.", undefined);
    return;
  }
  const snapshot = await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}`, { auth: true });
  const game = snapshot?.currentGame;
  setStatus(
    elements.roomStatus,
    [
      `Rom: ${snapshot.code}`,
      `Hall: ${snapshot.hallId}`,
      `Host playerId: ${snapshot.hostPlayerId}`,
      `Spillere: ${Array.isArray(snapshot.players) ? snapshot.players.length : 0}`,
      `Status: ${game?.status || "NONE"}`,
      `Trukket: ${game?.drawnNumbers?.length || 0}`
    ].join("\n"),
    "success"
  );
}

function getSelectedRoomCode() {
  const roomCode = (elements.roomSelect.value || "").trim().toUpperCase();
  if (!roomCode) {
    throw new Error("Velg rom først.");
  }
  return roomCode;
}

function getSelectedHallId() {
  const hallId = (elements.hallSelect.value || "").trim();
  if (!hallId) {
    throw new Error("Velg hall først.");
  }
  return hallId;
}

async function handleCreateRoom() {
  const hallId = getSelectedHallId();
  const hostName = (elements.hostName.value || "").trim();
  const hostWalletId = (elements.hostWalletId.value || "").trim();

  setLoading(elements.createRoomBtn, true, "Oppretter...", "Opprett rom");
  try {
    const result = await apiRequest("/api/admin/rooms", {
      method: "POST",
      auth: true,
      body: {
        hallId,
        hostName: hostName || undefined,
        hostWalletId: hostWalletId || undefined
      }
    });
    await loadRooms();
    elements.roomSelect.value = result.roomCode;
    setStatus(
      elements.roomStatus,
      [
        `Rom opprettet: ${result.roomCode}`,
        `Host playerId: ${result.playerId}`,
        `Hall: ${result.snapshot?.hallId || hallId}`,
        `Spillstatus: ${result.snapshot?.currentGame?.status || "NONE"}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(elements.roomStatus, error.message || "Klarte ikke opprette rom.", "error");
  } finally {
    setLoading(elements.createRoomBtn, false, "Oppretter...", "Opprett rom");
  }
}

async function handleStartRoom() {
  let entryFee = Number(elements.entryFee.value || 0);
  if (!Number.isFinite(entryFee) || entryFee < 0) {
    entryFee = 0;
  }
  const ticketsPerPlayer = Number.parseInt(elements.ticketsPerPlayer.value || "4", 10);
  if (!Number.isInteger(ticketsPerPlayer) || ticketsPerPlayer < 1 || ticketsPerPlayer > 5) {
    setStatus(elements.roomStatus, "ticketsPerPlayer må være et heltall mellom 1 og 5.", "error");
    return;
  }

  const roomCode = getSelectedRoomCode();
  setLoading(elements.startRoomBtn, true, "Starter...", "Start spill");
  try {
    const result = await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/start`, {
      method: "POST",
      auth: true,
      body: {
        entryFee,
        ticketsPerPlayer
      }
    });
    await loadRooms();
    setStatus(
      elements.roomStatus,
      [
        `Spill startet i rom ${result.roomCode}`,
        `Status: ${result.snapshot?.currentGame?.status || "-"}`,
        `Trukket: ${result.snapshot?.currentGame?.drawnNumbers?.length || 0}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(elements.roomStatus, error.message || "Klarte ikke starte spill.", "error");
  } finally {
    setLoading(elements.startRoomBtn, false, "Starter...", "Start spill");
  }
}

async function handleDrawNext() {
  const roomCode = getSelectedRoomCode();
  setLoading(elements.drawNextBtn, true, "Trekker...", "Trekk neste");
  try {
    const result = await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/draw-next`, {
      method: "POST",
      auth: true
    });
    await loadRooms();
    setStatus(
      elements.roomStatus,
      [
        `Rom: ${result.roomCode}`,
        `Neste tall: ${result.number}`,
        `Trukket totalt: ${result.snapshot?.currentGame?.drawnNumbers?.length || 0}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(elements.roomStatus, error.message || "Klarte ikke trekke neste tall.", "error");
  } finally {
    setLoading(elements.drawNextBtn, false, "Trekker...", "Trekk neste");
  }
}

async function handleEndRoom() {
  const roomCode = getSelectedRoomCode();
  setLoading(elements.endRoomBtn, true, "Avslutter...", "Avslutt spill");
  try {
    const result = await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/end`, {
      method: "POST",
      auth: true,
      body: {
        reason: "Manual end from admin panel"
      }
    });
    await loadRooms();
    setStatus(
      elements.roomStatus,
      [
        `Spill avsluttet i rom ${result.roomCode}`,
        `Status: ${result.snapshot?.currentGame?.status || "-"}`,
        `Årsak: ${result.snapshot?.currentGame?.endedReason || "-"}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(elements.roomStatus, error.message || "Klarte ikke avslutte spill.", "error");
  } finally {
    setLoading(elements.endRoomBtn, false, "Avslutter...", "Avslutt spill");
  }
}

function buildUpdatePayload(selectedGame) {
  let parsedSettings;
  try {
    parsedSettings = JSON.parse(elements.settingsJson.value || "{}");
  } catch (_error) {
    throw new Error("Settings JSON er ugyldig JSON.");
  }

  if (!parsedSettings || typeof parsedSettings !== "object" || Array.isArray(parsedSettings)) {
    throw new Error("Settings må være et JSON-objekt (ikke liste).\nEksempel: {\"key\":\"value\"}");
  }

  if (selectedGame?.slug === "candy") {
    const payoutPercent = parseCandyPayoutPercent(elements.payoutPercent.value || "0");
    parsedSettings = {
      ...parsedSettings,
      payoutPercent
    };
  }

  const sortOrder = Number.parseInt(elements.sortOrder.value || "0", 10);
  if (!Number.isFinite(sortOrder)) {
    throw new Error("Sortering må være et tall.");
  }

  return {
    title: elements.title.value.trim(),
    route: elements.route.value.trim(),
    description: elements.description.value.trim(),
    sortOrder,
    isEnabled: elements.enabled.value === "true",
    settings: parsedSettings
  };
}

async function handleLogin() {
  const email = elements.email.value.trim();
  const password = elements.password.value;

  if (!email || !password) {
    setStatus(elements.loginStatus, "Fyll inn både e-post og passord.", "error");
    return;
  }

  setLoading(elements.loginBtn, true, "Logger inn...", "Logg inn");
  setStatus(elements.loginStatus, "Prøver admin-login...", undefined);

  try {
    const session = await apiRequest("/api/admin/auth/login", {
      method: "POST",
      body: {
        email,
        password
      }
    });

    state.token = session.accessToken;
    state.user = session.user;
    setStoredToken(state.token);
    showAdmin();

    elements.adminIdentity.textContent = `Innlogget som ${session.user.displayName} (${session.user.email})`;
    setStatus(elements.loginStatus, "Innlogging OK.", "success");
    await Promise.all([loadGames(), loadHalls(), loadRooms()]);
    setStatus(elements.roomStatus, "Klar for backend-kontroll av rom/spill.");
  } catch (error) {
    state.token = "";
    state.user = null;
    setStoredToken("");
    showLogin();
    setStatus(elements.loginStatus, error.message || "Innlogging feilet.", "error");
  } finally {
    setLoading(elements.loginBtn, false, "Logger inn...", "Logg inn");
  }
}

async function handleLogout() {
  setLoading(elements.logoutBtn, true, "Logger ut...", "Logg ut");
  try {
    if (state.token) {
      await apiRequest("/api/admin/auth/logout", {
        method: "POST",
        auth: true
      });
    }
  } catch (_error) {
    // Ignore logout errors and clear local token anyway.
  } finally {
    state.token = "";
    state.user = null;
    state.games = [];
    state.halls = [];
    state.rooms = [];
    setStoredToken("");
    showLogin();
    setStatus(elements.loginStatus, "Logget ut.", "success");
    setStatus(elements.adminStatus, "Klar.", undefined);
    setStatus(elements.roomStatus, "Ingen rom valgt.", undefined);
    elements.adminIdentity.textContent = "";
    setLoading(elements.logoutBtn, false, "Logger ut...", "Logg ut");
  }
}

async function handleSave() {
  const selected = getSelectedGame();
  if (!selected) {
    setStatus(elements.adminStatus, "Ingen spill valgt.", "error");
    return;
  }

  let payload;
  try {
    payload = buildUpdatePayload(selected);
  } catch (error) {
    setStatus(elements.adminStatus, error.message || "Ugyldig input.", "error");
    return;
  }

  setLoading(elements.saveBtn, true, "Lagrer...", "Lagre");
  setStatus(elements.adminStatus, `Lagrer ${selected.slug}...`, undefined);

  try {
    const updatedGame = await apiRequest(`/api/admin/games/${encodeURIComponent(selected.slug)}`, {
      method: "PUT",
      auth: true,
      body: payload
    });

    state.games = state.games.map((game) => (game.slug === updatedGame.slug ? updatedGame : game));
    renderGameOptions();
    elements.gameSelect.value = updatedGame.slug;
    renderSelectedGame();

    setStatus(elements.adminStatus, `Lagret ${updatedGame.slug} kl ${new Date().toLocaleTimeString("nb-NO")}.`, "success");
  } catch (error) {
    setStatus(elements.adminStatus, error.message || "Lagring feilet.", "error");
  } finally {
    setLoading(elements.saveBtn, false, "Lagrer...", "Lagre");
  }
}

async function bootstrap() {
  elements.loginBtn.addEventListener("click", () => {
    handleLogin().catch((error) => {
      setStatus(elements.loginStatus, error.message || "Innlogging feilet.", "error");
    });
  });

  elements.password.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleLogin().catch((error) => {
        setStatus(elements.loginStatus, error.message || "Innlogging feilet.", "error");
      });
    }
  });

  elements.gameSelect.addEventListener("change", () => {
    renderSelectedGame();
    setStatus(elements.adminStatus, "Klar.", undefined);
  });

  elements.roomSelect.addEventListener("change", () => {
    showSelectedRoomSnapshot().catch((error) => {
      setStatus(elements.roomStatus, error.message || "Kunne ikke hente romstatus.", "error");
    });
  });

  elements.saveBtn.addEventListener("click", () => {
    handleSave().catch((error) => {
      setStatus(elements.adminStatus, error.message || "Lagring feilet.", "error");
    });
  });

  elements.reloadBtn.addEventListener("click", () => {
    loadGames().catch((error) => {
      setStatus(elements.adminStatus, error.message || "Kunne ikke laste spill.", "error");
    });
  });

  elements.refreshRoomsBtn.addEventListener("click", () => {
    Promise.all([loadHalls(), loadRooms()])
      .then(() => {
        setStatus(elements.roomStatus, "Romliste oppdatert.", "success");
      })
      .catch((error) => {
        setStatus(elements.roomStatus, error.message || "Kunne ikke oppdatere romliste.", "error");
      });
  });

  elements.createRoomBtn.addEventListener("click", () => {
    handleCreateRoom().catch((error) => {
      setStatus(elements.roomStatus, error.message || "Kunne ikke opprette rom.", "error");
    });
  });

  elements.startRoomBtn.addEventListener("click", () => {
    handleStartRoom().catch((error) => {
      setStatus(elements.roomStatus, error.message || "Kunne ikke starte spill.", "error");
    });
  });

  elements.drawNextBtn.addEventListener("click", () => {
    handleDrawNext().catch((error) => {
      setStatus(elements.roomStatus, error.message || "Kunne ikke trekke neste tall.", "error");
    });
  });

  elements.endRoomBtn.addEventListener("click", () => {
    handleEndRoom().catch((error) => {
      setStatus(elements.roomStatus, error.message || "Kunne ikke avslutte spill.", "error");
    });
  });

  elements.logoutBtn.addEventListener("click", () => {
    handleLogout().catch(() => undefined);
  });

  const storedToken = getStoredToken();
  if (!storedToken) {
    showLogin();
    return;
  }

  state.token = storedToken;
  try {
    const user = await apiRequest("/api/admin/auth/me", { auth: true });
    state.user = user;
    showAdmin();
    elements.adminIdentity.textContent = `Innlogget som ${user.displayName} (${user.email})`;
    await Promise.all([loadGames(), loadHalls(), loadRooms()]);
    setStatus(elements.roomStatus, "Klar for backend-kontroll av rom/spill.");
  } catch (_error) {
    state.token = "";
    state.user = null;
    setStoredToken("");
    showLogin();
    setStatus(elements.loginStatus, "Session utløpt. Logg inn på nytt.", "error");
  }
}

bootstrap().catch((error) => {
  showLogin();
  setStatus(elements.loginStatus, error.message || "Uventet feil ved oppstart.", "error");
});
