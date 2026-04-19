// Toast stub — lightweight alert-like notifications. Replaces `toastr` at API
// level; will swap to real toastr when first page needs it.

export type ToastLevel = "success" | "info" | "warning" | "error";

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement("div");
  container.id = "toast-container";
  container.className = "toast-top-right";
  container.style.cssText = "position:fixed;top:12px;right:12px;z-index:10500;display:flex;flex-direction:column;gap:8px;max-width:360px;";
  document.body.append(container);
  return container;
}

export function show(message: string, level: ToastLevel = "info", timeoutMs = 4000): void {
  const host = ensureContainer();
  const box = document.createElement("div");
  box.className = `alert alert-${level === "error" ? "danger" : level}`;
  box.setAttribute("role", "alert");
  box.style.cssText = "margin:0;box-shadow:0 2px 6px rgba(0,0,0,0.15);cursor:pointer;";
  box.textContent = message;
  box.addEventListener("click", () => box.remove());
  host.append(box);
  if (timeoutMs > 0) {
    setTimeout(() => box.remove(), timeoutMs);
  }
}

export const Toast = {
  show,
  success: (msg: string) => show(msg, "success"),
  info: (msg: string) => show(msg, "info"),
  warning: (msg: string) => show(msg, "warning"),
  error: (msg: string) => show(msg, "error"),
};
