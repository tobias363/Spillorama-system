/**
 * Unit-tester for WithdrawXmlExportService.
 *
 * Dekker:
 *   - XML-struktur + korrekte attributter/felter (buildXml)
 *   - XML-escaping av tegn som <, >, &, ', "
 *   - generateDailyXmlForAgent: 0 rader → tom batch-stub, ingen DB-skriving
 *   - generateDailyXmlForAgent: multi-hall-rader for én agent samles i én XML
 *   - generateDailyXmlForAgent: flytter status ACCEPTED → EXPORTED
 *   - markBatchEmailSent: oppdaterer kolonner + mapper tilbake
 *   - listBatches / getBatch: basic queries
 *   - Ingen fil skrives når skipFileWrite=true
 *
 * Bruker stub-Pool som lagrer sekvensen av queries (like pattern som
 * CloseDayService.test.ts). Dette lar oss verifisere SQL-kall uten
 * å trenge en reell Postgres.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  WithdrawXmlExportService,
  buildXml,
  type WithdrawExportRow,
} from "./WithdrawXmlExportService.js";
import { DomainError } from "../game/BingoEngine.js";

interface RecordedQuery {
  sql: string;
  params: unknown[] | undefined;
}

interface QueryMapper {
  /** Returner rows når sql matcher predicate; ellers undefined (passer videre). */
  (query: RecordedQuery): unknown[] | undefined;
}

function makePool(handlers: QueryMapper[]) {
  const recorded: RecordedQuery[] = [];

  async function query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    const rq = { sql, params };
    recorded.push(rq);
    for (const h of handlers) {
      const rows = h(rq);
      if (rows !== undefined) return { rows };
    }
    return { rows: [] };
  }

  const mockClient = {
    query,
    release: () => {},
  };

  return {
    pool: {
      query,
      connect: async () => mockClient,
    },
    recorded,
  };
}

function makeRow(overrides: Partial<WithdrawExportRow> = {}): WithdrawExportRow {
  // NB: bruk `in overrides` fremfor `??` slik at null-verdier kan overstyre
  // default (trengs for å teste NULL-felter i XML-rendering).
  return {
    id: overrides.id ?? "wr-1",
    userId: overrides.userId ?? "user-1",
    hallId: "hallId" in overrides ? overrides.hallId! : "hall-a",
    amountCents: overrides.amountCents ?? 10000,
    bankAccountNumber:
      "bankAccountNumber" in overrides ? overrides.bankAccountNumber! : "12345678901",
    bankName: "bankName" in overrides ? overrides.bankName! : "DNB",
    accountHolder:
      "accountHolder" in overrides ? overrides.accountHolder! : "Kari Nordmann",
    acceptedAt: "acceptedAt" in overrides ? overrides.acceptedAt! : "2026-04-24T10:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-04-24T09:00:00.000Z",
  };
}

// ─── buildXml() rene unit-tester (ingen DB) ──────────────────────────────

test("buildXml: inkluderer batchId, agentUserId, generatedAt, count på root", () => {
  const xml = buildXml(
    "batch-abc",
    "agent-xyz",
    "2026-04-24T21:00:00.000Z",
    [makeRow({ id: "wr-1" })]
  );
  assert.match(xml, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<withdrawals /);
  assert.match(xml, /batchId="batch-abc"/);
  assert.match(xml, /agentUserId="agent-xyz"/);
  assert.match(xml, /generatedAt="2026-04-24T21:00:00\.000Z"/);
  assert.match(xml, /count="1"/);
  assert.match(xml, /<\/withdrawals>/);
});

test("buildXml: hver withdrawal har amountCents + amountMajor beregnet", () => {
  const xml = buildXml("b", null, "2026-04-24T21:00:00.000Z", [
    makeRow({ amountCents: 12500 }),
  ]);
  assert.match(xml, /amountCents="12500"/);
  assert.match(xml, /amountMajor="125\.00"/);
});

