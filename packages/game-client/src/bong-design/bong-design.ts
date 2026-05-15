/**
 * Bong-design preview-runtime.
 *
 * Tobias-direktiv 2026-05-15:
 *   "Kan opprette bare et nytt view hvor bongene vises med dummy tall.
 *    Det er kun for å tweake på designet."
 *
 * Side-en rendrer 3 bonger (Hvit / Gul / Lilla) side-om-side i 3 scenarier:
 *  - Ingen markeringer (fresh ticket)
 *  - Med markeringer (mid-spill — 8 markerte celler)
 *  - Bingo-vinst (Rad 1 fullført — 5 markerte celler i øverste rad)
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
  // prettier-ignore
  yellow: [
     1,  5,  9, 13, 14,
    18, 21, 24, 27, 29,
    33, 36,  0, 42, 45, // index 12 = FREE
    46, 50, 53, 57, 59,
    63, 65, 69, 72, 74,
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

const FREE_LOGO_URL = "/web/games/assets/game1/design/spillorama-logo.png";

/**
 * Bygg én bong (5×5 grid) for en gitt farge og markerings-scenario.
 *
 * @param config — farge-metadata (palett-key, label, pris, multiplikator)
 * @param markedIndices — Set av celle-indekser som skal vises som markerte.
 *                       FREE-cellen (index 12) håndteres separat — den er
 *                       alltid "marked" via logo-bildet, men har ikke
 *                       MARKED_BG-styling.
 */
function buildBong(config: BongConfig, markedIndices: Set<number>): HTMLDivElement {
  const card = document.createElement("div");
  card.className = `bong-card color-${config.color}`;

  // Header (navn + pris)
  const header = document.createElement("div");
  header.className = "bong-header";

  const name = document.createElement("div");
  name.className = "bong-name";
  name.textContent = config.label;
  header.appendChild(name);

  const price = document.createElement("div");
  price.className = "bong-price";
  price.textContent = `${config.priceKr} kr`;
  header.appendChild(price);

  card.appendChild(header);

  // BINGO-bokstaver
  const letters = document.createElement("div");
  letters.className = "bingo-letters";
  for (const ch of "BINGO") {
    const span = document.createElement("div");
    span.className = "letter";
    span.textContent = ch;
    letters.appendChild(span);
  }
  card.appendChild(letters);

  // 5×5 grid
  const grid = document.createElement("div");
  grid.className = "bong-grid";

  const numbers = DUMMY_NUMBERS[config.color];
  for (let idx = 0; idx < 25; idx++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    const num = numbers[idx];

    if (num === 0) {
      // FREE-cellen
      cell.classList.add("free");
      const img = document.createElement("img");
      img.src = FREE_LOGO_URL;
      img.alt = "FREE";
      img.draggable = false;
      // Fallback til ★ hvis logo ikke laster
      img.addEventListener("error", () => {
        cell.classList.add("fallback");
        cell.removeChild(img);
        cell.textContent = "★";
      });
      cell.appendChild(img);
    } else {
      cell.textContent = String(num);
      if (markedIndices.has(idx)) {
        cell.classList.add("marked");
      }
    }

    grid.appendChild(cell);
  }
  card.appendChild(grid);

  // Footer (statisk meta-rad for design-paritet med prod's "X igjen"-tekst)
  const footer = document.createElement("div");
  footer.className = "bong-footer";
  const remaining = 25 - markedIndices.size - 1; // -1 for FREE
  if (remaining <= 0) {
    footer.textContent = "Bingo!";
  } else if (remaining === 1) {
    footer.textContent = "One to go!";
  } else {
    footer.textContent = `${remaining} igjen`;
  }
  card.appendChild(footer);

  return card;
}

/**
 * Bygg én kolonne-wrapper med label + meta + bong, slik at vi får
 * gjenkjennelig "Hvit (5 kr × 1)"-tekst over hver bong.
 */
function buildBongColumn(config: BongConfig, markedIndices: Set<number>): HTMLDivElement {
  const col = document.createElement("div");
  col.className = "bong-col";

  const label = document.createElement("div");
  label.className = "col-label";
  label.textContent = `${config.label} (${config.priceKr} kr × ${config.multiplier})`;
  col.appendChild(label);

  col.appendChild(buildBong(config, markedIndices));

  return col;
}

/**
 * Renderer ÉN scenario-rad — kalt 3 ganger fra bootstrap().
 */
function renderScenario(rootId: string, markedIndices: Set<number>): void {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = "";
  for (const config of BONG_CONFIGS) {
    root.appendChild(buildBongColumn(config, markedIndices));
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

/**
 * Scenario A: Fresh ticket — kun FREE-celle "marked" via logo.
 */
const FRESH_MARKS = new Set<number>();

/**
 * Scenario B: Mid-spill — 8 tilfeldige celler markert. Indeksene er
 * deterministiske (kuratert fordeling utenfor FREE-celle index 12).
 */
const MID_GAME_MARKS = new Set<number>([
  2, 5, 7, 11, 16, 19, 21, 23,
]);

/**
 * Scenario C: Bingo Rad 1 — alle 5 celler i øverste rad markert.
 * (index 0-4 = øverste rad i 5×5)
 */
const ROW_1_MARKS = new Set<number>([0, 1, 2, 3, 4]);

renderScenario("row-fresh", FRESH_MARKS);
renderScenario("row-marked", MID_GAME_MARKS);
renderScenario("row-bingo", ROW_1_MARKS);
