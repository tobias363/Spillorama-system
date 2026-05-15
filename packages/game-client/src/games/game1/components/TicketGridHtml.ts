import type { GameState } from "../../../bridge/GameBridge.js";
import { activePatternFromState } from "../logic/PatternMasks.js";
import {
  sortPhaseFromActivePattern,
  sortTicketsByProgress,
} from "../logic/TicketSortByProgress.js";
import type { Ticket } from "@spillorama/shared-types/game";
import { BingoTicketHtml } from "./BingoTicketHtml.js";
import { BingoTicketTripletHtml } from "./BingoTicketTripletHtml.js";

/**
 * §5.9 (Tobias-direktiv 2026-05-15 IMMUTABLE) — Felles render-API for
 * single-bonger (`BingoTicketHtml`) og triple-grupperte bonger
 * (`BingoTicketTripletHtml`). Begge typer eksponerer samme public API
 * (`root`, `markNumber`, `markNumbers`, `reset`, `highlightLuckyNumber`,
 * `setActivePattern`, `destroy`) så `TicketGridHtml` kan lagre dem i én
 * felles `tickets`-array uten branching i mark-propagation-laget.
 *
 * Triple-bonger oppstår når 3 `Ticket`-objekter med samme `purchaseId`
 * (sortert på `sequenceInPurchase`) blir gruppert i `rebuild()`.
 * Partial-purchases (1-2 av 3 mottatt) faller tilbake til single-rendering.
 */
type TicketEntry = BingoTicketHtml | BingoTicketTripletHtml;

/**
 * HTML grid scroller for Game 1 tickets. Replaces the Pixi TicketGridScroller
 * + TicketGroup pair. Uses native `overflow-y: auto` and CSS grid — the
 * platform handles wheel / touch / keyboard scrolling for free.
 *
 * Responsibilities:
 *   - Mount inside an HtmlOverlayManager absolute-positioned slot
 *   - Render one BingoTicketHtml per ticket
 *   - Diff-render on `setTickets` so unchanged tickets don't rebuild (preserves
 *     cell mark animations and flip state)
 *   - Propagate mark-number events to every child ticket
 */

export interface TicketGridHtmlOptions {
  onCancelTicket?: (ticketId: string) => void;
}

export class TicketGridHtml {
  readonly root: HTMLDivElement;
  private readonly scrollArea: HTMLDivElement;
  private readonly gridEl: HTMLDivElement;
  /**
   * Render-entries i grid-rekkefølge. Hver entry er enten en enkelt-bong
   * (`BingoTicketHtml`) eller en triple-bong-wrapper (`BingoTicketTripletHtml`)
   * som internt holder 3 sub-bonger. Mark-propagation kaller `markNumber` på
   * begge typer — wrapperen propagerer videre til sub-bongene.
   *
   * NB: `liveCount` regnes på ANTALL ENTRIES, ikke antall underliggende
   * tickets. Tripler teller som 1 entry. Caller (`Game1Controller.update`)
   * sender allerede liveCount i Ticket-array-rom (3 tickets per large-kjøp
   * teller som 3) — vi konverterer i `rebuild()` ved å regne hvor mange
   * `Ticket`-objekter som ble konsumert per entry.
   */
  private tickets: TicketEntry[] = [];
  /**
   * ID-map fra `Ticket.id` → render-entry. For triple-bonger registreres
   * ALLE 3 sub-ticket-ID-er → samme triplet (slik at f.eks. en hypotetisk
   * `ticket:replace`-event på én sub-ticket finner riktig render-entry).
   * `purchaseId` registreres også separat for triple-spesifikt cancel-routing.
   */
  private ticketById = new Map<string, TicketEntry>();
  /** Cache of the last rendered tickets' identity + colour, keyed by id. */
  private lastSignature: string | null = null;
  /** Mark-state signature (drawn-count + last-drawn + lucky + activePattern).
   *  Used by setTickets to skip `applyMarks` when nothing that affects marks
   *  has changed since the last call. Backend sends room:update every ~1.2s
   *  during drawing; without this short-circuit we re-iterate every live
   *  ticket × every drawn number on every state-tick even when nothing is
   *  new (BIN-blink round 3). */
  private lastMarkStateSig: string | null = null;
  private cancelable = false;
  /** Antall live (spillende) brett — første N av `tickets`. Pre-round-brett
   *  (index ≥ liveCount) skal IKKE merkes av `markNumberOnAll`. Oppdateres
   *  av `setTickets`. */
  private liveCount = 0;
  private onCancelTicket: ((ticketId: string) => void) | null;

