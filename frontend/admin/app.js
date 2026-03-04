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

  hallEditorSelect: document.getElementById("hallEditorSelect"),
  hallSlug: document.getElementById("hallSlug"),
  hallName: document.getElementById("hallName"),
  hallRegion: document.getElementById("hallRegion"),
  hallAddress: document.getElementById("hallAddress"),
  hallIsActive: document.getElementById("hallIsActive"),
  createHallBtn: document.getElementById("createHallBtn"),
  saveHallBtn: document.getElementById("saveHallBtn"),
  reloadHallsBtn: document.getElementById("reloadHallsBtn"),
  hallStatus: document.getElementById("hallStatus"),

  terminalHallFilter: document.getElementById("terminalHallFilter"),
  terminalSelect: document.getElementById("terminalSelect"),
  terminalHallId: document.getElementById("terminalHallId"),
  terminalCode: document.getElementById("terminalCode"),
  terminalDisplayName: document.getElementById("terminalDisplayName"),
  terminalIsActive: document.getElementById("terminalIsActive"),
  createTerminalBtn: document.getElementById("createTerminalBtn"),
  saveTerminalBtn: document.getElementById("saveTerminalBtn"),
  reloadTerminalsBtn: document.getElementById("reloadTerminalsBtn"),
  terminalStatus: document.getElementById("terminalStatus"),

  configHallSelect: document.getElementById("configHallSelect"),
  configGameSelect: document.getElementById("configGameSelect"),
  configEnabled: document.getElementById("configEnabled"),
  configMaxTicketsPerPlayer: document.getElementById("configMaxTicketsPerPlayer"),
  configMinRoundIntervalMs: document.getElementById("configMinRoundIntervalMs"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  reloadConfigBtn: document.getElementById("reloadConfigBtn"),
  configStatus: document.getElementById("configStatus"),

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
  terminals: [],
  rooms: [],
  hallGameConfigs: []
};

function setStatus(element, message, type) {
  if (!element) {
    return;
  }
  element.textContent = message;
  element.classList.remove("error", "success");
  if (type === "error" || type === "success") {
    element.classList.add(type);
  }
}

function setLoading(button, isLoading, loadingLabel, defaultLabel) {
  if (!button) {
    return;
  }
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

function setSelectOptions(selectEl, options, selectedValue, placeholder) {
  if (!selectEl) {
    return;
  }

  selectEl.innerHTML = "";
  const normalizedOptions = Array.isArray(options) ? options : [];

  if (!normalizedOptions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder || "Ingen alternativer";
    selectEl.appendChild(option);
    selectEl.value = "";
    return;
  }

  for (const optionData of normalizedOptions) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    selectEl.appendChild(option);
  }

  const canReuseSelection = normalizedOptions.some((optionData) => optionData.value === selectedValue);
  selectEl.value = canReuseSelection ? selectedValue : normalizedOptions[0].value;
}

function asBooleanString(value) {
  return value ? "true" : "false";
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
  setSelectOptions(
    elements.gameSelect,
    state.games.map((game) => ({
      value: game.slug,
      label: `${game.title} (${game.slug})`
    })),
    previous,
    "Ingen spill"
  );

  const previousConfigGame = elements.configGameSelect.value;
  setSelectOptions(
    elements.configGameSelect,
    state.games.map((game) => ({
      value: game.slug,
      label: `${game.title} (${game.slug})`
    })),
    previousConfigGame,
    "Ingen spill"
  );

  renderSelectedGame();
  renderSelectedHallGameConfig();
}

async function loadGames() {
  const games = await apiRequest("/api/admin/games", { auth: true });
  state.games = Array.isArray(games) ? games : [];
  renderGameOptions();
  setStatus(elements.adminStatus, `Lastet ${state.games.length} spill.`, "success");
}

function getSelectedHallEditor() {
  const hallId = (elements.hallEditorSelect.value || "").trim();
  return state.halls.find((hall) => hall.id === hallId) || null;
}

function renderSelectedHallEditor() {
  const hall = getSelectedHallEditor();
  if (!hall) {
    elements.hallSlug.value = "";
    elements.hallName.value = "";
    elements.hallRegion.value = "";
    elements.hallAddress.value = "";
    elements.hallIsActive.value = "true";
    return;
  }

  elements.hallSlug.value = hall.slug || "";
  elements.hallName.value = hall.name || "";
  elements.hallRegion.value = hall.region || "";
  elements.hallAddress.value = hall.address || "";
  elements.hallIsActive.value = asBooleanString(Boolean(hall.isActive));
}

