/**
 * GAP #10 + #12 (BACKEND_1TO1_GAP_AUDIT_2026-04-24 §1.5):
 * Integration-tester for admin deposit/withdraw history-endepunktene.
 *
 *   - GET /api/admin/deposits/history       (GAP #10)
 *   - GET /api/admin/withdrawals/history    (GAP #12)
 *
 * Dekker:
 *   - RBAC (ADMIN + HALL_OPERATOR + SUPPORT) — PLAYER blokkeres.
 *   - Hall-scope: HALL_OPERATOR auto-tvinges til egen hall, og kan
 *     ikke override via query-param.
 *   - Filter-kombinasjoner (status, fromDate/toDate, type, playerId).
 *   - Cursor-pagination + edge-cases (tom resultat, ugyldig cursor).
 *   - CSV-eksport (text/csv + UTF-8 BOM).
 *
 * Bruker en stub PaymentRequestService med deterministisk in-memory data.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPaymentRequestsRouter } from "../paymentRequests.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  ListHistoryOptions,
  ListHistoryResult,
  PaymentRequest,
  PaymentRequestKind,
  PaymentRequestService,
} from "../../payments/PaymentRequestService.js";

function makeUser(
  id: string,
  role: PublicAppUser["role"],
  hallId: string | null
): PublicAppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `wallet-${id}`,
    role,
    hallId,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  };
}

function makeRequest(
  id: string,
  overrides: Partial<PaymentRequest> & { kind: PaymentRequestKind }
): PaymentRequest {
  return {
    id,
    kind: overrides.kind,
    userId: overrides.userId ?? "player-1",
    walletId: overrides.walletId ?? "wallet-player-1",
    amountCents: overrides.amountCents ?? 1000,
    hallId: overrides.hallId ?? null,
    submittedBy: overrides.submittedBy ?? "player-1",
    status: overrides.status ?? "PENDING",
    rejectionReason: overrides.rejectionReason ?? null,
    acceptedBy: overrides.acceptedBy ?? null,
    acceptedAt: overrides.acceptedAt ?? null,
    rejectedBy: overrides.rejectedBy ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    walletTransactionId: overrides.walletTransactionId ?? null,
    destinationType:
      overrides.destinationType ?? (overrides.kind === "withdraw" ? "hall" : null),
    createdAt: overrides.createdAt ?? "2026-04-18T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-18T00:00:00Z",
  };
}

interface Spies {
  /** Hver listHistory-kall opptar argumentene (uten cursor) for assertions. */
  listHistoryCalls: ListHistoryOptions[];
}

async function withServer(
  users: Record<string, PublicAppUser>,
  records: PaymentRequest[],
  run: (baseUrl: string, spies: Spies) => Promise<void>
): Promise<void> {
  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const user = users[token];
      if (!user) throw new Error("UNAUTHORIZED");
      return user;
    },
  } as unknown as PlatformService;

  const listHistoryCalls: ListHistoryOptions[] = [];

  const paymentRequestService = {
    async listHistory(options: ListHistoryOptions = {}): Promise<ListHistoryResult> {
      listHistoryCalls.push(options);
      // Mock-implementasjonen filtrerer in-memory data — fokuset her er
      // at route-laget setter riktige options. Algorithm-ekvivalens med
      // ekte service er testet på service-nivå (PaymentRequestService.test.ts).
      const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
      let filtered = records.slice();
      if (options.kind) filtered = filtered.filter((r) => r.kind === options.kind);
      if (options.statuses && options.statuses.length) {
        filtered = filtered.filter((r) => options.statuses!.includes(r.status));
      }
      if (options.hallId) filtered = filtered.filter((r) => r.hallId === options.hallId);
      if (options.userId) filtered = filtered.filter((r) => r.userId === options.userId);
      if (options.destinationType) {
        filtered = filtered.filter((r) => r.destinationType === options.destinationType);
      }
      if (options.createdFrom) {
        filtered = filtered.filter((r) => r.createdAt >= options.createdFrom!);
      }
      if (options.createdTo) {
        filtered = filtered.filter((r) => r.createdAt <= options.createdTo!);
      }
      filtered.sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
      );
      // Naiv cursor: hvis cursor er satt og kan parses, skip alle rader
      // før (og inklusiv) cursor-iden. Tilstrekkelig til at vi kan teste
      // at route faktisk videreformidler cursor.
      if (options.cursor) {
        try {
          const decoded = Buffer.from(options.cursor, "base64url").toString("utf8");
          const idx = decoded.indexOf("|");
          if (idx > 0) {
            const cursorId = decoded.slice(idx + 1);
            const skipUntil = filtered.findIndex((r) => r.id === cursorId);
            if (skipUntil >= 0) {
              filtered = filtered.slice(skipUntil + 1);
            }
          }
        } catch {
          // ignorer — service-laget ville kastet, men her speiler vi bare bruk
        }
      }
      const items = filtered.slice(0, limit);
      const nextCursor =
        items.length === limit && filtered.length > limit && items[items.length - 1]
          ? Buffer.from(
              `${items[items.length - 1]!.createdAt}|${items[items.length - 1]!.id}`,
              "utf8"
            ).toString("base64url")
          : null;
      return { items, nextCursor };
    },
  } as unknown as PaymentRequestService;

  const app = express();
  app.use(express.json());
  app.use(
    createPaymentRequestsRouter({
      platformService,
      paymentRequestService,
      emitWalletRoomUpdates: async () => {},
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl, { listHistoryCalls });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function get(
  baseUrl: string,
  path: string,
  token: string
): Promise<{ status: number; json: unknown; text: string; contentType: string | null }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: res.status,
    json,
    text,
    contentType: res.headers.get("content-type"),
  };
}

