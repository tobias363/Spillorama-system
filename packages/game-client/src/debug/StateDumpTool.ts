/**
 * 2026-05-14 (Tobias-direktiv) — Frontend-state-dump-verktøy.
 *
 * Bakgrunn:
 *   Når Tobias rapporterer bugs som "Bongen viser 20 kr men skulle vært
 *   10 kr" har PM-agenten brukt sesjons-tid på å gjette hvilken state-
 *   kilde frontend faktisk leser fra:
 *     - state.ticketTypes (room-snapshot)?
 *     - nextGame.ticketPricesCents (lobby-API)?
 *     - state.entryFee ?? 10 (default-fallback)?
 *
 *   Med manuelle browser-console-snippets blir bildet fragmentert og
 *   ikke-reproduserbart. Vi trenger en deterministisk dump.
 *
 *   Tobias-direktiv 2026-05-14:
 *   > "Vi mangler en deterministisk dump av frontend-state i runtime."
 *
 *   Denne tool-en samler komplett state-tree fra ALLE kjente kilder i ett
 *   enkelt JSON-objekt og publiserer det fire steder:
 *
 *     1. window.__SPILL1_STATE_DUMP — JS-globalt for DevTools-inspeksjon
 *     2. localStorage["spill1.lastStateDump"] — persistert tvers reloads
 *     3. POST /api/_dev/debug/frontend-state-dump — server-side log
 *     4. console.log("[STATE-DUMP]", ...) — Live-monitor-agent plukker opp
 *
 * Designvalg:
 *   - Pure read — vi muterer ALDRI state. Bare leser.
 *   - Stable shape — samme key-rekkefølge hver gang så diff blir lett.
 *   - Idempotent — flere kall gir flere dumps med unik timestamp men
 *     identisk structure.
 *   - Fail-soft — manglende kilder gir `null`-felter, ikke throw.
 *   - Token-gated server-POST — gjenbruker RESET_TEST_PLAYERS_TOKEN
 *     (samme som rrweb + bug-report).
 *   - Privacy — vi dumper IKKE passord eller full PII, men spillerprofil
 *     forblir (userId, walletId, balance). Dette er kun debug-verktøy
 *     og kjøres KUN i staging/dev der token er konfigurert.
 *
 * Hva dumpen inkluderer (fem hovedseksjoner):
 *   - lobbyState: aktiv hall, halls-listen, games + status, compliance,
 *     balance.
 *   - roomState: currentGame, players, ticketTypes, gameVariant,
 *     scheduler-state, drawnNumbers.
 *   - playerState: myTickets, armed-selections, preRoundTickets,
 *     wallet-balanse, lucky-number.
 *   - screenState: nåværende screen, transition-historie.
 *   - socketState: connected, room joined, siste mottatte events.
 *   - derivedState (kjernen i feilsøking):
 *     * pricePerColor: { yellow: 500, white: 1000, purple: 1500 }
 *       (entryFee × priceMultiplier per fargen).
 *     * innsatsVsForhandskjop: { activeStake, pendingStake, classification }
 *     * autoMultiplikatorApplied: true/false + per-fargen-skalering vist.
 *
 * Brukstilfeller:
 *   1. "Pris viser 20 kr men skulle vært 10 kr" → dump → se
 *      `derivedState.pricePerColor` for å finne om bug er i entryFee,
 *      multiplier, eller fallback.
 *   2. "Innsats + Forhåndskjøp dobbelt-telles" → dump → se
 *      `derivedState.innsatsVsForhandskjop`.
 *   3. "Frontend henger etter runde-end" → dump → se `screenState` +
 *      `socketState.lastEvents`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Local-storage-key for siste dump (idempotent overwrite). */
export const STATE_DUMP_LOCALSTORAGE_KEY = "spill1.lastStateDump";

/** Globalt JS-variabel-navn (kun for DevTools-inspeksjon). */
export const STATE_DUMP_GLOBAL_NAME = "__SPILL1_STATE_DUMP";

/** Console-tag som Live-monitor-agent grep-er etter. */
export const STATE_DUMP_LOG_TAG = "[STATE-DUMP]";

