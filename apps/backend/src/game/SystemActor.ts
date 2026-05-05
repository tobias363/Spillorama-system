/**
 * SystemActor — sentinel-id for server-driven engine-mutasjoner.
 *
 * Bakgrunn (audit §2.1, §2.6 — SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05):
 * Spill 2/3 (perpetual-rom) har ingen master-rolle — runden starter, trekker
 * og slutter helt automatisk via cron-tick + perpetual-loop. Likevel har
 * `BingoEngine.startGame/endGame/drawNextNumber` arvet en `actorPlayerId`-
 * parameter fra Spill 1's master-flow, og PR #942 introduserte en slug-
 * conditional bypass av `assertHost` for å holde flyten i gang.
 *
 * Slug-bypass er per-call-site og dekker derfor IKKE alle innganger
 * (`game:end`-handler, `claim:submit`, framtidige call-sites). En ondsinnet
 * spiller kan fortsatt sende `game:end` med egen `playerId` og brikke et
 * 1500-spillers-rom på sekunder.
 *
 * Fix: innfør et eksplisitt **system-actor**-konsept. System-driven kall
 * (auto-draw-tick, perpetual-loop, boot-sweep, admin-routes) bruker
 * `SYSTEM_ACTOR_ID` istedenfor en stale `hostPlayerId`. `assertHost`
 * tillater system-actor for perpetual-rom; for Spill 1 (master-flow) kreves
 * fortsatt at `actorPlayerId === room.hostPlayerId`.
 *
 * SIKKERHET:
 *   - `SYSTEM_ACTOR_ID` MÅ aldri komme fra klient.
 *   - Alle socket-/HTTP-handlers som leser `actorPlayerId` fra payload MÅ
 *     avvise denne sentinel-en eksplisitt (FORBIDDEN), uavhengig av rommets
 *     slug. Klient skal aldri kunne utgi seg som system.
 *   - Verdien er bevisst valgt slik at den ikke kan oppstå som en gyldig
 *     UUID/playerId i prod (`__system_actor__` med dobbelt understreker).
 */

export const SYSTEM_ACTOR_ID = "__system_actor__" as const;

/**
 * Returnerer true hvis `id` er sentinel-en for system-driven kall.
 *
 * Brukes i to scenarier:
 *   1. ACL-laget i `assertHost`: tillat skip for perpetual-rom når actor er system.
 *   2. Socket-/HTTP-handlers: avvis hvis klient prøver å sende denne i payload.
 */
export function isSystemActor(id: string | null | undefined): boolean {
  return id === SYSTEM_ACTOR_ID;
}
