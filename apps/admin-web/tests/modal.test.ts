import { describe, it, expect, beforeEach, vi } from "vitest";
import { Modal } from "../src/components/Modal.js";
import { initI18n } from "../src/i18n/I18n.js";

describe("Modal", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
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
});
