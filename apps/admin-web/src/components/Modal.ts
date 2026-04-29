// Modal component — Bootstrap-3-compatible API, vanilla DOM.
// Backdrop + keyboard semantics mirror Bootstrap 3 exactly so existing
// jQuery/bootstrap.min.js `data-backdrop`/`data-keyboard` attributes behave
// identically when legacy templates are ported.
//
// Settlement/close-day flows require `backdrop: "static"` + `keyboard: false`
// so the operator cannot dismiss the dialog by click-outside or ESC —
//
// FE-P0-001 (Bølge 2B, 2026-04-29): WCAG 2.1 AA compliance.
//   * `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (title) on host.
//   * Focus trap: Tab/Shift+Tab cycles within modal (WCAG 2.1.2 No Keyboard Trap).
//   * Initial focus: first focusable element (or close-X / first button) (WCAG 2.4.3 Focus Order).
//   * Focus restore: focus returns to opener element on close.
//   * `inert` attribute on direct sibling elements while modal is open
//     (prevents AT/screen-reader from reading background while modal active).
//   * Stacking: nested modals push/pop state — outer modal's opener and inert-set
//     remain intact; inner modal manages its own.

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
  /**
   * Optional explicit `aria-label` for screen-readers when there is no `title`.
   * If both `title` and `ariaLabel` are absent, the modal will still be labelled
   * via the rendered title id; with neither, AT will read "dialog" only.
   */
  ariaLabel?: string;
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
let modalIdCounter = 0;

/**
 * CSS selector for elements considered focusable for Tab navigation inside the modal.
 * Mirrors common focus-trap libraries; `[tabindex="-1"]` is intentionally excluded
 * because programmatic focus targets should not participate in Tab cycle.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
  "audio[controls]",
  "video[controls]",
  "details > summary:first-of-type",
].join(",");

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

  // Remember the element that had focus before the modal opened so we can
  // restore it on close (WCAG 2.4.3). Falls back to <body> if nothing is focused.
  const previouslyFocused: HTMLElement | null =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;

  // Unique ids for aria-labelledby / aria-describedby wiring.
  modalIdCounter += 1;
  const modalId = `modal-${modalIdCounter}`;
  const titleId = `${modalId}-title`;

  const host = document.createElement("div");
  const sizeClass = opts.size === "sm" ? "modal-sm" : opts.size === "lg" || opts.size === "xl" ? "modal-lg" : "";
  const classes = ["modal", "fade", "in", opts.className ?? ""].filter(Boolean).join(" ");
  host.className = classes;
  host.id = modalId;
  host.setAttribute("tabindex", "-1");
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  if (opts.title !== undefined) {
    host.setAttribute("aria-labelledby", titleId);
  } else if (opts.ariaLabel) {
    host.setAttribute("aria-label", opts.ariaLabel);
  }
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
    h4.id = titleId;
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

  // Apply `inert` to all existing direct children of <body> so that screen
  // readers and keyboard navigation cannot reach background content while the
  // modal is open. We snapshot the set of elements we mutated so that on
  // close we only revert those — preserves correct stacking when a modal
  // opens a nested confirm modal.
  const inertedSiblings: HTMLElement[] = [];
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    // Skip prior modals/backdrops and the toast container, which must remain interactive.
    if (
      child.classList.contains("modal") ||
      child.classList.contains("modal-backdrop") ||
      child.id === "toast-container"
    ) {
      continue;
    }
    // Don't double-inert elements that were already inert before we opened.
    if (child.hasAttribute("inert")) continue;
    child.setAttribute("inert", "");
    child.setAttribute("aria-hidden", "true");
    inertedSiblings.push(child);
  }

  document.body.append(host);

  // Keyboard handling: ESC + focus-trap (Tab / Shift+Tab cycle).
  const keyHandler = (e: KeyboardEvent): void => {
    // Only the topmost modal in the stack should react to keys.
    const top = activeModals[activeModals.length - 1];
    if (top !== instance) return;

    if (e.key === "Escape" && keyboard) {
      instance.close("keyboard");
      return;
    }

    if (e.key === "Tab") {
      const focusables = getFocusableElements(host);
      if (focusables.length === 0) {
        // Nothing to focus inside — keep focus on the host so Tab cannot
        // escape into the (inert) background.
        e.preventDefault();
        host.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // If focus has somehow escaped the modal (e.g. browser-default focus on body),
      // bring it back to the first focusable element.
      if (!active || !host.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey) {
        if (active === first || active === host) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };
  document.addEventListener("keydown", keyHandler);

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
      // Revert `inert` only on the elements we mutated.
      for (const sib of inertedSiblings) {
        sib.removeAttribute("inert");
        sib.removeAttribute("aria-hidden");
      }
      const idx = activeModals.indexOf(instance);
      if (idx >= 0) activeModals.splice(idx, 1);
      // Restore focus to the element that opened this modal (WCAG 2.4.3).
      // Skip restoration when there is a topmost modal still open — that
      // outer modal's own focus-trap will reclaim focus.
      if (activeModals.length === 0 && previouslyFocused && document.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus();
        } catch {
          // Element may have become non-focusable since open; swallow.
        }
      }
      opts.onClose?.(reason);
    },
    setContent: (content) => {
      body.textContent = "";
      appendContent(body, content);
    },
  };
  activeModals.push(instance);

  // Move focus into the modal synchronously so that any callsite-level
  // `expect(document.activeElement)` assertion observes focus correctly,
  // and so the previously-focused element is reliably blurred before the
  // user's first keypress. We honour an explicit `autofocus` attribute on
  // a body element by preferring it over the default body-first picker.
  const target = pickInitialFocus(host);
  try {
    target.focus();
  } catch {
    // Defensive: jsdom may throw if the node is somehow detached.
  }

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

/**
 * Returns all currently focusable elements inside the modal in DOM order.
 * Filters out elements that are not visible (`display:none` / `visibility:hidden`)
 * because focusing an invisible element confuses both sighted keyboard users
 * and screen-readers.
 */
function getFocusableElements(host: HTMLElement): HTMLElement[] {
  const candidates = Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => isElementVisible(el));
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  // jsdom does not implement layout, so `offsetParent` is null even for
  // visible elements. Fall back to inline style heuristics there.
  const style = el.style;
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

/**
 * Initial focus order, matches WCAG SC 2.4.3 best practice and Bootstrap-3 default.
 *   0. An explicit `autofocus` element anywhere inside `.modal-body` (caller intent wins).
 *   1. First focusable inside `.modal-body` (form input, link, button) — most-common UX expectation.
 *   2. First focusable button in `.modal-footer` — fallback for content-only modals.
 *   3. The close-X in the header.
 *   4. The modal host itself (programmatic focus target via `tabindex=-1`).
 */
function pickInitialFocus(host: HTMLElement): HTMLElement {
  const body = host.querySelector<HTMLElement>(".modal-body");
  if (body) {
    const autofocus = body.querySelector<HTMLElement>("[autofocus]");
    if (autofocus && isElementVisible(autofocus)) return autofocus;
    const bodyFocusables = body.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    for (const el of Array.from(bodyFocusables)) {
      if (isElementVisible(el)) return el;
    }
  }
  const footer = host.querySelector<HTMLElement>(".modal-footer");
  if (footer) {
    const footerFocusables = footer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    for (const el of Array.from(footerFocusables)) {
      if (isElementVisible(el)) return el;
    }
  }
  const closeX = host.querySelector<HTMLElement>(".modal-header .close");
  if (closeX && isElementVisible(closeX)) return closeX;
  return host;
}

export const Modal = { open, closeAll };
