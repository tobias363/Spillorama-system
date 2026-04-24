# Legacy TV-skjerm Design-spec — 2026-04-24

**Formål:** Ekstrahert fra Unity-kildekode (commit `5fda0f78`) for å gi Tobias
komplett oversikt over hvilke UI-elementer og dynamiske atferd som TV-skjermen
(BingoHallDisplay) hadde, slik at nytt web-TV-design kan matche funksjonelt
og vurdere visuell paritet bevisst (jf. Unity-paritet-regel: funksjonell 1:1,
visuell polish er web-teams valg med dokumentert avvik).

**Scope:** Kun UI-struktur, data-bindinger, state-transitions og dynamisk
oppførsel. Nettverkslaget (Socket.IO-broadcasts) er ikke dekket i detalj, kun
nevnt som triggers for UI-endringer.

**Kilder:**
- `legacy/unity-client/Assets/_Project/_Scripts/Panels/BingoHallDisplay.cs` (1881 linjer — hovedkontroller)
- `legacy/unity-client/Assets/_Project/_Scripts/Panels/BingoHallDisplay.SpilloramaFlow.cs` (partial class, ny bridge-integrasjon)
- `legacy/unity-client/Assets/_Project/_Scripts/Core/ScreenSaverManager.cs`
- `legacy/unity-client/Assets/_Project/_Scripts/Panels/Bingo Hall Display/ClaimWinnerPanel.cs`
- `legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Admin Bingo Hall Display/*.cs` (9 filer)
- `legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Game Panel 2/PrefabJackpotPanel.cs`
- `legacy/unity-client/Assets/_Project/_Scripts/Data/Constants.cs` (GAME_STATUS enum, LanguageKey)

---

## 1. Hovedkontroller (`BingoHallDisplay.cs`)

### 1.1 Felt — Serialized fra Unity Editor

Alle `[SerializeField]`-felter med formål og rolle i UI:

| Felt | Type | Rolle |
|---|---|---|
| `muteImg` | `Sprite` | Ikon for mutet tilstand |
| `unmuteImg` | `Sprite` | Ikon for unmutet tilstand |
| `soundBtn` | `Button` | Mute/unmute-knapp (øvre høyre hjørne) |
| `bingoBtn` | `Image` | BINGO-knapp (selv ikke klikkbar på TV, men viser grey/yellow visuell indikator) |
| `bingoBtnYellow` | `Sprite` | Aktiv BINGO-sprite (gul) |
| `bingoBtnGrey` | `Sprite` | Pauset BINGO-sprite (grå) |
| `panelLiveRoomData` | `GameObject` | Hovedpanel for live game-data (drawn counter, balls, patterns) |
| `ExitBtn` | `GameObject` | Exit-knapp, kun synlig hvis `DeviceType` er ikke-tom |
| `panelResult` | `GameObject` | Resultatpanel — vises etter GameFinish |
| `panelRowWinner` | `GameObject` | Panel for ticket-winner-detaljer (vises når det finnes winningTickets) |
| `txtTotalNumbersWithdrawn` | `TextMeshProUGUI` | "Totalt trukne tall" (talltelleren) |
| `txtFullHouseWinners` | `TextMeshProUGUI` | Antall Fullt-hus-vinnere |
| `txtPatternsWon` | `TextMeshProUGUI` | Antall vunne patterns |
| `txtCurrentLanguage` | `TextMeshProUGUI` | Viser aktiv stemme-språk ("Norwegian Male" / "Norwegian Female" / "English") |
| `bingoBallPanelManager` | `BingoBallPanelManager2` | Kontroller for ball-animasjon (stor ball + 5 små) |
| `claimWinnerPanel` | `ClaimWinnerPanel` | Panel for claim-winner-verifisering (se §8) |
| `prefabWinnerDetails` | `PrefabHallDispalyPatternDetails` | Prefab for pattern-rad med detaljer (§6) |
| `transformContainer` | `Transform` | Parent for instansierte pattern-rader |
| `roomId` / `gameId` | `string` | IDs for aktiv room/game |
| `adminSocket` | `Socket` | Socket.IO-referanse til admin-namespace |
| `gameStatus` | `GAME_STATUS` | Enum: `Waiting` / `Running` / `Finished` (fra `Constants.cs:317-322`) |
| `jackPotData` | `JackPotData` | Jackpot-tilstand (draw-count, prize-array for animasjon) |
| `prefabWinnerDetailsList` | `List<PrefabHallDispalyPatternDetails>` | Alle instansierte pattern-rader |
| `ticketWinnerDisplay` | `ticketWinner` | 5×5 bingo-brett som viser vinner-tall |
| `Timer_PopUP` | `GameObject` | Container for countdown-popup |
| `Counter_Txt` | `TMP_Text` | "Vent på X game start" / "X spill starter om NN" (lokalisert) |
| `NextGame_Counter_Txt` | `TMP_Text` | "Neste spill om MM:SS" — aktiv countdown med sekunder |
| `Winner_Prefab` | `AdminTVScreenWinners` | Prefab for vinner-rad (§2) |
| `Winners_List` | `List<AdminTVScreenWinners>` | Alle instansierte vinner-rader |
| `Winners_Parent` | `RectTransform` | Parent for vinner-rader med dynamisk høyde |
| `Game_Name_Txt` | `TMP_Text` | Spillnavn (ikke brukt i current code) |
| `Current_Game_Name_Txt` | `TMP_Text` | "Spiller nå: {gameName}" (lokalisert) |
| `Next_Game_Name_Txt` | `TMP_Text` | "Neste: {gameName}" — skjules hvis tom |
| `Game_Count_Txt` | `TMP_Text` | "Spill #{gameCount}" (lokalisert) |
| `Ball_Drawn_Count_Txt` | `TMP_Text` | Stor talltelleren: "antall trukket" |
| `Ball_Drawn_Display` | `GameObject` | Parent for ball-display (toggles når timer er aktiv) |
| `MiniGamesParent` | `GameObject` | Container for mini-game-paneler |
| `wheelOfFortunePanel` / `fortuneWheelManager` / `newFortuneWheelManager` | `WheelOfFortunePanel` / `FortuneWheelManager` / `NewFortuneWheelManager` | Hjul-mini-game |
| `treasureChestPanel` | `TreasureChestPanel` | Skattekiste-mini-game |
| `mysteryGamePanel` | `MysteryGamePanel` | Mystery-mini-game |
| `colorDraftPanel` | `ColorDraftPanel` | Color Draft-mini-game |
| `PanelMiniGameWinners` | `PanelMiniGameWinners` | Vinnerliste for mini-games (§3) |
| `BackgroundSprite` | `Sprite` | Felles bakgrunn brukt som prop til mini-games |

### 1.2 State-maskin

