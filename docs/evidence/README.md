# Agent Contract Evidence Storage

**Status:** Konvensjon fra 2026-05-16 (ADR-0024 Fase 2 follow-up)
**Eier:** PM-AI
**Formål:** Persistent storage for evidence-packs referert i `AGENT_TASK_CONTRACT`-instanser.

---

## Hvorfor denne mappa finnes

Tidligere praksis: evidence-packs ble lagret i `/tmp/purchase-open-forensics-<timestamp>.md` og lignende. Dette skapte tre problemer:

1. **Overlever ikke reboot** — maskin-restart sletter `/tmp/`. Evidence forsvinner.
2. **Kan ikke audites** — 3 måneder senere kan ikke PM finne hvilken DB-snapshot/Sentry-issue agenten faktisk så.
3. **Kan ikke linkes fra ADR/PR/PITFALLS** — referanser til `/tmp/`-stier brytes umiddelbart.

For et system som håndterer ekte penger + compliance er det ikke akseptabelt at audit-grunnlaget er ephemerisk.

## Konvensjon

Når `scripts/generate-agent-contract.sh` genererer en kontrakt, foreslår den en **contract-ID** av formen:

```
docs/evidence/YYYYMMDD-<short-slug-of-agent-name>/
```

Eksempel:
```
docs/evidence/20260516-agent-a-purchase-open-seed-tick-fix/
```

PM skal kopiere evidence-filer hit FØR agent-spawn dersom kontrakten brukes for:

- P0/P1 risk-nivå
- Compliance-, wallet-, eller live-room-impact
- Repeated bugs (2+ ganger sett)
- Kontrakter referert i ADR eller PITFALLS_LOG

Generatorscriptet advarer hvis `--evidence`-flagget peker til `/tmp/` eller `/var/folders/` og foreslår eksakte `cp`-kommandoer.

## Hva skal commit-es

| Type | Commit-policy | Hvorfor |
|---|---|---|
| **Forensic Postgres-snapshots** | Ja | Audit-trail, reproducerbarhet |
| **Sentry issue export** | Ja | Cross-ref til Sentry kan forsvinne |
| **Backend-logger (anonymiserte)** | Ja | PII-skrubbet, beholdes |
| **Skjermbilder fra live-test** | Ja | Permanent kontekst |
| **PostHog session URLs** | Ja (selve URLen) | Kontext-spor selv om PostHog-data utløper |
| **Live-monitor-output** | Ja | Korrelerer med snapshot-tidspunkt |
| **PII / personnummer / wallet-tx-detaljer med IDs** | NEI — skrub først | GDPR + pengespillforskriften |
| **Vendor-credentials i logs** | NEI — fjern før commit | Sikkerhet |

Hvis evidence inneholder PII eller secrets, **skrub før commit**. Bruk pseudonymer / hash for user IDs hvis identifisering kan rekonstrueres.

## Hva skal IKKE være her

- Pågående arbeid (`/tmp/` er fortsatt riktig sted under aktiv test)
- Generiske test-output uten kontrakt-referanse
- Logs fra normal drift uten incident-kontekst
- Output fra `npm run`-kommandoer som er enkelt regenererbart

Hvis du er usikker: spør om evidencen **knytter en agent-contract til en konkret beslutning**. Hvis ja → her. Hvis nei → ikke her.

## Filnavn-konvensjon

Inni hver `<contract-id>/`-mappe:

```
docs/evidence/20260516-agent-a-purchase-open-seed-tick-fix/
├── README.md                              # kontrakt + sammendrag
├── 20260516T102333Z-postgres-snapshot.md  # før master-action
├── 20260516T102415Z-postgres-snapshot.md  # etter master-action
├── 20260516T102501Z-sentry-baseline.json
├── 20260516T102622Z-pilot-monitor.log
└── contract.md                            # kopi av selve kontrakten (frozen)
```

`README.md` i hver mappe skal kort beskrive:
- Hvilken agent-contract dette tilhører (contract-ID + link til PR/ADR)
- Når evidence ble samlet
- Hvilket scope (purchase_open / wallet / etc.)
- Hva som ble brukt fra dette for å trekke konklusjon

## Lifecycle og retensjon

| Tid siden generering | Status |
|---|---|
| 0–30 dager | Aktiv. Referer fra åpne PR-er, ADR-er, PITFALLS-entries. |
| 30 dager–6 måneder | Historisk. Kan refereres ved postmortem eller audit. |
| 6 måneder–2 år | Arkiv. Behold men flag for arkivering hvis tilhørende kontrakt er erstattet. |
| > 2 år | Vurder fjerning hvis ingen aktiv referanse. Krever ADR for sletting av compliance-relevant evidence. |

For Lotteritilsynet-relevant evidence: **behold uavkortet i 5 år** per regulatoriske krav.

## Cross-references

- [`scripts/generate-agent-contract.sh`](../../scripts/generate-agent-contract.sh) — genererer contract-ID, foreslår `cp`-kommandoer
- [`scripts/verify-contract-freshness.mjs`](../../scripts/verify-contract-freshness.mjs) — verifiserer skill-SHA-lockfile
- [`docs/adr/0024-pm-knowledge-enforcement-architecture.md`](../adr/0024-pm-knowledge-enforcement-architecture.md) — meta-ADR som introduserte denne konvensjonen
- [`docs/engineering/AGENT_TASK_CONTRACT.md`](../engineering/AGENT_TASK_CONTRACT.md) — kontrakt-protokoll

---

**Sist oppdatert:** 2026-05-16 (introdusert som del av Fase 2)
