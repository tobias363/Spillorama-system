-- BIN-583 B3.6: legg til PRODUCT_SALE i action_type-enumen.
-- Lar produkt-salg bli rapportert i samme aggregat som cash-ops og
-- ticket-sales via app_agent_transactions.

ALTER TABLE app_agent_transactions
  DROP CONSTRAINT IF EXISTS app_agent_transactions_action_type_check;

ALTER TABLE app_agent_transactions
  ADD CONSTRAINT app_agent_transactions_action_type_check
    CHECK (action_type IN (
      'CASH_IN', 'CASH_OUT',
      'TICKET_SALE', 'TICKET_REGISTER', 'TICKET_CANCEL',
      'PRODUCT_SALE',
      'FEE', 'OTHER'
    ));
