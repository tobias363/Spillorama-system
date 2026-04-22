-- PT4: Pending-payouts for fysiske bonger etter pattern-match.
--
-- Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
--       (§ "Fase 6: Vinn-varsel + verifisering + utbetaling", linje 127-156)
--
-- Bakgrunn:
--   Digital bong → auto-payout fra wallet-pott ved phase-match i
--   Game1DrawEngineService.evaluateAndPayoutPhase(). Fysisk bong kan IKKE
--   auto-payout — spilleren må fysisk fremvise bongen for bingoverten, som
--   scanner den før kontant-utbetaling. Denne tabellen holder "pending"-
--   rader fra detect-øyeblikket (draw-engine) til verifisering og faktisk
--   utbetaling (bingovert) er gjennomført.
--
-- Design:
--   * En rad per (ticket_id, pattern_phase) — UNIQUE constraint forhindrer
--     duplikat-detection hvis drawNext kjøres idempotent.
--   * NULLABLE verifisering/utbetaling-felter: rad starter i "detected"-state
--     (kun detected_at satt), går via "verified" (scan + fire-øyne-flag) til
--     enten "paid_out" eller "rejected".
--   * `admin_approval_required` flagges ved verifisering hvis
--     expected_payout_cents >= 500000 (5000 kr). Admin må så kalle egen
--     admin-approve-endepunkt før confirm-payout er lovlig.
--   * Partial-indekser for hot queries:
--       - "hvilke pending-payouts for dette spillet?" (admin-skjerm ved
--         aktivt spill)
--       - "hvilke pending-payouts har denne bingoverten ansvar for?"
--         (bingovert-vakt)
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_physical_ticket_pending_payouts (
  id                         TEXT PRIMARY KEY,
  -- ticket_id speiler app_static_tickets.ticket_serial. FK droppes fordi
  -- ticket_serial alene ikke er unik (samme serial kan finnes i flere haller
  -- + farger). Unikhet sikres via (hall_id, ticket_id, pattern_phase) i
  -- kombinasjon med constraint under.
  ticket_id                  TEXT NOT NULL,
  hall_id                    TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  scheduled_game_id          TEXT NOT NULL REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  pattern_phase              TEXT NOT NULL,
  expected_payout_cents      BIGINT NOT NULL,
  responsible_user_id        TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  color                      TEXT NOT NULL,
  detected_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at                TIMESTAMPTZ NULL,
  verified_by_user_id        TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  paid_out_at                TIMESTAMPTZ NULL,
  paid_out_by_user_id        TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  admin_approval_required    BOOLEAN NOT NULL DEFAULT false,
  admin_approved_at          TIMESTAMPTZ NULL,
  admin_approved_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  rejected_at                TIMESTAMPTZ NULL,
  rejected_by_user_id        TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  rejected_reason            TEXT NULL,
  -- Én pending-row per (hall, ticket_serial, phase). Forhindrer duplikat-
  -- detection hvis draw-engine skulle krasje og kjøre phase-evaluering om
  -- igjen for samme bong. (hall_id inkludert fordi samme ticket_serial kan
  -- finnes i flere haller.)
  CONSTRAINT pt4_unique_hall_ticket_phase UNIQUE (hall_id, ticket_id, pattern_phase)
);

COMMENT ON TABLE  app_physical_ticket_pending_payouts IS 'PT4: Fysisk-bong pending-utbetalinger etter pattern-match. En rad per (ticket_id, pattern_phase). Går via detected → verified → (admin_approved) → paid_out / rejected.';

COMMENT ON COLUMN app_physical_ticket_pending_payouts.ticket_id               IS 'PT4: ticket_serial fra app_static_tickets (bong-ID som treffet pattern).';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.hall_id                 IS 'PT4: hall bongen tilhører (replika fra static_tickets for rask query).';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.scheduled_game_id       IS 'PT4: planlagt Spill 1-økt bongen vant i.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.pattern_phase           IS 'PT4: pattern-key, f.eks. "row_1" | "row_2" | "row_3" | "row_4" | "full_house".';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.expected_payout_cents   IS 'PT4: forventet utbetaling i øre beregnet av draw-engine (pot-andel eller fixed). Kan avvike fra faktisk utbetaling ved split mellom flere vinnere — verifiseres igjen ved confirm-payout.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.responsible_user_id     IS 'PT4: bingovert ansvarlig for denne bongen (sold_by_user_id / handover_to). Mottaker av varsel-socket.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.color                   IS 'PT4: ticket_color-familie (small/large/traffic-light) — replika fra static_tickets for UI-rendering.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.detected_at             IS 'PT4: tidspunkt draw-engine detekterte match (audit-bevis).';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.verified_at             IS 'PT4: tidspunkt bingovert scannet bongen for verifikasjon.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.verified_by_user_id     IS 'PT4: bingovert som scannet og verifiserte (ofte == responsible_user_id).';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.paid_out_at             IS 'PT4: tidspunkt faktisk kontant-utbetaling ble bekreftet. Settes sammen med paid_out_by_user_id. Også speiler app_static_tickets.paid_out_at.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.paid_out_by_user_id     IS 'PT4: bingovert som bekreftet utbetaling.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.admin_approval_required IS 'PT4: true hvis expected_payout_cents >= 500000 (5000 kr). Krever fire-øyne før confirm-payout.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.admin_approved_at       IS 'PT4: tidspunkt ADMIN gav fire-øyne-approval. Må være satt før confirm-payout hvis admin_approval_required = true.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.admin_approved_by_user_id IS 'PT4: ADMIN som godkjente (må være annen enn verified_by og paid_out_by ideelt, men ikke tvang-validert på tabellen — håndheves i service hvis policy utvides).';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.rejected_at             IS 'PT4: tidspunkt rad ble avvist (f.eks. bong ikke fysisk frembrakt når bingovert gikk).';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.rejected_by_user_id     IS 'PT4: bingovert/ADMIN som avviste.';
COMMENT ON COLUMN app_physical_ticket_pending_payouts.rejected_reason         IS 'PT4: fri-tekst årsak for audit.';

-- Partial-indeks: "hvilke pending-payouts er fortsatt åpne for dette spillet?"
-- Brukt av admin-skjerm som lister aktive vinn ved aktivt spill.
CREATE INDEX IF NOT EXISTS idx_pt4_pending_payouts_game
  ON app_physical_ticket_pending_payouts (scheduled_game_id)
  WHERE paid_out_at IS NULL AND rejected_at IS NULL;

-- Partial-indeks: "hvilke pending-payouts har denne bingoverten ansvar for?"
-- Brukt av bingovert-vakt-skjerm.
CREATE INDEX IF NOT EXISTS idx_pt4_pending_payouts_user
  ON app_physical_ticket_pending_payouts (responsible_user_id)
  WHERE paid_out_at IS NULL AND rejected_at IS NULL;
