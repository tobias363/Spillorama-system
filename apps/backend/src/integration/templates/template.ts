/**
 * BIN-588: Minimal Handlebars-compatible template engine.
 *
 * Supports the subset used by the ported legacy mail templates:
 *   {{var}}                    - simple variable
 *   {{nested.path}}            - dotted path lookup
 *   {{#if var}}...{{/if}}      - truthy-block (no else)
 *
 * Missing variables render as empty string. Output is HTML-escaped by
 * default; prefix the expression with "&" (e.g. {{&rawHtml}}) to skip
 * escaping. The set of features was chosen to match the
 * `forgot_mail_template.html` and `bankid_reminder.html` legacy templates
 * without pulling in the full handlebars runtime.
 */

export type TemplateContext = Record<string, unknown>;

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char);
}

function lookup(ctx: TemplateContext, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = ctx;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Render a template string. Throws only on malformed `{{#if}}`/`{{/if}}`
 * pairs; missing variables silently render as empty.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  const parts: string[] = [];
  let i = 0;
  const n = template.length;

  while (i < n) {
    const open = template.indexOf("{{", i);
    if (open === -1) {
      parts.push(template.slice(i));
      break;
    }
    parts.push(template.slice(i, open));
    const close = template.indexOf("}}", open + 2);
    if (close === -1) {
      parts.push(template.slice(open));
      break;
    }
    const expr = template.slice(open + 2, close).trim();
    i = close + 2;

    if (expr.startsWith("#if ")) {
      const condPath = expr.slice(4).trim();
      const endTag = "{{/if}}";
      const endIndex = findMatchingEndIf(template, i);
      if (endIndex === -1) {
        throw new Error(`Template: unclosed {{#if ${condPath}}}`);
      }
      const block = template.slice(i, endIndex);
      i = endIndex + endTag.length;
      if (isTruthy(lookup(context, condPath))) {
        parts.push(renderTemplate(block, context));
      }
      continue;
    }

    if (expr === "/if") {
      throw new Error("Template: unexpected {{/if}} without matching {{#if}}");
    }

    const raw = expr.startsWith("&");
    const path = raw ? expr.slice(1).trim() : expr;
    const value = stringify(lookup(context, path));
    parts.push(raw ? value : escapeHtml(value));
  }

  return parts.join("");
}

/**
 * Find the matching `{{/if}}` for an opened `#if` block, taking nested
 * `#if` blocks into account.
 */
function findMatchingEndIf(template: string, from: number): number {
  let depth = 1;
  let pos = from;
  while (pos < template.length) {
    const open = template.indexOf("{{", pos);
    if (open === -1) return -1;
    const close = template.indexOf("}}", open + 2);
    if (close === -1) return -1;
    const expr = template.slice(open + 2, close).trim();
    if (expr.startsWith("#if ")) {
      depth += 1;
    } else if (expr === "/if") {
      depth -= 1;
      if (depth === 0) return open;
    }
    pos = close + 2;
  }
  return -1;
}
