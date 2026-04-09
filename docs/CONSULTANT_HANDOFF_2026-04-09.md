# Konsulent-overlevering: Candy Mania integrering i Spillorama-lobbyen

**Dato:** 2026-04-09  
**Repo:** `tobias363/bingosystem` (GitHub, privat)  
**Produksjon:** `https://bingo-system-jsso.onrender.com/web/`  
**Deploy:** Render auto-deploy fra `main`-branchen  

---

## 1. Hva vi prøver å oppnå

Spillorama er en bingo-lobby som kjører som **Unity WebGL**. Den viser 5 spilltiles (Papir bingo, Lynbingo, BingoBonanza, Turbomania, SpinnGo) som alle er rendret inne i Unity sin `<canvas>`.

Vi ønsker å legge til **Candy Mania** som en 6. tile i lobbyen. Candy Mania er et HTML/JS-spill (React) som kjører som en iframe-overlay over Unity. Målet er at Candy Mania ser **identisk ut** med de andre 5 spilltilene — samme design, knapper, status-badges.

---

## 2. Hva som fungerer i dag

Disse delene er ferdig implementert og testet i produksjon:

### Iframe-overlay (`index.html`)
- `#game-overlay` — en fullskjerm iframe-container med z-index 900
- Åpnes via `openGameInIframe(url)` i JavaScript
- "Tilbake til lobby"-knapp lukker overlayet

### Wallet-bridge (PostMessage)
- Candy-iframen kommuniserer med lobbyen via `window.postMessage`
- Støttede meldinger: `candy:getBalance`, `candy:debit`, `candy:credit`, `candy:close`, `candy:ready`
- Lobbyen videresender til `/api/integration/wallet/*` endpoints

### Auto-login (candy-launch)
- `POST /api/integration/candy-launch` med Bearer-token
- Returnerer `embedUrl` med auto-login token for Candy
- Brukes når spilleren klikker på Candy-tilen

### Unity-til-JS kommunikasjon
- `SetPlayerToken(token)` — kalles av Unity etter login, setter `_playerToken`
- `OpenUrlInSameTab(url)` — kalles av Unity for å åpne spill i ny fane/iframe
- `window.unityInstance` — eksponert globalt for SendMessage-kall

### Auth-beacon polling
- `/api/integration/auth-beacon` polles hvert 3. sekund
- Oppdager innlogging og kaller `SetPlayerToken()` automatisk

### Render deploy
- `render.yaml` med alle env-variabler (timing, compliance, payout)
- Auto-deploy fra `main` via Render

---

## 3. Hva som har blitt forsøkt (og hvorfor det feilet)

### Forsøk 1: Enkel HTML-tile ved siden av Unity (PR #72)
**Tilnærming:** Legg til en frittstående HTML-div for Candy Mania plassert ved siden av Unity-canvasen.  
**Resultat:** Tilen så helt annerledes ut enn Unity-spillene. Uakseptabelt design-avvik.

### Forsøk 2: Dynamisk posisjonering over Unity-tiles (PR #73)
**Tilnærming:** Bruk `getBoundingClientRect` og `ResizeObserver` for å lese Unity-tilenes posisjoner og plassere Candy-tilen oppå det siste ledige sporet.  
**Resultat:** **Umulig.** Unity renderer tiles internt i WebGL-canvasen. Fra HTML/JavaScript kan vi kun lese canvasens ytre grenser (posisjon, størrelse), IKKE posisjonene til individuelle UI-elementer inne i Unity. `getBoundingClientRect` returnerer bare canvasens eget rektangel.

### Forsøk 3: Full HTML 3×2 grid overlay (PR #75-79)
**Tilnærming:** Bygg et komplett CSS Grid med alle 6 spill som HTML-tiles, plassert som `position: fixed; z-index: 100` over Unity-canvasen. Solid bakgrunn (`bg.png`) dekker Unity under. Klikk på Unity-spill bruker `SendMessage('UIManager', 'NavigateToGame', gameNumber)` for å navigere Unity programmatisk.

