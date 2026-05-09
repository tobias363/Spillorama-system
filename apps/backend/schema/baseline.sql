--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;

--
-- Name: app_regulatory_ledger_block_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_regulatory_ledger_block_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'app_regulatory_ledger er append-only — % er blokkert. Skriv en kompenserende ADJUSTMENT-rad isteden.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

--
-- Name: app_user_2fa_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_user_2fa_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

--
-- Name: app_user_profile_settings_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_user_profile_settings_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_agent_halls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_agent_halls (
    user_id text NOT NULL,
    hall_id text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by_user_id text
);

--
-- Name: app_agent_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_agent_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_user_id text NOT NULL,
    module text NOT NULL,
    can_create boolean DEFAULT false NOT NULL,
    can_edit boolean DEFAULT false NOT NULL,
    can_view boolean DEFAULT false NOT NULL,
    can_delete boolean DEFAULT false NOT NULL,
    can_block_unblock boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    CONSTRAINT app_agent_permissions_module_check CHECK ((module = ANY (ARRAY['player'::text, 'schedule'::text, 'game_creation'::text, 'saved_game'::text, 'physical_ticket'::text, 'unique_id'::text, 'report'::text, 'wallet'::text, 'transaction'::text, 'withdraw'::text, 'product'::text, 'hall_account'::text, 'hall_specific_report'::text, 'payout'::text, 'accounting'::text])))
);

--
-- Name: app_agent_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_agent_settlements (
    id text NOT NULL,
    shift_id text NOT NULL,
    agent_user_id text NOT NULL,
    hall_id text NOT NULL,
    business_date date NOT NULL,
    daily_balance_at_start numeric(14,2) DEFAULT 0 NOT NULL,
    daily_balance_at_end numeric(14,2) DEFAULT 0 NOT NULL,
    reported_cash_count numeric(14,2) NOT NULL,
    daily_balance_difference numeric(14,2) DEFAULT 0 NOT NULL,
    settlement_to_drop_safe numeric(14,2) DEFAULT 0 NOT NULL,
    withdraw_from_total_balance numeric(14,2) DEFAULT 0 NOT NULL,
    total_drop_safe numeric(14,2) DEFAULT 0 NOT NULL,
    shift_cash_in_total numeric(14,2) DEFAULT 0 NOT NULL,
    shift_cash_out_total numeric(14,2) DEFAULT 0 NOT NULL,
    shift_card_in_total numeric(14,2) DEFAULT 0 NOT NULL,
    shift_card_out_total numeric(14,2) DEFAULT 0 NOT NULL,
    settlement_note text,
    closed_by_user_id text NOT NULL,
    is_forced boolean DEFAULT false NOT NULL,
    edited_by_user_id text,
    edited_at timestamp with time zone,
    edit_reason text,
    other_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    machine_breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
    bilag_receipt jsonb
);

--
-- Name: app_agent_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_agent_shifts (
    id text NOT NULL,
    user_id text NOT NULL,
    hall_id text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    is_logged_out boolean DEFAULT false NOT NULL,
    is_daily_balance_transferred boolean DEFAULT false NOT NULL,
    daily_balance numeric(14,2) DEFAULT 0 NOT NULL,
    total_daily_balance_in numeric(14,2) DEFAULT 0 NOT NULL,
    total_cash_in numeric(14,2) DEFAULT 0 NOT NULL,
    total_cash_out numeric(14,2) DEFAULT 0 NOT NULL,
    total_card_in numeric(14,2) DEFAULT 0 NOT NULL,
    total_card_out numeric(14,2) DEFAULT 0 NOT NULL,
    selling_by_customer_number integer DEFAULT 0 NOT NULL,
    hall_cash_balance numeric(14,2) DEFAULT 0 NOT NULL,
    hall_dropsafe_balance numeric(14,2) DEFAULT 0 NOT NULL,
    daily_difference numeric(14,2) DEFAULT 0 NOT NULL,
    control_daily_balance jsonb DEFAULT '{}'::jsonb NOT NULL,
    settlement jsonb DEFAULT '{}'::jsonb NOT NULL,
    previous_settlement jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    settled_by_user_id text,
    distributed_winnings boolean DEFAULT false NOT NULL,
    transferred_register_tickets boolean DEFAULT false NOT NULL,
    logout_notes text
);

--
-- Name: app_agent_ticket_ranges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_agent_ticket_ranges (
    id text NOT NULL,
    agent_id text NOT NULL,
    hall_id text NOT NULL,
    ticket_color text NOT NULL,
    initial_serial text NOT NULL,
    final_serial text NOT NULL,
    serials jsonb NOT NULL,
    next_available_index integer DEFAULT 0 NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    transfer_to_next_agent boolean DEFAULT false NOT NULL,
    current_top_serial text,
    handover_from_range_id text,
    handed_off_to_range_id text,
    CONSTRAINT app_agent_ticket_ranges_next_available_index_check CHECK ((next_available_index >= 0)),
    CONSTRAINT app_agent_ticket_ranges_ticket_color_check CHECK ((ticket_color = ANY (ARRAY['small'::text, 'large'::text, 'traffic-light'::text])))
);

--
-- Name: app_agent_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_agent_transactions (
    id text NOT NULL,
    shift_id text NOT NULL,
    agent_user_id text NOT NULL,
    player_user_id text NOT NULL,
    hall_id text NOT NULL,
    action_type text NOT NULL,
    wallet_direction text NOT NULL,
    payment_method text NOT NULL,
    amount numeric(14,2) NOT NULL,
    previous_balance numeric(14,2) NOT NULL,
    after_balance numeric(14,2) NOT NULL,
    wallet_tx_id text,
    ticket_unique_id text,
    external_reference text,
    notes text,
    other_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    related_tx_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_request_id text,
    CONSTRAINT app_agent_transactions_action_type_check CHECK ((action_type = ANY (ARRAY['CASH_IN'::text, 'CASH_OUT'::text, 'TICKET_SALE'::text, 'TICKET_REGISTER'::text, 'TICKET_CANCEL'::text, 'PRODUCT_SALE'::text, 'MACHINE_CREATE'::text, 'MACHINE_TOPUP'::text, 'MACHINE_CLOSE'::text, 'MACHINE_VOID'::text, 'FEE'::text, 'OTHER'::text]))),
    CONSTRAINT app_agent_transactions_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT app_agent_transactions_payment_method_check CHECK ((payment_method = ANY (ARRAY['CASH'::text, 'CARD'::text, 'WALLET'::text]))),
    CONSTRAINT app_agent_transactions_wallet_direction_check CHECK ((wallet_direction = ANY (ARRAY['CREDIT'::text, 'DEBIT'::text])))
);

--
-- Name: app_alert_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_alert_log (
    id bigint NOT NULL,
    scenario_key text NOT NULL,
    game text NOT NULL,
    hall_id text,
    scenario text NOT NULL,
    severity text NOT NULL,
    message text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    channels text[] DEFAULT ARRAY[]::text[] NOT NULL,
    entry_hash text NOT NULL,
    previous_entry_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_alert_log_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text])))
);

--
-- Name: app_alert_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_alert_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_alert_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_alert_log_id_seq OWNED BY public.app_alert_log.id;

--
-- Name: app_aml_red_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_aml_red_flags (
    id text NOT NULL,
    user_id text NOT NULL,
    rule_slug text NOT NULL,
    severity text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    reason text NOT NULL,
    transaction_id text,
    details jsonb,
    opened_by text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_outcome text,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_aml_red_flags_review_outcome_check CHECK ((review_outcome = ANY (ARRAY['REVIEWED'::text, 'DISMISSED'::text, 'ESCALATED'::text]))),
    CONSTRAINT app_aml_red_flags_severity_check CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text]))),
    CONSTRAINT app_aml_red_flags_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'REVIEWED'::text, 'DISMISSED'::text, 'ESCALATED'::text])))
);

--
-- Name: app_aml_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_aml_rules (
    id text NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    severity text NOT NULL,
    threshold_amount_cents bigint,
    window_days integer,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_aml_rules_severity_check CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text])))
);

--
-- Name: app_anti_fraud_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_anti_fraud_signals (
    id text NOT NULL,
    user_id text NOT NULL,
    hall_id text,
    transaction_id text,
    risk_level text NOT NULL,
    signals_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    action_taken text NOT NULL,
    ip_address text,
    amount_cents bigint,
    operation_type text,
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_anti_fraud_signals_action_taken_check CHECK ((action_taken = ANY (ARRAY['logged'::text, 'flagged_for_review'::text, 'blocked'::text]))),
    CONSTRAINT app_anti_fraud_signals_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);

--
-- Name: app_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_audit_log (
    id bigint NOT NULL,
    actor_id text,
    actor_type text NOT NULL,
    action text NOT NULL,
    resource text NOT NULL,
    resource_id text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['USER'::text, 'ADMIN'::text, 'HALL_OPERATOR'::text, 'SUPPORT'::text, 'PLAYER'::text, 'SYSTEM'::text, 'EXTERNAL'::text, 'AGENT'::text])))
);

--
-- Name: app_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_audit_log_id_seq OWNED BY public.app_audit_log.id;

--
-- Name: app_blocked_ips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_blocked_ips (
    id text NOT NULL,
    ip_address text NOT NULL,
    reason text,
    blocked_by text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_chat_messages (
    id bigint NOT NULL,
    hall_id text NOT NULL,
    room_code text NOT NULL,
    player_id text NOT NULL,
    player_name text NOT NULL,
    message text NOT NULL,
    emoji_id integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by_user_id text,
    delete_reason text,
    CONSTRAINT app_chat_messages_delete_reason_check CHECK (((delete_reason IS NULL) OR (length(delete_reason) <= 500))),
    CONSTRAINT app_chat_messages_message_check CHECK ((length(message) <= 500))
);

--
-- Name: app_chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_chat_messages_id_seq OWNED BY public.app_chat_messages.id;

--
-- Name: app_close_day_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_close_day_log (
    id text NOT NULL,
    game_management_id text NOT NULL,
    close_date date NOT NULL,
    closed_by text,
    summary_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    start_time text,
    end_time text,
    notes text,
    recurring_pattern_id text
);

--
-- Name: app_close_day_recurring_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_close_day_recurring_patterns (
    id text NOT NULL,
    game_management_id text NOT NULL,
    pattern_json jsonb NOT NULL,
    start_date date NOT NULL,
    end_date date,
    max_occurrences integer,
    start_time text,
    end_time text,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by text
);

--
-- Name: app_cms_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_cms_content (
    slug text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    updated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    live_version_id text,
    live_version_number integer
);

--
-- Name: app_cms_content_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_cms_content_versions (
    id text NOT NULL,
    slug text NOT NULL,
    version_number integer NOT NULL,
    content text NOT NULL,
    status text NOT NULL,
    created_by_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_by_user_id text,
    approved_at timestamp with time zone,
    published_by_user_id text,
    published_at timestamp with time zone,
    retired_at timestamp with time zone,
    CONSTRAINT app_cms_content_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'approved'::text, 'live'::text, 'retired'::text]))),
    CONSTRAINT cms_content_versions_four_eyes_chk CHECK (((approved_by_user_id IS NULL) OR (approved_by_user_id <> created_by_user_id)))
);

--
-- Name: app_cms_faq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_cms_faq (
    id text NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by_user_id text,
    updated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_compliance_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_compliance_outbox (
    id bigint NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT app_compliance_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT app_compliance_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processed'::text, 'dead_letter'::text])))
);

--
-- Name: app_compliance_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_compliance_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_compliance_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_compliance_outbox_id_seq OWNED BY public.app_compliance_outbox.id;

--
-- Name: app_daily_regulatory_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_daily_regulatory_reports (
    id text NOT NULL,
    sequence bigint NOT NULL,
    report_date date NOT NULL,
    hall_id text NOT NULL,
    channel text NOT NULL,
    ticket_turnover_nok numeric(14,2) NOT NULL,
    prizes_paid_nok numeric(14,2) NOT NULL,
    tickets_sold_count integer NOT NULL,
    unique_players integer NOT NULL,
    ledger_first_sequence bigint NOT NULL,
    ledger_last_sequence bigint NOT NULL,
    prev_hash text,
    signed_hash text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    generated_by text,
    CONSTRAINT app_daily_regulatory_reports_channel_check CHECK ((channel = ANY (ARRAY['HALL'::text, 'INTERNET'::text]))),
    CONSTRAINT app_daily_regulatory_reports_tickets_sold_count_check CHECK ((tickets_sold_count >= 0)),
    CONSTRAINT app_daily_regulatory_reports_unique_players_check CHECK ((unique_players >= 0))
);

--
-- Name: app_daily_regulatory_reports_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_daily_regulatory_reports_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_daily_regulatory_reports_sequence_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_daily_regulatory_reports_sequence_seq OWNED BY public.app_daily_regulatory_reports.sequence;

--
-- Name: app_daily_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_daily_schedules (
    id text NOT NULL,
    name text NOT NULL,
    game_management_id text,
    hall_id text,
    hall_ids_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    week_days integer DEFAULT 0 NOT NULL,
    day text,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone,
    start_time text DEFAULT ''::text NOT NULL,
    end_time text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    stop_game boolean DEFAULT false NOT NULL,
    special_game boolean DEFAULT false NOT NULL,
    is_saved_game boolean DEFAULT false NOT NULL,
    is_admin_saved_game boolean DEFAULT false NOT NULL,
    innsatsen_sales bigint DEFAULT 0 NOT NULL,
    subgames_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    other_data_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_daily_schedules_check CHECK (((end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT app_daily_schedules_day_check CHECK (((day IS NULL) OR (day = ANY (ARRAY['monday'::text, 'tuesday'::text, 'wednesday'::text, 'thursday'::text, 'friday'::text, 'saturday'::text, 'sunday'::text])))),
    CONSTRAINT app_daily_schedules_end_time_check CHECK (((end_time = ''::text) OR (end_time ~ '^[0-9]{2}:[0-9]{2}$'::text))),
    CONSTRAINT app_daily_schedules_innsatsen_sales_check CHECK ((innsatsen_sales >= 0)),
    CONSTRAINT app_daily_schedules_start_time_check CHECK (((start_time = ''::text) OR (start_time ~ '^[0-9]{2}:[0-9]{2}$'::text))),
    CONSTRAINT app_daily_schedules_status_check CHECK ((status = ANY (ARRAY['active'::text, 'running'::text, 'finish'::text, 'inactive'::text]))),
    CONSTRAINT app_daily_schedules_week_days_check CHECK (((week_days >= 0) AND (week_days <= 127)))
);

--
-- Name: app_deposit_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_deposit_requests (
    id text NOT NULL,
    user_id text NOT NULL,
    wallet_id text NOT NULL,
    amount_cents bigint NOT NULL,
    hall_id text,
    submitted_by text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    rejection_reason text,
    accepted_by text,
    accepted_at timestamp with time zone,
    rejected_by text,
    rejected_at timestamp with time zone,
    wallet_transaction_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_deposit_requests_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT app_deposit_requests_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'REJECTED'::text])))
);

--
-- Name: app_draw_session_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_draw_session_events (
    id bigint NOT NULL,
    draw_session_id text NOT NULL,
    event_type text NOT NULL,
    chain_index bigint NOT NULL,
    previous_hash text NOT NULL,
    event_hash text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_draw_session_events_event_type_check CHECK ((event_type = ANY (ARRAY['CREATED'::text, 'HALL_READY'::text, 'HALL_UNREADY'::text, 'COORDINATOR_START'::text, 'DRAW'::text, 'CLAIM'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);

--
-- Name: app_draw_session_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_draw_session_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_draw_session_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_draw_session_events_id_seq OWNED BY public.app_draw_session_events.id;

--
-- Name: app_draw_session_halls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_draw_session_halls (
    draw_session_id text NOT NULL,
    hall_id text NOT NULL,
    ready_at timestamp with time zone,
    ready_confirmed_by text,
    digital_tickets_sold integer DEFAULT 0 NOT NULL,
    physical_tickets_sold integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_draw_session_halls_digital_tickets_sold_check CHECK ((digital_tickets_sold >= 0)),
    CONSTRAINT app_draw_session_halls_physical_tickets_sold_check CHECK ((physical_tickets_sold >= 0))
);

--
-- Name: app_draw_session_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_draw_session_tickets (
    id text NOT NULL,
    draw_session_id text NOT NULL,
    hall_id text NOT NULL,
    user_id text NOT NULL,
    purchase_channel text DEFAULT 'digital'::text NOT NULL,
    grid_json jsonb NOT NULL,
    price_paid_nok numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_draw_session_tickets_price_paid_nok_check CHECK ((price_paid_nok >= (0)::numeric)),
    CONSTRAINT app_draw_session_tickets_purchase_channel_check CHECK ((purchase_channel = ANY (ARRAY['digital'::text, 'physical'::text])))
);

--
-- Name: app_draw_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_draw_sessions (
    id text NOT NULL,
    hall_group_id text NOT NULL,
    coordinator_hall_id text NOT NULL,
    status text DEFAULT 'OPEN_FOR_TICKETS'::text NOT NULL,
    ruleset_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    rng_seed text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_draw_sessions_status_check CHECK ((status = ANY (ARRAY['OPEN_FOR_TICKETS'::text, 'WAITING_READY'::text, 'READY_TO_START'::text, 'DRAWING'::text, 'COMPLETE'::text, 'CANCELLED'::text])))
);

--
-- Name: app_email_verify_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_email_verify_tokens (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_game1_accumulating_pots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_accumulating_pots (
    id text NOT NULL,
    hall_id text NOT NULL,
    pot_key text NOT NULL,
    display_name text NOT NULL,
    current_amount_cents bigint DEFAULT 0 NOT NULL,
    config_json jsonb NOT NULL,
    last_daily_boost_date text,
    last_reset_at timestamp with time zone,
    last_reset_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_game1_draws; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_draws (
    id text NOT NULL,
    scheduled_game_id text NOT NULL,
    draw_sequence integer NOT NULL,
    ball_value integer NOT NULL,
    drawn_at timestamp with time zone DEFAULT now() NOT NULL,
    current_phase_at_draw integer,
    CONSTRAINT app_game1_draws_ball_value_check CHECK (((ball_value >= 1) AND (ball_value <= 75))),
    CONSTRAINT app_game1_draws_current_phase_at_draw_check CHECK (((current_phase_at_draw IS NULL) OR ((current_phase_at_draw >= 1) AND (current_phase_at_draw <= 5)))),
    CONSTRAINT app_game1_draws_draw_sequence_check CHECK ((draw_sequence >= 1))
);

--
-- Name: app_game1_game_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_game_state (
    scheduled_game_id text NOT NULL,
    draw_bag_json jsonb NOT NULL,
    draws_completed integer DEFAULT 0 NOT NULL,
    current_phase integer DEFAULT 1 NOT NULL,
    last_drawn_ball integer,
    last_drawn_at timestamp with time zone,
    next_auto_draw_at timestamp with time zone,
    paused boolean DEFAULT false NOT NULL,
    engine_started_at timestamp with time zone DEFAULT now() NOT NULL,
    engine_ended_at timestamp with time zone,
    paused_at_phase integer,
    CONSTRAINT app_game1_game_state_current_phase_check CHECK (((current_phase >= 1) AND (current_phase <= 5))),
    CONSTRAINT app_game1_game_state_draws_completed_check CHECK ((draws_completed >= 0)),
    CONSTRAINT app_game1_game_state_paused_at_phase_check CHECK (((paused_at_phase IS NULL) OR ((paused_at_phase >= 1) AND (paused_at_phase <= 5))))
);

--
-- Name: app_game1_hall_ready_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_hall_ready_status (
    game_id text NOT NULL,
    hall_id text NOT NULL,
    is_ready boolean DEFAULT false NOT NULL,
    ready_at timestamp with time zone,
    ready_by_user_id text,
    digital_tickets_sold integer DEFAULT 0 NOT NULL,
    physical_tickets_sold integer DEFAULT 0 NOT NULL,
    excluded_from_game boolean DEFAULT false NOT NULL,
    excluded_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_ticket_id text,
    start_scanned_at timestamp with time zone,
    final_scan_ticket_id text,
    final_scanned_at timestamp with time zone,
    CONSTRAINT app_game1_hall_ready_status_digital_tickets_sold_check CHECK ((digital_tickets_sold >= 0)),
    CONSTRAINT app_game1_hall_ready_status_physical_tickets_sold_check CHECK ((physical_tickets_sold >= 0))
);

--
-- Name: app_game1_jackpot_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_jackpot_awards (
    id text NOT NULL,
    hall_group_id text NOT NULL,
    idempotency_key text NOT NULL,
    awarded_amount_cents bigint NOT NULL,
    previous_amount_cents bigint NOT NULL,
    new_amount_cents bigint NOT NULL,
    scheduled_game_id text,
    draw_sequence_at_win integer,
    reason text,
    awarded_by_user_id text,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_game1_jackpot_awards_awarded_amount_cents_check CHECK ((awarded_amount_cents >= 0)),
    CONSTRAINT app_game1_jackpot_awards_draw_sequence_at_win_check CHECK (((draw_sequence_at_win IS NULL) OR (draw_sequence_at_win >= 0))),
    CONSTRAINT app_game1_jackpot_awards_new_amount_cents_check CHECK ((new_amount_cents >= 0)),
    CONSTRAINT app_game1_jackpot_awards_previous_amount_cents_check CHECK ((previous_amount_cents >= 0))
);

--
-- Name: app_game1_jackpot_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_jackpot_state (
    hall_group_id text NOT NULL,
    current_amount_cents bigint DEFAULT 200000 NOT NULL,
    last_accumulation_date date DEFAULT CURRENT_DATE NOT NULL,
    max_cap_cents bigint DEFAULT 3000000 NOT NULL,
    daily_increment_cents bigint DEFAULT 400000 NOT NULL,
    draw_thresholds_json jsonb DEFAULT '[50, 55, 56, 57]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jackpot_state_amount_nonneg CHECK ((current_amount_cents >= 0)),
    CONSTRAINT jackpot_state_cap_positive CHECK ((max_cap_cents > 0)),
    CONSTRAINT jackpot_state_increment_nonneg CHECK ((daily_increment_cents >= 0))
);

--
-- Name: app_game1_master_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_master_audit (
    id text NOT NULL,
    game_id text NOT NULL,
    action text NOT NULL,
    actor_user_id text NOT NULL,
    actor_hall_id text NOT NULL,
    group_hall_id text NOT NULL,
    halls_ready_snapshot jsonb NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_game1_master_audit_action_check CHECK ((action = ANY (ARRAY['start'::text, 'pause'::text, 'resume'::text, 'stop'::text, 'exclude_hall'::text, 'include_hall'::text, 'timeout_detected'::text, 'transfer_request'::text, 'transfer_approved'::text, 'transfer_rejected'::text, 'transfer_expired'::text])))
);

--
-- Name: app_game1_master_transfer_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_master_transfer_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id text NOT NULL,
    from_hall_id text NOT NULL,
    to_hall_id text NOT NULL,
    initiated_by_user_id text CONSTRAINT app_game1_master_transfer_request_initiated_by_user_id_not_null NOT NULL,
    initiated_at timestamp with time zone DEFAULT now() NOT NULL,
    valid_till timestamp with time zone NOT NULL,
    status text NOT NULL,
    responded_by_user_id text,
    responded_at timestamp with time zone,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_game1_master_transfer_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])))
);

--
-- Name: app_game1_mini_game_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_mini_game_results (
    id text NOT NULL,
    scheduled_game_id text NOT NULL,
    mini_game_type text NOT NULL,
    winner_user_id text NOT NULL,
    config_snapshot_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    choice_json jsonb,
    result_json jsonb,
    payout_cents integer DEFAULT 0 NOT NULL,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT app_game1_mini_game_results_mini_game_type_check CHECK ((mini_game_type = ANY (ARRAY['wheel'::text, 'chest'::text, 'colordraft'::text, 'oddsen'::text, 'mystery'::text]))),
    CONSTRAINT app_game1_mini_game_results_payout_cents_check CHECK ((payout_cents >= 0))
);

--
-- Name: app_game1_oddsen_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_oddsen_state (
    id text NOT NULL,
    hall_id text NOT NULL,
    chosen_number integer NOT NULL,
    chosen_by_player_id text NOT NULL,
    chosen_for_game_id text NOT NULL,
    set_by_game_id text NOT NULL,
    ticket_size_at_win text NOT NULL,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_outcome text,
    pot_amount_cents bigint,
    wallet_transaction_id text,
    CONSTRAINT app_game1_oddsen_state_chosen_number_check CHECK ((chosen_number = ANY (ARRAY[55, 56, 57]))),
    CONSTRAINT app_game1_oddsen_state_pot_amount_cents_check CHECK (((pot_amount_cents IS NULL) OR (pot_amount_cents >= 0))),
    CONSTRAINT app_game1_oddsen_state_resolved_outcome_check CHECK (((resolved_outcome IS NULL) OR (resolved_outcome = ANY (ARRAY['hit'::text, 'miss'::text, 'expired'::text])))),
    CONSTRAINT app_game1_oddsen_state_ticket_size_at_win_check CHECK ((ticket_size_at_win = ANY (ARRAY['small'::text, 'large'::text])))
);

--
-- Name: app_game1_phase_winners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_phase_winners (
    id text NOT NULL,
    scheduled_game_id text NOT NULL,
    assignment_id text NOT NULL,
    winner_user_id text NOT NULL,
    hall_id text NOT NULL,
    phase integer NOT NULL,
    draw_sequence_at_win integer NOT NULL,
    prize_amount_cents integer NOT NULL,
    total_phase_prize_cents integer NOT NULL,
    winner_brett_count integer NOT NULL,
    ticket_color text NOT NULL,
    wallet_transaction_id text,
    loyalty_points_awarded integer,
    jackpot_amount_cents integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_game1_phase_winners_draw_sequence_at_win_check CHECK ((draw_sequence_at_win >= 1)),
    CONSTRAINT app_game1_phase_winners_jackpot_amount_cents_check CHECK (((jackpot_amount_cents IS NULL) OR (jackpot_amount_cents >= 0))),
    CONSTRAINT app_game1_phase_winners_phase_check CHECK (((phase >= 1) AND (phase <= 5))),
    CONSTRAINT app_game1_phase_winners_prize_amount_cents_check CHECK ((prize_amount_cents >= 0)),
    CONSTRAINT app_game1_phase_winners_total_phase_prize_cents_check CHECK ((total_phase_prize_cents >= 0)),
    CONSTRAINT app_game1_phase_winners_winner_brett_count_check CHECK ((winner_brett_count >= 1))
);

--
-- Name: app_game1_pot_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_pot_events (
    id text NOT NULL,
    pot_id text NOT NULL,
    hall_id text NOT NULL,
    event_kind text NOT NULL,
    delta_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL,
    scheduled_game_id text,
    ticket_purchase_id text,
    winner_user_id text,
    winner_ticket_color text,
    reason text,
    config_snapshot_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_game1_scheduled_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_scheduled_games (
    id text NOT NULL,
    daily_schedule_id text,
    schedule_id text,
    sub_game_index integer NOT NULL,
    sub_game_name text NOT NULL,
    custom_game_name text,
    scheduled_day date NOT NULL,
    scheduled_start_time timestamp with time zone NOT NULL,
    scheduled_end_time timestamp with time zone NOT NULL,
    notification_start_seconds integer NOT NULL,
    ticket_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    jackpot_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    game_mode text NOT NULL,
    master_hall_id text NOT NULL,
    group_hall_id text NOT NULL,
    participating_halls_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    actual_start_time timestamp with time zone,
    actual_end_time timestamp with time zone,
    started_by_user_id text,
    excluded_hall_ids_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    stopped_by_user_id text,
    stop_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    room_code text,
    game_config_json jsonb,
    catalog_entry_id text,
    plan_run_id text,
    plan_position integer,
    trafikklys_row_color text,
    pause_reason text,
    CONSTRAINT app_game1_scheduled_games_game_mode_check CHECK ((game_mode = ANY (ARRAY['Auto'::text, 'Manual'::text]))),
    CONSTRAINT app_game1_scheduled_games_notification_start_seconds_check CHECK ((notification_start_seconds >= 0)),
    CONSTRAINT app_game1_scheduled_games_plan_position_check CHECK (((plan_position IS NULL) OR (plan_position >= 1))),
    CONSTRAINT app_game1_scheduled_games_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'purchase_open'::text, 'ready_to_start'::text, 'running'::text, 'paused'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT app_game1_scheduled_games_sub_game_index_check CHECK ((sub_game_index >= 0)),
    CONSTRAINT app_game1_scheduled_games_trafikklys_row_color_check CHECK (((trafikklys_row_color IS NULL) OR (trafikklys_row_color = ANY (ARRAY['rød'::text, 'grønn'::text, 'gul'::text]))))
);

--
-- Name: app_game1_ticket_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_ticket_assignments (
    id text NOT NULL,
    scheduled_game_id text NOT NULL,
    purchase_id text NOT NULL,
    buyer_user_id text NOT NULL,
    hall_id text NOT NULL,
    ticket_color text NOT NULL,
    ticket_size text NOT NULL,
    grid_numbers_json jsonb NOT NULL,
    sequence_in_purchase integer NOT NULL,
    markings_json jsonb DEFAULT '{"marked": []}'::jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_game1_ticket_assignments_sequence_in_purchase_check CHECK ((sequence_in_purchase >= 1)),
    CONSTRAINT app_game1_ticket_assignments_ticket_size_check CHECK ((ticket_size = ANY (ARRAY['small'::text, 'large'::text])))
);

--
-- Name: app_game1_ticket_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game1_ticket_purchases (
    id text NOT NULL,
    scheduled_game_id text NOT NULL,
    buyer_user_id text NOT NULL,
    hall_id text NOT NULL,
    ticket_spec_json jsonb NOT NULL,
    total_amount_cents bigint NOT NULL,
    payment_method text NOT NULL,
    agent_user_id text,
    idempotency_key text NOT NULL,
    purchased_at timestamp with time zone DEFAULT now() NOT NULL,
    refunded_at timestamp with time zone,
    refund_reason text,
    refunded_by_user_id text,
    refund_transaction_id text,
    CONSTRAINT app_game1_ticket_purchases_payment_method_check CHECK ((payment_method = ANY (ARRAY['digital_wallet'::text, 'cash_agent'::text, 'card_agent'::text]))),
    CONSTRAINT app_game1_ticket_purchases_total_amount_cents_check CHECK ((total_amount_cents >= 0))
);

--
-- Name: app_game2_ticket_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game2_ticket_pools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_code text NOT NULL,
    player_id uuid NOT NULL,
    game_id text NOT NULL,
    ticket_grids jsonb NOT NULL,
    purchased_indices integer[] DEFAULT '{}'::integer[] NOT NULL,
    pick_any_number integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_game2_ticket_pools_pick_any_number_range CHECK (((pick_any_number IS NULL) OR ((pick_any_number >= 1) AND (pick_any_number <= 21))))
);

--
-- Name: app_game_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game_catalog (
    id text NOT NULL,
    slug text NOT NULL,
    display_name text NOT NULL,
    description text,
    rules_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    ticket_colors_json jsonb DEFAULT '["gul", "hvit"]'::jsonb NOT NULL,
    ticket_prices_cents_json jsonb DEFAULT '{"gul": 1000, "hvit": 500}'::jsonb NOT NULL,
    prizes_cents_json jsonb NOT NULL,
    bonus_game_slug text,
    bonus_game_enabled boolean DEFAULT false NOT NULL,
    requires_jackpot_setup boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    prize_multiplier_mode text DEFAULT 'auto'::text NOT NULL
);

--
-- Name: app_game_management; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game_management (
    id text NOT NULL,
    game_type_id text NOT NULL,
    parent_id text,
    name text NOT NULL,
    ticket_type text,
    ticket_price bigint DEFAULT 0 NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone,
    status text DEFAULT 'inactive'::text NOT NULL,
    total_sold bigint DEFAULT 0 NOT NULL,
    total_earning bigint DEFAULT 0 NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    repeated_from_id text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_game_management_check CHECK (((end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT app_game_management_status_check CHECK ((status = ANY (ARRAY['active'::text, 'running'::text, 'closed'::text, 'inactive'::text]))),
    CONSTRAINT app_game_management_ticket_price_check CHECK ((ticket_price >= 0)),
    CONSTRAINT app_game_management_ticket_type_check CHECK (((ticket_type IS NULL) OR (ticket_type = ANY (ARRAY['Large'::text, 'Small'::text])))),
    CONSTRAINT app_game_management_total_earning_check CHECK ((total_earning >= 0)),
    CONSTRAINT app_game_management_total_sold_check CHECK ((total_sold >= 0))
);

--
-- Name: app_game_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game_plan (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    hall_id text,
    group_of_halls_id text,
    weekdays_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    CONSTRAINT app_game_plan_hall_or_group CHECK ((((hall_id IS NOT NULL) AND (group_of_halls_id IS NULL)) OR ((hall_id IS NULL) AND (group_of_halls_id IS NOT NULL)))),
    CONSTRAINT app_game_plan_time_window CHECK ((start_time < end_time))
);

--
-- Name: app_game_plan_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game_plan_item (
    id text NOT NULL,
    plan_id text NOT NULL,
    "position" integer NOT NULL,
    game_catalog_id text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bonus_game_override text,
    CONSTRAINT app_game_plan_item_position_check CHECK (("position" >= 1))
);

--
-- Name: app_game_plan_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game_plan_run (
    id text NOT NULL,
    plan_id text NOT NULL,
    hall_id text NOT NULL,
    business_date date NOT NULL,
    current_position integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'idle'::text NOT NULL,
    jackpot_overrides_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    master_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_game_plan_run_current_position_check CHECK ((current_position >= 1)),
    CONSTRAINT app_game_plan_run_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'running'::text, 'paused'::text, 'finished'::text])))
);

