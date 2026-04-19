// Form stub — helpers for building bs3-style form-groups with validation hooks.
// jQuery-form-validator wiring lands when the first CRUD form is ported.

export interface FieldOptions {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "tel" | "url" | "date" | "textarea" | "select";
  placeholder?: string;
  required?: boolean;
  value?: string | number;
  options?: Array<{ value: string; label: string }>;
  help?: string;
}

export function renderField(opts: FieldOptions): HTMLElement {
  const group = document.createElement("div");
  group.className = "form-group";
  const label = document.createElement("label");
  label.setAttribute("for", `f-${opts.name}`);
  label.textContent = opts.label + (opts.required ? " *" : "");
  group.append(label);

  let field: HTMLElement;
  if (opts.type === "textarea") {
    const ta = document.createElement("textarea");
    ta.className = "form-control";
    ta.id = `f-${opts.name}`;
    ta.name = opts.name;
    if (opts.placeholder) ta.placeholder = opts.placeholder;
    if (opts.required) ta.required = true;
    if (opts.value != null) ta.value = String(opts.value);
    field = ta;
  } else if (opts.type === "select") {
    const sel = document.createElement("select");
    sel.className = "form-control";
    sel.id = `f-${opts.name}`;
    sel.name = opts.name;
    if (opts.required) sel.required = true;
    for (const o of opts.options ?? []) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (String(opts.value) === o.value) opt.selected = true;
      sel.append(opt);
    }
    field = sel;
  } else {
    const input = document.createElement("input");
    input.className = "form-control";
    input.id = `f-${opts.name}`;
    input.name = opts.name;
    input.type = opts.type ?? "text";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.required) input.required = true;
    if (opts.value != null) input.value = String(opts.value);
    field = input;
  }
  group.append(field);

  if (opts.help) {
    const help = document.createElement("p");
    help.className = "help-block";
    help.textContent = opts.help;
    group.append(help);
  }
  return group;
}

export function toObject(form: HTMLFormElement): Record<string, string> {
  const fd = new FormData(form);
  const out: Record<string, string> = {};
  fd.forEach((v, k) => {
    out[k] = typeof v === "string" ? v : "";
  });
  return out;
}

export const Form = { renderField, toObject };
