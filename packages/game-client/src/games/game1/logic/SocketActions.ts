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
  readonly getScheduledPurchaseContext?: () => {
    scheduledGameId: string | null;
    hallId: string;
    overallStatus: string | null;
    ticketConfig: {
      entryFee: number;
      ticketTypes: Array<{ name: string; type: string; priceMultiplier: number; ticketCount: number }>;
    } | null;
  };
  readonly getPlayScreen: () => PlayScreen | null;
  readonly toast: ToastNotification | null;
  readonly onError: (message: string) => void;
}

interface ScheduledTicketSpecEntry {
  color: string;
  size: "small" | "large";
  count: number;
  priceCentsEach: number;
}

function getAccessToken(): string {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem("spillorama.accessToken") || "";
}

function getCurrentUserId(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  for (const key of ["spillorama.user", "spillorama.dev.user"]) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) || "null") as { id?: unknown } | null;
      if (typeof parsed?.id === "string" && parsed.id.trim()) return parsed.id.trim();
    } catch {
      // ignore malformed session storage
    }
  }
  return null;
}

function makeClientIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web-game1-${crypto.randomUUID()}`;
  }
  return `web-game1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function colorFromTicketName(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("white")) return "white";
  if (n.includes("yellow")) return "yellow";
  if (n.includes("purple")) return "purple";
  if (n.includes("red")) return "red";
  if (n.includes("green")) return "green";
  if (n.includes("orange")) return "orange";
  return null;
}

function sizeFromSelection(selection: { type: string; name?: string }): "small" | "large" {
  const raw = `${selection.type} ${selection.name ?? ""}`.toLowerCase();
  return raw.includes("large") ? "large" : "small";
}