--
-- Name: app_game_settings_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game_settings_change_log (
    id text NOT NULL,
    game_slug text NOT NULL,
    changed_by_user_id text,
    changed_by_display_name text NOT NULL,
    changed_by_role text NOT NULL,
    source text NOT NULL,
    effective_from timestamp with time zone,
    payload_summary text NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_game_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_game_types (
    id text NOT NULL,
    type_slug text NOT NULL,
    name text NOT NULL,
    photo text DEFAULT ''::text NOT NULL,
    pattern boolean DEFAULT false NOT NULL,
    grid_rows integer DEFAULT 5 NOT NULL,
    grid_columns integer DEFAULT 5 NOT NULL,
    range_min integer,
    range_max integer,
    total_no_tickets integer,
    user_max_tickets integer,
    lucky_numbers_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    extra_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_game_types_check CHECK (((range_min IS NULL) OR (range_max IS NULL) OR (range_max >= range_min))),
    CONSTRAINT app_game_types_grid_columns_check CHECK ((grid_columns > 0)),
    CONSTRAINT app_game_types_grid_rows_check CHECK ((grid_rows > 0)),
    CONSTRAINT app_game_types_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text]))),
    CONSTRAINT app_game_types_total_no_tickets_check CHECK (((total_no_tickets IS NULL) OR (total_no_tickets > 0))),
    CONSTRAINT app_game_types_user_max_tickets_check CHECK (((user_max_tickets IS NULL) OR (user_max_tickets > 0)))
);

--
-- Name: app_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_games (
    slug text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    route text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    settings_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_hall_cash_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_cash_transactions (
    id text NOT NULL,
    hall_id text NOT NULL,
    agent_user_id text,
    shift_id text,
    settlement_id text,
    tx_type text NOT NULL,
    direction text NOT NULL,
    amount numeric(14,2) NOT NULL,
    previous_balance numeric(14,2) NOT NULL,
    after_balance numeric(14,2) NOT NULL,
    notes text,
    other_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_hall_cash_transactions_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT app_hall_cash_transactions_direction_check CHECK ((direction = ANY (ARRAY['CREDIT'::text, 'DEBIT'::text]))),
    CONSTRAINT app_hall_cash_transactions_tx_type_check CHECK ((tx_type = ANY (ARRAY['DAILY_BALANCE_TRANSFER'::text, 'DROP_SAFE_MOVE'::text, 'SHIFT_DIFFERENCE'::text, 'MANUAL_ADJUSTMENT'::text])))
);

--
-- Name: app_hall_cash_withdrawals_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_cash_withdrawals_daily (
    hall_id text NOT NULL,
    business_date date NOT NULL,
    total_amount_cents bigint DEFAULT 0 NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_hall_cash_withdrawals_daily_count_check CHECK ((count >= 0)),
    CONSTRAINT app_hall_cash_withdrawals_daily_total_amount_cents_check CHECK ((total_amount_cents >= 0))
);

--
-- Name: app_hall_display_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_display_tokens (
    id text NOT NULL,
    hall_id text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    token_hash text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone
);

--
-- Name: app_hall_game_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_game_config (
    hall_id text NOT NULL,
    game_slug text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    max_tickets_per_player integer DEFAULT 30 NOT NULL,
    min_round_interval_ms integer DEFAULT 30000 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_hall_game_config_max_tickets_per_player_check CHECK (((max_tickets_per_player >= 1) AND (max_tickets_per_player <= 30))),
    CONSTRAINT app_hall_game_config_min_round_interval_ms_check CHECK ((min_round_interval_ms >= 30000))
);

--
-- Name: app_hall_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_group_members (
    group_id text NOT NULL,
    hall_id text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_hall_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_groups (
    id text NOT NULL,
    name text NOT NULL,
    public_code text,
    tv_broadcast_id integer,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    legacy_group_hall_id text,
    tv_id integer,
    products_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    extra_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text,
    deleted_at timestamp with time zone,
    master_hall_id text,
    CONSTRAINT app_hall_groups_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

--
-- Name: app_hall_manual_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_manual_adjustments (
    id text NOT NULL,
    hall_id text NOT NULL,
    amount_cents bigint NOT NULL,
    category text NOT NULL,
    business_date date NOT NULL,
    note text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_hall_manual_adjustments_category_check CHECK ((category = ANY (ARRAY['BANK_DEPOSIT'::text, 'BANK_WITHDRAWAL'::text, 'CORRECTION'::text, 'REFUND'::text, 'OTHER'::text])))
);

--
-- Name: app_hall_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_products (
    hall_id text NOT NULL,
    product_id text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    added_by text
);

--
-- Name: app_hall_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hall_registrations (
    id text NOT NULL,
    user_id text NOT NULL,
    wallet_id text NOT NULL,
    hall_id text NOT NULL,
    status text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    activated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_hall_registrations_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'INACTIVE'::text, 'BLOCKED'::text])))
);

--
-- Name: app_halls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_halls (
    id text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    region text DEFAULT 'NO'::text NOT NULL,
    address text DEFAULT ''::text NOT NULL,
    organization_number text,
    settlement_account text,
    invoice_method text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hall_group_id text,
    tv_url text,
    cash_balance numeric(14,2) DEFAULT 0 NOT NULL,
    dropsafe_balance numeric(14,2) DEFAULT 0 NOT NULL,
    tv_token text DEFAULT (gen_random_uuid())::text NOT NULL,
    hall_number integer,
    tv_voice_selection text DEFAULT 'voice1'::text NOT NULL,
    is_test_hall boolean DEFAULT false NOT NULL,
    CONSTRAINT app_halls_tv_voice_selection_check CHECK ((tv_voice_selection = ANY (ARRAY['voice1'::text, 'voice2'::text, 'voice3'::text])))
);

--
-- Name: app_idempotency_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_idempotency_records (
    idempotency_key text NOT NULL,
    endpoint text NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_leaderboard_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_leaderboard_tiers (
    id text NOT NULL,
    tier_name text DEFAULT 'default'::text NOT NULL,
    place integer NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    prize_amount numeric(12,2),
    prize_description text DEFAULT ''::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    extra_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_leaderboard_tiers_place_check CHECK ((place > 0)),
    CONSTRAINT app_leaderboard_tiers_points_check CHECK ((points >= 0)),
    CONSTRAINT app_leaderboard_tiers_prize_amount_check CHECK (((prize_amount IS NULL) OR (prize_amount >= (0)::numeric)))
);

--
-- Name: app_loyalty_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_loyalty_events (
    id text NOT NULL,
    user_id text NOT NULL,
    event_type text NOT NULL,
    points_delta integer DEFAULT 0 NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_loyalty_player_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_loyalty_player_state (
    user_id text NOT NULL,
    current_tier_id text,
    lifetime_points integer DEFAULT 0 NOT NULL,
    month_points integer DEFAULT 0 NOT NULL,
    month_key text,
    tier_locked boolean DEFAULT false NOT NULL,
    last_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_loyalty_player_state_lifetime_points_check CHECK ((lifetime_points >= 0)),
    CONSTRAINT app_loyalty_player_state_month_points_check CHECK ((month_points >= 0))
);

--
-- Name: app_loyalty_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_loyalty_tiers (
    id text NOT NULL,
    name text NOT NULL,
    rank integer NOT NULL,
    min_points integer DEFAULT 0 NOT NULL,
    max_points integer,
    benefits_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_loyalty_tiers_check CHECK (((max_points IS NULL) OR (max_points > min_points))),
    CONSTRAINT app_loyalty_tiers_min_points_check CHECK ((min_points >= 0)),
    CONSTRAINT app_loyalty_tiers_rank_check CHECK ((rank > 0))
);

--
-- Name: app_machine_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_machine_tickets (
    id text NOT NULL,
    machine_name text NOT NULL,
    ticket_number text NOT NULL,
    external_ticket_id text NOT NULL,
    hall_id text NOT NULL,
    shift_id text,
    agent_user_id text NOT NULL,
    player_user_id text NOT NULL,
    room_id text,
    initial_amount_cents bigint NOT NULL,
    total_topup_cents bigint DEFAULT 0 NOT NULL,
    current_balance_cents bigint DEFAULT 0 NOT NULL,
    payout_cents bigint,
    is_closed boolean DEFAULT false NOT NULL,
    closed_at timestamp with time zone,
    closed_by_user_id text,
    void_at timestamp with time zone,
    void_by_user_id text,
    void_reason text,
    unique_transaction text NOT NULL,
    other_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_machine_tickets_initial_amount_cents_check CHECK ((initial_amount_cents >= 0)),
    CONSTRAINT app_machine_tickets_machine_name_check CHECK ((machine_name = ANY (ARRAY['METRONIA'::text, 'OK_BINGO'::text])))
);

--
-- Name: app_maintenance_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_maintenance_windows (
    id text NOT NULL,
    maintenance_start timestamp with time zone NOT NULL,
    maintenance_end timestamp with time zone NOT NULL,
    message text DEFAULT 'Systemet er under vedlikehold.'::text NOT NULL,
    show_before_minutes integer DEFAULT 60 NOT NULL,
    status text DEFAULT 'inactive'::text NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    deactivated_at timestamp with time zone,
    CONSTRAINT app_maintenance_windows_check CHECK ((maintenance_end >= maintenance_start)),
    CONSTRAINT app_maintenance_windows_show_before_minutes_check CHECK ((show_before_minutes >= 0)),
    CONSTRAINT app_maintenance_windows_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

--
-- Name: app_mini_games_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_mini_games_config (
    id text NOT NULL,
    game_type text NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_mini_games_config_game_type_check CHECK ((game_type = ANY (ARRAY['wheel'::text, 'chest'::text, 'mystery'::text, 'colordraft'::text])))
);

--
-- Name: app_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    fcm_message_id text,
    error_message text,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'failed'::text])))
);

--
-- Name: app_ops_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_ops_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    severity text NOT NULL,
    type text NOT NULL,
    hall_id text,
    message text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    acknowledged_at timestamp with time zone,
    acknowledged_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_ops_alerts_severity_check CHECK ((severity = ANY (ARRAY['INFO'::text, 'WARNING'::text, 'CRITICAL'::text])))
);

--
-- Name: app_password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_password_reset_tokens (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_patterns (
    id text NOT NULL,
    game_type_id text NOT NULL,
    game_name text NOT NULL,
    pattern_number text NOT NULL,
    name text NOT NULL,
    mask integer NOT NULL,
    claim_type text DEFAULT 'BINGO'::text NOT NULL,
    prize_percent numeric(6,3) DEFAULT 0 NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    design integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    is_wof boolean DEFAULT false NOT NULL,
    is_tchest boolean DEFAULT false NOT NULL,
    is_mys boolean DEFAULT false NOT NULL,
    is_row_pr boolean DEFAULT false NOT NULL,
    row_percentage numeric(6,3) DEFAULT 0 NOT NULL,
    is_jackpot boolean DEFAULT false NOT NULL,
    is_game_type_extra boolean DEFAULT false NOT NULL,
    is_lucky_bonus boolean DEFAULT false NOT NULL,
    pattern_place text,
    extra_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_patterns_claim_type_check CHECK ((claim_type = ANY (ARRAY['LINE'::text, 'BINGO'::text]))),
    CONSTRAINT app_patterns_design_check CHECK ((design >= 0)),
    CONSTRAINT app_patterns_mask_check CHECK (((mask >= 0) AND (mask < 33554432))),
    CONSTRAINT app_patterns_order_index_check CHECK ((order_index >= 0)),
    CONSTRAINT app_patterns_prize_percent_check CHECK (((prize_percent >= (0)::numeric) AND (prize_percent <= (100)::numeric))),
    CONSTRAINT app_patterns_row_percentage_check CHECK ((row_percentage >= (0)::numeric)),
    CONSTRAINT app_patterns_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

--
-- Name: app_physical_ticket_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_physical_ticket_batches (
    id text NOT NULL,
    hall_id text NOT NULL,
    batch_name text NOT NULL,
    range_start bigint NOT NULL,
    range_end bigint NOT NULL,
    default_price_cents bigint NOT NULL,
    game_slug text,
    assigned_game_id text,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_physical_ticket_batches_check CHECK ((range_end >= range_start)),
    CONSTRAINT app_physical_ticket_batches_default_price_cents_check CHECK ((default_price_cents >= 0)),
    CONSTRAINT app_physical_ticket_batches_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'CLOSED'::text])))
);

--
-- Name: app_physical_ticket_cashouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_physical_ticket_cashouts (
    id text NOT NULL,
    ticket_unique_id text NOT NULL,
    hall_id text NOT NULL,
    game_id text,
    payout_cents bigint NOT NULL,
    paid_by text NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    other_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT app_physical_ticket_cashouts_payout_cents_check CHECK ((payout_cents > 0))
);

--
-- Name: app_physical_ticket_pending_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_physical_ticket_pending_payouts (
    id text NOT NULL,
    ticket_id text NOT NULL,
    hall_id text NOT NULL,
    scheduled_game_id text NOT NULL,
    pattern_phase text NOT NULL,
    expected_payout_cents bigint CONSTRAINT app_physical_ticket_pending_payo_expected_payout_cents_not_null NOT NULL,
    responsible_user_id text CONSTRAINT app_physical_ticket_pending_payout_responsible_user_id_not_null NOT NULL,
    color text NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    verified_by_user_id text,
    paid_out_at timestamp with time zone,
    paid_out_by_user_id text,
    admin_approval_required boolean DEFAULT false CONSTRAINT app_physical_ticket_pending_pa_admin_approval_required_not_null NOT NULL,
    admin_approved_at timestamp with time zone,
    admin_approved_by_user_id text,
    rejected_at timestamp with time zone,
    rejected_by_user_id text,
    rejected_reason text,
    pending_for_next_agent boolean DEFAULT false CONSTRAINT app_physical_ticket_pending_pay_pending_for_next_agent_not_null NOT NULL
);

--
-- Name: app_physical_ticket_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_physical_ticket_transfers (
    id text NOT NULL,
    batch_id text NOT NULL,
    from_hall_id text NOT NULL,
    to_hall_id text NOT NULL,
    reason text NOT NULL,
    transferred_by text NOT NULL,
    transferred_at timestamp with time zone DEFAULT now() NOT NULL,
    ticket_count_at_transfer integer NOT NULL,
    CONSTRAINT app_physical_ticket_transfers_check CHECK ((from_hall_id <> to_hall_id)),
    CONSTRAINT app_physical_ticket_transfers_ticket_count_at_transfer_check CHECK ((ticket_count_at_transfer >= 0))
);

--
-- Name: app_physical_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_physical_tickets (
    id text NOT NULL,
    batch_id text NOT NULL,
    unique_id text NOT NULL,
    hall_id text NOT NULL,
    status text DEFAULT 'UNSOLD'::text NOT NULL,
    price_cents bigint,
    assigned_game_id text,
    sold_at timestamp with time zone,
    sold_by text,
    buyer_user_id text,
    voided_at timestamp with time zone,
    voided_by text,
    voided_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    numbers_json jsonb,
    pattern_won text,
    won_amount_cents bigint,
    evaluated_at timestamp with time zone,
    is_winning_distributed boolean DEFAULT false NOT NULL,
    winning_distributed_at timestamp with time zone,
    CONSTRAINT app_physical_tickets_pattern_won_check CHECK (((pattern_won IS NULL) OR (pattern_won = ANY (ARRAY['row_1'::text, 'row_2'::text, 'row_3'::text, 'row_4'::text, 'full_house'::text])))),
    CONSTRAINT app_physical_tickets_price_cents_check CHECK (((price_cents IS NULL) OR (price_cents >= 0))),
    CONSTRAINT app_physical_tickets_status_check CHECK ((status = ANY (ARRAY['UNSOLD'::text, 'SOLD'::text, 'VOIDED'::text]))),
    CONSTRAINT app_physical_tickets_won_amount_cents_check CHECK (((won_amount_cents IS NULL) OR (won_amount_cents >= 0)))
);

