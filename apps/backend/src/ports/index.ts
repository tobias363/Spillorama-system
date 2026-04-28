/**
 * Unified pipeline refactor — Fase 0 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Barrel-eksport for ports + InMemory-implementasjoner.
 *
 * Eksisterende production-adaptere (PostgresWalletAdapter,
 * ComplianceLedger, AuditLogService, PlatformService) implementerer
 * IKKE disse portene ennå — det kommer i Fase 1 via tynne
 * adapter-wrappers (`WalletAdapterPort`, `ComplianceAdapterPort` osv.).
 *
 * I Fase 0 brukes portene kun av:
 * - Invariant-tester (apps/backend/src/__tests__/invariants/) som
 *   konstruerer InMemory-implementasjonene.
 * - Senere Fase 1+ services (PayoutService, DrawingService, ...).
 */

// Port-interfaces
export * from "./AuditPort.js";
export * from "./ClockPort.js";
export * from "./CompliancePort.js";
export * from "./HallPort.js";
export * from "./IdempotencyKeyPort.js";
export * from "./WalletPort.js";

// InMemory-implementasjoner
export { InMemoryAuditPort } from "./inMemory/InMemoryAuditPort.js";
export { FakeClockPort, SystemClockPort } from "./inMemory/InMemoryClockPort.js";
export { InMemoryCompliancePort } from "./inMemory/InMemoryCompliancePort.js";
export { InMemoryHallPort } from "./inMemory/InMemoryHallPort.js";
export { InMemoryWalletPort } from "./inMemory/InMemoryWalletPort.js";
