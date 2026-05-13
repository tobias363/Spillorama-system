### Smoke-test steps (wallet-touch + compliance-ledger)

1. Forutsetning: master har startet runde, spiller har positiv wallet-balanse
2. Åpne `http://localhost:4000/web/?debug=1` som spiller
3. Kjøp bonger (klikk Bingo-tile → +-rader → Kjøp)
4. Åpne en ny terminal: `psql -h localhost -U spillorama -d spillorama -c "SELECT type, amount_cents, idempotency_key FROM app_wallet_transactions ORDER BY created_at DESC LIMIT 5;"`
5. **Expected:** Siste rad har `type='STAKE'`, `amount_cents` = total kjøp i øre, unik `idempotency_key`
6. Kjør: `SELECT event_type, amount_cents, hall_id FROM app_rg_compliance_ledger ORDER BY created_at DESC LIMIT 5;`
7. **Expected:** Tilsvarende STAKE-rad, bundet til **kjøpe-hall** (ikke master-hall — se PITFALLS_LOG §1.x)

### Forventet feilbilde hvis PR er broken

- Wallet-balanse trekkes men ingen compliance-ledger-rad → outbox-pattern brutt
- Compliance-rad bundet til `master_hall_id` istedenfor `actor_hall_id` (regulatorisk bug, PR #443-regresjon)
- Duplikat-STAKE pga manglende idempotency-key