Enum definert i `Constants.cs:317-322`:

```csharp
public enum GAME_STATUS
{
    Waiting,
    Running,
    Finished
}
```

Status-transitions og UI-effekter (observert i `BingoHallDisplay.cs`):

| State | Visible UI | Trigger |
|---|---|---|
| `Waiting` | `Timer_PopUP` + `Counter_Txt` aktiv, `Ball_Drawn_Display` skjult, `panelLiveRoomData` skjult | Initial / etter `Reset()` |
| `Running` | `panelLiveRoomData` åpen, `Ball_Drawn_Display` aktiv, `Timer_PopUP` skjult | Etter første ball-withdraw eller countDownToStartTheGame→0 |
| `Finished` | `panelResult` åpen, `Winners_List` instansiert, `panelLiveRoomData` lukket | `OnGameFinish` (`BingoHallDisplay.cs:779`) |

Sub-states (ikke i enum, men sidetilstander):
- **Countdown til neste spill:** `NextGame_Counter_Txt` aktiv, teller ned i MM:SS
- **Mini-game aktiv:** `MiniGamesParent.SetActive(true)`, et av fire mini-game-paneler åpnet
- **Claim winner popup:** `claimWinnerPanel.Open()` på toppen — utløst av `playerClaimWinner`-broadcast
- **Paused:** Trigget av `toggleGameStatus` med `status="Pause"` — alle mini-games får `isPaused = true`

### 1.3 Initialization-flyt (`Awake` / `OnEnable` / `Start`)

`BingoHallDisplay.cs:155-209`:

1. `Awake()`: `HardReset()` + `Reset()` — rydder all pattern/winner-list
2. `OnEnable()`:
   - `SoundManager.Instance.TvScreenSoundStatus = false` (mute som default)
   - `soundBtn.image.sprite = muteImg`
   - `bingoBtn.sprite = bingoBtnYellow`
   - Lese språk-preferanse fra `PlayerPrefs` (`LanguagePrefKey = "CurrentLanguage"`)
   - `SwitchLanguage()` — setter `currentLanguage` basert på prefs
   - Abonnere på socket-reconnect
   - Lukke `panelLiveRoomData`, `panelResult`, `claimWinnerPanel`
   - `Application.ExternalCall("requestGameData")` — be vertsside (web/app) om game-data
   - `Application.ExternalCall("sendDeviceTypeToUnity")` — spør om device-type
3. På `AdminHallDisplayRoomIdCall` (ekstern JS-call): lagre `roomId`, `HallId`, `DeviceType`, kall `EnableBroadcasts()` og `AdminLoginEventCall()`
4. `AdminLoginEventCall()` → `CallAdminLoginEventWithDelay` (1 sek delay) → `EventManager.Instance.AdminHallDisplayLogin` → socket emit `AdminHallDisplayLogin` med `roomId` + `HallId`

### 1.4 Events / broadcast-triggers

Alle fra `EnableBroadcasts()` (`BingoHallDisplay.cs:217-246`):

| Event | Handler | UI-effekt |
|---|---|---|
| `SubscribeRoomAdmin` | `OnSubscribeRoom` | Full state-rebuild (gameName, counter, patterns, winnings, withdrawn-list) |
| `WithdrawBingoBall` | `OnWithdrawBingoBall` | Ball-animasjon, øk teller, skjul Timer_PopUP |
| `BingoWinningAdmin` | `OnBingoWinning` | Legg til pattern-winner i listen + `data` cache |
| `GameFinishAdmin` | `OnGameFinish` | Switch til panelResult, bygg Winners_List |
| `TVScreenGameRefreshRoom` (`adminRefreshRoom`) | `Refresh_Room` | Refresh hele panelet |
| `countDownToStartTheGame` | `OnCountDownToStartTheGame` | Start countdown Counter_Txt |
| `ActivateMiniGame` | `OnActivateMiniGame` | Åpne riktig mini-game-panel (switch på `miniGameType`) |
| `adminExtraGameNoti` | `adminExtraGameNoti` | Popup for ekstra-spill-vinner (currently disabled via `// UIManager...DisplayPopup`) |
| `toggleGameStatus` | `On_Admin_toggleGameStatus` | Pause/Resume alle mini-game-paneler, spille BINGO-lyd |
| `BingoAnnouncement` | `OnBingoAnnouncement` | Spille BINGO-lyd + `DisplayBigBallOnWin` |
| `nextGameStartCountDownTime` | `OnnextGameStartCountDownTime` | Parse UTC-dato, start `StartCountdown` coroutine på NextGame_Counter_Txt |
| `playerClaimWinner` | `OnplayerClaimWinner` | `claimWinnerPanel.SetData(claimWinningResponse)` |
| `PatternChange` | `OnPatternChange` | Oppdater `jackPotData` på alle pattern-prefabs |

### 1.5 Knapper og interaktivitet

Selv om TV-en er passiv (kiosk-skjerm), finnes disse knappene i UI:

| Knapp | Kode-referanse | Funksjon |
|---|---|---|
| `soundBtn` (Mute/Unmute) | `MuteUnmuteBtnTap()` (`BingoHallDisplay.cs:212-222`) | Toggler `SoundManager.Instance.TvScreenSoundStatus`, bytter sprite |
| `ExitBtn` | `OnExitButtonTap()` (`BingoHallDisplay.cs:277-295`) | Åpner `spillorama://open` (Android/iOS) eller `Application.ExternalCall("openSpilloramaTab")` (web) |
| Language next/prev | `nextButtonTap(bool isNextTap)` (`BingoHallDisplay.cs:1339-1378`) | Rotere mellom 3 språk: 0 = Norwegian Male, 1 = Norwegian Female, 2 = English. Persisteres i `PlayerPrefs` med nøkkel `CurrentLanguage` |
| BINGO-knappen | `OnBingoBtnTap()` (`BingoHallDisplay.cs:248-276`) | Kaller `EventManager.Instance.StopGameByPlayers` — i praksis ikke brukt på TV (kun visuell). Merk: `BingoButtonColor()` er commented out i koden |

### 1.6 Språk-håndtering

Tre språk støttet via `PlayerPrefs["CurrentLanguage"]` (int 0/1/2):

```csharp
public enum soundlanguage {
    English,
    NorwegianFemale,
    NorwegianMale,
}
```

Default ved init: `currentLanguage = "Norwegian Male"` (`BingoHallDisplay.cs:142`).

Metoder:
- `PlayNorwegianMaleAudio()` / `PlayNorwegianFemaleAudio()` / `PlayEnglishAudio()` setter `currentLanguage` string
- `SetGameLanguage(string language)` mapper `"en"` → `"en-US"`, `"nor"` → `"nb"` og setter `LocalizationManager.CurrentLanguageCode`

---