--
-- Name: app_player_hall_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_player_hall_status (
    user_id text NOT NULL,
    hall_id text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    reason text,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_product_cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_product_cart_items (
    cart_id text NOT NULL,
    product_id text NOT NULL,
    quantity integer NOT NULL,
    unit_price_cents bigint NOT NULL,
    line_total_cents bigint NOT NULL,
    CONSTRAINT app_product_cart_items_line_total_cents_check CHECK ((line_total_cents >= 0)),
    CONSTRAINT app_product_cart_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT app_product_cart_items_unit_price_cents_check CHECK ((unit_price_cents >= 0))
);

--
-- Name: app_product_carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_product_carts (
    id text NOT NULL,
    order_id text NOT NULL,
    agent_user_id text NOT NULL,
    hall_id text NOT NULL,
    shift_id text NOT NULL,
    user_type text NOT NULL,
    user_id text,
    username text,
    total_cents bigint NOT NULL,
    status text DEFAULT 'CART_CREATED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_product_carts_status_check CHECK ((status = ANY (ARRAY['CART_CREATED'::text, 'ORDER_PLACED'::text, 'CANCELLED'::text]))),
    CONSTRAINT app_product_carts_total_cents_check CHECK ((total_cents >= 0)),
    CONSTRAINT app_product_carts_user_type_check CHECK ((user_type = ANY (ARRAY['ONLINE'::text, 'PHYSICAL'::text])))
);

--
-- Name: app_product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_product_categories (
    id text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

--
-- Name: app_product_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_product_sales (
    id text NOT NULL,
    cart_id text NOT NULL,
    order_id text NOT NULL,
    hall_id text NOT NULL,
    shift_id text NOT NULL,
    agent_user_id text NOT NULL,
    player_user_id text,
    payment_method text NOT NULL,
    total_cents bigint NOT NULL,
    wallet_tx_id text,
    agent_tx_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_product_sales_payment_method_check CHECK ((payment_method = ANY (ARRAY['CASH'::text, 'CARD'::text, 'CUSTOMER_NUMBER'::text]))),
    CONSTRAINT app_product_sales_total_cents_check CHECK ((total_cents >= 0))
);

--
-- Name: app_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_products (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    price_cents bigint NOT NULL,
    category_id text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_products_price_cents_check CHECK ((price_cents >= 0)),
    CONSTRAINT app_products_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))
);

--
-- Name: app_regulatory_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_regulatory_ledger (
    id text NOT NULL,
    sequence bigint NOT NULL,
    event_date date NOT NULL,
    channel text NOT NULL,
    hall_id text NOT NULL,
    draw_session_id text,
    user_id text,
    transaction_type text NOT NULL,
    amount_nok numeric(12,2) NOT NULL,
    ticket_ref text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    prev_hash text,
    event_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_regulatory_ledger_channel_check CHECK ((channel = ANY (ARRAY['HALL'::text, 'INTERNET'::text]))),
    CONSTRAINT app_regulatory_ledger_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['TICKET_SALE'::text, 'PRIZE_PAYOUT'::text, 'REFUND'::text, 'ADJUSTMENT'::text])))
);

--
-- Name: app_regulatory_ledger_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_regulatory_ledger_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_regulatory_ledger_sequence_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_regulatory_ledger_sequence_seq OWNED BY public.app_regulatory_ledger.sequence;

--
-- Name: app_rg_compliance_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_compliance_ledger (
    id text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_at_ms bigint NOT NULL,
    hall_id text NOT NULL,
    game_type text NOT NULL,
    channel text NOT NULL,
    event_type text NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency text NOT NULL,
    room_code text,
    game_id text,
    claim_id text,
    player_id text,
    wallet_id text,
    source_account_id text,
    target_account_id text,
    policy_version text,
    batch_id text,
    metadata_json jsonb,
    idempotency_key text NOT NULL
);

--
-- Name: app_rg_daily_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_daily_reports (
    date_key text NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    report_json jsonb NOT NULL
);

--
-- Name: app_rg_extra_prize_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_extra_prize_entries (
    id bigint NOT NULL,
    hall_id text NOT NULL,
    link_id text NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at_ms bigint NOT NULL,
    policy_id text NOT NULL
);

--
-- Name: app_rg_extra_prize_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_rg_extra_prize_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_rg_extra_prize_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_rg_extra_prize_entries_id_seq OWNED BY public.app_rg_extra_prize_entries.id;

--
-- Name: app_rg_hall_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_hall_organizations (
    id text NOT NULL,
    hall_id text NOT NULL,
    organization_id text NOT NULL,
    organization_name text NOT NULL,
    organization_account_id text NOT NULL,
    share_percent real NOT NULL,
    game_type text,
    channel text,
    is_active integer DEFAULT 1 NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);

--
-- Name: app_rg_loss_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_loss_entries (
    id bigint NOT NULL,
    wallet_id text NOT NULL,
    hall_id text NOT NULL,
    entry_type text NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at_ms bigint NOT NULL
);

--
-- Name: app_rg_loss_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_rg_loss_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_rg_loss_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_rg_loss_entries_id_seq OWNED BY public.app_rg_loss_entries.id;

--
-- Name: app_rg_overskudd_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_overskudd_batches (
    id text NOT NULL,
    created_at text NOT NULL,
    date text NOT NULL,
    hall_id text,
    game_type text,
    channel text,
    required_minimum real NOT NULL,
    distributed_amount real NOT NULL,
    transfers_json text NOT NULL,
    allocations_json text NOT NULL
);

--
-- Name: app_rg_payout_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_payout_audit (
    id text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    claim_id text,
    game_id text,
    room_code text,
    hall_id text NOT NULL,
    policy_version text,
    amount numeric(12,2) NOT NULL,
    currency text NOT NULL,
    wallet_id text NOT NULL,
    player_id text,
    source_account_id text,
    tx_ids_json jsonb NOT NULL,
    kind text NOT NULL,
    chain_index integer NOT NULL,
    previous_hash text NOT NULL,
    event_hash text NOT NULL
);

--
-- Name: app_rg_pending_loss_limit_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_pending_loss_limit_changes (
    wallet_id text NOT NULL,
    hall_id text NOT NULL,
    daily_pending_value numeric(12,2),
    daily_effective_from_ms bigint,
    monthly_pending_value numeric(12,2),
    monthly_effective_from_ms bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_rg_personal_loss_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_personal_loss_limits (
    wallet_id text NOT NULL,
    hall_id text NOT NULL,
    daily_limit numeric(12,2) NOT NULL,
    monthly_limit numeric(12,2) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_rg_play_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_play_states (
    wallet_id text NOT NULL,
    accumulated_ms bigint DEFAULT 0 NOT NULL,
    active_from_ms bigint,
    pause_until_ms bigint,
    last_mandatory_break_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    games_played_in_session integer DEFAULT 0 NOT NULL
);

--
-- Name: app_rg_prize_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_prize_policies (
    id text NOT NULL,
    game_type text NOT NULL,
    hall_id text NOT NULL,
    link_id text NOT NULL,
    effective_from_ms bigint NOT NULL,
    single_prize_cap numeric(12,2) NOT NULL,
    daily_extra_prize_cap numeric(12,2) NOT NULL,
    created_at_ms bigint NOT NULL
);

--
-- Name: app_rg_restrictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rg_restrictions (
    wallet_id text NOT NULL,
    timed_pause_until timestamp with time zone,
    timed_pause_set_at timestamp with time zone,
    self_excluded_at timestamp with time zone,
    self_exclusion_minimum_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_risk_countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_risk_countries (
    country_code text NOT NULL,
    label text NOT NULL,
    reason text,
    added_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_risk_countries_country_code_check CHECK ((char_length(country_code) = 2))
);

--
-- Name: app_saved_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_saved_games (
    id text NOT NULL,
    game_type_id text NOT NULL,
    name text NOT NULL,
    is_admin_save boolean DEFAULT true NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_saved_games_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

--
-- Name: app_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_schedules (
    id text NOT NULL,
    schedule_name text NOT NULL,
    schedule_number text NOT NULL,
    schedule_type text DEFAULT 'Manual'::text NOT NULL,
    lucky_number_prize bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    is_admin_schedule boolean DEFAULT true NOT NULL,
    manual_start_time text DEFAULT ''::text NOT NULL,
    manual_end_time text DEFAULT ''::text NOT NULL,
    sub_games_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_schedules_lucky_number_prize_check CHECK ((lucky_number_prize >= 0)),
    CONSTRAINT app_schedules_manual_end_time_check CHECK (((manual_end_time = ''::text) OR (manual_end_time ~ '^[0-9]{2}:[0-9]{2}$'::text))),
    CONSTRAINT app_schedules_manual_start_time_check CHECK (((manual_start_time = ''::text) OR (manual_start_time ~ '^[0-9]{2}:[0-9]{2}$'::text))),
    CONSTRAINT app_schedules_schedule_type_check CHECK ((schedule_type = ANY (ARRAY['Auto'::text, 'Manual'::text]))),
    CONSTRAINT app_schedules_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

--
-- Name: app_screen_saver_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_screen_saver_images (
    id text NOT NULL,
    hall_id text,
    image_url text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    display_seconds integer DEFAULT 10 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_screen_saver_images_display_order_check CHECK ((display_order >= 0)),
    CONSTRAINT app_screen_saver_images_display_seconds_check CHECK (((display_seconds >= 1) AND (display_seconds <= 300))),
    CONSTRAINT app_screen_saver_images_image_url_check CHECK ((length(image_url) > 0))
);

--
-- Name: app_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_sessions (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    device_user_agent text,
    ip_address text,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_spill1_prize_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_spill1_prize_defaults (
    hall_id text NOT NULL,
    phase_index smallint NOT NULL,
    min_prize_cents bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    CONSTRAINT app_spill1_prize_defaults_min_prize_cents_check CHECK ((min_prize_cents >= 0)),
    CONSTRAINT app_spill1_prize_defaults_phase_index_check CHECK (((phase_index >= 1) AND (phase_index <= 5)))
);

--
-- Name: app_spill2_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_spill2_config (
    id text NOT NULL,
    opening_time_start text,
    opening_time_end text,
    min_tickets_to_start integer DEFAULT 5 NOT NULL,
    ticket_price_cents integer DEFAULT 1000 NOT NULL,
    round_pause_ms integer DEFAULT 60000 NOT NULL,
    ball_interval_ms integer DEFAULT 4000 NOT NULL,
    jackpot_number_table_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    lucky_number_enabled boolean DEFAULT false NOT NULL,
    lucky_number_prize_cents integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT app_spill2_config_ball_interval_ms_check CHECK (((ball_interval_ms >= 1000) AND (ball_interval_ms <= 10000))),
    CONSTRAINT app_spill2_config_lucky_number_prize_cents_check CHECK (((lucky_number_prize_cents IS NULL) OR (lucky_number_prize_cents >= 0))),
    CONSTRAINT app_spill2_config_min_tickets_to_start_check CHECK (((min_tickets_to_start >= 0) AND (min_tickets_to_start <= 1000))),
    CONSTRAINT app_spill2_config_round_pause_ms_check CHECK (((round_pause_ms >= 1000) AND (round_pause_ms <= 300000))),
    CONSTRAINT app_spill2_config_ticket_price_cents_check CHECK (((ticket_price_cents > 0) AND (ticket_price_cents <= 100000)))
);

--
-- Name: app_spill3_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_spill3_config (
    id text NOT NULL,
    min_tickets_to_start integer DEFAULT 20 NOT NULL,
    prize_mode text NOT NULL,
    prize_rad1_cents integer,
    prize_rad2_cents integer,
    prize_rad3_cents integer,
    prize_rad4_cents integer,
    prize_full_house_cents integer,
    prize_rad1_pct numeric(5,2),
    prize_rad2_pct numeric(5,2),
    prize_rad3_pct numeric(5,2),
    prize_rad4_pct numeric(5,2),
    prize_full_house_pct numeric(5,2),
    ticket_price_cents integer DEFAULT 500 NOT NULL,
    pause_between_rows_ms integer DEFAULT 3000 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    opening_time_start text,
    opening_time_end text,
    CONSTRAINT app_spill3_config_pause_between_rows_ms_check CHECK (((pause_between_rows_ms >= 0) AND (pause_between_rows_ms <= 60000))),
    CONSTRAINT app_spill3_config_prize_full_house_cents_check CHECK (((prize_full_house_cents IS NULL) OR (prize_full_house_cents >= 0))),
    CONSTRAINT app_spill3_config_prize_full_house_pct_check CHECK (((prize_full_house_pct IS NULL) OR ((prize_full_house_pct >= (0)::numeric) AND (prize_full_house_pct <= (100)::numeric)))),
    CONSTRAINT app_spill3_config_prize_mode_check CHECK ((prize_mode = ANY (ARRAY['fixed'::text, 'percentage'::text]))),
    CONSTRAINT app_spill3_config_prize_rad1_cents_check CHECK (((prize_rad1_cents IS NULL) OR (prize_rad1_cents >= 0))),
    CONSTRAINT app_spill3_config_prize_rad1_pct_check CHECK (((prize_rad1_pct IS NULL) OR ((prize_rad1_pct >= (0)::numeric) AND (prize_rad1_pct <= (100)::numeric)))),
    CONSTRAINT app_spill3_config_prize_rad2_cents_check CHECK (((prize_rad2_cents IS NULL) OR (prize_rad2_cents >= 0))),
    CONSTRAINT app_spill3_config_prize_rad2_pct_check CHECK (((prize_rad2_pct IS NULL) OR ((prize_rad2_pct >= (0)::numeric) AND (prize_rad2_pct <= (100)::numeric)))),
    CONSTRAINT app_spill3_config_prize_rad3_cents_check CHECK (((prize_rad3_cents IS NULL) OR (prize_rad3_cents >= 0))),
    CONSTRAINT app_spill3_config_prize_rad3_pct_check CHECK (((prize_rad3_pct IS NULL) OR ((prize_rad3_pct >= (0)::numeric) AND (prize_rad3_pct <= (100)::numeric)))),
    CONSTRAINT app_spill3_config_prize_rad4_cents_check CHECK (((prize_rad4_cents IS NULL) OR (prize_rad4_cents >= 0))),
    CONSTRAINT app_spill3_config_prize_rad4_pct_check CHECK (((prize_rad4_pct IS NULL) OR ((prize_rad4_pct >= (0)::numeric) AND (prize_rad4_pct <= (100)::numeric)))),
    CONSTRAINT app_spill3_config_ticket_price_cents_check CHECK ((ticket_price_cents > 0))
);

--
-- Name: app_static_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_static_tickets (
    id text NOT NULL,
    hall_id text NOT NULL,
    ticket_serial text NOT NULL,
    ticket_color text NOT NULL,
    ticket_type text NOT NULL,
    card_matrix jsonb NOT NULL,
    is_purchased boolean DEFAULT false NOT NULL,
    purchased_at timestamp with time zone,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    sold_by_user_id text,
    sold_from_range_id text,
    responsible_user_id text,
    sold_to_scheduled_game_id text,
    reserved_by_range_id text,
    paid_out_at timestamp with time zone,
    paid_out_amount_cents integer,
    paid_out_by_user_id text,
    CONSTRAINT app_static_tickets_ticket_color_check CHECK ((ticket_color = ANY (ARRAY['small'::text, 'large'::text, 'traffic-light'::text])))
);

--
-- Name: app_status_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_status_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    status text NOT NULL,
    impact text NOT NULL,
    affected_components jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by_user_id text,
    updated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT app_status_incidents_impact_check CHECK ((impact = ANY (ARRAY['none'::text, 'minor'::text, 'major'::text, 'critical'::text]))),
    CONSTRAINT app_status_incidents_status_check CHECK ((status = ANY (ARRAY['investigating'::text, 'identified'::text, 'monitoring'::text, 'resolved'::text])))
);

--
-- Name: app_sub_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_sub_games (
    id text NOT NULL,
    game_type_id text NOT NULL,
    game_name text NOT NULL,
    name text NOT NULL,
    sub_game_number text NOT NULL,
    pattern_rows_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    ticket_colors_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    extra_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT app_sub_games_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

--
-- Name: app_system_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_system_accounts (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    api_key_hash text NOT NULL,
    permissions_json jsonb NOT NULL,
    hall_scope_json jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    last_used_ip text,
    created_by_user_id text,
    revoked_at timestamp with time zone,
    revoked_by_user_id text,
    revoke_reason text
);

--
-- Name: app_system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_system_settings (
    key text NOT NULL,
    value_json jsonb DEFAULT 'null'::jsonb NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    updated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_terminals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_terminals (
    id text NOT NULL,
    hall_id text NOT NULL,
    terminal_code text NOT NULL,
    display_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_ticket_ranges_per_game; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_ticket_ranges_per_game (
    id text NOT NULL,
    game_id text NOT NULL,
    hall_id text NOT NULL,
    ticket_type text NOT NULL,
    initial_id integer NOT NULL,
    final_id integer,
    sold_count integer DEFAULT 0 NOT NULL,
    round_number integer DEFAULT 1 NOT NULL,
    carried_from_game_id text,
    recorded_by_user_id text,
    recorded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_ticket_ranges_per_game_check CHECK (((final_id IS NULL) OR (final_id >= initial_id))),
    CONSTRAINT app_ticket_ranges_per_game_initial_id_check CHECK ((initial_id >= 0)),
    CONSTRAINT app_ticket_ranges_per_game_round_number_check CHECK ((round_number >= 1)),
    CONSTRAINT app_ticket_ranges_per_game_sold_count_check CHECK ((sold_count >= 0)),
    CONSTRAINT app_ticket_ranges_per_game_ticket_type_check CHECK ((ticket_type = ANY (ARRAY['small_yellow'::text, 'small_white'::text, 'large_yellow'::text, 'large_white'::text, 'small_purple'::text, 'large_purple'::text, 'small_red'::text, 'large_red'::text, 'small_green'::text, 'large_green'::text, 'small_blue'::text])))
);

--
-- Name: app_unique_id_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_unique_id_transactions (
    id text NOT NULL,
    unique_id text NOT NULL,
    action_type text NOT NULL,
    amount_cents numeric(14,2) DEFAULT 0 NOT NULL,
    previous_balance numeric(14,2) DEFAULT 0 NOT NULL,
    new_balance numeric(14,2) DEFAULT 0 NOT NULL,
    payment_type text,
    agent_user_id text NOT NULL,
    game_type text,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_unique_id_transactions_action_type_check CHECK ((action_type = ANY (ARRAY['CREATE'::text, 'ADD_MONEY'::text, 'WITHDRAW'::text, 'REPRINT'::text, 'REGENERATE'::text]))),
    CONSTRAINT app_unique_id_transactions_amount_cents_check CHECK ((amount_cents >= (0)::numeric)),
    CONSTRAINT app_unique_id_transactions_payment_type_check CHECK (((payment_type IS NULL) OR (payment_type = ANY (ARRAY['CASH'::text, 'CARD'::text]))))
);

--
-- Name: app_unique_ids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_unique_ids (
    id text NOT NULL,
    hall_id text NOT NULL,
    balance_cents numeric(14,2) DEFAULT 0 NOT NULL,
    purchase_date timestamp with time zone DEFAULT now() NOT NULL,
    expiry_date timestamp with time zone NOT NULL,
    hours_validity integer NOT NULL,
    payment_type text NOT NULL,
    created_by_agent_id text NOT NULL,
    printed_at timestamp with time zone DEFAULT now() NOT NULL,
    reprinted_count integer DEFAULT 0 NOT NULL,
    last_reprinted_at timestamp with time zone,
    last_reprinted_by text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    regenerated_from_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_unique_ids_balance_cents_check CHECK ((balance_cents >= (0)::numeric)),
    CONSTRAINT app_unique_ids_hours_validity_check CHECK ((hours_validity >= 24)),
    CONSTRAINT app_unique_ids_payment_type_check CHECK ((payment_type = ANY (ARRAY['CASH'::text, 'CARD'::text]))),
    CONSTRAINT app_unique_ids_reprinted_count_check CHECK ((reprinted_count >= 0)),
    CONSTRAINT app_unique_ids_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'WITHDRAWN'::text, 'REGENERATED'::text, 'EXPIRED'::text])))
);

--
-- Name: app_user_2fa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_2fa (
    user_id text NOT NULL,
    pending_secret text,
    enabled_secret text,
    enabled_at timestamp with time zone,
    backup_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_user_2fa_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_2fa_challenges (
    id text NOT NULL,
    user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_user_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    firebase_token text NOT NULL,
    device_type text NOT NULL,
    device_label text,
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_user_devices_device_type_check CHECK ((device_type = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])))
);

--
-- Name: app_user_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_pins (
    user_id text NOT NULL,
    pin_hash text NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_user_pins_failed_attempts_check CHECK ((failed_attempts >= 0))
);

--
-- Name: app_user_profile_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_profile_settings (
    user_id text NOT NULL,
    language text DEFAULT 'nb-NO'::text NOT NULL,
    blocked_until timestamp with time zone,
    blocked_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_user_profile_settings_language_check CHECK ((language = ANY (ARRAY['nb-NO'::text, 'en-US'::text])))
);

--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    id text NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    surname text,
    password_hash text NOT NULL,
    wallet_id text NOT NULL,
    role text NOT NULL,
    kyc_status text DEFAULT 'UNVERIFIED'::text NOT NULL,
    birth_date date,
    kyc_verified_at timestamp with time zone,
    kyc_provider_ref text,
    phone text,
    compliance_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hall_id text,
    deleted_at timestamp with time zone,
    language text DEFAULT 'nb'::text NOT NULL,
    avatar_filename text,
    parent_user_id text,
    agent_status text DEFAULT 'active'::text NOT NULL,
    profile_image_url text,
    bankid_selfie_url text,
    bankid_document_url text,
    password_changed_at timestamp with time zone,
    CONSTRAINT app_users_agent_status_check CHECK ((agent_status = ANY (ARRAY['active'::text, 'inactive'::text]))),
    CONSTRAINT app_users_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'HALL_OPERATOR'::text, 'SUPPORT'::text, 'PLAYER'::text, 'AGENT'::text]))),
    CONSTRAINT chk_app_users_hall_operator_has_hall CHECK ((((role = 'HALL_OPERATOR'::text) AND (hall_id IS NOT NULL)) OR (role <> 'HALL_OPERATOR'::text)))
);

--
-- Name: app_voucher_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_voucher_redemptions (
    id text NOT NULL,
    voucher_id text NOT NULL,
    user_id text NOT NULL,
    wallet_id text NOT NULL,
    game_slug text NOT NULL,
    scheduled_game_id text,
    room_code text,
    discount_applied_cents bigint NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_voucher_redemptions_discount_applied_cents_check CHECK ((discount_applied_cents >= 0))
);

--
-- Name: app_vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_vouchers (
    id text NOT NULL,
    code text NOT NULL,
    type text NOT NULL,
    value bigint NOT NULL,
    max_uses integer,
    uses_count integer DEFAULT 0 NOT NULL,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    description text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_vouchers_check CHECK (((type <> 'PERCENTAGE'::text) OR (value <= 100))),
    CONSTRAINT app_vouchers_check1 CHECK (((valid_from IS NULL) OR (valid_to IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT app_vouchers_max_uses_check CHECK (((max_uses IS NULL) OR (max_uses > 0))),
    CONSTRAINT app_vouchers_type_check CHECK ((type = ANY (ARRAY['PERCENTAGE'::text, 'FLAT_AMOUNT'::text]))),
    CONSTRAINT app_vouchers_uses_count_check CHECK ((uses_count >= 0)),
    CONSTRAINT app_vouchers_value_check CHECK ((value >= 0))
);

--
-- Name: app_wallet_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_wallet_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_id text NOT NULL,
    amount_cents numeric(20,6) NOT NULL,
    idempotency_key text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    room_code text NOT NULL,
    game_session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    committed_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
    CONSTRAINT app_wallet_reservations_amount_positive CHECK ((amount_cents > (0)::numeric)),
    CONSTRAINT app_wallet_reservations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'released'::text, 'committed'::text, 'expired'::text])))
);

--
-- Name: app_withdraw_email_allowlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_withdraw_email_allowlist (
    id text NOT NULL,
    email text NOT NULL,
    label text,
    added_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_withdraw_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_withdraw_requests (
    id text NOT NULL,
    user_id text NOT NULL,
    wallet_id text NOT NULL,
    amount_cents bigint NOT NULL,
    hall_id text,
    submitted_by text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    rejection_reason text,
    accepted_by text,
    accepted_at timestamp with time zone,
    rejected_by text,
    rejected_at timestamp with time zone,
    wallet_transaction_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    destination_type text,
    bank_account_number text,
    bank_name text,
    account_holder text,
    exported_at timestamp with time zone,
    exported_xml_batch_id text,
    CONSTRAINT app_withdraw_requests_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT app_withdraw_requests_destination_type_check CHECK (((destination_type IS NULL) OR (destination_type = ANY (ARRAY['bank'::text, 'hall'::text])))),
    CONSTRAINT app_withdraw_requests_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'EXPORTED'::text])))
);

--
-- Name: app_xml_export_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_xml_export_batches (
    id text NOT NULL,
    agent_user_id text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    xml_file_path text NOT NULL,
    email_sent_at timestamp with time zone,
    recipient_emails text[] DEFAULT '{}'::text[] NOT NULL,
    withdraw_request_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_xml_export_batches_withdraw_request_count_check CHECK ((withdraw_request_count >= 0))
);