/** Default server-endpoint (token-gated). */
const DEFAULT_DUMP_ENDPOINT = "/api/_dev/debug/frontend-state-dump";

/** Default token-strategi matcher RrwebRecorder. */
const DEFAULT_DEV_TOKEN = "spillorama-2026-test";

/**
 * Wire-shape: hva som faktisk dumpes. Frosset for diff-vennlighet —
 * key-rekkefølge fastsatt her, ikke i call-sites.
 */
export interface FrontendStateDump {
  /** Timestamp i ms — unik per dump. */
  timestamp: number;
  /** ISO-string for menneskelig lesing. */
  timestampIso: string;
  /** UUID v4 — så multiple dumps kan korreleres mot server. */
  dumpId: string;
  /** Spill (slug). Default "bingo". */
  gameSlug: string;
  /** Lobby-state (active hall, halls, games, compliance, balance). */
  lobbyState: LobbyStateSection | null;
  /** Rom-state (currentGame, players, ticketTypes, gameVariant). */
  roomState: RoomStateSection | null;
  /** Player-state (mine billetter, armed-selections, wallet-balanse). */
  playerState: PlayerStateSection | null;
  /** Screen-state (nåværende screen, transition-historie). */
  screenState: ScreenStateSection | null;
  /** Socket-state (connected, room joined, siste events). */
  socketState: SocketStateSection | null;
  /** Avledet state (kjernen i bug-investigation). */
  derivedState: DerivedStateSection;
  /** Klient-side miljø (href, user-agent etc). */
  env: EnvSection;
}

export interface LobbyStateSection {
  activeHallId: string | null;
  halls: Array<{ id: string; name: string | null }>;
  games: Array<{
    slug: string;
    name?: string | null;
    status?: string | null;
  }>;
  /** Ticket-priser fra lobby-API (skal være kilde-til-sannhet for pris). */
  ticketPricesCents: Record<string, number> | null;
  /** Neste planlagte spill (Spill 1 — `nextGame` fra lobby-state). */
  nextGame: {
    catalogSlug?: string | null;
    displayName?: string | null;
    scheduledStartTime?: string | null;
    ticketPricesCents?: Record<string, number> | null;
  } | null;
  /** Spillerens compliance-status (canPlay, restrictions). */
  compliance: {
    canPlay: boolean | null;
    selfExcluded: boolean | null;
    timedPauseUntil: string | null;
  } | null;
  /** Wallet-saldo (kroner). */
  balanceKr: number | null;
}

export interface RoomStateSection {
  roomCode: string | null;
  hallId: string | null;
  gameStatus: string | null;
  gameId: string | null;
  gameType: string | null;
  playerCount: number;
  drawCount: number;
  totalDrawCapacity: number;
  lastDrawnNumber: number | null;
  prizePool: number;
  /** Inngangs-pris (kroner) fra room:update. */
  entryFee: number;
  /** Bong-typer fra room:update.gameVariant. */
  ticketTypes: Array<{
    name: string;
    type: string;
    priceMultiplier: number;
    ticketCount: number;
  }>;
  /** Jackpot-header fra room:update.gameVariant.jackpot. */
  jackpot: { drawThreshold: number; prize: number; isDisplay: boolean } | null;
  isPaused: boolean;
  pauseReason: string | null;
  pauseUntil: string | null;
  millisUntilNextStart: number | null;
  canStartNow: boolean;
}

export interface PlayerStateSection {
  myPlayerId: string | null;
  /** Aktiv-runde-billetter (i RUNNING-state). */
  myTickets: Array<{
    id?: string | number | null;
    type?: string | null;
    color?: string | null;
  }>;
  /** Pre-round-billetter (alltid generert av backend; vis kun hvis armed). */
  preRoundTickets: Array<{
    id?: string | number | null;
    type?: string | null;
    color?: string | null;
  }>;
  /** Lengde av myMarks per ticket (sum av marks). */
  myMarksTotal: number;
  /** Armed-status — har spilleren kalt bet:arm for next round? */
  isArmed: boolean;
  /** Server-autoritativ active-round-innsats i kroner. */
  myStake: number;
  /** Server-autoritativ next-round-pending-innsats i kroner. */
  myPendingStake: number;
  /** Lucky-number spilleren har satt. */
  myLuckyNumber: number | null;
  /** Wallet-balanse i kroner — kan avvike fra lobby-state.balanceKr. */
  walletBalanceKr: number | null;
}

