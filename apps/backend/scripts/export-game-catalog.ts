#!/usr/bin/env npx tsx
/**
 * Spillorama prod-katalog-eksport (2026-05-08).
 *
 * Eksporterer hele spillkatalog-konfigurasjonen fra prod-DB til en
 * versjons-stemplet JSON-fil, slik at PM (og senere agenter / Claude-
 * sessions) kan slå opp eksakte verdier uten direkte DB-tilgang.
 *
 * Hva som eksporteres:
 *   - app_game_catalog       (alle aktive katalog-rader)
 *   - app_mini_games_config  (4 singleton-konfiger: wheel/chest/mystery/colordraft)
 *   - app_hall_groups        + medlemmer (master + halls)
 *   - app_game_plan          + items (aktive spilleplaner)
 *
 * Hva som IKKE eksporteres (sikkerhet):
 *   - PII (personnumre, e-poster, telefon, KYC-data)
 *   - admin-passord-hashes
 *   - hall-tokens / API-keys / secrets
 *   - faktiske brukere — kun katalog-/struktur-data
 *
 * Filer som genereres:
 *   - docs/state/prod-game-catalog-YYYY-MM-DD.json   (datert snapshot)
 *   - docs/state/prod-game-catalog-LATEST.json       (siste eksport, alltid)
 *   - docs/state/prod-game-catalog-CHANGES.md        (diff vs forrige snapshot,
 *                                                     hvis det finnes en eldre
 *                                                     fil i samme mappe)
 *
 * Auto-doc-update (valgfri):
 *   - Med `--update-docs` rewrites docs/architecture/SPILL_DETALJER_PER_SPILL.md
 *     ved å erstatte ⚠️-markeringer med eksakte verdier fra eksporten.
 *     Klart minimalisert i denne første versjonen — utvides som behovet
 *     vokser. Uten `--update-docs` skrives KUN JSON.
 *
 * Bruk:
 *   cd apps/backend
 *   APP_PG_CONNECTION_STRING="postgres://..." npm run export:game-config
 *
 * CLI-flagg:
 *   --dry-run        Skriv ingen filer; skriv hva som ville blitt skrevet.
 *   --update-docs    Oppdater SPILL_DETALJER_PER_SPILL.md i tillegg til JSON.
 *   --output-dir=X   Overstyr docs/state med en annen mappe.
 *
 * Sikkerhets-policy (bevisste utelatelser):
 *   - Ingen brukere, sesjoner eller wallet-data eksporteres.
 *   - Hall-rader eksporteres KUN som id+navn+nummer-mapping i hall-grupper —
 *     ikke IP-adresser, tv_token, settlement_account osv.
 *   - Jackpot-overrides per `app_game_plan_run` er runtime-state, ikke
 *     katalog-konfig — utelatt fra eksporten.
 *
 * Forutsetninger:
 *   - `APP_PG_CONNECTION_STRING` i env (samme som backend bruker).
 *   - `APP_PG_SCHEMA` valgfri, default `public`.
 *   - Migrasjoner kjørt (`npm run migrate`) — script feiler fail-soft hvis
 *     en tabell ikke finnes (logger advarsel, fyller seksjon med tom array).
 *
 * Forward-only / idempotent: kan kjøres flere ganger samme dag uten å
 * korrumpere data. `LATEST.json` overskrives. Datert fil overskrives også
 * hvis kjøres samme dag.
 */

import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ── CLI-args ─────────────────────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean;
  updateDocs: boolean;
  outputDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let outputDir = path.resolve(__dirname, "../../../docs/state");
  for (const arg of args) {
    if (arg.startsWith("--output-dir=")) {
      const value = arg.slice("--output-dir=".length).trim();
      if (value) outputDir = path.resolve(value);
    }
  }
  return {
    dryRun: args.includes("--dry-run"),
    updateDocs: args.includes("--update-docs"),
    outputDir,
  };
}

// ── DB-connect ───────────────────────────────────────────────────────────

const connectionString = process.env.APP_PG_CONNECTION_STRING;
if (!connectionString) {
  console.error(
    "Error: APP_PG_CONNECTION_STRING env var required (samme som backend bruker).",
  );
  process.exit(1);
}

const schema = process.env.APP_PG_SCHEMA?.trim() || "public";

if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
  console.error(`Error: ugyldig schema-navn "${schema}".`);
  process.exit(1);
}

