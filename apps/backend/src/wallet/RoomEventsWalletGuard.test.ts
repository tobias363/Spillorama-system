/**
 * R6 (BIN-818): statisk guard mot direkte wallet-tabell-writes utenfor
 * `WalletAdapter`.
 *
 * Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.6.
 *
 * Hva denne testen håndhever:
 *   1. Ingen direkte INSERT/UPDATE mot wallet-tabeller fra
 *      `apps/backend/src/{game,sockets}` — alle wallet-mutasjoner SKAL gå
 *      gjennom `WalletAdapter.{debit,credit,transfer,reserve,...}` så
 *      outbox-pattern (BIN-761) er garantert.
 *   2. Ingen `pool.query` eller `client.query` med wallet-tabell-navn fra
 *      socket-handlers eller game-engine-kode.
 *
 * Hvorfor som test og ikke runtime-guard:
 *   - Hindrer regresjon ved at en framtidig PR introduserer en bypass.
 *   - Kjører på CI uten å trenge DB-tilgang.
 *   - Tydelig feilmelding peker ut akkurat hvilken fil + linje som bryter
 *     kontrakten.
 *
 * Hvis denne testen feiler: ikke disable den. Refaktorer call-site-en til å
 * bruke `WalletAdapter`-interface, eller diskuter unntak i PR-en.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const BACKEND_SRC = join(REPO_ROOT, "apps/backend/src");

/**
 * Wallet-tabell-navn som er forbeholdt `PostgresWalletAdapter`. Hvis en av
 * disse dukker opp i en INSERT/UPDATE/DELETE i scanned-mappene, er det en
 * bypass av outbox-laget.
 *
 * `wallet_reservations` er IKKE her — reserve/release-ops er saldo-lås, ikke
 * pengebevegelser, og har ingen outbox-event. Adapter eier dem fortsatt, men
 * det er ikke en outbox-relevant invariant.
 *
 * `wallet_outbox` har spesiell betydning: kun `WalletOutboxRepo` skal skrive.
 */
const WALLET_TABLES = [
  "wallet_outbox",
  "wallet_transactions",
  "wallet_entries",
  "wallet_account",
  "wallet_balance",
  "wallet_accounts",
  "wallet_balances",
];

/**
 * Mapper som SKAL auditeres. Disse skal aldri skrive direkte til wallet-
 * tabellene — alt går via `WalletAdapter`.
 */
const SCAN_DIRS = [
  join(BACKEND_SRC, "game"),
  join(BACKEND_SRC, "sockets"),
];

/**
 * Filer som er eksplisitt unntatt scan-en (f.eks. fordi de leser, ikke
 * skriver, eller dokumenterer i kommentarer).
 */
const ALLOWLIST_PATTERNS = [
  // Read-only join for replay (audit-flyt).
  "Game1ReplayService.ts",
  // README og test-filer er per definisjon ute av prod-pathen.
  "README.md",
  ".test.ts",
  ".test.js",
  "__tests__",
  // Compliance-store skriver til loss-tabeller (ikke wallet-tabeller).
  "PostgresResponsibleGamingStore.ts",
];

function isAllowlisted(absPath: string): boolean {
  return ALLOWLIST_PATTERNS.some((pattern) => absPath.includes(pattern));
}

function* walkDir(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Mappen finnes ikke (f.eks. ny check-out). Skip stille.
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walkDir(full);
    } else if (s.isFile() && /\.(ts|js)$/.test(entry)) {
      yield full;
    }
  }
}

interface Violation {
  file: string;
  line: number;
  text: string;
  table: string;
  statement: string;
}

const MUTATING_STATEMENTS = ["INSERT INTO", "UPDATE", "DELETE FROM"];

/**
 * Strip enkle kommentarer/blokk-kommentarer fra en linje slik at vi ikke
 * matcher beskrivende prosa. Vi gjør dette på linje-basis — det er ikke en
 * full TS-parser, men dekker majoriteten av false-positives.
 */
function stripCommentary(line: string): string {
  // // line-comment
  const lineCommentIdx = line.indexOf("//");
  let trimmed = lineCommentIdx >= 0 ? line.slice(0, lineCommentIdx) : line;
  // /* block-comment */
  trimmed = trimmed.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "");
  return trimmed;
}