function renderHallOptions() {
  const previousEditor = elements.hallEditorSelect.value;
  const previousRoomHall = elements.hallSelect.value;
  const previousTerminalFilter = elements.terminalHallFilter.value;
  const previousTerminalHallId = elements.terminalHallId.value;
  const previousConfigHall = elements.configHallSelect.value;

  const hallOptionsAll = state.halls.map((hall) => ({
    value: hall.id,
    label: `${hall.name} (${hall.slug})${hall.isActive ? "" : " [INAKTIV]"}`
  }));

  const hallOptionsActive = state.halls
    .filter((hall) => hall.isActive)
    .map((hall) => ({
      value: hall.id,
      label: `${hall.name} (${hall.slug})`
    }));

  setSelectOptions(elements.hallEditorSelect, hallOptionsAll, previousEditor, "Ingen haller");
  setSelectOptions(elements.hallSelect, hallOptionsActive, previousRoomHall, "Ingen aktive haller");
  setSelectOptions(elements.terminalHallFilter, hallOptionsAll, previousTerminalFilter, "Ingen haller");
  setSelectOptions(elements.terminalHallId, hallOptionsAll, previousTerminalHallId, "Ingen haller");
  setSelectOptions(elements.configHallSelect, hallOptionsAll, previousConfigHall, "Ingen haller");

  renderSelectedHallEditor();
  renderSelectedHallGameConfig();
}

async function loadHalls() {
  const halls = await apiRequest("/api/admin/halls?includeInactive=true", { auth: true });
  state.halls = Array.isArray(halls) ? halls : [];
  renderHallOptions();
  setStatus(elements.hallStatus, `Lastet ${state.halls.length} haller.`, "success");
}

function getSelectedHallForConfig() {
  const hallId = (elements.configHallSelect.value || "").trim();
  if (!hallId) {
    throw new Error("Velg hall først.");
  }
  return hallId;
}

function getSelectedGameForConfig() {
  const gameSlug = (elements.configGameSelect.value || "").trim();
  if (!gameSlug) {
    throw new Error("Velg spill først.");
  }
  return gameSlug;
}

function renderSelectedHallGameConfig() {
  const selectedGameSlug = (elements.configGameSelect.value || "").trim();
  const config = state.hallGameConfigs.find((item) => item.gameSlug === selectedGameSlug);

  const defaultMaxTickets = 4;
  const defaultMinRoundIntervalMs = 30000;

  if (!config) {
    elements.configEnabled.value = "true";
    elements.configMaxTicketsPerPlayer.value = String(defaultMaxTickets);
    elements.configMinRoundIntervalMs.value = String(defaultMinRoundIntervalMs);
    return;
  }

  elements.configEnabled.value = asBooleanString(Boolean(config.isEnabled));
  elements.configMaxTicketsPerPlayer.value = String(config.maxTicketsPerPlayer ?? defaultMaxTickets);
  elements.configMinRoundIntervalMs.value = String(config.minRoundIntervalMs ?? defaultMinRoundIntervalMs);
}

async function loadHallGameConfigs() {
  const hallId = (elements.configHallSelect.value || "").trim();
  if (!hallId) {
    state.hallGameConfigs = [];
    renderSelectedHallGameConfig();
    setStatus(elements.configStatus, "Ingen hall valgt for konfig.");
    return;
  }

  const configs = await apiRequest(
    `/api/admin/halls/${encodeURIComponent(hallId)}/game-config?includeDisabled=true`,
    { auth: true }
  );
  state.hallGameConfigs = Array.isArray(configs) ? configs : [];
  renderSelectedHallGameConfig();
  setStatus(elements.configStatus, `Lastet ${state.hallGameConfigs.length} konfig-linjer for valgt hall.`, "success");
}

function getSelectedTerminal() {
  const terminalId = (elements.terminalSelect.value || "").trim();
  return state.terminals.find((terminal) => terminal.id === terminalId) || null;
}

