// PR-A5 (BIN-663) — /hall/add + /hall/edit/:id.
//
// Data:
//   POST /api/admin/halls                 create
//   PUT  /api/admin/halls/:id             update
//   listHalls() to resolve existing record on edit (no GET :id endpoint).
//
// Felter:
//   - Hall Name         (mandatory)
//   - Slug              (URL-safe string, auto-generert fra name hvis tomt)
//   - Hall Number       (heltall, mandatory — legacy legacy 101/102/...)
//   - Address
//   - Organization Number / Settlement Account / Invoice Method
//   - Status (Active/Inactive)

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  listHalls,
  createHall,
  updateHall,
  setHallVoice,
  HALL_TV_VOICES,
  type AdminHall,
  type HallClientVariant,
  type HallTvVoice,
} from "../../api/admin-halls.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";

const CLIENT_VARIANTS: readonly HallClientVariant[] = ["web"];

/**
 * Voice-labels vist i dropdown. Map til stabile engelske labels så vi
 * ikke er avhengig av at i18n-nøkler finnes før voice-pakkene får
 * egne navn i audio-direkotrien.
 */
const VOICE_LABELS: Record<HallTvVoice, string> = {
  voice1: "Voice 1",
  voice2: "Voice 2",
  voice3: "Voice 3",
};

export function renderHallFormPage(container: HTMLElement, editId: string | null): void {
  const isEdit = editId !== null;
  const titleKey = isEdit ? "edit_hall" : "add_hall";

  container.innerHTML = `
    ${contentHeader(titleKey, "hall_management")}
    <section class="content">
      ${boxOpen(titleKey, "primary")}
        <div id="hall-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#hall-form-host")!;
  void mount(host, editId);
}

async function mount(host: HTMLElement, editId: string | null): Promise<void> {
  let existing: AdminHall | null = null;
  if (editId) {
    try {
      const halls = await listHalls({ includeInactive: true });
      existing = halls.find((h) => h.id === editId) ?? null;
      if (!existing) {
        host.innerHTML = `<div class="callout callout-danger">${escapeHtml(t("something_went_wrong"))}</div>`;
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      host.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
      return;
    }
  }

  const hallNumberValue = existing?.hallNumber != null ? String(existing.hallNumber) : "";

  host.innerHTML = `
    <form id="hall-form" class="form-horizontal" data-testid="hall-form">
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-name">${escapeHtml(t("hall_name"))}</label>
        <div class="col-sm-9">
          <input type="text" id="hf-name" name="name" class="form-control" required
            value="${escapeHtml(existing?.name ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-slug">${escapeHtml(t("slug"))}</label>
        <div class="col-sm-9">
          <input type="text" id="hf-slug" name="slug" class="form-control" required
            value="${escapeHtml(existing?.slug ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-hall-number">${escapeHtml(t("hall_number"))}</label>
        <div class="col-sm-9">
          <input
            type="number"
            min="1"
            step="1"
            id="hf-hall-number"
            name="hallNumber"
            class="form-control"
            data-testid="hall-number-input"
            value="${escapeHtml(hallNumberValue)}"
          >
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-region">${escapeHtml(t("region"))}</label>
        <div class="col-sm-9">
          <input type="text" id="hf-region" name="region" class="form-control"
            value="${escapeHtml(existing?.region ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-address">${escapeHtml(t("address"))}</label>
        <div class="col-sm-9">
          <input type="text" id="hf-address" name="address" class="form-control"
            value="${escapeHtml(existing?.address ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-org">${escapeHtml(t("organization_number"))}</label>
        <div class="col-sm-9">
          <input type="text" id="hf-org" name="organizationNumber" class="form-control"
            value="${escapeHtml(existing?.organizationNumber ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-settle">${escapeHtml(t("settlement_account"))}</label>
        <div class="col-sm-9">
          <input type="text" id="hf-settle" name="settlementAccount" class="form-control"
            value="${escapeHtml(existing?.settlementAccount ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-invoice">${escapeHtml(t("invoice_method"))}</label>
        <div class="col-sm-9">
          <input type="text" id="hf-invoice" name="invoiceMethod" class="form-control"
            value="${escapeHtml(existing?.invoiceMethod ?? "")}">
        </div>
      </div>
      ${existing ? `
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-variant">${escapeHtml(t("type"))}</label>
        <div class="col-sm-9">
          <select id="hf-variant" name="clientVariant" class="form-control">
            ${CLIENT_VARIANTS.map(
              (v) =>
                `<option value="${escapeHtml(v)}"${existing!.clientVariant === v ? " selected" : ""}>${escapeHtml(v)}</option>`
            ).join("")}
          </select>
        </div>
      </div>
      <div class="form-group" data-testid="hall-tv-settings-section">
        <label class="col-sm-3 control-label" for="hf-tv-voice">TV Voice</label>
        <div class="col-sm-9">
          <select id="hf-tv-voice" name="tvVoiceSelection" class="form-control" data-testid="hall-tv-voice-select">
            ${HALL_TV_VOICES.map(
              (v) =>
                `<option value="${escapeHtml(v)}"${(existing!.tvVoiceSelection ?? "voice1") === v ? " selected" : ""}>${escapeHtml(VOICE_LABELS[v])}</option>`
            ).join("")}
          </select>
          <p class="help-block">Stemme som TV-kiosk bruker ved ball-utrop. Endring slås inn umiddelbart på aktive TV-skjermer.</p>
        </div>
      </div>` : ""}
      <div class="form-group">
        <label class="col-sm-3 control-label" for="hf-active">${escapeHtml(t("status"))}</label>
        <div class="col-sm-9">
          <select id="hf-active" name="isActive" class="form-control">
            <option value="true"${existing?.isActive !== false ? " selected" : ""}>${escapeHtml(t("active"))}</option>
            <option value="false"${existing?.isActive === false ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-offset-3 col-sm-9">
          <button type="submit" class="btn btn-success" data-action="save-hall">
            <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("submit"))}
          </button>
          <a class="btn btn-default" href="#/hall">${escapeHtml(t("cancel"))}</a>
        </div>
      </div>
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#hall-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, existing);
  });
}