function buildScheduledTicketSpec(
  selections: Array<{ type: string; qty: number; name?: string }>,
  ticketTypes: Array<{ name: string; type: string; priceMultiplier: number; ticketCount: number }>,
  entryFee: number,
): ScheduledTicketSpecEntry[] {
  const specByKey = new Map<string, ScheduledTicketSpecEntry>();
  const effectiveSelections = selections.length > 0
    ? selections
    : [{ type: "small", qty: 1, name: "Small White" }];
  for (const selection of effectiveSelections) {
    const qty = Math.max(1, Math.round(selection.qty));
    const ticketType =
      (selection.name ? ticketTypes.find((t) => t.name === selection.name) : undefined) ??
      ticketTypes.find((t) => t.type === selection.type);
    const name = selection.name ?? ticketType?.name ?? selection.type;
    const color = colorFromTicketName(name);
    if (!color) {
      throw new Error(`Ukjent bongfarge for ${name}.`);
    }
    const size = sizeFromSelection(selection);
    // Tobias-bug 2026-05-13 (autonomous-pilot-test-loop): bruk
    // `priceMultiplier` direkte fra ticketTypes-tabellen, IKKE prøv å
    // utlede small × 2 for large. Backend (`GamePlanEngineBridge.ts`)
    // setter LARGE_TICKET_PRICE_MULTIPLIER = 3 (1 stor bong = 3 brett),
    // og tabellen som sendes til klient inneholder denne verdien:
    //   Small White:  priceMultiplier 1
    //   Large White:  priceMultiplier 3
    //   Small Yellow: priceMultiplier 2
    //   Large Yellow: priceMultiplier 6
    //   Small Purple: priceMultiplier 3
    //   Large Purple: priceMultiplier 9
    // Tidligere kode multipliserte small-bongens multiplikator med 2 for
    // large → ga Large White = ×2 i stedet for ×3, og buy-API avviste med
    // `INVALID_TICKET_SPEC` (server forventer 1500 øre).
    const fallbackMultiplier =
      ticketType?.priceMultiplier ?? 1;
    const multiplier = ticketType?.priceMultiplier ?? fallbackMultiplier;
    const priceCentsEach = Math.round(entryFee * multiplier * 100);
    const key = `${color}:${size}:${priceCentsEach}`;
    const existing = specByKey.get(key);
    if (existing) {
      existing.count += qty;
    } else {
      specByKey.set(key, { color, size, count: qty, priceCentsEach });
    }
  }
  return [...specByKey.values()];
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
    const scheduledContext = this.deps.getScheduledPurchaseContext?.() ?? null;

    // [BUY-DEBUG] Tobias-direktiv 2026-05-13: detaljert trace av hele kjøps-
    // flyten. Logger til konsoll (synlig ved ?debug=1) + EventTracker (ring-
    // buffer som kan dump-es via debug-HUD). Hjelper Tobias og PM å se
    // hvor pris/farge-display divergerer fra server's faktiske kjøps-
    // validering.
    const buyDebugEnabled =
      typeof window !== "undefined" &&
      typeof window.location !== "undefined" &&
      /[?&]debug=1/.test(window.location.search);
    const buyCorrelationId = `buy-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    if (buyDebugEnabled) {
      // eslint-disable-next-line no-console
      console.log("[BUY-DEBUG][client][SocketActions.buy][entry]", {
        correlationId: buyCorrelationId,
        selections,
        usingScheduledPath: !!(
          scheduledContext?.scheduledGameId &&
          scheduledContext.ticketConfig &&
          (scheduledContext.overallStatus === "purchase_open" ||
            scheduledContext.overallStatus === "ready_to_start")
        ),
        scheduledContext: scheduledContext
          ? {
              scheduledGameId: scheduledContext.scheduledGameId,
              hallId: scheduledContext.hallId,
              overallStatus: scheduledContext.overallStatus,
              hasTicketConfig: !!scheduledContext.ticketConfig,
              entryFee: scheduledContext.ticketConfig?.entryFee,
              ticketTypes: scheduledContext.ticketConfig?.ticketTypes,
            }
          : null,
      });
    }

    if (
      scheduledContext?.scheduledGameId &&
      scheduledContext.ticketConfig &&
      (scheduledContext.overallStatus === "purchase_open" ||
        scheduledContext.overallStatus === "ready_to_start")
    ) {
      try {
        const buyerUserId = getCurrentUserId();
        const accessToken = getAccessToken();
        if (!buyerUserId || !accessToken) {
          throw new Error("Mangler innlogget spiller for bongkjøp.");
        }
        const ticketSpec = buildScheduledTicketSpec(
          selections,
          scheduledContext.ticketConfig.ticketTypes,
          scheduledContext.ticketConfig.entryFee,
        );

        if (buyDebugEnabled) {
          // eslint-disable-next-line no-console
          console.log("[BUY-DEBUG][client][SocketActions.buy][REST-spec]", {
            correlationId: buyCorrelationId,
            buyerUserId,
            hallId: scheduledContext.hallId,
            scheduledGameId: scheduledContext.scheduledGameId,
            ticketSpec,
            ticketSpecTotalCents: ticketSpec.reduce(
              (sum, e) => sum + e.count * e.priceCentsEach,
              0,
            ),
            entryFeeFromConfig: scheduledContext.ticketConfig.entryFee,
          });
        }

        const response = await fetch("/api/game1/purchase", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            scheduledGameId: scheduledContext.scheduledGameId,
            buyerUserId,
            hallId: scheduledContext.hallId,
            paymentMethod: "digital_wallet",
            idempotencyKey: makeClientIdempotencyKey(),
            ticketSpec,
          }),
        });
        const body = await response.json().catch(() => null) as {
          ok?: boolean;
          error?: { message?: string };
        } | null;
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.error?.message || "Kunne ikke kjøpe billetter");
        }
        const roomCode = this.deps.getRoomCode();
        if (roomCode) {
          const state = await this.deps.socket.getRoomState({
            roomCode,
            hallId: scheduledContext.hallId,
            scheduledGameId: scheduledContext.scheduledGameId,
          });
          if (state.ok && state.data?.snapshot) {
            this.deps.bridge.applySnapshot(state.data.snapshot);
          } else {
            console.warn("[Game1SocketActions] room:state etter scheduled purchase feilet", state);
          }
        }
        this.deps.getPlayScreen()?.showBuyPopupResult(true);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("spillorama:balanceRefreshRequested"));
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kunne ikke kjøpe billetter";
        this.deps.getPlayScreen()?.showBuyPopupResult(false, message);
        this.deps.onError(message);
        return;
      }
    }

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

    if (buyDebugEnabled) {
      // eslint-disable-next-line no-console
      console.log("[BUY-DEBUG][client][SocketActions.buy][bet:arm-payload]", {
        correlationId: buyCorrelationId,
        payload,
        selectionCount: selections.length,
        totalQty: selections.reduce((sum, s) => sum + s.qty, 0),
      });
    }

    const result = await this.deps.socket.armBet(payload);

    if (buyDebugEnabled) {
      // Best-effort: hent ticket-count fra snapshot.preRoundTickets hvis det
      // finnes — typing-en på RoomSnapshot er ikke ekspandert med dette
      // feltet, så vi caster via unknown for å lese.
      const snapshotAsRecord = result.ok
        ? (result.data?.snapshot as unknown as
            | { preRoundTickets?: Record<string, unknown[]> }
            | null
            | undefined)
        : null;
      const preRoundMap = snapshotAsRecord?.preRoundTickets ?? {};
      const snapshotTicketCount = Object.keys(preRoundMap).reduce(
        (sum, pid) => {
          const arr = preRoundMap[pid];
          return sum + (Array.isArray(arr) ? arr.length : 0);
        },
        0,
      );
      // eslint-disable-next-line no-console
      console.log("[BUY-DEBUG][client][SocketActions.buy][bet:arm-ack]", {
        correlationId: buyCorrelationId,
        ok: result.ok,
        errorCode: !result.ok ? result.error?.code : null,
        errorMessage: !result.ok ? result.error?.message : null,
        lossLimit: result.ok ? result.data?.lossLimit : null,
        snapshotTicketCount: result.ok ? snapshotTicketCount : null,
      });
    }

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
   *
   * Bølge G (2026-05-05): metoden beholdes for kontrakt-kompatibilitet
   * (controller-wiring + tester), men den fyres ikke lenger av PlayScreen
   * — server-side auto-claim-on-draw (BIN-689) eier flyten. Tidligere
   * `playScreen.resetClaimButton(type)`-kall på NACK er fjernet siden
   * knappene ikke lenger eksisterer i game1/game3-PlayScreen.
   */
  async claim(type: "LINE" | "BINGO"): Promise<void> {
    if (this.deps.getPhase() === "SPECTATING") {
      this.deps.toast?.info("Tilskuere kan ikke gjøre claims");
      return;
    }

    const result = await this.deps.socket.submitClaim({ roomCode: this.deps.getRoomCode(), type });
    if (!result.ok) {
      this.deps.toast?.error(result.error?.message ?? `Ugyldig ${type === "LINE" ? "rekke" : "bingo"}-claim`);
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
