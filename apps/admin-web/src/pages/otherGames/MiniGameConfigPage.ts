// PR-A1 (refactor) — generisk mini-game-config-side.
//
// Konsoliderer de tidligere per-type-sidene (WheelOfFortunePage,
// TreasureChestPage, MysteryGamePage, ColorDraftPage) til én fil som
// håndterer alle fire typer via et type-spesifikt form-schema.
//
// Backend-kall, URL-struktur, test-ID-er, form-ID-er og i18n-nøkler er
// identiske med de tidligere sidene — dette er ren strukturell refactor
// uten visuelle eller funksjonelle endringer.

import { t } from "../../i18n/I18n.js";
import { escapeHtml } from "../adminUsers/shared.js";
import {
  activeAndJsonRow,
  collectPrizes,
  loadMiniGameConfig,
  renderOtherGamesShell,
  renderPrizeGrid,
  saveMiniGameFromForm,
  submitRow,
} from "./shared.js";
import {
  MINI_GAME_TYPES,
  type MiniGameType,
} from "../../api/admin-other-games.js";

/** Whitelist-guard: sjekker at en string er en gyldig MiniGameType. */
export function isMiniGameType(value: string): value is MiniGameType {
  return (MINI_GAME_TYPES as readonly string[]).includes(value);
}

// ── Prize-grid group (brukt for både flat og colordraft) ─────────────────────

interface PrizeGroup {
  /** i18n-nøkkel for label. */
  labelKey: string;
  /** Prefix for input-names (f.eks. "price", "redColorPrize"). */
  namePrefix: string;
  /** Antall prize-felter i gruppen. */
  count: number;
  /** Bootstrap-kolonne-størrelse per felt. */
  colSize: "col-lg-1" | "col-lg-2";
  /** data-testid for grid-container. */
  gridTestId: string;
  /** "inline" (label + grid på samme rad) eller "stacked" (label over). */
  layout: "inline" | "stacked";
}

interface MiniGameFormSchema {
  /** i18n-nøkkel for side-tittel (og box-heading). */
  titleKey: string;
  /** Module-id for contentHeader. */
  moduleKey: string;
  /** Form-host container ID. */
  formHostId: string;
  /** Test-prefix (bruker i testIdPrefix og form-id). */
  testPrefix: string;
  /** Gruppene som rendres (1 for wheel/chest/mystery, 3 for colordraft). */
  groups: PrizeGroup[];
  /**
   * Bygger structured-config som sendes til backend. Får tak i rå
   * prize-arrays per namePrefix og eksisterende config for spread.
   */
  buildStructuredConfig: (
    prizes: Record<string, number[]>,
    existingConfig: Record<string, unknown>
  ) => Record<string, unknown>;
  /**
   * Ekstraherer prize-arrays per namePrefix fra eksisterende config.
   */
  extractPrizes: (
    config: Record<string, unknown>
  ) => Record<string, number[]>;
}

// ── Schemas per type ────────────────────────────────────────────────────────

