/**
 * Unified pipeline refactor — Fase 0 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Narrow port for hall-oppslag som game-pipelinen trenger.
 *
 * Erstatter direkte avhengigheter på `PlatformService` (apps/backend/src/
 * platform/PlatformService.ts) i game-pipelinen. PayoutService /
 * MasterCoordinationService skal kun kunne lese hall-metadata + sjekke
 * test-hall-bypass — ikke skrive eller slette.
 *
 * Bug-bakgrunn (PILOT-STOP-SHIP 2026-04-28):
 *   `isTestHall`-bug-mønsteret denne uken (#660, #671, #677) skyldes at
 *   hall-tier-flagget måtte propageres gjennom 3-5 call-sites manuelt.
 *   Med denne porten blir `isTestHall(hallId)` ÉN funksjon som services
 *   spør på direkte i stedet for å videresende et boolean parameter.
 *
 * Implementasjoner:
 * - `InMemoryHallPort` (Fase 0) — for invariant-tester. Map<hallId, Hall>.
 * - `HallAdapterPort` (Fase 1) — wrapper rundt `PlatformService.listHalls()`
 *   eller direkte mot Postgres.
 */

import type { HallDefinition } from "../platform/PlatformService.js";
import type { HallGroup as HallGroupDef } from "../admin/HallGroupService.js";

/**
 * Hall-shape som game-pipelinen får eksponert. Subset av `HallDefinition`
 * som inkluderer kun feltene services trenger (id, navn, isTestHall,
 * isActive). Eksponering av hele `HallDefinition` ville skape unødvendig
 * kobling til admin/CRUD-feltene.
 */
export interface Hall {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  /**
   * Demo Hall bypass-flagg. TRUE = engine skal bypasse "stop on first
   * pattern" / auto-pause på phase-won. Kun for lokal testing.
   */
  isTestHall: boolean;
}

/**
 * Hall-gruppe-shape for multi-hall-koordinering. Subset av `HallGroupDef`.
 * `memberHallIds` er en flat liste av hall-ID-er som tilhører gruppen.
 */
export interface HallGroup {
  id: string;
  name: string;
  memberHallIds: string[];
}

export interface HallPort {
  /**
   * Hent en hall pr id. Returnerer `null` hvis hallId ikke finnes
   * (ikke kast — caller velger hva som er passende feilmelding).
   */
  getHall(hallId: string): Promise<Hall | null>;

  /**
   * Hent hall-gruppen som inneholder `hallId`. Returnerer `null` hvis
   * hallen ikke er medlem av noen gruppe (single-hall-spill).
   */
  getGroupForHall(hallId: string): Promise<HallGroup | null>;

  /**
   * Sjekk om en hall er en test-hall. Returnerer FALSE hvis hallId
   * ikke finnes (defensiv: ukjent hall = produksjon = ingen bypass).
   */
  isTestHall(hallId: string): Promise<boolean>;
}

/**
 * Internal helper — mapper en `HallDefinition` til den smale `Hall`-typen
 * som porten eksponerer. Brukes av Fase 1-adapteren; eksponert her så
 * test-fixtures også kan bruke samme mapping.
 */
export function mapHallDefinitionToPortHall(def: HallDefinition): Hall {
  return {
    id: def.id,
    slug: def.slug,
    name: def.name,
    isActive: def.isActive,
    isTestHall: def.isTestHall === true,
  };
}

/**
 * Internal helper — mapper en `HallGroupDef` til den smale `HallGroup`-typen
 * som porten eksponerer.
 */
export function mapHallGroupDefToPortGroup(def: HallGroupDef): HallGroup {
  return {
    id: def.id,
    name: def.name,
    memberHallIds: def.members.map((m) => m.hallId),
  };
}
