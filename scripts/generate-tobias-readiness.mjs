#!/usr/bin/env node
/**
 * generate-tobias-readiness.mjs
 *
 * Tobias-direktiv 2026-05-13: Tobias' verifiserings-burden må ned. For hver
 * PR genererer vi en konkret "smoke-test"-seksjon som forteller han nøyaktig
 * hvilke UI-handlinger han skal gjøre (URL, credentials, klikk-rekkefølge,
 * forventet resultat). Erstatter aldri manuell review — gjør den raskere.
 *
 * Inputs:
 *   --diff-file <path>          Fil som inneholder output av `git diff --name-only base..head`
 *                               Hvis utelatt: les fra stdin
 *   --commit-messages <path>    Fil med commit-meldinger (én per linje, oneline-format)
 *                               Valgfri — brukes for "Hva endret"-paragrafen
 *   --output-file <path>        Skriv markdown hit (default: stdout)
 *   --templates-dir <path>      Override template-dir (default: scripts/tobias-readiness-templates)
 *
 * Output: markdown-blokk klar til å limes inn i ai-fragility-review.yml-kommentar.
 *
 * Heuristikk for scenario-matching:
 *   - apps/backend/src/sockets/game1*               → master-start + spiller-buy
 *   - apps/backend/src/game/MasterActionService.ts  → master-start + master-stop
 *   - apps/backend/src/game/Game1*Service.ts        → master-start + spiller-buy
 *   - apps/backend/src/game/Game1Engine.ts          → spiller-mark
 *   - apps/backend/src/game/Game1PayoutService.ts   → wallet-touch + master-advance
 *   - packages/game-client/src/games/game1/screens/PlayScreen.ts → spiller-buy
 *   - packages/game-client/src/games/game1/components/TicketGrid* → spiller-buy
 *   - apps/admin-web/src/pages/cash-inout/*         → master-start + master-stop
 *   - apps/backend/src/wallet/* + apps/backend/src/compliance/* → wallet-touch
 *   - .husky/*, scripts/* (untatt scripts/dev/seed*) → docs-only
 *   - .github/*, docs/*, *.md only                  → docs-only
 *   - resten                                        → unknown
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// CLI-arg-parsing (minimalt, ingen ekstern dep)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Input-lesing
// ---------------------------------------------------------------------------

function readDiffFiles(diffFilePath) {
  let raw;
  if (diffFilePath) {
    raw = readFileSync(diffFilePath, "utf8");
  } else if (!process.stdin.isTTY) {
    // Synchronously read stdin (small input — git diff --name-only is bounded)
    raw = readFileSync(0, "utf8");
  } else {
    raw = "";
  }
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function readCommitMessages(commitMsgPath) {
  if (!commitMsgPath || !existsSync(commitMsgPath)) return [];
  return readFileSync(commitMsgPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Scenario-matching — heuristikk
// ---------------------------------------------------------------------------

/**
 * Klassifiser hver fil til ett eller flere scenario-tags.
 * En fil kan trigge flere scenarier (f.eks. MasterActionService → start + stop).
 */
