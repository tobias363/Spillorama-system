/**
 * Fase 2 (2026-05-07): GamePlan editor (plan-meta + sekvens-builder).
 *
 * URLer:
 *   /admin/#/games/plans/new   — opprett ny plan (kun meta, ingen items i v1)
 *   /admin/#/games/plans/:id   — rediger eksisterende plan + sekvens
 *
 * To kolonner:
 *   Venstre: tilgjengelige spill (katalog, søk + "Legg til")
 *   Høyre:   plan-sekvens (drag-and-drop reorder, "Fjern", "Lagre rekkefølge")
 *
 * Drag-and-drop: native HTML5 dragstart/dragover/drop. Lett implementasjon —
 * ingen tunge biblioteker. Reorder-state holdes i en lokal array, og
 * sequence-blokken re-renders på hver mutation.
 */

import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";
import { t } from "../../../i18n/I18n.js";
import {
  defaultPlanPayload,
  fetchPlan,
  payloadToCreateInput,
  payloadToUpdateInput,
  planToPayload,
  saveItems,
  savePlanMeta,
  type PlanMetaPayload,
} from "./GamePlanState.js";
import { fetchCatalogList } from "../catalog/GameCatalogState.js";
import {
  BONUS_GAME_DISPLAY_NAMES,
  BONUS_GAME_SLUG_VALUES,
  WEEKDAY_VALUES,
  type BonusGameSlug,
  type GamePlanWithItems,
  type SetGamePlanItemInput,
  type Weekday,
} from "../../../api/admin-game-plans.js";
import type { GameCatalogEntry } from "../../../api/admin-game-catalog.js";
import { listHalls, type AdminHall } from "../../../api/admin-halls.js";
import { listHallGroups } from "../../../api/admin-hall-groups.js";

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mandag",
  tue: "Tirsdag",
  wed: "Onsdag",
  thu: "Torsdag",
  fri: "Fredag",
  sat: "Lørdag",
  sun: "Søndag",
};

interface PlanEditorState {
  meta: PlanMetaPayload;
  /** Sekvens-rekkefølge (kun for edit-mode). */
  sequence: SetGamePlanItemInput[];
  /** Original sekvens (for diff-detection). */
  originalSequence: SetGamePlanItemInput[];
  catalog: GameCatalogEntry[];
  halls: AdminHall[];
  groups: { id: string; name: string }[];
  planId: string | null;
}