--
-- Name: game_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_checkpoints (
    id bigint NOT NULL,
    game_id text NOT NULL,
    room_code text NOT NULL,
    hall_id text,
    reason text NOT NULL,
    claim_id text,
    payout_amount numeric(20,6),
    transaction_ids jsonb,
    snapshot jsonb,
    players jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: game_checkpoints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_checkpoints_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: game_checkpoints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_checkpoints_id_seq OWNED BY public.game_checkpoints.id;

--
-- Name: game_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_sessions (
    game_id text NOT NULL,
    room_code text NOT NULL,
    hall_id text,
    status text DEFAULT 'RUNNING'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    draw_session_id text,
    game_slug text DEFAULT 'bingo'::text NOT NULL
);

--
-- Name: hall_game_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hall_game_schedules (
    id text NOT NULL,
    hall_id text NOT NULL,
    game_type text DEFAULT 'standard'::text NOT NULL,
    display_name text NOT NULL,
    day_of_week integer,
    start_time time without time zone NOT NULL,
    prize_description text DEFAULT ''::text NOT NULL,
    max_tickets integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    variant_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    parent_schedule_id text,
    sub_game_sequence integer,
    sub_game_number text,
    CONSTRAINT hall_game_schedules_day_of_week_check CHECK (((day_of_week IS NULL) OR ((day_of_week >= 0) AND (day_of_week <= 6)))),
    CONSTRAINT hall_game_schedules_max_tickets_check CHECK (((max_tickets >= 1) AND (max_tickets <= 30)))
);

--
-- Name: hall_schedule_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hall_schedule_log (
    id text NOT NULL,
    hall_id text NOT NULL,
    schedule_slot_id text,
    game_session_id text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    player_count integer,
    total_payout numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: pgmigrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgmigrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    run_on timestamp without time zone NOT NULL
);

--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: pgmigrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pgmigrations_id_seq OWNED BY public.pgmigrations.id;

--
-- Name: swedbank_payment_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.swedbank_payment_intents (
    id text NOT NULL,
    provider text NOT NULL,
    user_id text NOT NULL,
    wallet_id text NOT NULL,
    order_reference text NOT NULL,
    payee_reference text NOT NULL,
    swedbank_payment_order_id text NOT NULL,
    amount_minor bigint NOT NULL,
    amount_major numeric(18,2) NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    checkout_redirect_url text,
    checkout_view_url text,
    credited_transaction_id text,
    credited_at timestamp with time zone,
    last_error text,
    raw_create_response jsonb,
    raw_latest_status jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_method text,
    card_funding_type text,
    card_brand text,
    rejected_at timestamp with time zone,
    rejection_reason text,
    last_reminded_at timestamp with time zone
);

--
-- Name: wallet_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_accounts (
    id text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deposit_balance numeric(20,6) DEFAULT 0 NOT NULL,
    winnings_balance numeric(20,6) DEFAULT 0 NOT NULL,
    balance numeric(20,6) GENERATED ALWAYS AS ((deposit_balance + winnings_balance)) STORED,
    currency text DEFAULT 'NOK'::text NOT NULL,
    CONSTRAINT wallet_accounts_currency_nok_only CHECK ((currency = 'NOK'::text)),
    CONSTRAINT wallet_accounts_nonneg_deposit_nonsystem CHECK (((is_system = true) OR (deposit_balance >= (0)::numeric))),
    CONSTRAINT wallet_accounts_nonneg_winnings_nonsystem CHECK (((is_system = true) OR (winnings_balance >= (0)::numeric))),
    CONSTRAINT wallet_accounts_system_no_winnings CHECK (((is_system = false) OR (winnings_balance = (0)::numeric)))
);

--
-- Name: wallet_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_entries (
    id bigint NOT NULL,
    operation_id text NOT NULL,
    account_id text NOT NULL,
    side text NOT NULL,
    amount numeric(20,6) NOT NULL,
    transaction_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_side text DEFAULT 'deposit'::text NOT NULL,
    entry_hash text,
    previous_entry_hash text,
    currency text DEFAULT 'NOK'::text NOT NULL,
    CONSTRAINT wallet_entries_account_side_check CHECK ((account_side = ANY (ARRAY['deposit'::text, 'winnings'::text]))),
    CONSTRAINT wallet_entries_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT wallet_entries_currency_nok_only CHECK ((currency = 'NOK'::text)),
    CONSTRAINT wallet_entries_side_check CHECK ((side = ANY (ARRAY['DEBIT'::text, 'CREDIT'::text])))
);

--
-- Name: wallet_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: wallet_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallet_entries_id_seq OWNED BY public.wallet_entries.id;

--
-- Name: wallet_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_outbox (
    id bigint NOT NULL,
    operation_id text NOT NULL,
    account_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT wallet_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT wallet_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processed'::text, 'dead_letter'::text])))
);

--
-- Name: wallet_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: wallet_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallet_outbox_id_seq OWNED BY public.wallet_outbox.id;

--
-- Name: wallet_reconciliation_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_reconciliation_alerts (
    id bigint NOT NULL,
    account_id text NOT NULL,
    account_side text NOT NULL,
    expected_balance numeric(20,4) NOT NULL,
    actual_balance numeric(20,4) NOT NULL,
    divergence numeric(20,4) NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by text,
    resolution_note text,
    CONSTRAINT wallet_reconciliation_alerts_account_side_check CHECK ((account_side = ANY (ARRAY['deposit'::text, 'winnings'::text])))
);

--
-- Name: wallet_reconciliation_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_reconciliation_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: wallet_reconciliation_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallet_reconciliation_alerts_id_seq OWNED BY public.wallet_reconciliation_alerts.id;

--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id text NOT NULL,
    operation_id text NOT NULL,
    account_id text NOT NULL,
    transaction_type text NOT NULL,
    amount numeric(20,6) NOT NULL,
    reason text NOT NULL,
    related_account_id text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    currency text DEFAULT 'NOK'::text NOT NULL,
    CONSTRAINT wallet_transactions_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT wallet_transactions_currency_nok_only CHECK ((currency = 'NOK'::text))
);

--
-- Name: app_alert_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_alert_log ALTER COLUMN id SET DEFAULT nextval('public.app_alert_log_id_seq'::regclass);

--
-- Name: app_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_audit_log ALTER COLUMN id SET DEFAULT nextval('public.app_audit_log_id_seq'::regclass);

--
-- Name: app_chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_chat_messages ALTER COLUMN id SET DEFAULT nextval('public.app_chat_messages_id_seq'::regclass);

--
-- Name: app_compliance_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_compliance_outbox ALTER COLUMN id SET DEFAULT nextval('public.app_compliance_outbox_id_seq'::regclass);

--
-- Name: app_daily_regulatory_reports sequence; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_regulatory_reports ALTER COLUMN sequence SET DEFAULT nextval('public.app_daily_regulatory_reports_sequence_seq'::regclass);

--
-- Name: app_draw_session_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_events ALTER COLUMN id SET DEFAULT nextval('public.app_draw_session_events_id_seq'::regclass);

--
-- Name: app_regulatory_ledger sequence; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_regulatory_ledger ALTER COLUMN sequence SET DEFAULT nextval('public.app_regulatory_ledger_sequence_seq'::regclass);

--
-- Name: app_rg_extra_prize_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_extra_prize_entries ALTER COLUMN id SET DEFAULT nextval('public.app_rg_extra_prize_entries_id_seq'::regclass);

--
-- Name: app_rg_loss_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_loss_entries ALTER COLUMN id SET DEFAULT nextval('public.app_rg_loss_entries_id_seq'::regclass);

--
-- Name: game_checkpoints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_checkpoints ALTER COLUMN id SET DEFAULT nextval('public.game_checkpoints_id_seq'::regclass);

--
-- Name: pgmigrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations ALTER COLUMN id SET DEFAULT nextval('public.pgmigrations_id_seq'::regclass);

--
-- Name: wallet_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_entries ALTER COLUMN id SET DEFAULT nextval('public.wallet_entries_id_seq'::regclass);

--
-- Name: wallet_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_outbox ALTER COLUMN id SET DEFAULT nextval('public.wallet_outbox_id_seq'::regclass);

--
-- Name: wallet_reconciliation_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_reconciliation_alerts ALTER COLUMN id SET DEFAULT nextval('public.wallet_reconciliation_alerts_id_seq'::regclass);

--
-- Name: app_agent_halls app_agent_halls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_halls
    ADD CONSTRAINT app_agent_halls_pkey PRIMARY KEY (user_id, hall_id);

--
-- Name: app_agent_permissions app_agent_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_permissions
    ADD CONSTRAINT app_agent_permissions_pkey PRIMARY KEY (id);

--
-- Name: app_agent_settlements app_agent_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_settlements
    ADD CONSTRAINT app_agent_settlements_pkey PRIMARY KEY (id);

--
-- Name: app_agent_settlements app_agent_settlements_shift_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_settlements
    ADD CONSTRAINT app_agent_settlements_shift_id_key UNIQUE (shift_id);

--
-- Name: app_agent_shifts app_agent_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_shifts
    ADD CONSTRAINT app_agent_shifts_pkey PRIMARY KEY (id);

--
-- Name: app_agent_ticket_ranges app_agent_ticket_ranges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_ticket_ranges
    ADD CONSTRAINT app_agent_ticket_ranges_pkey PRIMARY KEY (id);

--
-- Name: app_agent_transactions app_agent_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_transactions
    ADD CONSTRAINT app_agent_transactions_pkey PRIMARY KEY (id);

--
-- Name: app_alert_log app_alert_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_alert_log
    ADD CONSTRAINT app_alert_log_pkey PRIMARY KEY (id);

--
-- Name: app_aml_red_flags app_aml_red_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_aml_red_flags
    ADD CONSTRAINT app_aml_red_flags_pkey PRIMARY KEY (id);

--
-- Name: app_aml_rules app_aml_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_aml_rules
    ADD CONSTRAINT app_aml_rules_pkey PRIMARY KEY (id);

--
-- Name: app_aml_rules app_aml_rules_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_aml_rules
    ADD CONSTRAINT app_aml_rules_slug_key UNIQUE (slug);

--
-- Name: app_anti_fraud_signals app_anti_fraud_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_anti_fraud_signals
    ADD CONSTRAINT app_anti_fraud_signals_pkey PRIMARY KEY (id);

--
-- Name: app_audit_log app_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_audit_log
    ADD CONSTRAINT app_audit_log_pkey PRIMARY KEY (id);

--
-- Name: app_blocked_ips app_blocked_ips_ip_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_blocked_ips
    ADD CONSTRAINT app_blocked_ips_ip_address_key UNIQUE (ip_address);

--
-- Name: app_blocked_ips app_blocked_ips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_blocked_ips
    ADD CONSTRAINT app_blocked_ips_pkey PRIMARY KEY (id);

--
-- Name: app_chat_messages app_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_chat_messages
    ADD CONSTRAINT app_chat_messages_pkey PRIMARY KEY (id);

--
-- Name: app_close_day_log app_close_day_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_close_day_log
    ADD CONSTRAINT app_close_day_log_pkey PRIMARY KEY (id);

--
-- Name: app_close_day_recurring_patterns app_close_day_recurring_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_close_day_recurring_patterns
    ADD CONSTRAINT app_close_day_recurring_patterns_pkey PRIMARY KEY (id);

--
-- Name: app_cms_content app_cms_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_content
    ADD CONSTRAINT app_cms_content_pkey PRIMARY KEY (slug);

--
-- Name: app_cms_content_versions app_cms_content_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_content_versions
    ADD CONSTRAINT app_cms_content_versions_pkey PRIMARY KEY (id);

--
-- Name: app_cms_content_versions app_cms_content_versions_slug_version_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_content_versions
    ADD CONSTRAINT app_cms_content_versions_slug_version_number_key UNIQUE (slug, version_number);

--
-- Name: app_cms_faq app_cms_faq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_faq
    ADD CONSTRAINT app_cms_faq_pkey PRIMARY KEY (id);

--
-- Name: app_compliance_outbox app_compliance_outbox_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_compliance_outbox
    ADD CONSTRAINT app_compliance_outbox_idempotency_key_key UNIQUE (idempotency_key);

--
-- Name: app_compliance_outbox app_compliance_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_compliance_outbox
    ADD CONSTRAINT app_compliance_outbox_pkey PRIMARY KEY (id);

--
-- Name: app_daily_regulatory_reports app_daily_regulatory_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_regulatory_reports
    ADD CONSTRAINT app_daily_regulatory_reports_pkey PRIMARY KEY (id);

--
-- Name: app_daily_regulatory_reports app_daily_regulatory_reports_report_date_hall_id_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_regulatory_reports
    ADD CONSTRAINT app_daily_regulatory_reports_report_date_hall_id_channel_key UNIQUE (report_date, hall_id, channel);

--
-- Name: app_daily_regulatory_reports app_daily_regulatory_reports_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_regulatory_reports
    ADD CONSTRAINT app_daily_regulatory_reports_sequence_key UNIQUE (sequence);

--
-- Name: app_daily_schedules app_daily_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_schedules
    ADD CONSTRAINT app_daily_schedules_pkey PRIMARY KEY (id);

--
-- Name: app_deposit_requests app_deposit_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_deposit_requests
    ADD CONSTRAINT app_deposit_requests_pkey PRIMARY KEY (id);

--
-- Name: app_draw_session_events app_draw_session_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_events
    ADD CONSTRAINT app_draw_session_events_pkey PRIMARY KEY (id);

--
-- Name: app_draw_session_halls app_draw_session_halls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_halls
    ADD CONSTRAINT app_draw_session_halls_pkey PRIMARY KEY (draw_session_id, hall_id);

--
-- Name: app_draw_session_tickets app_draw_session_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_tickets
    ADD CONSTRAINT app_draw_session_tickets_pkey PRIMARY KEY (id);

--
-- Name: app_draw_sessions app_draw_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_sessions
    ADD CONSTRAINT app_draw_sessions_pkey PRIMARY KEY (id);

--
-- Name: app_email_verify_tokens app_email_verify_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_email_verify_tokens
    ADD CONSTRAINT app_email_verify_tokens_pkey PRIMARY KEY (id);

--
-- Name: app_email_verify_tokens app_email_verify_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_email_verify_tokens
    ADD CONSTRAINT app_email_verify_tokens_token_hash_key UNIQUE (token_hash);

--
-- Name: app_game1_accumulating_pots app_game1_accumulating_pots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_accumulating_pots
    ADD CONSTRAINT app_game1_accumulating_pots_pkey PRIMARY KEY (id);

--
-- Name: app_game1_draws app_game1_draws_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_draws
    ADD CONSTRAINT app_game1_draws_pkey PRIMARY KEY (id);

--
-- Name: app_game1_draws app_game1_draws_scheduled_game_id_ball_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_draws
    ADD CONSTRAINT app_game1_draws_scheduled_game_id_ball_value_key UNIQUE (scheduled_game_id, ball_value);

--
-- Name: app_game1_draws app_game1_draws_scheduled_game_id_draw_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_draws
    ADD CONSTRAINT app_game1_draws_scheduled_game_id_draw_sequence_key UNIQUE (scheduled_game_id, draw_sequence);

--
-- Name: app_game1_game_state app_game1_game_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_game_state
    ADD CONSTRAINT app_game1_game_state_pkey PRIMARY KEY (scheduled_game_id);

--
-- Name: app_game1_hall_ready_status app_game1_hall_ready_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_hall_ready_status
    ADD CONSTRAINT app_game1_hall_ready_status_pkey PRIMARY KEY (game_id, hall_id);

--
-- Name: app_game1_jackpot_awards app_game1_jackpot_awards_idempotency_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_jackpot_awards
    ADD CONSTRAINT app_game1_jackpot_awards_idempotency_unique UNIQUE (idempotency_key);

--
-- Name: app_game1_jackpot_awards app_game1_jackpot_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_jackpot_awards
    ADD CONSTRAINT app_game1_jackpot_awards_pkey PRIMARY KEY (id);

--
-- Name: app_game1_jackpot_state app_game1_jackpot_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_jackpot_state
    ADD CONSTRAINT app_game1_jackpot_state_pkey PRIMARY KEY (hall_group_id);

--
-- Name: app_game1_master_audit app_game1_master_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_master_audit
    ADD CONSTRAINT app_game1_master_audit_pkey PRIMARY KEY (id);

--
-- Name: app_game1_master_transfer_requests app_game1_master_transfer_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_master_transfer_requests
    ADD CONSTRAINT app_game1_master_transfer_requests_pkey PRIMARY KEY (id);

--
-- Name: app_game1_mini_game_results app_game1_mini_game_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_mini_game_results
    ADD CONSTRAINT app_game1_mini_game_results_pkey PRIMARY KEY (id);

--
-- Name: app_game1_oddsen_state app_game1_oddsen_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_oddsen_state
    ADD CONSTRAINT app_game1_oddsen_state_pkey PRIMARY KEY (id);

--
-- Name: app_game1_phase_winners app_game1_phase_winners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_phase_winners
    ADD CONSTRAINT app_game1_phase_winners_pkey PRIMARY KEY (id);

--
-- Name: app_game1_phase_winners app_game1_phase_winners_scheduled_game_id_phase_assignment__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_phase_winners
    ADD CONSTRAINT app_game1_phase_winners_scheduled_game_id_phase_assignment__key UNIQUE (scheduled_game_id, phase, assignment_id);

--
-- Name: app_game1_pot_events app_game1_pot_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_pot_events
    ADD CONSTRAINT app_game1_pot_events_pkey PRIMARY KEY (id);

--
-- Name: app_game1_scheduled_games app_game1_scheduled_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_scheduled_games
    ADD CONSTRAINT app_game1_scheduled_games_pkey PRIMARY KEY (id);

--
-- Name: app_game1_ticket_assignments app_game1_ticket_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_assignments
    ADD CONSTRAINT app_game1_ticket_assignments_pkey PRIMARY KEY (id);

--
-- Name: app_game1_ticket_assignments app_game1_ticket_assignments_purchase_id_sequence_in_purcha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_assignments
    ADD CONSTRAINT app_game1_ticket_assignments_purchase_id_sequence_in_purcha_key UNIQUE (purchase_id, sequence_in_purchase);

--
-- Name: app_game1_ticket_purchases app_game1_ticket_purchases_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_purchases
    ADD CONSTRAINT app_game1_ticket_purchases_idempotency_key_key UNIQUE (idempotency_key);

--
-- Name: app_game1_ticket_purchases app_game1_ticket_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_purchases
    ADD CONSTRAINT app_game1_ticket_purchases_pkey PRIMARY KEY (id);

--
-- Name: app_game2_ticket_pools app_game2_ticket_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game2_ticket_pools
    ADD CONSTRAINT app_game2_ticket_pools_pkey PRIMARY KEY (id);

--
-- Name: app_game2_ticket_pools app_game2_ticket_pools_room_player_game_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game2_ticket_pools
    ADD CONSTRAINT app_game2_ticket_pools_room_player_game_unique UNIQUE (room_code, player_id, game_id);

--
-- Name: app_game_catalog app_game_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_catalog
    ADD CONSTRAINT app_game_catalog_pkey PRIMARY KEY (id);

--
-- Name: app_game_catalog app_game_catalog_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_catalog
    ADD CONSTRAINT app_game_catalog_slug_key UNIQUE (slug);

--
-- Name: app_game_management app_game_management_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_management
    ADD CONSTRAINT app_game_management_pkey PRIMARY KEY (id);

--
-- Name: app_game_plan_item app_game_plan_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_item
    ADD CONSTRAINT app_game_plan_item_pkey PRIMARY KEY (id);

--
-- Name: app_game_plan_item app_game_plan_item_plan_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_item
    ADD CONSTRAINT app_game_plan_item_plan_id_position_key UNIQUE (plan_id, "position");

--
-- Name: app_game_plan app_game_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan
    ADD CONSTRAINT app_game_plan_pkey PRIMARY KEY (id);

--
-- Name: app_game_plan_run app_game_plan_run_hall_id_business_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_run
    ADD CONSTRAINT app_game_plan_run_hall_id_business_date_key UNIQUE (hall_id, business_date);

--
-- Name: app_game_plan_run app_game_plan_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_run
    ADD CONSTRAINT app_game_plan_run_pkey PRIMARY KEY (id);

--
-- Name: app_game_settings_change_log app_game_settings_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_settings_change_log
    ADD CONSTRAINT app_game_settings_change_log_pkey PRIMARY KEY (id);

--
-- Name: app_game_types app_game_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_types
    ADD CONSTRAINT app_game_types_pkey PRIMARY KEY (id);

--
-- Name: app_games app_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_games
    ADD CONSTRAINT app_games_pkey PRIMARY KEY (slug);

--
-- Name: app_hall_cash_transactions app_hall_cash_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_cash_transactions
    ADD CONSTRAINT app_hall_cash_transactions_pkey PRIMARY KEY (id);

--
-- Name: app_hall_cash_withdrawals_daily app_hall_cash_withdrawals_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_cash_withdrawals_daily
    ADD CONSTRAINT app_hall_cash_withdrawals_daily_pkey PRIMARY KEY (hall_id, business_date);

--
-- Name: app_hall_display_tokens app_hall_display_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_display_tokens
    ADD CONSTRAINT app_hall_display_tokens_pkey PRIMARY KEY (id);

--
-- Name: app_hall_display_tokens app_hall_display_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_display_tokens
    ADD CONSTRAINT app_hall_display_tokens_token_hash_key UNIQUE (token_hash);

--
-- Name: app_hall_game_config app_hall_game_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_game_config
    ADD CONSTRAINT app_hall_game_config_pkey PRIMARY KEY (hall_id, game_slug);

--
-- Name: app_hall_group_members app_hall_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_group_members
    ADD CONSTRAINT app_hall_group_members_pkey PRIMARY KEY (group_id, hall_id);

--
-- Name: app_hall_groups app_hall_groups_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_groups
    ADD CONSTRAINT app_hall_groups_name_key UNIQUE (name);

--
-- Name: app_hall_groups app_hall_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_groups
    ADD CONSTRAINT app_hall_groups_pkey PRIMARY KEY (id);

--
-- Name: app_hall_groups app_hall_groups_public_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_groups
    ADD CONSTRAINT app_hall_groups_public_code_key UNIQUE (public_code);

--
-- Name: app_hall_groups app_hall_groups_tv_broadcast_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_groups
    ADD CONSTRAINT app_hall_groups_tv_broadcast_id_key UNIQUE (tv_broadcast_id);

--
-- Name: app_hall_manual_adjustments app_hall_manual_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_manual_adjustments
    ADD CONSTRAINT app_hall_manual_adjustments_pkey PRIMARY KEY (id);

--
-- Name: app_hall_products app_hall_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_products
    ADD CONSTRAINT app_hall_products_pkey PRIMARY KEY (hall_id, product_id);

--
-- Name: app_hall_registrations app_hall_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_registrations
    ADD CONSTRAINT app_hall_registrations_pkey PRIMARY KEY (id);

--
-- Name: app_hall_registrations app_hall_registrations_user_id_hall_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_registrations
    ADD CONSTRAINT app_hall_registrations_user_id_hall_id_key UNIQUE (user_id, hall_id);

--
-- Name: app_halls app_halls_hall_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_halls
    ADD CONSTRAINT app_halls_hall_number_unique UNIQUE (hall_number);

--
-- Name: app_halls app_halls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_halls
    ADD CONSTRAINT app_halls_pkey PRIMARY KEY (id);

--
-- Name: app_halls app_halls_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_halls
    ADD CONSTRAINT app_halls_slug_key UNIQUE (slug);

--
-- Name: app_idempotency_records app_idempotency_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_idempotency_records
    ADD CONSTRAINT app_idempotency_records_pkey PRIMARY KEY (idempotency_key, endpoint);

--
-- Name: app_leaderboard_tiers app_leaderboard_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_leaderboard_tiers
    ADD CONSTRAINT app_leaderboard_tiers_pkey PRIMARY KEY (id);

--
-- Name: app_loyalty_events app_loyalty_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_loyalty_events
    ADD CONSTRAINT app_loyalty_events_pkey PRIMARY KEY (id);

--
-- Name: app_loyalty_player_state app_loyalty_player_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_loyalty_player_state
    ADD CONSTRAINT app_loyalty_player_state_pkey PRIMARY KEY (user_id);

--
-- Name: app_loyalty_tiers app_loyalty_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_loyalty_tiers
    ADD CONSTRAINT app_loyalty_tiers_pkey PRIMARY KEY (id);

--
-- Name: app_machine_tickets app_machine_tickets_machine_name_ticket_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_machine_name_ticket_number_key UNIQUE (machine_name, ticket_number);

--
-- Name: app_machine_tickets app_machine_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_pkey PRIMARY KEY (id);

--
-- Name: app_machine_tickets app_machine_tickets_unique_transaction_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_unique_transaction_key UNIQUE (unique_transaction);

--
-- Name: app_maintenance_windows app_maintenance_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_maintenance_windows
    ADD CONSTRAINT app_maintenance_windows_pkey PRIMARY KEY (id);

--
-- Name: app_mini_games_config app_mini_games_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_mini_games_config
    ADD CONSTRAINT app_mini_games_config_pkey PRIMARY KEY (id);

--
-- Name: app_notifications app_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notifications
    ADD CONSTRAINT app_notifications_pkey PRIMARY KEY (id);

--
-- Name: app_ops_alerts app_ops_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_ops_alerts
    ADD CONSTRAINT app_ops_alerts_pkey PRIMARY KEY (id);

--
-- Name: app_password_reset_tokens app_password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_password_reset_tokens
    ADD CONSTRAINT app_password_reset_tokens_pkey PRIMARY KEY (id);

