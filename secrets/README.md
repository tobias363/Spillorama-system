# `secrets/` — lokale credentials for PM og ops

**Eier:** Tobias Haugen
**Sist oppdatert:** 2026-05-10
**Status:** Aktiv

> **Til ny PM:** Hvis du ser denne mappen tom (kun template-filer), spør Tobias om
> credentials. Når du har fått dem, kopier hver `*.template.md` til `*.local.md`,
> lim inn nøkkelen, og lagre. Filene `*.local.md` er auto-ignorert av git
> (se `secrets/.gitignore`).

---

## Hva er dette

Sentral, gitignored mappe for credentials som PM/Tobias trenger for ops-oppgaver
som ikke kjøres av backend selv. Dette er ikke runtime-secrets — de ligger i
`apps/backend/.env` (også gitignored). Disse er **operasjonelle nøkler** som:

- Render API key (deploy, env-var-mgmt, services-API)
- Linear API token (issue-mgmt fra CLI/scripts)
- Eventuelle andre admin-nøkler PM trenger

**Hvorfor ikke bare bruke `.env`?** Backend trenger ingen av disse i runtime — de
er bare for menneskelige operasjoner og scripts. Å blande operasjonelle nøkler
inn i `.env` øker blast-radius hvis `.env` lekkes.

---

## Slik bruker du det

### Første gang (ny PM eller ny maskin)

1. Spør Tobias om credentials — han har dem i sitt password manager (1Password
   eller tilsvarende). Han limer dem inn i en sikker kanal (ikke chat).
2. For hver credential du trenger, kopier template-filen:
   ```bash
   cd secrets/
   cp render-api.template.md render-api.local.md
   ```
3. Åpne `render-api.local.md` og lim inn nøkkelen i feltet markert
   `<LIM INN HER>`.
4. Lagre. Filen er allerede ignorert — verifiser med:
   ```bash
   git status
   # secrets/render-api.local.md skal IKKE vises
   ```

### Bruk fra script eller CLI

```bash
# Hent Render API-nøkkel inn i miljø-variabel for én kommando
export RENDER_API_KEY=$(grep -A1 "API Key:" secrets/render-api.local.md | tail -1 | tr -d ' ')
curl -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services
```

Eller bedre — lag en `secrets/load-env.sh.local` (også auto-ignorert) som
eksporterer alt:

```bash
#!/bin/bash
# secrets/load-env.sh.local
export RENDER_API_KEY="..."
export LINEAR_API_KEY="..."
```

Så `source secrets/load-env.sh.local` før ops-arbeid.

---

## Sikkerhetsregler

1. **ALDRI committ en `*.local.md`-fil eller `load-env.sh.local`.** `git status`
   skal aldri vise filer fra denne mappen som untracked.
2. **ALDRI lim credentials inn i Linear, GitHub Issues, Slack, eller Cowork-chat.**
   Selv private kanaler logges et sted.
3. **Roter credentials hvis de mistenkes lekket.** Render API-nøkkel kan rotes
   i Render-dashboard → Account Settings → API Keys.
4. **Bruk minimum-privileges.** Render har read-only API-nøkler — bruk den hvis
   du bare trenger å lese, ikke deploye.
5. **Ved oppsigelse / PM-bytte:** roter ALLE credentials. Legg til checklist-item
   i `docs/operations/CREDENTIALS_AND_ACCESS.md`.

---

## Hvorfor ikke en MCP?

Per 2026-05-10 finnes ingen offisiell Render MCP-server. Når den lanseres:

1. Koble den i Claude/Cowork-MCP-registry
2. Marker `secrets/render-api.local.md` som DEPRECATED
3. Oppdater `docs/operations/CREDENTIALS_AND_ACCESS.md` til å peke på MCP

Linear har MCP — preferer den fremfor manuell `LINEAR_API_KEY` der det er
mulig.

---

## Filstruktur

```
secrets/
├── .gitignore              # Whitelist-basert: alt ekskludert unntatt navngitte filer
├── README.md               # Denne filen
├── render-api.template.md  # Template — committet
├── render-api.local.md     # Din lokale fil med faktisk nøkkel — auto-ignorert
├── linear-api.template.md  # Template — committet
└── linear-api.local.md     # Din lokale fil — auto-ignorert
```

---

**Se også:** [`docs/operations/CREDENTIALS_AND_ACCESS.md`](../docs/operations/CREDENTIALS_AND_ACCESS.md)
for full oversikt over hvor hver credential ligger og hvem som har tilgang.
