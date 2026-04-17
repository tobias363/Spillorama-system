# Legacy deletion plan — Fase 5

**Eier:** Teknisk leder (Tobias Haugen) + operativ beredskap + compliance
**Linear-referanse:** [BIN-537](https://linear.app/bingosystem/issue/BIN-537)
**Status:** Planleggingsfase — ingen sletting før alle DoD-punkter er ✅

---

## 1. Hva skal slettes

Katalogene under `legacy/` er karantene og skal trekkes ut av dette repoet når paritet er nådd og piloten har kjørt stabilt. Omfang:

| Path | Innhold | Skjebne |
|------|---------|---------|
| `legacy/unity-client/` | Unity C#-prosjekt (Assets, Packages, ProjectSettings) | Flytt til arkiv-repo, slett her |
| `legacy/unity-backend/` | Node.js-backend for legacy Unity-spill | Flytt til arkiv-repo, slett her |
| `legacy/scripts/` | `unity-*.sh` byggeverktøy | Flytt til arkiv-repo |
| `legacy/docs/` | Unity-relatert dokumentasjon | Flytt til arkiv-repo |
| `legacy/README.md` | Utfasingsplan for legacy | Beholdes som historisk notat i arkiv, slettes her |
| `.github/workflows/unity-*.yml` | CI-jobber for Unity-bygg | Slettes her, evt. flyttes til arkiv |

Relaterte referanser som også må fjernes i same PR:

- PR-template (`.github/pull_request_template.md`): fjern `legacy/unity-client` fra "Scope"-sjekkliste
- Dokumenter i `docs/`: fjern Unity-spesifikke seksjoner, merk historiske

---

## 2. Arkiv-repo

Forslag: `tobias363/Spillorama-legacy-archive` (eget GitHub-repo, ikke del av live bingo-systemet).

**Hvorfor eget repo:**
- Beholder git-historikk for revisjon (pengespill-krav)
- Nullstiller CI-kostnad (Unity-bygg er dyre, ikke nødvendige når systemet er avviklet)
- Holder live bingo-repoet slankt og rask å checkout

**Hvordan flytte:**

```bash
# Fra live repo (kort skisse)
git subtree split -P legacy -b legacy-only
cd ../
git clone <live-repo-url> spillorama-legacy-archive
cd spillorama-legacy-archive
git checkout -b main
git pull ../Spillorama-system legacy-only
# Rydd rot-filer, commit, push til nytt remote
```

Alternativer hvis subtree-split blir for komplisert:
- `git filter-repo --path legacy/` for ren ekstraksjon
- Manuell kopi + initial commit (mister historikk — ikke anbefalt for regulert system)

---

## 3. DoD — sjekkliste før sletting kan skje

Alle 10 punkter må være ✅ og signert av to roller (teknisk leder + compliance):

- [ ] **BIN-525 Parity-matrix** viser 100 % ✅ for G1, G2, G3, G5
- [ ] **BIN-527 Wire-kontrakt-test** kjører grønt i CI på backend, web-klient og legacy-bridge
- [ ] **BIN-526 E2E pengeflyt-test** dekker alle fire spill og er required status check
- [ ] **BIN-508 Load-test** har passert 1000+ spillere med p99 < 500 ms og 0 dropped events
- [ ] **Pilot**: minst én hall har kjørt web-klient i **minst 4 uker** uten regulatoriske hendelser
- [ ] **BIN-533 Risk register** er lukket med closure-matrise
- [ ] **BIN-532 Unity build reproducibility** bevist i CI (dokumentert rollback-evne fra arkiv-repo)
- [ ] **BIN-540 Feature-flag rollback** testet i staging og i minst én produksjons-hall
- [ ] **BIN-541 Spillvett cross-game** passerer på alle spill i ny stack
- [ ] **BIN-537 (denne)**: operativ beredskap og compliance har signert sletting

---

## 4. Godkjenningsmyndighet

Sletting kan ikke utføres av én person alene.

| Rolle | Navn (per 2026-04-17) | Ansvar |
|-------|-----------------------|--------|
| Teknisk leder | Tobias Haugen | Bekrefter at alle tekniske DoD-punkter er lukket og dokumentert |
| Operativ beredskap | *(tildeles)* | Bekrefter at rollback-prosedyre er testet og at vaktordning kan fallback til arkiv-repo innen SLA |
| Compliance | *(tildeles)* | Bekrefter at regulatoriske krav er dekket av ny stack |

Signering i egen commit-melding på sletting-PR-en:

```
chore(legacy): remove legacy/ — approved by <tech-lead>, <ops>, <compliance>

Co-Authored-By: <ops-lead>
Co-Authored-By: <compliance-lead>
```

---

## 5. Rollback-strategi

Hva gjør vi hvis `legacy/` er slettet og noe bryter i prod?

**Scenarier og respons:**

| Scenario | Tid til detektering | Respons |
|----------|---------------------|---------|
| Prod-bug i web-versjon, kritisk | < 5 min | Flip feature-flag: web → unity (BIN-540). Unity kjører fortsatt fra arkiv-deploy. SLA: 2 min. |
| Prod-bug, ikke kritisk | < 1 time | Hotfix i ny stack, deploy. Rollback ikke nødvendig. |
| Unity-deploy krasjer etter sletting | < 30 min | Trekk fra arkiv-repo, kjør `deploy/unity-archive` workflow (bygget og testet før sletting). |

**Krav for å muliggjøre rollback etter sletting:**

1. Arkiv-repo har kjørbar `infra/deploy-backend.sh` eller tilsvarende som kan bootstrappe legacy.
2. Render (eller deploy-platform) har en bevart `staging-legacy` service som kan aktiveres via flagg.
3. DB-schema er bakoverkompatibelt i minst 4 uker etter sletting (ingen breaking migrations).
4. Siste Unity-build (WebGL wasm-bundle + admin-panel HTML) er beholdt i versjonert artefakt-lager (bevares per BIN-532).

---

## 6. Kommunikasjon

Før sletting:

- Varsle alle halladmin 7 dager i forveien med dato og fallback-prosedyre
- Varsle Lotteritilsynet hvis regulatoriske avhengigheter har endret seg
- Oppdater `README.md` og `docs/architecture/SPILLORAMA_SYSTEM_SCOPE_AND_SOURCE_OF_TRUTH_2026-04-12.md`

Etter sletting:

- Status-oppdatering til team (Slack)
- Release-notater som referer arkiv-repo for historiske Unity-versjoner
- Arkiver `legacy/README.md` som siste dokumenterte tilstand

---

## 7. Tidsplan

Basert på senior-PM-plan (uke 1 = pre-GO, uke 9–12 = fase 5):

```
Uke 9:   Pilot-evaluering ferdig. Alle DoD-punkter sjekkes.
Uke 10:  Arkiv-repo opprettes. legacy/ ekstraheres med historikk.
Uke 11:  Sletting-PR åpnes. 1 uke review/sign-off.
Uke 12:  Merge + deploy. Sletting fullført.
```

Reviderbart når prosjektet faktisk starter og faktisk tidsplan er kjent.

---

## 8. Åpne spørsmål

- Skal `.github/workflows/unity-*.yml` flyttes til arkiv-repo (for at repo-en skal være kjørbar alene), eller er det nok å ta vare på Unity vendor-SDK-bundle?
- Må vi beholde en `legacy-runtime-freeze-2026.md` på arkiv-repo som snapshot av siste kjente driftskonfigurasjon?
- Har Lotteritilsynet krav til hvor lenge vi må oppbevare legacy spillmotor-kildekode? (Må avklares før sletting.)

---

## 9. Revisjonshistorikk

| Dato | Hvem | Endring |
|------|------|---------|
| 2026-04-17 | Tobias Haugen (via senior-PM-review) | Initial plan etablert |