test("buildXml: escaper <, >, &, ', \" i alle tekst-felter", () => {
  const xml = buildXml("b", null, "2026-04-24T21:00:00.000Z", [
    makeRow({
      id: "wr-<evil>&stuff",
      accountHolder: "Ola \"Spesial\" O'Brien <script>alert(1)</script>",
      bankName: "DNB & Co",
    }),
  ]);
  assert.ok(!xml.includes("<script>"), "raw <script> tag må escapes");
  assert.match(xml, /id="wr-&lt;evil&gt;&amp;stuff"/);
  assert.match(xml, /Ola &quot;Spesial&quot; O&apos;Brien/);
  assert.match(xml, /DNB &amp; Co/);
});

test("buildXml: 0 rader gir gyldig XML med count=0 + ingen withdrawal-elementer", () => {
  const xml = buildXml("b", null, "2026-04-24T21:00:00.000Z", []);
  assert.match(xml, /count="0"/);
  assert.ok(!xml.includes("<withdrawal "), "tom batch må ikke ha withdrawal-elementer");
});

test("buildXml: NULL-felter ender opp som tomme strenger (ikke 'null')", () => {
  const xml = buildXml("b", null, "2026-04-24T21:00:00.000Z", [
    makeRow({ bankAccountNumber: null, bankName: null, accountHolder: null }),
  ]);
  assert.match(xml, /<bankAccountNumber><\/bankAccountNumber>/);
  assert.match(xml, /<bankName><\/bankName>/);
  assert.match(xml, /<accountHolder><\/accountHolder>/);
  assert.ok(!xml.includes(">null<"), "NULL-felter må ikke bli literal 'null'");
});

test("buildXml: multi-rader beholder rekkefølge fra input-array", () => {
  const xml = buildXml("b", "agent-1", "2026-04-24T21:00:00.000Z", [
    makeRow({ id: "first", amountCents: 100 }),
    makeRow({ id: "second", amountCents: 200 }),
    makeRow({ id: "third", amountCents: 300 }),
  ]);
  const posFirst = xml.indexOf(`id="first"`);
  const posSecond = xml.indexOf(`id="second"`);
  const posThird = xml.indexOf(`id="third"`);
  assert.ok(posFirst < posSecond && posSecond < posThird, "rader skal stå i input-rekkefølge");
});

// ─── generateDailyXmlForAgent: 0 rader-path ──────────────────────────────

test("generateDailyXmlForAgent: 0 ACCEPTED rader → tom batch-stub, ingen INSERT/UPDATE", async () => {
  const { pool, recorded } = makePool([
    (q) => {
      if (q.sql.includes(`"app_withdraw_requests"`) && q.sql.includes("FOR UPDATE")) {
        return []; // 0 rader
      }
      return undefined;
    },
  ]);
  const svc = WithdrawXmlExportService.forTesting(pool as never, {
    skipFileWrite: true,
    nowMs: () => new Date("2026-04-24T21:00:00Z").getTime(),
  });
  const result = await svc.generateDailyXmlForAgent("agent-1");
  assert.equal(result.rows.length, 0);
  assert.equal(result.batch.withdrawRequestCount, 0);
  assert.equal(result.xmlContent, "");
  // Sørg for at vi ikke har INSERT'et batch eller UPDATE'et requests.
  const inserts = recorded.filter((r) => r.sql.includes("INSERT INTO"));
  const updates = recorded.filter((r) => r.sql.includes("SET status = 'EXPORTED'"));
  assert.equal(inserts.length, 0, "INSERT skal ikke skje ved 0 rader");
  assert.equal(updates.length, 0, "UPDATE skal ikke skje ved 0 rader");
});

// ─── generateDailyXmlForAgent: multi-hall for én agent ───────────────────