export interface ScreenStateSection {
  currentScreen: string | null;
  /** Siste 10 screen-overganger (eldste først). */
  transitionHistory: Array<{ at: number; from?: string; to: string }>;
}

export interface SocketStateSection {
  connected: boolean;
  connectionState: string | null;
  /** Truncert til siste 20 events for ikke å fylle dump. */
  lastEvents: Array<{
    timestamp: number;
    direction: "in" | "out";
    type: string;
  }>;
}

export interface DerivedStateSection {
  /**
   * Per-bong-pris i kroner — beregnet som entryFee × priceMultiplier per
   * ticketType. Hvis ticketTypes mangler returnerer vi { __empty: true }.
   *
   * Eksempel ved entryFee=5, ticketTypes=[{yellow,1},{white,2},{purple,3}]:
   *   { yellow: 5, white: 10, purple: 15 }
   */
  pricePerColor: Record<string, number> | { __empty: true };
  /**
   * Auto-multiplikator-status: true hvis vi har minst én priceMultiplier
   * forskjellig fra 1 (dvs. ekte skalering). Hjelper PM se om frontend
   * faktisk anvender multipliseringen.
   */
  autoMultiplikatorApplied: boolean;
  /**
   * Innsats vs Forhåndskjøp-klassifikasjon. Hjelper når Tobias melder
   * "begge teller dobbelt" — vi viser at de er separate verdier.
   */
  innsatsVsForhandskjop: {
    activeStakeKr: number;
    pendingStakeKr: number;
    /** Sum av begge — vis IKKE som "total betalt" i UI. */
    summedKr: number;
    /** "active" hvis activeStake>0 og pending=0; "pre-round" omvendt; "both" ved overgang. */
    classification: "active" | "pre-round" | "both" | "none";
  };
  /**
   * Sammenligning mellom kilder for ticket-pris:
   *   - "room.entryFee × ticketType.priceMultiplier" (kanonisk)
   *   - "lobby.ticketPricesCents" (forventet kilde for pris-popup)
   *   - "lobby.nextGame.ticketPricesCents" (kilde for next-round-display)
   *
   * Hvis disse divergerer er det rød flag — typisk indikerer det at
   * frontend leser fra feil sted.
   */
  pricingSourcesComparison: {
    roomEntryFeeKr: number | null;
    roomTicketTypesNames: string[];
    lobbyTicketPricesKr: Record<string, number> | null;
    nextGameTicketPricesKr: Record<string, number> | null;
    /** "consistent" hvis alle kilder gir samme totalsum; ellers "divergent". */
    consistency: "consistent" | "divergent" | "insufficient-data";
  };
}

export interface EnvSection {
  href: string;
  userAgent: string;
  /** Window-størrelse — hjelper når UI-bugs er viewport-spesifikke. */
  viewport: { width: number; height: number };
}

/**
 * Provider-grensesnitt — minimal kontrakt som call-site må gi for å
 * generere en dump. Alle felter er valgfrie; manglende kilder gir
 * `null`-felter i dump-output.
 */
export interface StateDumpProviders {
  /** Hent frontend-state-tree (typisk GameBridge.getState()). */
  getGameState?: () => unknown | null;
  /** Hent lobby-state (Spill1LobbyState eller tilsvarende). */
  getLobbyState?: () => unknown | null;
  /** Hent screen-state (currentScreen + transition-historie). */
  getScreenState?: () => { current: string | null; history?: Array<{ at: number; from?: string; to: string }> } | null;
  /** Hent socket-state (connected + last events). */
  getSocketState?: () =>
    | { connected: boolean; connectionState?: string; lastEvents?: Array<{ timestamp: number; direction: "in" | "out"; type: string }> }
    | null;
  /** Hent gjeldende spill-slug. */
  getGameSlug?: () => string;
}

