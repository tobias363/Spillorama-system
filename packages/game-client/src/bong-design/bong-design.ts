/**
 * Bong-design preview-runtime.
 *
 * Tobias-direktiv 2026-05-15:
 *   "Kan opprette bare et nytt view hvor bongene vises med dummy tall.
 *    Det er kun for å tweake på designet."
 *
 * Tobias bekreftet 2026-05-15 at single-bong "Small Yellow" er bra. Ny
 * iterasjon legger til "Trippel Gul" — tre Small Yellow-bonger festet
 * sammen i ÉN større container, skilt av tynne vertikale linjer.
 *
 * Side-en rendrer:
 *  1) Trippel Gul (hoved-fokus) — 3 sub-grids i én container, mid-spill
 *  2) Enkelt Small Yellow (sammenligning) — samme stil som sub-grid over
 *  3) 3 scenarier per farge — Hvit / Gul / Lilla side-om-side
 *      a) Fresh (ingen marks)
 *      b) Mid-spill (10 marks)
 *      c) Bingo Rad 1 (5 marks)
 *
 * Implementasjonen er BEVISST stand-alone (ingen avhengighet til
 * Pixi/Socket.IO/Pattern-eval-logikk). Når Tobias har godkjent designet
 * skal endringer reflekteres 1:1 i
 * `packages/game-client/src/games/game1/components/BingoTicketHtml.ts`.
 */

/**
 * Deterministiske dummy-tall for hver bong-farge slik at samme tall vises
 * hver gang side lastes — lett å iterere på design uten "ja men forrige
 * gang så det annerledes ut"-effekter.
 *
 * Layout: 5×5 grid, kolonner B(1-15) I(16-30) N(31-45) G(46-60) O(61-75).
 * Sentercelle (index 12) = 0 (FREE).
 *
 * Gul-bong-tall fra Tobias-referansebilde 2026-05-15. Hvit/Lilla lager
 * tilsvarende mønster med samme antall marks.
 */
const DUMMY_NUMBERS: Record<"white" | "yellow" | "purple", number[]> = {
  // prettier-ignore
  white: [
     3,  8, 12, 14, 15,
    17, 22, 26, 28, 30,
    32, 38,  0, 41, 44, // index 12 = FREE
    47, 52, 55, 58, 60,
    62, 67, 70, 73, 75,
  ],
  // Tobias-referansebilde 2026-05-15 — eksakt layout for gul "Small Yellow"
  // prettier-ignore
  yellow: [
     1,  6,  8, 10, 11,
    18, 20, 24, 28, 34,
    38, 44,  0, 45, 48, // index 12 = FREE
    49, 54, 55, 57, 59,
    60, 61, 62, 67, 71,
  ],
  // prettier-ignore
  purple: [
     2,  6, 10, 11,  4,
    19, 23, 25,  9,  7,
    31, 37,  0, 43, 44, // index 12 = FREE
    48, 51, 54, 56,  8,
    64, 66, 68, 71, 75,
  ],
};

type BongColor = "white" | "yellow" | "purple";

interface BongConfig {
  color: BongColor;
  label: string;
  priceKr: number;
  multiplier: number;
}

const BONG_CONFIGS: BongConfig[] = [
  { color: "white", label: "Hvit", priceKr: 5, multiplier: 1 },
  { color: "yellow", label: "Gul", priceKr: 10, multiplier: 2 },
  { color: "purple", label: "Lilla", priceKr: 15, multiplier: 3 },
];

/**
 * Dummy-tall for 3 forskjellige Small Yellow-bonger i Trippel Gul-
 * containeren. Tobias-direktiv 2026-05-15: hver sub-grid skal se ut
 * som et unikt brett. Mid-spill-scenario med markeringer på alle 3.
 *
 * Layout 5×5 per grid: kolonner B(1-15) I(16-30) N(31-45) G(46-60) O(61-75).
 * Index 12 = FREE.
 */
const TRIPLE_YELLOW_NUMBERS: [number[], number[], number[]] = [
  // Grid 1 — kopi av single Yellow (kjent godkjent layout)
  // prettier-ignore
  [
     1,  6,  8, 10, 11,
    18, 20, 24, 28, 34,
    38, 44,  0, 45, 48,
    49, 54, 55, 57, 59,
    60, 61, 62, 67, 71,
  ],
  // Grid 2 — unike tall (forskjellig fra grid 1)
  // prettier-ignore
  [
     3,  5,  9, 12, 14,
    17, 22, 26, 29, 30,
    33, 39,  0, 42, 44,
    47, 50, 52, 56, 58,
    63, 65, 69, 72, 74,
  ],
  // Grid 3 — unike tall (forskjellig fra grid 1 og 2)
  // prettier-ignore
  [
     2,  4,  7, 13, 15,
    16, 19, 23, 27, 25,
    32, 37,  0, 41, 43,
    46, 51, 53, 58, 60,
    62, 64, 68, 70, 73,
  ],
];

