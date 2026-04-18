import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";

/**
 * BIN-410 (D3): Inline side-panel for preRound-kjøp under WAITING-fasen.
 *
 * Unity-referanser:
 *   - `Game1GamePlayPanel.UpcomingGames.cs:9-19`  — hovedmetode (UpdateUpcomingGames)
 *   - `Game1GamePlayPanel.UpcomingGames.cs:26-95` — layout-builder
 *   - `Game1UpcomingGameTicketData.cs:29-60`      — data-holder per ticket-type
 *   - `Game1GamePlayPanel.SocketFlow.cs:127, :192` — lukk-trigger (ved RUNNING/ENDED)
 *
 * Design-valg:
 *   - Side-panel (ikke modal). Modal-popupen (`Game1BuyPopup`) reserveres nå for
 *     eksplisitt "Forhåndskjøp"/"Kjøp flere brett"-klikk (Q1 avgjørelse 2026-04-18).
 *   - Skjules automatisk når runde starter (RUNNING) eller når D2-threshold
 *     trigger `disableBuyMore` (Q3 avgjørelse — kjøp er stengt, ingen preRound
 *     heller).
 *   - Vises KUN i WAITING-state — ikke under SPECTATING (Q4 avgjørelse —
 *     Unity viser upcoming-panelet kun mellom runder, ikke mens trekning går).
 *
 * Internt håndhever vi samme 30-vektet-cap som `Game1BuyPopup`: plus-knapp
 * disables når rad-vekten ikke får plass i remaining. Gjenbruker pattern fra
 * PR-3 i stedet for delt modul — popup-kontekst og panel-kontekst har ulik
 * layout og ulike refs.
 */

const MAX_WEIGHTED_TICKETS = 30;

export interface UpcomingPurchaseState {
  entryFee: number;
  ticketTypes: Array<{ name: string; type: string; priceMultiplier: number; ticketCount: number }>;
  alreadyPurchased: number;
  gameName?: string;
}

export interface UpcomingPurchaseOptions {
  overlay: HtmlOverlayManager;
  onArm: (selections: Array<{ type: string; qty: number }>) => void;
}

export class UpcomingPurchase {
  private root: HTMLDivElement;
  private headerTitle: HTMLDivElement;
  private headerSubtitle: HTMLDivElement;
  private typesContainer: HTMLDivElement;
  private totalLabel: HTMLDivElement;
  private statusMsg: HTMLDivElement;
  private armBtn: HTMLButtonElement;

  private onArm: (selections: Array<{ type: string; qty: number }>) => void;
  private alreadyPurchased = 0;
  private typeRows: Array<{
    type: string;
    price: number;
    ticketCount: number;
    qty: number;
    qtyLabel: HTMLSpanElement;
    plusBtn: HTMLButtonElement;
    minusBtn: HTMLButtonElement;
  }> = [];
  private visible = false;