test("generateDailyXmlForAgent: multi-hall-requests for én agent samles i én XML", async () => {
  const rowsFromDb = [
    { id: "wr-1", user_id: "u1", hall_id: "hall-a", amount_cents: 10000, bank_account_number: "111", bank_name: "DNB", account_holder: "A", accepted_at: "2026-04-24T09:00:00Z", created_at: "2026-04-24T08:00:00Z" },
    { id: "wr-2", user_id: "u2", hall_id: "hall-b", amount_cents: 20000, bank_account_number: "222", bank_name: "Nordea", account_holder: "B", accepted_at: "2026-04-24T09:30:00Z", created_at: "2026-04-24T08:30:00Z" },
    { id: "wr-3", user_id: "u3", hall_id: "hall-c", amount_cents: 30000, bank_account_number: "333", bank_name: "SpareBank1", account_holder: "C", accepted_at: "2026-04-24T10:00:00Z", created_at: "2026-04-24T09:00:00Z" },
  ];
  const batchRow = {
    id: "stub",
    agent_user_id: "agent-1",
    generated_at: "2026-04-24T21:00:00.000Z",
    xml_file_path: "/tmp/x.xml",
    email_sent_at: null,
    recipient_emails: [],
    withdraw_request_count: 3,
  };

  const { pool } = makePool([
    (q) => {
      if (q.sql.includes("FOR UPDATE")) return rowsFromDb;
      if (q.sql.includes("INSERT INTO") && q.sql.includes("app_xml_export_batches")) {
        return [batchRow];
      }
      return undefined;
    },
  ]);
  const svc = WithdrawXmlExportService.forTesting(pool as never, {
    skipFileWrite: true,
    nowMs: () => new Date("2026-04-24T21:00:00Z").getTime(),
  });
  const result = await svc.generateDailyXmlForAgent("agent-1");
  assert.equal(result.rows.length, 3, "tre rader fra tre forskjellige haller");
  assert.ok(result.xmlContent.includes(`id="wr-1"`));
  assert.ok(result.xmlContent.includes(`id="wr-2"`));
  assert.ok(result.xmlContent.includes(`id="wr-3"`));
  assert.ok(result.xmlContent.includes(`hallId="hall-a"`));
  assert.ok(result.xmlContent.includes(`hallId="hall-b"`));
  assert.ok(result.xmlContent.includes(`hallId="hall-c"`));
  // Alle rader skal være én XML med count="3"
  assert.match(result.xmlContent, /count="3"/);
  // Ingen withdrawal-element er splittet over flere batches
  const withdrawalCount = (result.xmlContent.match(/<withdrawal /g) ?? []).length;
  assert.equal(withdrawalCount, 3);
});

// ─── generateDailyXmlForAgent: status-flip ACCEPTED → EXPORTED ──────────

test("generateDailyXmlForAgent: utfører UPDATE fra ACCEPTED til EXPORTED med batch-id", async () => {
  const rowsFromDb = [
    { id: "wr-1", user_id: "u1", hall_id: "hall-a", amount_cents: 10000, bank_account_number: "111", bank_name: "DNB", account_holder: "A", accepted_at: "2026-04-24T09:00:00Z", created_at: "2026-04-24T08:00:00Z" },
  ];
  const batchRow = {
    id: "batch-generated-id",
    agent_user_id: "agent-1",
    generated_at: "2026-04-24T21:00:00.000Z",
    xml_file_path: "/tmp/x.xml",
    email_sent_at: null,
    recipient_emails: [],
    withdraw_request_count: 1,
  };

  const { pool, recorded } = makePool([
    (q) => {
      if (q.sql.includes("FOR UPDATE")) return rowsFromDb;
      if (q.sql.includes("INSERT INTO") && q.sql.includes("app_xml_export_batches")) {
        return [batchRow];
      }
      return undefined;
    },
  ]);
  const svc = WithdrawXmlExportService.forTesting(pool as never, {
    skipFileWrite: true,
    nowMs: () => new Date("2026-04-24T21:00:00Z").getTime(),
  });
  await svc.generateDailyXmlForAgent("agent-1");

  const updateQuery = recorded.find(
    (r) => r.sql.includes("UPDATE") && r.sql.includes("SET status = 'EXPORTED'")
  );
  assert.ok(updateQuery, "UPDATE til EXPORTED skal skje");
  assert.ok(
    Array.isArray((updateQuery!.params as unknown[])[0]),
    "første param er request-id-array"
  );
  const ids = (updateQuery!.params as unknown[])[0] as string[];
  assert.deepEqual(ids, ["wr-1"]);
});

