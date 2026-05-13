# PM Push Control — kontroll over multi-agent git-pushes

**Status:** Aktiv (etablert 2026-05-13)
**Eier:** PM-AI (per ADR-0009 — PM eier git)
**Etablert etter Tobias-direktiv 2026-05-13:** *"Kan du også sette opp rutine i at du har kontroll på alt som blir pusha til git så du kan forsikre om at det ikke blir konfliktende arbeid"*

---

## Hvorfor

Med 5-10+ parallelle agenter under aktiv pilot-utvikling oppstår merge-konflikter raskt. Verktøyet `scripts/pm-push-control.mjs` gir PM (meg):

1. **Synlighet** — alle aktive agenter + deres deklarerte scope ved hvert tidspunkt
2. **Konfliktdeteksjon** — fil-overlapp BEGE PR åpnes, ikke etter
3. **Merge-ordre-anbefaling** — topologisk sortering av åpne PR-er
4. **Aktiv push-overvåkning** — daemon som detekterer nye pushes fra registrerte branches

---

## Bruk

### Daglig flyt

```bash
# Når jeg spawner ny agent — registrer scope FØRST
node scripts/pm-push-control.mjs register \
  <agent-id> \
  <branch-name> \
  <fil-glob-1> <fil-glob-2> ...

# Se hva som er aktivt nå
node scripts/pm-push-control.mjs list

# Sjekk konflikter (in-flight + åpne PR-er)
node scripts/pm-push-control.mjs conflicts

# Få anbefalt merge-rekkefølge for åpne PR-er
node scripts/pm-push-control.mjs merge-order

# Sammenlign agentens DEKLARERTE scope mot ACTUAL diff
node scripts/pm-push-control.mjs diff <agent-id-or-shortname>

# Når agent leverer + jeg har laget PR
node scripts/pm-push-control.mjs unregister <agent-id-or-shortname>

# Daemon-modus (poll hvert 30s, varsler på nye pushes)
node scripts/pm-push-control.mjs watch
```

### Pre-spawn-sjekkliste (PM-rutine)

Før jeg spawner ny agent, sjekker jeg:

1. `node scripts/pm-push-control.mjs list` — hvilke agenter er aktive?
2. Skriv ned deklarert scope for ny agent
3. Verifiser at scope IKKE overlapper kritiske filer for andre aktive agenter
4. Hvis overlapp er uunngåelig (eks. AGENT_EXECUTION_LOG.md som ALLE skriver til), dokumenter i `conflictsAcknowledged` i registry
5. Spawn agent → `register` med deklarert scope

### Post-delivery-rutine

Når agent leverer:

1. `node scripts/pm-push-control.mjs diff <id>` — verifiser at faktisk diff matcher deklarert scope
2. Hvis betydelig avvik → flag for PR-review
3. `gh pr create + auto-merge`
4. `node scripts/pm-push-control.mjs unregister <id>`
5. Etter merge: `node scripts/pm-push-control.mjs merge-order` — gjenværende PR-er som kanskje trenger rebase

---

## Registry-format

Live state ligger i `/tmp/active-agents.json`:

```json
{
  "version": 1,
  "updatedAt": "ISO-timestamp",
  "agents": [
    {
      "id": "agent-id",
      "shortname": "A1",
      "topic": "Kort beskrivelse",
      "branch": "feat/branch-name",
      "scope": ["fil-glob-1", "fil-glob-2"],
      "spawnedAt": "ISO-timestamp",
      "status": "in-flight" | "delivered" | "merged"
    }
  ],
  "conflictsAcknowledged": [
    {
      "files": ["docs/engineering/AGENT_EXECUTION_LOG.md"],
      "agents": ["A1", "A2", "..."],
      "type": "additive-append",
      "resolution": "auto-resolvable som append"
    }
  ]
}
```

Registry **persisterer ikke** mellom PM-sesjoner. Hver ny PM-sesjon må re-registrere agenter den spawner.

Audit-trail finnes i `/tmp/pm-push-control.log` — kronologisk lista over registreringer, unregistreringer, og polled changes.

---

## Glob-syntaks (scope-deklarasjon)

- `*` — matcher hvilken som helst sekvens innenfor én sti-segment
- `**` — matcher rekursivt
- Eksakte sti-strenger matcher seg selv

Eksempler:
```
apps/backend/src/game/Game1*           # matcher Game1Engine.ts, Game1LobbyService.ts
.claude/skills/*/SKILL.md              # matcher alle skills' SKILL.md
docs/engineering/PITFALLS_LOG.md       # eksakt fil
**/*.test.ts                           # alle test-filer rekursivt
```

---

## Konflikt-typer

| Type | Eksempel | Handling |
|---|---|---|
| **Hard kollisjon** | 2 agenter modifiserer samme funksjon i samme fil | Spawn én av dem først, vent på merge, så spawn andre |
| **Additiv-append** | Multiple agenter appender til AGENT_EXECUTION_LOG.md | Auto-mergeable hvis alle appender på slutten |
| **Additiv-section** | 2 agenter legger til hver sin nye seksjon i PITFALLS_LOG.md | Auto-merge oftest mulig (forskjellige steder) |
| **Konfigurasjon-merge** | 2 agenter legger til scripts i package.json | Manuell JSON-merge eller serielt |
| **Orkestrator-extend** | 2 agenter legger til hooks i `.husky/pre-commit` | Sekvensielt merge, andre rebases |

---

## Integrasjon med live-monitor

Når B1 (monitor-active-push) lander, vil pm-push-control integrere:
- P0-anomali fra monitor → trigger automatisk `pm-push-control conflicts`
- Ny PR fra in-flight agent → mac-notif
- Conflict detected → mac-notif

---

## Begrensninger

1. **Registry er ephemeral** (/tmp) — overlever ikke reboot
2. **PM må huske å register** — ikke automatisk
3. **Glob-matching er enkelt** — ingen .gitignore-respekt
4. **Ikke pre-push hook** — sjekker ETTER push (D1-agent skal legge til pre-push hooks)
5. **Ikke automatisk rebase** — D1 skal legge til auto-rebase på merge

---

## Roadmap (D1-agent vil polere)

- [ ] Pre-push git-hook som validerer at push fra in-flight branch matcher deklarert scope
- [ ] GitHub Actions workflow som auto-rebaser åpne PR-er når annen PR merger
- [ ] Persistent registry i `.claude/active-agents.json` (committed, ikke /tmp)
- [ ] Mac-notif on conflict
- [ ] Integration med live-monitor (P0 events trigger conflict-scan)
- [ ] Vitest-tester for konflikt-detektorer
- [ ] HTML-dashboard som auto-refresh

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — Phase 1 MVP. 11 aktive agenter registrert. List/register/conflicts/merge-order/diff/poll/watch commands. | PM-AI (Claude Opus 4.7) |