## 2. Vinner-panel (`AdminTVScreenWinners.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Admin Bingo Hall Display/AdminTVScreenWinners.cs`

Prefab som instansieres én per vunnet pattern på resultat-siden. Vises i `Winners_Parent` (vertikal stack).

### 2.1 UI-felter

| Felt | Rolle |
|---|---|
| `RT` | `RectTransform` — for programmatisk plassering og resize |
| `Patterns_Txt` | Pattern-navn (lokalisert: "Rad 1", "Bilde", "Ramme", "Fullt hus") |
| `Winner_Count_Txt` | Antall vinnere for denne patternen |
| `Won_amount_Txt` | Totalt vunnet beløp |
| `Hall_Specific_Winner_Txt` | Halls joined med `" | "` separator |
| `ticketid__Winings_Txt` | Multi-line text med alle spillerdetaljer |

### 2.2 Pattern-navn-mapping

```csharp
if (pattern == "Row 1"..."Row 4")
  → "TextDataSubRow" + " " + pattern.Split(' ')[1]  // "Rad 1", "Rad 2", etc.
else if "Picture" → "TextDataSubPicture"  // "Bilde"
else if "Frame"   → "TextDataSubFrame"    // "Ramme"
else if "Full House" → "Full House"        // "Fullt hus"
```

Localization-nøkler er i `I2.Loc.LocalizationManager`. Nøkkelnavn (`TextDataSubRow`, `TextDataSubPicture`, `TextDataSubFrame`) er strenger som løses mot I2-oversettelsestabell.

### 2.3 Ticket-ID-format

Per spiller bygges en linje:
```
Id : {ticketNumber} ({wonAmount} kr) ({userType})
```

Lagres i `StringBuilder` og settes som tekst på `ticketid__Winings_Txt`. Merk **ingen dedikert formatering** — bare konkatenering med linjeskift.

### 2.4 Dynamisk høyde

`UpdateColumn(List<PlayerIdArray> playerIdArray)` øker `RT.sizeDelta.y` med **80px per 2 vinnere** (counter > 2).

```csharp
if (++counter > 2)
{
    RT.sizeDelta = new Vector2(RT.sizeDelta.x, RT.sizeDelta.y + 80f);
    counter = 0;
}
```

### 2.5 Instansiering og stacking

I `BingoHallDisplay.OnGameFinish()` og `OpenResultPanel()`:

```csharp
winner.RT.anchoredPosition = new Vector2(
    0f,
    -(10 + (i * winner.RT.rect.height) + (i * 10))
);
```

Winners_Parent høyde settes:
```csharp
Winners_Parent.sizeDelta = new Vector2(
    Winners_Parent.sizeDelta.x,
    (Winners_List.Count * Winner_Prefab.RT.rect.height) + (Winners_List.Count * 10) + 20
);
```

Top-offset er 10px, padding mellom rader 10px, bunn-padding 20px.

---

## 3. Mini-game-vinnere (`PanelMiniGameWinners.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Admin Bingo Hall Display/PanelMiniGameWinners.cs`

Vises etter mini-game (Wheel/TreasureChest/Mystery/ColorDraft). Bruker `PrefabMiniGameWinPlayerDetails` per vinner.

### 3.1 Datakategorier (tre typer vinnere)

Fra `WinningTicketNumbers`:
- `physicalWinners` (fysiske tickets i lokalet)
- `onlineWinners` (online spillere)
- `uniqueWinners` (unike vinnere på tvers, merk: feltnavnet brukes men ikke dokumentert)

### 3.2 Prefab-data (`PrefabMiniGameWinPlayerDetails.cs`)

```csharp
public void SetData(string playerType, string ticketNumber, int winningAmount)
{
    txtPlayerType.text = playerType;        // "Physical" / "Online" / "Unique"
    txtTicketNumber.text = ticketNumber;
    txtWinningAmount.text = winningAmount.ToString() + " kr";
}
```

### 3.3 Auto-refresh (`Auto_Refresh_Lobby`)

Etter 7 sekunder: forvent at `bingoHallDisplayPanel` deaktiveres og reaktiveres (hard refresh av hele TV-skjermen).

```csharp
IEnumerator Auto_Refresh_Lobby()
{
    float time = 7f;
    while (time > 0f) { time -= Time.deltaTime; yield return new WaitForEndOfFrame(); }
    UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(false);
    UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(true);
}
```

### 3.4 Reset

```csharp
public void Reset() {
    if (PlayerDetailsContainers.childCount > 0)
        foreach (Transform child in PlayerDetailsContainers)
            Destroy(child.gameObject);
}
```

---

## 4. Claim-ticket-prefab (`ClaimWinnerTicket.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Admin Bingo Hall Display/ClaimWinnerTicket.cs`

Viser en fysisk ticket som 5×5-brett med tall. Brukes inne i `ClaimWinnerPanel` (§8).

### 4.1 Struktur

5 rader × 5 kolonner = 25 felt. Hver rad er en `List<TextMeshProUGUI>` av 5 celler:
- `txtRow1` / `txtRow2` / `txtRow3` / `txtRow4` / `txtRow5`

### 4.2 Data-mapping

```csharp
for (int i = 0; i < resp.ticket.Count; i++)
{
    int number = resp.ticket[i].Number;
    bool show = resp.ticket[i].show;
    int group = i / 5;  // 0-4 → rad 1-5
    // Append til riktig rad
}
```

Hver celle har to aspekter:
- `.text = number.ToString()` — tallet
- `.gameObject.SetActive(show)` — synlig hvis trukket/matched

### 4.3 Midtcelle-håndtering

Rad 3 (midtraden) har spesialhåndtering for `j == 2` (senter på 5×5):
```csharp
if (j != 2) {
    txtRow3[j].text = Row3Count[j].ToString();
    txtRow3[j].gameObject.SetActive(Row3Show[j]);
}
```

Dette indikerer at **midtcellen er en "free space"** (ikke tall-overskrevet, beholder sin egen asset fra prefab).

---

## 5. Missede claims (`MissedWinningClaimsData.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Admin Bingo Hall Display/MissedWinningClaimsData.cs`

Viser unclaimed wins (ticket som kunne vunnet, men spiller sjekket ikke inn).

### 5.1 UI-felt

| Felt | Rolle |
|---|---|
| `txtWinningPattern` | Pattern-navn (lokalisert som §2.2) |
| `txtLastMatchedBall` | Siste ball som matchet pattern |
| `txtDrawCountWhenPatternMissed` | Ball-nr i draw-rekkefølgen da pattern ble komplett |
| `txtTotalDrawCount` | Totalt antall trukne baller |

### 5.2 Bruk

Instansieres fra `ClaimWinnerPanel.SetMissedWinningClaimsData()` i en liste med alle unclaimed winners for den aktuelle ticket.

---