// Konstantsett vi gjenbruker. Datoene er strict-stigende slik at
// «nyeste først»-sortering har et entydig svar.
const seedRecords: PaymentRequest[] = [
  makeRequest("d-1", {
    kind: "deposit",
    userId: "u-A",
    hallId: "hall-a",
    amountCents: 5000,
    status: "PENDING",
    createdAt: "2026-04-10T10:00:00Z",
  }),
  makeRequest("d-2", {
    kind: "deposit",
    userId: "u-B",
    hallId: "hall-b",
    amountCents: 12000,
    status: "ACCEPTED",
    createdAt: "2026-04-11T10:00:00Z",
  }),
  makeRequest("d-3", {
    kind: "deposit",
    userId: "u-A",
    hallId: "hall-a",
    amountCents: 3000,
    status: "REJECTED",
    createdAt: "2026-04-12T10:00:00Z",
  }),
  makeRequest("w-1", {
    kind: "withdraw",
    userId: "u-A",
    hallId: "hall-a",
    amountCents: 8000,
    status: "PENDING",
    destinationType: "bank",
    createdAt: "2026-04-13T10:00:00Z",
  }),
  makeRequest("w-2", {
    kind: "withdraw",
    userId: "u-B",
    hallId: "hall-b",
    amountCents: 15000,
    status: "ACCEPTED",
    destinationType: "hall",
    createdAt: "2026-04-14T10:00:00Z",
  }),
  makeRequest("w-3", {
    kind: "withdraw",
    userId: "u-C",
    hallId: "hall-a",
    amountCents: 2500,
    status: "REJECTED",
    destinationType: "bank",
    createdAt: "2026-04-15T10:00:00Z",
  }),
];

const userMap = {
  admin: makeUser("admin", "ADMIN", null),
  support: makeUser("support", "SUPPORT", null),
  "op-a": makeUser("op-a", "HALL_OPERATOR", "hall-a"),
  "op-b": makeUser("op-b", "HALL_OPERATOR", "hall-b"),
  "op-unassigned": makeUser("op-unassigned", "HALL_OPERATOR", null),
  player: makeUser("player", "PLAYER", null),
};

// ── GAP #10: Deposit history ────────────────────────────────────────────────

test("GAP #10: ADMIN ser alle deposit-rader (status default = alle)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/deposits/history", "admin");
    assert.equal(res.status, 200);
    const data = (res.json as { ok: boolean; data: { items: PaymentRequest[]; nextCursor: string | null } }).data;
    assert.equal(data.items.length, 3);
    // Skal være sortert nyeste først.
    assert.equal(data.items[0]!.id, "d-3");
    assert.equal(data.items[1]!.id, "d-2");
    assert.equal(data.items[2]!.id, "d-1");
    assert.equal(data.nextCursor, null);
  });
});

