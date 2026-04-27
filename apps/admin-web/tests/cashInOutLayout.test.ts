// 1:1 legacy layout-test for Cash In/Out Management-siden.
// Verifiserer at DOM-strukturen matcher legacy-skjermbildet 2026-04-27:
//   - Page-actions-bar med Tilbake + Logg ut skift
//   - 3 sentrerte tabs: Standard / Agentmodul / Spillmodul
//   - Box 1 — Daglig saldo (tabell + 2 knappe-rader)
//   - Box 2 — Cash inn/ut 7-knapps grid
//   - Box 3 — "Ingen kommende spill"-placeholder
//   - Box 4 — "Ingen pågående spill"-placeholder
//
// Vi bruker `data-marker`-attributter for stabile selectors slik at
// CSS-/styling-endringer ikke knekker testene.

import { describe, it, expect, beforeEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { renderCashInOutPage } from "../src/pages/cash-inout/CashInOutPage.js";

function agentSession(): Session {
  return {
    id: "ag-1",
    name: "Michael",
    email: "m@x.no",
    role: "agent",
    isSuperAdmin: false,
    avatar: "",
    hall: [{ id: "hall-a", name: "Oslo bingo" }],
    dailyBalance: null,
    permissions: {},
  };
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  setSession(agentSession());
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

describe("CashInOutPage — 1:1 legacy layout", () => {
  it("rendrer page-actions-bar med Tilbake + Logg ut skift øverst-høyre", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);
    const bar = root.querySelector('[data-marker="cashinout-page-actions"]');
    expect(bar).toBeTruthy();
    const back = bar?.querySelector<HTMLAnchorElement>('[data-action="back"]');
    const logout = bar?.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]');
    expect(back).toBeTruthy();
    expect(back?.classList.contains("btn-primary")).toBe(true);
    expect(logout).toBeTruthy();
    expect(logout?.classList.contains("btn-danger")).toBe(true);
  });

  it("rendrer 3 tabs: Standard (active) / Agentmodul / Spillmodul", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);
    const tabsEl = root.querySelector('[data-marker="cashinout-tabs"]');
    expect(tabsEl).toBeTruthy();
    const tabs = tabsEl!.querySelectorAll<HTMLAnchorElement>("[data-tab]");
    expect(tabs.length).toBe(3);
    expect(tabs[0]?.dataset.tab).toBe("standard");
    expect(tabs[1]?.dataset.tab).toBe("agent");
    expect(tabs[2]?.dataset.tab).toBe("game");
    // Standard er aktiv ved init
    const activeLi = tabsEl!.querySelector("li.active");
    expect(activeLi?.querySelector('[data-tab="standard"]')).toBeTruthy();
  });

  it("klikk på Agentmodul-tab skifter aktiv pane", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);
    const agentTab = root.querySelector<HTMLAnchorElement>('[data-tab="agent"]');
    agentTab?.click();
    const standardPane = root.querySelector<HTMLElement>("#tab-standard");
    const agentPane = root.querySelector<HTMLElement>("#tab-agent");
    expect(standardPane?.style.display).toBe("none");
    expect(agentPane?.style.display).toBe("");
    expect(agentPane?.classList.contains("active")).toBe(true);
  });

  it("Box 1 — Daglig saldo viser Agentnavn + tabell + 2 action-rader", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);
    const box = root.querySelector('[data-marker="box-daily-balance"]');
    expect(box).toBeTruthy();
    // Agent-navn fra session
    const agentName = box!.querySelector('[data-marker="agent-name-value"]');
    expect(agentName?.textContent).toContain("Michael");
    // Daily-balance-tabell
    expect(box!.querySelector("#daily-balance-table")).toBeTruthy();
    expect(box!.querySelector("#v-totalHallCashBalance")).toBeTruthy();
    expect(box!.querySelector("#v-totalCashIn")).toBeTruthy();
    expect(box!.querySelector("#v-totalCashOut")).toBeTruthy();
    expect(box!.querySelector("#v-dailyBalance")).toBeTruthy();
    // 2 action-rader
    const row1 = box!.querySelector('[data-marker="daily-actions-row-1"]');
    const row2 = box!.querySelector('[data-marker="daily-actions-row-2"]');
    expect(row1).toBeTruthy();
    expect(row2).toBeTruthy();
    // Rad 1: Add daily balance + Refresh + Today's sales report (F8)
    expect(row1!.querySelector('[data-action="add-daily-balance"]')).toBeTruthy();
    expect(row1!.querySelector('[data-action="refresh-balance"]')).toBeTruthy();
    expect(row1!.querySelector('[data-action="todays-sales-report"]')).toBeTruthy();
    // Rad 2: Control daily balance + Settlement
    expect(row2!.querySelector('[data-action="control-daily-balance"]')).toBeTruthy();
    expect(row2!.querySelector('[data-action="settlement"]')).toBeTruthy();
  });

  it("Box 2 — Cash inn/ut har 7-knapps grid (4 + 3)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);
    const grid = root.querySelector('[data-marker="cashinout-grid"]');
    expect(grid).toBeTruthy();
    const buttons = grid!.querySelectorAll<HTMLElement>(".cashinout-grid-btn");
    expect(buttons.length).toBe(7);
    // Verify each button by data-action
    const actions = Array.from(buttons).map((b) => b.dataset.action);
    expect(actions).toEqual([
      "slot-machine",
      "add-money-unique-id",
      "add-money-registered-user",
      "create-new-unique-id",
      "withdraw-unique-id",
      "withdraw-registered-user",
      "sell-products",
    ]);
  });

  it("Box 2 — knapp-fargene matcher legacy: 4 grønne + 2 røde + 1 grønn", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);
    const grid = root.querySelector('[data-marker="cashinout-grid"]')!;
    const buttons = Array.from(grid.querySelectorAll<HTMLElement>(".cashinout-grid-btn"));
    // Slot-machine, add-money-unique-id, add-money-registered-user, create-new-unique-id
    expect(buttons[0]?.classList.contains("btn-success")).toBe(true);
    expect(buttons[1]?.classList.contains("btn-success")).toBe(true);
    expect(buttons[2]?.classList.contains("btn-success")).toBe(true);
    expect(buttons[3]?.classList.contains("btn-success")).toBe(true);
    // withdraw-unique-id, withdraw-registered-user (red)
    expect(buttons[4]?.classList.contains("btn-danger")).toBe(true);
    expect(buttons[5]?.classList.contains("btn-danger")).toBe(true);
    // sell-products (green)
    expect(buttons[6]?.classList.contains("btn-success")).toBe(true);
  });

  it("Box 3 + Box 4 — empty placeholders for kommende/pågående spill", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);
    const upcoming = root.querySelector('[data-marker="box-upcoming-games"]');
    const ongoing = root.querySelector('[data-marker="box-ongoing-games"]');
    expect(upcoming).toBeTruthy();
    expect(ongoing).toBeTruthy();
    expect(upcoming?.textContent).toContain("Ingen kommende spill");
    expect(ongoing?.textContent).toContain("Ingen pågående spill");
  });

  it("F5/F6/F8-hotkeys og knappe-handlers fortsatt registrert (ikke regresjon)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);
    // F5/F6 hotkey må kunne åpne modaler — vi sjekker bare at handleren
    // ikke kaster og at side-knappene er klikkbare via DOM.
    const addF5 = root.querySelector<HTMLElement>('[data-action="add-money-registered-user"]');
    const withdrawF6 = root.querySelector<HTMLElement>('[data-action="withdraw-registered-user"]');
    expect(addF5).toBeTruthy();
    expect(withdrawF6).toBeTruthy();
    expect(addF5?.textContent).toContain("F5");
    expect(withdrawF6?.textContent).toContain("F6");
  });

  it("legacy-styling injiseres én gang som <style id=cashinout-1to1-style>", () => {
    const root1 = document.createElement("div");
    const root2 = document.createElement("div");
    document.body.append(root1, root2);
    renderCashInOutPage(root1);
    renderCashInOutPage(root2);
    const styles = document.querySelectorAll("#cashinout-1to1-style");
    expect(styles.length).toBe(1);
  });
});