**Hva som ble gjort:**
1. Opprettet `external-games.js` med 3×2 CSS Grid, alle 6 tiles med identisk design
2. CSS-guard i index.html: skjul grid før innlogging (`body.player-authenticated`)
3. Unity-tiles brukte først `pointer-events: none` for click-passthrough (feilet)
4. La til `NavigateToGame(string)` metode i UIManager.cs (C#)
5. Rebuilt Unity WebGL med nye C#-metoder
6. Endret tiles til `pointer-events: auto` med SendMessage-navigasjon

**Resultater og problemer:**

| Problem | Årsak | Status |
|---------|-------|--------|
| Spill vises FØR innlogging | Auth-beacon finner gammel token, eller CSS-guard feiler | Uløst |
| HTML-grid dekker Unity komplett | `background: url(bg.png)` + `z-index: 100` skjuler alt under | By design, men problematisk |
| Unity-header skjult | `top: 12%` matcher ikke Unity sin header-høyde | Uløst |
| BingoBonanza-bilde kuttet | CSS Grid-layout passer ikke alle bilde-aspektforhold | Uløst |
| `NavigateToGame` ikke testet i prod | Unity-rebuild var fersk, testing ble avbrutt | Ukjent |

**Rollback:** HTML-gridet er nå fjernet (PR #80). Unity sin egen lobby fungerer normalt igjen.

---

## 4. Grunnleggende arkitekturproblem

**Unity WebGL renderer ALT internt i en `<canvas>`-element.**

Fra HTML/JavaScript kan vi:
- ✅ Se canvasens ytre grenser (posisjon, størrelse)
- ✅ Sende klikk-events til canvasen
- ✅ Kalle `unityInstance.SendMessage('GameObjectName', 'MethodName', param)` for C#-kommunikasjon

Fra HTML/JavaScript kan vi **IKKE**:
- ❌ Lese posisjonene til individuelle UI-elementer inne i Unity
- ❌ Style eller flytte Unity-tiles
- ❌ Vite nøyaktig hvor en tile er rendret på canvasen
- ❌ Garantere at HTML-elementer aligner med Unity-elementer

**SendMessage-begrensninger:**
- `SendMessage` bruker `GameObject.Find()` internt — finner KUN aktive GameObjects
- Spillorama sine lobby-paneler (`Panel - Lobby Game Selection`, `Panel - Top Bar Panel`, etc.) er **inaktive** (`m_IsActive: 0`) i scenen
- Løsning: Rute gjennom `UIManager` som alltid er aktiv (singleton) og har referanser til alle paneler
- `NavigateToGame()` ble lagt til UIManager.cs for dette formålet

---

## 5. Relevante filer

### Frontend (deploy-filene)
| Fil | Beskrivelse |
|-----|-------------|
| `bingo_in_20_3_26_latest/public/web/index.html` | Unity-loader, CSS-guard, auth, iframe-overlay, wallet-bridge |
| `bingo_in_20_3_26_latest/public/web/external-games.js` | Tom etter rollback — var HTML game grid |
| `bingo_in_20_3_26_latest/public/web/Build/Spillorama.*` | Unity WebGL build (inkluderer NavigateToGame) |
| `bingo_in_20_3_26_latest/public/web/TemplateData/style.css` | Unity container-styling |
| `bingo_in_20_3_26_latest/public/web/assets/games/` | Placeholder tile-bilder |

### Unity-prosjekt (gitignored, lokalt)
| Fil | Beskrivelse |
|-----|-------------|
| `Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs` | Singleton UI-manager, har `NavigateToGame()` og `ReturnToLobby()` |
| `Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LobbyGameSelection.cs` | Lobby game tiles, `OnGame1ButtonTap()` til `OnGame5ButtonTap()` |
| `Spillorama/Assets/_Project/_Scripts/Panels/TopBarPanel.cs` | Top bar med `OnGamesButtonTap()` |
| `Spillorama/Assets/_Project/_Scenes/Game.unity` | Hovedscene med alle UI-paneler |

### Backend
| Fil | Beskrivelse |
|-----|-------------|
| `bingo_in_20_3_26_latest/api/integration/` | Auth-beacon, candy-launch, wallet endpoints |
| `render.yaml` | Render deploy-config med env vars |

---

## 6. Unity C# API som er lagt til

Disse metodene ble lagt til i `UIManager.cs` og er inkludert i den nåværende WebGL-builden:

```csharp
// Kalles fra JavaScript via SendMessage('UIManager', 'NavigateToGame', '2')
public void NavigateToGame(string gameNumber)
{
    Debug.Log("NavigateToGame called from JS: game_" + gameNumber);
    if (gameNumber == "0")
    {
        topBarPanel.OnGamesButtonTap();
        return;
    }
    lobbyPanel.OpenGameSelectionPanel();
    StartCoroutine(NavigateToGameDelayed(gameNumber));
}

private IEnumerator NavigateToGameDelayed(string gameNumber)
{
    yield return null; // Vent 1 frame for panel-aktivering
    LobbyGameSelection gameSelection = lobbyPanel.GetComponentInChildren<LobbyGameSelection>(true);
    if (gameSelection != null)
    {
        gameSelection.gameObject.SetActive(true);
        switch (gameNumber)
        {
            case "1": gameSelection.OnGame1ButtonTap(); break;
            case "2": gameSelection.OnGame2ButtonTap(); break;
            case "3": gameSelection.OnGame3ButtonTap(); break;
            case "4": gameSelection.OnGame4ButtonTap(); break;
            case "5": gameSelection.OnGame5ButtonTap(); break;
        }
    }
}

public void ReturnToLobby()
{
    topBarPanel.OnGamesButtonTap();
}
```

**Viktig:** Disse C#-metodene er IKKE testet i produksjon ennå. De ble nettopp lagt til og Unity ble rebuilt, men HTML-gridet som skulle bruke dem ble rullet tilbake.

---

## 7. Aktive GameObjects (bekreftet via brute-force testing)

Følgende GameObjects er aktive ved oppstart og kan nås via `SendMessage`:

| GameObject | Har metoder for navigasjon? |
|------------|---------------------------|
| `UIManager` | ✅ Ja — `NavigateToGame()`, `ReturnToLobby()` (nylig lagt til) |
| `LandingScreen` | Nei — login/registrering |
| `ExternalCallClass` | Nei — Firebase/deep links |
| `ProcessDeepLinkMngr` | Nei — deep link håndtering |
| `Managers` | Nei — GameSocketManager etc. |
| `FirebaseManager` | Nei — push notifications |

Følgende er **INAKTIVE** og kan **IKKE** nås via SendMessage:
- `Panel - Lobby Game Selection` (har `OnGame1ButtonTap()` etc.)
- `Panel - Top Bar Panel` (har `OnGamesButtonTap()`)
- `Panel - Lobby`
- Alle andre Panel-GameObjects

---

## 8. Anbefalte veier videre

### Alternativ A: Legg til Candy som 6. tile i Unity (anbefalt)

Endre Unity-prosjektet til å ha 6 tiles i stedet for 5. Candy-tilen kaller `Application.ExternalCall()` eller en JS-funksjon som åpner iframe-overlayet.

**Fordeler:**
- Perfekt visuell integrasjon — alle tiles rendret av Unity
- Ingen alignment-problemer
- Login-gating håndteres av Unity selv

**Ulemper:**
- Krever Unity Editor-tilgang og C#-kompetanse
- Krever rebuild av WebGL etter endring

**Konkrete steg:**
1. Åpne `Game.unity` i Unity Editor
2. Finn `Panel - Lobby Game Selection` og dupliser en eksisterende tile
3. Sett opp bilde, tekst og onClick-event for Candy
4. I C# (f.eks. `LobbyGameSelection.cs`), legg til `OnGame6ButtonTap()` som kaller en JS-funksjon
5. JS-funksjonen kaller `openGameInIframe('/candy/')` (allerede implementert i index.html)
6. Build WebGL og deploy

### Alternativ B: Enkel Candy-knapp utenfor canvasen

Plasser en HTML-knapp for Candy utenfor Unity-canvasens område (f.eks. under canvasen, i en sidebar, eller som en flytende knapp).

**Fordeler:**
- Enkelt å implementere, ingen Unity-endringer
- Ingen risiko for å bryte eksisterende lobby

**Ulemper:**
- Candy ser annerledes ut enn Unity-tilene
- Ikke "integrert" visuelt

### Alternativ C: Hybrid med visibilitetskontroll

Gjenopprett HTML-gridet MEN gjør det riktig:
1. La Unity rendere sin egen lobby normalt (ingen solid bakgrunn)
2. Bruk `SendMessage('UIManager', 'HideLobbyTiles')` for å be Unity skjule sine egne tiles
3. Vis HTML-gridet BARE når Unity har bekreftet at tiles er skjult
4. Klikk navigerer via `SendMessage` (allerede implementert)

**Fordeler:**
- Full visuell kontroll fra HTML
- Candy ser identisk ut med andre spill

**Ulemper:**
- Krever ny C# metode (`HideLobbyTiles`) i Unity
- Kompleks timing mellom Unity og HTML
- Auth-gating må løses robust

---

## 9. Kjente uløste problemer

1. **Auth-beacon gir falske positiver** — pollingen på `/api/integration/auth-beacon` kan finne gamle tokens og sette `player-authenticated` før brukeren faktisk er logget inn. Bør undersøkes/fikses.

2. **Unity WebGL bygget inneholder `NavigateToGame`** — den nåværende WebGL-builden (i `Build/`) inneholder de nye C#-metodene, men de er ubrukte siden HTML-gridet er fjernet. De gjør ingen skade men brukes heller ikke.

3. **Tile-bilder** — placeholder-bildene i `assets/games/` matcher ikke Unity sine egne spillbilder. Hvis HTML-grid brukes igjen, trenger disse oppdateres.

---

## 10. Nøkkelkode i index.html som MÅ beholdes

Disse funksjonene i `index.html` er kritiske og brukes av Candy-integrasjonen:

- `SetPlayerToken(token)` — linje 419-427
- `openGameInIframe(url)` — linje 351-387
- `closeGameOverlay()` — linje 403-411
- `_loadIframe()` — linje 389-401
- Wallet bridge (`window.addEventListener('message', ...)`) — linje 435-514
- `OpenUrlInSameTab(url)` — linje 516-534
- `window.unityInstance = unityInstance` — linje 224

---

## 11. Slik tester du endringer

1. Push til en branch, lag PR mot `main`
2. CI-sjekker (backend + compliance) må passere
3. Squash-merge til `main`
4. Render auto-deployer innen ~2-3 minutter
5. Test på `https://bingo-system-jsso.onrender.com/web/`
6. Åpne browser DevTools (F12) → Console for `[BIN-134]` logger

**Merk:** Det finnes ingen lokal dev-server for Unity WebGL. All testing skjer i produksjon.

---

## 12. Git-historikk (relevante PRs)

| PR | Tittel | Status |
|----|--------|--------|
| #72 | Candy Mania tile (enkel) | Merget |
| #73 | Dynamisk posisjonering | Merget |
| #74 | Disable auto-trigger deploy | Merget |
| #75 | Full HTML game grid | Merget |
| #76 | Pointer-events passthrough | Merget |
| #77 | Debug diagnostikk | Merget |
| #78 | Expose unityInstance globalt | Merget |
| #79 | NavigateToGame + SendMessage | Merget |
| #80 | **Rollback — fjern HTML-grid** | Denne PR-en |