/** Options for `dumpState()`. */
export interface DumpStateOptions {
  /** Server-endpoint som dump POST-es til (default `/api/_dev/debug/frontend-state-dump`). */
  endpoint?: string;
  /** Token — gjenbruker RESET_TEST_PLAYERS_TOKEN-konvensjonen. */
  token?: string;
  /** Skip server-POST (tester / offline). Default false. */
  skipServerPost?: boolean;
  /** Skip console.log (tester). Default false. */
  skipConsoleLog?: boolean;
  /** Override clock — tester. */
  now?: () => number;
  /** Override UUID-generator — tester. */
  generateId?: () => string;
  /** Override fetch-impl — tester. */
  fetchFn?: typeof fetch;
}

/** Sub-dependency injection: providers + options. */
export interface BuildDumpInput extends DumpStateOptions {
  providers: StateDumpProviders;
}

// ─── Hovedfunksjon ────────────────────────────────────────────────────────────

/**
 * Bygger en frontend-state-dump fra alle tilgjengelige kilder.
 *
 * Pure read — muterer aldri input. Returnerer komplett dump-objekt.
 * Throw-safe — alle provider-kall wrappes i try/catch og returnerer null
 * ved feil.
 */
export function buildStateDump(input: BuildDumpInput): FrontendStateDump {
  const providers = input.providers ?? {};
  const now = input.now ?? Date.now;
  const generateId = input.generateId ?? defaultGenerateId;
  const timestamp = now();

  // ── Hent rå state via providers (alle try/catch-beskyttet) ───────────────
  const gameState = safeGet(providers.getGameState);
  const lobbyState = safeGet(providers.getLobbyState);
  const screenStateRaw = safeGet(providers.getScreenState);
  const socketStateRaw = safeGet(providers.getSocketState);
  const gameSlug =
    safeGet(providers.getGameSlug as () => unknown) as string | null | undefined;

  // ── Bygg seksjoner ───────────────────────────────────────────────────────
  const lobby = buildLobbySection(lobbyState);
  const room = buildRoomSection(gameState);
  const player = buildPlayerSection(gameState);
  const screen = buildScreenSection(screenStateRaw);
  const socket = buildSocketSection(socketStateRaw);
  const derived = buildDerivedSection({ gameState, lobby, room, player });
  const env = buildEnvSection();

  return {
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
    dumpId: generateId(),
    gameSlug: typeof gameSlug === "string" && gameSlug ? gameSlug : "bingo",
    lobbyState: lobby,
    roomState: room,
    playerState: player,
    screenState: screen,
    socketState: socket,
    derivedState: derived,
    env,
  };
}

/**
 * Genererer dump og publiserer til alle 4 kanaler (window-global,
 * localStorage, server-POST, console.log).
 *
 * Idempotent — multiple kall gir flere dumps med unik timestamp + dumpId.
 * Server-POST og localStorage-skriv er fail-soft (logges som warn, kaster
 * ikke videre).
 */
export async function dumpState(input: BuildDumpInput): Promise<FrontendStateDump> {
  const dump = buildStateDump(input);

  // 1. window-global
  try {
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>)[STATE_DUMP_GLOBAL_NAME] = dump;
    }
  } catch (err) {
    warn("window-global skriv feilet:", err);
  }

  // 2. localStorage
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(
        STATE_DUMP_LOCALSTORAGE_KEY,
        JSON.stringify(dump),
      );
    }
  } catch (err) {
    warn("localStorage skriv feilet:", err);
  }

  // 3. console.log med tag for Live-monitor-agent
  if (!input.skipConsoleLog) {
    try {
      // eslint-disable-next-line no-console
      console.log(STATE_DUMP_LOG_TAG, JSON.stringify(dump));
    } catch (err) {
      warn("console.log feilet:", err);
    }
  }

  // 4. Server-POST (fail-soft)
  if (!input.skipServerPost) {
    try {
      await postToServer(dump, input);
    } catch (err) {
      warn("server-POST feilet:", err);
    }
  }

  return dump;
}

