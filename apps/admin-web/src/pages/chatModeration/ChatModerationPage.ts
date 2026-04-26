// HIGH-11 — Chat Moderation UI.
//
// Path: /admin/chat-moderation
//
// Data: GET /api/admin/chat/messages (filter + offset-paginert).
// Action: POST /api/admin/chat/messages/:id/delete (soft-delete med reason).
// Filter: hallId + roomCode + dato-vindu + søk + includeDeleted-toggle.
//
// RBAC:
//  - CHAT_MODERATION_READ (ADMIN + HALL_OPERATOR + SUPPORT) for listing.
//  - CHAT_MODERATION_WRITE (ADMIN + HALL_OPERATOR) for sletting.
// HALL_OPERATOR ser kun egen hall — backend hall-scope-tvinger filteret.
//
// Pengespillforskriften §13 + AML krever moderator-evne; sletting går i
// audit-log som `admin.chat.delete` med originalmelding + reason for revisjon.

import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listChatMessages,
  deleteChatMessage,
  type ChatModerationMessage,
  type ListChatModerationParams,
} from "../../api/admin-chat-moderation.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../amountwithdraw/shared.js";

interface PageState {
  rows: ChatModerationMessage[];
  total: number;
  offset: number;
  limit: number;
  lastFilter: ListChatModerationParams;
}

const PAGE_SIZE = 50;