  constructor(opts: TicketGridHtmlOptions = {}) {
    this.onCancelTicket = opts.onCancelTicket ?? null;

    this.root = document.createElement("div");
    // data-test attribute consumed by Playwright pilot-flow tests
    // (tests/e2e/spill1-pilot-flow.spec.ts). Inert in production.
    this.root.setAttribute("data-test", "ticket-grid");
    Object.assign(this.root.style, {
      position: "absolute",
      display: "flex",
      flexDirection: "column",
      pointerEvents: "auto",
      boxSizing: "border-box",
      // Higher than the sibling flex children inside HtmlOverlayManager.root
      // — otherwise `CenterTopPanel` (flex: 1, default align-items: stretch)
      // stretches to full height and visually covers the ticket grid, and
      // also soaks up pointer events in its empty lower half.
      zIndex: "5",
    });

    this.scrollArea = document.createElement("div");
    Object.assign(this.scrollArea.style, {
      flex: "1 1 auto",
      overflowY: "auto",
      overflowX: "hidden",
      padding: "8px",
      // Hide scrollbar visually but keep it scrollable (Pixi aesthetic match).
      scrollbarWidth: "thin",
      scrollbarColor: "rgba(255,255,255,0.25) transparent",
    });
    // Dynamisk fade-maske: ingen fade når skrollet helt opp / helt ned;
    // 16px fade når det er mer innhold i den retningen.
    this.scrollArea.addEventListener("scroll", () => this.updateScrollMask());
    this.root.appendChild(this.scrollArea);

    this.gridEl = document.createElement("div");
    Object.assign(this.gridEl.style, {
      display: "grid",
      gridTemplateColumns: "repeat(5, minmax(0px, 1fr))",
      gap: "10px",
      alignContent: "start",
    });
    this.scrollArea.appendChild(this.gridEl);
  }

