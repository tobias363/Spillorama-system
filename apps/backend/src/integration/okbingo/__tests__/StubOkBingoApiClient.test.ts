/**
 * BIN-583 B3.5: Stub OK Bingo client tester.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { StubOkBingoApiClient } from "../StubOkBingoApiClient.js";
import { DomainError } from "../../../game/BingoEngine.js";

test("createTicket returnerer ticket + roomId", async () => {
  const client = new StubOkBingoApiClient();
  const r = await client.createTicket({ amountCents: 5000, roomId: 247, uniqueTransaction: "tx-1" });
  assert.ok(r.ticketNumber);
  assert.equal(r.roomId, 247);
});

test("createTicket idempotent-violation", async () => {
  const client = new StubOkBingoApiClient();
  await client.createTicket({ amountCents: 5000, roomId: 247, uniqueTransaction: "tx-x" });
  await assert.rejects(
    client.createTicket({ amountCents: 5000, roomId: 247, uniqueTransaction: "tx-x" }),
    (err) => err instanceof DomainError && err.code === "OKBINGO_DUPLICATE_TX"
  );
});

test("topup + close balance-flow", async () => {
  const client = new StubOkBingoApiClient();
  const c = await client.createTicket({ amountCents: 10000, roomId: 247, uniqueTransaction: "tx-c" });
  const t = await client.topupTicket({
    ticketNumber: c.ticketNumber, amountCents: 5000, roomId: 247, uniqueTransaction: "tx-t",
  });
  assert.equal(t.newBalanceCents, 15000);
  const cl = await client.closeTicket({
    ticketNumber: c.ticketNumber, roomId: 247, uniqueTransaction: "tx-cl",
  });
  assert.equal(cl.finalBalanceCents, 15000);
});

test("close på allerede lukket → OKBINGO_TICKET_CLOSED", async () => {
  const client = new StubOkBingoApiClient();
  const c = await client.createTicket({ amountCents: 5000, roomId: 247, uniqueTransaction: "tx-1" });
  await client.closeTicket({ ticketNumber: c.ticketNumber, roomId: 247, uniqueTransaction: "tx-2" });
  await assert.rejects(
    client.closeTicket({ ticketNumber: c.ticketNumber, roomId: 247, uniqueTransaction: "tx-3" }),
    (err) => err instanceof DomainError && err.code === "OKBINGO_TICKET_CLOSED"
  );
});

test("openDay registrerer roomId", async () => {
  const client = new StubOkBingoApiClient();
  await client.openDay(247);
  assert.equal(client.isDayOpened(247), true);
});

test("failOnce trigger feil", async () => {
  const client = new StubOkBingoApiClient();
  client.failOnce("create", "OKBINGO_API_ERROR");
  await assert.rejects(
    client.createTicket({ amountCents: 5000, roomId: 247, uniqueTransaction: "tx-fail" }),
    (err) => err instanceof DomainError && err.code === "OKBINGO_API_ERROR"
  );
  // Etter feil skal create fungere igjen
  const r = await client.createTicket({ amountCents: 5000, roomId: 247, uniqueTransaction: "tx-ok" });
  assert.ok(r.ticketNumber);
});
