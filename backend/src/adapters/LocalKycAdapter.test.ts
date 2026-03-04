import assert from "node:assert/strict";
import test from "node:test";
import { LocalKycAdapter } from "./LocalKycAdapter.js";

function yearsAgoDate(years: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

test("LocalKycAdapter verifies adult users", async () => {
  const adapter = new LocalKycAdapter({ minAgeYears: 18 });
  const result = await adapter.verify({
    userId: "user-1",
    birthDate: yearsAgoDate(25)
  });

  assert.equal(result.decision, "VERIFIED");
  assert.ok(result.providerReference.startsWith("local-kyc-"));
});

test("LocalKycAdapter rejects underage users", async () => {
  const adapter = new LocalKycAdapter({ minAgeYears: 18 });
  const result = await adapter.verify({
    userId: "user-2",
    birthDate: yearsAgoDate(15)
  });

  assert.equal(result.decision, "REJECTED");
  assert.equal(result.reason, "UNDERAGE");
});