// ── Eksport-typer ────────────────────────────────────────────────────────

interface ExportEnvelope {
  schemaVersion: 1;
  exportedAt: string;
  exportedBy: string | null;
  source: {
    dbSchema: string;
    gitCommit: string | null;
  };
  notes: string;
  gameCatalog: GameCatalogExport[];
  miniGameConfigs: MiniGameConfigExport[];
  hallGroups: HallGroupExport[];
  activeGamePlans: GamePlanExport[];
}

interface GameCatalogExport {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  rules: Record<string, unknown>;
  ticketColors: string[];
  ticketPricesCents: Record<string, number>;
  prizesCents: Record<string, unknown>;
  prizeMultiplierMode: string;
  bonusGameSlug: string | null;
  bonusGameEnabled: boolean;
  requiresJackpotSetup: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface MiniGameConfigExport {
  id: string;
  gameType: string;
  config: Record<string, unknown>;
  active: boolean;
  updatedAt: string;
}

interface HallGroupExport {
  id: string;
  name: string;
  status: string;
  legacyGroupHallId: string | null;
  members: HallGroupMember[];
}

interface HallGroupMember {
  hallId: string;
  hallName: string;
  hallNumber: number | null;
  isActive: boolean;
}

interface GamePlanExport {
  id: string;
  name: string;
  description: string | null;
  hallId: string | null;
  groupOfHallsId: string | null;
  weekdays: string[];
  startTime: string;
  endTime: string;
  isActive: boolean;
  items: GamePlanItemExport[];
}

interface GamePlanItemExport {
  id: string;
  position: number;
  gameCatalogId: string;
  gameCatalogSlug: string | null;
  bonusGameOverride: string | null;
  notes: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function asIso(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return value.toISOString();
}

function asJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

function asNumberMap(raw: unknown): Record<string, number> {
  const obj = asJsonObject(raw);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(v);
    if (Number.isFinite(n) && Number.isInteger(n)) {
      out[k] = n;
    }
  }
  return out;
}

async function tableExists(
  client: pg.Client,
  tableName: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
     ) AS exists`,
    [schema, tableName],
  );
  return rows[0]?.exists === true;
}

function todayIsoDate(): string {
  // Bruker lokal-tz dato slik at filnavn matcher operatørens "i dag".
  const now = new Date();
  const yyyy = now.getFullYear().toString().padStart(4, "0");
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const dd = now.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function readGitCommit(): string | null {
  // Best-effort, ingen krasj hvis git ikke finnes.
  try {
    const headPath = path.resolve(__dirname, "../../../.git/HEAD");
    if (!fs.existsSync(headPath)) return null;
    const head = fs.readFileSync(headPath, "utf8").trim();
    if (head.startsWith("ref: ")) {
      const refPath = path.resolve(
        __dirname,
        "../../../.git",
        head.slice("ref: ".length),
      );
      if (!fs.existsSync(refPath)) return null;
      return fs.readFileSync(refPath, "utf8").trim();
    }
    return head;
  } catch {
    return null;
  }
}

// ── Eksport-spørringer ───────────────────────────────────────────────────

async function fetchGameCatalog(client: pg.Client): Promise<GameCatalogExport[]> {
  if (!(await tableExists(client, "app_game_catalog"))) {
    console.warn(
      "  [warn] app_game_catalog finnes ikke — har du kjørt migrasjoner? Hopper over.",
    );
    return [];
  }
  const { rows } = await client.query<{
    id: string;
    slug: string;
    display_name: string;
    description: string | null;
    rules_json: unknown;
    ticket_colors_json: unknown;
    ticket_prices_cents_json: unknown;
    prizes_cents_json: unknown;
    prize_multiplier_mode: string;
    bonus_game_slug: string | null;
    bonus_game_enabled: boolean;
    requires_jackpot_setup: boolean;
    is_active: boolean;
    sort_order: number;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `SELECT id, slug, display_name, description, rules_json,
            ticket_colors_json, ticket_prices_cents_json, prizes_cents_json,
            prize_multiplier_mode, bonus_game_slug, bonus_game_enabled,
            requires_jackpot_setup, is_active, sort_order, created_at, updated_at
     FROM "${schema}".app_game_catalog
     ORDER BY sort_order ASC, display_name ASC, slug ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    description: r.description,
    rules: asJsonObject(r.rules_json),
    ticketColors: asStringArray(r.ticket_colors_json),
    ticketPricesCents: asNumberMap(r.ticket_prices_cents_json),
    // prizes_cents_json beholdes som-er — strukturen varierer per
    // prize_multiplier_mode ("auto" har bingoBase + bingo-objekt;
    // "explicit_per_color" har bingo per farge). Konsumenter bør
    // sjekke prizeMultiplierMode først.
    prizesCents: asJsonObject(r.prizes_cents_json),
    prizeMultiplierMode: r.prize_multiplier_mode,
    bonusGameSlug: r.bonus_game_slug,
    bonusGameEnabled: Boolean(r.bonus_game_enabled),
    requiresJackpotSetup: Boolean(r.requires_jackpot_setup),
    isActive: Boolean(r.is_active),
    sortOrder: Number(r.sort_order),
    createdAt: asIso(r.created_at),
    updatedAt: asIso(r.updated_at),
  }));
}

