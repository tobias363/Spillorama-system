import type { GameDefinition } from "../platform/PlatformService.js";

export type GameSettingFieldType = "string" | "text" | "integer" | "number" | "boolean" | "enum" | "json";

export interface GameSettingFieldOptionDefinition {
  label: string;
  value: string | number | boolean;
}

export interface GameSettingFieldDefinition {
  key: string;
  path: string;
  label: string;
  description: string;
  type: GameSettingFieldType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>;
  required?: boolean;
  readOnly?: boolean;
  isLocked?: boolean;
  lockReason?: string;
  options?: GameSettingFieldOptionDefinition[];
}

export interface GameSettingsSectionDefinition {
  id: string;
  label: string;
  description: string;
  fields: GameSettingFieldDefinition[];
}

export interface GameSettingsDefinition {
  slug: string;
  title: string;
  description: string;
  sections: GameSettingsSectionDefinition[];
  fields: GameSettingFieldDefinition[];
}

export interface AdminSettingsCatalog {
  generatedAt: string;
  games: GameSettingsDefinition[];
}

export interface BingoSettingsCatalogContext {
  minRoundIntervalMs: number;
  minPlayersToStart: number;
  maxTicketsPerPlayer: number;
  fixedAutoDrawIntervalMs: number;
  forceAutoStart: boolean;
  forceAutoDraw: boolean;
  runningRoundLockActive: boolean;
}

function cloneField(field: GameSettingFieldDefinition): GameSettingFieldDefinition {
  return {
    ...field,
    options: field.options ? [...field.options] : undefined
  };
}

function flattenSections(sections: GameSettingsSectionDefinition[]): GameSettingFieldDefinition[] {
  return sections.flatMap((section) => section.fields.map((field) => cloneField(field)));
}

export function buildBingoSettingsDefinition(context: BingoSettingsCatalogContext): GameSettingsDefinition {
  const lockReason = context.runningRoundLockActive
    ? "Kan ikke endres mens en runde kjører. Planlegg endring med effectiveFrom."
    : "";

  const sections: GameSettingsSectionDefinition[] = [
    {
      id: "scheduler",
      label: "Rundeplan",
      description: "Styrer auto-start og minimumsregler for nye runder.",
      fields: [
        {
          key: "autoRoundStartEnabled",
          path: "autoRoundStartEnabled",
          label: "Auto-start aktiv",
          description: "Starter nye runder automatisk når intervallet er nådd.",
          type: "boolean",
          defaultValue: true,
          readOnly: context.forceAutoStart,
          isLocked: context.runningRoundLockActive,
          lockReason: context.forceAutoStart
            ? "Tvunget av driftsregel (force auto-start)."
            : lockReason
        },
        {
          key: "autoRoundStartIntervalMs",
          path: "autoRoundStartIntervalMs",
          label: "Startintervall",
          description: "Tid mellom runde-start i millisekunder.",
          type: "integer",
          min: context.minRoundIntervalMs,
          step: 1000,
          unit: "ms",
          defaultValue: context.minRoundIntervalMs,
          isLocked: context.runningRoundLockActive,
          lockReason
        },
        {
          key: "autoRoundMinPlayers",
          path: "autoRoundMinPlayers",
          label: "Min spillere",
          description: "Minimum antall spillere før ny runde kan starte.",
          type: "integer",
          min: context.minPlayersToStart,
          max: 999,
          step: 1,
          defaultValue: context.minPlayersToStart,
          isLocked: context.runningRoundLockActive,
          lockReason
        },
        {
          key: "autoRoundTicketsPerPlayer",
          path: "autoRoundTicketsPerPlayer",
          label: "Bonger per spiller",
          description: "Antall bonger tildelt hver spiller ved auto-start.",
          type: "integer",
          min: 1,
          max: context.maxTicketsPerPlayer,
          step: 1,
          defaultValue: 1,
          isLocked: context.runningRoundLockActive,
          lockReason
        },
        {
          key: "autoRoundEntryFee",
          path: "autoRoundEntryFee",
          label: "Innsats per runde",
          description: "Innsats (NOK) per runde for auto-start.",
          type: "number",
          min: 0,
          step: 0.01,
          unit: "NOK",
          defaultValue: 0,
          isLocked: context.runningRoundLockActive,
          lockReason
        },
        {
          key: "payoutPercent",
          path: "payoutPercent",
          label: "Utbetaling (%)",
          description: "Andel av innsats som går til premiepotten.",
          type: "number",
          min: 0,
          max: 100,
          step: 0.01,
          unit: "%",
          defaultValue: 90,
          isLocked: context.runningRoundLockActive,
          lockReason
        }
      ]
    },
    {
      id: "draw",
      label: "Trekk",
      description: "Styrer automatisk trekking av tall i aktive runder.",
      fields: [
        {
          key: "autoDrawEnabled",
          path: "autoDrawEnabled",
          label: "Auto-trekk aktiv",
          description: "Trekker nye tall automatisk i aktive runder.",
          type: "boolean",
          defaultValue: true,
          readOnly: context.forceAutoDraw,
          isLocked: context.runningRoundLockActive,
          lockReason: context.forceAutoDraw
            ? "Tvunget av driftsregel (force auto-draw)."
            : lockReason
        },
        {
          key: "autoDrawIntervalMs",
          path: "autoDrawIntervalMs",
          label: "Trekkintervall",
          description: `Tid mellom hvert trekk i millisekunder. Fast verdi: ${context.fixedAutoDrawIntervalMs} ms.`,
          type: "integer",
          min: context.fixedAutoDrawIntervalMs,
          max: context.fixedAutoDrawIntervalMs,
          step: 50,
          unit: "ms",
          defaultValue: context.fixedAutoDrawIntervalMs,
          readOnly: true,
          isLocked: true,
          lockReason: `Låst av kode til ${context.fixedAutoDrawIntervalMs} ms.`
        }
      ]
    }
  ];

  return {
    slug: "bingo",
    title: "Bingo",
    description: "Typed driftsinnstillinger for live bingo.",
    sections,
    fields: flattenSections(sections)
  };
}

export function buildDefaultGameSettingsDefinition(game: GameDefinition): GameSettingsDefinition {
  return {
    slug: game.slug,
    title: game.title,
    description: game.description,
    sections: [],
    fields: []
  };
}