  constructor(opts: UpcomingPurchaseOptions) {
    this.onArm = opts.onArm;

    // Root panel — absolute positioned on the right side (over chat column edge).
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      top: "180px",
      right: "280px",
      width: "320px",
      display: "none",
      flexDirection: "column",
      background: "linear-gradient(180deg, rgba(58,10,10,0.92) 0%, rgba(26,0,0,0.92) 100%)",
      border: "2px solid rgba(121,0,1,0.85)",
      borderRadius: "14px",
      padding: "16px 14px",
      boxSizing: "border-box",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      color: "#fff",
      fontFamily: "inherit",
      zIndex: "45",
      pointerEvents: "auto",
    });
    opts.overlay.getRoot().appendChild(this.root);

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;flex-direction:column;gap:4px;margin-bottom:12px;";
    this.headerTitle = document.createElement("div");
    Object.assign(this.headerTitle.style, {
      fontSize: "14px",
      fontWeight: "700",
      color: "#ffe83d",
      lineHeight: "1.2",
    });
    this.headerTitle.textContent = "Neste spill";
    header.appendChild(this.headerTitle);

    this.headerSubtitle = document.createElement("div");
    Object.assign(this.headerSubtitle.style, {
      fontSize: "12px",
      color: "#ccc",
    });
    this.headerSubtitle.textContent = "";
    header.appendChild(this.headerSubtitle);
    this.root.appendChild(header);

    // Types container (vertical rows, not grid — panel is narrow)
    this.typesContainer = document.createElement("div");
    this.typesContainer.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-bottom:12px;";
    this.root.appendChild(this.typesContainer);

    // Separator
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;background:rgba(255,255,255,0.12);margin:4px 0 10px;";
    this.root.appendChild(sep);

    // Total
    this.totalLabel = document.createElement("div");
    Object.assign(this.totalLabel.style, {
      fontSize: "15px",
      fontWeight: "600",
      color: "#fff",
      textAlign: "center",
      margin: "4px 0 10px",
    });
    this.totalLabel.textContent = "Totalt: 0 kr";
    this.root.appendChild(this.totalLabel);

    // Status
    this.statusMsg = document.createElement("div");
    Object.assign(this.statusMsg.style, {
      fontSize: "12px",
      color: "#ff6b6b",
      textAlign: "center",
      minHeight: "16px",
      margin: "0 0 8px",
    });
    this.root.appendChild(this.statusMsg);

    // Arm (buy) button
    this.armBtn = document.createElement("button");
    this.armBtn.textContent = "Kjøp 0 kr";
    Object.assign(this.armBtn.style, {
      padding: "11px 14px",
      fontSize: "15px",
      fontWeight: "700",
      borderRadius: "9px",
      border: "none",
      background: "linear-gradient(180deg, #c41030 0%, #8a0020 100%)",
      color: "#fff",
      cursor: "pointer",
      textAlign: "center",
      fontFamily: "inherit",
      transition: "opacity 0.15s",
    });
    this.armBtn.disabled = true;
    this.armBtn.style.opacity = "0.5";
    this.armBtn.style.cursor = "default";
    this.armBtn.addEventListener("click", () => this.handleArm());
    this.root.appendChild(this.armBtn);
  }

  /**
   * Render or re-render the panel with a new state snapshot. If the panel is
   * already visible, updates in-place (keeps qty selections). If not visible,
   * just stores state for the next show().
   */
  update(state: UpcomingPurchaseState): void {
    this.alreadyPurchased = Math.max(0, state.alreadyPurchased ?? 0);
    this.headerSubtitle.textContent =
      this.alreadyPurchased > 0
        ? `${state.gameName ?? "Bingo"} — Kjøpt: ${this.alreadyPurchased}`
        : (state.gameName ?? "Bingo");

    // Full rebuild if types have changed (detect by type-list signature).
    const sig = state.ticketTypes.map((t) => t.type).join("|");
    const currentSig = this.typeRows.map((r) => r.type).join("|");
    if (sig !== currentSig) {
      this.typesContainer.innerHTML = "";
      this.typeRows = [];
      for (const tt of state.ticketTypes) {
        const price = Math.round(state.entryFee * tt.priceMultiplier);
        this.buildTypeRow(tt, price);
      }
    } else {
      // Prices may still change (entryFee variant) — refresh in place.
      for (let i = 0; i < this.typeRows.length; i++) {
        const tt = state.ticketTypes[i];
        if (!tt) continue;
        const price = Math.round(state.entryFee * tt.priceMultiplier);
        this.typeRows[i].price = price;
      }
    }

    this.recalc();
  }

  show(state: UpcomingPurchaseState): void {
    this.update(state);
    if (this.typeRows.length === 0) {
      // Nothing to show — don't render an empty panel.
      this.root.style.display = "none";
      this.visible = false;
      return;
    }
    this.root.style.display = "flex";
    this.visible = true;
  }

  hide(): void {
    this.root.style.display = "none";
    this.visible = false;
  }

  isShowing(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.root.remove();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private buildTypeRow(
    tt: { name: string; type: string; ticketCount: number },
    price: number,
  ): void {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      padding: "8px 10px",
      background: "rgba(0,0,0,0.3)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "8px",
    });

    const info = document.createElement("div");
    info.style.cssText = "display:flex;flex-direction:column;min-width:0;flex:1;";
    const nameEl = document.createElement("div");
    nameEl.textContent = tt.ticketCount > 1 ? `${tt.name} (${tt.ticketCount} brett)` : tt.name;
    Object.assign(nameEl.style, {
      fontSize: "13px",
      fontWeight: "600",
      color: "#fff",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    info.appendChild(nameEl);
    const priceEl = document.createElement("div");
    priceEl.textContent = `${price} kr`;
    Object.assign(priceEl.style, { fontSize: "11px", color: "#aaa" });
    info.appendChild(priceEl);
    row.appendChild(info);

    const qtyRow = document.createElement("div");
    qtyRow.style.cssText = "display:flex;align-items:center;gap:6px;";

    const minusBtn = this.createRoundBtn("\u2212");
    const qtyLabel = document.createElement("span");
    qtyLabel.textContent = "0";
    Object.assign(qtyLabel.style, {
      fontSize: "16px",
      fontWeight: "700",
      color: "#fff",
      minWidth: "20px",
      textAlign: "center",
    });
    const plusBtn = this.createRoundBtn("+");

    qtyRow.appendChild(minusBtn);
    qtyRow.appendChild(qtyLabel);
    qtyRow.appendChild(plusBtn);
    row.appendChild(qtyRow);

    const entry = {
      type: tt.type,
      price,
      ticketCount: tt.ticketCount,
      qty: 0,
      qtyLabel,
      plusBtn,
      minusBtn,
    };
    this.typeRows.push(entry);

    minusBtn.addEventListener("click", () => {
      if (entry.qty > 0) {
        entry.qty--;
        qtyLabel.textContent = String(entry.qty);
        this.recalc();
      }
    });
    plusBtn.addEventListener("click", () => {
      if (plusBtn.disabled) return;
      entry.qty++;
      qtyLabel.textContent = String(entry.qty);
      this.recalc();
    });

    this.typesContainer.appendChild(row);
  }

  private recalc(): void {
    const total = this.typeRows.reduce((sum, r) => sum + r.qty * r.price, 0);
    const weightedSelected = this.typeRows.reduce((sum, r) => sum + r.qty * r.ticketCount, 0);
    const remaining = MAX_WEIGHTED_TICKETS - this.alreadyPurchased - weightedSelected;
    const atHardCap = this.alreadyPurchased >= MAX_WEIGHTED_TICKETS;

    this.totalLabel.textContent = `Totalt: ${total} kr`;

    for (const row of this.typeRows) {
      const disable = atHardCap || row.ticketCount > remaining;
      row.plusBtn.disabled = disable;
      row.plusBtn.style.opacity = disable ? "0.35" : "1";
      row.plusBtn.style.cursor = disable ? "not-allowed" : "pointer";
    }

    if (atHardCap) {
      this.statusMsg.style.color = "#ffe83d";
      this.statusMsg.textContent = "Maks 30 brett nådd";
      this.armBtn.disabled = true;
      this.armBtn.style.opacity = "0.5";
      this.armBtn.style.cursor = "default";
      this.armBtn.textContent = "Maks nådd";
      return;
    }

    if (weightedSelected === 0) {
      this.statusMsg.textContent = "";
      this.armBtn.disabled = true;
      this.armBtn.style.opacity = "0.5";
      this.armBtn.style.cursor = "default";
      this.armBtn.textContent = "Kjøp 0 kr";
      return;
    }

    if (remaining === 0) {
      this.statusMsg.style.color = "#81c784";
      this.statusMsg.textContent = "Maks 30 valgt";
    } else {
      this.statusMsg.textContent = "";
    }
    this.armBtn.disabled = false;
    this.armBtn.style.opacity = "1";
    this.armBtn.style.cursor = "pointer";
    this.armBtn.textContent = `Kjøp ${total} kr`;
  }

  private handleArm(): void {
    if (this.armBtn.disabled) return;
    const selections = this.typeRows
      .filter((r) => r.qty > 0)
      .map((r) => ({ type: r.type, qty: r.qty }));
    if (selections.length === 0) return;
    this.onArm(selections);
  }

  private createRoundBtn(text: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    Object.assign(btn.style, {
      width: "28px",
      height: "28px",
      borderRadius: "50%",
      border: "1.5px solid rgba(255,255,255,0.3)",
      background: "rgba(255,255,255,0.08)",
      color: "#fff",
      fontSize: "16px",
      fontWeight: "700",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "background 0.15s, opacity 0.15s",
      fontFamily: "inherit",
      padding: "0",
      lineHeight: "1",
    });
    btn.addEventListener("mouseenter", () => {
      if (!btn.disabled) btn.style.background = "rgba(255,255,255,0.18)";
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.disabled) btn.style.background = "rgba(255,255,255,0.08)";
    });
    return btn;
  }
}
