/**
 * Unified pipeline refactor — Fase 1 adapter-bridges
 * (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Barrel-eksport for adapter-wrappers som kobler eksisterende prod-
 * infrastruktur til Fase 0-portene. Bruk:
 *
 * ```ts
 * import {
 *   AuditAdapterPort,
 *   ComplianceAdapterPort,
 *   WalletAdapterPort,
 * } from "./adapters/index.js";
 *
 * const service = new PayoutService({
 *   wallet: new WalletAdapterPort(walletAdapter),
 *   compliance: new ComplianceAdapterPort(legacyComplianceLedgerPort),
 *   audit: new AuditAdapterPort(auditLogService),
 *   keys: new DefaultIdempotencyKeyPort(),
 * });
 * ```
 *
 * Disse adapterne er TYNNE — de mapper bare typer + parametere mellom
 * de to kontraktene. Ingen domain-logikk her.
 */

export { AuditAdapterPort } from "./AuditAdapterPort.js";
export { ComplianceAdapterPort } from "./ComplianceAdapterPort.js";
export { WalletAdapterPort } from "./WalletAdapterPort.js";
