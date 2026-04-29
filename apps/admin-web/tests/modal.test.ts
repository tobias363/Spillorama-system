import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Modal } from "../src/components/Modal.js";
import { initI18n } from "../src/i18n/I18n.js";

describe("Modal", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
  });

  // Force-close any leftover modal instances so the internal `activeModals[]`
  // state cannot leak between tests. Without this, a test that calls
  // `Modal.open()` without explicit close() would leave a stale entry that
  // breaks the next test's `previouslyFocused` restore (it bails when
  // `activeModals.length > 0`).
  afterEach(() => {
    Modal.closeAll(true);
    document.body.innerHTML = "";
  });

  it("renders a modal with backdrop and body content by default", () => {
    const m = Modal.open({ content: "hello" });
    expect(document.querySelector(".modal")).toBeTruthy();
    expect(document.querySelector(".modal-backdrop")).toBeTruthy();
    expect(document.querySelector(".modal-body")?.textContent).toBe("hello");
    expect(document.body.classList.contains("modal-open")).toBe(true);
    m.close();
    expect(document.querySelector(".modal")).toBeFalsy();
    expect(document.querySelector(".modal-backdrop")).toBeFalsy();
  });

  it("ESC closes the modal by default", () => {
    const onClose = vi.fn();
    Modal.open({ content: "x", onClose });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledWith("keyboard");
    expect(document.querySelector(".modal")).toBeFalsy();
  });

  it("keyboard:false ignores ESC (Agent B Settlement flow)", () => {
    const onClose = vi.fn();
    Modal.open({ content: "x", keyboard: false, onClose });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".modal")).toBeTruthy();
  });

  it("backdrop:true dismisses on backdrop click", () => {
    const onClose = vi.fn();
    Modal.open({ content: "x", onClose });
    const modalEl = document.querySelector<HTMLElement>(".modal")!;
    // Bootstrap 3 dismisses when click target IS the modal wrapper
    modalEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledWith("backdrop");
  });

  it("backdrop:'static' does NOT dismiss on backdrop click (Settlement flow)", () => {
    const onClose = vi.fn();
    Modal.open({ content: "x", backdrop: "static", onClose });
    const modalEl = document.querySelector<HTMLElement>(".modal")!;
    modalEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".modal")).toBeTruthy();
    expect(modalEl.getAttribute("data-backdrop")).toBe("static");
  });

  it("backdrop:'static' + keyboard:false hides the close-X button", () => {
    Modal.open({ title: "Bekreft", content: "kan ikke angres", backdrop: "static", keyboard: false });
    const closeX = document.querySelector<HTMLElement>(".modal-header .close");
    expect(closeX).toBeTruthy();
    expect(closeX!.style.display).toBe("none");
  });

  it("backdrop:false renders no backdrop element", () => {
    Modal.open({ content: "x", backdrop: false });
    expect(document.querySelector(".modal-backdrop")).toBeFalsy();
    expect(document.querySelector(".modal")).toBeTruthy();
  });

  it("renders footer buttons with data-action and variant classes", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    Modal.open({
      title: "Bekreft oppgjør",
      content: "Dette kan ikke angres.",
      backdrop: "static",
      keyboard: false,
      buttons: [
        { label: "Avbryt", variant: "default", action: "cancel", onClick: onCancel },
        { label: "Bekreft", variant: "danger", action: "confirm", onClick: onConfirm },
      ],
    });
    const cancel = document.querySelector<HTMLButtonElement>("[data-action='cancel']")!;
    const confirm = document.querySelector<HTMLButtonElement>("[data-action='confirm']")!;
    expect(cancel.classList.contains("btn-default")).toBe(true);
    expect(confirm.classList.contains("btn-danger")).toBe(true);
    confirm.click();
    // Allow the async click handler to resolve
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalled();
  });

  it("closeAll skips keyboard:false modals unless force=true", () => {
    Modal.open({ content: "a", keyboard: false });
    Modal.open({ content: "b" });
    Modal.closeAll();
    expect(document.querySelectorAll(".modal")).toHaveLength(1);
    Modal.closeAll(true);
    expect(document.querySelectorAll(".modal")).toHaveLength(0);
  });

  // ── FE-P0-001 (Bølge 2B) — WCAG 2.1 AA accessibility ──────────────────────

  describe("WCAG 2.1 AA accessibility (FE-P0-001)", () => {
    it("sets role=dialog and aria-modal=true on the modal host", () => {
      Modal.open({ title: "Settlement", content: "body" });
      const modalEl = document.querySelector<HTMLElement>(".modal")!;
      expect(modalEl.getAttribute("role")).toBe("dialog");
      expect(modalEl.getAttribute("aria-modal")).toBe("true");
    });

    it("binds aria-labelledby to the rendered title id", () => {
      Modal.open({ title: "Bekreft oppgjør", content: "body" });
      const modalEl = document.querySelector<HTMLElement>(".modal")!;
      const labelledBy = modalEl.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      const titleEl = document.getElementById(labelledBy!);
      expect(titleEl).toBeTruthy();
      expect(titleEl!.textContent).toBe("Bekreft oppgjør");
      expect(titleEl!.classList.contains("modal-title")).toBe(true);
    });

    it("uses ariaLabel option as fallback when there is no title", () => {
      Modal.open({ content: "body", ariaLabel: "Quick prompt" });
      const modalEl = document.querySelector<HTMLElement>(".modal")!;
      expect(modalEl.getAttribute("aria-labelledby")).toBeNull();
      expect(modalEl.getAttribute("aria-label")).toBe("Quick prompt");
    });

    it("focus-trap: Tab from last focusable wraps to first (close-X)", () => {
      const form = document.createElement("form");
      form.innerHTML = `<input id="i1" type="text"><input id="i2" type="text">`;
      Modal.open({
        title: "T",
        content: form,
        buttons: [
          { label: "Cancel", action: "cancel" },
          { label: "Confirm", action: "confirm" },
        ],
      });

      const closeX = document.querySelector<HTMLButtonElement>(".modal-header .close")!;
      const confirmBtn = document.querySelector<HTMLButtonElement>("[data-action='confirm']")!;

      // Park focus on the LAST focusable inside the modal (Confirm button).
      confirmBtn.focus();
      expect(document.activeElement).toBe(confirmBtn);

      // Forward Tab from the last focusable should wrap to the first
      // focusable in DOM order, which is the header close-X.
      const tabEvt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      const propagated = document.dispatchEvent(tabEvt);
      expect(propagated).toBe(false); // preventDefault was called
      expect(document.activeElement).toBe(closeX);
    });

    it("focus-trap: Shift+Tab from first focusable (close-X) wraps to last", () => {
      const form = document.createElement("form");
      form.innerHTML = `<input id="i1" type="text">`;
      Modal.open({
        title: "T",
        content: form,
        buttons: [
          { label: "Cancel", action: "cancel" },
          { label: "Confirm", action: "confirm" },
        ],
      });

      const closeX = document.querySelector<HTMLButtonElement>(".modal-header .close")!;
      const confirmBtn = document.querySelector<HTMLButtonElement>("[data-action='confirm']")!;

      closeX.focus();
      expect(document.activeElement).toBe(closeX);

      const evt = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const propagated = document.dispatchEvent(evt);
      expect(propagated).toBe(false);
      expect(document.activeElement).toBe(confirmBtn);
    });

    it("focus-trap: tab between mid-elements is not intercepted (browser default)", () => {
      const form = document.createElement("form");
      form.innerHTML = `<input id="i1" type="text"><input id="i2" type="text">`;
      Modal.open({
        title: "T",
        content: form,
        buttons: [{ label: "OK", action: "ok" }],
      });

      const i1 = document.getElementById("i1") as HTMLInputElement;
      i1.focus();

      // Tab from a mid-list element must not be preventDefault'd —
      // the browser handles focus advancement natively inside the modal.
      const evt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      const propagated = document.dispatchEvent(evt);
      expect(propagated).toBe(true); // not prevented
    });

    it("focus-trap: brings focus back into modal when activeElement escapes", () => {
      const stray = document.createElement("button");
      stray.id = "stray";
      stray.textContent = "outside";
      document.body.appendChild(stray);

      const form = document.createElement("form");
      form.innerHTML = `<input id="ix" type="text">`;
      Modal.open({ title: "T", content: form, buttons: [{ label: "OK", action: "ok" }] });

      // Simulate focus accidentally landing outside the modal.
      stray.focus();
      expect(document.activeElement).toBe(stray);

      const modalEl = document.querySelector<HTMLElement>(".modal")!;
      const tabEvt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      document.dispatchEvent(tabEvt);

      // After the trap fires, focus must be inside the modal somewhere.
      expect(modalEl.contains(document.activeElement)).toBe(true);
    });

    it("initial focus lands on the first focusable inside .modal-body", () => {
      const form = document.createElement("form");
      form.innerHTML = `<input id="first" type="text">`;
      Modal.open({
        title: "T",
        content: form,
        buttons: [{ label: "OK", action: "ok" }],
      });
      expect(document.activeElement?.id).toBe("first");
    });

    it("initial focus prefers an [autofocus] element in the body over DOM order", () => {
      const form = document.createElement("form");
      form.innerHTML = `
        <input id="plain" type="text">
        <input id="auto" type="text" autofocus>`;
      Modal.open({
        title: "T",
        content: form,
        buttons: [{ label: "OK", action: "ok" }],
      });
      expect(document.activeElement?.id).toBe("auto");
    });

    it("focus-restore: returns focus to opener element when modal closes", () => {
      const opener = document.createElement("button");
      opener.id = "opener";
      opener.textContent = "Open";
      document.body.appendChild(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      const m = Modal.open({ title: "Settlement", content: "body" });
      // Modal should now have focus inside
      expect(document.activeElement).not.toBe(opener);

      m.close();
      expect(document.activeElement).toBe(opener);
    });

    it("focus-restore: gracefully handles opener that was removed from DOM", () => {
      const opener = document.createElement("button");
      document.body.appendChild(opener);
      opener.focus();
      const m = Modal.open({ title: "T", content: "body" });
      // Opener is removed before modal closes
      opener.remove();
      // Should not throw on close.
      expect(() => m.close()).not.toThrow();
    });

    it("inert: applies inert + aria-hidden to background siblings while open", () => {
      const sibling = document.createElement("div");
      sibling.id = "background-content";
      sibling.textContent = "main page";
      document.body.appendChild(sibling);

      Modal.open({ title: "T", content: "body" });
      expect(sibling.hasAttribute("inert")).toBe(true);
      expect(sibling.getAttribute("aria-hidden")).toBe("true");
    });

    it("inert: removes inert + aria-hidden from siblings on close", () => {
      const sibling = document.createElement("div");
      sibling.id = "background-content";
      document.body.appendChild(sibling);

      const m = Modal.open({ title: "T", content: "body" });
      expect(sibling.hasAttribute("inert")).toBe(true);
      m.close();
      expect(sibling.hasAttribute("inert")).toBe(false);
      expect(sibling.hasAttribute("aria-hidden")).toBe(false);
    });

    it("inert: does not touch sibling that was already inert before opening", () => {
      const sibling = document.createElement("div");
      sibling.setAttribute("inert", "");
      document.body.appendChild(sibling);
      const m = Modal.open({ title: "T", content: "body" });
      // Still inert (we didn't add it)
      expect(sibling.hasAttribute("inert")).toBe(true);
      m.close();
      // Crucially: still inert after close (we didn't remove it because we didn't add it)
      expect(sibling.hasAttribute("inert")).toBe(true);
    });

    it("inert: does not inert the toast container (toasts must reach screen readers)", () => {
      const toast = document.createElement("div");
      toast.id = "toast-container";
      document.body.appendChild(toast);
      Modal.open({ title: "T", content: "body" });
      expect(toast.hasAttribute("inert")).toBe(false);
    });

    it("nested modal: only the topmost modal handles ESC", () => {
      const onCloseOuter = vi.fn();
      const onCloseInner = vi.fn();
      Modal.open({ title: "Outer", content: "outer", onClose: onCloseOuter });
      Modal.open({ title: "Inner", content: "inner", onClose: onCloseInner });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(onCloseInner).toHaveBeenCalledWith("keyboard");
      expect(onCloseOuter).not.toHaveBeenCalled();
      // Outer is still in the DOM
      expect(document.querySelectorAll(".modal")).toHaveLength(1);
    });

    it("nested modal: closing inner restores focus into outer modal, not opener", () => {
      const opener = document.createElement("button");
      document.body.appendChild(opener);
      opener.focus();

      Modal.open({ title: "Outer", content: "<button id='outer-btn'>OK</button>" });
      // Now inside outer modal
      const outerBtn = document.getElementById("outer-btn") as HTMLButtonElement;
      // Focus is on outerBtn (or should be near it via initial-focus picker)

      const inner = Modal.open({ title: "Inner", content: "inner" });
      inner.close();

      // Opener must NOT regain focus while outer modal is still open
      expect(document.activeElement).not.toBe(opener);
      // outerBtn should still exist
      expect(outerBtn).toBeTruthy();
    });
  });
});