test("GAP #10: SUPPORT kan lese deposit-history (read-only)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/deposits/history", "support");
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data.items.length, 3);
  });
});

test("GAP #10: HALL_OPERATOR ser kun deposits i egen hall (auto hall-scope)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const res = await get(baseUrl, "/api/admin/deposits/history", "op-a");
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    // d-1 + d-3 er i hall-a, d-2 i hall-b → operator-A skal ikke se d-2.
    assert.equal(data.items.length, 2);
    assert.ok(data.items.every((i) => i.hallId === "hall-a"));
    // Verifiser at service ble kalt med hallId-filter.
    const lastCall = spies.listHistoryCalls.at(-1)!;
    assert.equal(lastCall.hallId, "hall-a");
  });
});

test("GAP #10: HALL_OPERATOR kan IKKE override hallId via query-param", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/deposits/history?hallId=hall-b",
      "op-a"
    );
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "FORBIDDEN"
    );
  });
});

test("GAP #10: HALL_OPERATOR uten tildelt hall → FORBIDDEN", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/deposits/history", "op-unassigned");
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "FORBIDDEN"
    );
  });
});

test("GAP #10: PLAYER blokkeres fra deposit-history", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/deposits/history", "player");
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "FORBIDDEN"
    );
  });
});

test("GAP #10: filter status=ACCEPTED returnerer kun aksepterte", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const res = await get(baseUrl, "/api/admin/deposits/history?status=ACCEPTED", "admin");
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0]!.status, "ACCEPTED");
    assert.deepEqual(spies.listHistoryCalls.at(-1)!.statuses, ["ACCEPTED"]);
  });
});

test("GAP #10: filter status=PENDING,REJECTED (CSV-liste)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const res = await get(
      baseUrl,
      "/api/admin/deposits/history?status=PENDING,REJECTED",
      "admin"
    );
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    const statuses = data.items.map((i) => i.status).sort();
    assert.deepEqual(statuses, ["PENDING", "REJECTED"]);
    assert.deepEqual(
      spies.listHistoryCalls.at(-1)!.statuses?.sort(),
      ["PENDING", "REJECTED"]
    );
  });
});

test("GAP #10: filter playerId begrenser til en spiller", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/deposits/history?playerId=u-A", "admin");
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data.items.length, 2);
    for (const item of data.items) {
      assert.equal(item.userId, "u-A");
    }
  });
});

test("GAP #10: filter fromDate/toDate (dato-only shorthand)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const res = await get(
      baseUrl,
      "/api/admin/deposits/history?fromDate=2026-04-11&toDate=2026-04-11",
      "admin"
    );
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    // Bare d-2 ble seedet på 2026-04-11; toDate=2026-04-11 inkluderer 00:00.
    assert.equal(data.items.length, 0);
    // Verifiser at service mottok ISO-normaliserte verdier.
    const last = spies.listHistoryCalls.at(-1)!;
    assert.equal(last.createdFrom, "2026-04-11T00:00:00.000Z");
    assert.equal(last.createdTo, "2026-04-11T00:00:00.000Z");
  });
});

test("GAP #10: ugyldig fromDate → INVALID_INPUT", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/deposits/history?fromDate=not-a-date",
      "admin"
    );
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "INVALID_INPUT"
    );
  });
});

test("GAP #10: type=vipps returnerer tom liste (kilde-skille forberedelse)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const res = await get(baseUrl, "/api/admin/deposits/history?type=vipps", "admin");
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data.items.length, 0);
    // Service skal IKKE ha blitt kalt — vi stenger ned før queryen.
    assert.equal(spies.listHistoryCalls.length, 0);
  });
});

test("GAP #10: type=hall returnerer alle deposits (alle er cash-in-hall i dag)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/deposits/history?type=hall", "admin");
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data.items.length, 3);
  });
});

test("GAP #10: invalid type → INVALID_INPUT", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/deposits/history?type=garbage",
      "admin"
    );
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "INVALID_INPUT"
    );
  });
});

test("GAP #10: ugyldig status → INVALID_INPUT", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/deposits/history?status=BOGUS",
      "admin"
    );
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "INVALID_INPUT"
    );
  });
});

