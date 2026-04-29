// Four variants: bg-blue / bg-yellow / bg-green / bg-red via icon-color.

import { escapeHtml } from "../../../utils/escapeHtml.js";

export interface InfoBoxOptions {
  labelLine1: string;
  labelLine2: string;
  /** Number, ratio, or `"—"` placeholder. */
  value: string | number;
  icon: string;
  color: "blue" | "yellow" | "green" | "red";
  href?: string;
}

export function renderInfoBox(opts: InfoBoxOptions): HTMLElement {
  const col = document.createElement("div");
  col.className = "col-md-3 col-sm-6 col-xs-12";

  const wrap = opts.href ? document.createElement("a") : document.createElement("div");
  if (opts.href) (wrap as HTMLAnchorElement).href = opts.href;
  wrap.style.textDecoration = "none";
  wrap.style.color = "inherit";

  const box = document.createElement("div");
  box.className = "info-box";

  const iconSpan = document.createElement("span");
  iconSpan.className = `info-box-icon bg-${opts.color}`;
  iconSpan.innerHTML = `<i class="${escapeHtml(opts.icon)}"></i>`;
  box.append(iconSpan);

  const content = document.createElement("div");
  content.className = "info-box-content";
  const text = document.createElement("span");
  text.className = "info-box-text";
  text.style.fontSize = "11px";
  text.innerHTML = `${escapeHtml(opts.labelLine1)}<br />${escapeHtml(opts.labelLine2)}`;
  const number = document.createElement("span");
  number.className = "info-box-number";
  number.textContent = typeof opts.value === "number" ? String(opts.value) : opts.value;
  content.append(text, number);
  box.append(content);

  wrap.append(box);
  col.append(wrap);
  return col;
}
