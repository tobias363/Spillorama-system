# apps/backend/migrations/

## Forward-only migrations (BIN-661)

**Vi har ingen Down-migrations.** Hvis du trenger å rulle tilbake en skjema-endring, skriv en **ny forward-migration** med ny tidsstempel.

### Hvorfor

Beslutning 2026-04-19 etter [BIN-661](https://linear.app/bingosystem/issue/BIN-661):

1. **Compliance-immutability.** `app_audit_log`, `app_regulatory_ledger`, `app_daily_regulatory_reports` og `app_wallet_*` må aldri kunne slettes utilsiktet. Norsk pengespill-regulering (§64) krever at vi kan rekonstruere historikk.
2. **Data-tap-risiko.** Før [BIN-657](https://linear.app/bingosystem/issue/BIN-657) hadde flere migrations Down-seksjoner med `DROP TABLE` for hele dataset. Én bokstav feil på kommandolinje (`migrate:down 0` i stedet for `migrate:down 1`) ville tømt produksjons-DB.
3. **Audit-sporbarhet.** Forward-only gjør at `pgmigrations`-tabellen er en fullstendig changelog — ingen "usynlige" rollbacks.

### Hvis du virkelig trenger å rulle tilbake

Skriv en ny migration som reverserer endringen. Eksempel:

```bash
# Du la til en kolonne ved uhell:
# migrations/20260425120000_add_wrong_column.sql: ALTER TABLE foo ADD COLUMN bar TEXT

# Lag en reverser-migration:
npm --prefix apps/backend run migrate:create revert_wrong_column
# Åpner: migrations/20260425130000_revert_wrong_column.sql
# Skriv:
#   -- Up migration
#   ALTER TABLE foo DROP COLUMN IF EXISTS bar;
```

Fordelen: kjører forover normalt, logger audit-trail, ingen risiko for å "gå en for mye tilbake".

## Markør-konvensjon

node-pg-migrate's parser krever **eksakt syntaks**:

```sql
-- Up migration
CREATE TABLE ...;
```

IKKE bare `-- Up` — parseren krever `migration`-ordet etter. Med feil syntaks behandles HELE filen som UP (inkl. eventuelle DROP-statements på slutten). Se [BIN-657 PR #235](https://github.com/tobias363/Spillorama-system/pull/235) for rotsak-detaljer.

Siden vi nå er forward-only trengs KUN `-- Up migration`-markør (ingen `-- Down migration`).

## Forbudt

- ❌ `-- Down migration` blokker i nye migrations
- ❌ `DROP TABLE` for data-bærende tabeller (wallet, audit-log, users, halls) uten eksplisitt PM-godkjenning og egen dedikert migration
- ❌ `npm run migrate:down` (scriptet er fjernet fra `package.json`)
- ❌ Å endre EKSISTERENDE migration-filer etter de er kjørt mot en DB — skriv ny migration i stedet

## Tillatt (med forsiktighet)

- ✅ `ALTER TABLE ... DROP COLUMN IF EXISTS` i forward-migration hvis kolonnen skal bort
- ✅ `DROP INDEX IF EXISTS` i forward-migration
- ✅ `DROP TABLE` for midlertidige/cache-tabeller (med tydelig kommentar om at dataen er tapelig)

## Migration-navngivning

Format: `YYYYMMDDHHMMSS_snake_case_description.sql`

- 14-sifret tidstempel (YYYYMMDDHHMMSS) for sortering
- Korte, beskrivende navn
- ASCII-only (ingen æøå) for cross-platform filsystem-kompatibilitet

## Commit-hygiene

- Én migration per logisk endring (ikke én per tabell hvis de henger sammen)
- Commit-body skal forklare **hvorfor**, ikke bare **hva**
- Link til Linear-issue
- Test lokalt med `npm --prefix apps/backend run migrate` før commit

## Se også

- [BIN-657](https://linear.app/bingosystem/issue/BIN-657) — markør-syntaks-fix
- [BIN-661](https://linear.app/bingosystem/issue/BIN-661) — forward-only-beslutning
- [BIN-643](https://linear.app/bingosystem/issue/BIN-643) — tapte migration-filer under restrukt
- node-pg-migrate docs: https://salsita.github.io/node-pg-migrate/
