// Modal component — Bootstrap-3-compatible API, vanilla DOM.
// Backdrop + keyboard semantics mirror Bootstrap 3 exactly so existing
// jQuery/bootstrap.min.js `data-backdrop`/`data-keyboard` attributes behave
// identically when legacy templates are ported.
//
// Settlement/close-day flows require `backdrop: "static"` + `keyboard: false`
// so the operator cannot dismiss the dialog by click-outside or ESC —

import { t } from "../i18n/I18n.js";

export type BackdropOption = "static" | true | false;

export interface ModalOptions {
  /** Title shown in the modal header. Omit for no header. */
  title?: string;
  /** Body content — HTML string or DOM node. HTML is NOT auto-escaped; caller is responsible. */
  content: string | Node;
  /**
   * - `true` (default): click on backdrop closes the modal.
   * - `false`: no backdrop element at all.
   * - `"static"`: backdrop is rendered and click is swallowed (modal stays open).
   *   Used for irreversible flows (settlement, close-day) where the operator
   *   must explicitly confirm or cancel.
   */
  backdrop?: BackdropOption;
  /**
   * - `true` (default): ESC closes the modal.
   * - `false`: ESC is ignored. Combine with `backdrop: "static"` for forced-confirm.
   */
  keyboard?: boolean;
  /** Bootstrap size modifier. */
  size?: "sm" | "lg" | "xl";
  /** Footer buttons. Omit for no footer. */
  buttons?: ModalButton[];
  /** Called when the modal is closed (by any means — ESC, backdrop, button, programmatic). */
  onClose?: (reason: ModalCloseReason) => void;
  /** CSS class to add to the outer `.modal` element (e.g. for danger-styling). */
  className?: string;
}

export interface ModalButton {
  label: string;
  /** `"default"` / `"primary"` / `"danger"` / `"success"` / `"warning"` / `"info"` */
  variant?: "default" | "primary" | "danger" | "success" | "warning" | "info";
  /** If `true`, clicking this button closes the modal (after onClick resolves). Default: `true`. */
  dismiss?: boolean;
  /** Click handler. If it returns a Promise, the button is disabled until it resolves. */
  onClick?: (instance: ModalInstance) => void | Promise<void>;
  /** Optional `data-action` attribute for tests and Agent B Settlement-flow. */
  action?: string;
}

export type ModalCloseReason = "backdrop" | "keyboard" | "button" | "programmatic";

export interface ModalInstance {
  /** The root `.modal` element. */
  root: HTMLElement;
  /** Closes the modal. `reason` defaults to `"programmatic"`. */
  close: (reason?: ModalCloseReason) => void;
  /** Replaces body content. */
  setContent: (content: string | Node) => void;
}

const activeModals: ModalInstance[] = [];

/**
 * Open a modal. Returns a handle with `close()` and `root`.
 *
 * Agent B Settlement-flow example:
 * ```ts
 * Modal.open({
 *   title: "Bekreft oppgjør",
 *   content: "Dette kan ikke angres.",
 *   backdrop: "static",
 *   keyboard: false,
 *   buttons: [
 *     { label: "Avbryt", variant: "default", action: "cancel" },
 *     { label: "Bekreft", variant: "danger", action: "confirm", onClick: submit },
 *   ],
 * });
 * ```
 */
