// FE-P0-003 (Bølge 2B pilot-blocker): Page-level lifecycle helpers for
// AbortController-aware fetches. Solves the flaky-hall-WiFi race where a
// slow stale fetch lands after the user has already navigated away or
// triggered a fresh fetch — and overwrites money-data UI with old state.
//
// Usage pattern in a page mount function:
//
//   const lifecycle = createPageLifecycle();
//   try {
//     const data = await loadCashInOutData({ signal: lifecycle.signal });
//     render(data);
//   } catch (err) {
//     if (isAbortError(err)) return; // page was unmounted, skip render
//     showError(err);
//   }
//   // …on unmount: lifecycle.dispose() aborts any in-flight request.
//
// Also offers `createRequestLifecycle()` for replacing in-flight requests
// (e.g. user clicks "Refresh" on a slow page) — calling start() again
// aborts the previous controller and returns a fresh signal.

/**
 * Page-level lifecycle: one AbortController owned by a page mount. All
 * requests started during this mount can share the same signal — when the
 * page unmounts, dispose() aborts them all in one shot.
 */
export interface PageLifecycle {
  /** AbortSignal to thread into apiRequest({ signal: lifecycle.signal }). */
  readonly signal: AbortSignal;
  /** True after dispose() has been called — useful as a defence-in-depth check. */
  readonly disposed: boolean;
  /** Abort the controller. Idempotent. Call from the page's unmount path. */
  dispose(): void;
}

export function createPageLifecycle(): PageLifecycle {
  const ctrl = new AbortController();
  let disposed = false;
  return {
    get signal() {
      return ctrl.signal;
    },
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ctrl.abort();
    },
  };
}

/**
 * Request-replacement lifecycle: each call to start() aborts the previous
 * controller and returns a fresh signal. Useful for "click refresh on a
 * slow page" or "user typed in a search box" patterns where a newer
 * request supersedes any pending one.
 *
 * Pattern:
 *   const requests = createRequestLifecycle();
 *   refreshButton.addEventListener("click", async () => {
 *     try {
 *       const signal = requests.start();
 *       const data = await loadData({ signal });
 *       render(data);
 *     } catch (err) {
 *       if (isAbortError(err)) return;
 *       showError(err);
 *     }
 *   });
 *   // …on page unmount:
 *   requests.dispose();
 */
export interface RequestLifecycle {
  /** Start a new request — aborts any prior in-flight one. */
  start(): AbortSignal;
  /** Abort the current controller without starting a new one. */
  cancel(): void;
  /** Final cleanup — same as cancel() but marks the lifecycle disposed. */
  dispose(): void;
  /** True after dispose() has been called. */
  readonly disposed: boolean;
}

export function createRequestLifecycle(): RequestLifecycle {
  let ctrl: AbortController | null = null;
  let disposed = false;
  return {
    start(): AbortSignal {
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      return ctrl.signal;
    },
    cancel(): void {
      if (ctrl) ctrl.abort();
      ctrl = null;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (ctrl) ctrl.abort();
      ctrl = null;
    },
    get disposed() {
      return disposed;
    },
  };
}
