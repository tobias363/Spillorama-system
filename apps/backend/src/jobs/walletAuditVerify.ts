/**
 * BIN-764: Wallet hash-chain nightly verifier.
 *
 * Kjører WalletAuditVerifier.verifyAll() én gang per dag (default kl. 02:00
 * lokal tid). Logger aggregert resultat, alarmerer hvis mismatches detekteres.
 *
 * Lotteritilsynet-pattern: nightly integrity-sweep gir bevis på at wallet-
 * audit-trail ikke er manipulert post-hoc i den foregående dagsens vindu.
 *
 * Date-keyed: kjører kun én gang per kalender-dag, idempotent ved restart.
 */

import type { JobResult } from "./JobScheduler.js";
import type { WalletAuditVerifier } from "../wallet/WalletAuditVerifier.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:wallet-audit-verify" });

export interface WalletAuditVerifyJobDeps {
  verifier: WalletAuditVerifier;
  /** Lokal time (0-23) når jobben skal kjøre. Default 2. */
  runAtHourLocal?: number;
  /** Override for testing — kjør hver tick uten date-key-sjekk. */
  alwaysRun?: boolean;
}

export function createWalletAuditVerifyJob(deps: WalletAuditVerifyJobDeps) {
  const runAtHour = deps.runAtHourLocal ?? 2;
  let lastRunDateKey = "";

  function dateKey(nowMs: number): string {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return async function runWalletAuditVerify(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);
    const todayKey = dateKey(nowMs);

    if (!deps.alwaysRun) {
      if (now.getHours() < runAtHour) {
        return { itemsProcessed: 0, note: `waiting for ${runAtHour}:00 local` };
      }
      if (todayKey === lastRunDateKey) {
        return { itemsProcessed: 0, note: "already ran today" };
      }
    }

    try {
      const result = await deps.verifier.verifyAll();
      lastRunDateKey = todayKey;

      if (result.totalMismatches > 0) {
        log.error(
          {
            accountsChecked: result.accountsChecked,
            failedAccounts: result.failedAccounts.map((f) => ({
              accountId: f.accountId,
              mismatches: f.mismatches.length,
            })),
            totalMismatches: result.totalMismatches,
          },
          "WALLET_AUDIT_VERIFY_TAMPER_DETECTED"
        );
      } else {
        log.info(
          {
            accountsChecked: result.accountsChecked,
            entriesChecked: result.totalEntriesChecked,
            legacyUnhashed: result.totalLegacyUnhashed,
            durationMs: result.durationMs,
          },
          "wallet hash-chain intakt"
        );
      }

      return {
        itemsProcessed: result.totalEntriesChecked,
        note: `accounts=${result.accountsChecked} mismatches=${result.totalMismatches} legacy=${result.totalLegacyUnhashed}`,
      };
    } catch (err) {
      log.error({ err }, "wallet-audit-verify tick feilet");
      return { itemsProcessed: 0, note: `error: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
}
