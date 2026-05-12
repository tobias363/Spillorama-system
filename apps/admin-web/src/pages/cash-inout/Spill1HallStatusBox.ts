/**
 * 2026-05-02 (Tobias UX-feedback): Spill 1 hall-status + handlinger inline
 * i cash-inout-dashboardet (Box 3 — "kommende spill"). Erstatter
 * "Ingen kommende spill"-placeholderen når det finnes en aktiv runde:
 *
 *  - Alle deltakende haller i runden vises som status-pillen
 *    grønn (Klar) / oransje (Ikke klar) / rød (Ingen kunder/ekskludert).
 *  - For agentens EGEN hall vises 2 knapper:
 *      • "Marker hall som Klar" / "Angre Klar"
 *      • "Ingen kunder" / "Har kunder igjen" (rød/grå)
 *  - Master-hall får i tillegg "Start Spill 1" + "Stopp Spill 1"-
 *    knapper i samme grid-stil som kontant-inn-/ut-knappene over.
 *
 * Polling: 2s tick mot `/api/agent/game1/lobby` (Bølge 3). Stoppes på
 * unmount via AbortSignal — caller passer inn signalet fra
 * activePageAbort i CashInOutPage slik at samme cleanup-flyt brukes.
 *
 * 2026-05-08 (Tobias-feedback, branch feat/spill1-hall-status-multi-hall):
 * Splittet hall-listen i to seksjoner — "Min hall" og "Andre haller i
 * gruppen" — slik at master ser ready-state for alle GoH-medlemmer.
 * Master-hall får 👑-merke; ticket-tellinger (digitale + fysiske) vises
 * pr hall.
 *
 * 2026-05-08 (Bølge 3): refaktorert til ny `fetchLobbyState` + master-
 * action-routes. Dual-fetch + adapter + wrapper er fjernet — `currentGame.id`
 * er nå alltid `lobby.currentScheduledGameId` (single id-rom). Pause/start/
 * resume bruker `pauseMaster`/`startMaster`/`resumeMaster`.
 */

import {
  fetchLobbyState,
  startMaster,
  resumeMaster,
  pauseMaster,
  recoverStale,
  sendMasterHeartbeat,
  markHallReadyForGame,
  unmarkHallReadyForGame,
  setHallNoCustomersForGame,
  setHallHasCustomersForGame,
} from "../../api/agent-game1.js";
import { fetchAgentGamePlanCurrent } from "../../api/agent-game-plan.js";
import type { AgentGamePlanItem } from "../../api/agent-game-plan.js";
import type {
  Spill1AgentLobbyState,
  Spill1HallReadyStatus,
  Spill1LobbyInconsistencyCode,
} from "../../../../../packages/shared-types/src/spill1-lobby-state.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { openJackpotSetupModal } from "../agent-portal/JackpotSetupModal.js";
import { escapeHtml } from "./shared.js";

/**
 * 2026-05-09 (recover-stale): warning-koder som krever master-handling
 * for å rydde opp. Når aggregator returnerer en av disse er master
 * blokkert fra alle write-actions — recover-stale-knappen er eneste
 * måte å unblokke uten `psql`-tilgang.
 */
const RECOVERABLE_WARNING_CODES: ReadonlySet<Spill1LobbyInconsistencyCode> =
  new Set(["STALE_PLAN_RUN", "BRIDGE_FAILED"]);

const POLL_INTERVAL_MS = 2_000;

/**
 * ADR-0022 Lag 4: master-heartbeat-intervall. Sender én POST hvert 30s
 * mot `/api/agent/game1/master/heartbeat` så lenge master har cash-inout-
 * UI-en åpen. Backend Game1AutoResumePausedService krever fersh heartbeat
 * (<90s) for å regne master som "aktiv" og IKKE auto-resume.
 */
const MASTER_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * ADR-0022 Lag 3: terskel før vi viser advarsel-banner. Engine auto-pauser
 * umiddelbart etter phase-won, men UI skal ikke spamme bannere for de
 * første sekundene. 30s er nok tid til at master rekker å klikke Fortsett
 * uten å se banner.
 */
const PAUSE_BANNER_SOFT_THRESHOLD_MS = 30_000;

/**
 * ADR-0022 Lag 3: terskel før vi viser warning-banner med countdown til
 * auto-resume. Settes mindre enn auto_resume_eligible_at-vinduet så
 * master ser advarselen før Lag 1-cron fyrer.
 */
const PAUSE_BANNER_WARNING_THRESHOLD_MS = 45_000;

/**
 * Bølge 3 (2026-05-08): refaktor til ren `Spill1AgentLobbyState`.
 *
 * Vi mapper aggregator-staten til en intern view-shape før render. Dette
 * holder render-logikken under uendret samtidig som datakilden kollapses
 * til ÉN endpoint (`/api/agent/game1/lobby`). Forrige løsning fetch'et
 * plan-API + legacy-API parallelt og merget felt-for-felt — Bølge 1
 * aggregator gjør jobben sentralt og UI ser ferdig konsistent state.
 */
interface ViewState {
  /** Speiles av `lobby.hallId`. */
  ownHallId: string;
  /** Kun `true` hvis caller er master for runden. */
  isMasterAgent: boolean;
  /** `null` betyr ingen aktiv runde — UI viser tom-state med hall-pills. */
  scheduledGameId: string | null;
  scheduledGameStatus: string | null;
  scheduledStartTime: string | null;
  /** Display-navn for nåværende plan-item (bingo / jackpot / oddsen-55 …). */
  catalogDisplayName: string | null;
  masterHallId: string | null;
  halls: Spill1HallReadyStatus[];
  allReady: boolean;
  /** Aggregator warnings used for targeted master recovery affordances. */
  warningCodes: Spill1LobbyInconsistencyCode[];
  // ADR-0022 Lag 3: stuck-recovery banner-state.
  /** ISO-timestamp for når engine sist auto-pauset (proxy: last_drawn_at). */
  pauseStartedAt: string | null;
  /** ISO-timestamp for når Game1AutoResumePausedService vil auto-fortsette. */
  autoResumeEligibleAt: string | null;
  /** ISO-timestamp for når Game1StuckGameDetectionService vil auto-avbryte. */
  stuckAutoEndAt: string | null;
  // ADR-0022 Lag 4: master-heartbeat-state.
  /** ISO-timestamp for sist heartbeat. Null hvis aldri sendt. */
  masterLastSeenAt: string | null;
  /** Computed server-side: true hvis heartbeat innenfor terskel. */
  masterIsActive: boolean;
}

interface BoxState {
  loaded: boolean;
  data: ViewState | null;
  busy: boolean;
  errorMessage: string | null;
  /**
   * Code-review-fix 2026-05-08 (PR #1075 review #1): warning-banner
   * istedenfor Toast.warning i polling-loopen.
   *
   * Tidligere kalte vi `Toast.warning(messages)` ved hver 2s-refresh hvis
   * `inconsistencyWarnings` ikke var tom. Toast er ikke idempotent (hver
   * kall lager ny DOM-boks med 4s timeout, jf. Toast.ts), så polling 2s ×
   * 4s timeout gir 2-3 stacked toasts permanent ved vedvarende warning
   * (f.eks. BRIDGE_FAILED som ikke fikses raskt). Resultatet er en
   * voksende stack av kopier i hjørnet av skjermen.
   *
   * Fix: deklarativ state — vi setter banneret ved hver refresh, og
   * render-funksjonen viser ÉN inline `<div class="alert alert-warning">`
   * over hall-pillene. Banneret forsvinner automatisk når warnings
   * cleares fra backend. User-action-feil bruker fortsatt `Toast.error`
   * (i `onClick`-handler), så transient feedback er bevart.
   */
  warningBanner: string | null;
  /**
   * 2026-05-09 (recover-stale): true når lobby-state har minst én
   * STALE_PLAN_RUN eller BRIDGE_FAILED warning. Når true viser
   * render-funksjonen en "🧹 Rydde stale plan-state"-knapp under
   * warning-banneret. Master kan da kalle cleanup-endpointet uten
   * å trenge psql-tilgang.
   */
  showRecoverButton: boolean;
}

let activeMount: { container: HTMLElement; signal: AbortSignal; cleanup: () => void } | null = null;

