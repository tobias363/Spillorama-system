# Spill 1 — Shell-redesign & Live Data-kobling

> **Dato:** April 2026  
> **Scope:** Web-shell UI for Spill 1 (Bingo Game 1) — topbar, ball-farger, billettvisning, Unity-bridge

---

## Bakgrunn

Spill 1 kjører som en Unity WebGL-app embed i web-shellet (`index.html`). Tidligere lå all UI-logikk i Unity Canvas, noe som krevde ~10 min WebGL-build for enhver visuell endring. Målet var å:

1. Flytte navigasjons-UI (topbar) til HTML/CSS for rask iterasjon
2. Koble live spilldata fra Unity til shellet via `Application.ExternalEval`
3. Fikse ball-farger og billettvisning

---

## Endrede filer

| Fil | Type |
|-----|------|
| `backend/public/web/index.html` | HTML + CSS + JS |
| `backend/public/web/lobby.js` | JavaScript |
| `Spillorama/Assets/_Project/_Scripts/Bridge/SpilloramaGameBridge.cs` | C# (Unity) |
| `Spillorama/Assets/_Project/_Scenes/Game.unity` | Unity Scene |

---

## 1. Ball-farger (Unity Canvas)

**Problem:** Trukne baller i bingobrettet viste feil farge — alle ble hvite/nøytrale.

**Fix:** Baller farges nå etter BINGO-kolonne i Unity:

| Kolonne | Tall | Farge |
|---------|------|-------|
| B | 1–15 | Blå |
| I | 16–30 | Rød |
| N | 31–45 | Lilla |
| G | 46–60 | Grønn |
| O | 61–75 | Gul |

---

## 2. Ingen tomme standardbilletter

**Problem:** Billett-området viste placeholder-billetter ved oppstart, selv før spilleren hadde kjøpt noe.

**Fix:** Billettlisten er nå tom inntil backend sender faktiske kjøpte billetter. Unity-panelet rendres ikke før `OnSubscribeRoom` leverer reelle billettdata fra `SpilloramaGameBridge`.

---

## 3. Unity Canvas — Pattern Container (Game.unity)

**Problem:** Pattern Container hadde ødelagt anchor-oppsett (`anchorMin:(0,1), anchorMax:(1,1)`) som ga full-bredde stretch og feil posisjonering.

**Fix via Coplay MCP:**
```
anchorMin: (0, 1)
anchorMax: (0, 1)
anchoredPosition: (760, 0)
sizeDelta: (250, 192)
```

---

## 4. HTML Game Top Bar

### Konsept

I stedet for en tung Unity-overlay valgte vi en ren HTML/CSS-bar som er fast posisjonert over Unity-canvasen. Fordel: all styling endres i editoren uten ny WebGL-build.

### Arkitektur

```
[body]
  ├── #lobby-screen          (lobby — skjules når spill startes)
  ├── #unity-container       (Unity WebGL canvas — vises under baren)
  ├── #lobby-back-bar        (HTML game-topbar — fast over Unity)
  └── #spillvett-fab         (Spillvett-knapp)
```

### Posisjonering

`#unity-container.unity-desktop` overstyrer `TemplateData/style.css` slik at Unity alltid starter under baren:

```css
#unity-container.unity-desktop {
  position: fixed !important;
  top: 80px !important;              /* høyde på game-baren */
  left: 0; right: 0; bottom: 0;
  width: 100%;
  height: calc(100vh - 80px) !important;
  transform: none !important;        /* fjerner TemplateData sin translate(-50%,-50%) */
}
```

### Layout — game-baren

```
[Logo]  [|]  [← Tilbake til lobby]        [spill-navn]        [🏠 Hall-select]  [● Saldo]  [Lommebok]
 ←── game-bar-left ──────────────→  ←── game-bar-title ──→  ←────── game-bar-right ──────────────→
```

**CSS-nøkler:**
```css
.lobby-back-bar {
  height: 80px;
  padding: 0 50px;    /* samme horisontale luft som lobby-topbar */
  background: linear-gradient(180deg, #5c1010 0%, #3d0d0d 100%);
}
```

Gjenbruker eksisterende lobby-klasser direkte:
- `.lobby-topbar-hall-wrap` / `.lobby-topbar-hall` — hall-selector
- `.lobby-balance-chip` — saldo-chip
- `.lobby-wallet-btn` — Lommebok-knapp
- `.lobby-topbar-divider` — vertikal skillelinje

---