async function submit(form: HTMLFormElement, existing: AdminHall | null): Promise<void> {
  const name = (form.querySelector<HTMLInputElement>("#hf-name")!).value.trim();
  const slug = (form.querySelector<HTMLInputElement>("#hf-slug")!).value.trim();
  const hallNumberRaw = (form.querySelector<HTMLInputElement>("#hf-hall-number")!).value.trim();
  const region = (form.querySelector<HTMLInputElement>("#hf-region")!).value.trim();
  const address = (form.querySelector<HTMLInputElement>("#hf-address")!).value.trim();
  const organizationNumber = (form.querySelector<HTMLInputElement>("#hf-org")!).value.trim();
  const settlementAccount = (form.querySelector<HTMLInputElement>("#hf-settle")!).value.trim();
  const invoiceMethod = (form.querySelector<HTMLInputElement>("#hf-invoice")!).value.trim();
  const variantEl = form.querySelector<HTMLSelectElement>("#hf-variant");
  const clientVariant = variantEl ? (variantEl.value as HallClientVariant) : undefined;
  const voiceEl = form.querySelector<HTMLSelectElement>("#hf-tv-voice");
  const tvVoice = voiceEl ? (voiceEl.value as HallTvVoice) : undefined;
  const isActive = (form.querySelector<HTMLSelectElement>("#hf-active")!).value === "true";

  if (!name || !slug) {
    Toast.error(t("all_fields_are_required"));
    return;
  }

  let hallNumber: number | null | undefined;
  if (hallNumberRaw === "") {
    hallNumber = null;
  } else {
    const parsed = Number(hallNumberRaw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      Toast.error(t("hall_number_positive_integer"));
      return;
    }
    hallNumber = parsed;
  }

  try {
    if (existing) {
      const patch: Record<string, unknown> = {
        name, slug, region, address,
        organizationNumber, settlementAccount, invoiceMethod, isActive,
        hallNumber,
      };
      if (clientVariant) patch.clientVariant = clientVariant;
      await updateHall(existing.id, patch);
      // Voice-pack er på et eget endpoint (egen RBAC + broadcast) og
      // oppdateres bare når valget faktisk har endret seg. Feiler voice-
      // patchen, viser vi fortsatt toast for hoved-patch-suksess så
      // operatøren ikke taper feltverdiene.
      if (tvVoice && tvVoice !== (existing.tvVoiceSelection ?? "voice1")) {
        try {
          await setHallVoice(existing.id, tvVoice);
        } catch (voiceErr) {
          Toast.error(
            voiceErr instanceof ApiError
              ? `TV Voice: ${voiceErr.message}`
              : "TV Voice: oppdatering feilet"
          );
          return;
        }
      }
    } else {
      await createHall({
        slug, name, region, address,
        organizationNumber: organizationNumber || undefined,
        settlementAccount: settlementAccount || undefined,
        invoiceMethod: invoiceMethod || undefined,
        isActive,
        hallNumber,
      });
    }
    Toast.success(t("success"));
    window.location.hash = "#/hall";
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  }
}