// ─── markBatchEmailSent ──────────────────────────────────────────────────

test("markBatchEmailSent: oppdaterer email_sent_at + recipient_emails", async () => {
  const batchRow = {
    id: "b1",
    agent_user_id: "agent-1",
    generated_at: "2026-04-24T21:00:00.000Z",
    xml_file_path: "/tmp/x.xml",
    email_sent_at: "2026-04-24T21:01:00.000Z",
    recipient_emails: ["a@x.com", "b@y.com"],
    withdraw_request_count: 5,
  };
  const { pool, recorded } = makePool([
    (q) => {
      if (
        q.sql.includes("UPDATE") &&
        q.sql.includes("app_xml_export_batches") &&
        q.sql.includes("email_sent_at")
      ) {
        return [batchRow];
      }
      return undefined;
    },
  ]);
  const svc = WithdrawXmlExportService.forTesting(pool as never, {});
  const result = await svc.markBatchEmailSent("b1", ["a@x.com", "b@y.com"]);
  assert.deepEqual(result.recipientEmails, ["a@x.com", "b@y.com"]);
  assert.equal(result.emailSentAt, "2026-04-24T21:01:00.000Z");
  // Params: [id, sentAt, recipients[]]
  const upd = recorded.find(
    (r) => r.sql.includes("UPDATE") && r.sql.includes("app_xml_export_batches")
  );
  assert.ok(upd);
  assert.equal((upd!.params as unknown[])[0], "b1");
  assert.deepEqual((upd!.params as unknown[])[2], ["a@x.com", "b@y.com"]);
});

test("markBatchEmailSent: ukjent batch → XML_BATCH_NOT_FOUND", async () => {
  const { pool } = makePool([
    () => [], // alle queries returnerer tomt
  ]);
  const svc = WithdrawXmlExportService.forTesting(pool as never, {});
  await assert.rejects(
    () => svc.markBatchEmailSent("nope", ["x@y.com"]),
    (err: unknown) => err instanceof DomainError && err.code === "XML_BATCH_NOT_FOUND"
  );
});

// ─── listBatches + getBatch ─────────────────────────────────────────────

test("listBatches: støtter agentUserId=null-filter", async () => {
  const { pool, recorded } = makePool([
    (q) => {
      if (q.sql.includes("app_xml_export_batches") && q.sql.includes("IS NULL")) return [];
      return undefined;
    },
  ]);
  const svc = WithdrawXmlExportService.forTesting(pool as never, {});
  await svc.listBatches({ agentUserId: null });
  assert.ok(
    recorded.some((r) => r.sql.includes("IS NULL")),
    "agentUserId=null-filter skal bruke IS NULL"
  );
});

test("listBatches: uten filter kjører uten WHERE-clause", async () => {
  const { pool, recorded } = makePool([() => []]);
  const svc = WithdrawXmlExportService.forTesting(pool as never, {});
  await svc.listBatches({});
  const sel = recorded.find((r) => r.sql.includes("app_xml_export_batches"));
  assert.ok(sel);
  assert.ok(!sel!.sql.includes("WHERE"), "ingen filter → ingen WHERE-clause");
});

test("getBatch: ukjent id → XML_BATCH_NOT_FOUND", async () => {
  const { pool } = makePool([() => []]);
  const svc = WithdrawXmlExportService.forTesting(pool as never, {});
  await assert.rejects(
    () => svc.getBatch("nope"),
    (err: unknown) => err instanceof DomainError && err.code === "XML_BATCH_NOT_FOUND"
  );
});