function scanFile(absPath: string): Violation[] {
  const source = readFileSync(absPath, "utf8");
  const lines = source.split("\n");
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const code = stripCommentary(raw).toUpperCase();
    // Ignorer linjer som starter med * (jsdoc/blokk-kommentar mid-stream).
    if (raw.trim().startsWith("*")) continue;

    for (const stmt of MUTATING_STATEMENTS) {
      if (!code.includes(stmt)) continue;
      for (const table of WALLET_TABLES) {
        // Match både `INSERT INTO wallet_outbox` og
        // `INSERT INTO "${schema}"."wallet_outbox"` (template literals).
        const upperTable = table.toUpperCase();
        if (code.includes(upperTable)) {
          violations.push({
            file: absPath,
            line: i + 1,
            text: raw.trim(),
            table,
            statement: stmt,
          });
        }
      }
    }
  }

  return violations;
}

test("R6 (BIN-818): ingen direkte wallet-tabell-mutasjoner i src/{game,sockets}", () => {
  const violations: Violation[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkDir(dir)) {
      if (isAllowlisted(file)) continue;
      violations.push(...scanFile(file));
    }
  }

  if (violations.length > 0) {
    const summary = violations
      .map(
        (v) =>
          `  ${relative(REPO_ROOT, v.file)}:${v.line} — ${v.statement} ${v.table}\n    ${v.text}`,
      )
      .join("\n");
    assert.fail(
      `R6 outbox-validering brutt: fant ${violations.length} direkte wallet-tabell-mutasjon(er) i rom-event-koden.\n` +
        `Alle wallet-mutasjoner SKAL gå gjennom WalletAdapter (debit/credit/transfer/...) så outbox-pattern (BIN-761) er garantert.\n\n` +
        `Brudd:\n${summary}\n\n` +
        `Hvis dette er en legitim ny call-site, refaktorer til WalletAdapter.\n` +
        `Hvis det er en bevisst unntak (kun audit-read), legg filen i ALLOWLIST_PATTERNS i denne testen.`,
    );
  }
});

/**
 * Sekundær guard: ingen `pool.query` eller `client.query` med wallet-tabell-
 * navn i template strings — fanger opp tilfeller der noen prøver å skrive
 * via en raw query mot den underliggende pool-en.
 *
 * Vi sjekker kun mot `wallet_outbox` og `wallet_transactions` her — de andre
 * tabellene er allerede dekket av primær-guarden over. Dette er en mer
 * lemfeldig regex-match som fanger raw-query-spawnere.
 */
test("R6 (BIN-818): ingen raw .query() mot wallet_outbox/wallet_transactions i src/{game,sockets}", () => {
  const violations: Violation[] = [];
  const sensitiveTables = ["wallet_outbox", "wallet_transactions"];

  for (const dir of SCAN_DIRS) {
    for (const file of walkDir(dir)) {
      if (isAllowlisted(file)) continue;
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        if (raw.trim().startsWith("//") || raw.trim().startsWith("*")) continue;
        const code = stripCommentary(raw);
        // Match .query(...) or .query<...>(...) followed by template literal
        // referring to wallet table.
        if (!/\.query\b/i.test(code)) continue;
        for (const table of sensitiveTables) {
          if (code.includes(table)) {
            // Allow read-only audit join som finnes i Game1ReplayService.
            // Sjekk om SELECT/JOIN i samme uttrykk — hvis ja, ok.
            const joinedSelect =
              /SELECT\s|JOIN\s/i.test(source.slice(
                Math.max(0, source.indexOf(raw) - 200),
                source.indexOf(raw) + raw.length + 200,
              ));
            if (joinedSelect && !/INSERT|UPDATE|DELETE/i.test(code)) {
              continue; // read-only OK
            }
            violations.push({
              file,
              line: i + 1,
              text: raw.trim(),
              table,
              statement: "raw .query()",
            });
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    const summary = violations
      .map(
        (v) =>
          `  ${relative(REPO_ROOT, v.file)}:${v.line} — ${v.statement} on ${v.table}\n    ${v.text}`,
      )
      .join("\n");
    assert.fail(
      `R6 outbox-validering: fant ${violations.length} raw .query() mot ` +
        `wallet-mutasjons-tabeller. Bruk WalletAdapter-metodene i stedet.\n\n` +
        `Brudd:\n${summary}`,
    );
  }
});