export function mountSpill1HallStatusBox(
  container: HTMLElement,
  signal: AbortSignal
): void {
  // Bug-fix 2026-05-02 (Tobias): router gjenbruker samme container-DOM-node
  // mellom navigasjoner, så vi MÅ skille på AbortSignal-identitet, ikke
  // container-identitet. Tidligere ga "samme container" no-op selv etter
  // at gammel signal var aborted — polling startet ikke på nytt og siden
  // viste evig "Henter Spill 1-status…" / "Ingen kommende spill".
  if (activeMount && activeMount.signal === signal && !signal.aborted) {
    return;
  }
  if (activeMount) {
    activeMount.cleanup();
    activeMount = null;
  }

  const state: BoxState = {
    loaded: false,
    data: null,
    busy: false,
    errorMessage: null,
    warningBanner: null,
    showRecoverButton: false,
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  // ADR-0022 Lag 4: master:heartbeat-timer. Sender POST hvert 30s mot
  // /api/agent/game1/master/heartbeat så lenge UI-en er åpen på master.
  // Backend bruker dette til å skille "master aktiv" fra "master borte →
  // auto-resume safe" i Game1AutoResumePausedService.
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let aborted = false;

  const cleanup = (): void => {
    aborted = true;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    // Bug-fix 2026-05-02: nullstill activeMount så neste mount-kall i samme
    // container ikke no-op-er på stale referanse.
    if (activeMount && activeMount.signal === signal) {
      activeMount = null;
    }
  };

  signal.addEventListener("abort", cleanup, { once: true });

  // Initial render with skeleton, then async fetch.
  render(container, state);
  void refresh();

  pollTimer = setInterval(() => {
    if (aborted) return;
    if (state.busy) return;
    void refresh();
  }, POLL_INTERVAL_MS);

  // ADR-0022 Lag 4: master:heartbeat-timer. Sender en POST hvert 30s mot
  // backend så Game1AutoResumePausedService kan skille "master aktiv" fra
  // "master borte". Vi sender første heartbeat umiddelbart slik at
  // backend ser pingen før første auto-resume-tick rekker å fyre.
  void sendHeartbeatIfActive();
  heartbeatTimer = setInterval(() => {
    if (aborted) return;
    void sendHeartbeatIfActive();
  }, MASTER_HEARTBEAT_INTERVAL_MS);

  async function sendHeartbeatIfActive(): Promise<void> {
    // Send kun heartbeat hvis caller er master-agent og vi har en hall-
    // kontekst. Backend tar uansett ikke skade av å motta heartbeat fra
    // ikke-master, men sparer noen DB-UPDATE-er.
    const data = state.data;
    if (!data) return;
    if (!data.isMasterAgent) return;
    if (!data.ownHallId) return;
    try {
      await sendMasterHeartbeat(data.ownHallId);
    } catch {
      // Fail-soft: sendMasterHeartbeat-funksjonen returnerer allerede en
      // neutral response ved nettverksfeil — denne try/catch er bare
      // forsikring for uventede sync-throws.
    }
  }

  container.addEventListener(
    "click",
    onClick,
    signal.aborted ? undefined : { signal }
  );

  async function refresh(): Promise<void> {
    try {
      // Bølge 3 (2026-05-08): ÉN kall, ÉN id-rom. Aggregator merger
      // plan-API + legacy-API server-side og returnerer ferdig konsistent
      // state. UI ser kun `currentScheduledGameId` (eller `null`) — ingen
      // alias-id-er, ingen merge-logikk her.
      const lobby = await fetchLobbyState(undefined, { signal });
      if (aborted) return;
      const view = mapLobbyToView(lobby);
      // 2026-05-09 (Tobias debug-fix): konsoll-logg så master kan
      // verifisere kobling i F12-console. Logger kun ved ENDRING av
      // scheduledGameId/status/warnings — ellers ville polling spamme
      // konsollet hvert 2. sek. Bruker JSON-serialisert sammenligning
      // for å oppdage shape-endringer på warnings.
      const prevSig =
        state.data === null
          ? null
          : `${state.data.scheduledGameId}|${state.data.scheduledGameStatus}|${state.warningBanner ?? ""}`;
      const nextSig = `${view.scheduledGameId}|${view.scheduledGameStatus}|${
        lobby.inconsistencyWarnings.map((w) => w.code).join(",")
      }`;
      if (prevSig !== nextSig) {
        // eslint-disable-next-line no-console
        console.log("[spill1-lobby] state-change", {
          hallId: lobby.hallId,
          isMasterAgent: lobby.isMasterAgent,
          masterHallId: lobby.masterHallId,
          groupOfHallsId: lobby.groupOfHallsId,
          currentScheduledGameId: lobby.currentScheduledGameId,
          scheduledGameStatus: lobby.scheduledGameMeta?.status ?? null,
          planRunStatus: lobby.planMeta?.planRunStatus ?? null,
          catalogDisplayName: lobby.planMeta?.catalogDisplayName ?? null,
          hallsCount: lobby.halls.length,
          hallIds: lobby.halls.map((h) => h.hallId),
          warnings: lobby.inconsistencyWarnings,
          generatedAt: lobby.generatedAt,
        });
      }
      state.loaded = true;
      state.data = view;
      state.errorMessage = null;

      // Aggregator kan flagge informative inconsistencies. Vi viser dem
      // som non-blocking warning-banner over hall-pillene slik at master
      // kan refreshe / kontakte support hvis warning-en peker på en ekte
      // race (f.eks. plan-run sier running men scheduled-game er
      // cancelled).
      //
      // Code-review-fix 2026-05-08 (PR #1075 review #1): tidligere kalte
      // vi `Toast.warning(messages)` her ved hver refresh. Toast er IKKE
      // idempotent — hver kall lager ny DOM-boks med 4s timeout. Ved 2s
      // polling × 4s timeout fikk vi 2-3 stacked toasts permanent ved
      // vedvarende warning. Nå er banneret deklarativt: state.warningBanner
      // settes per refresh, og render() viser ÉN inline alert. Forsvinner
      // når warnings cleares.
      if (lobby.inconsistencyWarnings.length > 0) {
        state.warningBanner = lobby.inconsistencyWarnings
          .map((w) => `${w.code}: ${w.message}`)
          .join(" · ");
        // 2026-05-09 (recover-stale): show the cleanup button only when
        // at least one warning is recoverable via master-action. Other
        // warnings (PLAN_SCHED_STATUS_MISMATCH, MISSING_GOH_MEMBERSHIP,
        // DUAL_SCHEDULED_GAMES) need different handling and should not
        // tempt master to click the wrong button.
        state.showRecoverButton = lobby.inconsistencyWarnings.some((w) =>
          RECOVERABLE_WARNING_CODES.has(w.code),
        );
      } else {
        state.warningBanner = null;
        state.showRecoverButton = false;
      }

      render(container, state);
    } catch (err) {
      if (aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Ukjent feil";
      state.loaded = true;
      state.errorMessage = message;
      render(container, state);
    }
  }

  /**
   * Bølge 3: oversett `Spill1AgentLobbyState` til lokal view-shape som
   * render-funksjonene under konsumerer. Mapping er én-til-én — vi
   * renamer felter for å holde renderfilen kompakt og leselig.
   *
   * `ownHallId` faller tilbake til `""` for ADMIN uten hall-context (empty-
   * state) — render-funksjonene returnerer "Ingen kommende spill" placeholder
   * i den situasjonen.
   */
  function mapLobbyToView(lobby: Spill1AgentLobbyState): ViewState {
    return {
      ownHallId: lobby.hallId ?? "",
      isMasterAgent: lobby.isMasterAgent,
      scheduledGameId: lobby.currentScheduledGameId,
      scheduledGameStatus: lobby.scheduledGameMeta?.status ?? null,
      scheduledStartTime: lobby.scheduledGameMeta?.scheduledStartTime ?? null,
      catalogDisplayName: lobby.planMeta?.catalogDisplayName ?? null,
      masterHallId: lobby.masterHallId,
      halls: lobby.halls,
      allReady: lobby.allHallsReady,
      warningCodes: lobby.inconsistencyWarnings.map((w) => w.code),
      // ADR-0022 Lag 3: stuck-recovery banner-felter (optional på wire,
      // null hvis aggregator-versjonen ikke fyller dem ennå).
      pauseStartedAt: lobby.scheduledGameMeta?.pauseStartedAt ?? null,
      autoResumeEligibleAt:
        lobby.scheduledGameMeta?.autoResumeEligibleAt ?? null,
      stuckAutoEndAt: lobby.scheduledGameMeta?.stuckAutoEndAt ?? null,
      // ADR-0022 Lag 4: master-heartbeat-state.
      masterLastSeenAt: lobby.masterLastSeenAt ?? null,
      masterIsActive: lobby.masterIsActive ?? false,
    };
  }

  async function onClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLElement>("[data-spill1-action]");
    if (!button) return;
    const action = button.dataset.spill1Action;
    if (!action) return;
    if (state.busy) return;
    const data = state.data;
    if (!data) return;
    // Bølge 3: `gameId` er nå alltid `currentScheduledGameId` (eller null
    // hvis ingen aktiv runde). Hall-ready-handlinger (mark-ready, no-customers
    // osv.) krever en eksisterende scheduled-game-rad — vi avviser i UI hvis
    // den mangler så vi ikke sender et call backend må avvise med 400.
    const gameId = data.scheduledGameId;
    const terminalRound =
      data.scheduledGameStatus === "completed" ||
      data.scheduledGameStatus === "cancelled";
    const readyActionGameId = terminalRound ? null : gameId;
    const ownHallId = data.ownHallId;
    if (!ownHallId) return;

    // 2026-05-09 (Tobias debug-fix): logg master-action-klikk så Tobias
    // kan verifisere i F12-console at riktig action + ids fyres mot
    // backend. Synlig per klikk (ikke per polling) så ingen støy.
    // eslint-disable-next-line no-console
    console.log("[spill1-action] click", {
      action,
      ownHallId,
      scheduledGameId: gameId,
      readyActionGameId,
      isMasterAgent: data.isMasterAgent,
      masterHallId: data.masterHallId,
    });

    state.busy = true;
    setBusyState(container, true);

    try {
      switch (action) {
        case "mark-ready":
          // 2026-05-09 (Tobias-direktiv): mark-ready kan nå kalles UTEN
          // gameId. Backend lazy-spawner scheduled-game (status=scheduled,
          // IKKE running) hvis ingen aktiv finnes — alle haller markerer
          // klar FØR master klikker Start neste spill.
          await markHallReadyForGame(ownHallId, readyActionGameId);
          Toast.success("Hallen er markert som Klar.");
          break;
        case "unmark-ready":
          // 2026-05-12 (Tobias pilot-test fix): tidligere ble dette en silent
          // return hvis `readyActionGameId === null` (typisk når forrige
          // runde var completed/cancelled). Backend `unmarkReady` aksepterer
          // KUN status='scheduled'/'purchase_open'/'ready_to_start', og det
          // finnes ingen lazy-spawn-flyt for unmark (det gir ingen mening å
          // angre klar på en ferdig runde). Resultat: master klikket Angre
          // Klar → ingenting skjedde → ingen feedback. Fiks: i terminal-runde
          // viser vi en informativ toast i stedet for å avvise stille, og
          // knapp-rendret disabler nå ready-knappene i terminal-runde slik
          // at dette branchet bare treffes hvis race-state har tilbakestilt
          // status mellom render og click.
          //
          // 2026-05-13 (Tobias pilot-test regresjon-fix): skill mellom
          // terminal-runde og idle-state så toast er presis. Render-laget
          // disabler nå knappen i begge tilstander så dette branchet bare
          // treffes ved race-state mellom render og click.
          if (!readyActionGameId) {
            if (terminalRound) {
              Toast.info(
                "Forrige runde er fullført — start neste runde først, deretter " +
                "kan du markere Klar/Angre Klar for den nye runden.",
              );
            } else {
              Toast.info(
                "Ingen aktiv runde — vent til master starter neste spill, " +
                "deretter kan du angre Klar for den nye runden.",
              );
            }
            return;
          }
          await unmarkHallReadyForGame(ownHallId, readyActionGameId);
          Toast.info("Klar-markering angret.");
          break;
        case "no-customers":
          // 2026-05-09 (Tobias-direktiv): same lazy-spawn-flow.
          await setHallNoCustomersForGame(ownHallId, readyActionGameId);
          Toast.info("Hallen er markert som 'Ingen kunder'.");
          break;
        case "has-customers":
          // 2026-05-12 (Tobias pilot-test fix): samme som unmark-ready over —
          // has-customers krever en aktiv scheduled-game (backend
          // `setHallHasCustomers` har ingen lazy-spawn-flyt). I terminal-
          // runde gir vi tilbakemelding i stedet for silent return.
          //
          // 2026-05-13 (Tobias pilot-test regresjon-fix): skill mellom
          // terminal- og idle-tilstand for klar feilmelding.
          if (!readyActionGameId) {
            if (terminalRound) {
              Toast.info(
                "Forrige runde er fullført — start neste runde først, deretter " +
                "kan du åpne hallen igjen for den nye runden.",
              );
            } else {
              Toast.info(
                "Ingen aktiv runde — vent til master starter neste spill, " +
                "deretter kan du åpne hallen igjen for den nye runden.",
              );
            }
            return;
          }
          await setHallHasCustomersForGame(ownHallId, readyActionGameId);
          Toast.info("Hallen er åpnet igjen.");
          break;
        case "start": {
          // Bølge 3: `startMaster` kaller den ENESTE master-routen
          // (POST /api/agent/game1/master/start) som internt bruker
          // `MasterActionService` for å koordinere plan-API + engine-bridge.
          //
          // Tobias UX 2026-05-02: master kan starte selv om noen haller
          // ikke er klare. Vi viser bekreftelse FØR start; backend lager
          // en HALLS_NOT_READY hvis "kjenne ekskludering" ikke er sendt
          // — men master-routen i Bølge 2 håndterer dette via plan-flow,
          // så vi sender bare med hallId.
          //
          // Jackpot-popup (ADR-0017, 2026-05-10): backend kan kaste
          // `JACKPOT_SETUP_REQUIRED` når katalog-entry har
          // `requiresJackpotSetup=true` (kun pos 7 i pilot-planen). Master
          // må sette draw + prizesCents per bongfarge før start retries.
          // Vi viser JackpotSetupModal og retry'er start når submit lykkes.
          //
          // Tobias-direktiv 2026-05-10: bingoverten setter ALLTID jackpot
          // manuelt før spillet starter. Daglig-akkumulert jackpot-bekreftelse
          // (`JACKPOT_CONFIRM_REQUIRED` fra PR #1150) er fjernet.
          const unreadyHalls = data.halls.filter(
            (h) => !h.isReady && !h.excludedFromGame,
          );
          if (unreadyHalls.length > 0) {
            const names = unreadyHalls.map((h) => h.hallName).join(", ");
            const ok = confirm(
              `Disse hallene har ikke trykket Klar:\n\n  ${names}\n\n` +
              `Hvis du starter nå vil de bli ekskludert fra denne runden. Vil du fortsette?`,
            );
            if (!ok) return;
          }
          const startSucceeded = await runStartWithJackpotFlow(
            ownHallId,
            unreadyHalls.length,
          );
          if (!startSucceeded) return;
          break;
        }
        case "resume":
          // Bølge 3: ÉN kall — `resumeMaster` koordinerer plan + engine
          // sentralt i backend. Ingen idempotens-fallback i klient.
          await resumeMaster(ownHallId);
          Toast.success("Spill 1 gjenopptatt.");
          break;
        case "pause": {
          // Bølge 3: master pauser via single master-route. `pauseMaster`
          // sender PUSH til samme MasterActionService-instans som driver
          // alle andre actions, så pause/resume/start har konsistent
          // sekvensering uten klient-side rekkefølge-logikk.
          const reason = window.prompt("Årsak (valgfritt):", "") ?? undefined;
          await pauseMaster(ownHallId, reason);
          Toast.success("Spill 1 pauset.");
          break;
        }
        case "recover-stale": {
          // 2026-05-09: master-driven cleanup of STALE_PLAN_RUN /
          // BRIDGE_FAILED state. Bypasses MasterActionService.preValidate
          // (which would block on those exact warnings) so we can
          // unblock master without psql-access.
          //
          // Confirm-modal first — this is a destructive(ish) action even
          // though it only does forward state-transitions. Better to ask
          // than to surprise the master with disappearing yesterday's
          // run.
          const ok = confirm(
            "Dette markerer gårsdagens plan-run som ferdig og avslutter " +
              "stuck scheduled-games for hallen.\n\n" +
              "Operasjonen er trygg (ingen wallet-touch eller payout) og " +
              "idempotent. Er du sikker?",
          );
          if (!ok) return;
          const result = await recoverStale(ownHallId);
          const planCount = result.cleared.planRuns;
          const gameCount = result.cleared.scheduledGames;
          if (planCount === 0 && gameCount === 0) {
            Toast.info("Ingen stale-state funnet — alt var allerede rent.");
          } else {
            Toast.success(
              `Stale plan-state ryddet: ${planCount} plan-run + ` +
                `${gameCount} scheduled-game${gameCount === 1 ? "" : "s"} ` +
                "markert som ferdig.",
            );
          }
          break;
        }
        default:
          return;
      }
      await refresh();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Ukjent feil";
      Toast.error(message);
    } finally {
      state.busy = false;
      setBusyState(container, false);
    }
  }

  activeMount = { container, signal, cleanup };
}

export function unmountSpill1HallStatusBox(): void {
  if (activeMount) {
    activeMount.cleanup();
    activeMount = null;
  }
}

function setBusyState(container: HTMLElement, busy: boolean): void {
  container.querySelectorAll<HTMLButtonElement>("[data-spill1-action]").forEach((btn) => {
    if (busy) {
      btn.setAttribute("disabled", "disabled");
    } else if (btn.hasAttribute("data-spill1-not-disabled")) {
      btn.removeAttribute("disabled");
      btn.removeAttribute("data-spill1-not-disabled");
    }
  });
}

function render(container: HTMLElement, state: BoxState): void {
  if (!state.loaded) {
    container.innerHTML = `
      <div class="box-body cashinout-empty-placeholder">
        <p class="text-muted text-center">Henter Spill 1-status…</p>
      </div>`;
    return;
  }

  if (state.errorMessage) {
    container.innerHTML = `
      <div class="box-body cashinout-empty-placeholder">
        <p class="text-danger text-center">
          <i class="fa fa-exclamation-triangle" aria-hidden="true"></i>
          ${escapeHtml(state.errorMessage)}
        </p>
      </div>`;
    return;
  }

  const data = state.data;
  if (!data) {
    container.innerHTML = `
      <div class="box-body cashinout-empty-placeholder">
        <p class="text-muted text-center">Ingen kommende spill tilgjengelig…</p>
      </div>`;
    return;
  }

  // Bølge 3 (2026-05-08): `data` er nå mappet fra `Spill1AgentLobbyState`.
  // Ingen `currentGame`-objekt — vi sjekker `scheduledGameStatus` direkte.
  // 2026-05-03 (Tobias UX): vis alltid hall-status for hallene i gruppen,
  // selv når ingen runde er aktiv eller spawn'et i scheduled-tabellen.
  //
  // 2026-05-08 (Tobias-feedback): Vis "Min hall" og "Andre haller i
  // gruppen" som separate seksjoner slik at master ser umiddelbart hvor
  // mange andre haller som er klare/ikke klare. Master-hall i andre-
  // listen får 👑-merke.
  const warningBannerHtml = renderWarningBanner(
    state.warningBanner,
    state.showRecoverButton,
  );
  const masterHallIdForCrown = data.masterHallId;
  const gameStatus = data.scheduledGameStatus;
  if (!gameStatus) {
    if (data.halls.length === 0) {
      container.innerHTML = `
        <div class="box-body cashinout-empty-placeholder">
          <p class="text-muted text-center">Ingen kommende spill tilgjengelig…</p>
        </div>`;
      return;
    }
    const ownHallSnap =
      data.halls.find((h) => h.hallId === data.ownHallId) ?? null;
    const otherHallsSnap = data.halls.filter(
      (h) => h.hallId !== data.ownHallId,
    );
    // 2026-05-09 (Tobias UX-fix): Master må kunne starte ny runde også når
    // ingen scheduled-game eksisterer ennå. Tidligere returnerte denne
    // grenen tidlig uten å rendere master-knapper, slik at master satt
    // fast i "venter på neste runde"-state uten noen måte å starte.
    // MasterActionService.start er idempotent og lazy-creater plan-run +
    // scheduled-game fra fullt idle, så ett klikk er nok for å initialisere
    // hele kjeden.
    const idleUnreadyCount = data.halls.filter(
      (h) => !h.isReady && !h.excludedFromGame,
    ).length;
    const idleMasterButtonsHtml = renderMasterButtons({
      canStart: data.isMasterAgent,
      canPause: false,
      canResume: false,
      isMaster: data.isMasterAgent,
      gameStatus: "idle",
      scheduledStartTime: null,
      unreadyCount: idleUnreadyCount,
      nextGameName: data.catalogDisplayName,
    });
    // 2026-05-09 (Tobias-feedback): "Det må være mulig å markere seg klar
    // i cash-in-out-vinduet." Vi rendrer ownHall-knappene i idle-state også
    // — knappene er disabled med tooltip "Master må starte spillet først"
    // inntil en scheduled-game-rad eksisterer (backend
    // `markHallReadyForGame` krever en gameId). Når master klikker Start,
    // spawn'es scheduled-game og knappene blir aktive automatisk via
    // 2s-polling i refresh().
    const idleOwnHallButtonsHtml = renderOwnHallButtons(
      ownHallSnap,
      "idle",
      false,
      data.isMasterAgent,
    );
    // 2026-05-12 (Tobias-direktiv): bruk samme header-mønster som aktiv-
    // pathen. I idle (ingen scheduled-game spawnet) viser vi alltid
    // "Neste spill på spilleplan: {name}" hvis aggregator har plan-meta.
    const idleNextGameName = data.catalogDisplayName;
    const idleTitleHtml = idleNextGameName
      ? `Neste spill på spilleplan: ${escapeHtml(idleNextGameName)}`
      : "Neste spill på spilleplan";
    container.innerHTML = `
      <div class="box-header with-border">
        <h3 class="box-title">${idleTitleHtml}</h3>
      </div>
      <div class="box-body">
        ${warningBannerHtml}
        <p class="text-muted small" style="margin-bottom: 12px;">
          Hall-status for neste planlagte spill. Status oppdateres når
          runden spawnes.
        </p>
        ${renderOwnHallSection(ownHallSnap, data.ownHallId, masterHallIdForCrown)}
        ${renderOtherHallsSection(otherHallsSnap, masterHallIdForCrown)}
        ${idleOwnHallButtonsHtml}
        ${idleMasterButtonsHtml}
      </div>`;
    return;
  }

  const ownHallId = data.ownHallId;
  const isMaster = data.isMasterAgent;
  const ownHall = data.halls.find((h) => h.hallId === ownHallId) ?? null;
  const otherHalls = data.halls.filter((h) => h.hallId !== ownHallId);

  // 2026-05-08 (Tobias-direktiv): Start aktiv når purchase-vinduet er åpnet.
  // Master kan starte UAVHENGIG av om andre haller er klare. Pause/Fortsett
  // synlig kun når aktuelt.
  //
  // 2026-05-11 (live-room recovery): når scheduled-game allerede er terminal,
  // er riktig master-handling fortsatt "Start neste spill". Backend
  // auto-advancer plan-run før ny engine-start.
  const canStartFromTerminalRound =
    isMaster &&
    (gameStatus === "completed" || gameStatus === "cancelled");
  const canStart =
    isMaster &&
    (gameStatus === "ready_to_start" ||
      gameStatus === "purchase_open" ||
      canStartFromTerminalRound);
  const canPause = isMaster && gameStatus === "running";
  const canResume = isMaster && gameStatus === "paused";

  const ownHallHtml = renderOwnHallSection(
    ownHall,
    ownHallId,
    masterHallIdForCrown,
  );
  const otherHallsHtml = renderOtherHallsSection(
    otherHalls,
    masterHallIdForCrown,
  );
  // Bølge 3: `scheduledGameId` er null før master har startet runden — i den
  // situasjonen disabler vi hall-knapper som krever en eksisterende
  // scheduled_games-rad (mark-ready / no-customers etc.) med tooltip.
  const hasValidGameId =
    data.scheduledGameId !== null && gameStatus !== "scheduled";
  const ownButtonsHtml = renderOwnHallButtons(
    ownHall,
    gameStatus,
    hasValidGameId,
  );
  // Antall ikke-klare/ikke-ekskluderte haller — vises som hint på Start-knappen
  // så master ser umiddelbart hvor mange som vil bli ekskludert.
  const unreadyCount = data.halls.filter(
    (h) => !h.isReady && !h.excludedFromGame,
  ).length;
  // 2026-05-08: vis planlagt-navnet i Start-knappen så master ser presis
  // hva som starter (eks: "Start neste spill — Bingo"). Trekkes fra
  // `lobby.planMeta.catalogDisplayName` som aggregator setter når plan
  // dekker dagen.
  const nextGameName = data.catalogDisplayName;

  // ADR-0022 Lag 3: aktivér pulse på Fortsett-knappen når engine har vært
  // auto-paused i > PAUSE_BANNER_SOFT_THRESHOLD_MS. Pulse trekker master-
  // ens oppmerksomhet til knappen uten å skjule den eller endre layout.
  const resumePulse =
    canResume === true &&
    data.pauseStartedAt !== null &&
    (() => {
      const pauseMs = new Date(data.pauseStartedAt!).getTime();
      if (Number.isNaN(pauseMs)) return false;
      return Date.now() - pauseMs >= PAUSE_BANNER_SOFT_THRESHOLD_MS;
    })();

  const masterButtonsHtml = renderMasterButtons({
    canStart,
    canPause,
    canResume,
    isMaster,
    gameStatus,
    scheduledStartTime: data.scheduledStartTime,
    unreadyCount,
    nextGameName,
    resumePulse,
  });

  // 2026-05-12 (Tobias-direktiv): header-tekst skal speile lobby-tilstanden
  // klart for master. Tidligere ble dette rendret som
  // "Spill 1 — Fullført · Subspill: 5×500" som verken signaliserer aktiv-vs-
  // neste-tilstand eller bruker termen "trekning". Riktig:
  //   - Aktiv trekning pågår (purchase_open | ready_to_start | running |
  //     paused): "Aktiv trekning - {catalog-display-name}"
  //   - Ellers (scheduled | completed | cancelled): "Neste spill på
  //     spilleplan: {catalog-display-name}"
  // Når `catalogDisplayName` mangler (ingen plan-meta i lobby-state) faller
  // vi tilbake til en generisk overskrift uten navn.
  const isActiveDraw =
    gameStatus === "purchase_open" ||
    gameStatus === "ready_to_start" ||
    gameStatus === "running" ||
    gameStatus === "paused";
  let titleHtml: string;
  if (nextGameName) {
    const escapedName = escapeHtml(nextGameName);
    titleHtml = isActiveDraw
      ? `Aktiv trekning - ${escapedName}`
      : `Neste spill på spilleplan: ${escapedName}`;
  } else {
    titleHtml = isActiveDraw
      ? "Aktiv trekning"
      : "Neste spill på spilleplan";
  }

  // ADR-0022 Lag 3: stuck-recovery-banner over master-knappene.
  // Banneret bygges utenfor master-action-blokken så det er synlig også
  // hvis canStart=false (typisk når engine er auto-paused og master må
  // klikke Fortsett).
  const stuckRecoveryBannerHtml = renderStuckRecoveryBanner(data);

  container.innerHTML = `
    <div class="box-header with-border">
      <h3 class="box-title">${titleHtml}</h3>
    </div>
    <div class="box-body">
      ${warningBannerHtml}
      ${stuckRecoveryBannerHtml}
      ${ownHallHtml}
      ${otherHallsHtml}
      ${ownButtonsHtml}
      ${masterButtonsHtml}
    </div>`;
}

/**
 * ADR-0022 Lag 3: render stuck-recovery-banner over master-actions når
 * engine har vært auto-paused i > 30s (soft warning) eller > 45s (warning
 * banner med countdown til auto-resume), eller når scheduled_end_time +
 * 30 min er passert (kritisk banner — auto-end vil snart fyre).
 *
 * Master ser hva som er galt og hvor mange sekunder de har før systemet
 * tar over. Eksisterende "Fortsett"-knapp er last-resort-affordance per
 * Option A (Tobias-direktiv 2026-05-12) — vi peker på den fra banneret
 * uten å introdusere en ny knapp.
 *
 * Returnerer tom streng når ingen stuck-state oppdages — caller inline'er.
 */
function renderStuckRecoveryBanner(data: ViewState): string {
  // Bare relevant når engine er auto-paused. Manuell master-pause håndteres
  // ikke som "stuck" — master er bevisst tilstede.
  if (data.scheduledGameStatus !== "paused") return "";
  if (!data.pauseStartedAt) return "";

  const now = Date.now();
  const pauseMs = new Date(data.pauseStartedAt).getTime();
  if (Number.isNaN(pauseMs)) return "";
  const pausedFor = Math.max(0, now - pauseMs);
  if (pausedFor < PAUSE_BANNER_SOFT_THRESHOLD_MS) return "";

  // Sekunder igjen før auto-resume fyrer (Lag 1).
  let autoResumeInSec: number | null = null;
  if (data.autoResumeEligibleAt) {
    const eligibleMs = new Date(data.autoResumeEligibleAt).getTime();
    if (!Number.isNaN(eligibleMs)) {
      autoResumeInSec = Math.max(0, Math.ceil((eligibleMs - now) / 1000));
    }
  }

  // Sekunder igjen før auto-end fyrer (Lag 2).
  let autoEndInMin: number | null = null;
  if (data.stuckAutoEndAt) {
    const endMs = new Date(data.stuckAutoEndAt).getTime();
    if (!Number.isNaN(endMs) && endMs > now) {
      autoEndInMin = Math.max(0, Math.ceil((endMs - now) / 60_000));
    }
  }

  // Kritisk: scheduled_end_time + 30 min passert → auto-end imminent.
  const isCritical = autoEndInMin !== null && autoEndInMin <= 5;

  // Warning: paused > PAUSE_BANNER_WARNING_THRESHOLD_MS.
  const isWarning =
    !isCritical && pausedFor >= PAUSE_BANNER_WARNING_THRESHOLD_MS;

  const cssClass = isCritical
    ? "alert alert-danger"
    : isWarning
      ? "alert alert-warning"
      : "alert alert-info";
  const icon = isCritical
    ? "fa-exclamation-triangle"
    : isWarning
      ? "fa-clock"
      : "fa-pause-circle";

  const pausedForSec = Math.floor(pausedFor / 1000);
  const heartbeatStatus = data.isMasterAgent
    ? data.masterIsActive
      ? " Master-heartbeat aktiv — auto-fortsett skipper."
      : " Master-heartbeat utgått — auto-fortsett vil fyre."
    : "";

  let mainMessage = `<strong>⏸ Pauset for ${pausedForSec}s.</strong> Klikk <em>Fortsett</em> for å gå videre.`;
  if (autoResumeInSec !== null && autoResumeInSec > 0 && !data.masterIsActive) {
    mainMessage += ` Auto-fortsett om ${autoResumeInSec}s.`;
  }
  if (isCritical && autoEndInMin !== null) {
    mainMessage = `<strong>🚨 Runden er forsinket.</strong> Auto-avbryt om ${autoEndInMin} min — klikk <em>Fortsett</em> umiddelbart.`;
  } else if (
    autoEndInMin !== null &&
    autoEndInMin < 30 &&
    !isCritical
  ) {
    mainMessage += ` Auto-avbryt om ${autoEndInMin} min.`;
  }

  return `
    <div class="${cssClass}" data-marker="spill1-stuck-recovery-banner"
         style="margin-bottom:12px;">
      <i class="fa ${icon}" aria-hidden="true"></i>
      <small>${mainMessage}${heartbeatStatus}</small>
    </div>`;
}

/**
 * Code-review-fix 2026-05-08 (PR #1075 review #1): render warning-banner
 * over hall-pillene istedenfor å spamme Toast.warning fra polling-loopen.
 *
 * Banneret er deklarativt — `state.warningBanner` settes per refresh, og
 * vises som ÉN inline `<div class="alert alert-warning">`. Banneret
 * forsvinner automatisk når `inconsistencyWarnings` er tom igjen.
 *
 * Returnerer tom string når ingen warning er aktiv så caller kan
 * inline'e resultatet trygt.
 *
 * 2026-05-09 (recover-stale): når `showRecoverButton=true` rendres en
 * "🧹 Rydde stale plan-state"-knapp under banneret. Knappen er kun
 * synlig når aggregator har flagget STALE_PLAN_RUN eller BRIDGE_FAILED
 * (de eneste warning-kodene som master kan rydde opp via cleanup-
 * endpointet). Andre warnings (DUAL_SCHEDULED_GAMES,
 * PLAN_SCHED_STATUS_MISMATCH, MISSING_GOH_MEMBERSHIP) krever ulik
 * intervensjon og skal ikke trigge denne knappen.
 */
function renderWarningBanner(
  banner: string | null,
  showRecoverButton = false,
): string {
  if (!banner) return "";
  const recoverButtonHtml = showRecoverButton
    ? `
      <div style="margin-top:8px;">
        <button type="button"
                class="btn btn-warning btn-sm"
                data-spill1-action="recover-stale"
                data-marker="spill1-hall-status-recover-button"
                title="Marker gårsdagens plan-run som ferdig og avslutt stuck scheduled-games. Trygg og idempotent.">
          <i class="fa fa-broom" aria-hidden="true"></i>
          🧹 Rydde stale plan-state
        </button>
      </div>`
    : "";
  return `
    <div class="alert alert-warning" data-marker="spill1-hall-status-warning"
         style="margin-bottom:12px;">
      <i class="fa fa-exclamation-triangle" aria-hidden="true"></i>
      <small>${escapeHtml(banner)}</small>
      ${recoverButtonHtml}
    </div>`;
}

/**
 * 2026-05-08 (Tobias-feedback): Render egen-hall-seksjonen ("Min hall").
 * Viser status-pillen + master-merke om hallen er master. Knapper for
 * egen hall (Marker Klar / Ingen kunder) rendres separat av
 * `renderOwnHallButtons` slik at de kan kobles til samme grid-stil som
 * kontant-inn-/ut-knappene.
 *
 * Bølge 3 (2026-05-08): typer er nå `Spill1HallReadyStatus` fra aggregator.
 * Ticket-tellinger er fjernet — de var en del av legacy-merge-pathen som
 * Bølge 1 fjerner. (Bonge-tellinger pr hall håndteres av cash-inout-
 * dashboardets eksisterende cash-flow-tabeller.)
 */
function renderOwnHallSection(
  ownHall: Spill1HallReadyStatus | null,
  ownHallId: string,
  masterHallId: string | null,
): string {
  // Hvis egen hall ikke er i halls-listen (eks. tom-state før plan-runtime
  // er registrert), vises minimal placeholder.
  if (!ownHall) {
    return `
      <div class="spill1-hall-section" data-marker="spill1-own-hall-section"
           style="margin-bottom:12px;">
        <h4 style="margin:0 0 8px 0;">Min hall</h4>
        <p class="text-muted small">Henter status…</p>
      </div>`;
  }
  const isMasterHall = masterHallId !== null && ownHallId === masterHallId;
  const masterCrown = isMasterHall
    ? `<span class="label label-default" data-marker="spill1-pill-master"
              title="Master-hall" style="margin-left:6px;">👑 Master</span>`
    : "";
  const pill = renderStatusPill(ownHall);
  return `
    <div class="spill1-hall-section" data-marker="spill1-own-hall-section"
         style="margin-bottom:12px;">
      <h4 style="margin:0 0 8px 0;">Min hall</h4>
      <div class="spill1-hall-list" data-marker="spill1-hall-list">
        <div class="spill1-hall-row spill1-hall-row-own">
          <span class="spill1-hall-name">
            ${escapeHtml(ownHall.hallName)}
            <small class="text-muted">(din hall)</small>
            ${masterCrown}
          </span>
          <span class="spill1-hall-meta">
            ${pill}
          </span>
        </div>
      </div>
    </div>`;
}

/**
 * 2026-05-08 (Tobias-feedback): Render andre-haller-seksjonen ("Andre
 * haller i gruppen"). Viser status-pill + 👑-merke for master-hall.
 * Master-agent ser denne for å avgjøre om de andre hallene er klare
 * før de starter — men start-knappen er IKKE blokkert av andre halls
 * ready-state (per Tobias-direktiv #1017).
 */
function renderOtherHallsSection(
  otherHalls: Spill1HallReadyStatus[],
  masterHallId: string | null,
): string {
  if (otherHalls.length === 0) {
    return `
      <div class="spill1-hall-section" data-marker="spill1-other-halls-section"
           style="margin-bottom:12px;">
        <h4 style="margin:0 0 8px 0;">Andre haller i gruppen</h4>
        <p class="text-muted small">Ingen andre haller i denne gruppen.</p>
      </div>`;
  }
  const rows = otherHalls
    .map((h) => {
      const isMasterHall = masterHallId !== null && h.hallId === masterHallId;
      const masterCrown = isMasterHall
        ? `<span class="label label-default" data-marker="spill1-pill-master"
                  title="Master-hall" style="margin-left:6px;">👑 Master</span>`
        : "";
      const pill = renderStatusPill(h);
      return `
        <div class="spill1-hall-row" data-hall-id="${escapeHtml(h.hallId)}">
          <span class="spill1-hall-name">
            ${escapeHtml(h.hallName)}
            ${masterCrown}
          </span>
          <span class="spill1-hall-meta">
            ${pill}
          </span>
        </div>`;
    })
    .join("");
  return `
    <div class="spill1-hall-section" data-marker="spill1-other-halls-section"
         style="margin-bottom:12px;">
      <h4 style="margin:0 0 8px 0;">Andre haller i gruppen</h4>
      <div class="spill1-hall-list" data-marker="spill1-hall-list">
        ${rows}
      </div>
    </div>`;
}

/**
 * Bølge 3 (2026-05-08): Render status-pill basert på aggregator-state.
 * `colorCode` (red/orange/green/gray) er ferdig-beregnet av backend's
 * `Game1HallReadyService.computeHallStatus` — vi mapper kun til UI-label.
 *
 * red    → Ekskludert / Ingen kunder (rød)
 * orange → Ikke klar (gul)
 * green  → Klar (grønn)
 * gray   → Ikke deltagende (nøytral)
 */
function renderStatusPill(h: Spill1HallReadyStatus): string {
  // 2026-05-09 (Tobias UX-fix): Tidligere viste vi "Ekskludert" når
  // EITHER `excludedFromGame=true` OR `hasNoCustomers=true`. Backend
  // setter `hasNoCustomers=true` for HVER hall med playerCount=0 — som
  // er forventet før spillere har koblet seg til (master åpner konsoll
  // FØR spillere er online). Vi viser nå "Ekskludert" KUN ved eksplisitt
  // master/agent-handling (`excludedFromGame`). `hasNoCustomers` påvirker
  // bare label-tekst (lagt til som "(ingen kunder)" suffiks når aktuelt).
  if (h.excludedFromGame) {
    const reason = h.excludedReason
      ? ` (${escapeHtml(h.excludedReason)})`
      : "";
    return `<span class="label label-danger" data-marker="spill1-pill-excluded">
              <i class="fa fa-times-circle" aria-hidden="true"></i> Ekskludert${reason}
            </span>`;
  }
  if (h.isReady) {
    return `<span class="label label-success" data-marker="spill1-pill-ready">
              <i class="fa fa-check-circle" aria-hidden="true"></i> Klar
            </span>`;
  }
  return `<span class="label label-warning" data-marker="spill1-pill-not-ready">
            <i class="fa fa-clock-o" aria-hidden="true"></i> Ikke klar
          </span>`;
}

function renderOwnHallButtons(
  ownHall: Spill1HallReadyStatus | null,
  gameStatus: string,
  hasValidGameId: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _isMasterAgent: boolean = false,
): string {
  if (!ownHall) {
    return "";
  }
  // 2026-05-03 (Tobias UX): tillat også 'scheduled' så agenter kan
  // markere klar/exclude tidlig (før cron promoter til 'purchase_open').
  // 2026-05-09 (Tobias-direktiv): "Alle haller skal markere seg som klar
  // og deretter skal master starte spillet når da alle er klare."
  // Backend lazy-spawner scheduled-game ved første mark-ready-klikk, så
  // alle haller (inkludert sub-haller) kan klikke i idle-state.
  //
  // 2026-05-12 (Tobias pilot-test fix): split editable i to:
  //   - readyEditableForUnmark: kun pre-game statuser (Angre Klar /
  //     Har kunder igjen krever en aktiv scheduled-game-rad backend kan
  //     UPDATE — completed/cancelled-rader avvises av Game1HallReadyService).
  //   - readyEditableForMark: inkluderer terminal-statuser fordi backend
  //     lazy-spawner ny scheduled-game når master klikker Marker Klar /
  //     Ingen kunder på en ferdig runde (lazyEnsureScheduledGameForHall).
  //
  // 2026-05-13 (Tobias pilot-test regresjon-fix): "Angre Klar virker ikke"
  // gjenoppstod etter PR #1280 fordi `gameStatus="idle"` er medlem av
  // isPreGameStatus → button rendret som ENABLED, men click-handler
  // bailet stille (`readyActionGameId=null` siden `data.scheduledGameId
  // === null` i idle). Master klikket → ingenting skjedde → ingen
  // feedback. Fiks: idle er ikke editable for unmark — backend
  // `setHallHasCustomers`/`unmarkReady` har ingen lazy-spawn-flyt, så
  // unmark krever en faktisk scheduled-game-rad. Master må vente til
  // master har startet neste runde for å kunne angre.
  const isPreGameStatus =
    gameStatus === "scheduled" ||
    gameStatus === "purchase_open" ||
    gameStatus === "ready_to_start" ||
    gameStatus === "idle";
  const isTerminalRound =
    gameStatus === "completed" || gameStatus === "cancelled";
  const isIdleStatus = gameStatus === "idle";
  // Mark-handlinger (Marker Klar / Ingen kunder) kan kalles i alle pre-game
  // OG terminal-statuser fordi backend lazy-spawner ny runde ved behov.
  const editableForMark = isPreGameStatus || isTerminalRound;
  // Unmark-handlinger (Angre Klar / Har kunder igjen) krever en
  // eksisterende ikke-terminal scheduled-game-rad. I terminal-runde må
  // master starte ny runde først. I idle-state finnes det heller ingen
  // rad å oppdatere — vi disabler så click-handleren ikke bailer stille.
  // NB: vi disabler IKKE basert på `hasValidGameId` for status="scheduled"
  // — `hasValidGameId` er en lazy-spawn-relatert flagg (false også for
  // status="scheduled" som er en gyldig DB-rad), mens backend `unmarkReady`
  // aksepterer `scheduled` likt med `purchase_open`/`ready_to_start`.
  const editableForUnmark = isPreGameStatus && !isIdleStatus;

  // 2026-05-09: backend håndterer lazy-spawn via
  // lazyEnsureScheduledGameForHall, så vi disabler IKKE for missing gameId.
  // Tooltip forklarer hva som skjer ved klikk i idle-state.
  const lazyTooltip = !hasValidGameId
    ? "Markerer hallen klar — backend forbereder neste runde"
    : "";
  const lazyTooltipAttr = lazyTooltip
    ? ` title="${escapeHtml(lazyTooltip)}"`
    : "";

  // 2026-05-12 (Tobias pilot-test fix): egen tooltip for terminal-runde
  // som forklarer at neste runde må startes først. Skiller seg fra
  // lazy-tooltip slik at master ser hvorfor knappen er disabled.
  const terminalTooltipAttr = isTerminalRound
    ? ` title="${escapeHtml(
        "Forrige runde er fullført — start neste runde først",
      )}"`
    : "";
  // 2026-05-13 (Tobias pilot-test regresjon-fix): tooltip for idle-state
  // når Angre Klar / Har kunder igjen ikke kan kalles fordi det ikke
  // finnes en scheduled-game-rad ennå. Master får vite at de må vente
  // på neste runde eller starte planen.
  const idleUnmarkTooltipAttr = isIdleStatus
    ? ` title="${escapeHtml(
        "Ingen aktiv runde — vent på at master starter neste spill",
      )}"`
    : "";

  const readyDisabled = ownHall.isReady
    ? !editableForUnmark || ownHall.excludedFromGame
    : !editableForMark || ownHall.excludedFromGame;
  // For Angre Klar i terminal-runde: vis terminal-tooltip; ellers lazy-
  // tooltip hvis relevant. Mark-knappen viser kun lazy-tooltip siden
  // mark-handling fungerer i terminal-runde via lazy-spawn.
  //
  // 2026-05-13: I idle-state med isReady=true (transient state mellom
  // mark-ready lazy-spawn og polling-refresh), vis idle-tooltip i stedet
  // for lazy-tooltip (sistnevnte er for mark-ready, ikke unmark).
  const readyTooltipAttr = ownHall.isReady && isTerminalRound
    ? terminalTooltipAttr
    : ownHall.isReady && isIdleStatus
      ? idleUnmarkTooltipAttr
      : lazyTooltipAttr;
  const readyBtn = ownHall.isReady
    ? `<button type="button" class="btn btn-default cashinout-grid-btn"
                data-spill1-action="unmark-ready"
                ${readyDisabled ? "disabled" : ""}${readyTooltipAttr}>
         <i class="fa fa-undo" aria-hidden="true"></i> Angre Klar
       </button>`
    : `<button type="button" class="btn btn-success cashinout-grid-btn"
                data-spill1-action="mark-ready"
                ${readyDisabled ? "disabled" : ""}${lazyTooltipAttr}>
         <i class="fa fa-check-circle" aria-hidden="true"></i> Marker Klar
       </button>`;

  const customersDisabled = ownHall.excludedFromGame
    ? !editableForUnmark
    : !editableForMark;
  // For Har kunder igjen i terminal-runde: vis terminal-tooltip.
  // 2026-05-13: I idle med excludedFromGame=true (transient), vis idle-tooltip.
  const customersTooltipAttr =
    ownHall.excludedFromGame && isTerminalRound
      ? terminalTooltipAttr
      : ownHall.excludedFromGame && isIdleStatus
        ? idleUnmarkTooltipAttr
        : lazyTooltipAttr;
  const customersBtn = ownHall.excludedFromGame
    ? `<button type="button" class="btn btn-default cashinout-grid-btn"
                data-spill1-action="has-customers"
                ${customersDisabled ? "disabled" : ""}${customersTooltipAttr}>
         <i class="fa fa-undo" aria-hidden="true"></i> Har kunder igjen
       </button>`
    : `<button type="button" class="btn btn-danger cashinout-grid-btn"
                data-spill1-action="no-customers"
                ${customersDisabled ? "disabled" : ""}${lazyTooltipAttr}>
         <i class="fa fa-times" aria-hidden="true"></i> Ingen kunder
       </button>`;

  // 2026-05-08 (Tobias-feedback): Header endret fra "Min hall" til
  // "Handlinger for min hall" siden status-pillen for egen hall nå
  // rendres av `renderOwnHallSection` over knappene. Uten endringen
  // ville agentene se to "Min hall"-headere i serie.
  return `
    <div class="spill1-self-actions" style="margin-top:16px;">
      <h4 style="margin:0 0 8px 0;">Handlinger for min hall</h4>
      <div class="cashinout-grid">
        ${readyBtn}
        ${customersBtn}
      </div>
    </div>`;
}

function renderMasterButtons(opts: {
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  isMaster: boolean;
  gameStatus: string;
  /**
   * 2026-05-07: scheduled-start-tid for runden. Brukes til tooltip på
   * Start-knappen når status='scheduled' så master ser når den blir aktiv.
   */
  scheduledStartTime: string | null;
  /**
   * Antall haller som ikke har trykket Klar og ikke er ekskludert. Hvis > 0
   * vises en advarsel under Start-knappen — master kan fortsatt starte men
   * får bekreftelses-popup og hallene ekskluderes fra denne runden.
   */
  unreadyCount: number;
  /**
   * 2026-05-08: planlagt sub-game-navn (eks "Bingo", "Mystery"). Brukes til
   * å bygge dynamisk Start-label "Start neste spill — {navn}".
   */
  nextGameName: string | null;
  /**
   * ADR-0022 Lag 3: hvis true, legg pulse-animasjon på Fortsett-knappen
   * for å trekke oppmerksomheten til den. Aktiveres når engine har vært
   * auto-paused i > PAUSE_BANNER_SOFT_THRESHOLD_MS.
   */
  resumePulse?: boolean;
}): string {
  if (!opts.isMaster) return "";
  const startTooltip = buildStartTooltip(
    opts.canStart,
    opts.gameStatus,
    opts.scheduledStartTime
  );
  const startTooltipAttr = startTooltip
    ? ` title="${escapeHtml(startTooltip)}"`
    : "";
  const startWarning =
    opts.canStart && opts.unreadyCount > 0
      ? `<p class="text-muted small" style="margin-top:8px;margin-bottom:0;">
           <i class="fa fa-info-circle text-warning" aria-hidden="true"></i>
           ${opts.unreadyCount} hall${opts.unreadyCount === 1 ? "" : "er"}
           ikke klar enda — start vil ekskludere ${opts.unreadyCount === 1 ? "den" : "dem"}.
         </p>`
      : "";
  // 2026-05-08 (Tobias-direktiv): Start-label inkluderer planlagt-navnet på
  // neste spill. Stop-knappen er FJERNET fra agent-UI — admin har eget
  // audit-trail-endpoint via /api/admin/game1/games/:gameId/stop hvis
  // master må stoppe en aktiv runde.
  const startLabel = opts.nextGameName
    ? `Start neste spill — ${opts.nextGameName}`
    : "Start neste spill";
  // ADR-0022 Lag 3: pulse-klasse på Fortsett når engine har vært auto-
  // paused i en stund. Selve pulse-animasjonen er definert inline i style-
  // tagen rendret én gang per render-pass (idempotent — duplikate
  // animasjons-keyframes deklarert i samme dokument er trygt). Vi
  // injecter style-blokken bare når pulse er aktiv så vi unngår å
  // forurense ren rest-state.
  const resumeShouldPulse =
    opts.resumePulse === true && opts.canResume === true;
  const resumeClass = resumeShouldPulse
    ? "btn btn-info cashinout-grid-btn spill1-resume-pulse"
    : "btn btn-info cashinout-grid-btn";
  const pulseStyleBlock = resumeShouldPulse
    ? `<style>
        @keyframes spill1ResumePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(91, 192, 222, 0.7); }
          50% { box-shadow: 0 0 0 8px rgba(91, 192, 222, 0); }
        }
        .spill1-resume-pulse {
          animation: spill1ResumePulse 1.6s ease-in-out infinite;
        }
      </style>`
    : "";
  return `
    <div class="spill1-master-actions" style="margin-top:16px;">
      <h4 style="margin:0 0 8px 0;">Master-handlinger</h4>
      <div class="cashinout-grid">
        <button type="button" class="btn btn-success cashinout-grid-btn"
                data-spill1-action="start"
                ${opts.canStart ? "" : "disabled"}${startTooltipAttr}>
          <i class="fa fa-play" aria-hidden="true"></i> ${escapeHtml(startLabel)}
        </button>
        <button type="button" class="btn btn-warning cashinout-grid-btn"
                data-spill1-action="pause"
                ${opts.canPause ? "" : "disabled"}>
          <i class="fa fa-pause" aria-hidden="true"></i> Pause
        </button>
        <button type="button" class="${resumeClass}"
                data-spill1-action="resume"
                ${opts.canResume ? "" : "disabled"}>
          <i class="fa fa-play-circle" aria-hidden="true"></i> Fortsett
        </button>
      </div>
      ${startWarning}
      ${pulseStyleBlock}
    </div>`;
}

/**
 * 2026-05-07: bygg tooltip-tekst for Start-knappen i cash-inout-dashboardet.
 * Speiler `Spill1AgentControls.buildStartButtonTooltip` slik at master-agent
 * får samme forklaring uansett hvor de kommer fra.
 */
function buildStartTooltip(
  canStart: boolean,
  status: string,
  scheduledStartTime: string | null
): string | null {
  if (canStart) return null;
  if (status === "scheduled") {
    const ts = formatScheduledStartHHMM(scheduledStartTime);
    if (ts) {
      return `Start blir tilgjengelig når purchase-vinduet åpner (kl ${ts} norsk tid)`;
    }
    return "Start blir tilgjengelig når purchase-vinduet åpner";
  }
  if (status === "running") {
    return "Spillet kjører allerede";
  }
  if (status === "paused") {
    return "Spillet er pauset — bruk Resume i stedet";
  }
  if (status === "completed") {
    return "Spillet er fullført";
  }
  if (status === "cancelled") {
    return "Spillet er avbrutt";
  }
  return null;
}

/**
 * 2026-05-07: format scheduled_start_time som HH:MM i Europe/Oslo. Returnerer
 * null hvis input er null eller invalid.
 */
function formatScheduledStartHHMM(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

/**
 * Jackpot-popup-flyt (ADR-0017, 2026-05-10).
 *
 * Kjører master-start med automatisk håndtering av `JACKPOT_SETUP_REQUIRED`
 * fra backend: catalog-entry har `requiresJackpotSetup=true` (gjelder kun
 * Jackpot-katalog-spillet på pos 7 i pilot-planen), master må sette draw +
 * prizesCents per bongfarge før start retries. Vi viser JackpotSetupModal
 * som submitter /jackpot-setup, og retry'er deretter start.
 *
 * Tobias-direktiv 2026-05-10: bingoverten setter ALLTID jackpot manuelt
 * før spillet starter. Daglig-akkumulert jackpot-bekreftelse (gammel
 * `JACKPOT_CONFIRM_REQUIRED`-flyt fra PR #1150) er fjernet — det skal
 * IKKE være automatisk akkumulering.
 *
 * Loop max 2 ganger så master kan submit'e setup og deretter starte.
 *
 * Returnerer `true` hvis start lyktes, `false` hvis master avbrøt eller
 * vi traff max-attempts. Toast-feedback (success / error) er allerede
 * vist før retur.
 *
 * `unreadyHallCount` brukes kun til success-melding så master ser hvor
 * mange haller som ble ekskludert. Validering av unready-haller er
 * gjort av caller før denne funksjonen kalles.
 */
async function runStartWithJackpotFlow(
  ownHallId: string,
  unreadyHallCount: number,
): Promise<boolean> {
  let setupSubmittedThisAttempt = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await startMaster(ownHallId);
      const successMessage =
        unreadyHallCount > 0
          ? `Spill 1 startet — ${unreadyHallCount} hall(er) ekskludert.`
          : "Spill 1 startet.";
      Toast.success(successMessage);
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) {
        const message =
          err instanceof Error ? err.message : "Kunne ikke starte Spill 1.";
        Toast.error(message);
        return false;
      }

      // JACKPOT_SETUP_REQUIRED: catalog-entry krever popup med
      // draw + prizesCents per bongfarge.
      if (err.code === "JACKPOT_SETUP_REQUIRED" && !setupSubmittedThisAttempt) {
        const item = await fetchCatalogItemForJackpotSetup(ownHallId, err);
        if (!item) {
          Toast.error(
            "Klarte ikke å laste plan-data for jackpot-setup. Refresh og prøv igjen.",
          );
          return false;
        }
        const submitted = await openJackpotSetupModalAsPromise(item);
        if (!submitted) return false;
        setupSubmittedThisAttempt = true;
        continue;
      }

      // Annen DomainError → vis melding og avbryt.
      Toast.error(err.message);
      return false;
    }
  }

  Toast.error(
    "Klarte ikke å starte Spill 1 etter 2 forsøk. Refresh og prøv igjen.",
  );
  return false;
}