export function renderChatModerationPage(container: HTMLElement): void {
  const state: PageState = {
    rows: [],
    total: 0,
    offset: 0,
    limit: PAGE_SIZE,
    lastFilter: {},
  };

  container.innerHTML = `
    ${contentHeader("Chat-moderasjon", "Chat-moderasjon")}
    <section class="content">
      ${boxOpen("Chat-moderasjon", "danger")}
        <p class="text-muted">
          Søk i chat-meldinger og slett innlegg som bryter retningslinjer
          (mobbing, hvitvaskings-snakk, eksponering av mindreårige).
          Slettede meldinger maskeres for andre spillere som
          «[Slettet av moderator]». Alle slettinger logges i revisjons-loggen.
        </p>
        <form id="chat-mod-filter" class="row" style="margin-bottom:12px;" data-testid="chat-mod-filter-form">
          <div class="col-sm-2">
            <label for="chat-mod-hall">Hall-ID</label>
            <input type="text" id="chat-mod-hall" class="form-control" data-testid="chat-mod-hall" placeholder="hall-1">
          </div>
          <div class="col-sm-2">
            <label for="chat-mod-room">Rom-kode</label>
            <input type="text" id="chat-mod-room" class="form-control" data-testid="chat-mod-room" placeholder="ROOM-A">
          </div>
          <div class="col-sm-2">
            <label for="chat-mod-from">Fra dato</label>
            <input type="date" id="chat-mod-from" class="form-control">
          </div>
          <div class="col-sm-2">
            <label for="chat-mod-to">Til dato</label>
            <input type="date" id="chat-mod-to" class="form-control">
          </div>
          <div class="col-sm-2">
            <label for="chat-mod-search">Søk i tekst/navn</label>
            <input type="text" id="chat-mod-search" class="form-control" data-testid="chat-mod-search" placeholder="hvitvasking">
          </div>
          <div class="col-sm-2">
            <label style="display:block;">&nbsp;</label>
            <button type="submit" class="btn btn-info" data-testid="chat-mod-search-btn">
              <i class="fa fa-search"></i> Søk
            </button>
          </div>
        </form>
        <div style="margin-bottom:12px;">
          <label>
            <input type="checkbox" id="chat-mod-include-deleted" data-testid="chat-mod-include-deleted">
            Inkluder allerede slettede meldinger
          </label>
        </div>
        <div id="chat-mod-summary" style="margin-bottom:8px;" class="text-muted"></div>
        <div id="chat-mod-table" data-testid="chat-mod-table">Laster …</div>
        <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
          <button type="button" class="btn btn-default" data-action="prev" data-testid="chat-mod-prev" disabled>
            <i class="fa fa-arrow-left"></i> Forrige
          </button>
          <button type="button" class="btn btn-default" data-action="next" data-testid="chat-mod-next" disabled>
            Neste <i class="fa fa-arrow-right"></i>
          </button>
          <span id="chat-mod-page-indicator" class="text-muted"></span>
        </div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#chat-mod-table")!;
  const summaryEl = container.querySelector<HTMLElement>("#chat-mod-summary")!;
  const form = container.querySelector<HTMLFormElement>("#chat-mod-filter")!;
  const includeDeletedCb = container.querySelector<HTMLInputElement>(
    "#chat-mod-include-deleted"
  )!;
  const prevBtn = container.querySelector<HTMLButtonElement>(
    "[data-action='prev']"
  )!;
  const nextBtn = container.querySelector<HTMLButtonElement>(
    "[data-action='next']"
  )!;
  const pageIndicator = container.querySelector<HTMLElement>(
    "#chat-mod-page-indicator"
  )!;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    state.offset = 0;
    void refresh();
  });
  includeDeletedCb.addEventListener("change", () => {
    state.offset = 0;
    void refresh();
  });
  prevBtn.addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - state.limit);
    void refresh({ keepFilter: true });
  });
  nextBtn.addEventListener("click", () => {
    state.offset = state.offset + state.limit;
    void refresh({ keepFilter: true });
  });

  function readFilterFromForm(): ListChatModerationParams {
    const hallId =
      container
        .querySelector<HTMLInputElement>("#chat-mod-hall")
        ?.value.trim() || undefined;
    const roomCode =
      container
        .querySelector<HTMLInputElement>("#chat-mod-room")
        ?.value.trim() || undefined;
    const from =
      container.querySelector<HTMLInputElement>("#chat-mod-from")?.value ||
      undefined;
    const to =
      container.querySelector<HTMLInputElement>("#chat-mod-to")?.value ||
      undefined;
    const search =
      container
        .querySelector<HTMLInputElement>("#chat-mod-search")
        ?.value.trim() || undefined;
    const includeDeleted = includeDeletedCb.checked;
    const filter: ListChatModerationParams = {
      limit: PAGE_SIZE,
      includeDeleted,
    };
    if (hallId) filter.hallId = hallId;
    if (roomCode) filter.roomCode = roomCode;
    if (from) filter.fromDate = `${from}T00:00:00.000Z`;
    if (to) filter.toDate = `${to}T23:59:59.999Z`;
    if (search) filter.search = search;
    return filter;
  }

  async function refresh(options: { keepFilter?: boolean } = {}): Promise<void> {
    tableHost.textContent = "Laster …";
    try {
      const baseFilter = options.keepFilter
        ? state.lastFilter
        : readFilterFromForm();
      const params: ListChatModerationParams = {
        ...baseFilter,
        offset: state.offset,
      };
      const res = await listChatMessages(params);
      state.rows = res.messages;
      state.total = res.total;
      state.limit = res.limit;
      state.offset = res.offset;
      state.lastFilter = baseFilter;

      summaryEl.textContent = `Fant ${res.total} melding${res.total === 1 ? "" : "er"}.`;
      mountTable();
      updatePagination();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Noe gikk galt.";
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
      summaryEl.textContent = "";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      pageIndicator.textContent = "";
    }
  }

  function updatePagination(): void {
    prevBtn.disabled = state.offset <= 0;
    nextBtn.disabled = state.offset + state.limit >= state.total;
    if (state.total === 0) {
      pageIndicator.textContent = "";
      return;
    }
    const startNum = state.offset + 1;
    const endNum = Math.min(state.offset + state.rows.length, state.total);
    pageIndicator.textContent = `Viser ${startNum}–${endNum} av ${state.total}`;
  }

  function mountTable(): void {
    DataTable.mount<ChatModerationMessage>(tableHost, {
      columns: [
        {
          key: "createdAt",
          title: "Tid",
          render: (r) =>
            new Date(r.createdAt).toISOString().slice(0, 19).replace("T", " "),
        },
        {
          key: "hallId",
          title: "Hall",
          render: (r) => escapeHtml(r.hallId),
        },
        {
          key: "roomCode",
          title: "Rom",
          render: (r) => `<code>${escapeHtml(r.roomCode)}</code>`,
        },
        {
          key: "playerName",
          title: "Spiller",
          render: (r) =>
            `${escapeHtml(r.playerName)} <span class="text-muted">(${escapeHtml(r.playerId)})</span>`,
        },
        {
          key: "message",
          title: "Melding",
          render: (r) => {
            const text = escapeHtml(r.message);
            if (r.deletedAt) {
              const reason = r.deleteReason
                ? ` — <em>${escapeHtml(r.deleteReason)}</em>`
                : "";
              return `<span class="text-muted"><s>${text}</s></span><br><small class="text-danger">Slettet ${escapeHtml(r.deletedAt)}${reason}</small>`;
            }
            return text;
          },
        },
        {
          key: "id",
          title: "Handling",
          render: (r) => {
            if (r.deletedAt) {
              return `<span class="text-muted">Slettet</span>`;
            }
            return `<button type="button" class="btn btn-sm btn-danger" data-action="delete" data-id="${escapeHtml(r.id)}" data-testid="chat-mod-delete-${escapeHtml(r.id)}">
              <i class="fa fa-trash"></i> Slett
            </button>`;
          },
        },
      ],
      rows: state.rows,
      emptyMessage: "Ingen meldinger samsvarer med filteret.",
    });

    // Wire delete-buttons. DataTable.mount er HTML-basert så vi binder etter mount.
    const buttons = tableHost.querySelectorAll<HTMLButtonElement>(
      "button[data-action='delete']"
    );
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (!id) return;
        void onDeleteClick(id);
      });
    });
  }

  async function onDeleteClick(id: string): Promise<void> {
    const target = state.rows.find((r) => r.id === id);
    if (!target) return;
    // Påkrevd reason — minst 5 tegn, maks 500.
    const reason = window.prompt(
      `Slett melding fra ${target.playerName}?\n\nMelding: «${target.message}»\n\nOppgi årsak (minst 5 tegn — synlig i revisjons-logg):`,
      ""
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      Toast.error("Årsak må være minst 5 tegn.");
      return;
    }
    if (trimmed.length > 500) {
      Toast.error("Årsak er for lang (maks 500 tegn).");
      return;
    }
    try {
      const result = await deleteChatMessage(id, trimmed);
      if (result.wasAlreadyDeleted) {
        Toast.info("Meldingen var allerede slettet av en annen moderator.");
      } else {
        Toast.success("Meldingen er slettet og logget i revisjons-loggen.");
      }
      void refresh({ keepFilter: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Noe gikk galt.";
      Toast.error(msg);
    }
  }

  void refresh();
}
