#!/usr/bin/env node
/**
 * fill-placeholders.mjs
 *
 * Interaktiv utfylling av <fyll inn>-placeholders i Bølge 1-3-filene.
 *
 * Bruk:
 *   node scripts/fill-placeholders.mjs            # Vis meny
 *   node scripts/fill-placeholders.mjs --all      # Gå gjennom alle kategorier
 *   node scripts/fill-placeholders.mjs --list     # List bare kategorier + status
 */

import { readFile, writeFile, copyFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", gray: "\x1b[90m",
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(prompt, { sensitive = false } = {}) {
  return new Promise((resolve) => {
    if (sensitive) {
      const originalWrite = rl._writeToOutput;
      rl._writeToOutput = function (s) {
        if (s === "\n" || s === "\r\n" || s === "\r") {
          originalWrite.call(rl, s);
        } else {
          originalWrite.call(rl, "*");
        }
      };
      rl.question(prompt, (answer) => {
        rl._writeToOutput = originalWrite;
        process.stdout.write("\n");
        resolve(answer.trim());
      });
    } else {
      rl.question(prompt, (answer) => resolve(answer.trim()));
    }
  });
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function replaceInFile(absPath, find, replace) {
  const content = await readFile(absPath, "utf8");
  if (!content.includes(find)) return false;
  const updated = content.replaceAll(find, replace);
  if (updated === content) return false;
  await writeFile(absPath, updated, "utf8");
  return true;
}

async function fileContainsAny(absPath, patterns) {
  if (!(await fileExists(absPath))) return false;
  const content = await readFile(absPath, "utf8");
  return patterns.some((p) => content.includes(p));
}

const CATEGORIES = [
  {
    id: "render-api",
    label: "Render API key + service-IDer",
    setup: async () => {
      const local = resolve(REPO_ROOT, "secrets/render-api.local.md");
      const template = resolve(REPO_ROOT, "secrets/render-api.template.md");
      if (!(await fileExists(local))) {
        await copyFile(template, local);
        console.log(`${C.green}✓${C.reset} Opprettet ${C.cyan}secrets/render-api.local.md${C.reset} fra template (gitignored)`);
      }
    },
    fields: [
      { prompt: "Render API key (selve nøkkelen, skjules under inntasting)", sensitive: true,
        files: [{ path: "secrets/render-api.local.md", find: "<LIM INN HER>", replace: "{value}" }] },
      { prompt: "Sist rotert (YYYY-MM-DD, eks 2026-05-10)",
        files: [{ path: "secrets/render-api.local.md", find: "**Sist rotert:** YYYY-MM-DD", replace: "**Sist rotert:** {value}" }] },
      { prompt: "Backend prod service-ID (srv-...)",
        files: [{ path: "secrets/render-api.local.md", find: "| Backend (prod) | `<srv-...>` |", replace: "| Backend (prod) | `{value}` |" }] },
      { prompt: "Backend staging service-ID (srv-...)",
        files: [{ path: "secrets/render-api.local.md", find: "| Backend (staging) | `<srv-...>` |", replace: "| Backend (staging) | `{value}` |" }] },
      { prompt: "Postgres prod service-ID (dbs-...)",
        files: [{ path: "secrets/render-api.local.md", find: "| Postgres (prod) | `<dbs-...>` |", replace: "| Postgres (prod) | `{value}` |" }] },
      { prompt: "Redis prod service-ID (red-...)",
        files: [{ path: "secrets/render-api.local.md", find: "| Redis (prod) | `<red-...>` |", replace: "| Redis (prod) | `{value}` |" }] },
    ],
  },
  {
    id: "tobias-contact",
    label: "Tobias' telefonnummer + tilgjengelighet",
    fields: [
      { prompt: "Tobias' telefonnummer (eks +47 12345678)",
        files: [
          { path: "docs/operations/STAKEHOLDERS.md", find: "- **Telefon:** _<fyll inn>_", replace: "- **Telefon:** {value}" },
          { path: "docs/operations/EMERGENCY_RUNBOOK.md", find: "SMS: _<Tobias' nummer her — fyll inn>_", replace: "SMS: {value}" },
        ] },
      { prompt: "Arbeidstid + akseptert kontakt-vindu",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "- **Tilgjengelighet:** _<arbeidstid + akseptert kontakt-vindu>_", replace: "- **Tilgjengelighet:** {value}" }] },
    ],
  },
  {
    id: "vendor-render",
    label: "Vendor: Render (plan, kost, fornyelse)",
    fields: [
      { prompt: "Render plan (Pro / Team / Enterprise)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Plan: _<fyll inn — Pro / Team / Enterprise>_", replace: "- Plan: {value}" }] },
      { prompt: "Render månedlig kost",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Månedlig kost: _<fyll inn>_\n- Fornyelse: _<fyll inn dato>_", replace: "- Månedlig kost: {value}\n- Fornyelse: _<fyll inn dato>_" }] },
      { prompt: "Render fornyelse (YYYY-MM-DD)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Fornyelse: _<fyll inn dato>_", replace: "- Fornyelse: {value}" }] },
      { prompt: "Render auto-renew (ja/nei)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Auto-renew: _<ja/nei>_", replace: "- Auto-renew: {value}" }] },
      { prompt: "Render kontrakt-utløp i tabell-rad",
        files: [{ path: "docs/operations/VENDORS.md", find: "| 1 | Render.com | PaaS / hosting | KRITISK (eneste hosting) | _<fyll inn>_ | 99.95 % |", replace: "| 1 | Render.com | PaaS / hosting | KRITISK (eneste hosting) | {value} | 99.95 % |" }] },
    ],
  },
  {
    id: "vendor-swedbank",
    label: "Vendor: Swedbank Pay (kritisk — payment)",
    fields: [
      { prompt: "Swedbank konto-eier (navn / e-post)",
        files: [{ path: "docs/operations/VENDORS.md", find: "**Kontaktinfo:**\n- Konto-eier: _<fyll inn>_\n- Account manager: _<navn + e-post>_", replace: "**Kontaktinfo:**\n- Konto-eier: {value}\n- Account manager: _<navn + e-post>_" }] },
      { prompt: "Swedbank Account manager (navn + e-post)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Account manager: _<navn + e-post>_", replace: "- Account manager: {value}" }] },
      { prompt: "Swedbank tech-support (e-post / portal)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Tech-support: _<e-post / portal>_", replace: "- Tech-support: {value}" }] },
      { prompt: "Swedbank avtale-ID",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Avtale-ID: _<fyll inn>_\n- Inngått: _<dato>_", replace: "- Avtale-ID: {value}\n- Inngått: _<dato>_" }] },
      { prompt: "Swedbank avtale inngått (YYYY-MM-DD)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Inngått: _<dato>_\n- Fornyelse: _<dato>_", replace: "- Inngått: {value}\n- Fornyelse: _<dato>_" }] },
      { prompt: "Swedbank fornyelse (YYYY-MM-DD)",
        files: [
          { path: "docs/operations/VENDORS.md", find: "- Inngått: _<dato>_\n- Fornyelse: _<dato>_", replace: "- Inngått: _<dato>_\n- Fornyelse: {value}" },
          { path: "docs/operations/VENDORS.md", find: "| 2 | Swedbank Pay | Payment gateway | KRITISK (eneste betalings-vei) | _<fyll inn>_ | _<fra avtale>_ |", replace: "| 2 | Swedbank Pay | Payment gateway | KRITISK (eneste betalings-vei) | {value} | _<fra avtale>_ |" },
        ] },
      { prompt: "Swedbank transaksjons-fee (eks 1.5% + 2 NOK)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Transaksjons-fee: _<fyll inn — % + faste beløp>_", replace: "- Transaksjons-fee: {value}" }] },
    ],
  },
  {
    id: "vendor-bankid",
    label: "Vendor: BankID (KYC)",
    fields: [
      { prompt: "BankID konto-eier",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Konto-eier: _<fyll inn>_\n- Vendor: _<BankID Norge AS / Signicat / annen integrator>_", replace: "- Konto-eier: {value}\n- Vendor: _<BankID Norge AS / Signicat / annen integrator>_" }] },
      { prompt: "BankID vendor (BankID Norge AS / Signicat / Criipto / annen)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Vendor: _<BankID Norge AS / Signicat / annen integrator>_", replace: "- Vendor: {value}" }] },
      { prompt: "BankID account manager (navn)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Account manager: _<navn>_", replace: "- Account manager: {value}" }] },
      { prompt: "BankID kontrakts-utløp (YYYY-MM-DD)",
        files: [{ path: "docs/operations/VENDORS.md", find: "| 3 | BankID | KYC / autentisering | HØY (alternativ: lokal verifikasjon i dev) | _<fyll inn>_ | _<fra avtale>_ |", replace: "| 3 | BankID | KYC / autentisering | HØY (alternativ: lokal verifikasjon i dev) | {value} | _<fra avtale>_ |" }] },
    ],
  },
  {
    id: "vendor-sentry",
    label: "Vendor: Sentry (observability)",
    fields: [
      { prompt: "Sentry plan (Free / Team / Business)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Plan: _<Free / Team / Business>_", replace: "- Plan: {value}" }] },
      { prompt: "Sentry månedlig kost",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Månedlig kost: _<>_", replace: "- Månedlig kost: {value}" }] },
      { prompt: "Sentry kontrakt-utløp (YYYY-MM-DD) — i tabell-rad",
        files: [{ path: "docs/operations/VENDORS.md", find: "| 4 | Sentry | Observability / error-tracking | MIDDELS | _<fyll inn>_ | 99.9 % |", replace: "| 4 | Sentry | Observability / error-tracking | MIDDELS | {value} | 99.9 % |" }] },
    ],
  },
  {
    id: "vendor-smtp",
    label: "Vendor: SMTP-leverandør",
    fields: [
      { prompt: "SMTP-leverandør valg (Postmark / SendGrid / Mailgun / AWS SES / annen)",
        files: [
          { path: "docs/operations/VENDORS.md", find: "**Kontrakt:** _<fyll inn>_", replace: "**Kontrakt:** {value}" },
          { path: "docs/operations/VENDORS.md", find: "| 5 | SMTP-leverandør (TBD) | E-post-utsendelse | MIDDELS | _<fyll inn>_ | _<fra avtale>_ |", replace: "| 5 | SMTP-leverandør | E-post-utsendelse | MIDDELS | {value} | _<fra avtale>_ |" },
        ] },
    ],
  },
  {
    id: "vendor-domain",
    label: "Vendor: Domene-registrar",
    fields: [
      { prompt: "Domene-registrar (eks Domeneshop, Cloudflare, Namecheap)",
        files: [
          { path: "docs/operations/VENDORS.md", find: "- Registrar: _<>_", replace: "- Registrar: {value}" },
          { path: "docs/operations/VENDORS.md", find: "| 6 | Domene-registrar | DNS | HØY | _<fyll inn>_ | — |", replace: "| 6 | Domene-registrar | DNS | HØY | {value} | — |" },
        ] },
      { prompt: "Aktive domener (komma-separert)",
        files: [{ path: "docs/operations/VENDORS.md", find: "  - _<liste alle aktive domener her>_", replace: "  - {value}" }] },
    ],
  },
  {
    id: "vendor-github",
    label: "Vendor: GitHub",
    fields: [
      { prompt: "GitHub plan (Free / Pro / Team / Enterprise)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Plan: _<Free / Pro / Team / Enterprise>_", replace: "- Plan: {value}" }] },
      { prompt: "Personlig konto eller org? (eks 'personlig (tobias363)')",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Org: _<personlig konto eller org?>_", replace: "- Org: {value}" }] },
      { prompt: "2FA aktivert? (ja/nei)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- 2FA aktivert: _<verifiser>_", replace: "- 2FA aktivert: {value}" }] },
      { prompt: "Branch-protection på main? (ja/nei)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Branch-protection på `main`: _<verifiser>_", replace: "- Branch-protection på `main`: {value}" }] },
      { prompt: "Code-owner-required-review? (ja/nei)",
        files: [{ path: "docs/operations/VENDORS.md", find: "- Code-owner-required-review: _<verifiser>_", replace: "- Code-owner-required-review: {value}" }] },
    ],
  },
  {
    id: "vendor-linear",
    label: "Vendor: Linear",
    fields: [
      { prompt: "Linear plan (Free / Standard / Plus)",
        files: [{ path: "docs/operations/VENDORS.md", find: "| 8 | Linear | Issue-tracking | LAV (kan migreres) | _<fyll inn>_ | — |", replace: "| 8 | Linear | Issue-tracking | LAV (kan migreres) | {value} | — |" }] },
    ],
  },
  {
    id: "vendor-anthropic",
    label: "Vendor: Anthropic (Claude)",
    fields: [
      { prompt: "Anthropic plan (Pro / Team / Max / Enterprise)",
        files: [{ path: "docs/operations/VENDORS.md", find: "| 9 | Anthropic (Claude) | AI-utviklings-verktøy | LAV (vekt-redskap) | _<plan-utløp>_ | — |", replace: "| 9 | Anthropic (Claude) | AI-utviklings-verktøy | LAV (vekt-redskap) | {value} | — |" }] },
    ],
  },
  {
    id: "stakeholder-lottstift",
    label: "Stakeholder: Lotteritilsynet (regulator)",
    fields: [
      { prompt: "Lotteritilsynet saksbehandler (navn + tittel)",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "- **Saksbehandler:** _<fyll inn — navn + tittel hvis kjent>_", replace: "- **Saksbehandler:** {value}" }] },
      { prompt: "Lotteritilsynet e-post",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "- **E-post:** _<fyll inn>_\n- **Telefon:** _<fyll inn>_\n- **Postadresse:** Lotteritilsynet, Førde", replace: "- **E-post:** {value}\n- **Telefon:** _<fyll inn>_\n- **Postadresse:** Lotteritilsynet, Førde" }] },
      { prompt: "Lotteritilsynet telefon",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "- **Telefon:** _<fyll inn>_\n- **Postadresse:** Lotteritilsynet, Førde", replace: "- **Telefon:** {value}\n- **Postadresse:** Lotteritilsynet, Førde" }] },
    ],
  },
  {
    id: "stakeholder-datatilsynet",
    label: "Stakeholder: Datatilsynet",
    fields: [
      { prompt: "Datatilsynet saksbehandler",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "- **Saksbehandler:** _<fyll inn>_\n- **Eskaleres ved:** Personvernbrudd", replace: "- **Saksbehandler:** {value}\n- **Eskaleres ved:** Personvernbrudd" }] },
    ],
  },
  {
    id: "pilot-halls",
    label: "Pilot-haller (4 stk: Årnes, Bodø, Brumunddal, Fauske)",
    fields: [
      { prompt: "Teknobingo Årnes — kontaktperson; telefon; e-post",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "| **Teknobingo Årnes** (Master) | Pilot-aktiv | _<fyll inn>_ | _<>_ | _<>_ | Master-hall for Spill 1 (per pilot-design) |", replace: "| **Teknobingo Årnes** (Master) | Pilot-aktiv | {value} | Master-hall for Spill 1 (per pilot-design) |" }] },
      { prompt: "Bodø — kontaktperson; telefon; e-post",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "| **Bodø** | Pilot-aktiv | _<>_ | _<>_ | _<>_ | |", replace: "| **Bodø** | Pilot-aktiv | {value} | |" }] },
      { prompt: "Brumunddal — kontaktperson; telefon; e-post",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "| **Brumunddal** | Pilot-aktiv | _<>_ | _<>_ | _<>_ | |", replace: "| **Brumunddal** | Pilot-aktiv | {value} | |" }] },
      { prompt: "Fauske — kontaktperson; telefon; e-post",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "| **Fauske** | Pilot-aktiv | _<>_ | _<>_ | _<>_ | |", replace: "| **Fauske** | Pilot-aktiv | {value} | |" }] },
    ],
  },
  {
    id: "stakeholder-candy",
    label: "Stakeholder: Candy team-lead",
    fields: [
      { prompt: "Candy team-lead (navn + e-post)",
        files: [{ path: "docs/operations/STAKEHOLDERS.md", find: "- **Kontaktperson:** _<fyll inn — Candy-team-lead>_", replace: "- **Kontaktperson:** {value}" }] },
    ],
  },
  {
    id: "memory-slack",
    label: "MEMORY: Slack MCP-status",
    fields: [
      { prompt: "Er Slack MCP koblet til Cowork? (ja/nei/ikke-relevant)",
        files: [{ path: "docs/memory/MEMORY.md", find: "| Slack MCP | (verifiser) | — |", replace: "| Slack MCP | {value} | — |" }] },
    ],
  },
];