## 5. Hall-selector i game-baren

Hall-selectoren i baren er **fullt interaktiv** — identisk oppførsel som i lobby.

### Dataflyten

```
lobbyState.halls
    │
    ├─► renderHallSelect(#lobby-hall-select)      ← lobby-topbar
    └─► renderHallSelect(#game-bar-hall-select)   ← game-topbar
              │
              └─► onChange → switchHall(hallId)
                      ├─► lobbyState.activeHallId oppdateres
                      ├─► sessionStorage('lobby.activeHallId')
                      ├─► window.SetActiveHall()          → spillvett.js
                      ├─► window.SwitchActiveHallFromHost() → Unity (ny!)
                      └─► renderLobby()
```

**Ny helper i `lobby.js`:**
```javascript
function renderHallSelect(el) {
  // Populerer enhver <select> med lobbyState.halls
  // og setter riktig selected-verdi
}
```

Begge selects initialiseres med én `addEventListener` i `initLobby()`:
```javascript
['lobby-hall-select', 'game-bar-hall-select'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', function() {
    switchHall(this.value);
  });
});
```

---

## 6. Saldo-synkronisering

Når Unity-spillet starter, kopieres saldo fra lobby-topbaren til game-baren:

```javascript
window.syncGameBar = function() {
  // Kopierer tekst fra #lobby-balance → #game-bar-balance
};
```

Kalles automatisk fra `loadUnityAndStartGame()` i `lobby.js` — både ved første load og ved retur til allerede lastet Unity.

---

## 7. Unity → HTML Bridge (`SpilloramaGameBridge.cs`)

Unity sender spilldata til HTML-shellet via `Application.ExternalEval` på to triggere:

| Trigger | Kall |
|---------|------|
| `room:update` mottatt | `PushHeaderToShell(snap)` |
| `draw:new` mottatt | `PushHeaderToShell(snap, draw.number)` |

**Data som sendes (JSON):**
```json
{
  "gameName": "Spill 3: Jackpot",
  "playerName": "Tobias",
  "activePlayers": 12,
  "lastBall": 54,
  "ballCount": 16,
  "maxBalls": 75,
  "bet": "40",
  "profit": "0",
  "prizeRows": [
    { "label": "Rad 1", "amount": "600 kr" },
    { "label": "Rad 2", "amount": "1400 kr" }
  ],
  "jackpotLabel": "16 Jackpot : 5000 kr",
  "patternName": "Rad 1"
}
```

**JS-mottaker i `index.html`:**
```javascript
window.SpilloramaUpdateHeader = function(jsonStr) {
  var d = JSON.parse(jsonStr);
  if (d.gameName) {
    document.getElementById('game-bar-name').textContent = d.gameName;
  }
};
```

> **Merk:** `SpilloramaShowHeader` er beholdt som en no-op for bakoverkompatibilitet — Unity C# kaller den fortsatt men den gjør ingenting siden bar-visibiliteten styres utelukkende av `lobby.js`.

---

## 8. Returnere til lobby

```javascript
window.returnToShellLobby = function() {
  lobbyEl.style.display = '';          // vis lobby igjen
  unityContainer.style.display = 'none';
  backBar.classList.remove('is-visible');
  document.getElementById('game-bar-name').textContent = '';  // tøm spillnavn
  loadLobbyData();                     // refresh saldo/data
};
```

---

## Arkitekturavgjørelser

| Valg | Alternativ | Begrunnelse |
|------|-----------|-------------|
| HTML topbar | Unity UI topbar | Ingen 10-min build for UI-endringer |
| `Application.ExternalEval` fra Unity | Web shell kobler til socket direkte | Unngår dobbel socket-tilkobling og auth-problemer |
| Gjenbruk av lobby CSS-klasser | Egne game-bar-klasser | Konsistent design, halvparten så mye CSS |
| `switchHall()` varsler Unity | Separat Unity-hall-logikk | Hall-bytte i game-baren virker live uten reload |

---

## Ikke gjort (fremtidig arbeid)

- [ ] Saldo i game-baren oppdateres ikke live under spillet (kun ved oppstart)
- [ ] `PushHeaderToShell` i C# sender fortsatt alle felt selv om JS kun bruker `gameName` — kan ryddes
- [ ] Lommebok-knappen i game-baren navigerer tilbake til lobby i stedet for å åpne lommeboken direkte
- [ ] Lucky number-tracking i bridge (feltet finnes i JSON-skjemaet men settes ikke ennå)