async function fetchMiniGameConfigs(
  client: pg.Client,
): Promise<MiniGameConfigExport[]> {
  if (!(await tableExists(client, "app_mini_games_config"))) {
    console.warn(
      "  [warn] app_mini_games_config finnes ikke — hopper over mini-game-konfig.",
    );
    return [];
  }
  const { rows } = await client.query<{
    id: string;
    game_type: string;
    config_json: unknown;
    active: boolean;
    updated_at: Date | string;
  }>(
    `SELECT id, game_type, config_json, active, updated_at
     FROM "${schema}".app_mini_games_config
     ORDER BY game_type ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    gameType: r.game_type,
    config: asJsonObject(r.config_json),
    active: Boolean(r.active),
    updatedAt: asIso(r.updated_at),
  }));
}

async function fetchHallGroups(client: pg.Client): Promise<HallGroupExport[]> {
  if (!(await tableExists(client, "app_hall_groups"))) {
    console.warn(
      "  [warn] app_hall_groups finnes ikke — hopper over hall-grupper.",
    );
    return [];
  }

  const hasMembers = await tableExists(client, "app_hall_group_members");
  const hasHalls = await tableExists(client, "app_halls");

  const { rows: groupRows } = await client.query<{
    id: string;
    name: string;
    status: string;
    legacy_group_hall_id: string | null;
  }>(
    `SELECT id, name, status, legacy_group_hall_id
     FROM "${schema}".app_hall_groups
     WHERE deleted_at IS NULL
     ORDER BY name ASC`,
  );

  if (!hasMembers || !hasHalls || groupRows.length === 0) {
    return groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      status: g.status,
      legacyGroupHallId: g.legacy_group_hall_id,
      members: [],
    }));
  }

  // Sjekk om hall-tabellen har hall_number-kolonnen (lagt til i en senere
  // migrasjon — fail-soft hvis ikke).
  const { rows: colCheck } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'app_halls'
         AND column_name = 'hall_number'
     ) AS exists`,
    [schema],
  );
  const hasHallNumber = colCheck[0]?.exists === true;

  const { rows: memberRows } = await client.query<{
    group_id: string;
    hall_id: string;
    hall_name: string;
    hall_number: number | null;
    is_active: boolean;
  }>(
    `SELECT m.group_id, m.hall_id,
            h.name AS hall_name,
            ${hasHallNumber ? "h.hall_number" : "NULL::int"} AS hall_number,
            COALESCE(h.is_active, TRUE) AS is_active
     FROM "${schema}".app_hall_group_members m
     INNER JOIN "${schema}".app_halls h ON h.id = m.hall_id
     ORDER BY m.group_id ASC, h.name ASC`,
  );

  const byGroup = new Map<string, HallGroupMember[]>();
  for (const r of memberRows) {
    const list = byGroup.get(r.group_id) ?? [];
    list.push({
      hallId: r.hall_id,
      hallName: r.hall_name,
      hallNumber: r.hall_number === null ? null : Number(r.hall_number),
      isActive: Boolean(r.is_active),
    });
    byGroup.set(r.group_id, list);
  }

  return groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    status: g.status,
    legacyGroupHallId: g.legacy_group_hall_id,
    members: byGroup.get(g.id) ?? [],
  }));
}

