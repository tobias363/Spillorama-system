/**
 * Game plan (spilleplan) panel — shows today's scheduled games for the hall.
 *
 * Fetches schedule from GET /api/halls/:hallId/schedule and displays
 * each slot with game name, time, variant type, and action buttons.
 *
 * - PrefabGamePlan1Ticket.cs — game plan card with OnBuyButtonTap / OnPlayButtonTap
 * - Game1GamePlayPanel.UpcomingGames.cs — upcoming game ticket purchase UI
 */

interface ScheduleSlot {
  id: string;
  gameType: string;
  displayName: string;
  startTime: string;
  prizeDescription: string;
  maxTickets: number;
  variantConfig: Record<string, unknown>;
}

export class GamePlanPanel {
  private backdrop: HTMLDivElement;
  private listEl: HTMLDivElement;
  private onBuy: ((slot: ScheduleSlot) => void) | null = null;

  constructor(container: HTMLElement) {
    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.9)",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      padding: "24px",
      zIndex: "65",
      pointerEvents: "auto",
      overflow: "auto",
    });
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.hide();
    });
    container.appendChild(this.backdrop);

    // Panel
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "linear-gradient(180deg, #2a1a0a 0%, #1a0a00 100%)",
      border: "2px solid rgba(255,200,100,0.3)",
      borderRadius: "16px",
      padding: "24px",
      maxWidth: "500px",
      width: "100%",
      maxHeight: "80vh",
      overflow: "auto",
    });
    this.backdrop.appendChild(panel);

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;";
    const title = document.createElement("h3");
    title.textContent = "Dagens spilleplan";
    title.style.cssText = "color:#ffe83d;font-size:20px;font-weight:700;margin:0;";
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Lukk spilleplan");
    closeBtn.title = "Lukk";
    closeBtn.textContent = "\u2715";
    closeBtn.style.cssText = "background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:50%;width:32px;height:32px;color:#fff;font-size:16px;cursor:pointer;font-family:inherit;";
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Game list
    this.listEl = document.createElement("div");
    this.listEl.style.cssText = "display:flex;flex-direction:column;gap:10px;";
    panel.appendChild(this.listEl);
  }

  setOnBuy(callback: (slot: ScheduleSlot) => void): void {
    this.onBuy = callback;
  }

  async show(hallId: string, apiBase: string): Promise<void> {
    this.listEl.innerHTML = '<div style="color:#999;text-align:center;padding:20px;">Laster spilleplan...</div>';
    this.backdrop.style.display = "flex";

    try {
      const token = localStorage.getItem("spillorama_token") ?? "";
      const res = await fetch(`${apiBase}/api/halls/${hallId}/schedule`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const slots: ScheduleSlot[] = data.data ?? data ?? [];
      this.renderSlots(slots);
    } catch (err) {
      this.listEl.innerHTML = '<div style="color:#ff6b6b;text-align:center;padding:20px;">Kunne ikke laste spilleplan</div>';
    }
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  destroy(): void {
    this.backdrop.remove();
  }

  private renderSlots(slots: ScheduleSlot[]): void {
    this.listEl.innerHTML = "";

    if (slots.length === 0) {
      this.listEl.innerHTML = '<div style="color:#999;text-align:center;padding:20px;">Ingen spill planlagt i dag</div>';
      return;
    }

    for (const slot of slots) {
      const card = document.createElement("div");
      Object.assign(card.style, {
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "10px",
        padding: "14px 16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      });

      // Info column
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.textContent = slot.displayName;
      name.style.cssText = "color:#fff;font-size:16px;font-weight:600;margin-bottom:4px;";
      info.appendChild(name);

      const details = document.createElement("div");
      details.style.cssText = "color:#aaa;font-size:13px;";
      const variantLabel = slot.gameType === "elvis" ? "Elvis" : slot.gameType === "traffic-light" ? "Traffic Light" : "Standard";
      details.textContent = `${slot.startTime} \u00b7 ${variantLabel} \u00b7 Maks ${slot.maxTickets} brett`;
      info.appendChild(details);

      if (slot.prizeDescription) {
        const prize = document.createElement("div");
        prize.textContent = slot.prizeDescription;
        prize.style.cssText = "color:#ffe83d;font-size:12px;margin-top:2px;";
        info.appendChild(prize);
      }

      card.appendChild(info);

      // Buy button
      const buyBtn = document.createElement("button");
      buyBtn.textContent = "Kjøp";
      Object.assign(buyBtn.style, {
        background: "linear-gradient(180deg, #c41030, #8a0020)",
        border: "none",
        borderRadius: "8px",
        padding: "8px 18px",
        color: "#fff",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer",
        fontFamily: "inherit",
        flexShrink: "0",
      });
      buyBtn.addEventListener("click", () => this.onBuy?.(slot));
      card.appendChild(buyBtn);

      this.listEl.appendChild(card);
    }
  }
}