export function open(opts: ModalOptions): ModalInstance {
  const backdrop: BackdropOption = opts.backdrop ?? true;
  const keyboard: boolean = opts.keyboard ?? true;

  const host = document.createElement("div");
  const sizeClass = opts.size === "sm" ? "modal-sm" : opts.size === "lg" || opts.size === "xl" ? "modal-lg" : "";
  const classes = ["modal", "fade", "in", opts.className ?? ""].filter(Boolean).join(" ");
  host.className = classes;
  host.setAttribute("tabindex", "-1");
  host.setAttribute("role", "dialog");
  host.style.display = "block";
  host.style.paddingRight = "15px";
  if (backdrop === "static") host.setAttribute("data-backdrop", "static");
  host.setAttribute("data-keyboard", keyboard ? "true" : "false");

  const dialog = document.createElement("div");
  dialog.className = `modal-dialog ${sizeClass}`.trim();
  dialog.setAttribute("role", "document");
  const contentBox = document.createElement("div");
  contentBox.className = "modal-content";

  // Header
  if (opts.title !== undefined) {
    const header = document.createElement("div");
    header.className = "modal-header";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "close";
    closeBtn.setAttribute("aria-label", t("close"));
    closeBtn.innerHTML = `<span aria-hidden="true">&times;</span>`;
    if (backdrop === "static" && keyboard === false) {
      // Matches legacy: no dismiss-X when dialog must be explicitly resolved.
      closeBtn.style.display = "none";
    } else {
      closeBtn.addEventListener("click", () => instance.close("button"));
    }
    const h4 = document.createElement("h4");
    h4.className = "modal-title";
    h4.textContent = opts.title;
    header.append(closeBtn, h4);
    contentBox.append(header);
  }

  // Body
  const body = document.createElement("div");
  body.className = "modal-body";
  appendContent(body, opts.content);
  contentBox.append(body);

  // Footer
  if (opts.buttons && opts.buttons.length > 0) {
    const footer = document.createElement("div");
    footer.className = "modal-footer";
    for (const btn of opts.buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn btn-${btn.variant ?? "default"}`;
      b.textContent = btn.label;
      if (btn.action) b.setAttribute("data-action", btn.action);
      b.addEventListener("click", async () => {
        if (btn.onClick) {
          b.disabled = true;
          try {
            await btn.onClick(instance);
          } finally {
            b.disabled = false;
          }
        }
        if (btn.dismiss !== false) instance.close("button");
      });
      footer.append(b);
    }
    contentBox.append(footer);
  }

  dialog.append(contentBox);
  host.append(dialog);

  // Backdrop element
  const backdropEl = backdrop === false ? null : document.createElement("div");
  if (backdropEl) {
    backdropEl.className = "modal-backdrop fade in";
    if (backdrop === true) {
      backdropEl.addEventListener("click", () => instance.close("backdrop"));
    }
    // `backdrop === "static"`: element exists but click does not dismiss.
    document.body.append(backdropEl);
  }

  // Prevent body scroll while modal is open
  const hadClass = document.body.classList.contains("modal-open");
  document.body.classList.add("modal-open");

  document.body.append(host);

  // Keyboard handling (ESC)
  const keyHandler = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && keyboard) instance.close("keyboard");
  };
  if (keyboard) document.addEventListener("keydown", keyHandler);

  // Click-outside on `.modal` container itself (Bootstrap 3 behaviour).
  // Inner `.modal-content` does not propagate this event, the outer wrapper does.
  if (backdrop === true) {
    host.addEventListener("click", (e) => {
      if (e.target === host) instance.close("backdrop");
    });
  }
  // backdrop === "static": swallow clicks on the .modal wrapper too.

  const instance: ModalInstance = {
    root: host,
    close: (reason: ModalCloseReason = "programmatic") => {
      document.removeEventListener("keydown", keyHandler);
      host.remove();
      backdropEl?.remove();
      if (!hadClass) document.body.classList.remove("modal-open");
      const idx = activeModals.indexOf(instance);
      if (idx >= 0) activeModals.splice(idx, 1);
      opts.onClose?.(reason);
    },
    setContent: (content) => {
      body.textContent = "";
      appendContent(body, content);
    },
  };
  activeModals.push(instance);
  return instance;
}

/** Close all currently-open modals. Respects `keyboard: false` — call with force=true to override. */
export function closeAll(force = false): void {
  const snapshot = [...activeModals];
  for (const m of snapshot) {
    const keyboardDisabled = m.root.getAttribute("data-keyboard") === "false";
    if (!force && keyboardDisabled) continue;
    m.close("programmatic");
  }
}

function appendContent(host: HTMLElement, content: string | Node): void {
  if (typeof content === "string") host.innerHTML = content;
  else host.append(content);
}

export const Modal = { open, closeAll };
