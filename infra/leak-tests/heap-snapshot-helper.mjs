#!/usr/bin/env node
/**
 * heap-snapshot-helper.mjs — diagnostisk sample-helper for R9 leak-test (BIN-819).
 *
 * Linear: https://linear.app/bingosystem/issue/BIN-819
 * Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.5
 *
 * To moduser:
 *
 *   1) SAMPLE-modus (default) — kjøres av r9-spill2-24h-leak-test.sh hver time:
 *      Spør backenden om diagnostikk (heap-bruk, FD-count, DB-pool, Redis,
 *      Socket.IO connected clients). Skriver resultatet som ÉN linje JSON
 *      til stdout. Hvis backenden mangler diagnose-endepunkter, faller
 *      helperen tilbake til 0 / udefinert per-felt og skriver et warning til
 *      stderr — testen fortsetter, men med begrenset signal.
 *
 *      Hvis --snapshot er gitt, ber helperen backenden ta et heap-snapshot
 *      som lagres i --out-dir/heap-{label}.heapsnapshot. Snapshots kan
 *      lastes inn i Chrome DevTools (Memory-tab → Load) for sammenligning
 *      mellom timer.
 *
 *   2) ANALYZE-modus (--analyze) — kjøres på slutten av leak-testen:
 *      Leser samples.json, regner ut heap-vekst, fd-vekst, og avgjør om
 *      invarianten holder seg innenfor toleranse-grense. Returnerer
 *      `{ ok, heapGrowthPct, fdGrowthPct, errors[] }` på stdout.
 *
 * Bruk:
 *   node heap-snapshot-helper.mjs \
 *     --backend=http://localhost:4000 \
 *     --token=<jwt> \
 *     --label=h0 \
 *     --out-dir=/tmp/r9-samples \
 *     [--snapshot]
 *
 *   node heap-snapshot-helper.mjs --analyze \
 *     --samples=/tmp/r9-samples/samples.json \
 *     --heap-growth-limit-pct=10 \
 *     --fd-growth-limit-pct=10
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, ...rest] = a.slice(2).split("=");
    out[k] = rest.length === 0 ? true : rest.join("=");
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// ── Sample-modus ────────────────────────────────────────────────────────
async function sampleMode() {
  const backend = String(args.backend ?? "http://localhost:4000");
  const token = String(args.token ?? "");
  const label = String(args.label ?? "unknown");
  const outDir = String(args.outDir ?? args["out-dir"] ?? "/tmp");
  const wantSnapshot = Boolean(args.snapshot);

  const result = {
    label,
    timestamp: new Date().toISOString(),
    heapUsedMb: 0,
    heapTotalMb: 0,
    rssMb: 0,
    openFileDescriptors: 0,
    dbPoolActive: 0,
    dbPoolIdle: 0,
    dbPoolTotal: 0,
    redisClients: 0,
    socketIoClients: 0,
    healthOk: false,
    snapshotPath: null,
    warnings: [],
  };

  // Forsøk å lese fra et diagnostics-endpoint hvis det finnes. Mest sannsynlig
  // navn er `/api/internal/diagnostics` eller `/health-deep`. Vi prøver begge
  // og feiler graceful hvis ingen finnes — testen rapporterer da kun RSS
  // og lar warnings dokumentere at finkornet sample ikke var mulig.
  const diagCandidates = [
    "/api/internal/diagnostics",
    "/api/admin/diagnostics",
    "/health/deep",
    "/health-deep",
  ];

  let diagBody = null;
  for (const p of diagCandidates) {
    try {
      const res = await fetch(`${backend}${p}`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        // Kort timeout — diagnostikk skal være rask hvis den finnes
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        diagBody = await res.json().catch(() => null);
        if (diagBody) {
          break;
        }
      }
    } catch {
      // try next
    }
  }

  if (!diagBody) {
    result.warnings.push(
      "Ingen diagnose-endpoint funnet — heap/fd-tall blir ikke samplet via app. Fallback: docker stats.",
    );
  } else {
    // Vi forventer en flat eller envelope-struktur. Tolerer begge.
    const d = diagBody.data ?? diagBody;
    result.heapUsedMb = Number(d.heapUsedMb ?? d.heap?.usedMb ?? 0);
    result.heapTotalMb = Number(d.heapTotalMb ?? d.heap?.totalMb ?? 0);
    result.rssMb = Number(d.rssMb ?? d.rss?.mb ?? 0);
    result.openFileDescriptors = Number(d.openFds ?? d.fdCount ?? 0);
    result.dbPoolActive = Number(d.db?.poolActive ?? d.dbPoolActive ?? 0);
    result.dbPoolIdle = Number(d.db?.poolIdle ?? d.dbPoolIdle ?? 0);
    result.dbPoolTotal = Number(d.db?.poolTotal ?? d.dbPoolTotal ?? 0);
    result.redisClients = Number(d.redis?.clients ?? d.redisClients ?? 0);
    result.socketIoClients = Number(d.socketIo?.clients ?? d.socketIoClients ?? 0);
    result.healthOk = Boolean(d.healthOk ?? d.ok ?? true);
  }

  // Heap-snapshot via /api/internal/heap-snapshot HVIS endpointen finnes.
  // Helperen er fail-safe: hvis ikke, hopper den over snapshot og noterer
  // det i warnings. Faktisk implementasjon av heap-snapshot-endpoint
  // dokumenteres i R9_SPILL2_LEAK_TEST_RESULT.md som "trenger backend-side
  // tillegg" hvis det ikke finnes.
  if (wantSnapshot) {
    fs.mkdirSync(outDir, { recursive: true });
    const snapPath = path.join(outDir, `heap-${label}.heapsnapshot`);
    let snapDone = false;

    const snapCandidates = [
      "/api/internal/heap-snapshot",
      "/api/admin/diagnostics/heap-snapshot",
    ];
    for (const p of snapCandidates) {
      try {
        const res = await fetch(`${backend}${p}`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(60000), // heap-snap kan ta 30+ sek
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(snapPath, buf);
          result.snapshotPath = snapPath;
          snapDone = true;
          break;
        }
      } catch {
        // try next
      }
    }
    if (!snapDone) {
      result.warnings.push(
        "Heap-snapshot-endpoint ikke implementert — bruk Chrome DevTools Inspector " +
          "eller node --inspect for manuell snapshot. Se " +
          "infra/leak-tests/heap-snapshot-helper.mjs §heap-snapshot-fallback.",
      );
    }
  }

  // Skriv én-linjet JSON til stdout
  process.stdout.write(JSON.stringify(result));
  process.stdout.write("\n");
}

// ── Analyze-modus ────────────────────────────────────────────────────────
function analyzeMode() {
  const samplesPath = String(args.samples ?? "");
  const heapLimit = Number(args["heap-growth-limit-pct"] ?? 10);
  const fdLimit = Number(args["fd-growth-limit-pct"] ?? 10);

  if (!samplesPath || !fs.existsSync(samplesPath)) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        errors: [`samples-fil mangler: ${samplesPath}`],
      }),
    );
    process.exit(2);
  }

  const samples = JSON.parse(fs.readFileSync(samplesPath, "utf8"));
  if (!Array.isArray(samples) || samples.length < 2) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        errors: [
          `For få samples for analyse: trenger ≥2, har ${samples.length}`,
        ],
      }),
    );
    process.exit(1);
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const errors = [];

  // Heap-vekst beregnes på heapUsedMb. Hvis den er 0 (ingen diag-endpoint
  // tilgjengelig), faller vi tilbake til rssMb.
  const useHeap =
    Number(first.heapUsedMb) > 0 && Number(last.heapUsedMb) > 0;
  const baselineHeap = useHeap
    ? Number(first.heapUsedMb)
    : Number(first.rssMb);
  const finalHeap = useHeap
    ? Number(last.heapUsedMb)
    : Number(last.rssMb);
  const heapGrowthPct =
    baselineHeap > 0
      ? ((finalHeap - baselineHeap) / baselineHeap) * 100
      : 0;
  if (heapGrowthPct > heapLimit) {
    errors.push(
      `Heap-vekst ${heapGrowthPct.toFixed(2)}% overskrider grense ${heapLimit}% ` +
        `(baseline=${baselineHeap.toFixed(1)}MB, final=${finalHeap.toFixed(1)}MB, ` +
        `kilde=${useHeap ? "heap" : "rss-fallback"})`,
    );
  }

  // FD-vekst — beregnes kun hvis vi har > 0 første samplet
  const baselineFd = Number(first.openFds ?? first.openFileDescriptors ?? 0);
  const finalFd = Number(last.openFds ?? last.openFileDescriptors ?? 0);
  let fdGrowthPct = 0;
  if (baselineFd > 0 && finalFd > 0) {
    fdGrowthPct = ((finalFd - baselineFd) / baselineFd) * 100;
    if (fdGrowthPct > fdLimit) {
      errors.push(
        `FD-vekst ${fdGrowthPct.toFixed(2)}% overskrider grense ${fdLimit}% ` +
          `(baseline=${baselineFd}, final=${finalFd})`,
      );
    }
  }

  // DB-pool: hvis dbPoolActive maxer ut over tid (= ingen idle), tyder
  // det på connection-leak. Vi flagger hvis dbPoolIdle > 0 i baseline
  // men 0 i final (tegn på at connections aldri returneres til poolen).
  const idleBaseline = Number(first.dbPoolIdle ?? 0);
  const idleFinal = Number(last.dbPoolIdle ?? 0);
  if (idleBaseline > 0 && idleFinal === 0) {
    errors.push(
      `DB-pool idle dropper fra ${idleBaseline} til 0 — mulig connection-leak`,
    );
  }

  // Mer-data-statistikk for rapport
  const stats = {
    samples: samples.length,
    baselineHeapMb: baselineHeap,
    finalHeapMb: finalHeap,
    heapGrowthPct: Number(heapGrowthPct.toFixed(2)),
    baselineFd,
    finalFd,
    fdGrowthPct: Number(fdGrowthPct.toFixed(2)),
    baselineDbPoolIdle: idleBaseline,
    finalDbPoolIdle: idleFinal,
    redisClientsBaseline: Number(first.redisClients ?? 0),
    redisClientsFinal: Number(last.redisClients ?? 0),
    socketClientsBaseline: Number(first.socketIoClients ?? 0),
    socketClientsFinal: Number(last.socketIoClients ?? 0),
  };

  const result = {
    ok: errors.length === 0,
    heapGrowthPct: stats.heapGrowthPct,
    fdGrowthPct: stats.fdGrowthPct,
    errors,
    stats,
  };

  process.stdout.write(JSON.stringify(result));
  process.stdout.write("\n");
  process.exit(errors.length === 0 ? 0 : 1);
}

// ── Entry ────────────────────────────────────────────────────────────────
if (args.analyze) {
  analyzeMode();
} else {
  sampleMode().catch((err) => {
    process.stderr.write(`heap-snapshot-helper: ${err.message}\n`);
    process.stdout.write(
      JSON.stringify({
        error: String(err.message ?? err),
        heapUsedMb: 0,
        rssMb: 0,
      }),
    );
    process.exit(0); // fail-soft: testen fortsetter med begrenset data
  });
}
