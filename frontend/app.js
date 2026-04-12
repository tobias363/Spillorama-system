/* global io */

const socket = io();
const AUTH_STORAGE_KEY = "bingo.portal.auth";
const CUSTOMER_VISIBLE_GAME_SLUGS = new Set(["bingo", "spillorama"]);
const DIRECT_LAUNCH_GAME_SLUGS = new Set(["spillorama"]);
const TOPUP_PRESET_AMOUNTS = [50, 100, 200, 300, 500, 1000];

const state = {
  accessToken: "",
  sessionExpiresAt: "",
  isAuthBootstrapping: false,
  profileTransferOpen: false,
  profilePersonalInfoOpen: false,
  transferDirection: "PLAYER",
  transferSelectedAmount: 100,
  transferCustomAmount: "",
  transferSubmitting: false,
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
  complianceState: null,
  reportState: null,
  reportPeriod: "last7",
  lastSwedbankIntentId: "",
  lastSwedbankCheckoutUrl: "",
  swedbankStatusPollTimer: null,
  swedbankStatusPollInFlight: false
};

let profileModalHideTimer = null;

const els = {
  appHeader: document.getElementById("appHeader"),
  activeGameLabel: document.getElementById("activeGameLabel"),
  gamesNav: document.getElementById("gamesNav"),
  walletMiniId: document.getElementById("walletMiniId"),
  walletMiniBalance: document.getElementById("walletMiniBalance"),
  headerHallId: document.getElementById("headerHallId"),
  walletTopupAmount: document.getElementById("walletTopupAmount"),
  walletTopupBtn: document.getElementById("walletTopupBtn"),
  walletSwedbankIntentBtn: document.getElementById("walletSwedbankIntentBtn"),
  walletRefreshBtn: document.getElementById("walletRefreshBtn"),
  adminPortalBtn: document.getElementById("adminPortalBtn"),
  profileBtn: document.getElementById("profileBtn"),
  userBadge: document.getElementById("userBadge"),
  logoutBtn: document.getElementById("logoutBtn"),
  profileModal: document.getElementById("profileModal"),
  profileModalCard: document.getElementById("profileModalCard"),
  profileMainView: document.getElementById("profileMainView"),
  profilePersonalInfoView: document.getElementById("profilePersonalInfoView"),
  profileTransferView: document.getElementById("profileTransferView"),
  profileTitle: document.getElementById("profileTitle"),
  profileSummary: document.getElementById("profileSummary"),
  profileFullName: document.getElementById("profileFullName"),
  profileEmail: document.getElementById("profileEmail"),
  profileBigBalance: document.getElementById("profileBigBalance"),
  profilePlayOverview: document.getElementById("profilePlayOverview"),
  profileInfoName: document.getElementById("profileInfoName"),
  profileInfoEmail: document.getElementById("profileInfoEmail"),
  profileInfoKycStatus: document.getElementById("profileInfoKycStatus"),
  profileInfoWalletId: document.getElementById("profileInfoWalletId"),
  profileInfoBalance: document.getElementById("profileInfoBalance"),
  profilePersonalInfoBtn: document.getElementById("profilePersonalInfoBtn"),
  profileCloseBtn: document.getElementById("profileCloseBtn"),
  transferToPlayerBtn: document.getElementById("transferToPlayerBtn"),
  transferToBankBtn: document.getElementById("transferToBankBtn"),
  transferBalance: document.getElementById("transferBalance"),
  transferAmountGrid: document.getElementById("transferAmountGrid"),
  transferCustomWrap: document.getElementById("transferCustomWrap"),
  transferCustomAmount: document.getElementById("transferCustomAmount"),
  transferContinueBtn: document.getElementById("transferContinueBtn"),
  swedbankCheckoutModal: document.getElementById("swedbankCheckoutModal"),
  swedbankCheckoutTitle: document.getElementById("swedbankCheckoutTitle"),
  swedbankCheckoutStatus: document.getElementById("swedbankCheckoutStatus"),
  swedbankCheckoutFrame: document.getElementById("swedbankCheckoutFrame"),
  swedbankConfirmBtn: document.getElementById("swedbankConfirmBtn"),
  swedbankOpenExternalBtn: document.getElementById("swedbankOpenExternalBtn"),
  swedbankCloseBtn: document.getElementById("swedbankCloseBtn"),

  authView: document.getElementById("authView"),
  appView: document.getElementById("appView"),
  heroWelcome: document.getElementById("heroWelcome"),
  heroGameTitle: document.getElementById("heroGameTitle"),
  heroGameDescription: document.getElementById("heroGameDescription"),
  gamesLobby: document.getElementById("gamesLobby"),

  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginBtn: document.getElementById("loginBtn"),
  loginStatus: document.getElementById("loginStatus"),

  registerDisplayName: document.getElementById("registerDisplayName"),
  registerSurname: document.getElementById("registerSurname"),
  registerDob: document.getElementById("registerDob"),
  registerPhone: document.getElementById("registerPhone"),
  registerEmail: document.getElementById("registerEmail"),
  registerPassword: document.getElementById("registerPassword"),
  registerBtn: document.getElementById("registerBtn"),
  registerStatus: document.getElementById("registerStatus"),

  kycCard: document.getElementById("kycCard"),
  kycBirthDate: document.getElementById("kycBirthDate"),
  kycVerifyBtn: document.getElementById("kycVerifyBtn"),
  kycStatus: document.getElementById("kycStatus"),

  walletStatus: document.getElementById("walletStatus"),
  safetyHallId: document.getElementById("safetyHallId"),
  safetyDailyLossLimit: document.getElementById("safetyDailyLossLimit"),
  safetyMonthlyLossLimit: document.getElementById("safetyMonthlyLossLimit"),
  safetyPauseMinutes: document.getElementById("safetyPauseMinutes"),
  safetyRefreshBtn: document.getElementById("safetyRefreshBtn"),
  safetySaveLossLimitsBtn: document.getElementById("safetySaveLossLimitsBtn"),
  safetySetPauseBtn: document.getElementById("safetySetPauseBtn"),
  safetyClearPauseBtn: document.getElementById("safetyClearPauseBtn"),
  safetySetSelfExclusionBtn: document.getElementById("safetySetSelfExclusionBtn"),
  safetyClearSelfExclusionBtn: document.getElementById("safetyClearSelfExclusionBtn"),
  safetyOverview: document.getElementById("safetyOverview"),
  safetyStatus: document.getElementById("safetyStatus"),
  reportStatus: document.getElementById("reportStatus"),
  reportSummary: document.getElementById("reportSummary"),
  reportBreakdownBody: document.getElementById("reportBreakdownBody"),
  reportPlaysBody: document.getElementById("reportPlaysBody"),
  reportEventsBody: document.getElementById("reportEventsBody"),
  reportPeriodButtons: document.getElementById("reportPeriodButtons"),
  reportRefreshBtn: document.getElementById("reportRefreshBtn"),
  reportEmail: document.getElementById("reportEmail"),
  reportDownloadPdfBtn: document.getElementById("reportDownloadPdfBtn"),
  reportEmailBtn: document.getElementById("reportEmailBtn"),

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
  bingoRtpMeter: document.getElementById("bingoRtpMeter"),
  bingoRtpMeterLabel: document.getElementById("bingoRtpMeterLabel"),
  bingoRtpMeterFill: document.getElementById("bingoRtpMeterFill"),
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

const NOK_FORMATTER = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const NOK_INTEGER_FORMATTER = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const GAME_SHOWCASE_THEME = Object.freeze({
  papirbingo: {
    accent: "#7b3fa0",
    accentSoft: "rgba(123, 63, 160, 0.28)",
    background:
      "linear-gradient(112deg, rgba(38, 14, 56, 0.92) 0%, rgba(78, 32, 110, 0.74) 42%, rgba(20, 12, 36, 0.56) 100%), radial-gradient(circle at 16% 20%, rgba(200, 150, 240, 0.22), transparent 35%), radial-gradient(circle at 82% 76%, rgba(160, 80, 220, 0.24), transparent 42%)",
    image: "/assets/games/papirbingo.png",
    fallbackPrizePool: 2400,
    fallbackPlayers: 28,
    fallbackTicketPrice: 1,
    fallbackNextDrawMinutes: 2,
    badge: 90
  },
  lynbingo: {
    accent: "#e8a035",
    accentSoft: "rgba(232, 160, 53, 0.28)",
    background:
      "linear-gradient(112deg, rgba(58, 38, 10, 0.92) 0%, rgba(110, 72, 22, 0.74) 42%, rgba(22, 16, 8, 0.56) 100%), radial-gradient(circle at 16% 20%, rgba(255, 200, 120, 0.22), transparent 35%), radial-gradient(circle at 82% 76%, rgba(200, 130, 40, 0.24), transparent 42%)",
    image: "/assets/games/bingo_1.png",
    fallbackPrizePool: 3200,
    fallbackPlayers: 45,
    fallbackTicketPrice: 2,
    fallbackNextDrawMinutes: 1,
    badge: 60
  },
  bingobonanza: {
    accent: "#3d6be9",
    accentSoft: "rgba(61, 107, 233, 0.26)",
    background:
      "linear-gradient(108deg, rgba(14, 27, 61, 0.92) 0%, rgba(44, 69, 120, 0.72) 42%, rgba(12, 22, 38, 0.52) 100%), radial-gradient(circle at 19% 23%, rgba(133, 181, 255, 0.24), transparent 35%), radial-gradient(circle at 79% 74%, rgba(84, 117, 255, 0.25), transparent 42%)",
    image: "/assets/games/bingo_3.png",
    fallbackPrizePool: 2789,
    fallbackPlayers: 36,
    fallbackTicketPrice: 1,
    fallbackNextDrawMinutes: 2,
    badge: 80
  },
  turbomania: {
    accent: "#e04040",
    accentSoft: "rgba(224, 64, 64, 0.28)",
    background:
      "linear-gradient(108deg, rgba(52, 14, 14, 0.92) 0%, rgba(100, 30, 30, 0.74) 42%, rgba(22, 10, 10, 0.56) 100%), radial-gradient(circle at 18% 22%, rgba(255, 140, 140, 0.22), transparent 35%), radial-gradient(circle at 80% 76%, rgba(220, 60, 60, 0.24), transparent 42%)",
    image: "/assets/games/bingo_4.png",
    fallbackPrizePool: 4500,
    fallbackPlayers: 52,
    fallbackTicketPrice: 2,
    fallbackNextDrawMinutes: 1,
    badge: 70
  },
  spinngo: {
    accent: "#2eac6e",
    accentSoft: "rgba(46, 172, 110, 0.28)",
    background:
      "linear-gradient(108deg, rgba(10, 36, 24, 0.92) 0%, rgba(22, 80, 52, 0.74) 42%, rgba(8, 20, 14, 0.56) 100%), radial-gradient(circle at 18% 22%, rgba(120, 240, 180, 0.22), transparent 35%), radial-gradient(circle at 80% 76%, rgba(60, 200, 120, 0.24), transparent 42%)",
    image: "/assets/games/galopp.png",
    fallbackPrizePool: 3100,
    fallbackPlayers: 38,
    fallbackTicketPrice: 2,
    fallbackNextDrawMinutes: 1,
    badge: 55
  },
  spillorama: {
    accent: "#e8a035",
    accentSoft: "rgba(232, 160, 53, 0.28)",
    background:
      "linear-gradient(112deg, rgba(58, 18, 10, 0.92) 0%, rgba(110, 52, 22, 0.74) 42%, rgba(22, 16, 8, 0.56) 100%), radial-gradient(circle at 16% 20%, rgba(255, 200, 120, 0.22), transparent 35%), radial-gradient(circle at 82% 76%, rgba(200, 130, 40, 0.24), transparent 42%)",
    image: "/assets/games/spillorama.png",
    fallbackPrizePool: 5000,
    fallbackPlayers: 42,
    fallbackTicketPrice: 2,
    fallbackNextDrawMinutes: 2,
    badge: 60
  },
  bingo: {
    accent: "#3d6be9",
    accentSoft: "rgba(61, 107, 233, 0.26)",
    background:
      "linear-gradient(108deg, rgba(14, 27, 61, 0.92) 0%, rgba(44, 69, 120, 0.72) 42%, rgba(12, 22, 38, 0.52) 100%), radial-gradient(circle at 19% 23%, rgba(133, 181, 255, 0.24), transparent 35%), radial-gradient(circle at 79% 74%, rgba(84, 117, 255, 0.25), transparent 42%)",
    image: "/assets/games/bingo_2.png",
    fallbackPrizePool: 2789.3,
    fallbackPlayers: 13,
    fallbackTicketPrice: 1,
    fallbackNextDrawMinutes: 2,
    badge: 90
  },
  default: {
    accent: "#ff3d3d",
    accentSoft: "rgba(255, 61, 61, 0.28)",
    background:
      "linear-gradient(108deg, rgba(52, 14, 22, 0.92) 0%, rgba(86, 38, 46, 0.74) 45%, rgba(14, 20, 32, 0.56) 100%), radial-gradient(circle at 21% 25%, rgba(255, 137, 137, 0.24), transparent 35%), radial-gradient(circle at 84% 74%, rgba(251, 77, 77, 0.25), transparent 42%)",
    image: "/assets/games/spillorama.png",
    fallbackPrizePool: 3996,
    fallbackPlayers: 22,
    fallbackTicketPrice: 2,
    fallbackNextDrawMinutes: 3,
    badge: 30
  }
});

function formatNok(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${NOK_FORMATTER.format(safe)} kr`;
}

function formatNokWhole(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${NOK_INTEGER_FORMATTER.format(Math.round(safe))} kr`;
}

function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function formatClockTime(referenceMs) {
  return new Date(referenceMs).toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("nb-NO", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function formatGameTypeLabel(gameType) {
  return gameType === "MAIN_GAME" ? "Hovedspill" : gameType === "DATABINGO" ? "Databingo" : gameType || "-";
}

function formatChannelLabel(channel) {
  return channel === "HALL" ? "Hall" : channel === "INTERNET" ? "Internett" : channel || "-";
}

function formatEventTypeLabel(eventType) {
  if (eventType === "STAKE") {
    return "Innsats";
  }
  if (eventType === "PRIZE") {
    return "Premie";
  }
  if (eventType === "EXTRA_PRIZE") {
    return "Ekstrapremie";
  }
  return eventType || "-";
}

function formatNetResult(value) {
  const safe = Number.isFinite(value) ? value : 0;
  const prefix = safe > 0 ? "+" : "";
  return `${prefix}${NOK_FORMATTER.format(safe)} kr`;
}

function getHallLabelById(hallId) {
  const normalizedHallId = typeof hallId === "string" ? hallId.trim() : "";
  if (!normalizedHallId) {
    return "Ingen hall valgt";
  }
  const hall = (Array.isArray(state.halls) ? state.halls : []).find((candidate) => candidate.id === normalizedHallId);
  if (!hall) {
    return normalizedHallId;
  }
  return hall.name || hall.slug || normalizedHallId;
}

function clampPercentage(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function resolveLossLimitTone(limitValue, usedValue) {
  if (!Number.isFinite(limitValue) || limitValue <= 0) {
    return "warn";
  }
  const ratio = usedValue / limitValue;
  if (ratio >= 1) {
    return "danger";
  }
  if (ratio >= 0.75) {
    return "warn";
  }
  return "safe";
}

function buildLossLimitViewModel(limitValue, usedValue) {
  const normalizedLimit = asFiniteNumber(limitValue);
  const normalizedUsed = Math.max(0, asFiniteNumber(usedValue) ?? 0);
  const hasLimit = Number.isFinite(normalizedLimit) && normalizedLimit > 0;
  const activeLimit = hasLimit ? normalizedLimit : 0;
  const remainingValue = hasLimit ? Math.max(0, activeLimit - normalizedUsed) : 0;
  const percent = hasLimit ? clampPercentage((normalizedUsed / activeLimit) * 100) : 0;

  return {
    hasLimit,
    limitValue: activeLimit,
    usedValue: normalizedUsed,
    remainingValue,
    percent,
    tone: resolveLossLimitTone(activeLimit, normalizedUsed),
    isReached: hasLimit && normalizedUsed >= activeLimit
  };
}

function createSafetyPill(label, tone = "neutral") {
  const pill = document.createElement("span");
  pill.className = `safety-pill is-${tone}`;
  pill.textContent = label;
  return pill;
}

function createOverviewMetricCard(label, value, helper = "") {
  const card = document.createElement("article");
  card.className = "overview-metric-card";

  const title = document.createElement("span");
  title.className = "overview-metric-label";
  title.textContent = label;

  const strong = document.createElement("strong");
  strong.className = "overview-metric-value";
  strong.textContent = value;

  card.appendChild(title);
  card.appendChild(strong);

  if (helper) {
    const note = document.createElement("span");
    note.className = "overview-metric-helper";
    note.textContent = helper;
    card.appendChild(note);
  }

  return card;
}

function renderProfilePlayOverview() {
  if (!els.profilePlayOverview) {
    return;
  }

  els.profilePlayOverview.innerHTML = "";

  if (!state.user) {
    const message = document.createElement("p");
    message.className = "subtle";
    message.textContent = "Spillvett vises når du er innlogget.";
    els.profilePlayOverview.appendChild(message);
    return;
  }

  if (!state.complianceState) {
    const message = document.createElement("p");
    message.className = "subtle";
    message.textContent = "Spillvett lastes for valgt hall.";
    els.profilePlayOverview.appendChild(message);
    return;
  }

  const compliance = state.complianceState;
  const report = state.reportState;
  const hallLabel = getHallLabelById(compliance.hallId || state.selectedHallId);
  const daily = buildLossLimitViewModel(compliance?.personalLossLimits?.daily, compliance?.netLoss?.daily);
  const monthly = buildLossLimitViewModel(compliance?.personalLossLimits?.monthly, compliance?.netLoss?.monthly);

  const shell = document.createElement("div");
  shell.className = "profile-play-overview-card";

  const header = document.createElement("div");
  header.className = "profile-play-overview-header";

  const heading = document.createElement("h4");
  heading.textContent = "Spillvett nå";

  const subtitle = document.createElement("p");
  subtitle.className = "subtle";
  subtitle.textContent = report?.range?.label
    ? `${hallLabel} · ${report.range.label}`
    : `${hallLabel} · spillregnskap lastes`;

  header.appendChild(heading);
  header.appendChild(subtitle);
  shell.appendChild(header);

  const pills = document.createElement("div");
  pills.className = "safety-status-pills";
  if (compliance?.restrictions?.isBlocked) {
    pills.appendChild(createSafetyPill("Blokkert", "danger"));
  } else {
    pills.appendChild(createSafetyPill("Klar til spill", "safe"));
  }
  if (compliance?.pause?.isOnPause) {
    pills.appendChild(createSafetyPill("Pålagt pause aktiv", "danger"));
  }
  if (compliance?.restrictions?.timedPause?.isActive) {
    pills.appendChild(createSafetyPill("Frivillig pause", "warn"));
  }
  if (compliance?.restrictions?.selfExclusion?.isActive) {
    pills.appendChild(createSafetyPill("Selvutestengt", "danger"));
  }
  shell.appendChild(pills);

  const grid = document.createElement("div");
  grid.className = "profile-play-overview-grid";
  grid.appendChild(createOverviewMetricCard("Aktiv hall", hallLabel));
  grid.appendChild(
    createOverviewMetricCard(
      "Dag igjen",
      daily.hasLimit ? formatNok(daily.remainingValue) : "Sett grense",
      daily.hasLimit ? `Brukt ${formatNok(daily.usedValue)} av ${formatNok(daily.limitValue)}` : "Må settes før spill"
    )
  );
  grid.appendChild(
    createOverviewMetricCard(
      "Måned igjen",
      monthly.hasLimit ? formatNok(monthly.remainingValue) : "Sett grense",
      monthly.hasLimit ? `Brukt ${formatNok(monthly.usedValue)} av ${formatNok(monthly.limitValue)}` : "Må settes før spill"
    )
  );
  grid.appendChild(
    createOverviewMetricCard(
      report?.range?.label ? `Netto ${report.range.label.toLowerCase()}` : "Netto resultat",
      report ? formatNetResult(report.summary?.netResult) : "Laster",
      report ? `Innsats ${formatNok(report.summary?.stakeTotal)} · Premier ${formatNok(report.summary?.prizeTotal)}` : "Spillregnskap oppdateres"
    )
  );
  shell.appendChild(grid);

  const pendingNotes = [];
  if (compliance?.pendingLossLimits?.daily) {
    pendingNotes.push(`Daggrense økes til ${formatNok(compliance.pendingLossLimits.daily.value)} fra ${formatDateTime(compliance.pendingLossLimits.daily.effectiveFrom)}.`);
  }
  if (compliance?.pendingLossLimits?.monthly) {
    pendingNotes.push(`Månedsgrense økes til ${formatNok(compliance.pendingLossLimits.monthly.value)} fra ${formatDateTime(compliance.pendingLossLimits.monthly.effectiveFrom)}.`);
  }
  if (pendingNotes.length) {
    const note = document.createElement("div");
    note.className = "safety-pending-note";
    note.textContent = pendingNotes.join(" ");
    shell.appendChild(note);
  }

  els.profilePlayOverview.appendChild(shell);
}

function createLossLimitCard({ title, model, regulatoryLimit, resetLabel, pendingLimit }) {
  const article = document.createElement("article");
  article.className = `safety-limit-card is-${model.tone}`;

  const top = document.createElement("div");
  top.className = "safety-limit-top";

  const heading = document.createElement("h4");
  heading.textContent = title;

  const badge = document.createElement("span");
  badge.className = `safety-pill is-${model.isReached ? "danger" : model.tone}`;
  badge.textContent = model.isReached ? "Grense nådd" : model.hasLimit ? "Aktiv grense" : "Grense mangler";

  top.appendChild(heading);
  top.appendChild(badge);
  article.appendChild(top);

  const remaining = document.createElement("strong");
  remaining.className = "safety-limit-remaining";
  remaining.textContent = model.hasLimit ? `${formatNok(model.remainingValue)} igjen` : "Sett personlig grense";
  article.appendChild(remaining);

  const meta = document.createElement("div");
  meta.className = "safety-limit-metrics";
  meta.appendChild(createOverviewMetricCard("Brukt", formatNok(model.usedValue)));
  meta.appendChild(createOverviewMetricCard("Aktiv grense", model.hasLimit ? formatNok(model.limitValue) : "Ikke satt"));
  meta.appendChild(createOverviewMetricCard("Maks", Number.isFinite(regulatoryLimit) ? formatNok(regulatoryLimit) : "-"));
  article.appendChild(meta);

  const meter = document.createElement("div");
  meter.className = `safety-meter-track is-${model.tone}`;
  const fill = document.createElement("span");
  fill.className = `safety-meter-fill is-${model.tone}`;
  fill.style.width = `${model.percent}%`;
  meter.appendChild(fill);
  article.appendChild(meter);

  const footer = document.createElement("p");
  footer.className = "safety-limit-footer";
  footer.textContent = resetLabel;
  article.appendChild(footer);

  if (pendingLimit) {
    const note = document.createElement("div");
    note.className = "safety-pending-note";
    note.textContent = `Ventende økning til ${formatNok(pendingLimit.value)} fra ${formatDateTime(pendingLimit.effectiveFrom)}.`;
    article.appendChild(note);
  }

  return article;
}

function renderSafetyOverview() {
  if (!els.safetyOverview) {
    return;
  }

  els.safetyOverview.innerHTML = "";

  if (!state.user) {
    const message = document.createElement("p");
    message.className = "subtle";
    message.textContent = "Logg inn for å se tapsgrenser og spillstatus.";
    els.safetyOverview.appendChild(message);
    return;
  }

  if (!state.complianceState) {
    const message = document.createElement("p");
    message.className = "subtle";
    message.textContent = "Ingen spillvett-data lastet for valgt hall ennå.";
    els.safetyOverview.appendChild(message);
    return;
  }

  const snapshot = state.complianceState;
  const hallLabel = getHallLabelById(snapshot.hallId || state.selectedHallId);
  const dailyModel = buildLossLimitViewModel(snapshot?.personalLossLimits?.daily, snapshot?.netLoss?.daily);
  const monthlyModel = buildLossLimitViewModel(snapshot?.personalLossLimits?.monthly, snapshot?.netLoss?.monthly);

  const shell = document.createElement("div");
  shell.className = "safety-overview-shell";

  const header = document.createElement("div");
  header.className = "safety-overview-header";

  const titleWrap = document.createElement("div");
  const heading = document.createElement("h4");
  heading.textContent = hallLabel;
  const subtitle = document.createElement("p");
  subtitle.className = "subtle";
  subtitle.textContent = `Per hall · maks ${formatNok(snapshot?.regulatoryLossLimits?.daily)} per dag og ${formatNok(snapshot?.regulatoryLossLimits?.monthly)} per måned.`;
  titleWrap.appendChild(heading);
  titleWrap.appendChild(subtitle);
  header.appendChild(titleWrap);

  const pills = document.createElement("div");
  pills.className = "safety-status-pills";
  if (snapshot?.restrictions?.isBlocked) {
    pills.appendChild(createSafetyPill("Blokkert", "danger"));
  } else {
    pills.appendChild(createSafetyPill("Aktiv hall", "safe"));
  }
  if (!dailyModel.hasLimit || !monthlyModel.hasLimit) {
    pills.appendChild(createSafetyPill("Grense må settes", "warn"));
  }
  if (snapshot?.pause?.isOnPause) {
    pills.appendChild(createSafetyPill("Pålagt pause", "danger"));
  }
  if (snapshot?.restrictions?.timedPause?.isActive) {
    pills.appendChild(createSafetyPill("Frivillig pause", "warn"));
  }
  if (snapshot?.restrictions?.selfExclusion?.isActive) {
    pills.appendChild(createSafetyPill("Selvutestengt", "danger"));
  }
  header.appendChild(pills);

  shell.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "safety-limit-grid";
  grid.appendChild(
    createLossLimitCard({
      title: "Daglig tapsgrense",
      model: dailyModel,
      regulatoryLimit: snapshot?.regulatoryLossLimits?.daily,
      resetLabel: "Nullstilles ved lokal midnatt.",
      pendingLimit: snapshot?.pendingLossLimits?.daily
    })
  );
  grid.appendChild(
    createLossLimitCard({
      title: "Månedlig tapsgrense",
      model: monthlyModel,
      regulatoryLimit: snapshot?.regulatoryLossLimits?.monthly,
      resetLabel: "Nullstilles ved ny kalendermåned.",
      pendingLimit: snapshot?.pendingLossLimits?.monthly
    })
  );
  shell.appendChild(grid);

  if (snapshot?.pause?.isOnPause && snapshot?.pause?.pauseUntil) {
    const note = document.createElement("div");
    note.className = "safety-pending-note";
    note.textContent = `Pålagt pause er aktiv til ${formatDateTime(snapshot.pause.pauseUntil)}.`;
    shell.appendChild(note);
  }

  els.safetyOverview.appendChild(shell);
}

function resolveShowcaseTheme(gameSlug) {
  const key = (gameSlug || "").trim().toLowerCase();
  return GAME_SHOWCASE_THEME[key] || GAME_SHOWCASE_THEME.default;
}

function resolveShowcaseStats(game, index) {
  const settings = getSettingsObject(game?.settings);
  const theme = resolveShowcaseTheme(game?.slug);

  let prizePool =
    asFiniteNumber(settings.prizePoolNok) ??
    asFiniteNumber(settings.jackpotNok) ??
    asFiniteNumber(settings.prizePool) ??
    theme.fallbackPrizePool;
  let players = Math.max(
    0,
    Math.floor(asFiniteNumber(settings.livePlayers) ?? asFiniteNumber(settings.playerCount) ?? theme.fallbackPlayers)
  );
  let ticketPrice =
    asFiniteNumber(settings.ticketPriceNok) ??
    asFiniteNumber(settings.ticketPrice) ??
    asFiniteNumber(settings.entryFeeNok) ??
    theme.fallbackTicketPrice;

  const configuredNextDrawAt = Date.parse(String(settings.nextDrawAt || "").trim());
  const nextDrawAtFromText = Number.isFinite(configuredNextDrawAt) ? configuredNextDrawAt : undefined;
  const nextDrawAtMs =
    asFiniteNumber(settings.nextDrawAtMs) ??
    nextDrawAtFromText ??
    Date.now() + (theme.fallbackNextDrawMinutes + index) * 60 * 1000;

  let drawText = `Trekkes kl. ${formatClockTime(nextDrawAtMs)}`;
  if (game?.slug === "bingo" && state.selectedGameSlug === "bingo" && state.snapshot) {
    const snapshotPlayers = Array.isArray(state.snapshot.players) ? state.snapshot.players.length : 0;
    if (snapshotPlayers > 0) {
      players = snapshotPlayers;
    }
    if (Number.isFinite(state.snapshot.currentGame?.entryFee)) {
      ticketPrice = state.snapshot.currentGame.entryFee;
    }
    if (Number.isFinite(state.snapshot.currentGame?.prizePool) && state.snapshot.currentGame.prizePool >= 0) {
      prizePool = state.snapshot.currentGame.prizePool;
    }
    if (state.snapshot.currentGame?.status === "RUNNING") {
      drawText = "Spill i gang";
    }
  }

  return {
    prizePool,
    players,
    ticketPrice,
    drawText,
    badgeValue: Math.max(1, Math.floor(asFiniteNumber(settings.levelBadge) ?? theme.badge))
  };
}

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

function syncBodyModalState() {
  const swedbankOpen = els.swedbankCheckoutModal && !els.swedbankCheckoutModal.classList.contains("hidden");
  const profileOpen = els.profileModal && els.profileModal.classList.contains("open");
  document.body.classList.toggle("modal-open", Boolean(swedbankOpen || profileOpen));
}

function setSwedbankModalVisible(visible) {
  if (!els.swedbankCheckoutModal) {
    return;
  }
  els.swedbankCheckoutModal.classList.toggle("hidden", !visible);
  syncBodyModalState();
}

function setProfileModalVisible(visible) {
  if (!els.profileModal) {
    return;
  }
  if (profileModalHideTimer) {
    window.clearTimeout(profileModalHideTimer);
    profileModalHideTimer = null;
  }

  if (visible) {
    els.profileModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      els.profileModal.classList.add("open");
      syncBodyModalState();
    });
    return;
  }

  els.profileModal.classList.remove("open");
  syncBodyModalState();
  profileModalHideTimer = window.setTimeout(() => {
    els.profileModal.classList.add("hidden");
    syncBodyModalState();
  }, 220);
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

function closeProfileModal() {
  setProfilePersonalInfoMode(false);
  setProfileTransferMode(false);
  setProfileModalVisible(false);
}

function openSwedbankCheckoutModal(intent) {
  if (!els.swedbankCheckoutModal || !els.swedbankCheckoutFrame) {
    return false;
  }

  const preferredUrl = (intent?.redirectUrl || intent?.viewUrl || "").trim();
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
  if (intent.redirectUrl || intent.viewUrl) {
    state.lastSwedbankCheckoutUrl = (intent.redirectUrl || intent.viewUrl || "").trim();
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
  closeProfileModal();
  state.accessToken = "";
  state.sessionExpiresAt = "";
  state.isAuthBootstrapping = false;
  state.profileTransferOpen = false;
  state.transferDirection = "PLAYER";
  state.transferSelectedAmount = TOPUP_PRESET_AMOUNTS[1];
  state.transferCustomAmount = "";
  state.transferSubmitting = false;
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
  state.complianceState = null;
  state.reportState = null;
  state.reportPeriod = "last7";
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

function getVisiblePortalGames(allGames) {
  if (!Array.isArray(allGames)) {
    return [];
  }
  return allGames.filter((game) => CUSTOMER_VISIBLE_GAME_SLUGS.has(game?.slug));
}

function currentAdminGame() {
  if (!state.adminGames.length) {
    return null;
  }
  return state.adminGames.find((game) => game.slug === state.selectedGameSlug) || state.adminGames[0] || null;
}

function getSettingsObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function resolveGameLaunchUrl(game) {
  const settings = getSettingsObject(game?.settings);
  const candidates = [
    settings.launchUrl,
    settings.portalLaunchUrl,
    settings.clientUrl,
    settings.playUrl
  ];

  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim();
    if (!raw) {
      continue;
    }
    if (raw.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      return raw;
    }
  }

  return "";
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
  const restoringSession = Boolean(state.isAuthBootstrapping && state.accessToken && !state.user);
  const showApp = loggedIn || restoringSession;

  els.authView.classList.toggle("hidden", showApp);
  els.appView.classList.toggle("hidden", !showApp);
  els.appHeader.classList.toggle("hidden", !showApp);
}

function renderUserBadge() {
  if (els.userBadge) {
    els.userBadge.textContent = "Profil";
  }
  if (els.adminPortalBtn) {
    els.adminPortalBtn.classList.add("hidden");
  }
}

function getCurrentWalletBalance() {
  if (state.walletState?.account && Number.isFinite(state.walletState.account.balance)) {
    return state.walletState.account.balance;
  }
  if (state.user && Number.isFinite(state.user.balance)) {
    return state.user.balance;
  }
  return 0;
}

function syncProfileCloseButton() {
  if (!els.profileCloseBtn) {
    return;
  }
  if (state.profileTransferOpen || state.profilePersonalInfoOpen) {
    els.profileCloseBtn.textContent = "×";
    els.profileCloseBtn.classList.add("profile-close-btn-icon");
    els.profileCloseBtn.setAttribute("aria-label", "Lukk");
    return;
  }
  els.profileCloseBtn.textContent = "Lukk";
  els.profileCloseBtn.classList.remove("profile-close-btn-icon");
  els.profileCloseBtn.removeAttribute("aria-label");
}

function getSelectedTransferAmount() {
  if (state.transferDirection !== "PLAYER") {
    return null;
  }
  if (state.transferSelectedAmount === "OTHER") {
    const amount = Number(state.transferCustomAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    return amount;
  }
  const amount = Number(state.transferSelectedAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount;
}

function renderTransferPanel() {
  if (!els.profileTransferView) {
    return;
  }

  if (els.transferBalance) {
    els.transferBalance.textContent = formatNokWhole(getCurrentWalletBalance());
  }

  if (els.transferToPlayerBtn) {
    const active = state.transferDirection === "PLAYER";
    els.transferToPlayerBtn.classList.toggle("active", active);
    els.transferToPlayerBtn.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (els.transferToBankBtn) {
    const active = state.transferDirection === "BANK";
    els.transferToBankBtn.classList.toggle("active", active);
    els.transferToBankBtn.setAttribute("aria-selected", active ? "true" : "false");
  }

  if (els.transferAmountGrid) {
    const amountButtons = els.transferAmountGrid.querySelectorAll("[data-transfer-amount]");
    amountButtons.forEach((button) => {
      const raw = String(button.dataset.transferAmount || "").trim().toLowerCase();
      const isOther = raw === "other";
      const active = isOther
        ? state.transferSelectedAmount === "OTHER"
        : Number(raw) === Number(state.transferSelectedAmount) && state.transferSelectedAmount !== "OTHER";
      button.classList.toggle("active", active);
      button.disabled = state.transferDirection !== "PLAYER" || state.transferSubmitting;
    });
  }

  if (els.transferCustomWrap) {
    const showCustom = state.transferDirection === "PLAYER" && state.transferSelectedAmount === "OTHER";
    els.transferCustomWrap.classList.toggle("hidden", !showCustom);
  }
  if (els.transferCustomAmount && els.transferCustomAmount.value !== state.transferCustomAmount) {
    els.transferCustomAmount.value = state.transferCustomAmount;
  }
  if (els.transferCustomAmount) {
    els.transferCustomAmount.disabled = state.transferDirection !== "PLAYER" || state.transferSubmitting;
  }

  const selectedAmount = getSelectedTransferAmount();
  if (els.transferContinueBtn) {
    const canContinue = state.transferDirection === "PLAYER" && Number.isFinite(selectedAmount) && selectedAmount > 0;
    els.transferContinueBtn.disabled = state.transferSubmitting || !canContinue;
    els.transferContinueBtn.textContent = state.transferSubmitting ? "Starter..." : "Fortsett";
  }
}

function setProfileTransferMode(enabled) {
  state.profileTransferOpen = Boolean(enabled);
  if (state.profileTransferOpen) {
    state.profilePersonalInfoOpen = false;
  }
  state.transferSubmitting = false;

  const inSubView = state.profileTransferOpen || state.profilePersonalInfoOpen;
  if (els.profileModalCard) {
    els.profileModalCard.classList.toggle("transfer-mode", state.profileTransferOpen);
  }
  if (els.profileMainView) {
    els.profileMainView.classList.toggle("hidden", inSubView);
  }
  if (els.profilePersonalInfoView) {
    els.profilePersonalInfoView.classList.toggle("hidden", !state.profilePersonalInfoOpen);
  }
  if (els.profileTransferView) {
    els.profileTransferView.classList.toggle("hidden", !state.profileTransferOpen);
  }
  if (els.profileSummary) {
    els.profileSummary.classList.toggle("hidden", inSubView);
  }

  if (state.profileTransferOpen) {
    state.transferDirection = "PLAYER";
    state.transferSelectedAmount = TOPUP_PRESET_AMOUNTS[1];
    state.transferCustomAmount = "";
    if (els.profileTitle) {
      els.profileTitle.textContent = "Overfør penger";
    }
    renderTransferPanel();
  } else if (!state.profilePersonalInfoOpen) {
    renderProfileSummary();
  }

  syncProfileCloseButton();
}

function setProfilePersonalInfoMode(enabled) {
  state.profilePersonalInfoOpen = Boolean(enabled);
  if (state.profilePersonalInfoOpen) {
    state.profileTransferOpen = false;
    state.transferSubmitting = false;
  }

  const inSubView = state.profileTransferOpen || state.profilePersonalInfoOpen;
  if (els.profileModalCard) {
    els.profileModalCard.classList.toggle("transfer-mode", state.profileTransferOpen);
  }
  if (els.profileMainView) {
    els.profileMainView.classList.toggle("hidden", inSubView);
  }
  if (els.profilePersonalInfoView) {
    els.profilePersonalInfoView.classList.toggle("hidden", !state.profilePersonalInfoOpen);
  }
  if (els.profileTransferView) {
    els.profileTransferView.classList.toggle("hidden", !state.profileTransferOpen);
  }
  if (els.profileSummary) {
    els.profileSummary.classList.toggle("hidden", inSubView);
  }

  if (state.profilePersonalInfoOpen) {
    if (els.profileTitle) {
      els.profileTitle.textContent = "Personlig informasjon";
    }
    renderProfileSummary();
  } else if (!state.profileTransferOpen) {
    renderProfileSummary();
  }

  syncProfileCloseButton();
}

function formatKycStatusLabel(status) {
  const rawKycStatus = String(status || "").trim().toUpperCase();
  if (rawKycStatus === "VERIFIED") {
    return "Verifisert";
  }
  if (rawKycStatus === "PENDING") {
    return "Venter";
  }
  if (rawKycStatus) {
    return rawKycStatus;
  }
  return "Ikke verifisert";
}

function renderProfileSummary() {
  if (!els.profileTitle || !els.profileSummary || !els.profileFullName || !els.profileBigBalance) {
    return;
  }

  if (!state.user) {
    if (!state.profileTransferOpen && !state.profilePersonalInfoOpen) {
      els.profileTitle.textContent = "Min profil";
      els.profileSummary.textContent = "Konto";
    }
    els.profileFullName.textContent = "Spiller";
    if (els.profileEmail) {
      els.profileEmail.textContent = "Ikke innlogget.";
    }
    if (els.profileInfoName) {
      els.profileInfoName.textContent = "Spiller";
    }
    if (els.profileInfoEmail) {
      els.profileInfoEmail.textContent = "Ikke innlogget";
    }
    if (els.profileInfoKycStatus) {
      els.profileInfoKycStatus.textContent = "Ukjent";
    }
    if (els.profileInfoWalletId) {
      els.profileInfoWalletId.textContent = "-";
    }
    if (els.profileInfoBalance) {
      els.profileInfoBalance.textContent = "0 kr";
    }
    els.profileBigBalance.textContent = "0 kr";
    renderTransferPanel();
    renderProfilePlayOverview();
    return;
  }

  const balance = getCurrentWalletBalance();
  if (!state.profileTransferOpen && !state.profilePersonalInfoOpen) {
    els.profileTitle.textContent = "Min profil";
    els.profileSummary.textContent = "Konto";
  }
  els.profileFullName.textContent = state.user.displayName || "Spiller";
  if (els.profileEmail) {
    els.profileEmail.textContent = state.user.email || "";
  }
  if (els.profileInfoName) {
    els.profileInfoName.textContent = state.user.displayName || "Spiller";
  }
  if (els.profileInfoEmail) {
    els.profileInfoEmail.textContent = state.user.email || "Ikke oppgitt";
  }
  if (els.profileInfoKycStatus) {
    els.profileInfoKycStatus.textContent = formatKycStatusLabel(state.user.kycStatus);
  }
  if (els.profileInfoWalletId) {
    els.profileInfoWalletId.textContent = state.user.walletId || state.walletState?.account?.id || "-";
  }
  if (els.profileInfoBalance) {
    els.profileInfoBalance.textContent = formatNokWhole(balance);
  }
  els.profileBigBalance.textContent = `${formatNokWhole(balance)}`;
  renderTransferPanel();
  renderProfilePlayOverview();
}

async function openProfileModal() {
  if (!state.user || !state.accessToken) {
    setStatusBox(els.loginStatus, "Logg inn for å åpne profil.", "error");
    return;
  }

  setProfilePersonalInfoMode(false);
  setProfileTransferMode(false);
  setProfileModalVisible(true);
  renderProfileSummary();

  try {
    await Promise.all([loadWalletState(), loadComplianceState(), loadPlayerReport()]);
    renderProfileSummary();
  } catch (error) {
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke oppdatere profil.", "error");
  }
}

function renderHeroPanel() {
  if (els.heroWelcome) {
    els.heroWelcome.textContent = state.user
      ? `Hei ${state.user.displayName}. Velg spill og trykk «Spill nå».`
      : "Logg inn for å starte.";
  }

  if (!els.heroGameTitle || !els.heroGameDescription) {
    return;
  }

  const selected = currentGame();
  if (!selected) {
    els.heroGameTitle.textContent = "Spillorama";
    els.heroGameDescription.textContent = "Ingen spill publisert. Be admin aktivere spill i /admin.";
    return;
  }

  els.heroGameTitle.textContent = "Spillorama";
  els.heroGameDescription.textContent =
    `${selected.title || selected.slug} er valgt. Les mer for detaljer eller start spill direkte.`;
}

function renderGameLobby() {
  if (!els.gamesLobby) return;
  els.gamesLobby.innerHTML = "";

  if (!state.games.length) {
    els.gamesLobby.innerHTML = '<p class="subtle">Ingen spill publisert ennå.</p>';
    return;
  }

  for (const [index, game] of state.games.entries()) {
    const theme = resolveShowcaseTheme(game.slug);
    const stats = resolveShowcaseStats(game, index);

    const card = document.createElement("article");
    card.className = `game-showcase-card ${game.slug === state.selectedGameSlug ? "active" : ""}`;
    card.style.setProperty("--showcase-accent", theme.accent);
    card.style.setProperty("--showcase-accent-soft", theme.accentSoft);
    card.style.setProperty("--showcase-bg", theme.background);

    card.innerHTML = `
      <div class="game-showcase-left">
        ${theme.image ? `
        <div class="game-showcase-image">
          <img src="${theme.image}" alt="${game.title || game.slug}" loading="lazy" />
        </div>` : ""}
        <div class="game-showcase-text">
          <span class="game-showcase-badge">${stats.badgeValue}</span>
          <h3 class="game-showcase-title">${game.title || game.slug}</h3>
          <p class="game-showcase-meta">${(game.route || "/").toUpperCase()} • ${game.isEnabled ? "LIVE" : "STENGT"}</p>
          <p class="game-showcase-description">${game.description || "Ingen beskrivelse tilgjengelig."}</p>
        </div>
      </div>
      <div class="game-showcase-right">
        <div class="game-showcase-metrics">
          <div class="game-showcase-metric">
            <strong>${formatNok(stats.prizePool)}</strong><span>Premiepott</span><span class="game-showcase-icon">P</span>
          </div>
          <div class="game-showcase-metric">
            <strong>${stats.players}</strong><span>Spillere</span><span class="game-showcase-icon">S</span>
          </div>
          <div class="game-showcase-metric">
            <strong>${formatNok(stats.ticketPrice)}</strong><span>Pris</span><span class="game-showcase-icon">K</span>
          </div>
          <div class="game-showcase-metric">
            <strong>${stats.drawText}</strong><span>Neste</span><span class="game-showcase-icon">T</span>
          </div>
        </div>
        <div class="game-showcase-actions">
          <button type="button" class="btn-ghost js-read-more">Les mer</button>
          <button type="button" class="btn-primary js-play-now" ${!game.isEnabled ? "disabled" : ""}>Spill nå</button>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      state.selectedGameSlug = game.slug;
      if (typeof renderSelectedGame === 'function') renderSelectedGame();
    });

    card.querySelector(".js-read-more").addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedGameSlug = game.slug;
      if (typeof renderSelectedGame === 'function') renderSelectedGame();
    });

    card.querySelector(".js-play-now").addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedGameSlug = game.slug;
      if (typeof renderSelectedGame === 'function') renderSelectedGame();

      if (DIRECT_LAUNCH_GAME_SLUGS.has(game.slug)) {
        const launchUrl = resolveGameLaunchUrl(game);
        if (launchUrl) window.location.assign(launchUrl);
        return;
      }
      const target = els.bingoView;
      if (target && !target.classList.contains("hidden")) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    els.gamesLobby.appendChild(card);
  }
}

function renderGamesNav() {
  els.gamesNav.innerHTML = "";
  if (!state.games.length) {
    if (els.activeGameLabel) {
      els.activeGameLabel.textContent = "Ingen spill tilgjengelig";
    }
    els.gamesNav.classList.add("hidden");
    renderGameLobby();
    renderHeroPanel();
    return;
  }

  els.gamesNav.classList.add("hidden");

  const selected = currentGame();
  if (els.activeGameLabel) {
    els.activeGameLabel.textContent = selected
      ? `${selected.title} (${selected.route})`
      : "Ingen spill valgt";
  }
  renderGameLobby();
  renderHeroPanel();
}

function renderWalletMini() {
  if (!els.walletMiniId || !els.walletMiniBalance) {
    renderProfileSummary();
    return;
  }

  if (!state.user) {
    els.walletMiniId.textContent = "Wallet: -";
    els.walletMiniBalance.textContent = "Saldo: 0";
    renderProfileSummary();
    return;
  }

  const balance =
    state.walletState?.account?.balance ??
    (Number.isFinite(state.user.balance) ? state.user.balance : 0);
  els.walletMiniId.textContent = `Wallet: ${state.user.walletId}`;
  els.walletMiniBalance.textContent = `Saldo: ${formatNokWhole(balance)}`;
  renderProfileSummary();
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
    `Saldo: ${formatNokWhole(state.walletState.account.balance)}`,
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

function populateHallSelect(selectElement, options = {}) {
  if (!selectElement) {
    return;
  }

  const { includePlaceholder = false, placeholderLabel = "Velg hall" } = options;
  selectElement.innerHTML = "";

  if (includePlaceholder) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = placeholderLabel;
    selectElement.appendChild(placeholder);
  }

  const halls = Array.isArray(state.halls) ? state.halls : [];
  for (const hall of halls) {
    const option = document.createElement("option");
    option.value = hall.id;
    option.textContent = `${hall.name} (${hall.slug})`;
    selectElement.appendChild(option);
  }
}

function syncHallSelectors() {
  const selectedHallId = state.selectedHallId || "";
  for (const element of [els.headerHallId, els.safetyHallId, els.bingoHallId]) {
    if (!element) {
      continue;
    }
    const exists = [...element.options].some((option) => option.value === selectedHallId);
    if (exists) {
      element.value = selectedHallId;
    }
  }
}

function renderHeaderHallSelect() {
  if (!els.headerHallId) {
    return;
  }

  populateHallSelect(els.headerHallId);
  if (!state.halls.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Ingen aktive haller";
    els.headerHallId.appendChild(option);
    els.headerHallId.disabled = true;
    return;
  }

  ensureDefaultSelectedHall();
  syncHallSelectors();
  els.headerHallId.disabled = false;
}

function renderSafetyHallSelect() {
  if (!els.safetyHallId) {
    return;
  }

  const halls = Array.isArray(state.halls) ? state.halls : [];
  if (!halls.length) {
    els.safetyHallId.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Ingen aktive haller";
    els.safetyHallId.appendChild(option);
    els.safetyHallId.disabled = true;
    return;
  }

  populateHallSelect(els.safetyHallId);
  ensureDefaultSelectedHall();
  const selectedHallId = state.selectedHallId || halls[0].id;
  state.selectedHallId = selectedHallId;
  syncHallSelectors();
  els.safetyHallId.disabled = false;
}

function syncSafetyInputsFromCompliance(compliance) {
  if (!compliance) {
    return;
  }

  const daily = compliance?.pendingLossLimits?.daily?.value ?? compliance?.personalLossLimits?.daily;
  const monthly = compliance?.pendingLossLimits?.monthly?.value ?? compliance?.personalLossLimits?.monthly;
  if (els.safetyDailyLossLimit) {
    els.safetyDailyLossLimit.value = Number.isFinite(daily) ? String(daily) : "";
  }
  if (els.safetyMonthlyLossLimit) {
    els.safetyMonthlyLossLimit.value = Number.isFinite(monthly) ? String(monthly) : "";
  }

  const hallId = typeof compliance?.hallId === "string" ? compliance.hallId.trim() : "";
  if (hallId) {
    state.selectedHallId = hallId;
    if (els.safetyHallId && [...els.safetyHallId.options].some((option) => option.value === hallId)) {
      els.safetyHallId.value = hallId;
    }
    if (els.bingoHallId && [...els.bingoHallId.options].some((option) => option.value === hallId)) {
      els.bingoHallId.value = hallId;
    }
  }

  renderSafetyOverview();
  renderProfilePlayOverview();
}

function formatComplianceForPlayer(snapshot) {
  const timedPause = snapshot?.restrictions?.timedPause;
  const selfExclusion = snapshot?.restrictions?.selfExclusion;
  const mandatoryPause = snapshot?.pause;
  const lastMandatoryBreak = mandatoryPause?.lastMandatoryBreak;
  const regulatoryDaily = snapshot?.regulatoryLossLimits?.daily;
  const regulatoryMonthly = snapshot?.regulatoryLossLimits?.monthly;
  const personalDaily = snapshot?.personalLossLimits?.daily;
  const personalMonthly = snapshot?.personalLossLimits?.monthly;
  const pendingDaily = snapshot?.pendingLossLimits?.daily;
  const pendingMonthly = snapshot?.pendingLossLimits?.monthly;
  const netDaily = snapshot?.netLoss?.daily;
  const netMonthly = snapshot?.netLoss?.monthly;

  return [
    `Wallet: ${snapshot?.walletId || state.user?.walletId || "-"}`,
    `Hall: ${snapshot?.hallId || state.selectedHallId || "-"}`,
    `Blokkert: ${snapshot?.restrictions?.isBlocked ? "Ja" : "Nei"}`,
    `Blokkert av: ${snapshot?.restrictions?.blockedBy || "-"}`,
    `Pålagt pause: ${mandatoryPause?.isOnPause ? "Aktiv" : "Ikke aktiv"}`,
    `Pålagt pause til: ${mandatoryPause?.pauseUntil || "-"}`,
    `Spilletid i aktiv økt: ${mandatoryPause?.accumulatedPlayMs ?? 0} ms av ${mandatoryPause?.playSessionLimitMs ?? "-"} ms`,
    `Siste pålagte pause: ${lastMandatoryBreak?.triggeredAt || "-"}`,
    `Siste pause hall: ${lastMandatoryBreak?.hallId || "-"}`,
    `Tap ved pålagt pause: dag=${lastMandatoryBreak?.netLoss?.daily ?? "-"} / måned=${lastMandatoryBreak?.netLoss?.monthly ?? "-"}`,
    `Frivillig pause: ${timedPause?.isActive ? "Aktiv" : "Ikke aktiv"}`,
    `Frivillig pause til: ${timedPause?.pauseUntil || "-"}`,
    `Selvutestenging: ${selfExclusion?.isActive ? "Aktiv" : "Ikke aktiv"}`,
    `Selvutestengt til: ${selfExclusion?.minimumUntil || "-"}`,
    `Regulatoriske grenser: dag=${regulatoryDaily ?? "-"} / måned=${regulatoryMonthly ?? "-"}`,
    `Personlige grenser: dag=${personalDaily ?? "-"} / måned=${personalMonthly ?? "-"}`,
    `Ventende daggrense: ${pendingDaily ? `${pendingDaily.value} fra ${pendingDaily.effectiveFrom}` : "-"}`,
    `Ventende månedsgrense: ${pendingMonthly ? `${pendingMonthly.value} fra ${pendingMonthly.effectiveFrom}` : "-"}`,
    `Netto tap: dag=${netDaily ?? "-"} / måned=${netMonthly ?? "-"}`
  ].join("\n");
}

function renderSafetyStatus() {
  renderSafetyOverview();

  if (!els.safetyStatus) {
    return;
  }

  if (!state.user) {
    setStatusBox(els.safetyStatus, "Ikke innlogget.");
    return;
  }

  if (!state.complianceState) {
    setStatusBox(els.safetyStatus, "Ingen spillvett-data lastet. Trykk «Oppdater spillvett».");
    return;
  }

  setStatusBox(els.safetyStatus, formatComplianceForPlayer(state.complianceState));
}

function renderReportPeriodButtons() {
  if (!els.reportPeriodButtons) {
    return;
  }
  const buttons = els.reportPeriodButtons.querySelectorAll("[data-report-period]");
  for (const button of buttons) {
    const isActive = button.dataset.reportPeriod === state.reportPeriod;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function createTableCell(tagName, text, className = "") {
  const cell = document.createElement(tagName);
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  return cell;
}

function renderEmptyTableState(tbody, colSpan, message) {
  if (!tbody) {
    return;
  }
  tbody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = createTableCell("td", message, "report-empty-row");
  cell.colSpan = colSpan;
  row.appendChild(cell);
  tbody.appendChild(row);
}

function renderReportSummary() {
  if (!els.reportSummary) {
    return;
  }

  const report = state.reportState;
  els.reportSummary.innerHTML = "";
  if (!report) {
    return;
  }

  const cards = [
    {
      label: "Periode",
      value: report.range?.label || "-"
    },
    {
      label: "Innsats",
      value: formatNok(report.summary?.stakeTotal)
    },
    {
      label: "Premier",
      value: formatNok(report.summary?.prizeTotal)
    },
    {
      label: "Netto resultat",
      value: formatNetResult(report.summary?.netResult)
    },
    {
      label: "Antall spill",
      value: String(report.summary?.totalPlays ?? 0)
    },
    {
      label: "Bokførte hendelser",
      value: String(report.summary?.totalEvents ?? 0)
    }
  ];

  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "report-summary-card";

    const label = document.createElement("span");
    label.className = "report-summary-label";
    label.textContent = card.label;

    const value = document.createElement("strong");
    value.className = "report-summary-value";
    value.textContent = card.value;

    article.appendChild(label);
    article.appendChild(value);
    els.reportSummary.appendChild(article);
  }
}

function renderReportBreakdown() {
  if (!els.reportBreakdownBody) {
    return;
  }

  const rows = Array.isArray(state.reportState?.breakdown) ? state.reportState.breakdown : [];
  if (!rows.length) {
    renderEmptyTableState(els.reportBreakdownBody, 6, "Ingen registrerte spill i valgt periode.");
    return;
  }

  els.reportBreakdownBody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(createTableCell("td", row.hallName || row.hallId || "-"));
    tr.appendChild(createTableCell("td", formatGameTypeLabel(row.gameType)));
    tr.appendChild(createTableCell("td", formatChannelLabel(row.channel)));
    tr.appendChild(createTableCell("td", formatNok(row.stakeTotal), "report-number-cell"));
    tr.appendChild(createTableCell("td", formatNok(row.prizeTotal), "report-number-cell"));
    tr.appendChild(createTableCell("td", formatNetResult(row.netResult), "report-number-cell"));
    els.reportBreakdownBody.appendChild(tr);
  }
}

function renderReportPlays() {
  if (!els.reportPlaysBody) {
    return;
  }

  const rows = Array.isArray(state.reportState?.plays) ? state.reportState.plays : [];
  if (!rows.length) {
    renderEmptyTableState(els.reportPlaysBody, 8, "Ingen spilldetaljer å vise i valgt periode.");
    return;
  }

  els.reportPlaysBody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(createTableCell("td", row.hallName || row.hallId || "-"));
    tr.appendChild(createTableCell("td", formatGameTypeLabel(row.gameType)));
    tr.appendChild(createTableCell("td", row.roomCode || row.gameId || row.playId || "-"));
    tr.appendChild(createTableCell("td", formatDateTime(row.startedAt)));
    tr.appendChild(createTableCell("td", formatDateTime(row.lastActivityAt)));
    tr.appendChild(createTableCell("td", formatNok(row.stakeTotal), "report-number-cell"));
    tr.appendChild(createTableCell("td", formatNok(row.prizeTotal), "report-number-cell"));
    tr.appendChild(createTableCell("td", formatNetResult(row.netResult), "report-number-cell"));
    els.reportPlaysBody.appendChild(tr);
  }
}

function renderReportEvents() {
  if (!els.reportEventsBody) {
    return;
  }

  const rows = Array.isArray(state.reportState?.events) ? state.reportState.events : [];
  if (!rows.length) {
    renderEmptyTableState(els.reportEventsBody, 5, "Ingen bokførte hendelser å vise i valgt periode.");
    return;
  }

  els.reportEventsBody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(createTableCell("td", formatDateTime(row.createdAt)));
    tr.appendChild(createTableCell("td", row.hallName || row.hallId || "-"));
    tr.appendChild(createTableCell("td", formatGameTypeLabel(row.gameType)));
    tr.appendChild(createTableCell("td", formatEventTypeLabel(row.eventType)));
    tr.appendChild(createTableCell("td", formatNok(row.amount), "report-number-cell"));
    els.reportEventsBody.appendChild(tr);
  }
}

function renderPlayerReport() {
  renderReportPeriodButtons();
  renderProfilePlayOverview();

  if (!els.reportStatus) {
    return;
  }

  if (!state.user) {
    setStatusBox(els.reportStatus, "Ikke innlogget.");
    renderReportSummary();
    renderReportBreakdown();
    renderReportPlays();
    renderReportEvents();
    return;
  }

  if (!state.reportState) {
    setStatusBox(els.reportStatus, "Ingen spillregnskap lastet. Trykk «Oppdater spillregnskap»."); 
    renderReportSummary();
    renderReportBreakdown();
    renderReportPlays();
    renderReportEvents();
    return;
  }

  const report = state.reportState;
  const lines = [
    `Periode: ${report.range?.label || "-"}`,
    `Hallfilter: ${report.hallName || "Alle haller"}`,
    `Innsats: ${formatNok(report.summary?.stakeTotal)}`,
    `Premier: ${formatNok(report.summary?.prizeTotal)}`,
    `Netto resultat: ${formatNetResult(report.summary?.netResult)}`,
    `Generert: ${formatDateTime(report.generatedAt)}`
  ];
  setStatusBox(els.reportStatus, lines.join("\n"), "success");
  renderReportSummary();
  renderReportBreakdown();
  renderReportPlays();
  renderReportEvents();
}

function renderBingoStatus(text, tone = "neutral") {
  setStatusBox(els.bingoStatus, text, tone);
}

function resolveRtpBudgetState(game) {
  if (!game || typeof game !== "object") {
    return null;
  }

  const payoutPercent = asFiniteNumber(game.payoutPercent);
  const prizePool = asFiniteNumber(game.prizePool) ?? 0;
  let maxPayoutBudget = asFiniteNumber(game.maxPayoutBudget);
  let remainingPayoutBudget = asFiniteNumber(game.remainingPayoutBudget);

  if (!Number.isFinite(maxPayoutBudget) && Number.isFinite(prizePool) && Number.isFinite(payoutPercent)) {
    maxPayoutBudget = (prizePool * payoutPercent) / 100;
  }
  if (!Number.isFinite(maxPayoutBudget) || maxPayoutBudget < 0) {
    return null;
  }
  if (!Number.isFinite(remainingPayoutBudget)) {
    remainingPayoutBudget = maxPayoutBudget;
  }

  const boundedRemaining = Math.min(maxPayoutBudget, Math.max(0, remainingPayoutBudget));
  const paidOut = Math.max(0, maxPayoutBudget - boundedRemaining);
  const usagePercent = maxPayoutBudget > 0 ? (paidOut / maxPayoutBudget) * 100 : 100;

  let level = "normal";
  if (usagePercent >= 100 || boundedRemaining <= 0) {
    level = "limit";
  } else if (usagePercent >= 90) {
    level = "high";
  } else if (usagePercent >= 80) {
    level = "elevated";
  }

  return {
    payoutPercent: Number.isFinite(payoutPercent) ? payoutPercent : undefined,
    maxPayoutBudget,
    remainingPayoutBudget: boundedRemaining,
    paidOut,
    usagePercent,
    level
  };
}

function renderRtpMeter(rtp, gameStatus) {
  if (!els.bingoRtpMeter || !els.bingoRtpMeterFill || !els.bingoRtpMeterLabel) {
    return;
  }

  if (!rtp) {
    els.bingoRtpMeter.classList.add("hidden");
    els.bingoRtpMeter.classList.remove("elevated", "high", "limit");
    els.bingoRtpMeterFill.style.width = "0%";
    els.bingoRtpMeterLabel.textContent = "0%";
    els.bingoRtpMeter.querySelector(".rtp-meter-track")?.setAttribute("aria-valuenow", "0");
    return;
  }

  const usedPercent = Math.max(0, Math.min(100, Math.round(rtp.usagePercent * 100) / 100));
  els.bingoRtpMeter.classList.remove("hidden");
  els.bingoRtpMeter.classList.remove("elevated", "high", "limit");
  if (gameStatus === "RUNNING" && rtp.level === "elevated") {
    els.bingoRtpMeter.classList.add("elevated");
  }
  if (gameStatus === "RUNNING" && rtp.level === "high") {
    els.bingoRtpMeter.classList.add("high");
  }
  if (gameStatus === "RUNNING" && rtp.level === "limit") {
    els.bingoRtpMeter.classList.add("limit");
  }

  els.bingoRtpMeterFill.style.width = `${usedPercent}%`;
  els.bingoRtpMeterLabel.textContent = `${usedPercent}% brukt`;
  els.bingoRtpMeter
    .querySelector(".rtp-meter-track")
    ?.setAttribute("aria-valuenow", String(usedPercent));
}

function renderBingoHallSelect() {
  if (!els.bingoHallId) {
    return;
  }

  const halls = Array.isArray(state.halls) ? state.halls : [];
  if (!halls.length) {
    els.bingoHallId.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Ingen aktive haller";
    els.bingoHallId.appendChild(option);
    els.bingoHallId.disabled = true;
    return;
  }

  populateHallSelect(els.bingoHallId);
  ensureDefaultSelectedHall();
  state.selectedHallId = state.selectedHallId || halls[0].id;
  syncHallSelectors();
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
    renderRtpMeter(null);
    els.bingoPlayers.innerHTML = "";
    els.bingoDrawnNumbers.innerHTML = "";
    els.bingoTickets.innerHTML = "<p>Ingen aktive data.</p>";
    return;
  }

  const game = state.snapshot.currentGame;
  const rtp = resolveRtpBudgetState(game);
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

  if (rtp) {
    lines.push(
      `RTP: ${rtp.payoutPercent !== undefined ? `${Math.round(rtp.payoutPercent * 100) / 100}%` : "-"} | Budsjett: ${formatNok(
        rtp.maxPayoutBudget
      )} | Brukt: ${formatNok(rtp.paidOut)} | Gjenstår: ${formatNok(rtp.remainingPayoutBudget)}`
    );
    if (game?.status === "RUNNING" && rtp.level === "elevated") {
      lines.push("ADVARSEL: RTP-budsjettet er over 80% brukt i denne runden.");
    } else if (game?.status === "RUNNING" && rtp.level === "high") {
      lines.push("ADVARSEL: RTP-budsjettet er over 90% brukt i denne runden.");
    } else if (game?.status === "RUNNING" && rtp.level === "limit") {
      lines.push("RTP-GRENSE NÅDD: Videre premieutbetaling i denne runden blir 0.");
    }
  }

  const statusTone =
    game?.status === "RUNNING" && rtp && (rtp.level === "high" || rtp.level === "limit")
      ? "error"
      : "neutral";
  renderBingoStatus(lines.join("\n"), statusTone);
  renderRtpMeter(rtp, game?.status);
  renderBingoPlayers();
  renderBingoDrawnNumbers();
  renderBingoTickets();

  syncWalletBalanceFromRoomSnapshot();
  renderWalletMini();
  renderWalletCard();
}

function renderBackendControlledGameOps() {
  const admin = isAdmin();
  if (els.bingoCreateRoomBtn) {
    els.bingoCreateRoomBtn.disabled = !admin;
  }
  if (els.bingoStartGameBtn) {
    els.bingoStartGameBtn.disabled = !admin;
  }
  if (els.bingoEndGameBtn) {
    els.bingoEndGameBtn.disabled = !admin;
  }
  if (els.bingoDrawNextBtn) {
    els.bingoDrawNextBtn.disabled = !admin;
  }
}

function renderAdminEditor() {
  // Admin-redigering er flyttet til dedikert portal: /admin
}

function renderSelectedGame() {
  renderGamesNav();
  renderSafetyHallSelect();
  renderSafetyStatus();

  const game = currentGame();
  const slug = game?.slug || "";
  const showBingoPanel = slug === "bingo";
  if (els.bingoView) {
    els.bingoView.classList.toggle("hidden", !showBingoPanel);
  }

  if (showBingoPanel) {
    renderBingoHallSelect();
    renderBingoState();
  }
  renderBackendControlledGameOps();
}

function renderAfterLogin() {
  renderLayoutForAuth();
  renderUserBadge();
  renderWalletMini();
  renderKycCard();
  renderWalletCard();
  renderHeaderHallSelect();
  renderSafetyHallSelect();
  renderSafetyStatus();
  renderPlayerReport();
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

async function loadPlayerReport() {
  const hallId = (state.selectedHallId || "").trim();
  const query = new URLSearchParams({ period: state.reportPeriod });
  if (hallId) {
    query.set("hallId", hallId);
  }
  const report = await api(`/api/spillevett/report?${query.toString()}`);
  state.reportState = report;
  renderPlayerReport();
}

function getSelectedSafetyHallId() {
  const hallId = (els.safetyHallId?.value || state.selectedHallId || "").trim();
  if (!hallId) {
    throw new Error("Velg hall for tapsgrenser.");
  }
  return hallId;
}

async function loadComplianceState() {
  const hallId = (els.safetyHallId?.value || state.selectedHallId || "").trim();
  const query = hallId ? `?hallId=${encodeURIComponent(hallId)}` : "";
  const compliance = await api(`/api/wallet/me/compliance${query}`);
  state.complianceState = compliance;
  syncSafetyInputsFromCompliance(compliance);
  setStatusBox(els.safetyStatus, formatComplianceForPlayer(compliance), "success");
}

function buildLossLimitsPayload() {
  const hallId = getSelectedSafetyHallId();
  const dailyLossLimit = parseOptionalNonNegativeNumber(els.safetyDailyLossLimit?.value, "Daglig tapsgrense");
  const monthlyLossLimit = parseOptionalNonNegativeNumber(
    els.safetyMonthlyLossLimit?.value,
    "Månedlig tapsgrense"
  );
  if (dailyLossLimit === undefined && monthlyLossLimit === undefined) {
    throw new Error("Fyll ut minst én tapsgrense.");
  }
  return { hallId, dailyLossLimit, monthlyLossLimit };
}

async function onSafetyRefresh() {
  try {
    await Promise.all([loadWalletState(), loadComplianceState(), loadPlayerReport()]);
  } catch (error) {
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke hente spillvett-data.", "error");
  }
}

async function onSafetySaveLossLimits() {
  try {
    const payload = buildLossLimitsPayload();
    const compliance = await api("/api/wallet/me/loss-limits", {
      method: "PUT",
      body: payload
    });
    state.complianceState = compliance;
    syncSafetyInputsFromCompliance(compliance);
    setStatusBox(els.safetyStatus, formatComplianceForPlayer(compliance), "success");
  } catch (error) {
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke lagre tapsgrenser.", "error");
  }
}

async function onSafetySetPause() {
  try {
    const durationMinutes = parseOptionalPositiveInteger(els.safetyPauseMinutes?.value, "Spillepause");
    const compliance = await api("/api/wallet/me/timed-pause", {
      method: "POST",
      body: {
        durationMinutes: durationMinutes ?? 15
      }
    });
    state.complianceState = compliance;
    syncSafetyInputsFromCompliance(compliance);
    setStatusBox(els.safetyStatus, formatComplianceForPlayer(compliance), "success");
  } catch (error) {
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke sette spillepause.", "error");
  }
}

async function onSafetyClearPause() {
  try {
    const compliance = await api("/api/wallet/me/timed-pause", {
      method: "DELETE"
    });
    state.complianceState = compliance;
    syncSafetyInputsFromCompliance(compliance);
    setStatusBox(els.safetyStatus, formatComplianceForPlayer(compliance), "success");
  } catch (error) {
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke fjerne spillepause.", "error");
  }
}

async function onSafetySetSelfExclusion() {
  try {
    const compliance = await api("/api/wallet/me/self-exclusion", {
      method: "POST"
    });
    state.complianceState = compliance;
    syncSafetyInputsFromCompliance(compliance);
    setStatusBox(els.safetyStatus, formatComplianceForPlayer(compliance), "success");
  } catch (error) {
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke aktivere selvekskludering.", "error");
  }
}

async function onSafetyClearSelfExclusion() {
  try {
    const compliance = await api("/api/wallet/me/self-exclusion", {
      method: "DELETE"
    });
    state.complianceState = compliance;
    syncSafetyInputsFromCompliance(compliance);
    setStatusBox(els.safetyStatus, formatComplianceForPlayer(compliance), "success");
  } catch (error) {
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke oppheve selvekskludering.", "error");
  }
}

async function onReportRefresh() {
  try {
    setStatusBox(els.reportStatus, "Laster spillregnskap...");
    await loadPlayerReport();
  } catch (error) {
    state.reportState = null;
    renderPlayerReport();
    setStatusBox(els.reportStatus, error.message || "Kunne ikke hente spillregnskap.", "error");
  }
}

async function requestReportExport(delivery) {
  if (!state.accessToken) {
    throw new Error("Ikke innlogget.");
  }

  const hallId = (state.selectedHallId || "").trim();
  const payload = {
    delivery,
    period: state.reportPeriod,
    hallId: hallId || undefined,
    email: delivery === "email" ? (els.reportEmail?.value || state.user?.email || "").trim() : undefined
  };

  const response = await fetch("/api/spillevett/report/export", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (delivery === "download") {
    if (!response.ok || !contentType.includes("application/pdf")) {
      let message = `Eksport feilet (${response.status}).`;
      try {
        const errorJson = await response.json();
        message = errorJson?.error?.message || message;
      } catch {
        // Ignore invalid json when pdf export fails before body is serialized.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const periodLabel = state.reportPeriod || "rapport";
    anchor.href = url;
    anchor.download = `spillregnskap-${periodLabel}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return { delivery: "download" };
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Ugyldig svar fra server (${response.status}).`);
  }

  if (!json?.ok) {
    throw new Error(json?.error?.message || `Eksport feilet (${response.status}).`);
  }

  return json.data;
}

async function onReportDownloadPdf() {
  try {
    setStatusBox(els.reportStatus, "Genererer PDF...");
    await requestReportExport("download");
    setStatusBox(els.reportStatus, "PDF lastet ned.", "success");
  } catch (error) {
    setStatusBox(els.reportStatus, error.message || "Kunne ikke laste ned PDF.", "error");
  }
}

async function onReportEmail() {
  try {
    setStatusBox(els.reportStatus, "Sender PDF på e-post...");
    const result = await requestReportExport("email");
    setStatusBox(els.reportStatus, `PDF sendt til ${result.recipientEmail}.`, "success");
  } catch (error) {
    setStatusBox(els.reportStatus, error.message || "Kunne ikke sende PDF på e-post.", "error");
  }
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
    syncHallSelectors();
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
  syncHallSelectors();
}

async function onSelectedHallChanged(nextHallId) {
  const normalizedHallId = (nextHallId || "").trim();
  if (!normalizedHallId || normalizedHallId === state.selectedHallId) {
    syncHallSelectors();
    return;
  }

  state.selectedHallId = normalizedHallId;
  syncHallSelectors();

  if (!state.user) {
    return;
  }

  try {
    await Promise.all([loadComplianceState(), loadPlayerReport()]);
  } catch (error) {
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke oppdatere data for valgt hall.", "error");
    setStatusBox(els.reportStatus, error.message || "Kunne ikke oppdatere spillregnskap.", "error");
  }
}

async function loadAuthenticatedData() {
  const [me, games, halls] = await Promise.all([
    api("/api/auth/me"),
    api("/api/games"),
    api("/api/halls")
  ]);

  state.user = me;
  state.games = getVisiblePortalGames(games);
  state.halls = Array.isArray(halls) ? halls : [];
  if (els.reportEmail) {
    els.reportEmail.value = me?.email || "";
  }
  ensureDefaultSelectedGame();
  ensureDefaultSelectedHall();
  state.adminGames = [];

  await loadWalletState();
  try {
    await Promise.all([loadComplianceState(), loadPlayerReport()]);
  } catch (error) {
    state.complianceState = null;
    state.reportState = null;
    setStatusBox(els.safetyStatus, error.message || "Kunne ikke laste spillvett-data.", "error");
    setStatusBox(els.reportStatus, error.message || "Kunne ikke laste spillregnskap.", "error");
  }
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
  const surname = (els.registerSurname.value || "").trim();
  const dob = (els.registerDob.value || "").trim();
  const phone = (els.registerPhone.value || "").trim();
  const email = (els.registerEmail.value || "").trim();
  const password = els.registerPassword.value || "";

  if (!displayName || !surname || !dob || !email || !password) {
    setStatusBox(els.registerStatus, "Fyll ut fornavn, etternavn, fødselsdato, e-post og passord.", "error");
    return;
  }

  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  if (age < 18) {
    setStatusBox(els.registerStatus, "Du må være minst 18 år for å registrere deg.", "error");
    return;
  }

  try {
    const session = await api("/api/auth/register", {
      method: "POST",
      auth: false,
      body: { displayName, surname, birthDate: dob, phone: phone || undefined, email, password }
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
  renderSafetyHallSelect();
  renderSafetyStatus();
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
  const inputValue = Number(els.walletTopupAmount?.value || 0);
  if (Number.isFinite(inputValue) && inputValue > 0) {
    return inputValue;
  }

  const prompted = window.prompt("Hvor mye vil du overføre?", "100");
  if (prompted === null) {
    throw new Error("Overføring avbrutt.");
  }
  const amount = Number(prompted);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Beløp må være større enn 0.");
  }
  return amount;
}

function setTransferDirection(direction) {
  const normalized = direction === "BANK" ? "BANK" : "PLAYER";
  state.transferDirection = normalized;
  renderTransferPanel();
}

function onTransferAmountGridClick(event) {
  const button = event.target.closest("[data-transfer-amount]");
  if (!button || button instanceof HTMLButtonElement === false || button.disabled) {
    return;
  }
  const raw = String(button.dataset.transferAmount || "").trim().toLowerCase();
  if (raw === "other") {
    state.transferSelectedAmount = "OTHER";
    renderTransferPanel();
    if (els.transferCustomAmount) {
      els.transferCustomAmount.focus();
    }
    return;
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }
  state.transferSelectedAmount = amount;
  state.transferCustomAmount = "";
  renderTransferPanel();
}

function onTransferCustomAmountInput() {
  state.transferCustomAmount = String(els.transferCustomAmount?.value || "").trim();
  renderTransferPanel();
}

function resolveTransferAmount() {
  if (state.transferDirection !== "PLAYER") {
    throw new Error("Overføring til bankkonto kommer snart.");
  }
  const amount = getSelectedTransferAmount();
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Velg et beløp over 0.");
  }
  return amount;
}

async function startSwedbankTopup(amount) {
  const intent = await api("/api/payments/swedbank/topup-intent", {
    method: "POST",
    body: { amount }
  });
  await applySwedbankIntentStatus(intent);
  const opened = openSwedbankCheckoutModal(intent);
  if (!opened) {
    throw new Error("Mottok ingen iframe-url fra Swedbank. Bruk 'Åpne i ny fane' hvis URL finnes.");
  }
  startSwedbankStatusPolling(intent.id);
}

async function onTransferContinue() {
  if (state.transferSubmitting) {
    return;
  }
  try {
    state.transferSubmitting = true;
    renderTransferPanel();
    const amount = resolveTransferAmount();
    await startSwedbankTopup(amount);
    closeProfileModal();
  } catch (error) {
    setStatusBox(els.walletStatus, error.message || "Top-up feilet.", "error");
  } finally {
    state.transferSubmitting = false;
    renderTransferPanel();
  }
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
  if (els.profileTransferView && els.profileMainView) {
    setProfileTransferMode(true);
    return;
  }
  try {
    const amount = parseTopupAmount();
    await startSwedbankTopup(amount);
  } catch (error) {
    setStatusBox(els.walletStatus, error.message || "Top-up feilet.", "error");
  }
}

function onOpenPersonalInfo() {
  setProfilePersonalInfoMode(true);
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
    if (!isAdmin()) {
      throw new Error("Kun admin kan opprette rom her. Bruk /admin.");
    }
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
    if (!isAdmin()) {
      throw new Error("Kun admin kan starte spill her. Bruk /admin.");
    }
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
    if (!isAdmin()) {
      throw new Error("Kun admin kan avslutte spill her. Bruk /admin.");
    }
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
    if (!isAdmin()) {
      throw new Error("Kun admin kan trekke tall her. Bruk /admin.");
    }
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
  window.location.assign("/admin");
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
if (els.logoutBtn) {
  els.logoutBtn.addEventListener("click", onLogout);
}

if (els.walletRefreshBtn) {
  els.walletRefreshBtn.addEventListener("click", onWalletRefresh);
}
if (els.walletTopupBtn) {
  els.walletTopupBtn.addEventListener("click", onWalletTopup);
}
if (els.profilePersonalInfoBtn) {
  els.profilePersonalInfoBtn.addEventListener("click", onOpenPersonalInfo);
}
if (els.transferToPlayerBtn) {
  els.transferToPlayerBtn.addEventListener("click", () => setTransferDirection("PLAYER"));
}
if (els.transferToBankBtn) {
  els.transferToBankBtn.addEventListener("click", () => setTransferDirection("BANK"));
}
if (els.transferAmountGrid) {
  els.transferAmountGrid.addEventListener("click", onTransferAmountGridClick);
}
if (els.transferCustomAmount) {
  els.transferCustomAmount.addEventListener("input", onTransferCustomAmountInput);
  els.transferCustomAmount.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onTransferContinue();
    }
  });
}
if (els.transferContinueBtn) {
  els.transferContinueBtn.addEventListener("click", onTransferContinue);
}
if (els.walletSwedbankIntentBtn) {
  els.walletSwedbankIntentBtn.addEventListener("click", onSwedbankIntent);
}
if (els.adminPortalBtn) {
  els.adminPortalBtn.addEventListener("click", () => {
    window.location.assign("/admin");
  });
}
if (els.profileBtn) {
  els.profileBtn.addEventListener("click", openProfileModal);
}
if (els.profileCloseBtn) {
  els.profileCloseBtn.addEventListener("click", closeProfileModal);
}
if (els.profileModal) {
  els.profileModal.addEventListener("click", (event) => {
    if (event.target === els.profileModal) {
      closeProfileModal();
    }
  });
}
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
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeProfileModal();
    onSwedbankClose();
  }
});
if (els.kycVerifyBtn) {
  els.kycVerifyBtn.addEventListener("click", onKycVerify);
}
if (els.safetyRefreshBtn) {
  els.safetyRefreshBtn.addEventListener("click", onSafetyRefresh);
}
if (els.safetySaveLossLimitsBtn) {
  els.safetySaveLossLimitsBtn.addEventListener("click", onSafetySaveLossLimits);
}
if (els.safetySetPauseBtn) {
  els.safetySetPauseBtn.addEventListener("click", onSafetySetPause);
}
if (els.safetyClearPauseBtn) {
  els.safetyClearPauseBtn.addEventListener("click", onSafetyClearPause);
}
if (els.safetySetSelfExclusionBtn) {
  els.safetySetSelfExclusionBtn.addEventListener("click", onSafetySetSelfExclusion);
}
if (els.safetyClearSelfExclusionBtn) {
  els.safetyClearSelfExclusionBtn.addEventListener("click", onSafetyClearSelfExclusion);
}
if (els.reportRefreshBtn) {
  els.reportRefreshBtn.addEventListener("click", onReportRefresh);
}
if (els.reportDownloadPdfBtn) {
  els.reportDownloadPdfBtn.addEventListener("click", onReportDownloadPdf);
}
if (els.reportEmailBtn) {
  els.reportEmailBtn.addEventListener("click", onReportEmail);
}
if (els.reportPeriodButtons) {
  els.reportPeriodButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-period]");
    if (!button) {
      return;
    }
    const nextPeriod = (button.dataset.reportPeriod || "").trim();
    if (!nextPeriod || nextPeriod === state.reportPeriod) {
      return;
    }
    state.reportPeriod = nextPeriod;
    renderReportPeriodButtons();
    onReportRefresh();
  });
}
if (els.headerHallId) {
  els.headerHallId.addEventListener("change", () => {
    onSelectedHallChanged(els.headerHallId.value);
  });
}
if (els.safetyHallId) {
  els.safetyHallId.addEventListener("change", () => {
    onSelectedHallChanged(els.safetyHallId.value);
  });
}

if (els.bingoHallId) {
  els.bingoHallId.addEventListener("change", () => {
    onSelectedHallChanged(els.bingoHallId.value);
  });
}

els.bingoCreateRoomBtn.addEventListener("click", onBingoCreateRoom);
els.bingoJoinRoomBtn.addEventListener("click", onBingoJoinRoom);
els.bingoStartGameBtn.addEventListener("click", onBingoStartGame);
els.bingoEndGameBtn.addEventListener("click", onBingoEndGame);
els.bingoDrawNextBtn.addEventListener("click", onBingoDrawNext);
els.bingoClaimLineBtn.addEventListener("click", () => onBingoClaim("LINE"));
els.bingoClaimBingoBtn.addEventListener("click", () => onBingoClaim("BINGO"));

if (els.adminSaveGameBtn) {
  els.adminSaveGameBtn.addEventListener("click", onAdminSaveGame);
}

function initialRender() {
  closeSwedbankCheckoutModal();
  setProfileTransferMode(false);
  renderLayoutForAuth();
  renderUserBadge();
  renderHeroPanel();
  renderGameLobby();
  renderWalletMini();
  renderKycCard();
  renderWalletCard();
  renderHeaderHallSelect();
  renderSafetyHallSelect();
  renderSafetyStatus();
  renderPlayerReport();
  renderBingoState();
  setStatusBox(els.loginStatus, "Ikke logget inn.");
  setStatusBox(els.registerStatus, "Ikke opprettet bruker ennå.");
}

async function bootstrap() {
  loadAuthFromStorage();
  state.isAuthBootstrapping = Boolean(state.accessToken);
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
  try {
    await bootFromToken();
  } finally {
    state.isAuthBootstrapping = false;
    renderLayoutForAuth();
  }
}

bootstrap();
