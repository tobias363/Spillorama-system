# PgHero — lokal DB-monitor

PgHero-konfigurasjonen for OBS-8 bruker standard `ankane/pghero`-image
direkte fra docker-compose.observability.yml. Ingen custom Dockerfile
eller config-fil er nødvendig — alle innstillinger styres via env-vars i
compose-filen.

## Hva PgHero gjør

Web-dashbord på `http://localhost:8080` som viser:

- **Slow queries** — toppen av `pg_stat_statements` rangert på `total_time`
- **Queries** — full liste av spørringer med kall-count + gjennomsnittstid
- **Live queries** — pågående queries (snapshot fra `pg_stat_activity`)
- **Connections** — antall aktive connections per state
- **Maintenance** — vacuum/analyze-historikk + bloat-estimat
- **Suggestions** — manglende indexes (FK-er uten støttende index), ubrukte indexes
- **Space** — table size + index size, sortert på diskbruk

## Forutsetning: pg_stat_statements

PgHero leser fra `pg_stat_statements`-extension. Sjekk at den er aktivert:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

`shared_preload_libraries = 'pg_stat_statements'` må stå i `postgresql.conf`
før Postgres starter. Det er IKKE aktivert i default
`postgres:16-alpine`-imaget — se runbook §3 for hvordan slå på lokalt.

## Custom config (ikke i bruk per OBS-8)

Hvis vi senere trenger:

- Flere databaser (multi-tenant view)
- Custom query-blacklist
- Røtter for embedding i Grafana

…kan vi legge `pghero.yml` her og mounte inn via `volumes:` i
docker-compose.observability.yml. Per 2026-05-14 trenger vi ikke det.