// ─── Seksjons-byggere ─────────────────────────────────────────────────────────

function buildLobbySection(raw: unknown): LobbyStateSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, any>;

  const halls: LobbyStateSection["halls"] = [];
  if (Array.isArray(s["halls"])) {
    for (const h of s["halls"]) {
      if (h && typeof h === "object") {
        halls.push({
          id: typeof h["id"] === "string" ? h["id"] : "",
          name:
            typeof h["name"] === "string"
              ? h["name"]
              : typeof h["displayName"] === "string"
                ? h["displayName"]
                : null,
        });
      }
    }
  }

  const games: LobbyStateSection["games"] = [];
  if (Array.isArray(s["games"])) {
    for (const g of s["games"]) {
      if (g && typeof g === "object") {
        games.push({
          slug: typeof g["slug"] === "string" ? g["slug"] : "",
          name:
            typeof g["name"] === "string"
              ? g["name"]
              : typeof g["displayName"] === "string"
                ? g["displayName"]
                : null,
          status:
            typeof g["status"] === "string"
              ? g["status"]
              : typeof g["gameStatus"] === "string"
                ? g["gameStatus"]
                : null,
        });
      }
    }
  }

  const ticketPricesCents = normaliseTicketPricesCents(s["ticketPricesCents"]);
  const nextGameRaw = s["nextGame"];
  const nextGame: LobbyStateSection["nextGame"] =
    nextGameRaw && typeof nextGameRaw === "object"
      ? {
          catalogSlug:
            typeof (nextGameRaw as any)["catalogSlug"] === "string"
              ? (nextGameRaw as any)["catalogSlug"]
              : typeof (nextGameRaw as any)["slug"] === "string"
                ? (nextGameRaw as any)["slug"]
                : null,
          displayName:
            typeof (nextGameRaw as any)["displayName"] === "string"
              ? (nextGameRaw as any)["displayName"]
              : typeof (nextGameRaw as any)["name"] === "string"
                ? (nextGameRaw as any)["name"]
                : null,
          scheduledStartTime:
            typeof (nextGameRaw as any)["scheduledStartTime"] === "string"
              ? (nextGameRaw as any)["scheduledStartTime"]
              : null,
          ticketPricesCents: normaliseTicketPricesCents(
            (nextGameRaw as any)["ticketPricesCents"],
          ),
        }
      : null;

  const complianceRaw = s["compliance"];
  const compliance: LobbyStateSection["compliance"] =
    complianceRaw && typeof complianceRaw === "object"
      ? {
          canPlay:
            typeof (complianceRaw as any)["canPlay"] === "boolean"
              ? (complianceRaw as any)["canPlay"]
              : null,
          selfExcluded:
            typeof (complianceRaw as any)["selfExcluded"] === "boolean"
              ? (complianceRaw as any)["selfExcluded"]
              : null,
          timedPauseUntil:
            typeof (complianceRaw as any)["timedPauseUntil"] === "string"
              ? (complianceRaw as any)["timedPauseUntil"]
              : null,
        }
      : null;

  return {
    activeHallId:
      typeof s["activeHallId"] === "string"
        ? s["activeHallId"]
        : typeof s["hallId"] === "string"
          ? s["hallId"]
          : null,
    halls,
    games,
    ticketPricesCents,
    nextGame,
    compliance,
    balanceKr: toNumber(s["balanceKr"] ?? s["balance"] ?? null),
  };
}