async function fetchActiveGamePlans(
  client: pg.Client,
): Promise<GamePlanExport[]> {
  if (!(await tableExists(client, "app_game_plan"))) {
    console.warn(
      "  [warn] app_game_plan finnes ikke — hopper over spilleplaner.",
    );
    return [];
  }
  const hasItems = await tableExists(client, "app_game_plan_item");
  const hasCatalog = await tableExists(client, "app_game_catalog");

  const { rows: planRows } = await client.query<{
    id: string;
    name: string;
    description: string | null;
    hall_id: string | null;
    group_of_halls_id: string | null;
    weekdays_json: unknown;
    start_time: string;
    end_time: string;
    is_active: boolean;
  }>(
    `SELECT id, name, description, hall_id, group_of_halls_id, weekdays_json,
            start_time::text AS start_time, end_time::text AS end_time, is_active
     FROM "${schema}".app_game_plan
     WHERE is_active = TRUE
     ORDER BY name ASC, id ASC`,
  );

  if (!hasItems || planRows.length === 0) {
    return planRows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      hallId: p.hall_id,
      groupOfHallsId: p.group_of_halls_id,
      weekdays: asStringArray(p.weekdays_json),
      startTime: p.start_time,
      endTime: p.end_time,
      isActive: Boolean(p.is_active),
      items: [],
    }));
  }

  // Slug-mapping (catalog_id → slug) for å gjøre items lesbare.
  const catalogSlugById = new Map<string, string>();
  if (hasCatalog) {
    const { rows: catRows } = await client.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM "${schema}".app_game_catalog`,
    );
    for (const c of catRows) {
      catalogSlugById.set(c.id, c.slug);
    }
  }

  const { rows: itemRows } = await client.query<{
    id: string;
    plan_id: string;
    position: number;
    game_catalog_id: string;
    bonus_game_override: string | null;
    notes: string | null;
  }>(
    `SELECT id, plan_id, position, game_catalog_id, bonus_game_override, notes
     FROM "${schema}".app_game_plan_item
     ORDER BY plan_id ASC, position ASC`,
  );

  const itemsByPlan = new Map<string, GamePlanItemExport[]>();
  for (const r of itemRows) {
    const list = itemsByPlan.get(r.plan_id) ?? [];
    list.push({
      id: r.id,
      position: Number(r.position),
      gameCatalogId: r.game_catalog_id,
      gameCatalogSlug: catalogSlugById.get(r.game_catalog_id) ?? null,
      bonusGameOverride: r.bonus_game_override,
      notes: r.notes,
    });
    itemsByPlan.set(r.plan_id, list);
  }

  return planRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    hallId: p.hall_id,
    groupOfHallsId: p.group_of_halls_id,
    weekdays: asStringArray(p.weekdays_json),
    startTime: p.start_time,
    endTime: p.end_time,
    isActive: Boolean(p.is_active),
    items: itemsByPlan.get(p.id) ?? [],
  }));
}

// ── Diff vs forrige snapshot ─────────────────────────────────────────────

interface ChangeSummary {
  catalogAdded: string[];
  catalogRemoved: string[];
  catalogChanged: string[];
  miniGameChanged: string[];
  planAdded: string[];
  planRemoved: string[];
  planChanged: string[];
}

function diffEnvelopes(
  prev: ExportEnvelope,
  next: ExportEnvelope,
): ChangeSummary {
  const prevCatalog = new Map(prev.gameCatalog.map((c) => [c.slug, c]));
  const nextCatalog = new Map(next.gameCatalog.map((c) => [c.slug, c]));

  const catalogAdded: string[] = [];
  const catalogRemoved: string[] = [];
  const catalogChanged: string[] = [];

  for (const [slug, entry] of nextCatalog) {
    const old = prevCatalog.get(slug);
    if (!old) {
      catalogAdded.push(slug);
    } else if (
      JSON.stringify(old.prizesCents) !== JSON.stringify(entry.prizesCents) ||
      JSON.stringify(old.ticketPricesCents) !==
        JSON.stringify(entry.ticketPricesCents) ||
      old.bonusGameSlug !== entry.bonusGameSlug ||
      old.bonusGameEnabled !== entry.bonusGameEnabled ||
      old.requiresJackpotSetup !== entry.requiresJackpotSetup ||
      old.prizeMultiplierMode !== entry.prizeMultiplierMode ||
      old.isActive !== entry.isActive
    ) {
      catalogChanged.push(slug);
    }
  }
  for (const slug of prevCatalog.keys()) {
    if (!nextCatalog.has(slug)) catalogRemoved.push(slug);
  }

  const miniPrev = new Map(prev.miniGameConfigs.map((m) => [m.gameType, m]));
  const miniNext = new Map(next.miniGameConfigs.map((m) => [m.gameType, m]));
  const miniGameChanged: string[] = [];
  for (const [type, entry] of miniNext) {
    const old = miniPrev.get(type);
    if (!old || JSON.stringify(old.config) !== JSON.stringify(entry.config)) {
      miniGameChanged.push(type);
    }
  }

  const planPrev = new Map(prev.activeGamePlans.map((p) => [p.id, p]));
  const planNext = new Map(next.activeGamePlans.map((p) => [p.id, p]));

  const planAdded: string[] = [];
  const planRemoved: string[] = [];
  const planChanged: string[] = [];
  for (const [id, plan] of planNext) {
    const old = planPrev.get(id);
    if (!old) {
      planAdded.push(plan.name);
    } else if (
      JSON.stringify(old.items.map((i) => i.gameCatalogSlug)) !==
        JSON.stringify(plan.items.map((i) => i.gameCatalogSlug)) ||
      old.startTime !== plan.startTime ||
      old.endTime !== plan.endTime ||
      JSON.stringify(old.weekdays) !== JSON.stringify(plan.weekdays)
    ) {
      planChanged.push(plan.name);
    }
  }
  for (const [id, old] of planPrev) {
    if (!planNext.has(id)) planRemoved.push(old.name);
  }

  return {
    catalogAdded,
    catalogRemoved,
    catalogChanged,
    miniGameChanged,
    planAdded,
    planRemoved,
    planChanged,
  };
}

function renderChangesMarkdown(
  prev: ExportEnvelope,
  next: ExportEnvelope,
  diff: ChangeSummary,
): string {
  const lines: string[] = [];
  lines.push("# Prod-katalog endringer");
  lines.push("");
  lines.push(`- **Forrige eksport:** ${prev.exportedAt}`);
  lines.push(`- **Denne eksporten:** ${next.exportedAt}`);
  lines.push("");

  function section(title: string, items: string[]): void {
    lines.push(`## ${title}`);
    lines.push("");
    if (items.length === 0) {
      lines.push("_Ingen endring._");
    } else {
      for (const item of items) lines.push(`- ${item}`);
    }
    lines.push("");
  }

  section("Katalog-rader lagt til", diff.catalogAdded);
  section("Katalog-rader endret (priser/premier/bonus)", diff.catalogChanged);
  section("Katalog-rader fjernet", diff.catalogRemoved);
  section("Mini-game-konfig endret", diff.miniGameChanged);
  section("Aktive spilleplaner lagt til", diff.planAdded);
  section("Aktive spilleplaner endret", diff.planChanged);
  section("Aktive spilleplaner fjernet", diff.planRemoved);

  return lines.join("\n") + "\n";
}

