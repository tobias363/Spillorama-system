# PM Dashboard — live current-state for PM

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Filen:** [`scripts/pm-dashboard.html`](../../scripts/pm-dashboard.html)

> **Til ny PM:** Bookmark denne fra dag 1. Den er din "morgens første sjekk"
> for prosjektets nåværende tilstand. Tar 5 sekunder å lese, oppdaterer hver
> 5. minutt automatisk.

---

## Versjon 1: Lokal HTML (versjonskontrollert)

Den enkleste versjonen er en single-page HTML i repoet:
[`scripts/pm-dashboard.html`](../../scripts/pm-dashboard.html).

### Slik bruker du den

**Direkte fra disk:**
1. Åpne Finder, naviger til `~/Projects/Spillorama-system/scripts/`
2. Dobbeltklikk `pm-dashboard.html` (åpnes i standard nettleser)
3. Bookmark URL-en (`file:///Users/.../pm-dashboard.html`)

**Via lokal HTTP-server (hvis du støter på CORS-problemer):**
```bash
cd ~/Projects/Spillorama-system
npx http-server scripts/ -p 8080
# Åpne http://localhost:8080/pm-dashboard.html
```

### Hva den viser

- **Backend health (prod)** — `/health`-endpoint på prod
- **Spill 1/2/3 health** — per-slug health-endpoints
- **Siste 10 commits til main** — fra GitHub API (offentlig, ingen auth)
- **Åpne pull-requests** — fra GitHub API
- **Snarveier til alle kanoniske docs**
- **PM dag-1-sjekkliste**
- **Hvis-noe-brenner-eskalering**

Auto-refresh hver 5. minutt. Refresh-knapp øverst til høyre.

### Begrensninger

- **CORS:** Browser kan ikke alltid fetche prod-endpoints direkte fra
  `file://`-protocol. Workaround: kjør lokal HTTP-server (over).
- **GitHub API rate-limit:** Uten auth: 60 requests/time per IP.
- **Ingen Linear-data:** Krever LINEAR_API_KEY eller MCP. Se versjon 2 under.

---

## Versjon 2: Cowork-artifact (med Linear MCP)

Hvis du bruker Cowork/Claude og har Linear MCP koblet (per 2026-05-10: ✅),
kan du opprette en mer kraftig versjon som artifact.

### Slik oppretter du den

I Cowork-chat:

> Be Claude opprette en artifact basert på `scripts/pm-dashboard.html` som
> i tillegg viser:
> - Åpne BIN-issues fra Linear (gruppert på status)
> - Aktive sprint / cycle
> - Issues blokkert / awaiting Tobias
>
> Bruk Linear MCP-tools (`mcp__linear__list_issues`,
> `mcp__linear__get_team` etc.) for live data. Følg
> `mcp__cowork__create_artifact`-pattern. Title: "Spillorama PM Dashboard
> (Live)".

### Fordel over HTML-versjonen

- ✅ Live Linear-data (åpne issues, prioritet, eier)
- ✅ Ingen CORS-problemer (kjører i Cowork-sandbox)
- ✅ Auto-refresher når du åpner Cowork-fanen
- ✅ Kan inkludere AI-genererte sammendrag

---

## Versjon 3: Hosted dashboard (post-pilot, vurder)

Hvis prosjektet vokser: vurder å hoste dashboard-en på en intern URL.

**Tradeoffs:**
- ✅ Tilgjengelig fra hvor som helst
- ❌ Krever auth (sensitive ops-data)
- ❌ Ekstra vedlikehold

**Anbefaling per 2026-05-10:** Vent. Versjon 1 + 2 dekker pilot-behov.

---

## Hva dashbordet IKKE viser

(Med vilje — disse hører ikke i en daglig dashboard:)

- Compliance-trail (Lotteritilsynet-rapportering — egen prosess)
- Detaljerte logs (bruk Render dashboard eller Sentry direkte)
- Wallet-balanser eller spiller-data (PII — krever auth)
- Performance-metrics over tid
- Test-resultater (i CI — sjekk via gh CLI eller GitHub UI)

---

## Vedlikehold av denne dashboard

Når kanoniske docs flyttes / nye legges til:
- Oppdater snarvei-grid i `scripts/pm-dashboard.html`
- Hvis nye health-endpoints: oppdater `fetchGameHealth`-funksjonen

---

**Se også:**
- [`scripts/pm-dashboard.html`](../../scripts/pm-dashboard.html) — selve dashbordet
- [`scripts/pm-onboarding.sh`](../../scripts/pm-onboarding.sh) — terminal-versjon
- [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](../engineering/PM_ONBOARDING_PLAYBOOK.md)
- [`EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) — når noe brenner