test("GAP #10: pagination med limit=2 + cursor", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const page1 = await get(
      baseUrl,
      "/api/admin/deposits/history?limit=2",
      "admin"
    );
    const data1 = (page1.json as { data: { items: PaymentRequest[]; nextCursor: string | null } })
      .data;
    assert.equal(data1.items.length, 2);
    assert.ok(data1.nextCursor, "nextCursor må finnes");
    // Side 2.
    const page2 = await get(
      baseUrl,
      `/api/admin/deposits/history?limit=2&cursor=${encodeURIComponent(data1.nextCursor!)}`,
      "admin"
    );
    const data2 = (page2.json as { data: { items: PaymentRequest[]; nextCursor: string | null } })
      .data;
    assert.equal(data2.items.length, 1);
    assert.equal(data2.nextCursor, null);
    const allIds = new Set([...data1.items, ...data2.items].map((i) => i.id));
    assert.equal(allIds.size, 3, "ingen duplikater på tvers av sider");
  });
});

test("GAP #10: format=csv returnerer text/csv med UTF-8 BOM + alle deposit-rader", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    // Hent rå bytes via arrayBuffer for å verifisere BOM (UTF-8 EF BB BF).
    const raw = await fetch(`${baseUrl}/api/admin/deposits/history?format=csv`, {
      method: "GET",
      headers: { Authorization: "Bearer admin" },
    });
    assert.equal(raw.status, 200);
    assert.ok(raw.headers.get("content-type")?.startsWith("text/csv"));
    const buf = new Uint8Array(await raw.arrayBuffer());
    // UTF-8 BOM er bytes 0xEF 0xBB 0xBF.
    assert.equal(buf[0], 0xef, `byte 0: ${buf[0]?.toString(16)}`);
    assert.equal(buf[1], 0xbb, `byte 1: ${buf[1]?.toString(16)}`);
    assert.equal(buf[2], 0xbf, `byte 2: ${buf[2]?.toString(16)}`);
    const text = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
    // Header-raden skal inneholde id-kolonne.
    const firstLine = text.split("\r\n")[0];
    assert.ok(firstLine?.startsWith("id,kind,status"), `first line: ${firstLine}`);
    // Alle 3 deposit-rader + header (4 ikke-tomme linjer).
    const lines = text.split("\r\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 4);
  });
});

