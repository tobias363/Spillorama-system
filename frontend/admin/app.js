const ADMIN_TOKEN_KEY = "bingo_admin_access_token";
const CANDY_GAME_SLUG = "candy";

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
  settingsJson: document.getElementById("settingsJson"),
  saveBtn: document.getElementById("saveBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  logoutBtn: document.getElementById("logoutBtn"),

  candyGameTitle: document.getElementById("candyGameTitle"),
  candyGameRoute: document.getElementById("candyGameRoute"),
  candyGameDescription: document.getElementById("candyGameDescription"),
  candyGameSortOrder: document.getElementById("candyGameSortOrder"),
  candyGameEnabled: document.getElementById("candyGameEnabled"),
  candyGameLaunchUrl: document.getElementById("candyGameLaunchUrl"),
  candyGameApiBaseUrl: document.getElementById("candyGameApiBaseUrl"),
  candyGameSettingsJson: document.getElementById("candyGameSettingsJson"),
  candyLoadGameBtn: document.getElementById("candyLoadGameBtn"),
  candySaveGameBtn: document.getElementById("candySaveGameBtn"),
  candyGameStatus: document.getElementById("candyGameStatus"),

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

  candyAutoRoundStartEnabled: document.getElementById("candyAutoRoundStartEnabled"),
  candyAutoRoundStartIntervalSeconds: document.getElementById("candyAutoRoundStartIntervalSeconds"),
  candyAutoRoundMinPlayers: document.getElementById("candyAutoRoundMinPlayers"),
  candyAutoRoundTicketsPerPlayer: document.getElementById("candyAutoRoundTicketsPerPlayer"),
  candyAutoRoundEntryFee: document.getElementById("candyAutoRoundEntryFee"),
  candyPayoutPercent: document.getElementById("candyPayoutPercent"),
  candyEffectiveFrom: document.getElementById("candyEffectiveFrom"),
  candyAutoDrawEnabled: document.getElementById("candyAutoDrawEnabled"),
  candyAutoDrawIntervalSeconds: document.getElementById("candyAutoDrawIntervalSeconds"),
  candySchedulerTickMs: document.getElementById("candySchedulerTickMs"),
  candyLoadSettingsBtn: document.getElementById("candyLoadSettingsBtn"),
  candySaveSettingsBtn: document.getElementById("candySaveSettingsBtn"),
  candyQuickHallSelect: document.getElementById("candyQuickHallSelect"),
  candyQuickRoomSelect: document.getElementById("candyQuickRoomSelect"),
  candyQuickEntryFee: document.getElementById("candyQuickEntryFee"),
  candyQuickTicketsPerPlayer: document.getElementById("candyQuickTicketsPerPlayer"),
  candyQuickStartNowBtn: document.getElementById("candyQuickStartNowBtn"),
  candyQuickCreateStartBtn: document.getElementById("candyQuickCreateStartBtn"),
  candyQuickStartExistingBtn: document.getElementById("candyQuickStartExistingBtn"),
  candyQuickDrawNextBtn: document.getElementById("candyQuickDrawNextBtn"),
  candyQuickEndRoomBtn: document.getElementById("candyQuickEndRoomBtn"),
  candyQuickRefreshRoomsBtn: document.getElementById("candyQuickRefreshRoomsBtn"),
  candyQuickStatus: document.getElementById("candyQuickStatus"),
  candySettingsStatus: document.getElementById("candySettingsStatus"),

  complianceWalletId: document.getElementById("complianceWalletId"),
  complianceHallSelect: document.getElementById("complianceHallSelect"),
  complianceDailyLossLimit: document.getElementById("complianceDailyLossLimit"),
  complianceMonthlyLossLimit: document.getElementById("complianceMonthlyLossLimit"),
  compliancePauseMinutes: document.getElementById("compliancePauseMinutes"),
  extraDrawDenialsLimit: document.getElementById("extraDrawDenialsLimit"),
  loadComplianceBtn: document.getElementById("loadComplianceBtn"),
  saveLossLimitsBtn: document.getElementById("saveLossLimitsBtn"),
  setTimedPauseBtn: document.getElementById("setTimedPauseBtn"),
  clearTimedPauseBtn: document.getElementById("clearTimedPauseBtn"),
  setSelfExclusionBtn: document.getElementById("setSelfExclusionBtn"),
  clearSelfExclusionBtn: document.getElementById("clearSelfExclusionBtn"),
  loadExtraDrawDenialsBtn: document.getElementById("loadExtraDrawDenialsBtn"),
  complianceStatus: document.getElementById("complianceStatus"),
  extraDrawDenialsStatus: document.getElementById("extraDrawDenialsStatus"),

  prizePolicyHallSelect: document.getElementById("prizePolicyHallSelect"),
  prizePolicyLinkId: document.getElementById("prizePolicyLinkId"),
  prizePolicyAt: document.getElementById("prizePolicyAt"),
  prizePolicyEffectiveFrom: document.getElementById("prizePolicyEffectiveFrom"),
  prizePolicySinglePrizeCap: document.getElementById("prizePolicySinglePrizeCap"),
  prizePolicyDailyExtraPrizeCap: document.getElementById("prizePolicyDailyExtraPrizeCap"),
  loadPrizePolicyBtn: document.getElementById("loadPrizePolicyBtn"),
  savePrizePolicyBtn: document.getElementById("savePrizePolicyBtn"),
  prizePolicyStatus: document.getElementById("prizePolicyStatus"),

  extraPrizeWalletId: document.getElementById("extraPrizeWalletId"),
  extraPrizeHallSelect: document.getElementById("extraPrizeHallSelect"),
  extraPrizeLinkId: document.getElementById("extraPrizeLinkId"),
  extraPrizeAmount: document.getElementById("extraPrizeAmount"),
  extraPrizeReason: document.getElementById("extraPrizeReason"),
  awardExtraPrizeBtn: document.getElementById("awardExtraPrizeBtn"),
  extraPrizeStatus: document.getElementById("extraPrizeStatus"),

  hallSelect: document.getElementById("hallSelect"),
  roomSelect: document.getElementById("roomSelect"),
  hostName: document.getElementById("hostName"),
  hostWalletId: document.getElementById("hostWalletId"),
  entryFee: document.getElementById("entryFee"),
  ticketsPerPlayer: document.getElementById("ticketsPerPlayer"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  createAndStartRoomBtn: document.getElementById("createAndStartRoomBtn"),
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
  hallGameConfigs: [],
  candySettings: null
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

function parseOptionalNonNegativeNumber(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} må være et tall som er 0 eller høyere.`);
  }
  return parsed;
}

function parseOptionalPositiveInteger(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} må være et heltall større enn 0.`);
  }
  return parsed;
}

function requireNonEmptyInput(value, label) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new Error(`${label} må fylles ut.`);
  }
  return trimmed;
}

function parseAbsoluteHttpUrl(value, label, required = false) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (required) {
      throw new Error(`${label} må fylles ut.`);
    }
    return "";
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    throw new Error(`${label} må være en gyldig URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} må starte med http:// eller https://.`);
  }

  return parsed.toString();
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

function getCandyGame() {
  return state.games.find((game) => game.slug === CANDY_GAME_SLUG) || null;
}

