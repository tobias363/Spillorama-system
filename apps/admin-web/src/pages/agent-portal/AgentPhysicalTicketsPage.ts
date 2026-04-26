// Agent-portal — Add Physical Ticket.
//
// Wireframe: docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf §17.13/17.22
//
// Bruker den allerede portede `renderAddPage` (PR-B3 / BIN-613) som støtter
// både ADMIN (multi-hall + valgmeny) og AGENT/HALL_OPERATOR (auto-scope til
// egen hall via `operatorHallId`). Den siden eier:
//   - Batch-CRUD (range_start/range_end + default_price + valgfri game-binding)
//   - Generate-knapp som materialiserer tickets i app_physical_tickets
//   - CSV-import for statiske inventar-batcher (PT1)
//   - "Last registered ID"-felt (scanner-hjelp)
//
// Note: V1.0-wireframen i §17.13 viser i tillegg en "Tickets Sold"-kolonne
// per ticket-type. Det er en runtime-stat fra game-engine og live-merker;
// følger i en oppfølger-PR (TODO under). I pilot kjører bingoverten flyten
// via `renderAddPage` (oppretter batchene) og `RegisterSoldTicketsModal`
// (markerer solgte før neste runde) — to separate skjermer som dekker
// samme legacy-flyt.

import { renderAddPage } from "../physical-tickets/AddPage.js";

export function mountAgentPhysicalTickets(container: HTMLElement): void {
  // TODO (BIN-pilot-PR): Vurder å pakke renderAddPage med agent-spesifikk
  //   header (breadcrumb til /agent/dashboard) + "Tickets Sold"-kolonnen
  //   fra V1.0 wireframe §17.13. Foreløpig holder vi 1:1-paritet med
  //   admin-versjonen siden hall-scoping allerede er på plass.
  renderAddPage(container);
}
