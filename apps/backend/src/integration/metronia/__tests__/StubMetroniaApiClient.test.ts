/**
 * BIN-583 B3.4: Stub-client tester. Verifiserer ticket-state-machine
 * og failOnce-test-helper. Real HttpMetroniaApiClient er thin wrapper
 * over fetch og testes med mocked fetch i en separat fil hvis behov.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { StubMetroniaApiClient } from "../StubMetroniaApiClient.js";
import { DomainError } from "../../../game/BingoEngine.js";

test("createTicket returnerer unik ticketNumber + ticketId", async () => {
  const client = new StubMetroniaApiClient();
  const r = await client.createTicket({ amountCents: 5000, uniqueTransaction: "tx-1" });
  assert.ok(r.ticketNumber);
  assert.ok(r.ticketId);
});

test("createTicket idempotent-violation: samme uniqueTransaction → DUPLICATE", async () => {
  const client = new StubMetroniaApiClient();
  await client.createTicket({ amountCents: 5000, uniqueTransaction: "tx-x" });
  await assert.rejects(
    client.createTicket({ amountCents: 5000, uniqueTransaction: "tx-x" }),
    (err) => err instanceof DomainError && err.code === "METRONIA_DUPLICATE_TX"
  );
});

test("topup øker balance + close returnerer balance", async () => {
  const client = new StubMetroniaApiClient();
  const created = await client.createTicket({ amountCents: 10000, uniqueTransaction: "tx-c" });
  const top = await client.topupTicket({
    ticketNumber: created.ticketNumber, amountCents: 2000, uniqueTransaction: "tx-t",
  });
  assert.equal(top.newBalanceCents, 12000);
  const closed = await client.closeTicket({
    ticketNumber: created.ticketNumber, uniqueTransaction: "tx-cl",
  });
  assert.equal(closed.finalBalanceCents, 12000);
});

test("close på allerede lukket ticket → METRONIA_TICKET_CLOSED", async () => {
  const client = new StubMetroniaApiClient();
  const created = await client.createTicket({ amountCents: 5000, uniqueTransaction: "tx-1" });
  await client.closeTicket({ ticketNumber: created.ticketNumber, uniqueTransaction: "tx-2" });
  await assert.rejects(
    client.closeTicket({ ticketNumber: created.ticketNumber, uniqueTransaction: "tx-3" }),
    (err) => err instanceof DomainError && err.code === "METRONIA_TICKET_CLOSED"
  );
});

test("failOnce trigger feil på neste create", async () => {
  const client = new StubMetroniaApiClient();
  client.failOnce("create", "METRONIA_API_ERROR");
  await assert.rejects(
    client.createTicket({ amountCents: 5000, uniqueTransaction: "tx-fail" }),
    (err) => err instanceof DomainError && err.code === "METRONIA_API_ERROR"
  );
  // Etter feil skal create fungere igjen
  const r = await client.createTicket({ amountCents: 5000, uniqueTransaction: "tx-ok" });
  assert.ok(r.ticketNumber);
});
