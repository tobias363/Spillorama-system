/**
 * PR-W2 wallet-split: admin wallet-correction-endepunkt.
 *
 * Endpoint:
 *   POST /api/admin/wallets/:walletId/credit  — manuell kredit-korreksjon
 *   (default til deposit-siden, ALDRI til winnings).
 *
 * Regulatorisk gate — pengespillforskriften §11:
 *   Admin kan ALDRI kreditere direkte til spillerens winnings-konto. Winnings
 *   skal reflektere faktiske gevinster fra spill — manuell admin-bonus vil
 *   undergrave loss-limit-beregningen (winnings-spent teller ikke mot tap)
 *   og tilsvare en forbudt bonus-utdeling per regelverket.
 *
 *   Derfor: eksplisitt 403 hvis `req.body.to === "winnings"`. Kun game-engine
 *   (Game1PayoutService + Game1MiniGameOrchestrator + BingoEngine payout-path)
 *   kan lovlig sende `to: "winnings"` til `walletAdapter.credit`.
 *
 * Rolle-krav: WALLET_COMPLIANCE_WRITE (ADMIN + SUPPORT) — matcher andre
 * manuelle wallet-operasjoner i systemet (manual deposit/withdraw-kø via
 * PAYMENT_REQUEST_WRITE er agent/hall-operator-domene, mens global-kred-
 * korreksjon er sentralt compliance-ansvar).
 *
 * Referanser:
 *   - docs/architecture/WALLET_SPLIT_DESIGN_2026-04-22.md §3.2 + §5.3
 *   - project_regulatory_requirements.md (MEMORY) — pengespillforskriften §11
 *   - WalletAdapter.CreditOptions-JSDoc (apps/backend/src/adapters/WalletAdapter.ts)
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import type {
  WalletAdapter,
  WalletAccountSide,
  WalletTransaction,
} from "../adapters/WalletAdapter.js";
import type { WalletAuditVerifier } from "../wallet/WalletAuditVerifier.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-wallet" });

// ── Wire-types ───────────────────────────────────────────────────────────────

export interface AdminWalletCreditRequest {
  /** Beløp i kroner. Positivt heltall/desimal. */
  amount: number;
  /** Menneskelig lesbar begrunnelse (obligatorisk for revisjons-spor). */
  reason: string;
  /**
   * Hvilken side av wallet-et (deposit / winnings). Default `"deposit"`.
   *
   * **Regulatorisk:** `"winnings"` er forbudt via dette endepunktet — gate
   * i handler-koden returnerer 403 `ADMIN_WINNINGS_CREDIT_FORBIDDEN`.
   */
  to?: WalletAccountSide;
  /** Idempotency-key (anbefalt for retry-sikkerhet). */
  idempotencyKey?: string;
}

export interface AdminWalletCreditResponse {
  transaction: WalletTransaction;
}

// ── Router ──────────────────────────────────────────────────────────────────

export interface AdminWalletRouterDeps {
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  /** Notifiser web-shell om saldo-endring (socket-fanout). */
  emitWalletRoomUpdates?: (walletIds: string[]) => Promise<void>;
  /** BIN-764: hash-chain-verifier for on-demand audit-endepunkt. */
  walletAuditVerifier?: WalletAuditVerifier;
}

export function createAdminWalletRouter(
  deps: AdminWalletRouterDeps
): express.Router {
  const { platformService, walletAdapter, emitWalletRoomUpdates, walletAuditVerifier } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  /**
   * POST /api/admin/wallets/:walletId/credit — manuell kredit-korreksjon.
   *
   * Body:
   *   { amount, reason, to?: "deposit"|"winnings", idempotencyKey? }
   *
   * Regulatorisk:
   *   - `to === "winnings"` → HTTP 403 `ADMIN_WINNINGS_CREDIT_FORBIDDEN`
   *     (pengespillforskriften §11, se fil-header).
   *   - Default `to === "deposit"` er sikkert og matcher manual-deposit-kø.
   */
  router.post("/api/admin/wallets/:walletId/credit", async (req, res) => {
    try {
      const actor = await requirePermission(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const amount = mustBePositiveAmount(req.body?.amount);
      const reason = mustBeNonEmptyString(req.body?.reason, "reason");
      const toRaw = req.body?.to;
      const idempotencyKey =
        typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim()
          ? req.body.idempotencyKey.trim()
          : undefined;

      // PR-W2 regulatorisk gate: admin KAN IKKE kreditere til winnings.
      // Dette er hard-kodet fail-closed per pengespillforskriften §11 —
      // se fil-header for kontekst. Eksplisitt 403 (ikke 400) for å
      // signalisere regulatorisk forbud til admin-UI.
      if (toRaw === "winnings") {
        logger.warn(
          { actorId: actor.id, walletId, amount },
          "[PR-W2] ADMIN_WINNINGS_CREDIT_FORBIDDEN — admin forsøkte å kreditere til winnings"
        );
        res.status(403).json({
          ok: false,
          error: {
            code: "ADMIN_WINNINGS_CREDIT_FORBIDDEN",
            message:
              "Admin kan ikke kreditere direkte til winnings-siden (pengespillforskriften §11). Bruk 'deposit' i stedet.",
          },
        });
        return;
      }

      // Validér resten av `to`-feltet: skal enten være "deposit" eller utelatt
      // (som default'er til "deposit" per CreditOptions-kontrakt).
      if (toRaw !== undefined && toRaw !== "deposit") {
        throw new DomainError(
          "INVALID_INPUT",
          "Feltet 'to' må være 'deposit' (eller utelatt — winnings er forbudt)."
        );
      }

      const tx = await walletAdapter.credit(walletId, amount, reason, {
        to: "deposit",
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      });

      if (emitWalletRoomUpdates) {
        await emitWalletRoomUpdates([walletId]).catch((err) => {
          logger.warn(
            { err, walletId },
            "[PR-W2] emitWalletRoomUpdates failed — continuing"
          );
        });
      }

      const response: AdminWalletCreditResponse = { transaction: tx };
      apiSuccess(res, response);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  /**
   * BIN-764: GET /api/admin/wallet/audit-verify/:accountId
   *
   * On-demand verifisering av hash-chain for én konto. Returnerer detaljert
   * resultat inkludert eventuelle mismatches. Brukes av admin-UI når en
   * compliance-medarbeider trenger å bekrefte audit-trail-integritet før
   * eksport til revisor.
   *
   * Rolle-krav: WALLET_COMPLIANCE_READ (ADMIN + SUPPORT). Read-only operasjon
   * — ingen DB-skriving. Kan kalles vilkårlig ofte; idempotent.
   */
  router.get("/api/admin/wallet/audit-verify/:accountId", async (req, res) => {
    try {
      await requirePermission(req, "WALLET_COMPLIANCE_READ");
      if (!walletAuditVerifier) {
        res.status(503).json({
          ok: false,
          error: {
            code: "WALLET_AUDIT_VERIFIER_NOT_CONFIGURED",
            message: "Audit-verifier er ikke konfigurert på serveren.",
          },
        });
        return;
      }
      const accountId = mustBeNonEmptyString(req.params.accountId, "accountId");
      const result = await walletAuditVerifier.verifyAccount(accountId);
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
