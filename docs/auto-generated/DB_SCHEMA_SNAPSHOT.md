# DB-skjema-snapshot

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> `.github/workflows/auto-generate-docs.yml` på hver push til main.
>
> Generator: `scripts/generate-architecture-docs.sh`
> Sist oppdatert: 2026-05-15T21:21:10Z
> Commit: `b772ccfd` (branch: `main`)

Liste over tabeller (og deres kolonner ved CREATE TABLE-tid) parset fra
`apps/backend/migrations/*.sql`. Senere ALTER TABLE-uttrykk listes
separat under "Endringer".

> **Begrensning:** Dette er en parse-basert tilnærming, ikke en
> autoritativ snapshot fra prod-DB. For 100% korrekthet, kjør
> `psql -d <prod> -c "\\d+"` direkte. Snapshot-en er tilstrekkelig for
> agent-onboarding men IKKE for compliance-bevis.

## Tabeller (CREATE TABLE)

| Tabell | Definert i migrasjon |
|---|---|
| `app_agent_halls` | `20260418220100_agent_halls.sql` |
| `app_agent_permissions` | `20260705000000_agent_permissions.sql` |
| `app_agent_settlements` | `20260418250000_agent_settlements.sql` |
| `app_agent_shifts` | `20260418220200_agent_shifts.sql` |
| `app_agent_ticket_ranges` | `20260417000003_agent_ticket_ranges.sql` |
| `app_agent_transactions` | `20260418240000_agent_transactions.sql` |
| `app_alert_log` | `20261215000000_app_room_alerting.sql` |
| `app_aml_red_flags` | `20260418200000_aml_red_flags.sql` |
| `app_aml_rules` | `20260418200000_aml_red_flags.sql` |
| `app_anti_fraud_signals` | `20261217000000_app_anti_fraud_signals.sql` |
| `app_audit_log` | `20260418160000_app_audit_log.sql` |
| `app_blocked_ips` | `20260418210000_security_admin.sql` |
| `app_chat_messages` | `20260418130000_chat_messages.sql` |
| `app_close_day_log` | `20260425000000_close_day_log.sql` |
| `app_close_day_recurring_patterns` | `20260901000000_close_day_recurring_patterns.sql` |
| `app_cms_content_versions` | `20260700000000_cms_content_versions.sql` |
| `app_cms_content` | `20260426000200_cms.sql` |
| `app_cms_faq` | `20260426000200_cms.sql` |
| `app_compliance_outbox` | `20260429074303_compliance_outbox.sql` |
| `app_daily_regulatory_reports` | `20260417000006_daily_regulatory_reports.sql` |
| `app_daily_schedules` | `20260422000000_daily_schedules.sql` |
| `app_deposit_requests` | `20260418160000_deposit_withdraw_queue.sql` |
| `app_draw_session_events` | `20260416000001_multi_hall_linked_draws.sql` |
| `app_draw_session_halls` | `20260416000001_multi_hall_linked_draws.sql` |
| `app_draw_session_tickets` | `20260417000008_draw_session_tickets.sql` |
| `app_draw_sessions` | `20260416000001_multi_hall_linked_draws.sql` |
| `app_email_verify_tokens` | `20260418180000_auth_tokens.sql` |
| `app_game1_accumulating_pots` | `20260611000000_game1_accumulating_pots.sql` |
| `app_game1_draws` | `20260501000100_app_game1_draws.sql` |
| `app_game1_game_state` | `20260501000200_app_game1_game_state.sql` |
| `app_game1_hall_ready_status` | `20260428000100_game1_hall_ready_status.sql` |
| `app_game1_jackpot_awards` | `20260901000000_game1_jackpot_awards.sql` |
| `app_game1_jackpot_state` | `20260821000000_game1_jackpot_state.sql` |
| `app_game1_master_audit` | `20260428000200_game1_master_audit.sql` |
| `app_game1_master_transfer_requests` | `20260727000000_game1_master_transfer_requests.sql` |
| `app_game1_mini_game_results` | `20260606000000_app_game1_mini_game_results.sql` |
| `app_game1_oddsen_state` | `20260609000000_game1_oddsen_state.sql` |
| `app_game1_phase_winners` | `20260501000300_app_game1_phase_winners.sql` |
| `app_game1_pot_events` | `20260611000000_game1_accumulating_pots.sql` |
| `app_game1_scheduled_games` | `20260428000000_game1_scheduled_games.sql` |
| `app_game1_ticket_assignments` | `20260501000000_app_game1_ticket_assignments.sql` |
| `app_game1_ticket_purchases` | `20260430000000_app_game1_ticket_purchases.sql` |
| `app_game2_ticket_pools` | `20261206000001_game2_ticket_pools.sql` |
| `app_game_catalog` | `20261210000000_app_game_catalog_and_plan.sql` |
| `app_game_management` | `20260419000000_game_management.sql` |
| `app_game_plan_item` | `20261210000000_app_game_catalog_and_plan.sql` |
| `app_game_plan_run` | `20261210000000_app_game_catalog_and_plan.sql` |
| `app_game_plan` | `20261210000000_app_game_catalog_and_plan.sql` |
| `app_game_settings_change_log` | `20260413000001_initial_schema.sql` |
| `app_game_types` | `20260425000000_game_types.sql` |
| `app_games` | `20260413000001_initial_schema.sql` |
| `app_hall_cash_transactions` | `20260418250300_hall_cash_transactions.sql` |
| `app_hall_cash_withdrawals_daily` | `20261202000000_hall_cash_withdrawals_daily.sql` |
| `app_hall_display_tokens` | `20260418150000_hall_display_tokens.sql` |
| `app_hall_game_config` | `20260413000001_initial_schema.sql` |
| `app_hall_group_members` | `20260424000000_hall_groups.sql` |
| `app_hall_groups` | `20260416000001_multi_hall_linked_draws.sql` |
| `app_hall_groups` | `20260424000000_hall_groups.sql` |
| `app_hall_manual_adjustments` | `20260421000000_hall_manual_adjustments.sql` |
| `app_hall_products` | `20260420000000_products.sql` |
| `app_hall_registrations` | `20260413000001_initial_schema.sql` |
| `app_halls` | `20260413000001_initial_schema.sql` |
| `app_idempotency_records` | `20260417000004_idempotency_records.sql` |
| `app_leaderboard_tiers` | `20260425000400_leaderboard_tiers.sql` |
| `app_loyalty_events` | `20260429000000_loyalty.sql` |
| `app_loyalty_player_state` | `20260429000000_loyalty.sql` |
| `app_loyalty_tiers` | `20260429000000_loyalty.sql` |
| `app_machine_tickets` | `20260420100000_machine_tickets.sql` |
| `app_maintenance_windows` | `20260425000500_system_settings_maintenance.sql` |
| `app_mini_games_config` | `20260425000600_mini_games_config.sql` |
| `app_notifications` | `20260706000000_app_notifications_and_devices.sql` |
| `app_ops_alerts` | `20261115000000_app_ops_alerts.sql` |
| `app_password_reset_tokens` | `20260418180000_auth_tokens.sql` |
| `app_patterns` | `20260423000000_patterns.sql` |
| `app_physical_ticket_batches` | `20260418230000_physical_tickets.sql` |
| `app_physical_ticket_cashouts` | `20260427000000_physical_ticket_cashouts.sql` |
| `app_physical_ticket_pending_payouts` | `20260608000000_physical_ticket_pending_payouts.sql` |
| `app_physical_ticket_transfers` | `20260420000100_physical_ticket_transfers.sql` |
| `app_physical_tickets` | `20260418230000_physical_tickets.sql` |
| `app_player_hall_status` | `20260418190000_player_lifecycle.sql` |
| `app_product_cart_items` | `20260420000000_products.sql` |
| `app_product_carts` | `20260420000000_products.sql` |
| `app_product_categories` | `20260420000000_products.sql` |
| `app_product_sales` | `20260420000000_products.sql` |
| `app_products` | `20260420000000_products.sql` |
| `app_regulatory_ledger` | `20260417000005_regulatory_ledger.sql` |
| `app_rg_compliance_ledger` | `20260413000001_initial_schema.sql` |
| `app_rg_daily_reports` | `20260413000001_initial_schema.sql` |
| `app_rg_extra_prize_entries` | `20260413000001_initial_schema.sql` |
| `app_rg_hall_organizations` | `20260413000001_initial_schema.sql` |
| `app_rg_loss_entries` | `20260413000001_initial_schema.sql` |
| `app_rg_overskudd_batches` | `20260413000001_initial_schema.sql` |
| `app_rg_payout_audit` | `20260413000001_initial_schema.sql` |
| `app_rg_pending_loss_limit_changes` | `20260413000001_initial_schema.sql` |
| `app_rg_personal_loss_limits` | `20260413000001_initial_schema.sql` |
| `app_rg_play_states` | `20260413000001_initial_schema.sql` |
| `app_rg_prize_policies` | `20260413000001_initial_schema.sql` |
| `app_rg_restrictions` | `20260413000001_initial_schema.sql` |
| `app_risk_countries` | `20260418210000_security_admin.sql` |
| `app_saved_games` | `20260425000200_saved_games.sql` |
| `app_schedules` | `20260425000300_schedules.sql` |
| `app_screen_saver_images` | `20260425125008_screen_saver_settings.sql` |
| `app_sessions` | `20260413000001_initial_schema.sql` |
| `app_spill1_prize_defaults` | `20261205000000_spill1_prize_defaults.sql` |
| `app_spill2_config` | `20261213000000_app_spill2_config.sql` |
| `app_spill3_config` | `20261211000000_app_spill3_config.sql` |
| `app_static_tickets` | `20260417000002_static_tickets.sql` |
| `app_status_incidents` | `20261203000000_status_incidents.sql` |
| `app_sub_games` | `20260425000100_sub_games.sql` |
| `app_system_accounts` | `20261208000000_app_system_accounts.sql` |
| `app_system_settings` | `20260425000500_system_settings_maintenance.sql` |
| `app_terminals` | `20260413000001_initial_schema.sql` |
| `app_ticket_ranges_per_game` | `20260726100000_ticket_ranges_per_game.sql` |
| `app_unique_id_transactions` | `20260724001000_app_unique_ids.sql` |
| `app_unique_ids` | `20260724001000_app_unique_ids.sql` |
| `app_user_2fa_challenges` | `20260910000000_user_2fa_and_session_metadata.sql` |
| `app_user_2fa` | `20260910000000_user_2fa_and_session_metadata.sql` |
| `app_user_devices` | `20260706000000_app_notifications_and_devices.sql` |
| `app_user_pins` | `20260902000000_app_user_pins.sql` |
| `app_user_profile_settings` | `20260820000000_user_profile_settings.sql` |
| `app_users` | `20260413000001_initial_schema.sql` |
| `app_voucher_redemptions` | `20260723000000_voucher_redemptions.sql` |
| `app_vouchers` | `20260418240000_vouchers.sql` |
| `app_wallet_reservations` | `20260425000000_wallet_reservations_numeric.sql` |
| `app_wallet_reservations` | `20260724100000_wallet_reservations.sql` |
| `app_withdraw_email_allowlist` | `20260418210000_security_admin.sql` |
| `app_withdraw_requests` | `20260418160000_deposit_withdraw_queue.sql` |
| `app_xml_export_batches` | `20260810000100_xml_export_batches.sql` |
| `game_checkpoints` | `20260413000001_initial_schema.sql` |
| `game_sessions` | `20260413000001_initial_schema.sql` |
| `hall_game_schedules` | `20260413000001_initial_schema.sql` |
| `hall_schedule_log` | `20260413000001_initial_schema.sql` |
| `swedbank_payment_intents` | `20260413000001_initial_schema.sql` |
| `wallet_accounts` | `20260413000001_initial_schema.sql` |
| `wallet_entries` | `20260413000001_initial_schema.sql` |
| `wallet_outbox` | `20260427000000_wallet_outbox.sql` |
| `wallet_reconciliation_alerts` | `20260826000000_wallet_reconciliation_alerts.sql` |
| `wallet_transactions` | `20260413000001_initial_schema.sql` |

