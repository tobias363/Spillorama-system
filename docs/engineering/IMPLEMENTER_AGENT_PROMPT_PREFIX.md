# Implementer-agent prompt-prefix — UI/komponenter

**Status:** Mal-tekst. PM kopier-paster inn i fix-agent-prompts som rører UI-komponenter
(BuyPopup, Bong-card, CenterTop, etc.).

**Tobias-direktiv 2026-05-15:** Preview-design-sider er IMMUTABLE. Agenter har historisk
"reddet" designet ved å overskrive preview-source med mellomstilstand fra prod. Denne
prefix-en forhindrer det.

---

## Hvordan bruke

Når du som PM spawner en fix/feature-agent som skal endre en av disse komponentene:

- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts`
- `packages/game-client/src/games/game1/components/BingoTicketHtml.ts`
- `packages/game-client/src/games/game1/components/BingoTicketTripletHtml.ts`
- `packages/game-client/src/games/game1/components/TicketGridHtml.ts`
- `packages/game-client/src/games/game1/CenterTopPanel.ts`
- `packages/game-client/src/games/game2/components/BongCard.ts`
- Enhver annen UI-komponent som har en tilhørende preview-mockup

…kopier inn følgende blokk øverst i agent-prompten (mellom oppgave-beskrivelse og
"Suksess-kriterier"):

```markdown
## ⛔ Preview-design er IMMUTABLE — les FRA source, ALDRI skriv til source

Dette repoet har 5 design-preview-sider under `packages/game-client/src/`:

- `bong-design/bong-design.html` — Spill 1 bong-rendering (single + Trippel Gul)
- `kjopsmodal-design/kjopsmodal-design.html` — BuyPopup Figma-export
- `premie-design/premie-design.html` — Center-top premie-tabell
- `dev-overview/dev-overview.html` — utvikler-landingsside
- `preview/preview.html` — bonus-spill preview

Disse er **kanonisk source** for design-mockups. Tobias-godkjent og IMMUTABLE.

**Regler:**

1. Hvis du må sammenligne mot design, les FRA `packages/game-client/src/{design-name}/`
2. Du skal **ALDRI** redigere preview-source (`.html` eller `.ts` i de 5 mappene)
3. Prod-komponentene må matche mockup, ikke omvendt
4. Hvis du tror designet skal endres: **STOP** og spør PM. Ikke gjør antakelser.

**Hvorfor:** Agenter har historisk "reddet" designet ved å overskrive preview-source med
en mellomstilstand fra prod. Dette skapte regresjon der mockup ikke lenger var sannhet.

**CI-gate:** `.github/workflows/preview-pages-immutable.yml` blokkerer PR-er som endrer
preview-source uten `[design-locked: YYYY-MM-DD]`-marker i PR-body. Du har IKKE marker.
Hvis du prøver å committe endringer i preview-mappene, vil PR-en bli blokkert.

**Stale build-artifacts:** Hvis du ser visuelle forskjeller mellom det Tobias rapporterer
og det du forventer, sjekk `apps/backend/public/web/games/*` — disse er gitignored og
kan være stale. Kjør `npm run build:games` lokalt for å regenerere.

**Relatert skill:** `.claude/skills/preview-pages-protection/SKILL.md`
```

---

## Når bruke denne prefix-en

| Type endring | Bruk prefix? |
|---|---|
| Endre `Game1BuyPopup.ts` | ✅ Ja — kjopsmodal-design er mockup |
| Endre `BingoTicketHtml.ts` | ✅ Ja — bong-design er mockup |
| Endre `CenterTopPanel.ts` premie-tabell | ✅ Ja — premie-design er mockup |
| Endre backend-engine | ❌ Nei — ingen preview-koblingen |
| Endre admin-web | ❌ Nei — admin har ikke mockup-flyt (per 2026-05-15) |
| Endre bonus-mini-spill (Wheel/Chest/Mystery/ColorDraft) | ✅ Ja — `preview.html` er mockup |
| Endre dev-overview-side | ✅ Ja — `dev-overview.html` er mockup |
| Refaktor som ikke rører UI-utseende (eks. flytte fil, rename funksjon) | ⚠️ Vurder — hvis det IKKE påvirker design, valgfritt. Hvis i tvil, inkluder. |

## Tommelfingerregel

Hvis agenten kan komme til å åpne `*.html` eller `*.css` i `packages/game-client/src/` for å
"sjekke design", inkluder prefix-en. Det koster ingenting og forhindrer regresjon.

## Eksempel — komplett agent-prompt

```markdown
Du skal fikse en bug i `Game1BuyPopup.ts` der "Du kjøper"-summary chips ikke
oppdateres når spilleren endrer stepper-verdi.

## ⛔ Preview-design er IMMUTABLE — les FRA source, ALDRI skriv til source

[... full prefix-blokk fra ovenfor ...]

## Bug-beskrivelse

[detaljer om bugen]

## Suksess-kriterier

[checkliste]

## Knowledge protocol

[§2.19 IMMUTABLE — skill + PITFALLS_LOG + AGENT_EXECUTION_LOG]
```

## Vedlikehold

- Hvis ny preview-side legges til: oppdater fil-listen i prefix-en
- Hvis CI-gate-regler endres (eks. marker-format): oppdater forklaringen
- Hvis skill `preview-pages-protection` flyttes: oppdater stien i prefix-en

## Relaterte docs

- `.claude/skills/preview-pages-protection/SKILL.md` — full skill
- `.github/workflows/preview-pages-immutable.yml` — CI-gate som håndhever regelen
- `docs/engineering/PITFALLS_LOG.md` §10 (Routing & Permissions) — historisk hendelse
- `docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md` — annen mal-tekst PM-rutinen bruker