/**
 * Mid-spill marks per sub-grid i Trippel Gul. Hver grid har 3-5 marks i
 * forskjellige posisjoner for å vise at de er uavhengige brett.
 */
const TRIPLE_YELLOW_MARKS: [Set<number>, Set<number>, Set<number>] = [
  // Grid 1 — samme mønster som single Yellow (kjent godkjent)
  new Set<number>([1, 3, 4, 7, 10, 14, 16, 19, 20, 23]),
  // Grid 2 — annet mønster, færre marks
  new Set<number>([2, 5, 8, 11, 13, 17, 21]),
  // Grid 3 — annet mønster
  new Set<number>([0, 4, 6, 9, 15, 18, 22, 24]),
];

/**
 * Bygg BINGO-bokstaver-header.
 */
function buildBingoLetters(): HTMLDivElement {
  const letters = document.createElement("div");
  letters.className = "bingo-letters";
  for (const ch of "BINGO") {
    const span = document.createElement("div");
    // Tobias-design 2026-05-15: hver bokstav får per-bokstav-farge + black
    // text-stroke. `letter-${ch.toLowerCase()}` matcher CSS-regler.
    span.className = `letter letter-${ch.toLowerCase()}`;
    span.textContent = ch;
    letters.appendChild(span);
  }
  return letters;
}

/**
 * Bygg 5×5 grid med tall og markeringer.
 *
 * @param numbers — 25 tall (0 = FREE-cellen i sentrum, idx 12)
 * @param markedIndices — set av celle-indekser som rendres som markerte
 */
function buildGrid(numbers: number[], markedIndices: Set<number>): HTMLDivElement {
  const grid = document.createElement("div");
  grid.className = "bong-grid";

  for (let idx = 0; idx < 25; idx++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    const num = numbers[idx];

    if (num === 0) {
      // FREE-cellen — ren tekst "FREE" på grønn bakgrunn
      // (Tobias-referansebilde 2026-05-15, ikke logo i mockup-versjon).
      cell.classList.add("free");
      cell.textContent = "FREE";
    } else {
      cell.textContent = String(num);
      if (markedIndices.has(idx)) {
        cell.classList.add("marked");
      }
    }

    grid.appendChild(cell);
  }
  return grid;
}

/**
 * Bygg én bong (5×5 grid) for en gitt farge og markerings-scenario.
 *
 * @param config — farge-metadata (palett-key, label, pris, multiplikator)
 * @param markedIndices — Set av celle-indekser som skal vises som markerte.
 *                       FREE-cellen (index 12) håndteres separat — den
 *                       rendres alltid som ren tekst "FREE" på grønn
 *                       bakgrunn (Tobias-referansebilde 2026-05-15).
 * @param footerText — eksplisitt footer-tekst (eks. "5 igjen", "3 igjen",
 *                     "BINGO!"). Tobias-direktiv 2026-05-15: scenario-
 *                     drevet footer, ikke matematisk beregnet.
 */
function buildBong(
  config: BongConfig,
  markedIndices: Set<number>,
  footerText: string,
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = `bong-card color-${config.color}`;

  // Header (navn + pris + × cancel)
  const header = document.createElement("div");
  header.className = "bong-header";

  const name = document.createElement("div");
  name.className = "bong-name";
  name.textContent = `Small ${config.label}`;
  header.appendChild(name);

  const price = document.createElement("div");
  price.className = "bong-price";
  price.textContent = `${config.priceKr} kr`;
  header.appendChild(price);

  // × cancel-knapp — Tobias-referansebilde 2026-05-15: rent × uten sirkel-
  // bakgrunn. Mockup-versjon viser bare knappen uten klikk-handler.
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "bong-cancel";
  cancelBtn.type = "button";
  cancelBtn.setAttribute("aria-label", "Avbestill brett");
  cancelBtn.textContent = "×";
  header.appendChild(cancelBtn);

  card.appendChild(header);

  // Body-wrapper — matcher trippel-sub-strukturen 1:1 (Tobias 2026-05-15).
  // .triple-sub har gap: 4px mellom letters/grid/footer; single arver samme
  // via .bong-body slik at single-bong = trippel-sub identisk.
  const body = document.createElement("div");
  body.className = "bong-body";

  // BINGO-bokstaver
  body.appendChild(buildBingoLetters());

  // 5×5 grid
  body.appendChild(buildGrid(DUMMY_NUMBERS[config.color], markedIndices));

  // Footer — Tobias-referansebilde 2026-05-15: scenario-drevet tekst
  const footer = document.createElement("div");
  footer.className = "bong-footer";
  footer.textContent = footerText;
  body.appendChild(footer);

  card.appendChild(body);

  return card;
}

/**
 * Bygg Trippel Gul-container — 3 Small Yellow-bonger i ÉN større card,
 * skilt av tynne vertikale linjer. Tobias-referansebilde 2026-05-15.
 *
 * Container-header:
 *   - "Gul - 3 bonger" venstre
 *   - "60 kr" mid (3 × 20 kr — auto-multiplikatorert: Gul = 10 kr × 2 = 20 kr/bong)
 *   - × høyre
 *
 * Hver sub-grid har egen BINGO-header, 5×5 grid og "X igjen"-footer.
 * Footer-tekstene varierer per grid for å vise at hver er uavhengig.
 */
