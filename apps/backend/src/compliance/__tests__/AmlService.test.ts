/**
 * BIN-587 B3-aml: unit-tester for AmlService.
 *
 * Bruker en minimal pg.Pool-stub som oppfører seg som en in-memory
 * butikk for app_aml_rules + app_aml_red_flags. Dekker business-logikk
 * som ikke er trivielt dekt i router-integrasjonstester (re-review-
 * rejection, validering, rule-upsert side-effekter).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { AmlService, MANUAL_FLAG_SLUG } from "../AmlService.js";
import type { PaymentRequest, PaymentRequestService } from "../../payments/PaymentRequestService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface RuleRow {
  id: string; slug: string; label: string; severity: string;
  threshold_amount_cents: number | null; window_days: number | null;
  description: string | null; is_active: boolean;
  created_at: Date; updated_at: Date;
}

interface FlagRow {
  id: string; user_id: string; rule_slug: string; severity: string;
  status: string; reason: string; transaction_id: string | null;
  details: Record<string, unknown> | null;
  opened_by: string | null; reviewed_by: string | null;
  reviewed_at: Date | null; review_outcome: string | null;
  review_note: string | null; created_at: Date; updated_at: Date;
}

interface Store {
  rules: Map<string, RuleRow>; // keyed by slug
  flags: Map<string, FlagRow>; // keyed by id
}

function newStore(): Store {
  return { rules: new Map(), flags: new Map() };
}

interface CategoryAggRow {
  slug: string;
  label: string;
  severity: string;
  description: string | null;
  cnt: number;
  open_cnt: number;
}

function runQuery(store: Store, sql: string, params: unknown[] = []): { rows: Array<RuleRow | FlagRow | { status: string } | { id: string } | CategoryAggRow>; rowCount: number } {
  const trimmed = sql.trim();
  const isRules = sql.includes("app_aml_rules");
  const isFlags = sql.includes("app_aml_red_flags");

  if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK") ||
      trimmed.startsWith("CREATE") || trimmed.startsWith("CREATE SCHEMA")) {
    return { rows: [], rowCount: 0 };
  }

  // BIN-650 aggregat-CTE: WITH flag_counts AS (...) SELECT ... FULL OUTER JOIN
  // Bruker slug fra rules + flags for å dekke (a) aktive rules uten flag,
  // (b) flags med slug som ikke er i rules-katalogen (soft-disabled/manual).
  if (trimmed.startsWith("WITH flag_counts")) {
    let fromFilter: number | null = null;
    let toFilter: number | null = null;
    let pIdx = 0;
    if (sql.includes("created_at >= $")) {
      fromFilter = Date.parse(params[pIdx++] as string);
    }
    if (sql.includes("created_at <= $")) {
      toFilter = Date.parse(params[pIdx++] as string);
    }
    const flagsInWindow = [...store.flags.values()].filter((f) => {
      const ms = f.created_at.getTime();
      if (fromFilter !== null && ms < fromFilter) return false;
      if (toFilter !== null && ms > toFilter) return false;
      return true;
    });
    const bySlug = new Map<string, { cnt: number; open_cnt: number; observed_severity: string }>();
    for (const f of flagsInWindow) {
      const agg = bySlug.get(f.rule_slug) ?? { cnt: 0, open_cnt: 0, observed_severity: f.severity };
      agg.cnt += 1;
      if (f.status === "OPEN") agg.open_cnt += 1;
      // Emulerer MAX(severity) — alfabetisk for enkelthet (samsvarer med testene vi trenger).
      if (f.severity > agg.observed_severity) agg.observed_severity = f.severity;
      bySlug.set(f.rule_slug, agg);
    }
    const result: CategoryAggRow[] = [];
    // Alle aktive rules (med count fra flags eller 0).
    for (const rule of store.rules.values()) {
      if (!rule.is_active) continue;
      const agg = bySlug.get(rule.slug);
      result.push({
        slug: rule.slug,
        label: rule.label,
        severity: rule.severity,
        description: rule.description,
        cnt: agg?.cnt ?? 0,
        open_cnt: agg?.open_cnt ?? 0,
      });
    }
    // Flags med slug som IKKE er i aktive rules.
    const activeSlugs = new Set(
      [...store.rules.values()].filter((r) => r.is_active).map((r) => r.slug),
    );
    for (const [slug, agg] of bySlug) {
      if (activeSlugs.has(slug)) continue;
      result.push({
        slug,
        label: slug,
        severity: agg.observed_severity,
        description: null,
        cnt: agg.cnt,
        open_cnt: agg.open_cnt,
      });
    }
    result.sort((a, b) => a.slug.localeCompare(b.slug));
    return { rows: result, rowCount: result.length };
  }

  if (trimmed.startsWith("SELECT") && isRules) {
    const rules = [...store.rules.values()].sort((a, b) => a.slug.localeCompare(b.slug));
    return { rows: rules, rowCount: rules.length };
  }

  if (trimmed.startsWith("INSERT") && isRules) {
    const [id, slug, label, severity, threshold, windowDays, description, isActive] = params as [
      string, string, string, string, number | null, number | null, string | null, boolean
    ];
    const now = new Date();
    const existing = store.rules.get(slug);
    if (existing && sql.includes("ON CONFLICT")) {
      store.rules.set(slug, {
        ...existing, label, severity, threshold_amount_cents: threshold,
        window_days: windowDays, description, is_active: isActive, updated_at: now,
      });
    } else {
      store.rules.set(slug, {
        id, slug, label, severity, threshold_amount_cents: threshold,
        window_days: windowDays, description, is_active: isActive,
        created_at: now, updated_at: now,
      });
    }
    return { rows: [], rowCount: 1 };
  }

  if (trimmed.startsWith("UPDATE") && isRules) {
    // Soft-disable: UPDATE rules SET is_active=false WHERE slug <> ALL($1)
    const [keepSlugs] = params as [string[]];
    let count = 0;
    for (const [slug, row] of store.rules) {
      if (!keepSlugs.includes(slug) && row.is_active) {
        store.rules.set(slug, { ...row, is_active: false, updated_at: new Date() });
        count++;
      }
    }
    return { rows: [], rowCount: count };
  }

  if (trimmed.startsWith("SELECT") && isFlags) {
    if (sql.includes("FOR UPDATE")) {
      const [id] = params as [string];
      const r = store.flags.get(id);
      return { rows: r ? [{ status: r.status }] : [], rowCount: r ? 1 : 0 };
    }
    if (sql.includes("WHERE id = $1")) {
      const [id] = params as [string];
      const r = store.flags.get(id);
      return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
    }
    let list = [...store.flags.values()];
    // Parse WHERE-filter (lite robust, men holder for testene)
    let pIdx = 0;
    if (sql.includes("status = $")) list = list.filter((f) => f.status === params[pIdx++]);
    if (sql.includes("severity = $")) list = list.filter((f) => f.severity === params[pIdx++]);
    if (sql.includes("user_id = $")) list = list.filter((f) => f.user_id === params[pIdx++]);
    const limit = params[params.length - 1] as number;
    list = list.slice(0, limit);
    return { rows: list, rowCount: list.length };
  }

  if (trimmed.startsWith("INSERT") && isFlags) {
    const [id, userId, ruleSlug, severity, reason, transactionId, detailsJson, openedBy] = params as [
      string, string, string, string, string, string | null, string | null, string | null
    ];
    const now = new Date();
    const row: FlagRow = {
      id, user_id: userId, rule_slug: ruleSlug, severity,
      status: "OPEN", reason, transaction_id: transactionId,
      details: detailsJson ? (JSON.parse(detailsJson) as Record<string, unknown>) : null,
      opened_by: openedBy, reviewed_by: null, reviewed_at: null,
      review_outcome: null, review_note: null,
      created_at: now, updated_at: now,
    };
    store.flags.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (trimmed.startsWith("UPDATE") && isFlags) {
    const [id, outcome, reviewerId, note] = params as [string, string, string, string];
    const f = store.flags.get(id);
    if (!f || f.status !== "OPEN") return { rows: [], rowCount: 0 };
    const updated: FlagRow = {
      ...f, status: outcome, review_outcome: outcome,
      reviewed_by: reviewerId, reviewed_at: new Date(),
      review_note: note, updated_at: new Date(),
    };
    store.flags.set(id, updated);
    return { rows: [updated], rowCount: 1 };
  }

  throw new Error(`unhandled SQL: ${trimmed.slice(0, 120)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
        release() {},
      };
    },
    async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
  };
  return pool as unknown as Pool;
}

interface PaymentSpy {
  calls: Array<{ userId?: string; minAmountCents?: number; status?: string }>;
  toReturn: PaymentRequest[];
}

function makePaymentSvc(spy: PaymentSpy): PaymentRequestService {
  return {
    async listPending(options: { userId?: string; minAmountCents?: number; status?: string }): Promise<PaymentRequest[]> {
      spy.calls.push({ userId: options.userId, minAmountCents: options.minAmountCents, status: options.status });
      return spy.toReturn;
    },
  } as unknown as PaymentRequestService;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-587 B3-aml: upsertRules oppretter nye + oppdaterer eksisterende", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await svc.upsertRules([
    { slug: "high-stake", label: "High stake threshold", severity: "HIGH", thresholdAmountCents: 100000 },
    { slug: "repeat-deposit", label: "Repeat deposit", severity: "MEDIUM", windowDays: 1 },
  ]);
  const rules = await svc.listRules();
  assert.equal(rules.length, 2);
  const highStake = rules.find((r) => r.slug === "high-stake")!;
  assert.equal(highStake.severity, "HIGH");
  assert.equal(highStake.thresholdAmountCents, 100000);
  assert.equal(highStake.isActive, true);
});

test("BIN-587 B3-aml: upsertRules soft-disabler regler som ikke er i input", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await svc.upsertRules([
    { slug: "rule-a", label: "Rule A", severity: "LOW" },
    { slug: "rule-b", label: "Rule B", severity: "MEDIUM" },
  ]);
  // Oppdater med bare rule-a — rule-b skal bli soft-disabled.
  await svc.upsertRules([{ slug: "rule-a", label: "Rule A", severity: "LOW" }]);
  const rules = await svc.listRules();
  const byB = rules.find((r) => r.slug === "rule-b")!;
  assert.equal(byB.isActive, false);
  const byA = rules.find((r) => r.slug === "rule-a")!;
  assert.equal(byA.isActive, true);
});

test("BIN-587 B3-aml: upsertRules avviser 'manual' som reservert slug", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await assert.rejects(
    () => svc.upsertRules([{ slug: MANUAL_FLAG_SLUG, label: "x", severity: "LOW" }]),
    (err: unknown) => err instanceof DomainError && /reservert/.test(err.message)
  );
});

test("BIN-587 B3-aml: upsertRules avviser ugyldig slug-format", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await assert.rejects(
    () => svc.upsertRules([{ slug: "has space", label: "x", severity: "LOW" }]),
    (err: unknown) => err instanceof DomainError && /rule-slug/.test(err.message)
  );
});

test("BIN-587 B3-aml: upsertRules avviser ugyldig severity", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await assert.rejects(
    () => svc.upsertRules([{ slug: "ok", label: "x", severity: "NUCLEAR" as unknown as "LOW" }]),
    (err: unknown) => err instanceof DomainError && /severity/.test(err.message)
  );
});

test("BIN-587 B3-aml: upsertRules avviser negativ threshold", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await assert.rejects(
    () => svc.upsertRules([{ slug: "ok", label: "x", severity: "LOW", thresholdAmountCents: -1 }]),
    (err: unknown) => err instanceof DomainError && /threshold/.test(err.message)
  );
});

test("BIN-587 B3-aml: createRedFlag defaulter til 'manual' slug hvis ikke oppgitt", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  const flag = await svc.createRedFlag({
    userId: "p-1",
    severity: "HIGH",
    reason: "Mistenkelig aktivitet",
    openedBy: "admin-1",
  });
  assert.equal(flag.ruleSlug, MANUAL_FLAG_SLUG);
  assert.equal(flag.status, "OPEN");
  assert.equal(flag.severity, "HIGH");
});

test("BIN-587 B3-aml: createRedFlag persist details som JSON", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  const flag = await svc.createRedFlag({
    userId: "p-1",
    severity: "MEDIUM",
    reason: "test",
    details: { ip: "10.0.0.1", matches: 5 },
    openedBy: null,
  });
  assert.deepEqual(flag.details, { ip: "10.0.0.1", matches: 5 });
});

test("BIN-587 B3-aml: createRedFlag avviser tom reason", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await assert.rejects(
    () => svc.createRedFlag({ userId: "p-1", severity: "LOW", reason: "  ", openedBy: null }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-587 B3-aml: reviewRedFlag setter outcome + reviewedBy + reviewedAt", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  const flag = await svc.createRedFlag({ userId: "p-1", severity: "HIGH", reason: "test", openedBy: "admin-1" });
  const reviewed = await svc.reviewRedFlag({
    flagId: flag.id,
    reviewerId: "admin-2",
    outcome: "DISMISSED",
    note: "Verified false positive",
  });
  assert.equal(reviewed.status, "DISMISSED");
  assert.equal(reviewed.reviewOutcome, "DISMISSED");
  assert.equal(reviewed.reviewedBy, "admin-2");
  assert.equal(reviewed.reviewNote, "Verified false positive");
  assert.ok(reviewed.reviewedAt);
});

test("BIN-587 B3-aml: reviewRedFlag avviser re-review (kun OPEN → *)", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  const flag = await svc.createRedFlag({ userId: "p-1", severity: "HIGH", reason: "test", openedBy: null });
  await svc.reviewRedFlag({ flagId: flag.id, reviewerId: "admin-1", outcome: "REVIEWED", note: "ok" });
  await assert.rejects(
    () => svc.reviewRedFlag({ flagId: flag.id, reviewerId: "admin-2", outcome: "ESCALATED", note: "escalate" }),
    (err: unknown) => err instanceof DomainError && err.code === "AML_FLAG_ALREADY_REVIEWED"
  );
});

test("BIN-587 B3-aml: reviewRedFlag avviser ukjent flagId", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await assert.rejects(
    () => svc.reviewRedFlag({ flagId: "ghost", reviewerId: "admin-1", outcome: "REVIEWED", note: "x" }),
    (err: unknown) => err instanceof DomainError && err.code === "AML_FLAG_NOT_FOUND"
  );
});

test("BIN-587 B3-aml: reviewRedFlag avviser ugyldig outcome", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  const flag = await svc.createRedFlag({ userId: "p-1", severity: "HIGH", reason: "test", openedBy: null });
  await assert.rejects(
    () => svc.reviewRedFlag({ flagId: flag.id, reviewerId: "admin-1", outcome: "DELETED" as unknown as "REVIEWED", note: "x" }),
    (err: unknown) => err instanceof DomainError && /outcome/.test(err.message)
  );
});

test("BIN-587 B3-aml: listTransactionsForReview delegerer til PaymentRequestService for alle statuser", async () => {
  const spy: PaymentSpy = { calls: [], toReturn: [] };
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc(spy));
  await svc.listTransactionsForReview({
    userId: "p-1",
    from: "2026-04-01T00:00:00Z",
    to: "2026-04-30T23:59:59Z",
    minAmountCents: 100000,
    limit: 50,
  });
  // Skal kalle én gang per status: PENDING, ACCEPTED, REJECTED
  assert.equal(spy.calls.length, 3);
  const statuses = spy.calls.map((c) => c.status).sort();
  assert.deepEqual(statuses, ["ACCEPTED", "PENDING", "REJECTED"]);
  assert.equal(spy.calls[0]!.userId, "p-1");
  assert.equal(spy.calls[0]!.minAmountCents, 100000);
});

test("BIN-587 B3-aml: scanNow returnerer null-resultat med active rule-slugs listet", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await svc.upsertRules([
    { slug: "rule-a", label: "A", severity: "LOW", isActive: true },
    { slug: "rule-b", label: "B", severity: "HIGH", isActive: false }, // inactive — ignoreres
  ]);
  const result = await svc.scanNow("admin-1");
  assert.equal(result.scanned, 0);
  assert.equal(result.flagsCreated, 0);
  assert.deepEqual(result.ruleSlugsEvaluated, ["rule-a"]);
});

test("BIN-587 B3-aml: listRedFlags filtrerer på userId", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await svc.createRedFlag({ userId: "p-1", severity: "LOW", reason: "a", openedBy: null });
  await svc.createRedFlag({ userId: "p-2", severity: "HIGH", reason: "b", openedBy: null });
  const forP1 = await svc.listRedFlags({ userId: "p-1" });
  assert.equal(forP1.length, 1);
  assert.equal(forP1[0]!.userId, "p-1");
});

// ── BIN-650: aggregateCategoryCounts ─────────────────────────────────────

test("BIN-650: aggregateCategoryCounts returnerer alle aktive rules med count=0 når ingen flags", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await svc.upsertRules([
    { slug: "high-amount", label: "High amount", severity: "HIGH", description: "over terskel" },
    { slug: "high-velocity", label: "High velocity", severity: "MEDIUM" },
  ]);
  const rows = await svc.aggregateCategoryCounts();
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.slug, "high-amount");
  assert.equal(rows[0]!.label, "High amount");
  assert.equal(rows[0]!.severity, "HIGH");
  assert.equal(rows[0]!.description, "over terskel");
  assert.equal(rows[0]!.count, 0);
  assert.equal(rows[0]!.openCount, 0);
  assert.equal(rows[1]!.slug, "high-velocity");
});

test("BIN-650: aggregateCategoryCounts teller flags per slug + skiller open", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await svc.upsertRules([
    { slug: "high-amount", label: "High amount", severity: "HIGH" },
  ]);
  // 3 flags på high-amount: 2 OPEN, 1 REVIEWED.
  const f1 = await svc.createRedFlag({ userId: "p-1", ruleSlug: "high-amount", severity: "HIGH", reason: "a", openedBy: null });
  await svc.createRedFlag({ userId: "p-2", ruleSlug: "high-amount", severity: "HIGH", reason: "b", openedBy: null });
  await svc.createRedFlag({ userId: "p-3", ruleSlug: "high-amount", severity: "HIGH", reason: "c", openedBy: null });
  await svc.reviewRedFlag({ flagId: f1.id, reviewerId: "admin-1", outcome: "REVIEWED", note: "ok" });

  const rows = await svc.aggregateCategoryCounts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.count, 3);
  assert.equal(rows[0]!.openCount, 2);
});

test("BIN-650: aggregateCategoryCounts inkluderer 'manual'-slug selv om den ikke er i rules", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  // Ingen rules — kun et manuelt flag.
  await svc.createRedFlag({ userId: "p-1", severity: "HIGH", reason: "mistenkelig", openedBy: "admin-1" });
  const rows = await svc.aggregateCategoryCounts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.slug, "manual");
  assert.equal(rows[0]!.label, "manual");
  assert.equal(rows[0]!.description, null);
  assert.equal(rows[0]!.count, 1);
  assert.equal(rows[0]!.openCount, 1);
});

test("BIN-650: aggregateCategoryCounts ignorerer flags utenfor [from, to]-vinduet", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await svc.upsertRules([
    { slug: "rule-a", label: "Rule A", severity: "LOW" },
  ]);
  const f1 = await svc.createRedFlag({ userId: "p-1", ruleSlug: "rule-a", severity: "LOW", reason: "r", openedBy: null });
  // Manipulerer created_at direkte i stub-storen for å simulere gammel rad.
  const row = store.flags.get(f1.id)!;
  row.created_at = new Date("2026-01-01T00:00:00Z");
  store.flags.set(f1.id, row);

  // Vindu som ekskluderer januar-raden.
  const rows = await svc.aggregateCategoryCounts({
    from: "2026-04-01T00:00:00Z",
    to: "2026-04-30T23:59:59Z",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.count, 0);
});

test("BIN-650: aggregateCategoryCounts avviser ugyldig from", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await assert.rejects(
    () => svc.aggregateCategoryCounts({ from: "ikke-iso" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-650: aggregateCategoryCounts avviser from > to", async () => {
  const store = newStore();
  const svc = AmlService.forTesting(makePool(store), makePaymentSvc({ calls: [], toReturn: [] }));
  await assert.rejects(
    () => svc.aggregateCategoryCounts({
      from: "2026-05-01T00:00:00Z",
      to: "2026-04-01T00:00:00Z",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});