function getSettingsObject(game) {
  const settings = game?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  return settings;
}

function renderSelectedGame() {
  const selected = getSelectedGame();
  if (!selected) {
    elements.title.value = "";
    elements.route.value = "";
    elements.description.value = "";
    elements.sortOrder.value = "0";
    elements.enabled.value = "false";
    elements.settingsJson.value = "{}";
    return;
  }

  const settings = getSettingsObject(selected);
  elements.title.value = selected.title || "";
  elements.route.value = selected.route || "";
  elements.description.value = selected.description || "";
  elements.sortOrder.value = String(selected.sortOrder ?? 0);
  elements.enabled.value = selected.isEnabled ? "true" : "false";
  elements.settingsJson.value = JSON.stringify(settings, null, 2);
}

function applyCandyGameToForm(game) {
  if (!game) {
    elements.candyGameTitle.value = "";
    elements.candyGameRoute.value = "";
    elements.candyGameDescription.value = "";
    elements.candyGameSortOrder.value = "0";
    elements.candyGameEnabled.value = "false";
    elements.candyGameLaunchUrl.value = "";
    elements.candyGameApiBaseUrl.value = "";
    elements.candyGameSettingsJson.value = "{}";
    return;
  }

  const settings = getSettingsObject(game);
  elements.candyGameTitle.value = game.title || "";
  elements.candyGameRoute.value = game.route || "";
  elements.candyGameDescription.value = game.description || "";
  elements.candyGameSortOrder.value = String(game.sortOrder ?? 0);
  elements.candyGameEnabled.value = game.isEnabled ? "true" : "false";
  elements.candyGameLaunchUrl.value = String(settings.launchUrl || "");
  elements.candyGameApiBaseUrl.value = String(settings.apiBaseUrl || "");
  elements.candyGameSettingsJson.value = JSON.stringify(settings, null, 2);
}

function formatCandyGame(game) {
  if (!game) {
    return "Fant ikke Candy i spillkatalogen.";
  }

  return [
    `slug: ${game.slug}`,
    `title: ${game.title || "-"}`,
    `route: ${game.route || "-"}`,
    `enabled: ${game.isEnabled ? "Ja" : "Nei"}`,
    `sortOrder: ${game.sortOrder ?? "-"}`,
    `launchUrl: ${String(game.settings?.launchUrl || "-")}`,
    `apiBaseUrl: ${String(game.settings?.apiBaseUrl || "-")}`,
    `updatedAt: ${game.updatedAt || "-"}`
  ].join("\n");
}

