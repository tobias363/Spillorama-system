import express from "express";
import { DomainError, toPublicError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { SwedbankPayService, SwedbankTopupIntent } from "../payments/SwedbankPayService.js";
import {
  SWEDBANK_SIGNATURE_HEADER,
  verifySwedbankSignature,
} from "../payments/swedbankSignature.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseBooleanEnv,
} from "../util/httpHelpers.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";

/**
 * BIN-GAP-#7/#8/#9: shape of the post-message envelope the iframe-host
 * dispatches up to the parent window after the deposit flow finishes.
 * Kept as a string-literal union so the player-app can lock onto a
 * stable contract.
 */
export type SwedbankIframeStatus = "success" | "cancelled" | "failed" | "pending" | "unknown";

/** Mobile-platform deeplink contract returned by `/api/payments/swedbank/goback`. */
export type SwedbankGobackPlatform = "ios" | "android" | "web";

export interface PaymentsRouterDeps {
  platformService: PlatformService;
  swedbankPayService: SwedbankPayService;
  emitWalletRoomUpdates: (walletIds: string[]) => Promise<void>;
  /**
   * BIN-603: shared secret for Swedbank webhook HMAC-SHA256 verification.
   * Empty string = webhook is treated as mis-configured and returns 503
   * (fail-closed). The raw bytes of the request body must reach this
   * router via `req.rawBody` — see the `express.json` `verify` hook in
   * index.ts.
   */
  swedbankWebhookSecret: string;
  /**
   * BIN-GAP-#9: optional audit-log sink for goback / payment-flow
   * completion events. Same fire-and-forget contract as elsewhere; if
   * omitted the routes still work but emit nothing to the audit table.
   */
  auditLogService?: AuditLogService;
  /**
   * BIN-GAP-#9: native-app deeplink scheme (e.g. `spillorama`). Used to
   * build `spillorama://payment/result?...` URLs for ios/android. The
   * `web` platform falls back to the merchant-base or to a relative
   * thank-you URL.
   */
  nativeAppDeeplinkScheme?: string;
  /**
   * BIN-GAP-#9: web "go back" base URL (e.g. `https://app.spillorama.no/wallet`).
   * Used for the `web` platform when no scheme override is present.
   */
  webGobackBaseUrl?: string;
}

/**
 * BIN-GAP-#7: HTML-escape an arbitrary string so it can be safely
 * interpolated into the iframe-host page or the deposit-response page.
 * We don't pull in a templating engine for three small pages; this
 * keeps the dependency surface flat and the audit story simple.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * BIN-GAP-#7: derive the JS-string-literal form of `value` so it can
 * be embedded inside `<script>…</script>` without breaking out via
 * `</script>`. Using JSON.stringify also handles the surrounding
 * quotes and unicode-escapes for us.
 */
function jsLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * BIN-GAP-#7: map our internal Swedbank status code to the simple
 * `success | failed | cancelled | pending | unknown` envelope the
 * player-app listens for. Mirrors the legacy `statusMap` semantics
 * in `swedbankpayIframe` but normalised to UPPER-CASE.
 */
function mapSwedbankStatusToIframeStatus(status: string): SwedbankIframeStatus {
  const upper = status.trim().toUpperCase();
  if (upper === "PAID" || upper === "FULLYPAID" || upper === "CREDITED") {
    return "success";
  }
  if (upper === "CANCELLED" || upper === "ABORTED") {
    return "cancelled";
  }
  if (upper === "FAILED" || upper === "EXPIRED" || upper === "ERROR") {
    return "failed";
  }
  if (upper === "PENDING" || upper === "INITIALIZED" || upper === "READY" || upper === "AWAITINGCONSUMERVERIFICATION") {
    return "pending";
  }
  return "unknown";
}