export async function renderGamePlanNewPage(
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = renderLoading();
  try {
    const [catalog, halls, groupsResult] = await Promise.all([
      fetchCatalogList({ isActive: true }),
      listHalls({ includeInactive: false }).catch(() => [] as AdminHall[]),
      listHallGroups({ status: "active" }).catch(
        () => ({ groups: [], count: 0 } as { groups: Array<{ id: string; name: string }>; count: number }),
      ),
    ]);
    const state: PlanEditorState = {
      meta: defaultPlanPayload(),
      sequence: [],
      originalSequence: [],
      catalog,
      halls,
      groups: groupsResult.groups.map((g) => ({ id: g.id, name: g.name })),
      planId: null,
    };
    renderEditor(container, state);
  } catch (err) {
    container.innerHTML = renderError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function renderGamePlanEditPage(
  container: HTMLElement,
  id: string,
): Promise<void> {
  container.innerHTML = renderLoading();
  try {
    const [plan, catalog, halls, groupsResult] = await Promise.all([
      fetchPlan(id),
      fetchCatalogList({ isActive: true }),
      listHalls({ includeInactive: false }).catch(() => [] as AdminHall[]),
      listHallGroups({ status: "active" }).catch(
        () => ({ groups: [], count: 0 } as { groups: Array<{ id: string; name: string }>; count: number }),
      ),
    ]);
    if (!plan) {
      container.innerHTML = renderError(`Plan med id ${id} ble ikke funnet.`);
      return;
    }
    const sequence: SetGamePlanItemInput[] = plan.items.map((it) => ({
      gameCatalogId: it.gameCatalogId,
      bonusGameOverride: it.bonusGameOverride ?? null,
      notes: it.notes,
    }));
    const state: PlanEditorState = {
      meta: planToPayload(plan),
      sequence,
      originalSequence: sequence.slice(),
      catalog,
      halls,
      groups: groupsResult.groups.map((g) => ({ id: g.id, name: g.name })),
      planId: plan.id,
    };
    renderEditor(container, state);
  } catch (err) {
    container.innerHTML = renderError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

function renderLoading(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content"><div class="row"><div class="col-sm-12">
        <div class="text-center" style="padding:48px"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>
      </div></div></section>
    </div></div>`;
}

function renderError(msg: string): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content"><div class="row"><div class="col-sm-12">
        <div class="alert alert-danger" style="margin:24px">${escapeHtml(msg)}</div>
        <a href="#/games/plans" class="btn btn-default" style="margin-left:24px">← Tilbake til planer</a>
      </div></div></section>
    </div></div>`;
}

function renderEditor(container: HTMLElement, state: PlanEditorState): void {
  const isEdit = state.planId !== null;
  const heading = isEdit ? "Rediger plan" : "Opprett plan";

  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(heading)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/games/plans">Spilleplaner</a></li>
          <li class="active">${escapeHtml(heading)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(heading)}</h6></div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in"><div class="panel-body">
              <form id="plan-meta-form" class="form-horizontal">
                ${renderMetaSection(state)}
                <div style="padding:16px;border-top:1px solid #eee;margin-top:16px;text-align:right">
                  <button type="submit" class="btn btn-success btn-flat" data-action="save-meta">
                    Lagre planinformasjon
                  </button>
                  <a href="#/games/plans" class="btn btn-default btn-flat">Avbryt</a>
                </div>
              </form>
            </div></div>
          </div>

          ${
            isEdit
              ? renderSequenceBuilderShell()
              : `<div class="alert alert-info" style="margin:24px">
                   <i class="fa fa-info-circle"></i>
                   Lagre planinformasjonen først; deretter får du sekvens-bygger for å legge til spill.
                 </div>`
          }
        </div></div>
      </section>
    </div></div>`;

  wireMetaForm(container, state);
  if (isEdit) {
    wireSequenceBuilder(container, state);
  }
}

function renderMetaSection(state: PlanEditorState): string {
  const m = state.meta;

  const hallsOpts = state.halls
    .map(
      (h) =>
        `<option value="${escapeHtml(h.id)}"${m.hallId === h.id ? " selected" : ""}>${escapeHtml(h.name)}</option>`,
    )
    .join("");
  const groupsOpts = state.groups
    .map(
      (g) =>
        `<option value="${escapeHtml(g.id)}"${m.groupOfHallsId === g.id ? " selected" : ""}>${escapeHtml(g.name)}</option>`,
    )
    .join("");

  const dayCb = (d: Weekday): string => {
    const checked = m.weekdays.includes(d);
    return `
      <label class="checkbox-inline" style="margin-right:12px">
        <input type="checkbox" name="weekday" value="${d}"${checked ? " checked" : ""}>
        ${escapeHtml(WEEKDAY_LABELS[d])}
      </label>`;
  };

  return `
    <div class="form-group">
      <label class="col-sm-3 control-label" for="plan-name">Navn <span class="text-danger">*</span></label>
      <div class="col-sm-9">
        <input type="text" class="form-control" id="plan-name" name="name" maxlength="200"
          value="${escapeHtml(m.name)}"
          placeholder="Eks. «Hverdagsplan» eller «Fredag/Lørdag fest»" required>
      </div>
    </div>
    <div class="form-group">
      <label class="col-sm-3 control-label" for="plan-description">Beskrivelse</label>
      <div class="col-sm-9">
        <textarea class="form-control" id="plan-description" rows="2" maxlength="2000"
          placeholder="Frittekst (valgfritt)">${escapeHtml(m.description ?? "")}</textarea>
      </div>
    </div>
    <div class="form-group">
      <label class="col-sm-3 control-label">Tilordning</label>
      <div class="col-sm-9">
        <label class="radio-inline">
          <input type="radio" name="binding" value="hall"${m.bindingKind === "hall" ? " checked" : ""}> Hall
        </label>
        <label class="radio-inline">
          <input type="radio" name="binding" value="group"${m.bindingKind === "group" ? " checked" : ""}> Group of halls
        </label>
      </div>
    </div>
    <div class="form-group binding-row" data-binding="hall" style="${m.bindingKind === "hall" ? "" : "display:none"}">
      <label class="col-sm-3 control-label" for="plan-hallId">Velg hall</label>
      <div class="col-sm-9">
        <select class="form-control" id="plan-hallId">
          <option value="">— Velg —</option>
          ${hallsOpts}
        </select>
      </div>
    </div>
    <div class="form-group binding-row" data-binding="group" style="${m.bindingKind === "group" ? "" : "display:none"}">
      <label class="col-sm-3 control-label" for="plan-groupId">Velg gruppe</label>
      <div class="col-sm-9">
        <select class="form-control" id="plan-groupId">
          <option value="">— Velg —</option>
          ${groupsOpts}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="col-sm-3 control-label">Dager</label>
      <div class="col-sm-9">
        ${WEEKDAY_VALUES.map(dayCb).join("")}
      </div>
    </div>
    <div class="form-group">
      <label class="col-sm-3 control-label">Åpningstid</label>
      <div class="col-sm-9">
        <div style="display:inline-block;margin-right:12px">
          <label style="font-weight:normal;font-size:12px">Start</label>
          <input type="time" class="form-control" id="plan-startTime" value="${escapeHtml(m.startTime)}"
            style="display:inline-block;width:auto" required>
        </div>
        <div style="display:inline-block">
          <label style="font-weight:normal;font-size:12px">Slutt</label>
          <input type="time" class="form-control" id="plan-endTime" value="${escapeHtml(m.endTime)}"
            style="display:inline-block;width:auto" required>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="col-sm-3 control-label">Aktiv</label>
      <div class="col-sm-9">
        <label class="switch">
          <input type="checkbox" id="plan-isActive"${m.isActive ? " checked" : ""}>
          <span class="slider round"></span>
        </label>
      </div>
    </div>`;
}

function renderSequenceBuilderShell(): string {
  return `
    <div class="panel panel-default card-view">
      <div class="panel-heading">
        <div class="pull-left"><h6 class="panel-title txt-dark">Sekvens — drag for å endre rekkefølge</h6></div>
        <div class="pull-right">
          <span id="seq-dirty-marker" class="label label-warning" style="display:none;margin-right:8px">
            Ulagret rekkefølge
          </span>
          <button type="button" class="btn btn-success btn-md" data-action="save-sequence">
            <i class="fa fa-save" aria-hidden="true"></i> Lagre rekkefølge
          </button>
        </div>
        <div class="clearfix"></div>
      </div>
      <div class="panel-wrapper collapse in"><div class="panel-body">
        <div class="row">
          <div class="col-sm-5">
            <h4 style="margin-top:0">Tilgjengelige spill (katalog)</h4>
            <input type="text" class="form-control" id="catalog-search"
              placeholder="Søk i katalog..." style="margin-bottom:12px">
            <div id="catalog-list" style="max-height:480px;overflow-y:auto;border:1px solid #ddd;border-radius:4px"></div>
          </div>
          <div class="col-sm-7">
            <h4 style="margin-top:0">Plan-sekvens</h4>
            <p class="text-muted" style="font-size:12px">
              Dra elementer for å endre rekkefølge. Duplikater er tillatt.
              Husk å klikke «Lagre rekkefølge» når du er ferdig.
            </p>
            <div id="sequence-list" style="min-height:120px;border:1px solid #ddd;border-radius:4px;padding:8px"></div>
          </div>
        </div>
      </div></div>
    </div>`;
}

function wireMetaForm(container: HTMLElement, state: PlanEditorState): void {
  const form = container.querySelector<HTMLFormElement>("#plan-meta-form");
  if (!form) return;

  // Toggle hall/group rows
  form.querySelectorAll<HTMLInputElement>('input[name="binding"]').forEach((rb) => {
    rb.addEventListener("change", () => {
      const value = rb.value as "hall" | "group";
      form.querySelectorAll<HTMLElement>(".binding-row").forEach((row) => {
        row.style.display = row.dataset.binding === value ? "" : "none";
      });
    });
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitMetaForm(form, state);
  });
}

function readMetaForm(form: HTMLFormElement): PlanMetaPayload | null {
  const name = (form.querySelector<HTMLInputElement>("#plan-name")?.value ?? "").trim();
  const description = (
    form.querySelector<HTMLTextAreaElement>("#plan-description")?.value ?? ""
  ).trim();
  const bindingKind =
    (form.querySelector<HTMLInputElement>('input[name="binding"]:checked')?.value ??
      "hall") === "group"
      ? "group"
      : "hall";
  const hallId =
    form.querySelector<HTMLSelectElement>("#plan-hallId")?.value.trim() ?? "";
  const groupId =
    form.querySelector<HTMLSelectElement>("#plan-groupId")?.value.trim() ?? "";
  const startTime =
    form.querySelector<HTMLInputElement>("#plan-startTime")?.value ?? "";
  const endTime =
    form.querySelector<HTMLInputElement>("#plan-endTime")?.value ?? "";
  const isActive = form.querySelector<HTMLInputElement>("#plan-isActive")?.checked ?? true;
  const dayCbs = form.querySelectorAll<HTMLInputElement>(
    'input[name="weekday"]:checked',
  );
  const weekdays = Array.from(dayCbs).map((cb) => cb.value as Weekday);

  if (!name) {
    Toast.error("Navn er påkrevd.");
    return null;
  }
  if (bindingKind === "hall" && !hallId) {
    Toast.error("Velg en hall.");
    return null;
  }
  if (bindingKind === "group" && !groupId) {
    Toast.error("Velg en gruppe.");
    return null;
  }
  if (weekdays.length === 0) {
    Toast.error("Velg minst én dag.");
    return null;
  }
  if (!startTime || !endTime) {
    Toast.error("Sett start- og sluttidspunkt.");
    return null;
  }

  return {
    name,
    description: description.length > 0 ? description : null,
    bindingKind,
    hallId: bindingKind === "hall" ? hallId : null,
    groupOfHallsId: bindingKind === "group" ? groupId : null,
    weekdays,
    startTime,
    endTime,
    isActive,
  };
}

async function submitMetaForm(
  form: HTMLFormElement,
  state: PlanEditorState,
): Promise<void> {
  const payload = readMetaForm(form);
  if (!payload) return;
  state.meta = payload;
  const submitBtn = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (submitBtn) submitBtn.disabled = true;
  try {
    const result = await savePlanMeta(
      state.planId ? payloadToUpdateInput(payload) : payloadToCreateInput(payload),
      state.planId ?? undefined,
    );
    if (result.ok) {
      Toast.success(state.planId ? "Plan oppdatert." : "Plan opprettet.");
      // Etter create: redirect til edit-side så bruker kan bygge sekvensen.
      if (!state.planId) {
        window.location.hash = `#/games/plans/${encodeURIComponent(result.value.id)}`;
        return;
      }
    } else {
      Toast.error(result.message);
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ── Sekvens-builder ─────────────────────────────────────────────────────

function wireSequenceBuilder(
  container: HTMLElement,
  state: PlanEditorState,
): void {
  const catalogList = container.querySelector<HTMLElement>("#catalog-list");
  const sequenceList = container.querySelector<HTMLElement>("#sequence-list");
  const searchEl = container.querySelector<HTMLInputElement>("#catalog-search");
  const saveBtn = container.querySelector<HTMLButtonElement>(
    'button[data-action="save-sequence"]',
  );
  const dirtyMarker = container.querySelector<HTMLElement>("#seq-dirty-marker");
  if (!catalogList || !sequenceList || !saveBtn) return;

  const catalogById = new Map(state.catalog.map((c) => [c.id, c]));

  function updateDirtyMarker(): void {
    if (!dirtyMarker) return;
    const a = state.sequence;
    const b = state.originalSequence;
    let dirty = a.length !== b.length;
    if (!dirty) {
      for (let i = 0; i < a.length; i += 1) {
        const ai = a[i]!;
        const bi = b[i]!;
        if (
          ai.gameCatalogId !== bi.gameCatalogId ||
          // Tolkning A (2026-05-07): bonus-override-endring teller som dirty.
          (ai.bonusGameOverride ?? null) !== (bi.bonusGameOverride ?? null)
        ) {
          dirty = true;
          break;
        }
      }
    }
    dirtyMarker.style.display = dirty ? "" : "none";
  }

  function renderCatalogList(filter: string): void {
    if (!catalogList) return;
    const f = filter.trim().toLowerCase();
    const filtered = state.catalog.filter((c) => {
      if (!c.isActive) return false;
      if (!f) return true;
      return (
        c.displayName.toLowerCase().includes(f) ||
        c.slug.toLowerCase().includes(f)
      );
    });
    if (filtered.length === 0) {
      catalogList.innerHTML = `<div class="text-muted" style="padding:16px;text-align:center">Ingen treff.</div>`;
      return;
    }
    catalogList.innerHTML = filtered
      .map(
        (c) => `
          <div class="catalog-item" data-id="${escapeHtml(c.id)}"
            style="padding:8px 12px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between">
            <div>
              <strong>${escapeHtml(c.displayName)}</strong>
              <br>
              <small><code>${escapeHtml(c.slug)}</code></small>
            </div>
            <button type="button" class="btn btn-success btn-xs"
              data-action="add-to-sequence" data-id="${escapeHtml(c.id)}"
              title="Legg til i sekvens">
              <i class="fa fa-plus"></i> Legg til
            </button>
          </div>`,
      )
      .join("");
    catalogList.querySelectorAll<HTMLButtonElement>(
      'button[data-action="add-to-sequence"]',
    ).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (!id) return;
        // Tolkning A (2026-05-07): nye items har eksplisitt null-override
        // (fallback til catalog).
        state.sequence.push({
          gameCatalogId: id,
          bonusGameOverride: null,
          notes: null,
        });
        renderSequence();
        updateDirtyMarker();
      });
    });
  }

  function renderSequence(): void {
    if (!sequenceList) return;
    if (state.sequence.length === 0) {
      sequenceList.innerHTML = `
        <div class="text-muted" style="padding:24px;text-align:center;border:2px dashed #ccc;border-radius:4px">
          Plan-sekvensen er tom. Bruk «Legg til» eller dra fra venstre kolonne.
        </div>`;
      return;
    }
    sequenceList.innerHTML = state.sequence
      .map((it, idx) => {
        const entry = catalogById.get(it.gameCatalogId);
        const label = entry?.displayName ?? `(ukjent: ${it.gameCatalogId})`;
        const slug = entry?.slug ?? "";
        const bonusSelected = it.bonusGameOverride ?? "";
        // Tolkning A (2026-05-07): "Ingen bonus" + 4 bonus-slugs.
        const bonusOptions = [
          `<option value=""${bonusSelected === "" ? " selected" : ""}>Ingen bonus</option>`,
          ...BONUS_GAME_SLUG_VALUES.map(
            (s) =>
              `<option value="${escapeHtml(s)}"${
                bonusSelected === s ? " selected" : ""
              }>${escapeHtml(BONUS_GAME_DISPLAY_NAMES[s])}</option>`,
          ),
        ].join("");
        return `
          <div class="seq-item" draggable="true" data-index="${idx}"
            style="padding:8px 12px;margin-bottom:4px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:move;display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div style="display:flex;align-items:center;flex:1;min-width:0">
              <i class="fa fa-bars" style="margin-right:12px;color:#888;flex-shrink:0" title="Dra"></i>
              <span style="display:inline-block;min-width:24px;color:#888;font-weight:bold">${idx + 1}.</span>
              <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(label)}</strong>
              <small style="margin-left:8px;color:#888;flex-shrink:0"><code>${escapeHtml(slug)}</code></small>
            </div>
            <select class="form-control input-sm seq-bonus-select"
              data-index="${idx}"
              title="Bonus-spill for denne posisjonen"
              style="width:auto;min-width:140px;flex-shrink:0">
              ${bonusOptions}
            </select>
            <button type="button" class="btn btn-danger btn-xs"
              data-action="remove-from-sequence" data-index="${idx}"
              title="Fjern" style="flex-shrink:0">
              <i class="fa fa-times"></i>
            </button>
          </div>`;
      })
      .join("");

    // Wire remove
    sequenceList
      .querySelectorAll<HTMLButtonElement>(
        'button[data-action="remove-from-sequence"]',
      )
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.index ?? -1);
          if (idx < 0 || idx >= state.sequence.length) return;
          state.sequence.splice(idx, 1);
          renderSequence();
          updateDirtyMarker();
        });
      });

    // Tolkning A (2026-05-07): wire bonus-dropdown change.
    sequenceList
      .querySelectorAll<HTMLSelectElement>(".seq-bonus-select")
      .forEach((sel) => {
        sel.addEventListener("change", () => {
          const idx = Number(sel.dataset.index ?? -1);
          if (idx < 0 || idx >= state.sequence.length) return;
          const value = sel.value;
          const item = state.sequence[idx];
          if (!item) return;
          if (value === "") {
            item.bonusGameOverride = null;
          } else {
            item.bonusGameOverride = value as BonusGameSlug;
          }
          updateDirtyMarker();
        });
      });

    // Wire drag-and-drop
    let dragIndex: number | null = null;
    sequenceList.querySelectorAll<HTMLElement>(".seq-item").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        dragIndex = Number(el.dataset.index ?? -1);
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          // Required for Firefox.
          e.dataTransfer.setData("text/plain", String(dragIndex));
        }
        el.style.opacity = "0.4";
      });
      el.addEventListener("dragend", () => {
        el.style.opacity = "1";
      });
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        el.style.borderTop = "3px solid #007bff";
      });
      el.addEventListener("dragleave", () => {
        el.style.borderTop = "1px solid #ccc";
      });
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.style.borderTop = "1px solid #ccc";
        const targetIdx = Number(el.dataset.index ?? -1);
        if (
          dragIndex === null ||
          dragIndex < 0 ||
          targetIdx < 0 ||
          dragIndex === targetIdx
        )
          return;
        const [moved] = state.sequence.splice(dragIndex, 1);
        if (moved) {
          state.sequence.splice(targetIdx, 0, moved);
        }
        dragIndex = null;
        renderSequence();
        updateDirtyMarker();
      });
    });
  }

  searchEl?.addEventListener("input", () => {
    renderCatalogList(searchEl.value);
  });
  saveBtn.addEventListener("click", () => {
    void saveSequence(state, saveBtn, dirtyMarker);
  });

  renderCatalogList("");
  renderSequence();
  updateDirtyMarker();
}

async function saveSequence(
  state: PlanEditorState,
  btn: HTMLButtonElement,
  dirtyMarker: HTMLElement | null,
): Promise<void> {
  if (!state.planId) return;
  btn.disabled = true;
  try {
    const result = await saveItems(state.planId, state.sequence);
    if (result.ok) {
      Toast.success("Rekkefølge lagret.");
      // Snap original til ny state for å fjerne dirty-markøren.
      state.originalSequence = state.sequence.slice();
      if (dirtyMarker) dirtyMarker.style.display = "none";
    } else {
      Toast.error(result.message);
    }
  } finally {
    btn.disabled = false;
  }
}

// Re-eksport for test-bruk.
export type { PlanEditorState, GamePlanWithItems };