function buildRoomSection(raw: unknown): RoomStateSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, any>;

  const ticketTypesArr: RoomStateSection["ticketTypes"] = [];
  if (Array.isArray(s["ticketTypes"])) {
    for (const t of s["ticketTypes"]) {
      if (t && typeof t === "object") {
        ticketTypesArr.push({
          name: typeof t["name"] === "string" ? t["name"] : "",
          type: typeof t["type"] === "string" ? t["type"] : "",
          priceMultiplier: toNumber(t["priceMultiplier"]) ?? 1,
          ticketCount: toNumber(t["ticketCount"]) ?? 1,
        });
      }
    }
  }

  const jackpotRaw = s["jackpot"];
  const jackpot: RoomStateSection["jackpot"] =
    jackpotRaw && typeof jackpotRaw === "object"
      ? {
          drawThreshold: toNumber((jackpotRaw as any)["drawThreshold"]) ?? 0,
          prize: toNumber((jackpotRaw as any)["prize"]) ?? 0,
          isDisplay: Boolean((jackpotRaw as any)["isDisplay"]),
        }
      : null;

  return {
    roomCode: typeof s["roomCode"] === "string" ? s["roomCode"] : null,
    hallId: typeof s["hallId"] === "string" ? s["hallId"] : null,
    gameStatus: typeof s["gameStatus"] === "string" ? s["gameStatus"] : null,
    gameId: typeof s["gameId"] === "string" ? s["gameId"] : null,
    gameType: typeof s["gameType"] === "string" ? s["gameType"] : null,
    playerCount: toNumber(s["playerCount"]) ?? 0,
    drawCount: toNumber(s["drawCount"]) ?? 0,
    totalDrawCapacity: toNumber(s["totalDrawCapacity"]) ?? 0,
    lastDrawnNumber: toNumber(s["lastDrawnNumber"]),
    prizePool: toNumber(s["prizePool"]) ?? 0,
    entryFee: toNumber(s["entryFee"]) ?? 0,
    ticketTypes: ticketTypesArr,
    jackpot,
    isPaused: Boolean(s["isPaused"]),
    pauseReason: typeof s["pauseReason"] === "string" ? s["pauseReason"] : null,
    pauseUntil: typeof s["pauseUntil"] === "string" ? s["pauseUntil"] : null,
    millisUntilNextStart: toNumber(s["millisUntilNextStart"]),
    canStartNow: Boolean(s["canStartNow"]),
  };
}

function buildPlayerSection(raw: unknown): PlayerStateSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, any>;

  const ticketsToArr = (val: unknown): PlayerStateSection["myTickets"] => {
    if (!Array.isArray(val)) return [];
    const out: PlayerStateSection["myTickets"] = [];
    for (const t of val) {
      if (t && typeof t === "object") {
        out.push({
          id:
            typeof t["id"] === "string" || typeof t["id"] === "number"
              ? t["id"]
              : null,
          type: typeof t["type"] === "string" ? t["type"] : null,
          color:
            typeof t["color"] === "string"
              ? t["color"]
              : typeof t["ticketColor"] === "string"
                ? t["ticketColor"]
                : null,
        });
      }
    }
    return out;
  };

  let myMarksTotal = 0;
  if (Array.isArray(s["myMarks"])) {
    for (const arr of s["myMarks"]) {
      if (Array.isArray(arr)) myMarksTotal += arr.length;
    }
  }

  return {
    myPlayerId: typeof s["myPlayerId"] === "string" ? s["myPlayerId"] : null,
    myTickets: ticketsToArr(s["myTickets"]),
    preRoundTickets: ticketsToArr(s["preRoundTickets"]),
    myMarksTotal,
    isArmed: Boolean(s["isArmed"]),
    myStake: toNumber(s["myStake"]) ?? 0,
    myPendingStake: toNumber(s["myPendingStake"]) ?? 0,
    myLuckyNumber: toNumber(s["myLuckyNumber"]),
    walletBalanceKr: toNumber(s["walletBalanceKr"] ?? s["balance"] ?? null),
  };
}

function buildScreenSection(raw: unknown): ScreenStateSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, any>;
  const history: ScreenStateSection["transitionHistory"] = [];
  if (Array.isArray(s["history"])) {
    // Truncér til siste 10
    const tail = s["history"].slice(-10);
    for (const h of tail) {
      if (h && typeof h === "object") {
        history.push({
          at: toNumber((h as any)["at"]) ?? 0,
          from:
            typeof (h as any)["from"] === "string"
              ? (h as any)["from"]
              : undefined,
          to: typeof (h as any)["to"] === "string" ? (h as any)["to"] : "",
        });
      }
    }
  }
  return {
    currentScreen:
      typeof s["current"] === "string"
        ? s["current"]
        : typeof s["currentScreen"] === "string"
          ? s["currentScreen"]
          : null,
    transitionHistory: history,
  };
}