## 6. Pattern-detaljer (`PrefabHallDispalyPatternDetails.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Admin Bingo Hall Display/PrefabHallDispalyPatternDetails.cs`

Prefab per pattern i live-paneler (Row 1/Row 2/Row 3/Row 4/Picture/Frame/Full House).

### 6.1 UI-felt

| Felt | Rolle |
|---|---|
| `patternName` | Pattern-tittel (lokalisert) |
| `playerCount` | Antall som vant denne patternen |
| `prize` | Premiebeløp (string: `"{prize} kr"`) |
| `jackpotDrawCount` | Kun vist for "Full House" i visse spill (Innsatsen, Oddsen 56/57/58, Jackpot) |
| `HighLight` | `Image` som åpnes/lukkes for å markere aktiv pattern |
| `btn` | `Button` for interaksjon (enables/disables basert på fremdrift) |

### 6.2 Data-mapping

```csharp
public void SetData(AdminDashboardWinningData data)
{
    // Pattern-navn lokaliseres som §2.2
    playerCount.text = data.winnerCount.ToString();
    prize.text = data.prize.ToString() + " kr";
}
```

### 6.3 Jackpot-modus

I `SetJackPotData(JackPotData Data)`, for `Full House` og spill-navn i listen `{"Innsatsen", "Oddsen 56/57/58", "Jackpot"}`:

```csharp
jackpotDrawCount.gameObject.SetActive(jackPotData.isDisplay);
jackpotDrawCount.text = Data.draw.ToString();

if (Data.prizeArray != null && Data.prizeArray.Count > 0)
    prizeAnimationCoroutine = StartCoroutine(AnimatePrizeText(Data.prizeArray));
else
    prize.text = Data.tvScreenWinningAmount.ToString() + " kr";
```

Animasjon (`AnimatePrizeText`) roterer gjennom `prizeArray` med 2 sekunders mellomrom (continuous loop):

```csharp
while (true) {
    prize.text = prizeArray[index].ToString() + " kr";
    index = (index + 1) % prizeArray.Count;
    yield return new WaitForSeconds(2f);
}
```

### 6.4 HighLight + btn interactable-logikk

Fra `BingoHallDisplay.GenerateBingoWinningList()` (`BingoHallDisplay.cs:1627-1656`):

- Alle patterns som allerede er vunnet (`i < patternsWon`): `btn.interactable = false`
- Neste pattern i rekkefølgen: `HighLight.Open()` + `btn.interactable = true`
- Resten: `HighLight.Close()`, ikke interagérbare

Dette gir **visuell fremdrift**: aktiv pattern blinker/highlightes, tidligere er dim.

---

## 7. Jackpot-panel (`PrefabJackpotPanel.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Game Panel 2/PrefabJackpotPanel.cs`

(Dette er teknisk sett en Game Panel 2-prefab, men brukes til jackpot-visning også i TV-kontekst. Koden er generell.)

### 7.1 UI-felter

| Felt | Rolle |
|---|---|
| `txtType` | "Jackpot" eller "Gevinst" (basert på `data.type`) |
| `txtNumber` | Jackpot-nummer (string) |
| `txtPrize` | Premiebeløp |
| `transformContainer` | Parent for rotasjon-animasjon |
| `Jackpot_CG` | `CanvasGroup` (for fade-in via alpha) |
| `Number_Container` | Container for nummer-boks (skaleres ved animasjon) |

### 7.2 Type-mapping

```csharp
txtType.text = LocalizationManager.GetTranslation(
    data.type.Equals("jackpot") ? "Jackpot" : "gain"
);
```

### 7.3 Animasjon

`PlayJackpotAnimation()`:
1. Rotere `transformContainer` fra `(0,0,0)` til `(0,0,-360)` over 1.5 sekunder (lineær Vector3.Lerp i Update)
2. `LeanTween.scale(Number_Container, Vector3.one * 1.1f, 0.5f)` — skalerer nummer-boks opp 10% på 0.5s
3. `SoundManager.Instance.PlayNotificationSound()` — notifikasjon-lyd

---

## 8. Claim-winner-panel (`ClaimWinnerPanel.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Panels/Bingo Hall Display/ClaimWinnerPanel.cs`

Popup som vises når en spiller claimer vinner-ticket (trigget av `playerClaimWinner`-broadcast).

### 8.1 UI-struktur

| Felt | Rolle |
|---|---|
| `missedWinningClaimsContainer` | Parent for `MissedWinningClaimsData`-prefabs |
| `panelRowWinnerContainer` | Parent for `RowWinningData`-prefabs |
| `panelRowWinner` | Container som skjules hvis ingen vinner-rader |
| `unclaimedWinningPanel` | Container for missed claims-seksjon |
| `noUnclaimedTicketsFound` | Vises hvis `unclaimedWinners.Count == 0` eller null |
| `txtTicketNumber` | Tittel: "Ticket #{ticketNumber}" (med `LocalizationParamsManager.value`) |
| `rowWinningDataPrefab` | Prefab for hver vunnet rad |
| `missedWinningClaimsDataPrefab` | Prefab for missed claim |
| `claimWinnerTicket` | Ticket-visualisering (§4) |

### 8.2 SetData-flyt

```csharp
public void SetData(ClaimWinningResponse claimWinningResponse)
{
    txtTicketNumber.SetParameterValue("value", ticketNumber);
    panelRowWinner.SetActive(winners.Count > 0);
    noUnclaimedTicketsFound.SetActive(unclaimedWinners.Count == 0);
    SetRowWinnerData(winners);                      // Vunne rader
    SetMissedWinningClaimsData(unclaimedWinners);   // Missede rader
    claimWinnerTicket.SetData(claimWinningResponse); // 5x5 ticket-visualisering
    this.Open();
}
```

### 8.3 Row-winning-data (`RowWinningData.cs`)

Per vunnet pattern-rad på ticket:

```csharp
public void SetData(string rowWinning, string rowWinningAmount, bool showPrize)
{
    // Pattern-navn lokaliseres som §2.2
    if (!showPrize) {
        txtRowWinning.fontStyle = Underline | Bold;
        txtRowWinningAmount.fontStyle = Bold | Underline;
        txtRowWinningAmount.text = "Processing"; // Lokalisert
    } else {
        txtRowWinning.fontStyle = Normal;
        txtRowWinningAmount.text = $"{rowWinningAmount} kr";
    }
}
```

Spesiell case: `showPrize = false` (premiebeløp er ikke ferdig kalkulert) viser "Processing" med bold+underline.

### 8.4 Close

```csharp
public void CloseBtnTap() { this.Close(); }
```

Lukkes også automatisk når:
- Ny ball trukket (`OnWithdrawBingoBall` kaller `claimWinnerPanel.Close()`)
- Game resumes (`toggleGameStatus = "Resume"`)

