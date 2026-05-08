#!/usr/bin/env node
/**
 * setup-husky.mjs
 *
 * Etter `husky init`, overskriver `.husky/pre-commit` med vart lint-staged
 * hook-innhold. Kalt fra `npm run prepare` (som kjores automatisk ved
 * `npm install`).
 *
 * Grunnen til at vi bruker et script i stedet for a committe filen direkte:
 * - `.husky/pre-commit` ma vare eksekverbar.
 * - `husky init` skriver standard-innhold og kan overskrive vart.
 *
 * Scriptet er idempotent og trygt a kjore flere ganger.
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), "..");
const HUSKY_DIR = join(REPO_ROOT, ".husky");
const HOOK_PATH = join(HUSKY_DIR, "pre-commit");

const HOOK_CONTENT = `# Husky pre-commit hook
#
# Kjorer lint-staged (.lintstagedrc.json) som matcher endrede filer mot:
#  - stylelint --fix paa CSS-filer
#  - lint-no-backdrop-js + lint-no-unsafe-html paa TS-filer
#  - npm run check (TypeScript strict) paa apps/backend/src/**/*.ts
#  - validate-skill-frontmatter paa .claude/skills/*/SKILL.md
#  - check-markdown-links paa docs/**/*.md
#  - validate-migration-name paa apps/backend/migrations/*.sql
#  - check-large-binaries paa store binary-typer
#
# Hvis hook feiler, fiks overtredelsene FOR commit. For nedbypass med
# begrunnelse: commit med --no-verify og dokumenter hvorfor.
#
# Se docs/engineering/PRE_COMMIT_HOOKS.md for full liste over regler og
# hvordan legge til nye hooks. Se docs/engineering/CSS_LINTING.md for
# CSS-spesifikke regler.

npx lint-staged
`;

function main() {
  // Bare skriv hvis .husky/ finnes (husky init er allerede kjort).
  // Hvis ikke, la husky handle det selv.
  if (!existsSync(HUSKY_DIR)) {
    // Lag katalogen proaktivt, men ikke feile hvis vi ikke har tillatelse.
    try {
      mkdirSync(HUSKY_DIR, { recursive: true });
    } catch {
      // Ingen feil — husky init vil sette opp mappen senere.
      return;
    }
  }

  try {
    writeFileSync(HOOK_PATH, HOOK_CONTENT, { mode: 0o755 });
    chmodSync(HOOK_PATH, 0o755);
    // eslint-disable-next-line no-console
    console.log(`setup-husky: wrote ${HOOK_PATH}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`setup-husky: unable to write hook (${err.message})`);
  }
}

main();
