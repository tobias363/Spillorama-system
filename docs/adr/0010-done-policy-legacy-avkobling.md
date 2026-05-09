# ADR-0010 — Done-policy for legacy-avkobling

**Status:** Accepted
**Dato:** 2026-04-17
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-009-done-policy-legacy-avkobling.md` til ny struktur. Innhold uendret.

## Kontekst

Linear-prosjektet "[Legacy-avkobling: Game 1-5 + backend-paritet](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a)"
sporer migrering bort fra legacy Unity-klient til web-native stack.

I 2026-04-17 ble fire issues (BIN-494, 498, 501, 520) oppdaget å være merket "Done" uten at koden var
faktisk merget til `main`:
- En PR var åpnet men ikke merget
- En annen var merget til feature-branch men ikke til main
- En tredje hadde manglende test
- En fjerde manglet `file:line`-bevis

Dette er **regulatorisk risiko**. Spillorama er pengespill — hvis Lotteritilsynet ber om bevis at
"legacy-avkobling-funn X er lukket", må vi kunne peke på commit i prod.

## Beslutning

Innfør formell **Done-policy** for legacy-avkobling-prosjektet:

En issue kan kun lukkes når **alle tre kriterier** er oppfylt:

1. **Commit merget til `main`** (ikke kun feature-branch eller PR-åpning)
2. **`file:line`-referanse** som bevis (f.eks. `apps/backend/src/wallet/WalletService.ts:142`)
3. **Test (eller grønn CI-link) som verifiserer atferd**

**Praksis:**
- Ved Done-claim: kommentar i Linear-issuen med merge-commit-SHA + file:line + test-link
- Reviewer (PM) verifiserer alle tre før Done godkjennes
- Hvis et kriterium mangler, reåpne issue og legg til kommentar om hva som mangler

**Retrospektiv validering 2026-04-17:** alle eksisterende Done-issues ble re-validert. Fire ble reåpnet
(BIN-494, 498, 501, 520), én bekreftet OK (BIN-495).

## Konsekvenser

### Positive
- **Regulatorisk forsvar:** Lotteritilsynet kan kreve bevis — vi kan svare med commit-SHA + file:line
- **Færre falske "Done"-funn:** policyen forhindrer "PR åpnet = ferdig"-tankegang
- **Bedre internal audit:** parity-matrix kan stole på Done-statusen

### Negative
- **Mer arbeid per Done-godkjennelse:** PM må verifisere tre kriterier hver gang. Akseptabelt for
  regulert system.

### Nøytrale
- **Policy gjelder kun legacy-avkobling-prosjektet:** andre Linear-prosjekter (loyalty, wallet-redesign)
  har ikke samme strenghet. Begrunnelse: legacy-avkobling er regulatorisk-sentralt; andre er
  vanlig produkt-arbeid.

## Alternativer vurdert

### Alternativ A: Stol på utviklerens "Done"-toggling
Avvist:
- Bevist usikker (4 av 5 var feilaktige Done-claims)
- Ikke akseptabelt regulatorisk

### Alternativ B: Krev kun commit-til-main, ikke test
Avvist:
- Tester fanger regresjon
- Lotteritilsynet kan kreve bevis at funnet ikke kan re-introduseres

### Alternativ C: Ekstern audit av hver Done
Avvist:
- For stort overhead
- PM-validering er tilstrekkelig

## Implementasjon

- ✅ Policy dokumentert i `docs/engineering/ENGINEERING_WORKFLOW.md` §7
- ✅ PR-template har egen "Legacy-avkobling Done-policy"-seksjon
- ✅ Memory: `feedback_done_policy.md` auto-loaded
- ✅ Retrospektiv validering 2026-04-17 fullført

Skills som bør oppdateres: `pm-orchestration-pattern`.

## Referanser

- `docs/engineering/ENGINEERING_WORKFLOW.md` §7
- `.github/pull_request_template.md`
- BIN-534 (Linear)
- Memory: `feedback_done_policy.md`
