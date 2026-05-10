#!/usr/bin/env node
/**
 * generate-weekly-status.mjs
 *
 * Genererer docs/status/YYYY-Wnn.md — ukentlig status-digest fra git-log,
 * PM-handoffs, og BACKLOG-endringer.
 *
 * CLI:
 *   node scripts/generate-weekly-status.mjs                  # Generer for nåværende uke
 *   node scripts/generate-weekly-status.mjs --week=2026-W19  # Spesifikk uke
 *   node scripts/generate-weekly-status.mjs --dry-run        # Print til stdout
 */

import { writeFile, readFile, readdir, mkdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const weekArg = args.find((a) => a.startsWith("--week="))?.split("=")[1];

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  const orig = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const origDay = orig.getUTCDay() || 7;
  orig.setUTCDate(orig.getUTCDate() - origDay + 1);
  const sunday = new Date(orig);
  sunday.setUTCDate(orig.getUTCDate() + 6);
  return {
    year: isoYear, week,
    mondayDate: orig.toISOString().slice(0, 10),
    sundayDate: sunday.toISOString().slice(0, 10),
  };
}

function parseWeekArg(arg) {
  const m = arg.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) throw new Error(`Bad --week format: ${arg}. Expected YYYY-Wnn.`);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return isoWeek(target);
}

const weekInfo = weekArg ? parseWeekArg(weekArg) : isoWeek(new Date());
const weekTag = `${weekInfo.year}-W${String(weekInfo.week).padStart(2, "0")}`;
const since = weekInfo.mondayDate;
const until = weekInfo.sundayDate;

console.error(`Generating digest for ${weekTag} (${since} → ${until})`);