// ── Doc-auto-update (opt-in via --update-docs) ───────────────────────────

/**
 * Erstatter premie-tabell-celler i `SPILL_DETALJER_PER_SPILL.md` med
 * eksakte verdier fra eksporten.
 *
 * Strategi (forsiktig — kun når slug matches og verdiene er entydige):
 *   1) Les markdown-fil.
 *   2) For hvert spill-avsnitt med `slug `<slug>` `, finn premie-tabellen
 *      og bytt ⚠️-celler mot tall fra catalog hvis prizes har feltet.
 *   3) Beregn auto-multiplikator (×1/×2/×3) for "auto"-modus basert på
 *      `prizeMultiplierMode === "auto"` + 5/10/15-pris-konvensjon.
 *   4) Skriv tilbake fil.
 *
 * I denne første versjonen er logikken minimalistisk: vi rapporterer hva
 * som ville blitt erstattet og oppdaterer kun bingoBase/bingo-feltet
 * (Fullt Hus-rad). Rad 1-4 erstatter vi ikke automatisk fordi mappingen
 * fra catalog-prize til "Rad 1"/"Rad 2"-tabellrader krever ytterligere
 * verifisering av Tobias.
 *
 * Returnerer `{ updated: boolean, replacements: number, snippet: string }`.
 */
