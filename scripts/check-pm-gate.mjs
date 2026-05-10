#!/usr/bin/env node
/**
 * check-pm-gate.mjs
 *
 * Hard-block validator for pm-checkpoint-gate (BIN-PM-VT, 2026-05-10).
 *
 * Sjekker at `.pm-onboarding-confirmed.txt` finnes og er gyldig (≤7 dager
 * gammel). Brukes av:
 *   - .husky/pre-commit (blokkerer commit)
 *   - .github/workflows/pm-gate-enforcement.yml (blokkerer merge)
 *
 * CLI:
 *   node scripts/check-pm-gate.mjs                  # default = strict, exit 1 hvis ikke valid
 *   node scripts/check-pm-gate.mjs --strict         # eksplisitt strict
 *   node scripts/check-pm-gate.mjs --soft           # advarer kun, alltid exit 0
 *   node scripts/check-pm-gate.mjs --hash           # print hash av confirmation-fil + metadata
 *   node scripts/check-pm-gate.mjs --log-public     # append hash til docs/.pm-confirmations.log
 *   node scripts/check-pm-gate.mjs --status         # human-readable status
 *
 * Bypass (skal brukes sjelden + dokumentert):
 *   PM_GATE_BYPASS=1                                # env-var skipper sjekken
 *   Commit-melding inneholder `[bypass-pm-gate: <begrunnelse>]`
 *   --no-verify på git commit (siste utvei, alltid logget)
 */