function gitLog(format, sinceDate, untilDate) {
  try {
    return execSync(
      `git log --no-merges --pretty=format:'${format}' --since="${sinceDate} 00:00" --until="${untilDate} 23:59"`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
  } catch {
    return "";
  }
}

function gitMergedPRs(sinceDate, untilDate) {
  try {
    const out = execSync(
      `git log --pretty=format:'%H|%s|%cI' --since="${sinceDate} 00:00" --until="${untilDate} 23:59" --merges main`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const commits = gitLog("%h|%s|%an|%cI", since, until)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [hash, subject, author, date] = line.split("|");
    return { hash, subject, author, date };
  });

const mergeCommits = gitMergedPRs(since, until).map((line) => {
  const [hash, subject, date] = line.split("|");
  const prMatch = subject.match(/#(\d+)/);
  return { hash, subject, date, pr: prMatch ? prMatch[1] : null };
});

const categories = {
  feat: [], fix: [], docs: [], test: [],
  chore: [], refactor: [], perf: [], other: [],
};
for (const c of commits) {
  const m = c.subject.match(/^(\w+)(\([^)]+\))?:/);
  const cat = m && categories[m[1]] !== undefined ? m[1] : "other";
  categories[cat].push(c);
}

async function findHandoffsInWeek() {
  const handoffsDir = resolve(REPO_ROOT, "docs/operations");
  let files;
  try {
    files = await readdir(handoffsDir);
  } catch {
    return [];
  }
  const inWeek = [];
  const sinceMs = new Date(since + "T00:00:00Z").getTime();
  const untilMs = new Date(until + "T23:59:59Z").getTime();
  for (const f of files) {
    if (!f.startsWith("PM_HANDOFF_")) continue;
    const m = f.match(/PM_HANDOFF_(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    const fileDate = new Date(m[1] + "T12:00:00Z").getTime();
    if (fileDate >= sinceMs && fileDate <= untilMs) {
      inWeek.push(f);
    }
  }
  return inWeek.sort();
}

const handoffsInWeek = await findHandoffsInWeek();

async function backlogSnapshot() {
  try {
    const content = await readFile(resolve(REPO_ROOT, "BACKLOG.md"), "utf8");
    const head = content.split("\n").slice(0, 30).join("\n");
    return head;
  } catch {
    return "_<BACKLOG.md ikke funnet>_";
  }
}

async function postmortemsInWeek() {
  const dir = resolve(REPO_ROOT, "docs/postmortems");
  let files;
  try { files = await readdir(dir); } catch { return []; }
  const inWeek = [];
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    if (m[1] >= since && m[1] <= until) inWeek.push(f);
  }
  return inWeek.sort();
}
const postmortems = await postmortemsInWeek();

async function newADRsInWeek() {
  const dir = resolve(REPO_ROOT, "docs/adr");
  let files;
  try { files = await readdir(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.match(/^\d{4}-/)) continue;
    const absPath = resolve(dir, f);
    try {
      const s = await stat(absPath);
      const ageMs = Date.now() - s.birthtimeMs;
      const sinceMs = Date.now() - new Date(since + "T00:00:00Z").getTime();
      if (ageMs <= sinceMs + 7 * 24 * 3600 * 1000) {
        try {
          const firstCommit = execSync(
            `git log --diff-filter=A --pretty=format:%cI -- "${absPath}"`,
            { cwd: REPO_ROOT, encoding: "utf8" },
          ).trim();
          if (firstCommit && firstCommit >= since && firstCommit <= until) {
            out.push(f);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return out.sort();
}
const newADRs = await newADRsInWeek();

function fmtCommit(c) {
  return `- \`${c.hash}\` ${c.subject} _(${c.author})_`;
}

const report = `# Ukesdigest ${weekTag}

**Periode:** ${since} → ${until}
**Generert:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
**Auto-generated by:** \`scripts/generate-weekly-status.mjs\`

> **Til ny PM/Tobias:** Dette er en automatisk samlet oversikt over hva som
> skjedde i uken. Den erstatter ikke PM-handoffs (som dekker enkeltsesjoner)
> men gir kronologisk uke-til-uke-kontekst over tid.

---

## Sammendrag

- **Commits:** ${commits.length} (på \`main\`, no-merges)
- **Merge commits:** ${mergeCommits.length}${mergeCommits.length > 0 ? ` (PR-er: ${mergeCommits.filter((c) => c.pr).map((c) => `#${c.pr}`).join(", ") || "—"})` : ""}
- **Nye PM-handoffs:** ${handoffsInWeek.length}
- **Nye postmortems:** ${postmortems.length}
- **Nye ADR-er:** ${newADRs.length}

${
  postmortems.length > 0
    ? `\n### 🚨 Postmortems denne uken\n\n${postmortems.map((p) => `- [\`${p}\`](../postmortems/${p})`).join("\n")}\n`
    : ""
}${
  newADRs.length > 0
    ? `\n### 📝 Nye ADR-er denne uken\n\n${newADRs.map((a) => `- [\`${a}\`](../adr/${a})`).join("\n")}\n`
    : ""
}${
  handoffsInWeek.length > 0
    ? `\n### 📋 PM-handoffs denne uken\n\n${handoffsInWeek.map((h) => `- [\`${h}\`](../operations/${h})`).join("\n")}\n`
    : ""
}

---

## Commits per kategori

${
  Object.entries(categories)
    .filter(([_, list]) => list.length > 0)
    .map(([cat, list]) => `### ${cat} (${list.length})\n\n${list.slice(0, 50).map(fmtCommit).join("\n")}${list.length > 50 ? `\n\n_... og ${list.length - 50} til_` : ""}\n`)
    .join("\n")
}

---

## BACKLOG (snapshot ved generering)

\`\`\`
${await backlogSnapshot()}
\`\`\`

Full BACKLOG: [\`BACKLOG.md\`](../../BACKLOG.md)

---

## Hva neste PM bør se

- Sjekk nyeste handoff: \`ls -t docs/operations/PM_HANDOFF_*.md | head -1\`
- Sjekk pilot-status: kjør \`./scripts/pm-onboarding.sh\`
- Sjekk om noen risikoer materialiserte seg: [\`docs/RISKS.md\`](../RISKS.md)
${postmortems.length > 0 ? "- **Les denne ukens postmortems** (lenker over)" : ""}

---

**Forrige uke:** _<lenke til forrige ukes-digest hvis den eksisterer>_
**Neste uke:** _<vil bli generert automatisk neste fredag>_
`;

if (dryRun) {
  process.stdout.write(report);
  process.exit(0);
}

const outDir = resolve(REPO_ROOT, "docs/status");
await mkdir(outDir, { recursive: true });
const outPath = resolve(outDir, `${weekTag}.md`);
await writeFile(outPath, report, "utf8");
console.error(`Wrote ${outPath}`);
process.exit(0);
