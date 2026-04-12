const ADMIN_TOKEN_KEY = "bingo_admin_access_token";
// Chat3: RBAC block start
const CHAT3_SECTION_ACCESS_RULES = {
  "section-game-settings": { permissions: ["GAME_CATALOG_READ"], mode: "all" },
  "section-games": { permissions: ["GAME_CATALOG_READ"], mode: "all" },
  "section-halls": { permissions: ["HALL_READ"], mode: "all" },
  "section-terminals": { permissions: ["TERMINAL_READ"], mode: "all" },
  "section-hall-rules": { permissions: ["HALL_GAME_CONFIG_READ"], mode: "all" },
  "section-wallet-compliance": { permissions: ["WALLET_COMPLIANCE_READ"], mode: "all" },
  "section-prize-policy": { permissions: ["PRIZE_POLICY_READ"], mode: "all" },
  "section-room-control": { permissions: ["ROOM_CONTROL_READ"], mode: "all" },
  "section-settings-change-log": { permissions: ["GAME_SETTINGS_CHANGELOG_READ"], mode: "all" }
};

const CHAT3_ACTION_PERMISSION_RULES = {
  saveBtn: "GAME_CATALOG_WRITE",
  reloadBtn: "GAME_CATALOG_READ",
  createHallBtn: "HALL_WRITE",
  saveHallBtn: "HALL_WRITE",
  reloadHallsBtn: "HALL_READ",
  createTerminalBtn: "TERMINAL_WRITE",
  saveTerminalBtn: "TERMINAL_WRITE",
  reloadTerminalsBtn: "TERMINAL_READ",
  saveConfigBtn: "HALL_GAME_CONFIG_WRITE",
  reloadConfigBtn: "HALL_GAME_CONFIG_READ",
  refreshRoomsBtn: "ROOM_CONTROL_READ",
  createRoomBtn: "ROOM_CONTROL_WRITE",
  createAndStartRoomBtn: "ROOM_CONTROL_WRITE",
  startRoomBtn: "ROOM_CONTROL_WRITE",
  drawNextBtn: "ROOM_CONTROL_WRITE",
  endRoomBtn: "ROOM_CONTROL_WRITE",
  loadComplianceBtn: "WALLET_COMPLIANCE_READ",
  saveLossLimitsBtn: "WALLET_COMPLIANCE_WRITE",
  setTimedPauseBtn: "WALLET_COMPLIANCE_WRITE",
  clearTimedPauseBtn: "WALLET_COMPLIANCE_WRITE",
  setSelfExclusionBtn: "WALLET_COMPLIANCE_WRITE",
  clearSelfExclusionBtn: "WALLET_COMPLIANCE_WRITE",
  loadExtraDrawDenialsBtn: "EXTRA_DRAW_DENIALS_READ",
  loadPrizePolicyBtn: "PRIZE_POLICY_READ",
  savePrizePolicyBtn: "PRIZE_POLICY_WRITE",
  awardExtraPrizeBtn: "EXTRA_PRIZE_AWARD",
  settingsLogLoadBtn: "GAME_SETTINGS_CHANGELOG_READ"
};
// Chat3: RBAC block end
const SECTION_HASH_PREFIX = "#section-";
const DEFAULT_ADMIN_SECTION_ID = "section-game-settings";