async function categoryStatus(cat) {
  const localFiles = cat.fields
    .flatMap((f) => f.files.map((x) => x.path))
    .filter((p) => p.endsWith(".local.md"));
  for (const f of [...new Set(localFiles)]) {
    if (!(await fileExists(resolve(REPO_ROOT, f)))) {
      return cat.fields.length;
    }
  }
  let remaining = 0;
  for (const field of cat.fields) {
    let stillThere = false;
    for (const file of field.files) {
      const abs = resolve(REPO_ROOT, file.path);
      if (!(await fileExists(abs))) continue;
      const content = await readFile(abs, "utf8");
      if (content.includes(file.find)) {
        stillThere = true;
        break;
      }
    }
    if (stillThere) remaining++;
  }
  return remaining;
}

async function runCategory(cat) {
  console.log(`\n${C.bold}${C.cyan}━━ ${cat.label} ━━${C.reset}`);
  if (cat.setup) await cat.setup();

  let updated = 0;
  let skipped = 0;
  for (const field of cat.fields) {
    let hasPlaceholder = false;
    for (const file of field.files) {
      const abs = resolve(REPO_ROOT, file.path);
      if (await fileContainsAny(abs, [file.find])) {
        hasPlaceholder = true;
        break;
      }
    }
    if (!hasPlaceholder) {
      console.log(`  ${C.gray}✓ allerede utfylt: ${field.prompt}${C.reset}`);
      continue;
    }

    const value = await ask(`  ${C.yellow}?${C.reset} ${field.prompt}\n    ${C.dim}(Enter for å hoppe over)${C.reset} > `, {
      sensitive: field.sensitive ?? false,
    });
    if (!value) {
      skipped++;
      continue;
    }
    let totalReplaced = 0;
    for (const file of field.files) {
      const abs = resolve(REPO_ROOT, file.path);
      const ok = await replaceInFile(abs, file.find, file.replace.replaceAll("{value}", value));
      if (ok) totalReplaced++;
    }
    if (totalReplaced > 0) {
      console.log(`    ${C.green}✓ skrevet til ${totalReplaced} fil(er)${C.reset}`);
      updated++;
    } else {
      console.log(`    ${C.red}⚠ ingen filer endret${C.reset}`);
    }
  }
  console.log(`${C.dim}  → ${updated} oppdatert, ${skipped} hoppet over${C.reset}`);
}