---

## 9. ScreenSaverManager (`ScreenSaverManager.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Core/ScreenSaverManager.cs`

Singleton som tar over når TV-en er idle i konfigurert tid.

### 9.1 UI-elementer

| Felt | Rolle |
|---|---|
| `screenSaverUI` | `GameObject` — hovedkontainer |
| `displayImage` | `Image` — viser en bilde om gangen |
| `inactivityDuration` | `float` — sekunder før aktivering (minutter fra config × 60) |
| `screenSaverToggle` | `bool` — master enable/disable |
| `imageTimes` | `List<ImageTime>` — liste av `{id, image (URL), time (sekunder)}` |
| `downloadedSceenSaverImages` | `Dictionary<string, Sprite>` — cache-mapping filename → sprite |
| `duration` | `float = 1f` — fade-in/fade-out tid |

### 9.2 Config-parametere (fra `updateScreenSaver`-broadcast)

```csharp
public class ModifyScreenSaverData {
    public bool screenSaver;        // Master on/off
    public string screenSaverTime;  // Minutter inaktivitet (string, parses til int)
    public List<ImageTime> imageTime;
}

public class ImageTime {
    public string id;
    public string image;  // Relativ URL til bilde
    public string time;   // Sekunder for denne bildes visning
}
```

### 9.3 Aktivering

I `Update()`:

```csharp
if (Input.anyKeyDown || MouseMoved() || Input.touchCount > 0) {
    ResetInactivityTimer();
    if (screenSaverActive) DeactivateScreenSaver();
}

if (ScreenSaverToggle
    && !walletPanel.isActiveAndEnabled
    && (!IsLoggedIn || lobbyPanel.isActiveAndEnabled)) {
    inactivityTimer += Time.deltaTime;
    if (inactivityTimer >= InactivityDuration && !screenSaverActive)
        ActivateScreenSaver();
}
```

**Aktiverings-regler:**
- Wallet er ikke åpen (betalingsflyt skal ikke avbrytes)
- Bruker er ikke innlogget ELLER lobby er aktiv
- Inaktivitet > konfigurert tid

### 9.4 Aktiveringssekvens

```csharp
void ActivateScreenSaver() {
    screenSaverUI.transform.SetAsLastSibling();  // Legg på topp
    screenSaverActive = true;
    screenSaverUI.SetActive(true);
    FadeIn();  // LeanTween.alpha til 1f over duration (1 sekund default)
    UIManager.Instance.CloseAllGameElements();  // Deaktiver alle game-UI
    displayImagesCoroutine = StartCoroutine(DisplayImages());
}
```

### 9.5 Bilde-rotasjon (`DisplayImages`)

```csharp
while (true) {
    ImageTime imageTime = imageTimes[currentImageIndex];
    string key = ExtractFilename(imageTime.image);
    if (downloadedSceenSaverImages.TryGetValue(key, out Sprite cached))
        displayImage.sprite = cached;
    else
        DownloadImage(imageTime.image);
    yield return new WaitForSeconds(
        int.TryParse(imageTime.time, out int sec) ? sec : 0
    );
    currentImageIndex = (currentImageIndex + 1) % imageTimes.Count;
}
```

Hver bilde vises i sin egen konfigurerte tid (fra config). Loop gjennom hele listen.

### 9.6 Deaktivering

```csharp
void DeactivateScreenSaver() {
    screenSaverActive = false;
    screenSaverUI.SetActive(false);
    FadeOut();  // LeanTween.alpha til 0f
    UIManager.Instance.ActiveAllGameElements();
    StopCoroutine(displayImagesCoroutine);
    ResetInactivityTimer();
}
```

### 9.7 Integrasjon med TV-flyt

ScreenSaver er **global** (ikke dedikert til TV-screen), men brukes i samme kontekst. På Hall-TV:
- Ingen spiller-innlogging → kriteriet `!IsLoggedIn` matcher alltid
- Lobby-panelet er TV-en sitt default panel
- Derfor vil screensaver aktiveres ved inaktivitet på TV

**Input-triggers som avbryter:**
- Tastetrykk (`Input.anyKeyDown`)
- Musebevegelse (`Mathf.Abs(Mouse X/Y) > 0.01f`)
- Touch (`Input.touchCount > 0`)

---

## 10. Multi-hall-flyt (`BingoHallDisplay.SpilloramaFlow.cs`)

**Filplass:** `legacy/unity-client/Assets/_Project/_Scripts/Panels/BingoHallDisplay.SpilloramaFlow.cs`

Partial class som integrerer den nye `SpilloramaGameBridge`-eventstrømmen. Dette er **ikke** legacy admin-socket, men bro mot det nye systemet.

### 10.1 Event-subscriptions

```csharp
private void EnableSpilloramaBroadcasts() {
    SpilloramaGameBridge.OnBallDrawn        += OnBallDrawn_TV;
    SpilloramaGameBridge.OnRoomStateUpdated += OnRoomState_TV;
    SpilloramaGameBridge.OnGameStarted      += OnGameStarted_TV;
    SpilloramaGameBridge.OnGameFinished     += OnGameFinished_TV;
    SpilloramaGameBridge.OnPatternWon       += OnPatternWon_TV;
}
```

### 10.2 `OnBallDrawn_TV`

```csharp
private void OnBallDrawn_TV(BingoNumberData ball) {
    claimWinnerPanel.Close();
    Timer_PopUP.SetActive(false);
    NextGame_Counter_Txt.gameObject.SetActive(false);
    Ball_Drawn_Display.SetActive(true);
    Ball_Drawn_Count_Txt.text = ball.totalWithdrawCount.ToString();

    if (SoundManager.Instance.TvScreenSoundStatus) {
        switch (CurrentSoundLanguage) {
            case soundlanguage.NorwegianFemale:
                SoundManager.Instance.PlayNorwegianFemaleNumberAnnouncement(ball.number, true);
                break;
            default:
                SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(ball.number, true);
                break;
        }
    }

    bingoBallPanelManager.NewWithdraw(ball, null, false, true, true);
    panelLiveRoomData.Open();
}
```

### 10.3 `OnRoomState_TV` — snapshot-rebuild

Når TV-en joiner et rom eller reconnecter:
1. Sette `Current_Game_Name_Txt` til "Bingo" (hardkodet i SpilloramaFlow, mens legacy admin-socket bruker gameHistory.gameName)
2. `Game_Count_Txt` = `snap.players.Length` (player count som proxy for game-count)
3. Hvis spillet ikke kjører: lukk `panelLiveRoomData`, vis `Timer_PopUP` hvis `millisUntilNextStart > 0`
4. Hvis spillet kjører: bygg drawn-list fra `game.drawnNumbers[]`, mappe til BingoNumberData, replay i ball-strip

