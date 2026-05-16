#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CONFIRMATION_FILE = join(REPO_ROOT, ".pm-knowledge-continuity-confirmed.txt");
const DEFAULT_PACK = "/tmp/pm-knowledge-continuity-pack.md";
const DEFAULT_SELF_TEST = "/tmp/pm-knowledge-self-test.md";
const VALIDITY_DAYS = Number.parseInt(process.env.PM_KNOWLEDGE_VALIDITY_DAYS ?? "7", 10);

const PLACEHOLDER_TOKEN_RE =
  /\b(todo|tbd|fyll inn|placeholder|kommer|ukjent|vet ikke|n\/a|na)\b/i;
const PLACEHOLDER_EXACT_RE = /^(ok|lest|pass|done|ja|nei)[.!]*$/i;

// ────────────────────────────────────────────────────────────────────────
// Fase 3 P3 — per-question heuristic validation
// ────────────────────────────────────────────────────────────────────────
//
// Tobias-direktiv 2026-05-16: self-test som er fritekst (kun length +
// placeholder-check) er ikke nok for vanntett kunnskapsparitet. Tier-3
// fragility-comprehension (verify-context-comprehension.mjs) har 48 tester
// som paraphraserer F-NN-entries. Self-test trenger tilsvarende per-fra-
// pack-anker-validering.
//
// Mønster (generaliserbart, brukes også i delivery-report-gate Fase 3 P1):
//   1. Per-spørsmål: minst ett konkret anker (regex-match) må finnes i svaret.
//   2. Generic-fluff-pattern avvises ("ok", "lest gjennom", "ser greit ut").
//   3. Stop-words filtreres bort fra content-word-tellinger.
//   4. Bypass via `[self-test-bypass: <begrunnelse min 20 tegn>]` i self-test.
//
// Hvis PM ikke kan svare med konkrete pack-refererte fakta, har PM ikke
// internalisert pack-en og skal lese på nytt.

const MIN_BYPASS_REASON_CHARS = 20;
const BYPASS_MARKER_RE = /\[self-test-bypass:\s*([^\]]+?)\]/i;

const GENERIC_ANSWER_PATTERNS = [
  /^(jeg leste|ok|lest|done|read it|ja|nei|forstått|skjønner|ser greit ut|alt ok)\.?$/i,
  /^(lest gjennom|sett på|tatt en titt|leste pakken)\.?$/i,
  /^(have read|read pack|read all)\.?$/i,
];

// Stop-words for content-word-filtrering. Samme set-prinsipp som
// verify-context-comprehension.mjs men inline her for å unngå
// cross-script-coupling før eventuell felles paraphrase-heuristics-modul.
const SELF_TEST_STOP_WORDS = new Set([
  "og", "i", "å", "er", "en", "et", "den", "det", "som", "på", "av", "for",
  "med", "til", "fra", "har", "var", "vi", "de", "ikke", "kan", "men", "om",
  "så", "vil", "skal", "ble", "blir", "blitt", "være", "vært", "denne",
  "dette", "disse", "noe", "noen", "alle", "alt", "bare", "også", "mer",
  "the", "is", "a", "an", "and", "or", "but", "in", "on", "at", "to",
  "of", "with", "by", "from", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "should",
  "could", "may", "might", "must", "this", "that", "these", "those", "all",
  "any", "no", "not", "yes", "if",
]);

/**
 * Per-spørsmål-anker. For hvert av de 12 self-test-spørsmålene definerer
 * vi minst ett regex-mønster som svaret må matche. Hvert spørsmål kan ha
 * flere alternative ankere — minst ett må treffe.
 *
 * Designet for å speile faktiske evidence-pack-referanser (handoff-
 * filnavn, PR-numre, ADR-IDer, PITFALLS-§-er, skills, etc.).
 *
 * Hvis en pack ikke inneholder en bestemt type referanse (f.eks. ingen
 * åpne PR-er for Q2), kan PM bruke bypass-marker med konkret begrunnelse.
 */
