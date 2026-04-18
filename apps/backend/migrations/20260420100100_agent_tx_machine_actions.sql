-- BIN-583 B3.4: utvid action_type-CHECK med MACHINE_*-verdier.
--
-- B3.2 introduserte CASH_IN/OUT, TICKET_SALE/REGISTER/CANCEL, FEE, OTHER.
-- B3.4 trenger MACHINE_CREATE/TOPUP/CLOSE/VOID for klarere audit-trails
-- på Metronia + (kommende) OK Bingo-flyt.
--
-- Up

ALTER TABLE app_agent_transactions
  DROP CONSTRAINT IF EXISTS app_agent_transactions_action_type_check;

ALTER TABLE app_agent_transactions
  ADD CONSTRAINT app_agent_transactions_action_type_check
  CHECK (action_type IN (
    'CASH_IN', 'CASH_OUT',
    'TICKET_SALE', 'TICKET_REGISTER', 'TICKET_CANCEL',
    'PRODUCT_SALE',
    'MACHINE_CREATE', 'MACHINE_TOPUP', 'MACHINE_CLOSE', 'MACHINE_VOID',
    'FEE', 'OTHER'
  ));

COMMENT ON CONSTRAINT app_agent_transactions_action_type_check ON app_agent_transactions IS
  'BIN-583 B3.4: utvidet med MACHINE_* for ekstern-maskin-integrasjon (Metronia/OK Bingo). Bevarer PRODUCT_SALE fra B3.6.';