--
-- Name: app_password_reset_tokens app_password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_password_reset_tokens
    ADD CONSTRAINT app_password_reset_tokens_token_hash_key UNIQUE (token_hash);

--
-- Name: app_patterns app_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_patterns
    ADD CONSTRAINT app_patterns_pkey PRIMARY KEY (id);

--
-- Name: app_physical_ticket_batches app_physical_ticket_batches_hall_id_batch_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_batches
    ADD CONSTRAINT app_physical_ticket_batches_hall_id_batch_name_key UNIQUE (hall_id, batch_name);

--
-- Name: app_physical_ticket_batches app_physical_ticket_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_batches
    ADD CONSTRAINT app_physical_ticket_batches_pkey PRIMARY KEY (id);

--
-- Name: app_physical_ticket_cashouts app_physical_ticket_cashouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_cashouts
    ADD CONSTRAINT app_physical_ticket_cashouts_pkey PRIMARY KEY (id);

--
-- Name: app_physical_ticket_cashouts app_physical_ticket_cashouts_ticket_unique_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_cashouts
    ADD CONSTRAINT app_physical_ticket_cashouts_ticket_unique_id_key UNIQUE (ticket_unique_id);

--
-- Name: app_physical_ticket_pending_payouts app_physical_ticket_pending_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT app_physical_ticket_pending_payouts_pkey PRIMARY KEY (id);

--
-- Name: app_physical_ticket_transfers app_physical_ticket_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_transfers
    ADD CONSTRAINT app_physical_ticket_transfers_pkey PRIMARY KEY (id);

--
-- Name: app_physical_tickets app_physical_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_tickets
    ADD CONSTRAINT app_physical_tickets_pkey PRIMARY KEY (id);

--
-- Name: app_physical_tickets app_physical_tickets_unique_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_tickets
    ADD CONSTRAINT app_physical_tickets_unique_id_key UNIQUE (unique_id);

--
-- Name: app_player_hall_status app_player_hall_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_player_hall_status
    ADD CONSTRAINT app_player_hall_status_pkey PRIMARY KEY (user_id, hall_id);

--
-- Name: app_product_cart_items app_product_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_cart_items
    ADD CONSTRAINT app_product_cart_items_pkey PRIMARY KEY (cart_id, product_id);

--
-- Name: app_product_carts app_product_carts_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_carts
    ADD CONSTRAINT app_product_carts_order_id_key UNIQUE (order_id);

--
-- Name: app_product_carts app_product_carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_carts
    ADD CONSTRAINT app_product_carts_pkey PRIMARY KEY (id);

--
-- Name: app_product_categories app_product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_categories
    ADD CONSTRAINT app_product_categories_pkey PRIMARY KEY (id);

--
-- Name: app_product_sales app_product_sales_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_sales
    ADD CONSTRAINT app_product_sales_order_id_key UNIQUE (order_id);

--
-- Name: app_product_sales app_product_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_sales
    ADD CONSTRAINT app_product_sales_pkey PRIMARY KEY (id);

--
-- Name: app_products app_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_products
    ADD CONSTRAINT app_products_pkey PRIMARY KEY (id);

--
-- Name: app_regulatory_ledger app_regulatory_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_regulatory_ledger
    ADD CONSTRAINT app_regulatory_ledger_pkey PRIMARY KEY (id);

--
-- Name: app_regulatory_ledger app_regulatory_ledger_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_regulatory_ledger
    ADD CONSTRAINT app_regulatory_ledger_sequence_key UNIQUE (sequence);

--
-- Name: app_rg_compliance_ledger app_rg_compliance_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_compliance_ledger
    ADD CONSTRAINT app_rg_compliance_ledger_pkey PRIMARY KEY (id);

--
-- Name: app_rg_daily_reports app_rg_daily_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_daily_reports
    ADD CONSTRAINT app_rg_daily_reports_pkey PRIMARY KEY (date_key);

--
-- Name: app_rg_extra_prize_entries app_rg_extra_prize_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_extra_prize_entries
    ADD CONSTRAINT app_rg_extra_prize_entries_pkey PRIMARY KEY (id);

--
-- Name: app_rg_hall_organizations app_rg_hall_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_hall_organizations
    ADD CONSTRAINT app_rg_hall_organizations_pkey PRIMARY KEY (id);

--
-- Name: app_rg_loss_entries app_rg_loss_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_loss_entries
    ADD CONSTRAINT app_rg_loss_entries_pkey PRIMARY KEY (id);

--
-- Name: app_rg_overskudd_batches app_rg_overskudd_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_overskudd_batches
    ADD CONSTRAINT app_rg_overskudd_batches_pkey PRIMARY KEY (id);

--
-- Name: app_rg_payout_audit app_rg_payout_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_payout_audit
    ADD CONSTRAINT app_rg_payout_audit_pkey PRIMARY KEY (id);

--
-- Name: app_rg_pending_loss_limit_changes app_rg_pending_loss_limit_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_pending_loss_limit_changes
    ADD CONSTRAINT app_rg_pending_loss_limit_changes_pkey PRIMARY KEY (wallet_id, hall_id);

--
-- Name: app_rg_personal_loss_limits app_rg_personal_loss_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_personal_loss_limits
    ADD CONSTRAINT app_rg_personal_loss_limits_pkey PRIMARY KEY (wallet_id, hall_id);

--
-- Name: app_rg_play_states app_rg_play_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_play_states
    ADD CONSTRAINT app_rg_play_states_pkey PRIMARY KEY (wallet_id);

--
-- Name: app_rg_prize_policies app_rg_prize_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_prize_policies
    ADD CONSTRAINT app_rg_prize_policies_pkey PRIMARY KEY (id);

--
-- Name: app_rg_restrictions app_rg_restrictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rg_restrictions
    ADD CONSTRAINT app_rg_restrictions_pkey PRIMARY KEY (wallet_id);

--
-- Name: app_risk_countries app_risk_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_risk_countries
    ADD CONSTRAINT app_risk_countries_pkey PRIMARY KEY (country_code);

--
-- Name: app_saved_games app_saved_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_saved_games
    ADD CONSTRAINT app_saved_games_pkey PRIMARY KEY (id);

--
-- Name: app_schedules app_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_schedules
    ADD CONSTRAINT app_schedules_pkey PRIMARY KEY (id);

--
-- Name: app_schedules app_schedules_schedule_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_schedules
    ADD CONSTRAINT app_schedules_schedule_number_key UNIQUE (schedule_number);

--
-- Name: app_screen_saver_images app_screen_saver_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_screen_saver_images
    ADD CONSTRAINT app_screen_saver_images_pkey PRIMARY KEY (id);

--
-- Name: app_sessions app_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_pkey PRIMARY KEY (id);

--
-- Name: app_sessions app_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_token_hash_key UNIQUE (token_hash);

--
-- Name: app_spill1_prize_defaults app_spill1_prize_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_spill1_prize_defaults
    ADD CONSTRAINT app_spill1_prize_defaults_pkey PRIMARY KEY (hall_id, phase_index);

--
-- Name: app_spill2_config app_spill2_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_spill2_config
    ADD CONSTRAINT app_spill2_config_pkey PRIMARY KEY (id);

--
-- Name: app_spill3_config app_spill3_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_spill3_config
    ADD CONSTRAINT app_spill3_config_pkey PRIMARY KEY (id);

--
-- Name: app_static_tickets app_static_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_static_tickets
    ADD CONSTRAINT app_static_tickets_pkey PRIMARY KEY (id);

--
-- Name: app_status_incidents app_status_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_status_incidents
    ADD CONSTRAINT app_status_incidents_pkey PRIMARY KEY (id);

--
-- Name: app_sub_games app_sub_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sub_games
    ADD CONSTRAINT app_sub_games_pkey PRIMARY KEY (id);

--
-- Name: app_system_accounts app_system_accounts_api_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_system_accounts
    ADD CONSTRAINT app_system_accounts_api_key_hash_key UNIQUE (api_key_hash);

--
-- Name: app_system_accounts app_system_accounts_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_system_accounts
    ADD CONSTRAINT app_system_accounts_name_key UNIQUE (name);

--
-- Name: app_system_accounts app_system_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_system_accounts
    ADD CONSTRAINT app_system_accounts_pkey PRIMARY KEY (id);

--
-- Name: app_system_settings app_system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_system_settings
    ADD CONSTRAINT app_system_settings_pkey PRIMARY KEY (key);

--
-- Name: app_terminals app_terminals_hall_id_terminal_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_terminals
    ADD CONSTRAINT app_terminals_hall_id_terminal_code_key UNIQUE (hall_id, terminal_code);

--
-- Name: app_terminals app_terminals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_terminals
    ADD CONSTRAINT app_terminals_pkey PRIMARY KEY (id);

--
-- Name: app_ticket_ranges_per_game app_ticket_ranges_per_game_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_ticket_ranges_per_game
    ADD CONSTRAINT app_ticket_ranges_per_game_pkey PRIMARY KEY (id);

--
-- Name: app_unique_id_transactions app_unique_id_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_unique_id_transactions
    ADD CONSTRAINT app_unique_id_transactions_pkey PRIMARY KEY (id);

--
-- Name: app_unique_ids app_unique_ids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_unique_ids
    ADD CONSTRAINT app_unique_ids_pkey PRIMARY KEY (id);

--
-- Name: app_user_2fa_challenges app_user_2fa_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_2fa_challenges
    ADD CONSTRAINT app_user_2fa_challenges_pkey PRIMARY KEY (id);

--
-- Name: app_user_2fa app_user_2fa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_2fa
    ADD CONSTRAINT app_user_2fa_pkey PRIMARY KEY (user_id);

--
-- Name: app_user_devices app_user_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_devices
    ADD CONSTRAINT app_user_devices_pkey PRIMARY KEY (id);

--
-- Name: app_user_pins app_user_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_pins
    ADD CONSTRAINT app_user_pins_pkey PRIMARY KEY (user_id);

--
-- Name: app_user_profile_settings app_user_profile_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_profile_settings
    ADD CONSTRAINT app_user_profile_settings_pkey PRIMARY KEY (user_id);

--
-- Name: app_users app_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_email_key UNIQUE (email);

--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);

--
-- Name: app_users app_users_wallet_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_wallet_id_key UNIQUE (wallet_id);

--
-- Name: app_voucher_redemptions app_voucher_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_voucher_redemptions
    ADD CONSTRAINT app_voucher_redemptions_pkey PRIMARY KEY (id);

--
-- Name: app_voucher_redemptions app_voucher_redemptions_voucher_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_voucher_redemptions
    ADD CONSTRAINT app_voucher_redemptions_voucher_id_user_id_key UNIQUE (voucher_id, user_id);

--
-- Name: app_vouchers app_vouchers_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_vouchers
    ADD CONSTRAINT app_vouchers_code_key UNIQUE (code);

--
-- Name: app_vouchers app_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_vouchers
    ADD CONSTRAINT app_vouchers_pkey PRIMARY KEY (id);

--
-- Name: app_wallet_reservations app_wallet_reservations_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_wallet_reservations
    ADD CONSTRAINT app_wallet_reservations_idempotency_key_key UNIQUE (idempotency_key);

--
-- Name: app_wallet_reservations app_wallet_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_wallet_reservations
    ADD CONSTRAINT app_wallet_reservations_pkey PRIMARY KEY (id);

--
-- Name: app_withdraw_email_allowlist app_withdraw_email_allowlist_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_withdraw_email_allowlist
    ADD CONSTRAINT app_withdraw_email_allowlist_email_key UNIQUE (email);

--
-- Name: app_withdraw_email_allowlist app_withdraw_email_allowlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_withdraw_email_allowlist
    ADD CONSTRAINT app_withdraw_email_allowlist_pkey PRIMARY KEY (id);

--
-- Name: app_withdraw_requests app_withdraw_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_withdraw_requests
    ADD CONSTRAINT app_withdraw_requests_pkey PRIMARY KEY (id);

--
-- Name: app_xml_export_batches app_xml_export_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_xml_export_batches
    ADD CONSTRAINT app_xml_export_batches_pkey PRIMARY KEY (id);

--
-- Name: game_checkpoints game_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_checkpoints
    ADD CONSTRAINT game_checkpoints_pkey PRIMARY KEY (id);

--
-- Name: game_sessions game_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_pkey PRIMARY KEY (game_id);

--
-- Name: hall_game_schedules hall_game_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_game_schedules
    ADD CONSTRAINT hall_game_schedules_pkey PRIMARY KEY (id);

--
-- Name: hall_schedule_log hall_schedule_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_schedule_log
    ADD CONSTRAINT hall_schedule_log_pkey PRIMARY KEY (id);

--
-- Name: pgmigrations pgmigrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations
    ADD CONSTRAINT pgmigrations_pkey PRIMARY KEY (id);

--
-- Name: app_physical_ticket_pending_payouts pt4_unique_hall_ticket_phase; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT pt4_unique_hall_ticket_phase UNIQUE (hall_id, ticket_id, pattern_phase);

--
-- Name: swedbank_payment_intents swedbank_payment_intents_order_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swedbank_payment_intents
    ADD CONSTRAINT swedbank_payment_intents_order_reference_key UNIQUE (order_reference);

--
-- Name: swedbank_payment_intents swedbank_payment_intents_payee_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swedbank_payment_intents
    ADD CONSTRAINT swedbank_payment_intents_payee_reference_key UNIQUE (payee_reference);

--
-- Name: swedbank_payment_intents swedbank_payment_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swedbank_payment_intents
    ADD CONSTRAINT swedbank_payment_intents_pkey PRIMARY KEY (id);

--
-- Name: swedbank_payment_intents swedbank_payment_intents_swedbank_payment_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swedbank_payment_intents
    ADD CONSTRAINT swedbank_payment_intents_swedbank_payment_order_id_key UNIQUE (swedbank_payment_order_id);

--
-- Name: app_game1_accumulating_pots t1_unique_hall_pot_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_accumulating_pots
    ADD CONSTRAINT t1_unique_hall_pot_key UNIQUE (hall_id, pot_key);

--
-- Name: app_agent_permissions uq_app_agent_permissions_agent_module; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_permissions
    ADD CONSTRAINT uq_app_agent_permissions_agent_module UNIQUE (agent_user_id, module);

--
-- Name: app_user_devices uq_app_user_devices_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_devices
    ADD CONSTRAINT uq_app_user_devices_token UNIQUE (firebase_token);

--
-- Name: app_game1_mini_game_results uq_game1_mini_game_results_sg_winner; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_mini_game_results
    ADD CONSTRAINT uq_game1_mini_game_results_sg_winner UNIQUE (scheduled_game_id, winner_user_id);

--
-- Name: app_game1_oddsen_state uq_game1_oddsen_state_hall_for_game; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_oddsen_state
    ADD CONSTRAINT uq_game1_oddsen_state_hall_for_game UNIQUE (hall_id, chosen_for_game_id);

--
-- Name: app_game1_scheduled_games uq_game1_sched_daily_day_sub; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_scheduled_games
    ADD CONSTRAINT uq_game1_sched_daily_day_sub UNIQUE (daily_schedule_id, scheduled_day, sub_game_index);

--
-- Name: wallet_accounts wallet_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_accounts
    ADD CONSTRAINT wallet_accounts_pkey PRIMARY KEY (id);

--
-- Name: wallet_entries wallet_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_entries
    ADD CONSTRAINT wallet_entries_pkey PRIMARY KEY (id);

--
-- Name: wallet_outbox wallet_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_outbox
    ADD CONSTRAINT wallet_outbox_pkey PRIMARY KEY (id);

--
-- Name: wallet_reconciliation_alerts wallet_reconciliation_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_reconciliation_alerts
    ADD CONSTRAINT wallet_reconciliation_alerts_pkey PRIMARY KEY (id);

--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);

--
-- Name: idx_app_agent_halls_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_halls_hall_id ON public.app_agent_halls USING btree (hall_id);

--
-- Name: idx_app_agent_permissions_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_permissions_agent ON public.app_agent_permissions USING btree (agent_user_id);

--
-- Name: idx_app_agent_settlements_agent_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_settlements_agent_date ON public.app_agent_settlements USING btree (agent_user_id, business_date DESC);

--
-- Name: idx_app_agent_settlements_business_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_settlements_business_date ON public.app_agent_settlements USING btree (business_date DESC);

--
-- Name: idx_app_agent_settlements_hall_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_settlements_hall_date ON public.app_agent_settlements USING btree (hall_id, business_date DESC);

--
-- Name: idx_app_agent_settlements_machine_breakdown; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_settlements_machine_breakdown ON public.app_agent_settlements USING gin (machine_breakdown);

--
-- Name: idx_app_agent_shifts_hall_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_shifts_hall_active ON public.app_agent_shifts USING btree (hall_id, is_active) WHERE is_active;

--
-- Name: idx_app_agent_shifts_hall_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_shifts_hall_started ON public.app_agent_shifts USING btree (hall_id, started_at DESC);

--
-- Name: idx_app_agent_shifts_settled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_shifts_settled ON public.app_agent_shifts USING btree (settled_at) WHERE (settled_at IS NOT NULL);

--
-- Name: idx_app_agent_shifts_user_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_shifts_user_started ON public.app_agent_shifts USING btree (user_id, started_at DESC);

--
-- Name: idx_app_agent_ticket_ranges_agent_hall_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_ticket_ranges_agent_hall_open ON public.app_agent_ticket_ranges USING btree (agent_id, hall_id, registered_at DESC) WHERE (closed_at IS NULL);

--
-- Name: idx_app_agent_ticket_ranges_agent_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_ticket_ranges_agent_open ON public.app_agent_ticket_ranges USING btree (agent_id, hall_id) WHERE (closed_at IS NULL);

--
-- Name: idx_app_agent_ticket_ranges_hall_color_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_ticket_ranges_hall_color_open ON public.app_agent_ticket_ranges USING btree (hall_id, ticket_color) WHERE (closed_at IS NULL);

--
-- Name: idx_app_agent_ticket_ranges_handed_off_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_ticket_ranges_handed_off_to ON public.app_agent_ticket_ranges USING btree (handed_off_to_range_id) WHERE (handed_off_to_range_id IS NOT NULL);

--
-- Name: idx_app_agent_ticket_ranges_serials_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_ticket_ranges_serials_gin ON public.app_agent_ticket_ranges USING gin (serials);

--
-- Name: idx_app_agent_ticket_ranges_transfer_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_ticket_ranges_transfer_ready ON public.app_agent_ticket_ranges USING btree (hall_id) WHERE ((transfer_to_next_agent = true) AND (closed_at IS NULL));

--
-- Name: idx_app_agent_transactions_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_agent_transactions_idempotency ON public.app_agent_transactions USING btree (agent_user_id, player_user_id, client_request_id) WHERE (client_request_id IS NOT NULL);

--
-- Name: idx_app_agent_tx_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_tx_agent ON public.app_agent_transactions USING btree (agent_user_id, created_at DESC);

--
-- Name: idx_app_agent_tx_hall_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_tx_hall_created ON public.app_agent_transactions USING btree (hall_id, created_at DESC);

--
-- Name: idx_app_agent_tx_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_tx_player ON public.app_agent_transactions USING btree (player_user_id, created_at DESC);

--
-- Name: idx_app_agent_tx_related; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_tx_related ON public.app_agent_transactions USING btree (related_tx_id) WHERE (related_tx_id IS NOT NULL);

--
-- Name: idx_app_agent_tx_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_tx_shift ON public.app_agent_transactions USING btree (shift_id, created_at DESC);

--
-- Name: idx_app_agent_tx_shift_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_agent_tx_shift_action ON public.app_agent_transactions USING btree (shift_id, action_type, payment_method);

--
-- Name: idx_app_alert_log_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_alert_log_chain ON public.app_alert_log USING btree (id);

--
-- Name: idx_app_alert_log_game_hall_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_alert_log_game_hall_created ON public.app_alert_log USING btree (game, hall_id, created_at DESC);

--
-- Name: idx_app_alert_log_scenario_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_alert_log_scenario_created ON public.app_alert_log USING btree (scenario_key, created_at DESC);

--
-- Name: idx_app_aml_red_flags_severity_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_aml_red_flags_severity_status ON public.app_aml_red_flags USING btree (severity, status, created_at DESC);

--
-- Name: idx_app_aml_red_flags_status_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_aml_red_flags_status_open ON public.app_aml_red_flags USING btree (status, created_at DESC) WHERE (status = 'OPEN'::text);

--
-- Name: idx_app_aml_red_flags_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_aml_red_flags_user ON public.app_aml_red_flags USING btree (user_id);

--
-- Name: idx_app_anti_fraud_signals_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_anti_fraud_signals_hall ON public.app_anti_fraud_signals USING btree (hall_id, assessed_at DESC) WHERE (hall_id IS NOT NULL);

--
-- Name: idx_app_anti_fraud_signals_review_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_anti_fraud_signals_review_queue ON public.app_anti_fraud_signals USING btree (assessed_at DESC) WHERE (action_taken = ANY (ARRAY['flagged_for_review'::text, 'blocked'::text]));

--
-- Name: idx_app_anti_fraud_signals_risk_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_anti_fraud_signals_risk_level ON public.app_anti_fraud_signals USING btree (risk_level, assessed_at DESC);

--
-- Name: idx_app_anti_fraud_signals_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_anti_fraud_signals_user ON public.app_anti_fraud_signals USING btree (user_id, assessed_at DESC);

--
-- Name: idx_app_audit_log_action_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_audit_log_action_created ON public.app_audit_log USING btree (action, created_at DESC);

--
-- Name: idx_app_audit_log_actor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_audit_log_actor_created ON public.app_audit_log USING btree (actor_id, created_at DESC) WHERE (actor_id IS NOT NULL);

--
-- Name: idx_app_audit_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_audit_log_created_at ON public.app_audit_log USING btree (created_at DESC);

--
-- Name: idx_app_audit_log_resource_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_audit_log_resource_created ON public.app_audit_log USING btree (resource, resource_id, created_at DESC) WHERE (resource_id IS NOT NULL);

--
-- Name: idx_app_blocked_ips_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_blocked_ips_active ON public.app_blocked_ips USING btree (ip_address) WHERE (expires_at IS NULL);

--
-- Name: idx_app_chat_messages_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_chat_messages_active ON public.app_chat_messages USING btree (created_at DESC) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_chat_messages_hall_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_chat_messages_hall_created ON public.app_chat_messages USING btree (hall_id, created_at DESC);

--
-- Name: idx_app_chat_messages_hall_room_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_chat_messages_hall_room_created ON public.app_chat_messages USING btree (hall_id, room_code, created_at DESC);

--
-- Name: idx_app_chat_messages_room_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_chat_messages_room_created ON public.app_chat_messages USING btree (room_code, created_at DESC);

--
-- Name: idx_app_close_day_log_game_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_close_day_log_game_recent ON public.app_close_day_log USING btree (game_management_id, closed_at DESC);

--
-- Name: idx_app_close_day_log_recurring_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_close_day_log_recurring_pattern ON public.app_close_day_log USING btree (recurring_pattern_id) WHERE (recurring_pattern_id IS NOT NULL);

--
-- Name: idx_app_close_day_recurring_patterns_game_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_close_day_recurring_patterns_game_active ON public.app_close_day_recurring_patterns USING btree (game_management_id) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_cms_faq_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_cms_faq_sort_order ON public.app_cms_faq USING btree (sort_order, created_at);

--
-- Name: idx_app_compliance_outbox_dead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_compliance_outbox_dead ON public.app_compliance_outbox USING btree (status) WHERE (status = 'dead_letter'::text);

--
-- Name: idx_app_compliance_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_compliance_outbox_pending ON public.app_compliance_outbox USING btree (status, created_at) WHERE (status = 'pending'::text);

--
-- Name: idx_app_daily_regulatory_reports_date_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_daily_regulatory_reports_date_hall ON public.app_daily_regulatory_reports USING btree (report_date DESC, hall_id);

--
-- Name: idx_app_daily_regulatory_reports_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_daily_regulatory_reports_sequence ON public.app_daily_regulatory_reports USING btree (sequence);

--
-- Name: idx_app_daily_schedules_game_management; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_daily_schedules_game_management ON public.app_daily_schedules USING btree (game_management_id) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_daily_schedules_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_daily_schedules_hall ON public.app_daily_schedules USING btree (hall_id) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_daily_schedules_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_daily_schedules_start_date ON public.app_daily_schedules USING btree (start_date DESC) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_daily_schedules_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_daily_schedules_status ON public.app_daily_schedules USING btree (status) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_daily_schedules_week_days; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_daily_schedules_week_days ON public.app_daily_schedules USING btree (week_days) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_deposit_requests_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_deposit_requests_hall_id ON public.app_deposit_requests USING btree (hall_id, created_at DESC);

--
-- Name: idx_app_deposit_requests_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_deposit_requests_status_created_at ON public.app_deposit_requests USING btree (status, created_at DESC);

--
-- Name: idx_app_deposit_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_deposit_requests_user_id ON public.app_deposit_requests USING btree (user_id, created_at DESC);

--
-- Name: idx_app_draw_session_events_session_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_draw_session_events_session_chain ON public.app_draw_session_events USING btree (draw_session_id, chain_index);

