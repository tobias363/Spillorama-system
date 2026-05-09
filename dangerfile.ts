/**
 * Danger.js — auto-PR-checklist bot
 *
 * Tobias-direktiv 2026-05-08: hver PR skal automatisk få context-sensitive
 * review-sjekkliste basert på hvilke filer som endres. Bot kommenterer
 * påminnelser om relaterte fundament-doc-er, skill-pakker, regulatoriske
 * krav og live-rom-robusthets-mandatet.
 *
 * Regelene under er bevisst smale og handlingsrettede — vi unngår vage
 * "sjekk koden"-warnings og blokker aldri merge med `fail()` annet enn
 * for PR-tittel-format.
 *
 * Doc: docs/engineering/PR_AUTO_CHECKLIST.md
 */

import { danger, warn, message, fail } from "danger";

// ------------------------------------------------------------------
// Defensive lookup på GitHub-PR-metadata. `danger ci` injiserer disse
// fra GITHUB_TOKEN. `danger local` (utvikler-test) har ikke noen PR
// så vi faller tilbake til tomme verdier — botten kjører i "diff-only"
// modus og hopper over PR-tittel/body-regler.
// ------------------------------------------------------------------
const githubPR = danger.github?.pr;
const prTitle = githubPR?.title ?? "";
const prBody = githubPR?.body ?? "";
const hasPRMetadata = githubPR !== undefined;

// Bypass-mekanisme: PR-beskrivelse som inneholder `[skip-danger]` slår
// av alle warnings (men ikke `fail()` på PR-tittel — det er hard-stop).
const skipChecklist = /\[skip-danger\]/i.test(prBody);

// Samle alle endrede filer (modifiserte + nye)
const allFiles = [
  ...danger.git.modified_files,
  ...danger.git.created_files,
];

// ============================================================
// REGEL 1: Fundament-doc → tilhørende skill må trolig oppdateres
// ============================================================
const fundamentDocs = [
  "docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md",
  "docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md",
  "docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md",
  "docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md",
  "docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md",
  "docs/architecture/SPILL_REGLER_OG_PAYOUT.md",
];
const skillsDir = ".claude/skills/";

const touchedFundamentDocs = allFiles.filter((f) => fundamentDocs.includes(f));
const touchedSkills = allFiles.some((f) => f.startsWith(skillsDir));

if (!skipChecklist && touchedFundamentDocs.length > 0 && !touchedSkills) {
  warn(
    `Du endret fundament-doc(er): ${touchedFundamentDocs.join(", ")}\n\n` +
      `Sjekk om tilhørende skill i \`${skillsDir}\` må oppdateres så agenter\n` +
      `får oppdatert kontekst. Hvis dokumentet bare flyttes/refraserer, skriv\n` +
      `\`[skip-danger]\` i PR-beskrivelsen.`,
  );
}

// ============================================================
// REGEL 2: Wallet-kode → outbox-pattern + idempotency
// ============================================================
const walletPathRe = /^apps\/backend\/src\/(wallet|adapters)\//;
if (!skipChecklist && allFiles.some((f) => walletPathRe.test(f))) {
  message(
    "Wallet-kode endret. Verifiser:\n" +
      "- All wallet-mutation går via WalletAdapter-interface\n" +
      "- Outbox-rad enqueue-es atomisk i samme TX som ledger-mutering\n" +
      "- Idempotency-keys håndteres (BIN-767 90-dagers TTL)\n" +
      "- Hash-chain-integrity bevart (BIN-764)\n\n" +
      "Skill: `wallet-outbox-pattern`",
  );
}

// ============================================================
// REGEL 3: Spill 1 master-kode → ID-rom-disambiguation
// ============================================================
const spill1MasterRe =
  /(Game1MasterControlService|GamePlanRunService|MasterActionService|GameLobbyAggregator|Spill1HallStatusBox|NextGamePanel)/;
if (!skipChecklist && allFiles.some((f) => spill1MasterRe.test(f))) {
  warn(
    "Spill 1 master-kode endret. ID-rom-disambiguation:\n" +
      "- `plan-run-id` MÅ ALDRI sendes til `/api/admin/game1/games/:gameId/...`\n" +
      "- Bruk `currentScheduledGameId` fra `Spill1AgentLobbyState` (Bølge 1+2)\n" +
      "- Verifiser at master-only handlinger gates på `hallId`, ikke `user.role`\n\n" +
      "Skill: `spill1-master-flow`",
  );
}