function buildSocketSection(raw: unknown): SocketStateSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, any>;
  const events: SocketStateSection["lastEvents"] = [];
  if (Array.isArray(s["lastEvents"])) {
    const tail = s["lastEvents"].slice(-20);
    for (const ev of tail) {
      if (ev && typeof ev === "object") {
        const direction = (ev as any)["direction"];
        events.push({
          timestamp: toNumber((ev as any)["timestamp"]) ?? 0,
          direction: direction === "out" ? "out" : "in",
          type: typeof (ev as any)["type"] === "string" ? (ev as any)["type"] : "",
        });
      }
    }
  }
  return {
    connected: Boolean(s["connected"]),
    connectionState:
      typeof s["connectionState"] === "string" ? s["connectionState"] : null,
    lastEvents: events,
  };
}

function buildDerivedSection(input: {
  gameState: unknown;
  lobby: LobbyStateSection | null;
  room: RoomStateSection | null;
  player: PlayerStateSection | null;
}): DerivedStateSection {
  const { lobby, room, player } = input;

  // ── pricePerColor ────────────────────────────────────────────────────────
  // entryFee × priceMultiplier per ticketType-navn.
  let pricePerColor: Record<string, number> | { __empty: true } = { __empty: true };
  if (room && room.ticketTypes.length > 0 && room.entryFee > 0) {
    const map: Record<string, number> = {};
    for (const t of room.ticketTypes) {
      const key = t.name || t.type;
      if (key) {
        map[key] = room.entryFee * t.priceMultiplier;
      }
    }
    if (Object.keys(map).length > 0) {
      pricePerColor = map;
    }
  }

  // ── autoMultiplikatorApplied ────────────────────────────────────────────
  let autoMultiplikatorApplied = false;
  if (room) {
    for (const t of room.ticketTypes) {
      if (t.priceMultiplier !== 1) {
        autoMultiplikatorApplied = true;
        break;
      }
    }
  }

  // ── innsatsVsForhandskjop ───────────────────────────────────────────────
  const activeStakeKr = player?.myStake ?? 0;
  const pendingStakeKr = player?.myPendingStake ?? 0;
  let classification: DerivedStateSection["innsatsVsForhandskjop"]["classification"];
  if (activeStakeKr > 0 && pendingStakeKr > 0) classification = "both";
  else if (activeStakeKr > 0) classification = "active";
  else if (pendingStakeKr > 0) classification = "pre-round";
  else classification = "none";

  // ── pricingSourcesComparison ────────────────────────────────────────────
  const roomEntryFeeKr = room?.entryFee ?? null;
  const roomTicketTypesNames = room ? room.ticketTypes.map((t) => t.name) : [];
  const lobbyTicketPricesKr = centsToKr(lobby?.ticketPricesCents ?? null);
  const nextGameTicketPricesKr = centsToKr(
    lobby?.nextGame?.ticketPricesCents ?? null,
  );

  // Consistency-sjekk: hvis vi har flere kilder, sammenlign totalsum.
  let consistency: DerivedStateSection["pricingSourcesComparison"]["consistency"] =
    "insufficient-data";
  const allSums: number[] = [];
  if (
    pricePerColor !== null &&
    typeof pricePerColor === "object" &&
    !("__empty" in pricePerColor)
  ) {
    const map = pricePerColor as Record<string, number>;
    allSums.push(
      Object.values(map).reduce((acc, v) => acc + v, 0),
    );
  }
  if (lobbyTicketPricesKr) {
    allSums.push(
      Object.values(lobbyTicketPricesKr).reduce((acc, v) => acc + v, 0),
    );
  }
  if (nextGameTicketPricesKr) {
    allSums.push(
      Object.values(nextGameTicketPricesKr).reduce((acc, v) => acc + v, 0),
    );
  }
  if (allSums.length >= 2) {
    const first = allSums[0]!;
    const allEqual = allSums.every((s) => Math.abs(s - first) < 0.01);
    consistency = allEqual ? "consistent" : "divergent";
  }

  return {
    pricePerColor,
    autoMultiplikatorApplied,
    innsatsVsForhandskjop: {
      activeStakeKr,
      pendingStakeKr,
      summedKr: activeStakeKr + pendingStakeKr,
      classification,
    },
    pricingSourcesComparison: {
      roomEntryFeeKr,
      roomTicketTypesNames,
      lobbyTicketPricesKr,
      nextGameTicketPricesKr,
      consistency,
    },
  };
}