const elements = {
  loginCard: document.getElementById("loginCard"),
  adminCard: document.getElementById("adminCard"),
  loginStatus: document.getElementById("loginStatus"),
  adminStatus: document.getElementById("adminStatus"),
  adminIdentity: document.getElementById("adminIdentity"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  loginBtn: document.getElementById("loginBtn"),
  adminNavLinks: Array.from(document.querySelectorAll(".admin-nav a[href^='#section-']")),
  adminSections: Array.from(document.querySelectorAll(".admin-content .admin-section")),
  adminSidebar: document.querySelector(".admin-sidebar"),

  settingsGameSelect: document.getElementById("settingsGameSelect"),
  settingsFields: document.getElementById("settingsFields"),
  settingsSaveState: document.getElementById("settingsSaveState"),
  settingsDirtyState: document.getElementById("settingsDirtyState"),
  settingsAdvancedJson: document.getElementById("settingsAdvancedJson"),
  settingsApplyJsonBtn: document.getElementById("settingsApplyJsonBtn"),
  settingsSaveBtn: document.getElementById("settingsSaveBtn"),
  settingsReloadBtn: document.getElementById("settingsReloadBtn"),
  settingsStatus: document.getElementById("settingsStatus"),

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
  roomStatus: document.getElementById("roomStatus"),
  // Chat3: RBAC block start
  settingsLogGameSlug: null,
  settingsLogLimit: null,
  settingsLogLoadBtn: null,
  settingsLogStatus: null,
  policyRoleSummary: null,
  policySummaryList: null,
  policyStatus: null
  // Chat3: RBAC block end
};

const state = {
  token: "",
  user: null,
  games: [],
  halls: [],
  terminals: [],
  rooms: [],
  hallGameConfigs: [],
  activeSectionId: "",
  settingsCatalog: [],
  settingsCatalogBySlug: {},
  settingsCurrentGameSlug: "",
  settingsOriginal: {},
  settingsDraft: {},
  settingsFieldErrors: {},
  settingsFieldInputs: new Map(),
  settingsDirty: false,
  settingsSaveState: "Ikke lagret",
  // Chat3: RBAC block start
  adminPermissions: [],
  adminPermissionMap: {},
  adminPolicy: {}
  // Chat3: RBAC block end
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
  const rbacLocked = button.dataset?.rbacLocked === "true";
  button.disabled = rbacLocked || isLoading;
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
  applyAdminSectionFromHash({ syncHash: true });
}

// Chat3: RBAC block start
function chat3HasPermission(permission) {
  return Boolean(state.adminPermissionMap?.[permission]);
}

function chat3EnsureUiExtensions() {
  const sidebar = elements.adminSidebar || document.querySelector(".admin-sidebar");
  if (sidebar && !document.getElementById("policyStatus")) {
    const policyBox = document.createElement("div");
    policyBox.style.marginTop = "14px";
    policyBox.style.borderTop = "1px solid #e5e7eb";
    policyBox.style.paddingTop = "10px";
    policyBox.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:14px;">Tilgangspolicy</h3>
      <p id="policyRoleSummary" class="muted">Policy ikke lastet.</p>
      <ul id="policySummaryList" style="margin:0;padding-left:18px;color:#374151;font-size:13px;"></ul>
      <pre id="policyStatus" class="status">Ingen policydata lastet.</pre>
    `;
    sidebar.appendChild(policyBox);
  }

  if (!document.getElementById("section-settings-change-log")) {
    const adminContent = document.querySelector(".admin-content");
    if (adminContent) {
      const section = document.createElement("article");
      section.id = "section-settings-change-log";
      section.className = "card admin-section";
      section.innerHTML = `
        <h2>Settings endringslogg</h2>
        <p class="muted">Viser hvem som endret settings, rolle, tidspunkt, source, effekt fra og payload-sammendrag.</p>
        <div class="grid">
          <div class="field">
            <label for="settingsLogGameSlug">Spill (gameSlug)</label>
            <select id="settingsLogGameSlug"></select>
          </div>
          <div class="field">
            <label for="settingsLogLimit">Antall rader (limit)</label>
            <input id="settingsLogLimit" type="number" min="1" max="200" value="50" />
          </div>
        </div>
        <div class="toolbar">
          <button id="settingsLogLoadBtn" class="secondary">Last endringslogg</button>
        </div>
        <pre id="settingsLogStatus" class="status">Ingen endringslogg lastet.</pre>
      `;
      adminContent.insertBefore(section, adminContent.firstChild);
    }
  }

  if (sidebar) {
    const nav = sidebar.querySelector(".admin-nav");
    if (nav && !nav.querySelector("a[href='#section-settings-change-log']")) {
      const link = document.createElement("a");
      link.href = "#section-settings-change-log";
      link.textContent = "Settings endringslogg";
      nav.insertBefore(link, nav.firstChild);
    }
  }

  elements.policyRoleSummary = document.getElementById("policyRoleSummary");
  elements.policySummaryList = document.getElementById("policySummaryList");
  elements.policyStatus = document.getElementById("policyStatus");
  elements.settingsLogGameSlug = document.getElementById("settingsLogGameSlug");
  elements.settingsLogLimit = document.getElementById("settingsLogLimit");
  elements.settingsLogLoadBtn = document.getElementById("settingsLogLoadBtn");
  elements.settingsLogStatus = document.getElementById("settingsLogStatus");
  elements.adminNavLinks = Array.from(document.querySelectorAll(".admin-nav a[href^='#section-']"));
  elements.adminSections = Array.from(document.querySelectorAll(".admin-content .admin-section"));
}

function chat3EvaluateSectionAccess(sectionId) {
  const rule = CHAT3_SECTION_ACCESS_RULES[sectionId];
  if (!rule) {
    return { allowed: true, missingPermissions: [] };
  }
  const missingPermissions = rule.permissions.filter((permission) => !chat3HasPermission(permission));
  if (rule.mode === "any") {
    return {
      allowed: missingPermissions.length < rule.permissions.length,
      missingPermissions
    };
  }
  return {
    allowed: missingPermissions.length === 0,
    missingPermissions
  };
}

function chat3ApplySectionVisibility() {
  const lockedLines = [];
  for (const section of elements.adminSections) {
    const evaluation = chat3EvaluateSectionAccess(section.id);
    const hidden = !evaluation.allowed;
    section.hidden = hidden;

    const navLink = elements.adminNavLinks.find((link) => link.getAttribute("href") === `#${section.id}`);
    if (navLink) {
      navLink.hidden = hidden;
      navLink.classList.toggle("locked", hidden);
    }

    if (hidden) {
      const sectionLabel =
        navLink?.textContent?.trim() ||
        section.querySelector("h2")?.textContent?.trim() ||
        section.id;
      lockedLines.push(`${sectionLabel}: mangler ${evaluation.missingPermissions.join(", ")}`);
    }
  }
  return lockedLines;
}

function chat3ApplyActionPermissionLocks() {
  for (const [elementKey, permission] of Object.entries(CHAT3_ACTION_PERMISSION_RULES)) {
    const element = elements[elementKey];
    if (!(element instanceof HTMLButtonElement)) {
      continue;
    }
    const allowed = chat3HasPermission(permission);
    if (!allowed) {
      element.dataset.rbacLocked = "true";
      element.disabled = true;
      element.title = `Låst for rollen ${state.user?.role || "ukjent"} (krever ${permission}).`;
      continue;
    }
    delete element.dataset.rbacLocked;
    element.disabled = false;
    if (element.title && element.title.includes("krever")) {
      element.removeAttribute("title");
    }
  }
}

function chat3RenderPolicySummary(lockedLines) {
  const totalPermissions = Object.keys(state.adminPolicy || {}).length;
  if (elements.policyRoleSummary) {
    elements.policyRoleSummary.textContent = `Rolle: ${state.user?.role || "-"} | Tilgang: ${state.adminPermissions.length}/${totalPermissions} permissions`;
  }

  if (elements.policySummaryList) {
    elements.policySummaryList.innerHTML = "";
    for (const [sectionId, rule] of Object.entries(CHAT3_SECTION_ACCESS_RULES)) {
      const evaluation = chat3EvaluateSectionAccess(sectionId);
      const line = document.createElement("li");
      const sectionLabel =
        elements.adminNavLinks.find((link) => link.getAttribute("href") === `#${sectionId}`)?.textContent?.trim() ||
        sectionId;
      const joiner = rule.mode === "any" ? " eller " : " + ";
      line.textContent = `${sectionLabel}: ${evaluation.allowed ? "åpen" : "låst"} (krever ${rule.permissions.join(joiner)})`;
      elements.policySummaryList.appendChild(line);
    }
  }

  if (lockedLines.length === 0) {
    setStatus(elements.policyStatus, "Ingen seksjoner er låst for din rolle.", "success");
    return;
  }
  setStatus(elements.policyStatus, `Skjult/låst:\n${lockedLines.map((line) => `- ${line}`).join("\n")}`);
}

function chat3ApplyRbacUi() {
  const lockedLines = chat3ApplySectionVisibility();
  chat3ApplyActionPermissionLocks();
  chat3RenderPolicySummary(lockedLines);
}

function chat3RenderSettingsLogGameOptions() {
  if (!elements.settingsLogGameSlug) {
    return;
  }
  const previous = elements.settingsLogGameSlug.value;
  setSelectOptions(
    elements.settingsLogGameSlug,
    [
      { value: "", label: "Alle spill" },
      ...state.games.map((game) => ({
        value: game.slug,
        label: `${game.title} (${game.slug})`
      }))
    ],
    previous,
    "Alle spill"
  );
}

function chat3FormatSettingsLogEntry(entry) {
  const actor = entry?.changedByDisplayName || entry?.changedByUserId || "System";
  return [
    `${entry?.createdAt || "-"} | game=${entry?.gameSlug || "-"} | source=${entry?.source || "-"}`,
    `aktor=${actor} (${entry?.changedByRole || "-"}) | effektFra=${entry?.effectiveFrom || "-"}`,
    `payload=${entry?.payloadSummary || "-"}`
  ].join("\n");
}

async function chat3LoadSettingsChangeLog() {
  if (!chat3HasPermission("GAME_SETTINGS_CHANGELOG_READ")) {
    setStatus(elements.settingsLogStatus, "Låst: mangler GAME_SETTINGS_CHANGELOG_READ.");
    return;
  }

  const limitRaw = Number.parseInt(String(elements.settingsLogLimit?.value || "50"), 10);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(200, limitRaw) : 50;
  const gameSlug = String(elements.settingsLogGameSlug?.value || "").trim();
  const query = new URLSearchParams({ limit: String(limit) });
  if (gameSlug) {
    query.set("gameSlug", gameSlug);
  }
  const entries = await apiRequest(`/api/admin/game-settings/change-log?${query.toString()}`, { auth: true });
  if (!Array.isArray(entries) || entries.length === 0) {
    setStatus(elements.settingsLogStatus, "Ingen endringer funnet med valgt filter.", "success");
    return;
  }
  setStatus(
    elements.settingsLogStatus,
    entries.map((entry) => chat3FormatSettingsLogEntry(entry)).join("\n\n"),
    "success"
  );
}

async function chat3LoadAdminPermissions() {
  const payload = await apiRequest("/api/admin/permissions", { auth: true });
  state.adminPermissions = Array.isArray(payload?.permissions) ? payload.permissions : [];
  state.adminPermissionMap =
    payload?.permissionMap && typeof payload.permissionMap === "object" ? payload.permissionMap : {};
  state.adminPolicy = payload?.policy && typeof payload.policy === "object" ? payload.policy : {};
  chat3ApplyRbacUi();
}
// Chat3: RBAC block end

// Chat2: Settings UI block start (single-view routing + settings editor)
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }
  if (isPlainObject(value)) {
    const next = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      next[key] = cloneJsonValue(nestedValue);
    }
    return next;
  }
  return value;
}

function stripUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item));
  }
  if (isPlainObject(value)) {
    const next = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === undefined) {
        continue;
      }
      next[key] = stripUndefinedDeep(nestedValue);
    }
    return next;
  }
  return value;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepEqualJson(left, right) {
  return stableSerialize(stripUndefinedDeep(left)) === stableSerialize(stripUndefinedDeep(right));
}

function asFiniteNumberOrUndefined(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeAdminSectionIdFromHash(hashValue) {
  const raw = String(hashValue || "").trim();
  if (!raw.startsWith(SECTION_HASH_PREFIX)) {
    return "";
  }
  return raw.slice(1);
}

function resolveDefaultAdminSectionId() {
  const firstNavHref = elements.adminNavLinks[0]?.getAttribute("href") || "";
  const fromNav = normalizeAdminSectionIdFromHash(firstNavHref);
  if (fromNav) {
    return fromNav;
  }
  return elements.adminSections[0]?.id || DEFAULT_ADMIN_SECTION_ID;
}

function applyAdminSection(sectionId, options = {}) {
  const sectionIds = elements.adminSections.map((section) => section.id);
  const targetSectionId = sectionIds.includes(sectionId) ? sectionId : resolveDefaultAdminSectionId();
  state.activeSectionId = targetSectionId;

  for (const section of elements.adminSections) {
    const isActive = section.id === targetSectionId;
    section.hidden = !isActive;
    section.classList.toggle("hidden", !isActive);
  }

  for (const link of elements.adminNavLinks) {
    const linkSectionId = normalizeAdminSectionIdFromHash(link.getAttribute("href"));
    const isActive = linkSectionId === targetSectionId;
    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  if (options.syncHash) {
    const hash = `#${targetSectionId}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  }
}

function applyAdminSectionFromHash(options = {}) {
  const requestedSectionId = normalizeAdminSectionIdFromHash(window.location.hash);
  const hasRequestedSection = elements.adminSections.some((section) => section.id === requestedSectionId);
  applyAdminSection(requestedSectionId, {
    syncHash: Boolean(options.syncHash) && !hasRequestedSection
  });
}

function splitSettingsPath(pathValue) {
  if (Array.isArray(pathValue)) {
    return pathValue.map((part) => String(part).trim()).filter(Boolean);
  }
  return String(pathValue || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getSettingsValueAtPath(source, pathValue) {
  const parts = splitSettingsPath(pathValue);
  if (!parts.length) {
    return undefined;
  }
  let cursor = source;
  for (const part of parts) {
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function removeSettingsValueAtPath(target, pathValue) {
  const parts = splitSettingsPath(pathValue);
  if (!parts.length) {
    return;
  }

  const stack = [];
  let cursor = target;
  for (const part of parts) {
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) {
      return;
    }
    stack.push({ parent: cursor, key: part });
    cursor = cursor[part];
  }

  const leaf = stack.pop();
  if (!leaf) {
    return;
  }
  delete leaf.parent[leaf.key];

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    const candidate = entry.parent[entry.key];
    if (!isPlainObject(candidate)) {
      break;
    }
    if (Object.keys(candidate).length === 0) {
      delete entry.parent[entry.key];
      continue;
    }
    break;
  }
}

function setSettingsValueAtPath(target, pathValue, value) {
  if (value === undefined) {
    removeSettingsValueAtPath(target, pathValue);
    return;
  }
  const parts = splitSettingsPath(pathValue);
  if (!parts.length) {
    return;
  }
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!isPlainObject(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function makeOptionValueKey(value) {
  if (typeof value === "string") {
    return `string:${value}`;
  }
  if (typeof value === "number") {
    return `number:${String(value)}`;
  }
  if (typeof value === "boolean") {
    return `boolean:${String(value)}`;
  }
  return `json:${stableSerialize(value)}`;
}

function formatSettingsMetaValue(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function normalizeSettingsFieldType(rawType, defaultValue) {
  const normalized = String(rawType || "")
    .trim()
    .toLowerCase();

  if (normalized === "int" || normalized === "integer") {
    return "integer";
  }
  if (normalized === "number" || normalized === "float" || normalized === "double" || normalized === "decimal") {
    return "number";
  }
  if (normalized === "bool" || normalized === "boolean") {
    return "boolean";
  }
  if (normalized === "enum" || normalized === "select") {
    return "enum";
  }
  if (normalized === "json" || normalized === "object") {
    return "json";
  }
  if (normalized === "text" || normalized === "textarea" || normalized === "multiline") {
    return "text";
  }

  if (typeof defaultValue === "boolean") {
    return "boolean";
  }
  if (typeof defaultValue === "number") {
    return Number.isInteger(defaultValue) ? "integer" : "number";
  }
  if (isPlainObject(defaultValue) || Array.isArray(defaultValue)) {
    return "json";
  }
  return "string";
}

function normalizeSettingsFieldOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions
      .map((option) => {
        if (isPlainObject(option)) {
          return {
            value: option.value,
            label: String(option.label ?? option.name ?? option.value ?? "")
          };
        }
        return {
          value: option,
          label: String(option)
        };
      })
      .filter((option) => option.label !== "");
  }

  if (isPlainObject(rawOptions)) {
    return Object.entries(rawOptions).map(([value, label]) => ({
      value,
      label: String(label)
    }));
  }

  return [];
}

function normalizeSettingsField(rawField, fallbackKey) {
  const source = isPlainObject(rawField) ? rawField : {};
  const path = splitSettingsPath(source.path ?? source.key ?? source.id ?? fallbackKey).join(".");
  if (!path) {
    return null;
  }

  const defaultValue = source.default ?? source.defaultValue;
  const options = normalizeSettingsFieldOptions(source.options ?? source.enum ?? source.values);
  let type = normalizeSettingsFieldType(source.type ?? source.valueType, defaultValue);
  if (options.length > 0 && type !== "boolean") {
    type = "enum";
  }

  const rawLock = source.lock ?? source.locked;
  let isLocked = false;
  let lockReason = "";
  if (typeof rawLock === "boolean") {
    isLocked = rawLock;
  } else if (typeof rawLock === "string") {
    isLocked = true;
    lockReason = rawLock;
  } else if (isPlainObject(rawLock)) {
    isLocked = Boolean(rawLock.active ?? rawLock.isLocked ?? true);
    lockReason = String(rawLock.reason ?? rawLock.message ?? "");
  }
  if (!lockReason && typeof source.lockReason === "string") {
    lockReason = source.lockReason;
  }

  const readOnly =
    Boolean(source.readOnly ?? source.readonly ?? source.isReadOnly ?? source.mutable === false) || isLocked;

  return {
    path,
    label: String(source.label ?? source.title ?? fallbackKey ?? path),
    description: String(source.description ?? source.helpText ?? ""),
    type,
    min: asFiniteNumberOrUndefined(source.min ?? source.minimum ?? source.constraints?.min),
    max: asFiniteNumberOrUndefined(source.max ?? source.maximum ?? source.constraints?.max),
    step: asFiniteNumberOrUndefined(source.step ?? source.increment),
    unit: String(source.unit ?? source.suffix ?? ""),
    defaultValue,
    required: Boolean(source.required),
    readOnly,
    isLocked,
    lockReason,
    options
  };
}

function normalizeSettingsFieldList(rawFields) {
  if (Array.isArray(rawFields)) {
    return rawFields
      .map((field, index) => normalizeSettingsField(field, isPlainObject(field) ? field.key : `field_${index + 1}`))
      .filter(Boolean);
  }
  if (isPlainObject(rawFields)) {
    return Object.entries(rawFields)
      .map(([key, field]) => normalizeSettingsField(field, key))
      .filter(Boolean);
  }
  return [];
}

function normalizeSettingsCatalogGame(rawGame, fallbackSlug) {
  const source = isPlainObject(rawGame) ? rawGame : {};
  const slug = String(source.slug ?? source.gameSlug ?? source.id ?? fallbackSlug ?? "").trim();
  if (!slug) {
    return null;
  }

  return {
    slug,
    title: String(source.title ?? source.label ?? source.name ?? slug),
    description: String(source.description ?? ""),
    fields: normalizeSettingsFieldList(
      source.fields ?? source.settingsFields ?? source.catalogFields ?? source.schema ?? source.catalog
    )
  };
}

function normalizeSettingsCatalogResponse(payload) {
  let rawGames = [];

  if (Array.isArray(payload)) {
    rawGames = payload;
  } else if (Array.isArray(payload?.games)) {
    rawGames = payload.games;
  } else if (Array.isArray(payload?.catalog)) {
    rawGames = payload.catalog;
  } else if (Array.isArray(payload?.items)) {
    rawGames = payload.items;
  } else if (isPlainObject(payload?.games)) {
    rawGames = Object.entries(payload.games).map(([slug, game]) => ({ ...(isPlainObject(game) ? game : {}), slug }));
  } else if (isPlainObject(payload)) {
    rawGames = Object.entries(payload)
      .filter(([, value]) => isPlainObject(value))
      .map(([slug, game]) => ({ ...game, slug }));
  }

  return rawGames
    .map((rawGame) => normalizeSettingsCatalogGame(rawGame))
    .filter((game) => game && game.slug);
}

function normalizeSettingsGameResponse(payload) {
  if (isPlainObject(payload?.settings)) {
    return stripUndefinedDeep(cloneJsonValue(payload.settings));
  }
  if (isPlainObject(payload?.values)) {
    return stripUndefinedDeep(cloneJsonValue(payload.values));
  }
  if (isPlainObject(payload?.game?.settings)) {
    return stripUndefinedDeep(cloneJsonValue(payload.game.settings));
  }
  if (!isPlainObject(payload)) {
    return {};
  }

  const reserved = new Set(["slug", "gameSlug", "title", "description", "updatedAt", "createdAt", "id", "label"]);
  const candidateKeys = Object.keys(payload).filter((key) => !reserved.has(key));
  if (!candidateKeys.length) {
    return {};
  }
  if (candidateKeys.length === Object.keys(payload).length) {
    return stripUndefinedDeep(cloneJsonValue(payload));
  }
  const next = {};
  for (const key of candidateKeys) {
    next[key] = cloneJsonValue(payload[key]);
  }
  return stripUndefinedDeep(next);
}

function getCurrentSettingsCatalogGame() {
  const slug = String(elements.settingsGameSelect?.value || "").trim();
  return state.settingsCatalogBySlug[slug] || null;
}

function getCurrentSettingsFields() {
  return getCurrentSettingsCatalogGame()?.fields || [];
}

function setSettingsSaveState(nextState) {
  state.settingsSaveState = nextState;
  if (!elements.settingsSaveState) {
    return;
  }
  elements.settingsSaveState.textContent = nextState;
  elements.settingsSaveState.classList.remove("saving", "saved", "error");
  if (nextState === "Lagrer...") {
    elements.settingsSaveState.classList.add("saving");
  } else if (nextState === "Lagret") {
    elements.settingsSaveState.classList.add("saved");
  } else if (nextState === "Feil") {
    elements.settingsSaveState.classList.add("error");
  }
}

function updateSettingsDirtyIndicator() {
  if (!elements.settingsDirtyState) {
    return;
  }
  elements.settingsDirtyState.textContent = state.settingsDirty
    ? "Du har ulagrede endringer."
    : "Ingen ulagrede endringer.";
}

function syncSettingsAdvancedJson() {
  if (!elements.settingsAdvancedJson) {
    return;
  }
  elements.settingsAdvancedJson.value = JSON.stringify(stripUndefinedDeep(cloneJsonValue(state.settingsDraft)), null, 2);
}

function updateSettingsSaveButtonState() {
  if (!elements.settingsSaveBtn) {
    return;
  }
  const hasErrors = Object.keys(state.settingsFieldErrors).length > 0;
  elements.settingsSaveBtn.disabled = !state.settingsCurrentGameSlug || !state.settingsDirty || hasErrors;
}

function updateSettingsDirtyState() {
  state.settingsDirty = !deepEqualJson(state.settingsDraft, state.settingsOriginal);
  updateSettingsDirtyIndicator();
  updateSettingsSaveButtonState();
}

function setSingleSettingsFieldValidation(path, errorMessage) {
  const entry = state.settingsFieldInputs.get(path);
  if (!entry) {
    return;
  }
  entry.error.textContent = errorMessage || "";
  entry.input.classList.toggle("input-error", Boolean(errorMessage));
}

function applySettingsValidationState() {
  for (const path of state.settingsFieldInputs.keys()) {
    setSingleSettingsFieldValidation(path, state.settingsFieldErrors[path] || "");
  }
}

function validateSettingsField(field) {
  const value = getSettingsValueAtPath(state.settingsDraft, field.path);
  const originalValue = getSettingsValueAtPath(state.settingsOriginal, field.path);

  if (field.readOnly && !deepEqualJson(value, originalValue)) {
    return `${field.label} er låst/readOnly og kan ikke endres.`;
  }
  if (value === undefined || value === null || value === "") {
    return field.required ? `${field.label} er påkrevd.` : "";
  }
  if (field.type === "boolean" && typeof value !== "boolean") {
    return `${field.label} må være Ja eller Nei.`;
  }
  if ((field.type === "number" || field.type === "integer") && (typeof value !== "number" || !Number.isFinite(value))) {
    return `${field.label} må være et gyldig tall.`;
  }
  if (field.type === "integer" && !Number.isInteger(value)) {
    return `${field.label} må være et heltall.`;
  }
  if ((field.type === "number" || field.type === "integer") && field.min !== undefined && value < field.min) {
    return `${field.label} må være minst ${field.min}.`;
  }
  if ((field.type === "number" || field.type === "integer") && field.max !== undefined && value > field.max) {
    return `${field.label} må være maks ${field.max}.`;
  }
  if (field.options.length > 0 && !field.options.some((option) => deepEqualJson(option.value, value))) {
    return `${field.label} har en verdi som ikke finnes i katalogen.`;
  }
  if (field.type === "json" && !isPlainObject(value) && !Array.isArray(value)) {
    return `${field.label} må være gyldig JSON.`;
  }
  return "";
}

function validateAllSettingsFields() {
  const nextErrors = {};
  for (const field of getCurrentSettingsFields()) {
    const error = validateSettingsField(field);
    if (error) {
      nextErrors[field.path] = error;
    }
  }
  state.settingsFieldErrors = nextErrors;
  applySettingsValidationState();
  updateSettingsSaveButtonState();
  return Object.keys(nextErrors).length === 0;
}

function coerceSettingsFieldInputValue(field, rawValue) {
  const textValue = String(rawValue ?? "");
  const trimmed = textValue.trim();
  if (!trimmed) {
    return undefined;
  }

  if (field.type === "boolean") {
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    throw new Error(`${field.label} må være Ja eller Nei.`);
  }

  if (field.type === "number" || field.type === "integer") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field.label} må være et gyldig tall.`);
    }
    return parsed;
  }

  if (field.type === "enum") {
    const match = field.options.find((option) => makeOptionValueKey(option.value) === trimmed);
    if (!match) {
      throw new Error(`${field.label} har en verdi som ikke finnes i katalogen.`);
    }
    return cloneJsonValue(match.value);
  }

  if (field.type === "json") {
    try {
      const parsed = JSON.parse(trimmed);
      if (!isPlainObject(parsed) && !Array.isArray(parsed)) {
        throw new Error("JSON må være objekt eller array.");
      }
      return parsed;
    } catch (_error) {
      throw new Error(`${field.label} må være gyldig JSON.`);
    }
  }

  return textValue;
}

