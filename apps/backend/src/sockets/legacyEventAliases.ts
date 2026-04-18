import type { Socket } from "socket.io";

/**
 * BIN-585: Unity fallback-klient (client_variant="unity-fallback" per BIN-540)
 * sender legacy event-navn som `SwapTicket`, `Game2BuyBlindTickets` osv.
 * Denne fila aliaser legacy-navn → kanonisk nytt event-navn på socket-nivå
 * ved å re-dispatche til allerede-registrerte handlers via
 * `socket.listeners(canonical)`.
 *
 * Kontrakten:
 * - Alias registreres ETTER canonical-handleren — se wiring i
 *   `apps/backend/src/index.ts` og `__tests__/testServer.ts`.
 * - Klienten sender NY payload-form (`roomCode`, `ticketId` osv.). Mappet fra
 *   legacy-feltnavn (`gameId` → `roomCode`) er Unity-bridge sitt ansvar; vi
 *   gjør ikke payload-transform her. Se SOCKET_EVENT_MATRIX.md.
 * - Fjernes når Unity slås av permanent.
 */
const LEGACY_EVENT_ALIASES: Record<string, string> = {
  // BIN-585 PR A — Game 5 pre-round free swap.
  SwapTicket: "ticket:swap",

  // BIN-585 PR B — events konseptuelt dekket av eksisterende kanoniske
  // handlers. Ingen ny server-kode; bare navnebro for Unity fallback-klient.
  //
  // Game2BuyBlindTickets: "blind" ticket purchase = server plukker
  // tilfeldige billetter fra pool. `bet:arm` uten `ticketSelections` gir
  // akkurat samme semantikk (server genererer `ticketCount` billetter).
  // Legacy ref: legacy/unity-backend/Game/Game2/Controllers/GameController.js:528
  Game2BuyBlindTickets: "bet:arm",

  // SelectWofAuto: Game 5 Wheel of Fortune auto-spin (server plukker segment
  // via tilfeldig distribusjon). `minigame:play` kaller
  // `engine.playMiniGame` som alltid velger segment server-autoritativt;
  // `selectedIndex`-parameteret er kosmetisk (ignorert for wheel/mystery/
  // colorDraft — bare treasureChest leser det som ren UI-hint).
  // Legacy ref: legacy/unity-backend/Game/Game5/Controllers/GameProcess.js:894
  SelectWofAuto: "minigame:play",

  // SelectRouletteAuto: Game 5 multi-spin roulette (kalles N ganger etter
  // WoF awarder N spinn). `jackpot:spin` har samme multi-spin-state-
  // tracking: playedSpins/totalSpins/isComplete/spinHistory, og avviser
  // dobbel-spinn via state i stedet for client-claimed `spinCount`
  // (hardere anti-replay). Legacy: GameProcess.js:1137
  SelectRouletteAuto: "jackpot:spin",

  // BIN-585 PR D — hall-operator events (nye handlers i ny backend).
  //
  // getHallBalance: legacy leste shift/agent-tabeller (ikke portert,
  // hører til BIN-583 agent-domene) og returnerte daily/cashIn/cashOut
  // breakdown. Ny `admin:hall-balance` returnerer walletAdapter
  // house-account saldo per (gameType, channel) — tilsvarer "hallens
  // penger holdt av system" uten agent-terminal-state.
  // Legacy: legacy/unity-backend/Game/AdminEvents/AdminController/AdminController.js:116
  getHallBalance: "admin:hall-balance",

  // ScreenSaver: hall-display idle-config. Legacy returnerte globale
  // Sys.Setting-feltene {screenSaver, screenSaverTime, imageTime}. Ny
  // `admin-display:screensaver` returnerer samme form, men config kommer
  // fra env (HALL_SCREENSAVER_* i envConfig.ts) med pilot-defaults.
  // Legacy: legacy/unity-backend/Game/Common/Sockets/common.js:549
  ScreenSaver: "admin-display:screensaver",
};

export function registerLegacyEventAliases(socket: Socket): void {
  for (const [legacyName, canonicalName] of Object.entries(LEGACY_EVENT_ALIASES)) {
    socket.on(legacyName, (...args: unknown[]) => {
      const listeners = socket.listeners(canonicalName);
      if (listeners.length === 0) {
        const callback = args[args.length - 1];
        if (typeof callback === "function") {
          (callback as (r: unknown) => void)({
            ok: false,
            error: { code: "ALIAS_NOT_WIRED", message: `Legacy alias "${legacyName}" has no canonical handler "${canonicalName}" registered.` },
          });
        }
        return;
      }
      for (const listener of listeners) {
        (listener as (...a: unknown[]) => void)(...args);
      }
    });
  }
}

/** Exported for tests. */
export const LEGACY_EVENT_ALIAS_MAP: Readonly<Record<string, string>> = LEGACY_EVENT_ALIASES;