/**
 * Wrap `openJackpotSetupModal` (callback-basert) som en Promise<boolean>
 * slik at `runStartWithJackpotFlow` kan bruke den i en sekvensiell loop.
 * Resolverer `true` hvis master submitter modal-en (success-callback fyrer),
 * `false` hvis avbryt eller backdrop-close.
 */
function openJackpotSetupModalAsPromise(
  item: AgentGamePlanItem,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const settle = (value: boolean): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    openJackpotSetupModal({
      item,
      onSuccess: () => settle(true),
      onCancel: () => settle(false),
    });
  });
}

/**
 * Hent katalog-item for nåværende plan-posisjon når backend kaster
 * `JACKPOT_SETUP_REQUIRED`. Vi fetcher /api/agent/game-plan/current for
 * å få full `currentItem.catalogEntry` (med ticketColors-listen som
 * JackpotSetupModal trenger for å rendre input per bongfarge).
 *
 * Returnerer `null` hvis fetch feilet eller currentItem mangler — caller
 * viser feilmelding i så fall.
 */
async function fetchCatalogItemForJackpotSetup(
  hallId: string,
  err: ApiError,
): Promise<AgentGamePlanItem | null> {
  try {
    const planCurrent = await fetchAgentGamePlanCurrent({ hallId });
    // Foretrekk currentItem (det er den master prøver å starte). Hvis
    // backend signaliserer at en spesifikk posisjon er det som krever
    // setup (via err.details.position), match den i items[].
    const targetPosition = (() => {
      const d = err.details;
      if (!d) return null;
      const p = Number(d.position);
      return Number.isFinite(p) && Number.isInteger(p) ? p : null;
    })();
    if (targetPosition !== null) {
      const match = planCurrent.items.find(
        (i) => i.position === targetPosition,
      );
      if (match) return match;
    }
    return planCurrent.currentItem ?? planCurrent.nextItem ?? null;
  } catch {
    // Network/parse-feil: graceful return null så caller viser feilmelding.
    return null;
  }
}