function formatSettingsFieldTypeLabel(type) {
  if (type === "integer") {
    return "integer";
  }
  if (type === "number") {
    return "number";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (type === "enum") {
    return "enum";
  }
  if (type === "json") {
    return "json";
  }
  if (type === "text") {
    return "text";
  }
  return "string";
}

function createSettingsInputElement(field, currentValue) {
  const inputId = `settings-field-${field.path.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  let inputElement;

  if (field.type === "boolean") {
    inputElement = document.createElement("select");
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Ikke satt";
    inputElement.appendChild(emptyOption);
    const trueOption = document.createElement("option");
    trueOption.value = "true";
    trueOption.textContent = "Ja";
    inputElement.appendChild(trueOption);
    const falseOption = document.createElement("option");
    falseOption.value = "false";
    falseOption.textContent = "Nei";
    inputElement.appendChild(falseOption);
    inputElement.value = typeof currentValue === "boolean" ? String(currentValue) : "";
  } else if (field.type === "enum") {
    inputElement = document.createElement("select");
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Ikke satt";
    inputElement.appendChild(emptyOption);
    for (const option of field.options) {
      const optionElement = document.createElement("option");
      optionElement.value = makeOptionValueKey(option.value);
      optionElement.textContent = option.label;
      inputElement.appendChild(optionElement);
    }
    const selected = currentValue === undefined ? "" : makeOptionValueKey(currentValue);
    const hasSelected = Array.from(inputElement.options).some((option) => option.value === selected);
    if (hasSelected) {
      inputElement.value = selected;
    } else if (selected) {
      const customOption = document.createElement("option");
      customOption.value = selected;
      customOption.textContent = `Egendefinert: ${formatSettingsMetaValue(currentValue)}`;
      inputElement.appendChild(customOption);
      inputElement.value = selected;
    } else {
      inputElement.value = "";
    }
  } else if (field.type === "text" || field.type === "json") {
    inputElement = document.createElement("textarea");
    inputElement.value =
      currentValue === undefined
        ? ""
        : field.type === "json"
          ? JSON.stringify(currentValue, null, 2)
          : String(currentValue);
  } else {
    inputElement = document.createElement("input");
    if (field.type === "number" || field.type === "integer") {
      inputElement.type = "number";
      if (field.min !== undefined) {
        inputElement.min = String(field.min);
      }
      if (field.max !== undefined) {
        inputElement.max = String(field.max);
      }
      if (field.step !== undefined) {
        inputElement.step = String(field.step);
      } else if (field.type === "integer") {
        inputElement.step = "1";
      } else {
        inputElement.step = "any";
      }
      inputElement.value = currentValue === undefined ? "" : String(currentValue);
    } else {
      inputElement.type = "text";
      inputElement.value = currentValue === undefined ? "" : String(currentValue);
    }
  }

  inputElement.id = inputId;
  inputElement.disabled = field.readOnly;
  if (currentValue === undefined && field.defaultValue !== undefined) {
    inputElement.placeholder = `Standard: ${formatSettingsMetaValue(field.defaultValue)}`;
  }
  return inputElement;
}

function handleSettingsFieldInput(field) {
  const entry = state.settingsFieldInputs.get(field.path);
  if (!entry) {
    return;
  }

  try {
    const nextValue = coerceSettingsFieldInputValue(field, entry.input.value);
    setSettingsValueAtPath(state.settingsDraft, field.path, nextValue);
    const validationError = validateSettingsField(field);
    if (validationError) {
      state.settingsFieldErrors[field.path] = validationError;
    } else {
      delete state.settingsFieldErrors[field.path];
    }
    setSingleSettingsFieldValidation(field.path, state.settingsFieldErrors[field.path] || "");
    syncSettingsAdvancedJson();
    updateSettingsDirtyState();
    if (Object.keys(state.settingsFieldErrors).length > 0) {
      setSettingsSaveState("Feil");
    } else if (state.settingsDirty) {
      setSettingsSaveState("Ikke lagret");
    }
  } catch (error) {
    state.settingsFieldErrors[field.path] = error.message || "Ugyldig verdi.";
    setSingleSettingsFieldValidation(field.path, state.settingsFieldErrors[field.path]);
    updateSettingsSaveButtonState();
    setSettingsSaveState("Feil");
  }
}

function renderSettingsFields() {
  if (!elements.settingsFields) {
    return;
  }
  elements.settingsFields.innerHTML = "";
  state.settingsFieldInputs = new Map();

  const game = getCurrentSettingsCatalogGame();
  if (!game) {
    const info = document.createElement("p");
    info.className = "settings-empty";
    info.textContent = "Velg et spill for å se innstillinger.";
    elements.settingsFields.appendChild(info);
    state.settingsFieldErrors = {};
    updateSettingsSaveButtonState();
    return;
  }

  if (!game.fields.length) {
    const info = document.createElement("p");
    info.className = "settings-empty";
    info.textContent = "Katalogen har ingen felt for valgt spill. Bruk Avansert JSON ved behov.";
    elements.settingsFields.appendChild(info);
    state.settingsFieldErrors = {};
    updateSettingsSaveButtonState();
    return;
  }

  for (const field of game.fields) {
    const fieldCard = document.createElement("section");
    fieldCard.className = "settings-field-card";

    const title = document.createElement("h3");
    title.textContent = field.label;
    fieldCard.appendChild(title);

    if (field.description) {
      const description = document.createElement("p");
      description.className = "settings-field-description";
      description.textContent = field.description;
      fieldCard.appendChild(description);
    }

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "field";
    const inputLabel = document.createElement("label");
    inputLabel.textContent = "Verdi";
    const inputElement = createSettingsInputElement(field, getSettingsValueAtPath(state.settingsDraft, field.path));
    inputLabel.setAttribute("for", inputElement.id);
    inputWrapper.appendChild(inputLabel);
    inputWrapper.appendChild(inputElement);

    const errorElement = document.createElement("p");
    errorElement.className = "field-error";
    errorElement.textContent = state.settingsFieldErrors[field.path] || "";
    inputWrapper.appendChild(errorElement);

    fieldCard.appendChild(inputWrapper);

    state.settingsFieldInputs.set(field.path, { input: inputElement, error: errorElement });

    const meta = document.createElement("p");
    meta.className = "settings-field-meta";
    const lockText = field.isLocked ? `Ja${field.lockReason ? ` (${field.lockReason})` : ""}` : "Nei";
    meta.textContent = [
      `Type: ${formatSettingsFieldTypeLabel(field.type)}`,
      `Min: ${field.min ?? "-"}`,
      `Maks: ${field.max ?? "-"}`,
      `Enhet: ${field.unit || "-"}`,
      `Default: ${formatSettingsMetaValue(field.defaultValue)}`,
      `Read only: ${field.readOnly ? "Ja" : "Nei"}`,
      `Låst: ${lockText}`
    ].join(" | ");
    fieldCard.appendChild(meta);

    inputElement.addEventListener(inputElement.tagName === "SELECT" ? "change" : "input", () => {
      handleSettingsFieldInput(field);
    });

    elements.settingsFields.appendChild(fieldCard);
  }

  applySettingsValidationState();
  updateSettingsSaveButtonState();
}

function renderSettingsGameOptions() {
  const previous = state.settingsCurrentGameSlug || elements.settingsGameSelect?.value || "";
  setSelectOptions(
    elements.settingsGameSelect,
    state.settingsCatalog.map((game) => ({
      value: game.slug,
      label: `${game.title} (${game.slug})`
    })),
    previous,
    "Ingen spill i settings-katalog"
  );
  state.settingsCurrentGameSlug = String(elements.settingsGameSelect?.value || "").trim();
}

async function loadSettingsForGameSlug(gameSlug) {
  const slug = String(gameSlug || "").trim();
  if (!slug) {
    state.settingsCurrentGameSlug = "";
    state.settingsOriginal = {};
    state.settingsDraft = {};
    state.settingsFieldErrors = {};
    state.settingsDirty = false;
    renderSettingsFields();
    syncSettingsAdvancedJson();
    setSettingsSaveState("Ikke lagret");
    updateSettingsDirtyIndicator();
    setStatus(elements.settingsStatus, "Velg et spill for å laste innstillinger.");
    return;
  }

  state.settingsCurrentGameSlug = slug;
  setLoading(elements.settingsReloadBtn, true, "Laster...", "Last på nytt");
  setStatus(elements.settingsStatus, `Laster innstillinger for ${slug}...`);
  try {
    const payload = await apiRequest(`/api/admin/settings/games/${encodeURIComponent(slug)}`, { auth: true });
    const normalizedSettings = normalizeSettingsGameResponse(payload);
    state.settingsOriginal = cloneJsonValue(normalizedSettings);
    state.settingsDraft = cloneJsonValue(normalizedSettings);
    state.settingsFieldErrors = {};
    state.settingsDirty = false;
    renderSettingsFields();
    syncSettingsAdvancedJson();
    setSettingsSaveState("Ikke lagret");
    updateSettingsDirtyIndicator();
    setStatus(elements.settingsStatus, `Lastet innstillinger for ${slug}.`, "success");
  } catch (error) {
    state.settingsFieldErrors = {};
    renderSettingsFields();
    setSettingsSaveState("Feil");
    setStatus(elements.settingsStatus, error.message || "Kunne ikke laste spillinnstillinger.", "error");
  } finally {
    setLoading(elements.settingsReloadBtn, false, "Laster...", "Last på nytt");
    updateSettingsSaveButtonState();
  }
}

async function loadSettingsForSelectedGame() {
  const slug = String(elements.settingsGameSelect?.value || "").trim();
  await loadSettingsForGameSlug(slug);
}

async function loadSettingsCatalog() {
  setStatus(elements.settingsStatus, "Laster settings-katalog...");
  try {
    const payload = await apiRequest("/api/admin/settings/catalog", { auth: true });
    const catalog = normalizeSettingsCatalogResponse(payload);
    state.settingsCatalog = catalog;
    state.settingsCatalogBySlug = Object.fromEntries(catalog.map((game) => [game.slug, game]));
    renderSettingsGameOptions();

    if (!catalog.length) {
      state.settingsCurrentGameSlug = "";
      state.settingsOriginal = {};
      state.settingsDraft = {};
      state.settingsFieldErrors = {};
      state.settingsDirty = false;
      renderSettingsFields();
      syncSettingsAdvancedJson();
      setSettingsSaveState("Ikke lagret");
      updateSettingsDirtyIndicator();
      setStatus(elements.settingsStatus, "Ingen spill i settings-katalog.", "error");
      return;
    }

    await loadSettingsForSelectedGame();
  } catch (error) {
    state.settingsCatalog = [];
    state.settingsCatalogBySlug = {};
    state.settingsCurrentGameSlug = "";
    state.settingsOriginal = {};
    state.settingsDraft = {};
    state.settingsFieldErrors = {};
    state.settingsDirty = false;
    renderSettingsGameOptions();
    renderSettingsFields();
    syncSettingsAdvancedJson();
    setSettingsSaveState("Feil");
    updateSettingsDirtyIndicator();
    setStatus(elements.settingsStatus, error.message || "Kunne ikke laste settings-katalog.", "error");
  }
}

function handleSettingsApplyAdvancedJson() {
  let parsed;
  try {
    parsed = JSON.parse(elements.settingsAdvancedJson.value || "{}");
  } catch (_error) {
    setSettingsSaveState("Feil");
    setStatus(elements.settingsStatus, "Avansert JSON er ugyldig JSON.", "error");
    return;
  }

  if (!isPlainObject(parsed)) {
    setSettingsSaveState("Feil");
    setStatus(elements.settingsStatus, "Avansert JSON må være et objekt.", "error");
    return;
  }

  state.settingsDraft = stripUndefinedDeep(cloneJsonValue(parsed));
  renderSettingsFields();
  validateAllSettingsFields();
  syncSettingsAdvancedJson();
  updateSettingsDirtyState();
  if (Object.keys(state.settingsFieldErrors).length > 0) {
    setSettingsSaveState("Feil");
    setStatus(elements.settingsStatus, "JSON ble brukt, men ett eller flere felt er ugyldige.", "error");
    return;
  }
  if (state.settingsDirty) {
    setSettingsSaveState("Ikke lagret");
  }
  setStatus(elements.settingsStatus, "Avansert JSON brukt i feltene.", "success");
}

async function saveSettingsPayloadWithFallback(slug, payload) {
  try {
    return await apiRequest(`/api/admin/settings/games/${encodeURIComponent(slug)}`, {
      method: "PUT",
      auth: true,
      body: {
        settings: payload
      }
    });
  } catch (firstError) {
    if (firstError.code && firstError.code !== "REQUEST_FAILED" && firstError.code !== "INVALID_INPUT") {
      throw firstError;
    }
    return apiRequest(`/api/admin/settings/games/${encodeURIComponent(slug)}`, {
      method: "PUT",
      auth: true,
      body: payload
    });
  }
}

async function handleSaveGameSettings() {
  const slug = String(elements.settingsGameSelect?.value || "").trim();
  if (!slug) {
    setSettingsSaveState("Feil");
    setStatus(elements.settingsStatus, "Velg et spill før lagring.", "error");
    return;
  }

  if (!validateAllSettingsFields()) {
    setSettingsSaveState("Feil");
    setStatus(elements.settingsStatus, "Rett valideringsfeil før lagring.", "error");
    return;
  }

  const payload = stripUndefinedDeep(cloneJsonValue(state.settingsDraft));
  setLoading(elements.settingsSaveBtn, true, "Lagrer...", "Lagre innstillinger");
  setSettingsSaveState("Lagrer...");
  setStatus(elements.settingsStatus, `Lagrer innstillinger for ${slug}...`);

  try {
    const responsePayload = await saveSettingsPayloadWithFallback(slug, payload);
    const normalizedSettings = normalizeSettingsGameResponse(responsePayload);
    const nextSettings = Object.keys(normalizedSettings).length > 0 ? normalizedSettings : payload;
    state.settingsOriginal = cloneJsonValue(nextSettings);
    state.settingsDraft = cloneJsonValue(nextSettings);
    state.settingsFieldErrors = {};
    state.settingsDirty = false;
    renderSettingsFields();
    syncSettingsAdvancedJson();
    updateSettingsDirtyIndicator();
    updateSettingsSaveButtonState();
    setSettingsSaveState("Lagret");
    setStatus(elements.settingsStatus, `Lagret ${slug} kl ${new Date().toLocaleTimeString("nb-NO")}.`, "success");

    const matchingGame = state.games.find((game) => game.slug === slug);
    if (matchingGame) {
      matchingGame.settings = cloneJsonValue(nextSettings);
      if (elements.gameSelect.value === slug) {
        renderSelectedGame();
      }
    }
  } catch (error) {
    setSettingsSaveState("Feil");
    setStatus(elements.settingsStatus, error.message || "Lagring av spillinnstillinger feilet.", "error");
  } finally {
    setLoading(elements.settingsSaveBtn, false, "Lagrer...", "Lagre innstillinger");
    updateSettingsSaveButtonState();
  }
}
// Chat2: Settings UI block end

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

  chat3RenderSettingsLogGameOptions();
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
  const previousComplianceHall = elements.complianceHallSelect.value;
  const previousPrizePolicyHall = elements.prizePolicyHallSelect.value;
  const previousExtraPrizeHall = elements.extraPrizeHallSelect.value;

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
  const pendingDaily = snapshot?.pendingLossLimits?.daily;
  const pendingMonthly = snapshot?.pendingLossLimits?.monthly;
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
    `pending.daily=${pendingDaily ? `${pendingDaily.value} @ ${pendingDaily.effectiveFrom}` : "-"}`,
    `pending.monthly=${pendingMonthly ? `${pendingMonthly.value} @ ${pendingMonthly.effectiveFrom}` : "-"}`,
    `net.daily=${netDaily ?? "-"} | net.monthly=${netMonthly ?? "-"}`
  ].join("\n");
}

function syncComplianceLimitInputs(snapshot) {
  const daily = snapshot?.pendingLossLimits?.daily?.value ?? snapshot?.personalLossLimits?.daily;
  const monthly = snapshot?.pendingLossLimits?.monthly?.value ?? snapshot?.personalLossLimits?.monthly;
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

    elements.adminIdentity.textContent = `Innlogget som ${session.user.displayName} (${session.user.email}) [${session.user.role}]`;
    setStatus(elements.loginStatus, "Innlogging OK.", "success");

    await chat3LoadAdminPermissions();
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
    // Chat2: Settings UI block start (logout reset)
    state.activeSectionId = "";
    state.settingsCatalog = [];
    state.settingsCatalogBySlug = {};
    state.settingsCurrentGameSlug = "";
    state.settingsOriginal = {};
    state.settingsDraft = {};
    state.settingsFieldErrors = {};
    state.settingsFieldInputs = new Map();
    state.settingsDirty = false;
    state.settingsSaveState = "Ikke lagret";
    // Chat2: Settings UI block end (logout reset)
    // Chat3: RBAC block start
    state.adminPermissions = [];
    state.adminPermissionMap = {};
    state.adminPolicy = {};
    // Chat3: RBAC block end
    setStoredToken("");
    showLogin();
    setStatus(elements.loginStatus, "Logget ut.", "success");
    setStatus(elements.adminStatus, "Klar.");
    setStatus(elements.hallStatus, "Ingen haller lastet.");
    setStatus(elements.terminalStatus, "Ingen terminaler lastet.");
    setStatus(elements.configStatus, "Ingen konfig lastet.");
    setStatus(elements.settingsStatus, "Ingen spillinnstillinger lastet.");
    setStatus(elements.complianceStatus, "Ingen compliance-data hentet.");
    setStatus(elements.extraDrawDenialsStatus, "Ingen denial-data hentet.");
    setStatus(elements.prizePolicyStatus, "Ingen policy lastet.");
    setStatus(elements.extraPrizeStatus, "Ingen extra prize sendt.");
    setStatus(elements.roomStatus, "Ingen rom valgt.");
    // Chat2: Settings UI block start (logout UI reset)
    renderSettingsGameOptions();
    renderSettingsFields();
    syncSettingsAdvancedJson();
    setSettingsSaveState("Ikke lagret");
    updateSettingsDirtyIndicator();
    // Chat2: Settings UI block end (logout UI reset)
    // Chat3: RBAC block start
    setStatus(elements.settingsLogStatus, "Ingen endringslogg lastet.");
    setStatus(elements.policyStatus, "Ingen policydata lastet.");
    if (elements.policyRoleSummary) {
      elements.policyRoleSummary.textContent = "Policy ikke lastet.";
    }
    if (elements.policySummaryList) {
      elements.policySummaryList.innerHTML = "";
    }
    // Chat3: RBAC block end
    elements.adminIdentity.textContent = "";
    setLoading(elements.logoutBtn, false, "Logger ut...", "Logg ut");
  }
}

async function loadAllAdminData() {
  const shouldLoadGames =
    chat3HasPermission("GAME_CATALOG_READ") ||
    chat3HasPermission("HALL_GAME_CONFIG_READ") ||
    chat3HasPermission("GAME_SETTINGS_CHANGELOG_READ");
  if (shouldLoadGames) {
    await loadGames();
  }

  // Chat2: Settings UI block start (settings bootstrap load)
  if (chat3HasPermission("GAME_CATALOG_READ")) {
    await loadSettingsCatalog().catch((error) => {
      setSettingsSaveState("Feil");
      setStatus(elements.settingsStatus, error.message || "Kunne ikke laste spillinnstillinger.", "error");
    });
  } else {
    setSettingsSaveState("Låst");
    setStatus(elements.settingsStatus, "Låst: mangler GAME_CATALOG_READ.");
  }
  // Chat2: Settings UI block end (settings bootstrap load)

  const shouldLoadHalls =
    chat3HasPermission("HALL_READ") ||
    chat3HasPermission("TERMINAL_READ") ||
    chat3HasPermission("HALL_GAME_CONFIG_READ") ||
    chat3HasPermission("WALLET_COMPLIANCE_READ") ||
    chat3HasPermission("PRIZE_POLICY_READ") ||
    chat3HasPermission("ROOM_CONTROL_READ");
  if (shouldLoadHalls) {
    await loadHalls();
  }
  ensurePrizePolicyEffectiveFromDefault();
  if (chat3HasPermission("HALL_GAME_CONFIG_READ")) {
    await loadHallGameConfigs();
  }
  if (chat3HasPermission("ROOM_CONTROL_READ")) {
    await loadRooms();
  }
  if (chat3HasPermission("TERMINAL_READ")) {
    await loadTerminals();
  }
  if (chat3HasPermission("GAME_SETTINGS_CHANGELOG_READ")) {
    await chat3LoadSettingsChangeLog().catch((error) => {
      setStatus(elements.settingsLogStatus, error.message || "Kunne ikke laste settings endringslogg.", "error");
    });
  } else {
    setStatus(elements.settingsLogStatus, "Låst: mangler GAME_SETTINGS_CHANGELOG_READ.");
  }
}

async function bootstrap() {
  // Chat3: RBAC block start
  chat3EnsureUiExtensions();
  // Chat3: RBAC block end
  // Chat2: Settings UI block start (settings + single-view wiring)
  setSettingsSaveState("Ikke lagret");
  updateSettingsDirtyIndicator();
  renderSettingsGameOptions();
  renderSettingsFields();
  syncSettingsAdvancedJson();
  applyAdminSectionFromHash({ syncHash: true });

  window.addEventListener("hashchange", () => {
    if (!state.token) {
      return;
    }
    applyAdminSectionFromHash({ syncHash: true });
  });

  elements.settingsGameSelect.addEventListener("change", () => {
    loadSettingsForSelectedGame().catch((error) => {
      setSettingsSaveState("Feil");
      setStatus(elements.settingsStatus, error.message || "Kunne ikke laste spillinnstillinger.", "error");
    });
  });

  elements.settingsReloadBtn.addEventListener("click", () => {
    loadSettingsForSelectedGame().catch((error) => {
      setSettingsSaveState("Feil");
      setStatus(elements.settingsStatus, error.message || "Kunne ikke oppdatere spillinnstillinger.", "error");
    });
  });

  elements.settingsSaveBtn.addEventListener("click", () => {
    handleSaveGameSettings().catch((error) => {
      setSettingsSaveState("Feil");
      setStatus(elements.settingsStatus, error.message || "Kunne ikke lagre spillinnstillinger.", "error");
    });
  });

  elements.settingsApplyJsonBtn.addEventListener("click", () => {
    handleSettingsApplyAdvancedJson();
  });
  // Chat2: Settings UI block end (settings + single-view wiring)

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

  // Chat3: RBAC block start
  elements.settingsLogLoadBtn?.addEventListener("click", () => {
    chat3LoadSettingsChangeLog().catch((error) => {
      setStatus(elements.settingsLogStatus, error.message || "Kunne ikke laste settings endringslogg.", "error");
    });
  });
  // Chat3: RBAC block end

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
    elements.adminIdentity.textContent = `Innlogget som ${user.displayName} (${user.email}) [${user.role}]`;
    await chat3LoadAdminPermissions();
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