export const PER_QUESTION_ANCHORS = [
  {
    num: 1,
    label: "Q1 (videreføringsprioritet)",
    expected: "PM_HANDOFF_<dato> eller PM_SESSION_KNOWLEDGE_EXPORT_<dato> filnavn",
    anchors: [
      /PM_HANDOFF_\d{4}-\d{2}-\d{2}/,
      /PM_SESSION_KNOWLEDGE_EXPORT_\d{4}-\d{2}-\d{2}/,
    ],
  },
  {
    num: 2,
    label: "Q2 (åpne PR-er / røde workflows / branches)",
    expected: "PR-nummer (#NNNN), workflow-navn, eller branch-navn",
    anchors: [
      /#\d{3,}/,
      /\b(workflow|gate|enforcement|knowledge-protocol|delivery-report|ai-fragility|pilot-flow|visual-regression|backend|admin-web|compliance|danger|pitfalls-id-validation)\b/i,
      /\b(codex|claude|feat|fix|chore|docs)\/[\w-]+/,
    ],
  },
  {
    num: 3,
    label: "Q3 (P0/P1-risikoer)",
    expected: "BIN-NNN eller konkret bug-navn med file:line eller spesifikk feilmodus",
    anchors: [
      /BIN-\d{2,}/,
      /\b(P0|P1)\b.{0,80}\b(wallet|compliance|live-room|purchase_open|payout|audit-trail|reconcile|drift)\b/i,
      /[a-zA-Z0-9_-]+\.(ts|tsx|sql|yml|sh|mjs):\d+/,
    ],
  },
  {
    num: 4,
    label: "Q4 (arkitekturvalg + invariants)",
    expected: "ADR-NNNN eller spesifikk arkitektur-doc med navn",
    anchors: [
      /ADR-\d{3,4}/,
      /\b(SPILL_ARCHITECTURE|SPILL_REGLER_OG_PAYOUT|LIVE_ROOM_ROBUSTNESS_MANDATE|PLAN_SPILL_KOBLING)\b/,
      /\b(hash-chain|outbox-pattern|perpetual-room|system-actor|audit-ledger|wallet-balance-equation|state-machine)\b/i,
    ],
  },
  {
    num: 5,
    label: "Q5 (relevante skills)",
    expected: "Skill-navn fra `.claude/skills/`",
    anchors: [
      /\b(pm-orchestration-pattern|spill1-master-flow|wallet-outbox-pattern|live-room-robusthet|pengespillforskriften|audit-hash-chain|buy-popup-design|bong-design|preview-pages-protection|database-migration-policy|casino-grade-testing|health-monitoring|intent-verification|dr-runbook)\b/i,
      /\.claude\/skills\/[a-z][\w-]+\/SKILL\.md/,
    ],
  },
  {
    num: 6,
    label: "Q6 (PITFALLS_LOG-entries)",
    expected: "§X.Y-format eller eksplisitt fallgruve-tittel",
    anchors: [
      /§\s*\d+\.\d+\b/,
      /PITFALLS[_-]?(LOG)?\.?md.{0,50}§\d+/i,
    ],
  },
  {
    num: 7,
    label: "Q7 (observability-kilder)",
    expected: "Sentry, PostHog, eller pilot-monitor + konkret handling",
    anchors: [
      /\b(sentry|posthog|pilot-monitor|pgHero|pg_stat_statements|grafana|render dashboard)\b/i,
      /SPILLORAMA-(BACKEND|FRONTEND|ADMIN)-\d+/,
    ],
  },
  {
    num: 8,
    label: "Q8 (git-state + uferdige filer)",
    expected: "Branch-navn, fil-paths som er modifiserte, eller eksplisitt 'working tree clean'",
    anchors: [
      /\b(working tree clean|ren branch|untracked|modified|staged)\b/i,
      /\b(claude|codex|feat|fix|chore|docs|dependabot|auto-doc)\/[\w-]+\b/,
      /[\w/-]+\.(ts|tsx|sql|yml|sh|mjs|md|json)\b/,
    ],
  },
  {
    num: 9,
    label: "Q9 (forrige PM-leveranse)",
    expected: "PR-nummer (#NNNN), commit-SHA (7+ tegn hex), eller spesifikt PR-tema",
    anchors: [
      /#\d{3,}/,
      /\b[a-f0-9]{7,12}\b/,
      /\b(merget|landet|ferdig|implementert|levert)\b.{0,80}\b(PR|Fase|ADR|skill|wallet|compliance|pilot|purchase|test)\b/i,
    ],
  },
  {
    num: 10,
    label: "Q10 (første konkrete handling)",
    expected: "Fil-path, BIN-NNN, eller konkret CLI-kommando",
    anchors: [
      /BIN-\d{2,}/,
      /[\w/-]+\.(ts|tsx|sql|yml|sh|mjs|md|json)\b/,
      /\b(npm run|node scripts|bash scripts|git rebase|gh pr)\b/,
    ],
  },
  {
    num: 11,
    label: "Q11 (leveranseformat fra agenter)",
    expected: "AGENT_DELIVERY_REPORT, 8-seksjon-format, eller `[delivery-report-not-applicable:]`",
    anchors: [
      /AGENT_DELIVERY_REPORT(_TEMPLATE)?\.?md/i,
      /\b(8\s+(H3-)?seksjon|åtte seksjoner|context read|knowledge updates)\b/i,
      /\[delivery-report-not-applicable:/,
    ],
  },
  {
    num: 12,
    label: "Q12 (kunnskapsoppdateringer)",
    expected: "SKILL.md, PITFALLS_LOG.md, eller AGENT_EXECUTION_LOG.md referert",
    anchors: [
      /SKILL\.md/,
      /PITFALLS_LOG\.md/,
      /AGENT_EXECUTION_LOG\.md/,
    ],
  },
];

/**
 * Splitt tekst til content-words (lowercase, ≥ 3 chars, ikke stop-word).
 * Brukes for å sammenligne svar mot spørsmålets nøkkel-ord.
 */
export function selfTestContentWords(text) {
  return text
    .toLowerCase()
    .replace(/[`\[\](){}#*_~.,;:!?"]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !SELF_TEST_STOP_WORDS.has(w));
}

/**
 * Returner true hvis tekst matcher generic-fluff-mønster (etter trimming).
 */
export function isGenericSelfTestAnswer(text) {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return true;
  return GENERIC_ANSWER_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Sjekk om svar-tekst inneholder minst ett ankermønster for gitt spørsmål.
 */
export function hasQuestionAnchor(answer, qNum) {
  const config = PER_QUESTION_ANCHORS.find((q) => q.num === qNum);
  if (!config) return { ok: true, expected: null }; // ukjent spørsmål, no-op
  for (const re of config.anchors) {
    if (re.test(answer)) return { ok: true, expected: config.expected };
  }
  return { ok: false, expected: config.expected, label: config.label };
}

/**
 * Ekstraher self-test-bypass-marker hvis tilstede. Returnerer
 * { bypass: true, reason } eller { bypass: false }.
 */
export function extractSelfTestBypass(text) {
  const m = BYPASS_MARKER_RE.exec(text);
  if (!m) return { bypass: false };
  const reason = m[1].trim();
  return {
    bypass: true,
    reason,
    valid: reason.length >= MIN_BYPASS_REASON_CHARS,
  };
}

const SELF_TEST_QUESTIONS = [
  "Hva er nøyaktig videreføringsprioritet fra siste PM-handoff og knowledge-export?",
  "Hvilke åpne PR-er, røde workflows eller uferdige branches må PM ta hensyn til før første kodehandling?",
  "Hvilke P0/P1-risikoer er aktive nå for live-room, wallet, compliance eller pilot?",
  "Hvilke arkitekturvalg og invariants må du bevare i første oppgave?",
  "Hvilke skills må lastes før du spawner agent eller endrer kode i det aktuelle domenet?",
  "Hvilke PITFALLS_LOG-entries er mest relevante, og hvilken konkret feil hindrer hver av dem?",
  "Hvilke observability-kilder må være aktive under test, og hva gjør du ved ny Sentry/PostHog/monitor-alarm?",
  "Hva er git-state akkurat nå, og hvilke utrackede eller uferdige filer må ikke blandes inn i neste PR?",
  "Hva leverte forrige PM, hva ble ikke ferdig, og hvilke beslutninger må ikke tas på nytt?",
  "Hva er din første konkrete handling etter onboarding, og hvorfor er den i samme spor som forrige PM?",
  "Hvilket leveranseformat krever du fra agenter før PM kan åpne PR?",
  "Hvilke dokumenter eller skills må oppdateres hvis arbeidet avdekker ny kunnskap?",
];

function usage() {
  return `Usage:
  node scripts/pm-knowledge-continuity.mjs --generate-pack [--output <path>]
  node scripts/pm-knowledge-continuity.mjs --self-test-template [--pack <path>] [--output <path>]
  node scripts/pm-knowledge-continuity.mjs --validate-self-test <path>
  node scripts/pm-knowledge-continuity.mjs --confirm-self-test <path> [--pack <path>]
  node scripts/pm-knowledge-continuity.mjs --validate
  node scripts/pm-knowledge-continuity.mjs --status
`;
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function rel(path) {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

function run(command, args = [], options = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: options.timeout ?? 10_000,
      }).trimEnd(),
    };
  } catch (error) {
    const message = error.stderr?.toString?.().trim() || error.message;
    return { ok: false, stdout: "", error: message };
  }
}

function sha256File(file) {
  if (!existsSync(file)) return "missing";
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

function ensureParent(file) {
  mkdirSync(dirname(file), { recursive: true });
}

function readText(file) {
  return readFileSync(file, "utf8");
}

function listFiles(dir, pattern) {
  const absolute = join(REPO_ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => join(absolute, name));
}

function latest(files) {
  return [...files].sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

function extractHeadings(file, limit = 20) {
  if (!file || !existsSync(file)) return [];
  return readText(file)
    .split("\n")
    .filter((line) => /^#{1,3}\s+/.test(line))
    .slice(0, limit);
}

function excerpt(file, maxLines = 80) {
  if (!file || !existsSync(file)) return "_Mangler._";
  return readText(file).split("\n").slice(0, maxLines).join("\n").trim();
}

function commandBlock(title, result, emptyText = "_Ingen output._") {
  if (!result.ok) {
    return `### ${title}\n\n_Kunne ikke hente: ${result.error}_\n`;
  }
  const body = result.stdout.trim() || emptyText;
  return `### ${title}\n\n\`\`\`text\n${body}\n\`\`\`\n`;
}

function findSkillVersions() {
  const root = join(REPO_ROOT, ".claude", "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(root, entry.name, "SKILL.md");
      if (!existsSync(file)) return null;
      const text = readText(file);
      const version = text.match(/^\s*version:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
      const description = text.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      return { name: entry.name, version, description };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function generatePack() {
  const now = new Date();
  const branch = run("git", ["branch", "--show-current"]);
  const head = run("git", ["rev-parse", "HEAD"]);
  const originMain = run("git", ["rev-parse", "origin/main"]);
  const status = run("git", ["status", "-sb"]);
  const latestCommits = run("git", ["log", "--oneline", "--decorate", "-10", "origin/main"]);
  const openPrs = run("gh", [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "20",
    "--json",
    "number,title,headRefName,mergeable,isDraft,reviewDecision,statusCheckRollup",
  ]);
  const recentRuns = run("gh", [
    "run",
    "list",
    "--limit",
    "20",
    "--json",
    "databaseId,workflowName,displayTitle,status,conclusion,headBranch,createdAt,url",
  ]);
  const handoffs = [
    ...listFiles("docs/operations", /^PM_HANDOFF_.*\.md$/),
    ...listFiles("docs/operations/archive", /^PM_HANDOFF_.*\.md$/),
  ];
  const exports = listFiles("docs/operations", /^PM_SESSION_KNOWLEDGE_EXPORT_.*\.md$/);
  const latestHandoff = latest(handoffs);
  const latestExport = latest(exports);
  const adrFiles = listFiles("docs/adr", /^\d{4}-.*\.md$/);
  const pitfalls = join(REPO_ROOT, "docs", "engineering", "PITFALLS_LOG.md");
  const agentLog = join(REPO_ROOT, "docs", "engineering", "AGENT_EXECUTION_LOG.md");
  const skills = findSkillVersions();

  const lines = [];
  lines.push("# PM Knowledge Continuity Evidence Pack");
  lines.push("");
  lines.push(`**Generated:** ${now.toISOString()}`);
  lines.push(`**Repo:** ${REPO_ROOT}`);
  lines.push(`**Branch:** ${branch.ok ? branch.stdout : "unknown"}`);
  lines.push(`**HEAD:** ${head.ok ? head.stdout : "unknown"}`);
  lines.push(`**origin/main:** ${originMain.ok ? originMain.stdout : "unknown"}`);
  lines.push("");
  lines.push("> This pack is generated current-state evidence. It does not replace PM_HANDOFF, KNOWLEDGE_EXPORT, ADR, skills or PITFALLS_LOG. PM must answer the self-test from this pack before first code action.");
  lines.push("");
  lines.push(commandBlock("Git working tree", status));
  lines.push(commandBlock("Recent origin/main commits", latestCommits));
  lines.push(commandBlock("Open PRs", openPrs, "_Ingen åpne PR-er eller gh ikke autentisert._"));
  lines.push(commandBlock("Recent GitHub workflow runs", recentRuns, "_Ingen workflow-runs returnert eller gh ikke autentisert._"));
  lines.push("## Latest PM Handoff");
  lines.push("");
  if (latestHandoff) {
    lines.push(`**File:** \`${rel(latestHandoff)}\``);
    lines.push(`**SHA256:** \`${sha256File(latestHandoff)}\``);
    lines.push("");
    lines.push("```markdown");
    lines.push(excerpt(latestHandoff, 90));
    lines.push("```");
  } else {
    lines.push("_Ingen PM_HANDOFF-filer funnet._");
  }
  lines.push("");
  lines.push("## Latest PM Knowledge Export");
  lines.push("");
  if (latestExport) {
    lines.push(`**File:** \`${rel(latestExport)}\``);
    lines.push(`**SHA256:** \`${sha256File(latestExport)}\``);
    lines.push("");
    lines.push("```markdown");
    lines.push(excerpt(latestExport, 90));
    lines.push("```");
  } else {
    lines.push("_Ingen PM_SESSION_KNOWLEDGE_EXPORT-filer funnet._");
  }
  lines.push("");
  lines.push("## ADR Map");
  lines.push("");
  lines.push(`**Count:** ${adrFiles.length}`);
  for (const file of adrFiles.slice(-15)) {
    const title = extractHeadings(file, 1)[0]?.replace(/^#+\s+/, "") ?? rel(file);
    lines.push(`- \`${rel(file)}\` — ${title}`);
  }
  lines.push("");
  lines.push("## PITFALLS_LOG Headings");
  lines.push("");
  if (existsSync(pitfalls)) {
    for (const heading of extractHeadings(pitfalls, 80)) {
      lines.push(`- ${heading.replace(/^#+\s+/, "")}`);
    }
  } else {
    lines.push("_Mangler PITFALLS_LOG._");
  }
  lines.push("");
  lines.push("## Recent Agent Execution Log Headings");
  lines.push("");
  if (existsSync(agentLog)) {
    for (const heading of extractHeadings(agentLog, 40).slice(-20)) {
      lines.push(`- ${heading.replace(/^#+\s+/, "")}`);
    }
  } else {
    lines.push("_Mangler AGENT_EXECUTION_LOG._");
  }
  lines.push("");
  lines.push("## Skill Catalog Snapshot");
  lines.push("");
  for (const skill of skills) {
    lines.push(`- \`${skill.name}\` v${skill.version}${skill.description ? ` — ${skill.description}` : ""}`);
  }
  lines.push("");
  lines.push("## Top PM Self-Test Questions");
  lines.push("");
  SELF_TEST_QUESTIONS.forEach((question, index) => {
    lines.push(`${index + 1}. ${question}`);
  });
  lines.push("");

  const text = lines.join("\n");
  return `${text}**Pack SHA256:** \`${sha256Text(text)}\`\n`;
}

function generateSelfTest(packFile) {
  const packHash = packFile && existsSync(packFile) ? sha256File(packFile) : "missing";
  const lines = [];
  lines.push("# PM Knowledge Continuity Self-Test");
  lines.push("");
  lines.push(`**Pack:** \`${packFile ?? DEFAULT_PACK}\``);
  lines.push(`**Pack SHA256:** \`${packHash}\``);
  lines.push("");
  lines.push("Svar med konkrete detaljer fra evidence pack, siste handoff, latest knowledge-export, PITFALLS_LOG, skills og GitHub-state. Placeholder-tekst, korte 'OK/lest'-svar eller generiske svar avvises.");
  lines.push("");
  SELF_TEST_QUESTIONS.forEach((question, index) => {
    lines.push(`### Q${index + 1}. ${question}`);
    lines.push("");
    lines.push("**Answer:** TODO");
    lines.push("");
  });
  return lines.join("\n");
}

export function parseAnswers(text) {
  const matches = [...text.matchAll(/^### Q(\d+)\.\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const section = text.slice(start, end);
    const answerMarker = section.match(/\*\*Answer:\*\*/i);
    const answer = answerMarker
      ? section.slice((answerMarker.index ?? 0) + answerMarker[0].length).trim()
      : section.trim();
    return {
      number: Number.parseInt(match[1], 10),
      question: match[2].trim(),
      answer,
    };
  });
}

/**
 * Validate a self-test file. Returns { ok, errors, warnings, answers, bypass }.
 *
 * Sjekker (Fase 3 P3 heuristikk):
 *   1. Filen finnes og parses (12 H3-svar).
 *   2. Pack-SHA256-referanse er ikke "missing".
 *   3. Hvert svar: ≥ 80 chars (etter strip av backtick-spans).
 *   4. Hvert svar: ikke placeholder-token eller exact-match-fluff.
 *   5. Hvert svar: ikke generic-fluff-pattern ("ok", "lest gjennom").
 *   6. Hvert svar: matcher minst ett per-spørsmål-anker fra
 *      PER_QUESTION_ANCHORS-tabellen.
 *
 * Bypass: `[self-test-bypass: <begrunnelse min 20 tegn>]` i fil-innholdet
 * short-circuit-er ALLE sjekker — returnerer ok=true med warning.
 * Beregnet på pack-spesifikke unntak (eks. ingen åpne PR-er = Q2-anker
 * "PR-nummer" ikke applicable).
 *
 * Tester finnes i scripts/__tests__/pm-knowledge-continuity.test.mjs.
 * Dokumentert i docs/engineering/PM_SELF_TEST_HEURISTICS.md.
 */
export function validateSelfTest(file, options = {}) {
  if (!file || !existsSync(file)) {
    return {
      ok: false,
      errors: [`Self-test file missing: ${file ?? "<not provided>"}`],
      warnings: [],
      answers: [],
      bypass: false,
    };
  }
  const text = readText(file);
  return validateSelfTestText(text, { skipPackHashCheck: options.skipPackHashCheck === true });
}

/**
 * Pure variant — validerer tekst-innhold (uten file-IO). Brukes av tester
 * og av validateSelfTest() over.
 */
export function validateSelfTestText(text, options = {}) {
  const errors = [];
  const warnings = [];

  // 1. Bypass-marker short-circuit
  const bypassInfo = extractSelfTestBypass(text);
  if (bypassInfo.bypass) {
    if (!bypassInfo.valid) {
      errors.push(
        `Self-test bypass marker found but reason is too short (${bypassInfo.reason.length} chars, min ${MIN_BYPASS_REASON_CHARS}).`,
      );
      return { ok: false, errors, warnings, answers: [], bypass: false };
    }
    warnings.push(`Self-test bypass akseptert: ${bypassInfo.reason}`);
    return { ok: true, errors, warnings, answers: [], bypass: true };
  }

  // 2. Parse answers
  const answers = parseAnswers(text);
  if (answers.length < 10) {
    errors.push(`Expected at least 10 answers, found ${answers.length}.`);
  }

  // 3. Pack-SHA-referanse
  if (!options.skipPackHashCheck) {
    const packHash = text.match(/\*\*Pack SHA256:\*\*\s+`([^`]+)`/)?.[1];
    if (!packHash || packHash === "missing") {
      errors.push("Self-test must reference a real evidence pack SHA256.");
    }
  }

  // 4. Per-answer checks
  for (const item of answers) {
    const plain = item.answer.replace(/`[^`]*`/g, "").trim();

    // 4a. Length
    if (plain.length < 80) {
      errors.push(`Q${item.number} answer is too short (${plain.length} chars, min 80).`);
      continue; // korte svar treffer ikke ankrer meningsfullt; hopp over resten
    }

    // 4b. Eksisterende placeholder-check
    if (PLACEHOLDER_TOKEN_RE.test(plain) || PLACEHOLDER_EXACT_RE.test(plain)) {
      errors.push(`Q${item.number} answer contains placeholder or non-evidence text.`);
      continue;
    }

    // 4c. Generic fluff-pattern (Fase 3 P3 nytt)
    if (isGenericSelfTestAnswer(plain)) {
      errors.push(
        `Q${item.number} answer matches generic fluff pattern (e.g. "OK", "lest gjennom"). Provide concrete pack-referenced detail.`,
      );
      continue;
    }

    // 4d. Per-spørsmål-anker (Fase 3 P3 nytt)
    const anchorCheck = hasQuestionAnchor(item.answer, item.number);
    if (!anchorCheck.ok) {
      errors.push(
        `Q${item.number} mangler konkret anker. ${anchorCheck.label} forventer: ${anchorCheck.expected}. ` +
          "Sett [self-test-bypass: <begrunnelse>] hvis pack genuint mangler denne typen referanse.",
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    answers,
    bypass: false,
  };
}

function writeConfirmation(selfTestFile, packFile) {
  const validation = validateSelfTest(selfTestFile);
  if (!validation.ok) {
    return validation;
  }
  const head = run("git", ["rev-parse", "HEAD"]);
  const packHash = packFile && existsSync(packFile) ? sha256File(packFile) : "missing";
  const selfTestHash = sha256File(selfTestFile);
  const payload = [
    "PM_KNOWLEDGE_CONTINUITY_CONFIRMED=1",
    `ISO_TIMESTAMP=${new Date().toISOString()}`,
    `VALIDITY_DAYS=${VALIDITY_DAYS}`,
    `MAIN_SHA=${head.ok ? head.stdout : "unknown"}`,
    `PACK_FILE=${packFile ?? ""}`,
    `PACK_SHA256=${packHash}`,
    `SELF_TEST_FILE=${selfTestFile}`,
    `SELF_TEST_SHA256=${selfTestHash}`,
    `ANSWER_COUNT=${validation.answers.length}`,
  ];
  const checksum = sha256Text(payload.join("\n"));
  const output = `${payload.join("\n")}\nCHECKSUM=${checksum}\n`;
  writeFileSync(CONFIRMATION_FILE, output);
  return { ok: true, errors: [], answers: validation.answers };
}

function validateConfirmation() {
  if (!existsSync(CONFIRMATION_FILE)) {
    return { ok: false, errors: [`Missing ${rel(CONFIRMATION_FILE)}.`] };
  }
  const text = readText(CONFIRMATION_FILE);
  const required = [
    "PM_KNOWLEDGE_CONTINUITY_CONFIRMED=1",
    "ISO_TIMESTAMP=",
    "PACK_SHA256=",
    "SELF_TEST_SHA256=",
    "ANSWER_COUNT=",
    "CHECKSUM=",
  ];
  const errors = required.filter((needle) => !text.includes(needle)).map((needle) => `Missing ${needle}`);
  const timestamp = text.match(/^ISO_TIMESTAMP=(.+)$/m)?.[1];
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    errors.push("Invalid ISO_TIMESTAMP.");
  } else {
    const ageDays = (Date.now() - Date.parse(timestamp)) / 86_400_000;
    if (ageDays > VALIDITY_DAYS) {
      errors.push(`Confirmation expired (${ageDays.toFixed(1)} days old, max ${VALIDITY_DAYS}).`);
    }
  }
  const answerCount = Number.parseInt(text.match(/^ANSWER_COUNT=(\d+)$/m)?.[1] ?? "0", 10);
  if (answerCount < 10) {
    errors.push(`ANSWER_COUNT too low (${answerCount}, min 10).`);
  }
  return { ok: errors.length === 0, errors };
}

function statusText() {
  const validation = validateConfirmation();
  if (!validation.ok) {
    return `PM Knowledge Continuity: FAIL\n- ${validation.errors.join("\n- ")}\n`;
  }
  return `PM Knowledge Continuity: OK\n- ${rel(CONFIRMATION_FILE)} is valid for ${VALIDITY_DAYS} days.\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stdout.write(usage());
    return 0;
  }
  if (args["generate-pack"]) {
    const output = resolve(String(args.output || DEFAULT_PACK));
    const pack = generatePack();
    ensureParent(output);
    writeFileSync(output, pack);
    process.stdout.write(`Wrote ${output}\nSHA256 ${sha256File(output)}\n`);
    return 0;
  }
  if (args["self-test-template"]) {
    const pack = args.pack ? resolve(String(args.pack)) : DEFAULT_PACK;
    const output = resolve(String(args.output || DEFAULT_SELF_TEST));
    ensureParent(output);
    writeFileSync(output, generateSelfTest(pack));
    process.stdout.write(`Wrote ${output}\n`);
    return 0;
  }
  if (args["validate-self-test"]) {
    const file = resolve(String(args["validate-self-test"]));
    const result = validateSelfTest(file);
    if (!result.ok) {
      process.stderr.write(`Self-test validation failed:\n- ${result.errors.join("\n- ")}\n`);
      return 1;
    }
    process.stdout.write(`Self-test valid (${result.answers.length} answers).\n`);
    return 0;
  }
  if (args["confirm-self-test"]) {
    const file = resolve(String(args["confirm-self-test"]));
    const pack = args.pack ? resolve(String(args.pack)) : DEFAULT_PACK;
    const result = writeConfirmation(file, pack);
    if (!result.ok) {
      process.stderr.write(`Self-test confirmation failed:\n- ${result.errors.join("\n- ")}\n`);
      return 1;
    }
    process.stdout.write(`Wrote ${CONFIRMATION_FILE}\n`);
    return 0;
  }
  if (args.validate) {
    const result = validateConfirmation();
    if (!result.ok) {
      process.stderr.write(`PM Knowledge Continuity validation failed:\n- ${result.errors.join("\n- ")}\n`);
      return 1;
    }
    process.stdout.write("PM Knowledge Continuity validation passed.\n");
    return 0;
  }
  if (args.status) {
    process.stdout.write(statusText());
    return validateConfirmation().ok ? 0 : 1;
  }
  process.stderr.write(usage());
  return 1;
}

// Only run main() when invoked as a script (not when imported by tests).
// Without this guard, importing this module from a test triggers usage()
// and sets exitCode=1, which fails the whole test-runner process.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exitCode = main();
}