test("GAP #10: format=csv leverer Content-Disposition attachment", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/deposits/history?format=csv`, {
      method: "GET",
      headers: { Authorization: "Bearer admin" },
    });
    assert.equal(res.status, 200);
    const cd = res.headers.get("content-disposition");
    assert.ok(cd?.includes("attachment"), `Content-Disposition: ${cd}`);
    assert.ok(cd?.includes("deposit-history-"), `filename: ${cd}`);
  });
});

test("GAP #10: invalid format → INVALID_INPUT", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/deposits/history?format=xml",
      "admin"
    );
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "INVALID_INPUT"
    );
  });
});

// ── GAP #12: Withdraw history ───────────────────────────────────────────────

test("GAP #12: ADMIN ser alle withdraw-rader (status default = alle)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/withdrawals/history", "admin");
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data.items.length, 3);
    // Sortert nyeste først.
    assert.equal(data.items[0]!.id, "w-3");
  });
});

test("GAP #12: type=bank filtrerer til kun bank-uttak", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const res = await get(
      baseUrl,
      "/api/admin/withdrawals/history?type=bank",
      "admin"
    );
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    // w-1 og w-3 er bank.
    assert.equal(data.items.length, 2);
    for (const item of data.items) {
      assert.equal(item.destinationType, "bank");
    }
    assert.equal(spies.listHistoryCalls.at(-1)!.destinationType, "bank");
  });
});

test("GAP #12: type=hall filtrerer til kun hall-utbetaling", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/withdrawals/history?type=hall",
      "admin"
    );
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    // Bare w-2 er hall.
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0]!.destinationType, "hall");
  });
});

test("GAP #12: type=all eller fravær begge fungerer (ingen filter)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const all1 = await get(baseUrl, "/api/admin/withdrawals/history?type=all", "admin");
    assert.equal(all1.status, 200);
    const data1 = (all1.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data1.items.length, 3);
    assert.equal(spies.listHistoryCalls.at(-1)!.destinationType, undefined);

    const all2 = await get(baseUrl, "/api/admin/withdrawals/history", "admin");
    const data2 = (all2.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data2.items.length, 3);
  });
});

test("GAP #12: invalid type → INVALID_INPUT", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/withdrawals/history?type=cash",
      "admin"
    );
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "INVALID_INPUT"
    );
  });
});

test("GAP #12: HALL_OPERATOR kun ser egen hall's withdrawals", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/withdrawals/history", "op-a");
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    // w-1 og w-3 er hall-a; w-2 er hall-b.
    assert.equal(data.items.length, 2);
    assert.ok(data.items.every((i) => i.hallId === "hall-a"));
  });
});

test("GAP #12: PLAYER blokkeres fra withdraw-history", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(baseUrl, "/api/admin/withdrawals/history", "player");
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "FORBIDDEN"
    );
  });
});

test("GAP #12: kombinert filter (status=ACCEPTED + type=hall + playerId)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const res = await get(
      baseUrl,
      "/api/admin/withdrawals/history?status=ACCEPTED&type=hall&playerId=u-B",
      "admin"
    );
    assert.equal(res.status, 200);
    const data = (res.json as { data: { items: PaymentRequest[] } }).data;
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0]!.id, "w-2");
    const last = spies.listHistoryCalls.at(-1)!;
    assert.deepEqual(last.statuses, ["ACCEPTED"]);
    assert.equal(last.destinationType, "hall");
    assert.equal(last.userId, "u-B");
  });
});

test("GAP #12: format=csv returnerer text/csv + alle withdraw-rader", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/withdrawals/history?format=csv",
      "admin"
    );
    assert.equal(res.status, 200);
    assert.ok(res.contentType?.startsWith("text/csv"));
    const lines = res.text
      .replace(/^﻿/, "")
      .split("\r\n")
      .filter((l) => l.length > 0);
    // Header + 3 rader.
    assert.equal(lines.length, 4);
    // Verifiser at destination_type kolonnen er fylt for withdrawals.
    const headerCols = lines[0]!.split(",");
    const destIdx = headerCols.indexOf("destinationType");
    assert.ok(destIdx >= 0);
    // Verifiser at minst én rad har bank/hall.
    const dataRows = lines.slice(1);
    const destValues = dataRows.map((row) => row.split(",")[destIdx]);
    assert.ok(
      destValues.some((v) => v === "bank" || v === "hall"),
      `dest values: ${destValues.join(", ")}`
    );
  });
});

test("GAP #12: ugyldig limit → INVALID_INPUT", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/withdrawals/history?limit=abc",
      "admin"
    );
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "INVALID_INPUT"
    );
  });
});

test("GAP #12: limit=0 → INVALID_INPUT (positivt heltall kreves)", async () => {
  await withServer(userMap, seedRecords, async (baseUrl) => {
    const res = await get(
      baseUrl,
      "/api/admin/withdrawals/history?limit=0",
      "admin"
    );
    assert.equal(res.status, 400);
    assert.equal(
      (res.json as { error?: { code?: string } }).error?.code,
      "INVALID_INPUT"
    );
  });
});

test("GAP #12: limit clampes ned til 500 ved store verdier", async () => {
  await withServer(userMap, seedRecords, async (baseUrl, spies) => {
    const res = await get(
      baseUrl,
      "/api/admin/withdrawals/history?limit=99999",
      "admin"
    );
    assert.equal(res.status, 200);
    assert.equal(spies.listHistoryCalls.at(-1)!.limit, 500);
  });
});

// ── RBAC-table (matcher mønsteret i adminPaymentRequests.test.ts) ────────────

test("GAP #10/#12: history-endepunktene gjenbruker PAYMENT_REQUEST_READ-policy", async () => {
  // Bare en sanity-sjekk på at ingen uventede roller slipper gjennom —
  // selve policy-table testes i adminPaymentRequests.test.ts.
  await withServer(userMap, seedRecords, async (baseUrl) => {
    // PLAYER → 400 FORBIDDEN på begge.
    const dep = await get(baseUrl, "/api/admin/deposits/history", "player");
    const wd = await get(baseUrl, "/api/admin/withdrawals/history", "player");
    assert.equal(dep.status, 400);
    assert.equal(wd.status, 400);
    assert.equal((dep.json as { error?: { code?: string } }).error?.code, "FORBIDDEN");
    assert.equal((wd.json as { error?: { code?: string } }).error?.code, "FORBIDDEN");
  });
});
