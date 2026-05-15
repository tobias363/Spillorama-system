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

function parseAnswers(text) {
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

function validateSelfTest(file) {
  if (!file || !existsSync(file)) {
    return { ok: false, errors: [`Self-test file missing: ${file ?? "<not provided>"}`], answers: [] };
  }
  const text = readText(file);
  const answers = parseAnswers(text);
  const errors = [];
  if (answers.length < 10) {
    errors.push(`Expected at least 10 answers, found ${answers.length}.`);
  }
  for (const item of answers) {
    const plain = item.answer.replace(/`[^`]*`/g, "").trim();
    if (plain.length < 80) {
      errors.push(`Q${item.number} answer is too short (${plain.length} chars, min 80).`);
    }
    if (PLACEHOLDER_TOKEN_RE.test(plain) || PLACEHOLDER_EXACT_RE.test(plain)) {
      errors.push(`Q${item.number} answer contains placeholder or non-evidence text.`);
    }
  }
  const packHash = text.match(/\*\*Pack SHA256:\*\*\s+`([^`]+)`/)?.[1];
  if (!packHash || packHash === "missing") {
    errors.push("Self-test must reference a real evidence pack SHA256.");
  }
  return { ok: errors.length === 0, errors, answers };
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

process.exitCode = main();
