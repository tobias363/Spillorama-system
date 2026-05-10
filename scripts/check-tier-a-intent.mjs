#!/usr/bin/env node
/**
 * check-tier-a-intent.mjs
 *
 * Tier-A intent-håndhevelse — del av Bølge 4 (intent-verification-mønster).
 *
 * Hvis commit endrer Tier-A-fil (compliance/wallet/RNG/auth-kjerne), krever
 * commit-melding å inneholde `Intent-confirmed-by: <Tobias|self|<navn>>`-linje.
 * Dette tvinger PM/agent til å eksplisitt bekrefte at intent ble verifisert
 * før kode-endring (jf. .claude/skills/intent-verification/SKILL.md).
 *
 * Brukes av:
 *   - .husky/pre-commit (etter PM-gate-sjekk, før lint-staged)
 *
 * Algoritme:
 *   1. Hvis ingen Tier-A-fil i staged: pass (exit 0)
 *   2. Hvis bypass via env-var eller commit-msg: pass m/warning
 *   3. Hvis Tier-A endret OG commit-msg har `Intent-confirmed-by:`: pass
 *   4. Else: blokker commit m/forklaring
 *
 * Bypass:
 *   PM_INTENT_BYPASS=1 git commit ...                                  # engang
 *   git commit -m "...\n\n[bypass-intent: hotfix etter incident]"      # commit-msg
 *
 * NB: Denne sjekken er ekstra paranoia på toppen av PM-gate. PM-gate
 *     bekrefter at PM har lest dokumentasjonen; intent-confirmed bekrefter
 *     at PM har eksplisitt verifisert oppgaven for denne spesifikke endringen.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

// Tier-A patterns — endring her krever intent-confirmed-by
const TIER_A_PATTERNS = [
  /^apps\/backend\/src\/compliance\//,
  /^apps\/backend\/src\/wallet\//,
  /^apps\/backend\/src\/auth\//,
  /^apps\/backend\/src\/security\//,
  /^apps\/backend\/src\/draw-engine\//,
  /^apps\/backend\/src\/adapters\/.*Wallet/,
  /^apps\/backend\/src\/adapters\/.*BankId/,
  /^apps\/backend\/src\/adapters\/.*Rng/,
  /^apps\/backend\/migrations\//,
  /Bingo[Ee]ngine/,
  /^docs\/adr\//,
  /AuditLog/,
  /HashChain/,
];

function isTierA(file) {
  return TIER_A_PATTERNS.some((re) => re.test(file));
}

function getStagedFiles() {
  try {
    const out = execSync("git diff --cached --name-only", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function getCommitMsg() {
  const msgFile = resolve(REPO_ROOT, ".git/COMMIT_EDITMSG");
  if (!existsSync(msgFile)) return "";
  try {
    return readFileSync(msgFile, "utf8");
  } catch {
    return "";
  }
}

function checkBypass(msg) {
  if (process.env.PM_INTENT_BYPASS === "1" || process.env.PM_INTENT_BYPASS === "true") {
    return { bypass: true, reason: `env-var PM_INTENT_BYPASS=${process.env.PM_INTENT_BYPASS}` };
  }
  const m = msg.match(/\[bypass-intent:\s*([^\]]+)\]/i);
  if (m) return { bypass: true, reason: `commit-msg: [bypass-intent: ${m[1].trim()}]` };
  return { bypass: false };
}

function hasIntentConfirmedBy(msg) {
  return /^Intent-confirmed-by:\s*\S+/m.test(msg);
}

function main() {
  const staged = getStagedFiles();
  const tierAFiles = staged.filter(isTierA);

  if (tierAFiles.length === 0) {
    // Ingen Tier-A-endringer — sjekk passes
    return 0;
  }

  const msg = getCommitMsg();
  const bypass = checkBypass(msg);
  if (bypass.bypass) {
    console.warn(`${C.yellow}⚠ Tier-A intent-bypass: ${bypass.reason}${C.reset}`);
    console.warn(`${C.dim}  Berørte Tier-A-filer: ${tierAFiles.join(", ")}${C.reset}`);
    return 0;
  }

  if (hasIntentConfirmedBy(msg)) {
    console.log(`${C.green}✓ Tier-A endring m/Intent-confirmed-by-linje${C.reset}`);
    console.log(`${C.dim}  Berørte filer: ${tierAFiles.length}${C.reset}`);
    return 0;
  }

  // FAIL
  console.error("");
  console.error(`${C.red}${C.bold}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.error(`${C.red}${C.bold}║  ⛔ COMMIT BLOKKERT — Tier-A intent ikke bekreftet           ║${C.reset}`);
  console.error(`${C.red}${C.bold}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.error("");
  console.error(`${C.bold}Du endrer Tier-A-fil(er) (compliance/wallet/RNG/auth/migrations):${C.reset}`);
  for (const f of tierAFiles) console.error(`  - ${f}`);
  console.error("");
  console.error(`${C.bold}Tier-A-endringer krever eksplisitt intent-bekreftelse i commit-meldingen.${C.reset}`);
  console.error("");
  console.error(`${C.bold}Hva må jeg gjøre?${C.reset}`);
  console.error(`  1. Hvis ikke gjort: kjør intent-restate-mønsteret`);
  console.error(`     (se ${C.cyan}.claude/skills/intent-verification/SKILL.md${C.reset})`);
  console.error(`  2. Få Tobias-OK på restate-blokken`);
  console.error(`  3. Legg til denne linjen i commit-meldingen:`);
  console.error("");
  console.error(`     ${C.cyan}Intent-confirmed-by: Tobias${C.reset}`);
  console.error(`     ${C.dim}# eller "self" hvis du IKKE er PM-AI og kan ta autonomi${C.reset}`);
  console.error(`     ${C.dim}# eller navngitt person${C.reset}`);
  console.error("");
  console.error(`${C.bold}Bypass (kun for spesielle tilfeller):${C.reset}`);
  console.error(`  ${C.cyan}PM_INTENT_BYPASS=1 git commit ...${C.reset}`);
  console.error(`  ${C.cyan}git commit -m "...\\n\\n[bypass-intent: hotfix etter incident]"${C.reset}`);
  console.error("");
  console.error(`${C.dim}Se docs/operations/PM_PR_VERIFICATION_DUTY.md for fullt regelverk.${C.reset}`);
  console.error("");
  return 1;
}

process.exit(main());
