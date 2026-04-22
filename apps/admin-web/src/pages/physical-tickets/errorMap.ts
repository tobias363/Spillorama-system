// PR-PT6 — PT1-PT5 feilkode → brukervennlig i18n-melding.
//
// Backend-rutene (adminStaticTickets, adminAgentTicketRanges,
// adminPhysicalTicketPayouts) returnerer `{ ok: false, error: { code, message } }`
// med semantiske HTTP-statuser (400/403/404/409). API-klienten kaster ApiError
// med `code` satt. Denne mapperen oversetter kodene til norsk/engelsk via
// i18n-nøkler slik at UI-et viser forståelige meldinger framfor rå
// DomainError-tekst.

import { t } from "../../i18n/I18n.js";
import { ApiError } from "../../api/client.js";

const CODE_TO_KEY: Record<string, string> = {
  // PT1/PT2/PT3 — scan- og range-feil
  TICKET_WRONG_HALL: "pt_err_ticket_wrong_hall",
  TICKET_WRONG_COLOR: "pt_err_ticket_wrong_color",
  TICKET_ALREADY_SOLD: "pt_err_ticket_already_sold",
  TICKET_ALREADY_RESERVED: "pt_err_ticket_already_reserved",
  TICKET_NOT_FOUND: "pt_err_ticket_not_found",
  RANGE_NOT_FOUND: "pt_err_range_not_found",
  RANGE_ALREADY_CLOSED: "pt_err_range_already_closed",
  INSUFFICIENT_INVENTORY: "pt_err_insufficient_inventory",
  NO_TICKETS_SOLD: "pt_err_no_tickets_sold",
  NO_UPCOMING_GAME_FOR_HALL: "pt_err_no_upcoming_game",
  INVALID_NEW_TOP: "pt_err_invalid_new_top",
  SERIAL_NOT_IN_RANGE: "pt_err_serial_not_in_range",
  SCHEDULED_GAME_NOT_FOUND: "pt_err_scheduled_game_not_found",
  SCHEDULED_GAME_HALL_MISMATCH: "pt_err_scheduled_game_hall_mismatch",
  SCHEDULED_GAME_NOT_JOINABLE: "pt_err_scheduled_game_not_joinable",

  // PT5 — handover
  HANDOVER_SAME_USER: "pt_err_handover_same_user",
  TARGET_USER_NOT_FOUND: "pt_err_target_user_not_found",
  TARGET_USER_NOT_IN_HALL: "pt_err_target_user_not_in_hall",

  // PT4 — vinn-verifisering + utbetaling
  PENDING_PAYOUT_NOT_FOUND: "pt_err_pending_payout_not_found",
  TICKET_SCAN_MISMATCH: "pt_err_ticket_scan_mismatch",
  NOT_VERIFIED: "pt_err_not_verified",
  ADMIN_APPROVAL_REQUIRED: "pt_err_admin_approval_required",
  ADMIN_APPROVAL_NOT_REQUIRED: "pt_err_admin_approval_not_required",
  ALREADY_REJECTED: "pt_err_already_rejected",
  ALREADY_PAID_OUT: "pt_err_already_paid_out",

  // Generiske
  FORBIDDEN: "pt_err_forbidden",
  UNAUTHORIZED: "pt_err_forbidden",
  INVALID_INPUT: "pt_err_invalid_input",
};

/**
 * Returnerer en brukervennlig melding for en feil fra PT1-PT5 backend-rute.
 * Prioritet: kjent kode → i18n-nøkkel, ellers server-melding, ellers generisk.
 */
export function mapPhysicalTicketErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const key = CODE_TO_KEY[err.code];
    if (key) return t(key);
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return t("something_went_wrong");
}