function renderGameOptions() {
  const previous = elements.gameSelect.value;
  const nonCandyGames = state.games.filter((game) => game.slug !== CANDY_GAME_SLUG);
  setSelectOptions(
    elements.gameSelect,
    nonCandyGames.map((game) => ({
      value: game.slug,
      label: `${game.title} (${game.slug})`
    })),
    previous,
    "Ingen spill (Candy styres i egen seksjon)"
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
  applyCandyGameToForm(getCandyGame());
  renderSelectedHallGameConfig();
}

async function loadGames() {
  const games = await apiRequest("/api/admin/games", { auth: true });
  state.games = Array.isArray(games) ? games : [];
  renderGameOptions();
  setStatus(elements.adminStatus, `Lastet ${state.games.length} spill.`, "success");
  const candyGame = getCandyGame();
  setStatus(elements.candyGameStatus, formatCandyGame(candyGame), candyGame ? "success" : "error");
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
  const previousComplianceHall = elements.complianceHallSelect.value;
  const previousPrizePolicyHall = elements.prizePolicyHallSelect.value;
  const previousExtraPrizeHall = elements.extraPrizeHallSelect.value;
  const previousCandyQuickHall = elements.candyQuickHallSelect.value;

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
  setSelectOptions(elements.complianceHallSelect, hallOptionsAll, previousComplianceHall, "Ingen haller");
  setSelectOptions(elements.prizePolicyHallSelect, hallOptionsAll, previousPrizePolicyHall, "Ingen haller");
  setSelectOptions(elements.extraPrizeHallSelect, hallOptionsAll, previousExtraPrizeHall, "Ingen haller");
  setSelectOptions(elements.candyQuickHallSelect, hallOptionsActive, previousCandyQuickHall, "Ingen aktive haller");
  renderCandyQuickRoomOptions();

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

function millisecondsToSecondsString(value, fallback = "") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return String(Math.round(numeric / 10) / 100);
}

function isoToDatetimeLocalValue(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  const seconds = String(parsed.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function datetimeLocalToIso(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} må være en gyldig dato/tid.`);
  }
  return parsed.toISOString();
}

function applyCandyManiaSettingsToForm(settings) {
  if (!settings) {
    return;
  }

  elements.candyAutoRoundStartEnabled.value = asBooleanString(Boolean(settings.autoRoundStartEnabled));
  elements.candyAutoRoundStartIntervalSeconds.value = millisecondsToSecondsString(
    settings.autoRoundStartIntervalMs,
    ""
  );
  elements.candyAutoRoundMinPlayers.value = Number.isFinite(settings.autoRoundMinPlayers)
    ? String(settings.autoRoundMinPlayers)
    : "";
  elements.candyAutoRoundTicketsPerPlayer.value = Number.isFinite(settings.autoRoundTicketsPerPlayer)
    ? String(settings.autoRoundTicketsPerPlayer)
    : "";
  elements.candyAutoRoundEntryFee.value = Number.isFinite(settings.autoRoundEntryFee)
    ? String(settings.autoRoundEntryFee)
    : "";
  elements.candyPayoutPercent.value = Number.isFinite(settings.payoutPercent)
    ? String(settings.payoutPercent)
    : "100";
  elements.candyEffectiveFrom.value = isoToDatetimeLocalValue(settings.pendingUpdate?.effectiveFrom);
  elements.candyAutoDrawEnabled.value = asBooleanString(Boolean(settings.autoDrawEnabled));
  elements.candyAutoDrawIntervalSeconds.value = millisecondsToSecondsString(settings.autoDrawIntervalMs, "");
  elements.candySchedulerTickMs.value = Number.isFinite(settings.schedulerTickMs)
    ? String(settings.schedulerTickMs)
    : "";
  elements.candyQuickEntryFee.value = Number.isFinite(settings.autoRoundEntryFee)
    ? String(settings.autoRoundEntryFee)
    : "0";
  elements.candyQuickTicketsPerPlayer.value = Number.isFinite(settings.autoRoundTicketsPerPlayer)
    ? String(settings.autoRoundTicketsPerPlayer)
    : "4";
}

function formatCandyManiaSettings(settings) {
  const constraints = settings?.constraints || {};
  const locks = settings?.locks || {};
  return [
    `autoRoundStartEnabled: ${settings?.autoRoundStartEnabled ? "Ja" : "Nei"}`,
    `autoRoundStartIntervalMs: ${settings?.autoRoundStartIntervalMs ?? "-"}`,
    `autoRoundMinPlayers: ${settings?.autoRoundMinPlayers ?? "-"}`,
    `autoRoundTicketsPerPlayer: ${settings?.autoRoundTicketsPerPlayer ?? "-"}`,
    `autoRoundEntryFee: ${settings?.autoRoundEntryFee ?? "-"}`,
    `payoutPercent: ${settings?.payoutPercent ?? "-"}`,
    `effectiveFrom (aktiv): ${settings?.effectiveFrom ?? "-"}`,
    `pendingUpdate: ${settings?.pendingUpdate?.effectiveFrom ?? "ingen"}`,
    `autoDrawEnabled: ${settings?.autoDrawEnabled ? "Ja" : "Nei"}`,
    `autoDrawIntervalMs: ${settings?.autoDrawIntervalMs ?? "-"}`,
    `schedulerTickMs: ${settings?.schedulerTickMs ?? "-"}`,
    `runtime: ${constraints.runtime || "-"}`,
    `autoplayAllowed: ${constraints.autoplayAllowed ? "Ja" : "Nei"}`,
    `minRoundIntervalMs: ${constraints.minRoundIntervalMs ?? "-"}`,
    `minPlayersToStart: ${constraints.minPlayersToStart ?? "-"}`,
    `runningRoundLockActive: ${locks.runningRoundLockActive ? "Ja" : "Nei"}`
  ].join("\n");
}

function parseSecondsToMilliseconds(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new Error(`${label} må fylles ut.`);
  }
  const parsedSeconds = Number(raw);
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    throw new Error(`${label} må være et tall større enn 0.`);
  }
  return Math.round(parsedSeconds * 1000);
}

function buildCandyManiaPayload() {
  const constraints = state.candySettings?.constraints || {};
  const minRoundIntervalMs = Number.isFinite(constraints.minRoundIntervalMs)
    ? Number(constraints.minRoundIntervalMs)
    : 30000;
  const minPlayersToStart = 1;
  const maxTicketsPerPlayer = Number.isFinite(constraints.maxTicketsPerPlayer)
    ? Number(constraints.maxTicketsPerPlayer)
    : 5;
  const minPayoutPercent = Number.isFinite(constraints.minPayoutPercent)
    ? Number(constraints.minPayoutPercent)
    : 0;
  const maxPayoutPercent = Number.isFinite(constraints.maxPayoutPercent)
    ? Number(constraints.maxPayoutPercent)
    : 100;

  const autoRoundStartIntervalMs = parseSecondsToMilliseconds(
    elements.candyAutoRoundStartIntervalSeconds.value,
    "Trekning hvert (sekunder)"
  );
  if (autoRoundStartIntervalMs < minRoundIntervalMs) {
    throw new Error(`Trekning hvert må være minst ${minRoundIntervalMs / 1000} sekunder.`);
  }

  const autoRoundMinPlayers = Number.parseInt(elements.candyAutoRoundMinPlayers.value || "", 10);
  if (!Number.isInteger(autoRoundMinPlayers) || autoRoundMinPlayers < minPlayersToStart) {
    throw new Error(`Min spillere må være et heltall >= ${minPlayersToStart}.`);
  }

  const autoRoundTicketsPerPlayer = Number.parseInt(elements.candyAutoRoundTicketsPerPlayer.value || "", 10);
  if (
    !Number.isInteger(autoRoundTicketsPerPlayer) ||
    autoRoundTicketsPerPlayer < 1 ||
    autoRoundTicketsPerPlayer > maxTicketsPerPlayer
  ) {
    throw new Error(`Bonger per spiller må være mellom 1 og ${maxTicketsPerPlayer}.`);
  }

  const autoRoundEntryFee = Number(elements.candyAutoRoundEntryFee.value || 0);
  if (!Number.isFinite(autoRoundEntryFee) || autoRoundEntryFee < 0) {
    throw new Error("Default innsats må være et tall som er 0 eller høyere.");
  }

  const payoutPercent = Number(elements.candyPayoutPercent.value || 0);
  if (
    !Number.isFinite(payoutPercent) ||
    payoutPercent < minPayoutPercent ||
    payoutPercent > maxPayoutPercent
  ) {
    throw new Error(`RTP/utbetaling må være mellom ${minPayoutPercent} og ${maxPayoutPercent}.`);
  }

  const autoDrawIntervalMs = parseSecondsToMilliseconds(
    elements.candyAutoDrawIntervalSeconds.value,
    "Trekk-intervall (sekunder)"
  );

  const effectiveFrom = datetimeLocalToIso(elements.candyEffectiveFrom.value, "Aktiver fra");

  return {
    autoRoundStartEnabled: elements.candyAutoRoundStartEnabled.value === "true",
    autoRoundStartIntervalMs,
    autoRoundMinPlayers,
    autoRoundTicketsPerPlayer,
    autoRoundEntryFee,
    payoutPercent: Math.round(payoutPercent * 100) / 100,
    autoDrawEnabled: elements.candyAutoDrawEnabled.value === "true",
    autoDrawIntervalMs,
    ...(effectiveFrom ? { effectiveFrom } : {})
  };
}

async function loadCandyManiaSettings() {
  const settings = await apiRequest("/api/admin/candy-mania/settings", { auth: true });
  state.candySettings = settings;
  applyCandyManiaSettingsToForm(settings);
  setStatus(elements.candySettingsStatus, formatCandyManiaSettings(settings), "success");
}

async function handleSaveCandyManiaSettings() {
  const payload = buildCandyManiaPayload();
  const settings = await apiRequest("/api/admin/candy-mania/settings", {
    method: "PUT",
    auth: true,
    body: payload
  });
  state.candySettings = settings;
  applyCandyManiaSettingsToForm(settings);
  setStatus(elements.candySettingsStatus, formatCandyManiaSettings(settings), "success");
}

function ensurePrizePolicyEffectiveFromDefault() {
  if (!elements.prizePolicyEffectiveFrom) {
    return;
  }
  const current = (elements.prizePolicyEffectiveFrom.value || "").trim();
  if (current) {
    return;
  }
  elements.prizePolicyEffectiveFrom.value = new Date().toISOString();
}

function getComplianceWalletId() {
  return requireNonEmptyInput(elements.complianceWalletId.value, "Wallet ID");
}

function formatComplianceSnapshot(snapshot) {
  const dailyReg = snapshot?.regulatoryLossLimits?.daily;
  const monthlyReg = snapshot?.regulatoryLossLimits?.monthly;
  const dailyPersonal = snapshot?.personalLossLimits?.daily;
  const monthlyPersonal = snapshot?.personalLossLimits?.monthly;
  const netDaily = snapshot?.netLoss?.daily;
  const netMonthly = snapshot?.netLoss?.monthly;

  return [
    `walletId: ${snapshot?.walletId || "-"}`,
    `hallId: ${snapshot?.hallId || "-"}`,
    `blocked: ${snapshot?.restrictions?.isBlocked ? "Ja" : "Nei"}`,
    `blockedBy: ${snapshot?.restrictions?.blockedBy || "-"}`,
    `timedPause: ${snapshot?.restrictions?.timedPause?.isActive ? "Aktiv" : "Ikke aktiv"}`,
    `timedPauseUntil: ${snapshot?.restrictions?.timedPause?.pauseUntil || "-"}`,
    `selfExclusion: ${snapshot?.restrictions?.selfExclusion?.isActive ? "Aktiv" : "Ikke aktiv"}`,
    `selfExclusionUntil: ${snapshot?.restrictions?.selfExclusion?.minimumUntil || "-"}`,
    `reg.daily=${dailyReg ?? "-"} | reg.monthly=${monthlyReg ?? "-"}`,
    `personal.daily=${dailyPersonal ?? "-"} | personal.monthly=${monthlyPersonal ?? "-"}`,
    `net.daily=${netDaily ?? "-"} | net.monthly=${netMonthly ?? "-"}`
  ].join("\n");
}

function syncComplianceLimitInputs(snapshot) {
  const daily = snapshot?.personalLossLimits?.daily;
  const monthly = snapshot?.personalLossLimits?.monthly;
  elements.complianceDailyLossLimit.value = Number.isFinite(daily) ? String(daily) : "";
  elements.complianceMonthlyLossLimit.value = Number.isFinite(monthly) ? String(monthly) : "";
}

async function handleLoadCompliance() {
  const walletId = getComplianceWalletId();
  const hallId = (elements.complianceHallSelect.value || "").trim();
  const query = new URLSearchParams();
  if (hallId) {
    query.set("hallId", hallId);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const compliance = await apiRequest(
    `/api/admin/wallets/${encodeURIComponent(walletId)}/compliance${suffix}`,
    { auth: true }
  );
  syncComplianceLimitInputs(compliance);
  setStatus(elements.complianceStatus, formatComplianceSnapshot(compliance), "success");
}

function buildLossLimitPayload() {
  const hallId = requireNonEmptyInput(elements.complianceHallSelect.value, "Hall");
  const dailyLossLimit = parseOptionalNonNegativeNumber(elements.complianceDailyLossLimit.value, "Daglig tapsgrense");
  const monthlyLossLimit = parseOptionalNonNegativeNumber(
    elements.complianceMonthlyLossLimit.value,
    "Månedlig tapsgrense"
  );

  if (dailyLossLimit === undefined && monthlyLossLimit === undefined) {
    throw new Error("Fyll ut minst én tapsgrense.");
  }

  return {
    hallId,
    dailyLossLimit,
    monthlyLossLimit
  };
}

async function handleSaveLossLimits() {
  const walletId = getComplianceWalletId();
  const payload = buildLossLimitPayload();
  const compliance = await apiRequest(
    `/api/admin/wallets/${encodeURIComponent(walletId)}/loss-limits`,
    {
      method: "PUT",
      auth: true,
      body: payload
    }
  );
  setStatus(elements.complianceStatus, formatComplianceSnapshot(compliance), "success");
}

async function handleSetTimedPause() {
  const walletId = getComplianceWalletId();
  const durationMinutes = parseOptionalPositiveInteger(
    elements.compliancePauseMinutes.value,
    "Pause (minutter)"
  );
  const compliance = await apiRequest(
    `/api/admin/wallets/${encodeURIComponent(walletId)}/timed-pause`,
    {
      method: "POST",
      auth: true,
      body: {
        durationMinutes
      }
    }
  );
  setStatus(elements.complianceStatus, formatComplianceSnapshot(compliance), "success");
}

async function handleClearTimedPause() {
  const walletId = getComplianceWalletId();
  const compliance = await apiRequest(
    `/api/admin/wallets/${encodeURIComponent(walletId)}/timed-pause`,
    {
      method: "DELETE",
      auth: true
    }
  );
  setStatus(elements.complianceStatus, formatComplianceSnapshot(compliance), "success");
}

async function handleSetSelfExclusion() {
  const walletId = getComplianceWalletId();
  const compliance = await apiRequest(
    `/api/admin/wallets/${encodeURIComponent(walletId)}/self-exclusion`,
    {
      method: "POST",
      auth: true
    }
  );
  setStatus(elements.complianceStatus, formatComplianceSnapshot(compliance), "success");
}

async function handleClearSelfExclusion() {
  const walletId = getComplianceWalletId();
  const compliance = await apiRequest(
    `/api/admin/wallets/${encodeURIComponent(walletId)}/self-exclusion`,
    {
      method: "DELETE",
      auth: true
    }
  );
  setStatus(elements.complianceStatus, formatComplianceSnapshot(compliance), "success");
}

async function handleLoadExtraDrawDenials() {
  const requestedLimit = parseOptionalPositiveInteger(elements.extraDrawDenialsLimit.value, "Denials limit");
  const limit = requestedLimit ?? 25;
  const denials = await apiRequest(`/api/admin/compliance/extra-draw-denials?limit=${limit}`, { auth: true });
  if (!Array.isArray(denials) || denials.length === 0) {
    setStatus(elements.extraDrawDenialsStatus, "Ingen extra draw denials registrert.", "success");
    return;
  }
  const lines = denials.slice(0, limit).map((item) => {
    return [
      `${item.createdAt} | source=${item.source} | reason=${item.reasonCode}`,
      `room=${item.roomCode || "-"} | player=${item.playerId || "-"} | wallet=${item.walletId || "-"}`
    ].join("\n");
  });
  setStatus(elements.extraDrawDenialsStatus, lines.join("\n\n"), "success");
}

function getPrizePolicyHallId() {
  return requireNonEmptyInput(elements.prizePolicyHallSelect.value, "Hall (policy)");
}

function buildPrizePolicyPayload() {
  const hallId = getPrizePolicyHallId();
  const linkId = (elements.prizePolicyLinkId.value || "").trim();
  const effectiveFrom = requireNonEmptyInput(elements.prizePolicyEffectiveFrom.value, "Effective from");
  const singlePrizeCap = parseOptionalNonNegativeNumber(
    elements.prizePolicySinglePrizeCap.value,
    "Single prize cap"
  );
  const dailyExtraPrizeCap = parseOptionalNonNegativeNumber(
    elements.prizePolicyDailyExtraPrizeCap.value,
    "Daily extra prize cap"
  );

  return {
    hallId,
    linkId: linkId || undefined,
    effectiveFrom,
    singlePrizeCap,
    dailyExtraPrizeCap
  };
}

function applyPrizePolicyToInputs(policy) {
  if (!policy) {
    return;
  }
  elements.prizePolicyHallSelect.value = policy.hallId || elements.prizePolicyHallSelect.value;
  elements.prizePolicyLinkId.value = policy.linkId || "";
  elements.prizePolicyEffectiveFrom.value = policy.effectiveFrom || elements.prizePolicyEffectiveFrom.value;
  elements.prizePolicySinglePrizeCap.value = Number.isFinite(policy.singlePrizeCap)
    ? String(policy.singlePrizeCap)
    : "";
  elements.prizePolicyDailyExtraPrizeCap.value = Number.isFinite(policy.dailyExtraPrizeCap)
    ? String(policy.dailyExtraPrizeCap)
    : "";
}

function formatPrizePolicy(policy) {
  return [
    `id: ${policy?.id || "-"}`,
    `hallId: ${policy?.hallId || "-"}`,
    `linkId: ${policy?.linkId || "-"}`,
    `effectiveFrom: ${policy?.effectiveFrom || "-"}`,
    `singlePrizeCap: ${policy?.singlePrizeCap ?? "-"}`,
    `dailyExtraPrizeCap: ${policy?.dailyExtraPrizeCap ?? "-"}`,
    `createdAt: ${policy?.createdAt || "-"}`
  ].join("\n");
}

async function handleLoadPrizePolicy() {
  const hallId = getPrizePolicyHallId();
  const linkId = (elements.prizePolicyLinkId.value || "").trim();
  const at = (elements.prizePolicyAt.value || "").trim();
  const query = new URLSearchParams({ hallId });
  if (linkId) {
    query.set("linkId", linkId);
  }
  if (at) {
    query.set("at", at);
  }
  const policy = await apiRequest(`/api/admin/prize-policy/active?${query.toString()}`, { auth: true });
  applyPrizePolicyToInputs(policy);
  setStatus(elements.prizePolicyStatus, formatPrizePolicy(policy), "success");
}

async function handleSavePrizePolicy() {
  const payload = buildPrizePolicyPayload();
  const policy = await apiRequest("/api/admin/prize-policy", {
    method: "PUT",
    auth: true,
    body: payload
  });
  applyPrizePolicyToInputs(policy);
  setStatus(elements.prizePolicyStatus, formatPrizePolicy(policy), "success");
}

function buildExtraPrizePayload() {
  const walletId = requireNonEmptyInput(elements.extraPrizeWalletId.value, "Wallet ID (extra prize)");
  const hallId = requireNonEmptyInput(elements.extraPrizeHallSelect.value, "Hall (extra prize)");
  const amountRaw = requireNonEmptyInput(elements.extraPrizeAmount.value, "Beløp");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Beløp må være et tall større enn 0.");
  }
  const linkId = (elements.extraPrizeLinkId.value || "").trim();
  const reason = (elements.extraPrizeReason.value || "").trim();

  return {
    walletId,
    body: {
      hallId,
      amount,
      linkId: linkId || undefined,
      reason: reason || undefined
    }
  };
}

async function handleAwardExtraPrize() {
  const payload = buildExtraPrizePayload();
  const result = await apiRequest(
    `/api/admin/wallets/${encodeURIComponent(payload.walletId)}/extra-prize`,
    {
      method: "POST",
      auth: true,
      body: payload.body
    }
  );

  setStatus(
    elements.extraPrizeStatus,
    [
      `walletId: ${result.walletId || payload.walletId}`,
      `hallId: ${result.hallId || payload.body.hallId}`,
      `linkId: ${result.linkId || payload.body.linkId || "-"}`,
      `amount: ${result.amount ?? payload.body.amount}`,
      `policyId: ${result.policyId || "-"}`,
      `remainingDailyExtraPrizeLimit: ${result.remainingDailyExtraPrizeLimit ?? "-"}`
    ].join("\n"),
    "success"
  );
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

function getCandyQuickFilteredRooms() {
  const selectedHallId = (elements.candyQuickHallSelect.value || "").trim();
  if (!selectedHallId) {
    return Array.isArray(state.rooms) ? state.rooms : [];
  }
  return (Array.isArray(state.rooms) ? state.rooms : []).filter((room) => room.hallId === selectedHallId);
}

function renderCandyQuickRoomOptions(preferredRoomCode) {
  const previous = preferredRoomCode || elements.candyQuickRoomSelect.value;
  const filteredRooms = getCandyQuickFilteredRooms();
  setSelectOptions(
    elements.candyQuickRoomSelect,
    filteredRooms.map((room) => ({
      value: room.code,
      label: formatRoomSummary(room)
    })),
    previous,
    "Ingen rom i valgt hall"
  );
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
  renderCandyQuickRoomOptions();
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
  const maxPayoutBudget = Number(game?.maxPayoutBudget);
  const remainingPayoutBudget = Number(game?.remainingPayoutBudget);
  const payoutPercent = Number(game?.payoutPercent);
  const hasRtp =
    Number.isFinite(maxPayoutBudget) &&
    maxPayoutBudget >= 0 &&
    Number.isFinite(remainingPayoutBudget) &&
    Number.isFinite(payoutPercent);
  const boundedRemaining = hasRtp ? Math.min(maxPayoutBudget, Math.max(0, remainingPayoutBudget)) : 0;
  const usedPercent = hasRtp && maxPayoutBudget > 0 ? ((maxPayoutBudget - boundedRemaining) / maxPayoutBudget) * 100 : 0;
  const rtpWarning =
    hasRtp && game?.status === "RUNNING"
      ? usedPercent >= 100 || boundedRemaining <= 0
        ? "RTP-GRENSE NÅDD"
        : usedPercent >= 90
          ? "RTP > 90%"
          : usedPercent >= 80
            ? "RTP > 80%"
            : ""
      : "";
  setStatus(
    elements.roomStatus,
    [
      `Rom: ${snapshot.code}`,
      `Hall: ${snapshot.hallId}`,
      `Host playerId: ${snapshot.hostPlayerId}`,
      `Spillere: ${Array.isArray(snapshot.players) ? snapshot.players.length : 0}`,
      `Status: ${game?.status || "NONE"}`,
      `Trukket: ${game?.drawnNumbers?.length || 0}`,
      hasRtp
        ? `RTP: ${Math.round(payoutPercent * 100) / 100}% | Brukt: ${Math.max(0, Math.min(100, Math.round(usedPercent * 100) / 100))}%`
        : "RTP: -",
      rtpWarning ? `Varsel: ${rtpWarning}` : "Varsel: Ingen"
    ].join("\n"),
    rtpWarning === "RTP-GRENSE NÅDD" || rtpWarning === "RTP > 90%" ? "error" : "success"
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

function getRoomStartPayload() {
  let entryFee = Number(elements.entryFee.value || 0);
  if (!Number.isFinite(entryFee) || entryFee < 0) {
    entryFee = 0;
  }

  const ticketsPerPlayer = Number.parseInt(elements.ticketsPerPlayer.value || "4", 10);
  if (!Number.isInteger(ticketsPerPlayer) || ticketsPerPlayer < 1 || ticketsPerPlayer > 5) {
    throw new Error("ticketsPerPlayer må være et heltall mellom 1 og 5.");
  }
  return { entryFee, ticketsPerPlayer };
}

function getCandyQuickSelectedHallId() {
  const hallId = (elements.candyQuickHallSelect.value || "").trim();
  if (!hallId) {
    throw new Error("Velg hall for Candy først.");
  }
  return hallId;
}

function getCandyQuickSelectedRoomCode() {
  const roomCode = (elements.candyQuickRoomSelect.value || "").trim().toUpperCase();
  if (!roomCode) {
    throw new Error("Velg eksisterende Candy-rom først.");
  }
  return roomCode;
}

function getCandyQuickStartPayloadFromForm() {
  let entryFee = Number(elements.candyQuickEntryFee.value || 0);
  if (!Number.isFinite(entryFee) || entryFee < 0) {
    throw new Error("Innsats må være et tall >= 0.");
  }
  entryFee = Math.round(entryFee * 100) / 100;

  const ticketsPerPlayer = Number.parseInt(elements.candyQuickTicketsPerPlayer.value || "4", 10);
  if (!Number.isInteger(ticketsPerPlayer) || ticketsPerPlayer < 1 || ticketsPerPlayer > 5) {
    throw new Error("Bonger per spiller må være et heltall mellom 1 og 5.");
  }

  return { entryFee, ticketsPerPlayer };
}

function getCandyQuickStartPayloadFromDefaults() {
  const settingsEntryFee = Number(state.candySettings?.autoRoundEntryFee);
  const settingsTickets = Number(state.candySettings?.autoRoundTicketsPerPlayer);
  const entryFee = Number.isFinite(settingsEntryFee) && settingsEntryFee >= 0
    ? Math.round(settingsEntryFee * 100) / 100
    : 0;
  const ticketsPerPlayer = Number.isInteger(settingsTickets) && settingsTickets >= 1 && settingsTickets <= 5
    ? settingsTickets
    : 4;
  return { entryFee, ticketsPerPlayer };
}

async function createAndStartCandyRoom(startPayload) {
  const hallId = getCandyQuickSelectedHallId();
  const created = await apiRequest("/api/admin/rooms", {
    method: "POST",
    auth: true,
    body: {
      hallId,
      hostName: "Candy Admin"
    }
  });

  const started = await apiRequest(`/api/admin/rooms/${encodeURIComponent(created.roomCode)}/start`, {
    method: "POST",
    auth: true,
    body: startPayload
  });

  await loadRooms();
  elements.roomSelect.value = created.roomCode;
  renderCandyQuickRoomOptions(created.roomCode);
  elements.candyQuickRoomSelect.value = created.roomCode;
  await showSelectedRoomSnapshot().catch(() => undefined);

  return { created, started, hallId };
}

async function handleCandyQuickStartNow() {
  const startPayload = getCandyQuickStartPayloadFromDefaults();
  setLoading(elements.candyQuickStartNowBtn, true, "Starter Candy...", "Start Candy nå");
  try {
    const { created, started, hallId } = await createAndStartCandyRoom(startPayload);
    setStatus(
      elements.candyQuickStatus,
      [
        `Candy startet med standardinnstillinger.`,
        `Rom: ${created.roomCode}`,
        `Hall: ${hallId}`,
        `Innsats: ${startPayload.entryFee}`,
        `Bonger/spiller: ${startPayload.ticketsPerPlayer}`,
        `Status: ${started.snapshot?.currentGame?.status || "-"}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(elements.candyQuickStatus, error.message || "Klarte ikke starte Candy nå.", "error");
  } finally {
    setLoading(elements.candyQuickStartNowBtn, false, "Starter Candy...", "Start Candy nå");
  }
}

async function handleCandyQuickCreateAndStart() {
  const startPayload = getCandyQuickStartPayloadFromForm();
  setLoading(
    elements.candyQuickCreateStartBtn,
    true,
    "Oppretter + starter Candy...",
    "Opprett + Start Candy nå"
  );
  try {
    const { created, started, hallId } = await createAndStartCandyRoom(startPayload);
    setStatus(
      elements.candyQuickStatus,
      [
        `Candy rom opprettet + startet: ${created.roomCode}`,
        `Hall: ${hallId}`,
        `Host playerId: ${created.playerId || "-"}`,
        `Innsats: ${startPayload.entryFee}`,
        `Bonger/spiller: ${startPayload.ticketsPerPlayer}`,
        `Status: ${started.snapshot?.currentGame?.status || "-"}`,
        `Trukket: ${started.snapshot?.currentGame?.drawnNumbers?.length || 0}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(
      elements.candyQuickStatus,
      error.message || "Klarte ikke opprette + starte Candy-rom.",
      "error"
    );
  } finally {
    setLoading(
      elements.candyQuickCreateStartBtn,
      false,
      "Oppretter + starter Candy...",
      "Opprett + Start Candy nå"
    );
  }
}

async function handleCandyQuickStartExisting() {
  const roomCode = getCandyQuickSelectedRoomCode();
  const startPayload = getCandyQuickStartPayloadFromForm();

  setLoading(
    elements.candyQuickStartExistingBtn,
    true,
    "Starter Candy-rom...",
    "Start valgt Candy-rom"
  );
  try {
    const started = await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/start`, {
      method: "POST",
      auth: true,
      body: startPayload
    });

    await loadRooms();
    elements.roomSelect.value = roomCode;
    renderCandyQuickRoomOptions(roomCode);
    elements.candyQuickRoomSelect.value = roomCode;
    await showSelectedRoomSnapshot().catch(() => undefined);

    setStatus(
      elements.candyQuickStatus,
      [
        `Candy spill startet i rom: ${roomCode}`,
        `Innsats: ${startPayload.entryFee}`,
        `Bonger/spiller: ${startPayload.ticketsPerPlayer}`,
        `Status: ${started.snapshot?.currentGame?.status || "-"}`,
        `Trukket: ${started.snapshot?.currentGame?.drawnNumbers?.length || 0}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(
      elements.candyQuickStatus,
      error.message || "Klarte ikke starte valgt Candy-rom.",
      "error"
    );
  } finally {
    setLoading(
      elements.candyQuickStartExistingBtn,
      false,
      "Starter Candy-rom...",
      "Start valgt Candy-rom"
    );
  }
}

async function handleCandyQuickDrawNext() {
  const roomCode = getCandyQuickSelectedRoomCode();
  setLoading(elements.candyQuickDrawNextBtn, true, "Trekker...", "Trekk neste i valgt rom");
  try {
    const result = await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/draw-next`, {
      method: "POST",
      auth: true
    });
    await loadRooms();
    elements.roomSelect.value = roomCode;
    renderCandyQuickRoomOptions(roomCode);
    elements.candyQuickRoomSelect.value = roomCode;
    await showSelectedRoomSnapshot().catch(() => undefined);
    setStatus(
      elements.candyQuickStatus,
      [
        `Candy rom: ${roomCode}`,
        `Neste tall: ${result.number}`,
        `Trukket totalt: ${result.snapshot?.currentGame?.drawnNumbers?.length || 0}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(elements.candyQuickStatus, error.message || "Klarte ikke trekke neste i Candy-rom.", "error");
  } finally {
    setLoading(elements.candyQuickDrawNextBtn, false, "Trekker...", "Trekk neste i valgt rom");
  }
}

async function handleCandyQuickEndRoom() {
  const roomCode = getCandyQuickSelectedRoomCode();
  setLoading(elements.candyQuickEndRoomBtn, true, "Avslutter...", "Avslutt valgt rom");
  try {
    const result = await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/end`, {
      method: "POST",
      auth: true,
      body: {
        reason: "Manual end from Candy quick control"
      }
    });
    await loadRooms();
    elements.roomSelect.value = roomCode;
    renderCandyQuickRoomOptions(roomCode);
    elements.candyQuickRoomSelect.value = roomCode;
    await showSelectedRoomSnapshot().catch(() => undefined);
    setStatus(
      elements.candyQuickStatus,
      [
        `Candy rom avsluttet: ${roomCode}`,
        `Status: ${result.snapshot?.currentGame?.status || "-"}`,
        `Årsak: ${result.snapshot?.currentGame?.endedReason || "-"}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    setStatus(elements.candyQuickStatus, error.message || "Klarte ikke avslutte Candy-rom.", "error");
  } finally {
    setLoading(elements.candyQuickEndRoomBtn, false, "Avslutter...", "Avslutt valgt rom");
  }
}

async function handleCandyQuickRefreshRooms() {
  await Promise.all([loadHalls(), loadRooms()]);
  setStatus(elements.candyQuickStatus, "Candy hall/rom er oppdatert fra backend.", "success");
}

async function handleStartRoom() {
  let startPayload;
  try {
    startPayload = getRoomStartPayload();
  } catch (error) {
    setStatus(elements.roomStatus, error.message || "Ugyldig start-input.", "error");
    return;
  }
  const roomCode = getSelectedRoomCode();
  setLoading(elements.startRoomBtn, true, "Starter...", "Start spill");
  try {
    const result = await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/start`, {
      method: "POST",
      auth: true,
      body: startPayload
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

async function handleCreateAndStartRoom() {
  const hallId = getSelectedRoomHallId();
  const hostName = (elements.hostName.value || "").trim();
  const hostWalletId = (elements.hostWalletId.value || "").trim();
  let startPayload;
  try {
    startPayload = getRoomStartPayload();
  } catch (error) {
    setStatus(elements.roomStatus, error.message || "Ugyldig start-input.", "error");
    return;
  }

  let createdRoomCode = "";
  let createdPlayerId = "";
  setLoading(elements.createAndStartRoomBtn, true, "Oppretter + starter...", "Opprett + Start");
  try {
    const created = await apiRequest("/api/admin/rooms", {
      method: "POST",
      auth: true,
      body: {
        hallId,
        hostName: hostName || undefined,
        hostWalletId: hostWalletId || undefined
      }
    });

    createdRoomCode = created.roomCode;
    createdPlayerId = created.playerId;
    const started = await apiRequest(`/api/admin/rooms/${encodeURIComponent(createdRoomCode)}/start`, {
      method: "POST",
      auth: true,
      body: startPayload
    });

    await loadRooms();
    elements.roomSelect.value = createdRoomCode;
    setStatus(
      elements.roomStatus,
      [
        `Rom opprettet + startet: ${createdRoomCode}`,
        `Host playerId: ${createdPlayerId}`,
        `Status: ${started.snapshot?.currentGame?.status || "-"}`,
        `Trukket: ${started.snapshot?.currentGame?.drawnNumbers?.length || 0}`
      ].join("\n"),
      "success"
    );
  } catch (error) {
    if (createdRoomCode) {
      await loadRooms().catch(() => undefined);
      elements.roomSelect.value = createdRoomCode;
      setStatus(
        elements.roomStatus,
        [
          `Rom opprettet: ${createdRoomCode}`,
          `Host playerId: ${createdPlayerId || "-"}`,
          `Start feilet: ${error.message || "Ukjent feil"}`
        ].join("\n"),
        "error"
      );
    } else {
      setStatus(elements.roomStatus, error.message || "Klarte ikke opprette + starte rom.", "error");
    }
  } finally {
    setLoading(elements.createAndStartRoomBtn, false, "Oppretter + starter...", "Opprett + Start");
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

function buildGameUpdatePayload() {
  let parsedSettings;
  try {
    parsedSettings = JSON.parse(elements.settingsJson.value || "{}");
  } catch (_error) {
    throw new Error("Settings JSON er ugyldig JSON.");
  }

  if (!parsedSettings || typeof parsedSettings !== "object" || Array.isArray(parsedSettings)) {
    throw new Error("Settings må være et JSON-objekt (ikke liste).");
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

function buildCandyGameUpdatePayload() {
  let parsedSettings;
  try {
    parsedSettings = JSON.parse(elements.candyGameSettingsJson.value || "{}");
  } catch (_error) {
    throw new Error("Candy Settings JSON er ugyldig JSON.");
  }

  if (!parsedSettings || typeof parsedSettings !== "object" || Array.isArray(parsedSettings)) {
    throw new Error("Candy settings må være et JSON-objekt (ikke liste).");
  }

  const sortOrder = Number.parseInt(elements.candyGameSortOrder.value || "0", 10);
  if (!Number.isFinite(sortOrder)) {
    throw new Error("Candy sortering må være et tall.");
  }

  const launchUrl = parseAbsoluteHttpUrl(elements.candyGameLaunchUrl.value, "Candy launch URL", true);
  const apiBaseUrl = parseAbsoluteHttpUrl(elements.candyGameApiBaseUrl.value, "Candy API Base URL", false);
  parsedSettings.launchUrl = launchUrl;
  if (apiBaseUrl) {
    parsedSettings.apiBaseUrl = apiBaseUrl;
  } else {
    delete parsedSettings.apiBaseUrl;
  }

  return {
    title: elements.candyGameTitle.value.trim(),
    route: elements.candyGameRoute.value.trim(),
    description: elements.candyGameDescription.value.trim(),
    sortOrder,
    isEnabled: elements.candyGameEnabled.value === "true",
    settings: parsedSettings
  };
}

async function handleSaveCandyGame() {
  const candy = getCandyGame();
  if (!candy) {
    setStatus(elements.candyGameStatus, "Fant ikke Candy i spillkatalogen.", "error");
    return;
  }

  let payload;
  try {
    payload = buildCandyGameUpdatePayload();
  } catch (error) {
    setStatus(elements.candyGameStatus, error.message || "Ugyldig Candy-input.", "error");
    return;
  }

  setLoading(elements.candySaveGameBtn, true, "Lagrer Candy...", "Lagre Candy-spill");
  setStatus(elements.candyGameStatus, "Lagrer Candy-spill...");
  try {
    const updatedGame = await apiRequest(`/api/admin/games/${encodeURIComponent(CANDY_GAME_SLUG)}`, {
      method: "PUT",
      auth: true,
      body: payload
    });
    state.games = state.games.map((game) => (game.slug === updatedGame.slug ? updatedGame : game));
    renderGameOptions();
    applyCandyGameToForm(updatedGame);
    setStatus(elements.candyGameStatus, formatCandyGame(updatedGame), "success");
  } catch (error) {
    setStatus(elements.candyGameStatus, error.message || "Lagring av Candy-spill feilet.", "error");
  } finally {
    setLoading(elements.candySaveGameBtn, false, "Lagrer Candy...", "Lagre Candy-spill");
  }
}

async function handleSaveGame() {
  const selected = getSelectedGame();
  if (!selected) {
    setStatus(elements.adminStatus, "Ingen spill valgt.", "error");
    return;
  }

  let payload;
  try {
    payload = buildGameUpdatePayload();
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
    state.candySettings = null;
    setStoredToken("");
    showLogin();
    setStatus(elements.loginStatus, "Logget ut.", "success");
    setStatus(elements.adminStatus, "Klar.");
    setStatus(elements.hallStatus, "Ingen haller lastet.");
    setStatus(elements.terminalStatus, "Ingen terminaler lastet.");
    setStatus(elements.configStatus, "Ingen konfig lastet.");
    setStatus(elements.candyGameStatus, "Ingen Candy-spilldata lastet.");
    setStatus(elements.candySettingsStatus, "Ingen Candy-driftinnstillinger lastet.");
    setStatus(elements.candyQuickStatus, "Ingen Candy rom-kjøring startet.");
    setStatus(elements.complianceStatus, "Ingen compliance-data hentet.");
    setStatus(elements.extraDrawDenialsStatus, "Ingen denial-data hentet.");
    setStatus(elements.prizePolicyStatus, "Ingen policy lastet.");
    setStatus(elements.extraPrizeStatus, "Ingen extra prize sendt.");
    setStatus(elements.roomStatus, "Ingen rom valgt.");
    elements.adminIdentity.textContent = "";
    setLoading(elements.logoutBtn, false, "Logger ut...", "Logg ut");
  }
}

async function loadAllAdminData() {
  await loadGames();
  await loadHalls();
  ensurePrizePolicyEffectiveFromDefault();
  await loadHallGameConfigs();
  await loadCandyManiaSettings();
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

  elements.candyLoadGameBtn.addEventListener("click", () => {
    loadGames()
      .then(() => {
        const candyGame = getCandyGame();
        setStatus(elements.candyGameStatus, formatCandyGame(candyGame), candyGame ? "success" : "error");
      })
      .catch((error) => {
        setStatus(elements.candyGameStatus, error.message || "Kunne ikke laste Candy-spill.", "error");
      });
  });

  elements.candySaveGameBtn.addEventListener("click", () => {
    handleSaveCandyGame().catch((error) => {
      setStatus(elements.candyGameStatus, error.message || "Kunne ikke lagre Candy-spill.", "error");
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

  elements.candyLoadSettingsBtn.addEventListener("click", () => {
    loadCandyManiaSettings().catch((error) => {
      setStatus(
        elements.candySettingsStatus,
        error.message || "Kunne ikke hente Candy-driftinnstillinger.",
        "error"
      );
    });
  });

  elements.candySaveSettingsBtn.addEventListener("click", () => {
    handleSaveCandyManiaSettings().catch((error) => {
      setStatus(
        elements.candySettingsStatus,
        error.message || "Kunne ikke lagre Candy-driftinnstillinger.",
        "error"
      );
    });
  });

  elements.candyQuickRefreshRoomsBtn.addEventListener("click", () => {
    handleCandyQuickRefreshRooms().catch((error) => {
      setStatus(elements.candyQuickStatus, error.message || "Kunne ikke oppdatere Candy hall/rom.", "error");
    });
  });

  elements.candyQuickStartNowBtn.addEventListener("click", () => {
    handleCandyQuickStartNow().catch((error) => {
      setStatus(elements.candyQuickStatus, error.message || "Kunne ikke starte Candy nå.", "error");
    });
  });

  elements.candyQuickCreateStartBtn.addEventListener("click", () => {
    handleCandyQuickCreateAndStart().catch((error) => {
      setStatus(elements.candyQuickStatus, error.message || "Kunne ikke opprette + starte Candy-rom.", "error");
    });
  });

  elements.candyQuickStartExistingBtn.addEventListener("click", () => {
    handleCandyQuickStartExisting().catch((error) => {
      setStatus(elements.candyQuickStatus, error.message || "Kunne ikke starte valgt Candy-rom.", "error");
    });
  });

  elements.candyQuickDrawNextBtn.addEventListener("click", () => {
    handleCandyQuickDrawNext().catch((error) => {
      setStatus(elements.candyQuickStatus, error.message || "Kunne ikke trekke neste i Candy-rom.", "error");
    });
  });

  elements.candyQuickEndRoomBtn.addEventListener("click", () => {
    handleCandyQuickEndRoom().catch((error) => {
      setStatus(elements.candyQuickStatus, error.message || "Kunne ikke avslutte Candy-rom.", "error");
    });
  });

  elements.candyQuickHallSelect.addEventListener("change", () => {
    renderCandyQuickRoomOptions();
  });

  elements.loadComplianceBtn.addEventListener("click", () => {
    handleLoadCompliance().catch((error) => {
      setStatus(elements.complianceStatus, error.message || "Kunne ikke hente compliance.", "error");
    });
  });

  elements.saveLossLimitsBtn.addEventListener("click", () => {
    handleSaveLossLimits().catch((error) => {
      setStatus(elements.complianceStatus, error.message || "Kunne ikke lagre tapsgrenser.", "error");
    });
  });

  elements.setTimedPauseBtn.addEventListener("click", () => {
    handleSetTimedPause().catch((error) => {
      setStatus(elements.complianceStatus, error.message || "Kunne ikke sette pause.", "error");
    });
  });

  elements.clearTimedPauseBtn.addEventListener("click", () => {
    handleClearTimedPause().catch((error) => {
      setStatus(elements.complianceStatus, error.message || "Kunne ikke fjerne pause.", "error");
    });
  });

  elements.setSelfExclusionBtn.addEventListener("click", () => {
    handleSetSelfExclusion().catch((error) => {
      setStatus(elements.complianceStatus, error.message || "Kunne ikke sette selvekskludering.", "error");
    });
  });

  elements.clearSelfExclusionBtn.addEventListener("click", () => {
    handleClearSelfExclusion().catch((error) => {
      setStatus(elements.complianceStatus, error.message || "Kunne ikke fjerne selvekskludering.", "error");
    });
  });

  elements.loadExtraDrawDenialsBtn.addEventListener("click", () => {
    handleLoadExtraDrawDenials().catch((error) => {
      setStatus(
        elements.extraDrawDenialsStatus,
        error.message || "Kunne ikke hente extra draw denials.",
        "error"
      );
    });
  });

  elements.loadPrizePolicyBtn.addEventListener("click", () => {
    handleLoadPrizePolicy().catch((error) => {
      setStatus(elements.prizePolicyStatus, error.message || "Kunne ikke hente aktiv policy.", "error");
    });
  });

  elements.savePrizePolicyBtn.addEventListener("click", () => {
    handleSavePrizePolicy().catch((error) => {
      setStatus(elements.prizePolicyStatus, error.message || "Kunne ikke lagre policy.", "error");
    });
  });

  elements.awardExtraPrizeBtn.addEventListener("click", () => {
    handleAwardExtraPrize().catch((error) => {
      setStatus(elements.extraPrizeStatus, error.message || "Kunne ikke tildele extra prize.", "error");
    });
  });

  elements.roomSelect.addEventListener("change", () => {
    const roomCode = (elements.roomSelect.value || "").trim().toUpperCase();
    const selectedRoom = state.rooms.find((room) => room.code === roomCode);
    if (selectedRoom) {
      elements.candyQuickHallSelect.value = selectedRoom.hallId;
      renderCandyQuickRoomOptions(roomCode);
      elements.candyQuickRoomSelect.value = roomCode;
    }
    showSelectedRoomSnapshot().catch((error) => {
      setStatus(elements.roomStatus, error.message || "Kunne ikke hente romstatus.", "error");
    });
  });

  elements.candyQuickRoomSelect.addEventListener("change", () => {
    const roomCode = (elements.candyQuickRoomSelect.value || "").trim().toUpperCase();
    if (!roomCode) {
      return;
    }
    const selectedRoom = state.rooms.find((room) => room.code === roomCode);
    if (selectedRoom) {
      elements.candyQuickHallSelect.value = selectedRoom.hallId;
      renderCandyQuickRoomOptions(roomCode);
      elements.candyQuickRoomSelect.value = roomCode;
    }
    elements.roomSelect.value = roomCode;
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

  elements.createAndStartRoomBtn.addEventListener("click", () => {
    handleCreateAndStartRoom().catch((error) => {
      setStatus(elements.roomStatus, error.message || "Kunne ikke opprette + starte rom.", "error");
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