### 10.4 Ball-farge-mapping (75-ball bingo)

```csharp
string col = n <= 15 ? "blue"
           : n <= 30 ? "red"
           : n <= 45 ? "purple"
           : n <= 60 ? "green"
                    : "yellow";
```

### 10.5 `OnPatternWon_TV` — minimal data

Bygger et `AdminDashboardWinningData` med kun pattern-name + winner-count=1 + prize, og sender til `AddNewBingoWinningData` som oppdaterer pattern-prefab-listen.

### 10.6 Multi-hall perspektiv (viktig observasjon)

**Legacy admin-socket-flyt (BingoHallDisplay.cs):** Hver TV subscriber med sin `HallId` og mottar bare game-state relevant for denne hallen (`EventManager.Instance.AdminHallDisplayLogin(adminSocket, roomId, HallId, ...)`).

**SpilloramaFlow:** Bridge-integrasjon, sannsynligvis broadcaster globalt. TV-en bestemmer ikke på nåværende tidspunkt hva som er "min hall" vs "annen hall"-data — dette er en **gap** som må løses av backend-filtrering eller client-side filter på HallId.

**Vinnerlister:** `AdminHallDisplayResult.winners[].halls` er en `List<string>` — viser hvilke haller vinneren kommer fra. `Hall_Specific_Winner_Txt` joiner med `" | "`. Dette antyder at **én TV-skjerm kan vise vinnere fra flere haller** (globalt spill) — men strukturen er tilgjengelig for å filtrere/highlighte bare egen hall.

**Konklusjon for nytt design:**
- TV-en må ha `hallId` som kontekst (finnes i `HallId`-feltet, settes via `AdminHallExternalCallData.hallId`)
- Backend bør filtrere eller markere vinnere som "i din hall" vs "annen hall"
- UI må vise begge klart (nåværende design bruker separator `|`)

---

## 11. Color / Sprite / Theme-hints

### 11.1 Sprite-referanser (`BingoHallDisplay.cs`)

| Sprite | Bruk |
|---|---|
| `muteImg` / `unmuteImg` | Toggles på `soundBtn.image.sprite` |
| `bingoBtnYellow` / `bingoBtnGrey` | Toggles på `bingoBtn.sprite` — gul = aktiv, grå = pauset |
| `BackgroundSprite` | Global bakgrunn brukt som prop til mini-games |

**Merk:** `BingoButtonColor()` er commented out i koden (`BingoHallDisplay.cs:319`). Kan hende at grå/gul-logikk ikke lenger er aktiv.

### 11.2 Ball-farge-mapping (fra SpilloramaFlow)

75-ball bingo kolonne-farge:
- B (1-15): **blue**
- I (16-30): **red**
- N (31-45): **purple**
- G (46-60): **green**
- O (61-75): **yellow**

Disse er "color-navn" som stringer — faktiske hex-koder må slås opp i ball-prefab (`PrefabBingoBallPanel2`).

### 11.3 Text-styling (`RowWinningData.cs`)

Prosessering-status har spesiell typografi:
- `FontStyles.Bold | FontStyles.Underline` — "Processing" under-streket og fet
- Normal: `FontStyles.Normal` (ikke fet)

### 11.4 Ingen hex-farger i kode

Alle farger settes via **Sprites + Editor-satt Color-properties** som ikke er visible i .cs-filene. For eksakte verdier må Unity Editor inspiseres (prefabs/scene-files). Anbefalt fallback for web: matche mot PNG-screenshots av original TV (se `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md`).

---

## 12. Sammenligning mot nåværende TV-design

Kilde: `apps/admin-web/src/pages/tv/TVScreenPage.ts` (358 linjer, Bølge 1-paritet per 2026-04-23).

Nåværende TS-kodens kommentar nevner eksplisitt: "Bølge 1-paritet (2026-04-23): drawn-counter (X / Y), aktivt pattern-banner (Patterns_Txt) og current/next-game sub-header (Current_Game_Name_Txt + Next_Game_Name_Txt fra BingoHallDisplay.cs)."

| Legacy-komponent | Legacy-kilde | Nåværende status (TVScreenPage.ts) | Gap |
|---|---|---|---|
| Mute/unmute-knapp (`soundBtn`) | `BingoHallDisplay.cs:17-19` | Mangler (voice-dropdown er placeholder, ingen mute) | Ikke portet |
| Exit-knapp (`ExitBtn`) | `BingoHallDisplay.cs:40-41` | Mangler | Ikke portet (kiosk-modus antatt) |
| BINGO yellow/grey-indikator | `bingoBtn` sprite-toggle | Mangler | Pause-indikator ikke portet |
| Current/Next game sub-header | `Current_Game_Name_Txt` + `Next_Game_Name_Txt` | Portet — `renderSubHeader` linje 186-207 | Portet |
| Game count (`Game_Count_Txt`) | "Spill #{count}" | **Ikke portet** — viser kun `Game {number} - {name}` i tittel | Manglende #-teller |
| Ball drawn counter (`Ball_Drawn_Count_Txt`) | "Totalt trukket" | Portet — `tv-drawn-counter` | Portet |
| Store ball + siste 5 (`bingoBallPanelManager`) | Animert ball + 5 små | Portet — `tv-last-ball-circle` + `tv-last-5` | Portet (ingen animasjon) |
| Patterns-tabell (`PrefabHallDispalyPatternDetails`) | Pattern-navn, playerCount, prize, highlight | Portet — `tv-patterns-table` | **Ingen jackpot-animasjon**, **ingen interactable btn** |
| Aktiv pattern-banner (`Patterns_Txt`) | Midt-under-ball | Portet — `renderActivePatternBanner` | Portet (uten pulse-animasjon i legacy) |
| Countdown (`NextGame_Counter_Txt`) | MM:SS countdown | Portet — `renderCountdown` | Portet |
| Timer-popup (`Timer_PopUP` + `Counter_Txt`) | "Vent på X game start" | Delvis portet — `tv-waiting-notice` | Mangler dynamisk game-name i ventet-melding |
| Winner-rader (`AdminTVScreenWinners`) | Pattern + count + amount + halls + player-list | Ikke portet på TV-hovedside — brukes i `/winners`-side (auto-switched) | Uklart om `/winners`-page viser full detalj |
| Claim-winner-popup (`ClaimWinnerPanel`) | Ticket 5×5 + winners + missed claims | **Mangler fullstendig** | Ikke portet |
| Missed claims (`MissedWinningClaimsData`) | Pattern + last ball + draw count | Mangler | Ikke portet |
| Mini-game winners (`PanelMiniGameWinners`) | Liste per Physical/Online/Unique | Mangler | Ikke portet |
| Jackpot-panel / jackpot-animasjon | Rotating prize + draw-count | Mangler | Ikke portet |
| ScreenSaverManager | Bilde-rotasjon på inaktivitet | Mangler | Ikke portet |
| Language-switch (3-språk) | `txtCurrentLanguage` + `nextButtonTap` | **Placeholder** — dropdown uten audio | Voice-selector persisterer til localStorage, ingen backend |
| Full-house jackpot-scrolling | `AnimatePrizeText` 2s loop | Mangler | Ikke portet |
| Pattern-progress highlight | `HighLight.Open/Close` | Portet (CSS-klasse `highlighted`) | Portet |
| Ticket-winner-display (`ticketWinner`) | 5×5 brett med pattern-scrolling | Mangler | Ikke portet |
| Auto-refresh etter game-finish (7s) | `RefreshPanelAfterDelay` | Portet delvis — auto-switch til `/winners` i 30s | Anderledes timing |
| Pattern-name-lokalisering | `TextDataSubRow`/`TextDataSubPicture`/`TextDataSubFrame`/"Full House" | Ukjent — bruker `p.name` direkte | Potensielt rå pattern-navn i UI |
| Device-type-basert exit | `Application.OpenURL("spillorama://open")` per device | Mangler | Web-kontekst antatt (ikke mobil-app) |
| Ball-farge per kolonne | blue/red/purple/green/yellow | Portet — CSS-klasse `col-b/i/n/g/o` | Portet (andre farge-navn) |
| Prize-format | `"{prize} kr"` (heltall) | `cents/100 + " kr"` (toLocaleString) | **Format-avvik**: legacy er heltall, nåværende dividerer på 100 (cents) |

