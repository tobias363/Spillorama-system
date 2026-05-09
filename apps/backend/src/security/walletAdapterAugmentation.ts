/**
 * BIN-806 A13: Module-augmentation av `TransactionOptions` for å legge til
 * et opt-in `antiFraudContext`-felt som `AntiFraudWalletAdapter` leser.
 *
 * Hvorfor module-augmentation framfor direkte edit av WalletAdapter.ts:
 *
 * Conflict-mitigation per BIN-806's brief — Agent U auditerer wallet-touch
 * og eier `WalletAdapter.ts`. Vi vil ikke endre den i denne PR-en for å
 * unngå merge-krasj. TypeScript module-augmentation lar oss legge til
 * felt på `TransactionOptions` fra en separat fil: alle callers ser
 * feltet via type-import, og kompilatoren tillater det uten at
 * `WalletAdapter.ts` rør seg.
 *
 * Når Agent U lander, kan dette flyttes inn i WalletAdapter.ts som en
 * trivial follow-up — augmentation er idempotent.
 *
 * Bruk:
 *
 *   import "../security/walletAdapterAugmentation.js";
 *   await wallet.debit(accountId, 100, "test", {
 *     idempotencyKey: "...",
 *     antiFraudContext: { userId, hallId, ipAddress },
 *   });
 *
 * Decorator-en `AntiFraudWalletAdapter` importerer denne filen via
 * side-effect så typen alltid er tilgjengelig der hvor decoratoren brukes.
 */

import type { AntiFraudOperationType } from "./AntiFraudService.js";

/**
 * BIN-806 A13: per-call context for anti-fraud assessment. Caller (route
 * eller service) sender det den vet; decorator + service fyller resten.
 */
export interface AntiFraudContext {
  userId: string;
  hallId?: string | null;
  ipAddress?: string | null;
  /**
   * Override operasjons-type for assessment-loggen. Default utledes av
   * decorator-en (DEBIT/CREDIT/etc.) basert på hvilket adapter-method
   * som ble kalt. Eksplisitt override brukes for spesielle flow som
   * skal logges som `OTHER`.
   */
  operationTypeOverride?: AntiFraudOperationType;
}

declare module "../adapters/WalletAdapter.js" {
  interface TransactionOptions {
    /**
     * BIN-806 A13: optional anti-fraud assessment context. Når satt kjører
     * `AntiFraudWalletAdapter`-decoratoren `assessTransaction` FØR den
     * underliggende adapter-metoden mutater state. `risk === "critical"`
     * blokkerer mutasjonen med `DomainError("FRAUD_RISK_CRITICAL")`.
     *
     * Optional by design: callers som ikke vil ha fraud-detection (f.eks.
     * system-interne house-account-overføringer) kan utelate feltet og
     * decoratoren blir pass-through. Produksjons-wallet-routes (player
     * deposit/withdraw/debit, etc.) bør alltid sette det.
     */
    antiFraudContext?: AntiFraudContext;
  }
}

// Side-effect: importerer denne for å tvinge augmentation til å lastes.
export const ANTI_FRAUD_AUGMENTATION_LOADED = true;