/**
 * BIN-GAP-#7: render the iframe-host HTML page. The page itself is
 * served same-origin to the player-app shell; the inner iframe loads
 * Swedbank's checkout. CSP is locked to:
 *   - default 'none'                   — deny-by-default
 *   - frame-src https://*.payex.com    — only the Swedbank iframe target
 *     and *.swedbankpay.com               (sandbox env uses payex.com)
 *   - script-src 'unsafe-inline' self  — inline bootstrap is required
 *     for the post-message glue; we ship no external scripts.
 *   - style-src  'unsafe-inline' self  — minimal inline styling.
 *   - connect-src https://*.payex.com  — Swedbank iframe will fetch its
 *     own assets; we don't issue any fetch from this host page.
 *
 * The iframe is rendered with sandbox="allow-scripts allow-forms
 * allow-popups allow-same-origin" so Swedbank's checkout works while
 * still keeping our origin's cookies untouchable from the inner frame.
 */
function renderIframeHostHtml(intent: SwedbankTopupIntent): string {
  const targetUrl = intent.viewUrl || intent.redirectUrl || "";
  const csp =
    "default-src 'none'; " +
    "frame-src https://*.payex.com https://*.swedbankpay.com; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https://*.payex.com https://*.swedbankpay.com; " +
    "connect-src 'self' https://*.payex.com https://*.swedbankpay.com; " +
    "form-action 'none'; " +
    "base-uri 'none';";

  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8" />
<title>Innskudd</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />
<meta name="referrer" content="no-referrer" />
<style>
  html,body{margin:0;padding:0;height:100%;background:#0d1d2a;color:#fff;font-family:system-ui,sans-serif}
  .wrap{display:flex;flex-direction:column;height:100%}
  .frame{flex:1;border:0;width:100%;background:#fff}
  .empty{display:flex;align-items:center;justify-content:center;height:100%;padding:1rem;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  ${targetUrl
    ? `<iframe class="frame" sandbox="allow-scripts allow-forms allow-popups allow-same-origin" src="${escapeHtml(targetUrl)}" title="Swedbank Pay checkout"></iframe>`
    : `<div class="empty"><p>Betalingen kan ikke åpnes nå. Lukk dette vinduet og forsøk igjen.</p></div>`}
</div>
<script>
(function(){
  var INTENT_ID = ${jsLiteral(intent.id)};
  var STATUS = ${jsLiteral(intent.status)};
  function postUp(payload){
    try { if (window.parent && window.parent !== window) { window.parent.postMessage(payload, '*'); } } catch (e) {}
    try { if (window.opener) { window.opener.postMessage(payload, '*'); } } catch (e) {}
  }
  postUp({ type: 'swedbank:iframe:opened', intentId: INTENT_ID, status: STATUS });
  window.addEventListener('message', function (e) {
    var d = e && e.data; if (!d || typeof d !== 'object') { return; }
    if (d.type === 'swedbank:result' || d.type === 'swedbank:close') { postUp(d); }
  });
})();
</script>
</body>
</html>`;
}

/**
 * BIN-GAP-#8: render the post-redirect "thank you / auto-close" page.
 * This page is the URL Swedbank redirects the user back to once the
 * checkout finishes (success/cancel). Its job is to:
 *   1. show a short status-banner so the user has something to look at
 *      while we close the iframe,
 *   2. fire a `postMessage({status})` to the parent so the player-app
 *      can react (refresh wallet balance / route to confirmation),
 *   3. attempt to close the popup/iframe via `window.close()` for
 *      desktop popups, and signal the native shell via the
 *      `spillorama://payment/result` deeplink for in-app webviews.
 *
 * Same locked-down CSP as the iframe-host. No external scripts, no
 * external styles, no remote fetch.
 */
function renderDepositResponseHtml(args: {
  status: SwedbankIframeStatus;
  intentId: string;
  amountMajor?: number;
  currency?: string;
  deeplink?: string;
}): string {
  const csp =
    "default-src 'none'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "form-action 'none'; " +
    "base-uri 'none';";
  const headline =
    args.status === "success"
      ? "Innskuddet er gjennomført"
      : args.status === "cancelled"
        ? "Innskuddet ble avbrutt"
        : args.status === "failed"
          ? "Innskuddet feilet"
          : args.status === "pending"
            ? "Innskuddet behandles"
            : "Status er ukjent";
  const detail =
    args.status === "success"
      ? "Saldo oppdateres straks. Du kan lukke dette vinduet."
      : args.status === "cancelled"
        ? "Du kan prøve igjen fra lommeboken."
        : args.status === "failed"
          ? "Pengene er ikke trukket. Prøv igjen eller kontakt support."
          : args.status === "pending"
            ? "Vi venter på bekreftelse fra Swedbank."
            : "Sjekk lommeboken eller kontakt support hvis innskuddet uteblir.";

  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8" />
<title>Innskudd – kvittering</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />
<meta name="referrer" content="no-referrer" />
<style>
  html,body{margin:0;padding:0;height:100%;background:#0d1d2a;color:#fff;font-family:system-ui,sans-serif}
  .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:1.5rem;text-align:center}
  .card{max-width:420px;background:rgba(255,255,255,.08);border-radius:12px;padding:1.5rem}
  h1{margin:0 0 .5rem;font-size:1.25rem;font-weight:600}
  p{margin:0 0 1rem;line-height:1.4}
  .badge{display:inline-block;padding:.25rem .75rem;border-radius:999px;font-size:.875rem;margin-bottom:1rem;background:#274355}
  .ok{background:#0e6b3a}
  .warn{background:#b76b00}
  .err{background:#b73a3a}
  button{appearance:none;border:0;border-radius:8px;padding:.5rem 1rem;font-size:1rem;cursor:pointer;background:#3b82f6;color:#fff}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <span class="badge ${args.status === "success" ? "ok" : args.status === "failed" ? "err" : "warn"}">${escapeHtml(args.status)}</span>
    <h1>${escapeHtml(headline)}</h1>
    <p>${escapeHtml(detail)}</p>
    <button type="button" id="close-btn">Tilbake til appen</button>
  </div>
</div>
<script>
(function(){
  var STATUS = ${jsLiteral(args.status)};
  var INTENT_ID = ${jsLiteral(args.intentId)};
  var DEEPLINK = ${jsLiteral(args.deeplink ?? "")};
  var payload = {
    type: 'swedbank:result',
    status: STATUS,
    intentId: INTENT_ID${
      args.amountMajor !== undefined ? `,\n    amountMajor: ${JSON.stringify(args.amountMajor)}` : ""
    }${args.currency ? `,\n    currency: ${jsLiteral(args.currency)}` : ""}
  };
  function postUp(){
    try { if (window.parent && window.parent !== window) { window.parent.postMessage(payload, '*'); } } catch (e) {}
    try { if (window.opener) { window.opener.postMessage(payload, '*'); } } catch (e) {}
  }
  function tryClose(){
    if (DEEPLINK) { try { window.location.href = DEEPLINK; return; } catch (e) {} }
    try { window.close(); } catch (e) {}
  }
  postUp();
  // Auto-close best-effort on success/cancelled — keep failed/pending visible
  // so the user reads the explanatory copy.
  if (STATUS === 'success' || STATUS === 'cancelled') {
    setTimeout(tryClose, 1500);
  }
  document.getElementById('close-btn').addEventListener('click', function(){
    postUp();
    tryClose();
  });
})();
</script>
</body>
</html>`;
}

/**
 * BIN-GAP-#9: build the platform-specific "back to app" deeplink. iOS
 * and Android use a custom URI scheme (default `spillorama://`) so the
 * webview can hand control back to the native shell. Web players are
 * routed to the player-app's wallet page (or merchant base) — the
 * fallback ensures we never return an empty URL.
 */
function buildGobackUrl(args: {
  platform: SwedbankGobackPlatform;
  intentId: string;
  status: SwedbankIframeStatus;
  scheme: string;
  webBase: string;
}): string {
  const params = new URLSearchParams({ id: args.intentId, status: args.status });
  if (args.platform === "ios" || args.platform === "android") {
    return `${args.scheme}://payment/result?${params.toString()}`;
  }
  // platform === "web"
  if (args.webBase) {
    const trimmed = args.webBase.endsWith("/") ? args.webBase : `${args.webBase}/`;
    try {
      const url = new URL("payment/result", trimmed);
      url.searchParams.set("id", args.intentId);
      url.searchParams.set("status", args.status);
      return url.toString();
    } catch {
      // fall through to relative
    }
  }
  return `/wallet?paymentResult=${encodeURIComponent(args.status)}&intentId=${encodeURIComponent(args.intentId)}`;
}

export function createPaymentsRouter(deps: PaymentsRouterDeps): express.Router {
  const {
    platformService,
    swedbankPayService,
    emitWalletRoomUpdates,
    swedbankWebhookSecret,
    auditLogService,
    nativeAppDeeplinkScheme,
    webGobackBaseUrl,
  } = deps;
  const router = express.Router();

  const deeplinkScheme = (nativeAppDeeplinkScheme ?? "spillorama").trim() || "spillorama";
  const webBase = (webGobackBaseUrl ?? "").trim();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.post("/api/payments/swedbank/topup-intent", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const amount = mustBePositiveAmount(req.body?.amount);
      const intent = await swedbankPayService.createTopupIntent({
        userId: user.id,
        walletId: user.walletId,
        amountMajor: amount,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined
      });
      apiSuccess(res, intent);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/payments/swedbank/confirm", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const intentId = mustBeNonEmptyString(req.body?.intentId, "intentId");
      const result = await swedbankPayService.reconcileIntentForUser(intentId, user.id);
      if (result.walletCreditedNow) {
        await emitWalletRoomUpdates([user.walletId]);
      }
      apiSuccess(res, result.intent);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/payments/swedbank/intents/:intentId", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const intentId = mustBeNonEmptyString(req.params.intentId, "intentId");
      const shouldRefresh = parseBooleanEnv(
        typeof req.query.refresh === "string" ? req.query.refresh : undefined,
        false
      );
      if (!shouldRefresh) {
        const intent = await swedbankPayService.getIntentForUser(intentId, user.id);
        apiSuccess(res, intent);
        return;
      }

      const result = await swedbankPayService.reconcileIntentForUser(intentId, user.id);
      if (result.walletCreditedNow) {
        await emitWalletRoomUpdates([user.walletId]);
      }
      apiSuccess(res, result.intent);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/payments/swedbank/callback", async (req, res) => {
    // BIN-603: HMAC-SHA256 verification over the raw request body BEFORE we
    // touch processCallback. The callback path is internet-exposed; without
    // signature verification anyone can POST a plausible Swedbank payload
    // and force us to hit Swedbank's API for reconciliation. Wallet credit
    // is still gated by the authoritative fetchPaymentOrder call inside
    // reconcileRow, so unsigned spam can't steal money — but it is DoS /
    // log-noise and diverges from industry standard. Verified here,
    // fail-closed on any mis-configuration.
    if (!swedbankWebhookSecret) {
      console.error("[swedbank-callback] SWEDBANK_WEBHOOK_SECRET is not configured; refusing callback");
      res.status(503).json({
        ok: false,
        error: { code: "WEBHOOK_NOT_CONFIGURED", message: "Swedbank webhook-verifisering er ikke konfigurert." },
      });
      return;
    }
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";
    const signatureHeader = req.headers[SWEDBANK_SIGNATURE_HEADER];
    if (!verifySwedbankSignature(rawBody, signatureHeader, swedbankWebhookSecret)) {
      const orderReference =
        typeof req.body?.orderReference === "string" ? req.body.orderReference : undefined;
      console.warn("[swedbank-callback] signature verification failed", {
        orderReference,
        hasHeader: Boolean(signatureHeader),
        bodyLength: rawBody.length,
      });
      res.status(401).json({
        ok: false,
        error: { code: "INVALID_SIGNATURE", message: "Swedbank webhook-signatur er ugyldig." },
      });
      return;
    }

    try {
      const result = await swedbankPayService.processCallback(req.body);
      if (result.walletCreditedNow) {
        await emitWalletRoomUpdates([result.intent.walletId]);
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[swedbank-callback] failed", error);
      res.status(500).json({
        ok: false,
        error: toPublicError(error)
      });
    }
  });

  // ── BIN-GAP-#7: iframe-launch wrap ───────────────────────────────────────
  // Legacy: `GET /payment/iframe/:checkoutId` → swedbankpayIframe controller.
  // The legacy controller queried by `orderNumber` (the Swedbank checkoutId);
  // in the new stack the player-app receives the intent UUID from the
  // POST /topup-intent response, which it then uses to open this URL inside
  // a webview. Auth: bearer-token + intent.user_id ownership-check (404 on
  // mismatch — never reveal "this id exists but is not yours").
  router.get("/api/payments/swedbank/iframe/:intentId", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const intentId = mustBeNonEmptyString(req.params.intentId, "intentId");
      let intent: SwedbankTopupIntent;
      try {
        intent = await swedbankPayService.getIntentForUser(intentId, user.id);
      } catch (error) {
        if (error instanceof DomainError && error.code === "PAYMENT_INTENT_NOT_FOUND") {
          // Treat unknown / not-owned as 404. Legacy returned a status-page
          // here too; we keep the same UX (404 + simple text body) so the
          // player-app can detect by status code.
          res.status(404).type("text/plain").send("Payment intent ikke funnet.");
          return;
        }
        throw error;
      }

      // CSP is set both as a meta-tag (for the inline script gating) and as
      // the response header (more robust against MITM removing the meta).
      const csp =
        "default-src 'none'; " +
        "frame-src https://*.payex.com https://*.swedbankpay.com; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https://*.payex.com https://*.swedbankpay.com; " +
        "connect-src 'self' https://*.payex.com https://*.swedbankpay.com; " +
        "form-action 'none'; base-uri 'none';";
      res.setHeader("Content-Security-Policy", csp);
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.type("text/html").send(renderIframeHostHtml(intent));
    } catch (error) {
      // Any other failure (UNAUTHORIZED, INVALID_INPUT, db-error) maps to a
      // bare 4xx/5xx text page — we deliberately do not echo internal error
      // shape into HTML.
      if (error instanceof DomainError && error.code === "UNAUTHORIZED") {
        res.status(401).type("text/plain").send("Ikke innlogget.");
        return;
      }
      console.error("[swedbank-iframe] failed", error);
      res.status(500).type("text/plain").send("Kunne ikke åpne betalingen.");
    }
  });

  // ── BIN-GAP-#8: deposit response (Swedbank → user redirect target) ──────
  // Legacy: `GET /payment/deposit/response` → swedbankpayPaymentResponse.
  // Swedbank redirects the user back to this URL after the checkout
  // finishes. The user-agent has no Bearer token at this point — auth is
  // implicit via the `swedbank_intent` query param (a UUID never exposed
  // to other users) plus the authoritative remote-status fetch inside
  // `reconcileIntentById`, which gates the wallet credit.
  //
  // Behaviour:
  //   1. Look up the intent by the `swedbank_intent` query param. The
  //      legacy used `order_number`; we read both to stay compatible with
  //      callbacks that have only the order-reference.
  //   2. Reconcile (best-effort) so the wallet is credited as soon as the
  //      user lands here — this matches the legacy "VERIFY" path.
  //   3. Render the thank-you page with auto-close + post-message.
  router.get("/api/payments/swedbank/deposit/response", async (req, res) => {
    const intentIdRaw =
      typeof req.query.swedbank_intent === "string"
        ? req.query.swedbank_intent
        : typeof req.query.intentId === "string"
          ? req.query.intentId
          : "";
    const orderRefRaw =
      typeof req.query.order_number === "string"
        ? req.query.order_number
        : typeof req.query.orderReference === "string"
          ? req.query.orderReference
          : "";
    const requestedPlatform: SwedbankGobackPlatform =
      req.query.platform === "ios" || req.query.platform === "android" ? req.query.platform : "web";

    // Always use the locked-down CSP and never cache.
    const csp =
      "default-src 'none'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "form-action 'none'; base-uri 'none';";
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    try {
      let intent: SwedbankTopupIntent | null = null;
      if (intentIdRaw.trim()) {
        try {
          // Best-effort: reconcile so a `success` redirect actually credits
          // the wallet. The wallet-room broadcast keeps the player-app's
          // balance UI in sync without an extra round-trip.
          const result = await swedbankPayService.reconcileIntentById(intentIdRaw.trim());
          intent = result.intent;
          if (result.walletCreditedNow) {
            await emitWalletRoomUpdates([result.intent.walletId]);
          }
        } catch (error) {
          if (error instanceof DomainError && error.code === "PAYMENT_INTENT_NOT_FOUND") {
            // fall through to render an "unknown" status page below
          } else {
            console.warn("[swedbank-deposit-response] reconcile failed", error);
            // Try a non-reconciling fetch so we still know about the intent
            try {
              intent = await swedbankPayService.getIntentById(intentIdRaw.trim());
            } catch {
              // treat as unknown
            }
          }
        }
      }

      // If only an order-reference was supplied (legacy clients) we don't
      // currently support it — the stable internal id is the intent UUID.
      // Render a generic "pending" page so the user sees something useful.
      const status: SwedbankIframeStatus = intent
        ? mapSwedbankStatusToIframeStatus(intent.status)
        : orderRefRaw.trim()
          ? "pending"
          : "unknown";

      const deeplink = intent
        ? buildGobackUrl({
            platform: requestedPlatform,
            intentId: intent.id,
            status,
            scheme: deeplinkScheme,
            webBase,
          })
        : undefined;

      // Audit-log the result — fire-and-forget. We log the *intent id* and
      // the resolved status, never PII or amounts beyond what's in the
      // intent (which is the player's own deposit).
      if (auditLogService && intent) {
        void auditLogService
          .record({
            actorId: intent.userId,
            actorType: "PLAYER",
            action: "payment.swedbank.response",
            resource: "swedbank_payment_intent",
            resourceId: intent.id,
            details: {
              status,
              walletId: intent.walletId,
              amountMajor: intent.amountMajor,
              currency: intent.currency,
              orderReference: intent.orderReference,
            },
          })
          .catch((err: unknown) => console.warn("[swedbank-deposit-response] audit failed", err));
      }

      res.type("text/html").send(
        renderDepositResponseHtml({
          status,
          intentId: intent?.id ?? intentIdRaw.trim(),
          amountMajor: intent?.amountMajor,
          currency: intent?.currency,
          deeplink,
        })
      );
    } catch (error) {
      console.error("[swedbank-deposit-response] failed", error);
      res.type("text/html").send(
        renderDepositResponseHtml({
          status: "unknown",
          intentId: intentIdRaw.trim(),
        })
      );
    }
  });

  // ── BIN-GAP-#9: native-app "back to app" deeplink ───────────────────────
  // Legacy: `POST /payment/goback` → goBacktoAppFromSwedbankpay. The native
  // shell calls this after the deposit-response page fires its post-message
  // so the backend can:
  //   1. validate the player owns the intent (no leaking via guessable id),
  //   2. write an audit-log row marking the payment-flow as completed,
  //   3. return a platform-specific deeplink the shell can navigate to.
  router.post("/api/payments/swedbank/goback", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const intentId = mustBeNonEmptyString(req.body?.paymentId ?? req.body?.intentId, "paymentId");
      const platformRaw =
        typeof req.body?.platform === "string" ? req.body.platform.trim().toLowerCase() : "";
      if (platformRaw !== "ios" && platformRaw !== "android" && platformRaw !== "web") {
        throw new DomainError("INVALID_INPUT", "platform må være ios, android eller web.");
      }
      const platform: SwedbankGobackPlatform = platformRaw;

      // Ownership check — getIntentForUser throws PAYMENT_INTENT_NOT_FOUND
      // for both unknown and not-owned, which is exactly the leak-free
      // behaviour we want.
      const intent = await swedbankPayService.getIntentForUser(intentId, user.id);
      const status = mapSwedbankStatusToIframeStatus(intent.status);
      const url = buildGobackUrl({
        platform,
        intentId: intent.id,
        status,
        scheme: deeplinkScheme,
        webBase,
      });

      if (auditLogService) {
        void auditLogService
          .record({
            actorId: user.id,
            actorType: "PLAYER",
            action: "payment.swedbank.goback",
            resource: "swedbank_payment_intent",
            resourceId: intent.id,
            details: {
              platform,
              status,
              walletId: intent.walletId,
              amountMajor: intent.amountMajor,
              currency: intent.currency,
              orderReference: intent.orderReference,
            },
            ipAddress: typeof req.ip === "string" ? req.ip : null,
            userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
          })
          .catch((err: unknown) => console.warn("[swedbank-goback] audit failed", err));
      }

      apiSuccess(res, { url, status, platform });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