function renderSelectedTerminal() {
  const terminal = getSelectedTerminal();
  if (!terminal) {
    elements.terminalCode.value = "";
    elements.terminalDisplayName.value = "";
    elements.terminalIsActive.value = "true";
    return;
  }

  elements.terminalHallId.value = terminal.hallId || elements.terminalHallId.value;
  elements.terminalCode.value = terminal.terminalCode || "";
  elements.terminalDisplayName.value = terminal.displayName || "";
  elements.terminalIsActive.value = asBooleanString(Boolean(terminal.isActive));
}

function renderTerminalOptions() {
  const previous = elements.terminalSelect.value;
  setSelectOptions(
    elements.terminalSelect,
    state.terminals.map((terminal) => ({
      value: terminal.id,
      label: `${terminal.terminalCode} (${terminal.displayName})${terminal.isActive ? "" : " [INAKTIV]"}`
    })),
    previous,
    "Ingen terminaler"
  );

  renderSelectedTerminal();
}

async function loadTerminals() {
  const hallFilter = (elements.terminalHallFilter.value || "").trim();
  const query = new URLSearchParams({ includeInactive: "true" });
  if (hallFilter) {
    query.set("hallId", hallFilter);
  }

  const terminals = await apiRequest(`/api/admin/terminals?${query.toString()}`, { auth: true });
  state.terminals = Array.isArray(terminals) ? terminals : [];
  renderTerminalOptions();
  setStatus(elements.terminalStatus, `Lastet ${state.terminals.length} terminaler.`, "success");
}

function formatRoomSummary(room) {
  return `${room.code} | hall=${room.hallId} | players=${room.playerCount} | status=${room.gameStatus}`;
}

function renderRoomOptions() {
  const previous = elements.roomSelect.value;
  setSelectOptions(
    elements.roomSelect,
    state.rooms.map((room) => ({
      value: room.code,
      label: formatRoomSummary(room)
    })),
    previous,
    "Ingen rom"
  );
}

async function loadRooms() {
  const rooms = await apiRequest("/api/admin/rooms", { auth: true });
  state.rooms = Array.isArray(rooms) ? rooms : [];
  renderRoomOptions();
  if ((elements.roomSelect.value || "").trim()) {
    await showSelectedRoomSnapshot();
  } else {
    setStatus(elements.roomStatus, "Ingen rom valgt.");
  }
}