function buildTripleYellow(): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "bong-card color-yellow triple";

  // Container-header — samme stil som single-bong-header
  const header = document.createElement("div");
  header.className = "bong-header";

  const name = document.createElement("div");
  name.className = "bong-name";
  name.textContent = "Gul – 3 bonger";
  header.appendChild(name);

  // Samlet pris: 3 × 20 kr = 60 kr (gul auto-mult: 10 × 2)
  const price = document.createElement("div");
  price.className = "bong-price";
  price.textContent = "60 kr";
  header.appendChild(price);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "bong-cancel";
  cancelBtn.type = "button";
  cancelBtn.setAttribute("aria-label", "Avbestill alle tre brett");
  cancelBtn.textContent = "×";
  header.appendChild(cancelBtn);

  card.appendChild(header);

  // Triple-grids container med tynne vertikale dividers mellom de 3 sub-grids
  const gridsContainer = document.createElement("div");
  gridsContainer.className = "triple-grids";

  // Footer-tekster per sub-grid — viser at hver er uavhengig
  const subFooters = ["3 igjen", "4 igjen", "2 igjen"];

  for (let i = 0; i < 3; i++) {
    // Vertikal divider mellom sub-grids (etter første, før hver påfølgende)
    if (i > 0) {
      const divider = document.createElement("div");
      divider.className = "triple-divider";
      gridsContainer.appendChild(divider);
    }

    const sub = document.createElement("div");
    sub.className = "triple-sub";

    // BINGO-letters per sub-grid
    sub.appendChild(buildBingoLetters());

    // 5×5 grid per sub
    sub.appendChild(buildGrid(TRIPLE_YELLOW_NUMBERS[i], TRIPLE_YELLOW_MARKS[i]));

    // Footer per sub
    const subFooter = document.createElement("div");
    subFooter.className = "bong-footer";
    subFooter.textContent = subFooters[i];
    sub.appendChild(subFooter);

    gridsContainer.appendChild(sub);
  }

  card.appendChild(gridsContainer);

  return card;
}

/**
 * Renderer ÉN scenario-rad — Hvit / Gul / Lilla side-om-side.
 */
function renderScenario(
  rootId: string,
  markedIndices: Set<number>,
  footerText: string,
): void {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = "";
  for (const config of BONG_CONFIGS) {
    root.appendChild(buildBong(config, markedIndices, footerText));
  }
}

/**
 * Renderer single Small Yellow-bong (sammenligning under Trippel Gul).
 * Bruker samme mid-spill marks som grid 1 i Trippel Gul for visuell paritet.
 */
function renderSingleYellow(rootId: string): void {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = "";
  const yellowConfig = BONG_CONFIGS.find((c) => c.color === "yellow");
  if (!yellowConfig) return;
  // Samme marks som grid 1 i Trippel Gul → spilleren ser at sub-grid og
  // single er identiske i stil.
  root.appendChild(buildBong(yellowConfig, TRIPLE_YELLOW_MARKS[0], "3 igjen"));
}

/**
 * Renderer Trippel Gul-containeren.
 */
function renderTripleYellow(rootId: string): void {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = "";
  root.appendChild(buildTripleYellow());
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

/**
 * Scenario A: Fresh ticket — kun FREE-celle "marked" via grønn FREE-tekst.
 */
const FRESH_MARKS = new Set<number>();

/**
 * Scenario B: Mid-spill — markeringer matcher Tobias-referansebilde
 * 2026-05-15 for gul "Small Yellow"-bong:
 *   Rad 1: 6*, 10*, 11*       (idx 1, 3, 4)
 *   Rad 2: 24*                 (idx 7)
 *   Rad 3: 38*, 48*            (idx 10, 14)
 *   Rad 4: 54*, 59*            (idx 16, 19)
 *   Rad 5: 60*, 67*            (idx 20, 23)
 * Hvit/Lilla får tilsvarende mønster.
 */
const MID_GAME_MARKS = new Set<number>([
  1, 3, 4, 7, 10, 14, 16, 19, 20, 23,
]);

/**
 * Scenario C: Bingo Rad 1 — alle 5 celler i øverste rad markert.
 * (index 0-4 = øverste rad i 5×5)
 */
const ROW_1_MARKS = new Set<number>([0, 1, 2, 3, 4]);

// ── Render alt ────────────────────────────────────────────────────────────

// Hoved-fokus: Trippel Gul + enkelt-sammenligning
renderTripleYellow("triple-yellow-host");
renderSingleYellow("single-yellow-host");

// Eksisterende 3-rads-scenarier (beholdt for full preview-funksjonalitet)
renderScenario("row-fresh", FRESH_MARKS, "5 igjen");
renderScenario("row-marked", MID_GAME_MARKS, "3 igjen");
renderScenario("row-bingo", ROW_1_MARKS, "BINGO!");
