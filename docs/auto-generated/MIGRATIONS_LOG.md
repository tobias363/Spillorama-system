# Migration-historikk

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> `.github/workflows/auto-generate-docs.yml` på hver push til main.
>
> Generator: `scripts/generate-architecture-docs.sh`
> Sist oppdatert: 2026-05-15T21:45:38Z
> Commit: `b38be59c` (branch: `main`)

Kronologisk liste over alle Postgres-migrations under
`apps/backend/migrations/`. Filene navngis med ISO-prefiks
`YYYYMMDDHHMMSS_<navn>.sql` og kjøres i sortert rekkefølge ved deploy
(se `render.yaml` → `npm run migrate`).

> **Oppdager du en migrasjon som ikke er i prod?** Sjekk
> `app_migrations`-tabellen i prod-DB. Render kjører `npm run migrate`
> som del av `buildCommand` — feiler en migrasjon, faller deploy.

Antall migrasjoner: **157**

| Filnavn | Bytes | Beskrivelse (slug fra filnavn) |
|---|---:|---|
| `20260413000001_initial_schema.sql` | 19221 | initial schema |
| `20260413000002_max_tickets_30_all_games.sql` | 822 | max tickets 30 all games |
| `20260415000001_game_variant_config.sql` | 3882 | game variant config |
| `20260416000001_multi_hall_linked_draws.sql` | 8470 | multi hall linked draws |
| `20260417000001_ticket_draw_session_binding.sql` | 1638 | ticket draw session binding |
| `20260417000002_static_tickets.sql` | 3087 | static tickets |
| `20260417000003_agent_ticket_ranges.sql` | 4144 | agent ticket ranges |
| `20260417000004_idempotency_records.sql` | 1672 | idempotency records |
| `20260417000005_regulatory_ledger.sql` | 6728 | regulatory ledger |
| `20260417000006_daily_regulatory_reports.sql` | 4584 | daily regulatory reports |
| `20260417000007_user_hall_binding.sql` | 1605 | user hall binding |
| `20260417000008_draw_session_tickets.sql` | 3093 | draw session tickets |
| `20260417120000_deactivate_game4_temabingo.sql` | 773 | deactivate game4 temabingo |
| `20260418090000_add_hall_client_variant.sql` | 975 | add hall client variant |
| `20260418130000_chat_messages.sql` | 1113 | chat messages |
| `20260418140000_halls_tv_url.sql` | 400 | halls tv url |
| `20260418150000_hall_display_tokens.sql` | 1874 | hall display tokens |
| `20260418160000_app_audit_log.sql` | 2104 | app audit log |
| `20260418160000_deposit_withdraw_queue.sql` | 3279 | deposit withdraw queue |
| `20260418170000_user_hall_scope.sql` | 897 | user hall scope |
| `20260418180000_auth_tokens.sql` | 2083 | auth tokens |
| `20260418190000_player_lifecycle.sql` | 1748 | player lifecycle |
| `20260418200000_aml_red_flags.sql` | 2717 | aml red flags |
| `20260418210000_security_admin.sql` | 2479 | security admin |
| `20260418220000_agent_role_and_profile.sql` | 2749 | agent role and profile |
| `20260418220100_agent_halls.sql` | 1775 | agent halls |
| `20260418220200_agent_shifts.sql` | 3789 | agent shifts |
| `20260418220300_audit_log_agent_actor_type.sql` | 975 | audit log agent actor type |
| `20260418230000_physical_tickets.sql` | 3632 | physical tickets |
| `20260418240000_agent_transactions.sql` | 4222 | agent transactions |
| `20260418240000_vouchers.sql` | 2019 | vouchers |
| `20260418250000_agent_settlements.sql` | 3700 | agent settlements |
| `20260418250100_shift_settled_at.sql` | 1103 | shift settled at |
| `20260418250200_hall_cash_balance.sql` | 921 | hall cash balance |
| `20260418250300_hall_cash_transactions.sql` | 2305 | hall cash transactions |
| `20260419000000_game_management.sql` | 3759 | game management |
| `20260420000000_products.sql` | 5318 | products |
| `20260420000050_agent_tx_product_sale.sql` | 538 | agent tx product sale |
| `20260420000100_physical_ticket_transfers.sql` | 1352 | physical ticket transfers |
| `20260420100000_machine_tickets.sql` | 2848 | machine tickets |
| `20260420100100_agent_tx_machine_actions.sql` | 910 | agent tx machine actions |
| `20260421000000_hall_manual_adjustments.sql` | 1262 | hall manual adjustments |
| `20260421000100_set_bingo_client_engine_web.sql` | 1542 | set bingo client engine web |
| `20260421120000_sub_game_parent_link.sql` | 1644 | sub game parent link |
| `20260421130000_purge_legacy_bingo1_no_gameslug.sql` | 936 | purge legacy bingo1 no gameslug |
| `20260421140000_payment_request_destination_type.sql` | 1472 | payment request destination type |
| `20260422000000_daily_schedules.sql` | 6571 | daily schedules |
| `20260423000000_patterns.sql` | 6254 | patterns |
| `20260423000100_halls_tv_token.sql` | 1876 | halls tv token |
| `20260424000000_add_game_slug_to_game_sessions.sql` | 1435 | add game slug to game sessions |
| `20260424000000_hall_groups.sql` | 7524 | hall groups |
| `20260424153706_agent_shift_logout_flags.sql` | 3852 | agent shift logout flags |
| `20260425000000_close_day_log.sql` | 3392 | close day log |
| `20260425000000_game_types.sql` | 4688 | game types |
| `20260425000000_wallet_reservations_numeric.sql` | 5084 | wallet reservations numeric |
| `20260425000100_sub_games.sql` | 6176 | sub games |
| `20260425000200_saved_games.sql` | 5936 | saved games |
| `20260425000300_schedules.sql` | 5779 | schedules |
| `20260425000400_leaderboard_tiers.sql` | 5144 | leaderboard tiers |
| `20260425000500_system_settings_maintenance.sql` | 6377 | system settings maintenance |
| `20260425000600_mini_games_config.sql` | 3821 | mini games config |
| `20260425125008_screen_saver_settings.sql` | 3619 | screen saver settings |
| `20260426000200_cms.sql` | 4027 | cms |
| `20260426120000_chat_moderation.sql` | 1758 | chat moderation |
| `20260427000000_physical_ticket_cashouts.sql` | 2356 | physical ticket cashouts |
| `20260427000000_wallet_outbox.sql` | 3612 | wallet outbox |
| `20260427000100_physical_ticket_win_data.sql` | 4206 | physical ticket win data |
| `20260428000000_game1_scheduled_games.sql` | 7571 | game1 scheduled games |
| `20260428000100_game1_hall_ready_status.sql` | 4339 | game1 hall ready status |
| `20260428000200_game1_master_audit.sql` | 4654 | game1 master audit |
| `20260428080000_compliance_ledger_idempotency.sql` | 1759 | compliance ledger idempotency |
| `20260429000000_loyalty.sql` | 8472 | loyalty |
| `20260429000100_drop_hall_client_variant.sql` | 911 | drop hall client variant |
| `20260429074303_compliance_outbox.sql` | 4544 | compliance outbox |
| `20260430000000_app_game1_ticket_purchases.sql` | 6771 | app game1 ticket purchases |
| `20260430000100_physical_tickets_scheduled_game_fk.sql` | 2167 | physical tickets scheduled game fk |
| `20260501000000_app_game1_ticket_assignments.sql` | 4896 | app game1 ticket assignments |
| `20260501000100_app_game1_draws.sql` | 2766 | app game1 draws |
| `20260501000200_app_game1_game_state.sql` | 3488 | app game1 game state |
| `20260501000300_app_game1_phase_winners.sql` | 4708 | app game1 phase winners |
| `20260503000000_game1_hall_scan_data.sql` | 2186 | game1 hall scan data |
| `20260601000000_app_game1_scheduled_games_room_code.sql` | 1137 | app game1 scheduled games room code |
| `20260605000000_app_game1_scheduled_games_game_config.sql` | 1661 | app game1 scheduled games game config |
| `20260606000000_app_game1_mini_game_results.sql` | 6111 | app game1 mini game results |
| `20260606000000_static_tickets_pt1_extensions.sql` | 4335 | static tickets pt1 extensions |
| `20260606000000_wallet_split_deposit_winnings.sql` | 5137 | wallet split deposit winnings |
| `20260607000000_agent_ticket_ranges_pt2_extensions.sql` | 2772 | agent ticket ranges pt2 extensions |
| `20260608000000_physical_ticket_pending_payouts.sql` | 7281 | physical ticket pending payouts |
| `20260609000000_game1_oddsen_state.sql` | 7714 | game1 oddsen state |
| `20260610000000_agent_ticket_ranges_pt5_extensions.sql` | 2074 | agent ticket ranges pt5 extensions |
| `20260611000000_game1_accumulating_pots.sql` | 8458 | game1 accumulating pots |
| `20260700000000_cms_content_versions.sql` | 5480 | cms content versions |
| `20260701000000_hall_number.sql` | 1857 | hall number |
| `20260705000000_agent_permissions.sql` | 3778 | agent permissions |
| `20260706000000_app_notifications_and_devices.sql` | 5992 | app notifications and devices |
| `20260723000000_voucher_redemptions.sql` | 2820 | voucher redemptions |
| `20260724000000_game1_mini_game_mystery.sql` | 1434 | game1 mini game mystery |
| `20260724001000_app_unique_ids.sql` | 5272 | app unique ids |
| `20260724100000_wallet_reservations.sql` | 3184 | wallet reservations |
| `20260725000000_settlement_machine_breakdown.sql` | 3106 | settlement machine breakdown |
| `20260726000000_game1_auto_pause_on_phase.sql` | 1933 | game1 auto pause on phase |
| `20260726000000_settlement_breakdown_k1b_fields.sql` | 2554 | settlement breakdown k1b fields |
| `20260726100000_ticket_ranges_per_game.sql` | 5306 | ticket ranges per game |
| `20260727000000_game1_master_transfer_requests.sql` | 4196 | game1 master transfer requests |
| `20260727000001_game1_master_audit_add_transfer_actions.sql` | 1315 | game1 master audit add transfer actions |
| `20260810000000_withdraw_requests_bank_export.sql` | 3364 | withdraw requests bank export |
| `20260810000100_xml_export_batches.sql` | 2544 | xml export batches |
| `20260811000000_halls_tv_voice_selection.sql` | 1084 | halls tv voice selection |
| `20260820000000_user_profile_settings.sql` | 2842 | user profile settings |
| `20260821000000_game1_jackpot_state.sql` | 3123 | game1 jackpot state |
| `20260825000000_close_day_log_3case.sql` | 1590 | close day log 3case |
| `20260825000000_player_profile_images.sql` | 2092 | player profile images |
| `20260826000000_wallet_reconciliation_alerts.sql` | 2759 | wallet reconciliation alerts |
| `20260901000000_close_day_recurring_patterns.sql` | 3939 | close day recurring patterns |
| `20260901000000_game1_jackpot_awards.sql` | 3467 | game1 jackpot awards |
| `20260902000000_app_user_pins.sql` | 2234 | app user pins |
| `20260902000000_payment_methods.sql` | 3215 | payment methods |
| `20260902000000_swedbank_intent_last_reminded_at.sql` | 1322 | swedbank intent last reminded at |
| `20260902000000_wallet_entries_hash_chain.sql` | 1869 | wallet entries hash chain |
| `20260910000000_user_2fa_and_session_metadata.sql` | 4806 | user 2fa and session metadata |
| `20260926000000_wallet_currency_readiness.sql` | 3671 | wallet currency readiness |
| `20260928000000_password_changed_at.sql` | 1428 | password changed at |
| `20261001000000_ticket_ranges_11_color_palette.sql` | 2971 | ticket ranges 11 color palette |
| `20261103000000_default_kiosk_products.sql` | 1665 | default kiosk products |
| `20261110000000_app_halls_is_test_hall.sql` | 2514 | app halls is test hall |
| `20261115000000_app_ops_alerts.sql` | 3227 | app ops alerts |
| `20261120000000_agent_transactions_idempotency.sql` | 2317 | agent transactions idempotency |
| `20261201000000_app_rg_play_states_games_played_session.sql` | 1378 | app rg play states games played session |
| `20261202000000_hall_cash_withdrawals_daily.sql` | 2748 | hall cash withdrawals daily |
| `20261203000000_status_incidents.sql` | 3059 | status incidents |
| `20261204000000_pending_payouts_for_next_agent_flag.sql` | 2204 | pending payouts for next agent flag |
| `20261205000000_spill1_prize_defaults.sql` | 4029 | spill1 prize defaults |
| `20261206000001_game2_ticket_pools.sql` | 3326 | game2 ticket pools |
| `20261207000000_remove_temabingo_game4.sql` | 1516 | remove temabingo game4 |
| `20261208000000_app_system_accounts.sql` | 4520 | app system accounts |
| `20261210000000_app_game_catalog_and_plan.sql` | 11776 | app game catalog and plan |
| `20261210010000_app_game1_scheduled_games_catalog_link.sql` | 4064 | app game1 scheduled games catalog link |
| `20261210010100_app_game1_scheduled_games_nullable_legacy_fks.sql` | 2223 | app game1 scheduled games nullable legacy fks |
| `20261210010200_app_game_plan_item_bonus_override.sql` | 1321 | app game plan item bonus override |
| `20261210010300_app_game_catalog_prize_multiplier_mode.sql` | 3929 | app game catalog prize multiplier mode |
| `20261210010400_app_game1_scheduled_games_trafikklys_row_color.sql` | 2330 | app game1 scheduled games trafikklys row color |
| `20261211000000_app_spill3_config.sql` | 6982 | app spill3 config |
| `20261212000000_app_spill3_config_opening_times.sql` | 1698 | app spill3 config opening times |
| `20261213000000_app_spill2_config.sql` | 7561 | app spill2 config |
| `20261214000000_app_hall_groups_master_hall_id.sql` | 1640 | app hall groups master hall id |
| `20261215000000_app_room_alerting.sql` | 3603 | app room alerting |
| `20261216000000_app_hall_groups_cascade_fk.sql` | 8474 | app hall groups cascade fk |
| `20261217000000_app_anti_fraud_signals.sql` | 3651 | app anti fraud signals |
| `20261218000000_app_game1_scheduled_games_pause_reason.sql` | 1702 | app game1 scheduled games pause reason |
| `20261219000000_game1_master_audit_add_crit7_actions.sql` | 3209 | game1 master audit add crit7 actions |
| `20261220000000_deprecate_game1_daily_jackpot_state.sql` | 2361 | deprecate game1 daily jackpot state |
| `20261221000000_app_game1_scheduled_games_room_code_active_only.sql` | 3328 | app game1 scheduled games room code active only |
| `20261222000000_game1_stuck_recovery.sql` | 2573 | game1 stuck recovery |
| `20261223000000_spill1_default_seconds_4.sql` | 2455 | spill1 default seconds 4 |
| `20261224000000_cleanup_stale_null_room_code.sql` | 1990 | cleanup stale null room code |
| `20261225000000_enable_pg_stat_statements.sql` | 2600 | enable pg stat statements |
| `20261226000000_reconcile_stuck_plan_runs.sql` | 3825 | reconcile stuck plan runs |