const WHEEL_SEGMENTS = 24;
const CHEST_COUNT = 10;
const MYSTERY_COUNT = 6;
const COLOR_TIER_COUNT = 4;
const COLOR_KEYS = ["red", "yellow", "green"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

/** Ekstraher flat prize-list fra legacy `prizeList` eller nytt felt. */
function extractFlatPrizeList(
  config: Record<string, unknown>,
  count: number,
  newFieldKey: string,
  itemPrizeField: string
): number[] {
  const out: number[] = new Array(count).fill(0);
  const legacy = config.prizeList;
  if (Array.isArray(legacy)) {
    for (let i = 0; i < count; i++) {
      const v = legacy[i];
      if (typeof v === "number" && Number.isFinite(v)) out[i] = v;
    }
    return out;
  }
  const items = config[newFieldKey];
  if (Array.isArray(items)) {
    for (let i = 0; i < count; i++) {
      const item = items[i];
      if (item && typeof item === "object" && itemPrizeField in item) {
        const v = (item as Record<string, unknown>)[itemPrizeField];
        if (typeof v === "number" && Number.isFinite(v)) out[i] = v;
      }
    }
  }
  return out;
}

const WHEEL_SCHEMA: MiniGameFormSchema = {
  titleKey: "wheel_of_fortune",
  moduleKey: "wheel_of_fortune",
  formHostId: "wheel-form-host",
  testPrefix: "wheel",
  groups: [
    {
      labelKey: "wheel_of_fortune_prize",
      namePrefix: "price",
      count: WHEEL_SEGMENTS,
      colSize: "col-lg-1",
      gridTestId: "wheel-prizes",
      layout: "stacked",
    },
  ],
  extractPrizes: (config) => ({
    price: extractFlatPrizeList(config, WHEEL_SEGMENTS, "segments", "prizeAmount"),
  }),
  buildStructuredConfig: (prizes, existing) => {
    const prizeArr = prizes.price ?? [];
    return {
      ...existing,
      segments: prizeArr.map((prizeAmount, i) => ({
        label: String(i + 1),
        prizeAmount,
      })),
      // Legacy-kompat: behold prizeList hvis eksisterende config hadde den.
      prizeList: prizeArr,
    };
  },
};

const CHEST_SCHEMA: MiniGameFormSchema = {
  titleKey: "treasure_chest",
  moduleKey: "treasure_chest",
  formHostId: "chest-form-host",
  testPrefix: "chest",
  groups: [
    {
      labelKey: "treasure_chest_prize",
      namePrefix: "price",
      count: CHEST_COUNT,
      colSize: "col-lg-2",
      gridTestId: "chest-prizes",
      layout: "stacked",
    },
  ],
  extractPrizes: (config) => ({
    price: extractFlatPrizeList(config, CHEST_COUNT, "prizes", "prizeAmount"),
  }),
  buildStructuredConfig: (prizes, existing) => {
    const prizeArr = prizes.price ?? [];
    return {
      ...existing,
      prizes: prizeArr.map((prizeAmount, i) => ({
        label: String(i + 1),
        prizeAmount,
      })),
      prizeList: prizeArr,
    };
  },
};

const MYSTERY_SCHEMA: MiniGameFormSchema = {
  titleKey: "mystery_game",
  moduleKey: "mystery_game",
  formHostId: "mystery-form-host",
  testPrefix: "mystery",
  groups: [
    {
      labelKey: "mystery_game_prize",
      namePrefix: "price",
      count: MYSTERY_COUNT,
      colSize: "col-lg-2",
      gridTestId: "mystery-prizes",
      layout: "stacked",
    },
  ],
  extractPrizes: (config) => ({
    price: extractFlatPrizeList(config, MYSTERY_COUNT, "rewards", "prizeAmount"),
  }),
  buildStructuredConfig: (prizes, existing) => {
    const prizeArr = prizes.price ?? [];
    return {
      ...existing,
      rewards: prizeArr.map((prizeAmount, i) => ({
        label: String(i + 1),
        prizeAmount,
      })),
      prizeList: prizeArr,
    };
  },
};

const COLORDRAFT_SCHEMA: MiniGameFormSchema = {
  titleKey: "color_draft",
  moduleKey: "color_draft",
  formHostId: "colordraft-form-host",
  testPrefix: "colordraft",
  groups: [
    {
      labelKey: "red_color_prize",
      namePrefix: "redColorPrize",
      count: COLOR_TIER_COUNT,
      colSize: "col-lg-2",
      gridTestId: "colordraft-red",
      layout: "inline",
    },
    {
      labelKey: "yellow_color_prize",
      namePrefix: "yellowColorPrize",
      count: COLOR_TIER_COUNT,
      colSize: "col-lg-2",
      gridTestId: "colordraft-yellow",
      layout: "inline",
    },
    {
      labelKey: "green_color_prize",
      namePrefix: "greenColorPrize",
      count: COLOR_TIER_COUNT,
      colSize: "col-lg-2",
      gridTestId: "colordraft-green",
      layout: "inline",
    },
  ],
  extractPrizes: (config) => {
    const perColor: Record<ColorKey, number[]> = {
      red: new Array(COLOR_TIER_COUNT).fill(0),
      yellow: new Array(COLOR_TIER_COUNT).fill(0),
      green: new Array(COLOR_TIER_COUNT).fill(0),
    };

    // Legacy-felter (redPrizes / yellowPrizes / greenPrizes).
    for (const color of COLOR_KEYS) {
      const legacyKey = `${color}Prizes`;
      const arr = config[legacyKey];
      if (Array.isArray(arr)) {
        for (let i = 0; i < COLOR_TIER_COUNT; i++) {
          const v = arr[i];
          if (typeof v === "number" && Number.isFinite(v)) perColor[color][i] = v;
        }
      }
    }

    // Ny shape: colors-array.
    const colors = config.colors;
    if (Array.isArray(colors)) {
      for (const entry of colors) {
        if (!entry || typeof entry !== "object") continue;
        const c = (entry as { color?: unknown }).color;
        const pa = (entry as { prizeAmounts?: unknown }).prizeAmounts;
        if (typeof c !== "string" || !COLOR_KEYS.includes(c as ColorKey)) continue;
        if (!Array.isArray(pa)) continue;
        const key = c as ColorKey;
        for (let i = 0; i < COLOR_TIER_COUNT; i++) {
          const v = pa[i];
          if (typeof v === "number" && Number.isFinite(v)) perColor[key][i] = v;
        }
      }
    }

    return {
      redColorPrize: perColor.red,
      yellowColorPrize: perColor.yellow,
      greenColorPrize: perColor.green,
    };
  },
  buildStructuredConfig: (prizes, existing) => {
    const redPrizes = prizes.redColorPrize ?? [];
    const yellowPrizes = prizes.yellowColorPrize ?? [];
    const greenPrizes = prizes.greenColorPrize ?? [];
    return {
      ...existing,
      // Ny shape: colors-array.
      colors: [
        { color: "red", prizeAmounts: redPrizes },
        { color: "yellow", prizeAmounts: yellowPrizes },
        { color: "green", prizeAmounts: greenPrizes },
      ],
      // Legacy-kompat.
      redPrizes,
      yellowPrizes,
      greenPrizes,
    };
  },
};

const SCHEMAS: Record<MiniGameType, MiniGameFormSchema> = {
  wheel: WHEEL_SCHEMA,
  chest: CHEST_SCHEMA,
  mystery: MYSTERY_SCHEMA,
  colordraft: COLORDRAFT_SCHEMA,
};

/** Returner schema for en gitt type (eksponert for tester). */
export function schemaForType(type: MiniGameType): MiniGameFormSchema {
  return SCHEMAS[type];
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderGroup(group: PrizeGroup, values: number[]): string {
  const label = escapeHtml(t(group.labelKey));
  const grid = renderPrizeGrid(values, group.count, group.namePrefix, group.colSize);

  if (group.layout === "stacked") {
    // Label på egen rad (col-sm-12), grid under (col-sm-12).
    return `
      <div class="form-group">
        <label class="col-sm-12">${label}</label>
        <div class="col-sm-12" data-testid="${escapeHtml(group.gridTestId)}">
          ${grid}
        </div>
      </div>`;
  }
  // inline: label col-sm-4, grid col-sm-8 (colordraft-layout).
  return `
    <div class="form-group">
      <label class="col-sm-4 control-label">${label}</label>
      <div class="col-sm-8" data-testid="${escapeHtml(group.gridTestId)}">
        ${grid}
      </div>
    </div>`;
}

/**
 * Render den generiske mini-game-config-siden for en gitt type.
 * Kalles fra dispatcheren (`mountOtherGamesRoute`).
 */
export function renderMiniGameConfigPage(
  container: HTMLElement,
  type: MiniGameType
): void {
  const schema = SCHEMAS[type];
  const host = renderOtherGamesShell(
    container,
    schema.titleKey,
    schema.moduleKey,
    schema.formHostId,
    schema.testPrefix
  );
  void mount(host, type, schema);
}

async function mount(
  host: HTMLElement,
  type: MiniGameType,
  schema: MiniGameFormSchema
): Promise<void> {
  const cfg = await loadMiniGameConfig(host, type);
  if (!cfg) return;

  const prizesByPrefix = schema.extractPrizes(cfg.config);
  const formId = `${schema.testPrefix}-form`;

  const groupsHtml = schema.groups
    .map((g) => renderGroup(g, prizesByPrefix[g.namePrefix] ?? []))
    .join("");

  host.innerHTML = `
    <form id="${escapeHtml(formId)}" class="form-horizontal" data-testid="${escapeHtml(formId)}">
      ${groupsHtml}
      ${activeAndJsonRow(cfg.active, cfg.config)}
      ${submitRow()}
    </form>`;

  const form = host.querySelector<HTMLFormElement>(`#${formId}`)!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      const collected: Record<string, number[]> = {};
      for (const g of schema.groups) {
        collected[g.namePrefix] = collectPrizes(form, g.namePrefix, g.count);
      }
      const structured = schema.buildStructuredConfig(collected, cfg.config);
      await saveMiniGameFromForm(type, form, structured);
    })();
  });
}