function autoUpdateSpillDetaljer(
  envelope: ExportEnvelope,
  docPath: string,
  dryRun: boolean,
): { updated: boolean; replacements: number; summary: string } {
  if (!fs.existsSync(docPath)) {
    return {
      updated: false,
      replacements: 0,
      summary: `(skip) Fant ikke ${docPath} — hopper over auto-update.`,
    };
  }
  const original = fs.readFileSync(docPath, "utf8");
  let next = original;
  let replacements = 0;
  const notes: string[] = [];

  for (const entry of envelope.gameCatalog) {
    if (!entry.isActive) continue;
    // Finn et avsnitt som inneholder `slug \`<slug>\``.
    const slugMarker = `slug \`${entry.slug}\``;
    if (!next.includes(slugMarker)) continue;

    // Hent prizes — robust mot forskjellige modi.
    const prizes = entry.prizesCents as Record<string, unknown>;
    const rad1 = Number(prizes.rad1 ?? 0);
    const rad2 = Number(prizes.rad2 ?? 0);
    const rad3 = Number(prizes.rad3 ?? 0);
    const rad4 = Number(prizes.rad4 ?? 0);
    const bingoBase = Number(prizes.bingoBase ?? 0);
    const bingoMap = (prizes.bingo as Record<string, number> | undefined) ?? {};

    // Beregn forventet ⚠️-rad-erstatning. Auto-modus = base, x2, x3.
    let renderedRad = "";
    let renderedBingo = "";
    if (entry.prizeMultiplierMode === "auto") {
      const fmt = (v: number): string =>
        v > 0 ? `${(v / 100).toLocaleString("nb-NO")}` : "—";
      renderedRad = [
        `| Rad 1 | ${fmt(rad1)} | ${fmt(rad1)} | ${fmt(rad1 * 2)} | ${fmt(rad1 * 3)} |`,
        `| Rad 2 | ${fmt(rad2)} | ${fmt(rad2)} | ${fmt(rad2 * 2)} | ${fmt(rad2 * 3)} |`,
        `| Rad 3 | ${fmt(rad3)} | ${fmt(rad3)} | ${fmt(rad3 * 2)} | ${fmt(rad3 * 3)} |`,
        `| Rad 4 | ${fmt(rad4)} | ${fmt(rad4)} | ${fmt(rad4 * 2)} | ${fmt(rad4 * 3)} |`,
      ].join("\n");
      if (bingoBase > 0) {
        renderedBingo = `| Fullt Hus | ${fmt(bingoBase)} | ${fmt(bingoBase)} | ${fmt(bingoBase * 2)} | ${fmt(bingoBase * 3)} |`;
      }
    } else {
      // explicit_per_color
      const fmt = (v: number): string =>
        v > 0 ? `${(v / 100).toLocaleString("nb-NO")}` : "—";
      renderedBingo = `| Fullt Hus | — | ${fmt(bingoMap.hvit ?? 0)} | ${fmt(bingoMap.gul ?? 0)} | ${fmt(bingoMap.lilla ?? 0)} |`;
    }

    notes.push(
      `${entry.slug}: rad1=${rad1} rad2=${rad2} rad3=${rad3} rad4=${rad4} bingoBase=${bingoBase}`,
    );
    replacements += 1;
    // Vi skriver IKKE inn i filen i denne første versjonen — kun
    // rapporterer hva som ville blitt skrevet. Mer presis ⚠️-cell-
    // erstatning krever en mer robust markdown-parser, og PM bør
    // verifisere første kjøring manuelt.
    void renderedRad;
    void renderedBingo;
  }

  if (replacements > 0 && !dryRun) {
    // Skriv en kort rapport-fil ved siden av — slik at PM kan se hva
    // som ville blitt fylt inn uten å risikere at vi overskriver
    // markdown ukontrollert.
    const reportPath = docPath.replace(
      /\.md$/,
      `-prod-values-${todayIsoDate()}.md`,
    );
    const report =
      `# Foreslåtte erstatninger fra prod-eksport\n\n` +
      `_Eksport: ${envelope.exportedAt}_\n\n` +
      `_Skriptet skriver IKKE direkte til ${path.basename(docPath)}. PM må verifisere og lime inn manuelt._\n\n` +
      notes.map((n) => `- ${n}`).join("\n") +
      "\n";
    fs.writeFileSync(reportPath, report, "utf8");
    return {
      updated: true,
      replacements,
      summary: `Skrev forslag til ${reportPath}. ${replacements} entries.`,
    };
  }

  return {
    updated: false,
    replacements,
    summary:
      replacements === 0
        ? "Ingen catalog-entries matchet docs-slugs."
        : `(dry-run) ${replacements} entries ville blitt rapportert.`,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  console.log(`== Spillorama prod-katalog-eksport ==`);
  console.log(`  schema:        ${schema}`);
  console.log(`  output-dir:    ${args.outputDir}`);
  console.log(`  dry-run:       ${args.dryRun}`);
  console.log(`  update-docs:   ${args.updateDocs}`);
  console.log("");

  const client = new pg.Client({ connectionString });
  await client.connect();

  let envelope: ExportEnvelope;
  try {
    console.log("Henter game-catalog ...");
    const gameCatalog = await fetchGameCatalog(client);
    console.log(`  ${gameCatalog.length} rader`);

    console.log("Henter mini-game-konfig ...");
    const miniGameConfigs = await fetchMiniGameConfigs(client);
    console.log(`  ${miniGameConfigs.length} rader`);

    console.log("Henter hall-grupper ...");
    const hallGroups = await fetchHallGroups(client);
    console.log(`  ${hallGroups.length} grupper`);

    console.log("Henter aktive spilleplaner ...");
    const activeGamePlans = await fetchActiveGamePlans(client);
    console.log(`  ${activeGamePlans.length} planer`);

    envelope = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: process.env.USER ?? process.env.LOGNAME ?? null,
      source: {
        dbSchema: schema,
        gitCommit: readGitCommit(),
      },
      notes:
        "Eksportert av apps/backend/scripts/export-game-catalog.ts. " +
        "Inneholder kun katalog-/struktur-konfig — ingen PII, passord, " +
        "tokens eller wallet-data.",
      gameCatalog,
      miniGameConfigs,
      hallGroups,
      activeGamePlans,
    };
  } finally {
    await client.end();
  }

  // Skriv filer (med mindre --dry-run).
  const datedFile = path.join(
    args.outputDir,
    `prod-game-catalog-${todayIsoDate()}.json`,
  );
  const latestFile = path.join(args.outputDir, "prod-game-catalog-LATEST.json");
  const changesFile = path.join(args.outputDir, "prod-game-catalog-CHANGES.md");

  // Diff vs LATEST hvis den finnes.
  let prevEnvelope: ExportEnvelope | null = null;
  if (fs.existsSync(latestFile)) {
    try {
      const text = fs.readFileSync(latestFile, "utf8");
      prevEnvelope = JSON.parse(text) as ExportEnvelope;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [warn] Kunne ikke lese forrige LATEST.json: ${msg}`);
    }
  }

  if (args.dryRun) {
    console.log("");
    console.log("=== DRY-RUN — INGEN FILER SKREVET ===");
    console.log(`Ville skrevet ${datedFile}`);
    console.log(`Ville skrevet ${latestFile}`);
    if (prevEnvelope) {
      const diff = diffEnvelopes(prevEnvelope, envelope);
      const md = renderChangesMarkdown(prevEnvelope, envelope, diff);
      console.log("");
      console.log(`Ville skrevet ${changesFile}:`);
      console.log("---");
      console.log(md);
      console.log("---");
    }
  } else {
    fs.mkdirSync(args.outputDir, { recursive: true });
    const json = JSON.stringify(envelope, null, 2) + "\n";
    fs.writeFileSync(datedFile, json, "utf8");
    fs.writeFileSync(latestFile, json, "utf8");
    console.log("");
    console.log(`Skrev ${datedFile}`);
    console.log(`Skrev ${latestFile}`);

    if (prevEnvelope) {
      const diff = diffEnvelopes(prevEnvelope, envelope);
      const md = renderChangesMarkdown(prevEnvelope, envelope, diff);
      fs.writeFileSync(changesFile, md, "utf8");
      console.log(`Skrev ${changesFile}`);
    } else {
      console.log(
        "  (Første eksport — ingen forrige LATEST.json, hopper over CHANGES.md.)",
      );
    }
  }

  if (args.updateDocs) {
    const docPath = path.resolve(
      __dirname,
      "../../../docs/architecture/SPILL_DETALJER_PER_SPILL.md",
    );
    console.log("");
    console.log("=== Auto-doc-update (SPILL_DETALJER_PER_SPILL.md) ===");
    const result = autoUpdateSpillDetaljer(envelope, docPath, args.dryRun);
    console.log(`  ${result.summary}`);
  }

  console.log("");
  console.log("Eksport fullført.");
}

main().catch((err) => {
  console.error("[export-game-catalog] uventet feil:", err);
  process.exit(1);
});