// ============================================================
// REGEL 4: Migration → idempotent CREATE/ALTER
// ============================================================
const migrationRe = /^apps\/backend\/migrations\/\d{14}_/;
if (!skipChecklist && allFiles.some((f) => migrationRe.test(f))) {
  message(
    "Migration endret. Sjekk:\n" +
      "- `CREATE TABLE IF NOT EXISTS`\n" +
      "- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`\n" +
      "- `CREATE INDEX IF NOT EXISTS`\n" +
      "- ADR-012 (MED-2 lessons fra prod-divergens 2026-04-26)\n\n" +
      "Skill: `database-migration-policy`",
  );
}

// ============================================================
// REGEL 5: Compliance-kode → § ref + gameType-mapping
// ============================================================
const compliancePathRe = /^apps\/backend\/src\/compliance\//;
if (!skipChecklist && allFiles.some((f) => compliancePathRe.test(f))) {
  warn(
    "Compliance-kode endret. Verifiser:\n" +
      "- §11/§66/§71 håndhevelse uberørt\n" +
      "- `gameType` MAIN_GAME (Spill 1-3) vs DATABINGO (SpinnGo) korrekt\n" +
      "- Single-prize-cap (2500 kr) **kun** for databingo, ikke hovedspill\n" +
      "- Audit-events bevares (hash-chain-integrity)\n\n" +
      "Skill: `pengespillforskriften-compliance`",
  );
}

// ============================================================
// REGEL 6: Live-rom-arkitektur → R-mandat (Evolution Gaming-grade)
// ============================================================
const liveRoomRe =
  /(Game1ScheduleTickService|Game[23]AutoDrawTickService|Spill[123]GlobalRoomService|Game[123]Engine\.ts|PerpetualRoundService)/;
if (!skipChecklist && allFiles.some((f) => liveRoomRe.test(f))) {
  warn(
    "Live-rom-arkitektur endret. R-mandat (BIN-810/LIVE_ROOM_ROBUSTNESS):\n" +
      "- Cross-instance failover må overleve (R2)\n" +
      "- Idempotent socket-events med `clientRequestId` (R5)\n" +
      "- Health-endpoint reflekterer state aldri stale > 5s (R7)\n" +
      "- Determinisme: ingen race-conditions på draw-tick / payout\n\n" +
      "Skill: `live-room-robusthet-mandate`",
  );
}

// ============================================================
// REGEL 7: PR-tittel må følge Conventional Commits
// (eneste regel som blokker merge med `fail()`)
// ============================================================
const conventionalCommitRe =
  /^(feat|fix|chore|docs|test|refactor|perf|build|ci|style|revert)(\(.+\))?!?: .+/;
if (hasPRMetadata && !conventionalCommitRe.test(prTitle)) {
  fail(
    "PR-tittel må følge Conventional Commits-format:\n" +
      "  `<type>(<scope>): <subject>`\n\n" +
      "Gyldige types: feat, fix, chore, docs, test, refactor, perf, build, ci, style, revert.\n" +
      "Eksempel: `feat(backend): add hall-level betting limits`\n\n" +
      "Se `docs/engineering/ENGINEERING_WORKFLOW.md` §1.",
  );
}

// ============================================================
// REGEL 8: PR-beskrivelse bør inneholde Summary + Test plan
// ============================================================
if (hasPRMetadata && !skipChecklist && prBody.length < 50) {
  warn(
    "PR-beskrivelse er kort eller tom. Inkluder minimum:\n" +
      "- **Summary** (hva gjør PR-en?)\n" +
      "- **Test plan** (hvordan har du verifisert?)\n\n" +
      "Mal: `.github/pull_request_template.md`.",
  );
}

// ============================================================
// REGEL 9: Kritisk kode (wallet/compliance/game) endret uten test-endringer
// ============================================================
const criticalCodeRe = /^apps\/backend\/src\/(wallet|compliance|game)\//;
const criticalChanges = allFiles.filter(
  (f) =>
    criticalCodeRe.test(f) &&
    f.endsWith(".ts") &&
    !f.endsWith(".test.ts") &&
    !f.endsWith(".spec.ts"),
);
const testChanges = allFiles.filter(
  (f) => f.endsWith(".test.ts") || f.endsWith(".spec.ts"),
);
if (!skipChecklist && criticalChanges.length > 0 && testChanges.length === 0) {
  warn(
    `Du endret ${criticalChanges.length} kritisk fil(er) i wallet/compliance/game ` +
      `uten test-endringer. Trenger du regression-test eller har eksisterende ` +
      `tests dekning for endringen?\n\n` +
      `Pengespillforskriften krever bevisbar test-dekning for compliance-paths.`,
  );
}
