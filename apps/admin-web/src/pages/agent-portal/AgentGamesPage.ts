// Agent-portal — Game Management landing.
//
// Monterer Next-Game-panel direkte — "Game Management" i legacy V1.0-
// wireframe er i praksis Next-Game-panelet (Start Next Game, PAUSE/Resume,
// Force End, Ready/Not-Ready popup, 2-min countdown, Jackpot-confirm).
//
// Videre sub-flows (Register More Tickets, Register Sold Tickets, Check
// for Bingo ticket-popup) kommer i oppfølger-PR-er under samme route-tre.

import { mountNextGamePanel, unmountNextGamePanel } from "./NextGamePanel.js";

export function mountAgentGames(container: HTMLElement): void {
  mountNextGamePanel(container);
}

export function unmountAgentGames(): void {
  unmountNextGamePanel();
}
