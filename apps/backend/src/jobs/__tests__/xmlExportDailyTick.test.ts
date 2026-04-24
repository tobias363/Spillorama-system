/**
 * Tester for `xml-export-daily` cron-job.
 *
 * Dekker:
 *   - Før runAtHourLocal → no-op
 *   - Samme date-key to ganger → andre kall er no-op
 *   - Ingen agenter i listDistinctAgentUserIds → no-op
 *   - Per-agent: generateDailyXmlForAgent kalles én gang per agent
 *   - Per-agent error ruller ikke tilbake andre agenter
 *   - 42P01 fra store → soft-no-op
 *   - alwaysRun-override kjører uavhengig av hour/date-key
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createXmlExportDailyTickJob } from "../xmlExportDailyTick.js";
import type {
  WithdrawXmlExportService,
  GenerateBatchResult,
  WithdrawExportRow,
} from "../../admin/WithdrawXmlExportService.js";
import type { AccountingEmailService } from "../../admin/AccountingEmailService.js";

interface Recorder {
  generateCalls: Array<string | null>;
  sendCalls: string[];
  generateBehavior?: (agentId: string | null) => Promise<GenerateBatchResult>;
  listBehavior?: () => Promise<Array<string | null>>;
}

function makeRow(): WithdrawExportRow {
  return {
    id: "wr-x",
    userId: "u",
    hallId: "h",
    amountCents: 10000,
    bankAccountNumber: "1",
    bankName: "B",
    accountHolder: "H",
    acceptedAt: "2026-04-24T09:00:00Z",
    createdAt: "2026-04-24T08:00:00Z",
  };
}

function makeMocks(rec: Recorder) {
  const xmlExportService: WithdrawXmlExportService = {
    listDistinctAgentUserIds: async () => {
      if (rec.listBehavior) return rec.listBehavior();
      return ["agent-1", "agent-2"];
    },
    generateDailyXmlForAgent: async (agentId: string | null): Promise<GenerateBatchResult> => {
      rec.generateCalls.push(agentId);
      if (rec.generateBehavior) return rec.generateBehavior(agentId);
      return {
        batch: {
          id: `batch-${agentId ?? "none"}`,
          agentUserId: agentId,
          generatedAt: "2026-04-24T23:00:00.000Z",
          xmlFilePath: "/tmp/x.xml",
          emailSentAt: null,
          recipientEmails: [],
          withdrawRequestCount: 1,
        },
        rows: [makeRow()],
        xmlContent: "<xml/>",
      };
    },
  } as unknown as WithdrawXmlExportService;

  const accountingEmailService: AccountingEmailService = {
    sendXmlBatch: async (batchId: string) => {
      rec.sendCalls.push(batchId);
      return {
        sent: true,
        skipped: false,
        deliveredTo: ["a@x.com"],
        failedFor: [],
        batch: null,
      };
    },
  } as unknown as AccountingEmailService;

  return { xmlExportService, accountingEmailService };
}

// ─── Guards ─────────────────────────────────────────────────────────────

test("xml-export-daily: før runAtHourLocal → waiting note, ingen kall", async () => {
  const rec: Recorder = { generateCalls: [], sendCalls: [] };
  const { xmlExportService, accountingEmailService } = makeMocks(rec);
  const job = createXmlExportDailyTickJob({
    xmlExportService,
    accountingEmailService,
    runAtHourLocal: 23,
  });
  // Klokka 10:00 — før 23
  const morning = new Date("2026-04-24T10:00:00").getTime();
  const result = await job(morning);
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /waiting for 23:00/);
  assert.equal(rec.generateCalls.length, 0);
});

test("xml-export-daily: samme date-key to ganger → andre kall er no-op", async () => {
  const rec: Recorder = { generateCalls: [], sendCalls: [] };
  const { xmlExportService, accountingEmailService } = makeMocks(rec);
  const job = createXmlExportDailyTickJob({
    xmlExportService,
    accountingEmailService,
    runAtHourLocal: 0, // tillat kjøring fra midnatt
  });
  const t1 = new Date("2026-04-24T23:00:00").getTime();
  const t2 = new Date("2026-04-24T23:15:00").getTime();
  await job(t1);
  const first = rec.generateCalls.length;
  assert.ok(first > 0, "første kall skal prosessere");

  await job(t2);
  assert.equal(rec.generateCalls.length, first, "andre kall samme dag skal være no-op");
});

test("xml-export-daily: alwaysRun=true overstyrer hour og date-key", async () => {
  const rec: Recorder = { generateCalls: [], sendCalls: [] };
  const { xmlExportService, accountingEmailService } = makeMocks(rec);
  const job = createXmlExportDailyTickJob({
    xmlExportService,
    accountingEmailService,
    runAtHourLocal: 23,
    alwaysRun: true,
  });
  const morning = new Date("2026-04-24T10:00:00").getTime();
  await job(morning);
  assert.ok(rec.generateCalls.length > 0, "alwaysRun=true skal kjøre tross time 10");
});

// ─── Agent-iterasjon ────────────────────────────────────────────────────

test("xml-export-daily: genererer én batch per agent + sender e-post for hver", async () => {
  const rec: Recorder = { generateCalls: [], sendCalls: [] };
  const { xmlExportService, accountingEmailService } = makeMocks(rec);
  const job = createXmlExportDailyTickJob({
    xmlExportService,
    accountingEmailService,
    alwaysRun: true,
  });
  const result = await job(Date.now());
  assert.deepEqual(rec.generateCalls, ["agent-1", "agent-2"]);
  assert.deepEqual(rec.sendCalls, ["batch-agent-1", "batch-agent-2"]);
  assert.equal(result.itemsProcessed, 2);
});

test("xml-export-daily: 0 rader for en agent → ingen e-post for den agenten", async () => {
  const rec: Recorder = { generateCalls: [], sendCalls: [] };
  const { xmlExportService, accountingEmailService } = makeMocks(rec);
  rec.generateBehavior = async (agentId) => ({
    batch: {
      id: "",
      agentUserId: agentId,
      generatedAt: "2026-04-24T23:00:00.000Z",
      xmlFilePath: "",
      emailSentAt: null,
      recipientEmails: [],
      withdrawRequestCount: 0,
    },
    rows: [], // 0 rader
    xmlContent: "",
  });
  const job = createXmlExportDailyTickJob({
    xmlExportService,
    accountingEmailService,
    alwaysRun: true,
  });
  await job(Date.now());
  // generateDailyXmlForAgent kalles men sendXmlBatch gjør det ikke.
  assert.equal(rec.generateCalls.length, 2);
  assert.equal(rec.sendCalls.length, 0);
});

test("xml-export-daily: per-agent error stopper ikke resten", async () => {
  const rec: Recorder = { generateCalls: [], sendCalls: [] };
  const { xmlExportService, accountingEmailService } = makeMocks(rec);
  rec.generateBehavior = async (agentId) => {
    if (agentId === "agent-1") throw new Error("per-agent-fault");
    return {
      batch: {
        id: `batch-${agentId ?? "none"}`,
        agentUserId: agentId,
        generatedAt: "2026-04-24T23:00:00.000Z",
        xmlFilePath: "/tmp/x.xml",
        emailSentAt: null,
        recipientEmails: [],
        withdrawRequestCount: 1,
      },
      rows: [makeRow()],
      xmlContent: "<xml/>",
    };
  };
  const job = createXmlExportDailyTickJob({
    xmlExportService,
    accountingEmailService,
    alwaysRun: true,
  });
  const result = await job(Date.now());
  // agent-2 skal fortsatt lykkes
  assert.deepEqual(rec.sendCalls, ["batch-agent-2"]);
  assert.equal(result.itemsProcessed, 1);
  assert.match(result.note ?? "", /errors=1/);
});

// ─── Ingen agenter / tabeller mangler ───────────────────────────────────

test("xml-export-daily: tom agent-liste → no-op", async () => {
  const rec: Recorder = { generateCalls: [], sendCalls: [], listBehavior: async () => [] };
  const { xmlExportService, accountingEmailService } = makeMocks(rec);
  const job = createXmlExportDailyTickJob({
    xmlExportService,
    accountingEmailService,
    alwaysRun: true,
  });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /no accepted bank withdrawals/);
});

test("xml-export-daily: 42P01 fra listDistinctAgentUserIds → soft-no-op", async () => {
  const rec: Recorder = {
    generateCalls: [],
    sendCalls: [],
    listBehavior: async () => {
      const err = new Error("undefined table");
      (err as { code?: string }).code = "42P01";
      throw err;
    },
  };
  const { xmlExportService, accountingEmailService } = makeMocks(rec);
  const job = createXmlExportDailyTickJob({
    xmlExportService,
    accountingEmailService,
    alwaysRun: true,
  });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /xml tables missing/);
});