  /**
   * Mount the grid under an HTML overlay parent. Call once, right after
   * constructing the PlayScreen.
   */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  /**
   * Absolute-position the grid inside its overlay parent. Coordinates are in
   * the same logical space as HtmlOverlayManager (which tracks the Pixi
   * canvas rect for DPR-correct positioning).
   */
  setBounds(x: number, y: number, width: number, height: number): void {
    Object.assign(this.root.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    // Bounds-endring kan endre hvorvidt innhold overflower → oppdater maske.
    this.updateScrollMask();
  }

  /** Oppdater fade-maske basert på scroll-posisjon. Ingen fade i topp når
   *  scrollTop==0; ingen fade i bunn når scrollet helt ned. 16px fade-zone.
   *  Kun skriv til DOM hvis masken faktisk endrer seg (unngå re-paint-blink). */
  private lastMaskStr: string | null = null;
  private updateScrollMask(): void {
    const el = this.scrollArea;
    const atTop = el.scrollTop <= 1;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const topStop = atTop ? "0" : "16px";
    const bottomStop = atBottom ? "100%" : "calc(100% - 16px)";
    const mask = `linear-gradient(to bottom, transparent 0, #000 ${topStop}, #000 ${bottomStop}, transparent 100%)`;
    if (mask === this.lastMaskStr) return;
    console.debug("[blink] TicketGrid.scrollMask change", { atTop, atBottom });
    this.lastMaskStr = mask;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  }

  /**
   * Render (or update) the grid from a list of tickets.
   *
   * Signature-based diff: tickets with unchanged `id` + `color` are kept
   * in-place (preserving marks + flip state). New/changed ones rebuild.
   *
   * `liveTicketCount` splits the input array: the first N tickets are the
   * player's active brett for the current round (marked by drawn numbers,
   * NOT cancelable — already paid for). The remaining tickets are the
   * pre-round queue for the next round (cancelable via ×, not markable).
   * Allows us to show both in the same grid during mid-round additive buys.
   */
  setTickets(
    tickets: Ticket[],
    opts: {
      cancelable: boolean;
      entryFee: number;
      state: GameState;
      liveTicketCount?: number;
      /**
       * Tobias-bug 2026-05-13: autoritativ ticket-types fra lobby-runtime
       * catalog. Bruker `priceMultiplier`/`ticketCount` herfra istedenfor
       * `state.ticketTypes` (room:update.gameVariant — 8 legacy-typer som
       * matcher feil med Spill 1 sin (size, color)-modell).
       */
      ticketTypes?: Array<{
        name: string;
        type: string;
        priceMultiplier: number;
        ticketCount: number;
      }>;
    },
  ): void {
    const liveCount = opts.liveTicketCount ?? 0;

    // ── Sortér live-bonger etter "nærmest å fullføre fasen" ─────────────────
    // Tobias 2026-04-26: server sender bonger i kjøps-rekkefølge, men spillere
    // synes det er vanskelig å se hvilken bong som er nærmest å vinne. Vi
    // sorterer KUN live-bonger (index < liveCount). Pre-round-bonger beholder
    // sin original-posisjon (de spiller ikke i nåværende runde).
    //
    // Hvis active-pattern ikke kan klassifiseres til en Spill 1-fase
    // (Spill 3 jubilee, ukjent custom-navn), beholdes server-rekkefølge.
    const orderedTickets = this.applyProgressSort(tickets, opts.state, liveCount);

    const signature = this.computeSignature(orderedTickets, opts.cancelable, liveCount);
    const markSig = this.computeMarkStateSig(opts.state, liveCount);

    if (signature === this.lastSignature) {
      // Same shape — only re-apply marks when the mark-state actually changed.
      // Backend sends room:update ~1.2s/tick; without this short-circuit we
      // iterate every live ticket × every drawn number on every tick.
      //
      // §5.9 IMMUTABLE 2026-05-15: signature inkluderer `l=${liveCount}`
      // i ticket-rom, så cache-hit her impliserer liveCount-i-ticket-rom
      // er uendret. `this.liveCount` (entry-rom, satt av forrige `rebuild`)
      // er fortsatt korrekt og brukes av `applyMarks` til entry-rom
      // iterering.
      if (markSig !== this.lastMarkStateSig) {
        this.applyMarks(opts.state);
        this.lastMarkStateSig = markSig;
      }
      return;
    }
    this.cancelable = opts.cancelable;
    this.rebuild(orderedTickets, opts, liveCount);
    // `rebuild()` setter `this.liveCount` til entry-rom (1 entry = 1 single
    // ELLER 1 triplet, ikke 3 sub-tickets) før vi når dette punktet.
    // Assign signature AFTER rebuild — rebuild() calls clear() which resets
    // lastSignature, so setting it beforehand gets overwritten.
    this.lastSignature = signature;
    this.applyMarks(opts.state);
    this.lastMarkStateSig = markSig;
    this.updateScrollMask();
  }

  /**
   * Returnér en ny array hvor live-bongene (index < liveCount) er sortert
   * etter closeness-til-fullføring. Pre-round-bonger (index ≥ liveCount)
   * beholder sin relative rekkefølge bak live-bongene.
   *
   * Faller tilbake til input-array hvis det ikke er noen live-bonger,
   * eller hvis active-pattern ikke kan klassifiseres til en Spill 1-fase.
   */
  private applyProgressSort(
    tickets: Ticket[],
    state: GameState,
    liveCount: number,
  ): Ticket[] {
    if (liveCount <= 0 || tickets.length === 0) return tickets;
    const activePattern = activePatternFromState(state.patterns, state.patternResults);
    const phase = sortPhaseFromActivePattern(activePattern);
    if (phase === null) return tickets;
    const drawn = new Set(state.drawnNumbers ?? []);
    const live = tickets.slice(0, liveCount);
    const preRound = tickets.slice(liveCount);
    const sortedLive = sortTicketsByProgress(live, drawn, phase);
    return [...sortedLive, ...preRound];
  }

  /** Mark a newly-drawn number across every LIVE ticket. Returns true if at
   *  least one live ticket actually matched — caller gates et one-shot "mark"-
   *  lydeffekt på returverdien.
   *
   *  Pre-round-brett (index ≥ liveCount) ignoreres: de spiller ikke i nåværende
   *  runde og skal ikke ha marks før de blir live ved neste round-start. */
  markNumberOnAll(number: number): boolean {
    let any = false;
    for (let i = 0; i < this.tickets.length; i++) {
      if (i >= this.liveCount) continue;
      if (this.tickets[i].markNumber(number)) any = true;
    }
    return any;
  }

  /** Highlight the player's lucky number on every ticket that contains it. */
  highlightLuckyNumber(number: number): void {
    for (const t of this.tickets) t.highlightLuckyNumber(number);
  }

  /** Reset all tickets' marks. Called on game reset / new round. */
  reset(): void {
    for (const t of this.tickets) t.reset();
  }

  /** Clear all rendered tickets (e.g. during a full state rebuild). */
  clear(): void {
    for (const t of this.tickets) t.destroy();
    this.tickets = [];
    this.ticketById.clear();
    this.gridEl.innerHTML = "";
    this.lastSignature = "__empty__";
    this.lastMarkStateSig = null;
  }

  destroy(): void {
    this.clear();
    this.root.remove();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private computeSignature(tickets: Ticket[], cancelable: boolean, liveCount: number): string {
    // BUG-FIX (Tobias 2026-04-27): in-game tickets har Ticket.id=undefined per
    // shared-types/game.ts:9 ("Absent on in-game tickets"). Hvis flere tickets
    // har samme color+type (typisk: 4 Small Yellow), ble signature IDENTISK
    // uansett rekkefølge — sort-rekkefølge ble derfor aldri reflektert i DOM
    // fordi setTickets()-shortcircuit traff lastSignature===signature.
    //
    // Fix: inkluder grid-fingerprint (første rad) per ticket. Hvert brett har
    // unike numre, så grid[0] gir stabil unik identifikasjon selv uten id.
    const parts = tickets.map((t) => {
      const fingerprint = t.id ?? (t.grid?.[0] ? t.grid[0].join(",") : "_");
      return `${fingerprint}:${t.color ?? "_"}:${t.type ?? "_"}`;
    });
    parts.push(`c=${cancelable ? 1 : 0}`);
    parts.push(`l=${liveCount}`);
    return parts.join("|");
  }

  /** Summerer alt i GameState som påvirker mark-rendering. Backend appender
   *  bare til `drawnNumbers`, så {length, last} er tilstrekkelig uten full
   *  join. Lucky-number og active-pattern-id dekker resten av markerings-
   *  triggerne. PatternResults-endring gir ny active-pattern → ny sig. */
  private computeMarkStateSig(state: GameState, liveCount: number): string {
    const drawn = state.drawnNumbers ?? [];
    const last = drawn.length > 0 ? drawn[drawn.length - 1] : "_";
    const lucky = state.myLuckyNumber ?? "_";
    const active = activePatternFromState(state.patterns, state.patternResults);
    const activeId = active?.id ?? "_";
    return `d=${drawn.length}:${last}|lu=${lucky}|ap=${activeId}|l=${liveCount}`;
  }

  private rebuild(
    tickets: Ticket[],
    opts: { cancelable: boolean; entryFee: number; state: GameState },
    liveCount: number,
  ): void {
    console.debug("[blink] TicketGrid.rebuild", {
      count: tickets.length,
      cancelable: opts.cancelable,
      liveCount,
      prevSig: this.lastSignature,
    });

    // [BUY-DEBUG] Tobias-direktiv 2026-05-13: log hver ticket før render.
    // Dette er SISTE STEG i klient-flyten — det som faktisk vises i UI.
    // Hvis prisen her er "20 kr" mens server sa "15 kr" har vi en
    // klient-side override som må fikses.
    const buyDebugEnabled =
      typeof window !== "undefined" &&
      typeof window.location !== "undefined" &&
      /[?&]debug=1/.test(window.location.search);
    if (buyDebugEnabled) {
      // eslint-disable-next-line no-console
      console.log("[BUY-DEBUG][client][TicketGrid.rebuild][input]", {
        ticketCount: tickets.length,
        liveCount,
        entryFee: opts.entryFee,
        cancelable: opts.cancelable,
        availableTicketTypes:
          opts.state.ticketTypes?.map((t) => ({
            name: t.name,
            type: t.type,
            priceMultiplier: t.priceMultiplier,
            ticketCount: t.ticketCount,
          })) ?? null,
        tickets: tickets.map((t, idx) => {
          const tt = opts.state.ticketTypes?.find((x) => x.type === t.type);
          const computedPrice = this.computePrice(t, opts);
          return {
            idx,
            id: t.id,
            type: t.type,
            color: t.color,
            serverPrice: t.price,
            computedPrice,
            usedServerPrice: typeof t.price === "number",
            resolvedTicketType: tt
              ? {
                  name: tt.name,
                  type: tt.type,
                  priceMultiplier: tt.priceMultiplier,
                  ticketCount: tt.ticketCount,
                }
              : null,
            isLive: idx < liveCount,
          };
        }),
      });
    }

    this.clear();

    // §5.9 IMMUTABLE 2026-05-15: triple-grupperings-flyt for large-bonger.
    //
    // Strategi:
    //   1. Iterer tickets sekvensielt.
    //   2. Hvis ticket har type="large" + gyldig purchaseId, slå opp om de
    //      neste 1-2 tickets i listen har SAMME purchaseId. Hvis 3 totalt
    //      → rendre som triplet. Ellers → faller hver tilbake til single.
    //   3. Backend leverer alle 3 sub-tickets i samme `setTickets`-call
    //      (purchase er atomisk), så look-ahead innenfor `tickets`-arrayet
    //      er trygt.
    //   4. `liveCount` er i ticket-rom (ikke entry-rom). Vi konverterer
    //      til entry-rom ved å summere konsumerte sub-tickets per entry.
    //      Siden purchase er atomisk (alle 3 har samme scheduled_game_id
    //      eller alle 3 er pre-round), kan en triplet ALDRI splittes på
    //      live/pre-round-grensen.
    let consumed = 0;
    let liveEntries = 0;
    while (consumed < tickets.length) {
      const ticket = tickets[consumed];
      const isLive = consumed < liveCount;
      const cancelable = isLive ? false : opts.cancelable;
      const rows = ticket.grid?.length ?? 5;
      const cols = ticket.grid?.[0]?.length ?? 5;

      // Try to group 3 large-tickets with same purchaseId.
      const tripletGroup = this.tryGroupTriplet(tickets, consumed);
      if (tripletGroup !== null) {
        const [t1, t2, t3] = tripletGroup;
        const price = this.computePrice(t1, opts);
        const triplet = new BingoTicketTripletHtml({
          tickets: [t1, t2, t3],
          price,
          rows,
          cols,
          cancelable,
          onCancel: this.onCancelTicket
            ? (purchaseId) => this.onCancelTicket?.(purchaseId)
            : undefined,
        });
        if (!isLive && liveCount > 0) {
          triplet.root.style.opacity = "0.72";
        }
        this.tickets.push(triplet);
        // Map ALL 3 sub-ticket-IDs til samme triplet for future ticket-
        // lookups (eks. en `ticket:replace` på en sub-ticket).
        for (const t of tripletGroup) {
          if (t.id) this.ticketById.set(t.id, triplet);
        }
        this.gridEl.appendChild(triplet.root);
        consumed += 3;
        if (isLive) liveEntries += 1;
        continue;
      }

      // Single-bong fallback: type="small", eller type="large" uten gyldig
      // purchaseId / partial purchase (1-2 av 3 mottatt).
      const price = this.computePrice(ticket, opts);
      const child = new BingoTicketHtml({
        ticket,
        price,
        rows,
        cols,
        cancelable,
        onCancel: this.onCancelTicket ?? undefined,
      });
      if (!isLive && liveCount > 0) {
        child.root.style.opacity = "0.72";
      }
      this.tickets.push(child);
      if (ticket.id) this.ticketById.set(ticket.id, child);
      this.gridEl.appendChild(child.root);
      consumed += 1;
      if (isLive) liveEntries += 1;
    }

    // Re-set liveCount to entry-rom så `markNumberOnAll` itererer korrekt
    // antall live-entries (1 entry = 1 single eller 1 triplet, ikke 3).
    this.liveCount = liveEntries;
  }

  /**
   * §5.9 IMMUTABLE 2026-05-15: forsøk å gruppere 3 etterfølgende tickets
   * med samme `purchaseId` (sortert på `sequenceInPurchase`).
   *
   * Returnerer en tuple `[t1, t2, t3]` hvis alle 3 betingelser oppfylles:
   * - `tickets[startIdx]` har `type="large"` og `purchaseId` satt
   * - `tickets[startIdx+1]` og `tickets[startIdx+2]` finnes med SAMME purchaseId
   *
   * Ellers null (faller tilbake til single-rendering for hver). Vi sorterer
   * IKKE her — backend `Game1ScheduledRoomSnapshot.ts` sender allerede
   * sub-tickets i sequenceInPurchase-rekkefølge per purchase.
   */
  private tryGroupTriplet(
    tickets: Ticket[],
    startIdx: number,
  ): [Ticket, Ticket, Ticket] | null {
    const first = tickets[startIdx];
    if (!first) return null;
    const firstType = (first.type ?? "").toLowerCase();
    if (firstType !== "large") return null;
    const purchaseId = first.purchaseId;
    if (!purchaseId) return null;
    // Trenger 2 til etter `first`.
    if (startIdx + 2 >= tickets.length) return null;
    const second = tickets[startIdx + 1];
    const third = tickets[startIdx + 2];
    if (!second || !third) return null;
    if (second.purchaseId !== purchaseId) return null;
    if (third.purchaseId !== purchaseId) return null;
    return [first, second, third];
  }

  private computePrice(
    ticket: Ticket,
    opts: {
      entryFee: number;
      state: GameState;
      ticketTypes?: Array<{
        name: string;
        type: string;
        priceMultiplier: number;
        ticketCount: number;
      }>;
    },
  ): number {
    // Tobias-bug 2026-05-15 (pre-runde-pris-20-kr-bug):
    //
    // Bug-symptom: spillere som kjøpte Small White + Yellow + Purple (5/10/15
    // kr) FØR runden startet, så ALLE 3 bonger med pris "20 kr". Etter
    // master-start → korrekt pris (5/10/15).
    //
    // Root cause: pre-runde har backend ingen scheduled-game bundet til
    // rommet ennå — `onScheduledGameCreated`-hooken har ikke fyrt fordi
    // master ikke har trykket "Start neste spill". Derfor:
    //   - `roomConfiguredEntryFeeByRoom` er tom for rommet
    //   - `getRoomConfiguredEntryFee` faller tilbake til
    //     `runtimeBingoSettings.autoRoundEntryFee` (env AUTO_ROUND_ENTRY_FEE=20)
    //   - `effectiveConfig` er DEFAULT_NORSK_BINGO_CONFIG der ALLE small_*
    //     har flat `priceMultiplier=1, ticketCount=1`
    //   - `enrichTicketList(list, 20)` setter `t.price = 20 × 1 / 1 = 20`
    //     for ALLE tickets uavhengig av farge
    //
    // Bug-intermittens: etter første master-start binder hookene fee=5 +
    // riktig per-farge variantConfig — disse PERSISTERER in-memory så
    // neste runde i samme rom viser riktige priser. `dev:nuke` eller
    // backend-crash → tilbake til 20-kr-bug for første runde.
    //
    // Fix-strategi: når `opts.ticketTypes` (lobbyTicketConfig fra plan-
    // runtime catalog) finnes OG vi finner matching ticket-type via
    // (color, type)-match, så ER lobby-data autoritativ — den kommer fra
    // server's Game1LobbyService som leser direkte fra `app_game_catalog`
    // (kanonisk pris-kilde per `SPILL_REGLER_OG_PAYOUT.md` §3). Server's
    // `ticket.price` kan være stale (basert på default-variant før master
    // har bundet scheduled-game-data) — vi prioriterer lobby-computed
    // pris i den situasjonen.
    //
    // Fallback-rekkefølge:
    //   1. lobbyTypes-match (autoritativ) → entryFee × multiplier / count
    //   2. ticket.price > 0 (server-side enrichTicketList) → bruk direkte
    //   3. state.ticketTypes-match (legacy room:update.gameVariant) →
    //      entryFee × multiplier / count
    //   4. fallback: entryFee × 1 / 1
    //
    // Hvorfor ikke bare bruke lobby alltid: tester (priceZeroBug §4)
    // sender korrekt server-pris UTEN lobbyTypes som autoritativ kilde —
    // den path-en må fortsatt fungere.
    const lobbyTypes = opts.ticketTypes;
    if (lobbyTypes && lobbyTypes.length > 0) {
      // Match by canonical name (eks: ticket.color "Large White" + type
      // "large" → vi leter etter ticketTypes-entry med samme combo). Pilot-
      // ticket-config bruker navn ("Small Yellow") med type "small"/"large".
      const ticketColor = (ticket.color ?? "").toLowerCase();
      const ticketSize = (ticket.type ?? "").toLowerCase();
      const found = lobbyTypes.find((tt) => {
        const ttName = tt.name.toLowerCase();
        const ttType = tt.type.toLowerCase();
        // Sjekk at både size og color matcher:
        //   ticket.type = "small" / "large"
        //   ticket.color = "Small White" / "Large White" osv.
        const nameContainsColor = ticketColor && ttName.includes(ticketColor);
        const typeMatches = ttType === ticketSize;
        return nameContainsColor && typeMatches;
      });
      if (found) {
        // Lobby-types autoritativ — server's ticket.price ignoreres her
        // selv om den er > 0, fordi lobby er kanonisk pris-kilde fra
        // catalog. Beskytter mot stale ticket.price = 20 fra default-
        // variant-fallback før master har bundet rommet.
        //
        //   Small White:  5 × 1 / 1 = 5 kr  ✓
        //   Small Yellow: 5 × 2 / 1 = 10 kr ✓
        //   Small Purple: 5 × 3 / 1 = 15 kr ✓
        //   Large White:  5 × 3 / 3 = 5 kr per brett  ✓
        const bundlePrice = opts.entryFee * found.priceMultiplier;
        return Math.round(bundlePrice / Math.max(1, found.ticketCount));
      }
      // Lobby-types finnes men matcher ikke denne ticket — kan skje for
      // legacy-tickets uten color/type-data. Fall gjennom til ticket.price
      // eller state.ticketTypes.
    }

    // Tobias-bug 2026-05-14 (priceZeroBug §4): server-pris > 0 brukes
    // direkte når lobby-types ikke ga noe match. Beskytter også mot
    // backend-bug der ticket.price=0 lekker gjennom (priceZeroBug §3).
    if (typeof ticket.price === "number" && ticket.price > 0) {
      return Math.round(ticket.price);
    }

    // Legacy fall-back: state.ticketTypes med type-only match (8 legacy-
    // typer fra room:update.gameVariant).
    const tt = opts.state.ticketTypes?.find((x) => x.type === ticket.type);
    const priceMultiplier = tt?.priceMultiplier ?? 1;
    const ticketCount = Math.max(1, tt?.ticketCount ?? 1);

    // Per-brett pris (det som vises på hvert enkelt brett-kort), ikke
    // bundle-pris. `priceMultiplier` skalerer bundle-pris fra
    // base-entryFee. `ticketCount` er antall brett bundlen utgjør
    // (Small=1 brett, Large=3 brett). Deler vi bundle-pris på ticketCount
    // får vi pris per enkelt brett:
    //   Small Yellow:  entryFee=5, mult=2, count=1 → 5×2/1 = 10 kr ✅
    //   Large Yellow:  entryFee=5, mult=6, count=3 → 5×6/3 = 10 kr ✅
    // Stor og Liten samme per-brett-pris — riktig per Tobias-spec.
    const bundlePrice = opts.entryFee * priceMultiplier;
    return Math.round(bundlePrice / ticketCount);
  }

  private applyMarks(state: GameState): void {
    // Live entries (index < this.liveCount, entry-rom) får ALLTID alle
    // trukne tall applisert. Tidligere versjon prioriterte `state.myMarks[i]`
    // først og falt tilbake til `drawnNumbers` kun hvis myMarks var tom —
    // det ga "tilfeldig marking" når rebuild nullstilte ticket-state og
    // myMarks var ufullstendig (f.eks. rett etter rebuild, eller når backend
    // ikke hadde synket per-ticket-marks). `BingoTicketHtml.markNumber` er
    // idempotent og matcher kun celler som faktisk inneholder tallet, så
    // `drawnNumbers` er trygg autoritativ kilde uansett rebuild-state.
    //
    // Pre-round entries (index ≥ liveCount) forblir umerket — de er preview
    // for neste runde. Eier-beslutning 2026-04-19: "selvfølgelig ikke disse
    // bongene aktive i den trekningen".
    //
    // §5.9 IMMUTABLE 2026-05-15: `this.liveCount` er i ENTRY-rom (1 entry =
    // 1 single eller 1 triplet). Triplet-wrapperen propagerer
    // mark/lucky/active-pattern internt til alle 3 sub-bonger.
    const activePattern = activePatternFromState(state.patterns, state.patternResults);
    const drawn = state.drawnNumbers ?? [];
    for (let i = 0; i < this.tickets.length; i++) {
      const ticket = this.tickets[i];
      const isLive = i < this.liveCount;
      if (isLive) {
        if (drawn.length > 0) ticket.markNumbers(drawn);
        if (state.myLuckyNumber) ticket.highlightLuckyNumber(state.myLuckyNumber);
        ticket.setActivePattern(activePattern);
      } else {
        ticket.setActivePattern(null);
      }
    }
  }
}