---

## 13. Design-prioritert liste for Bølge 2+3+4

Prioritert av **operasjonell synlighet** (hva en spiller/ansvarlig ser umiddelbart) og **feil-følsomhet** (hva som skader tilliten hvis det mangler), ikke dev-kompleksitet.

### Bølge 2 — Mest synlige gaps (høyt prioriterte)

1. **Pattern-name-lokalisering** (TextDataSubRow → "Rad 1", etc.)
   - Nåværende viser `p.name` rått. Må mappe til norsk ("Rad 1", "Bilde", "Ramme", "Fullt hus").
   - Referanse: `AdminTVScreenWinners.cs:22-40`, `PrefabHallDispalyPatternDetails.cs:34-52`.

2. **Prize-format-avvik (kr vs cents)**
   - Legacy viser `{prize} kr` (heltall). Nåværende deler på 100. Må bekreftes mot backend kontrakt — er `p.prize` i cents eller kr?

3. **Game-count-display** (Spill #{N} / {total})
   - Mangler i nåværende layout. Legacy viser "Spill {gameCount}" — brukt for "vi er på spill 3 av 12 i dag".

4. **Jackpot-panel for Full House** (for Innsatsen/Oddsen/Jackpot-spill)
   - Når det er jackpot-spill: vis `jackpotDrawCount` og roter mellom `prizeArray` (2s interval).
   - Referanse: `PrefabHallDispalyPatternDetails.cs:66-95`.

5. **Mute/unmute-knapp + voice-selector som faktisk fungerer**
   - Nåværende voice-dropdown er placeholder uten audio. Legacy har full mute-knapp + 3-språk-switcher (M/F/EN) med faktisk lyd.
   - Referanse: `BingoHallDisplay.cs:212-222` + `SwitchLanguage/PlayNorwegianMaleAudio`.

### Bølge 3 — Winners / Claims / TV-ops

6. **Winners-side — full detalj per pattern** (AdminTVScreenWinners-paritet)
   - Pattern-navn + count + amount + halls joined + Ticket-id-liste.
   - Legacy auto-switch til winners-panelet etter game-finish — nåværende routing går til `/winners`, men innholdet er uavklart.
   - Referanse: `AdminTVScreenWinners.cs:20-66`.

7. **Claim-winner-popup** (verifisering når spiller claimer)
   - 5×5 ticket-visualisering + vunne rader + missede claims-seksjon.
   - Triggert av `playerClaimWinner`-broadcast.
   - Referanse: `ClaimWinnerPanel.cs:13-49`, `ClaimWinnerTicket.cs:9-68`.

8. **Missed winning claims** (ticket som kunne vunnet men ikke claimet)
   - Pattern + last matched ball + draw count when missed + total draws.
   - Referanse: `MissedWinningClaimsData.cs:9-29`.

9. **Mini-game winners-panel**
   - Når mini-game er ferdig: vis Physical/Online/Unique-kategorier med ticket-nr + amount.
   - 7s auto-refresh etter visning.
   - Referanse: `PanelMiniGameWinners.cs:31-65`.

### Bølge 4 — Polish / sjeldnere bruk

10. **Pattern-pulse-animasjon ved endring** (visual feedback)
    - Når `HighLight.Open()` skjer → subtil pulse. Nåværende har CSS-klasse men uklart om animasjonen er implementert.

11. **Ball-animasjon — kulen trekkes inn** (fra "bingoBallMovementAnimationTime = 1f" i BingoBallPanelManager2)
    - Ny ball ruller inn med animasjon. Nåværende viser bare som statisk tall.

12. **Countdown når timer > 0** (Timer_PopUP med "Vent på X game start")
    - Legacy har dedikert popup med game-navn og "starter om…"-tekst. Nåværende har bare en "Venter på neste spill…"-notice.

13. **Jackpot-rotasjon-animasjon** (`AnimatePrizeText`)
    - 2s interval som roterer mellom verdier i `prizeArray`. Kun for Full House i jackpot-spill.

14. **ScreenSaverManager** (lav prioritet for TV-ops)
    - Bilde-rotasjon på inaktivitet. Kan skippes i web-context hvis TV-en alltid viser spill — er kun relevant mellom spill eller etter stengetid.
    - Anbefaling: enkel versjon med logo + "Neste spill om X" i stedet for bilde-karusell.

15. **Exit-knapp** (bare relevant hvis TV-en er en app-view, ikke kiosk)
    - Ikke nødvendig for kiosk-browser. Kan droppes med dokumentert avvik.

16. **BINGO yellow/grey-indikator** (pause-tilstand)
    - Liten visuell cue for når spillet er pauset under claim-verifisering. Kan erstattes med banner/overlay.

### Topp 5 mest synlige gaps (oppsummering for kommunikasjon)

1. **Claim-winner-popup** — når spiller sjekker inn vinner-ticket, har TV-en null visuell feedback
2. **Winners-panel full detalj** — etter game-finish må vinnere vises per pattern med beløp + hall + ticket-id
3. **Jackpot-panel** — Full House i jackpot-spill har egen visning (draw-count + roterende prize)
4. **Mini-game winners** — hjul/skattekiste/mystery/color-draft har egen vinner-visning (Physical/Online/Unique)
5. **Pattern-name-lokalisering** (rå "Row 1" → "Rad 1", "Full House" → "Fullt hus") og prize-format (kr vs cents)

---

## 14. Tekniske referanser

### 14.1 LanguageKey-konstanter (`Constants.cs`)

Key-strings som løses mot `I2.Loc.LocalizationManager`:
- `NoOngoingGameMessage` → "There is no ongoing game. Please try again later"
- `GamePausedByAdminMessage` → "Checking the claimed tickets"
- `Processing` → "Processing"
- `TextDataSubRow`, `TextDataSubPicture`, `TextDataSubFrame`, `Full House`

### 14.2 Broadcast-event-navn (fra `Constants.BroadcastName`)

Relevante for TV-skjerm:
- `SubscribeRoomAdmin` — initial state-load
- `WithdrawBingoBall` — ball trukket
- `BingoWinningAdmin` — pattern vunnet
- `GameFinishAdmin` — spill ferdig
- `TVScreenGameRefreshRoom` (= `"adminRefreshRoom"`) — tving refresh
- `countDownToStartTheGame` — countdown til start
- `ActivateMiniGame` — mini-game starter
- `toggleGameStatus` — pause/resume
- `BingoAnnouncement` — spille bingo-lyd
- `nextGameStartCountDownTime` — countdown til neste spill
- `playerClaimWinner` — spiller claimer ticket
- `PatternChange` — jackpot-data endret
- `updateScreenSaver` — screensaver-config endret

### 14.3 Data-contracts (fra kode-observasjon)

**AdminHallDisplayGameHistory** (fra `OnSubscribeRoom`):
- `gameName` (string)
- `gameCount` (int)
- `gameId` (string)
- `gameStatus` ("Waiting" | "Running" | "Finished")
- `totalBallsDrawn` / `totalWithdrawCount` (int)
- `fullHouseWinners` / `patternsWon` (int)
- `withdrawNumberList` (List<int> eller BingoNumberData)
- `nextNumber` (int)
- `winningList` (List<AdminDashboardWinningData>)
- `winningTickets` (List<WinningTicket>)
- `nextGame.gameName` (string)
- `jackPotData` (JackPotData)
- `minigameData` (minigameData objekt med gameName, isMinigameActivated, isMinigamePlayed, isMinigameFinished)
- `isGamePaused`, `pauseGameStats`, `pauseGameMessage`
- `countDownDateTime` (UTC string)

**AdminHallDisplayResult** (fra `OnGameFinish`):
- `totalWithdrawCount`, `fullHouseWinners`, `patternsWon` (ints)
- `winners` (List<WinnerInfo>) hvor WinnerInfo har:
  - `lineType` ("Row 1" / "Picture" / "Frame" / "Full House")
  - `count` (int)
  - `finalWonAmount` (int)
  - `halls` (List<string>)
  - `playerIdArray` (List<PlayerIdArray> med `ticketNumber`, `wonAmount`, `userType`)
  - `playerTypeSpecificWinners` / `hallSpecificWinners` (currently commented out i AdminTVScreenWinners)

**JackPotData**:
- `isDisplay` (bool)
- `draw` (int — draw-count for jackpot)
- `tvScreenWinningAmount` (int)
- `prizeArray` (List<int> — roteres ved 2s interval)

**ClaimWinningResponse** (fra `playerClaimWinner`):
- `ticketNumber` (string)
- `winners` (List<ClaimWinner> med `lineType`, `wonAmount`, `showPrize`)
- `unclaimedWinners` (List<UnclaimedWinners> med `lineType`, `withdrawBall`, `withdrawBallCount`, `totalWithdrawCount`)
- `ticket` (List<{Number, show}>) — 25 celler for 5×5 brett

---

## 15. Notater om legacy-arkitektur

**Partial class-mønster:** `BingoHallDisplay` er delt i to filer:
- `BingoHallDisplay.cs` (1881 linjer) — admin socket-integrasjon
- `BingoHallDisplay.SpilloramaFlow.cs` (partial class) — nytt Spillorama-bridge-laget

Disse er to **parallelle** event-kilder. Den nye bridge-koden er enklere (hardkoder "Bingo" som gameName, bruker playerCount som game-count-proxy). Legacy admin-socket-flyt er mer detaljert og er source-of-truth for fullstendig TV-UI.

**Refresh-mønster:** `Refresh()` deaktiverer og reaktiverer hele `gameObject`:
```csharp
public void Refresh() {
    isRefresh = true;
    PanelMiniGameWinners.Close();
    SoundManager.Instance.StopNumberAnnouncement();
    gameObject.SetActive(false);
    gameObject.SetActive(true);  // Triggers OnEnable igjen
}
```

Dette er ekstremt aggressivt — alle pattern-prefabs og winner-list destrueres og bygges på nytt fra `OnSubscribeRoom`. Web-motstykket bør vurdere eventuell state-diff istedenfor full re-mount.

**Sound-tracking:** `SoundManager.Instance.playedSoundTracker` brukes for å unngå dobbel-avspilling av bingo-lyd og nummerannounsements. Viktig ved reconnect/refresh-scenarier. Web må ha tilsvarende idempotens for lyd.

**PlayerPrefs som persistering:** Språk-valg (`CurrentLanguage`) er lagret i Unity PlayerPrefs. Nåværende web-ekvivalent er `localStorage["tv_voice_<hallId>"]` — per hall, ikke global. Det bør bekreftes om dette er korrekt (én TV per hall vs samme config på tvers).

---

## 16. Åpne spørsmål / avklaringer

1. **Prize-format (cents vs kr):** Legacy viser `{prize} kr` som heltall. Nåværende `formatPrize(cents)` deler på 100. Backend-kontrakten må bekreftes.
2. **Pattern-navn-kilde:** Kommer `p.name` fra backend som norsk ("Rad 1") eller engelsk ("Row 1")? Lokalisering må gjøres et sted — front eller backend.
3. **Multi-hall-filtrering:** TV viser `halls.join(" | ")` — er dette alltid "min hall" eller alle haller i spillet?
4. **Voice-selector + audio:** Audio-filer er ikke implementert. Må separat feature (voice-pack) spec'es.
5. **Screensaver policy:** Skal web-TV ha screensaver i det hele tatt? Kiosk-browser kan ha egen idle-handling.
6. **ScreenSaver auth-dependency:** Legacy screensaver aktiveres bare hvis `!IsLoggedIn || lobbyPanel.isActiveAndEnabled`. TV har ingen bruker-login-begrep — hvordan mappes dette?
7. **BINGO-knapp-semantikk:** Legacy har en fysisk BINGO-knapp på TV som kaller `StopGameByPlayers`. Er dette et "bingo-caller"-mønster som skal portes til web-TV, eller bare visuell?
