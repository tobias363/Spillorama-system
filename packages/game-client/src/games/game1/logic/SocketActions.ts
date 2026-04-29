import type { GameBridge } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { ToastNotification } from "../components/ToastNotification.js";
import type { PlayScreen } from "../screens/PlayScreen.js";
import type { Phase } from "./Phase.js";

export interface SocketActionsDeps {
  readonly socket: SpilloramaSocket;
  readonly bridge: GameBridge;
  readonly getRoomCode: () => string;
  readonly getPhase: () => Phase;
  readonly getPlayScreen: () => PlayScreen | null;
  readonly toast: ToastNotification | null;
  readonly onError: (message: string) => void;
}

/**
 * Ett ansvar: alle socket-kall som initieres av spiller-handlinger. Ingen
 * UI-rendering her — UI-tilbakemeldinger går via `toast` eller
 * `playScreen`-metoder (som er separate ansvar).
 *
 * Regulatorisk sporbarhet: alle skrive-handlinger mot backend skal være
 * definert her. En auditor kan grep-e `deps.socket.*`-kall og se full
 * liste.
 */
export class Game1SocketActions {
  constructor(private readonly deps: SocketActionsDeps) {}

  /**
   * Arm (kjøp) billetter for neste runde. Per-type-seleksjoner tillater
   * spillere å blande farger (Small Yellow + Small Purple), mens fallback-
   * `ticketCount` er beholdt for legacy single-arm-UX.
   *
   * Tobias 2026-04-29 (post-orphan-fix UX): server returnerer nå
   * `lossLimit`-info på success-acks. Partial-buy (rejected > 0) viser
   * en klar melding om hvor mange brett ble avvist og hvilken grense
   * traff. Total avvisning (LOSS_LIMIT_REACHED-error) viser
   * popup-feilmelding med tap-status og lar bruker prøve igjen.
   *
   * Bonger rendres ALDRI før server har confirmet kjøpet — popup-en er
   * i `confirming`-state mens vi venter på ack, og pre-round-bonger
   * vises kun etter server har lagt dem inn i armed-set (kommer i
   * room:update etterpå).
   */
  async buy(selections: Array<{ type: string; qty: number; name?: string }> = []): Promise<void> {
    const payload: {
      roomCode: string;
      armed: true;
      ticketCount?: number;
      ticketSelections?: Array<{ type: string; qty: number; name?: string }>;
    } = {
      roomCode: this.deps.getRoomCode(),
      armed: true,
    };
    if (selections.length > 0) {
      payload.ticketSelections = selections;
    } else {
      payload.ticketCount = 1;
    }
    const result = await this.deps.socket.armBet(payload);

    if (!result.ok) {
      // Tobias 2026-04-29 (UX-fix): server-ack feilet med klar feilkode.
      // Vis melding i popup-en og la bruker prøve igjen — ingen bonger
      // er rendret, ingen state-endringer på klient-siden.
      const message = result.error?.message || "Kunne ikke kjøpe billetter";
      this.deps.getPlayScreen()?.showBuyPopupResult(false, message);
      this.deps.onError(message);
      return;
    }

    // Tobias 2026-04-29 (UX-fix): success-ack — bygg lossState fra server-
    // returnert lossLimit-info. Brukes til å rendre tap-headeren.
    const lossLimit = result.data?.lossLimit;
    const lossStateForUi = lossLimit
      ? {
          dailyUsed: lossLimit.dailyUsed,
          dailyLimit: lossLimit.dailyLimit,
          monthlyUsed: lossLimit.monthlyUsed,
          monthlyLimit: lossLimit.monthlyLimit,
          walletBalance: lossLimit.walletBalance,
        }
      : undefined;

    // Update popup-headeren med fersk tap-status før vi viser result.
    if (lossStateForUi) {
      this.deps.getPlayScreen()?.updateBuyPopupLossState(lossStateForUi);
    }

    // Tobias 2026-04-29 (UX-fix): partial-buy — server aksepterte færre
    // brett enn forespurt pga loss-limit. Vis klar melding om hva som ble
    // kjøpt og hva som ble avvist. Popup-en auto-skjules etter 3.5 sek.
    if (lossLimit && lossLimit.rejected > 0) {
      this.deps.getPlayScreen()?.showBuyPopupPartialResult({
        accepted: lossLimit.accepted,
        rejected: lossLimit.rejected,
        rejectionReason: lossLimit.rejectionReason,
        lossState: lossStateForUi,
      });
    } else {
      // Full-buy: standard success.
      this.deps.getPlayScreen()?.showBuyPopupResult(true);
    }

    // Be lobby-shellen refetche saldo umiddelbart så chip-en reflekterer
    // reservasjonen (mirroreres tidligere oppførsel — wallet:state-push
    // dekker som sekundær path).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("spillorama:balanceRefreshRequested"));
    }
  }

  /** A6: Host/admin manual game start — calls game:start on the socket. */
  async startGame(): Promise<void> {
    const result = await this.deps.socket.startGame({ roomCode: this.deps.getRoomCode() });
    if (!result.ok) {
      this.deps.toast?.error(result.error?.message || "Kunne ikke starte spillet");
    }
  }

  /**
   * Submit en LINE- eller BINGO-claim.
   *
   * Spectator-guard: spillere uten billetter får en toast i stedet for å
   * sende et tomt claim som backend uansett avviser.
   */
  async claim(type: "LINE" | "BINGO"): Promise<void> {
    if (this.deps.getPhase() === "SPECTATING") {
      this.deps.toast?.info("Tilskuere kan ikke gjøre claims");
      return;
    }

    const result = await this.deps.socket.submitClaim({ roomCode: this.deps.getRoomCode(), type });
    if (!result.ok) {
      this.deps.toast?.error(result.error?.message ?? `Ugyldig ${type === "LINE" ? "rekke" : "bingo"}-claim`);
      this.deps.getPlayScreen()?.resetClaimButton(type);
      console.error("[Game1] Claim failed:", result.error);
    }
  }

  /** Avbestille ALLE pre-round-brett (disarm). */
  async cancelAll(): Promise<void> {
    const result = await this.deps.socket.armBet({
      roomCode: this.deps.getRoomCode(),
      armed: false,
    });
    if (result.ok) {
      this.deps.toast?.info("Bonger avbestilt");
      const screen = this.deps.getPlayScreen();
      if (screen) {
        screen.reset();
        screen.update(this.deps.bridge.getState());
      }
      // Tobias 2026-04-26: refund ble registrert; be lobby refetche saldo umiddelbart.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("spillorama:balanceRefreshRequested"));
      }
    } else {
      this.deps.toast?.error(result.error?.message || "Kunne ikke avbestille");
    }
  }

  /**
   * BIN-692: per-brett × avbestill. Backend fjerner hele bundelen
   * (Large = 3, Elvis = 2, Traffic = 3) atomisk. UI-refresh kommer via
   * påfølgende room:update.
   *
   * Klientens RUNNING-guard er defence-in-depth — ×-knappen skal ikke
   * vises under PLAYING/SPECTATING, og backend-guarden kaster
   * `GAME_RUNNING` uansett.
   */
  async cancelTicket(ticketId: string): Promise<void> {
    const state = this.deps.bridge.getState();
    if (state.gameStatus === "RUNNING") {
      this.deps.toast?.info("Kan ikke avbestille mens runden pågår.");
      return;
    }
    const result = await this.deps.socket.cancelTicket({
      roomCode: this.deps.getRoomCode(),
      ticketId,
    });
    if (result.ok) {
      this.deps.toast?.info(
        result.data?.fullyDisarmed
          ? "Alle brett avbestilt"
          : `Brett avbestilt (${result.data?.removedTicketIds.length ?? 1})`,
      );
      // Tobias 2026-04-26: per-brett refund — be lobby refetche saldo umiddelbart.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("spillorama:balanceRefreshRequested"));
      }
    } else {
      this.deps.toast?.error(result.error?.message || "Kunne ikke avbestille brett");
    }
  }

  /**
   * Sett lucky-number for gjeldende runde. UI oppdateres automatisk via neste
   * `room:update` — ingen lokal mutasjon her.
   */
  async setLuckyNumber(n: number): Promise<void> {
    const result = await this.deps.socket.setLuckyNumber({
      roomCode: this.deps.getRoomCode(),
      luckyNumber: n,
    });
    if (!result.ok) {
      console.error("[Game1] setLuckyNumber failed:", result.error);
    }
  }

  /**
   * BIN-419 Elvis-variant: spillere kan bytte ut alle sine brett mot en
   * fee. Implementert som disarm → arm-ny-runde.
   */
  async elvisReplace(): Promise<void> {
    const roomCode = this.deps.getRoomCode();
    await this.deps.socket.armBet({ roomCode, armed: false });
    const result = await this.deps.socket.armBet({ roomCode, armed: true });
    if (result.ok) {
      this.deps.toast?.info("Bonger byttet!");
      const screen = this.deps.getPlayScreen();
      if (screen) {
        screen.reset();
        screen.update(this.deps.bridge.getState());
      }
    } else {
      this.deps.toast?.error("Kunne ikke bytte bonger");
    }
  }
}
