/**
 * Task 1.4 (2026-04-24): enhetstester for Spill 1 agent-kontrollpanel.
 *
 * Fokuserer på state-matrise rundt knappe-disabling — orthogonal til
 * NextGamePanel-testene som verifiserer integrasjon.
 */

import { describe, it, expect } from "vitest";
import { renderSpill1AgentControls } from "../src/pages/agent-portal/Spill1AgentControls.js";
import { renderSpill1AgentStatus } from "../src/pages/agent-portal/Spill1AgentStatus.js";
import type { Spill1CurrentGame, Spill1CurrentGameHall } from "../src/api/agent-game1.js";

function makeGame(overrides: Partial<Spill1CurrentGame> = {}): Spill1CurrentGame {
  return {
    id: "g1",
    status: "purchase_open",
    masterHallId: "hall-master",
    groupHallId: "grp-1",
    participatingHallIds: ["hall-master", "hall-slave"],
    subGameName: "Kvikkis",
    customGameName: null,
    scheduledStartTime: "2026-04-24T10:00:00Z",
    scheduledEndTime: "2026-04-24T11:00:00Z",
    actualStartTime: null,
    actualEndTime: null,
    ...overrides,
  };
}

function mountFragment(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("Spill1AgentControls", () => {
  it("master-agent + purchase_open + allReady → start-knapp aktiv", () => {
    const html = renderSpill1AgentControls({
      currentGame: makeGame({ status: "purchase_open" }),
      isMasterAgent: true,
      allReady: true,
      excludedHallIds: [],
    });
    const root = mountFragment(html);
    const startBtn = root.querySelector<HTMLButtonElement>(
      "[data-marker='spill1-start-btn']"
    );
    expect(startBtn).toBeTruthy();
    expect(startBtn?.disabled).toBe(false);
  });

  it("master-agent + purchase_open + NOT allReady → start disabled", () => {
    const html = renderSpill1AgentControls({
      currentGame: makeGame({ status: "purchase_open" }),
      isMasterAgent: true,
      allReady: false,
      excludedHallIds: [],
    });
    const root = mountFragment(html);
    const startBtn = root.querySelector<HTMLButtonElement>(
      "[data-marker='spill1-start-btn']"
    );
    expect(startBtn?.disabled).toBe(true);
  });

  it("master-agent + ready_to_start → start alltid aktiv (independent of allReady)", () => {
    const html = renderSpill1AgentControls({
      currentGame: makeGame({ status: "ready_to_start" }),
      isMasterAgent: true,
      allReady: false,
      excludedHallIds: [],
    });
    const root = mountFragment(html);
    const startBtn = root.querySelector<HTMLButtonElement>(
      "[data-marker='spill1-start-btn']"
    );
    expect(startBtn?.disabled).toBe(false);
  });

  it("master-agent + paused → resume aktiv, start disabled", () => {
    const html = renderSpill1AgentControls({
      currentGame: makeGame({ status: "paused" }),
      isMasterAgent: true,
      allReady: true,
      excludedHallIds: [],
    });
    const root = mountFragment(html);
    expect(
      root.querySelector<HTMLButtonElement>("[data-marker='spill1-start-btn']")
        ?.disabled
    ).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>("[data-marker='spill1-resume-btn']")
        ?.disabled
    ).toBe(false);
  });

  it("master-agent + running → begge disabled (ingen naturlige actions her)", () => {
    const html = renderSpill1AgentControls({
      currentGame: makeGame({ status: "running" }),
      isMasterAgent: true,
      allReady: true,
      excludedHallIds: [],
    });
    const root = mountFragment(html);
    expect(
      root.querySelector<HTMLButtonElement>("[data-marker='spill1-start-btn']")
        ?.disabled
    ).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>("[data-marker='spill1-resume-btn']")
        ?.disabled
    ).toBe(true);
  });

  it("slave-agent viser kun master-notice, ingen knapper", () => {
    const html = renderSpill1AgentControls({
      currentGame: makeGame(),
      isMasterAgent: false,
      allReady: true,
      excludedHallIds: [],
    });
    const root = mountFragment(html);
    expect(root.querySelector("[data-marker='spill1-slave-notice']")).toBeTruthy();
    expect(
      root.querySelector("[data-marker='spill1-start-btn']")
    ).toBeNull();
    expect(
      root.querySelector("[data-marker='spill1-resume-btn']")
    ).toBeNull();
  });

  it("ekskluderte haller vises i excluded-notice for master", () => {
    const html = renderSpill1AgentControls({
      currentGame: makeGame(),
      isMasterAgent: true,
      allReady: true,
      excludedHallIds: ["hall-2", "hall-3"],
    });
    const root = mountFragment(html);
    const notice = root.querySelector<HTMLElement>(
      "[data-marker='spill1-excluded-notice']"
    );
    expect(notice?.textContent).toContain("hall-2");
    expect(notice?.textContent).toContain("hall-3");
  });
});

describe("Spill1AgentStatus", () => {
  const halls: Spill1CurrentGameHall[] = [
    {
      hallId: "hall-master",
      hallName: "Master",
      isReady: true,
      readyAt: "2026-04-24T09:55:00Z",
      digitalTicketsSold: 10,
      physicalTicketsSold: 5,
      excludedFromGame: false,
      excludedReason: null,
    },
    {
      hallId: "hall-slave",
      hallName: "Slave",
      isReady: false,
      readyAt: null,
      digitalTicketsSold: 0,
      physicalTicketsSold: 0,
      excludedFromGame: false,
      excludedReason: null,
    },
  ];

  it("rendrer display-navn (custom overstyrer sub_game_name)", () => {
    const html = renderSpill1AgentStatus({
      currentGame: makeGame({ customGameName: "Min-runde" }),
      halls,
      hallId: "hall-master",
      isMasterAgent: true,
      allReady: false,
    });
    const root = mountFragment(html);
    expect(root.textContent).toContain("Min-runde");
  });

  it("viser master-hall-ID og (deg)-markering når agent er i master", () => {
    const html = renderSpill1AgentStatus({
      currentGame: makeGame(),
      halls,
      hallId: "hall-master",
      isMasterAgent: true,
      allReady: false,
    });
    const root = mountFragment(html);
    expect(root.textContent).toContain("(deg)");
  });

  it("viser ikke (deg)-markering når agent er i deltaker-hall", () => {
    const html = renderSpill1AgentStatus({
      currentGame: makeGame(),
      halls,
      hallId: "hall-slave",
      isMasterAgent: false,
      allReady: false,
    });
    const root = mountFragment(html);
    expect(root.textContent).not.toContain("(deg)");
    expect(root.querySelector("[data-marker='spill1-role-slave']")).toBeTruthy();
  });

  it("status-badge viser riktig klasse for running", () => {
    const html = renderSpill1AgentStatus({
      currentGame: makeGame({ status: "running" }),
      halls,
      hallId: "hall-master",
      isMasterAgent: true,
      allReady: true,
    });
    const root = mountFragment(html);
    const badge = root.querySelector("[data-field='spill1-status-badge']");
    expect(badge?.className).toContain("label-success");
  });
});
