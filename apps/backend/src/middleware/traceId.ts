/**
 * MED-1: Express middleware that establishes a per-request trace-id
 * context. Once installed, every `logger.*` call downstream of this
 * middleware automatically includes `traceId` and `requestId` (alias)
 * fields — no manual threading required.
 *
 * Wire-up:
 *   import { traceIdMiddleware } from "./middleware/traceId.js";
 *   app.use(traceIdMiddleware());
 *
 * Behaviour:
 *   - Reads incoming `X-Trace-Id` header if present (trusted upstream
 *     proxy / load-balancer flows). Otherwise mints a fresh UUID v4.
 *   - Sets `X-Trace-Id` on the response so clients can correlate.
 *   - Wraps `next()` in `runWithTraceContext` so the rest of the
 *     request — including async work after `await next()` — sees
 *     the context.
 *
 * Header validation: an incoming `X-Trace-Id` is accepted only if it
 * looks like a UUID or a short opaque token (1–128 chars,
 * `[a-zA-Z0-9_.-]+`). This prevents header-injection / log-injection
 * attacks where a malicious client embeds newlines or control chars
 * to forge log lines.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { newTraceId, runWithTraceContext, type TraceContext } from "../util/traceContext.js";

const INCOMING_TRACE_ID_REGEX = /^[a-zA-Z0-9_.-]{1,128}$/;
const TRACE_HEADER = "x-trace-id";
const TRACE_HEADER_RESPONSE = "X-Trace-Id";

/**
 * Augment Express Request with the resolved trace-id so handlers that
 * still want to read it directly (without going through the logger) can.
 */
declare module "express-serve-static-core" {
  interface Request {
    traceId?: string;
  }
}

export interface TraceIdMiddlewareOptions {
  /**
   * If true, accept `X-Trace-Id` from the incoming request and reuse it.
   * Set to false in environments where the request is reachable directly
   * from untrusted clients with no upstream proxy. Default: true (we
   * already validate the format).
   */
  trustIncoming?: boolean;
}

export function traceIdMiddleware(opts: TraceIdMiddlewareOptions = {}): RequestHandler {
  const { trustIncoming = true } = opts;

  return function traceIdHandler(req: Request, res: Response, next: NextFunction): void {
    let traceId: string | null = null;

    if (trustIncoming) {
      const headerValue = req.headers[TRACE_HEADER];
      const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (typeof candidate === "string" && INCOMING_TRACE_ID_REGEX.test(candidate)) {
        traceId = candidate;
      }
    }

    if (!traceId) traceId = newTraceId();

    // Expose to handlers + outgoing response — clients can correlate by
    // grepping their browser network tab or capturing the header in a
    // bug report. Set BEFORE next() so the header is available even if
    // a downstream handler calls res.end synchronously.
    req.traceId = traceId;
    res.setHeader(TRACE_HEADER_RESPONSE, traceId);

    const ctx: TraceContext = {
      traceId,
      requestId: traceId,
    };

    runWithTraceContext(ctx, () => next());
  };
}
