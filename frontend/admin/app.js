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
  settingsJson: document.getElementById("settingsJson"),
  saveBtn: document.getElementById("saveBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  logoutBtn: document.getElementById("logoutBtn")
};

const state = {
  token: "",
  user: null,
  games: []
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

  elements.title.value = selected.title || "";
  elements.route.value = selected.route || "";
  elements.description.value = selected.description || "";
  elements.sortOrder.value = String(selected.sortOrder ?? 0);
  elements.enabled.value = selected.isEnabled ? "true" : "false";
  elements.settingsJson.value = JSON.stringify(selected.settings || {}, null, 2);
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

function buildUpdatePayload() {
  let parsedSettings;
  try {
    parsedSettings = JSON.parse(elements.settingsJson.value || "{}");
  } catch (_error) {
    throw new Error("Settings JSON er ugyldig JSON.");
  }

  if (!parsedSettings || typeof parsedSettings !== "object" || Array.isArray(parsedSettings)) {
    throw new Error("Settings må være et JSON-objekt (ikke liste).\nEksempel: {\"key\":\"value\"}");
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
    await loadGames();
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
    setStoredToken("");
    showLogin();
    setStatus(elements.loginStatus, "Logget ut.", "success");
    setStatus(elements.adminStatus, "Klar.", undefined);
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
    payload = buildUpdatePayload();
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
    await loadGames();
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
