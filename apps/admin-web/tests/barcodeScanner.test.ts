import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { attachBarcodeScanner } from "../src/components/BarcodeScanner.js";

describe("BarcodeScanner", () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    input = document.createElement("input");
    input.type = "text";
    document.body.append(input);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function typeAndEnter(value: string): void {
    input.value = value;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    vi.runAllTimers();
  }

  it("extracts 7-digit ticket ID from the 22-char barcode", () => {
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan });

    // positions:      0         1         2
    //                 012345678901234567890123
    //                           ^extractStart=14, len=7 → "1234567"
    typeAndEnter("0000000000000012345670099"); // > 22 chars, last 22 retained
    expect(onScan).toHaveBeenCalledOnce();
    const [ticketId, raw] = onScan.mock.calls[0]!;
    expect(raw).toBe("000000000000012345670099".slice(-22));
    expect(ticketId).toBe(Number("0000000000000012345670099".slice(-22).substr(14, 7)));
  });

  it("keeps the last 22 chars when the scanner prepends noise", () => {
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan });
    const tail = "ABCDEFGHIJKLMN1234567ZZ"; // 23 chars, last 22 = "BCDEFGHIJKLMN1234567ZZ"
    typeAndEnter("XYZ" + tail);
    expect(onScan).toHaveBeenCalledOnce();
    const [, raw] = onScan.mock.calls[0]!;
    expect(raw.length).toBe(22);
    expect(raw).toBe(("XYZ" + tail).slice(-22));
  });

  it("ignores Enter when value is shorter than minLength", () => {
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan });
    typeAndEnter("123"); // too short — not a scan
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores Enter on empty input", () => {
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan });
    typeAndEnter("");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("debounces: onScan fires only after the debounceMs delay", () => {
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan, debounceMs: 250 });
    input.value = "0000000000000012345670099";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    // Not yet:
    vi.advanceTimersByTime(100);
    expect(onScan).not.toHaveBeenCalled();
    // Still not:
    vi.advanceTimersByTime(100);
    expect(onScan).not.toHaveBeenCalled();
    // Now:
    vi.advanceTimersByTime(100);
    expect(onScan).toHaveBeenCalledOnce();
  });

  it("parses the extracted substring as a number and writes it back to input", () => {
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan });
    typeAndEnter("0000000000000012345670099");
    const [ticketId] = onScan.mock.calls[0]!;
    expect(typeof ticketId).toBe("number");
    expect(input.value).toBe(String(ticketId));
  });

  it("moves focus to nextFocus after a successful scan", () => {
    const next = document.createElement("input");
    document.body.append(next);
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan, nextFocus: next });
    typeAndEnter("0000000000000012345670099");
    expect(document.activeElement).toBe(next);
  });

  it("detach removes the listener — subsequent Enter does not fire onScan", () => {
    const onScan = vi.fn();
    const detach = attachBarcodeScanner({ input, onScan });
    detach();
    typeAndEnter("0000000000000012345670099");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores Enter-only on other keys", () => {
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan });
    input.value = "0000000000000012345670099";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    vi.runAllTimers();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("rapid re-Enter: pending timer is reset, only the last scan fires", () => {
    const onScan = vi.fn();
    attachBarcodeScanner({ input, onScan, debounceMs: 250 });
    input.value = "0000000000000099999990099";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    vi.advanceTimersByTime(100);
    // User re-enters a different value and presses Enter again
    input.value = "0000000000000011111110099";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    vi.advanceTimersByTime(260);
    expect(onScan).toHaveBeenCalledOnce();
    const [, raw] = onScan.mock.calls[0]!;
    expect(raw).toBe("0000000000000011111110099".slice(-22));
  });
});