## Endringer (ALTER TABLE) — antall per tabell

Dette gir en grov idé om hvor aktiv en tabell har vært.

| Tabell | Antall ALTER TABLE-statements |
|---|---:|
| `app_halls` | 14 |
| `app_users` | 13 |
| `app_game1_scheduled_games` | 12 |
| `app_hall_groups` | 11 |
| `app_withdraw_requests` | 9 |
| `wallet_accounts` | 8 |
| `app_physical_tickets` | 6 |
| `app_agent_transactions` | 5 |
| `wallet_entries` | 4 |
| `app_wallet_reservations` | 4 |
| `app_game_plan_run` | 4 |
| `app_game_plan` | 4 |
| `app_game1_master_audit` | 4 |
| `app_game_plan_item` | 3 |
| `app_agent_ticket_ranges` | 3 |
| `app_agent_shifts` | 3 |
| `wallet_transactions` | 2 |
| `swedbank_payment_intents` | 2 |
| `hall_game_schedules` | 2 |
| `app_rg_compliance_ledger` | 2 |
| `app_hall_group_members` | 2 |
| `app_hall_game_config` | 2 |
| `app_game1_mini_game_results` | 2 |
| `app_close_day_log` | 2 |
| `app_audit_log` | 2 |
| `app_agent_settlements` | 2 |
| `game_sessions` | 1 |
| `app_ticket_ranges_per_game` | 1 |
| `app_static_tickets` | 1 |
| `app_spill3_config` | 1 |
| `app_sessions` | 1 |
| `app_rg_play_states` | 1 |
| `app_physical_ticket_pending_payouts` | 1 |
| `app_physical_ticket_batches` | 1 |
| `app_game_catalog` | 1 |
| `app_game1_hall_ready_status` | 1 |
| `app_game1_game_state` | 1 |
| `app_cms_content` | 1 |
| `app_chat_messages` | 1 |
| `IF` | 1 |

## CREATE INDEX — antall per tabell

| Tabell | Antall indekser |
|---|---:|