--
-- Name: idx_app_draw_session_halls_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_draw_session_halls_hall_id ON public.app_draw_session_halls USING btree (hall_id, draw_session_id);

--
-- Name: idx_app_draw_session_tickets_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_draw_session_tickets_session ON public.app_draw_session_tickets USING btree (draw_session_id);

--
-- Name: idx_app_draw_session_tickets_user_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_draw_session_tickets_user_session ON public.app_draw_session_tickets USING btree (user_id, draw_session_id, created_at);

--
-- Name: idx_app_draw_sessions_coordinator_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_draw_sessions_coordinator_hall ON public.app_draw_sessions USING btree (coordinator_hall_id, created_at DESC);

--
-- Name: idx_app_draw_sessions_hall_group_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_draw_sessions_hall_group_created ON public.app_draw_sessions USING btree (hall_group_id, created_at DESC);

--
-- Name: idx_app_draw_sessions_one_active_per_group; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_draw_sessions_one_active_per_group ON public.app_draw_sessions USING btree (hall_group_id) WHERE (status <> ALL (ARRAY['COMPLETE'::text, 'CANCELLED'::text]));

--
-- Name: idx_app_email_verify_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_email_verify_tokens_expires ON public.app_email_verify_tokens USING btree (expires_at) WHERE (used_at IS NULL);

--
-- Name: idx_app_email_verify_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_email_verify_tokens_user ON public.app_email_verify_tokens USING btree (user_id) WHERE (used_at IS NULL);

--
-- Name: idx_app_game1_scheduled_games_room_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_game1_scheduled_games_room_code ON public.app_game1_scheduled_games USING btree (room_code) WHERE (room_code IS NOT NULL);

--
-- Name: idx_app_game2_ticket_pools_game_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game2_ticket_pools_game_id ON public.app_game2_ticket_pools USING btree (game_id);

--
-- Name: idx_app_game_catalog_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_catalog_slug ON public.app_game_catalog USING btree (slug) WHERE (is_active = true);

--
-- Name: idx_app_game_catalog_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_catalog_sort ON public.app_game_catalog USING btree (sort_order, display_name);

--
-- Name: idx_app_game_management_repeated_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_management_repeated_from ON public.app_game_management USING btree (repeated_from_id) WHERE (repeated_from_id IS NOT NULL);

--
-- Name: idx_app_game_management_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_management_status ON public.app_game_management USING btree (status) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_game_management_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_management_type ON public.app_game_management USING btree (game_type_id) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_game_plan_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_plan_group ON public.app_game_plan USING btree (group_of_halls_id) WHERE ((is_active = true) AND (group_of_halls_id IS NOT NULL));

--
-- Name: idx_app_game_plan_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_plan_hall ON public.app_game_plan USING btree (hall_id) WHERE ((is_active = true) AND (hall_id IS NOT NULL));

--
-- Name: idx_app_game_plan_item_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_plan_item_plan ON public.app_game_plan_item USING btree (plan_id, "position");

--
-- Name: idx_app_game_plan_run_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_plan_run_active ON public.app_game_plan_run USING btree (hall_id, business_date) WHERE (status = ANY (ARRAY['idle'::text, 'running'::text, 'paused'::text]));

--
-- Name: idx_app_game_settings_change_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_settings_change_log_created_at ON public.app_game_settings_change_log USING btree (created_at DESC);

--
-- Name: idx_app_game_settings_change_log_game_slug_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_settings_change_log_game_slug_created_at ON public.app_game_settings_change_log USING btree (game_slug, created_at DESC);

--
-- Name: idx_app_game_types_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_game_types_status ON public.app_game_types USING btree (status) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_hall_cash_tx_hall_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hall_cash_tx_hall_created ON public.app_hall_cash_transactions USING btree (hall_id, created_at DESC);

--
-- Name: idx_app_hall_cash_tx_settlement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hall_cash_tx_settlement ON public.app_hall_cash_transactions USING btree (settlement_id) WHERE (settlement_id IS NOT NULL);

--
-- Name: idx_app_hall_cash_tx_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hall_cash_tx_shift ON public.app_hall_cash_transactions USING btree (shift_id) WHERE (shift_id IS NOT NULL);

--
-- Name: idx_app_hall_game_config_game_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hall_game_config_game_slug ON public.app_hall_game_config USING btree (game_slug);

--
-- Name: idx_app_hall_group_members_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hall_group_members_group ON public.app_hall_group_members USING btree (group_id);

--
-- Name: idx_app_hall_group_members_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hall_group_members_hall ON public.app_hall_group_members USING btree (hall_id);

--
-- Name: idx_app_hall_groups_master_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hall_groups_master_hall_id ON public.app_hall_groups USING btree (master_hall_id) WHERE ((master_hall_id IS NOT NULL) AND (deleted_at IS NULL));

--
-- Name: idx_app_hall_groups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hall_groups_status ON public.app_hall_groups USING btree (status) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_halls_hall_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_halls_hall_group_id ON public.app_halls USING btree (hall_group_id) WHERE (hall_group_id IS NOT NULL);

--
-- Name: idx_app_halls_hall_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_halls_hall_number ON public.app_halls USING btree (hall_number) WHERE (hall_number IS NOT NULL);

--
-- Name: idx_app_leaderboard_tiers_place; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_leaderboard_tiers_place ON public.app_leaderboard_tiers USING btree (tier_name, place) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_leaderboard_tiers_tier_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_leaderboard_tiers_tier_active ON public.app_leaderboard_tiers USING btree (tier_name, active) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_loyalty_events_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_loyalty_events_type_time ON public.app_loyalty_events USING btree (event_type, created_at DESC);

--
-- Name: idx_app_loyalty_events_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_loyalty_events_user_time ON public.app_loyalty_events USING btree (user_id, created_at DESC);

--
-- Name: idx_app_loyalty_player_state_lifetime; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_loyalty_player_state_lifetime ON public.app_loyalty_player_state USING btree (lifetime_points DESC);

--
-- Name: idx_app_loyalty_player_state_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_loyalty_player_state_tier ON public.app_loyalty_player_state USING btree (current_tier_id) WHERE (current_tier_id IS NOT NULL);

--
-- Name: idx_app_loyalty_tiers_rank_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_loyalty_tiers_rank_active ON public.app_loyalty_tiers USING btree (rank DESC, min_points) WHERE ((deleted_at IS NULL) AND (active = true));

--
-- Name: idx_app_machine_tickets_hall_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_machine_tickets_hall_machine ON public.app_machine_tickets USING btree (hall_id, machine_name, created_at DESC);

--
-- Name: idx_app_machine_tickets_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_machine_tickets_open ON public.app_machine_tickets USING btree (machine_name, hall_id) WHERE (is_closed = false);

--
-- Name: idx_app_machine_tickets_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_machine_tickets_player ON public.app_machine_tickets USING btree (player_user_id, created_at DESC);

--
-- Name: idx_app_machine_tickets_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_machine_tickets_shift ON public.app_machine_tickets USING btree (shift_id, created_at DESC) WHERE (shift_id IS NOT NULL);

--
-- Name: idx_app_maintenance_windows_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_maintenance_windows_start ON public.app_maintenance_windows USING btree (maintenance_start DESC);

--
-- Name: idx_app_maintenance_windows_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_maintenance_windows_status ON public.app_maintenance_windows USING btree (status);

--
-- Name: idx_app_notifications_type_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_notifications_type_data ON public.app_notifications USING btree (type, created_at DESC);

--
-- Name: idx_app_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_notifications_user_created ON public.app_notifications USING btree (user_id, created_at DESC);

--
-- Name: idx_app_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_notifications_user_unread ON public.app_notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);

--
-- Name: idx_app_ops_alerts_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_ops_alerts_hall ON public.app_ops_alerts USING btree (hall_id, created_at DESC);

--
-- Name: idx_app_ops_alerts_open_per_type_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_ops_alerts_open_per_type_hall ON public.app_ops_alerts USING btree (type, COALESCE(hall_id, ''::text)) WHERE (acknowledged_at IS NULL);

--
-- Name: idx_app_ops_alerts_unack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_ops_alerts_unack ON public.app_ops_alerts USING btree (severity, created_at DESC) WHERE (acknowledged_at IS NULL);

--
-- Name: idx_app_password_reset_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_password_reset_tokens_expires ON public.app_password_reset_tokens USING btree (expires_at) WHERE (used_at IS NULL);

--
-- Name: idx_app_password_reset_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_password_reset_tokens_user ON public.app_password_reset_tokens USING btree (user_id) WHERE (used_at IS NULL);

--
-- Name: idx_app_patterns_game_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_patterns_game_type ON public.app_patterns USING btree (game_type_id) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_patterns_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_patterns_order ON public.app_patterns USING btree (game_type_id, order_index) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_patterns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_patterns_status ON public.app_patterns USING btree (status) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_physical_ticket_batches_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_physical_ticket_batches_game ON public.app_physical_ticket_batches USING btree (assigned_game_id) WHERE (assigned_game_id IS NOT NULL);

--
-- Name: idx_app_physical_ticket_batches_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_physical_ticket_batches_hall ON public.app_physical_ticket_batches USING btree (hall_id);

--
-- Name: idx_app_physical_ticket_cashouts_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_physical_ticket_cashouts_game ON public.app_physical_ticket_cashouts USING btree (game_id, paid_at DESC) WHERE (game_id IS NOT NULL);

--
-- Name: idx_app_physical_ticket_cashouts_hall_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_physical_ticket_cashouts_hall_paid_at ON public.app_physical_ticket_cashouts USING btree (hall_id, paid_at DESC);

--
-- Name: idx_app_physical_tickets_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_physical_tickets_batch ON public.app_physical_tickets USING btree (batch_id);

--
-- Name: idx_app_physical_tickets_game_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_physical_tickets_game_status ON public.app_physical_tickets USING btree (assigned_game_id, status) WHERE (assigned_game_id IS NOT NULL);

--
-- Name: idx_app_physical_tickets_hall_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_physical_tickets_hall_status ON public.app_physical_tickets USING btree (hall_id, status);

--
-- Name: idx_app_physical_tickets_undistributed_winners; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_physical_tickets_undistributed_winners ON public.app_physical_tickets USING btree (assigned_game_id) WHERE ((won_amount_cents > 0) AND (is_winning_distributed = false));

--
-- Name: idx_app_player_hall_status_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_player_hall_status_hall ON public.app_player_hall_status USING btree (hall_id) WHERE (is_active = false);

--
-- Name: idx_app_regulatory_ledger_daily; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_regulatory_ledger_daily ON public.app_regulatory_ledger USING btree (event_date, hall_id, channel);

--
-- Name: idx_app_regulatory_ledger_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_regulatory_ledger_sequence ON public.app_regulatory_ledger USING btree (sequence);

--
-- Name: idx_app_regulatory_ledger_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_regulatory_ledger_session ON public.app_regulatory_ledger USING btree (draw_session_id) WHERE (draw_session_id IS NOT NULL);

--
-- Name: idx_app_regulatory_ledger_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_regulatory_ledger_user ON public.app_regulatory_ledger USING btree (user_id, event_date DESC) WHERE (user_id IS NOT NULL);

--
-- Name: idx_app_rg_compliance_ledger_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_rg_compliance_ledger_idempotency ON public.app_rg_compliance_ledger USING btree (idempotency_key);

--
-- Name: idx_app_saved_games_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_saved_games_created_by ON public.app_saved_games USING btree (created_by) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_saved_games_game_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_saved_games_game_type ON public.app_saved_games USING btree (game_type_id) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_saved_games_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_saved_games_status ON public.app_saved_games USING btree (status) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_schedules_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_schedules_created_at ON public.app_schedules USING btree (created_at DESC) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_schedules_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_schedules_created_by ON public.app_schedules USING btree (created_by) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_schedules_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_schedules_type ON public.app_schedules USING btree (schedule_type) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_sessions_last_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_sessions_last_activity ON public.app_sessions USING btree (last_activity_at) WHERE (revoked_at IS NULL);

--
-- Name: idx_app_sessions_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_sessions_token_hash ON public.app_sessions USING btree (token_hash);

--
-- Name: idx_app_sessions_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_sessions_user_active ON public.app_sessions USING btree (user_id) WHERE (revoked_at IS NULL);

--
-- Name: idx_app_spill2_config_singleton_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_spill2_config_singleton_active ON public.app_spill2_config USING btree (active) WHERE (active = true);

--
-- Name: idx_app_spill3_config_singleton_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_spill3_config_singleton_active ON public.app_spill3_config USING btree (active) WHERE (active = true);

--
-- Name: idx_app_static_tickets_hall_color_unpurchased; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_static_tickets_hall_color_unpurchased ON public.app_static_tickets USING btree (hall_id, ticket_color) WHERE (is_purchased = false);

--
-- Name: idx_app_static_tickets_hall_serial_color; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_static_tickets_hall_serial_color ON public.app_static_tickets USING btree (hall_id, ticket_serial, ticket_color);

--
-- Name: idx_app_status_incidents_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_status_incidents_active ON public.app_status_incidents USING btree (created_at DESC) WHERE (status <> 'resolved'::text);

--
-- Name: idx_app_status_incidents_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_status_incidents_created_at ON public.app_status_incidents USING btree (created_at DESC);

--
-- Name: idx_app_sub_games_game_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_sub_games_game_type ON public.app_sub_games USING btree (game_type_id) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_sub_games_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_sub_games_status ON public.app_sub_games USING btree (status) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_system_accounts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_system_accounts_active ON public.app_system_accounts USING btree (api_key_hash) WHERE ((revoked_at IS NULL) AND (is_active = true));

--
-- Name: idx_app_system_accounts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_system_accounts_created_at ON public.app_system_accounts USING btree (created_at DESC);

--
-- Name: idx_app_system_settings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_system_settings_category ON public.app_system_settings USING btree (category);

--
-- Name: idx_app_terminals_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_terminals_hall_id ON public.app_terminals USING btree (hall_id);

--
-- Name: idx_app_unique_id_tx_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_unique_id_tx_agent ON public.app_unique_id_transactions USING btree (agent_user_id, created_at DESC);

--
-- Name: idx_app_unique_id_tx_card; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_unique_id_tx_card ON public.app_unique_id_transactions USING btree (unique_id, created_at DESC);

--
-- Name: idx_app_unique_id_tx_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_unique_id_tx_type ON public.app_unique_id_transactions USING btree (action_type, created_at DESC);

--
-- Name: idx_app_unique_ids_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_unique_ids_agent ON public.app_unique_ids USING btree (created_by_agent_id, created_at DESC);

--
-- Name: idx_app_unique_ids_hall_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_unique_ids_hall_created ON public.app_unique_ids USING btree (hall_id, created_at DESC);

--
-- Name: idx_app_unique_ids_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_unique_ids_status ON public.app_unique_ids USING btree (status, expiry_date);

--
-- Name: idx_app_user_2fa_challenges_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_2fa_challenges_expires ON public.app_user_2fa_challenges USING btree (expires_at) WHERE (consumed_at IS NULL);

--
-- Name: idx_app_user_2fa_challenges_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_2fa_challenges_user ON public.app_user_2fa_challenges USING btree (user_id) WHERE (consumed_at IS NULL);

--
-- Name: idx_app_user_devices_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_devices_last_seen ON public.app_user_devices USING btree (last_seen_at DESC);

--
-- Name: idx_app_user_devices_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_devices_user_active ON public.app_user_devices USING btree (user_id) WHERE (is_active = true);

--
-- Name: idx_app_user_pins_locked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_pins_locked ON public.app_user_pins USING btree (locked_until) WHERE (locked_until IS NOT NULL);

--
-- Name: idx_app_user_profile_settings_blocked_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_profile_settings_blocked_until ON public.app_user_profile_settings USING btree (blocked_until) WHERE (blocked_until IS NOT NULL);

--
-- Name: idx_app_users_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_users_deleted_at ON public.app_users USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

--
-- Name: idx_app_users_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_users_hall_id ON public.app_users USING btree (hall_id) WHERE (hall_id IS NOT NULL);

--
-- Name: idx_app_users_parent_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_users_parent_user_id ON public.app_users USING btree (parent_user_id) WHERE (parent_user_id IS NOT NULL);

--
-- Name: idx_app_users_password_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_users_password_changed_at ON public.app_users USING btree (password_changed_at) WHERE (deleted_at IS NULL);

--
-- Name: idx_app_users_role_agent_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_users_role_agent_status ON public.app_users USING btree (role, agent_status) WHERE (role = 'AGENT'::text);

--
-- Name: idx_app_voucher_redemptions_redeemed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_voucher_redemptions_redeemed_at ON public.app_voucher_redemptions USING btree (redeemed_at);

--
-- Name: idx_app_voucher_redemptions_user_voucher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_voucher_redemptions_user_voucher ON public.app_voucher_redemptions USING btree (user_id, voucher_id);

--
-- Name: idx_app_vouchers_active_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_vouchers_active_code ON public.app_vouchers USING btree (code) WHERE (is_active = true);

--
-- Name: idx_app_withdraw_requests_accepted_not_exported; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_withdraw_requests_accepted_not_exported ON public.app_withdraw_requests USING btree (status, destination_type, accepted_at) WHERE ((status = 'ACCEPTED'::text) AND (destination_type = 'bank'::text));

--
-- Name: idx_app_withdraw_requests_destination_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_withdraw_requests_destination_type ON public.app_withdraw_requests USING btree (destination_type, created_at DESC);

--
-- Name: idx_app_withdraw_requests_exported_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_withdraw_requests_exported_batch ON public.app_withdraw_requests USING btree (exported_xml_batch_id);

--
-- Name: idx_app_withdraw_requests_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_withdraw_requests_hall_id ON public.app_withdraw_requests USING btree (hall_id, created_at DESC);

--
-- Name: idx_app_withdraw_requests_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_withdraw_requests_status_created_at ON public.app_withdraw_requests USING btree (status, created_at DESC);

--
-- Name: idx_app_withdraw_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_withdraw_requests_user_id ON public.app_withdraw_requests USING btree (user_id, created_at DESC);

--
-- Name: idx_app_xml_export_batches_agent_generated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_xml_export_batches_agent_generated ON public.app_xml_export_batches USING btree (agent_user_id, generated_at DESC);

--
-- Name: idx_app_xml_export_batches_generated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_xml_export_batches_generated_at ON public.app_xml_export_batches USING btree (generated_at DESC);

--
-- Name: idx_cms_content_versions_slug_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cms_content_versions_slug_history ON public.app_cms_content_versions USING btree (slug, version_number DESC);

--
-- Name: idx_cms_content_versions_slug_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cms_content_versions_slug_live ON public.app_cms_content_versions USING btree (slug) WHERE (status = 'live'::text);

--
-- Name: idx_cms_content_versions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cms_content_versions_status ON public.app_cms_content_versions USING btree (status) WHERE (status = ANY (ARRAY['draft'::text, 'review'::text, 'approved'::text]));

--
-- Name: idx_game1_assignments_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_assignments_buyer ON public.app_game1_ticket_assignments USING btree (buyer_user_id, scheduled_game_id);

--
-- Name: idx_game1_assignments_scheduled_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_assignments_scheduled_game ON public.app_game1_ticket_assignments USING btree (scheduled_game_id);

--
-- Name: idx_game1_draws_game_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_draws_game_sequence ON public.app_game1_draws USING btree (scheduled_game_id, draw_sequence);

--
-- Name: idx_game1_hall_ready_game_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_hall_ready_game_ready ON public.app_game1_hall_ready_status USING btree (game_id, is_ready);

--
-- Name: idx_game1_hall_ready_hall_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_hall_ready_hall_ready ON public.app_game1_hall_ready_status USING btree (hall_id, is_ready);

--
-- Name: idx_game1_jackpot_awards_hall_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_jackpot_awards_hall_group ON public.app_game1_jackpot_awards USING btree (hall_group_id, awarded_at DESC);

--
-- Name: idx_game1_jackpot_awards_scheduled_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_jackpot_awards_scheduled_game ON public.app_game1_jackpot_awards USING btree (scheduled_game_id) WHERE (scheduled_game_id IS NOT NULL);

--
-- Name: idx_game1_master_audit_action_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_master_audit_action_created ON public.app_game1_master_audit USING btree (action, created_at);

--
-- Name: idx_game1_master_audit_actor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_master_audit_actor_created ON public.app_game1_master_audit USING btree (actor_user_id, created_at);

--
-- Name: idx_game1_master_audit_game_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_master_audit_game_created ON public.app_game1_master_audit USING btree (game_id, created_at);

--
-- Name: idx_game1_master_transfer_game_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_master_transfer_game_status ON public.app_game1_master_transfer_requests USING btree (game_id, status);

--
-- Name: idx_game1_master_transfer_valid_till_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_master_transfer_valid_till_pending ON public.app_game1_master_transfer_requests USING btree (valid_till) WHERE (status = 'pending'::text);

--
-- Name: idx_game1_mini_game_results_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_mini_game_results_open ON public.app_game1_mini_game_results USING btree (triggered_at) WHERE (completed_at IS NULL);

--
-- Name: idx_game1_mini_game_results_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_mini_game_results_scheduled ON public.app_game1_mini_game_results USING btree (scheduled_game_id);

--
-- Name: idx_game1_mini_game_results_winner_triggered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_mini_game_results_winner_triggered ON public.app_game1_mini_game_results USING btree (winner_user_id, triggered_at DESC);

--
-- Name: idx_game1_oddsen_state_for_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_oddsen_state_for_game ON public.app_game1_oddsen_state USING btree (chosen_for_game_id) WHERE (resolved_at IS NULL);

--
-- Name: idx_game1_oddsen_state_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_oddsen_state_hall ON public.app_game1_oddsen_state USING btree (hall_id, set_at DESC);

--
-- Name: idx_game1_oddsen_state_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_oddsen_state_player ON public.app_game1_oddsen_state USING btree (chosen_by_player_id, set_at DESC);

--
-- Name: idx_game1_phase_winners_game_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_phase_winners_game_phase ON public.app_game1_phase_winners USING btree (scheduled_game_id, phase);

--
-- Name: idx_game1_phase_winners_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_phase_winners_hall ON public.app_game1_phase_winners USING btree (hall_id, created_at DESC);

--
-- Name: idx_game1_phase_winners_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_phase_winners_user ON public.app_game1_phase_winners USING btree (winner_user_id, created_at DESC);

--
-- Name: idx_game1_purchases_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_purchases_buyer ON public.app_game1_ticket_purchases USING btree (buyer_user_id);

--
-- Name: idx_game1_purchases_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_purchases_hall ON public.app_game1_ticket_purchases USING btree (hall_id);

--
-- Name: idx_game1_purchases_refundable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_purchases_refundable ON public.app_game1_ticket_purchases USING btree (scheduled_game_id) WHERE (refunded_at IS NULL);

--
-- Name: idx_game1_purchases_scheduled_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_purchases_scheduled_game ON public.app_game1_ticket_purchases USING btree (scheduled_game_id);

--
-- Name: idx_game1_sched_catalog; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_sched_catalog ON public.app_game1_scheduled_games USING btree (catalog_entry_id, scheduled_day) WHERE (catalog_entry_id IS NOT NULL);

--
-- Name: idx_game1_sched_group_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_sched_group_day ON public.app_game1_scheduled_games USING btree (group_hall_id, scheduled_day);

--
-- Name: idx_game1_sched_plan_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_sched_plan_run ON public.app_game1_scheduled_games USING btree (plan_run_id) WHERE (plan_run_id IS NOT NULL);

--
-- Name: idx_game1_sched_status_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game1_sched_status_start ON public.app_game1_scheduled_games USING btree (status, scheduled_start_time);

--
-- Name: idx_game_checkpoints_game_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_checkpoints_game_id ON public.game_checkpoints USING btree (game_id);

--
-- Name: idx_game_checkpoints_room_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_checkpoints_room_code ON public.game_checkpoints USING btree (room_code);

--
-- Name: idx_game_sessions_draw_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_draw_session_id ON public.game_sessions USING btree (draw_session_id) WHERE (draw_session_id IS NOT NULL);

--
-- Name: idx_game_sessions_game_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_game_slug ON public.game_sessions USING btree (game_slug);

--
-- Name: idx_game_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_status ON public.game_sessions USING btree (status);

--
-- Name: idx_hall_game_schedules_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hall_game_schedules_hall_id ON public.hall_game_schedules USING btree (hall_id, is_active, day_of_week, start_time);

--
-- Name: idx_hall_game_schedules_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hall_game_schedules_parent ON public.hall_game_schedules USING btree (parent_schedule_id) WHERE (parent_schedule_id IS NOT NULL);

--
-- Name: idx_hall_manual_adjustments_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hall_manual_adjustments_created ON public.app_hall_manual_adjustments USING btree (created_at DESC);

--
-- Name: idx_hall_manual_adjustments_hall_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hall_manual_adjustments_hall_date ON public.app_hall_manual_adjustments USING btree (hall_id, business_date DESC);

--
-- Name: idx_hall_products_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hall_products_hall ON public.app_hall_products USING btree (hall_id) WHERE (is_active = true);

--
-- Name: idx_hall_schedule_log_hall_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hall_schedule_log_hall_id ON public.hall_schedule_log USING btree (hall_id, started_at DESC);