async function listAll() {
  console.log(`\n${C.bold}Status per kategori:${C.reset}\n`);
  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    const remaining = await categoryStatus(cat);
    const marker = remaining === 0 ? `${C.green}✓ ferdig${C.reset}` : `${C.yellow}${remaining} placeholders igjen${C.reset}`;
    console.log(`  ${String(i + 1).padStart(2)}. ${cat.label} — ${marker}`);
  }
  console.log("");
}

async function showMenu() {
  console.log(`\n${C.bold}${C.blue}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.blue}║ Spillorama — Fill Placeholders (interaktiv)                  ║${C.reset}`);
  console.log(`${C.bold}${C.blue}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}Trykk Enter på et felt for å hoppe over. Kjøring er idempotent.${C.reset}\n`);

  await listAll();

  const choice = await ask(`Velg kategori (1-${CATEGORIES.length}), 'all' for alle, eller 'q' for å avslutte: `);
  if (choice === "q" || choice === "quit" || choice === "exit" || choice === "") {
    return false;
  }
  if (choice === "all") {
    for (const cat of CATEGORIES) await runCategory(cat);
    return true;
  }
  const n = parseInt(choice, 10);
  if (isNaN(n) || n < 1 || n > CATEGORIES.length) {
    console.log(`${C.red}Ugyldig valg. Prøv igjen.${C.reset}`);
    return true;
  }
  await runCategory(CATEGORIES[n - 1]);
  return true;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    await listAll();
    rl.close();
    return;
  }

  if (args.includes("--all")) {
    console.log(`${C.bold}Kjører gjennom ALLE kategorier...${C.reset}`);
    for (const cat of CATEGORIES) await runCategory(cat);
    console.log(`\n${C.green}${C.bold}Ferdig.${C.reset}`);
    await listAll();
    rl.close();
    return;
  }

  let cont = true;
  while (cont) cont = await showMenu();
  console.log(`\n${C.green}Ferdig. Husk: \`git diff\` for å se endringene før commit.${C.reset}`);
  console.log(`${C.dim}NB: secrets/*.local.md er gitignored.${C.reset}\n`);
  rl.close();
}

main().catch((err) => {
  console.error(`${C.red}fill-placeholders.mjs failed:${C.reset}`, err);
  rl.close();
  process.exit(1);
});