async function showSelectedRoomSnapshot() {
  const roomCode = (elements.roomSelect.value || "").trim().toUpperCase();
  if (!roomCode) {
    setStatus(elements.roomStatus, "Ingen rom valgt.");
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

function getSelectedRoomHallId() {
  const hallId = (elements.hallSelect.value || "").trim();
  if (!hallId) {
    throw new Error("Velg hall først.");
  }
  return hallId;
}

async function handleCreateRoom() {
  const hallId = getSelectedRoomHallId();
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

function buildGameUpdatePayload(selectedGame) {
  let parsedSettings;
  try {
    parsedSettings = JSON.parse(elements.settingsJson.value || "{}");
  } catch (_error) {
    throw new Error("Settings JSON er ugyldig JSON.");
  }

  if (!parsedSettings || typeof parsedSettings !== "object" || Array.isArray(parsedSettings)) {
    throw new Error("Settings må være et JSON-objekt (ikke liste).");
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

async function handleSaveGame() {
  const selected = getSelectedGame();
  if (!selected) {
    setStatus(elements.adminStatus, "Ingen spill valgt.", "error");
    return;
  }

  let payload;
  try {
    payload = buildGameUpdatePayload(selected);
  } catch (error) {
    setStatus(elements.adminStatus, error.message || "Ugyldig input.", "error");
    return;
  }

  setLoading(elements.saveBtn, true, "Lagrer...", "Lagre spill");
  setStatus(elements.adminStatus, `Lagrer ${selected.slug}...`);

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

    await loadHallGameConfigs();
    setStatus(elements.adminStatus, `Lagret ${updatedGame.slug} kl ${new Date().toLocaleTimeString("nb-NO")}.`, "success");
  } catch (error) {
    setStatus(elements.adminStatus, error.message || "Lagring feilet.", "error");
  } finally {
    setLoading(elements.saveBtn, false, "Lagrer...", "Lagre spill");
  }
}

function buildHallPayload() {
  const slug = (elements.hallSlug.value || "").trim();
  const name = (elements.hallName.value || "").trim();
  const region = (elements.hallRegion.value || "").trim();
  const address = (elements.hallAddress.value || "").trim();
  const isActive = elements.hallIsActive.value === "true";

  if (!slug) {
    throw new Error("Slug er påkrevd.");
  }
  if (!name) {
    throw new Error("Navn er påkrevd.");
  }

  return {
    slug,
    name,
    region: region || undefined,
    address: address || undefined,
    isActive
  };
}

async function handleCreateHall() {
  let payload;
  try {
    payload = buildHallPayload();
  } catch (error) {
    setStatus(elements.hallStatus, error.message || "Ugyldig hall-input.", "error");
    return;
  }

  setLoading(elements.createHallBtn, true, "Oppretter...", "Opprett hall");
  try {
    const created = await apiRequest("/api/admin/halls", {
      method: "POST",
      auth: true,
      body: payload
    });
    await loadHalls();
    elements.hallEditorSelect.value = created.id;
    renderSelectedHallEditor();
    elements.configHallSelect.value = created.id;
    await loadHallGameConfigs();
    await loadTerminals();
    setStatus(elements.hallStatus, `Opprettet hall ${created.name} (${created.slug}).`, "success");
  } catch (error) {
    setStatus(elements.hallStatus, error.message || "Klarte ikke opprette hall.", "error");
  } finally {
    setLoading(elements.createHallBtn, false, "Oppretter...", "Opprett hall");
  }
}

async function handleSaveHall() {
  const hall = getSelectedHallEditor();
  if (!hall) {
    setStatus(elements.hallStatus, "Velg en hall å lagre.", "error");
    return;
  }

  let payload;
  try {
    payload = buildHallPayload();
  } catch (error) {
    setStatus(elements.hallStatus, error.message || "Ugyldig hall-input.", "error");
    return;
  }

  setLoading(elements.saveHallBtn, true, "Lagrer...", "Lagre hall");
  try {
    const updated = await apiRequest(`/api/admin/halls/${encodeURIComponent(hall.id)}`, {
      method: "PUT",
      auth: true,
      body: payload
    });
    await loadHalls();
    elements.hallEditorSelect.value = updated.id;
    renderSelectedHallEditor();
    elements.configHallSelect.value = updated.id;
    await loadHallGameConfigs();
    await loadTerminals();
    setStatus(elements.hallStatus, `Lagret hall ${updated.name}.`, "success");
  } catch (error) {
    setStatus(elements.hallStatus, error.message || "Klarte ikke lagre hall.", "error");
  } finally {
    setLoading(elements.saveHallBtn, false, "Lagrer...", "Lagre hall");
  }
}

function buildTerminalPayload() {
  const hallId = (elements.terminalHallId.value || "").trim();
  const terminalCode = (elements.terminalCode.value || "").trim();
  const displayName = (elements.terminalDisplayName.value || "").trim();
  const isActive = elements.terminalIsActive.value === "true";

  if (!hallId) {
    throw new Error("Velg hall for terminal.");
  }
  if (!terminalCode) {
    throw new Error("Terminalkode er påkrevd.");
  }

  return {
    hallId,
    terminalCode,
    displayName: displayName || terminalCode,
    isActive
  };
}

async function handleCreateTerminal() {
  let payload;
  try {
    payload = buildTerminalPayload();
  } catch (error) {
    setStatus(elements.terminalStatus, error.message || "Ugyldig terminal-input.", "error");
    return;
  }

  setLoading(elements.createTerminalBtn, true, "Oppretter...", "Opprett terminal");
  try {
    const created = await apiRequest("/api/admin/terminals", {
      method: "POST",
      auth: true,
      body: payload
    });

    if (elements.terminalHallFilter.value !== payload.hallId) {
      elements.terminalHallFilter.value = payload.hallId;
    }
    await loadTerminals();
    elements.terminalSelect.value = created.id;
    renderSelectedTerminal();
    setStatus(elements.terminalStatus, `Opprettet terminal ${created.terminalCode}.`, "success");
  } catch (error) {
    setStatus(elements.terminalStatus, error.message || "Klarte ikke opprette terminal.", "error");
  } finally {
    setLoading(elements.createTerminalBtn, false, "Oppretter...", "Opprett terminal");
  }
}

async function handleSaveTerminal() {
  const terminal = getSelectedTerminal();
  if (!terminal) {
    setStatus(elements.terminalStatus, "Velg en terminal å lagre.", "error");
    return;
  }

  let payload;
  try {
    payload = buildTerminalPayload();
  } catch (error) {
    setStatus(elements.terminalStatus, error.message || "Ugyldig terminal-input.", "error");
    return;
  }

  setLoading(elements.saveTerminalBtn, true, "Lagrer...", "Lagre terminal");
  try {
    const updated = await apiRequest(`/api/admin/terminals/${encodeURIComponent(terminal.id)}`, {
      method: "PUT",
      auth: true,
      body: {
        terminalCode: payload.terminalCode,
        displayName: payload.displayName,
        isActive: payload.isActive
      }
    });

    if (elements.terminalHallFilter.value !== updated.hallId) {
      elements.terminalHallFilter.value = updated.hallId;
    }
    await loadTerminals();
    elements.terminalSelect.value = updated.id;
    renderSelectedTerminal();
    setStatus(elements.terminalStatus, `Lagret terminal ${updated.terminalCode}.`, "success");
  } catch (error) {
    setStatus(elements.terminalStatus, error.message || "Klarte ikke lagre terminal.", "error");
  } finally {
    setLoading(elements.saveTerminalBtn, false, "Lagrer...", "Lagre terminal");
  }
}

function buildHallGameConfigPayload() {
  const isEnabled = elements.configEnabled.value === "true";
  const maxTicketsPerPlayer = Number.parseInt(elements.configMaxTicketsPerPlayer.value || "0", 10);
  const minRoundIntervalMs = Number.parseInt(elements.configMinRoundIntervalMs.value || "0", 10);

  if (!Number.isInteger(maxTicketsPerPlayer) || maxTicketsPerPlayer < 1) {
    throw new Error("Maks bonger må være et heltall større enn 0.");
  }
  if (!Number.isInteger(minRoundIntervalMs) || minRoundIntervalMs < 1000) {
    throw new Error("Min rundeintervall må være minst 1000 ms.");
  }

  return {
    isEnabled,
    maxTicketsPerPlayer,
    minRoundIntervalMs
  };
}

async function handleSaveHallGameConfig() {
  let hallId;
  let gameSlug;
  let payload;

  try {
    hallId = getSelectedHallForConfig();
    gameSlug = getSelectedGameForConfig();
    payload = buildHallGameConfigPayload();
  } catch (error) {
    setStatus(elements.configStatus, error.message || "Ugyldig config-input.", "error");
    return;
  }

  setLoading(elements.saveConfigBtn, true, "Lagrer...", "Lagre hall-spillregel");
  try {
    await apiRequest(
      `/api/admin/halls/${encodeURIComponent(hallId)}/game-config/${encodeURIComponent(gameSlug)}`,
      {
        method: "PUT",
        auth: true,
        body: payload
      }
    );
    await loadHallGameConfigs();
    setStatus(elements.configStatus, `Lagret regel for hall=${hallId}, spill=${gameSlug}.`, "success");
  } catch (error) {
    setStatus(elements.configStatus, error.message || "Klarte ikke lagre hall-spillregel.", "error");
  } finally {
    setLoading(elements.saveConfigBtn, false, "Lagrer...", "Lagre hall-spillregel");
  }
}

async function handleLogin() {
  const email = elements.email.value.trim();
  const password = elements.password.value;

  if (!email || !password) {
    setStatus(elements.loginStatus, "Fyll inn både e-post og passord.", "error");
    return;
  }

  setLoading(elements.loginBtn, true, "Logger inn...", "Logg inn");
  setStatus(elements.loginStatus, "Prøver admin-login...");

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

    await loadAllAdminData();
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
    state.terminals = [];
    state.rooms = [];
    state.hallGameConfigs = [];
    setStoredToken("");
    showLogin();
    setStatus(elements.loginStatus, "Logget ut.", "success");
    setStatus(elements.adminStatus, "Klar.");
    setStatus(elements.hallStatus, "Ingen haller lastet.");
    setStatus(elements.terminalStatus, "Ingen terminaler lastet.");
    setStatus(elements.configStatus, "Ingen konfig lastet.");
    setStatus(elements.roomStatus, "Ingen rom valgt.");
    elements.adminIdentity.textContent = "";
    setLoading(elements.logoutBtn, false, "Logger ut...", "Logg ut");
  }
}

async function loadAllAdminData() {
  await loadGames();
  await loadHalls();
  await loadHallGameConfigs();
  await loadTerminals();
  await loadRooms();
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
    setStatus(elements.adminStatus, "Klar.");
  });

  elements.saveBtn.addEventListener("click", () => {
    handleSaveGame().catch((error) => {
      setStatus(elements.adminStatus, error.message || "Lagring feilet.", "error");
    });
  });

  elements.reloadBtn.addEventListener("click", () => {
    Promise.all([loadGames(), loadHallGameConfigs()])
      .then(() => {
        setStatus(elements.adminStatus, "Spill oppdatert.", "success");
      })
      .catch((error) => {
        setStatus(elements.adminStatus, error.message || "Kunne ikke laste spill.", "error");
      });
  });

  elements.hallEditorSelect.addEventListener("change", () => {
    renderSelectedHallEditor();
  });

  elements.createHallBtn.addEventListener("click", () => {
    handleCreateHall().catch((error) => {
      setStatus(elements.hallStatus, error.message || "Kunne ikke opprette hall.", "error");
    });
  });

  elements.saveHallBtn.addEventListener("click", () => {
    handleSaveHall().catch((error) => {
      setStatus(elements.hallStatus, error.message || "Kunne ikke lagre hall.", "error");
    });
  });

  elements.reloadHallsBtn.addEventListener("click", () => {
    loadHalls()
      .then(() => loadHallGameConfigs())
      .then(() => loadTerminals())
      .then(() => {
        setStatus(elements.hallStatus, "Hall-liste oppdatert.", "success");
      })
      .catch((error) => {
        setStatus(elements.hallStatus, error.message || "Kunne ikke oppdatere haller.", "error");
      });
  });

  elements.terminalHallFilter.addEventListener("change", () => {
    const hallId = (elements.terminalHallFilter.value || "").trim();
    if (hallId) {
      elements.terminalHallId.value = hallId;
    }
    loadTerminals().catch((error) => {
      setStatus(elements.terminalStatus, error.message || "Kunne ikke laste terminaler.", "error");
    });
  });

  elements.terminalSelect.addEventListener("change", () => {
    renderSelectedTerminal();
  });

  elements.createTerminalBtn.addEventListener("click", () => {
    handleCreateTerminal().catch((error) => {
      setStatus(elements.terminalStatus, error.message || "Kunne ikke opprette terminal.", "error");
    });
  });

  elements.saveTerminalBtn.addEventListener("click", () => {
    handleSaveTerminal().catch((error) => {
      setStatus(elements.terminalStatus, error.message || "Kunne ikke lagre terminal.", "error");
    });
  });

  elements.reloadTerminalsBtn.addEventListener("click", () => {
    loadTerminals()
      .then(() => {
        setStatus(elements.terminalStatus, "Terminal-liste oppdatert.", "success");
      })
      .catch((error) => {
        setStatus(elements.terminalStatus, error.message || "Kunne ikke oppdatere terminaler.", "error");
      });
  });

  elements.configHallSelect.addEventListener("change", () => {
    loadHallGameConfigs().catch((error) => {
      setStatus(elements.configStatus, error.message || "Kunne ikke laste hall-konfig.", "error");
    });
  });

  elements.configGameSelect.addEventListener("change", () => {
    renderSelectedHallGameConfig();
  });

  elements.saveConfigBtn.addEventListener("click", () => {
    handleSaveHallGameConfig().catch((error) => {
      setStatus(elements.configStatus, error.message || "Kunne ikke lagre hall-konfig.", "error");
    });
  });

  elements.reloadConfigBtn.addEventListener("click", () => {
    loadHallGameConfigs()
      .then(() => {
        setStatus(elements.configStatus, "Hall-spillkonfig oppdatert.", "success");
      })
      .catch((error) => {
        setStatus(elements.configStatus, error.message || "Kunne ikke oppdatere hall-konfig.", "error");
      });
  });

  elements.roomSelect.addEventListener("change", () => {
    showSelectedRoomSnapshot().catch((error) => {
      setStatus(elements.roomStatus, error.message || "Kunne ikke hente romstatus.", "error");
    });
  });

  elements.refreshRoomsBtn.addEventListener("click", () => {
    Promise.all([loadRooms(), loadHalls()])
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
    await loadAllAdminData();
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