--
-- Name: idx_physical_ticket_transfers_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_physical_ticket_transfers_batch ON public.app_physical_ticket_transfers USING btree (batch_id, transferred_at DESC);

--
-- Name: idx_product_carts_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_carts_agent ON public.app_product_carts USING btree (agent_user_id, created_at DESC);

--
-- Name: idx_product_carts_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_carts_shift ON public.app_product_carts USING btree (shift_id, status);

--
-- Name: idx_product_categories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_categories_active ON public.app_product_categories USING btree (is_active) WHERE (deleted_at IS NULL);

--
-- Name: idx_product_sales_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_sales_hall ON public.app_product_sales USING btree (hall_id, created_at DESC);

--
-- Name: idx_product_sales_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_sales_player ON public.app_product_sales USING btree (player_user_id) WHERE (player_user_id IS NOT NULL);

--
-- Name: idx_product_sales_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_sales_shift ON public.app_product_sales USING btree (shift_id, created_at DESC);

--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.app_products USING btree (category_id) WHERE (deleted_at IS NULL);

--
-- Name: idx_products_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_status ON public.app_products USING btree (status) WHERE (deleted_at IS NULL);

--
-- Name: idx_pt4_pending_payouts_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt4_pending_payouts_game ON public.app_physical_ticket_pending_payouts USING btree (scheduled_game_id) WHERE ((paid_out_at IS NULL) AND (rejected_at IS NULL));

--
-- Name: idx_pt4_pending_payouts_next_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt4_pending_payouts_next_agent ON public.app_physical_ticket_pending_payouts USING btree (hall_id) WHERE ((pending_for_next_agent = true) AND (paid_out_at IS NULL) AND (rejected_at IS NULL));

--
-- Name: idx_pt4_pending_payouts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt4_pending_payouts_user ON public.app_physical_ticket_pending_payouts USING btree (responsible_user_id) WHERE ((paid_out_at IS NULL) AND (rejected_at IS NULL));

--
-- Name: idx_rg_extra_prizes_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_extra_prizes_scope ON public.app_rg_extra_prize_entries USING btree (hall_id, link_id, created_at_ms DESC);

--
-- Name: idx_rg_hall_organizations_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_hall_organizations_hall ON public.app_rg_hall_organizations USING btree (hall_id);

--
-- Name: idx_rg_hall_registrations_status_requested_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_hall_registrations_status_requested_at ON public.app_hall_registrations USING btree (status, requested_at);

--
-- Name: idx_rg_hall_registrations_wallet_hall_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_hall_registrations_wallet_hall_status ON public.app_hall_registrations USING btree (wallet_id, hall_id, status);

--
-- Name: idx_rg_ledger_hall_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_ledger_hall_date ON public.app_rg_compliance_ledger USING btree (hall_id, created_at_ms DESC);

--
-- Name: idx_rg_ledger_wallet_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_ledger_wallet_date ON public.app_rg_compliance_ledger USING btree (wallet_id, created_at_ms DESC);

--
-- Name: idx_rg_loss_entries_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_loss_entries_scope ON public.app_rg_loss_entries USING btree (wallet_id, hall_id, created_at_ms DESC);

--
-- Name: idx_rg_overskudd_batches_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_overskudd_batches_date ON public.app_rg_overskudd_batches USING btree (date DESC);

--
-- Name: idx_rg_prize_policies_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rg_prize_policies_scope ON public.app_rg_prize_policies USING btree (game_type, hall_id, link_id, effective_from_ms DESC);

--
-- Name: idx_screen_saver_images_hall_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_screen_saver_images_hall_active ON public.app_screen_saver_images USING btree (hall_id, is_active, display_order) WHERE (deleted_at IS NULL);

--
-- Name: idx_screen_saver_images_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_screen_saver_images_order ON public.app_screen_saver_images USING btree (hall_id, display_order) WHERE (deleted_at IS NULL);

--
-- Name: idx_static_tickets_responsible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_static_tickets_responsible ON public.app_static_tickets USING btree (responsible_user_id) WHERE (paid_out_at IS NULL);

--
-- Name: idx_static_tickets_scheduled_game_purchased; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_static_tickets_scheduled_game_purchased ON public.app_static_tickets USING btree (sold_to_scheduled_game_id) WHERE ((is_purchased = true) AND (paid_out_at IS NULL));

--
-- Name: idx_swedbank_payment_intents_payment_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_swedbank_payment_intents_payment_method ON public.swedbank_payment_intents USING btree (payment_method) WHERE (payment_method IS NOT NULL);

--
-- Name: idx_swedbank_payment_intents_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_swedbank_payment_intents_user ON public.swedbank_payment_intents USING btree (user_id, created_at DESC);

--
-- Name: idx_swedbank_payment_intents_user_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_swedbank_payment_intents_user_pending ON public.swedbank_payment_intents USING btree (user_id, created_at DESC) WHERE (status <> ALL (ARRAY['PAID'::text, 'CREDITED'::text, 'FAILED'::text, 'EXPIRED'::text, 'CANCELLED'::text]));

--
-- Name: idx_swedbank_payment_intents_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_swedbank_payment_intents_wallet ON public.swedbank_payment_intents USING btree (wallet_id, created_at DESC);

--
-- Name: idx_t1_pot_events_pot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_t1_pot_events_pot ON public.app_game1_pot_events USING btree (pot_id, created_at DESC);

--
-- Name: idx_t1_pot_events_win; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_t1_pot_events_win ON public.app_game1_pot_events USING btree (created_at DESC) WHERE (event_kind = 'win'::text);

--
-- Name: idx_t1_pots_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_t1_pots_hall ON public.app_game1_accumulating_pots USING btree (hall_id);

--
-- Name: idx_ticket_ranges_per_game_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_ranges_per_game_game ON public.app_ticket_ranges_per_game USING btree (game_id);

--
-- Name: idx_ticket_ranges_per_game_hall_type_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_ranges_per_game_hall_type_round ON public.app_ticket_ranges_per_game USING btree (hall_id, ticket_type, round_number DESC);

--
-- Name: idx_ticket_ranges_per_game_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ticket_ranges_per_game_unique ON public.app_ticket_ranges_per_game USING btree (game_id, hall_id, ticket_type);

--
-- Name: idx_wallet_entries_account_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_entries_account_created ON public.wallet_entries USING btree (account_id, created_at DESC);

--
-- Name: idx_wallet_entries_account_side; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_entries_account_side ON public.wallet_entries USING btree (account_id, account_side, created_at DESC);

--
-- Name: idx_wallet_entries_hash_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_entries_hash_chain ON public.wallet_entries USING btree (account_id, id);

--
-- Name: idx_wallet_entries_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_entries_operation ON public.wallet_entries USING btree (operation_id);

--
-- Name: idx_wallet_outbox_dead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_outbox_dead ON public.wallet_outbox USING btree (status) WHERE (status = 'dead_letter'::text);

--
-- Name: idx_wallet_outbox_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_outbox_operation ON public.wallet_outbox USING btree (operation_id);

--
-- Name: idx_wallet_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_outbox_pending ON public.wallet_outbox USING btree (status, created_at) WHERE (status = 'pending'::text);

--
-- Name: idx_wallet_reconciliation_alerts_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_reconciliation_alerts_account ON public.wallet_reconciliation_alerts USING btree (account_id, account_side, detected_at DESC);

--
-- Name: idx_wallet_reconciliation_alerts_open_per_account; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_wallet_reconciliation_alerts_open_per_account ON public.wallet_reconciliation_alerts USING btree (account_id, account_side) WHERE (resolved_at IS NULL);

--
-- Name: idx_wallet_reconciliation_alerts_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_reconciliation_alerts_unresolved ON public.wallet_reconciliation_alerts USING btree (detected_at DESC) WHERE (resolved_at IS NULL);

--
-- Name: idx_wallet_reservations_expires_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_reservations_expires_active ON public.app_wallet_reservations USING btree (expires_at) WHERE (status = 'active'::text);

--
-- Name: idx_wallet_reservations_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_reservations_room ON public.app_wallet_reservations USING btree (room_code);

--
-- Name: idx_wallet_reservations_wallet_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_reservations_wallet_active ON public.app_wallet_reservations USING btree (wallet_id) WHERE (status = 'active'::text);

--
-- Name: idx_wallet_transactions_account_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_transactions_account_created ON public.wallet_transactions USING btree (account_id, created_at DESC);

--
-- Name: idx_wallet_transactions_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_wallet_transactions_idempotency_key ON public.wallet_transactions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

--
-- Name: ix_app_halls_tv_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_app_halls_tv_token ON public.app_halls USING btree (tv_token);

--
-- Name: ix_hall_display_tokens_hall; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hall_display_tokens_hall ON public.app_hall_display_tokens USING btree (hall_id) WHERE (revoked_at IS NULL);

--
-- Name: ix_hall_display_tokens_hash_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hall_display_tokens_hash_active ON public.app_hall_display_tokens USING btree (token_hash) WHERE (revoked_at IS NULL);

--
-- Name: uniq_app_agent_halls_primary_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_app_agent_halls_primary_per_user ON public.app_agent_halls USING btree (user_id) WHERE is_primary;

--
-- Name: uniq_app_agent_shifts_active_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_app_agent_shifts_active_per_user ON public.app_agent_shifts USING btree (user_id) WHERE is_active;

--
-- Name: uniq_app_agent_tx_sale_per_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_app_agent_tx_sale_per_ticket ON public.app_agent_transactions USING btree (ticket_unique_id) WHERE ((action_type = 'TICKET_SALE'::text) AND (ticket_unique_id IS NOT NULL));

--
-- Name: uq_app_close_day_log_game_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_close_day_log_game_date ON public.app_close_day_log USING btree (game_management_id, close_date);

--
-- Name: uq_app_game_types_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_game_types_name ON public.app_game_types USING btree (name) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_game_types_type_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_game_types_type_slug ON public.app_game_types USING btree (type_slug) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_hall_groups_legacy_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_hall_groups_legacy_id ON public.app_hall_groups USING btree (legacy_group_hall_id) WHERE ((legacy_group_hall_id IS NOT NULL) AND (deleted_at IS NULL));

--
-- Name: uq_app_hall_groups_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_hall_groups_name ON public.app_hall_groups USING btree (name) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_leaderboard_tiers_tier_place; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_leaderboard_tiers_tier_place ON public.app_leaderboard_tiers USING btree (tier_name, place) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_loyalty_tiers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_loyalty_tiers_name ON public.app_loyalty_tiers USING btree (name) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_loyalty_tiers_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_loyalty_tiers_rank ON public.app_loyalty_tiers USING btree (rank) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_mini_games_config_game_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_mini_games_config_game_type ON public.app_mini_games_config USING btree (game_type);

--
-- Name: uq_app_patterns_name_per_game_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_patterns_name_per_game_type ON public.app_patterns USING btree (game_type_id, name) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_saved_games_name_per_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_saved_games_name_per_type ON public.app_saved_games USING btree (game_type_id, name) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_sub_games_name_per_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_sub_games_name_per_type ON public.app_sub_games USING btree (game_type_id, name) WHERE (deleted_at IS NULL);

--
-- Name: uq_app_sub_games_sub_game_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_app_sub_games_sub_game_number ON public.app_sub_games USING btree (sub_game_number) WHERE (deleted_at IS NULL);

--
-- Name: app_daily_regulatory_reports trg_app_daily_regulatory_reports_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_daily_regulatory_reports_no_delete BEFORE DELETE ON public.app_daily_regulatory_reports FOR EACH ROW EXECUTE FUNCTION public.app_regulatory_ledger_block_mutation();

--
-- Name: app_daily_regulatory_reports trg_app_daily_regulatory_reports_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_daily_regulatory_reports_no_truncate BEFORE TRUNCATE ON public.app_daily_regulatory_reports FOR EACH STATEMENT EXECUTE FUNCTION public.app_regulatory_ledger_block_mutation();

--
-- Name: app_daily_regulatory_reports trg_app_daily_regulatory_reports_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_daily_regulatory_reports_no_update BEFORE UPDATE ON public.app_daily_regulatory_reports FOR EACH ROW EXECUTE FUNCTION public.app_regulatory_ledger_block_mutation();

--
-- Name: app_regulatory_ledger trg_app_regulatory_ledger_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_regulatory_ledger_no_delete BEFORE DELETE ON public.app_regulatory_ledger FOR EACH ROW EXECUTE FUNCTION public.app_regulatory_ledger_block_mutation();

--
-- Name: app_regulatory_ledger trg_app_regulatory_ledger_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_regulatory_ledger_no_truncate BEFORE TRUNCATE ON public.app_regulatory_ledger FOR EACH STATEMENT EXECUTE FUNCTION public.app_regulatory_ledger_block_mutation();

--
-- Name: app_regulatory_ledger trg_app_regulatory_ledger_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_regulatory_ledger_no_update BEFORE UPDATE ON public.app_regulatory_ledger FOR EACH ROW EXECUTE FUNCTION public.app_regulatory_ledger_block_mutation();

--
-- Name: app_user_2fa trg_app_user_2fa_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_user_2fa_updated_at BEFORE UPDATE ON public.app_user_2fa FOR EACH ROW EXECUTE FUNCTION public.app_user_2fa_set_updated_at();

--
-- Name: app_user_profile_settings trg_app_user_profile_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_user_profile_settings_updated_at BEFORE UPDATE ON public.app_user_profile_settings FOR EACH ROW EXECUTE FUNCTION public.app_user_profile_settings_set_updated_at();