import { readFile, appendFile, writeFile, stat, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const CONFIRM_FILE = resolve(REPO_ROOT, ".pm-onboarding-confirmed.txt");
const PUBLIC_LOG = resolve(REPO_ROOT, "docs/.pm-confirmations.log");
const CHECKPOINT_SCRIPT = resolve(REPO_ROOT, "scripts/pm-checkpoint.sh");
const VALIDITY_DAYS = parseInt(process.env.PM_CHECKPOINT_VALIDITY_DAYS ?? "7", 10);

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

const args = process.argv.slice(2);
const mode = args.find((a) =>
  ["--strict", "--soft", "--hash", "--log-public", "--status"].includes(a),
) ?? "--strict";

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function fileAgeDays(absPath) {
  const s = await stat(absPath);
  return (Date.now() - s.mtimeMs) / (1000 * 60 * 60 * 24);
}

async function gateState() {
  if (!(await fileExists(CHECKPOINT_SCRIPT))) {
    return {
      state: "checkpoint-missing",
      message: `pm-checkpoint.sh ikke funnet (BIN-PM-VT-PR ikke merget?). Gate i pause-modus.`,
    };
  }
  if (!(await fileExists(CONFIRM_FILE))) {
    return {
      state: "no-confirmation",
      message: `Ingen .pm-onboarding-confirmed.txt funnet. Kjør: bash scripts/pm-checkpoint.sh`,
    };
  }
  const ageDays = await fileAgeDays(CONFIRM_FILE);
  if (ageDays > VALIDITY_DAYS) {
    return {
      state: "expired",
      message: `Bekreftelsen er ${Math.floor(ageDays)} dager gammel (max ${VALIDITY_DAYS}). Re-kjør gate.`,
      ageDays,
    };
  }
  const content = await readFile(CONFIRM_FILE, "utf8");
  const pmIdMatch = content.match(/\*\*PM-identifier:\*\*\s*(.+)/);
  const shaMatch = content.match(/\*\*Main-SHA:\*\*\s*([a-f0-9]+)/);
  const pmId = pmIdMatch?.[1].trim() ?? "ukjent";
  const mainSha = shaMatch?.[1].trim() ?? "ukjent";
  const hash = createHash("sha256").update(content).digest("hex");
  const hashShort = hash.slice(0, 12);
  const handoffCount = (content.match(/^### \d+\. /gm) ?? []).length;

  return {
    state: "valid",
    message: `Bekreftelse gyldig (${Math.floor(ageDays)} dager gammel)`,
    hashShort, pmId, mainSha, ageDays, handoffCount,
  };
}

function checkBypass() {
  if (process.env.PM_GATE_BYPASS === "1" || process.env.PM_GATE_BYPASS === "true") {
    return { bypass: true, reason: `env-var PM_GATE_BYPASS=${process.env.PM_GATE_BYPASS}` };
  }
  try {
    const msgFile = resolve(REPO_ROOT, ".git/COMMIT_EDITMSG");
    if (existsSync(msgFile)) {
      const msg = execSync(`cat ${msgFile} 2>/dev/null`, { encoding: "utf8" });
      const m = msg.match(/\[bypass-pm-gate:\s*([^\]]+)\]/i);
      if (m) return { bypass: true, reason: `commit-msg: [bypass-pm-gate: ${m[1].trim()}]` };
    }
  } catch { /* ignore */ }
  return { bypass: false };
}

async function modeStatus() {
  const g = await gateState();
  const b = checkBypass();
  console.log(`${C.bold}PM-gate status${C.reset}`);
  console.log(`  Confirmation file: ${CONFIRM_FILE}`);
  console.log(`  Validity: ${VALIDITY_DAYS} dager`);
  console.log(`  State: ${g.state === "valid" ? C.green : g.state === "checkpoint-missing" ? C.yellow : C.red}${g.state}${C.reset}`);
  console.log(`  Message: ${g.message}`);
  if (g.state === "valid") {
    console.log(`  PM-identifier: ${g.pmId}`);
    console.log(`  Main-SHA: ${g.mainSha}`);
    console.log(`  Hash-prefix: ${g.hashShort}`);
    console.log(`  Handoffs confirmed: ${g.handoffCount}`);
    console.log(`  Age: ${Math.floor(g.ageDays)} dager`);
  }
  if (b.bypass) {
    console.log(`  ${C.yellow}Bypass aktiv: ${b.reason}${C.reset}`);
  }
  return g.state === "valid" ? 0 : 1;
}

async function modeHash() {
  const g = await gateState();
  if (g.state !== "valid") {
    console.error(`${C.red}Cannot hash: ${g.message}${C.reset}`);
    return 1;
  }
  console.log(JSON.stringify({
    hash_prefix: g.hashShort,
    pm_id: g.pmId,
    main_sha: g.mainSha,
    handoff_count: g.handoffCount,
    age_days: Math.floor(g.ageDays),
  }, null, 2));
  return 0;
}

async function modeLogPublic() {
  const g = await gateState();
  if (g.state !== "valid") {
    console.error(`${C.red}Cannot log: ${g.message}${C.reset}`);
    return 1;
  }
  if (!(await fileExists(PUBLIC_LOG))) {
    await writeFile(PUBLIC_LOG, [
      "# PM-confirmations Audit Log",
      "# Format: TIMESTAMP_ISO | HASH_PREFIX | PM_ID | HANDOFF_COUNT | MAIN_SHA",
      "# Gjenereres av scripts/check-pm-gate.mjs --log-public",
      "",
    ].join("\n"), "utf8");
    console.log(`${C.green}Created public log: ${PUBLIC_LOG}${C.reset}`);
  }
  const log = await readFile(PUBLIC_LOG, "utf8");
  if (log.includes(`| ${g.hashShort} |`)) {
    console.log(`${C.dim}Hash ${g.hashShort} allerede loggført. Ingen endring.${C.reset}`);
    return 0;
  }
  const ts = new Date().toISOString();
  const line = `${ts} | ${g.hashShort} | ${g.pmId} | ${g.handoffCount} | ${g.mainSha}\n`;
  await appendFile(PUBLIC_LOG, line, "utf8");
  console.log(`${C.green}✓ Logget til docs/.pm-confirmations.log${C.reset}`);
  console.log(`  ${line.trim()}`);
  return 0;
}

async function modeStrict() {
  const b = checkBypass();
  if (b.bypass) {
    console.log(`${C.yellow}⚠ PM-gate bypass aktivert: ${b.reason}${C.reset}`);
    console.log(`${C.dim}  Gate-sjekk skippet. Sørg for at dette er dokumentert.${C.reset}`);
    return 0;
  }
  const g = await gateState();
  if (g.state === "checkpoint-missing") {
    console.log(`${C.yellow}⚠ ${g.message}${C.reset}`);
    console.log(`${C.dim}  Tillater commit i pause-modus.${C.reset}`);
    return 0;
  }
  if (g.state === "valid") {
    console.log(`${C.green}✓ PM-gate passert (${g.pmId}, hash ${g.hashShort}, ${Math.floor(g.ageDays)}d gammel)${C.reset}`);
    return 0;
  }
  console.error("");
  console.error(`${C.red}${C.bold}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.error(`${C.red}${C.bold}║  ⛔ COMMIT BLOKKERT — PM-gate ikke passert                   ║${C.reset}`);
  console.error(`${C.red}${C.bold}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.error("");
  console.error(`${C.bold}Status:${C.reset} ${g.message}`);
  console.error("");
  console.error(`${C.bold}Hva må jeg gjøre?${C.reset}`);
  console.error(`  1. Kjør gate: ${C.cyan}bash scripts/pm-checkpoint.sh${C.reset}`);
  console.error(`  2. Logg til public audit-log: ${C.cyan}node scripts/check-pm-gate.mjs --log-public${C.reset}`);
  console.error(`  3. Prøv commit på nytt`);
  console.error("");
  console.error(`${C.bold}Hvis du ikke er PM (eller dette er en spesiell sak):${C.reset}`);
  console.error(`  ${C.cyan}PM_GATE_BYPASS=1 git commit ...${C.reset}`);
  console.error(`  ${C.dim}# Eller permanent for Tobias' maskin (legg i ~/.zshrc):${C.reset}`);
  console.error(`  ${C.cyan}export PM_GATE_BYPASS=1${C.reset}`);
  console.error(`  ${C.dim}# Eller dokumentert i commit-meldingen:${C.reset}`);
  console.error(`  ${C.cyan}git commit -m "fix(scope): subject\\n\\n[bypass-pm-gate: hotfix etter rollback]"${C.reset}`);
  console.error("");
  console.error(`${C.dim}Se docs/operations/PM_PR_VERIFICATION_DUTY.md for fullt regelverk.${C.reset}`);
  console.error("");
  return 1;
}

async function modeSoft() {
  const g = await gateState();
  if (g.state !== "valid") {
    console.warn(`${C.yellow}⚠ PM-gate ikke valid: ${g.message}${C.reset}`);
    console.warn(`${C.dim}  (Soft-mode — ikke blokkert.)${C.reset}`);
  }
  return 0;
}

async function main() {
  let exitCode = 0;
  switch (mode) {
    case "--status": exitCode = await modeStatus(); break;
    case "--hash":   exitCode = await modeHash(); break;
    case "--log-public": exitCode = await modeLogPublic(); break;
    case "--soft":   exitCode = await modeSoft(); break;
    case "--strict":
    default:         exitCode = await modeStrict(); break;
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`check-pm-gate.mjs failed:`, err);
  process.exit(2);
});