export function classifyFile(filepath) {
  const f = filepath.replace(/\\/g, "/"); // normalize for cross-platform

  // docs-only checks først (mest spesifikke)
  if (
    f.startsWith("docs/") ||
    f.startsWith(".github/ISSUE_TEMPLATE") ||
    f.endsWith(".md") && !f.includes("packages/") && !f.includes("apps/") && !f.includes("scripts/")
  ) {
    return ["docs-only"];
  }

  // husky/ci-scripts → docs-only (Tobias trenger ikke teste CI-konfig manuelt)
  if (f.startsWith(".husky/") || (f.startsWith("scripts/") && !f.startsWith("scripts/dev/seed"))) {
    return ["docs-only"];
  }

  // Github workflows / templates
  if (f.startsWith(".github/workflows/") || f.startsWith(".github/pull_request_template")) {
    return ["docs-only"];
  }

  const scenarios = new Set();

  // Backend sockets — game1-pathway
  if (/^apps\/backend\/src\/sockets\/game1/.test(f)) {
    scenarios.add("master-start");
    scenarios.add("spiller-buy");
  }

  // MasterActionService — start + stop + advance
  if (/^apps\/backend\/src\/game\/MasterActionService\.ts$/.test(f)) {
    scenarios.add("master-start");
    scenarios.add("master-stop");
    scenarios.add("master-advance");
  }

  // GamePlanRunService — typisk koblet til master-flyt
  if (/^apps\/backend\/src\/game\/GamePlanRunService\.ts$/.test(f)) {
    scenarios.add("master-start");
    scenarios.add("master-stop");
  }

  // Game1*Service (untatt MasterActionService som har egen regel over)
  if (
    /^apps\/backend\/src\/game\/Game1[A-Z][a-zA-Z]+Service\.ts$/.test(f) &&
    !f.includes("MasterActionService")
  ) {
    scenarios.add("master-start");
    scenarios.add("spiller-buy");
  }

  // Engine — ball-trekning + auto-mark
  if (
    /^apps\/backend\/src\/game\/(BingoEngine|Game1Engine|Game1DrawEngineService)\.ts$/.test(f)
  ) {
    scenarios.add("spiller-mark");
  }

  // Payout-service
  if (/^apps\/backend\/src\/game\/Game1PayoutService\.ts$/.test(f)) {
    scenarios.add("master-advance");
    scenarios.add("wallet-touch");
  }

  // Wallet- og compliance-paths
  if (
    /^apps\/backend\/src\/(wallet|compliance|adapters\/.*Wallet|adapters\/.*Compliance)/.test(f)
  ) {
    scenarios.add("wallet-touch");
  }

  // Ticket-purchase
  if (/^apps\/backend\/src\/game\/Game1TicketPurchaseService\.ts$/.test(f)) {
    scenarios.add("spiller-buy");
    scenarios.add("wallet-touch");
  }

  // Frontend — game-client
  if (
    /^packages\/game-client\/src\/games\/game1\/screens\/PlayScreen\.ts$/.test(f) ||
    /^packages\/game-client\/src\/games\/game1\/components\/(Buy|TicketGrid)/.test(f)
  ) {
    scenarios.add("spiller-buy");
  }

  // PlayScreen marking-logic / cell-render
  if (
    /^packages\/game-client\/src\/games\/game1\/components\/(Cell|MarkRenderer)/.test(f) ||
    /^packages\/game-client\/src\/games\/game1\/screens\/PlayScreen\.ts$/.test(f)
  ) {
    scenarios.add("spiller-mark");
  }

  // Admin-web — master-konsoll
  if (/^apps\/admin-web\/src\/pages\/cash-inout\//.test(f)) {
    scenarios.add("master-start");
    scenarios.add("master-stop");
  }

  if (/^apps\/admin-web\/src\/pages\/agent-portal\/NextGamePanel/.test(f)) {
    scenarios.add("master-start");
    scenarios.add("master-advance");
  }

  // Shared-types — påvirker både master + spiller; default master-start
  if (/^packages\/shared-types\/src\/(spill1|socket-events|api)/.test(f)) {
    scenarios.add("master-start");
    scenarios.add("spiller-buy");
  }

  // No match → unknown
  if (scenarios.size === 0) {
    return ["unknown"];
  }

  return [...scenarios];
}

/**
 * Aggreger scenario-tags på tvers av filer. Hvis ALLE filer er docs-only → docs-only.
 * Ellers samle unique non-docs-scenarier (dropp docs-only/unknown hvis det finnes ekte scenarier).
 */
export function aggregateScenarios(files) {
  if (files.length === 0) {
    return { scenarios: ["unknown"], allDocsOnly: false };
  }

  const allTags = files.flatMap((f) => classifyFile(f));
  const uniqueTags = [...new Set(allTags)];

  // Hvis hver eneste fil er docs-only → docs-only PR
  const everyFileDocsOnly = files.every((f) => {
    const tags = classifyFile(f);
    return tags.length === 1 && tags[0] === "docs-only";
  });

  if (everyFileDocsOnly) {
    return { scenarios: ["docs-only"], allDocsOnly: true };
  }

  // Ellers: dropp docs-only fra aggregert liste (det er kun "støy" når ekte scenarier finnes)
  const realScenarios = uniqueTags.filter((t) => t !== "docs-only");

  // Hvis kun "unknown" igjen → unknown
  if (realScenarios.length === 1 && realScenarios[0] === "unknown") {
    return { scenarios: ["unknown"], allDocsOnly: false };
  }

  // Dropp "unknown" hvis det finnes andre scenarier (de er mer informative)
  const finalScenarios = realScenarios.length > 1
    ? realScenarios.filter((t) => t !== "unknown")
    : realScenarios;

  return { scenarios: finalScenarios, allDocsOnly: false };
}

// ---------------------------------------------------------------------------
// Template-rendering
// ---------------------------------------------------------------------------

function loadTemplate(name, templatesDir) {
  const path = resolve(templatesDir, `${name}.md`);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
}

function renderTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Summary-generering — 1-3 setninger om hva PR-en gjør
// ---------------------------------------------------------------------------

