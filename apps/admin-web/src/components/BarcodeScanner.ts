// BarcodeScanner — vanilla-DOM port of the legacy `on_scanner()` helper
//
// Hall terminals have USB barcode readers configured to emit the full barcode
// followed by ENTER. The raw string is ≥ 22 characters; the ticket ID sits at
// positions 14..20 (7 digits). Shorter strings (manual typing with Enter) are
// ignored so accidental submits don't fire.
//
// See BARCODE-SCANNER-SPEC.md for background.

export interface BarcodeScannerOptions {
  /** Input element that receives the scan. Must be a text-like input. */
  input: HTMLInputElement;
  /** Minimum total length to treat as a scan (default: 22). */
  minLength?: number;
  /** Zero-based start of the ticket-ID substring (default: 14). */
  extractStart?: number;
  /** Length of the ticket-ID substring (default: 7). */
  extractLength?: number;
  /**
   * Debounce in ms after Enter before reading the value. Default: 250.
   * Matches legacy; lets all buffered keystrokes from fast readers land first.
   */
  debounceMs?: number;
  /**
   * Called after a successful scan.
   * @param ticketId parsed number extracted from the barcode
   * @param rawValue the trimmed (last `minLength` characters) raw string
   */
  onScan: (ticketId: number, rawValue: string) => void;
  /** Optional element to focus after a successful scan. */
  nextFocus?: HTMLElement;
}

/**
 * Attach a barcode scanner to an input. Returns a detach function that must be
 * called on route/unmount to avoid double-binding on re-entry.
 */
export function attachBarcodeScanner(opts: BarcodeScannerOptions): () => void {
  const minLength = opts.minLength ?? 22;
  const extractStart = opts.extractStart ?? 14;
  const extractLength = opts.extractLength ?? 7;
  const debounceMs = opts.debounceMs ?? 250;

  let timer: number | null = null;

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter") return;

    // Debounce — legacy uses setTimeout to let buffered chars land.
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;

      let value = opts.input.value;
      if (value === "") return;

      if (value.length < minLength) {
        // Not a scan — manual typing + Enter. Ignore.
        return;
      }

      // Keep the last `minLength` characters if the reader prepended noise.
      if (value.length > minLength) {
        value = value.slice(-minLength);
      }

      const extracted = value.substr(extractStart, extractLength);
      const ticketId = Number.parseInt(extracted, 10);
      if (!Number.isFinite(ticketId)) return;

      opts.input.value = String(ticketId);
      opts.onScan(ticketId, value);
      if (opts.nextFocus) opts.nextFocus.focus();
    }, debounceMs);
  };

  opts.input.addEventListener("keydown", onKeydown);

  return function detach(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    opts.input.removeEventListener("keydown", onKeydown);
  };
}

export const BarcodeScanner = { attach: attachBarcodeScanner };