function buildEnvSection(): EnvSection {
  let href = "";
  let userAgent = "";
  let width = 0;
  let height = 0;
  try {
    if (typeof window !== "undefined") {
      href = window.location?.href ?? "";
      userAgent = window.navigator?.userAgent ?? "";
      width = window.innerWidth ?? 0;
      height = window.innerHeight ?? 0;
    }
  } catch {
    /* fail-soft */
  }
  return {
    href,
    userAgent,
    viewport: { width, height },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeGet<T>(fn?: (() => T) | null): T | null {
  if (!fn) return null;
  try {
    return fn() ?? null;
  } catch (err) {
    warn("provider feilet:", err);
    return null;
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normaliseTicketPricesCents(
  v: unknown,
): Record<string, number> | null {
  if (!v || typeof v !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = toNumber(raw);
    if (n !== null) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function centsToKr(
  v: Record<string, number> | null,
): Record<string, number> | null {
  if (!v) return null;
  const out: Record<string, number> = {};
  for (const [k, cents] of Object.entries(v)) {
    out[k] = cents / 100;
  }
  return out;
}

/**
 * Default UUID v4 generator. Forsøker crypto.randomUUID() først,
 * fallback til pseudo-random hex hvis ikke tilgjengelig.
 */
function defaultGenerateId(): string {
  try {
    if (
      typeof globalThis !== "undefined" &&
      (globalThis as any).crypto?.randomUUID
    ) {
      return (globalThis as any).crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // Fallback: 16 hex-bytes
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) {
    s += hex[Math.floor(Math.random() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) s += "-";
  }
  return s;
}

async function postToServer(
  dump: FrontendStateDump,
  input: DumpStateOptions,
): Promise<void> {
  if (typeof window === "undefined") return; // SSR / test-env
  const endpoint = input.endpoint ?? DEFAULT_DUMP_ENDPOINT;
  const token = input.token ?? resolveDefaultToken();
  const fetchImpl = input.fetchFn ?? (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchImpl) return;

  const url = `${endpoint}?token=${encodeURIComponent(token)}`;
  await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dump),
    credentials: "omit",
    // Best-effort: timeout via abort-signal hvis tilgjengelig
  });
}

/**
 * Resolve default-token. Samme strategi som RrwebRecorder /
 * EventStreamer:
 *   1. URL `?debugToken=`
 *   2. localStorage `SPILL1_DEBUG_STREAM_TOKEN`
 *   3. Default `spillorama-2026-test`
 */
function resolveDefaultToken(): string {
  try {
    if (typeof window === "undefined") return DEFAULT_DEV_TOKEN;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("debugToken")?.trim();
    if (fromQuery) return fromQuery;
    const fromLs =
      typeof window.localStorage !== "undefined"
        ? window.localStorage.getItem("SPILL1_DEBUG_STREAM_TOKEN")?.trim()
        : null;
    if (fromLs) return fromLs;
    return DEFAULT_DEV_TOKEN;
  } catch {
    return DEFAULT_DEV_TOKEN;
  }
}

function warn(...args: unknown[]): void {
  try {
    // eslint-disable-next-line no-console
    console.warn("[StateDumpTool]", ...args);
  } catch {
    /* silent */
  }
}

// ─── Test-exports ────────────────────────────────────────────────────────────

export const __TEST_ONLY__ = {
  buildLobbySection,
  buildRoomSection,
  buildPlayerSection,
  buildScreenSection,
  buildSocketSection,
  buildDerivedSection,
  buildEnvSection,
  normaliseTicketPricesCents,
  centsToKr,
  toNumber,
  resolveDefaultToken,
  DEFAULT_DUMP_ENDPOINT,
};
