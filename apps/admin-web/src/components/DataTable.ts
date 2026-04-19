// DataTable stub — minimal bs3-compatible table API.
// Full DataTables.net integration lands in PR-A3 when the first list-view
// is ported. PR-A1 only exposes the shape so Agent B can consume it without
// file-ownership conflicts.

export interface Column<T> {
  key: keyof T & string;
  title: string;
  render?: (row: T) => string | Node;
  width?: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
}

export interface DataTableOptions<T> {
  columns: Column<T>[];
  rows: T[];
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function mount<T>(container: HTMLElement, opts: DataTableOptions<T>): void {
  container.innerHTML = "";
  const table = document.createElement("table");
  table.className = `table table-bordered table-hover ${opts.className ?? ""}`.trim();

  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  for (const col of opts.columns) {
    const th = document.createElement("th");
    th.textContent = col.title;
    if (col.width) th.style.width = col.width;
    if (col.align) th.style.textAlign = col.align;
    tr.append(th);
  }
  thead.append(tr);
  table.append(thead);

  const tbody = document.createElement("tbody");
  if (opts.rows.length === 0) {
    const empty = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = opts.columns.length;
    td.style.textAlign = "center";
    td.textContent = opts.emptyMessage ?? "No data available in table";
    empty.append(td);
    tbody.append(empty);
  } else {
    for (const row of opts.rows) {
      const rowEl = document.createElement("tr");
      if (opts.onRowClick) {
        rowEl.style.cursor = "pointer";
        rowEl.addEventListener("click", () => opts.onRowClick!(row));
      }
      for (const col of opts.columns) {
        const td = document.createElement("td");
        if (col.align) td.style.textAlign = col.align;
        if (col.render) {
          const out = col.render(row);
          if (typeof out === "string") td.innerHTML = out;
          else td.append(out);
        } else {
          const v = row[col.key];
          td.textContent = v == null ? "" : String(v);
        }
        rowEl.append(td);
      }
      tbody.append(rowEl);
    }
  }
  table.append(tbody);
  container.append(table);
}

export const DataTable = { mount };