--
-- Name: app_agent_halls app_agent_halls_assigned_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_halls
    ADD CONSTRAINT app_agent_halls_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_agent_halls app_agent_halls_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_halls
    ADD CONSTRAINT app_agent_halls_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_agent_halls app_agent_halls_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_halls
    ADD CONSTRAINT app_agent_halls_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_agent_permissions app_agent_permissions_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_permissions
    ADD CONSTRAINT app_agent_permissions_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_agent_permissions app_agent_permissions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_permissions
    ADD CONSTRAINT app_agent_permissions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_agent_settlements app_agent_settlements_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_settlements
    ADD CONSTRAINT app_agent_settlements_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_agent_settlements app_agent_settlements_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_settlements
    ADD CONSTRAINT app_agent_settlements_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_agent_settlements app_agent_settlements_edited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_settlements
    ADD CONSTRAINT app_agent_settlements_edited_by_user_id_fkey FOREIGN KEY (edited_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_agent_settlements app_agent_settlements_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_settlements
    ADD CONSTRAINT app_agent_settlements_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_agent_settlements app_agent_settlements_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_settlements
    ADD CONSTRAINT app_agent_settlements_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.app_agent_shifts(id) ON DELETE RESTRICT;

--
-- Name: app_agent_shifts app_agent_shifts_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_shifts
    ADD CONSTRAINT app_agent_shifts_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_agent_shifts app_agent_shifts_settled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_shifts
    ADD CONSTRAINT app_agent_shifts_settled_by_user_id_fkey FOREIGN KEY (settled_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_agent_shifts app_agent_shifts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_shifts
    ADD CONSTRAINT app_agent_shifts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_agent_ticket_ranges app_agent_ticket_ranges_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_ticket_ranges
    ADD CONSTRAINT app_agent_ticket_ranges_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_agent_ticket_ranges app_agent_ticket_ranges_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_ticket_ranges
    ADD CONSTRAINT app_agent_ticket_ranges_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_agent_ticket_ranges app_agent_ticket_ranges_handed_off_to_range_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_ticket_ranges
    ADD CONSTRAINT app_agent_ticket_ranges_handed_off_to_range_id_fkey FOREIGN KEY (handed_off_to_range_id) REFERENCES public.app_agent_ticket_ranges(id) ON DELETE SET NULL;

--
-- Name: app_agent_ticket_ranges app_agent_ticket_ranges_handover_from_range_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_ticket_ranges
    ADD CONSTRAINT app_agent_ticket_ranges_handover_from_range_id_fkey FOREIGN KEY (handover_from_range_id) REFERENCES public.app_agent_ticket_ranges(id) ON DELETE SET NULL;

--
-- Name: app_agent_transactions app_agent_transactions_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_transactions
    ADD CONSTRAINT app_agent_transactions_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_agent_transactions app_agent_transactions_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_transactions
    ADD CONSTRAINT app_agent_transactions_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_agent_transactions app_agent_transactions_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_transactions
    ADD CONSTRAINT app_agent_transactions_player_user_id_fkey FOREIGN KEY (player_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_agent_transactions app_agent_transactions_related_tx_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_transactions
    ADD CONSTRAINT app_agent_transactions_related_tx_id_fkey FOREIGN KEY (related_tx_id) REFERENCES public.app_agent_transactions(id) ON DELETE SET NULL;

--
-- Name: app_agent_transactions app_agent_transactions_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_agent_transactions
    ADD CONSTRAINT app_agent_transactions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.app_agent_shifts(id) ON DELETE RESTRICT;

--
-- Name: app_aml_red_flags app_aml_red_flags_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_aml_red_flags
    ADD CONSTRAINT app_aml_red_flags_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_aml_red_flags app_aml_red_flags_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_aml_red_flags
    ADD CONSTRAINT app_aml_red_flags_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_aml_red_flags app_aml_red_flags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_aml_red_flags
    ADD CONSTRAINT app_aml_red_flags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_anti_fraud_signals app_anti_fraud_signals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_anti_fraud_signals
    ADD CONSTRAINT app_anti_fraud_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_blocked_ips app_blocked_ips_blocked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_blocked_ips
    ADD CONSTRAINT app_blocked_ips_blocked_by_fkey FOREIGN KEY (blocked_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_cms_content app_cms_content_live_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_content
    ADD CONSTRAINT app_cms_content_live_version_id_fkey FOREIGN KEY (live_version_id) REFERENCES public.app_cms_content_versions(id) ON DELETE SET NULL;

--
-- Name: app_cms_content app_cms_content_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_content
    ADD CONSTRAINT app_cms_content_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_cms_content_versions app_cms_content_versions_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_content_versions
    ADD CONSTRAINT app_cms_content_versions_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_cms_content_versions app_cms_content_versions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_content_versions
    ADD CONSTRAINT app_cms_content_versions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_cms_content_versions app_cms_content_versions_published_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_content_versions
    ADD CONSTRAINT app_cms_content_versions_published_by_user_id_fkey FOREIGN KEY (published_by_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_cms_faq app_cms_faq_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_faq
    ADD CONSTRAINT app_cms_faq_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_cms_faq app_cms_faq_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cms_faq
    ADD CONSTRAINT app_cms_faq_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_daily_regulatory_reports app_daily_regulatory_reports_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_regulatory_reports
    ADD CONSTRAINT app_daily_regulatory_reports_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_daily_regulatory_reports app_daily_regulatory_reports_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_regulatory_reports
    ADD CONSTRAINT app_daily_regulatory_reports_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_daily_schedules app_daily_schedules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_schedules
    ADD CONSTRAINT app_daily_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_daily_schedules app_daily_schedules_game_management_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_schedules
    ADD CONSTRAINT app_daily_schedules_game_management_id_fkey FOREIGN KEY (game_management_id) REFERENCES public.app_game_management(id) ON DELETE SET NULL;

--
-- Name: app_daily_schedules app_daily_schedules_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_daily_schedules
    ADD CONSTRAINT app_daily_schedules_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE SET NULL;

--
-- Name: app_deposit_requests app_deposit_requests_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_deposit_requests
    ADD CONSTRAINT app_deposit_requests_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE SET NULL;

--
-- Name: app_deposit_requests app_deposit_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_deposit_requests
    ADD CONSTRAINT app_deposit_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_draw_session_events app_draw_session_events_draw_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_events
    ADD CONSTRAINT app_draw_session_events_draw_session_id_fkey FOREIGN KEY (draw_session_id) REFERENCES public.app_draw_sessions(id) ON DELETE RESTRICT;

--
-- Name: app_draw_session_halls app_draw_session_halls_draw_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_halls
    ADD CONSTRAINT app_draw_session_halls_draw_session_id_fkey FOREIGN KEY (draw_session_id) REFERENCES public.app_draw_sessions(id) ON DELETE CASCADE;

--
-- Name: app_draw_session_halls app_draw_session_halls_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_halls
    ADD CONSTRAINT app_draw_session_halls_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_draw_session_halls app_draw_session_halls_ready_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_halls
    ADD CONSTRAINT app_draw_session_halls_ready_confirmed_by_fkey FOREIGN KEY (ready_confirmed_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_draw_session_tickets app_draw_session_tickets_draw_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_tickets
    ADD CONSTRAINT app_draw_session_tickets_draw_session_id_fkey FOREIGN KEY (draw_session_id) REFERENCES public.app_draw_sessions(id) ON DELETE RESTRICT;

--
-- Name: app_draw_session_tickets app_draw_session_tickets_draw_session_id_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_tickets
    ADD CONSTRAINT app_draw_session_tickets_draw_session_id_hall_id_fkey FOREIGN KEY (draw_session_id, hall_id) REFERENCES public.app_draw_session_halls(draw_session_id, hall_id) ON DELETE RESTRICT;

--
-- Name: app_draw_session_tickets app_draw_session_tickets_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_tickets
    ADD CONSTRAINT app_draw_session_tickets_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_draw_session_tickets app_draw_session_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_session_tickets
    ADD CONSTRAINT app_draw_session_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_draw_sessions app_draw_sessions_coordinator_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_sessions
    ADD CONSTRAINT app_draw_sessions_coordinator_hall_id_fkey FOREIGN KEY (coordinator_hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_draw_sessions app_draw_sessions_hall_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_draw_sessions
    ADD CONSTRAINT app_draw_sessions_hall_group_id_fkey FOREIGN KEY (hall_group_id) REFERENCES public.app_hall_groups(id) ON DELETE RESTRICT;

--
-- Name: app_email_verify_tokens app_email_verify_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_email_verify_tokens
    ADD CONSTRAINT app_email_verify_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_game1_accumulating_pots app_game1_accumulating_pots_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_accumulating_pots
    ADD CONSTRAINT app_game1_accumulating_pots_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game1_draws app_game1_draws_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_draws
    ADD CONSTRAINT app_game1_draws_scheduled_game_id_fkey FOREIGN KEY (scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game1_game_state app_game1_game_state_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_game_state
    ADD CONSTRAINT app_game1_game_state_scheduled_game_id_fkey FOREIGN KEY (scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game1_hall_ready_status app_game1_hall_ready_status_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_hall_ready_status
    ADD CONSTRAINT app_game1_hall_ready_status_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE CASCADE;

--
-- Name: app_game1_hall_ready_status app_game1_hall_ready_status_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_hall_ready_status
    ADD CONSTRAINT app_game1_hall_ready_status_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game1_jackpot_awards app_game1_jackpot_awards_hall_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_jackpot_awards
    ADD CONSTRAINT app_game1_jackpot_awards_hall_group_id_fkey FOREIGN KEY (hall_group_id) REFERENCES public.app_hall_groups(id) ON DELETE RESTRICT;

--
-- Name: app_game1_jackpot_state app_game1_jackpot_state_hall_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_jackpot_state
    ADD CONSTRAINT app_game1_jackpot_state_hall_group_id_fkey FOREIGN KEY (hall_group_id) REFERENCES public.app_hall_groups(id) ON DELETE RESTRICT;

--
-- Name: app_game1_master_audit app_game1_master_audit_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_master_audit
    ADD CONSTRAINT app_game1_master_audit_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game1_master_transfer_requests app_game1_master_transfer_requests_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_master_transfer_requests
    ADD CONSTRAINT app_game1_master_transfer_requests_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE CASCADE;

--
-- Name: app_game1_mini_game_results app_game1_mini_game_results_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_mini_game_results
    ADD CONSTRAINT app_game1_mini_game_results_scheduled_game_id_fkey FOREIGN KEY (scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE CASCADE;

--
-- Name: app_game1_oddsen_state app_game1_oddsen_state_chosen_for_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_oddsen_state
    ADD CONSTRAINT app_game1_oddsen_state_chosen_for_game_id_fkey FOREIGN KEY (chosen_for_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game1_oddsen_state app_game1_oddsen_state_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_oddsen_state
    ADD CONSTRAINT app_game1_oddsen_state_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game1_oddsen_state app_game1_oddsen_state_set_by_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_oddsen_state
    ADD CONSTRAINT app_game1_oddsen_state_set_by_game_id_fkey FOREIGN KEY (set_by_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game1_phase_winners app_game1_phase_winners_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_phase_winners
    ADD CONSTRAINT app_game1_phase_winners_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.app_game1_ticket_assignments(id) ON DELETE RESTRICT;

--
-- Name: app_game1_phase_winners app_game1_phase_winners_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_phase_winners
    ADD CONSTRAINT app_game1_phase_winners_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game1_phase_winners app_game1_phase_winners_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_phase_winners
    ADD CONSTRAINT app_game1_phase_winners_scheduled_game_id_fkey FOREIGN KEY (scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game1_phase_winners app_game1_phase_winners_winner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_phase_winners
    ADD CONSTRAINT app_game1_phase_winners_winner_user_id_fkey FOREIGN KEY (winner_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_game1_pot_events app_game1_pot_events_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_pot_events
    ADD CONSTRAINT app_game1_pot_events_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game1_pot_events app_game1_pot_events_pot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_pot_events
    ADD CONSTRAINT app_game1_pot_events_pot_id_fkey FOREIGN KEY (pot_id) REFERENCES public.app_game1_accumulating_pots(id) ON DELETE RESTRICT;

--
-- Name: app_game1_pot_events app_game1_pot_events_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_pot_events
    ADD CONSTRAINT app_game1_pot_events_scheduled_game_id_fkey FOREIGN KEY (scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game1_pot_events app_game1_pot_events_winner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_pot_events
    ADD CONSTRAINT app_game1_pot_events_winner_user_id_fkey FOREIGN KEY (winner_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_game1_scheduled_games app_game1_scheduled_games_catalog_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_scheduled_games
    ADD CONSTRAINT app_game1_scheduled_games_catalog_entry_id_fkey FOREIGN KEY (catalog_entry_id) REFERENCES public.app_game_catalog(id) ON DELETE SET NULL;

--
-- Name: app_game1_scheduled_games app_game1_scheduled_games_daily_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_scheduled_games
    ADD CONSTRAINT app_game1_scheduled_games_daily_schedule_id_fkey FOREIGN KEY (daily_schedule_id) REFERENCES public.app_daily_schedules(id) ON DELETE CASCADE;

--
-- Name: app_game1_scheduled_games app_game1_scheduled_games_group_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_scheduled_games
    ADD CONSTRAINT app_game1_scheduled_games_group_hall_id_fkey FOREIGN KEY (group_hall_id) REFERENCES public.app_hall_groups(id) ON DELETE CASCADE;

--
-- Name: app_game1_scheduled_games app_game1_scheduled_games_master_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_scheduled_games
    ADD CONSTRAINT app_game1_scheduled_games_master_hall_id_fkey FOREIGN KEY (master_hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game1_scheduled_games app_game1_scheduled_games_plan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_scheduled_games
    ADD CONSTRAINT app_game1_scheduled_games_plan_run_id_fkey FOREIGN KEY (plan_run_id) REFERENCES public.app_game_plan_run(id) ON DELETE SET NULL;

--
-- Name: app_game1_scheduled_games app_game1_scheduled_games_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_scheduled_games
    ADD CONSTRAINT app_game1_scheduled_games_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.app_schedules(id) ON DELETE RESTRICT;

--
-- Name: app_game1_ticket_assignments app_game1_ticket_assignments_buyer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_assignments
    ADD CONSTRAINT app_game1_ticket_assignments_buyer_user_id_fkey FOREIGN KEY (buyer_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_game1_ticket_assignments app_game1_ticket_assignments_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_assignments
    ADD CONSTRAINT app_game1_ticket_assignments_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game1_ticket_assignments app_game1_ticket_assignments_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_assignments
    ADD CONSTRAINT app_game1_ticket_assignments_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.app_game1_ticket_purchases(id) ON DELETE RESTRICT;

--
-- Name: app_game1_ticket_assignments app_game1_ticket_assignments_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_assignments
    ADD CONSTRAINT app_game1_ticket_assignments_scheduled_game_id_fkey FOREIGN KEY (scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game1_ticket_purchases app_game1_ticket_purchases_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_purchases
    ADD CONSTRAINT app_game1_ticket_purchases_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_game1_ticket_purchases app_game1_ticket_purchases_buyer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_purchases
    ADD CONSTRAINT app_game1_ticket_purchases_buyer_user_id_fkey FOREIGN KEY (buyer_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_game1_ticket_purchases app_game1_ticket_purchases_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_purchases
    ADD CONSTRAINT app_game1_ticket_purchases_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game1_ticket_purchases app_game1_ticket_purchases_refunded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_purchases
    ADD CONSTRAINT app_game1_ticket_purchases_refunded_by_user_id_fkey FOREIGN KEY (refunded_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_game1_ticket_purchases app_game1_ticket_purchases_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game1_ticket_purchases
    ADD CONSTRAINT app_game1_ticket_purchases_scheduled_game_id_fkey FOREIGN KEY (scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_game_catalog app_game_catalog_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_catalog
    ADD CONSTRAINT app_game_catalog_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_game_management app_game_management_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_management
    ADD CONSTRAINT app_game_management_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_game_management app_game_management_repeated_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_management
    ADD CONSTRAINT app_game_management_repeated_from_id_fkey FOREIGN KEY (repeated_from_id) REFERENCES public.app_game_management(id) ON DELETE SET NULL;

--
-- Name: app_game_plan app_game_plan_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan
    ADD CONSTRAINT app_game_plan_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_game_plan app_game_plan_group_of_halls_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan
    ADD CONSTRAINT app_game_plan_group_of_halls_id_fkey FOREIGN KEY (group_of_halls_id) REFERENCES public.app_hall_groups(id) ON DELETE CASCADE;

--
-- Name: app_game_plan app_game_plan_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan
    ADD CONSTRAINT app_game_plan_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_game_plan_item app_game_plan_item_game_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_item
    ADD CONSTRAINT app_game_plan_item_game_catalog_id_fkey FOREIGN KEY (game_catalog_id) REFERENCES public.app_game_catalog(id) ON DELETE RESTRICT;

--
-- Name: app_game_plan_item app_game_plan_item_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_item
    ADD CONSTRAINT app_game_plan_item_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.app_game_plan(id) ON DELETE CASCADE;

--
-- Name: app_game_plan_run app_game_plan_run_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_run
    ADD CONSTRAINT app_game_plan_run_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_game_plan_run app_game_plan_run_master_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_run
    ADD CONSTRAINT app_game_plan_run_master_user_id_fkey FOREIGN KEY (master_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_game_plan_run app_game_plan_run_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_plan_run
    ADD CONSTRAINT app_game_plan_run_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.app_game_plan(id) ON DELETE CASCADE;

--
-- Name: app_game_settings_change_log app_game_settings_change_log_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_settings_change_log
    ADD CONSTRAINT app_game_settings_change_log_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_game_settings_change_log app_game_settings_change_log_game_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_settings_change_log
    ADD CONSTRAINT app_game_settings_change_log_game_slug_fkey FOREIGN KEY (game_slug) REFERENCES public.app_games(slug) ON DELETE CASCADE;

--
-- Name: app_game_types app_game_types_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_game_types
    ADD CONSTRAINT app_game_types_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_hall_cash_transactions app_hall_cash_transactions_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_cash_transactions
    ADD CONSTRAINT app_hall_cash_transactions_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_hall_cash_transactions app_hall_cash_transactions_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_cash_transactions
    ADD CONSTRAINT app_hall_cash_transactions_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_hall_cash_transactions app_hall_cash_transactions_settlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_cash_transactions
    ADD CONSTRAINT app_hall_cash_transactions_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.app_agent_settlements(id) ON DELETE SET NULL;

--
-- Name: app_hall_cash_transactions app_hall_cash_transactions_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_cash_transactions
    ADD CONSTRAINT app_hall_cash_transactions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.app_agent_shifts(id) ON DELETE SET NULL;

--
-- Name: app_hall_display_tokens app_hall_display_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_display_tokens
    ADD CONSTRAINT app_hall_display_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_hall_display_tokens app_hall_display_tokens_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_display_tokens
    ADD CONSTRAINT app_hall_display_tokens_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_hall_game_config app_hall_game_config_game_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_game_config
    ADD CONSTRAINT app_hall_game_config_game_slug_fkey FOREIGN KEY (game_slug) REFERENCES public.app_games(slug) ON DELETE CASCADE;

--
-- Name: app_hall_game_config app_hall_game_config_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_game_config
    ADD CONSTRAINT app_hall_game_config_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_hall_group_members app_hall_group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_group_members
    ADD CONSTRAINT app_hall_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.app_hall_groups(id) ON DELETE CASCADE;

--
-- Name: app_hall_group_members app_hall_group_members_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_group_members
    ADD CONSTRAINT app_hall_group_members_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_hall_groups app_hall_groups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_groups
    ADD CONSTRAINT app_hall_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_hall_groups app_hall_groups_master_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_groups
    ADD CONSTRAINT app_hall_groups_master_hall_id_fkey FOREIGN KEY (master_hall_id) REFERENCES public.app_halls(id) ON DELETE SET NULL;

--
-- Name: app_hall_manual_adjustments app_hall_manual_adjustments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_manual_adjustments
    ADD CONSTRAINT app_hall_manual_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_hall_manual_adjustments app_hall_manual_adjustments_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_manual_adjustments
    ADD CONSTRAINT app_hall_manual_adjustments_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_hall_products app_hall_products_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_products
    ADD CONSTRAINT app_hall_products_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_hall_products app_hall_products_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_products
    ADD CONSTRAINT app_hall_products_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_hall_products app_hall_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_products
    ADD CONSTRAINT app_hall_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.app_products(id) ON DELETE CASCADE;

--
-- Name: app_hall_registrations app_hall_registrations_activated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_registrations
    ADD CONSTRAINT app_hall_registrations_activated_by_user_id_fkey FOREIGN KEY (activated_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_hall_registrations app_hall_registrations_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_registrations
    ADD CONSTRAINT app_hall_registrations_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_hall_registrations app_hall_registrations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hall_registrations
    ADD CONSTRAINT app_hall_registrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_halls app_halls_hall_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_halls
    ADD CONSTRAINT app_halls_hall_group_id_fkey FOREIGN KEY (hall_group_id) REFERENCES public.app_hall_groups(id) ON DELETE SET NULL;

--
-- Name: app_leaderboard_tiers app_leaderboard_tiers_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_leaderboard_tiers
    ADD CONSTRAINT app_leaderboard_tiers_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_loyalty_events app_loyalty_events_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_loyalty_events
    ADD CONSTRAINT app_loyalty_events_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_loyalty_events app_loyalty_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_loyalty_events
    ADD CONSTRAINT app_loyalty_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_loyalty_player_state app_loyalty_player_state_current_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_loyalty_player_state
    ADD CONSTRAINT app_loyalty_player_state_current_tier_id_fkey FOREIGN KEY (current_tier_id) REFERENCES public.app_loyalty_tiers(id) ON DELETE SET NULL;

--
-- Name: app_loyalty_player_state app_loyalty_player_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_loyalty_player_state
    ADD CONSTRAINT app_loyalty_player_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_loyalty_tiers app_loyalty_tiers_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_loyalty_tiers
    ADD CONSTRAINT app_loyalty_tiers_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_machine_tickets app_machine_tickets_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_machine_tickets app_machine_tickets_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_machine_tickets app_machine_tickets_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_machine_tickets app_machine_tickets_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_player_user_id_fkey FOREIGN KEY (player_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_machine_tickets app_machine_tickets_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.app_agent_shifts(id) ON DELETE SET NULL;

--
-- Name: app_machine_tickets app_machine_tickets_void_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_machine_tickets
    ADD CONSTRAINT app_machine_tickets_void_by_user_id_fkey FOREIGN KEY (void_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_maintenance_windows app_maintenance_windows_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_maintenance_windows
    ADD CONSTRAINT app_maintenance_windows_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_mini_games_config app_mini_games_config_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_mini_games_config
    ADD CONSTRAINT app_mini_games_config_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_notifications app_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notifications
    ADD CONSTRAINT app_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_password_reset_tokens app_password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_password_reset_tokens
    ADD CONSTRAINT app_password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_patterns app_patterns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_patterns
    ADD CONSTRAINT app_patterns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_ticket_batches app_physical_ticket_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_batches
    ADD CONSTRAINT app_physical_ticket_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_ticket_batches app_physical_ticket_batches_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_batches
    ADD CONSTRAINT app_physical_ticket_batches_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_cashouts app_physical_ticket_cashouts_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_cashouts
    ADD CONSTRAINT app_physical_ticket_cashouts_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_cashouts app_physical_ticket_cashouts_paid_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_cashouts
    ADD CONSTRAINT app_physical_ticket_cashouts_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_cashouts app_physical_ticket_cashouts_ticket_unique_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_cashouts
    ADD CONSTRAINT app_physical_ticket_cashouts_ticket_unique_id_fkey FOREIGN KEY (ticket_unique_id) REFERENCES public.app_physical_tickets(unique_id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_pending_payouts app_physical_ticket_pending_payo_admin_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT app_physical_ticket_pending_payo_admin_approved_by_user_id_fkey FOREIGN KEY (admin_approved_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_ticket_pending_payouts app_physical_ticket_pending_payouts_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT app_physical_ticket_pending_payouts_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_pending_payouts app_physical_ticket_pending_payouts_paid_out_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT app_physical_ticket_pending_payouts_paid_out_by_user_id_fkey FOREIGN KEY (paid_out_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_ticket_pending_payouts app_physical_ticket_pending_payouts_rejected_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT app_physical_ticket_pending_payouts_rejected_by_user_id_fkey FOREIGN KEY (rejected_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_ticket_pending_payouts app_physical_ticket_pending_payouts_responsible_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT app_physical_ticket_pending_payouts_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_pending_payouts app_physical_ticket_pending_payouts_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT app_physical_ticket_pending_payouts_scheduled_game_id_fkey FOREIGN KEY (scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_pending_payouts app_physical_ticket_pending_payouts_verified_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_pending_payouts
    ADD CONSTRAINT app_physical_ticket_pending_payouts_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_ticket_transfers app_physical_ticket_transfers_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_transfers
    ADD CONSTRAINT app_physical_ticket_transfers_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.app_physical_ticket_batches(id) ON DELETE CASCADE;

--
-- Name: app_physical_ticket_transfers app_physical_ticket_transfers_from_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_transfers
    ADD CONSTRAINT app_physical_ticket_transfers_from_hall_id_fkey FOREIGN KEY (from_hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_transfers app_physical_ticket_transfers_to_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_transfers
    ADD CONSTRAINT app_physical_ticket_transfers_to_hall_id_fkey FOREIGN KEY (to_hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_physical_ticket_transfers app_physical_ticket_transfers_transferred_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_transfers
    ADD CONSTRAINT app_physical_ticket_transfers_transferred_by_fkey FOREIGN KEY (transferred_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_physical_tickets app_physical_tickets_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_tickets
    ADD CONSTRAINT app_physical_tickets_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.app_physical_ticket_batches(id) ON DELETE CASCADE;

--
-- Name: app_physical_tickets app_physical_tickets_buyer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_tickets
    ADD CONSTRAINT app_physical_tickets_buyer_user_id_fkey FOREIGN KEY (buyer_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_tickets app_physical_tickets_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_tickets
    ADD CONSTRAINT app_physical_tickets_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_physical_tickets app_physical_tickets_sold_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_tickets
    ADD CONSTRAINT app_physical_tickets_sold_by_fkey FOREIGN KEY (sold_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_tickets app_physical_tickets_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_tickets
    ADD CONSTRAINT app_physical_tickets_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_player_hall_status app_player_hall_status_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_player_hall_status
    ADD CONSTRAINT app_player_hall_status_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_player_hall_status app_player_hall_status_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_player_hall_status
    ADD CONSTRAINT app_player_hall_status_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_player_hall_status app_player_hall_status_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_player_hall_status
    ADD CONSTRAINT app_player_hall_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_product_cart_items app_product_cart_items_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_cart_items
    ADD CONSTRAINT app_product_cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.app_product_carts(id) ON DELETE CASCADE;

--
-- Name: app_product_cart_items app_product_cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_cart_items
    ADD CONSTRAINT app_product_cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.app_products(id) ON DELETE RESTRICT;

--
-- Name: app_product_carts app_product_carts_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_carts
    ADD CONSTRAINT app_product_carts_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_product_carts app_product_carts_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_carts
    ADD CONSTRAINT app_product_carts_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_product_carts app_product_carts_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_carts
    ADD CONSTRAINT app_product_carts_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.app_agent_shifts(id) ON DELETE RESTRICT;

--
-- Name: app_product_carts app_product_carts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_carts
    ADD CONSTRAINT app_product_carts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_product_sales app_product_sales_agent_tx_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_sales
    ADD CONSTRAINT app_product_sales_agent_tx_id_fkey FOREIGN KEY (agent_tx_id) REFERENCES public.app_agent_transactions(id) ON DELETE SET NULL;

--
-- Name: app_product_sales app_product_sales_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_sales
    ADD CONSTRAINT app_product_sales_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_product_sales app_product_sales_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_sales
    ADD CONSTRAINT app_product_sales_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.app_product_carts(id) ON DELETE RESTRICT;

--
-- Name: app_product_sales app_product_sales_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_sales
    ADD CONSTRAINT app_product_sales_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_product_sales app_product_sales_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_sales
    ADD CONSTRAINT app_product_sales_player_user_id_fkey FOREIGN KEY (player_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_product_sales app_product_sales_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_product_sales
    ADD CONSTRAINT app_product_sales_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.app_agent_shifts(id) ON DELETE RESTRICT;

--
-- Name: app_products app_products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_products
    ADD CONSTRAINT app_products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.app_product_categories(id) ON DELETE SET NULL;

--
-- Name: app_regulatory_ledger app_regulatory_ledger_draw_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_regulatory_ledger
    ADD CONSTRAINT app_regulatory_ledger_draw_session_id_fkey FOREIGN KEY (draw_session_id) REFERENCES public.app_draw_sessions(id) ON DELETE RESTRICT;

--
-- Name: app_regulatory_ledger app_regulatory_ledger_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_regulatory_ledger
    ADD CONSTRAINT app_regulatory_ledger_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_regulatory_ledger app_regulatory_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_regulatory_ledger
    ADD CONSTRAINT app_regulatory_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_risk_countries app_risk_countries_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_risk_countries
    ADD CONSTRAINT app_risk_countries_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_saved_games app_saved_games_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_saved_games
    ADD CONSTRAINT app_saved_games_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_schedules app_schedules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_schedules
    ADD CONSTRAINT app_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_screen_saver_images app_screen_saver_images_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_screen_saver_images
    ADD CONSTRAINT app_screen_saver_images_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_sessions app_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id);

--
-- Name: app_spill2_config app_spill2_config_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_spill2_config
    ADD CONSTRAINT app_spill2_config_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_spill3_config app_spill3_config_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_spill3_config
    ADD CONSTRAINT app_spill3_config_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_static_tickets app_static_tickets_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_static_tickets
    ADD CONSTRAINT app_static_tickets_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_static_tickets app_static_tickets_paid_out_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_static_tickets
    ADD CONSTRAINT app_static_tickets_paid_out_by_user_id_fkey FOREIGN KEY (paid_out_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_static_tickets app_static_tickets_reserved_by_range_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_static_tickets
    ADD CONSTRAINT app_static_tickets_reserved_by_range_id_fkey FOREIGN KEY (reserved_by_range_id) REFERENCES public.app_agent_ticket_ranges(id) ON DELETE SET NULL;

--
-- Name: app_static_tickets app_static_tickets_responsible_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_static_tickets
    ADD CONSTRAINT app_static_tickets_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_static_tickets app_static_tickets_sold_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_static_tickets
    ADD CONSTRAINT app_static_tickets_sold_by_user_id_fkey FOREIGN KEY (sold_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_static_tickets app_static_tickets_sold_from_range_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_static_tickets
    ADD CONSTRAINT app_static_tickets_sold_from_range_id_fkey FOREIGN KEY (sold_from_range_id) REFERENCES public.app_agent_ticket_ranges(id) ON DELETE SET NULL;

--
-- Name: app_static_tickets app_static_tickets_sold_to_scheduled_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_static_tickets
    ADD CONSTRAINT app_static_tickets_sold_to_scheduled_game_id_fkey FOREIGN KEY (sold_to_scheduled_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE SET NULL;

--
-- Name: app_sub_games app_sub_games_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sub_games
    ADD CONSTRAINT app_sub_games_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_system_settings app_system_settings_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_system_settings
    ADD CONSTRAINT app_system_settings_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_terminals app_terminals_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_terminals
    ADD CONSTRAINT app_terminals_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: app_ticket_ranges_per_game app_ticket_ranges_per_game_carried_from_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_ticket_ranges_per_game
    ADD CONSTRAINT app_ticket_ranges_per_game_carried_from_game_id_fkey FOREIGN KEY (carried_from_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE SET NULL;

--
-- Name: app_ticket_ranges_per_game app_ticket_ranges_per_game_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_ticket_ranges_per_game
    ADD CONSTRAINT app_ticket_ranges_per_game_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE CASCADE;

--
-- Name: app_ticket_ranges_per_game app_ticket_ranges_per_game_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_ticket_ranges_per_game
    ADD CONSTRAINT app_ticket_ranges_per_game_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_ticket_ranges_per_game app_ticket_ranges_per_game_recorded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_ticket_ranges_per_game
    ADD CONSTRAINT app_ticket_ranges_per_game_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_unique_id_transactions app_unique_id_transactions_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_unique_id_transactions
    ADD CONSTRAINT app_unique_id_transactions_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_unique_id_transactions app_unique_id_transactions_unique_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_unique_id_transactions
    ADD CONSTRAINT app_unique_id_transactions_unique_id_fkey FOREIGN KEY (unique_id) REFERENCES public.app_unique_ids(id) ON DELETE CASCADE;

--
-- Name: app_unique_ids app_unique_ids_created_by_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_unique_ids
    ADD CONSTRAINT app_unique_ids_created_by_agent_id_fkey FOREIGN KEY (created_by_agent_id) REFERENCES public.app_users(id) ON DELETE RESTRICT;

--
-- Name: app_unique_ids app_unique_ids_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_unique_ids
    ADD CONSTRAINT app_unique_ids_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_unique_ids app_unique_ids_last_reprinted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_unique_ids
    ADD CONSTRAINT app_unique_ids_last_reprinted_by_fkey FOREIGN KEY (last_reprinted_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_unique_ids app_unique_ids_regenerated_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_unique_ids
    ADD CONSTRAINT app_unique_ids_regenerated_from_id_fkey FOREIGN KEY (regenerated_from_id) REFERENCES public.app_unique_ids(id) ON DELETE SET NULL;

--
-- Name: app_user_2fa_challenges app_user_2fa_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_2fa_challenges
    ADD CONSTRAINT app_user_2fa_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_user_2fa app_user_2fa_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_2fa
    ADD CONSTRAINT app_user_2fa_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_user_devices app_user_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_devices
    ADD CONSTRAINT app_user_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_user_pins app_user_pins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_pins
    ADD CONSTRAINT app_user_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_user_profile_settings app_user_profile_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_profile_settings
    ADD CONSTRAINT app_user_profile_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_users app_users_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE RESTRICT;

--
-- Name: app_users app_users_parent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_parent_user_id_fkey FOREIGN KEY (parent_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_voucher_redemptions app_voucher_redemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_voucher_redemptions
    ADD CONSTRAINT app_voucher_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_voucher_redemptions app_voucher_redemptions_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_voucher_redemptions
    ADD CONSTRAINT app_voucher_redemptions_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES public.app_vouchers(id) ON DELETE CASCADE;

--
-- Name: app_vouchers app_vouchers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_vouchers
    ADD CONSTRAINT app_vouchers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_withdraw_email_allowlist app_withdraw_email_allowlist_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_withdraw_email_allowlist
    ADD CONSTRAINT app_withdraw_email_allowlist_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_withdraw_requests app_withdraw_requests_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_withdraw_requests
    ADD CONSTRAINT app_withdraw_requests_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE SET NULL;

--
-- Name: app_withdraw_requests app_withdraw_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_withdraw_requests
    ADD CONSTRAINT app_withdraw_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

--
-- Name: app_xml_export_batches app_xml_export_batches_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_xml_export_batches
    ADD CONSTRAINT app_xml_export_batches_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

--
-- Name: app_physical_ticket_batches fk_physical_ticket_batches_scheduled_game; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_ticket_batches
    ADD CONSTRAINT fk_physical_ticket_batches_scheduled_game FOREIGN KEY (assigned_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE SET NULL NOT VALID;

--
-- Name: app_physical_tickets fk_physical_tickets_scheduled_game; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_physical_tickets
    ADD CONSTRAINT fk_physical_tickets_scheduled_game FOREIGN KEY (assigned_game_id) REFERENCES public.app_game1_scheduled_games(id) ON DELETE SET NULL NOT VALID;

--
-- Name: hall_game_schedules hall_game_schedules_hall_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_game_schedules
    ADD CONSTRAINT hall_game_schedules_hall_id_fkey FOREIGN KEY (hall_id) REFERENCES public.app_halls(id) ON DELETE CASCADE;

--
-- Name: hall_game_schedules hall_game_schedules_parent_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_game_schedules
    ADD CONSTRAINT hall_game_schedules_parent_schedule_id_fkey FOREIGN KEY (parent_schedule_id) REFERENCES public.hall_game_schedules(id) ON DELETE CASCADE;

--
-- Name: hall_schedule_log hall_schedule_log_schedule_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_schedule_log
    ADD CONSTRAINT hall_schedule_log_schedule_slot_id_fkey FOREIGN KEY (schedule_slot_id) REFERENCES public.hall_game_schedules(id) ON DELETE SET NULL;

--
-- Name: wallet_entries wallet_entries_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_entries
    ADD CONSTRAINT wallet_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.wallet_accounts(id);

--
-- Name: wallet_entries wallet_entries_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_entries
    ADD CONSTRAINT wallet_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.wallet_transactions(id);

--
-- Name: wallet_transactions wallet_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.wallet_accounts(id);

--
-- PostgreSQL database dump complete
--