export function buildSummary(files, commitMessages) {
  // Prioritet: bruk commit-meldinger hvis tilgjengelig
  if (commitMessages.length > 0) {
    // Ta første ikke-merge-commit-melding, fjern Conventional Commits-prefix
    const firstReal = commitMessages.find((m) => !m.toLowerCase().startsWith("merge"));
    if (firstReal) {
      // Strip "<type>(<scope>): "-prefiks for renere visning
      const cleaned = firstReal.replace(/^[a-z]+(\([^)]+\))?:\s+/i, "").trim();
      // Capitalize første bokstav
      const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      return capitalized;
    }
  }

  // Fallback: oppsummer fra fil-typer
  const counts = {
    backend: files.filter((f) => f.startsWith("apps/backend/")).length,
    admin: files.filter((f) => f.startsWith("apps/admin-web/")).length,
    gameClient: files.filter((f) => f.startsWith("packages/game-client/")).length,
    sharedTypes: files.filter((f) => f.startsWith("packages/shared-types/")).length,
    docs: files.filter(
      (f) =>
        f.startsWith("docs/") ||
        f.endsWith(".md") ||
        f.startsWith(".github/"),
    ).length,
    other: 0,
  };
  counts.other =
    files.length -
    counts.backend -
    counts.admin -
    counts.gameClient -
    counts.sharedTypes -
    counts.docs;

  const parts = [];
  if (counts.backend > 0) parts.push(`${counts.backend} backend-fil${counts.backend === 1 ? "" : "er"}`);
  if (counts.admin > 0) parts.push(`${counts.admin} admin-web-fil${counts.admin === 1 ? "" : "er"}`);
  if (counts.gameClient > 0) parts.push(`${counts.gameClient} game-client-fil${counts.gameClient === 1 ? "" : "er"}`);
  if (counts.sharedTypes > 0) parts.push(`${counts.sharedTypes} shared-types-fil${counts.sharedTypes === 1 ? "" : "er"}`);
  if (counts.docs > 0) parts.push(`${counts.docs} doc-/config-fil${counts.docs === 1 ? "" : "er"}`);
  if (counts.other > 0) parts.push(`${counts.other} annen fil`);

  if (parts.length === 0) {
    return "Endrer prosjekt-filer.";
  }
  return `Endrer ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Format file-list for display (truncate hvis lang)
// ---------------------------------------------------------------------------

function formatFileList(files, max = 8) {
  if (files.length === 0) return "_(ingen)_";
  if (files.length <= max) {
    return files.map((f) => `\`${f}\``).join(", ");
  }
  const shown = files.slice(0, max).map((f) => `\`${f}\``).join(", ");
  return `${shown}, _(+${files.length - max} til)_`;
}

// ---------------------------------------------------------------------------
// Estimert test-tid per scenario
// ---------------------------------------------------------------------------

function estimateTestTime(scenarios) {
  if (scenarios.length === 1 && scenarios[0] === "docs-only") {
    return "0 min (docs-only)";
  }
  if (scenarios.length === 1 && scenarios[0] === "unknown") {
    return "ukjent — sjekk PR-beskrivelse";
  }
  // Hver scenario tar ~2 min å gjennomføre manuelt
  const minutes = scenarios.length * 2;
  return `~${minutes} min`;
}

// ---------------------------------------------------------------------------
// Hovedrendering
// ---------------------------------------------------------------------------

export function generateReadinessSection({ files, commitMessages, templatesDir }) {
  const { scenarios, allDocsOnly } = aggregateScenarios(files);
  const summary = buildSummary(files, commitMessages);
  const estimatedTime = estimateTestTime(scenarios);
  const fileList = formatFileList(files);

  const lines = [];
  lines.push("## 🎯 Tobias smoke-test (auto-generated)");
  lines.push("");
  lines.push(`**Estimated test time:** ${estimatedTime}`);
  if (!allDocsOnly && scenarios[0] !== "unknown") {
    lines.push(
      "**Pre-req:** `cd /Users/tobiashaugen/Projects/Spillorama-system && ENABLE_BUY_DEBUG=1 npm run dev:nuke` etter merge",
    );
  }
  lines.push("");

  lines.push("### Hva endret i denne PR-en");
  lines.push("");
  lines.push(summary);
  lines.push("");

  // Render hvert scenario sin template
  const seenScenarios = new Set();
  for (const scenario of scenarios) {
    if (seenScenarios.has(scenario)) continue;
    seenScenarios.add(scenario);

    const template = loadTemplate(scenario, templatesDir);
    if (template === null) {
      // Fallback: bruk unknown
      const fallback = loadTemplate("unknown", templatesDir);
      if (fallback) {
        lines.push(renderTemplate(fallback, { FILE_LIST: fileList, SUMMARY: summary }));
      } else {
        lines.push(`### ${scenario} (mal mangler)`);
        lines.push("");
      }
      lines.push("");
      continue;
    }

    lines.push(renderTemplate(template, { FILE_LIST: fileList, SUMMARY: summary }));
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(
    "_Auto-generert av `scripts/generate-tobias-readiness.mjs`. Skill-matching er heuristisk — sjekk filer over hvis du synes test-stegene ikke matcher endringen._",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  const templatesDir = args["templates-dir"]
    ? resolve(args["templates-dir"])
    : resolve(__dirname, "tobias-readiness-templates");

  if (!existsSync(templatesDir)) {
    console.error(`ERROR: templates-dir ikke funnet: ${templatesDir}`);
    process.exit(1);
  }

  const files = readDiffFiles(args["diff-file"]);
  const commitMessages = readCommitMessages(args["commit-messages"]);

  const output = generateReadinessSection({ files, commitMessages, templatesDir });

  if (args["output-file"]) {
    writeFileSync(resolve(args["output-file"]), output, "utf8");
  } else {
    process.stdout.write(output);
    if (!output.endsWith("\n")) process.stdout.write("\n");
  }
}

// Kjør kun hvis vi er entry-point (ikke imported av test)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  });
}
